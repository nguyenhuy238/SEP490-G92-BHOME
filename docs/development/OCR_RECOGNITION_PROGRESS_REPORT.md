# Tiến độ nhận dạng công tơ — 07/11/2026

Kết quả lượt tiếp theo ở
[OCR_NEXT_RECOGNITION_IMPROVEMENT_REPORT.md](OCR_NEXT_RECOGNITION_IMPROVEMENT_REPORT.md).
Các số dưới đây giữ nguyên làm baseline lịch sử.

**Chưa đạt nhận dạng và đọc số an toàn cho cả bốn loại.** Đã chạy thêm inference
thật cho readability, localization, classifier phân cấp và đọc bánh số điện.
Classifier phân cấp nhận đúng thêm 3/9 ảnh meter so với direct CLIP trên cùng bộ
test lịch sử; chưa có bằng chứng để kích hoạt production. Không có model mới
`ACCEPTED`. Người dùng xác nhận tiếp tục với nhãn provisional khi chưa có reviewer.

## 1. Git và traceability

Starting HEAD `3a8a6e15545e4abb6191d85c434b753d8956f1eb`, branch `member/QHuy`,
working tree sạch. Đây là lượt tiếp theo của
[báo cáo trước](OCR_FOUR_CLASS_RECOGNITION_COMPLETION.md), không chạy lại training
trên weak62, không huấn luyện bằng historical test hoặc nhãn số chưa duyệt.

| Hành vi yêu cầu → nguồn | Thành phần ảnh hưởng | Acceptance / negative cases |
| --- | --- | --- |
| OCR là đề xuất, Staff xác nhận: BF-05 / UC-20 / GBR-07 | Offline model tools, blinded review pack; runtime giữ nguyên | Đọc được positive; blank/segment/serial không thành số billing; không tự confirm |
| Chọn vùng số, phân biệt loại từ ảnh: task hiện tại + UC-20 | CLIP, Grounding DINO, Stage2/Paddle component studies | Cùng ảnh/split/GT; oracle crop tách full-frame; không dùng filename/OCR metadata để suy loại |
| Chỉ confirmed reading đi vào hóa đơn: UC-21 / JOB-10 / GBR-09 | Không đổi invoice/API/schema | Test confirmation, finalization, payment/meter automation và quyền Location |

Task hiện tại cho phép nghiên cứu provisional, không phê duyệt nhãn thành GT hay
thay đổi chính sách billing. Các tham chiếu nghiệp vụ dùng guardrail AGENTS và
mapping sẵn có; lượt này không diễn giải lại nguyên văn báo cáo SRS .docx.

## 2. Baseline đã đối chiếu

| Baseline tại starting HEAD | Kết quả lịch sử, không phải independent acceptance |
| --- | --- |
| CLIP direct, 15 test:9 meter +6 negative | Đúng accepted2/9; sai accepted0/15; unknown13/15 |
| YOLO display 416, 4 Commons test | Numeric-proxy IoU≥.5:1/4, chỉ blank; readable0/3 |
| English/mobile và multilingual/server CTC, 4 oracle LCD crop | Mỗi model đúng2/3 readable; sai numeric2/4 gồm blank và water disputed |
| Water mechanical full pipeline | Historical exact10/33, fallback42/52; auto exact1/33, fallback51/52 |
| Weak62 four-class YOLO và CC0 LCD CRNN | Đã rejected ở lượt trước; CRNN historical exact0/3 |

Baseline direct CLIP đã replay trong study mới: max score delta **0.0** với report
cũ. Các số water10/33 không benchmark lại hoặc dùng để tune trong lượt này.
Verification toàn repository được chạy lại ở mục 10; test pass không chứng minh
accuracy trên ảnh thật.

## 3. Dataset, nhãn và human review

