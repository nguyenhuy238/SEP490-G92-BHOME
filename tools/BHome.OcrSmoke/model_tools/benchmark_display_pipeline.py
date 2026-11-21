"""Same-photo before/after benchmark, full image to experimental digit string.

This excludes visual category, readability, billing register, precision, API and
Staff workflow. No candidate is exposed as an application proposal.
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
import onnxruntime as ort

sys.path.insert(0, str(Path(__file__).resolve().parent))
from study_high_resolution_displays import text_proposals, yolo, crop
from compare_paddle_meter_models import PaddleCtcReader


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for name in ['display', 'text_detector', 'english', 'manifest', 'root', 'output']: p.add_argument(name, type=Path)
    a = p.parse_args()
    if a.output.exists(): raise ValueError('Never overwrite a benchmark')
    options = ort.SessionOptions(); options.intra_op_num_threads = 2
    display = ort.InferenceSession(str(a.display), sess_options=options, providers=['CPUExecutionProvider'])
    detector = ort.InferenceSession(str(a.text_detector), sess_options=options, providers=['CPUExecutionProvider'])
    reader = PaddleCtcReader('english_mobile', a.english)
    rows = []
    for sample in json.loads(a.manifest.read_text())['samples']:
        path = a.root / sample['image']
        if hashlib.sha256(path.read_bytes()).hexdigest() != sample['sha256']: raise ValueError('Image changed')
        for method in ['yolo416', 'native_text', 'native_text_row_margin']:
            started = time.perf_counter(); image = cv2.imread(str(path))
            boxes = yolo(display, image) if method == 'yolo416' else text_proposals(detector, image, reader)
            selected = max(boxes, key=lambda b: b['score']) if method == 'yolo416' and boxes else boxes[0] if boxes else None
            threshold = .25 if method == 'yolo416' else .7
            result = {'raw': '', 'digits': None}
            if selected is not None and selected['score'] >= threshold:
                bounds = selected['box'][:]
                if method.endswith('row_margin'):
                    margin = .5 * (bounds[3] - bounds[1]); bounds[0] -= margin; bounds[2] += margin
                window, _, _ = crop(image, bounds); result = reader.read(window)
            positive = sample['readabilityState'] == 'readable_consumption'
            rows.append({'id': sample['id'], 'method': method, 'positive': positive, 'expectedDigits': sample['expectedDigits'],
                         'category': sample['category'], 'expectedState': sample['readabilityState'],
                         'exact': positive and result['digits'] == sample['expectedDigits'],
                         'incorrectPositiveNumeric': positive and result['digits'] is not None and result['digits'] != sample['expectedDigits'],
                         'invalidControlNumeric': not positive and result['digits'] is not None,
                         'fallback': result['digits'] is None, 'applicationProposalEmitted': False,
                         'selected': selected, **result, 'fullImagePipelineMs': (time.perf_counter() - started) * 1000})
    summary = {}
    for method in ['yolo416', 'native_text', 'native_text_row_margin']:
        subset = [r for r in rows if r['method'] == method]
        summary[method] = {'inputs': len(subset), 'positives': sum(r['positive'] for r in subset),
            **{k: sum(r[k] for r in subset) for k in ['exact', 'incorrectPositiveNumeric', 'invalidControlNumeric', 'fallback']},
            'p95FullImagePipelineMs': float(np.percentile([r['fullImagePipelineMs'] for r in subset], 95))}
    a.output.write_text(json.dumps({'scope': 'exploratory_provisional_full_image_to_numeric_not_full_BHOME_OCR',
        'activationDecision': 'REJECTED', 'runtimeEnabled': False, 'summary': summary, 'rows': rows,
        'manifestSha256': hashlib.sha256(a.manifest.read_bytes()).hexdigest(),
        'reason': 'Margin recovers a true visible thin digit but incorrect non-billing/obscured control outputs remain; no type/register/precision safety validation'}, indent=2) + '\n')
    print(json.dumps(summary))


if __name__ == '__main__': main()
