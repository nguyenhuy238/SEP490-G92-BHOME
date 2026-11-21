# Pretrained YOLO + PP-OCR — 04/11/2026

Lượt tiếp theo05/11 đã bổ sung stage2 thật và đo52 ảnh: xem
[completion report](METER_OCR_COMPLETION_REPORT.md). Số liệu trong tài liệu này
được giữ làm baseline, không tự chuyển thành kết quả final của stage2.

## Kết quả và phạm vi

Đã tích hợp **inference thật trong .NET**: pretrained YOLOv8n-OBB → chọn một vùng
chỉ số → OpenCV sửa góc/cắt ảnh → PP-OCR hiện có → parser → proposal cần review.
Không train/fine-tune, không thay PP-OCR, không gọi dịch vụ OCR bên ngoài.

**Chưa đạt chất lượng đọc số để dùng tự động trong thực tế.** Trên 10 ảnh công khai
được chọn từ test split của tác giả, định vị body/window đạt 10/10 hit ở IoU ≥0.5;
đọc đúng toàn bộ chuỗi chỉ đạt **1/7** ảnh có nhãn đầy đủ. Có 2 proposal sai và
7/10 ảnh fallback. Không có pretrained classifier bốn loại đã được kiểm chứng.
Chế độ YOLO mặc định tắt; đã provision và bật riêng cấu hình Development trên máy
làm việc này. Cần khởi động lại API hiện có để áp dụng.

Không coi hit rate này là mAP, độ chính xác trên công tơ Việt Nam, hay kết quả
acceptance ≥90%/≥50 ảnh. Chưa có tập BHOME holdout độc lập đủ lớn.

## Traceability và audit trước thay đổi

| Yêu cầu / nguồn                                        | Thành phần                                                       | Kiểm chứng                                                                |
| ------------------------------------------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------- |
| BF-05, UC-20, GBR-07: OCR chỉ đề xuất, Staff xác nhận  | `OcrWorkflowService`, capture/confirmation hiện có               | 5 PostgreSQL meter regression; không sửa workflow lưu/xác nhận            |
| UC-21, GBR-08/09: chỉ số xác nhận mới tham gia hóa đơn | Invoice workflow hiện có                                         | PostgreSQL invoice Finalization regression                                |
| GBR-01/02: phân quyền và Location scope                | Controller/service hiện có                                       | OCR API authorization tests; giữ Development + Owner/Staff cho diagnostic |
| Chọn vùng số thật, không chọn serial theo số lớn nhất  | `YoloMeterSceneDetector`, `MeterSceneSelection`, `OnnxOcrEngine` | Native/ONNX/.NET parity; 10 ảnh có nhãn; ảnh hai đồng hồ                  |
| Chụp một nút, hỏi loại sau khi không chắc              | `ocr-test.tsx`, `AutomaticOcrRouter`                             | Mobile screen tests; preview crop + trường sửa được + xóa trạng thái      |

Đã đọc audit, dataset, automatic OCR report và code thực tế. Trước thay đổi,
`IMeterSceneDetector` chỉ là điểm tích hợp; chưa có adapter được đăng ký với weights.
`IImageCategoryClassifier` cũng chưa có model. Text rules nhận diện hai mặt CCCD
và gợi ý utility từ đơn vị; đơn vị không chứng minh được cơ/điện tử.

Tái sử dụng: endpoint diagnostic, auth/Location/task checks, `LocalOcrService`,
semaphore/timeout, `ImagePreprocessor`, các session DBNet/recognizer, perspective
crop, meter parser/precision, confirmation transaction, camera và temporary image
lifecycle. Không đổi schema, billing, MinIO hay permission.

Baseline trước sửa: binary `auto1` đã chạy trên manifest ảnh điện thật hiện có,
1/1 exact, 2.805 s. Đây chỉ là một ảnh, không phải baseline đại diện. So sánh chính
ở dưới chạy đường PP-OCR cũ và đường có YOLO trên **cùng 10 ảnh**.

## Nghiên cứu và lựa chọn model

