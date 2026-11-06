# BHOME OCR — kết quả thực hiện master task 05–06/11/2026

**Chưa hoàn tất OCR tự động bốn loại; không đủ bằng chứng để bật model mới.**
Đã nghiên cứu/tải dữ liệu, gán nhãn, fine-tune GPU thật, export ONNX, kiểm tra
trong .NET và chạy regression với MinIO thật. Điểm thiếu chính là dữ liệu nước
điện tử và độ tin cậy nhận dạng ngoài tập nhỏ; không coi các test kỹ thuật qua
là nghiệm thu độ chính xác OCR.

Cập nhật 06/11: đã thêm adapter ONNX bốn lớp mặc định tắt, kiểm visual mismatch
với Meter server và huấn luyện thêm LCD thật. Model LCD mới vẫn bị loại. Phần
tiếp nối ở cuối tài liệu ghi kết quả mới; các bảng ngày05/11 dưới đây là lịch sử.

## Baseline và phạm vi

Branch `member/QHuy`, bắt đầu từ `efab534`, working tree sạch. Không tạo lại
mười commit cũ. BF-05 / UC-20 / GBR-07 và UC-21 / GBR-09: OCR là đề xuất;
Staff xác nhận; billing chỉ dùng confirmed readings. Không sửa schema, backend
authorization, CCCD retention, xác nhận thanh toán hay tính tiền.

Baseline trước task đã có one-button Mobile, chọn loại sau capture khi chưa
chắc, PP-OCRv6, water OBB Stage1/Stage2, crop/review và precision server-side.
Kết quả lịch sử52 ảnh water/33 full labels: typed10/33, auto1/33, không quan sát
false reading trên33 full labels; chưa có visual classifier bốn loại. Các số
đó là kết quả report cũ, không được chạy lại hoặc nâng thành nghiệm thu trong task này.

## Những phần đã thực hiện

1. Nghiên cứu nhiều nguồn HF/Roboflow/GitHub/Kaggle/academic/Commons, ghi rõ
   license, nguồn bị gated và lý do không đưa vào train. Không scrape thumbnail
   search engine, vượt login/paywall, gửi email thay người dùng hoặc upload ảnh private.
2. Tải169 ảnh CC0 +155 ảnh Commons có metadata license;324 ảnh tải được là
   số raw assets, không phải324 ảnh train độc lập. Catalog179 candidate Commons,
   24 lỗi tải không được điền ảnh giả.
3. Duyệt58 ảnh Commons cho body/negative:21 điện cơ,13 điện tử,15 nước cơ,
   1 nước điện tử,8 negatives. Sửa nhãn theo hình thật: ảnh có tên “Digital
   Water Meter” là cơ khí. Không gán box thân cho ảnh Mendeley chỉ có display.
4. Tách theo uploader/author trước augmentation; kiểm tra SHA/corruption,
   pHash, provenance, label geometry. Mendeley163 ảnh train duy nhất sau
   loại duplicate/unlabeled; whole source cùng train vì thiếu physical IDs.
5. Fine-tune ba cấu hình YOLOv8n trên RTX3070; sáu lượt gồm các lượt xác minh
   guard dữ liệu. Freeze ảnh/labels/YAML, không train trên test. Lưu CSV epochs,
   checkpoint hashes, ONNX hashes và metric thật.
6. Export/đối chiếu native–ORT và `.NET` trên22 lượt ảnh/model; thêm CLI đánh
   giá public categories/crops, checksum rejection và regression tools.
7. Khởi động Docker sẵn có và chạy8 capture scenarios với MinIO/PostgreSQL
   thật, gồm private evidence, authorized download, replay, failure cleanup và
   proposal/confirmed reading. Không còn coi “thiếu Docker” là lý do bỏ gate này.

## Phân loại và đọc chỉ số

