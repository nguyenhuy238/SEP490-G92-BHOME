"""New wheel probes: direct text regions, row assembly and oracle crops.

No reader output resolves the two visually uncertain rolling-digit labels.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import time

import cv2
import onnxruntime as ort

sys.path.insert(0, str(Path(__file__).resolve().parent))
from study_high_resolution_displays import text_proposals
from compare_paddle_meter_models import PaddleCtcReader
from parseq_reader import ParseqReader
from wheel_row_geometry import group_rows


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for name in ['detector', 'english', 'server', 'parseq_source', 'parseq_weights', 'manifest', 'root', 'output']: p.add_argument(name, type=Path)
    a = p.parse_args()
    if a.output.exists(): raise ValueError('Use a fresh wheel study')
    a.output.mkdir(parents=True)
    options = ort.SessionOptions(); options.intra_op_num_threads = 2
    detector = ort.InferenceSession(str(a.detector), sess_options=options, providers=['CPUExecutionProvider'])
    readers = {'english': PaddleCtcReader('english_mobile', a.english), 'server': PaddleCtcReader('multilingual_server', a.server),
               'parseq': ParseqReader(a.parseq_source, a.parseq_weights)}
    rows = []
    for sample in json.loads(a.manifest.read_text())['samples']:
        path = a.root / sample['image']
        if hashlib.sha256(path.read_bytes()).hexdigest() != sample['sha256']: raise ValueError('Frozen source changed')
        image = cv2.imread(str(path)); started = time.perf_counter()
        proposals = text_proposals(detector, image, readers['english'])
        groups = group_rows([{'box': r['box'], 'raw': r['recognition']['raw'],
                              'minimumCharacterScore': r['recognition']['minimumCharacterScore']} for r in proposals])
        x1, y1, x2, y2 = sample['readingWindow']
        results = {name: reader.read(image[y1:y2, x1:x2]) for name, reader in readers.items()}
        rows.append({'id': sample['id'], 'category': sample['category'], 'expectedDigits': sample['expectedDigits'],
                     'uncertainPositions': sample['uncertainPositions'], 'nativeRegions': proposals, 'groupedRows': groups,
                     'largestNative': proposals[0]['recognition']['raw'] if proposals else None,
                     'largestObservedRow': groups[0]['raw'] if groups else None, 'oracle': results,
                     'pipelineMs': (time.perf_counter() - started) * 1000})
    report = {'scope': 'new_provisional_wheel_components_not_billing_or_independent_acceptance', 'runtimeEnabled': False,
              'manifestSha256': hashlib.sha256(a.manifest.read_bytes()).hexdigest(), 'rows': rows,
              'limitation': 'Text-row assembly cannot establish complete wheel coverage, category, register or rolling digit correctness'}
    (a.output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps([{'id': r['id'], 'largestNative': r['largestNative'], 'largestObservedRow': r['largestObservedRow'],
                       'oracle': {k: v['raw'] for k, v in r['oracle'].items()}} for r in rows]))


if __name__ == '__main__': main()
