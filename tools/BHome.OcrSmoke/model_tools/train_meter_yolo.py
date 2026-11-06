"""Fine-tune verified YOLOv8n offline; validation selects weights, never test.

Prepare the dataset with prepare_meter_training.py first. The public COCO
checkpoint is pinned to Ultralytics assets v8.3.0. Requires reviewed Ultralytics
AGPL-3.0 terms; no cloud tracking, runtime Python, or production activation.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import time

PRETRAINED_SHA256 = "f59b3d833e2ff32e194b5bb8e08d211dc7c5bdf144b90d2c8412c47ccfc83b36"


def verify_training_audit(dataset, audit):
    root = dataset.resolve()
    def checked(relative, digest):
        path = (root / relative).resolve()
        if not path.is_relative_to(root) or not digest or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
            raise ValueError("Frozen training input changed or escaped dataset root")
        return path
    checked("dataset.yaml", audit.get("datasetYamlSha256"))
    images, labels = set(), set()
    for sample in audit["samples"]:
        images.add(checked(sample["image"], sample["sha256"]))
        if sample.get("label"):
            labels.add(checked(sample["label"], sample["labelSha256"]))
        elif sample["split"] in ("train", "val"):
            raise ValueError("Every supervised image needs frozen labels, including empty negatives")
    listed_images = {p.resolve() for p in (root / "images").rglob("*") if p.suffix.lower() in (".jpg", ".jpeg", ".png")}
    if listed_images != {p for p in images if p.is_relative_to(root / "images")}:
        raise ValueError("Unlisted image in training dataset")
    if {p.resolve() for p in (root / "labels").rglob("*.txt")} != labels:
        raise ValueError("Unlisted label in training dataset")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dataset", type=Path)
    parser.add_argument("pretrained", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--cuda-packages", type=Path)
    parser.add_argument("--epochs", type=int, default=100)
    parser.add_argument("--device", default="0")
    parser.add_argument("--allow-partial-development", action="store_true")
    parser.add_argument("--name", choices=("body", "lcd-digits"), default="body")
    args = parser.parse_args()
    if args.cuda_packages:
        sys.path.insert(0, str(args.cuda_packages.resolve()))
    os.environ["YOLO_AUTOINSTALL"] = "false"
    os.environ["YOLO_OFFLINE"] = "true"
    os.environ["YOLO_CONFIG_DIR"] = str(args.output.resolve() / "settings")
    import torch
    import ultralytics
    from ultralytics import YOLO, settings
    import ultralytics.data.utils
    ultralytics.data.utils.check_font = lambda *a, **kw: None
    if ultralytics.__version__ != "8.3.224" or torch.__version__.split("+")[0] != "2.6.0":
        raise ValueError("Use the pinned offline training environment")
    settings.update({"sync": False, "wandb": False, "mlflow": False, "comet": False,
                     "clearml": False, "dvc": False, "neptune": False})
    if hashlib.sha256(args.pretrained.read_bytes()).hexdigest() != PRETRAINED_SHA256:
        raise ValueError("Unverified pretrained weights")
    audit_path = args.dataset / "audit.json"
    audit = json.loads(audit_path.read_text(encoding="utf-8"))
    if args.name == "lcd-digits" and audit["classes"] != [str(i) for i in range(10)]:
        raise ValueError("LCD recognition requires the reviewed ten-digit class order")
    if audit["partialDevelopment"] and not args.allow_partial_development:
        raise ValueError("Incomplete classes cannot be presented as a four-class model")
    verify_training_audit(args.dataset, audit)
    # Ultralytics caches labels by its own heuristic. Rebuild after our stronger
    # image/label/YAML checks instead of trusting stale local cache contents.
    for split in ("train", "val", "test"):
        (args.dataset / "labels" / (split + ".cache")).unlink(missing_ok=True)
    if not 1 <= args.epochs <= 300:
        raise ValueError("Bounded epoch count required")
    run = args.output / args.name
    if run.exists():
        raise ValueError("Do not overwrite a previous training run")
    torch.set_num_threads(2)
    config = dict(data=str((args.dataset / "dataset.yaml").resolve()), epochs=args.epochs,
                  imgsz=416, batch=8, device=args.device, workers=0, seed=42,
                  deterministic=True, amp=False, optimizer="AdamW", lr0=.001,
                  patience=20, degrees=15., translate=.1, scale=.25, perspective=.0003,
                  fliplr=0., flipud=0., hsv_h=.01, hsv_s=.25, hsv_v=.3,
                  mosaic=.3, mixup=0., close_mosaic=10, plots=False, save=True,
                  project=str(args.output.resolve()), name=args.name, exist_ok=False)
    provenance = {"status": "started", "pretrainedSha256": PRETRAINED_SHA256,
                  "pretrainedUrl": "https://github.com/ultralytics/assets/releases/download/v8.3.0/yolov8n.pt",
                  "license": "Ultralytics AGPL-3.0; source image licenses retained separately",
                  "auditSha256": hashlib.sha256(audit_path.read_bytes()).hexdigest(),
                  "manifestSha256": audit["manifestSha256"], "classes": audit["classes"],
                  "unsupportedClasses": audit["unsupportedClasses"], "config": config,
                  "python": sys.version, "torch": torch.__version__,
                  "ultralytics": ultralytics.__version__,
                  "hardware": torch.cuda.get_device_name(0) if args.device != "cpu" else "CPU"}
    args.output.mkdir(parents=True, exist_ok=True)
    report_path = args.output / "training-provenance.json"
    report_path.write_text(json.dumps(provenance, indent=2) + "\n", encoding="utf-8")
    started = time.monotonic()
    model = YOLO(str(args.pretrained.resolve()))
    model.train(**config)
    best = run / "weights/best.pt"
    provenance.update(status="trained_not_activated", elapsedSeconds=time.monotonic()-started,
                      bestSha256=hashlib.sha256(best.read_bytes()).hexdigest(),
                      lastSha256=hashlib.sha256((run / "weights/last.pt").read_bytes()).hexdigest())
    report_path.write_text(json.dumps(provenance, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(provenance))


if __name__ == "__main__":
    main()
