"""Full-frame vs tiles vs predicted-body cascade vs native text proposals.

Screen and numeric-register ground truth are distinct provisional annotations.
No historical test input is used. A numeric region is not a billing register.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import sys
import time

import cv2
import numpy as np
import onnxruntime as ort

sys.path.insert(0, str(Path(__file__).resolve().parent))
from evaluate_finetuned_yolo import letterbox, decode, iou
from compare_paddle_meter_models import PaddleCtcReader
from display_tile_geometry import tile_windows

METHODS = ['full416', 'tiles640', 'tiles416', 'predicted_body', 'predicted_body_tiles416', 'native_text1280', 'screen_then_text1280']


def nms(boxes):
    kept = []
    for box in sorted(boxes, key=lambda b: b['score'], reverse=True):
        if not any(iou(box['box'], b['box']) > .45 for b in kept):
            kept.append(box)
    return kept[:100]


def yolo(session, image, x=0, y=0, reading=True):
    tensor, scale, left, top = letterbox(image)
    raw = session.run(None, {session.get_inputs()[0].name: tensor})[0]
    return [{**b, 'box': [b['box'][0] + x, b['box'][1] + y, b['box'][2] + x, b['box'][3] + y]}
            for b in decode(raw, image.shape, scale, left, top, .15) if not reading or b['class'] == 0]


def predict_tiles(session, image, edge, x=0, y=0):
    boxes = yolo(session, image, x, y)
    h, w = image.shape[:2]
    for x1, y1, x2, y2 in tile_windows(w, h, edge):
        boxes += yolo(session, image[y1:y2, x1:x2], x + x1, y + y1)
    return nms(boxes)


def crop(image, box):
    x1, y1, x2, y2 = box
    h, w = image.shape[:2]
    x1, y1 = max(0, int(np.floor(x1))), max(0, int(np.floor(y1)))
    x2, y2 = min(w, int(np.ceil(x2))), min(h, int(np.ceil(y2)))
    return image[y1:y2, x1:x2], x1, y1


def text_proposals(session, image, english):
    h, w = image.shape[:2]
    ratio = min(1, 1280 / max(w, h))
    rw, rh = max(32, round(w * ratio / 32) * 32), max(32, round(h * ratio / 32) * 32)
    rgb = cv2.resize(image[:, :, ::-1], (rw, rh)).astype(np.float32) / 255
    tensor = np.ascontiguousarray(((rgb - [.485, .456, .406]) / [.229, .224, .225]).transpose(2, 0, 1)[None], dtype=np.float32)
    probability = session.run(None, {session.get_inputs()[0].name: tensor})[0][0, 0]
    mask = (probability >= .3).astype(np.uint8) * 255
    contours, _ = cv2.findContours(mask, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    boxes = []
    for contour in contours[:256]:
        if len(contour) < 3 or cv2.contourArea(contour) < 6:
            continue
        x, y, cw, ch = cv2.boundingRect(contour)
        selected = probability[y:y + ch, x:x + cw][mask[y:y + ch, x:x + cw] != 0]
        if selected.size == 0 or selected.mean() < .5:
            continue
        points = contour.astype(np.float32)
        points[:, :, 0] *= w / probability.shape[1]
        points[:, :, 1] *= h / probability.shape[0]
        center, size, angle = cv2.minAreaRect(points)
        pad = size[0] * size[1] * 1.5 / max(1, size[0] + size[1])
        corners = cv2.boxPoints((center, (size[0] + pad, size[1] + pad), angle))
        box = [max(0., float(corners[:, 0].min())), max(0., float(corners[:, 1].min())),
               min(float(w), float(corners[:, 0].max())), min(float(h), float(corners[:, 1].max()))]
        window, _, _ = crop(image, box)
        result = english.read(window)
        # Reject mixed text instead of deleting unwanted characters. No expected
        # digit count, serial field or ground-truth region participates in choice.
        if result['digits'] is not None and result['minimumCharacterScore'] >= .5:
            boxes.append({'box': box, 'score': float(selected.mean()), 'recognition': result})
    return sorted(boxes, key=lambda b: (b['box'][3] - b['box'][1], b['score']), reverse=True)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for name in ['display', 'body', 'detector', 'english', 'server', 'manifest', 'root', 'output']:
        p.add_argument(name, type=Path)
    a = p.parse_args()
    if a.output.exists(): raise ValueError('Never overwrite a study')
    a.output.mkdir(parents=True)
    opts = ort.SessionOptions(); opts.intra_op_num_threads = 2
    sessions = {name: ort.InferenceSession(str(path), sess_options=opts, providers=['CPUExecutionProvider'])
                for name, path in [('display', a.display), ('body', a.body), ('detector', a.detector)]}
    readers = {name: PaddleCtcReader(kind, path) for name, kind, path in
               [('english', 'english_mobile', a.english), ('server', 'multilingual_server', a.server)]}
    samples = json.loads(a.manifest.read_text())['samples']
    rows = []; thresholds = {}; grids = {}
    for split in ['validation', 'test']:
        for sample in [s for s in samples if s['split'] == split]:
            path = (a.root / sample['image']).resolve()
            if not path.is_relative_to(a.root.resolve()) or hashlib.sha256(path.read_bytes()).hexdigest() != sample['sha256']:
                raise ValueError('Frozen image changed')
            image = cv2.imread(str(path))
            for method in METHODS:
                started = time.perf_counter(); body_boxes = []; text_boxes = []
                if method == 'full416': boxes = yolo(sessions['display'], image)
                elif method in ['tiles640', 'tiles416', 'screen_then_text1280']:
                    boxes = predict_tiles(sessions['display'], image, 416 if method == 'tiles416' else 640)
                elif method.startswith('predicted_body'):
                    body_boxes = [b for b in yolo(sessions['body'], image, reading=False) if b['score'] >= .25]
                    boxes = []
                    if len(body_boxes) == 1:
                        window, x, y = crop(image, body_boxes[0]['box'])
                        boxes = predict_tiles(sessions['display'], window, 416, x, y) if method.endswith('tiles416') else yolo(sessions['display'], window, x, y)
                else:
                    text_boxes = text_proposals(sessions['detector'], image, readers['english'])
                    boxes = text_boxes[:1]
                # Fixed top-confidence screen selection; do not choose by GT IoU.
                boxes = sorted(boxes, key=lambda b: b['score'], reverse=True)
                selected = boxes[0] if boxes else None
                screen_box = selected['box'] if selected and method != 'native_text1280' else None
                if method == 'screen_then_text1280' and selected:
                    window, x, y = crop(image, selected['box'])
                    text_boxes = text_proposals(sessions['detector'], window, readers['english'])
                    selected = text_boxes[0] if text_boxes else None
                    if selected: selected = {**selected, 'box': [selected['box'][0] + x, selected['box'][1] + y, selected['box'][2] + x, selected['box'][3] + y]}
                recognition = {}
                if selected:
                    window, _, _ = crop(image, selected['box'])
                    recognition = {name: reader.read(window) for name, reader in readers.items()}
                    filename = sample['id'] + '-' + method + '.png'
                    cv2.imwrite(str(a.output / filename), window)
                rows.append({'id': sample['id'], 'split': split, 'method': method, 'bodyBoxes': body_boxes,
                    'boxes': boxes, 'selected': selected, 'screenBox': screen_box, 'textCandidates': text_boxes,
                    'screenIoU': iou(screen_box, sample['display_screen']) if screen_box and sample['display_screen'] else 0,
                    'numericIoU': iou(selected['box'], sample['numeric_register']) if selected and sample['numeric_register'] else 0,
                    'hasAnnotatedScreen': sample['display_screen'] is not None, 'expectedDigits': sample['expectedDigits'],
                    'readabilityState': sample['readabilityState'], 'recognition': recognition, 'pipelineMs': (time.perf_counter() - started) * 1000})
        if split == 'validation':
            for method in METHODS:
                candidates = []
                for threshold in [.25, .4, .55, .7]:
                    subset = [r for r in rows if r['method'] == method]
                    good = sum(r['selected'] is not None and r['selected']['score'] >= threshold and
                               (r['numericIoU'] if 'text1280' in method else r['screenIoU']) >= .5 for r in subset)
                    bad = sum(r['selected'] is not None and r['selected']['score'] >= threshold and not r['hasAnnotatedScreen'] for r in subset)
                    grids[method + ':' + str(threshold)] = {'localized': good, 'negativeAccepted': bad}
                    if good > 0 and bad == 0: candidates.append((good, threshold))
                thresholds[method] = max(candidates)[1] if candidates else None
            (a.output / 'selection-before-test.json').write_text(json.dumps(thresholds, indent=2) + '\n')
    result = {'scope': 'provisional_new_geometry_screen_and_numeric_not_billing_accuracy', 'runtimeEnabled': False,
        'manifestSha256': hashlib.sha256(a.manifest.read_bytes()).hexdigest(), 'selectedOnValidation': thresholds,
        'validationGrid': grids, 'modelHashes': {name: hashlib.sha256(path.read_bytes()).hexdigest() for name, path in
                [('display', a.display), ('body', a.body), ('detector', a.detector)]}, 'rows': rows,
        'limitations': ['Largest numeric font is an experimental geometric proposal, not register verification',
                       'Top-score screen is a research proposal; multiple regions remain unsafe for production',
                       'All new coordinates and strings are agent provisional; zero independent human reviews']}
    (a.output / 'report.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'selected': thresholds, 'test': [{'id': r['id'], 'method': r['method'], 'screenIoU': r['screenIoU'], 'numericIoU': r['numericIoU'],
                'raw': {k: v['raw'] for k, v in r['recognition'].items()}} for r in rows if r['split'] == 'test']}))


if __name__ == '__main__': main()
