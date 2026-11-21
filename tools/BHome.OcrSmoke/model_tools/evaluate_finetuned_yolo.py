"""Export/verify actual fine-tuned YOLOv8 detection tensors; freeze thresholds on val.

The independent test is read only after selection. No automatic activation.
No mAP or per-digit score is reported as end-to-end billing accuracy.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import time

import cv2
import numpy as np
import onnx
import onnxruntime as ort
import torch


def letterbox(image, size=416):
    height, width = image.shape[:2]
    scale = min(size / width, size / height)
    rw, rh = round(width * scale), round(height * scale)
    left, top = round((size-rw)/2-.1), round((size-rh)/2-.1)
    resized = cv2.resize(image, (rw, rh), interpolation=cv2.INTER_LINEAR)
    padded = cv2.copyMakeBorder(resized, top, size-rh-top, left, size-rw-left,
                               cv2.BORDER_CONSTANT, value=(114, 114, 114))
    tensor = np.ascontiguousarray(padded[:, :, ::-1].transpose(2, 0, 1)[None], dtype=np.float32) / 255
    return tensor, scale, left, top


def iou(a, b):
    x = max(0, min(a[2], b[2])-max(a[0], b[0]))
    y = max(0, min(a[3], b[3])-max(a[1], b[1]))
    inter = x*y
    area = (a[2]-a[0])*(a[3]-a[1])+(b[2]-b[0])*(b[3]-b[1])-inter
    return inter/area if area > 0 else 0.


def decode(raw, shape, scale, left, top, threshold=.001):
    rows = raw[0].T
    output = []
    for row in rows:
        cls = int(np.argmax(row[4:])); score = float(row[4+cls])
        if not np.isfinite(row).all() or score < threshold:
            continue
        x, y, w, h = (float(v) for v in row[:4])
        box = [max(0., (x-w/2-left)/scale), max(0., (y-h/2-top)/scale),
               min(float(shape[1]), (x+w/2-left)/scale), min(float(shape[0]), (y+h/2-top)/scale)]
        if box[2] > box[0] and box[3] > box[1]:
            output.append({"class": cls, "score": score, "box": box})
    kept = []
    for candidate in sorted(output, key=lambda p: p["score"], reverse=True):
        if not any(p["class"] == candidate["class"] and iou(p["box"], candidate["box"]) > .45 for p in kept):
            kept.append(candidate)
        if len(kept) == 100:
            break
    return kept


def body_score(samples, predictions, names, threshold):
    rows, confusion = [], {}
    totals = {name: {"tp": 0, "fp": 0, "fn": 0} for name in names}
    for sample in samples:
        found = [p for p in predictions[sample["id"]] if p["score"] >= threshold]
        actual = sample["category"]
        selected = names[found[0]["class"]] if len(found) == 1 else "unknown" if not found else "ambiguous"
        confusion.setdefault(actual, {}).setdefault(selected, 0)
        confusion[actual][selected] += 1
        correct = False
        for prediction in found:
            name = names[prediction["class"]]
            matches = name == actual and sample.get("box") is not None and iou(prediction["normalizedBox"], sample["box"]) >= .5 and not correct
            totals[name]["tp" if matches else "fp"] += 1
            correct |= matches
        if actual in totals and not correct:
            totals[actual]["fn"] += 1
        rows.append({"id": sample["id"], "actual": actual, "predicted": selected,
                     "localizedCorrectly": correct, "detections": len(found)})
    for counts in totals.values():
        tp, fp, fn = counts["tp"], counts["fp"], counts["fn"]
        counts.update(precision=tp/(tp+fp) if tp+fp else None, recall=tp/(tp+fn) if tp+fn else None)
    return {"threshold": threshold, "classes": totals, "confusion": confusion, "samples": rows,
            "wrongCategory": sum(r["predicted"] not in (r["actual"], "unknown", "ambiguous") for r in rows),
            "correctSingleCategory": sum(r["predicted"] == r["actual"] for r in rows)}


def digit_score(samples, predictions, threshold):
    rows = []
    for sample in samples:
        found = sorted([p for p in predictions[sample["id"]] if p["score"] >= threshold], key=lambda p: p["box"][0])
        # Conflicting overlapping classes or split rows must not form a proposal.
        overlap = any(iou(a["box"], b["box"]) > .2 for i, a in enumerate(found) for b in found[:i])
        heights = [p["box"][3]-p["box"][1] for p in found]
        centers = [(p["box"][1]+p["box"][3])/2 for p in found]
        bad_row = bool(found) and max(centers)-min(centers) > .5 * float(np.median(heights))
        proposal = "".join(str(p["class"]) for p in found) if 3 <= len(found) <= 12 and not overlap and not bad_row else None
        expected = sample["expectedDigits"]
        rows.append({"id": sample["id"], "expectedDigits": expected, "proposal": proposal,
                     "exact": expected is not None and proposal == expected,
                     "falseProposal": proposal is not None and proposal != expected,
                     "fallback": proposal is None, "overlap": overlap, "multipleRows": bad_row,
                     "detections": found})
    return {"threshold": threshold, "readable": sum(s["expectedDigits"] is not None for s in samples),
            "exact": sum(r["exact"] for r in rows), "falseProposals": sum(r["falseProposal"] for r in rows),
            "fallback": sum(r["fallback"] for r in rows), "samples": rows}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("training", type=Path)
    parser.add_argument("dataset", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--name", choices=("body", "lcd-digits"), default="body")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    os.environ["YOLO_AUTOINSTALL"] = "false"
    os.environ["YOLO_OFFLINE"] = "true"
    os.environ["YOLO_CONFIG_DIR"] = str(args.output.resolve() / "settings")
    from ultralytics import YOLO, settings
    import ultralytics.data.utils
    settings.update({"sync": False})
    # plots=False: data validation must not fetch an optional plotting font.
    ultralytics.data.utils.check_font = lambda *a, **kw: None
    torch.set_num_threads(2)
    provenance = json.loads((args.training / "training-provenance.json").read_text(encoding="utf-8"))
    weights = args.training / args.name / "weights/best.pt"
    if hashlib.sha256(weights.read_bytes()).hexdigest() != provenance["bestSha256"]:
        raise ValueError("Trained checkpoint changed")
    audit = json.loads((args.dataset / "audit.json").read_text(encoding="utf-8"))
    if hashlib.sha256((args.dataset / "audit.json").read_bytes()).hexdigest() != provenance["auditSha256"]:
        raise ValueError("Frozen training audit changed")
    model = YOLO(str(weights.resolve()))
    model.model.float().cpu().eval()
    if list(model.names.values()) != audit["classes"]:
        raise ValueError("Trained class order mismatch")
    export_path = Path(model.export(format="onnx", imgsz=416, batch=1, dynamic=False, simplify=False,
                                   opset=17, half=False, nms=False, device="cpu"))
    graph = onnx.load(str(export_path))
    # Strip volatile timestamp metadata; retain class names, version and task.
    props = {p.key: p.value for p in graph.metadata_props if p.key != "date"}
    del graph.metadata_props[:]
    for key, value in sorted(props.items()):
        p = graph.metadata_props.add(); p.key, p.value = key, value
    model_path = args.output / (args.name + ".onnx")
    onnx.checker.check_model(graph)
    onnx.save(graph, str(model_path))
    session_options = ort.SessionOptions()
    session_options.intra_op_num_threads = 2
    session_options.inter_op_num_threads = 1
    session = ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"],
                                   sess_options=session_options)
    if session.get_inputs()[0].shape != [1, 3, 416, 416] or session.get_outputs()[0].shape != [1, 4+len(audit["classes"]), 3549]:
        raise ValueError("Unexpected static ONNX contract")
    samples = [s for s in audit["samples"] if s["split"] in ("val", "test")]
    predictions, timings, parity = {}, [], []
    dotnet_references = []
    reference_dir = args.output / "parity"
    reference_dir.mkdir(exist_ok=True)
    for index, sample in enumerate(samples):
        path = args.dataset / sample["image"]
        if hashlib.sha256(path.read_bytes()).hexdigest() != sample["sha256"]:
            raise ValueError("Frozen evaluation image changed")
        image = cv2.imread(str(path))
        tensor, ratio, left, top = letterbox(image)
        started = time.perf_counter()
        raw = session.run(None, {session.get_inputs()[0].name: tensor})[0]
        timings.append((time.perf_counter()-started)*1000)
        if index < 10:
            with torch.inference_mode():
                native = model.model(torch.from_numpy(tensor))[0].numpy()
            np.testing.assert_allclose(raw, native, rtol=2e-3, atol=2e-3)
            parity.append({"id": sample["id"], "maxAbsoluteDifference": float(np.max(np.abs(raw-native))), "passed": True})
            np.save(reference_dir / (sample["id"] + "-input.npy"), tensor)
            np.save(reference_dir / (sample["id"] + "-output.npy"), raw)
            tensor.astype("<f4").tofile(reference_dir / (sample["id"] + "-input.f32"))
            raw.astype("<f4").tofile(reference_dir / (sample["id"] + "-output.f32"))
            shutil.copyfile(path, reference_dir / (sample["id"] + ".jpg"))
            dotnet_references.append({"id": sample["id"], "image": sample["id"] + ".jpg",
                                      "input": sample["id"] + "-input.f32",
                                      "output": sample["id"] + "-output.f32"})
        found = decode(raw, image.shape, ratio, left, top)
        for detection in found:
            detection["normalizedBox"] = [v/(image.shape[1] if i % 2 == 0 else image.shape[0]) for i, v in enumerate(detection["box"])]
        predictions[sample["id"]] = found
    validation = [s for s in samples if s["split"] == "val"]
    test = [s for s in samples if s["split"] == "test"]
    grid = [.25, .5, .7, .8, .9, .95, .99]
    if args.name == "body":
        choices = [body_score(validation, predictions, audit["classes"], t) for t in grid]
        eligible = [r for r in choices if r["wrongCategory"] == 0 and all(v["fp"] == 0 for v in r["classes"].values())]
        chosen = max(eligible, key=lambda r: (r["correctSingleCategory"], -r["threshold"])) if eligible else choices[-1]
        result = body_score(test, predictions, audit["classes"], chosen["threshold"])
        # Conventional detection mAP on supported classes only; open-set sample
        # remains included separately in result above.
        mAP = {}
        for split in ("val", "test"):
            metrics = model.val(data=str((args.dataset / "dataset.yaml").resolve()), split=split,
                                imgsz=416, device="cpu", workers=0, batch=8, plots=False,
                                project=str(args.output.resolve()), name="metrics-"+split)
            mAP[split] = {"mAP50": float(metrics.box.map50), "mAP50_95": float(metrics.box.map),
                          "perClass": [{"class": audit["classes"][int(c)], "precision": float(metrics.box.p[i]),
                                        "recall": float(metrics.box.r[i]), "mAP50": float(metrics.box.ap50[i]),
                                        "mAP50_95": float(metrics.box.ap[i])} for i, c in enumerate(metrics.box.ap_class_index)]}
    else:
        choices = [digit_score(validation, predictions, t) for t in grid]
        eligible = [r for r in choices if r["falseProposals"] == 0]
        chosen = max(eligible, key=lambda r: (r["exact"], -r["threshold"])) if eligible else choices[-1]
        result = digit_score(test, predictions, chosen["threshold"])
        mAP = None
    report = {"model": args.name, "status": "evaluated_not_activated", "classes": audit["classes"],
              "validationSelectionPassed": bool(eligible) and (chosen["exact"] > 0 if args.name == "lcd-digits" else all(v["tp"] > 0 for v in chosen["classes"].values())),
              "unsupportedClasses": audit["unsupportedClasses"], "weightsSha256": provenance["bestSha256"],
              "onnxSha256": hashlib.sha256(model_path.read_bytes()).hexdigest(),
              "input": [1, 3, 416, 416], "output": [1, 4+len(audit["classes"]), 3549],
              "preprocessing": "BGR->RGB/255, centered letterbox114, bilinear, actual rounded left/top",
              "decode": "cxcywh pixels + per-class scores; no objectness; class-aware greedy NMS IoU .45",
              "nativeOnnxParity": parity, "calibrationSource": "validation only, zero observed false proposals preferred",
              "validationGrid": choices, "selectedValidation": chosen, "test": result,
              "detectionMetrics": mAP, "cpuSessionMs": {"p50": float(np.percentile(timings, 50)),
                                                        "p95": float(np.percentile(timings, 95)), "max": max(timings)},
              "limitations": "Small agent-reviewed development set; no independent human annotation review; no 90% or four-class accuracy claim; crop digit results are not billing readings."}
    (args.output / "evaluation.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    (args.output / "dotnet-parity.json").write_text(json.dumps({"model": model_path.name,
        "sha256": report["onnxSha256"], "classes": audit["classes"],
        "inputShape": report["input"], "outputShape": report["output"],
        "samples": dotnet_references}, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: v for k, v in report.items() if k in ("model", "onnxSha256", "input", "output", "cpuSessionMs")}))


if __name__ == "__main__":
    main()
