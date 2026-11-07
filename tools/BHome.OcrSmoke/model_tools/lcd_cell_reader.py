"""Character CNN and image-derived segmentation, independent of expected counts."""
import cv2
import numpy as np
import torch
from torch import nn


class LcdCellCnn(nn.Module):
    def __init__(self):
        super().__init__()
        self.net = nn.Sequential(nn.Conv2d(1, 16, 3, padding=1), nn.ReLU(), nn.MaxPool2d(2),
            nn.Conv2d(16, 32, 3, padding=1), nn.ReLU(), nn.MaxPool2d(2),
            nn.Conv2d(32, 64, 3, padding=1), nn.ReLU(), nn.AdaptiveAvgPool2d((3, 2)),
            nn.Flatten(), nn.Linear(384, 64), nn.ReLU(), nn.Linear(64, 10))

    def forward(self, images):
        return self.net(images)


def cell_tensor(bgr):
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    lo, hi = np.percentile(gray, [3, 97])
    normalized = np.clip((gray.astype(np.float32) - lo) / max(hi - lo, 1), 0, 1)
    return cv2.resize(normalized, (32, 48))[None]


def segment_cells(bgr):
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape
    if min(h, w) < 3: return []
    _, mask = cv2.threshold(cv2.GaussianBlur(gray, (3, 3), 0), 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    # Remove broad dark frames, never a narrow digit touching the crop edge.
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask)
    for label in range(1, count):
        x, y, cw, ch, area = stats[label]
        if cw > .9 * w or area > .6 * h * w:
            mask[labels == label] = 0
    active = (np.count_nonzero(mask, axis=0) >= max(1, round(.04 * h))).astype(np.uint8)[None]
    active = cv2.morphologyEx(active, cv2.MORPH_CLOSE, np.ones((1, max(1, round(.025 * h))), np.uint8))[0]
    transitions = np.diff(np.pad(active.astype(int), (1, 1)))
    starts = np.flatnonzero(transitions == 1); ends = np.flatnonzero(transitions == -1)
    boxes = []
    for x1, x2 in zip(starts, ends):
        ys = np.flatnonzero(np.any(mask[:, x1:x2], axis=1))
        if ys.size and ys[-1] - ys[0] + 1 >= .4 * h:
            boxes.append([int(x1), int(ys[0]), int(x2), int(ys[-1] + 1)])
    return boxes


def read_cells(model, bgr, device):
    boxes = segment_cells(bgr)
    if not 3 <= len(boxes) <= 12:
        return {'raw': '', 'digits': None, 'minimumCharacterScore': 0, 'cellBoxes': boxes, 'reason': 'segmentation_count_uncertain'}
    images = np.stack([cell_tensor(bgr[y1:y2, x1:x2]) for x1, y1, x2, y2 in boxes])
    with torch.inference_mode():
        probs = model(torch.from_numpy(images).to(device)).softmax(-1).cpu().numpy()
    text = ''.join(str(int(i)) for i in probs.argmax(-1))
    return {'raw': text, 'digits': text, 'minimumCharacterScore': float(probs.max(-1).min()), 'cellBoxes': boxes,
            'reason': 'experimental_image_segmentation_no_digit_count_or_register_prior'}
