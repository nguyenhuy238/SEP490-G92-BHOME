# Hoàn thiện OCR — 05/11/2026

## Phạm vi và truy vết

Tiếp tục baseline pretrained ngày04/11; không train/fine-tune, không đổi provider
PP-OCR, database, permission hay confirmation. Yêu cầu -> BF-05/UC-20/GBR-07:
đọc đúng vùng chỉ số, OCR chỉ proposal -> OnnxOcrEngine, digit adapter, parser ->
exact-match A/B/C, conflict/missing/unclear tests. UC-21/GBR-09 -> invoice chỉ dùng
chỉ số xác nhận -> chạy lại meter/invoice PostgreSQL regression.

Kế hoạch: (1) phân tích từng lỗi baseline và crop/PP output; (2) xác minh/export
stage2 rồi đánh giá native/ONNX/.NET và preprocessing trên cùng ảnh; (3) chỉ tích
hợp chiến lược có bằng chứng, giữ fallback; (4) tìm weights cho category còn thiếu,
resolver không đoán category từ đơn vị; (5) regression và báo cáo kết quả thực tế.

SRS local khác tên revision theo audit trước; dùng mapping BF/UC/GBR đã ghi trong
`METER_OCR_AUDIT_2026-11-04.md`, không giả định bản report chưa có trong repository.
Trong thư mục attachment chỉ có prompt, chưa có binary của8 ảnh chat. Tuy nhiên
fixture có ảnh GELEX trùng nội dung ảnh thứ hai, `.tools/ocr-real/meter.png`, và
manifest cũ đã gán `03251.4` với precision1. Đã quan sát ảnh để đối chiếu và chạy
inference trên file này. Bảy ảnh còn lại **chưa chạy inference**, không biến suy
đoán từ ảnh chat thành nhãn acceptance. Tất cả hình/weights nằm local, không gửi
lên dịch vụ OCR/AI.

## A. Root cause của 1/7

Đã xuất4 crop variants trên từng10 ảnh baseline, giữ ảnh/label gốc. Diagnostic
local có GT, toàn bộ PP text/score/bbox, parser, stage2 result và lý do scene reject:
`.tools/ocr-completion-calibration/public-only-diagnostics.json`.
`comparison.json` chỉ có boolean/metrics; ảnh crop nằm cùng thư mục. Đây là công
cụ offline dùng public fixtures, không phải endpoint ghi ảnh/text người dùng.

Các chuỗi dưới đây lấy từ annotation công khai và inference thực tế. `u` nghĩa
annotation có chữ số không rõ, chuỗi thiếu ký tự đó; không coi là full GT.

| Public image suffix | GT annotation | PP crop → parser | Stage2 trên crop gốc | Nguyên nhân / guard                                                            |
| ------------------- | ------------- | ---------------- | -------------------- | ------------------------------------------------------------------------------ |
| 13                  | `0024618` +u  | `00266008`       | u → reject           | recognition bánh số + GT không rõ; scene u                                     |
| 14                  | `0024618` +u  | `100236188`      | u → reject           | recognition thêm/nhầm số; scene u                                              |
| 16                  | `00246181`    | `00246088`       | u → reject           | PP sai; stage2 không chắc, giữ nhập tay                                        |
| 17                  | `0024618` +u  | `00256088`       | u → reject           | recognition; scene u                                                           |
| 72                  | `0000603`     | `00006039`       | `00006036`           | scene u; annotation có vẻ thiếu một digit so với crop8 vị trí; giữ nguyên nhãn |
| 80                  | `00171113`    | `1070031`        | `00171113`           | PP recognition; hai recognizer mâu thuẫn, không chọn score cao hơn             |
| 82                  | `0021609`     | `0021609`        | u → reject           | PP đúng ở annotation, stage2 u; margin .3 đổi stage2 thành `0021605` sai       |
| 111                 | `0076832`     | `00768324`       | u → reject           | scene u; có dấu hiệu nhãn thiếu vị trí cuối, chưa relabel                      |
| 112                 | `00768328`    | không parse được | `00768328`           | recognition/malformed PP; parser từ chối ambiguity                             |
| 113                 | `0768328`     | `0768324`        | `0768328`            | PP recognition, conflict cần review                                            |

