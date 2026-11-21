"""Compare pinned Paddle CTC models on frozen public diagnostic crops.

Component experiment only: oracle windows, publisher digit labels, no billing or
four-class acceptance claim. Existing numeric conflicts remain recorded as vetoes.
No threshold selection, training, or application registration occurs here.
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

MODELS = {
    'english_mobile': ('b5f833dfc5d0eb71da397b4efa06ebeee9b431b690a47d6af40d77d8eabc557f',
                       '27e91d0582f40168aa218303c76e184bc78fa7a5d105aad0cfbad8458b441067'),
    'multilingual_server': ('d9dc333c9c7b042c6dffb8e33d72b6f65c9c1d463d0a3c2f78174fea55e94752',
                            '2c719dba044c4e2228aef8ff92f5f575394d75d24c16de096a33b7cfd902f66d'),
}


class PaddleCtcReader:
    def __init__(self, name, root):
        for file, expected in zip(('inference.onnx', 'inference.yml'), MODELS[name]):
            if hashlib.sha256((root/file).read_bytes()).hexdigest() != expected:
                raise ValueError('Pinned model/config checksum mismatch')
        config = yaml.safe_load((root/'inference.yml').read_text(encoding='utf-8'))
        self.dictionary = ['', *config['PostProcess']['character_dict'], ' ']
        settings = ort.SessionOptions(); settings.intra_op_num_threads = 2; settings.inter_op_num_threads = 1
        settings.log_severity_level = 3
        self.session = ort.InferenceSession(str(root/'inference.onnx'), settings, providers=['CPUExecutionProvider'])

    def read(self, image):
        if image is None or image.size == 0: raise ValueError('Corrupt crop')
        natural = math.ceil(48*image.shape[1]/image.shape[0]); width = max(320, natural)
        if not 1 <= natural <= 2048: raise ValueError('Unsupported crop aspect ratio')
        image = cv2.resize(image, (natural, 48)).astype(np.float32).transpose(2, 0, 1)/127.5-1
        tensor = np.zeros((1, 3, 48, width), np.float32); tensor[0, :, :, :natural] = image
        started = time.perf_counter()
        scores = self.session.run(None, {self.session.get_inputs()[0].name: tensor})[0][0]
        if scores.shape[1] != len(self.dictionary): raise ValueError('CTC dictionary mismatch')
        ids = scores.argmax(1); previous = 0; text = []; confidence = []
        for t, index in enumerate(ids):
            if index and index != previous:
                text.append(self.dictionary[index]); confidence.append(float(scores[t, index]))
            previous = index
        raw = ''.join(text).strip()
        digits = re.sub(r'[.,]', '', raw) if re.fullmatch(r'[0-9]+(?:[.,][0-9]+)?', raw) else None
        return {'raw': raw, 'digits': digits, 'minimumCharacterScore': min(confidence, default=0),
                'meanCharacterScore': float(np.mean(confidence)) if confidence else 0,
                'forwardMs': (time.perf_counter()-started)*1000}


def summarize(rows):
    metrics = {}
    for row in rows:
        key = row['scope']+':'+row['model']; count = metrics.setdefault(key, Counter())
        count.update(inputs=1, numeric=row['digits'] is not None)
        if row['scope']=='lcd_agent_draft':
            count.update(matchesAgentDraft=row['exact'])
        else:
            count.update(completeLabel=row['expectedDigits'] is not None, exact=row['exact'], incorrect=row['incorrect'])
    for key, count in metrics.items():
        count['p95ForwardMs'] = float(np.percentile([r['forwardMs'] for r in rows if r['scope']+':'+r['model'] == key], 95))
    return metrics


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('english', type=Path); p.add_argument('server', type=Path)
    p.add_argument('diagnostic', type=Path); p.add_argument('output', type=Path)
    p.add_argument('--lcd-manifest', type=Path); p.add_argument('--root', type=Path, default=Path('.'))
    a = p.parse_args(); readers = {name: PaddleCtcReader(name, root) for name, root in
                                  [('english_mobile', a.english), ('multilingual_server', a.server)]}
    diagnostic = json.loads(a.diagnostic.read_text(encoding='utf-8')); rows = []
    for sample in diagnostic['rows']:
        for mode in sample['modes']:
            if mode['mode'] not in ('predicted_window', 'oracle_window'): continue
            crop = a.diagnostic.parent/mode['cropFile']; image = cv2.imread(str(crop))
            for name, reader in readers.items():
                result = reader.read(image); expected = sample['expectedDigits']
                legacy_conflict = bool(mode['ppNumericCandidate'] and mode['stage2Value'] and
                                       mode['ppNumericCandidate'].replace('.', '') != mode['stage2Value'])
                rows.append({'id': sample['imageId'], 'scope': mode['mode'], 'model': name,
                             'cropSha256': hashlib.sha256(crop.read_bytes()).hexdigest(),
                             'expectedDigits': expected, 'labelStatus': 'publisher_not_independently_reviewed',
                             'exact': expected is not None and result['digits'] == expected,
                             'incorrect': expected is not None and result['digits'] is not None and result['digits'] != expected,
                             'legacyNumericDisagreementPreserved': legacy_conflict, **result})
    if a.lcd_manifest:
        for sample in json.loads(a.lcd_manifest.read_text(encoding='utf-8'))['samples']:
            path = (a.root/sample['crop']).resolve()
            if not path.is_relative_to(a.root.resolve()) or hashlib.sha256(path.read_bytes()).hexdigest() != sample['cropSha256']:
                raise ValueError('Public LCD crop path/hash mismatch')
            for name, reader in readers.items():
                result = reader.read(cv2.imread(str(path)))
                rows.append({'id': sample['id'], 'scope': 'lcd_agent_draft', 'model': name,
                             'expectedDigits': sample['expectedDigits'], 'labelStatus': 'draft_exclude_acceptance',
                             'exact': result['raw'] == sample['expectedDigits'], **result})
    metrics = summarize(rows)
    result = {'diagnosticSha256': hashlib.sha256(a.diagnostic.read_bytes()).hexdigest(),
              'models': MODELS, 'scope': 'offline_component_only_no_runtime_activation', 'metrics': metrics, 'rows': rows}
    a.output.write_text(json.dumps(result, indent=2, ensure_ascii=True)+'\n', encoding='utf-8')
    print(json.dumps(metrics))


if __name__ == '__main__': main()
