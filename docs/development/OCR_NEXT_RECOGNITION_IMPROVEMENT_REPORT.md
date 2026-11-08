# Cải thiện nhận dạng công tơ tiếp theo — 07/11/2026

**Có thêm một chuỗi LCD đúng ở mức component, chưa có model mới đủ điều kiện bật
runtime.** Trên cùng5 ảnh full-frame provisional, native text + row margin đọc
đúng2/2 positive so với1/2 của native text crop ban đầu, nhưng vẫn trả số ở1/3
invalid controls. Classifier chưa cải thiện trên bộ ảnh khác nguồn tác giả.
Không tuyên bố hoàn tất nhận dạng/billing bốn loại hoặc independent acceptance.

## 1. Starting state và traceability

Starting HEAD `2168006f11a91e11176bb59f419577363ac5c544`, branch `member/QHuy`,
working tree sạch. Đã đọc AGENTS, CONTRIBUTING, latest progress/completion,
failure-root-cause, dataset/review instructions, evaluation JSON và model tools.
[Báo cáo trước](OCR_RECOGNITION_PROGRESS_REPORT.md) là baseline; không tái tạo
commit, không tune bộ9 meter lịch sử, không train lại weak62 YOLO/all-blank CRNN.

| Yêu cầu → nguồn                                                        | Thành phần                             | Kiểm chứng / ranh giới                                                                              |
| ---------------------------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Type từ pixels, đúng display/digits: task hiện tại, BF-05/UC-20/GBR-07 | Offline CLIP/localization/reader tools | Source-group/hash/pHash audit; raw strings; positive/negative và oracle/full-frame riêng            |
| OCR là suggestion, Staff xác nhận: UC-20/GBR-07                        | Runtime không đổi                      | OCR125 và PostgreSQL7 workflow; giữ Location authorization, Meter metadata, correction/confirmation |
| Confirmed reading mới đi vào billing: UC-21/JOB-10/GBR-09              | Không sửa invoice/payment/API/schema   | Finalization/payment automation trong7 workflow; không tự xác nhận số từ model                      |

Mapping nghiệp vụ dựa trên repository guardrails và tài liệu mapping hiện có;
lượt này không đọc lại hay diễn giải policy mới từ SRS .docx. Không thay đổi
nghiệp vụ tiền, quyền, precision, occupancy hoặc status.

## 2. Baseline trước lượt này

| Phạm vi lịch sử                               | Kết quả đã ghi nhận                                                     |
| --------------------------------------------- | ----------------------------------------------------------------------- |
| Full-frame direct CLIP,9 meter +6 negative    | 2/9 correct accepted,0/15 incorrect,13/15 unknown                       |
| Full-frame hierarchical CLIP, cùng ảnh        | 5/9 correct accepted,0/15 incorrect,10/15 unknown                       |
| Historical readable LCD localization          | YOLO416/Grounding DINO readable0/3; oracle body không giải quyết        |
| Historical5 LCD crops, không readability gate | English/server:2 exact,2 incorrect numeric,1 fallback                   |
| Shape-combined gate, cùng5                    | Giữ1/3 readable, chặn2/2 invalid;1 exact,0 incorrect,4 fallback         |
| Mechanical water full runtime benchmark       | Historical10/33 exact;42/52 fallback; không phải independent acceptance |
| Mechanical electricity oracle provisional     | English1/2; water Stage2 transfer0/2; rolling label chưa giải quyết     |

Historical classification scores được phân tích bằng JSON đã có; không chạy lại
hoặc chọn prompts/threshold trên9 test meter cũ.

## 3. Dataset và provisional/verified labels

[Classification manifest](../datasets/meter/continued-classification-provisional.json)
giữ36 historical TRAIN để tạo few-shot prototypes;7 validation mới,9 held-out
provisional mới và2 multi-meter challenges. Validation/test/challenge khác tác
giả với historical62 và negative-reading controls; cùng author/site ở test và
challenge giữ cùng held-out role. Đã kiểm SHA và DCT63 pHash≤6 trước inference.
Đây là **author-group separation trong Commons**, không phải chứng minh hai
platform/site hoàn toàn độc lập hoặc physical-meter independence.

Test9 có7 category positives:2 electricity mechanical,2 electricity digital,
2 water mechanical và1 water digital **product illustration**;2 negative controls.
Ảnh render không thay thế real-photo water LCD. Tuning/calibration được đóng băng
vào `selection-before-test.json` trước khi inference test. Historical test/control
không đi vào train hoặc selection. Model pretraining overlap vẫn unknown.