Body/window hit10/10 ở IoU≥.5 chỉ cho biết vùng bao giao nhau đủ lớn. Nó không
đánh giá từng glyph, nội dung chuỗi hay fraction. PP recognizer hiện tại đọc văn
bản tiếng Việt tốt hơn bánh số; các failure có crop nhìn thấy đủ vị trí nhưng
nhầm6/8,4/8, thêm/mất leading digit hoặc ký tự `/`/`-`. Parser loại chuỗi malformed
là hành vi bảo vệ, không phải nguyên nhân model nhìn nhầm. Scene `u` cũng có false
positive nhưng không bị bỏ guard để nâng accuracy.

Crop orientation legacy và canonical long-axis cho cùng kết quả trên10 ảnh này.
Thử margin0, .3/.15 và .8/.15 (đơn vị chiều cao window), PP direct, CLAHE2 và PP
từng digit. Margin rộng có thể làm PP đọc thêm nhãn/cạnh ô, hoặc stage2 đổi sai
digit; CLAHE không cải thiện nhất quán. Không bật thresholding/margin mới trong
runtime. PP từng digit trên42 crop: chỉ2/23 chuỗi stage2 emit trùng PP digit-wise;
nhiều ký tự O/Q/B/chữ Việt, không được tự map O→0 để ép accuracy. Không triển khai
chiến lược này vào request.

Một lỗi hậu xử lý tìm được và sửa: native Ultralytics `scale_boxes` dựng padding
từ kích thước nguồn chưa round; ROI letterbox dùng kích thước resize đã round.
Một số crop lệch tối đa1 pixel tensor. .NET decode nay theo native; preprocessing
vẫn giống hệt Python, không đổi tensor. Các corner OBB width/height hoán đổi+90°
được so bằng corner tương đương, không đòi raw angle giống nhau.

## B. Model thật và chiến lược đọc

