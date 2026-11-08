"""Offline official English PP-OCRv5 candidate; no runtime model registration.

Inputs are the public pinned diagnostic and its crops. Compare all inputs; never
select only pictures whose ground truth agrees. The full original type/register/
blur/multiple-region veto remains a prerequisite, as does Stage2 completeness.
"""
import argparse
from collections import Counter
import hashlib
import json
import math
from pathlib import Path
import re
import time

import cv2
import numpy as np
import onnxruntime as ort
import yaml

MODEL_SHA = 'b5f833dfc5d0eb71da397b4efa06ebeee9b431b690a47d6af40d77d8eabc557f'
CONFIG_SHA = '27e91d0582f40168aa218303c76e184bc78fa7a5d105aad0cfbad8458b441067'


class EnglishReader:
    def __init__(self, root):
        for name, expected in [('inference.onnx', MODEL_SHA), ('inference.yml', CONFIG_SHA)]:
            if hashlib.sha256((root/name).read_bytes()).hexdigest() != expected:
                raise ValueError('Official model/config checksum mismatch')
        config = yaml.safe_load((root/'inference.yml').read_text(encoding='utf-8'))
        self.dictionary = ['', *config['PostProcess']['character_dict'], ' ']
        settings = ort.SessionOptions(); settings.intra_op_num_threads = 2; settings.inter_op_num_threads = 1; settings.log_severity_level = 3
        self.session = ort.InferenceSession(str(root/'inference.onnx'), settings, providers=['CPUExecutionProvider'])

    def read(self, image):
        width = max(320, math.ceil(48 * image.shape[1] / image.shape[0]))
        resized_width = min(width, math.ceil(48 * image.shape[1] / image.shape[0]))
        resized = cv2.resize(image, (resized_width, 48)).astype(np.float32).transpose(2, 0, 1) / 127.5 - 1
        tensor = np.zeros((1, 3, 48, width), dtype=np.float32)
        tensor[0, :, :, :resized_width] = resized
        start = time.perf_counter()
        scores = self.session.run(None, {self.session.get_inputs()[0].name: tensor})[0][0]
        if scores.shape[-1] != len(self.dictionary): raise ValueError('CTC dictionary mismatch')
        ids = scores.argmax(axis=1); result=[]; confidences=[]; previous=0
        for index, value in enumerate(ids):
            if value != 0 and value != previous:
                result.append(self.dictionary[value]); confidences.append(float(scores[index, value]))
            previous = value
        text = ''.join(result).strip()
        return text, min(confidences, default=0), float(np.mean(confidences)) if confidences else 0, (time.perf_counter()-start)*1000


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('model',type=Path);parser.add_argument('diagnostic',type=Path);parser.add_argument('output',type=Path)
    parser.add_argument('--positive-manifest',type=Path);parser.add_argument('--image-root',type=Path,default=Path('.'))
    args=parser.parse_args(); reader=EnglishReader(args.model)
    data=json.loads(args.diagnostic.read_text(encoding='utf-8')); rows=[]; counts={}
    for sample in data['rows']:
        expected=sample['expectedDigits']; modes=[]
        for observed in sample['modes']:
            if observed['mode'] not in ('predicted_window','oracle_window'): continue
            image=cv2.imread(str(args.diagnostic.parent/observed['cropFile']))
            raw, minimum, confidence, latency=reader.read(image)
            numeric=raw.replace(',','.') if re.fullmatch(r'[0-9]+(?:[.,][0-9]+)?',raw) else None
            forbidden={'billing_register_unverified','meter_type_mismatch','multiple_reading_regions','blur_or_low_detail','text_region_limit','orientation_uncertain','conflicting_reading'}
            veto=forbidden.intersection(observed['parserWarnings'])
            value=(numeric if numeric is not None and numeric.replace('.','')==observed['stage2Value']
                   and observed['confidence'] is not None and observed['confidence'] >= .5 and not observed['stage2Warnings']
                   and not veto and sample['canRecognize'] else None)
            outcome={'mode':observed['mode'],'raw':raw,'minimumCharacterScore':minimum,'confidence':confidence,'forwardMs':latency,
                     'numeric':numeric,'stage2':observed['stage2Value'],'veto':sorted(veto),'value':value,
                     'exact':expected is not None and value is not None and value.replace('.','')==expected,
                     'false':expected is not None and value is not None and value.replace('.','')!=expected,
                     'unknownGroundTruthProposal':expected is None and value is not None}
            modes.append(outcome)
            c=counts.setdefault(observed['mode'],Counter());c.update(inputs=1,proposed=value is not None,exact=outcome['exact'],false=outcome['false'],unknown=outcome['unknownGroundTruthProposal'])
        rows.append({'imageId':sample['imageId'],'expectedDigits':expected,'modes':modes})
    positives=[]
    if args.positive_manifest:
        for sample in json.loads(args.positive_manifest.read_text(encoding='utf-8'))['samples']:
            if sample['provenance']['kind']!='public' or sample['split']!='test':raise ValueError('Frozen public positive candidates required')
            root=args.image_root.resolve();path=(root/sample['image']).resolve()
            if not path.is_relative_to(root) or hashlib.sha256(path.read_bytes()).hexdigest()!=sample['sha256']:raise ValueError('Positive image checksum/path mismatch')
            im=cv2.imread(str(path));scale=min(1,1600/max(im.shape[:2]));im=cv2.resize(im,(int(im.shape[1]*scale),int(im.shape[0]*scale)),interpolation=cv2.INTER_AREA)
            ok,encoded=cv2.imencode('.jpg',im,[cv2.IMWRITE_JPEG_QUALITY,85])
            if not ok:raise ValueError('Mobile image encoding failed')
            im=cv2.imdecode(encoded,cv2.IMREAD_COLOR)
            p=np.asarray(sample['windowPolygon'],np.float32)*[im.shape[1],im.shape[0]]
            width=max(2,int(max(np.linalg.norm(p[0]-p[1]),np.linalg.norm(p[2]-p[3]))));height=max(2,int(max(np.linalg.norm(p[0]-p[3]),np.linalg.norm(p[1]-p[2]))))
            matrix=cv2.getPerspectiveTransform(p.astype(np.float32),np.asarray([[0,0],[width-1,0],[width-1,height-1],[0,height-1]],np.float32))
            crop=cv2.warpPerspective(im,matrix,(width,height),borderMode=cv2.BORDER_REPLICATE)
            text,minimum,confidence,ms=reader.read(crop)
            positives.append({'id':sample['id'],'sha256':sample['sha256'],'mode':'oracle_crop_only','inputTransform':'mobile-1600-jpeg85',
                'expectedDigits':sample['reading']['digits'],'raw':text,'minimumCharacterScore':minimum,'confidence':confidence,
                'exactRawDigits':text==sample['reading']['digits'],'forwardMs':ms,'billingAccuracy':None,'applicationProposal':None,
                'humanIndependentReview':sample['review']['independentHumanReview']})
    args.output.write_text(json.dumps({'model':'PaddlePaddle/en_PP-OCRv5_mobile_rec_onnx','revision':'3fafbc3b5dcf93dd72add9f48368be8a3a2cd33b','modelSha256':MODEL_SHA,'metrics':counts,'rows':rows,'positiveOracleObservations':positives,'runtimeEnabled':False},indent=2)+'\n',encoding='utf-8')
    print(json.dumps(counts))


if __name__=='__main__': main()
