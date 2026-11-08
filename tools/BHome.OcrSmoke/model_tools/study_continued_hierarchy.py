"""New provisional split: physical prompts, full-image TTA and few-shot CLIP.

Never reads historical test images. Selection is serialized before new held-out
inference; all outputs are offline diagnostics without billing authorization.
"""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import sys
import time

import numpy as np
from PIL import Image, ImageOps
import torch
from transformers import CLIPModel, CLIPProcessor

sys.path.insert(0, str(Path(__file__).resolve().parent))
from study_meter_hierarchy import prototypes, UTILITY_PROMPTS, TECHNOLOGY_PROMPTS, WEIGHTS_SHA
from meter_hierarchy_policy import hierarchy_decision
from prepare_continued_classification import assert_isolation

UTILITY = [
    ['a photograph of a utility electricity meter measuring kilowatt hours',
     'an electrical energy meter in a switchboard or an electric meter box'],
    ['a photograph of a utility water volume meter connected to plumbing pipes',
     'a water consumption meter with a round brass or plastic housing and inlet and outlet pipes'],
    ['a photograph without a visible electricity or water consumption meter',
     'a closed lid, plumbing valve, bottle, sign or industrial timer instead of a visible utility consumption meter'],
]
TECHNOLOGY = [
    ['a mechanical counter with rotating number wheels like an odometer',
     'a utility meter showing white printed digits on black rotating drums and a red last wheel',
     'an analog utility meter with circular pointer dials or mechanical digit wheels'],
    ['a utility meter showing electronic seven segment numbers on a liquid crystal LCD screen',
     'a digital meter with an electronic LCD or LED numeric display',
     'an electronic utility meter with a rectangular screen with seven segment numerals'],
]
U = ['electricity', 'water', 'not_meter']
T = ['mechanical', 'digital']
METHODS = ['frozen_hierarchy', 'physical_prompts', 'letterbox_physical', 'tta_physical',
           'fewshot_025', 'fewshot_050', 'fewshot_075']