| Candidate                                                                 | Classes kiểm tra trong checkpoint           | Weights                                                                     | License đã xem                                   | ONNX / inference thật                                          | Accuracy của lượt này                                                             | Quyết định                                                                      |
| ------------------------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| [A: ntarekp](https://huggingface.co/ntarekp/watermeter-yolov8-obb)        | `meter`, `window`, `0..9`, `u`              | stage1 tải được; stage2 không dùng                                          | Card khai MIT; xem lưu ý dưới                    | YOLOv8n OBB, export CPU thành công; native/ONNX 10 ảnh         | body/window 10/10 hit; PP exact 1/7                                               | Chọn stage1 cho localization; không dùng digit detections thay PP-OCR           |
| [B: alreaper](https://huggingface.co/alreaper/Rwanda_Water_Meter_Reading) | Cùng 13 classes trong `best.pt`             | best tải được; last không cần dùng                                          | Card khai Apache-2.0; xem lưu ý dưới             | Detect axis-aligned; export CPU thành công; native/ONNX 10 ảnh | Ground-truth accuracy và PP end-to-end **NOT TESTED**; parity không phải accuracy | Không thêm runtime model thứ hai; không có lợi thế classifier/OBB đã chứng minh |
| [C: saarthak-s](https://github.com/saarthak-s/Meter_Ocr)                  | Code mô tả `meter_reading`, `serial_number` | Repo không có checkpoint; hai linked Kaggle output API trả 404 khi kiểm tra | Repo AGPL-3.0                                    | **NOT TESTED**, chưa lấy được weights                          | **NOT TESTED**                                                                    | Không tích hợp code/demo thành detector giả                                     |
| [supreetbhat/meter_reading](https://github.com/supreetbhat/meter_reading) | Chưa kiểm tra checkpoint                    | Tree có `best.pt`                                                           | Không tìm thấy license rõ trong repo đã kiểm tra | **NOT TESTED**                                                 | **NOT TESTED**                                                                    | Không tải/tích hợp khi provenance/license chưa rõ                               |

A là analog-water model theo model card. Các con số mAP công bố bởi tác giả không
được dùng làm kết quả BHOME. Không có model generic COCO nào được dùng.
Nguồn dataset A: [Mbarira-Watermeter-model](https://github.com/Ntarekp/Mbarira-Watermeter-model),
revision `72d1821ad6d97e00275bfd80c508df233555328a`.

License card không tự giải quyết quyền của toàn bộ model/dependency.
[Ultralytics công bố AGPL-3.0/Enterprise](https://www.ultralytics.com/license).
Cần project review quyền sử dụng/phân phối trước deployment; báo cáo này không
khẳng định export ONNX làm mất nghĩa vụ license hoặc đã được chấp thuận production.
Không commit weights, ảnh dataset hoặc Python environment.

## Provenance, export và tensor contract

| Artifact                   | Revision / SHA256                                                  |
| -------------------------- | ------------------------------------------------------------------ |
| A revision Hugging Face    | `c00b2752e3ad762eb269a05e1dceb28f48c1f27b`                         |
| A PT                       | `f2882a477bc12ecc5526cf73438d254945271c3e1b2b4214aa8e4deb637c3be9` |
| A ONNX `water-stage1.onnx` | `5311b093b39a2ef752c2052e2755ab8f595613d37d612e48c10dc26f6ecb9d44` |
| B revision Hugging Face    | `d02910f0bea0fea2f71f46bdcdba34ff4c004d4e`                         |
| B PT                       | `7215bf64c237d7b376c4f0ac85141ace5b75acdbf5f8be805e2b8ac573269167` |
| B ONNX                     | `00ea1d0b455c4d1081b0293e1a606c798529a21dd8b5e0bdf0140232d4ca7d21` |

Exporter: Python 3.11.9, torch 2.6.0+cpu, torchvision 0.21.0+cpu,
ultralytics 8.3.224, ONNX 1.17.0, ORT 1.20.1, numpy 1.26.4,
OpenCV Python 4.11.0.86. Full pins: `model_tools/requirements-export.txt`.
Checkpoint A ghi Ultralytics 8.4.110; đã kiểm tra export/parity thực tế với bản
exporter nêu trên, không suy đoán tương thích chỉ từ version.

Trước load PT: xác minh hash, đọc pickle opcodes/globals, giới hạn namespace đã
xem, dùng `torch.load(weights_only=True)` với allowlist. Không có `train()` hoặc
fine-tuning. Export static FP32, opset17, batch1, no embedded NMS, no simplify;
loại metadata thời gian và sắp metadata để có hash tái lập. Không bỏ hash guard
nếu môi trường export khác tạo artifact khác.

- Input A/B: `[1,3,640,640]`, RGB/255, letterbox pad114, round giống Python.
- A output: `[1,18,8400]` = xywh + 13 class scores + angle radians.
- B output: `[1,17,8400]`; không giả định có OBB angle.
- A runtime giữ lớp0 body, lớp1 window, lớp12 `u` để chặn số không rõ. Digit
  detections không dùng để ghép chỉ số hoặc sửa kết quả PP.
- Deletterbox tọa độ, probabilistic class-aware fast NMS, giữ nhiều đối tượng;
  limit overflow → unavailable, không âm thầm cắt danh sách để thành một đồng hồ.
- OBB giữ geometry đến perspective crop. Trường hợp width/height đổi chỗ +90°
  được kiểm bằng khoảng cách các corner, không so raw angle thiếu chuẩn hóa.

Native vs ONNX raw tensors: `assert_allclose(rtol=2e-3, atol=2e-3)` qua 10 ảnh
cho cả A và B. .NET vs Python letterbox max delta **0** trên cả 10 ảnh A;
count/class/score/center/corners sau NMS khớp native cả 10. Xem output local
`.tools/meter-detection-models/native-onnx-parity.json` (chứa bbox của ảnh công khai).

## Runtime và fallback

`YoloMeterSceneDetector` singleton + lazy session, SHA256/shape guard, CPU threads
theo `OcrOptions`. Warmup nạp model trước nhận request; lỗi detector không tắt
identity OCR. Token dừng preprocessing/decoding và ORT run; tensor/Mat tạm được
xóa sau sử dụng. Shared `LocalOcrService` vẫn giới hạn concurrency và timeout8s.

Automatic routing chạy neutral text để bảo vệ luồng CCCD, sau đó YOLO định vị và
PP đọc **crop**. Nếu có identity evidence đồng thời có meter detection, trả
conflict, không chọn tùy tiện. Một body/một window đủ tin cậy mới đọc; nhiều
body/window, `u`, vùng cắt ra ngoài ảnh, confidence thấp → review/manual.
Window độc lập được hỗ trợ có cảnh báo body chưa xác minh.

| Loại                           | Trạng thái thực tế                                                                              |
| ------------------------------ | ----------------------------------------------------------------------------------------------- |
| Mechanical water               | Có real localization + PP proposal khi metadata hoặc người dùng xác nhận loại; accuracy chưa đủ |
| Digital water                  | Chưa kiểm chứng model; typed task dùng đường PP/manual cũ                                       |
| Mechanical electricity         | Chưa có weights meter-specific phù hợp được xác minh; PP/manual cũ                              |
| Digital electricity            | Tương tự; không áp model analog-water vào typed task này                                        |
| Bốn loại tự nhận diện thị giác | **Chưa hoàn thành**, checkpoint không có classes tương ứng                                      |
| CCCD front/back                | Giữ text rules/PP hiện có; không thêm model CCCD và không persist ảnh                           |

Auto không có trusted meter metadata: `classificationStatus=ambiguous`,
`detectedCategory=unknown`, `classificationConfidence=null`. Có thể trả
`partialCategory=meter|water|electricity` (utility từ text nếu đủ bằng chứng),
`detectionConfidence` là score window thật, `cropPreviewDataUri` và provisional
`meterProposal`. Không dùng score window làm category probability.
Chuỗi giữ leading zeros; fractional separator chưa rõ được cảnh báo, không suy
đoán số chữ số đỏ. Khi đọc theo task, precision vẫn do backend meter metadata.

Mobile giữ một nút **Chụp ảnh OCR**, preview crop và trường sửa được; selector
chỉ hiện **sau** capture nếu chưa chắc loại. Crop cùng analysis bị bỏ khi xóa,
retake, app background, hết60s hoặc đổi phiên; chống kết quả cũ bằng generation
và abort hiện có. Diagnostic không tạo Reading/Invoice/Resident/evidence.

## Đánh giá thật và giới hạn

Subset: `wm_clean_000013,14,16,17,72` là 5 ảnh đầu dùng thử; bổ sung
`80,82,111,112,113` có nhãn không chứa `u`. Đây là lựa chọn có thiên lệch,
không phải random holdout mới. Hash từng ảnh/label trong
`model_tools/evaluation-manifest.json`. Ground truth là digit annotations của tác
giả theo thứ tự tâm X, **không phải nhãn billing decimal đã xác nhận**. Ba ảnh có
`u` không có toàn bộ chuỗi rõ, loại khỏi exact-match denominator.

| Metric, cùng 10 ảnh                | Trước YOLO        | Sau YOLO           |
| ---------------------------------- | ----------------- | ------------------ |
| Định vị body / window IoU≥.5       | Không có detector | 10/10 / 10/10      |
| Exact reading, 7 nhãn đầy đủ       | 0/7               | 1/7 (14.29%)       |
| Proposal sai trên 7 ảnh đầy đủ     | 4                 | 2                  |
| Ảnh có proposal / fallback         | 4 / 6             | 3 / 7              |
| Four-class classification accuracy | Không có model    | **NOT MEASURABLE** |

Không suy ra OCR chính xác từ localization10/10. PP còn đọc nhầm bánh số; một
số ảnh rõ bị `u` detector chặn nhầm. Giữ guard thay vì xóa cảnh báo để tăng số
proposal. Không có cải thiện đủ để tuyên bố hoàn thành water OCR acceptance.

Body hit dùng IoU của axis-aligned bounding rectangles; window hit dùng rotated
polygon IoU. Đây là hit count ở một threshold, không phải đánh giá mAP đầy đủ.

Latency warm sessions, CPU Ryzen7 5800H, threads2:

| Path, 10 ảnh                          | p50     | p95 (nearest-rank) |
| ------------------------------------- | ------- | ------------------ |
| PP cũ, typed                          | 3.489 s | 5.684 s            |
| YOLO + PP, typed crop/fallback        | 0.211 s | 0.579 s            |
| Automatic neutral routing + YOLO + PP | 4.793 s | 5.728 s            |

Tất cả10 proposal/fallback trong10s trong lần đo. Typed có nhiều early rejection
nên tốc độ không thể diễn giải thành nhận dạng nhanh và đúng. Có các tác vụ kiểm
thử cục bộ khác trong lúc chạy; đây không phải benchmark tải cô lập. Chưa benchmark
cold startup, tải đồng thời, p95 production hoặc thiết bị.

Challenge thật trên ảnh public82 biến đổi + fixture synthetic: hai đồng hồ,
xoay90°, blur mạnh, nửa ảnh → fallback; unknown object/blank → không proposal;
CCCD synthetic front/back ở cả4 hướng vẫn đúng route (8/8); ảnh trộn hai mặt
không tạo proposal. Ảnh meter xoay chưa đọc thành công, không
coi hỗ trợ geometry là bằng chứng OCR rotated accuracy. Electricity/water label
synthetic chỉ kiểm routing, không thay ảnh meter thật của từng loại.

Evidence không chứa ảnh/raw OCR/reading:
`pretrained-yolo-evaluation.json`, `pretrained-yolo-challenges.json` và
`pretrained-yolo-export-parity.json` cạnh báo cáo.

## Chạy và tái lập

Máy hiện tại đã có `.tools/yolo-python/python.exe`, weights, ảnh public và setting
Development. F5 lại **API đang dùng**, reload Mobile → Owner/Staff → Test OCR →
Chụp ảnh OCR → đối chiếu crop/nhập sửa/chọn loại sau capture. Chưa chạy E2E camera
trên điện thoại thật trong lượt này.

Trên máy mới, chuẩn bị Python3.11 riêng rồi:

```powershell
py -3.11 -m venv .tools/yolo-export
& .tools/yolo-export/Scripts/python.exe -m pip install --extra-index-url https://download.pytorch.org/whl/cpu -r tools/BHome.OcrSmoke/model_tools/requirements-export.txt
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Prepare-PretrainedMeterDetector.ps1 -Python .tools/yolo-export/Scripts/python.exe -EnableDevelopment
```

`-IncludeCandidateB` tùy chọn tải/export/parity B để so sánh. Script xác minh
PT/ONNX/data hashes; chỉ sửa3 detector settings không nhạy cảm trong user-secrets
Development và `.env` hiện có. Không thay PP model, certificate, database, token.
Python chỉ cần offline export, không được dùng bởi API runtime. Các prerequisite
OCR/mobile HTTPS vẫn theo `OCR_MOBILE_DELIVERY.md`.

```powershell
dotnet run --project tools/BHome.OcrSmoke -c Release -- --pretrained-yolo-evaluate .tools/ocr-models .tools/meter-detection-models .tools/meter-detection-evaluation .tools/meter-detection-models/bhome-evaluation.json
dotnet run --project tools/BHome.OcrSmoke -c Release -- --pretrained-yolo-challenges .tools/ocr-models .tools/meter-detection-models .tools/meter-detection-evaluation/wm_clean_000082.jpg .tools/automatic-ocr .tools/meter-detection-models/challenges.json
```

Challenge fixtures tạo bằng `scripts/New-AutomaticOcrFixtures.ps1` nếu chưa có.
Eval exit0 chỉ xác nhận chạy/parity/localization, **không** xác nhận đạt90% OCR.

Config: `Ocr:MeterDetector:Enabled` (defaultfalse), `ModelDirectory` (mặc định
sibling của PP directory), `ConfidenceThreshold=.5`, `NmsThreshold=.7`.
`Ocr:MeterDetectionMinConfidence` default.8; local evaluation/dev dùng.7,
chưa gọi đây là threshold đã calibrate. Không có flag tự bật trong Production.

Rollback: đặt `Ocr__MeterDetector__Enabled=false` trong `.env` và
`Ocr:MeterDetector:Enabled=false` trong Development user-secrets; restart API.
Không cần migration hoặc sửa dữ liệu nghiệp vụ. Missing/hash mismatch weights
trả cảnh báo detector unavailable và giữ explicit manual fallback.

## Kiểm chứng đã chạy

- Backend Release build: 0 warnings/errors.
- Application220, Domain83, OCR integration95: pass.
- PostgreSQL tạm loopback port55491: meter5 + invoice finalization1: pass.
  Storage là test substitute; không phải kiểm chứng MinIO thật.
- Mobile369: pass; typecheck/lint pass.
- PP-OCR smoke cũ: 18/18 fixture synthetic pass với detector tắt.
- Export/parity A+B, provision script bật Development: pass; không training.
- Initial broad integration filter có9 lỗi do Docker không chạy và5 skip thiếu
  Postgres env; đã chạy lại95 OCR tests không cần container và6 PostgreSQL tests
  liên quan bằng fixture Compact24. Không gọi lượt Docker đó là passed.
- Initial Mobile run dùng system Node gặp12 lỗi launcher do đổi runtime;
  rerun với repo Node22 qua `Use-LocalTools.ps1` pass369. PowerShell execution
  policy chặn `npm.ps1` ban đầu; dùng process `-ExecutionPolicy Bypass`/`npm.cmd`.
- Real meter four-category ≥50 images, phone E2E, real MinIO, load/cold-start:
  **NOT RUN / chưa đủ dữ liệu**. Không có tuyên bố coverage hoặc accuracy≥90%.

## File thay đổi

- Infrastructure: thêm `YoloMeterSceneDetector.cs`; sửa `MeterSceneSelection`,
  `OcrOptions`, `OcrWarmup`, `OnnxOcrEngine`, `DependencyInjection`.
- Application: `AutomaticOcr.cs`, `MeterReadingParser.cs`.
- Mobile: `ocr-test.tsx`, `automaticOcr.ts`.
- Tests: `AutomaticOcrTests`, `YoloMeterSceneDetectorTests`, `automaticOcrScreen`.
- Tools: `PretrainedYoloEvaluation`, `PretrainedYoloChallenges`, Program,
  `model_tools/*`; `Prepare-PretrainedMeterDetector.ps1`.
- Docs: báo cáo/evidence này, API conventions/status và cross-links audit/dataset.

Không commit/push; weights và test images nằm trong `.tools/` được gitignore.
