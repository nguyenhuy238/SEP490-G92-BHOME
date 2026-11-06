"""Freeze reviewed public negative-reading controls with no training/threshold fit.

Audits source authors, SHA256 and pHash against the current BHOME train/val
manifest. It does not establish independence from unknown pretraining data.
"""
import argparse
import hashlib
import html
import json
from pathlib import Path
import re
import sys

import numpy as np
from PIL import Image, ImageOps

sys.path.insert(0, str(Path(__file__).resolve().parent))
from prepare_meter_training import perceptual_hash


def author(value):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", value))).strip().lower()


def prepare(manifest, image_root, repository, output):
    data = json.loads(manifest.read_text(encoding="utf-8"))
    sources = {}
    for name in ("public-sources.json", "public-sources-expanded.json", "water-lcd-public-previews.json"):
        sources.update({a["id"]: a for a in json.loads((repository / "docs/datasets/meter" / name).read_text(encoding="utf-8"))["assets"]})
    training = json.loads((repository / "docs/datasets/meter/four-class-development-v2.json").read_text(encoding="utf-8"))
    references = [s for s in training["samples"] if s["split"] in ("train", "validation")]
    used_authors = {author(sources[s["id"]]["author"]) for s in references}
    hashes = []
    for sample in references:
        path = repository / sample["image"]
        if hashlib.sha256(path.read_bytes()).hexdigest() != sample["sha256"]:
            raise ValueError("Reference source image changed")
        with Image.open(path) as im:
            hashes.append((sample["id"], perceptual_hash(np.asarray(ImageOps.exif_transpose(im).convert("RGB")))))
    if output.exists() and any(output.iterdir()):
        raise ValueError("Never overwrite frozen evaluation")
    checked = []
    for sample in data["samples"]:
        asset = sources[sample["id"]]
        if not author(asset["author"]) or author(asset["author"]) in used_authors:
            raise ValueError("Unknown or overlapping train/validation author")
        path = image_root / (sample["id"] + ".jpg")
        if path.is_symlink() or hashlib.sha256(path.read_bytes()).hexdigest() != asset["sha256"]:
            raise ValueError("Frozen challenge image changed")
        with Image.open(path) as source:
            rgb = ImageOps.exif_transpose(source).convert("RGB")
        phash = perceptual_hash(np.asarray(rgb))
        if any((phash ^ h).bit_count() <= 6 for _, h in hashes):
            raise ValueError("Perceptual train/validation overlap requires review")
        if not sample.get("review") or sample["expectedReading"] is not None:
            raise ValueError("This negative-only corpus cannot invent numeric GT")
        checked.append((sample, asset, rgb, phash))
    output.mkdir(parents=True, exist_ok=True)
    (output / "images").mkdir()
    cases, audit = [], []
    for sample, asset, rgb, phash in checked:
        rgb.thumbnail((1600, 1600))
        destination = output / "images" / (sample["id"] + ".jpg")
        rgb.save(destination, quality=85)
        for kind in sample["profiles"]:
            cases.append({"file": destination.relative_to(output).as_posix(), "kind": kind,
                          "expectedFields": {}, "expectFallback": True})
        audit.append({"id": sample["id"], "sourceSha256": asset["sha256"], "authorGroup": author(asset["author"]),
                      "imageSha256": hashlib.sha256(destination.read_bytes()).hexdigest(),
                      "sourcePhash": f"{phash:016x}", "reason": sample["reason"]})
    result = {"dataset": "meter-evaluation", "cases": cases}
    (output / "manifest.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    (output / "audit.json").write_text(json.dumps({"manifestSha256": hashlib.sha256(manifest.read_bytes()).hexdigest(),
        "independentImages": len(audit), "profileObservations": len(cases), "sourceRows": audit,
        "limitation": "Negative-only public corpus; author/hash/pHash disjoint from BHOME body train/val. Unknown pretraining and physical identity; no positive reading accuracy claim."}, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"independentNegativeImages": len(audit), "profileObservations": len(cases)}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("manifest", "image_root", "repository", "output"):
        parser.add_argument(name, type=Path)
    a = parser.parse_args()
    prepare(a.manifest, a.image_root, a.repository, a.output)
