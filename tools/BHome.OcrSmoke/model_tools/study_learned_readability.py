"""Source-group cross-validated learned readability features vs frozen rules.

Fits on the previous calibration subset only; historical tests and new photos
never choose weights, regularization or thresholds. No numeric text is a feature.
"""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import sys

import cv2
import numpy as np
from PIL import Image, ImageOps
import torch
from transformers import CLIPModel, CLIPProcessor

sys.path.insert(0, str(Path(__file__).resolve().parent))
from evaluate_lcd_readability import pixel_features, PROMPTS, STATES
from study_meter_hierarchy import prototypes, WEIGHTS_SHA
from lcd_readability_policy import accept
from compare_paddle_meter_models import PaddleCtcReader


def feature(row, visual):
    p = row['pixel']
    vector = [p['innerRange90'], p['localContrast95'], p['innerMedian'], np.log1p(p['laplacianVariance']),
              p['foregroundSupportComponents'], p['smallHolesPerEstimatedGlyph']]
    if visual: vector += [row['visual']['scores'][s] for s in STATES]
    return np.array(vector)


def fit(x, y, regularization):
    mean = x.mean(0); std = np.maximum(x.std(0), 1e-5)
    design = np.column_stack([np.ones(len(x)), (x - mean) / std]); weights = np.zeros(design.shape[1])
    penalty = np.eye(len(weights)) * regularization; penalty[0, 0] = 1e-6
    for _ in range(40):
        probability = 1 / (1 + np.exp(-np.clip(design @ weights, -40, 40)))
        gradient = design.T @ (probability - y) + penalty @ weights
        hessian = (design.T * (probability * (1 - probability))) @ design + penalty
        step = np.linalg.solve(hessian, gradient); weights -= step
        if np.linalg.norm(step) < 1e-7: break
    return {'mean': mean.tolist(), 'std': std.tolist(), 'weights': weights.tolist()}


def predict(model, x):
    standardized = (x - model['mean']) / model['std']
    logits = np.column_stack([np.ones(len(x)), standardized]) @ model['weights']
    return 1 / (1 + np.exp(-np.clip(logits, -40, 40)))


