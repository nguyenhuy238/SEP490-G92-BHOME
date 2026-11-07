"""Compare direct and utility->technology visual classification, no training.

Thresholds are chosen on the same historical validation inputs before test.
Whole-frame results and oracle-body diagnostics are strictly separated. Neither
strategy counts meters or verifies a register. No application model activation.
"""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import sys
import time

import numpy as np
from PIL import Image,ImageOps
import torch
from transformers import CLIPModel,CLIPProcessor

sys.path.insert(0,str(Path(__file__).resolve().parent))
from evaluate_clip_meter_categories import PROMPTS as DIRECT_PROMPTS,CLASSES,WEIGHTS_SHA
from meter_hierarchy_policy import hierarchy_decision

UTILITY_PROMPTS=[
    ['a photograph of an electricity utility meter measuring electric energy in kilowatt hours',
     'an electric power consumption meter'],
    ['a photograph of a water utility meter measuring consumed water volume',
     'a water consumption meter connected to water pipes'],
    ['a photograph of an object that is not an electricity or water meter',
     'an identity document, room, landscape or ordinary object without a utility meter'],
]
TECHNOLOGY_PROMPTS=[
    ['a mechanical utility meter with rotating number wheels or pointer dials',
     'an analog meter that displays its reading using a mechanical counter or circular pointer scales'],
    ['a digital utility meter with an electronic LCD or LED numeric screen',
     'an electronic meter that displays its reading on a digital screen'],
]


def prototypes(model,processor,groups,device):
    inputs=processor(text=[p for group in groups for p in group],return_tensors='pt',padding=True)
    with torch.no_grad():
        vectors=model.get_text_features(**{k:v.to(device) for k,v in inputs.items()});vectors/=vectors.norm(dim=-1,keepdim=True)
        result=[];start=0
        for group in groups:
            mean=vectors[start:start+len(group)].mean(0);result.append(mean/mean.norm());start+=len(group)
    return torch.stack(result)


