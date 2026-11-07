"""Evaluate pixel/visual LCD-state gates before numeric recognition, offline only.

Provisional readable and negative calibration subsets remain separate. Thresholds
are frozen before historical test is read. A readable-candidate decision does not
verify a billing register, decimal precision or Staff confirmation.
"""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import sys
import time
import xml.etree.ElementTree as ET

import cv2
import numpy as np
from PIL import Image
import torch
from transformers import CLIPModel, CLIPProcessor

sys.path.insert(0,str(Path(__file__).resolve().parent))
from compare_paddle_meter_models import PaddleCtcReader
from evaluate_clip_meter_categories import WEIGHTS_SHA

STATES=['readable_candidate','blank_or_unpowered','segment_test','blurred_or_obscured','unknown']
PROMPTS=[
    ['a closeup of an active LCD utility meter screen with clearly visible consumption numbers',
     'a functioning digital meter display showing a readable numeric value'],
    ['a blank unpowered LCD screen with no active numbers',
     'an unpowered seven segment LED display with faint outlines of unlit digits'],
    ['an LCD display showing all segments and all icons lit during a display test',
     'a digital display in segment test mode showing every segment'],
    ['a blurred obscured reflective meter screen whose digits cannot be read',
     'a digital display hidden by glare dirt or reflections'],
    ['a printed serial number or technical label instead of a consumption display',
     'a status message instead of a numeric consumption reading'],
]


def pixel_features(image):
    gray=cv2.cvtColor(image,cv2.COLOR_BGR2GRAY).astype(np.float32)
    h,w=gray.shape;roi=gray[int(.1*h):max(int(.9*h),int(.1*h)+1),int(.06*w):max(int(.94*w),int(.06*w)+1)]
    smooth=cv2.GaussianBlur(roi,(0,0),3)
    # Unlit hollow segment outlines can contain many small holes per glyph.
    # Filled active digits normally have at most two large counters. This is an
    # experimental image feature, not a rule rejecting strings of repeated digits.
    _,mask=cv2.threshold(roi.astype(np.uint8),0,255,cv2.THRESH_BINARY+cv2.THRESH_OTSU)
    if np.count_nonzero(mask)>mask.size/2:mask=255-mask
    contours,hierarchy=cv2.findContours(mask,cv2.RETR_CCOMP,cv2.CHAIN_APPROX_SIMPLE)
    small_holes=0;support=0;rh,rw=mask.shape
    if hierarchy is not None:
        for contour,relation in zip(contours,hierarchy[0]):
            area=abs(cv2.contourArea(contour));x,y,cw,ch=cv2.boundingRect(contour)
            touches=x<=0 or y<=0 or x+cw>=rw or y+ch>=rh
            if relation[3]>=0 and .0005*rh*rh<=area<=.025*rh*rh:small_holes+=1
            if relation[3]<0 and not touches and .22*rh<=ch<=.95*rh and .04*rh<=cw<=1.2*rh and area>=.003*rh*rh:support+=1
    estimated_glyphs=max(1,round(rw/(.65*rh)))
    return {'innerRange90':float((np.percentile(roi,95)-np.percentile(roi,5))/255),
            'localContrast95':float(np.percentile(np.abs(roi-smooth),95)/255),
            'innerMedian':float(np.median(roi)/255),'laplacianVariance':float(cv2.Laplacian(gray,cv2.CV_32F).var()),
            'foregroundSupportComponents':support,'smallHolesPerEstimatedGlyph':small_holes/estimated_glyphs}