| Phép đo                              | Kết quả                         | Diễn giải                                                        |
| ------------------------------------ | ------------------------------- | ---------------------------------------------------------------- |
| Detector đủ4 lớp                     | Chưa có                         | Một ảnh water digital chỉ ở open-set test                        |
| Detector3 lớp thử nghiệm,9 ảnh meter | 3 đúng,5 sai,1 unknown          | Val không tìm được threshold an toàn; không bật                  |
| Detector3 lớp,6 negative             | Reject5/6                       | Có1 nhận nhầm; không đạt gate unknown rejection                  |
| Auto hiện hành trên cùng15 ảnh       | 0 gán sai,15 chưa phân loại     | 9 meter positives,6 negative; không đo numeric reading ở tập này |
| LCD rows trên3 crop có nhãn số       | 2/3 exact digit sequence        | Không phải full-frame/precision/register accuracy                |
| LCD rows trên4 ảnh test              | 2 false proposals,0 fallback    | Màn hình chưa hiển thị reading và missing digit; không bật       |
| PP page trên cùng4 crop              | 0/3 exact,1 false,3 fallback    | Cho thấy còn khoảng trống recognition thực tế                    |
| Điện cơ, một crop mới                | PP và water Stage2 đều fallback | Không có bằng chứng để tái dùng Stage2 cho điện cơ               |

Theo loại: điện cơ chưa có cải thiện được triển khai; nước cơ giữ pipeline và
kết quả lịch sử; hai crop điện tử có digit sequence đúng ở model thử nghiệm
nhưng negative control thất bại; nước điện tử một crop bị thiếu digit. Chưa có
bộ độc lập50 ảnh/lớp, chưa đạt hoặc chứng minh90%. Không suy decimal từ màu
đỏ, không dùng model prediction làm GT hay chọn register chỉ vì số lớn nhất.

Chi tiết per-class precision/recall/mAP/confusion/threshold, từng mẫu và bảng
PP vs YOLO: [training report](OCR_MODEL_TRAINING_REPORT.md) và
[bằng chứng JSON](ocr-master-results.json).

## Backend, Mobile và artifact

Runtime HTTP vẫn dùng hệ thống hiện hành. Không register `IImageCategoryClassifier`
mới hoặc thay model đang chạy vì candidate chưa qua gate. Python chỉ phục vụ
offline; .NET parity thật đã chứng minh có thể load và chạy các artifact FP32,
nhưng chưa hoàn tất adapter/category decoding/display localization cho4 loại.
Không gọi offline verification là production integration.

Mobile giữ một nút capture, crop preview, precision/unit, sửa thủ công,
retake/cancel và selector sau capture. Không sửa UI để hiển thị loại chưa được
model chứng minh. Unit/typecheck/lint đã chạy; điện thoại thật chưa kiểm tra.

Weights/ảnh/crops/env/logs ở `.tools/`, không commit. [Workflow](../datasets/meter/TRAINING.md)
và catalog/annotations nằm trong Git. Artifact chính và hash trong training
report; các model đều có `activationDecision=rejected` trong JSON evidence.

## Các lệnh đã chạy và kết quả

| Gate                                                                           | Kết quả thực thi                                               |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| `dotnet build src/backend/BHome.sln -c Release --no-restore`                   | PASS,0 warnings/errors                                         |
| `dotnet build tools/BHome.OcrSmoke -c Release --no-restore`                    | PASS,0 warnings/errors                                         |
| Application unit                                                               | 225 passed                                                     |
| Domain unit                                                                    | 83 passed                                                      |
| Integration namespace `BHome.IntegrationTests.Ocr`, bật local model evaluation | 115 passed,5 skipped; gồm8 capture cases MinIO/PostgreSQL thật |
| Native disposable PostgreSQL, MeterCaptureRegression + Invoice.Finalization    | 6 passed,0 skipped; thực thi riêng5 ca bị skip ở lệnh trên     |
| Mobile local Node22                                                            | 372 passed; typecheck và lint PASS                             |
| `node --test tests/scripts/MeterDataset.test.cjs`                              | 28 passed                                                      |
| Python model tools unittest                                                    | 10 passed                                                      |
| PP-OCR smoke                                                                   | 18/18 passed                                                   |
| Native/ORT + .NET preprocessing/tensor parity                                  | 22 lượt đối chiếu qua; không phải22 ảnh meter độc lập          |
| Checksum bị sửa                                                                | Bị từ chối, exit2 đúng như mong đợi                            |
| Real phone/camera E2E                                                          | NOT RUN: không có adb/điện thoại kết nối                       |
| Coverage / representative4-class accuracy                                      | NOT MEASURED / NOT MET                                         |

