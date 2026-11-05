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