Đã tải/kiểm public assets từ catalog hiện có và thêm
[2 nguồn Commons](../datasets/meter/continued-public-sources.json). Không gọi mọi
file được tải lại là một ảnh độc lập mới. Kiểm nội dung ảnh cho thấy:

- [Digital Water Meter](https://commons.wikimedia.org/wiki/File:Digital_Water_Meter.jpg)
  hiển thị **bánh số cơ khí**, dù caption gọi digital; không thêm vào water LCD.
- [City water meter](https://commons.wikimedia.org/wiki/File:City_water_meter.jpg)
  chỉ thấy nắp đậy, phù hợp negative/visibility control, không có reading GT.
- “Static Watthour Meter” mới kiểm cũng dùng bánh số; tên thiết bị không phải
  nhãn công nghệ hiển thị. Không dùng filename/caption/OCR/metadata để classifier
  quyết định type.

[Display manifest5 ảnh](../datasets/meter/continued-display-provisional.json) tách
`meter_body`, `display_screen`, `numeric_register`, `serial_region`,
`non_billing_display`. Screen và numeric boxes được agent đánh dấu riêng từ ảnh;
chưa có annotation thì null, không gọi whole screen là numeric-register GT.
2 chuỗi LCD nháp là16254 và000501; ảnh thứ ba blurred để digits=null.
[Wheel manifest](../datasets/meter/continued-wheel-provisional.json) có1 chuỗi
electricity nháp12615 và2 rolling rows để null, không vote/model-labeling.

Human reviews **0**; independently verified exact labels mới **0**. Mọi tọa độ,
category và chuỗi mới đều provisional. `commons_48039403` có enclosure/display
khó xác định technology; frozen category của classifier vẫn giữ nguyên để không
sửa kết quả sau inference, cần human review. `commons_11930077` có terminal edge
gây output thừa1; vẫn giữ nháp12615 và tính không khớp, không đổi GT theo readers.

## 4. Classifier audit và các candidate

So sánh fixed hierarchy(.85 utility/.65 technology), physical-description prompts,
letterbox toàn ảnh, TTA±7° và few-shot cosine prototypes với visual weight.25/.50/.75.
Few-shot dùng classification TRAIN, không dùng numeric labels hoặc test. Chọn
policy trên7 validation mới với ràng buộc có positive đúng và0 wrong acceptance.
**Không candidate mới nào thỏa điều kiện**, nên policy=null, không giả vờ reject-all
là improvement. [Scores, grid và quyết định](ocr-continued-classifier-results.json).

| Strategy / new9 probes                     | Correct /7 category positives | Incorrect /9 | Unknown /9 | Non-meter false /2 |
| ------------------------------------------ | ----------------------------- | ------------ | ---------- | ------------------ |
| Frozen hierarchy                           | 1                             | 2            | 6          | 1                  |
| Physical prompts, letterbox, TTA, few-shot | 0 mỗi candidate               | 0            | 9          | 0                  |

Frozen hierarchy per-class recall: electricity mechanical0/2, electricity
digital0/2, water mechanical1/2, water digital0/1 illustration. Accepted precision
1/3. Đây không phải so sánh5/9→1/7 trên cùng ảnh hoặc independent accuracy.

Head-level failures: electricity utility đúng nhưng confidence.797/.846 thấp hơn
.85 ở hai ảnh; L7C2 utility.949 nhưng mechanical.536; water wheel bị utility
electricity.864; nắp nước được nhận water.867 +mechanical.996. Illustration water
LCD lại nghiêng mechanical.911. Do đó thiếu negative/body/style evidence và
confidence calibration; chỉ đổi prompt hoặc nới threshold không giải quyết.

P95 preprocessing+encoder trên9 probes khoảng30ms frozen,24ms letterbox và276ms
TTA; ít mẫu, gồm first-use effects, không phải API/SLA. Classifier không đếm meter;
2 multi-meter challenges chỉ có raw head scores, **counting/selection NOT SUPPORTED**.

## 5. LCD localization: actual predictions và annotation taxonomy

Đã chạy single416, overlapping native tiles640/416, predicted YOLO body→display,
predicted body→tiles, DB text detector native-max1280 và screen→text cascade.
Giữ geometry/offset về ảnh gốc; cohort3 màn hình(validation1,test2) có2 readable
và1 blurred. Các số
sau là **raw top proposal trước acceptance threshold**, không phải API success:

| Method                  | Screen IoU≥.5 /3           | Numeric IoU≥.5 /3 | Calibration policy       |
| ----------------------- | -------------------------- | ----------------- | ------------------------ |
| Full416                 | 2                          | 0                 | .25                      |
| Tiles640                | 2                          | 1                 | Không có eligible policy |
| Tiles416                | 2                          | 1                 | .25                      |
| Predicted body→display  | 1                          | 0                 | Không có eligible policy |
| Predicted body→tiles416 | 0                          | 0                 | Không có eligible policy |
| Native text1280         | Không phải screen detector | 2                 | .7                       |
| Screen→native text1280  | 2                          | 1                 | Không có eligible policy |

Full416 có box screen IoU.845 ở clear test nhưng score.224 dưới selected.25;
không tính accepted localization. Tiling tìm được blurred LCD bị full416 bỏ sót,
nhưng tiles416 chọn nhầm vùng ở clear LCD. Body cascade không có gain an toàn.
Không đổi numeric GT để screen detector “pass”; serial/non-billing GT còn thiếu.
[Boxes, scores, OCR và latency](ocr-continued-localization-results.json).

Native text tìm đúng numeric region nhưng bỏ chữ số1 mảnh bị tách khỏi cụm text.
Row margin cố định.5×predicted row height lấy thêm **pixel thật** hai bên, không
fill digit, không dùng expected count/range. Đây là hypothesis sau failure
analysis, đánh giá **exploratory**, không đổi tên thành fresh independent test.

## 6. Readability: học từ ảnh, không dùng chuỗi số làm bằng chứng

Học logistic L2 từ6 pixel/topology features và5 CLIP-state scores trên11 calibration
images cũ; chọn regularization/threshold bằng leave-one-source-group-out, đóng
băng trước new/historical evaluation. Không dùng numeric OCR làm feature.
Pixel-only không có eligible positive policy. Combined chọn L2=1,threshold.65.
Segment-test preview trong calibration cũ mang CC BY-NC4.0, chỉ dùng nghiên cứu
offline; không coi weights nghiên cứu này là model đã duyệt cho sản phẩm.

| Cohort / gate                                      | Readable giữ được | Invalid accepted | Fallback |
| -------------------------------------------------- | ----------------- | ---------------- | -------- |
| New4:2 readable +status row +blurred; frozen shape | 1/2               | 1/2              | 2/4      |
| New4; learned combined                             | 1/2               | 1/2              | 2/4      |
| New4; learned pixel                                | 0/2               | 0/2              | 4/4      |
| Historical5; frozen shape                          | 1/3               | 0/2              | 4/5      |
| Historical5; learned combined                      | 3/3               | 2/2              | 0/5      |

Learned combined phục hồi readable retention nhưng nhận cả hai invalid historical
controls. Cả frozen/learned đều nhận status row1.8.0 của ảnh mới như readable.
**REJECTED**: không giải quyết register/status bằng việc nhìn thấy digits; cũng
không reject88888 chỉ vì pattern. Không có measured gain đủ an toàn để bật gate.
[Feature weights, folds và từng ảnh](ocr-continued-readability-results.json).

## 7. Digital numeric recognition: model thật và bounded training

Đã tải/inference official **PARSeq base** (autoregressive Transformer +1 refinement),
source revision1902db043c029a7e03a3818c616c06600af574be,
[official repository](https://github.com/baudm/parseq), Apache-2.0.
[Receipt](../../tools/BHome.OcrSmoke/model_tools/parseq-receipt.json) giữ URL/SHA95MB.
Đọc trực tiếp official inference model, full94-character vocabulary;
`torch.load(weights_only=True)`, không load pickled model object. Chỉ thêm isolated
timm0.9.16 trongignored `.tools`, không thêm production dependency/đổi framework.

Train **character CNN** mới từ949 publisher digit boxes của163 CC0 Mendeley TRAIN
images, fixed20 epochs, source/hash verified. Đây là classification từng ký tự,
khác whole-sequence CTC all-blank đã bị loại; không train CRNN cũ, không dùng
provisional/test numeric labels. Segmentation từ ảnh, không supplied digit count.
Final train loss≈.203 không được gọi accuracy. Model không generalize đủ.

| Same2 labeled LCD positives(1validation +1test), oracle numeric crop | Exact | Incorrect numeric | Fallback        |
| -------------------------------------------------------------------- | ----- | ----------------- | --------------- |
| PP runtime direct                                                    | 1/2   | 0/2               | 1/2 non-numeric |
| PP runtime page                                                      | 0/2   | 0/2               | 2/2 non-numeric |
| English CTC                                                          | 2/2   | 0/2               | 0/2             |
| Server CTC                                                           | 2/2   | 0/2               | 0/2             |
| PARSeq                                                               | 2/2   | 0/2               | 0/2             |
| Character CNN                                                        | 0/2   | 1/2               | 1/2             |

Oracle full-screen crop khác oracle numeric crop: English1/2,server0/2,PARSeq1/2,
character CNN0/2 exact. Multi-row/status/small thin digits gây lỗi; không strip
unwanted characters rồi gọi exact. Leading zeros được giữ trong raw000501.
Decimal/unit/register chưa có verified GT; không suy billing value từ digit string.
[Training/reader/raw outputs](ocr-continued-numeric-results.json). LED-specific
evaluation **NOT_RUN**, thiếu representative images/labels.

## 8. Full-image before/after numeric benchmark

Cùng5 full photographs(2validation +3test), gồm2 readable positives,1 blurred LCD,
1 covered meter và1 non-consumption timer. Đây là **ảnh gốc→localization→numeric string**, chưa gồm
type/readability/register/precision/API/Staff; tất cả labels provisional.

| Pipeline                           | Correct positive /2 | Incorrect positive numeric /2 | Invalid-control numeric /3 | Fallback /5 | Observed p95 |
| ---------------------------------- | ------------------- | ----------------------------- | -------------------------- | ----------- | ------------ |
| YOLO416 .25→English                | 0                   | 0                             | 0                          | 5           | 55ms         |
| Native text .7→English             | 1                   | 1                             | 1                          | 2           | 2049ms       |
| Native text .7 +row margin→English | 2                   | 0                             | 1                          | 2           | 2108ms       |

Một additional correct string được phục hồi từ pixel của digit1 thật; không
chỉ giảm false positives bằng reject-all. Nhưng non-consumption counter vẫn ra4,
nên **REJECTED activation**. Raw printed/serial candidates trên blurred image
cũng không phải consumption evidence. Latency tính decode/detect/read trong
offline process, không gồm model initialization, queue/network/API/camera.
N=5 quá nhỏ và selected/provisional, không suy production p95 hoặc confidence
interval về accuracy. [Benchmark chạy thật](ocr-continued-full-image-results.json).

## 9. Mechanical-water reader comparison

PARSeq là architecture mới; các models/decoding được đóng băng, chỉ đánh giá
historical exploratory crops, không fit/train hoặc chọn threshold từ test.

| Crop cohort                  | Reader  | Exact | Incorrect numeric | Labeled fallback |
| ---------------------------- | ------- | ----- | ----------------- | ---------------- |
| Predicted36 crops,30 labeled | English | 12/30 | 13/30             | 5/30             |
| Cùng cohort                  | Server  | 16/30 | 10/30             | 4/30             |
| Cùng cohort                  | PARSeq  | 15/30 | 10/30             | 5/30             |
| Oracle52 crops,33 labeled    | English | 12/33 | 19/33             | 2/33             |
| Cùng cohort                  | Server  | 17/33 | 13/33             | 3/33             |
| Cùng cohort                  | PARSeq  | 14/33 | 17/33             | 2/33             |

Unlabeled numeric outputs và fallback trên toàn cohort nằm riêng trong JSON,
không gọi chúng đúng/sai khi thiếu exact GT. PARSeq không hơn server; **REJECTED**.
Không thay genuine PP/Stage2 disagreement, rolling/unclear/partial/geometry veto
bằng majority vote hoặc “chọn reader mạnh hơn”. Runtime historical10/33 exact,
42/52 fallback giữ nguyên; không chạy lại một full runtime benchmark để gọi crop
numbers là improvement billing.

## 10. Mechanical-electricity và new wheel probes

Trên2 provisional oracle examples cũ: English1/2 exact,1/2 wrong; server2/2 exact;
PARSeq1/2 exact,1/2 wrong. Server cũng đưa239652 ở disputed rolling sample, không
dùng agreement server/PARSeq làm GT. Water Stage2 transfer cũ vẫn rejected.

Trên new L7C2 image, frozen draft12615: oracle English `1261 51`, server/PARSeq
`126151`; full-image largest native `151`, geometric row assembly `6151`.
Exact0/1; server/PARSeq và assembled numeric đều không khớp. Không xóa terminal1
để tạo pass. Đây là phản ví dụ cho việc dùng2/2 oracle cũ để activate reader.

Hai rolling rows mới để expectedDigits=null: các reader/grouping trả khác nhau,
không chấm exact, không gán lại nhãn theo model. Một crop electricity chỉ chứa
wheels, không phải full-meter category sample. Pointer-dial numeric reading là
vấn đề riêng, **NOT_RUN**. [Native/grouped/oracle evidence](ocr-continued-wheel-results.json).

## 11. Kết quả theo category

“Incorrect/fallback” dưới đây là offline component outcomes, không phải proposal
được phát qua API. Các denominator khác mục đích không cộng thành một accuracy.

| Category               | New classification                               | Display localization                                                         | Exact reading evidence                               | Incorrect / fallback evidence                                                               |
| ---------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Electricity mechanical | 0/2                                              | Native/grouped row thiếu glyphs trên new1; không có accepted detector        | Old oracle server2/2; new oracle0/1                  | New assembled wrong1/1; English new oracle non-numeric1/1                                   |
| Electricity digital    | 0/2                                              | Native numeric IoU≥.5 ở2/2 labeled positives; chưa xác minh billing register | Full-image subpipeline1/2→2/2 provisional            | After margin0/2 positive wrong, nhưng invalid controls1/3 numeric; total fallback2/5        |
| Water mechanical       | 1/2                                              | Không có full-pipeline localization gain mới được accepted                   | Historical runtime10/33; new PARSeq crop14/33 oracle | Historical PARSeq oracle17/33 wrong,2/33 labeled fallback; runtime fallback42/52 giữ nguyên |
| Water digital          | 0/1 illustration, real-photo recall NOT MEASURED | Không có representative positive set mới                                     | NOT MEASURED mới                                     | BLOCKED_BY_DATA; không suy từ water-mechanical/energy-LCD data                              |

Không có new independent test/human acceptance; không báo CI của các tỷ lệ nhỏ,
biased/provisional như giới hạn tin cậy cho hệ thống. Classifier accepted precision
mới1/3 chỉ mô tả frozen baseline trên9 probes. Full BHOME four-category end-to-end
accuracy **NOT MEASURED**.

## 12. Model decisions và ONNX/.NET integration

| Model / candidate                      | Explicit status                   | Lý do                                                                        |
| -------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------- |
| Existing hierarchy                     | EXPERIMENTAL                      | Giữ historical improvement, new probes cho thấy sai/unknown; chưa activation |
| Physical prompts /TTA /few-shot CLIP   | REJECTED                          | Không có eligible positive policy trên new validation                        |
| Tiled display /predicted-body cascade  | REJECTED                          | Không tăng readable-positive accepted coverage đáng tin cậy                  |
| Native text +row margin                | EXPERIMENTAL; activation REJECTED | Có thêm correct positive nhưng invalid counter vẫn có số                     |
| Learned readability pixel/combined     | REJECTED                          | Reject-all hoặc blank/status false acceptance                                |
| PARSeq base                            | REJECTED                          | Không hơn best CTC; sai numeric và chưa có state/register gates              |
| Publisher-supervised character CNN     | REJECTED                          | 0/2 provisional numeric positives                                            |
| Mechanical row assembly                | REJECTED                          | Incomplete rows, new positive chưa đúng                                      |
| Verified water-LCD training/acceptance | BLOCKED_BY_DATA                   | Thiếu đa thiết bị và human-reviewed exact/state/register GT                  |
| New accepted-model ONNX/.NET adapter   | NOT_RUN                           | Không candidate qua quality gates, không export để gọi thành công            |

New `ACCEPTED` runtime models **0**. Không thay API/DTO/DI/config/auth, Meter metadata,
Staff confirmation, invoice/payment, unknown fallback hoặc safeguards. Không có
schema migration. Existing native Stage2/.NET và English Python/.NET parity vẫn
được chạy; parity không chứng minh positive accuracy. Các code edits chỉ ở
`tools/BHome.OcrSmoke/model_tools`, script tests và docs/manifests, không ở `src`.

## 13. Dataset review và các blocker còn lại

[Pilot8 ảnh cần review](../datasets/meter/continued-review-pilot.json) được đóng gói
mù bằng tool hiện có tại `.tools/ocr-continued/review/index.html`, không hiện nhãn
nháp/model suggestions. Pilot12 cũ vẫn giữ nguyên. Reviewer tự ghi type, body/window,
readability, digits/uncertain positions, physical group, unit/register/precision;
screen vs numeric-register taxonomy phải được thẩm định trước training/acceptance.
Hai reviewer ID không tự chứng minh hai người độc lập. Chưa có người review mới.

Water digital: [MeterOCR public project](https://universe.roboflow.com/meterocr-vt9ic/water-digital-meter)
ghi CC BY4.0, nhưng hiện chỉ có3 linked200×150 previews đã ở TRAIN cũ. Public browse
request trả403 trong lượt này; không đoán full-resolution asset URLs, không lấy
API credentials/vượt gate. Các kết quả search khác chưa có license/content được
xác minh thì không nhập dataset. Readable water LCD đa thiết bị vẫn thiếu.

Cần thêm hard negatives(nắp/timer/TDS/status), hybrid electronic meters dùng
wheels, glyph1 mảnh tách rời, transitions, source/physical groups và registration
metadata trước calibration. Không dùng chính những test/probes đã xem làm fresh
selection set ở lượt sau. Source captions không phải technology/digit GT.

## 14. Regression, MinIO và camera

[Verification receipt](ocr-continued-verification-results.json) ghi commands và
hash logs local. Checks được chạy sau model/code units, không dùng chúng làm
thước đo accuracy.

| Check thực sự đã chạy                                                  | Kết quả                                                               |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Backend solution Release build --no-restore                            | PASS,0 warnings/0 errors                                              |
| Application /Domain                                                    | PASS325 /106                                                          |
| OCR integration, pinned models, exclude Docker/CompactPostgres         | PASS125,0 skipped                                                     |
| Disposable PostgreSQL confirmation/real ONNX/invoice/payment workflows | PASS7,0 skipped; evidence storage in memory                           |
| Python script regressions                                              | PASS59                                                                |
| Dataset Node tests                                                     | PASS29                                                                |
| Mobile Vitest                                                          | PASS56 suites/576 tests                                               |
| TypeScript /ESLint                                                     | PASS /PASS                                                            |
| Existing Stage2 native/.NET /English Python/.NET parity                | PASS10 /4 crops                                                       |
| Full-image numeric benchmark                                           | Executed5 images×3 methods, measured results above                    |
| Physical-camera HTTPS→API→confirmation→DB→MinIO E2E                    | NOT_RUN: no accessible adb/device session                             |
| Real MinIO evidence upload/retrieval/failure cleanup                   | NOT_RUN: no local9000/9001 listener; Docker Linux daemon missing pipe |

Owned disposable PostgreSQL loopback55493 đã dừng sau test. In-memory evidence
không thay cho MinIO thật. Không upload private images, không thay hardware E2E
bằng synthetic/file tests. Không deploy, không bật model mới.

Resolved experiment errors: direct official PARSeq model cần tokenizer argument
(đã sửa trước measured run); dataset rows không có label hashes nên chuyển sang
verified digit-box audit thay vì đoán path/labels; NumPy counter serialization
đã sửa và replay vào fresh directory. Wheel assembly sửa thứ tự x trước y để
giữ perspective slope, có regression test; final new-wheel result vẫn rejected.
Không che các failed activation gates bằng các engineering PASS.

## 15. Chronological commits và final state

| Commit                 | Nội dung                                                                       |
| ---------------------- | ------------------------------------------------------------------------------ |
| b934e2f                | Freeze new author-separated probes and integrity checks                        |
| f18611e                | Evaluate hierarchy prompts, full-frame TTA and few-shot prototypes             |
| f0145f4                | Separate screen/numeric taxonomy and compare native/tiled/body localization    |
| f219f25                | Measure source-group cross-validated readability retention/failures            |
| b9b04f1                | Compare PARSeq, trained character CNN, Paddle and margin recovery              |
| e063b22                | Probe new wheel rows, preserve rolling ambiguity, prepare blinded pilot8       |
| c61f2db                | Benchmark full-image numeric before/after with actual latency/invalid controls |
| Commit chứa report này | Record results, replay instructions and final regression evidence              |

Final reporting HEAD là commit chứa file này; hash đầy đủ, danh sách file thay đổi
và clean-tree status
sau commit ghi ở `.tools/ocr-continued-final-state.json`, chronological hashes ở
`.tools/ocr-next-git-history.md`. Không nhúng hash chưa được tạo vào chính commit.
Không push, merge, rebase, squash, reset, rewrite history hoặc deploy. Independent
acceptance và full four-category billing recognition vẫn pending.
