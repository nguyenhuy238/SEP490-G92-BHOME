"""Train a small LCD CRNN/CTC on frozen publisher labels, export and test once.

All source groups were split before augmentation. This is a research candidate,
not billing OCR: Commons labels are agent-reviewed, precision/register incomplete.
No synthetic digits, provisional Kaggle numeric labels or historical water tests
enter training. No application registration or threshold selection on test.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import random
import time

import cv2
import numpy as np
import onnxruntime as ort
import torch
from torch import nn


class LcdCrnn(nn.Module):
    def __init__(self):
        super().__init__()
        blocks = []; previous = 1
        for index, channels in enumerate((64, 128, 256, 256)):
            blocks += [nn.Conv2d(previous, channels, 3, padding=1), nn.BatchNorm2d(channels), nn.ReLU(),
                       nn.MaxPool2d(2 if index < 2 else (2, 1))]
            previous = channels
        self.cnn = nn.Sequential(*blocks)
        self.sequence = nn.LSTM(256, 128, 2, bidirectional=True, dropout=.1)
        self.characters = nn.Linear(256, 11)

    def forward(self, image):
        features = self.cnn(image).mean(2).permute(2, 0, 1)
        sequence, _ = self.sequence(features)
        return self.characters(sequence)


def tensor_image(image, augment=False):
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    if augment:
        center = (gray.shape[1]/2, gray.shape[0]/2)
        matrix = cv2.getRotationMatrix2D(center, random.uniform(-4, 4), 1)
        gray = cv2.warpAffine(gray, matrix, (gray.shape[1], gray.shape[0]), borderMode=cv2.BORDER_REPLICATE)
        gray = np.clip(gray.astype(np.float32)*random.uniform(.75, 1.25)+random.uniform(-15, 15), 0, 255).astype(np.uint8)
    width = min(320, max(1, math.ceil(48*gray.shape[1]/gray.shape[0])))
    result = np.zeros((1, 48, 320), np.float32)
    result[0, :, :width] = cv2.resize(gray, (width, 48))/127.5-1
    return result


def decode(logits):
    ids = logits.argmax(2).T; output = []
    for row in ids:
        previous = 0; text = []
        for index in row:
            if index and index != previous: text.append(str(int(index)-1))
            previous = index
        output.append(''.join(text))
    return output


def distance(a, b):
    row = list(range(len(b)+1))
    for i, first in enumerate(a, 1):
        current = [i]
        for j, second in enumerate(b, 1):
            current.append(min(current[-1]+1, row[j]+1, row[j-1]+(first != second)))
        row = current
    return row[-1]


def main():
    p = argparse.ArgumentParser(description=__doc__); p.add_argument('dataset', type=Path); p.add_argument('output', type=Path)
    p.add_argument('--epochs', type=int, default=200); a = p.parse_args()
    if not 100 <= a.epochs <= 300: raise ValueError('Bounded training budget required')
    if a.output.exists(): raise ValueError('Do not overwrite a candidate run')
    if not torch.cuda.is_available(): raise ValueError('This bounded experiment requires the available CUDA device')
    audit_path = a.dataset/'audit.json'; audit = json.loads(audit_path.read_text())
    if hashlib.sha256(audit_path.read_bytes()).hexdigest()!='73ef4741ab0548a21077860d55bf6e8313c6cf5f1d598bdb30fc0dc76355cb62':
        raise ValueError('Frozen CC0 LCD experiment audit changed')
    if audit.get('task') != 'lcd_digit_detection' or not audit.get('trainingOnlyRowCrops'):
        raise ValueError('Frozen LCD row dataset required')
    rows = audit['samples']; loaded = []
    for row in rows:
        image = a.dataset/row['image']
        if not image.resolve().is_relative_to(a.dataset.resolve()) or hashlib.sha256(image.read_bytes()).hexdigest() != row['sha256']:
            raise ValueError('Frozen crop hash/path mismatch')
        if row['split'] == 'train' and (not row.get('sourceDigits', '').isdigit() or row.get('license') != 'CC0-1.0'):
            raise ValueError('Only publisher-labeled CC0 train rows are admitted')
        loaded.append((row, cv2.imread(str(image))))
    train = [(r, im) for r, im in loaded if r['split'] == 'train']
    validation = [(r, im) for r, im in loaded if r['split'] == 'val']
    if len(train) != 163 or len(validation) != 2: raise ValueError('Unexpected frozen experiment counts')
    random.seed(42); np.random.seed(42); torch.manual_seed(42); torch.set_num_threads(2)
    torch.backends.cudnn.deterministic = True; torch.backends.cudnn.benchmark = False
    a.output.mkdir(parents=True); model = LcdCrnn().cuda(); optimizer = torch.optim.AdamW(model.parameters(), lr=.001, weight_decay=.0001)
    criterion = nn.CTCLoss(blank=0, zero_infinity=True)
    history = []; best = float('inf'); selected = None; started = time.perf_counter()
    for epoch in range(1, a.epochs+1):
        model.train(); indices = list(range(len(train))); random.shuffle(indices); total = 0
        for offset in range(0, len(indices), 16):
            batch = [train[i] for i in indices[offset:offset+16]]
            images = torch.from_numpy(np.stack([tensor_image(im, True) for _, im in batch])).cuda()
            texts = [r['sourceDigits'] for r, _ in batch]
            target = torch.tensor([int(c)+1 for text in texts for c in text], dtype=torch.long).cuda()
            lengths = torch.tensor([len(text) for text in texts], dtype=torch.long)
            logits = model(images); log_probs = logits.log_softmax(2)
            loss = criterion(log_probs, target, torch.full((len(batch),), logits.shape[0], dtype=torch.long), lengths)
            optimizer.zero_grad(); loss.backward(); nn.utils.clip_grad_norm_(model.parameters(), 5); optimizer.step(); total += float(loss)
        if epoch % 5 == 0 or epoch == 1:
            model.eval()
            with torch.no_grad():
                prediction = decode(model(torch.from_numpy(np.stack([tensor_image(im) for _, im in validation])).cuda()).cpu().numpy())
            score = sum(distance(text, r['expectedDigits'] or '')/max(1, len(r['expectedDigits'] or '')) for text, (r, _) in zip(prediction, validation))
            item = {'epoch': epoch, 'meanTrainLoss': total/math.ceil(len(train)/16), 'validationEditDistance': score,
                    'validationRaw': prediction, 'elapsedSeconds': time.perf_counter()-started}
            history.append(item); print(json.dumps(item), flush=True)
            if score < best:
                best = score; selected = epoch; torch.save(model.state_dict(), a.output/'best.pt')
            if epoch >= 100 and epoch-selected >= 60: break
    (a.output/'history.json').write_text(json.dumps(history, indent=2)+'\n')
    model.load_state_dict(torch.load(a.output/'best.pt', weights_only=True)); model.cpu().eval()
    example = torch.zeros(1, 1, 48, 320)
    torch.onnx.export(model, example, str(a.output/'recognition.onnx'), input_names=['image'], output_names=['logits'], opset_version=17)
    settings = ort.SessionOptions(); settings.intra_op_num_threads = 2
    session = ort.InferenceSession(str(a.output/'recognition.onnx'), settings, providers=['CPUExecutionProvider'])
    evaluation = []
    # Test is inspected once only, after selecting the checkpoint on validation.
    for row, image in loaded:
        if row['split'] == 'train': continue
        tensor = tensor_image(image)[None]
        with torch.no_grad(): native = model(torch.from_numpy(tensor)).numpy()
        begin = time.perf_counter(); exported = session.run(None, {'image': tensor})[0]; elapsed = (time.perf_counter()-begin)*1000
        raw = decode(exported)[0]; expected = row['expectedDigits']
        evaluation.append({'id': row['id'], 'split': row['split'], 'expectedDigits': expected, 'raw': raw,
                           'exact': expected is not None and raw == expected, 'blankRejected': expected is None and raw == '',
                           'incorrectProposal': raw != '' and raw != expected, 'fallback': raw == '', 'forwardMs': elapsed,
                           'nativeOnnxSameText': decode(native)[0] == raw, 'maxLogitDelta': float(np.max(np.abs(native-exported)))})
    report = {'architecture': 'four CNN blocks + bidirectional LSTM128x2 +11-class CTC', 'seed': 42,
              'trainingRows': len(train), 'validationRows': len(validation), 'testRows': sum(r['split']=='test' for r in rows),
              'datasetAuditSha256': hashlib.sha256(audit_path.read_bytes()).hexdigest(), 'selectedEpoch': selected,
              'trainedEpochs': epoch, 'modelSha256': hashlib.sha256((a.output/'recognition.onnx').read_bytes()).hexdigest(),
              'independentHumanAcceptance': False, 'runtimeEnabled': False, 'hardware': torch.cuda.get_device_name(0),
              'torch': torch.__version__, 'elapsedSeconds': time.perf_counter()-started, 'rows': evaluation}
    (a.output/'report.json').write_text(json.dumps(report, indent=2)+'\n'); print(json.dumps(report), flush=True)


if __name__ == '__main__': main()
