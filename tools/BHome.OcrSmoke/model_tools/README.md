# Offline pretrained meter model tools

No training/fine-tuning. Python is used only to inspect/export existing public
weights and compare native/ONNX outputs. The API executes ONNX in .NET.

See [implementation, provenance, metrics and limitations](../../../docs/development/PRETRAINED_YOLO_METER_OCR_IMPLEMENTATION.md).

Use Python 3.11 (verified: 3.11.9) in a separate environment:

```powershell
py -3.11 -m venv .tools/yolo-export
& .tools/yolo-export/Scripts/python.exe -m pip install --extra-index-url https://download.pytorch.org/whl/cpu -r tools/BHome.OcrSmoke/model_tools/requirements-export.txt
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Prepare-PretrainedMeterDetector.ps1 -Python .tools/yolo-export/Scripts/python.exe
```

Add `-IncludeCandidateB` to reproduce the second candidate's export/parity.
Add `-IncludeStage2` for the pinned 416×416 analog-water digit model, and
`-IncludeFullPublicTest` for all52 author-test photos/labels with hashes.
Add `-EnableDevelopment` to set the three local detector settings (not production).
Restart the existing API after configuration changes.

The script downloads pinned HF checkpoints and the pinned public author test
subset; checks hashes; exports static FP32 opset17 ONNX; verifies native/ONNX raw
tensors; and checks the runtime-pinned ONNX hash. No private image is required.
Do not bypass a checksum mismatch or use `weights_only=False` on checkpoints.

Artifacts stay in ignored `.tools/meter-detection-models` and
`.tools/meter-detection-evaluation`. `model-metadata.json` describes selected A;
`evaluation-manifest.json` pins public photos and labels. Large binaries and images
are not committed. Existing PP-OCR files remain in `.tools/ocr-models`.

The model card's MIT/Apache declarations do not settle underlying Ultralytics
licensing. Review the source/license references in the report before deployment.
The selected detector has no four-category classifier and does not prove OCR
quality: measured exact reading is 1/7 fully labeled public images, with 70%
manual fallback over the ten-image subset.

See the [05/11 completion report](../../../docs/development/METER_OCR_COMPLETION_REPORT.md)
for stage2 A/B/C comparisons and final full-pipeline metrics. Stage2 improves raw
crop reading but conservative conflict rejection leaves high fallback; acceptance
is not met. It is not a universal electricity/LCD reader or four-type classifier.

Incremental studies: `--water-decision-audit` records public scene/digit/PP outcomes
and model-derived wheel-cell crops in an ignored output folder. Use
`evaluate_water_decisions.py` on separate author validation/test audit JSON;
exact-byte overlap fails unless explicitly reviewed/excluded. `-IncludeValidation`
provisions the pinned101-image author validation split, not an independent BHOME set.

`evaluate_wheel_reader.py` is an offline probe of
`oleost/visionstate-wheel-reader@563f365a5b377c10c7248517ef2576ac5cee3cbf` v1 ONNX
(Apache-2.0; included `VisionState-LICENSE.txt`). Its hash is verified before ORT
inference; it is not enabled in API inference. Its cell geometry and confidence
are diagnostic and are not author benchmark or calibrated BHOME probability.

## Four-category experiments, 2026-11-07

These are offline research tools. None enables a model in application DI/config.
Results and activation decisions are in
`docs/development/OCR_FOUR_CLASS_RECOGNITION_COMPLETION.md`. Keep weights, images,
review packs and local packages under ignored `.tools`.

`compare_paddle_meter_models.py` compares the pinned English/mobile and official
multilingual/server CTC models on existing diagnostic crops. Provisional Kaggle
labels are reported as draft matches, never as independent accuracy/error rates:

```powershell
.tools/yolo-python/python.exe tools/BHome.OcrSmoke/model_tools/compare_paddle_meter_models.py .tools/ocr-recovery-english .tools/ocr-four-server .tools/ocr-recovery-validation/diagnostic-public-only.json .tools/ocr-four-paddle-replay.json --lcd-manifest docs/datasets/meter/kaggle-electricity-development-candidates.json --root .
```

The embedded Python distribution ignores PYTHONPATH. To use the existing CUDA
packages, inject their directory **before** importing Torch. For example:

```powershell
@'
from pathlib import Path
import runpy, sys
sys.path.insert(0, str(Path('.tools/yolo-cuda-packages').resolve()))
sys.path.insert(0, str(Path('tools/BHome.OcrSmoke/model_tools').resolve()))
sys.argv = ['train_lcd_crnn.py', '.tools/master-lcd-rows-dataset', '.tools/ocr-four-crnn-replay', '--epochs', '200']
runpy.run_path('tools/BHome.OcrSmoke/model_tools/' + sys.argv[0], run_name='__main__')
'@ | .tools/yolo-python/python.exe -
```

Other argv lists for the same wrapper:

```python
['train_kaggle_display_detector.py', '.tools/ocr-recovery-kaggle', '.', '.tools/ocr-four-display-data-replay', '.tools/master-dataset/yolov8n.pt', '.tools/ocr-four-display-replay']
['evaluate_clip_meter_categories.py', '.tools/ocr-four-clip', 'docs/datasets/meter/four-class-development-v2.json', '.', '.tools/ocr-four-clip-replay.json']
```

CLIP additionally needs the isolated packages from
`requirements-clip-experiment.txt` in `.tools/ocr-four-clip-packages`; add that
directory to sys.path before runpy. All model files must match pinned revisions
and hashes. CLIP is a whole-image classification baseline with no boxes/counts;
its outputs must not be passed to the YOLO detector adapter.

Training uses frozen source-separated manifests before augmentation, validation
checkpoint selection, then a single historical test evaluation. Fresh output
directories are required. A successful export/parity does not pass recognition
or billing gates. Do not train on historical water evaluation or provisional
numeric reviews. `meter_review.py` builds a blinded review package and reconciles
declared reviews; see `docs/datasets/meter/INDEPENDENT_REVIEW.md` before using it.
