"""One limited last-block adaptation of the existing model, validation-only selection.

No evaluation images enter training. Crops/contrast address background and LCD
domain mismatch; the architecture, class order and .NET preprocessing stay fixed.
All labels remain provisional. This is not independent business acceptance.
"""
import argparse
import hashlib
import json
from pathlib import Path
import random

import cv2
import numpy as np
import onnx
import onnxruntime as ort
from PIL import Image
import torch
from transformers import CLIPModel

from train_runtime_meter_heads import ExportModel, VisualHeads, runtime_pixels, metrics, WEIGHTS_SHA
from prepare_continued_classification import assert_isolation


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['clip', 'heads', 'manifest', 'root', 'output']:
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    if hashlib.sha256((args.clip/'pytorch_model.bin').read_bytes()).hexdigest() != WEIGHTS_SHA:
        raise ValueError('Changed backbone')
    samples = json.loads(args.manifest.read_text())['samples']
    assert_isolation(samples)
    seed = 73
    random.seed(seed); np.random.seed(seed); torch.manual_seed(seed); torch.set_num_threads(2)
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    backbone = CLIPModel.from_pretrained(args.clip, local_files_only=True, attn_implementation='eager')
    heads = VisualHeads(); heads.load_state_dict(torch.load(args.heads, map_location='cpu', weights_only=True))
    model = ExportModel(backbone, heads).to(device)
    for parameter in model.parameters(): parameter.requires_grad_(False)
    for module in [model.vision.encoder.layers[-1], model.vision.post_layernorm, model.projection, model.heads]:
        for parameter in module.parameters(): parameter.requires_grad_(True)
    utilities = ['electricity', 'water', 'not_meter']; technologies = ['mechanical', 'digital']
    train = [s for s in samples if s['split']=='train']
    validation = [s for s in samples if s['split']=='validation']
    images = {}

    def load(sample):
        path = (args.root/sample['image']).resolve()
        if not path.is_relative_to(args.root.resolve()) or hashlib.sha256(path.read_bytes()).hexdigest()!=sample['sha256']:
            raise ValueError('Changed source')
        return cv2.imread(str(path))

    for sample in train+validation: images[sample['id']] = load(sample)

    def pixels(image, augment=False):
        if augment:
            h,w = image.shape[:2]; ratio = random.uniform(.8,1)
            rh,rw = max(1,round(h*ratio)),max(1,round(w*ratio))
            y,x = random.randint(0,h-rh),random.randint(0,w-rw)
            image = image[y:y+rh,x:x+rw]
            # Preserve every glyph: no digit editing, random erasing or mirroring.
            gain, gamma = random.uniform(.7,1.3),random.uniform(.8,1.2)
            table = np.clip(gain*255*(np.arange(256)/255)**gamma,0,255).astype(np.uint8)
            image = cv2.LUT(image,table)
        return runtime_pixels(Image.fromarray(image[:,:,::-1]))

    def observations(subset):
        model.eval(); rows=[]
        with torch.inference_mode():
            for sample in subset:
                tensor = torch.from_numpy(pixels(images[sample['id']])[None]).to(device)
                u,t = model(tensor)
                rows.append({'id':sample['id'],'expected':sample['category'],
                    'utility':dict(zip(utilities,u.softmax(-1)[0].cpu().tolist())),
                    'technology':dict(zip(technologies,t.softmax(-1)[0].cpu().tolist()))})
        return rows

    # Four-category balance rather than technology-only balance: each utility's
    # mechanical/digital styles receive equal weight within their own head loss.
    counts = {c:sum(s['category']==c for s in train) for c in {s['category'] for s in train}}
    backbone_parameters = [p for name,p in model.named_parameters() if p.requires_grad and not name.startswith('heads.')]
    optimizer = torch.optim.AdamW([{'params':backbone_parameters,'lr':1e-5},
        {'params':model.heads.parameters(),'lr':3e-4}],weight_decay=.1)
    thresholds = (.55,.75); candidates=[]; best=None; best_state=None
    for epoch in range(13):
        if epoch:
            model.train(); random.shuffle(train)
            for offset in range(0,len(train),8):
                batch = train[offset:offset+8]
                x = torch.from_numpy(np.stack([pixels(images[s['id']],True) for s in batch])).to(device)
                yu = torch.tensor([2 if s['category']=='not_meter' else utilities.index(s['category'].split('_')[0]) for s in batch],device=device)
                yt = torch.tensor([-1 if s['category']=='not_meter' else technologies.index(s['category'].split('_')[1]) for s in batch],device=device)
                weights = torch.tensor([len(train)/(len(counts)*counts[s['category']]) for s in batch],device=device)
                u,t = model(x); mask = yt>=0
                loss = (torch.nn.functional.cross_entropy(u,yu,reduction='none')*weights).mean()
                if mask.any(): loss += (torch.nn.functional.cross_entropy(t[mask],yt[mask],reduction='none')*weights[mask]).mean()
                optimizer.zero_grad(); loss.backward(); torch.nn.utils.clip_grad_norm_(model.parameters(),1); optimizer.step()
        if epoch in [0,2,4,8,12]:
            rows = observations(validation); score=metrics(rows,thresholds)
            candidate = {'epoch':epoch,**score}; candidates.append(candidate)
            ranking=(-score['counts']['wrong'],score['counts']['correct'],-epoch)
            if best is None or ranking>best:
                best=ranking; best_state={k:v.detach().cpu().clone() for k,v in model.state_dict().items()}
                selected={'epoch':epoch,**score,'rows':rows}
            print(json.dumps(candidate),flush=True)
    selection={'selected':selected,'candidates':candidates,'thresholds':thresholds,
        'passesDevelopmentReplacementGate':selected['counts']['wrong']==0 and selected['counts']['correct']>1}
    (args.output/'selection-before-test.json').write_text(json.dumps(selection,indent=2)+'\n')
    model.load_state_dict(best_state);model.eval()
    test=[s for s in samples if s['split']=='test']
    for sample in test:images[sample['id']]=load(sample)
    test_rows=observations(test)
    model=model.cpu();torch.save(model.state_dict(),args.output/'vision-heads.pt')
    example=torch.from_numpy(pixels(images[test[0]['id']])[None])
    torch.onnx.export(model,(example,),str(args.output/'classifier.onnx'),opset_version=17,
        input_names=['pixel_values'],output_names=['utility_logits','technology_logits'],dynamo=False)
    graph=onnx.load(str(args.output/'classifier.onnx'))
    onnx.helper.set_model_props(graph,{'bhome.utility_classes':','.join(utilities),
        'bhome.technology_classes':','.join(technologies),'bhome.preprocessing':'rgb-cubic-letterbox224-clip-v1',
        'bhome.base_sha256':WEIGHTS_SHA,'bhome.adaptation':'last-vision-block-v1'})
    onnx.save(graph,str(args.output/'classifier.onnx'))
    settings=ort.SessionOptions();settings.intra_op_num_threads=2
    session=ort.InferenceSession(str(args.output/'classifier.onnx'),sess_options=settings,providers=['CPUExecutionProvider'])
    parity=[]
    for sample in test:
        tensor=torch.from_numpy(pixels(images[sample['id']])[None])
        with torch.inference_mode():native=model(tensor)
        converted=session.run(None,{'pixel_values':tensor.numpy()})
        delta=max(float(np.abs(a.numpy()-b).max()) for a,b in zip(native,converted))
        if delta>1e-3:raise ValueError('Native/ONNX mismatch')
        parity.append({'id':sample['id'],'maxLogitDelta':delta})
    result={'scope':'provisional_last_block_adaptation_not_independent_acceptance','seed':seed,
        'trainCount':len(train),'baseSha256':WEIGHTS_SHA,'initialHeadsSha256':hashlib.sha256(args.heads.read_bytes()).hexdigest(),
        'modelSha256':hashlib.sha256((args.output/'classifier.onnx').read_bytes()).hexdigest(),
        'manifestSha256':hashlib.sha256(args.manifest.read_bytes()).hexdigest(),
        'selection':selection,'test':metrics(test_rows,thresholds),'rows':test_rows,'parity':parity,
        'businessProposalEnabled':False,'humanReviewCount':0}
    (args.output/'report.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'selection':selected['counts'],'test':result['test'],'sha':result['modelSha256']}),flush=True)


if __name__=='__main__':main()
