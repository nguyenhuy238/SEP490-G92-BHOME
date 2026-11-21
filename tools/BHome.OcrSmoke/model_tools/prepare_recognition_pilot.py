"""Prepare twelve PUBLIC LCD examples for blinded review, not acceptance/train.

These are explicitly provisional agent observations. Frozen historical digit
labels remain intact; disputed glyphs are flagged rather than relabeled from OCR.
Opaque copies avoid exposing publisher filenames containing meter identifiers.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import sys

from PIL import Image
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parent))
from prepare_meter_training import perceptual_hash

KAGGLE_DIGITS = {8:'003475',39:'069156',43:'007696',50:'020355',57:'053308',67:'014962'}


def prepare(root,output):
    source=root/'.tools/ocr-recovery-kaggle'
    audit=json.loads((source/'audit.json').read_text())
    if hashlib.sha256((root/'.tools/ocr-recovery-public/meter-data.zip').read_bytes()).hexdigest()!=audit['archiveSha256']:
        raise ValueError('Pinned source ZIP changed')
    body={r['id']:r for r in json.loads((root/'docs/datasets/meter/four-class-development-v2.json').read_text())['samples']}
    catalog={r['id']:r for r in json.loads((root/'docs/datasets/meter/public-sources.json').read_text())['assets']}
    aliases=root/'.tools/ocr-next-phase/pilot-source';aliases.mkdir(parents=True,exist_ok=True)
    originals=sorted((source/'processed/images').glob('*/*.jpg'));samples=[]
    for index,digits in KAGGLE_DIGITS.items():
        row=audit['rows'][index];image=originals[index];sha=row['sourceSha256']
        if row['id']!=f'kgl_{index:03d}' or hashlib.sha256(image.read_bytes()).hexdigest()!=sha:
            raise ValueError('Kaggle image ordering/hash changed')
        with Image.open(image) as im:w,h=im.size
        x1,y1,x2,y2=row['sourceBoxXYXY'];poly=[[x1/w,y1/h],[x2/w,y1/h],[x2/w,y2/h],[x1/w,y2/h]]
        target=aliases/(row['id']+'.jpg');shutil.copyfile(image,target)
        samples.append({'id':row['id'],'image':target.relative_to(root).as_posix(),'sha256':sha,
                        'sourceGroup':'kaggle_all_unknown_physical_id','physicalMeterGroup':None,'split':'development_only',
                        'category':'electricity_digital','meterPolygon':None,'windowPolygon':poly,
                        'digits':digits,'frozenExpectedDigits':None,'decimalPlaces':None,'unit':'kWh','register':'unknown',
                        'readabilityState':'readable_consumption','readable':True,'uncertainPositions':[],
                        'annotationConfidence':'high_for_visible_digits_only','reviewStatus':'provisional_agent_visual_no_human_review',
                        'billingRegisterVerified':False,'bodyExtentReviewed':False,
                        'provenance':{'kind':'public','license':'MIT','sourceUrl':'https://www.kaggle.com/datasets/saarthaksrivastav/meter-data'}})
    for row in json.loads((root/'docs/datasets/meter/lcd-evaluation.json').read_text())['samples']:
        identifier=row['id'];image=root/'.tools/master-dataset/commons'/(identifier+'.jpg');sha=catalog[identifier]['sha256']
        if hashlib.sha256(image.read_bytes()).hexdigest()!=sha:raise ValueError('Commons source changed')
        target=aliases/(identifier+'.jpg');shutil.copyfile(image,target)
        with Image.open(image) as im:w,h=im.size
        x1,y1,x2,y2=row['crop'];positive=row['expectedDigits'] is not None;disputed=identifier=='commons_141189268'
        sample={'id':identifier,'image':target.relative_to(root).as_posix(),'sha256':sha,
                'sourceGroup':body[identifier]['sourceGroup'],'physicalMeterGroup':None,'split':row['split'],
                'category':body[identifier]['category'],'meterPolygon':body[identifier]['meterPolygon'],
                'windowPolygon':[[x1/w,y1/h],[x2/w,y1/h],[x2/w,y2/h],[x1/w,y2/h]],
                'digits':None if disputed else row['expectedDigits'],'frozenExpectedDigits':row['expectedDigits'],
                'decimalPlaces':None,'unit':'m3' if body[identifier]['category']=='water_digital' else 'kWh',
                'register':'unknown','readabilityState':'readable_consumption' if positive else 'blank_or_unpowered',
                'readable':positive,'uncertainPositions':[7] if disputed else [],
                'annotationConfidence':'disputed_digit' if disputed else 'agent_visual_provisional',
                'reviewStatus':'provisional_agent_visual_no_human_review','billingRegisterVerified':False,
                'provenance':{'kind':'public','license':catalog[identifier]['license'],'sourceUrl':catalog[identifier]['sourceUrl']}}
        if disputed:sample['dispute']={'index':7,'possibleGlyphs':['1','7'],'action':'preserve_frozen_label_do_not_correct_from_model_output'}
        samples.append(sample)
    hashes={}
    for sample in samples:
        with Image.open(root/sample['image']) as image:hashes[sample['id']]=perceptual_hash(np.asarray(image.convert('RGB')))
    pairs=[]
    for i,a in enumerate(samples):
        for b in samples[:i]:
            distance=(hashes[a['id']]^hashes[b['id']]).bit_count()
            if distance<=6:pairs.append({'a':a['id'],'b':b['id'],'distance':distance,'sameSourceGroup':a['sourceGroup']==b['sourceGroup']})
    manifest={'version':1,'purpose':'small provisional LCD state/digit pilot; not independent acceptance or training',
              'humanReviewsReceived':0,'independentExactLabels':0,'sourcePolicy':'unknown physical meters stay in one source group; no random split',
              'frozenHistoricalLabelsChanged':False,'samples':samples,
              'views':{'A_classification':[s['id'] for s in samples], 'B_localization':[s['id'] for s in samples],
                       'C_provisional_digits':[s['id'] for s in samples if s['digits'] is not None],
                       'D_negative_or_uncertain':[s['id'] for s in samples if not s['readable'] or s['uncertainPositions']]},
              'perceptualPairs':pairs,'mendeleySourceCorrection':{'url':'https://data.mendeley.com/datasets/fnn44p4mj8/1',
                 'actualDomain':'seven_segment_digital_energy_meter_displays_not_mechanical_water','license':'CC0-1.0'}}
    output.write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps({'pilot':len(samples),'views':{k:len(v) for k,v in manifest['views'].items()},'humanReviews':0,'nearDuplicatePairs':len(pairs)}))


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('root',type=Path);p.add_argument('output',type=Path)
    a=p.parse_args();prepare(a.root,a.output)
