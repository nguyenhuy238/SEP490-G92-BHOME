"""Download the frozen, licensed public candidate catalog; never infer labels.

Uses only requests/Pillow already pinned in requirements-export.txt. Images and
download receipts stay outside Git. Re-running checks existing content, rather
than trusting a partially downloaded file. No credentials or private uploads.
"""
import argparse
import concurrent.futures
import hashlib
import io
import json
from pathlib import Path
from urllib.parse import urlparse

import requests
from PIL import Image


def fetch(asset, root):
    url = asset["downloadUrl"]
    if urlparse(url).hostname not in {"upload.wikimedia.org", "thumb.wikimedia.org"}:
        raise ValueError("Only the reviewed Wikimedia asset host is allowed")
    if asset["license"] not in {
        "CC BY 2.0", "CC BY 3.0", "CC BY 4.0", "CC BY-SA 2.0",
        "CC BY-SA 3.0", "CC BY-SA 4.0", "CC0", "Public domain",
    }:
        raise ValueError("Unreviewed license")
    if not asset["id"].startswith("commons_") or not asset["id"][8:].isdigit():
        raise ValueError("Unsafe asset identifier")
    destination = root / (asset["id"] + ".jpg")
    if destination.exists():
        content = destination.read_bytes()
    else:
        response = requests.get(url, timeout=(15, 90), stream=True,
                                headers={"User-Agent": "BHOME-University-OCR-Research/1.0"})
        response.raise_for_status()
        chunks, size = [], 0
        for chunk in response.iter_content(65536):
            size += len(chunk)
            if size > 20 * 1024 * 1024:
                raise ValueError("Public image exceeds offline size limit")
            chunks.append(chunk)
        content = b"".join(chunks)
    with Image.open(io.BytesIO(content)) as image:
        if image.format not in ("JPEG", "PNG") or image.width * image.height > 30_000_000:
            raise ValueError("Unsupported or oversized public image")
        dimensions = list(image.size)
        image.verify()
    digest = hashlib.sha256(content).hexdigest()
    if asset.get("sha256") and asset["sha256"] != digest:
        raise ValueError("Public image checksum changed")
    if not destination.exists():
        destination.write_bytes(content)
    return {"id": asset["id"], "file": destination.name, "sha256": digest,
            "dimensions": dimensions, "bytes": len(content)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("catalog", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    assets = json.loads(args.catalog.read_text(encoding="utf-8"))["assets"]
    receipts, failures = [], []
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        futures = {pool.submit(fetch, asset, args.output): asset for asset in assets}
        for future in concurrent.futures.as_completed(futures):
            asset = futures[future]
            try:
                receipts.append(future.result())
            except (requests.RequestException, ValueError, OSError) as error:
                failures.append({"id": asset["id"], "error": type(error).__name__})
    report = {"catalogSha256": hashlib.sha256(args.catalog.read_bytes()).hexdigest(),
              "downloaded": sorted(receipts, key=lambda x: x["id"]), "failures": failures}
    (args.output / "receipts.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"downloaded": len(receipts), "failed": len(failures)}))


if __name__ == "__main__":
    main()
