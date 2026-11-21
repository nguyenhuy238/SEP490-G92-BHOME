"""Research-only image-evidence classification baseline; never a meter detector.

Fixed prompts are frozen before inference. Select a reject threshold on existing
development validation, then read historical test labels. CLIP gives neither body
boxes nor meter counts; no mAP, detector integration or independent acceptance.
"""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import time

import numpy as np
from PIL import Image, ImageOps
import torch
from transformers import CLIPModel, CLIPProcessor

CLASSES = ['electricity_mechanical', 'electricity_digital', 'water_mechanical', 'water_digital', 'not_meter']
PROMPTS = [
    ['a photograph of a mechanical electricity meter with rotating number wheels and an aluminum disc',
     'an analog electric kilowatt hour meter with a mechanical number counter'],
    ['a photograph of a digital electricity meter with an LCD screen showing kilowatt hours',
     'an electronic electric power utility meter with a digital numeric display'],
    ['a photograph of a mechanical water meter with a number wheel counter and small round dials',
     'an analog water consumption meter with rotating digits and pointer dials'],
    ['a photograph of an ultrasonic digital water meter with an LCD numeric screen',
     'an electronic water consumption meter showing cubic meters on a digital display'],
    ['a photograph of a room without a utility meter', 'a photograph of an identity document',
     'a photograph of an ordinary object that is not an electricity or water meter'],
]
WEIGHTS_SHA = 'a63082132ba4f97a80bea76823f544493bffa8082296d62d71581a4feff1576f'


def summarize(rows, threshold):
    counts = Counter(); confusion = {}; per_class = {c: Counter() for c in CLASSES[:4]}
    for row in rows:
        expected = row['category']; accepted = row['prediction'] if row['score'] >= threshold and row['margin'] >= .1 and row['prediction'] != 'not_meter' else 'unknown'
        counts.update(inputs=1, meters=expected != 'not_meter', correctAccepted=accepted == expected,
                      incorrectAccepted=accepted != 'unknown' and accepted != expected, unknown=accepted == 'unknown',
                      openSetFalseAccepted=expected == 'not_meter' and accepted != 'unknown')
        key = expected+'->'+accepted; confusion[key] = confusion.get(key, 0)+1
        for cls, metric in per_class.items():
            metric.update(tp=accepted == cls and expected == cls, fp=accepted == cls and expected != cls,
                          fn=expected == cls and accepted != cls)
    for metric in per_class.values():
        metric['recall'] = metric['tp']/(metric['tp']+metric['fn']) if metric['tp']+metric['fn'] else None
        metric['precision'] = metric['tp']/(metric['tp']+metric['fp']) if metric['tp']+metric['fp'] else None
    return {'counts': counts, 'confusion': confusion, 'perClass': per_class}


def main():
    p = argparse.ArgumentParser(description=__doc__); p.add_argument('model', type=Path)
    p.add_argument('manifest', type=Path); p.add_argument('root', type=Path); p.add_argument('output', type=Path)
    a = p.parse_args()
    if hashlib.sha256((a.model/'pytorch_model.bin').read_bytes()).hexdigest() != WEIGHTS_SHA:
        raise ValueError('Official CLIP weights checksum mismatch')
    receipt = json.loads((a.model/'provenance.json').read_text())
    if receipt['revision'] != '3d74acf9a28c67741b2f4f2ea7635f0aaf6f0268': raise ValueError('Unpinned model revision')
    for name, asset in receipt['files'].items():
        if Path(name).name != name or hashlib.sha256((a.model/name).read_bytes()).hexdigest() != asset['sha256']:
            raise ValueError('CLIP model/tokenizer configuration changed')
    torch.set_num_threads(2); device = 'cuda' if torch.cuda.is_available() else 'cpu'
    model = CLIPModel.from_pretrained(a.model, local_files_only=True).to(device).eval()
    processor = CLIPProcessor.from_pretrained(a.model, local_files_only=True)
    prompts = [text for group in PROMPTS for text in group]
    text_input = processor(text=prompts, return_tensors='pt', padding=True)
    with torch.no_grad():
        text = model.get_text_features(**{k:v.to(device) for k,v in text_input.items()}); text /= text.norm(dim=-1, keepdim=True)
        prototypes = []; offset = 0
        for group in PROMPTS:
            prototype = text[offset:offset+len(group)].mean(0); prototypes.append(prototype/prototype.norm()); offset += len(group)
        prototypes = torch.stack(prototypes)
    data = json.loads(a.manifest.read_text(encoding='utf-8')); rows = []
    for sample in data['samples']:
        path = (a.root/sample['image']).resolve()
        if not path.is_relative_to(a.root.resolve()) or hashlib.sha256(path.read_bytes()).hexdigest() != sample['sha256']:
            raise ValueError('Frozen public classification image changed')
        with Image.open(path) as original: image = ImageOps.exif_transpose(original).convert('RGB')
        pixels = processor(images=image, return_tensors='pt')['pixel_values'].to(device)
        if device == 'cuda': torch.cuda.synchronize()
        started = time.perf_counter()
        with torch.no_grad():
            features = model.get_image_features(pixels); features /= features.norm(dim=-1, keepdim=True)
            probabilities = (model.logit_scale.exp()*features@prototypes.T).softmax(-1)[0].cpu().numpy()
        if device == 'cuda': torch.cuda.synchronize()
        order = probabilities.argsort()[::-1]; predicted = int(order[0])
        rows.append({'id': sample['id'], 'sha256': sample['sha256'], 'split': sample['split'], 'category': sample['category'],
                     'prediction': CLASSES[predicted], 'score': float(probabilities[predicted]),
                     'margin': float(probabilities[order[0]]-probabilities[order[1]]),
                     'scores': {cls:float(score) for cls, score in zip(CLASSES, probabilities)},
                     'forwardMs': (time.perf_counter()-started)*1000})
    validation = [r for r in rows if r['split'] == 'validation']
    grid = {str(t):summarize(validation, t) for t in (.35, .5, .65, .75, .85, .9, .95)}
    eligible = [float(t) for t, result in grid.items() if result['counts']['incorrectAccepted'] == 0 and result['counts']['correctAccepted'] > 0]
    threshold = max(eligible, key=lambda t:(grid[str(t)]['counts']['correctAccepted'], t)) if eligible else None
    # No test-based threshold adjustment; if validation fails, .9 is descriptive only.
    test = [r for r in rows if r['split'] == 'test']; observed = threshold if threshold is not None else .9
    result = {'scope': 'zero_shot_whole_image_research_not_detection', 'prompts': PROMPTS, 'classes': CLASSES,
              'modelRevision': receipt['revision'], 'modelSha256': WEIGHTS_SHA,
              'manifestSha256': hashlib.sha256(a.manifest.read_bytes()).hexdigest(), 'validationGrid': grid,
              'selectedThreshold': threshold, 'testThreshold': observed, 'test': summarize(test, observed),
              'testRawTop1Correct': sum(r['category'] == r['prediction'] for r in test), 'testInputs': len(test),
              'p95ForwardMs': float(np.percentile([r['forwardMs'] for r in rows], 95)),
              'limitations': ['Not a detector: no boxes, counts or mAP', 'Historical agent-reviewed data; pretraining overlap unknown',
                              'No independent human acceptance or activation'], 'runtimeEnabled': False, 'rows': rows}
    a.output.write_text(json.dumps(result, indent=2)+'\n'); print(json.dumps({k:v for k,v in result.items() if k not in ['rows','validationGrid','prompts']}))


if __name__ == '__main__': main()
