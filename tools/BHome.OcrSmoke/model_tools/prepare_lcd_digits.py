"""Prepare the CC0 Mendeley LCD digit corpus and frozen Commons crop evaluation.

All Mendeley images stay in TRAIN: unknown meter/session identities prevent
claiming an independent random split. Validation/test use separately reviewed
Commons author groups. Reading-crop evaluation is explicitly not end-to-end OCR.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
import re
import sys
import zipfile

import numpy as np
from PIL import Image, ImageOps
sys.path.insert(0, str(Path(__file__).resolve().parent))
from prepare_meter_training import audit_pairs, perceptual_hash

FILES = {
    "RAW IMAGES.zip": "d4dadbd2e51a8e85809a035afa390e8312d6c9206ae6bcd98e094fa61f623529",
    "export-coco-2019-06-11T14_40_00.348423.json": "5b23d2380d433c218f2f26d800639c54dff51d74cb15ea9c842b0a552db3200b",
}


def prepare(source, catalog_path, commons, evaluation_path, output, crop_training_rows=False, preview=None):
    for name, digest in FILES.items():
        if hashlib.sha256((source / name).read_bytes()).hexdigest() != digest:
            raise ValueError("CC0 source checksum mismatch")
    if output.exists() and any(output.iterdir()):
        raise ValueError("Never overwrite a frozen LCD dataset")
    coco = json.loads((source / list(FILES)[1]).read_text(encoding="utf-8"))
    classes = {c["id"]: int(c["name"].removeprefix("Text ")) for c in coco["categories"]}
    if sorted(classes.values()) != list(range(10)):
        raise ValueError("Unexpected COCO classes")
    annotations = {}
    for annotation in coco["annotations"]:
        annotations.setdefault(annotation["image_id"], []).append(annotation)
    images = {}
    with zipfile.ZipFile(source / "RAW IMAGES.zip") as archive:
        for member in archive.infolist():
            if not member.filename.lower().endswith((".jpg", ".jpeg", ".png")):
                continue
            name = Path(member.filename).stem
            if not name.isdigit() or name in images or member.file_size > 20 * 1024 * 1024:
                raise ValueError("Unsafe, duplicate or oversized ZIP image")
            images[name] = archive.read(member)
    output.mkdir(parents=True, exist_ok=True)
    samples, seen, duplicate_exclusions, source_hashes = [], set(), [], {}
    for image in coco["images"]:
        match = re.search(r"-([0-9]+)\.[Jj][Pp][Gg]$", image["file_name"])
        if match is None:
            raise ValueError("Unknown COCO/source image mapping")
        number = match.group(1)
        content = images[number]
        digest = hashlib.sha256(content).hexdigest()
        if digest in seen:
            duplicate_exclusions.append(number)
            continue
        seen.add(digest)
        with Image.open(io.BytesIO(content)) as original:
            original.verify()
        with Image.open(io.BytesIO(content)) as original:
            if original.size != (image["width"], image["height"]):
                raise ValueError("COCO/source dimensions disagree")
            rgb = ImageOps.exif_transpose(original).convert("RGB")
            if rgb.size != original.size:
                raise ValueError("Review orientation before transforming labels")
        ordered = sorted(annotations[image["id"]], key=lambda a: a["bbox"][0])
        offset_x, offset_y = 0, 0
        source_hashes["mendeley_" + number] = perceptual_hash(np.asarray(rgb))
        if crop_training_rows:
            # Training-only crop from source annotations. Evaluation crops were
            # frozen independently and are never derived from model outputs.
            height = max(a["bbox"][3] for a in ordered)
            offset_x = max(0, int(min(a["bbox"][0] for a in ordered)-.2*height))
            offset_y = max(0, int(min(a["bbox"][1] for a in ordered)-.2*height))
            right = min(rgb.width, int(max(a["bbox"][0]+a["bbox"][2] for a in ordered)+.2*height+1))
            bottom = min(rgb.height, int(max(a["bbox"][1]+a["bbox"][3] for a in ordered)+.2*height+1))
            rgb = rgb.crop((offset_x, offset_y, right, bottom))
        labels = []
        for a in ordered:
            x, y, w, h = a["bbox"]
            x -= offset_x
            y -= offset_y
            if w <= 0 or h <= 0 or x < 0 or y < 0 or x+w > rgb.width or y+h > rgb.height:
                raise ValueError("Invalid source digit box")
            labels.append(f"{classes[a['category_id']]} {(x+w/2)/rgb.width:.8f} {(y+h/2)/rgb.height:.8f} {w/rgb.width:.8f} {h/rgb.height:.8f}")
        identifier = "mendeley_" + number
        target = output / "images/train" / (identifier + ".jpg")
        target.parent.mkdir(parents=True, exist_ok=True)
        rgb.save(target, quality=95, subsampling=0)
        label = output / "labels/train" / (identifier + ".txt")
        label.parent.mkdir(parents=True, exist_ok=True)
        label.write_text("\n".join(labels) + "\n", encoding="utf-8")
        samples.append({"id": identifier, "split": "train", "image": target.relative_to(output).as_posix(),
                        "sha256": hashlib.sha256(target.read_bytes()).hexdigest(),
                        "sourceSha256": digest, "group": "mendeley_all_unknown_physical_id",
                        "label": label.relative_to(output).as_posix(),
                        "labelSha256": hashlib.sha256(label.read_bytes()).hexdigest(),
                        "source": "https://doi.org/10.17632/fnn44p4mj8.1", "license": "CC0-1.0",
                        "digitCount": len(labels), "sourceDigits": "".join(str(classes[a['category_id']]) for a in ordered)})
    catalog = {a["id"]: a for a in json.loads(catalog_path.read_text(encoding="utf-8"))["assets"]}
    evaluation = json.loads(evaluation_path.read_text(encoding="utf-8"))
    for sample in evaluation["samples"]:
        asset = catalog[sample["id"]]
        path = commons / (sample["id"] + ".jpg")
        if hashlib.sha256(path.read_bytes()).hexdigest() != asset["sha256"]:
            raise ValueError("Frozen Commons evaluation image changed")
        with Image.open(path) as original:
            rgb = ImageOps.exif_transpose(original).convert("RGB")
        source_hashes[sample["id"]] = perceptual_hash(np.asarray(rgb))
        x1, y1, x2, y2 = sample["crop"]
        if not (0 <= x1 < x2 <= rgb.width and 0 <= y1 < y2 <= rgb.height):
            raise ValueError("Invalid reviewed display crop")
        target = output / "images" / sample["split"] / (sample["id"] + ".jpg")
        target.parent.mkdir(parents=True, exist_ok=True)
        rgb.crop(sample["crop"]).save(target, quality=95, subsampling=0)
        # Only validation boxes are needed by training; test remains untouched.
        if sample["split"] == "val":
            lines = []
            for digit, left, top, right, bottom in sample["digitBoxes"]:
                if not (x1 <= left < right <= x2 and y1 <= top < bottom <= y2):
                    raise ValueError("Validation digit outside reviewed crop")
                lines.append(f"{digit} {((left+right)/2-x1)/(x2-x1):.8f} {((top+bottom)/2-y1)/(y2-y1):.8f} {(right-left)/(x2-x1):.8f} {(bottom-top)/(y2-y1):.8f}")
            label = output / "labels/val" / (sample["id"] + ".txt")
            label.parent.mkdir(parents=True, exist_ok=True)
            label.write_text("\n".join(lines) + "\n", encoding="utf-8")
        samples.append({**sample, "image": target.relative_to(output).as_posix(),
                        "sha256": hashlib.sha256(target.read_bytes()).hexdigest(),
                        **({"label": label.relative_to(output).as_posix(),
                            "labelSha256": hashlib.sha256(label.read_bytes()).hexdigest()} if sample["split"] == "val" else {}),
                        "source": asset["sourceUrl"], "license": asset["license"]})
    preview_audit = None
    if preview is not None:
        if not crop_training_rows:
            raise ValueError("Preview extension requires training row crops")
        from lcd_preview_training import add_preview
        preview_audit = add_preview(preview, output, samples, source_hashes)
    # Exact overlap across splits is always rejected, even for public data.
    split_hashes = {}
    for sample in samples:
        digest = sample["sha256"]
        if digest in split_hashes and split_hashes[digest] != sample["split"]:
            raise ValueError("LCD exact-content split leakage")
        split_hashes[digest] = sample["split"]
    audit = {"manifestSha256": hashlib.sha256(evaluation_path.read_bytes()).hexdigest(),
             "classes": [str(i) for i in range(10)], "unsupportedClasses": [],
             "partialDevelopment": False, "task": "lcd_digit_detection",
             "trainingOnlyRowCrops": crop_training_rows, "exactDuplicateExclusions": duplicate_exclusions,
             "lcdPreview": preview_audit,
             "sourcePerceptualPairs": audit_pairs(samples, source_hashes),
             "perceptualScope": "Full source images before any training/validation row crops; DCT63 Hamming<=6; not proof of physical identity",
             "sourceZipSha256": FILES["RAW IMAGES.zip"], "sourceCocoSha256": FILES[list(FILES)[1]],
             "unlabeledExcluded": sorted(set(images) - {re.search(r"-([0-9]+)\.[Jj][Pp][Gg]$", i["file_name"]).group(1) for i in coco["images"]}),
             "samples": samples, "note": "Only 1 readable validation crop + 1 blank; insufficient to establish generalization. No reading-window model or decimal inference."}
    lines = ["path: " + json.dumps(str(output.resolve()).replace("\\", "/")),
             "train: images/train", "val: images/val", "names:"]
    lines += [f"  {i}: '{i}'" for i in range(10)]
    (output / "dataset.yaml").write_text("\n".join(lines) + "\n", encoding="utf-8")
    audit["datasetYamlSha256"] = hashlib.sha256((output / "dataset.yaml").read_bytes()).hexdigest()
    (output / "audit.json").write_text(json.dumps(audit, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"train": sum(s["split"] == "train" for s in samples),
                      "validation": sum(s["split"] == "val" for s in samples),
                      "test": sum(s["split"] == "test" for s in samples),
                      "unlabeledExcluded": audit["unlabeledExcluded"]}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("catalog", type=Path)
    parser.add_argument("commons", type=Path)
    parser.add_argument("evaluation", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--crop-training-rows", action="store_true")
    parser.add_argument("--preview", type=Path, help="Pinned CC-BY-NC preview, TRAIN only; no commercial activation")
    args = parser.parse_args()
    prepare(args.source, args.catalog, args.commons, args.evaluation, args.output, args.crop_training_rows, args.preview)


if __name__ == "__main__":
    main()
