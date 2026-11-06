"""Import publisher digit boxes from the pinned preview into TRAIN only.

Never infer a digit, billing register, precision, category, or test ground truth.
Three reviewed blank/segment-test images are excluded, not relabeled as readings.
"""
import hashlib
import json
import xml.etree.ElementTree as ET

import numpy as np
from PIL import Image, ImageOps

from download_lcd_preview import PREFIX, REPOSITORY, REVISION
from prepare_meter_training import perceptual_hash

EXCLUDED = {8: "blank_display_with_unreliable_zero_labels",
            37: "blank_display_with_unreliable_zero_labels", 48: "segment_test_not_consumption"}


def digit_boxes(xml, image_size):
    if len(xml) > 1024 * 1024 or b"<!DOCTYPE" in xml or b"<!ENTITY" in xml:
        raise ValueError("Unsupported preview XML")
    root = ET.fromstring(xml)
    if tuple(int(root.findtext("size/" + n)) for n in ("width", "height")) != image_size:
        raise ValueError("Preview dimensions disagree")
    digits, displays = [], []
    for obj in root.findall("object"):
        name = obj.findtext("name")
        if name != "scoreboard" and name not in tuple(str(i) for i in range(10)):
            continue  # Explicitly separate serial characters from on-screen digits.
        box = tuple(int(obj.findtext("bndbox/" + n)) for n in ("xmin", "ymin", "xmax", "ymax"))
        x1, y1, x2, y2 = box
        if not (0 <= x1 < x2 <= image_size[0] and 0 <= y1 < y2 <= image_size[1]):
            raise ValueError("Invalid preview box")
        if name == "scoreboard":
            displays.append(box)
        else:
            digits.append((int(name), *box))
    if len(displays) != 1 or not 3 <= len(digits) <= 12:
        raise ValueError("One display and a complete digit row required")
    a, b, c, d = displays[0]
    if any(not (a <= x1 < x2 <= c and b <= y1 < y2 <= d) for _, x1, y1, x2, y2 in digits):
        raise ValueError("Digit outside annotated display")
    heights = [y2-y1 for _, _, y1, _, y2 in digits]
    centers = [(y1+y2)/2 for _, _, y1, _, y2 in digits]
    if max(centers)-min(centers) > .5 * float(np.median(heights)):
        raise ValueError("Multiple digit rows require review")
    return sorted(digits, key=lambda row: row[1])


def add_preview(source, output, samples, source_hashes):
    receipt_path = source / "receipts.json"
    receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    if (receipt.get("repository"), receipt.get("revision"), receipt.get("license")) != (
            REPOSITORY, REVISION, "CC-BY-NC-4.0"):
        raise ValueError("Unreviewed preview provenance")
    receipts = {a["file"]: a["sha256"] for a in receipt["assets"]}
    expected = {"README.md"} | {f"{PREFIX}{i:05d}.{ext}" for i in range(1, 51) for ext in ("jpg", "xml", "txt")}
    if set(receipts) != expected or len(receipt["assets"]) != len(expected):
        raise ValueError("Incomplete preview receipts")
    for name, digest in receipts.items():
        path = source / name
        if path.is_symlink() or path.stat().st_size > 5 * 1024 * 1024 or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
            raise ValueError("Preview asset changed")
    exclusions = dict(EXCLUDED)
    exact = {s["sourceSha256"] for s in samples if s.get("sourceSha256")}
    for i in range(1, 51):
        if i in EXCLUDED:
            continue
        stem = f"{PREFIX}{i:05d}"
        digest = receipts[stem + ".jpg"]
        if digest in exact:
            exclusions[i] = "exact_duplicate"
            continue
        with Image.open(source / (stem + ".jpg")) as original:
            original.verify()
        with Image.open(source / (stem + ".jpg")) as original:
            rgb = ImageOps.exif_transpose(original).convert("RGB")
        try:
            boxes = digit_boxes((source / (stem + ".xml")).read_bytes(), rgb.size)
        except ValueError as error:
            # Quarantine inconsistent publisher annotations; never clip/fill
            # digit labels or weaken the display validation to retain a sample.
            exclusions[i] = "annotation_review_required: " + str(error)
            continue
        identifier = f"lcd_preview_{i:05d}"
        source_hashes[identifier] = perceptual_hash(np.asarray(rgb))
        height = max(y2-y1 for _, _, y1, _, y2 in boxes)
        left = max(0, int(min(x1 for _, x1, _, _, _ in boxes)-.2*height))
        top = max(0, int(min(y1 for _, _, y1, _, _ in boxes)-.2*height))
        right = min(rgb.width, int(max(x2 for _, _, _, x2, _ in boxes)+.2*height+1))
        bottom = min(rgb.height, int(max(y2 for _, _, _, _, y2 in boxes)+.2*height+1))
        crop = rgb.crop((left, top, right, bottom))
        target = output / "images/train" / (identifier + ".jpg")
        label = output / "labels/train" / (identifier + ".txt")
        target.parent.mkdir(parents=True, exist_ok=True)
        label.parent.mkdir(parents=True, exist_ok=True)
        crop.save(target, quality=95, subsampling=0)
        lines = [f"{digit} {((x1+x2)/2-left)/crop.width:.8f} {((y1+y2)/2-top)/crop.height:.8f} {(x2-x1)/crop.width:.8f} {(y2-y1)/crop.height:.8f}"
                 for digit, x1, y1, x2, y2 in boxes]
        label.write_text("\n".join(lines) + "\n", encoding="utf-8")
        samples.append({"id": identifier, "split": "train", "group": "lcd_preview_all_unknown_physical_id",
                        "image": target.relative_to(output).as_posix(),
                        "sha256": hashlib.sha256(target.read_bytes()).hexdigest(), "sourceSha256": digest,
                        "label": label.relative_to(output).as_posix(),
                        "labelSha256": hashlib.sha256(label.read_bytes()).hexdigest(),
                        "source": receipt["sourceUrl"], "license": receipt["license"],
                        "digitCount": len(boxes), "annotationStatus": "publisher_labels_structure_checked_agent_sample_reviewed"})
        exact.add(digest)
    return {"revision": REVISION, "receiptSha256": hashlib.sha256(receipt_path.read_bytes()).hexdigest(),
            "exclusions": exclusions, "usage": "noncommercial offline research; no runtime activation"}
