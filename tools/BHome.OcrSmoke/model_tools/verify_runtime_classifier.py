"""Prepare hash-bound OpenCV/Python ORT references for the real .NET parity test.

Run with the same installed packages as train_runtime_meter_heads.py. Output is
local ignored data, never a replacement constant ONNX graph.
"""
import argparse
import hashlib
import json
from pathlib import Path

import cv2
import numpy as np
import onnxruntime as ort
from PIL import Image
from train_runtime_meter_heads import runtime_pixels, VisualHeads, ExportModel, WEIGHTS_SHA


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['root', 'manifest', 'model', 'output']:
        parser.add_argument(name, type=Path)
    parser.add_argument('--clip', type=Path)
    parser.add_argument('--heads', type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    settings = ort.SessionOptions()
    settings.intra_op_num_threads = 2
    session = ort.InferenceSession(str(args.model), sess_options=settings, providers=['CPUExecutionProvider'])
    native = None
    if args.clip or args.heads:
        import torch
        from transformers import CLIPModel
        if not args.clip or not args.heads or hashlib.sha256((args.clip / 'pytorch_model.bin').read_bytes()).hexdigest() != WEIGHTS_SHA:
            raise ValueError('Both pinned CLIP and trained heads are required')
        torch.set_num_threads(2)
        heads = VisualHeads()
        heads.load_state_dict(torch.load(args.heads, map_location='cpu', weights_only=True))
        native = ExportModel(CLIPModel.from_pretrained(args.clip, local_files_only=True, attn_implementation='eager'), heads).eval()
    rows = []
    for sample in json.loads(args.manifest.read_text())['samples']:
        if sample['split'] != 'test':
            continue
        path = (args.root / sample['image']).resolve()
        if not path.is_relative_to(args.root.resolve()) or hashlib.sha256(path.read_bytes()).hexdigest() != sample['sha256']:
            raise ValueError('Frozen public input changed')
        # Match native decoder in ASP.NET, avoiding PIL vs OpenCV JPEG rounding.
        decoded = cv2.imread(str(path), cv2.IMREAD_COLOR)
        tensor = runtime_pixels(Image.fromarray(decoded[:, :, ::-1]))[None]
        tensor.tofile(args.output / (sample['id'] + '.f32'))
        logits = session.run(['utility_logits', 'technology_logits'], {'pixel_values': tensor})
        native_delta = None
        if native is not None:
            with torch.inference_mode():
                expected = native(torch.from_numpy(tensor))
            native_delta = max(float(np.abs(a - b.numpy()).max()) for a,b in zip(logits,expected))
            if native_delta > 1e-3:
                raise ValueError('Real native/ONNX logits diverge')
        rows.append({'id': sample['id'], 'image': sample['image'], 'sha256': sample['sha256'],
                     'tensor': sample['id'] + '.f32', 'logits': [x.ravel().tolist() for x in logits], 'nativeMaxLogitDelta': native_delta})
    (args.output / 'references.json').write_text(json.dumps({
        'modelSha256': hashlib.sha256(args.model.read_bytes()).hexdigest(), 'samples': rows}, indent=2) + '\n')


if __name__ == '__main__':
    main()
