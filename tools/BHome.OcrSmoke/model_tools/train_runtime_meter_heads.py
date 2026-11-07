"""Supervised visual heads, real CLIP vision ONNX export, validation-only selection.

Hard negatives and hybrid wheel meters change the training evidence. Historical
evaluation images never train weights. All labels remain provisional; diagnostics
only, not business acceptance. No filename, OCR or Meter metadata model inputs.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys

import numpy as np
from PIL import Image, ImageOps
import torch
from torch import nn
from transformers import CLIPModel, CLIPProcessor
import onnxruntime as ort
import cv2

sys.path.insert(0, str(Path(__file__).resolve().parent))
from study_meter_hierarchy import WEIGHTS_SHA
from prepare_continued_classification import assert_isolation
from meter_hierarchy_policy import hierarchy_decision


def runtime_pixels(image):
    bgr = np.asarray(image)[:, :, ::-1].copy(); h,w = bgr.shape[:2]
    ratio = min(1,1600/max(w,h))
    if ratio<1: bgr=cv2.resize(bgr,(max(1,int(w*ratio)),max(1,int(h*ratio))),interpolation=cv2.INTER_AREA)
    h,w=bgr.shape[:2];scale=min(224/w,224/h);rw,rh=round(w*scale),round(h*scale)
    resized=cv2.resize(bgr,(rw,rh),interpolation=cv2.INTER_CUBIC)
    padded=np.full((224,224,3),(104,117,123),dtype=np.uint8);left,top=(224-rw)//2,(224-rh)//2;padded[top:top+rh,left:left+rw]=resized
    rgb=padded[:,:,::-1].astype(np.float32)/255
    return ((rgb-np.array([.48145466,.4578275,.40821073],np.float32))/np.array([.26862954,.26130258,.27577711],np.float32)).transpose(2,0,1).copy()


class VisualHeads(nn.Module):
    def __init__(self):
        super().__init__(); self.utility = nn.Linear(512, 3); self.technology = nn.Linear(512, 2)

    def forward(self, features):
        return self.utility(features), self.technology(features)


class ExportModel(nn.Module):
    def __init__(self, clip, heads):
        super().__init__(); self.vision = clip.vision_model; self.projection = clip.visual_projection; self.heads = heads

    def forward(self, pixel_values):
        vector = self.projection(self.vision(pixel_values=pixel_values).pooler_output)
        vector = vector / vector.norm(dim=-1, keepdim=True)
        return self.heads(vector)


def metrics(rows, threshold):
    counts = dict(inputs=len(rows), meters=sum(r['expected'] != 'not_meter' for r in rows), correct=0, wrong=0, unknown=0, negativeFalseAccepted=0)
    matrix = {}
    for r in rows:
        predicted = hierarchy_decision(r['utility'], r['technology'], *threshold)
        counts['correct'] += predicted == r['expected']; counts['wrong'] += predicted != 'unknown' and predicted != r['expected']
        counts['unknown'] += predicted == 'unknown'; counts['negativeFalseAccepted'] += r['expected'] == 'not_meter' and predicted != 'unknown'
        key = r['expected'] + '->' + predicted; matrix[key] = matrix.get(key, 0) + 1
    return {'counts': counts, 'confusion': matrix}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for name in ['clip', 'manifest', 'root', 'output']: p.add_argument(name, type=Path)
    a = p.parse_args()
    if a.output.exists(): raise ValueError('Use a fresh run')
    a.output.mkdir(parents=True)
    if hashlib.sha256((a.clip / 'pytorch_model.bin').read_bytes()).hexdigest() != WEIGHTS_SHA: raise ValueError('CLIP changed')
    samples = json.loads(a.manifest.read_text())['samples']; assert_isolation(samples)
    torch.manual_seed(41); torch.set_num_threads(2); device = 'cuda' if torch.cuda.is_available() else 'cpu'
    clip = CLIPModel.from_pretrained(a.clip, local_files_only=True, attn_implementation='eager').to(device).eval()
    processor = CLIPProcessor.from_pretrained(a.clip, local_files_only=True)
    utility_names = ['electricity', 'water', 'not_meter']; technology_names = ['mechanical', 'digital']
    features = {}; pixels = {}; targets_u = []; targets_t = []; train = []
    # TRAIN and validation encoded first. Test pixels are not read until selection.
    for sample in [s for s in samples if s['split'] != 'test']:
        path = (a.root / sample['image']).resolve()
        if not path.is_relative_to(a.root.resolve()) or hashlib.sha256(path.read_bytes()).hexdigest() != sample['sha256']: raise ValueError('Frozen image changed')
        with Image.open(path) as source: image = ImageOps.exif_transpose(source).convert('RGB')
        angles = [-5, 0, 5] if sample['split'] == 'train' else [0]
        views = [image.rotate(angle, resample=Image.Resampling.BICUBIC, expand=True, fillcolor=(123,117,104)) for angle in angles]
        batch = torch.from_numpy(np.stack([runtime_pixels(v) for v in views])).to(device)
        with torch.inference_mode(): vector = clip.get_image_features(batch); vector /= vector.norm(dim=-1, keepdim=True)
        features[sample['id']] = vector.detach().clone(); pixels[sample['id']] = batch.detach().cpu()
        if sample['split'] == 'train':
            train.append(vector.detach().clone()); category = sample['category']
            targets_u += [2 if category == 'not_meter' else utility_names.index(category.split('_')[0])] * len(angles)
            targets_t += [-1 if category == 'not_meter' else technology_names.index(category.split('_')[1])] * len(angles)
    x = torch.cat(train).clone(); yu = torch.tensor(targets_u, device=device); yt = torch.tensor(targets_t, device=device)
    heads = VisualHeads().to(device); optimizer = torch.optim.AdamW(heads.parameters(), lr=.01, weight_decay=.1)
    weights_u = len(yu) / (3 * torch.bincount(yu).float()); mask = yt >= 0
    weights_t = mask.sum() / (2 * torch.bincount(yt[mask]).float())
    validation = [s for s in samples if s['split'] == 'validation']; candidates = []; checkpoints = {}
    def observations(subset):
        rows = []
        for sample in subset:
            with torch.no_grad(): u,t = heads(features[sample['id']][:1]); u = u.softmax(-1)[0].cpu().tolist(); t = t.softmax(-1)[0].cpu().tolist()
            rows.append({'id': sample['id'], 'expected': sample['category'], 'utility': dict(zip(utility_names,u)), 'technology': dict(zip(technology_names,t))})
        return rows
    for epoch in range(1, 401):
        heads.train(); u,t = heads(x)
        loss = nn.functional.cross_entropy(u,yu,weight=weights_u) + nn.functional.cross_entropy(t[mask],yt[mask],weight=weights_t)
        optimizer.zero_grad(); loss.backward(); optimizer.step()
        if epoch in [50,100,200,400]:
            heads.eval(); checkpoints[epoch] = {k:v.detach().cpu().clone() for k,v in heads.state_dict().items()}
            rows = observations(validation)
            for a_u in [.55,.7,.85,.95]:
                for a_t in [.55,.65,.75,.85]:
                    m = metrics(rows,(a_u,a_t)); c = m['counts']
                    candidates.append({'epoch':epoch,'thresholds':[a_u,a_t],**m})
    eligible = [c for c in candidates if c['counts']['wrong']==0 and c['counts']['correct']>0]
    chosen = max(eligible,key=lambda c:(c['counts']['correct'],min(c['thresholds']),-c['epoch'])) if eligible else min(candidates,key=lambda c:(c['counts']['wrong'],-c['counts']['correct'],c['epoch']))
    heads.load_state_dict(checkpoints[chosen['epoch']]); heads.eval()
    selection = {'chosen':chosen,'positiveZeroWrongPolicyFound':bool(eligible),'candidates':candidates}
    (a.output/'selection-before-test.json').write_text(json.dumps(selection,indent=2)+'\n')
    test = [s for s in samples if s['split']=='test']
    for sample in test:
        path=a.root/sample['image']
        if hashlib.sha256(path.read_bytes()).hexdigest()!=sample['sha256']: raise ValueError('Frozen held-out image changed')
        with Image.open(path) as source: image=ImageOps.exif_transpose(source).convert('RGB')
        pixel=torch.from_numpy(runtime_pixels(image)[None]).to(device)
        with torch.no_grad(): vector=clip.get_image_features(pixel);vector/=vector.norm(dim=-1,keepdim=True)
        pixels[sample['id']]=pixel.cpu();features[sample['id']]=vector
    rows=observations(test); torch.save(heads.state_dict(),a.output/'heads.pt')
    exported=ExportModel(clip.cpu(),heads.cpu()).eval(); example=pixels[test[0]['id']]
    torch.onnx.export(exported,(example,),str(a.output/'classifier.onnx'),opset_version=17,input_names=['pixel_values'],output_names=['utility_logits','technology_logits'],dynamo=False)
    import onnx
    graph=onnx.load(str(a.output/'classifier.onnx'))
    onnx.helper.set_model_props(graph,{'bhome.utility_classes':'electricity,water,not_meter','bhome.technology_classes':'mechanical,digital','bhome.preprocessing':'rgb-cubic-letterbox224-clip-v1','bhome.base_sha256':WEIGHTS_SHA})
    onnx.save(graph,str(a.output/'classifier.onnx'))
    options=ort.SessionOptions();options.intra_op_num_threads=2
    session=ort.InferenceSession(str(a.output/'classifier.onnx'),sess_options=options,providers=['CPUExecutionProvider']);parity=[]
    for sample in test:
        tensor=pixels[sample['id']]
        with torch.no_grad(): expected=exported(tensor)
        observed=session.run(None,{'pixel_values':tensor.numpy()});delta=max(float(np.max(np.abs(native.numpy()-converted))) for native,converted in zip(expected,observed))
        if delta>1e-3: raise ValueError('Native ONNX logit mismatch')
        np.save(a.output/(sample['id']+'-input.npy'),tensor.numpy())
        parity.append({'id':sample['id'],'maxLogitDelta':delta,'logits':[v.tolist() for v in observed]})
    result={'scope':'provisional_supervised_diagnostics_not_business_acceptance','clipSha256':WEIGHTS_SHA,'modelSha256':hashlib.sha256((a.output/'classifier.onnx').read_bytes()).hexdigest(),
        'manifestSha256':hashlib.sha256(a.manifest.read_bytes()).hexdigest(),'selection':chosen,'positiveZeroWrongValidationPolicyFound':bool(eligible),
        'utilityClasses':utility_names,'technologyClasses':technology_names,'preprocessing':{'shape':[1,3,224,224],'color':'RGB','resize':'cap1600_area_then_OpenCV_cubic_letterbox224','paddingRgb':[123,117,104],'mean':[.48145466,.4578275,.40821073],'std':[.26862954,.26130258,.27577711]},
        'test':metrics(rows,chosen['thresholds']),'rows':rows,'parity':parity,'activation':'development_diagnostics_only','humanReviewsReceived':0}
    (a.output/'report.json').write_text(json.dumps(result,indent=2)+'\n'); print(json.dumps({'selection':chosen,'test':result['test'],'sha256':result['modelSha256']}))


if __name__=='__main__': main()