def metrics(rows, setting):
    counts = Counter(inputs=len(rows), positiveMeters=sum(r['expected'] != 'not_meter' for r in rows),
                     correctlyAccepted=0, incorrectlyAccepted=0, unknown=0, negativeFalseAccepted=0)
    confusion = Counter()
    for row in rows:
        pred = hierarchy_decision(row['utility'], row['technology'], *setting) if setting else 'unknown'
        counts.update(correctlyAccepted=pred == row['expected'], incorrectlyAccepted=pred != 'unknown' and pred != row['expected'],
                      unknown=pred == 'unknown', negativeFalseAccepted=row['expected'] == 'not_meter' and pred != 'unknown')
        confusion[row['expected'] + '->' + pred] += 1
    accepted = counts['inputs'] - counts['unknown']
    per = {}
    for name in [u + '_' + t for u in U[:2] for t in T]:
        n = sum(r['expected'] == name for r in rows)
        tp = confusion[name + '->' + name]
        fp = sum(v for k, v in confusion.items() if k.endswith('->' + name) and not k.startswith(name + '->'))
        per[name] = {'inputs': n, 'correct': tp, 'recall': tp / n if n else None, 'acceptedPrecision': tp / (tp + fp) if tp + fp else None}
    return {'counts': dict(counts), 'acceptedPrecision': counts['correctlyAccepted'] / accepted if accepted else None,
            'confusion': dict(confusion), 'perClass': per,
            'p95PipelineMs': float(np.percentile([r['pipelineMs'] for r in rows], 95)) if rows else None}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for name in ['clip', 'manifest', 'root', 'output']:
        p.add_argument(name, type=Path)
    a = p.parse_args()
    if a.output.exists():
        raise ValueError('Use a fresh experiment directory')
    a.output.mkdir(parents=True)
    if hashlib.sha256((a.clip / 'pytorch_model.bin').read_bytes()).hexdigest() != WEIGHTS_SHA:
        raise ValueError('Pinned model changed')
    data = json.loads(a.manifest.read_text(encoding='utf-8'))
    assert_isolation([{**s, 'split': s['split'].replace('multiple_meter_challenge', 'test')} for s in data['samples']])
    torch.set_num_threads(2)
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    model = CLIPModel.from_pretrained(a.clip, local_files_only=True).to(device).eval()
    processor = CLIPProcessor.from_pretrained(a.clip, local_files_only=True)
    old = [prototypes(model, processor, prompts, device) for prompts in [UTILITY_PROMPTS, TECHNOLOGY_PROMPTS]]
    physical = [prototypes(model, processor, prompts, device) for prompts in [UTILITY, TECHNOLOGY]]
    cache = {}

    def encode(sample, view):
        key = (sample['id'], view)
        if key in cache:
            return cache[key]
        path = (a.root / sample['image']).resolve()
        if not path.is_relative_to(a.root.resolve()) or hashlib.sha256(path.read_bytes()).hexdigest() != sample['sha256']:
            raise ValueError('Frozen input changed')
        with Image.open(path) as source:
            image = ImageOps.exif_transpose(source).convert('RGB')
        if device == 'cuda': torch.cuda.synchronize()
        started = time.perf_counter()
        views = [image]
        if view != 'center':
            color = tuple(round(x * 255) for x in processor.image_processor.image_mean)
            views = [image.rotate(angle, resample=Image.Resampling.BICUBIC, expand=True, fillcolor=color)
                     for angle in ([-7, 0, 7] if view == 'tta' else [0])]
            views = [ImageOps.pad(v, (224, 224), method=Image.Resampling.BICUBIC, color=color) for v in views]
        pixels = processor(images=views, return_tensors='pt')['pixel_values'].to(device)
        with torch.no_grad():
            vector = model.get_image_features(pixels)
            vector /= vector.norm(dim=-1, keepdim=True)
            vector = vector.mean(0)
            vector /= vector.norm()
        if device == 'cuda': torch.cuda.synchronize()
        result = (vector, (time.perf_counter() - started) * 1000)
        cache[key] = result
        return result

    train = [s for s in data['samples'] if s['split'] == 'train']
    centroids = []
    for labels in [U, T]:
        vectors = []
        for label in labels:
            subset = [s for s in train if (s['category'] == 'not_meter' and label == 'not_meter') or
                      (s['category'] != 'not_meter' and label in s['category'].split('_'))]
            mean = torch.stack([encode(s, 'pad')[0] for s in subset]).mean(0)
            vectors.append(mean / mean.norm())
        centroids.append(torch.stack(vectors))
    np.savez(a.output / 'fewshot-prototypes.npz', utility=centroids[0].cpu().numpy(), technology=centroids[1].cpu().numpy())
    rows = []
    selected = {}
    grid = {}
    winner = None
    for split in ['validation', 'test', 'multiple_meter_challenge']:
        for sample in [s for s in data['samples'] if s['split'] == split]:
            for method in METHODS:
                view = 'center' if method in ['frozen_hierarchy', 'physical_prompts'] else 'tta' if method == 'tta_physical' else 'pad'
                vector, elapsed = encode(sample, view)
                heads = old if method == 'frozen_hierarchy' else physical
                if method.startswith('fewshot'):
                    alpha = int(method[-3:]) / 100
                    heads = [(1 - alpha) * text + alpha * visual for text, visual in zip(physical, centroids)]
                    heads = [head / head.norm(dim=-1, keepdim=True) for head in heads]
                with torch.no_grad():
                    scores = [(model.logit_scale.exp() * vector @ head.T).softmax(-1).cpu().tolist() for head in heads]
                rows.append({'id': sample['id'], 'expected': sample['category'], 'split': split, 'method': method,
                             'utility': dict(zip(U, scores[0])), 'technology': dict(zip(T, scores[1])), 'pipelineMs': elapsed,
                             'isProductIllustration': sample.get('isProductIllustration', False)})
        if split == 'validation':
            for method in METHODS:
                val = [r for r in rows if r['method'] == method]
                candidates = []
                for u in [.65, .75, .85, .9, .95]:
                    for t in [.55, .65, .75, .85, .95]:
                        setting = (u, t)
                        m = metrics(val, setting)
                        grid[method + ':' + str(setting)] = m['counts']
                        if m['counts']['incorrectlyAccepted'] == 0 and m['counts']['correctlyAccepted'] > 0:
                            candidates.append((m['counts']['correctlyAccepted'], min(setting), sum(setting), setting))
                selected[method] = (.85, .65) if method == 'frozen_hierarchy' else max(candidates)[-1] if candidates else None
            eligible = [(metrics([r for r in rows if r['method'] == method], selected[method])['counts']['correctlyAccepted'], method)
                        for method in METHODS if selected[method] is not None and
                        metrics([r for r in rows if r['method'] == method], selected[method])['counts']['incorrectlyAccepted'] == 0]
            winner = max(eligible)[1] if eligible else None
            selection = {'selectedOnNewValidation': selected, 'winner': winner,
                         'manifestSha256': hashlib.sha256(a.manifest.read_bytes()).hexdigest(),
                         'utilityPrompts': UTILITY, 'technologyPrompts': TECHNOLOGY}
            (a.output / 'selection-before-test.json').write_text(json.dumps(selection, indent=2) + '\n')
    report = {'scope': data['scope'], 'modelSha256': WEIGHTS_SHA, 'runtimeEnabled': False, 'status': 'EXPERIMENTAL',
              'selection': selection, 'selectionSha256': hashlib.sha256((a.output / 'selection-before-test.json').read_bytes()).hexdigest(),
              'humanReviewsReceived': 0, 'historicalTestInference': False, 'prototypeTrainingSamples': len(train),
              'validationGrid': grid, 'metrics': {split: {method: metrics([r for r in rows if r['split'] == split and r['method'] == method], selected[method])
                    for method in METHODS} for split in ['validation', 'test']},
              'multipleMeterBehavior': 'Unsupported: whole-image classifier has no counting/localization evidence; raw scores only',
              'hardware': device, 'rows': rows}
    (a.output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'selection': selected, 'winner': winner, 'heldOut': report['metrics']['test']}))


if __name__ == '__main__':
    main()
