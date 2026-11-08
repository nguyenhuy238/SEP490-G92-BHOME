# Nhận dạng bốn loại công tơ — kết quả 07/11/2026

Lượt nghiên cứu tiếp theo và trạng thái mới nhất ở
[OCR_RECOGNITION_PROGRESS_REPORT.md](OCR_RECOGNITION_PROGRESS_REPORT.md).
Các metric bên dưới được giữ làm lịch sử của lượt trước.

**Chưa hoàn tất hệ thống tự động bốn loại.** Lượt này đã sửa verification, chạy
baseline visual mới, huấn luyện hai model thật, export ONNX và kiểm inference
.NET. Có thêm positive recognition ở mức component; chưa có candidate đủ điều
kiện bật runtime. Không hạ safeguards hoặc lấy số test/epoch thay accuracy.

## Git, phạm vi và trạng thái ban đầu

Start `ab70009156b65b3bc95b77a6400cead9f12d9874`, branch `member/QHuy`, working tree
sạch. Giữ mọi commit trước; không push, merge, rebase, rewrite hoặc deploy.

BF-05 / UC-20 / GBR-07: OCR gợi ý, Staff kiểm và xác nhận tại Location được giao.
UC-21 / JOB-10 / GBR-09: chỉ số confirmed mới được dùng tính hóa đơn. Giữ API,
DTO, schema, authorization, Meter metadata và billing. Không đăng ký model mới
trong DI hoặc bật classifier bị loại. Tool parity chỉ được bổ sung đúng class order
reading_region/serial_region; không sửa `YoloMeterCategoryClassifier`.

Historical baseline được giữ từ lượt trước: typed10/33 digit strings đúng,
42/52 fallback; automatic1/33 đúng,51/52 fallback. Không chạy lại historical52 để
chọn model trong lượt này. Production weights/fusion không đổi; không tuyên bố
baseline đó đã tăng. Phân tích trước chỉ ra PP recognition/fusion là nút thắt trên
corpus nước: Stage1 validation100/100 geometry, Stage247/69 predicted crop, fusion
12/69. [Root cause](OCR_FAILURE_ROOT_CAUSE_ANALYSIS.md).

## Sửa verification thực tế

Đã tái hiện14 CS1503 ở hai fixture `PolicyDto` trong ContractServiceTests. Bỏ
tham số theo constructor cũ, giữ RoomId đúng vị trí và toàn bộ assertions; không
sửa Contract business logic. Khôi phục installed `expo-image-picker` theo lockfile
bằng npm install dưới Node22; không đổi dependency version, hoàn nguyên phần
optional libc metadata do npm tự ghi lại.

Node URL trong Vitest config/incident file test được import từ `node:url`, tránh
trộn DOM URL và Node URL types. Meter screen test cập nhật mocks/labels theo room
overview hiện tại, vẫn kiểm correction, explicit confirmation, chỉ một request
khi double-click, retake xóa dữ liệu cũ và cancellation bỏ late response.

## Dữ liệu, giấy phép và review

[Dataset report](OCR_FOUR_CLASS_DATASET_REPORT.md) và
[counts/splits](ocr-four-dataset-counts.json) tách A classification, B localization,
C recognition. Không gộp327 ảnh thành327 thiết bị hoặc ba preview thành ba nguồn
độc lập. Không nhận12 nháp Kaggle vào train/numeric acceptance.

- View A: giữ62 ảnh development cũ để đánh giá pretrained visual model, không
  retrain YOLO trên tập yếu. Water digital train chỉ3 preview cùng nguồn, vẫn thiếu
  category/body data đa thiết bị có review độc lập.
- View B:300 ảnh Kaggle có reading/serial boxes hợp lệ, MIT theo metadata publisher,
  toàn nguồn ở TRAIN.27 ảnh missing reading hoặc có nhãn không hợp lệ bị quarantine.
  Validation2/test4 Commons khác nguồn giữ nguyên. Boxes là localization proxies,
  chưa xác minh billing-register eligibility; không có complete serial GT ở holdout.
