"""Source-separated LCD reading/serial detector experiment on public annotations.

All Kaggle images remain TRAIN because physical identity is unknown. Existing
Commons validation/test images remain frozen. Region labels are proxies for
reading localization, not verified billing register labels. No category model,
numeric GT, application activation or test-driven threshold calibration.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import time

import cv2
import numpy as np
import onnxruntime as ort
import torch
import yaml
from ultralytics import YOLO, settings

from prepare_meter_training import audit_pairs, perceptual_hash
from train_meter_yolo import PRETRAINED_SHA256, verify_training_audit


def prepare(kaggle, root, output):
    if output.exists(): raise ValueError('Never overwrite a frozen dataset')
    inventory = json.loads((kaggle/'audit.json').read_text())
    if inventory['archiveSha256'] != 'f459b1d39ff68cab8e2ee909f9f095bc3244b1efa23ff848ac2bd572c73bd4a4':
        raise ValueError('Unpinned Kaggle source')
    if hashlib.sha256((root/'.tools/ocr-recovery-public/meter-data.zip').read_bytes()).hexdigest()!=inventory['archiveSha256']:
        raise ValueError('Source ZIP checksum mismatch')
    excluded = set(inventory['invalidLabelRows']); entries = []; hashes = {}; exclusions = []
    source_images = sorted((kaggle/'processed/images').glob('*/*.jpg'))
    if len(source_images) != len(inventory['rows']): raise ValueError('Source inventory changed')
    for image, row in zip(source_images, inventory['rows']):
        label = kaggle/'processed/labels'/image.parent.name/(image.stem+'.txt')
        if hashlib.sha256(image.read_bytes()).hexdigest() != row['sourceSha256'] or hashlib.sha256(label.read_bytes()).hexdigest() != row['labelSha256']:
            raise ValueError('Publisher image/annotation checksum mismatch')
        if row['id'] in excluded or not row['readingBoxCount']:
            exclusions.append({'id':row['id'], 'reason':'invalid_label_or_missing_reading_annotation'}); continue
        im = cv2.imread(str(image)); name = row['id']; split = 'train'
        destination = output/'images'/split/(name+'.jpg'); destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(image, destination)
        target = output/'labels'/split/(name+'.txt'); target.parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(label, target)
        entries.append({'id':name, 'split':split, 'image':destination.relative_to(output).as_posix(),
                        'sha256':row['sourceSha256'], 'label':target.relative_to(output).as_posix(),
                        'labelSha256':row['labelSha256'], 'sourceGroup':'kaggle_all_unknown_physical_id',
                        'annotationStatus':'publisher_reviewed_boxes_not_independent_billing_gt'})
        hashes[name] = perceptual_hash(cv2.cvtColor(im, cv2.COLOR_BGR2RGB))
    catalog = json.loads((root/'docs/datasets/meter/public-sources.json').read_text())
    source_assets = {x['id']:x for x in catalog['assets']}
    evaluation = json.loads((root/'docs/datasets/meter/lcd-evaluation.json').read_text())
    for sample in evaluation['samples']:
        name = sample['id']; image = root/'.tools/master-dataset/commons'/(name+'.jpg')
        content = image.read_bytes(); digest = hashlib.sha256(content).hexdigest()
        if digest != source_assets[name]['sha256']: raise ValueError('Commons source hash mismatch')
        im = cv2.imread(str(image)); h, w = im.shape[:2]; x1,y1,x2,y2 = sample['crop']
        if not (0 <= x1 < x2 <= w and 0 <= y1 < y2 <= h): raise ValueError('Reviewed numeric-region bounds invalid')
        split = sample['split']; destination = output/'images'/split/(name+'.jpg'); destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(image,destination); target = output/'labels'/split/(name+'.txt'); target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(f'0 {(x1+x2)/2/w:.8f} {(y1+y2)/2/h:.8f} {(x2-x1)/w:.8f} {(y2-y1)/h:.8f}\n')
        entries.append({'id':name, 'split':split, 'image':destination.relative_to(output).as_posix(), 'sha256':digest,
                        'label':target.relative_to(output).as_posix(), 'labelSha256':hashlib.sha256(target.read_bytes()).hexdigest(),
                        'sourceGroup':'commons_'+split, 'box':[x1,y1,x2,y2], 'annotationStatus':'agent_reviewed_region_proxy_no_billing_acceptance'})
        hashes[name] = perceptual_hash(cv2.cvtColor(im, cv2.COLOR_BGR2RGB))
    pairs = audit_pairs(entries,hashes)
    data = {'path':output.resolve().as_posix(), 'train':'images/train', 'val':'images/val', 'test':'images/test',
            'names':{0:'reading_region',1:'serial_region'}}
    (output/'dataset.yaml').write_text(yaml.safe_dump(data))
    audit = {'classes':['reading_region','serial_region'], 'samples':entries, 'exclusions':exclusions,
             'manifestSha256':hashlib.sha256((kaggle/'audit.json').read_bytes()).hexdigest(),
             'datasetYamlSha256':hashlib.sha256((output/'dataset.yaml').read_bytes()).hexdigest(),
             'perceptualPairs':pairs,'sourceGrouping':'all Kaggle in train; preexisting Commons heldout unchanged',
             'counts':{s:sum(x['split']==s for x in entries) for s in ['train','val','test']}}
    (output/'audit.json').write_text(json.dumps(audit,indent=2)+'\n');return audit


def measure(model, dataset, samples, size, threshold=.25):
    rows=[]
    for row in samples:
        begin=time.perf_counter(); prediction=model.predict(str(dataset/row['image']),imgsz=size,conf=threshold,device='cpu',rect=False,verbose=False)[0]
        boxes=[{'class':int(c),'score':float(s),'box':[float(n) for n in b]} for c,s,b in zip(prediction.boxes.cls,prediction.boxes.conf,prediction.boxes.xyxy)]
        expected=row['box']; overlapping=[]
        for b in boxes:
            if b['class']!=0:continue
            box=b['box'];inter=max(0,min(box[2],expected[2])-max(box[0],expected[0]))*max(0,min(box[3],expected[3])-max(box[1],expected[1]))
            union=(box[2]-box[0])*(box[3]-box[1])+(expected[2]-expected[0])*(expected[3]-expected[1])-inter
            overlapping.append(inter/union if union>0 else 0)
        rows.append({'id':row['id'],'split':row['split'],'size':size,'expectedRegion':expected,'boxes':boxes,
                     'bestIoU':max(overlapping,default=0),'localizedIoU50':max(overlapping,default=0)>=.5,
                     'forwardAndDecodeMs':(time.perf_counter()-begin)*1000})
    return rows


def raw_parity(model, exported, dataset, samples):
    from evaluate_finetuned_yolo import letterbox
    session=ort.InferenceSession(str(exported),providers=['CPUExecutionProvider']);rows=[]
    model.model.cpu().eval()
    for row in samples:
        tensor,*_=letterbox(cv2.imread(str(dataset/row['image'])),416)
        with torch.no_grad():native=model.model(torch.from_numpy(tensor))[0].numpy()
        onnx=session.run(None,{session.get_inputs()[0].name:tensor})[0]
        score_delta=float(np.max(np.abs(native[:,4:]-onnx[:,4:])))
        box_delta=float(np.max(np.abs(native[:,:4]-onnx[:,:4])))
        rows.append({'id':row['id'],'maxScoreDelta':score_delta,'maxBoxDelta':box_delta,
                     'passed':score_delta<.0002 and box_delta<.01})
    return rows


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('kaggle',type=Path);p.add_argument('root',type=Path)
    p.add_argument('dataset',type=Path);p.add_argument('pretrained',type=Path);p.add_argument('output',type=Path)
    a=p.parse_args()
    if a.output.exists():raise ValueError('Never overwrite a model run')
    if hashlib.sha256(a.pretrained.read_bytes()).hexdigest()!=PRETRAINED_SHA256:raise ValueError('Pretrained checkpoint hash mismatch')
    audit=prepare(a.kaggle,a.root,a.dataset);verify_training_audit(a.dataset,audit)
    settings.update({'sync':False});os.environ['WANDB_DISABLED']='true';os.environ['YOLO_AUTOINSTALL']='false';torch.set_num_threads(2)
    a.output.mkdir(parents=True);started=time.perf_counter();model=YOLO(str(a.pretrained))
    model.train(data=str((a.dataset/'dataset.yaml').resolve()),epochs=40,patience=12,imgsz=416,batch=16,device=0,
                workers=0,seed=42,deterministic=True,amp=False,optimizer='AdamW',lr0=.001,
                degrees=10,translate=.1,scale=.2,perspective=.0003,fliplr=0,flipud=0,mosaic=.2,close_mosaic=10,
                plots=False,project=str(a.output.resolve()),name='run',exist_ok=False)
    selected=YOLO(str(a.output/'run/weights/best.pt'))
    validation=[x for x in audit['samples'] if x['split']=='val']
    val_rows=measure(selected,a.dataset,validation,416)+measure(selected,a.dataset,validation,640)
    exported=Path(selected.export(format='onnx',imgsz=416,opset=17,simplify=False,dynamic=False))
    parity_rows=measure(selected,a.dataset,validation,416)+measure(YOLO(str(exported)),a.dataset,validation,416)
    # Read historical test only after weights/resolution policy frozen; no calibration.
    test_rows=measure(selected,a.dataset,[x for x in audit['samples'] if x['split']=='test'],416)
    report={'task':'LCD reading/serial region detection development proxy','datasetCounts':audit['counts'],
            'datasetAuditSha256':hashlib.sha256((a.dataset/'audit.json').read_bytes()).hexdigest(),
            'modelSha256':hashlib.sha256(exported.read_bytes()).hexdigest(),'modelFile':exported.as_posix(),
            'validation':val_rows,'nativeAndOnnxValidation':parity_rows,'rawTensorParity':raw_parity(selected,exported,a.dataset,validation),'test':test_rows,
            'runtimeEnabled':False,'independentAcceptance':False,'elapsedSeconds':time.perf_counter()-started,
            'limitation':'Two development validation images; no complete serial GT outside train; proxy box != billing register verification'}
    (a.output/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:v for k,v in report.items() if k not in ['validation','nativeAndOnnxValidation','test']}))


if __name__=='__main__':main()
