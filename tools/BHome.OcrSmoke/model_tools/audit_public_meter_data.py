"""Audit an already downloaded Kaggle meter-data v1 archive; no network/training.

Opaque display crops omit serial regions. Near-duplicate clusters are candidates,
not evidence of independent physical meters. Original publisher splits are kept.
"""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path

import cv2
import numpy as np

ARCHIVE_SHA = 'f459b1d39ff68cab8e2ee909f9f095bc3244b1efa23ff848ac2bd572c73bd4a4'


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('archive', type=Path)
    p.add_argument('extracted', type=Path)
    p.add_argument('output', type=Path)
    a = p.parse_args()
    if hashlib.sha256(a.archive.read_bytes()).hexdigest() != ARCHIVE_SHA:
        raise ValueError('Archive checksum mismatch')
    root = a.extracted.resolve()
    crops = root/'display-crops'; crops.mkdir(exist_ok=True)
    rows = []; perceptual = []; errors = []; counts = Counter()
    for index, image in enumerate(sorted((root/'processed/images').glob('*/*.jpg'))):
        im = cv2.imread(str(image))
        if im is None:
            raise ValueError('Image decode failed')
        name = f'kgl_{index:03d}'
        label = root/'processed/labels'/image.parent.name/(image.stem+'.txt')
        boxes = []
        for line in label.read_text().splitlines():
            values = [float(x) for x in line.split()]
            if len(values) != 5 or values[0] not in (0, 1) or not all(np.isfinite(values)):
                errors.append(name); continue
            cls, x, y, w, h = values
            if w <= 0 or h <= 0 or x-w/2 < 0 or y-h/2 < 0 or x+w/2 > 1 or y+h/2 > 1:
                errors.append(name); continue
            counts[str(int(cls))] += 1
            if cls == 0: boxes.append(values)
        gray = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)
        dct = cv2.dct(cv2.resize(gray, (32, 32)).astype(np.float32))[:8, :8].flatten()[1:]
        perceptual.append(dct > np.median(dct))
        row = {'id': name, 'sourceSha256': hashlib.sha256(image.read_bytes()).hexdigest(),
               'labelSha256': hashlib.sha256(label.read_bytes()).hexdigest(),
               'publisherSplit': image.parent.name, 'readingBoxCount': len(boxes),
               'physicalMeterGroup': None}
        if len(boxes) == 1:
            _, x, y, w, h = boxes[0]; height, width = im.shape[:2]
            bounds = [max(0, int((x-w/2)*width)), max(0, int((y-h/2)*height)),
                      min(width, int((x+w/2)*width)), min(height, int((y+h/2)*height))]
            x1, y1, x2, y2 = bounds
            target = crops/(name+'.png')
            if not cv2.imwrite(str(target), im[y1:y2, x1:x2]): raise ValueError('Crop write failed')
            row.update(crop=f'.tools/ocr-recovery-kaggle/display-crops/{name}.png',
                       cropSha256=hashlib.sha256(target.read_bytes()).hexdigest(), sourceBoxXYXY=bounds)
        rows.append(row)
    pairs = [{'a': rows[i]['id'], 'b': rows[j]['id'], 'distance': int(np.count_nonzero(perceptual[i] != perceptual[j])),
              'crossPublisherSplit': rows[i]['publisherSplit'] != rows[j]['publisherSplit']}
             for i in range(len(rows)) for j in range(i) if np.count_nonzero(perceptual[i] != perceptual[j]) <= 6]
    duplicates = sum(n-1 for n in Counter(r['sourceSha256'] for r in rows).values())
    result = {'archiveSha256': ARCHIVE_SHA, 'images': len(rows), 'exactDuplicateImages': duplicates,
              'labelCounts': counts, 'invalidLabelRows': errors, 'perceptualThreshold': 6,
              'nearDuplicatePairs': pairs, 'physicalIndependence': 'unknown_not_training_eligible', 'rows': rows}
    a.output.write_text(json.dumps(result, indent=2)+'\n', encoding='utf-8')
    print(json.dumps({k: result[k] for k in ('images', 'exactDuplicateImages', 'labelCounts', 'invalidLabelRows')}))
    print(json.dumps({'nearDuplicatePairs': len(pairs), 'crossSplitPairs': sum(x['crossPublisherSplit'] for x in pairs)}))


if __name__ == '__main__':
    main()