- View C:163 Mendeley CC0 row crops có publisher digits ở TRAIN; Commons validation
  1 readable+1 blank, test3 readable+1 blank. Agent-reviewed labels không được gọi
  là independent human acceptance. Không dùng historical water evaluation để train.

Đã kiểm source/image/label SHA, corrupt decode, pHash cross-split trước augmentation.
Nhóm thiết bị chưa rõ của Kaggle/Mendeley ở cùng source group, không random split.
Gói review mù327 ảnh tại `.tools/ocr-four-review/index.html` cho hai người vẽ body/
window, nhập category/digits/uncertainty/precision/unit/register/group. Merge kiểm
hash, reviewers khác nhau và consensus; digits bất đồng không lọt vào A/B. Output
vẫn pending project review, không tự chứng minh hai ID là hai người độc lập.
[Hướng dẫn](../datasets/meter/INDEPENDENT_REVIEW.md). Human reviews nhận được:0;
independent exact labels mới:0. Có thể bắt đầu pilot nhỏ, không cần review hết327
ảnh ngay. Ảnh/weights/crops/review outputs nằm ngoài Git.

Đã tìm thêm Commons water LCD nhưng public download trả429; bounded delayed retry
vẫn429, đã dừng. MR-AMR v2 ghi CC BY-NC3.0 trong description và chỉ cung cấp digit
crops/binarized/augmented challenges; không suy thành full-meter water LCD diversity.
Chưa tải nguồn đó. Giấy phép bài báo không thay quyền dataset. Không vượt gate hoặc
gửi ảnh Tenant/CCCD đến dịch vụ AI.

## Visual classifier: actual image evidence