TRX ở `tests/backend/*/TestResults/master-*.trx`; raw stdout logs trong
`.tools/master-*.log`. Không cộng các suite có scenario dùng lại thành số test
nghiệp vụ độc lập. Các capture scenario dùng OCR stub/synthetic ở những nhánh
cần kết quả cố định; đây là integration storage/authorization/confirmation,
không phải phone-to-model-to-billing E2E. HTTP local-model tests và parity được
đo riêng. Test image/data là public hoặc synthetic, không dùng CCCD thật.
Automatic baseline15 ảnh: p50=5035ms, p95≈7447ms, max8015ms,15/15≤10s; đây là
Dev run có fallback và workload khác, không phải chứng nhận SLA/accuracy.

Các lỗi trong quá trình phát triển đã sửa và chạy lại: cast long/int khi build
tool C#, mapping `InvalidDataException` để checksum rejection trả exit2 thay vì
crash, sibling import trong embedded Python. Một test pHash dùng white noise
không giữ nội dung sau resize đã đổi sang structured synthetic image; ngưỡng6
không bị nới. Các giới hạn pHash vẫn được ghi rõ. Không còn lỗi build/regression
chưa xử lý trong các gate trên; **các gate chất lượng model vẫn thất bại**.

## Phần còn thiếu để nghiệm thu

- Nguồn được phép dùng có nhiều công tơ nước LCD/LED độc lập; các nguồn gated
  cần quyền truy cập/đồng ý từ chủ dữ liệu. Một sample Commons không đủ train/val/test.
  Cần tiếp tục qua các nguồn có thể cấp quyền, không yêu cầu người dùng tự chụp hàng trăm ảnh.
- Box toàn thân/window và GT register/precision đúng trên4 loại, nhiều meter/
  nhiều register, màn hình status/unpowered, glare/rotation/wheel transitions;
  kiểm tra hai người trước acceptance. Uploader grouping không chứng minh physical IDs.
- Candidate phân loại và recognizer vượt validation, false-proposal/open-set
  gates rồi mới thêm adapter và bật Development. Không bỏ safeguard để tăng proposal.
- Bộ test đại diện Việt Nam, mục tiêu≥50 ảnh độc lập/lớp và≥90% end-to-end;
  đo riêng detection, reading exact, false proposals, fallback và latency.
- Phone capture/review/cancel/background/confirmation/evidence E2E trên thiết bị.

Đây là kết quả phát triển có bằng chứng và giới hạn cụ thể, **chưa production ready**.
Không push, merge, rebase, squash, rewrite history hay deploy.

## Commit và file thay đổi

| Commit    | Message                                                                       | Mô tả ngắn                                            | Kiểm tra                                        |
| --------- | ----------------------------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------- |
| `0cc0161` | `chore(ocr): research licensed datasets and validate detection annotations`   | Catalog/license, downloader, detection-only validator | Tải152 ảnh ban đầu, validator28                 |
| `0e9a4d5` | `feat(ocr): prepare grouped public datasets and reproducible GPU fine-tuning` | Annotations, data guards, GPU workflow                | Dataset thật, Python10, training thật           |
| `a9a8ef3` | `test(ocr): verify fine-tuned ONNX parity and public-image baselines`         | ONNX/native/.NET và benchmark cùng ảnh                | Tool build, parity, baseline, checksum-negative |