def summarize(rows,method,setting):
    counts=Counter();confusion=Counter();per_class={c:Counter() for c in CLASSES[:4]}
    for row in rows:
        if setting is None:predicted='unknown'
        elif method=='direct':
            scores=row['direct'];order=sorted(scores,key=scores.get,reverse=True)
            predicted=order[0] if order[0]!='not_meter' and scores[order[0]]>=setting and scores[order[0]]-scores[order[1]]>=.1 else 'unknown'
        else:predicted=hierarchy_decision(row['utility'],row['technology'],*setting)
        expected=row['expected'];counts.update(inputs=1,positiveMeters=expected!='not_meter',
            correctlyAccepted=predicted==expected,incorrectlyAccepted=predicted!='unknown' and predicted!=expected,
            unknown=predicted=='unknown',negativeFalseAccepted=expected=='not_meter' and predicted!='unknown')
        confusion[expected+'->'+predicted]+=1
        for category,metric in per_class.items():metric.update(tp=predicted==category and expected==category,fp=predicted==category and expected!=category,fn=expected==category and predicted!=category)
    for metric in per_class.values():
        metric['recall']=metric['tp']/(metric['tp']+metric['fn']) if metric['tp']+metric['fn'] else None
        metric['precision']=metric['tp']/(metric['tp']+metric['fp']) if metric['tp']+metric['fp'] else None
    return {'counts':counts,'confusion':confusion,'perClass':per_class}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name in ['clip','manifest','root','output']:p.add_argument(name,type=Path)
    a=p.parse_args()
    if a.output.exists():raise ValueError('Never overwrite a classification study')
    if hashlib.sha256((a.clip/'pytorch_model.bin').read_bytes()).hexdigest()!=WEIGHTS_SHA:raise ValueError('Pinned weights changed')
    receipt=json.loads((a.clip/'provenance.json').read_text())
    for name,entry in receipt['files'].items():
        if Path(name).name!=name or hashlib.sha256((a.clip/name).read_bytes()).hexdigest()!=entry['sha256']:raise ValueError('CLIP artifact changed')
    torch.set_num_threads(2);device='cuda' if torch.cuda.is_available() else 'cpu'
    model=CLIPModel.from_pretrained(a.clip,local_files_only=True).to(device).eval();processor=CLIPProcessor.from_pretrained(a.clip,local_files_only=True)
    heads={'direct':prototypes(model,processor,DIRECT_PROMPTS,device),'utility':prototypes(model,processor,UTILITY_PROMPTS,device),
           'technology':prototypes(model,processor,TECHNOLOGY_PROMPTS,device)}
    names={'direct':CLASSES,'utility':['electricity','water','not_meter'],'technology':['mechanical','digital']}
    samples=json.loads(a.manifest.read_text(encoding='utf-8'))['samples'];rows=[];selected={};grids={}
    for split in ['validation','test']:
        for sample in [s for s in samples if s['split']==split]:
            path=(a.root/sample['image']).resolve()
            if not path.is_relative_to(a.root.resolve()) or hashlib.sha256(path.read_bytes()).hexdigest()!=sample['sha256']:raise ValueError('Frozen image changed')
            with Image.open(path) as source:original=ImageOps.exif_transpose(source).convert('RGB')
            for scope in ['full_frame','oracle_meter_body']:
                image=original;used=False
                if scope=='oracle_meter_body' and sample.get('meterPolygon'):
                    xs=[p[0]*image.width for p in sample['meterPolygon']];ys=[p[1]*image.height for p in sample['meterPolygon']]
                    image=image.crop((int(min(xs)),int(min(ys)),int(max(xs)),int(max(ys))));used=True
                pixels=processor(images=image,return_tensors='pt')['pixel_values'].to(device)
                if device=='cuda':torch.cuda.synchronize()
                started=time.perf_counter()
                with torch.no_grad():
                    vector=model.get_image_features(pixels);vector/=vector.norm(dim=-1,keepdim=True)
                    scores={head:(model.logit_scale.exp()*vector@prototype.T).softmax(-1)[0].cpu().numpy() for head,prototype in heads.items()}
                if device=='cuda':torch.cuda.synchronize()
                rows.append({'id':sample['id'],'sha256':sample['sha256'],'split':split,'scope':scope,'usedOracleBody':used,'expected':sample['category'],
                             **{head:dict(zip(names[head],map(float,values))) for head,values in scores.items()},'forwardMs':(time.perf_counter()-started)*1000})
        if split=='validation':
            for scope in ['full_frame','oracle_meter_body']:
                validation=[r for r in rows if r['scope']==scope]
                direct={str(t):summarize(validation,'direct',t) for t in [.35,.5,.65,.75,.85,.9,.95]}
                hierarchy={str((u,t)):summarize(validation,'hierarchy',(u,t)) for u in [.65,.75,.85,.9,.95] for t in [.65,.75,.85,.9,.95]}
                grids[scope]={'direct':direct,'hierarchy':hierarchy}
                eligible=[float(t) for t,v in direct.items() if v['counts']['incorrectlyAccepted']==0 and v['counts']['correctlyAccepted']>0]
                direct_threshold=max(eligible,key=lambda t:(direct[str(t)]['counts']['correctlyAccepted'],t)) if eligible else None
                eligible_h=[(u,t) for u in [.65,.75,.85,.9,.95] for t in [.65,.75,.85,.9,.95] if hierarchy[str((u,t))]['counts']['incorrectlyAccepted']==0 and hierarchy[str((u,t))]['counts']['correctlyAccepted']>0]
                h_threshold=max(eligible_h,key=lambda c:(hierarchy[str(c)]['counts']['correctlyAccepted'],min(c),sum(c))) if eligible_h else None
                selected[scope]={'direct':direct_threshold,'hierarchy':h_threshold}
    results={scope:{method:summarize([r for r in rows if r['scope']==scope and r['split']=='test'],method,setting) for method,setting in settings.items()} for scope,settings in selected.items()}
    old=json.loads((a.root/'docs/development/ocr-four-clip-results.json').read_text());old_rows={r['id']:r for r in old['rows']}
    deltas=[abs(v-old_rows[r['id']]['scores'][c]) for r in rows if r['scope']=='full_frame' for c,v in r['direct'].items()]
    result={'scope':'historical_development_classification_not_independent_acceptance','modelSha256':WEIGHTS_SHA,
            'manifestSha256':hashlib.sha256(a.manifest.read_bytes()).hexdigest(),'utilityPrompts':UTILITY_PROMPTS,'technologyPrompts':TECHNOLOGY_PROMPTS,
            'selectedOnValidation':selected,'validationGrid':grids,'test':results,'directBaselineMaxScoreDelta':max(deltas),
            'runtimeEnabled':False,'hardware':device,'pretrainingOverlapUnknown':True,'rows':rows,
            'limitations':['Oracle body crops are not production inputs','Neither model counts or localizes meters','No independent human labels or billing acceptance']}
    a.output.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'selected':selected,'test':results,'directBaselineMaxScoreDelta':max(deltas)}))


if __name__=='__main__':main()