Đánh giá offline [CLIP ViT-B/32](https://huggingface.co/openai/clip-vit-base-patch32),
revision `3d74acf9a28c67741b2f4f2ea7635f0aaf6f0268`, pin605MB weights/tokenizer/config;
[MIT license](https://github.com/openai/CLIP/blob/main/LICENSE). Prompts cố định trước
inference; chỉ pixels đi vào image encoder, không tên file/OCR/user category. Đây
là baseline zero-shot khác kiến trúc để thử visual evidence khi supervised data yếu.
Các package Transformers chỉ cài trong target research riêng; không thêm dependency
backend/mobile hoặc cloud inference. Không train lại62 ảnh.

Validation11 ảnh: threshold0,75 và margin0,1 cho5 accepted đúng,0 sai,6 unknown.
Chọn threshold trên validation, freeze rồi chấm15 historical test. Baseline ứng dụng
cũng được chạy lại trên đúng15 ảnh. [Outputs/confusion/per-class metrics](ocr-four-clip-results.json).

| Metric trên cùng15 test:9 meter+6 negative | App baseline | CLIP candidate | Difference |
| ------------------------------------------ | -----------: | -------------: | ---------: |
| Correct accepted classifications           |            0 |              2 |         +2 |
| Incorrect accepted classifications         |            0 |              0 |          0 |
| Unknown/fallback classification            |           15 |             13 |         −2 |
| Correct accepted /positive meters          |          0/9 |            2/9 |       +2/9 |
| Non-meter false acceptance                 |          0/6 |            0/6 |          0 |

Candidate accepted hai electricity_digital; recall test: electricity_digital2/3,
các lớp electricity_mechanical0/3, water_mechanical0/2, water_digital0/1. Accepted
precision2/2 chỉ là quan sát rất nhỏ. Raw top1 đúng11/15 gồm cả negatives, không phải
11 positive meters. p95 image-encoder forward14,45ms GPU, không so với latency full
API. Softmax chưa được calibration cho production.

**REJECTED activation**: chưa đủ recall bốn lớp, không body boxes/meter counts hoặc
multiple-meter handling; detection mAP là N/A cho whole-image classifier. Web
pretraining overlap với Commons không rõ. Không independent acceptance95%. Không
đổi adapter YOLO sang CLIP hoặc gán mAP/detection capability cho nó.

## Display detector: huấn luyện thật bằng nguồn mới

Fine-tune pretrained YOLOv8n trên300 Kaggle TRAIN,2 Commons validation,4 historical
test. Hai classes reading_region/serial_region; seed42,416px,batch16,AdamW,40 epoch
budget,patience12, không flip digits. RTX3070 Laptop8GB; early stop ở19 epochs,
best epoch7. Không nhận class0 box là whole-meter box hoặc xác minh register.

Validation mAP50=.995, mAP50–95=.62394 tại checkpoint chọn, chỉ2 region objects;
không đại diện accuracy thế giới thật hoặc serial-class performance. Predict ở416
đạt IoU≥.5 trên2/2,640 chỉ1/2 và có extra regions. Không thay threshold theo test.
Historical test416 chỉ1/4 khớp IoU≥.5, ca đó là blank LCD;0/3 readable positives.
**REJECTED runtime** vì generalization/register gate không đạt.

Export ONNX thật, input[1,3,416,416], output[1,6,3549], SHA
`a6e4bc8e9b40ad3151039b889e12f830a2993cf8e690f557bfecb1a1d519de37`.
Native/ORT raw tensor parity2/2 và .NET parity2/2 PASS; .NET preprocessing input
delta0. Ban đầu native prediction dùng auto rectangular padding khác ONNX square;
đã sửa `rect=False`, giữ weights/threshold, đo lại cùng preprocessing. Các dòng
incomparable cũ giữ trong ignored artifact, không gọi chúng là parity pass.
[Results và parity](ocr-four-display-results.json), [19 actual epochs](ocr-four-display-training.csv).
Parity không chứng minh nhận dạng hoặc billing accuracy. Existing water-only
display detector không có category support tương đương để so electric full-frame;
không ghi N/A thành0% baseline.

## Mechanical và LCD/LED recognizers

Paddle server model mới chính thức Apache-2.0, revision
`b70df217f4fd99d14f970bad092cebe7d74cc4d1`; pin model/config/dictionary.
So cùng frozen water crops với PP hiện tại và English mobile:

| Component, cùng75 predicted crops có63 complete labels | PP hiện tại direct | English mobile | Server |
| ------------------------------------------------------ | -----------------: | -------------: | -----: |
| Exact digit strings                                    |                 11 |             34 |     33 |
| Incorrect raw numeric strings                          |                 41 |             19 |     23 |

Oracle100 crops có69 complete labels: PP direct13 exact/37 wrong, English36/25,
server39/19. Đây là recognition component comparison, không proposal sau parser/
fusion hoặc full-frame accuracy. Các crop thiếu do scene gate không bị nhận thành
đúng. Server p95 forward khoảng73,31ms predicted/76,13ms oracle CPU; English khoảng
22ms. Không bỏ legacy numeric disagreement, blur, multiple regions, unreadable/
missing digits, wrong unit/category/register hoặc confirmation để lấy số cao hơn.

Trên4 LCD historical test crops cố định (3 digit labels+1 blank):

Các output dưới đây là parser baseline hoặc strict-numeric candidate outputs ở
offline probe, không phải API proposals hoặc billing readings đã qua toàn bộ gates.

| Reader                                     | Exact /3 readable labels | Incorrect numeric outputs /4 | Fallback /4 |
| ------------------------------------------ | -----------------------: | ---------------------------: | ----------: |
| PP hiện tại direct, parser baseline đo lại |                        0 |                            2 |           2 |
| English direct, strict numeric output      |                        2 |                            2 |           0 |
| Server direct, strict numeric output       |                        2 |                            2 |           0 |
| New CRNN/CTC                               |                        0 |                            0 |           4 |

Hai recognizer mới đọc đúng004046 và21594 ở crop điện. Nhưng cả hai hallucinate
88888 trên segment outlines của LCD chưa hoạt động, và đọc sai chuỗi nước 000880578. Server trả00088058: không tự bổ sung digit. Digit labels không xác minh
decimal hoặc billing register;21594 vẫn register unknown. Hai correct positives
không bù được hai wrong numeric outputs. **REJECTED activation** cho digital readers.
12 Kaggle draft crops vẫn chỉ4/12 matches cho mỗi model, không báo error rate hoặc
accuracy được xác minh từ nháp. [Actual Paddle outputs](ocr-four-paddle-results.json).

CRNN mới:4 CNN blocks+BiLSTM128×2+11-class CTC,163 CC0 training rows, augmentation
sau split; không dùng provisional Kaggle numeric labels. Train100 epochs trênGPU,
validation chọn epoch1 all-blank vì các checkpoint học digits lại hallucinate trên
blank validation. Test0/3 exact,4/4 fallback: **REJECTED**, không gọi zero errors là
success. Export ONNX thật; native/ORT cùng strings6/6, max logits delta<.000005.
[Training history và results](ocr-four-crnn-results.json).

Mechanical electricity chưa có corpus mới đủ exact/group/precision GT để fine-tune
hoặc kiểm chứng water Stage2 generalization. Mechanical water không train bằng
historical evaluation; giữ Stage2/fusion cũ và không chấp nhận13 recovery cases bằng
cách bỏ veto. Supervised four-class fine-tuning vẫn BLOCKED data, khác với hai
training runs khả thi đã thực hiện ở trên.

## Runtime, regression và E2E

Không candidate mới nào được bật trong Development/Production. App vẫn dùng trusted
Meter metadata cho assigned task; visual predictions không override server Meter.
Không thêm route/DTO/schema hoặc dùng unconfirmed OCR cho invoice. Classifier+
specialized reader integration và independent exact billing accuracy bốn loại:
**NOT MEASURED / chưa đủ gate**. Không gọi manual fallback là reader hoàn tất.

[Verification evidence và log hashes](ocr-four-verification.json):

| Check thực sự chạy lượt này                                          | Result                                                    |
| -------------------------------------------------------------------- | --------------------------------------------------------- |
| Backend solution Release build                                       | PASS,0 warnings/errors                                    |
| Application full suite                                               | 325 PASS,0 skip                                           |
| Domain                                                               | 106 PASS,0 skip                                           |
| OCR Integration, real local ONNX assets                              | 125 PASS,0 skip                                           |
| PostgreSQL/ONNX Staff correction/confirmation/replay+invoice filters | 7 PASS,0 skip                                             |
| OcrSmoke Release build                                               | PASS,0 warnings/errors                                    |
| Water Stage2 native/.NET parity                                      | 10/10 PASS                                                |
| English Python/.NET parity                                           | 4/4 PASS                                                  |
| New display native/ORT và .NET parity                                | 2/2 mỗi phép đo PASS, không cộng như independent accuracy |
| New CRNN native/ORT                                                  | 6/6 same strings; không phải recognition quality pass     |
| Mobile Vitest                                                        | 56 suites,576 tests PASS                                  |
| Mobile TypeScript / ESLint                                           | PASS / PASS                                               |
| Python tooling tests, gồm review integrity                           | 40 PASS                                                   |
| Node dataset validators                                              | 29 PASS                                                   |
| Physical camera / real MinIO                                         | NOT RUN                                                   |

PostgreSQL16 isolated loopback55493 chỉ synthetic data, đã dừng sau test. Bảy
workflow tests chạy backend/ONNX/DB thật nhưng storage là explicit in-memory
substitute. Không có MinIO listener/Docker daemon dùng được; Windows binary archive
công khai trả410. Không có adb/device truy cập được. Camera→upload→MinIO latency
và physical E2E chưa đo. Không cộng các suites chồng lấp thành tổng coverage.

Lệnh verification chính:

```powershell
dotnet build src/backend/BHome.sln -c Release --no-restore
dotnet test tests/backend/BHome.Application.UnitTests -c Release --no-build --no-restore
dotnet test tests/backend/BHome.Domain.UnitTests -c Release --no-build --no-restore
$env:BHOME_OCR_LOCAL_EVALUATION_ROOT=(Get-Location).Path
dotnet test tests/backend/BHome.IntegrationTests -c Release --no-build --no-restore --filter 'FullyQualifiedName~Ocr&Category!=Docker&Category!=CompactPostgres'
.tools/yolo-python/python.exe -m unittest discover -s tests/scripts -p 'test_*.py'
.tools/node-v22.23.4-win-x64/node.exe --test tests/scripts/MeterDataset.test.cjs
```

Mobile commands chạy trong `src/mobile`, bằng local Node22: Vitest với config hiện
hành, `node_modules/typescript/bin/tsc --noEmit`, root ESLint `src --max-warnings0`.
Workflow filter là `FullyQualifiedName~CompactMeterOcrWorkflowTests|FullyQualifiedName~Compact24InvoiceRegressionTests.Finalization|FullyQualifiedName~Compact24PaymentRegressionTests.MeterAutomation`.
Lệnh replay cụ thể ở [model-tools README](../../tools/BHome.OcrSmoke/model_tools/README.md).
Model tools nằm ở `tools/BHome.OcrSmoke/model_tools`; các runs giữ config, source
SHA, weights SHA và reports trong `.tools/ocr-four-*`. Training dùng runpy wrapper
để đưa existing `.tools/yolo-cuda-packages` vào sys.path trước khi import Torch;
CLIP thêm isolated `.tools/ocr-four-clip-packages`. Khi replay dùng output directory
mới; không overwrite frozen runs. Không commit model weights hoặc local packages.

## Kết quả theo loại và blockers

| Meter category         | Visual classification, accepted trên9 meter test | Display detection                        | Exact reading                                           | Validation status                                 |
| ---------------------- | ------------------------------------------------ | ---------------------------------------- | ------------------------------------------------------- | ------------------------------------------------- |
| Mechanical Electricity | CLIP0/3                                          | Chưa có candidate mới được xác minh      | NOT MEASURED mới                                        | BLOCKED diverse GT; chưa hoàn tất                 |
| Digital Electricity    | CLIP2/3                                          | New detector1/3, chỉ blank;0/2 readable  | English/server oracle crops2/2; có blank false output   | EVALUATED, REJECTED activation                    |
| Mechanical Water       | CLIP0/2                                          | Historical51/52; không benchmark lại mới | Historical full10/33; new component numbers ở bảng trên | Baseline giữ nguyên; chưa có accepted improvement |
| Digital Water          | CLIP0/1                                          | New detector0/1                          | English/server0/1 oracle crop                           | BLOCKED representative data, REJECTED reader      |

Các mẫu số khác nhau được giữ riêng. Không có independent95% classification hoặc
90% billing reading result: cả hai **NOT MEASURED**. Cần human-reviewed groups/body
boxes, readable water LCD đa thiết bị và precision/register GT trước calibration/
activation. Review package có thể thu nhận pilot nhỏ; không sửa GT theo model hoặc
đổi threshold bằng historical test. Accepted production recognition improvements:0.

## Chronological local commits và final state

| Commit                 | Short English description                                               |
| ---------------------- | ----------------------------------------------------------------------- |
| 76c17a2                | Restore backend and mobile verification without changing business logic |
| 49cd694                | Prepare blinded independent review and separate dataset views           |
| 31e5e9a                | Evaluate a real visual CLIP four-category baseline                      |
| f954115                | Train source-separated LCD region detection and verify .NET parity      |
| 4ffc6a6                | Train/export CRNN and record failed positive-reading gate               |
| ae38bd0                | Compare pinned Paddle models on frozen water/LCD crops                  |
| Commit chứa report này | Record measured capabilities, regressions and activation blockers       |

Final HEAD đầy đủ và working tree sau reporting commit ghi tại
`.tools/ocr-four-final-state.json`; chronological hashes trong `.tools/ocr-next-git-history.md`.
Commit chứa report này là final reporting HEAD, tránh tự nhúng hash chưa được tạo.
Không push/merge/rebase/deploy. Những phần chưa qua gate được giữ pending, không
đánh dấu hoàn thành chỉ vì code chạy hoặc ONNX export thành công.
