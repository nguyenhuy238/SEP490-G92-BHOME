"""Validate reviewed annotations, audit leakage, export YOLO body detection data.

No download, augmentation or training. The full four-class dataset is required
unless --allow-partial-development is explicitly supplied. Unsupported examples
remain in the evaluation manifest as open-set controls, never fake negatives.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

import cv2
import numpy as np
from PIL import Image, ImageOps

CLASSES = ("electricity_mechanical", "electricity_digital", "water_mechanical", "water_digital")


def perceptual_hash(image):
    gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
    coefficients = cv2.dct(cv2.resize(gray, (32, 32)).astype(np.float32))[:8, :8].flatten()
    bits = coefficients[1:] > np.median(coefficients[1:])
    return sum(int(bit) << i for i, bit in enumerate(bits))


def audit_pairs(samples, hashes, distance=6):
    pairs = []
    for i, first in enumerate(samples):
        for second in samples[:i]:
            d = (hashes[first["id"]] ^ hashes[second["id"]]).bit_count()
            if d <= distance:
                pair = {"first": first["id"], "second": second["id"], "distance": d,
                        "crossSplit": first["split"] != second["split"]}
                pairs.append(pair)
                if pair["crossSplit"]:
                    raise ValueError("Perceptual cross-split candidate requires review: " + json.dumps(pair))
    return pairs


def prepare(manifest, image_root, output, allow_partial=False, node="node"):
    repo = Path(__file__).resolve().parents[3]
    subprocess.run([node, str(repo / "scripts/Validate-MeterDataset.cjs"),
                    str(manifest), str(image_root)], check=True, capture_output=True, text=True)
    data = json.loads(manifest.read_text(encoding="utf-8"))
    samples = data["samples"]
    names = [c for c in CLASSES if any(s["category"] == c and s["split"] == "train" for s in samples)]
    if not allow_partial and names != list(CLASSES):
        raise ValueError("All four classes need real train/validation samples; partial development must be explicit")
    for name in names:
        for split in ("train", "validation", "test"):
            if not any(s["category"] == name and s["split"] == split for s in samples):
                raise ValueError(f"Missing {split} evidence for {name}")
    if not names:
        raise ValueError("No supported meter class")
    images, hashes = {}, {}
    for sample in samples:
        if not all(sample.get(field) for field in ("sourceGroup", "captureGroup", "nearDuplicateGroup")):
            raise ValueError("Reviewed training groups required")
        if not sample.get("review", {}).get("method"):
            raise ValueError("Visual review record required")
        with Image.open(image_root / sample["image"]) as source:
            source.verify()
        with Image.open(image_root / sample["image"]) as source:
            if source.width * source.height > 30_000_000:
                raise ValueError("Oversized training input")
            image = ImageOps.exif_transpose(source).convert("RGB")
            images[sample["id"]] = image.copy()
            hashes[sample["id"]] = perceptual_hash(np.asarray(image))
    pairs = audit_pairs(samples, hashes)
    if output.exists() and any(output.iterdir()):
        raise ValueError("Output must be empty; never overwrite frozen datasets")
    output.mkdir(parents=True, exist_ok=True)
    evaluation = []
    counts = {}
    for sample in samples:
        category, split = sample["category"], sample["split"]
        split = "val" if split == "validation" else split
        unsupported = category not in names and category != "not_meter"
        folder = "open-set" if unsupported else "images/" + split
        target = output / folder / (sample["id"] + ".jpg")
        target.parent.mkdir(parents=True, exist_ok=True)
        images[sample["id"]].save(target, quality=95, subsampling=0)
        box = None
        if category != "not_meter":
            polygon = sample["meterPolygon"]
            box = [min(p[0] for p in polygon), min(p[1] for p in polygon),
                   max(p[0] for p in polygon), max(p[1] for p in polygon)]
        if not unsupported:
            label = output / "labels" / split / (sample["id"] + ".txt")
            label.parent.mkdir(parents=True, exist_ok=True)
            line = ""
            if box:
                x1, y1, x2, y2 = box
                line = f"{names.index(category)} {(x1+x2)/2:.8f} {(y1+y2)/2:.8f} {x2-x1:.8f} {y2-y1:.8f}\n"
            label.write_text(line, encoding="utf-8")
        counts[split + ":" + category] = counts.get(split + ":" + category, 0) + 1
        evaluation.append({"id": sample["id"], "split": split, "category": category,
                           "image": target.relative_to(output).as_posix(), "box": box,
                           "unsupported": unsupported, "sha256": hashlib.sha256(target.read_bytes()).hexdigest(),
                           **({"label": label.relative_to(output).as_posix(),
                               "labelSha256": hashlib.sha256(label.read_bytes()).hexdigest()} if not unsupported else {})})
    audit = {"manifestSha256": hashlib.sha256(manifest.read_bytes()).hexdigest(),
             "classes": names, "unsupportedClasses": [c for c in CLASSES if c not in names],
             "partialDevelopment": names != list(CLASSES), "counts": counts,
             "perceptualAlgorithm": "63-bit DCT median pHash, Hamming<=6; no proof of identity",
             "perceptualPairs": pairs, "samples": evaluation}
    lines = ["path: " + json.dumps(str(output.resolve()).replace("\\", "/")),
             "train: images/train", "val: images/val", "test: images/test", "names:"]
    lines += [f"  {i}: {name}" for i, name in enumerate(names)]
    (output / "dataset.yaml").write_text("\n".join(lines) + "\n", encoding="utf-8")
    audit["datasetYamlSha256"] = hashlib.sha256((output / "dataset.yaml").read_bytes()).hexdigest()
    (output / "audit.json").write_text(json.dumps(audit, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: v for k, v in audit.items() if k not in ("samples", "perceptualPairs")}))
    return audit


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("image_root", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--allow-partial-development", action="store_true")
    parser.add_argument("--node", default="node")
    args = parser.parse_args()
    prepare(args.manifest, args.image_root, args.output, args.allow_partial_development, args.node)


if __name__ == "__main__":
    main()
