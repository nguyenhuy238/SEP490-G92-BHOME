"""Acquire and audit a pinned public single-meter digit source, outside app runtime.

The source is CC-BY-4.0. Its publisher labels are not BHOME ground truth and its
random frame splits are not independent physical-meter evaluation. No image or
annotation is admitted to training by this tool. Requires existing requests/Pillow;
parquet inspection additionally needs pyarrow 19.0.1 in an isolated tool environment.
"""
import argparse
from collections import Counter, defaultdict
import hashlib
import io
import json
import math
from pathlib import Path

import requests
from PIL import Image

REPOSITORY = "S3CUR/badger-55-watermeter"
REVISION = "b49bf7505cf1212de4e4e803bc39e8ce70c6d37e"
PARQUET_SHA256 = "cc66049ac19d35eba94ea16a119962a454d372a530932d676422e4ef64ec301a"
PARQUET_BYTES = 29511245
README_SHA256 = "bd510074e3cb2da0b9e7b2ccebe1e4f52c258aa73f11c25ad73c73499eabf438"
BASE_URL = f"https://huggingface.co/datasets/{REPOSITORY}/resolve/{REVISION}/"


def verify_file(path, expected_sha256, expected_bytes=None):
    if expected_bytes is not None and path.stat().st_size != expected_bytes:
        raise ValueError("Pinned source size mismatch")
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    if digest.hexdigest() != expected_sha256:
        raise ValueError("Pinned source checksum mismatch")


def acquire(root):
    root.mkdir(parents=True, exist_ok=True)
    for filename, sha256, size in [
        ("slots.parquet", PARQUET_SHA256, PARQUET_BYTES),
        ("README.md", README_SHA256, 12993),
    ]:
        destination = root / filename
        if destination.exists():
            verify_file(destination, sha256, size)
            continue
        partial = root / (filename + ".download")
        try:
            with requests.get(BASE_URL + filename, stream=True, timeout=(15, 90)) as response:
                response.raise_for_status()
                with partial.open("wb") as stream:
                    total = 0
                    for chunk in response.iter_content(65536):
                        total += len(chunk)
                        if total > size:
                            raise ValueError("Source exceeded pinned size")
                        stream.write(chunk)
            verify_file(partial, sha256, size)
            partial.replace(destination)
        finally:
            partial.unlink(missing_ok=True)