Commit cuối ghi báo cáo/evidence của task này được báo hash trong phần trả lời
và `git log -4`. Các nhóm file chính: `scripts/Validate-MeterDataset.cjs`,
`tests/scripts/*Meter*`, `tests/scripts/test_meter_model_tools.py`,
`docs/datasets/meter/*`, `tools/BHome.OcrSmoke/{Program,PublicMeterEvaluation,TrainedYoloParity}.cs`,
`tools/BHome.OcrSmoke/model_tools/*`, ba report OCR và CSV/JSON evidence.
Không có thay đổi production service, controller, schema, auth hay Mobile source.

## Tiếp nối master task — 06/11/2026

**PARTIAL, chưa đạt nghiệm thu bốn loại hoặc production readiness.** Bắt đầu tại
`8f5c751` trên `member/QHuy`; các commit ngày05/11 đã tồn tại nên không làm lại.
Giữ nguyên hai tài liệu người dùng đang sửa. Không push/merge/deploy, không đưa
ảnh, weights, secrets, crops, environment hoặc build output vào Git.

### Công việc mới đã hoàn tất

- Kiểm code/model/documentation, Release build và baseline thật. Năm artifact
  đang dùng được đọc/ghi SHA256 trong [evidence mới](ocr-20261106-verification.json).
- Nghiên cứu thêm public sources; tải pinned LCD preview50 JPEG +100 labels.
  Card CC-BY-NC-4.0 chỉ cho nghiên cứu offline phi thương mại. Xem đủ50 ảnh,
  quarantine7 ảnh, giữ43 train; không có ảnh nước điện tử mới phù hợp. Các nguồn
  HTTP401/manual-gated không bị vượt quyền. [Nghiên cứu](OCR_DATASET_RESEARCH.md).
- Tooling mới tải/receipt/hash, tách serial khỏi digits, kiểm VOC dimensions,
  display containment, row geometry, quarantine; source mới cùng TRAIN. Dataset
  206 train /2 val /4 development test; toàn ảnh nguồn được kiểm pHash trước
  crop. Nhóm cùng nguồn không chứng minh đã biết physical meter IDs.
- Fine-tune YOLOv8n LCD trên GPU49 epoch, export FP32 ONNX thật, native/ORT và
  .NET parity6/6 mỗi loại. **Loại model** vì val0/1 exact và test còn2 false/4.
  Không train lại để tune theo test. [Training report](OCR_MODEL_TRAINING_REPORT.md)
  có config, source, checkpoint/hash, CSV và từng kết quả.
- `YoloMeterCategoryClassifier` thực thi in-process ONNX với checksum, exact
  four-class metadata/tensor, letterbox/NMS, cancellation, lazy singleton,
  candidate ambiguity và bounds/score limits. Mặc định tắt; Production không
  chạy. Chưa có trained four-class weights đủ điều kiện cấp cho adapter.
- DI/engine đã nối adapter; outage giữ OCR cũ với warning, meter-only unknown
  không chặn bằng chứng CCCD mạnh. Tác vụ dùng kind từ Meter server: visual
  mismatch đủ confidence/nhiều meter không phát reading. Không override metadata.
  Không thay API/schema, permission, precision, invoice hoặc confirmation policy.
- 13 adapter tests gồm loader/ORT/concurrency bằng **Constant ONNX test graph**,
  bốn class mappings, checksum/path/shape/NaN/NMS, Production/disabled/rollback,
  rejected three-class artifact và PP thật khi adapter outage. Constant graph
  kiểm kỹ thuật, hoàn toàn không phải accuracy/model huấn luyện bốn loại.

[Kiến trúc](OCR_MODEL_ARCHITECTURE.md) phân biệt body detection, display detector,
mechanical/digital readers, PP-OCR, parser và Staff confirmation. Mobile giữ
nguyên một nút chụp, crop, correction, retake/cancel và selector sau capture;
không cần sửa UI cho một model đang tắt.

### Đo lại pipeline hiện hành

