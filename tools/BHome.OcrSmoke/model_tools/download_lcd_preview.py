"""Acquire the pinned public LCD preview for noncommercial offline research.

No credentials, gated-source fallback, training, relabeling, or runtime activation.
Images/labels stay outside Git. The source card specifies CC-BY-NC-4.0; its
commercial-sales paragraph is not treated as a commercial license for this demo.
"""
import argparse
import concurrent.futures
import hashlib
import io
import json
from pathlib import Path

import requests
from PIL import Image

REPOSITORY = "2005JIAZHI/Annotated-Digital-LCD-Utility-Meter-And-Serial-Numbers-Dataset"
REVISION = "4b0837a012d2062ac702d7f400e991cedfd6f64d"
PREFIX = "DS_electro_scor_ser_labeled_v1_2026_"
BASE = f"https://huggingface.co/datasets/{REPOSITORY}/resolve/{REVISION}/"


def fetch(name, root, expected=None):
    if name != "README.md" and not any(name == f"{PREFIX}{i:05d}.{ext}"
                                       for i in range(1, 51) for ext in ("jpg", "txt", "xml")):
        raise ValueError("Unreviewed preview asset")
    destination = root / name
    if destination.is_symlink():
        raise ValueError("Symlink asset is not allowed")
    if destination.exists():
        content = destination.read_bytes()
    else:
        with requests.get(BASE + name, timeout=(15, 45), stream=True) as response:
            response.raise_for_status()  # 401/403 is a blocker; never bypass.
            chunks, length = [], 0
            for chunk in response.iter_content(65536):
                length += len(chunk)
                if length > 5 * 1024 * 1024:
                    raise ValueError("Oversized preview asset")
                chunks.append(chunk)
            content = b"".join(chunks)
    digest = hashlib.sha256(content).hexdigest()
    if not content or (expected and expected != digest):
        raise ValueError("Preview asset changed")
    if name.endswith(".jpg"):
        with Image.open(io.BytesIO(content)) as image:
            if image.format != "JPEG" or image.width * image.height > 12_000_000:
                raise ValueError("Unsupported preview image")
            image.verify()
    if not destination.exists():
        destination.write_bytes(content)
    return {"file": name, "sha256": digest, "bytes": len(content)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    receipt_path = args.output / "receipts.json"
    old = json.loads(receipt_path.read_text(encoding="utf-8")) if receipt_path.exists() else {}
    if old and (old.get("revision") != REVISION or old.get("repository") != REPOSITORY):
        raise ValueError("Output belongs to a different source revision")
    hashes = {r["file"]: r["sha256"] for r in old.get("assets", [])}
    readme = fetch("README.md", args.output, hashes.get("README.md"))
    card = (args.output / "README.md").read_text(encoding="utf-8")
    if "license: cc-by-nc-4.0" not in card or "free preview" not in card:
        raise ValueError("Preview license changed; review before downloading images")
    names = [f"{PREFIX}{i:05d}.{ext}" for i in range(1, 51) for ext in ("jpg", "txt", "xml")]
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        assets = list(pool.map(lambda name: fetch(name, args.output, hashes.get(name)), names))
    report = {"repository": REPOSITORY, "revision": REVISION,
              "sourceUrl": f"https://huggingface.co/datasets/{REPOSITORY}/tree/{REVISION}",
              "license": "CC-BY-NC-4.0", "use": "noncommercial offline research only",
              "assets": sorted([readme, *assets], key=lambda r: r["file"])}
    receipt_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"images": 50, "labelFiles": 100, "revision": REVISION}))


if __name__ == "__main__":
    main()
