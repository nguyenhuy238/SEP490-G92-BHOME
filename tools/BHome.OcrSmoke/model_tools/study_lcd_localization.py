"""Compare frozen YOLO and class-agnostic Grounding DINO display localization.

Full-frame and oracle-body crops are reported separately. Existing Commons
numeric-region proxy GT is never expanded to make a screen detector pass. Prompt,
resolution and thresholds are chosen on validation before historical test probes.
All model inference is local; no model training or application activation.
"""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import sys
import time

import cv2
import numpy as np
from PIL import Image
import torch
from transformers import AutoConfig, AutoProcessor, AutoModelForZeroShotObjectDetection
import onnxruntime as ort

sys.path.insert(0,str(Path(__file__).resolve().parent))
from compare_paddle_meter_models import PaddleCtcReader
from evaluate_finetuned_yolo import letterbox,decode,iou

WEIGHTS_SHA='1a2412ef99bd74bcd3c2a246fa1e48581f8889a1300c9051974741314fc042f3'
YOLO_SHA='a6e4bc8e9b40ad3151039b889e12f830a2993cf8e690f557bfecb1a1d519de37'
PROMPTS=['lcd screen.','digital meter reading display.']


def nms(boxes):
    kept=[]
    for box in sorted(boxes,key=lambda b:b['score'],reverse=True):
        if not any(iou(box['box'],other['box'])>.5 for other in kept):kept.append(box)
        if len(kept)==20:break
    return kept


def score(samples,observations,threshold):
    counts=Counter()
    for sample,observed in zip(samples,observations):
        boxes=[b for b in observed['boxes'] if b['score']>=threshold]
        matches=[iou(b['box'],sample['crop'])>=.5 for b in boxes]
        counts.update(inputs=1,localizedAny=any(matches),correctUniqueSelection=len(boxes)==1 and any(matches),
                      missing=not boxes,multipleRegions=len(boxes)>1,proxyNonmatchingBoxes=sum(not v for v in matches))
    return counts


def view(image,sample,body,scope):
    if scope=='full_frame':return image,0,0
    polygon=body[sample['id']]['meterPolygon'];h,w=image.shape[:2]
    x1=max(0,int(min(p[0] for p in polygon)*w));y1=max(0,int(min(p[1] for p in polygon)*h))
    x2=min(w,int(max(p[0] for p in polygon)*w));y2=min(h,int(max(p[1] for p in polygon)*h))
    if x1>=x2 or y1>=y2:raise ValueError('Invalid frozen oracle-body polygon')
    return image[y1:y2,x1:x2],x1,y1


def predict_grounding(model,processor,image,prompt,size,device):
    pil=Image.fromarray(cv2.cvtColor(image,cv2.COLOR_BGR2RGB))
    inputs=processor(images=pil,text=prompt,size={'shortest_edge':size,'longest_edge':1333},return_tensors='pt').to(device)
    if device=='cuda':torch.cuda.synchronize()
    started=time.perf_counter()
    with torch.no_grad():outputs=model(**inputs)
    result=processor.post_process_grounded_object_detection(outputs,inputs.input_ids,box_threshold=.15,text_threshold=.25,target_sizes=[image.shape[:2]])[0]
    if device=='cuda':torch.cuda.synchronize()
    boxes=[];h,w=image.shape[:2]
    for coordinates,confidence,label in zip(result['boxes'].cpu().numpy(),result['scores'].cpu().numpy(),result['labels']):
        coordinates=np.clip(coordinates,[0,0,0,0],[w,h,w,h]);x1,y1,x2,y2=map(float,coordinates)
        if np.isfinite(coordinates).all() and x1<x2 and y1<y2:
            boxes.append({'box':[x1,y1,x2,y2],'score':float(confidence),'phrase':label})
    return {'boxes':nms(boxes),'elapsedMs':(time.perf_counter()-started)*1000}


