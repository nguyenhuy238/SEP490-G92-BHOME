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

## Recognition-state and domain-transfer studies, 2026-11-07

Decisions and limitations: `docs/development/OCR_RECOGNITION_PROGRESS_REPORT.md`.
No study changes application inference/config. All new labels are provisional,
human reviews received zero. Do not train numeric models from these drafts.

Use the runpy wrapper above with both existing isolated package directories for
the following argv lists. Run from repository root with **fresh** output paths:

```python
['evaluate_lcd_readability.py', '.tools/ocr-four-clip', '.tools/ocr-recovery-english', '.tools/ocr-four-server', 'docs/datasets/meter/recognition-state-pilot.json', '.', '.tools/ocr-state-replay']
['prepare_grounding_display.py', '.tools/ocr-next-grounding', 'tools/BHome.OcrSmoke/model_tools/grounding-display-receipt.json']
['study_lcd_localization.py', '.tools/ocr-next-grounding', '.tools/ocr-four-display/run/weights/best.onnx', '.tools/ocr-recovery-english', '.tools/ocr-four-server', '.', '.tools/ocr-localization-replay']
['study_meter_hierarchy.py', '.tools/ocr-four-clip', 'docs/datasets/meter/four-class-development-v2.json', '.', '.tools/ocr-hierarchy-replay.json']
```

Grounding uses the pinned official Apache-2.0 tiny checkpoint, 640/800 short edge,
max1333, text threshold.25, class-agnostic NMS.5. Receipt hashes are mandatory;
no external inference or image upload. Numeric-region proxy IoU is not whole-LCD
ground truth. Validation selects policies before historical test; oracle-body
crops are diagnostics and must never be reported as full-frame detection.

Mechanical study (actual .NET readers, existing frozen crop manifest):

```powershell
dotnet run --project tools/BHome.OcrSmoke -c Release --no-restore -- --mechanical-electric-window-study .tools/ocr-models .tools/meter-detection-models .tools/ocr-recovery-english docs/datasets/meter/mechanical-electric-provisional-pilot.json . .tools/ocr-mechanical-replay.json
```

`prepare_mechanical_electric_pilot.py` can create fresh crops and a fresh manifest
from original Commons images before inference; do not overwrite the committed
manifest to improve predictions. It preserves one disputed rolling digit as null.
The two provisional wheel strings are historical classification TRAIN images,
not independent numeric test data. Output `draftMatch` is never billing accuracy.
Keep readers' disagreeing strings separate; do not vote them into ground truth.

## Continued accuracy experiments, 2026-11-07

See `docs/development/OCR_NEXT_RECOGNITION_IMPROVEMENT_REPORT.md`. These are local
experiments, not production features. Never retune the old9-meter test. New
provisional author-group probes, pixel/CLIP folds and publisher character boxes
have separate roles; no independent human labels were added.

The existing wrapper can run these argv lists (fresh output paths required):

```python
['study_continued_hierarchy.py', '.tools/ocr-four-clip', 'docs/datasets/meter/continued-classification-provisional.json', '.', '.tools/continued-classifier-replay']
['study_high_resolution_displays.py', '.tools/ocr-four-display/run/weights/best.onnx', '.tools/master-body-export/body.onnx', '.tools/ocr-models/detection.onnx', '.tools/ocr-recovery-english', '.tools/ocr-four-server', 'docs/datasets/meter/continued-display-provisional.json', '.', '.tools/continued-localization-replay']
['study_learned_readability.py', '.tools/ocr-four-clip', '.tools/ocr-recovery-english', '.tools/ocr-four-server', 'docs/development/ocr-progress-readability-results.json', 'docs/datasets/meter/continued-display-provisional.json', '.', '.tools/continued-readability-replay']
```

PARSeq adds a different autoregressive baseline. Its official Apache-2.0 source
must be checked out in an **external ignored clone** at the revision in
`parseq-receipt.json`; its official release checkpoint must match the full SHA.
Use `requirements-parseq-experiment.txt` with `--no-deps --target` in a separate
ignored package directory and prepend that directory to sys.path too. Reuse
existing Torch/torchvision; do not install the old upstream training requirements
over the project environment. `ParseqReader` verifies clean source/revision and
weights before import, constructs the official model with full94 charset, and
loads only its state dictionary via weights_only=True. No cloud image inference.

Additional argv lists using this isolated setup:

```python
['study_meter_numeric_alternatives.py', '.tools/ocr-continued/parseq-source', '.tools/ocr-continued/parseq-bb5792a6.pt', '.tools/master-lcd-verified-dataset', '.tools/ocr-recovery-english', '.tools/ocr-four-server', 'docs/datasets/meter/continued-display-provisional.json', '.tools/ocr-continued/localization/report.json', '.tools/ocr-recovery-historical-test/diagnostic-public-only.json', '.', '.tools/continued-numeric-replay']
['study_new_wheel_rows.py', '.tools/ocr-models/detection.onnx', '.tools/ocr-recovery-english', '.tools/ocr-four-server', '.tools/ocr-continued/parseq-source', '.tools/ocr-continued/parseq-bb5792a6.pt', 'docs/datasets/meter/continued-wheel-provisional.json', '.', '.tools/continued-wheels-replay']
['benchmark_display_pipeline.py', '.tools/ocr-four-display/run/weights/best.onnx', '.tools/ocr-models/detection.onnx', '.tools/ocr-recovery-english', 'docs/datasets/meter/continued-display-provisional.json', '.', '.tools/continued-full-image-replay.json']
```

The numeric study trains a small character CNN for a fixed20 epochs using only
Mendeley publisher digit boxes whose label hashes are present in the verified
audit. It does not retrain the failed CRNN or supervise from provisional strings.
Raw sequences, unknown rolling digits, oracle crops and predicted crops remain
separate. Row margin uses observed row height and original pixels, never an
expected count or a guessed missing digit. Grouping never supplies absent digits.
Neither method verifies a billing register; rejected models stay out of DI/config.

Blinded priority pilot (eight public full images, no suggestions in package):

```powershell
.tools/yolo-python/python.exe tools/BHome.OcrSmoke/model_tools/meter_review.py build-manifest docs/datasets/meter/continued-review-pilot.json . .tools/continued-review-replay
```

All source images must still match manifest hashes. Use the original public
catalogs for license/attribution, including continued-public-sources.json. Do not
replace inaccessible assets by guessed high-resolution URLs or relabel held-out
errors to fit model outputs. Human reviews remain zero until actually received.
