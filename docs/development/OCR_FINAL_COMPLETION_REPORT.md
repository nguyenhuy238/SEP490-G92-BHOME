# BHOME OCR — kết quả thực hiện master task 05–06/11/2026

**Lượt tiếp nối từ `83317cb`: xem [kết quả mới nhất](#tiếp-nối-master-implementation-task-từ-83317cb).**
Đã train YOLO bốn lớp thật nhưng model bị loại; baseline đọc số chưa cải thiện.
Các kết quả cũ bên dưới được giữ làm lịch sử, không thay thế số đo mới nhất.

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

## Tiếp nối master implementation task từ `83317cb`

**Trạng thái: PARTIAL — chưa đủ điều kiện đưa OCR tự động bốn loại vào sử dụng.**
Lượt này bắt đầu trên `member/QHuy`, working tree sạch, sau merge của nhóm tại
`83317cb`; không tạo lại các commit OCR cũ. Giữ baseline PP-OCRv6 + water Stage1/2,
adapter bốn lớp mặc định tắt và toàn bộ xác nhận nghiệp vụ. Không sửa migration,
schema, endpoint, phân quyền, appsettings, chính sách thanh toán hay Mobile.

Traceability: BF-05 / UC-20 / GBR-07 → parser, fusion, engine và automatic router →
kiểm tra đúng display/đơn vị, fallback và Staff confirmation. GBR-01/02 → capture
workflow → regression phạm vi Location và quyền truy cập. UC-21 / GBR-09 → workflow
confirmed reading và invoice finalization → PostgreSQL/MinIO regression. Đã đọc
SRS thực tế trong `docs/reports/BHome_Report-3_Software Requirement Specification.docx`;
OCR vẫn là đề xuất, không tự xác nhận hay quyết định số tiền.

### Dữ liệu và ranh giới đánh giá

Tải thêm 70 ảnh Commons có author/license/hash và ba ảnh preview được liên kết
công khai từ MeterOCR (CC BY 4.0); chỉ dùng đúng URL preview đã công bố, không
truy cập bản gốc bằng URL đoán. Catalog nằm trong
[public-sources-expanded.json](../datasets/meter/public-sources-expanded.json) và
[water-lcd-public-previews.json](../datasets/meter/water-lcd-public-previews.json).
Nguồn Commons có CC0/CC BY/CC BY-SA theo từng ảnh, không gộp thành một license.
Trang/export Roboflow trả 403/yêu cầu đăng nhập không bị vượt qua. Archive Seeed
6.160 JPEG đã kiểm kê; 30 ảnh mẫu là đồng hồ áp suất MPa, loại khỏi tập meter billing.
Không áp license MIT của project khác cho archive này. Chi tiết nguồn/loại trừ:
[nghiên cứu dataset](OCR_DATASET_RESEARCH.md).

[Manifest development v2](../datasets/meter/four-class-development-v2.json) gồm
62 ảnh: 21 điện cơ, 13 điện tử, 15 nước cơ, 5 nước điện tử, 8 negatives. Train/val/test
là 36/11/15; riêng nước điện tử 3/1/1. Ba ảnh LCD train cùng publisher group, chỉ
200×150 và thân bị cắt. Ảnh LCD test mới là màn hình trắng, không có chỉ số đọc được.
Ảnh LCD development test cũ chuyển sang validation, không train; các nhóm test cũ
đã được quan sát nên không gọi đây là nghiệm thu độc lập. Kiểm tra SHA/pHash/group
không thay thế physical-device IDs hoặc chứng minh không trùng pretraining.

Thêm [8 ảnh kiểm tra từ chối](../datasets/meter/independent-reading-controls.json),
17 lượt theo profile: LCD trắng, flow rate, TDS, biểu tượng, tháp nước, nắp không
display, gallons không được hỗ trợ và nhiều thiết bị không đọc rõ. Author không
trùng body train/val; kiểm SHA và pHash63 Hamming≤6 với train/val trước khi chuẩn bị.
Không gán số giả cho ảnh trắng/không đọc được. Đây là negative-only, không phải tập
positive độc lập đại diện bốn loại. Blank annotation dùng coarse review rectangle,
không dùng làm ground truth display IoU. Xem [quy trình](../datasets/meter/TRAINING.md).

### Huấn luyện thật và quyết định loại model

Fine-tune YOLOv8n trên RTX 3070 Laptop bằng Torch 2.6.0+cu118/Ultralytics 8.3.224:
416 px, batch8, AdamW lr0=.001, seed42, deterministic, AMP off, patience20,
budget100 epoch. Dừng sau29 epoch, best fitness epoch9, 35,969 giây. Không tăng
epoch hoặc giảm ngưỡng bằng kết quả test. Config/augmentation đầy đủ, CSV và metrics:
[training report](OCR_MODEL_TRAINING_REPORT.md), [results](ocr-next-four-class-results.json),
[29 epoch CSV](ocr-next-four-class-training.csv).

- Best PT SHA256: `57366ec4d8f477c812635b9644ef1e58c805e8adb63adec454c3996d03904593`.
- ONNX SHA256: `c40c7f3bf9acb774528179e4b78749d1ed19c0872c63d46ee117e873a1b5ced7`.
- Bốn head thực, input `[1,3,416,416]`, output `[1,8,3549]`, FP32/opset17;
  native/ORT parity10/10, .NET tensor parity10/10. Model/ảnh không commit vào Git.

| Lớp | Val P/R | Val mAP50 / 50–95 | Test P/R | Test mAP50 / 50–95 |
| --- | --- | --- | --- | --- |
| Điện cơ | .046 / 1 | .4832 / .2688 | .0051 / 1 | .2296 / .0896 |
| Điện tử | 0 / 0 | .0703 / .0206 | .0051 / 1 | .0523 / .0067 |
| Nước cơ | 1 / 0 | .6657 / .3072 | .0017 / .5 | .4954 / .1002 |
| Nước điện tử | .238 / 1 | .9950 / .7960 | .0017 / 1 | .0829 / .0580 |
| Tổng mAP | — | .5536 / .3481 | — | .2151 / .0636 |

Đây là detection metrics từ evaluator Ultralytics, không phải accuracy của API.
Adapter .NET thật, giữ candidate .25/classification .90/NMS .45, trả unknown toàn
bộ26 ảnh val+test. Confusion theo hàng expected, cột unknown: điện cơ6, điện tử6,
nước cơ5, nước điện tử2, not-meter7; mọi cột accepted bằng0. Recall accepted trên
19 ảnh meter là0; precision accepted không xác định. Không tuyên bố thành công vì
không có false proposal. **Checkpoint bị loại, không bật configuration.**
Cold-load ONNX 139,435 ms; bốn inference đồng thời trên cùng ảnh nhất quán,
74,982 ms tổng. Chỉ kiểm session/thread stability; không đo HTTP load hoặc chứng
minh phân loại đúng. [Runtime checks](ocr-next-four-class-runtime-checks.json).

### Code nhận dạng và kết nối đã sửa

Parser từ chối đơn vị tách riêng như m³/h, L/min, Hz, V, ppm hoặc gallons ở gần số;
nếu thiếu geometry để tách nghĩa thì fallback. Fusion giữ veto
`billing_register_unverified`, không cho Stage2 biến số flow-rate thành chỉ số m³.
Không thêm quy tắc quy đổi hoặc lấp chữ số chưa biết.

Engine/router nay dùng crop DISPLAY đã qua kiểm tra khi kết quả phân loại đáng
tin cậy là nước cơ, rồi chạy PP-OCR + water Stage2 và đối chiếu độc lập như typed
path. Body-only crop không đủ; confidence phân loại và detection giữ riêng.
Crop conflict/blur/orientation/unclear/limit làm fallback. Review preview là dữ liệu
tạm, không lưu thêm ảnh. Test với Stage1/PP/Stage2 thật đọc `00431469` trên fixture
công khai; nhãn classifier trong test này là stub, không dùng làm bằng chứng accuracy
classifier. Engine version: `ocrdoc-ppocrv6-vi-run6-9b534643-yolo2-cache1-category2`.

| Reader | Kết quả hiện tại |
| --- | --- |
| Điện cơ | Giữ PP/manual; chưa có reader chuyên biệt mới được xác thực |
| Điện tử | Giữ PP/manual và kiểm register/đơn vị; chưa có reader chuyên biệt mới được xác thực |
| Nước cơ | Có routing tới Stage1/PP/Stage2 hiện hữu, crop review và fusion veto; baseline accuracy chưa tăng |
| Nước điện tử | Giữ PP/manual; ba preview không đủ train/đánh giá reader, không dùng water mechanical digits thay thế |

Meter metadata server, Staff confirmation, authorization và invoice finalization
được giữ nguyên. Capture tests dùng PostgreSQL/MinIO thật nhưng OCR stub/synthetic
để cố định nhánh nghiệp vụ; các test HTTP/model thật chạy riêng. Chưa chứng minh
toàn chuỗi camera thật → model thật → xác nhận → billing.

### Benchmark cuối và checks đã chạy

Chạy lại baseline52 ảnh,33 có digit GT đầy đủ, cùng corpus cũ, không phải independent
acceptance và chưa có decimal/register GT đủ cho accuracy billing:

| Chế độ | Exact / 33 full labels | False / 33 | Fallback / 52 | p50 / p95 / max ms |
| --- | --- | --- | --- | --- |
| Typed nước cơ | 10 (30,30%) | 0 | 42 (80,77%) | 268 / 1006 / 1251 |
| Automatic | 1 (3,03%) | 0 | 51 (98,08%) | 4174,5 / 6528,15 / 7605 |

Correct/all-input lần lượt10/52 và1/52. Không dùng conditional10/10 hoặc1/1 để quảng
bá100% accuracy. Tất cả52 lượt mỗi chế độ ≤10s ở service; chưa gồm upload, cold start,
storage, HTTP và tải đồng thời. **Không cải thiện accuracy/fallback của baseline.**
Negative controls mới17/17 từ chối đúng,0 phát chỉ số,17 fallback; p50/p95/max
273/5760/5760 ms. Positive accuracy là null, không phải100%.
[Evidence negative](ocr-next-reading-controls-results.json),
[tổng hợp và hash raw](ocr-next-verification.json); raw `.tools/ocr-next-*`.

| Check thực thi | Kết quả |
| --- | --- |
| Release full solution + OcrSmoke build cuối | PASS,0 warnings/errors |
| Application / Domain toàn project | 311 /102 PASS |
| OCR integration, tách ba ca model thật, không CompactPostgres | 130 PASS,0 skip; gồm8 capture PostgreSQL/MinIO |
| Ba ca HTTP/PP/Stage1/Stage2/model thật chạy riêng | 3 PASS,0 skip |
| Targeted routing/fusion; OCR Application | 29;144 PASS, trùng các suite trên, không cộng lại |
| Meter confirmation + hai invoice finalization regressions | 7 PASS,0 skip; PostgreSQL disposable, MinIO thật khi cần |
| Mobile Vitest / typecheck / lint | 386 PASS / PASS / PASS |
| Node dataset validator / Python model tools | 29 /16 PASS |
| ESLint script thay đổi / git diff --check | PASS / PASS |
| ONNX parity native / .NET | 10/10 mỗi phép |
| Camera Android/iOS vật lý | NOT RUN: không có device/camera automation session hoặc adb |
| Positive four-class acceptance đại diện | NOT RUN: thiếu licensed data/GT độc lập đủ chất lượng |

TRX: `tests/backend/BHome.IntegrationTests/TestResults/ocr-next-{integration,real-models,business}.trx`.
Log từng check: `.tools/ocr-next-{final-build,application,domain,integration,real-models,business,mobile-tests,mobile-typecheck,mobile-lint,script-lint}.log`.
Trong quá trình làm có lỗi import sibling module của embedded Python và lỗi trùng
tên biến local khi nối region; đã sửa và chạy lại checks qua. Commons403 xử lý bằng
User-Agent mô tả đúng tác vụ theo policy; Roboflow403/export authentication giữ
nguyên giới hạn truy cập. Không còn test/build failure chưa xử lý ở các checks kể trên.

### Commit và các điều kiện còn thiếu

| Commit Hash | Commit Message | Short Description | Verification |
| --- | --- | --- | --- |
| `edf2861` | `chore(ocr): expand verified meter datasets` | Catalog/license/split và downloads | Prepare62, Python15, Node28 |
| `2f7e954` | `feat(ocr): train four-class meter detector` | GPU train, ONNX, benchmark adapter, rejected |29 epoch, parity10+10, adapter26 |
| `76a326c` | `test(ocr): establish independent reading rejection controls` | Blank annotation và negative-only dataset | Python16, Node29, author/hash/pHash guards |
| `84fd796` | `fix(ocr): reject separately detected non-billing units` | Kiểm đơn vị cạnh số | OCR Application139 |
| `d00c692` | `fix(ocr): preserve non-billing veto during digit fusion` | Chặn fusion bỏ qua unit veto | WaterDigit15 |
| `d30b39f` | `feat(ocr): route classified water to verified display reader` | Crop/routing/fusion thực | Build, targeted29, OCR Application144 |
| `c31892e` | `test(ocr): verify reading rejection and classifier runtime` | Evidence âm và concurrent inference |17 rejects,4 consistent, build |
| `HEAD` (commit báo cáo này) | `docs(ocr): record continuation results and model rejection` | Báo cáo, JSON tổng hợp | JSON/hash/links/diff/history |

Danh sách file thay đổi và full hash sau commit cuối:
`.tools/ocr-next-git-history.md`, tái tạo từ `git log --reverse 83317cb..HEAD`.
Các source chính: Application/Ocr `AutomaticOcr`, `MeterOcrLayout`, `MeterReadingParser`;
Infrastructure/Ocr `MeterRecognitionFusion`, `OnnxOcrEngine`; tests tương ứng;
`VisualCategoryEvaluation`/OcrSmoke CLI; model download/challenge tools; dataset
validator, manifests và evidence/docs liên kết trên. Không push/merge/rebase/deploy.

Còn thiếu positive GT đủ đa dạng cho display/digits/precision/register của bốn loại,
physical-device isolation, model vượt open-set/false-proposal/calibration gates,
reader chuyên biệt điện cơ/điện tử/nước LCD và camera E2E. Ba preview cùng nguồn
không giải quyết thiếu hụt này. Chưa đạt mục tiêu95% classification hoặc90% reading;
không đăng ký model bị loại thành tính năng hoạt động. Tiếp tục cần dữ liệu được cấp
phép với nhãn được kiểm chứng; các gate này không thể hoàn tất bằng cách giảm ngưỡng.

## Tiếp nối ưu tiên Staff từ HEAD9932bdd — 06/11/2026

**Trạng thái: triển khai một phần, chưa production-ready; accuracy nước cơ chưa
tăng.** Điểm bắt đầu thực tế `9932bdd607fc9e7812c931aa39ca68b3cb3e5d9a`, nhánh
`member/QHuy`, working tree sạch. Commit `4d9fa22` đã nằm trong history; không
tái tạo các thay đổi cũ. SRS thực tế BF-05A/B, UC-20/21 và manual/confirmation
requirements đã được đọc. [Traceability](OCR_PRIORITY_TRACEABILITY.md).

### Thay đổi runtime đã chấp nhận

`CaptureWorkflowResources` chỉ resolve khi UtilityType và Display khớp một trong
bốn tổ hợp enum. Không còn mặc định enum sai thành điện/digital. Kiểu nullable
chỉ thuộc kết quả resolve nội bộ; không thêm metadata/schema/endpoint giả.
`OcrWorkflowService` kiểm quyền Staff/Location trước; metadata chưa xác định,
precision ngoài0..4 hoặc previous reading âm trả review/manual trước khi đọc ảnh
hoặc gọi model. Proposal cũ được xóa khi retake không đủ metadata. UI tiếng Việt
giải thích cần Owner kiểm cấu hình. Bốn profile hợp lệ vẫn chọn từ server;
classifier không đổi Meter identity. Không có field billing-register được xác minh
trong Meter hiện tại; nhận diện serial của thiết bị vẫn chưa được thực hiện.

Không thay precision/billing policy hoặc điều kiện xác nhận. Thấp hơn previous
vẫn giữ cảnh báo và confirmation guard hiện có; model unavailable/multiple-meter/
wrong category và unconfirmed proposals giữ fallback/rejection hiện hữu.

Test HTTP mới sử dụng Staff/session thật của test host, PostgreSQL tạm UTF-8,
Stage1/PP/Stage2 ONNX thật và ảnh public pinned `wm_clean_000058.jpg`: server có
precision2 **giả lập cho test** → proposal `004314.69` → chưa có MeterReading →
Staff sửa4314.70 → lưu Corrected với proposal4314.69 riêng → replay cùng ID.
Evidence upload/download có SHA256 trùng bytes; storage trong test là substitute
in-memory, **không phải MinIO thật**. Ca này xác minh orchestration, không chứng
minh billing precision GT của ảnh nguồn hoặc accuracy đại diện.

### Failure audit và thí nghiệm bị loại

[Taxonomy theo52 ảnh](ocr-priority-failure-taxonomy.json) ghép stage evidence
public có hash với runtime mới; không lấy `fusedValue` cũ làm outcome mới. Các
observations không loại trừ nhau:51 unresolved automatic category,26 digit assembly
uncertainty,18 fusion veto/disagreement,13 Stage2 đúng nhưng proposal bị từ chối.
13 ca này chỉ là recovery candidates, không đủ điều kiện bỏ veto. Box/display/
register/decimal GT so sánh và readability review còn thiếu; không biến annotation
`u` thành bằng chứng “đã từ chối đúng ảnh không đọc được”.

Thử nghiệm mới căn PP theo union polygon chữ số Stage2, khác các crop-margin/
CLAHE probe cũ. Validation100 sau loại SHA trùng test;69 digit labels đầy đủ.
Baseline12 đúng/0 sai; permissive13/0 nhưng có thể xóa original numeric disagreement
bằng PP mới malformed; strict yêu cầu PP mới khớp Stage2 chỉ7/0. **REJECTED**, không
chạy candidate trên test, không giảm threshold, không thay runtime reader. Code,
hash guard, kết quả và lệnh tái lập ở [study](OCR_ALIGNMENT_AND_POSITIVE_STUDY.md),
[JSON](ocr-priority-alignment-results.json). Không train lại62 ảnh yếu.

### Dữ liệu và positive inference mới

Đã tìm nguồn mới bằng English/Vietnamese và tải [Badger55 CC BY4.0](https://huggingface.co/datasets/S3CUR/badger-55-watermeter/tree/b49bf7505cf1212de4e4e803bc39e8ce70c6d37e):
4.548 digit crops,4.546 SHA riêng, **một physical meter**; labels còn cần review.
Quarantine, không thêm supervised train/test hoặc suy wheel-transition thành chỉ
số billing. Tool acquisition pin revision/SHA/size và kiểm duplicates/group.
[Audit nguồn](OCR_LICENSED_SOURCE_AUDIT.md), [manifest](../datasets/meter/licensed-meter-source-audit-badger.json).
Nguồn Dryad CC0 mới có detection/segmentation/reading nhưng file403 chưa tải;
mirror có nghi vấn license và nguồn gated không bị vượt truy cập. Vẫn thiếu nước
LCD representative có giấy phép/annotation đủ để train/validate bốn loại.

Duyệt106 ảnh Commons ngoài các author/ID tham chiếu tìm được hai ứng viên digits-only
được freeze trước inference, có source/hash/window/license/group; human annotation
review độc lập thứ hai còn thiếu. Đã chạy model thật, không chỉ validator:

| Category | Automatic classification mới | Display detection | Exact digits mới | Incorrect proposals | Fallback |
| --- | --- | --- | --- | --- | --- |
| Điện cơ | NOT MEASURED positive | NOT MEASURED | NOT MEASURED | NOT MEASURED positive | NOT MEASURED positive |
| Điện LCD | 1 unknown/1 frame, không accepted class | Chỉ có oracle window, không đo localization accuracy | 0/1 selected window mỗi PP mode | 0; full-frame ba meter không proposal | 1/1 mỗi PP oracle mode; full-frame rejection1/1 |
| Nước cơ | 1 unknown/1 frame, không accepted class | Một ảnh clear nhưng Stage1 không thấy display | 0/1 full-frame và0/1 từng oracle mode | 0 | 1/1 từng mode |
| Nước LCD | NOT MEASURED positive | NOT MEASURED | NOT MEASURED | NOT MEASURED positive | NOT MEASURED positive |

Hai positive candidates **không được nhận dạng đúng**, không gọi là hoàn tất
positive acceptance. Điện LCD có ba meter: full-frame chỉ dùng cho rejection,
không đưa selected-window GT vào mẫu số full-frame positive. Oracle crop không
đo localization. Decimal/register billing accuracy=null. [Evidence](ocr-priority-positive-results.json).
Các model điện cơ/điện tử/nước LCD chuyên biệt và four-class classifier vẫn chưa
đạt gate; checkpoint cũ giữ disabled. Không activate model hoặc đổi appsettings.

Frozen historical water benchmark chạy lại, tách khỏi hai ảnh mới:

| Mode | Exact /33 full labels | Incorrect /33 | Fallback /52 | Correct/all inputs | Correct/emitted | p50/p95/max ms |
| --- | --- | --- | --- | --- | --- | --- |
| Trusted mechanical-water | 10 | 0 | 42 | 10/52 | 10/10 | 203/779.8/866 |
| Automatic | 1 | 0 | 51 | 1/52 | 1/1 | 2873.5/5940.5/7494 |

Đây là digit sequence trên corpus tác giả cũ, chưa có billing-decimal GT và chưa
independent acceptance. Không quảng bá precision10/10 thành accuracy100% đại diện.
Negative controls chạy lại17/17 reject,0 proposals; [JSON](ocr-priority-negative-results.json).
Không dùng negative-only score để tuyên bố reader đọc được positive.

### Kiểm chứng thực thi trong lượt này

| Check | Kết quả mới |
| --- | --- |
| Backend solution Release build cuối | PASS,0 warning/error |
| Application / Domain | 321 /102 PASS |
| OCR integration không Docker/CompactPostgres, có opt-in model thật | 125 PASS,0 skip |
| PostgreSQL metadata/confirmation + invoice finalization/meter job | 6 PASS,0 skip; storage substitute |
| HTTP task + ONNX thật + correction/evidence/replay | 1 PASS,0 skip; PostgreSQL thật, storage substitute |
| Mobile Vitest với Node22 của repository | 389 PASS; typecheck/lint PASS |
| Node dataset / Python meter tools / alignment summary | 29 /29 /3 PASS |
| Manifest positive mới | valid=true,2 samples; đây chỉ là cấu trúc/hash |
| Stage2 .NET với native reference pinned | 10/10; input max delta0; không chạy lại PyTorch native |
| Validation/test overlap guard | Từ chối manifest có SHA trùng test, không tạo output |
| MinIO thật | NOT RUN: không có service MinIO local/Docker daemon dùng được |
| Camera Android/iOS vật lý | NOT RUN: không có camera session được điều khiển/adb |
| Representative positive four-category/billing acceptance | NOT RUN: thiếu verified independent data |

Các lỗi đầu lượt đã xử lý và chạy lại: build cùng lúc OcrSmoke gây2 file-copy retry
warnings (build cuối0); npm.ps1 bị execution policy (dùng npm.cmd); Node toàn cục
không thuộc22 gây12 startup-test failure (Node22 qua389); cluster test ban đầu
WIN1252 gây JSON Unicode error (cluster UTF8 riêng qua6); fixture tạo hai active
water meters cùng Room bị409 (tách Rooms); token từ test host có signing key khác
bị401 (đăng nhập đúng target host). Không sửa production safeguards để làm test qua.

TRX `ocr-priority-{metadata,real-ocr,workflow,real-workflow}.trx` trong test project
tương ứng; log `.tools/ocr-priority-*.log`. [Verification JSON](ocr-priority-verification.json)
ghi hash evidence, số kiểm chứng, test chưa chạy và các blocker.

### Files, lệnh tái lập và Git

Source: Application `OcrWorkflowService`; Infrastructure `CaptureWorkflowResources`;
Mobile `meterOcrFeedback`; unit/UI tests tương ứng; `CaptureWorkflowTests` và
`CompactMeterOcrWorkflowTests`; OcrSmoke `ReviewedPositiveEvaluation`,
`WaterDigitAlignmentStudy`, Program; Python taxonomy/acquisition/summary tools;
manifests/results/docs liên kết. Không sửa financial calculation/schema.

```powershell
dotnet build src/backend/BHome.sln -c Release --no-restore
dotnet test tests/backend/BHome.Application.UnitTests -c Release
dotnet test tests/backend/BHome.Domain.UnitTests -c Release
$env:BHOME_OCR_LOCAL_EVALUATION_ROOT=(Get-Location).Path
dotnet test tests/backend/BHome.IntegrationTests -c Release --filter 'FullyQualifiedName~Ocr&Category!=Docker&Category!=CompactPostgres'
# Set BHOME_COMPACT24_TEST_ADMIN to an isolated authorized UTF8 loopback admin only.
dotnet test tests/backend/BHome.IntegrationTests -c Release --filter 'FullyQualifiedName~CompactMeterOcrWorkflowTests|FullyQualifiedName~Compact24InvoiceRegressionTests.Finalization|FullyQualifiedName~Compact24PaymentRegressionTests.MeterAutomation'
Push-Location src/mobile
& ../../.tools/node-v22.23.4-win-x64/node.exe ../../node_modules/vitest/vitest.mjs run --config vitest.config.ts
npm.cmd run typecheck
npm.cmd run lint
Pop-Location
node.exe --test tests/scripts/MeterDataset.test.cjs
.tools/yolo-python/python.exe -m unittest discover -s tests/scripts -p 'test_*meter*.py'
.tools/yolo-python/python.exe tests/scripts/test_water_alignment_summary.py
```

Acquisition, alignment, positive evaluator và parity reproduce commands nằm trong
hai study/source report; baseline CLI giữ `--meter-completion-evaluate` với corpus52.
Model binaries, crop tạm, parquet và ảnh public ngoài Git. Không ảnh CCCD thật,
secrets, real Tenant data hoặc weights mới được commit.

| Commit | Work unit đã kiểm chứng |
| --- | --- |
| c2027d2 | Metadata-guided Staff review/validation + UI/tests |
| 5d921ce | Per-image failure taxonomy và frozen baseline |
| 2db6232 | PostgreSQL profile/scope/proposal/confirmation regressions |
| a1abcef | Licensed source acquisition/audit, quarantine và positive candidates |
| cd8fb3b | Real ONNX HTTP task → Staff correction/evidence/replay |
| f061811 | Rejected alignment study và positive/negative inference evidence |
| HEAD của commit báo cáo | Báo cáo trạng thái có bằng chứng |

Final HEAD và working-tree status được ghi sau commit tại
`.tools/ocr-priority-final-state.json`; history đầy đủ tái tạo vào tệp IDE đang mở
`.tools/ocr-next-git-history.md` (`git log --reverse 9932bdd..HEAD`). Các commit là
local; không push/merge/rebase/deploy. Process PostgreSQL riêng cho lượt test được
dừng sau kiểm chứng; không dùng database thật của người dùng.

Còn thiếu: cải thiện accuracy/fallback thực tế được xác minh; positive data đại diện
và human-reviewed GT đủ bốn loại; precision/register/location ground truth; reader
và classifier qua gate; MinIO transport và physical camera E2E. Không đánh dấu các
phase bị chặn dữ liệu/môi trường là đã hoàn tất.