[Stage2 source](https://huggingface.co/ntarekp/watermeter-yolov8-obb) revision
`c00b2752e3ad762eb269a05e1dceb28f48c1f27b`:

| Artifact            | SHA256 / contract                                                                |
| ------------------- | -------------------------------------------------------------------------------- |
| `stage2_digits.pt`  | `f5553aaba25b49b8cab4b74d5b87f0ad68779a889fe19dcbc3139439a0f3ef02`               |
| `water-stage2.onnx` | `2100d78ae1d762327cb871ee521a8dd9e84afc34de1cd8cf58876332e5834006`               |
| Actual classes      | `0..9`, `u` (11classes), OBB, không có decimal/category class                    |
| Input/output        | FP32 `[1,3,416,416]` → `[1,16,3549]`                                             |
| Preprocess/NMS      | RGB/255, pad114; threshold.35, probabilistic class-aware NMS.45; digit review≥.5 |

Model card khai MIT. Đã đọc provenance và metadata, verify LFS hash, inspect pickle
globals và load `weights_only=True`. Export opset17 bằng môi trường pin cũ
Python3.11.9/torch2.6.0+cpu/Ultralytics8.3.224; không train. Native/ONNX raw tensors
pass `rtol=atol=2e-3`; max absolute delta trên10 crop khoảng.0047 ở tọa độ lớn,
không phải probability sai. .NET input max delta0, detection count/class/score và
corners khớp native10/10. Weights không commit. License framework/redistribution
vẫn cần review theo [báo cáo trước](PRETRAINED_YOLO_METER_OCR_IMPLEMENTATION.md)
và [Ultralytics](https://www.ultralytics.com/license); không tuyên bố production approval.

`YoloWaterDigitRecognizer` là singleton sessionlazy + warmup; SHA/shape guard,
CPU thread2, cancellation ORT và buffer cleanup. Sorting tâmX trong crop deskew,
giữ leading zeros; khác hàng, gap lớn, overlap cross-class, count<3/>12, score
thấp hoặc bất kỳu → không chuỗi. Không trim/pad theo độ dài GT. Không thể phát
hiện chắc chắn digit thiếu ở hai đầu khi không có metadata độ dài; đây là hạn chế.

Ba chiến lược được đo trên cùng crop:

- A: stage1 crop → PP page/DBNet → parser.
- B: stage1 crop → pretrained stage2 → geometry/unclear guard.
- C exploratory: B chỉ dùng khi A không có giá trị hoặc A=B; không chọn string
  theo score. Sau đó runtime áp dụng thêm parser ambiguity, profile/blur/scene
  guard; không đồng nhất C exploratory với end-to-end.

| Dataset / strategy, crop legacy      | A exact / full labels | B exact / full labels | C exploratory exact / full labels | False A/B/C |
| ------------------------------------ | --------------------- | --------------------- | --------------------------------- | ----------- |
| 10 ảnh baseline (7full)              | 1/7                   | 3/7                   | 1/7                               | 3 / 0 / 0   |
| 42 ảnh chưa dùng lượt trước (26full) | 2/26                  | 20/26                 | 11/26                             | 11 / 1 / 1  |

Guarded proposal/fallback trên42: A18/24, B23/19, C13/29 (bao gồm ảnh annotationu).
Đây là so sánh **crop gốc full resolution** với scene guard, không bao gồm upload
validation/resize/JPEG của Mobile. Baseline typed trước đó1/7 và2 false khác A
diagnostic do typed PP profile/retry và preprocessing, không sửa số liệu cũ.
Margin .3 exploratory trên42 đạt B21/26, C12/26 nhưng được xem sau đánh giá, nên
không coi đó là heldout và không chọn cấu hình theo kết quả này.

Runtime chọn fusion thận trọng: một window hợp lệ, đúng profile nước cơ từ task,
PP và stage2 đọc cùng crop. Disagreement, PP multiple/ambiguous hoặc stage2u →
fallback; nếu PP không có chữ số và không có ambiguity, stage2-only proposal có
cảnh báo review. Missing/corrupt stage2 giữ PP cũ với cảnh báo unavailable. Water
stage2 không được áp cho typed electricity/digital water. Automatic chưa biết
profile không emit PP số thiếu căn cứ; vẫn trả crop và hỏi loại sau capture.

Stage2 không có decimal class. Khi hai chuỗi trùng sau bỏ **chỉ dấu chấm** thì giữ
dấu chấm PP quan sát; không bỏ leading zeros. Khi chỉ có digit string, không tự
đoán màu đỏ/fraction. Production `Meter.DecimalPlaces` từ server vẫn áp dụng;
diagnostic không biết precision thì cảnh báo, người dùng sửa hoặc chọn precision.
Không đọc các mặt kim nhỏ trên P-MAX rồi tự cộng thành fraction.

## C. Category resolver và pretrained còn thiếu

Đã tìm thêm model qua Hugging Face API và repo nguồn, không chỉ đọc tên demo:

| Candidate                                                                                 | Kết quả xác minh                                                                               | Quyết định                                                                                |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [Seeed digital_meter_water](https://huggingface.co/Seeed-Studio/digital_meter_water)      | Card MIT, link ONNX YOLOv5tiny192 SevenSeg; link chính thức trả403 khi tải                     | Không lấy được weights; runtime/accuracy NOT TESTED; không phải classifier4 loại          |
| [Omar meter-reading-models](https://huggingface.co/Omar-Elnaggar/meter-reading-models)    | revision69b44338; có analogue/digital PT + classification PTH, không card/license/class map rõ | Không load pickle không xác minh; NOT TESTED                                              |
| [pentiumcoder/digital-number-ocr](https://github.com/pentiumcoder/digital-number-ocr)     | Tree có ONNX nhưng không project LICENSE, chỉ license của dependencies trong `.venv`           | Không nhầm license dependency là quyền weights; NOT TESTED                                |
| [oleost/visionstate-wheel-reader](https://huggingface.co/oleost/visionstate-wheel-reader) | Apache2 card, ONNX wheel-position water/gas; cần wheel-cell layout/context                     | Không phân loại4 loại; chưa kiểm chứng integration/cell geometry, không thêm model thứ ba |
| Seeed/Mohamedniyaz metadata khác                                                          | Card/README có nhưng không weights trong HF siblings                                           | Không tuyên bố inference                                                                  |
| `s2021sss`, `mulil` HF candidates                                                         | Có checkpoint/ONNX nhưng thiếu license/provenance/classes rõ                                   | Không load/tích hợp để lấp checkbox                                                       |

Không tìm được pretrained **bốn lớp** đủ provenance và capability để tích hợp trong
lượt nghiên cứu này; không khẳng định model như vậy không tồn tại ở nơi khác.

Resolver nay dùng nhãn thiết bị **rõ ràng** như `CÔNG TƠ ĐIỆN TỬ`,
`DIGITAL WATER METER`, `MECHANICAL WATER METER` kết hợp utility evidence đọc được.
`kWh/m³` một mình vẫn chỉ narrowing utility, không biết cơ/điện tử. Nhãn/đơn vị
trái utility hoặc nhãn digital+mechanical cùng xuất hiện → ambiguous. Nhãn chữ
nguồn `text_rules`, confidence=null; không giả làm visual model. Dòng nhãn có
confidence<.9 không dùng. Metadata task đọc từ server vẫn là loại authoritative;
không suy Room/ownership từ ảnh.

| Loại                | Năng lực có bằng chứng                                              | Trạng thái automatic                                                  |
| ------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Nước cơ             | stage1+stage2 inference, PP đối chiếu;52 public analog-water photos | Không có visual class; cần metadata hoặc nhãn chữ rõ/chọn sau capture |
| Điện tử electricity | PP profile + numeric refinement,1 GELEX fixture thật                | Nhận dạng từ nhãn chữ trên ảnh; không có meter-window YOLO riêng      |
| Điện cơ             | PP typed/synthetic regression; explicit mechanical label rules      | Chưa có real dataset/model classifier phù hợp                         |
| Nước digital        | PP typed/synthetic regression; explicit digital label rules         | Chưa có real dataset/model classifier phù hợp                         |
| CCCD hai mặt        | Giữ PP/text rules; synthetic4 hướng mỗi mặt                         | Không thay identity processing/permission/retention                   |

GELEX: auto đã trả `electricity_digital` đúng từ nhãn, source text_rules, không
fake confidence. Raw digit string `032514` vẫn chưa biết precision; **không tính
đó là exact billing reading `03251.4`**. Typed digital electricity + server
precision1 cho1/1 exact. Không auto chèn dấu thập phân dựa vào model CE-38.

## D. Toàn luồng, accuracy và kết luận

Đã chạy `LocalOcrService` thật trên cả52 ảnh test của tác giả, bao gồm10 ảnh cũ
và42 ảnh chưa dùng ở lượt04/11. 33 ảnh có toàn bộ digit annotations,19 ảnh cóu.
Ảnh nguồn4032×3024 đầu tiên vượt12MP bị validation từ chối đúng thiết kế; evaluator
nay thực hiện **cùng contract Mobile**: resize cạnh dài≤1600, JPEG85 trước request.
Không sửa ảnh/nhãn gốc hay tăng limit backend. Tất cả baseline/candidate của bảng
dưới dùng cùng mobile bytes, stage1 model và threshold. 19 ảnh cóu không được
đánh là đúng/sai khi không biết GT; vẫn nằm trong denominator fallback52.

| Final runtime, cùng52 ảnh       | Baseline typed PP | Typed nước cơ PP+stage2 | Automatic chưa chọn loại |
| ------------------------------- | ----------------- | ----------------------- | ------------------------ |
| Exact annotated reading /33full | 4/33 (12.12%)     | 3/33 (9.09%)            | 1/33 (3.03%)             |
| False proposal trên33full       | 17                | 0                       | 0                        |
| Proposal tổng                   | 26                | 3                       | 1                        |
| Manual fallback                 | 26/52 (50%)       | 49/52 (94.23%)          | 51/52 (98.08%)           |
| Latency p50                     | .209s             | .220s                   | 3.498s                   |
| Latency p95 nearest-rank        | .712s             | .801s                   | 6.171s                   |
| Latency max                     | .829s             | 1.019s                  | 6.962s                   |
| Proposal/fallback trong10s      | 52/52             | 52/52                   | 52/52                    |

**Không đạt mục tiêu accuracy90%.** B digit recognizer cải thiện việc đọc trên crop,
nhưng C runtime với parser/unclear/profile guards chủ yếu cải thiện tránh proposal
sai; exact recall giảm so với baseline. Không gọi thay đổi này là hoàn thành OCR
production. 0 false trong33 ảnh không chứng minh false rate0 ngoài dataset.
Không xóa conflict guard để đưa số20/26 lên thành runtime accuracy.

Trong52 ảnh, automatic trả unknown/ambiguous52/52, không có category mechanical
water tự phân loại hoàn chỉnh. Không có tập đủ bốn loại nên không báo một con số
four-class accuracy giả. Nước cơ có52 ảnh inference; digital electricity có1 ảnh
GELEX, typed+precision1 đạt1/1, automatic xác định category1/1 nhưng chưa xác định
decimal billing value. Mechanical electricity/digital water real images=0 trong
lượt executable này; detection/reading/classification của hai loại đó **NOT TESTED**
trên ảnh thật. Không thay chúng bằng synthetic để chứng nhận accuracy.

Đây vẫn là ảnh test **của tác giả model**, nhiều ảnh cùng meter/view gần nhau;
42 ảnh chưa dùng ở lượt trước không phải holdout Việt Nam độc lập theo meter/site.
Sau khi xem variants trên42, không dùng kết quả ấy để tự gọi threshold calibrated.
Các nhãn có dấu hiệu thiếu digit72/111 giữ nguyên trong tất cả số đếm; chúng cần
được chủ dữ liệu kiểm tra trước acceptance, không sửa để làm model tốt hơn.
Không có decimal/billing-label GT cho public water set; chỉ so annotated digit strings.
Latency đo CPU Ryzen7 5800H, threads2, sessionwarm; có tác vụ dev đồng thời, chưa
phải load benchmark hay latency camera/LAN/phone. Cold startup chưa benchmark.

Evidence đã lưu, không chứa ảnh/raw identity/secret:

- [summary A/B/C và final runtime](meter-ocr-completion-summary.json).
- [52 hàng final runtime](meter-ocr-completion-runtime.json).
- [native/ONNX/.NET stage2 crop parity](meter-ocr-stage2-parity.json).
- `.tools/ocr-completion-calibration` và `.tools/ocr-completion-holdout`: public-only
  crops + raw OCR diagnostics dùng phân tích lỗi, không commit.
- `.tools/ocr-completion-challenges.json`: 17 challenges; hai đồng hồ, crop thiếu,
  blur/90° không tạo reading; CCCD synthetic2 mặt×4 hướng giữ đúng route; mixed
  sides/blank/unknown không tạo proposal. Không gọi fallback ảnh xoay là đọc đúng.
- Real HTTP smoke: `diagnostics/water-mechanical` trả digit string đúng public58,
  requiresConfirmation=true; `diagnostics/auto` trả electricity_digital từ GELEX;
  cùng ảnh GELEX xoay180° vẫn đúng category; no-store và không gọi lookup nghiệp vụ.
  Auth là test principal, không chứng nhận
  mobile login/camera/network E2E. Inference là model thật, không fake engine.

## E. Thay đổi và vận hành

Nguồn thay đổi: `AutomaticOcr.cs`; `OnnxOcrEngine.cs`, `YoloMeterSceneDetector.cs`,
`OcrOptions.cs`, `OcrWarmup.cs`, `DependencyInjection.cs`, `Properties/AssemblyInfo.cs`;
mới `YoloWaterDigitRecognizer.cs`, `MeterRecognitionFusion.cs`, `MeterWindowCrop.cs`
(crop variants offline). Không sửa parser/billing/schema/token/evidence storage.

Mobile giữ UI một nút/crop/manual/edit hiện có, chỉ thêm thông điệp tiếng Việt cho
conflict/profile-required/gap/overlap/model-unavailable; không đưa sáu nút chọn
loại trước camera trở lại. Có test warning để tránh lộ mã kỹ thuật cho người dùng.

Tests mới/sửa: `WaterDigitRecognitionTests.cs`, `AutomaticOcrTests.cs`,
`OcrApiTests.cs`, opt-in `LocalMeterModelsFactAttribute.cs`, `automaticOcr.test.ts`.
Tools: `MeterRecognitionComparison`, `MeterCompletionEvaluation`, `DigitCropProbe`,
`Stage2Parity`, Program flags; exporter stage2; summary script; full-test hash
manifest; metadata và provision script. Weights chỉ trong `.tools/`.

Đã bật Development trên máy này với pinned stage2; restart API đang dùng rồi reload
Mobile. Nước cơ: nếu automatic chưa chắc thì chọn **Nước cơ sau khi chụp** và đọc
lại; conflict/u vẫn phải nhập tay. Điện tử GELEX: hệ thống đọc nhãn loại; kiểm tra
dấu thập phân và nhập sửa theo display/metadata. Chưa có automatic four-class model.

Reproduce với môi trường Python pin từ lượt trước:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Prepare-PretrainedMeterDetector.ps1 -Python .tools/yolo-python/python.exe -IncludeStage2 -IncludeFullPublicTest -EnableDevelopment
dotnet run --project tools/BHome.OcrSmoke -c Release -- --meter-recognition-compare .tools/ocr-models .tools/meter-detection-models .tools/meter-detection-evaluation .tools/ocr-completion-calibration
dotnet run --project tools/BHome.OcrSmoke -c Release -- --meter-completion-evaluate .tools/ocr-models .tools/meter-detection-models .tools/meter-detection-all-test .tools/ocr-completion-runtime-final.json
```

Để so42 ảnh: từ full-test manifest lấy phần không thuộc `evaluation-manifest.json`
vào `.tools/meter-detection-holdout` rồi dùng `--meter-recognition-compare`; script
summary nhận hai file comparison và runtime như trong `--help`. Để kiểm parity
crop: copy10 `*-legacy.png` vào một thư mục riêng rồi:

```powershell
.tools/yolo-python/python.exe tools/BHome.OcrSmoke/model_tools/inspect_export_pretrained.py .tools/meter-detection-models .tools/stage2-parity-crops --stage2-only
dotnet run --project tools/BHome.OcrSmoke -c Release -- --stage2-parity .tools/meter-detection-models .tools/stage2-parity-crops .tools/ocr-completion-stage2-parity.json
$env:BHOME_OCR_LOCAL_EVALUATION_ROOT = (Get-Location).Path
dotnet test tests/backend/BHome.IntegrationTests -c Release --filter FullyQualifiedName~RealModelsReadWaterThroughDiagnosticHttp
```

Exporter/provision không được chạy đồng thời với runtime benchmark dùng cùng files
model. Exit0 của evaluator chỉ nói lệnh chạy xong, không nói đạt acceptance.

`Ocr:MeterDetector:WaterDigitsEnabled` defaultfalse; opt-in stage2 chỉ khi stage1
cũng được dùng. SHA/shape mismatch/missing file có fallback. Rollback flag này
false trong `.env` và Development user-secrets rồi restart API để trở lại PP-only;
tắt luôn `Ocr:MeterDetector:Enabled` nếu muốn bỏ cả stage1. Không cần migration.

## F. Kiểm chứng đã chạy / chưa chạy

| Check                                                | Kết quả                                                                        |
| ---------------------------------------------------- | ------------------------------------------------------------------------------ |
| Backend Release build                                | Pass,0 warnings/errors                                                         |
| Application UT                                       | 225 pass                                                                       |
| Domain UT                                            | 83 pass                                                                        |
| OCR integration                                      | 106 pass, bao gồm actual-model HTTP smoke                                      |
| Stage2 native/ONNX raw + .NET preprocess/detections  | 10 crop pass                                                                   |
| PP regression                                        | 18/18 synthetic fixture pass                                                   |
| Meter confirmation + invoice finalization PostgreSQL | 6 pass trên DB tạm loopback55491, storage substitute                           |
| Mobile Vitest                                        | 370 pass                                                                       |
| Mobile TypeScript/ESLint                             | pass                                                                           |
| Provision stage1+stage2, pinned hashes/Dev opt-in    | pass                                                                           |
| Real MinIO                                           | NOT RUN: không có listener9000/9001 hoặc Docker pipe trong môi trường kiểm tra |
| Phone camera/LAN E2E                                 | NOT RUN: không có phiên thiết bị thật được điều khiển                          |
| Independent four-type≥90% acceptance                 | NOT ACHIEVED; thiếu dataset/model, không có coverage/performance giả           |

## G. Dữ liệu và fine-tuning còn cần

Không train/fine-tune trong lượt này. Chưa có căn cứ nói fine-tuning là bắt buộc
duy nhất; có thể dùng pretrained khác khi lấy được weights, class map, quyền dùng
và kiểm chứng. Tuy nhiên các weights đã xác minh hiện không đủ cho mục tiêu.

Kế hoạch tối thiểu cụ thể, cần phê duyệt/thu dữ liệu trước training:

1. Thu4 loại thiết bị Việt Nam theo nhiều site/model/điều kiện, có ảnh nghiêng,
   glare/mờ/thiếu crop/serial/multiple-register và negative/mixed. Gán body/window
   polygons, class, full digit string, decimal boundary và vị trí unreadable; không
   ép người gán nhãn đoán digit đang chuyển bánh. Không đưa PII/CCCD thật vào tập.
2. Hai người kiểm nhãn riêng, giải quyết bất đồng; liên kết ảnh với physical-meter
   group để split theo meter/site, không theo frame hoặc reading giống nhau.
   Giữ tối thiểu50 ảnh độc lập **mỗi loại** làm test riêng đề xuất, ngoài tập train/
   validation; mục tiêu này là kế hoạch, chưa phải dữ liệu đã có hay cỡ mẫu bảo đảm.
3. Chuẩn bị khoảng200 ảnh có bbox/category mỗi loại làm điểm bắt đầu cho classifier/
   display detector; digit labels từ tất cả crop giúp fine-tune stage2 nước cơ.
   Với LCD/LED, đánh giá Seeed/alternative model khi artifact truy cập được; nếu
   không đủ thì fine-tune digit/display model riêng. Đây là ngân sách đề xuất, không
   cam kết200 ảnh sẽ đạt90%.
4. Đánh giá B/C với trust gate thực tế: model confidence cần calibration trên
   validation, không nâng threshold bằng cách xem test. Thử digit recognizer thay
   PP trên water-only **chỉ sau** khi chứng minh false proposal giới hạn chấp nhận
   và có quyết định review; không bỏ disagreement guard chỉ để tăng recall.
5. Final acceptance báo riêng mỗi loại: detection/category coverage, exact reading
   gồm decimal/leading zeros, false proposal, unreadable rejection/fallback và
   proposal/fallback≤10s. Chỉ tuyên bố production-ready khi dataset đại diện và
   phone/MinIO/business regressions đạt; chưa có kết luận đó trong lượt này.

Không commit/push/merge tự động.
