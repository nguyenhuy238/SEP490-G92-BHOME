# OCR experimental diagnostics

Phạm vi BF-05 / UC-20 / GBR-07: chỉ quan sát OCR trong Development. UC-21 /
JOB-10 / GBR-09 tiếp tục chỉ dùng số đọc đã được Staff xác nhận. Endpoint này
không truy cập Meter Task, Resident, invoice hoặc lưu số đọc/ảnh.

## Bật và gọi

Dùng endpoint hiện có `POST /api/v1/ocr/diagnostics/auto?experimental=true`,
authenticated Owner/Staff, raw JPEG/PNG body tối đa 5 MiB, response `no-store`.
Không truyền query hoặc truyền `false` giữ nguyên contract automatic OCR cũ.
Query trùng hoặc không phải boolean trả 400; Tenant 403, chưa đăng nhập 401.

Phải có **đồng thời** host `Development`, `MobileDevelopment:Enabled=true`,
`Ocr:Enabled=true`, `Ocr:ExperimentalMeter:Enabled=true` và query opt-in trên.
Production, MobileDevelopment tắt hoặc experimental flag tắt: 404 cho opt-in.
`Ocr:Enabled=false` vẫn theo lỗi integration-disabled hiện có.

Ví dụ phần cấu hình cho host Development đã có authentication/database config:

```json
{
  "MobileDevelopment": { "Enabled": true },
  "Ocr": {
    "Enabled": true,
    "ModelDirectory": "<existing-pinned-ppocr-directory>",
    "MaxDimension": 1600,
    "TimeoutMilliseconds": 9000,
    "ExperimentalMeter": {
      "Enabled": true,
      "ClassifierPath": "<local-classifier.onnx>",
      "ClassifierSha256": "f7277b0570a4d6a959cbba52a6492d304029a63c22a372ca37764787df8921f3",
      "EnglishModelDirectory": "<pinned-English-model-directory>",
      "UtilityThreshold": 0.55,
      "TechnologyThreshold": 0.75,
      "RefineUnitCrops": true,
      "Categories": ["DigitalElectricity"]
    }
  }
}
```

Cấu hình thông thường vẫn mặc định `ExperimentalMeter.Enabled=false`,
`Categories=[]`. Mỗi enum `MechanicalElectricity`, `DigitalElectricity`,
`MechanicalWater`, `DigitalWater` có thể được thêm/bỏ độc lập. Reader mới chỉ hỗ
trợ hai digital enums về kỹ thuật; lượt đánh giá này chỉ bật DigitalElectricity.
Mechanical reader trả `experimental_reader_unsupported_for_category`, không tái
sử dụng water Stage-2 cho electricity. DigitalWater chưa có dữ liệu chấp nhận.

AutomaticProfile phải giữ neutral: không xoay/enhance/denoise/threshold; validate
startup từ chối config khác preprocessing đã đo. Cấu hình JSON không tự được nạp
từ `.tools`; dùng appsettings Development local hoặc environment variables theo
host hiện có. Không commit authentication secrets. Bản local với đường dẫn thật
ở `.tools/ocr-runtime-focus/development-settings.json`.

## Contract và cách hiểu kết quả

Response vẫn có envelope `{ "analysis": ..., "elapsedMilliseconds": ... }`.
Experimental `analysis` gồm:

| Field | Ý nghĩa |
| --- | --- |
| `experimental`, `businessProposalEnabled`, `requiresConfirmation` | Luôn `true`, `false`, `true` |
| `status` | `review_required` hoặc `unavailable` |
| `classification` | OcrCategoryDecision hiện có; `classified`, `unknown` hoặc `unavailable` |
| `candidateCategory` | Argmax từ pixels, có thể sai ngay cả khi `classification.status=unknown`; không phải type đã xác thực |
| `readingCandidate` | Chuỗi diagnostic có unit cùng vùng và qua gate; null nếu chưa đủ bằng chứng |
| `displayState` | `readable_candidate`, `numeric_text_present_display_unverified`, `unreadable_or_unverified` hoặc `unknown` |
| `registerStatus` | `consumption_candidate`, `unverified`, `ambiguous`, `non_consumption` |
| `readingBounds` | Nullable x/y/width/height trong ảnh sau cap1600; không phải ảnh gốc nếu đã resize |
| `warnings` | Bao gồm experimental, category/register review, decimal precision chưa xác minh |