52 ảnh analog water của author,33 ảnh có đầy đủ digit labels, resize1600/JPEG85,
cùng weights và deadline. Đây là corpus đã dùng nhiều lần, có repeated meters
và annotation/license gaps; chỉ đánh giá lịch sử, không đưa vào fine-tune mới.
Chưa có decimal/register GT để gọi là billing accuracy độc lập.

| Pipeline | Exact trên33 full labels | False trên full labels | Fallback /52 | Correct /mọi input | Correct /proposals |
| --- | --- | --- | --- | --- | --- |
| Typed nước cơ hiện hành | 10/33 | 0 | 42/52 | 10/52 (19.23%) | 10/10 |
| Automatic hiện hành | 1/33 | 0 | 51/52 | 1/52 (1.92%) | 1/1 |

Kết quả giữ nguyên baseline trong yêu cầu, **chưa giảm fallback**. Conditional
accuracy100% trên ít proposal không chứng minh hệ thống tốt. Typed p50/p95/max
282/892.45/1220ms; automatic4390/7034.3/8020ms,52/52 kết thúc≤10s. Không gồm
upload, HTTP, startup, evidence storage hay load/SLA production.

Automatic category baseline trên15 ảnh public development holdout: 9 meter
(3 điện cơ,3 điện tử,2 nước cơ,1 nước điện tử) và6 negatives;0/9 đúng category,
0 gán sai,15/15 unknown/ambiguous/unavailable. Không có GT số nên không tính
exact reading ở tập này. Adapter mới tắt, không diễn giải đây là quality của
model bốn lớp mới.

| Loại | Body/display detection mới | Visual classification mới | Exact reading full-frame mới | False reading /fallback |
| --- | --- | --- | --- | --- |
| Điện cơ | NOT MEASURED | NOT MEASURED | NOT MEASURED | Chưa đủ GT để đo |
| Điện tử | NOT MEASURED | NOT MEASURED | NOT MEASURED | LCD crops mới2 false/4 tổng, không phải full-frame |
| Nước cơ | Giữ detector cũ, không đo lại P/R ở phiên này | NOT MEASURED | Typed10/33; auto1/33 trên corpus lặp | 0 false trên33; fallback42/52 typed,51/52 auto |
| Nước điện tử | NOT MEASURED | NOT MEASURED | NOT MEASURED | Chỉ1 source body test, thiếu train/val/reading GT đại diện |

LCD development crop test mới:2/3 readable exact digit strings,2 false/4 inputs,
0 fallback; correct/all inputs2/4 và conditional2/4. Không suy digit accuracy,
register eligibility hoặc decimal từ exact sequence. Kết quả test đã quan sát
không còn là test nghiệm thu độc lập cho các quyết định tiếp theo.

### Kiểm tra thực thi

| Check | Kết quả |
| --- | --- |
| Backend Release và OcrSmoke build cuối | PASS,0 warning/error |
| Application UnitTests toàn project | 276 PASS |
| Domain UnitTests toàn project | 90 PASS |
| OCR integration namespace, local-model opt-in, không CompactPostgres | 127 PASS,0 skip; gồm8 PostgreSQL/MinIO thật |
| Adapter suite sau fix invalid-path | 13 PASS,0 skip;12 ca trùng suite127, không cộng thành test độc lập |
| Compact24 meter confirmation + legacy invoice finalization | 6 PASS,0 skip; PostgreSQL disposable, MinIO riêng cho legacy finalization |
| Compact24 invoice finalization trên schema hiện hành | 1 PASS,0 skip; database disposable riêng |
| Mobile Vitest / typecheck / ESLint | 381 PASS / PASS / PASS |
| Dataset Node validator / Python model tools | 28 PASS /14 PASS |
| LCD mới native/ORT và .NET tensor parity | 6/6 mỗi phép đối chiếu |
| Physical Android/iOS camera E2E | NOT RUN: không có camera/device automation session hoặc adb khả dụng |
| Independent representative4-class acceptance/calibration | NOT RUN: dữ liệu/GT và model chưa đủ |