[Pilot12 ảnh](../datasets/meter/RECOGNITION_STATE_PILOT.md) gồm6 Kaggle +6 Commons:
11 electricity digital,1 water digital;9 chuỗi nháp,2 blank/inactive,1 disputed
digit. Mọi nhãn mới **provisional**, human reviews **0**, independent exact labels
**0**. 12 ảnh này dùng chuẩn bị review; không phải 12 positive độc lập mới.
Blinded pack tại `.tools/ocr-next-pilot-review/index.html`; không chứa gợi ý số
của model/agent. View A/B/C/D tách category/body, window, digits và negative state;
blank/obscured/segment-test không vào numeric-training view. Chưa có bbox người
review thì giữ null. Không coi hai ID tự khai là hai reviewer độc lập.

Không có SHA trùng hoặc cặp pHash63 distance≤6 trong pilot; physical independence
vẫn unknown. Toàn Kaggle giữ một source group; không random split các crop cùng
thiết bị. Body/window proxies và provenance được giữ riêng. Nhãn review mới chưa
được dùng huấn luyện supervised reader nào.

[Pilot bánh số điện](../datasets/meter/mechanical-electric-provisional-pilot.json)
thêm3 oracle crops từ historical classification TRAIN, chưa được dùng numeric
training:2 chuỗi provisional và1 rolling digit để null. Đây không phải independent
test, không suy precision hay register từ dự đoán. Pointer dials không phải digit
wheels; ảnh nhiều register hoặc glare không được gán số tùy ý.

Các điều chỉnh phạm vi nghiên cứu, không sửa historical GT:

- `commons_141189268`: giữ frozen000880578 và tính sai của historical benchmark;
  pilot mới để digits=null, uncertainPositions=[7], chưa phân xử glyph1/7.
- Preview8/37 có dấu vết000000.00 và status code, không đủ chứng cứ coi blank;
  nghiên cứu mới giữ unknown. Preview48 toàn segments/annunciators chỉ là control
  segment-test provisional, license phi thương mại, không đưa vào model sản phẩm.