`readingCandidate` có thể tồn tại khi classifier còn unknown vì người dùng đang
chủ động thử diagnostics. Nó không trở thành `OcrProposal`, không có
`proposedFields`/`meterProposal`, không được gửi trực tiếp tới confirmation hay
billing. Confidence là softmax model, chưa phải xác suất đúng đã calibration.
Unit gần vùng là bằng chứng chọn ứng viên, chưa chứng minh billing register/decimal.

Pipeline thực: neutral pixels → supervised CLIP ONNX → PP-OCRv6 text regions →
English CTC, margin theo chiều cao hàng và giới hạn vùng cạnh → active-ink gate →
unit/register selector. OCR không dùng tên file, nhãn dataset hay task metadata.
Không fuzzy đổi `kvVh` thành `kWh`, không cắt/bổ sung digits để khớp label.

`RefineUnitCrops` mặc định true trong pipeline experimental. Khi một label chưa
biết nằm gần numeric row, dùng quadrilateral PP detector để re-recognize hai
crop: native rectified và warp trực tiếp đến chiều cao CTC48. Cả hai phải đọc
đúng unit đầy đủ, mean confidence ≥.8 và minimum character score ≥.5. Không
thay các label đã nhận là kW/kVA/V/A/Hz/flow hoặc calibration bằng kWh. Hai view
cùng ảnh có tương quan, không phải hai xác minh độc lập; thêm warnings
`unit_crop_rectified`, `unit_requires_human_review`. Đặt false và restart để
replay bước unit trước thay đổi. Numeric row có label L1/L2/L3/status/phase cạnh
bên không được dùng thay total consumption; không sửa chuỗi thành OBIS.

`numeric_text_present_display_unverified` chỉ xác nhận có text dạng số; không
khẳng định đã tìm thấy LCD readable. Nó thay cách báo `readable_candidate` trên
fallback khi serial text có nét rõ nhưng chưa có consumption register.

## Model/fallback và replay

Classifier kiểm SHA-256, float32 tensors `[1,3,224,224]` → `[1,3]`, `[1,2]`,
metadata class order và RGB preprocessing. English model/dictionary pin checksum
trong adapter. Thiếu file, sai hash, lỗi ONNX hoặc timeout trả explicit fallback
không có reading. Loader được warmup trước HTTP listener; sau khi thay model hoặc
khắc phục failed lazy load cần restart. Rollback: tắt flag và restart host.

Real-model tests dùng `ApiFactory`/ASP.NET TestServer, production DI/ONNX code và
test-only principal. Đây không phải production JWT, camera hay Mobile E2E:

```powershell
$env:BHOME_OCR_LOCAL_EVALUATION_ROOT=(Get-Location).Path
dotnet test tests/backend/BHome.IntegrationTests -c Release --filter FullyQualifiedName~ExperimentalMeterRuntimeTests
```

Provision các public fixtures/pinned models theo manifests và báo cáo trước khi
chạy. Python reference generator là `verify_runtime_classifier.py`; test đối chiếu
9 tensor/logits thật. Model binary và ảnh local không nằm trong Git.
Kết quả và acceptance blockers: [runtime report](../development/OCR_RUNTIME_ACTIVATION_RESULTS.md).
Kết quả cải thiện unit tiếp theo: [Staff activation progress](../development/OCR_STAFF_ACTIVATION_PROGRESS.md).