Build đầu đã qua, một lượt build cuối bị MSB3021/MSB3027 vì benchmark của chính
phiên này đang giữ DLL; đã đợi benchmark kết thúc và chạy lại cả hai build thành
công. Lượt bootstrap PostgreSQL đầu dùng API RNG không có trên PowerShell5;
đã sửa runner tạm sang RNG instance, chạy6/6 và xóa container do runner tạo.
Test CCCD mới ban đầu chọn fixture thiếu title cần cho classification; chuyển
sang fixture automatic có sẵn đúng hợp đồng, không nới assertion/rules. Một
lệnh Mobile ban đầu bị npm.ps1 execution policy; chạy npm.cmd cùng Node22,
không sửa policy máy. Không còn failure chưa xử lý ở các gate trên.

Capture integration dùng OCR stub/synthetic để cố định nhánh workflow; đó là
bằng chứng authorization/evidence/transaction/confirmation, không phải camera
thật→model thật→billing E2E. HTTP model thật/parity đo riêng. Không cộng lại
những suite/scenario có dùng chung test.

Raw reports/logs: `.tools/ocr-20261106-*`; TRX nằm trong IntegrationTests/TestResults.
[JSON tổng hợp](ocr-20261106-verification.json) và training CSV/results có hash
nguồn để đối chiếu; raw ảnh/model vẫn ngoài Git.

### Chưa thể nghiệm thu

Thiếu dữ liệu nước LCD được phép dùng, independent GT bốn loại (body/display,
digits/precision/register, multiple meters, unreadable/status/segment-test),
model vượt false-proposal/open-set/calibration gates và camera E2E. Điện cơ,
điện tử, nước điện tử vẫn giữ PP/manual, chưa có specialized reader mới được
chứng minh để bật. Không có ≥90% accuracy hoặc ≥95% classification claim.
Những phần này không được đánh dấu completed chỉ vì adapter/test/build qua.

### Commit tiếp nối và file thay đổi

| Commit | Message | Mô tả | Kiểm tra |
| --- | --- | --- | --- |
| `63d1995` | `docs(ocr): audit additional public LCD datasets` | Source/license/gaps | API/download151 assets, review50 ảnh, baseline build/unit |
| `0e8f18f` | `chore(ocr): prepare audited LCD preview training data` | Downloader, quarantine, train isolation | Python14, Node28, prepare206/2/4 thật |
| `9903527` | `test(ocr): benchmark expanded LCD fine-tuning` | GPU train/export/parity, model rejected |49 epoch, native6/.NET6, exact/false metrics |
| `a29833e` | `feat(ocr): add guarded four-class ONNX classification` | Adapter/DI/task mismatch/CCCD fallback | Build, OCR127, adapter12, Application276, Domain90 |
| `7c0aacb` | `fix(ocr): fall back on invalid classifier artifact paths` | Bảo toàn fallback khi path lỗi | Adapter13, Release/tool builds |
| `HEAD` (commit báo cáo này) | `docs(ocr): record verification results and remaining model gates` | Tổng hợp evidence/giới hạn | Kiểm JSON, links, diff, history |

Hash đầy đủ của mọi commit, kể cả commit báo cáo, được tạo sau commit cuối tại
`.tools/ocr-20261106-git-history.md`; tái tạo bằng `git log --reverse 8f5c751..HEAD`.
Không thể nhúng hash của một commit vào chính nội dung commit đó.

File source chính: Infrastructure/Ocr `YoloMeterCategoryClassifier`,
`MeterCategoryValidation`, `OnnxOcrEngine`, `OcrOptions`, interface/warmup và DI;
test `YoloMeterCategoryClassifierTests`; model tools `download_lcd_preview`,
`lcd_preview_training`, `prepare_lcd_digits`; Python tests; dataset TRAINING/
preparation metadata; API conventions và các report/results OCR được link ở đây.
