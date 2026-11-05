"""Offline inspection/export/parity of pinned public checkpoints. NO training, no cloud OCR."""
import argparse
import hashlib
import importlib
import json
import os
from pathlib import Path
import pickletools
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument("models", type=Path)
parser.add_argument("images", type=Path)
parser.add_argument("--include-candidate-b", action="store_true")
parser.add_argument("--stage2-only", action="store_true")
args = parser.parse_args()
config_directory = args.models.resolve() / "ultralytics-settings"
config_directory.mkdir(parents=True, exist_ok=True)
os.environ["YOLO_CONFIG_DIR"] = str(config_directory)
os.environ["YOLO_AUTOINSTALL"] = "false"
os.environ["YOLO_OFFLINE"] = "true"
import cv2
import numpy as np
import onnx
import onnxruntime as ort
import torch
from ultralytics import YOLO
from ultralytics.utils import DEFAULT_CFG_DICT

torch.set_num_threads(2)
PINNED = {
    "water-stage1.pt": "f2882a477bc12ecc5526cf73438d254945271c3e1b2b4214aa8e4deb637c3be9",
    "rwanda-best.pt": "7215bf64c237d7b376c4f0ac85141ace5b75acdbf5f8be805e2b8ac573269167",
    "water-stage2.pt": "f5553aaba25b49b8cab4b74d5b87f0ad68779a889fe19dcbc3139439a0f3ef02",
}

def safe_checkpoint(path):
    if hashlib.sha256(path.read_bytes()).hexdigest() != PINNED[path.name]:
        raise ValueError("Unverified checkpoint")
    with zipfile.ZipFile(path) as archive:
        data = archive.read(next(n for n in archive.namelist() if n.endswith("/data.pkl")))
    allowed = []
    for op, value, _ in pickletools.genops(data):
        if op.name in ("EXT1", "EXT2", "EXT4", "STACK_GLOBAL"):
            raise ValueError("Unsupported pickle opcode")
        if op.name != "GLOBAL":
            continue
        module, name = value.split(" ", 1)
        if not (module.startswith("torch") or module.startswith("ultralytics.nn.") or
                (module, name) in (("__builtin__", "set"), ("collections", "OrderedDict"))):
            raise ValueError("Unreviewed pickle global")
        obj = getattr(importlib.import_module("builtins" if module == "__builtin__" else module), name)
        allowed.append((obj, module + "." + name))
    with torch.serialization.safe_globals(allowed):
        return torch.load(path, map_location="cpu", weights_only=True)

def letterbox(image, size=640):
    h, w = image.shape[:2]
    ratio = min(size / w, size / h)
    rw, rh = round(w * ratio), round(h * ratio)
    left, top = round((size - rw) / 2 - .1), round((size - rh) / 2 - .1)
    resized = cv2.resize(image, (rw, rh), interpolation=cv2.INTER_LINEAR)
    padded = cv2.copyMakeBorder(resized, top, size-rh-top, left, size-rw-left, cv2.BORDER_CONSTANT, value=(114,114,114))
    return np.ascontiguousarray(padded[:,:,::-1].transpose(2,0,1)[None], dtype=np.float32) / 255

reports = []
for filename in (("water-stage2.pt",) if args.stage2_only else ("water-stage1.pt", "rwanda-best.pt") if args.include_candidate_b else ("water-stage1.pt",)):
    size = 416 if filename == "water-stage2.pt" else 640
    path = args.models.resolve() / filename
    checkpoint = safe_checkpoint(path)
    task = "obb" if "OBB" in type(checkpoint["model"]).__name__ else "detect"
    wrapper = YOLO("yolov8n-obb.yaml" if task == "obb" else "yolov8n.yaml", task=task)
    wrapper.model = checkpoint["model"].float().eval()
    wrapper.model.args = {**DEFAULT_CFG_DICT, **checkpoint.get("train_args", {})}
    wrapper.model.pt_path = str(path)
    wrapper.model.task = task
    wrapper.overrides = {"model": str(path), "task": task, "imgsz": size}
    wrapper.task = task
    names = wrapper.model.names
    print(json.dumps({"model": filename, "task": task, "names": names, "checkpointVersion": checkpoint.get("version")}))
    exported = Path(wrapper.export(format="onnx", imgsz=size, opset=17, simplify=False,
                                  dynamic=False, nms=False, batch=1, device="cpu", verbose=False))
    graph = onnx.load(str(exported))
    metadata = [(p.key, p.value) for p in graph.metadata_props if p.key != "date"]
    del graph.metadata_props[:]
    for key, value in sorted(metadata):
        item = graph.metadata_props.add(); item.key = key; item.value = value
    onnx.save(graph, str(exported))
    onnx.checker.check_model(str(exported))
    session = ort.InferenceSession(str(exported), providers=["CPUExecutionProvider"])
    head = wrapper.model.model[-1]
    head.export = True
    head.format = "onnx"
    samples = []
    for photo in sorted(p for p in args.images.iterdir() if p.suffix.lower() in (".jpg", ".png")):
        image = cv2.imread(str(photo))
        tensor = letterbox(image, size)
        with torch.inference_mode():
            native = wrapper.model(torch.from_numpy(tensor)).numpy()
        converted = session.run(None, {session.get_inputs()[0].name: tensor})[0]
        delta = np.abs(native - converted)
        np.testing.assert_allclose(native, converted, rtol=2e-3, atol=2e-3)
        result = wrapper.predict(image, imgsz=size, conf=.35 if args.stage2_only else .25, iou=.45 if args.stage2_only else .7, rect=False, device="cpu", verbose=False)[0]
        boxes = result.obb if task == "obb" else result.boxes
        objects = []
        for i, cls in enumerate(boxes.cls.int().tolist()):
            if not args.stage2_only and names[cls] not in ("meter", "window", "water_meter", "reading_window"):
                continue
            coords = boxes.xywhr[i].tolist() if task == "obb" else boxes.xywh[i].tolist() + [0.0]
            objects.append({"classId": cls, "name": names[cls], "confidence": float(boxes.conf[i]), "xywhr": coords})
        samples.append({"file": photo.name, "maxAbsoluteDelta": float(delta.max()), "detections": objects})
        # The same neutral tensor is used to check the .NET input/output pipeline.
        tensor.tofile(args.models / (filename + "." + photo.stem + ".input.f32"))
        converted.tofile(args.models / (filename + "." + photo.stem + ".output.f32"))
    reports.append({"file": filename, "ptSha256": PINNED[filename], "onnx": exported.name,
        "onnxSha256": hashlib.sha256(exported.read_bytes()).hexdigest(), "task": task,
        "names": names, "input": session.get_inputs()[0].shape, "output": session.get_outputs()[0].shape,
        "samples": samples})
(args.models / ("native-stage2-parity.json" if args.stage2_only else "native-onnx-parity.json")).write_text(json.dumps(reports, indent=2), encoding="utf-8")
print("Native/ONNX parity passed; no training performed.")