def predict_yolo(session,image):
    tensor,scale,left,top=letterbox(image,416);started=time.perf_counter()
    raw=session.run(None,{session.get_inputs()[0].name:tensor})[0]
    boxes=[{'box':b['box'],'score':b['score'],'phrase':'reading_region'} for b in decode(raw,image.shape,scale,left,top,threshold=.25) if b['class']==0]
    return {'boxes':boxes,'elapsedMs':(time.perf_counter()-started)*1000}


def shift(result,x,y):
    return {**result,'boxes':[{**b,'box':[b['box'][0]+x,b['box'][1]+y,b['box'][2]+x,b['box'][3]+y]} for b in result['boxes']]}


def numeric_observation(image,boxes,threshold,readers):
    selected=[b for b in boxes if b['score']>=threshold]
    if len(selected)!=1:return {'reason':'missing_or_multiple_regions','recognition':{}}
    x1,y1,x2,y2=selected[0]['box'];h,w=image.shape[:2]
    x1=max(0,int(np.floor(x1)));y1=max(0,int(np.floor(y1)));x2=min(w,int(np.ceil(x2)));y2=min(h,int(np.ceil(y2)))
    crop=image[y1:y2,x1:x2]
    return {'reason':'one_predicted_region_not_register_verified','bounds':[x1,y1,x2,y2],
            'recognition':{name:reader.read(crop) for name,reader in readers.items()}}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name in ['grounding','yolo','english','server','root','output']:p.add_argument(name,type=Path)
    a=p.parse_args()
    if a.output.exists():raise ValueError('Never overwrite an evaluated localization study')
    if hashlib.sha256((a.grounding/'model.safetensors').read_bytes()).hexdigest()!=WEIGHTS_SHA or hashlib.sha256(a.yolo.read_bytes()).hexdigest()!=YOLO_SHA:
        raise ValueError('Pinned detector weights changed')
    provenance=json.loads((a.grounding/'provenance.json').read_text())
    for name,entry in provenance['files'].items():
        if Path(name).name!=name or hashlib.sha256((a.grounding/name).read_bytes()).hexdigest()!=entry['sha256']:
            raise ValueError('Grounding model/tokenizer changed')
    a.output.mkdir(parents=True);torch.set_num_threads(2);device='cuda' if torch.cuda.is_available() else 'cpu'
    config=AutoConfig.from_pretrained(a.grounding,local_files_only=True);config.disable_custom_kernels=True
    model=AutoModelForZeroShotObjectDetection.from_pretrained(a.grounding,config=config,local_files_only=True).to(device).eval()
    processor=AutoProcessor.from_pretrained(a.grounding,local_files_only=True)
    settings=ort.SessionOptions();settings.intra_op_num_threads=2
    yolo=ort.InferenceSession(str(a.yolo),settings,providers=['CPUExecutionProvider'])
    readers={'english':PaddleCtcReader('english_mobile',a.english),'server':PaddleCtcReader('multilingual_server',a.server)}
    body={r['id']:r for r in json.loads((a.root/'docs/datasets/meter/four-class-development-v2.json').read_text())['samples']}
    samples=json.loads((a.root/'docs/datasets/meter/lcd-evaluation.json').read_text())['samples']
    catalog={r['id']:r for r in json.loads((a.root/'docs/datasets/meter/public-sources.json').read_text())['assets']}
    images={}
    for sample in samples:
        path=a.root/'.tools/master-dataset/commons'/(sample['id']+'.jpg')
        if hashlib.sha256(path.read_bytes()).hexdigest()!=catalog[sample['id']]['sha256']:raise ValueError('Frozen public image changed')
        images[sample['id']]=cv2.imread(str(path))
    validation=[s for s in samples if s['split']=='val'];test=[s for s in samples if s['split']=='test']
    grids={};selected={};rows=[]
    for scope in ['full_frame','oracle_meter_body']:
        candidates={}
        for prompt in PROMPTS:
            for size in [640,800]:
                key=f'{prompt}:{size}';observations=[]
                for sample in validation:
                    crop,x,y=view(images[sample['id']],sample,body,scope)
                    observations.append(shift(predict_grounding(model,processor,crop,prompt,size,device),x,y))
                candidates[key]={'prompt':prompt,'size':size,'observations':observations,
                                 'thresholds':{str(t):score(validation,observations,t) for t in [.25,.35,.45,.55]}}
        grids[scope]=candidates;eligible=[]
        for key,candidate in candidates.items():
            for t,counts in candidate['thresholds'].items():
                if counts['correctUniqueSelection']>0 and counts['proxyNonmatchingBoxes']==0:
                    eligible.append((counts['correctUniqueSelection'],float(t),-candidate['size'],key))
        if eligible:
            _,threshold,_,key=max(eligible);chosen=candidates[key]
            selected[scope]={'prompt':chosen['prompt'],'size':chosen['size'],'threshold':threshold,'validationPolicyFound':True}
        else:selected[scope]={'prompt':PROMPTS[0],'size':800,'threshold':.35,'validationPolicyFound':False,'descriptiveOnly':True}
    # Configuration frozen before evaluating historical test; no refit/selection.
    for scope,choice in selected.items():
        for sample in validation+test:
            image=images[sample['id']];crop,x,y=view(image,sample,body,scope)
            ground=shift(predict_grounding(model,processor,crop,choice['prompt'],choice['size'],device),x,y)
            baseline=shift(predict_yolo(yolo,crop),x,y)
            for method,observation,threshold in [('grounding',ground,choice['threshold']),('previous_yolo',baseline,.25)]:
                boxes=[b for b in observation['boxes'] if b['score']>=threshold]
                matches=[iou(b['box'],sample['crop']) for b in boxes]
                rows.append({'id':sample['id'],'split':sample['split'],'scope':scope,'method':method,
                             'expectedNumericRegion':sample['crop'],'expectedDigits':sample['expectedDigits'],
                             'boxes':boxes,'elapsedMs':observation['elapsedMs'],'bestProxyIoU':max(matches,default=0),
                             'localizedAtIoU50':max(matches,default=0)>=.5,'uniqueCorrectSelection':len(boxes)==1 and max(matches,default=0)>=.5,
                             'numeric':numeric_observation(image,boxes,threshold,readers)})
        for sample in validation+test:
            # Oracle digit crops are supplied by the old review, not a detector.
            source=a.root/'.tools/master-lcd-rows-dataset/images'/sample['split']/(sample['id']+'.jpg')
            rows.append({'id':sample['id'],'split':sample['split'],'scope':scope,'method':'oracle_numeric_crop',
                         'expectedDigits':sample['expectedDigits'],'cropSha256':hashlib.sha256(source.read_bytes()).hexdigest(),
                         'numeric':{'recognition':{name:reader.read(cv2.imread(str(source))) for name,reader in readers.items()}}})
    report={'scope':'historical_development_geometry_and_component_recognition','groundingRevision':provenance['revision'],
            'groundingSha256':WEIGHTS_SHA,'groundingLicense':provenance['license'],'yoloSha256':YOLO_SHA,
            'validationGrid':grids,'selected':selected,'rows':rows,'runtimeEnabled':False,'independentAcceptance':False,
            'limitations':['Oracle-body inputs are not production crops','Numeric proxies differ from whole LCD screen boxes',
                           'Readability, register and precision remain unverified; numeric outputs are not API proposals']}
    report['inputManifestSha256']={name:hashlib.sha256((a.root/name).read_bytes()).hexdigest() for name in
        ['docs/datasets/meter/four-class-development-v2.json','docs/datasets/meter/lcd-evaluation.json','docs/datasets/meter/public-sources.json']}
    (a.output/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'selected':selected,'testLocalized':{scope+':'+method:sum(r.get('localizedAtIoU50',False) for r in rows if r['split']=='test' and r['scope']==scope and r['method']==method) for scope in selected for method in ['grounding','previous_yolo']}}))


if __name__=='__main__':main()
