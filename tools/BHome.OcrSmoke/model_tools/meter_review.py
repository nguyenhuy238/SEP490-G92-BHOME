"""Build a blinded local review pack and reconcile two declared human reviews.

No model suggestions, filename labels or production writes. Views A/B/C remain
provisional until actual people submit reviews; metadata cannot prove independence.
All unknown physical meters from this source stay in one source group.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil

from PIL import Image

CATEGORIES = {'electricity_mechanical', 'electricity_digital', 'water_mechanical', 'water_digital', 'not_meter', 'unknown'}
READABILITY_STATES = {'readable_consumption','blank_or_unpowered','segment_test','status_only','wrong_register','blurred_or_obscured','unknown'}
NEGATIVE_STATES = READABILITY_STATES-{'readable_consumption','unknown'}
FIELDS = ('category','physicalMeterGroup','displayState','readable','digits','decimalPlaces','unit','register','uncertainPositions','readabilityState','annotationConfidence')
UNITS = {None,'kWh','m3','kW','kVA','V','A','Hz','imp/kWh','m3/h','L/min','h','other'}


def valid_box(box):
    return (isinstance(box,list) and len(box)==4 and all(isinstance(n,(int,float)) and not isinstance(n,bool) and 0<=n<=1 for n in box)
            and box[0]<box[2] and box[1]<box[3])


def box_agrees(a,b):
    if not valid_box(a) or not valid_box(b): return False
    intersection=max(0,min(a[2],b[2])-max(a[0],b[0]))*max(0,min(a[3],b[3])-max(a[1],b[1]))
    union=(a[2]-a[0])*(a[3]-a[1])+(b[2]-b[0])*(b[3]-b[1])-intersection
    return intersection/union>=.8


def validate_review(document, package):
    reviewer=document.get('reviewerId','')
    if not re.fullmatch(r'[A-Za-z0-9_-]{3,80}',reviewer) or document.get('humanVisualReview') is not True:
        raise ValueError('A declared human review and opaque reviewer ID are required')
    expected={r['id']:r for r in package['samples']};rows={}
    for row in document['rows']:
        identifier=row.get('id')
        if identifier not in expected or identifier in rows:raise ValueError('Unknown or duplicate reviewed image')
        if row.get('sourceSha256')!=expected[identifier]['sourceSha256']:raise ValueError('Reviewed image checksum mismatch')
        if row.get('category') not in CATEGORIES:raise ValueError('Unsupported reviewed category')
        digits=row.get('digits');uncertain=row.get('uncertainPositions')
        if digits is not None and (not isinstance(digits,str) or not re.fullmatch(r'[0-9]{1,12}',digits)):
            raise ValueError('Exact digits must preserve zeros and contain no inferred separators')
        if not isinstance(uncertain,list) or any(type(i) is not int or not 0<=i<12 for i in uncertain):raise ValueError('Invalid uncertain positions')
        if digits is not None and (row.get('readable') is not True or uncertain):raise ValueError('Uncertain digits cannot be declared exact')
        precision=row.get('decimalPlaces')
        if precision is not None and (type(precision) is not int or not 0<=precision<=4):raise ValueError('Unverified precision must be null')
        for field in ('meterBox','windowBox'):
            if row.get(field) is not None and not valid_box(row[field]):raise ValueError('Invalid reviewed normalized box')
        group=row.get('physicalMeterGroup')
        if group is not None and not re.fullmatch(r'[A-Za-z0-9_-]{1,80}',group):raise ValueError('Opaque physical-meter group required')
        if row.get('unit') not in UNITS or row.get('register') not in ('total_energy','total_volume','other','unknown'):
            raise ValueError('Unsupported reviewed unit/register')
        if row.get('displayState') not in ('single','multiple','unknown') or (row.get('readable') is not None and type(row['readable']) is not bool):
            raise ValueError('Unknown display/readability state must be explicit')
        if row.get('readabilityState','unknown') not in READABILITY_STATES or row.get('annotationConfidence','unknown') not in ('high','medium','low','unknown'):
            raise ValueError('Unsupported readability state/confidence')
        if digits is not None and row.get('readabilityState') in ('blank_or_unpowered','segment_test','blurred_or_obscured'):
            raise ValueError('Unreadable display state cannot supply exact digits')
        rows[identifier]=row
    return reviewer,rows


def reconcile(package,first,second):
    reviewer_a,a=validate_review(first,package);reviewer_b,b=validate_review(second,package)
    if reviewer_a==reviewer_b:raise ValueError('Two different declared reviewers are required')
    views={'A_classification':[],'B_localization':[],'C_recognition':[],'D_negative_controls':[]};pending=[]
    for source in package['samples']:
        identifier=source['id'];left=a.get(identifier);right=b.get(identifier)
        if left is None or right is None:
            pending.append({'id':identifier,'reason':'two_reviews_missing'});continue
        common={k:left.get(k) for k in FIELDS}
        item={'id':identifier,'sourceSha256':source['sourceSha256'],'sourceGroup':source.get('sourceGroup',package['sourceGroup']),
              'reviewerIds':[reviewer_a,reviewer_b],'status':'declared_consensus_pending_project_review'}
        agreed=lambda *fields:all(left.get(f)==right.get(f) for f in fields)
        if agreed('category','physicalMeterGroup') and left['category']!='unknown':
            if left['category']=='not_meter' or box_agrees(left.get('meterBox'),right.get('meterBox')):
                views['A_classification'].append({**item,'category':left['category'],
                    'physicalMeterGroup':left.get('physicalMeterGroup'),'meterBox':left.get('meterBox')})
        if box_agrees(left.get('windowBox'),right.get('windowBox')) and agreed('register','displayState'):
            views['B_localization'].append({**item,'windowBox':left['windowBox'],
                'register':left['register'],'displayState':left['displayState']})
        if (box_agrees(left.get('windowBox'),right.get('windowBox')) and agreed(*FIELDS)
                and left.get('digits') is not None and left['readable'] is True and left['displayState']=='single'
                and left.get('readabilityState') not in NEGATIVE_STATES
                and left['category'] in CATEGORIES-{'unknown','not_meter'}):
            billing=(left.get('decimalPlaces') is not None and
                     ((left['category'].startswith('electricity_') and left['unit']=='kWh' and left['register']=='total_energy') or
                      (left['category'].startswith('water_') and left['unit']=='m3' and left['register']=='total_volume')))
            views['C_recognition'].append({**item,**common,'windowBox':left['windowBox'],'billingMetadataDeclared':billing})
        if agreed('readabilityState') and left.get('readabilityState') in NEGATIVE_STATES:
            views['D_negative_controls'].append({**item,'readabilityState':left['readabilityState']})
        if not agreed(*FIELDS):pending.append({'id':identifier,'reason':'annotation_disagreement'})
    return {'views':views,'pending':pending,'independentAcceptanceEstablished':False,
            'splitPolicy':'source group remains unsplit until project review; never split unknown meters randomly'}


def verify_package_images(package,root):
    for row in package['samples']:
        image=(root/row['image']).resolve()
        if not image.is_relative_to(root.resolve()) or hashlib.sha256(image.read_bytes()).hexdigest()!=row['sourceSha256']:
            raise ValueError('Review-package image path/hash changed')
        with Image.open(image) as decoded:decoded.verify()


def build(kaggle,output):
    if output.exists():raise ValueError('Never overwrite a review pack')
    audit=json.loads((kaggle/'audit.json').read_text());images=sorted((kaggle/'processed/images').glob('*/*.jpg'))
    if len(images)!=len(audit['rows']):raise ValueError('Source inventory count changed')
    output.mkdir(parents=True);(output/'images').mkdir();rows=[]
    for index,(image,row) in enumerate(zip(images,audit['rows'])):
        if row['id']!=f'kgl_{index:03d}' or image.is_symlink() or not image.resolve().is_relative_to(kaggle.resolve()):
            raise ValueError('Unsafe source identity/path')
        if hashlib.sha256(image.read_bytes()).hexdigest()!=row['sourceSha256']:raise ValueError('Source image changed')
        with Image.open(image) as decoded:decoded.verify()
        relative='images/'+row['id']+'.jpg';shutil.copyfile(image,output/relative)
        rows.append({'id':row['id'],'sourceSha256':row['sourceSha256'],'image':relative})
    package={'sourceGroup':'kaggle_all_unknown_physical_id','sourceUrl':'https://www.kaggle.com/datasets/saarthaksrivastav/meter-data',
             'sourceLicense':'MIT','archiveSha256':audit['archiveSha256'],'samples':rows,'modelSuggestionsIncluded':False}
    (output/'package.json').write_text(json.dumps(package,indent=2)+'\n')
    template=Path(__file__).with_name('meter_review.html').read_text(encoding='utf-8')
    payload=json.dumps(package,ensure_ascii=True).replace('<','\\u003c')
    (output/'index.html').write_text(template.replace('__PACKAGE__',payload),encoding='utf-8')
    print(json.dumps({'publicImages':len(rows),'humanReviewsReceived':0,'independentExactLabels':0,'output':output.as_posix()}))


def build_manifest(manifest,root,output):
    if output.exists():raise ValueError('Never overwrite a review pack')
    data=json.loads(manifest.read_text(encoding='utf-8'));rows=[];seen=set()
    for source in data['samples']:
        identifier=source['id'];image=(root/source['image']).resolve()
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,80}',identifier) or identifier in seen or not image.is_relative_to(root.resolve()):
            raise ValueError('Unsafe or duplicate pilot image')
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,80}',source.get('sourceGroup','')):
            raise ValueError('Pilot source group required')
        seen.add(identifier)
        if hashlib.sha256(image.read_bytes()).hexdigest()!=source['sha256']:raise ValueError('Pilot image checksum mismatch')
        with Image.open(image) as decoded:decoded.verify()
        rows.append({'id':identifier,'sourceSha256':source['sha256'],'sourceGroup':source['sourceGroup'],
                     'image':'images/'+identifier+image.suffix.lower()})
    output.mkdir(parents=True);(output/'images').mkdir()
    for source,row in zip(data['samples'],rows):shutil.copyfile(root/source['image'],output/row['image'])
    package={'sourceGroup':'multiple_sources_keep_per_image_groups','samples':rows,'modelSuggestionsIncluded':False,
             'inputManifestSha256':hashlib.sha256(manifest.read_bytes()).hexdigest()}
    (output/'package.json').write_text(json.dumps(package,indent=2)+'\n')
    template=Path(__file__).with_name('meter_review.html').read_text(encoding='utf-8')
    (output/'index.html').write_text(template.replace('__PACKAGE__',json.dumps(package).replace('<','\\u003c')),encoding='utf-8')
    print(json.dumps({'pilotImages':len(rows),'humanReviewsReceived':0,'modelSuggestionsIncluded':False}))


def main():
    p=argparse.ArgumentParser(description=__doc__);commands=p.add_subparsers(dest='command',required=True)
    create=commands.add_parser('build');create.add_argument('kaggle',type=Path);create.add_argument('output',type=Path)
    pilot=commands.add_parser('build-manifest')
    for name in ['manifest','root','output']:pilot.add_argument(name,type=Path)
    merge=commands.add_parser('merge')
    for name in ['package','first','second','output']:merge.add_argument(name,type=Path)
    a=p.parse_args()
    if a.command=='build':build(a.kaggle,a.output)
    elif a.command=='build-manifest':build_manifest(a.manifest,a.root,a.output)
    else:
        package=json.loads(a.package.read_text());verify_package_images(package,a.package.parent)
        result=reconcile(package,*[json.loads(getattr(a,n).read_text()) for n in ['first','second']])
        a.output.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({k:len(v) for k,v in result['views'].items()}))


if __name__=='__main__':main()
