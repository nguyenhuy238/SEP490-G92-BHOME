"""Offline official PARSeq autoregressive baseline; no application dependency.

Requires the reviewed Apache-2.0 source checkout and isolated timm0.9.16. Loads
only a state dictionary with weights_only=True, never a pickled model object.
"""
import hashlib
from pathlib import Path
import re
import subprocess
import sys
import time

import numpy as np
from PIL import Image
import torch

REVISION = '1902db043c029a7e03a3818c616c06600af574be'
WEIGHTS = 'bb5792a68e367476abca029cbf8699abc805f3d3dc7e57aae45c8ec4f7b7cd00'


class ParseqReader:
    def __init__(self, source, weights):
        source = Path(source)
        revision = subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip()
        dirty = subprocess.check_output(['git', '-C', str(source), 'status', '--porcelain'], text=True).strip()
        if revision != REVISION or dirty or hashlib.sha256(Path(weights).read_bytes()).hexdigest() != WEIGHTS:
            raise ValueError('PARSeq source or weights changed')
        sys.path.insert(0, str(source.resolve()))
        from strhub.models.parseq.model import PARSeq
        from strhub.data.utils import Tokenizer
        # Exact official base configuration and full training vocabulary. No
        # numeric-only vocabulary masks away wrong characters after inference.
        charset = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~'
        self.tokenizer = Tokenizer(charset)
        self.device = 'cuda' if torch.cuda.is_available() else 'cpu'
        self.model = PARSeq(len(self.tokenizer), 25, (32, 128), (4, 8), 384,
                            6, 4, 12, 12, 4, 1, True, 1, .1)
        self.model.load_state_dict(torch.load(weights, map_location='cpu', weights_only=True), strict=True)
        self.model = self.model.to(self.device).eval()

    def read(self, bgr):
        image = Image.fromarray(bgr[:, :, ::-1]).resize((128, 32), Image.Resampling.BICUBIC)
        tensor = torch.from_numpy(np.asarray(image, dtype=np.float32).transpose(2, 0, 1).copy())[None].to(self.device) / 127.5 - 1
        if self.device == 'cuda': torch.cuda.synchronize()
        started = time.perf_counter()
        with torch.inference_mode():
            probabilities = self.model(self.tokenizer, tensor).softmax(-1)
            texts, confidence = self.tokenizer.decode(probabilities)
        if self.device == 'cuda': torch.cuda.synchronize()
        raw = texts[0]
        values = confidence[0].cpu().tolist()
        return {'raw': raw, 'digits': re.sub('[.,]', '', raw) if re.fullmatch(r'[0-9]+(?:[.,][0-9]+)?', raw) else None,
                'minimumCharacterScore': min(values, default=0), 'meanCharacterScore': float(np.mean(values)) if values else 0,
                'forwardMs': (time.perf_counter() - started) * 1000}
