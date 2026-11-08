"""One frozen whole-image/display fusion experiment; no training or oracle boxes.

Reuse pinned CLIP heads, body and display detectors. Crop geometry comes only
from model outputs. No OCR, file name, numeric label or Meter profile input.
This offline experiment never changes the application's classifier.
"""
import argparse
import hashlib
import json
from pathlib import Path

import cv2
import numpy as np
import onnxruntime as ort
from PIL import Image

from evaluate_finetuned_yolo import letterbox, decode, iou
from train_runtime_meter_heads import runtime_pixels
from meter_hierarchy_policy import hierarchy_decision


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ['classifier', 'body', 'display', 'manifest', 'root', 'output']:
        parser.add_argument(key, type=Path)
    args = parser.parse_args()
    if args.output.exists():
        raise ValueError('Use a fresh receipt')
    settings = ort.SessionOptions()
    settings.intra_op_num_threads = 2
    settings.inter_op_num_threads = 1
    models = {key: ort.InferenceSession(str(getattr(args, key)), sess_options=settings,
              providers=['CPUExecutionProvider']) for key in ['classifier', 'body', 'display']}

    def predict(image):
        tensor = runtime_pixels(Image.fromarray(image[:, :, ::-1]))[None]
        return models['classifier'].run(None, {'pixel_values': tensor})

    def detections(name, image):
        tensor, scale, left, top = letterbox(image)
        model = models[name]
        return decode(model.run(None, {model.get_inputs()[0].name: tensor})[0],
                      image.shape, scale, left, top, .5)

    def decision(logits):
        probs = []
        for raw in logits:
            scores = np.exp(raw[0] - np.max(raw[0]))
            probs.append(scores / scores.sum())
        return hierarchy_decision(dict(zip(['electricity', 'water', 'not_meter'], probs[0])),
                                  dict(zip(['mechanical', 'digital'], probs[1])), .55, .75)

    rows = []
    for sample in json.loads(args.manifest.read_text(encoding='utf-8'))['samples']:
        path = (args.root / sample['image']).resolve()
        if not path.is_relative_to(args.root.resolve()) or hashlib.sha256(path.read_bytes()).hexdigest() != sample['sha256']:
            raise ValueError('Frozen public photo changed')
        image = cv2.imread(str(path))
        scale = min(1, 1600 / max(image.shape[:2]))
        if scale < 1:
            image = cv2.resize(image, (int(image.shape[1]*scale), int(image.shape[0]*scale)), interpolation=cv2.INTER_AREA)
        whole = predict(image)
        bodies = []
        for box in detections('body', image):
            if not any(iou(box['box'], old['box']) >= .8 for old in bodies):
                bodies.append(box)
        screens = [b for b in detections('display', image) if b['class'] == 0]
        selected = None
        if len(bodies) == 1 and len(screens) == 1:
            x1, y1, x2, y2 = screens[0]['box']
            bx1, by1, bx2, by2 = bodies[0]['box']
            if bx1 <= (x1+x2)/2 <= bx2 and by1 <= (y1+y2)/2 <= by2:
                selected = [int(np.floor(x1)), int(np.floor(y1)), int(np.ceil(x2)), int(np.ceil(y2))]
        fused = [x.copy() for x in whole]
        display_logits = None
        if selected:
            x1, y1, x2, y2 = selected
            display_logits = predict(image[y1:y2, x1:x2])
            # Whole image establishes utility; equal-weight technology logits
            # preserve body context while adding actual predicted-display detail.
            fused[1] = (whole[1] + display_logits[1]) * .5
        rows.append({'id': sample['id'], 'category': sample['category'], 'cohort': sample['cohort'],
                     'baseline': decision(whole), 'candidate': decision(fused), 'bodyCount': len(bodies),
                     'screenCount': len(screens), 'selectedPredictedDisplay': selected,
                     'wholeLogits': [x.tolist() for x in whole],
                     'displayLogits': None if display_logits is None else [x.tolist() for x in display_logits]})
    receipt = {'scope': 'offline_provisional_no_business_activation', 'thresholds': [.55, .75],
               'technologyWholeWeight': .5, 'noTraining': True, 'oracleBoxesUsed': False,
               'models': {name: hashlib.sha256(getattr(args, name).read_bytes()).hexdigest() for name in models},
               'manifestSha256': hashlib.sha256(args.manifest.read_bytes()).hexdigest(), 'rows': rows}
    args.output.write_text(json.dumps(receipt, indent=2)+'\n', encoding='utf-8')
    for cohort in sorted({row['cohort'] for row in rows}):
        for mode in ['baseline', 'candidate']:
            subset = [row for row in rows if row['cohort'] == cohort]
            print(json.dumps({'cohort': cohort, 'mode': mode, 'inputs': len(subset),
                              'correct': sum(r[mode] == r['category'] for r in subset),
                              'wrong': sum(r[mode] not in ['unknown', r['category']] for r in subset),
                              'unknown': sum(r[mode] == 'unknown' for r in subset)}))


if __name__ == '__main__':
    main()
