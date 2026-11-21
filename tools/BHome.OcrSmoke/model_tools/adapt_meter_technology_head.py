"""One technology-only adaptation using additional licensed LCD appearances.

Utility head and CLIP remain frozen. No OCR labels, oracle regions, thresholds
chosen on test, or default runtime activation. Preview source is TRAIN only.
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps
import torch
from torch import nn
from transformers import CLIPModel
import onnx
import onnxruntime as ort

from train_runtime_meter_heads import VisualHeads, ExportModel, runtime_pixels, metrics
from study_meter_hierarchy import WEIGHTS_SHA


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['clip', 'baseline', 'base_manifest', 'additions', 'evaluation', 'fresh', 'root', 'output']:
        parser.add_argument(name, type=Path)
    a = parser.parse_args()
    if a.output.exists():
        raise ValueError('Use a fresh experiment directory')
    a.output.mkdir(parents=True)
    if hashlib.sha256((a.clip/'pytorch_model.bin').read_bytes()).hexdigest() != WEIGHTS_SHA:
        raise ValueError('Changed CLIP weights')
    base = json.loads(a.base_manifest.read_text(encoding='utf-8-sig'))['samples']
    extra = json.loads(a.additions.read_text(encoding='utf-8-sig'))['samples']
    train = [s for s in base if s['split'] == 'train' and s['category'] != 'not_meter']
    evaluation = json.loads(a.evaluation.read_text(encoding='utf-8-sig'))['samples']
    evaluation += json.loads(a.fresh.read_text(encoding='utf-8-sig'))['samples']
    for sample in evaluation:
        sample.setdefault('cohort', 'fresh_source_provisional')
    if {s['sha256'] for s in train+extra} & {s['sha256'] for s in evaluation}:
        raise ValueError('Training/evaluation duplicate')
    if {s['sourceGroup'] for s in train+extra} & {s['sourceGroup'] for s in evaluation}:
        raise ValueError('Training/evaluation source overlap')
    torch.manual_seed(41)
    torch.set_num_threads(2)
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    clip = CLIPModel.from_pretrained(a.clip, local_files_only=True, attn_implementation='eager').to(device).eval()
    heads = VisualHeads().to(device)
    heads.load_state_dict(torch.load(a.baseline/'heads.pt', map_location=device, weights_only=True))
    heads.utility.requires_grad_(False)
    before_utility = {k: v.detach().clone() for k, v in heads.utility.state_dict().items()}

    def pixels(sample):
        path = (a.root/sample['image']).resolve()
        if not path.is_relative_to(a.root.resolve()) or hashlib.sha256(path.read_bytes()).hexdigest() != sample['sha256']:
            raise ValueError('Changed training/evaluation pixels')
        with Image.open(path) as image:
            return runtime_pixels(ImageOps.exif_transpose(image).convert('RGB'))[None]

    features, targets = [], []
    for sample in train+extra:
        tensor = torch.from_numpy(pixels(sample)).to(device)
        with torch.inference_mode():
            vector = clip.get_image_features(tensor)
            vector /= vector.norm(dim=-1, keepdim=True)
        features.append(vector.detach().clone())
        technology = sample.get('technology', sample.get('category', '').split('_')[-1])
        targets.append(['mechanical', 'digital'].index(technology))
    x = torch.cat(features)
    y = torch.tensor(targets, device=device)
    weights = len(y)/(2*torch.bincount(y).float())
    optimizer = torch.optim.AdamW(heads.technology.parameters(), lr=.01, weight_decay=.1)
    for _ in range(50):
        loss = nn.functional.cross_entropy(heads.technology(x), y, weight=weights)
        optimizer.zero_grad()
        loss.backward()
        optimizer.step()
    assert all(torch.equal(v, heads.utility.state_dict()[k]) for k, v in before_utility.items())
    heads.eval()
    torch.save(heads.state_dict(), a.output/'heads.pt')
    exported = ExportModel(clip.cpu(), heads.cpu()).eval()
    example = torch.from_numpy(pixels(evaluation[0]))
    torch.onnx.export(exported, (example,), str(a.output/'classifier.onnx'), opset_version=17,
                      input_names=['pixel_values'], output_names=['utility_logits', 'technology_logits'], dynamo=False)
    graph = onnx.load(str(a.output/'classifier.onnx'))
    onnx.helper.set_model_props(graph, {'bhome.utility_classes': 'electricity,water,not_meter',
        'bhome.technology_classes': 'mechanical,digital', 'bhome.preprocessing': 'rgb-cubic-letterbox224-clip-v1',
        'bhome.base_sha256': WEIGHTS_SHA})
    onnx.save(graph, str(a.output/'classifier.onnx'))
    settings = ort.SessionOptions()
    settings.intra_op_num_threads = 2
    settings.inter_op_num_threads = 1
    models = {name: ort.InferenceSession(str(path/'classifier.onnx'), sess_options=settings,
              providers=['CPUExecutionProvider']) for name, path in [('baseline', a.baseline), ('candidate', a.output)]}
    rows, parity = [], []
    for sample in evaluation:
        tensor = pixels(sample)
        for name, model in models.items():
            logits = model.run(None, {'pixel_values': tensor})
            probabilities = [torch.from_numpy(v).softmax(-1)[0].tolist() for v in logits]
            rows.append({'mode': name, 'id': sample['id'], 'cohort': sample['cohort'], 'expected': sample['category'],
                         'utility': dict(zip(['electricity', 'water', 'not_meter'], probabilities[0])),
                         'technology': dict(zip(['mechanical', 'digital'], probabilities[1]))})
            if name == 'candidate' and sample['cohort'] == 'historical_test':
                with torch.no_grad():
                    reference = exported(torch.from_numpy(tensor))
                delta = max(float(np.max(np.abs(v.numpy()-w))) for v, w in zip(reference, logits))
                if delta > 1e-3:
                    raise ValueError('Native/ONNX parity failed')
                parity.append({'id': sample['id'], 'maxLogitDelta': delta})
    summary = {c: {mode: metrics([r for r in rows if r['mode'] == mode and r['cohort'] == c], [.55, .75])
                    for mode in models} for c in sorted({r['cohort'] for r in rows})}
    receipt = {'scope': 'noncommercial_offline_provisional_no_promotion', 'utilityHeadUnchanged': True,
               'epochs': 50, 'oldTechnologyTrainingImages': len(train), 'additionalLcdFrames': len(extra),
               'uniquePhysicalDevices': None, 'thresholds': [.55, .75],
               'modelSha256': hashlib.sha256((a.output/'classifier.onnx').read_bytes()).hexdigest(),
               'trainingManifestSha256': hashlib.sha256(a.additions.read_bytes()).hexdigest(),
               'evaluationManifestSha256': hashlib.sha256(a.evaluation.read_bytes()).hexdigest(),
               'freshManifestSha256': hashlib.sha256(a.fresh.read_bytes()).hexdigest(),
               'summary': summary, 'rows': rows, 'parity': parity}
    (a.output/'report.json').write_text(json.dumps(receipt, indent=2)+'\n', encoding='utf-8')
    print(json.dumps(summary))


if __name__ == '__main__':
    main()