- [Mendeley fnn44p4mj8 v1](https://data.mendeley.com/datasets/fnn44p4mj8/1) là
  seven-segment **digital energy meter**, CC0;163 prepared crops không phải
  mechanical-water data. Không dùng dataset này để tuyên bố hỗ trợ water wheels.
- Ảnh [Digital Water Meter](https://commons.wikimedia.org/wiki/File:Digital_Water_Meter.jpg)
  mới vẫn HTTP429; dừng acquisition, không đổi host/vượt hạn chế. Ảnh water thứ hai
  đã có bị glare và có nhiều thiết bị; không tạo exact GT giả.

## 4. Display readability — thực nghiệm có positive và negative

Inference CLIP local + pixel contrast + cấu trúc nét/holes;5 nhóm prompt cố định:
readable candidate, blank/unpowered, segment test, obscured và unknown/status.
Nhóm unknown chưa thay thế được classifier xác minh wrong billing register.
Letterbox toàn display ở224 giữ outer digits; không center-crop mất đầu/cuối số.
Threshold chọn trên11 calibration:7 provisional readable +4 negative gồm blank,
segment test và2 publisher serial crops; đóng băng trước historical test5 ảnh.
Test có3 readable +2 blank/inactive. Segment/status held-out đa thiết bị còn thiếu.

| Gate | Readable giữ được /3 | Negative chặn /2 | Sai numeric /5 | Exact frozen /5 | Fallback /5 |
| --- | --- | --- | --- | --- | --- |
| Không gate: English hoặc server | Không áp dụng | Không áp dụng |2|2|1|
| Pixel contrast |0|2|0|0|5|
| CLIP visual state |1|0|1|1|3|
| Visual + contrast |1|0|1|1|3|
| Visual + contrast + segment structure |1|2|0|1|4|
| Shape primary |0|2|0|0|5|

Pixel/shape-primary không tìm được positive policy an toàn trên calibration nên
reject-all, **REJECTED**. Shape-combined chặn hai blank nhưng mất2/3 readable,
**REJECTED activation**. Không gọi việc giảm sai2→0 trong khi exact2→1 và fallback
1→4 là hoàn tất blank recovery. Chuỗi88888 không bị loại bằng regex; model phải
dựa trên ảnh. Control repeated digits không tự mang nghĩa blank. Cả English và
server cho cùng bảng numeric này; output component không phải API proposal.
[Kết quả từng ảnh và policy](ocr-progress-readability-results.json).

Tách hai category trong cùng5 oracle test inputs (English và server giống nhau):

| Category / số ảnh | Ungated exact / sai numeric / fallback | Shape-combined exact / sai numeric / fallback |
| --- | --- | --- |
| Electricity digital /3, gồm1 blank |2 /1 /0|1 /0 /2|
| Water digital /2, gồm1 blank |0 /1 /1|0 /0 /2|

Không được báo water gate là thành công khi nó không đọc đúng positive nào.

## 5. Localization và domain mismatch

314 reading boxes Kaggle: relative area p10/median/p90≈1.82%/4.48%/9.01%; chiều
cao sau resize416≈24.2/38.6/53.7px. Hai electricity LCD test readable Commons chỉ
≈18.5/18.2px. Kaggle thường bao whole LCD/units; frozen Commons proxy là vùng số.
Khác miền và khác độ chi tiết annotation đều ảnh hưởng; không sửa GT để tăng IoU.

Đã chạy **Grounding DINO tiny** thật với full frame và oracle meter body, prompt
`lcd screen.` / `digital meter reading display.`, short-edge640/800, max1333.
Chọn prompt/resolution/score từ2 validation trước4 test. Model Apache-2.0,
[official source](https://huggingface.co/IDEA-Research/grounding-dino-tiny), pinned
revision/hash ở [receipt](../../tools/BHome.OcrSmoke/model_tools/grounding-display-receipt.json).

| Input / model | Test localized proxy IoU≥.5 /4 | Readable /3 |
| --- | --- | --- |
| Full-frame YOLO416 |1, blank|0|
| Oracle-body YOLO416 |1, blank|0|
| Full-frame Grounding DINO, selected800 |0|0|
| Oracle-body Grounding DINO, selected640 |0|0|

Grounding thường bỏ sót LCD hoặc bao generic meter body. Body oracle không cứu
localization; không có improvement được acceptance. Một YOLO crop IoU≈.399 đọc
ra chuỗi khác nhau/prefix dư, không sửa bằng cách strip ký tự theo expected.
Oracle digit crops vẫn English/server2/3 readable; đây là ceiling component,
không phải kết quả end-to-end. [Geometry, OCR và domain analysis](ocr-progress-localization-results.json).

## 6. Digital reader

So sánh lại hai reader thật English/mobile và multilingual/server CTC với cùng
oracle crops và các detector crops. Trên5 readability test, ungated mỗi reader:
2 exact frozen,2 incorrect numeric,1 fallback. Water disputed vẫn tính trong sai;
không đổi GT theo English. Chưa xác minh register/decimal/unit cho phép billing.

Không train lại CRNN đã all-blank bằng nhãn provisional hoặc chọn epoch vì blank
suppression. Training reader mới trên dữ liệu đa thiết bị được human-review:
**BLOCKED_BY_DATA**. LED representative evaluation: **NOT_RUN**. English CTC và
server CTC trong scope activation chung: **REJECTED**. Chúng vẫn hữu ích để chẩn
đoán component; Python/.NET English parity4/4 được chạy lại, không phải accuracy.

## 7. Mechanical reader

Chạy PP direct/page, English CTC và water Stage2 trên3 oracle wheel crops, crop
và provisional labels đóng băng trước inference. Hai ảnh có chuỗi nháp:

| Reader | Khớp nháp /2 | Numeric khác nháp /2 | Không có numeric /2 |
| --- | --- | --- | --- |
| PP direct |0|0|2|
| PP page |0|1|1|
| English |1|1|0|
| Water Stage2 transfer |0|1|1|

Stage2 có lần trả0034 thay vì đủ6 chữ số. Đây là thiếu digit chứ không phải
recognition thành công. Ảnh thứ ba rolling digit chưa có GT: PP239659,
English239657,Stage2 239654; giữ riêng cả ba, không vote/ưu tiên một chuỗi làm GT.
English khớp1/2 trên oracle provisional chưa đủ để bật electricity runtime.
Stage2 water→electricity transfer: **REJECTED**. Whole-frame wheel localization,
pointer-dial numeric reading và diverse independent electricity GT vẫn thiếu.
[Observations có model/crop hashes](ocr-progress-mechanical-results.json).

Water mechanical: giữ nguyên historical full10/33 exact, fallback42/52; không có
candidate mới đủ bằng chứng. Numeric disagreement/unclear-digit/geometry/partial
checks không bị nới. Stage2/native parity10/10 chạy lại, không suy thành accuracy.

## 8. Direct và hierarchical visual classifier

Cùng pinned CLIP weights, frozen historical manifest, image pixels; không đọc
filename/OCR/metadata để quyết định loại. Direct5 classes so với utility3-way
(electricity/water/not-meter) rồi technology2-way(mechanical/digital). Chỉ accept
khi cả hai heads đạt confidence và margin. Threshold chọn trên11 validation;
test15 gồm9 meter +6 negative. Pretraining overlap unknown, không độc lập.

| Input / strategy | Đúng accepted /9 meter | Sai accepted /15 | Unknown /15 | Negative false accepted /6 |
| --- | --- | --- | --- | --- |
| Full-frame direct |2|0|13|0|
| Full-frame hierarchy |5|0|10|0|
| Oracle-body direct |1|0|14|0|
| Oracle-body hierarchy |3|1|11|0|

Body oracle gây1 mechanical-electricity→digital sai; không mặc định crop là tốt
hơn. Full-frame hierarchy: **EXPERIMENTAL**, chưa export/activate; direct:
**REJECTED activation**. Không có meter counting/boxes/mAP từ CLIP. P95 forward
chung3 prototype heads trên GPU khoảng17.1ms full-frame,17.8ms oracle-body, không
bao preprocessing/API/queue, không phải latency SLA. [Confusion và scores](ocr-progress-hierarchy-results.json).

## 9. Kết quả positive theo loại và activation decisions

| Category | Visual direct → hierarchy, full-frame | Exact reading evidence | Trạng thái |
| --- | --- | --- | --- |
| Electricity mechanical |0/3 →1/3|English1/2 oracle **provisional**, Stage2 0/2; full-frame mới chưa đo|EXPERIMENTAL; BLOCKED_BY_DATA cho acceptance|
| Electricity digital |2/3 →3/3|English/server2/2 readable oracle; blank có numeric sai; detector readable0/2|REJECTED activation|
| Water mechanical |0/2 →1/2|Historical full10/33; không đo lại mới|Baseline giữ nguyên, không có accepted improvement|
| Water digital |0/1 →0/1|Frozen readable0/1; disputed glyph; blank control không có số|BLOCKED_BY_DATA; reader REJECTED|

Không gộp component/exact/provisional vào accuracy billing. Positive independent
four-class accuracy và independent exact-reading accuracy: **NOT MEASURED**.
New supervised four-class training, reader fine-tuning: **BLOCKED_BY_DATA**.
Grounding localization: **REJECTED**. Previous YOLO display, weak62 detector và
CRNN: giữ **REJECTED**; không tái huấn luyện với dữ liệu không đổi.

Runtime integration mới: **NOT_RUN**, vì không model mới nào qua positive và
safety gates. Accepted model count lượt này **0**. API/DTO/DI/config/schema,
authorization, meter metadata, unknown fallback, Staff correction/confirmation,
invoice và payment giữ nguyên. CLI nghiên cứu nằm trong OcrSmoke, không phải API.

## 10. Regression và thiết bị/hạ tầng

[Verification receipt](ocr-progress-verification-results.json) giữ commands,
kết quả và hash logs local; không dùng số test làm độ chính xác model.

| Check đã chạy sau code | Kết quả |
| --- | --- |
| Backend solution Release build, no-restore |PASS,0 warnings/0 errors|
| Application / Domain unit tests |PASS325 /106|
| OCR integration, loại Docker/CompactPostgres, pinned local models |PASS125,0 skipped|
| PostgreSQL workflow + real ONNX + invoice finalization/payment automation |PASS7,0 skipped; storage substitute in memory|
| Python scripts unit/regression |PASS49|
| Node dataset tests |PASS29|
| Mobile Vitest |PASS56 suites/576 tests|
| Mobile TypeScript / ESLint |PASS / PASS|
| Stage2 native/.NET parity / English Python/.NET parity |PASS10 /4 crops|
| Mechanical component benchmark |Đã chạy12 observations; không independent acceptance|
| Real camera |NOT_RUN: không có adb/device được kết nối qua môi trường này|
| Real MinIO |NOT_RUN: không listener9000/9001, Docker daemon unavailable|

PostgreSQL disposable đã có được chạy ở loopback55493 bằng test role, test tự tạo
và dọn DB; server đã dừng sau suite. In-memory evidence test không phải MinIO E2E.
Đã kiểm Docker: CLI có nhưng lỗi missing dockerDesktopLinuxEngine pipe. Không
thay camera thật bằng ảnh file để gọi là camera pass. Không có hardware/cloud
deployment hay model activation.

Lỗi trong quá trình làm: build đầu của smoke study lỗi dấu ngoặc C#; đã sửa trước
commit và chạy thành công benchmark/build sau đó. Test readability ban đầu phụ
thuộc optional Transformers khi import; đã tách pure policy và chạy cả49 tests
không cần optional research packages. Không có failing check chưa xử lý trong
các suite đã chạy; device/MinIO/independent acceptance vẫn chưa được xác minh.

## 11. Blockers và gói tiếp nhận tiếp theo

Cần hai người review pilot mù, phân xử disputed digits, body/window/register và
precision; số reviewer hiện0 không thay đổi khi người dùng cho phép provisional.
Cần readable water LCD từ nhiều thiết bị (không chỉ một ảnh), wheel-electricity
và pointer dials tách style, active/blank/segment/status pairs, register/decimal
GT và source/physical-meter groups trước split. Không dùng review consensus tự
khai làm independent acceptance khi chưa xác minh người review.

Hướng có tín hiệu hiện tại là full-frame utility→technology classifier. Chỉ
calibrate/train tiếp trên group-reviewed train/validation và đánh giá một bộ mới
độc lập; không tune tiếp historical test để nâng5/9. Readability phải giữ được
readable positives đồng thời chặn blank/invalid, localization phải tìm đúng số
trước khi đánh giá reader E2E. Camera/MinIO cần môi trường thật để đóng gate.

## 12. Incremental commits và final state

| Commit | Nội dung |
| --- | --- |
|e6bdf8b|Prepare provisional12-image state pilot and blinded review workflow|
|e157f3a|Evaluate actual display-state and numeric gate tradeoffs|
|f5dd307|Isolate pure policy tests from optional model dependencies|
|6ccb35f|Compare Grounding DINO, YOLO and oracle localization; record domain gap|
|09b4588|Measure direct vs hierarchical visual classification|
|3648d46|Probe electricity wheel readers and preserve numeric disagreement|
|Commit chứa report này|Record measured results, replay commands and final verification|

Final reporting HEAD là commit chứa file này; hash đầy đủ và working-tree status
sau commit ghi tại `.tools/ocr-recognition-final-state.json`, chronological log
tại `.tools/ocr-next-git-history.md`. Không nhúng hash chưa được tạo vào chính
commit đó. Không push, merge, rebase, squash, reset hoặc deploy. Mục tiêu bốn loại
đọc đúng billing vẫn pending; không đánh dấu hoàn tất từ export, fallback hay
test pass.
