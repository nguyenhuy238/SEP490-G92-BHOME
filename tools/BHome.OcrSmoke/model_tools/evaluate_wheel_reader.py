"""Offline public-fixture probe of oleost/visionstate-wheel-reader, never a cloud API.

Model preprocessing and mechanical-position interpretation follow VisionState
common.py@ee48ef0d6c64c5b87c7433e1f07c638c744b3650 (Apache-2.0).
See VisionState-LICENSE.txt. The dynamic program is reimplemented here; no history,
monotonicity assumption, ground-truth digit count or automatic carry correction is
taken from BHOME billing data.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import numpy as np
import onnxruntime as ort
from PIL import Image, ImageOps

parser = argparse.ArgumentParser()
parser.add_argument("model", type=Path)
parser.add_argument("audit_directory", type=Path)
parser.add_argument("report", type=Path)
args = parser.parse_args()
expected_hash = "37912f885b061a7b12298872fbdfa1b73ca0664363b293a55617b1d3680a98ac"
if hashlib.sha256(args.model.read_bytes()).hexdigest() != expected_hash:
    raise ValueError("Unverified wheel model")
config = ort.SessionOptions()
config.intra_op_num_threads = 2
session = ort.InferenceSession(str(args.model), sess_options=config, providers=["CPUExecutionProvider"])
if session.get_inputs()[0].shape[1:] != [1, 48, 32] or session.get_outputs()[0].shape[1:] != [100]:
    raise ValueError("Unsupported wheel tensor contract")

def read(cells):
    tensor = []
    for path in cells:
        with Image.open(path) as cell:
            gray = Image.fromarray(np.asarray(cell.convert("RGB")).min(axis=2))
            resized = gray.resize((32, 48), Image.Resampling.BILINEAR)
            tensor.append(np.asarray(ImageOps.autocontrast(resized, cutoff=1), dtype=np.float32)[None] / 255)
    logits = session.run(None, {"cells": np.stack(tensor)})[0]
    logp = logits - np.logaddexp.reduce(logits, axis=1, keepdims=True)
    scores = logp[-1].copy()
    parents = []
    # State is the observed 0.1-position bin of the wheel to the right.
    for wheel in range(len(cells) - 2, -1, -1):
        next_scores = np.full(100, -np.inf)
        links = np.zeros(100, dtype=np.int64)
        for right in range(100):
            fraction = max(0, right - 90)
            for digit in range(10):
                current = digit * 10 + fraction
                candidate = scores[right] + logp[wheel, current]
                if candidate > next_scores[current]:
                    next_scores[current], links[current] = candidate, right
        parents.append(links)
        scores = next_scores
    position = int(np.argmax(scores))
    positions = [position]
    for links in reversed(parents):
        position = int(links[position])
        positions.append(position)
    text = "".join(str(p // 10) for p in positions)
    # This diagnostic confidence is probability mass of each decoded digit,
    # independent of author-published confidence/temporal rules.
    probabilities = np.exp(logp).reshape(len(cells), 10, 10).sum(axis=2)
    confidence = min(float(probabilities[i, int(d)]) for i, d in enumerate(text))
    return text, confidence

rows = []
for row in json.loads((args.audit_directory / "audit-public-only.json").read_text())["rows"]:
    value, confidence = None, None
    if 3 <= len(row["cells"]) <= 12:
        value, confidence = read([args.audit_directory / p for p in row["cells"]])
    rows.append({"file": row["file"], "clear": row["clear"], "sceneAllowed": row["sceneAllowed"],
        "stage2Available": row["stage2Value"] is not None, "wheelAvailable": value is not None,
        "wheelExact": row["clear"] and value == row["expected"],
        "wheelFalse": row["clear"] and value is not None and value != row["expected"],
        "agreement": value is not None and value == row["stage2Value"],
        "agreementExact": row["clear"] and value is not None and value == row["stage2Value"] == row["expected"],
        "agreementFalse": row["clear"] and value is not None and value == row["stage2Value"] and value != row["expected"],
        "wheelConfidence": confidence})
summary = {"images": len(rows), "fullyLabeled": sum(r["clear"] for r in rows),
    **{k: sum(r[k] for r in rows) for k in ("wheelAvailable", "wheelExact", "wheelFalse", "agreement", "agreementExact", "agreementFalse")}}
args.report.write_text(json.dumps({"modelSha256": expected_hash, "summary": summary, "rows": rows,
    "limitation": "Stage2-based cell geometry, author public water data. No representative independent test, no four-type classifier, no threshold calibration or production integration."}, indent=2) + "\n")
print(json.dumps(summary))