def audit_rows(rows):
    counters = {key: Counter() for key in ("slot", "digit", "tier", "mechanism", "split")}
    sha_groups, dhash_groups, frame_splits = defaultdict(list), defaultdict(list), defaultdict(set)
    dimensions = Counter()
    inventory = []
    for index, row in enumerate(rows):
        if row["slot"] not in (4, 5, 6, 7) or row["digit"] not in range(10):
            raise ValueError("Invalid publisher digit/slot label")
        theta = row["theta_deg"]
        if not isinstance(theta, (int, float)) or not math.isfinite(theta) or not 0 <= theta < 360:
            raise ValueError("Invalid publisher angle label")
        if row["tier"] not in ("gold", "platinum") or row["split"] not in ("train", "val", "test"):
            raise ValueError("Invalid publisher tier/split")
        expected_mechanism = "continuous" if row["slot"] == 7 else "geneva"
        if row["mechanism"] != expected_mechanism:
            raise ValueError("Publisher mechanism disagrees with pinned v2 specification")
        if not row["frame"] or not row["source_pool"]:
            raise ValueError("Missing publisher source grouping")
        data = row["image_bytes"]
        if not isinstance(data, bytes) or not 0 < len(data) <= 1024 * 1024:
            raise ValueError("Invalid embedded image")
        with Image.open(io.BytesIO(data)) as im:
            if im.format != "JPEG" or max(im.size) > 1024 or min(im.size) < 1:
                raise ValueError("Unsupported source crop")
            im.load()
            dimensions[str(im.size)] += 1
            thumb = im.convert("L").resize((9, 8), Image.Resampling.LANCZOS)
            pixels = list(thumb.tobytes())
        dhash = sum((pixels[y * 9 + x] > pixels[y * 9 + x + 1]) << (y * 8 + x)
                    for y in range(8) for x in range(8))
        digest = hashlib.sha256(data).hexdigest()
        sha_groups[digest].append(index)
        dhash_groups[f"{dhash:016x}"].append(index)
        frame_splits[row["frame"]].add(row["split"])
        for key, counter in counters.items():
            counter[str(row[key])] += 1
        inventory.append({"row": index, "imageSha256": digest, "dhash": f"{dhash:016x}",
                          "publisherFrame": row["frame"], "publisherPool": row["source_pool"],
                          "publisherSplit": row["split"], "bhomeSplit": None,
                          "physicalMeterGroup": "badger55-single-meter", "annotationReview": "pending"})
    if not inventory:
        raise ValueError("Source contains no images")
    duplicates = [indices for indices in sha_groups.values() if len(indices) > 1]
    cross_split_duplicates = [indices for indices in duplicates
                              if len({inventory[i]["publisherSplit"] for i in indices}) > 1]
    report = {
        "repository": REPOSITORY, "revision": REVISION,
        "sourceUrl": f"https://huggingface.co/datasets/{REPOSITORY}/tree/{REVISION}",
        "license": "CC BY 4.0", "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
        "attribution": "badger model 55 water-meter drum digits dataset. Three, 2026.",
        "parquetSha256": PARQUET_SHA256, "parquetBytes": PARQUET_BYTES,
        "readmeSha256": README_SHA256, "rows": len(inventory),
        "publisherCounts": {key: dict(counter) for key, counter in counters.items()},
        "dimensions": dict(dimensions), "physicalMeterGroups": 1,
        "uniqueSha256Images": len(sha_groups), "exactDuplicateGroups": len(duplicates),
        "exactDuplicateRowsBeyondFirst": sum(len(group) - 1 for group in duplicates),
        "exactDuplicateGroupsAcrossPublisherSplits": len(cross_split_duplicates),
        "equalDhashCandidateGroups": sum(len(group) > 1 for group in dhash_groups.values()),
        "publisherFramesSpanningSplits": sum(len(splits) > 1 for splits in frame_splits.values()),
        "bhomeSupervisedImagesAdded": 0, "bhomeIndependentEvaluationImagesAdded": 0,
        "status": "quarantined_publisher_labels_pending_review",
        "splitPolicy": "Keep the entire physical-meter/source group together before augmentation; publisher splits are diagnostic only.",
        "limitations": [
            "All rows show one physical meter; these are not 4548 diverse meter bodies.",
            "Digit crops have no full-meter body boxes, display polygons or billing-register/decimal ground truth.",
            "Publisher hand-review uses model-assisted evidence; BHOME independent annotation review is pending.",
            "Transition angles/digits must not be silently converted into settled billing digits.",
            "Equal dHash is a review candidate, not proof of the same image; no exhaustive perceptual-distance audit performed.",
            "No classifier/recognizer training, model activation or independent accuracy measurement performed.",
        ],
    }
    return report, inventory


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", type=Path, help="Ignored offline acquisition directory")
    parser.add_argument("report", type=Path)
    parser.add_argument("--download", action="store_true")
    args = parser.parse_args()
    if args.download:
        acquire(args.root)
    verify_file(args.root / "slots.parquet", PARQUET_SHA256, PARQUET_BYTES)
    verify_file(args.root / "README.md", README_SHA256, 12993)
    import pyarrow.parquet as parquet
    report, inventory = audit_rows(parquet.read_table(args.root / "slots.parquet").to_pylist())
    args.report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    (args.root / "inventory.json").write_text(json.dumps(inventory, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"rows": report["rows"], "status": report["status"],
                      "uniqueSha256Images": report["uniqueSha256Images"]}))


if __name__ == "__main__":
    main()