def clip_input(image):
    # Preserve the whole display rather than center-cropping away outer digits/icons.
    rgb=cv2.cvtColor(image,cv2.COLOR_BGR2RGB);h,w=rgb.shape[:2];scale=min(224/w,224/h)
    resized=cv2.resize(rgb,(max(1,round(w*scale)),max(1,round(h*scale))))
    canvas=np.full((224,224,3),(123,117,104),np.uint8);rh,rw=resized.shape[:2]
    canvas[(224-rh)//2:(224-rh)//2+rh,(224-rw)//2:(224-rw)//2+rw]=resized
    return Image.fromarray(canvas)


def load_visual(root):
    if hashlib.sha256((root/'pytorch_model.bin').read_bytes()).hexdigest()!=WEIGHTS_SHA:raise ValueError('Pinned CLIP weights changed')
    receipt=json.loads((root/'provenance.json').read_text())
    for name,entry in receipt['files'].items():
        if Path(name).name!=name or hashlib.sha256((root/name).read_bytes()).hexdigest()!=entry['sha256']:
            raise ValueError('CLIP configuration changed')
    device='cuda' if torch.cuda.is_available() else 'cpu';torch.set_num_threads(2)
    model=CLIPModel.from_pretrained(root,local_files_only=True).to(device).eval()
    processor=CLIPProcessor.from_pretrained(root,local_files_only=True)
    text=processor(text=[p for group in PROMPTS for p in group],padding=True,return_tensors='pt')
    with torch.no_grad():
        embedding=model.get_text_features(**{k:v.to(device) for k,v in text.items()});embedding/=embedding.norm(dim=-1,keepdim=True)
        prototypes=torch.stack([embedding[2*i:2*i+2].mean(0) for i in range(len(PROMPTS))]);prototypes/=prototypes.norm(dim=-1,keepdim=True)
    return model,processor,prototypes,device


def state_prediction(image,visual):
    model,processor,prototypes,device=visual
    pixels=processor(images=clip_input(image),do_resize=False,do_center_crop=False,return_tensors='pt')['pixel_values'].to(device)
    if device=='cuda':torch.cuda.synchronize()
    started=time.perf_counter()
    with torch.no_grad():
        feature=model.get_image_features(pixels);feature/=feature.norm(dim=-1,keepdim=True)
        scores=(model.logit_scale.exp()*feature@prototypes.T).softmax(-1)[0].cpu().numpy()
    if device=='cuda':torch.cuda.synchronize()
    order=scores.argsort()[::-1]
    return {'prediction':STATES[int(order[0])],'scores':dict(zip(STATES,map(float,scores))),
            'score':float(scores[order[0]]),'margin':float(scores[order[0]]-scores[order[1]]),'forwardMs':(time.perf_counter()-started)*1000}


def accept(row,method,threshold):
    if threshold is None:return False
    if method=='pixel_contrast':return row['pixel']['localContrast95']>=threshold
    visual=row['visual'];readable=visual['prediction']=='readable_candidate' and visual['score']>=threshold and visual['margin']>=.1
    if method=='shape_primary':
        active=row['pixel']['localContrast95']>=.025 and row['pixel']['foregroundSupportComponents']>=1 and row['pixel']['smallHolesPerEstimatedGlyph']<3
        nonreadable_veto=visual['prediction']!='readable_candidate' and visual['score']>=threshold and visual['margin']>=.1
        return active and not nonreadable_veto
    if method=='shape_combined':
        return readable and row['pixel']['localContrast95']>=.025 and row['pixel']['foregroundSupportComponents']>=1 and row['pixel']['smallHolesPerEstimatedGlyph']<3
    return readable and (method!='combined' or row['pixel']['localContrast95']>=.025)


def metrics(rows,method,threshold):
    count=Counter()
    for row in rows:
        accepted=accept(row,method,threshold);positive=row['expectedReadable']
        count.update(inputs=1,readablePositives=positive,negativeControls=not positive,
                     correctlyAcceptedReadable=accepted and positive,incorrectReadableRejection=not accepted and positive,
                     correctlyRejectedNegative=not accepted and not positive,falseReadableAcceptance=accepted and not positive)
    return count


def prepare_cases(root,output,pilot):
    cases=[];dataset=root/'.tools/master-lcd-rows-dataset'
    frozen={r['id']:r for r in json.loads((dataset/'audit.json').read_text())['samples'] if r['split']!='train'}
    output.mkdir(parents=True,exist_ok=True)
    for row in pilot['samples']:
        if row['id'].startswith('kgl_'):
            path=root/'.tools/ocr-recovery-kaggle/display-crops'/(row['id']+'.png');role='calibration'
        else:
            original=frozen[row['id']];path=dataset/original['image'];role='calibration' if original['split']=='val' else 'historical_test'
            if hashlib.sha256(path.read_bytes()).hexdigest()!=original['sha256']:raise ValueError('Frozen LCD crop changed')
        cases.append({'id':row['id'],'path':path.as_posix(),'cropSha256':hashlib.sha256(path.read_bytes()).hexdigest(),
                      'sourceGroup':row['sourceGroup'],'role':role,'expectedReadable':row['readable'],
                      'expectedState':'readable_candidate' if row['readable'] else 'blank_or_unpowered',
                      'expectedDigits':row['frozenExpectedDigits'] if row['frozenExpectedDigits'] is not None else row['digits'],
                      'numericGroundTruthStatus':'disputed_frozen_label_retained' if row.get('dispute') else 'provisional_not_independent'})
    preview=root/'.tools/ocr-20261106-lcd-preview';name='DS_electro_scor_ser_labeled_v1_2026_00048'
    receipt=json.loads((preview/'receipts.json').read_text());receipts={x['file']:x['sha256'] for x in receipt['assets']}
    for suffix in ['.jpg','.xml']:
        if hashlib.sha256((preview/(name+suffix)).read_bytes()).hexdigest()!=receipts[name+suffix]:raise ValueError('Preview source changed')
    tree=ET.parse(preview/(name+'.xml'));boxes=[[int(o.findtext('bndbox/'+k)) for k in ['xmin','ymin','xmax','ymax']] for o in tree.findall('object') if o.findtext('name')=='scoreboard']
    if len(boxes)!=1:raise ValueError('One publisher display annotation required')
    with Image.open(preview/(name+'.jpg')) as image:image.crop(boxes[0]).save(output/'segment-test.png')
    cases.append({'id':'preview_48','path':(output/'segment-test.png').as_posix(),'role':'calibration',
                  'cropSha256':hashlib.sha256((output/'segment-test.png').read_bytes()).hexdigest(),'sourceGroup':'preview_all_unknown_physical_id',
                  'expectedReadable':False,'expectedState':'segment_test','expectedDigits':None,'numericGroundTruthStatus':'provisional_not_independent',
                  'license':'CC-BY-NC-4.0_offline_research_only'})
    originals=sorted((root/'.tools/ocr-recovery-kaggle/processed/images').glob('*/*.jpg'))
    for index in [8,67]:
        path=originals[index];label=root/'.tools/ocr-recovery-kaggle/processed/labels'/path.parent.name/(path.stem+'.txt')
        serial=[list(map(float,line.split())) for line in label.read_text().splitlines() if line.split()[0]=='1']
        if len(serial)!=1:raise ValueError('One publisher serial box required')
        with Image.open(path) as image:
            w,h=image.size;_,x,y,bw,bh=serial[0];bounds=[int((x-bw/2)*w),int((y-bh/2)*h),int((x+bw/2)*w),int((y+bh/2)*h)]
            if not (0<=bounds[0]<bounds[2]<=w and 0<=bounds[1]<bounds[3]<=h):raise ValueError('Serial annotation invalid')
            target=output/f'serial-kgl_{index:03d}.png';image.crop(bounds).save(target)
        cases.append({'id':f'serial_kgl_{index:03d}','path':target.as_posix(),'role':'calibration','sourceGroup':'kaggle_all_unknown_physical_id',
                      'cropSha256':hashlib.sha256(target.read_bytes()).hexdigest(),'expectedReadable':False,'expectedState':'unknown',
                      'expectedDigits':None,'numericGroundTruthStatus':'publisher_serial_region_not_billing'})
    blank=json.loads((root/'docs/datasets/meter/blank-lcd-annotation.json').read_text())['samples'][0];path=root/blank['image']
    if hashlib.sha256(path.read_bytes()).hexdigest()!=blank['sha256']:raise ValueError('Blank-water image changed')
    with Image.open(path) as image:
        xs=[p[0]*image.width for p in blank['windowPolygon']];ys=[p[1]*image.height for p in blank['windowPolygon']]
        target=output/'blank-water.png';image.crop((int(min(xs)),int(min(ys)),int(max(xs)),int(max(ys)))).save(target)
    cases.append({'id':blank['id'],'path':target.as_posix(),'role':'historical_test','sourceGroup':blank['sourceGroup'],
                  'cropSha256':hashlib.sha256(target.read_bytes()).hexdigest(),'expectedReadable':False,'expectedState':'blank_or_unpowered',
                  'expectedDigits':None,'numericGroundTruthStatus':'provisional_blank_control_coarse_crop'})
    (output/'cases.json').write_text(json.dumps(cases,indent=2)+'\n');return cases


def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name in ['clip','english','server','pilot','root','output']:p.add_argument(name,type=Path)
    a=p.parse_args()
    if a.output.exists():raise ValueError('Do not overwrite an evaluated state experiment')
    pilot=json.loads(a.pilot.read_text());cases=prepare_cases(a.root,a.output,pilot)
    visual=load_visual(a.clip);readers={'english':PaddleCtcReader('english_mobile',a.english),'server':PaddleCtcReader('multilingual_server',a.server)};rows=[]
    # Process calibration only before selecting any thresholds.
    for role in ['calibration','historical_test']:
        for case in [r for r in cases if r['role']==role]:
            image=cv2.imread(case['path'])
            rows.append({**case,'pixel':pixel_features(image),'visual':state_prediction(image,visual),
                         'recognition':{name:reader.read(image) for name,reader in readers.items()}})
        if role=='calibration':
            grids={};selected={}
            for method in ['pixel_contrast','visual_state','combined','shape_combined','shape_primary']:
                thresholds=[.015,.025,.04,.06,.08,.1] if method=='pixel_contrast' else [.5,.65,.75,.85,.9,.95]
                grid={str(t):metrics(rows,method,t) for t in thresholds};grids[method]=grid
                eligible=[t for t in thresholds if grid[str(t)]['falseReadableAcceptance']==0 and grid[str(t)]['correctlyAcceptedReadable']>0]
                selected[method]=max(eligible,key=lambda t:(grid[str(t)]['correctlyAcceptedReadable'],t)) if eligible else None
    test=[r for r in rows if r['role']=='historical_test'];recognition={}
    for name in readers:
        for method in ['ungated','pixel_contrast','visual_state','combined','shape_combined','shape_primary']:
            counters=Counter()
            for row in test:
                value=row['recognition'][name]['digits'] if method=='ungated' or accept(row,method,selected[method]) else None
                counters.update(inputs=1,exactOnFrozenLabels=value is not None and value==row['expectedDigits'],
                                incorrectNumeric=value is not None and value!=row['expectedDigits'],fallback=value is None)
            recognition[name+':'+method]=counters
    result={'scope':'provisional_display_state_experiment_no_runtime_activation','prompts':PROMPTS,
            'clipModelSha256':WEIGHTS_SHA,'preprocessing':'full-display RGB letterbox224 with CLIP mean-color padding',
            'selectedOnCalibration':selected,'calibrationGrid':grids,'historicalStateMetrics':{m:metrics(test,m,t) for m,t in selected.items()},
            'historicalNumericMetrics':recognition,'independentHumanReviews':0,'billingRegisterVerified':False,
            'runtimeEnabled':False,'hardware':visual[-1],'rows':rows}
    (a.output/'report.json').write_text(json.dumps(result,indent=2,ensure_ascii=True)+'\n')
    print(json.dumps({k:v for k,v in result.items() if k in ['selectedOnCalibration','historicalStateMetrics','historicalNumericMetrics']}))


if __name__=='__main__':main()