def state_metrics(rows, decisions):
    result = Counter(inputs=len(rows), readable=sum(r['expectedReadable'] for r in rows), retained=0, invalidAccepted=0, fallback=0)
    for row, decision in zip(rows, decisions):
        result.update(retained=decision and row['expectedReadable'], invalidAccepted=decision and not row['expectedReadable'], fallback=not decision)
    return {key: int(value) for key, value in result.items()}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for name in ['clip', 'english', 'server', 'previous', 'manifest', 'root', 'output']: p.add_argument(name, type=Path)
    a = p.parse_args()
    if a.output.exists(): raise ValueError('Use a fresh state experiment directory')
    a.output.mkdir(parents=True)
    previous = json.loads(a.previous.read_text()); calibration = [r for r in previous['rows'] if r['role'] == 'calibration']
    choices = {}; candidates = {}; models = {}
    for visual in [False, True]:
        name = 'learned_combined' if visual else 'learned_pixel'
        x = np.stack([feature(r, visual) for r in calibration]); y = np.array([r['expectedReadable'] for r in calibration], dtype=float)
        groups = np.array([r['sourceGroup'] for r in calibration]); eligible = []
        for strength in [.1, 1, 10]:
            probabilities = np.zeros(len(x))
            for group in sorted(set(groups)):
                train = groups != group; held = ~train
                probabilities[held] = predict(fit(x[train], y[train], strength), x[held])
            for threshold in [.5, .65, .8, .9, .95]:
                m = state_metrics(calibration, probabilities >= threshold)
                candidates[name + ':' + str((strength, threshold))] = m
                if m['retained'] > 0 and m['invalidAccepted'] == 0: eligible.append((m['retained'], threshold, strength))
        choice = max(eligible) if eligible else None
        choices[name] = {'regularization': choice[2], 'threshold': choice[1]} if choice else None
        models[name] = fit(x, y, choice[2] if choice else 1)
    (a.output / 'selection-before-evaluation.json').write_text(json.dumps({'choices': choices, 'models': models}, indent=2) + '\n')
    if hashlib.sha256((a.clip / 'pytorch_model.bin').read_bytes()).hexdigest() != WEIGHTS_SHA: raise ValueError('CLIP changed')
    torch.set_num_threads(2); device = 'cuda' if torch.cuda.is_available() else 'cpu'
    model = CLIPModel.from_pretrained(a.clip, local_files_only=True).to(device).eval()
    processor = CLIPProcessor.from_pretrained(a.clip, local_files_only=True)
    text = prototypes(model, processor, PROMPTS, device)
    readers = {'english': PaddleCtcReader('english_mobile', a.english), 'server': PaddleCtcReader('multilingual_server', a.server)}
    rows = [r for r in previous['rows'] if r['role'] == 'historical_test']
    samples = json.loads(a.manifest.read_text())['samples']
    for sample in samples:
        if sample['display_screen'] is None: continue
        path = a.root / sample['image']
        if hashlib.sha256(path.read_bytes()).hexdigest() != sample['sha256']: raise ValueError('Source changed')
        source = cv2.imread(str(path)); bounds = sample['display_screen']; cases = [('screen', bounds, sample['readabilityState'] == 'readable_consumption')]
        if sample['id'] == 'commons_54903199': cases.append(('status_row', [360, 245, 705, 299], False))
        for suffix, (x1, y1, x2, y2), readable in cases:
            crop = source[y1:y2, x1:x2]
            image = Image.fromarray(crop[:, :, ::-1]); image = ImageOps.pad(image, (224, 224), method=Image.Resampling.BICUBIC, color=(123, 117, 104))
            pixels = processor(images=image, return_tensors='pt')['pixel_values'].to(device)
            with torch.inference_mode():
                vector = model.get_image_features(pixels); vector /= vector.norm(dim=-1, keepdim=True)
                scores = (model.logit_scale.exp() * vector @ text.T).softmax(-1)[0].cpu().numpy()
            order = np.argsort(scores)[::-1]
            rows.append({'id': sample['id'] + ':' + suffix, 'role': 'new_provisional', 'sourceGroup': sample['id'],
                         'expectedReadable': readable, 'expectedState': sample['readabilityState'] if suffix == 'screen' else 'status_only',
                         'expectedDigits': sample['expectedDigits'] if readable else None, 'pixel': pixel_features(crop),
                         'visual': {'prediction': STATES[order[0]], 'score': float(scores[order[0]]), 'margin': float(scores[order[0]] - scores[order[1]]),
                                    'scores': dict(zip(STATES, map(float, scores)))},
                         'recognition': {name: reader.read(crop) for name, reader in readers.items()}})
    decisions = {'frozen_shape_combined': [accept(r, 'shape_combined', .5) for r in rows]}
    for name, model in models.items():
        scores = predict(model, np.stack([feature(r, name == 'learned_combined') for r in rows]))
        decisions[name] = [bool(score >= choices[name]['threshold']) if choices[name] else False for score in scores]
        for row, score in zip(rows, scores): row[name + 'Probability'] = float(score)
    report = {'scope': 'provisional_source_group_cv_not_independent_readability_acceptance', 'choices': choices,
              'crossValidationGrid': candidates, 'calibrationSourceGroups': sorted(set(r['sourceGroup'] for r in calibration)),
              'models': models, 'runtimeEnabled': False, 'status': 'EXPERIMENTAL', 'numericTextUsedAsFeature': False,
              'metrics': {role: {name: state_metrics([r for r in rows if r['role'] == role], [d for r, d in zip(rows, values) if r['role'] == role])
                                for name, values in decisions.items()} for role in ['new_provisional', 'historical_test']},
              'rows': [{**r, 'decisions': {name: bool(values[i]) for name, values in decisions.items()}} for i, r in enumerate(rows)]}
    (a.output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'choices': choices, 'metrics': report['metrics']}))


if __name__ == '__main__': main()
