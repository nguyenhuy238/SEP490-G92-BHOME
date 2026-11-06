"""Download only the three licensed, publicly linked MeterOCR preview images.

These are the publisher's example links, not an authenticated dataset export or
guessed full-resolution URLs. No credentials, private uploads, or auth fallback.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path

import requests
from PIL import Image

PROJECT = "https://universe.roboflow.com/meterocr-vt9ic/water-digital-meter"
PREFIX = "https://source.roboflow.com/6tkDrTsqVTNM3xf2lGf9EdX04wf2/"
EXAMPLES = {"089j4CRbYLmnBVWRKauk", "0MlNSNipRwsqs9DqoiQO", "0QOVwGDjB9WO5inVcJN0"}


def fetch(asset, root):
    suffix = asset.get("id", "").removeprefix("meterocr_")
    if (suffix not in EXAMPLES or asset.get("sourceUrl") != PROJECT or
            asset.get("downloadUrl") != PREFIX + suffix + "/thumb.jpg" or
            asset.get("license") != "CC BY 4.0"):
        raise ValueError("Unreviewed public preview")
    expected = asset.get("sha256", "")
    if len(expected) != 64 or any(c not in "0123456789abcdef" for c in expected):
        raise ValueError("Pinned preview checksum required")
    target = root / (asset["id"] + ".jpg")
    if target.is_symlink():
        raise ValueError("Symlink preview is not allowed")
    if target.exists():
        content = target.read_bytes()
    else:
        with requests.get(asset["downloadUrl"], timeout=(15, 30), stream=True) as response:
            response.raise_for_status()
            chunks, length = [], 0
            for chunk in response.iter_content(65536):
                length += len(chunk)
                if length > 1024 * 1024:
                    raise ValueError("Oversized public preview")
                chunks.append(chunk)
            content = b"".join(chunks)
    if hashlib.sha256(content).hexdigest() != expected:
        raise ValueError("Public preview checksum changed")
    with Image.open(io.BytesIO(content)) as image:
        if image.format != "JPEG" or list(image.size) != asset["dimensions"]:
            raise ValueError("Public preview format changed")
        image.verify()
    if not target.exists():
        target.write_bytes(content)
    return {"id": asset["id"], "sha256": expected, "bytes": len(content)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("catalog", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    catalog = json.loads(args.catalog.read_text(encoding="utf-8"))
    receipts = [fetch(asset, args.output) for asset in catalog["assets"]]
    (args.output / "receipts.json").write_text(json.dumps({"catalogSha256": hashlib.sha256(args.catalog.read_bytes()).hexdigest(),
                                                         "assets": receipts}, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"downloadedVerifiedPublicPreviews": len(receipts)}))


if __name__ == "__main__":
    main()
