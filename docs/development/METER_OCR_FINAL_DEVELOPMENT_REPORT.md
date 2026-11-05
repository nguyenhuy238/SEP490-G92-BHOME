# OCR incremental development — 05/11/2026

> Báo cáo tiếp theo cho master task nghiên cứu dataset và fine-tune GPU:
> [OCR_FINAL_COMPLETION_REPORT.md](OCR_FINAL_COMPLETION_REPORT.md).
> Kết quả trong tài liệu này là baseline lịch sử, không phải kết quả model mới.

## A. Ban đầu và quy tắc làm việc

Branch đã xác minh: `member/QHuy`; HEAD ban đầu `1ad6cea`. Có35 đường dẫn thay đổi
OCR từ lượt trước, không có staging ban đầu hoặc thay đổi ngoài OCR. Không tạo
branch/PR, không reset, không push/merge. Git.txt gốc không có trong checkout;
đã đọc `CONTRIBUTING.md` và áp dụng quy tắc personal branch tại AGENTS.md§9 có
ưu tiên cao hơn hướng dẫn feature branch cũ.

Baseline thật: stage2 trên42 crop mới đúng20/26, PP2/26; runtime mobile52 ảnh,
33full labels: typed3/33,0false,49fallback; automatic1/33,51fallback. Đây là ảnh
test tác giả, không phải acceptance độc lập BHOME. Các thông số trước có trong
`METER_OCR_COMPLETION_REPORT.md`, không coi localization là reading accuracy.

## Truy vết và kế hoạch kiểm chứng

| Unit                                       | Nguồn / rule                | Thành phần                          | Acceptance / kiểm thử                                                 |
| ------------------------------------------ | --------------------------- | ----------------------------------- | --------------------------------------------------------------------- |
| Audit/commit work cũ                       | yêu cầu trực tiếp, AGENTS§9 | Git index/source/tests/docs         | path staging rõ ràng, build/test, commit riêng                        |
| Phân tích fallback và candidate recognizer | BF-05/UC-20/GBR-07          | stage1/crop/stage2/fusion/evaluator | phân loại reject đúng/sai/unknown, validation tách test, không đoánu  |
| Annotation/evaluation dataset              | NFR OCR, GBR-13 privacy     | schema/validator/split audit        | decimal/register/group/license labels, cấm path traversal và leakage  |
| Review Mobile                              | UC-20/GBR-07                | OCR test screen                     | một camera, xem crop/precision, sửa tay, clear/cancel                 |
| Business regressions                       | UC-20/21, GBR-01/02/07/09   | services/confirmation/invoices      | assigned Staff, precision, idempotency, chỉ confirmed usage tính tiền |

Không đổi chính sách tài chính, quyền hoặc retention. Không train khi chưa có
dữ liệu được phép và license phù hợp. Mọi số liệu mới phải ghi điều kiện thực thi.

## B. Cải tiến hoàn tất

1. Review và chia35 đường dẫn OCR cũ thành5 commit backend, nhãn loại, Mobile,
   tooling và docs; không recreate các commit đã có ở HEAD. Mỗi nhóm stage bằng
   danh sách path rõ ràng, xem staged diff/check và xác minh commit sau khi tạo.
2. Phân tích toàn bộ52 test +101 validation ảnh public bằng inference thật và cùng
   contract resize1600/JPEG85 của Mobile. Tìm1 ảnh exact-hash trùng giữa splits;
   loại khỏi validation, giữ100 ảnh calibration. Không sửa nhãn để hợp model.
3. Sửa một nhánh reject quá rộng: một dòng PP malformed không phải reading hợp lệ
   cạnh tranh. Stage2 đã qua scene/geometry/u/confidence/blur guard có thể trả
   review-only proposal; valid numeric disagreement/multiple regions/sai utility
   vẫn chặn. Không giảm confidence gate hoặc tự bù missing digit.
4. Màn Test OCR hiển thị đơn vị và cho chọn precision sau khi đã phân loại, đọc
   lại cùng ảnh qua backend thay vì bắt chụp lại. Meter buffer chỉ ở review60s,
   vẫn xóa khi clear/background/retake/unmount; CCCD buffer vẫn xóa ngay sau đọc.
5. Thêm validator annotation, template và25 test tự chứa: group theo meter/site,
   hash duplicate, polygon, precision/register, unreadable labels, provenance,
   path traversal/symlink escape. Không upload/train hay lưu ảnh private vào Git.
6. Probe thêm model bánh số Apache2 và model LCD YOLO26; giữ ngoài runtime vì
   kết quả chưa đủ. Dataset/tooling và báo cáo được commit riêng, không thêm model
   không hoạt động chỉ để tạo commit.

## C. Accuracy và fallback

[Water decision study](METER_OCR_WATER_DECISION_STUDY.md) và
[runtime mới52 ảnh](meter-ocr-incremental-runtime.json) lưu điều kiện/số liệu.
Đây vẫn là bộ test tác giả từng dùng, **không phải** holdout mới độc lập BHOME.

| Metric trên cùng52 ảnh,33full labels | Trước session  | Sau increment  |
| ------------------------------------ | -------------- | -------------- |
| Typed water exact                    | 3/33 (9.09%)   | 10/33 (30.30%) |
| False proposal trên33full            | 0              | 0              |
| Typed fallback                       | 49/52 (94.23%) | 42/52 (80.77%) |
| Auto exact                           | 1/33           | 1/33           |
| Auto false proposal                  | 0              | 0              |
| Auto fallback                        | 51/52          | 51/52          |
| Typed p50/p95/max ms                 | 220/801/1019   | 202/820/916    |
| Auto p50/p95/max ms                  | 3498/6171/6962 | 2853/5702/6731 |

Không tăng false quan sát được trong33 nhãn đầy đủ, nhưng không suy thành risk0
production. Mười chín ảnh annotationu không có full GT nên không tính đúng/sai,
vẫn tính trong fallback52. Latency là các lượt CPU dev khác nhau, có tác vụ khác,
không phải benchmark cô lập; không kết luận tăng tốc có ý nghĩa thống kê.
Tất cả52 proposal/fallback lượt mới trong10s. Exact gồm digit-string annotation;
public water set thiếu billing decimal GT để chứng nhận consumption billing.

Calibration chỉ dùng100 validation sau dedup (69full). Với các guard giữ nguyên,
nhánh single-line thêm8 correct/0false. Grid .5..99 chọn gate.5 theo coverage
validation, bằng gate cũ; sau đó frozen policy có7 correct/0false thêm trên test52.
Đây là bằng chứng hỗ trợ increment, không đủ cho acceptance90%. Group physical
meter/site của dữ liệu tác giả chưa có, còn nguy cơ near-duplicate leakage.

Baseline breakdown52:3 correct proposal;20 correct stage2 strings bị reject;
19 annotationu rejected;10 còn lại là stage2 sai hoặc không có chuỗi. Xem
[breakdown chi tiết](meter-ocr-water-decision-study.json) để tách incorrect vs
missing. Không gọi mọi ca reject là sai. Category là chiều khác:52/52 ảnh water
test vẫn chưa ra full automatic category;31 có cảnh báo profile-required. Vì vậy
cải thiện typed reading không đồng nghĩa cải thiện phân loại tự động.

## D. Category và model đã kiểm tra

| Category               | Có gì hoạt động                                                                              | Thiếu gì                                                      |
| ---------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Mechanical water       | stage1+stage2 ONNX thật, typed/server metadata, proposal+precision+Staff confirm             | automatic visual technology classification, accuracy đại diện |
| Digital electricity    | PP đọc theo profile; nhãn GELEX được text_rules nhận diện; typed precision1 đã có HTTP smoke | visual meter/window classifier được validate đủ ảnh           |
| Mechanical electricity | typed PP/precision/manual correction hiện có; explicit label rules                           | pretrained pipeline/dataset thật đủ chứng minh support        |
| Digital water          | typed PP/precision/manual correction hiện có; explicit label rules                           | total register vs flow-rate visual evidence và dataset thật   |
| CCCD front/back        | giữ pipeline/text rules và privacy                                                           | không mở rộng lưu ảnh/identity scope                          |

Không có classifier4 loại đã được chứng minh. Không dùng kWh/m³ hoặc output digit
model để giả làm visual category probability. Metadata do task service đọc từ
server vẫn authoritative; chưa biết loại thì hỏi sau capture.

Model research tiếp tục trên primary sources:

- [VisionState wheel reader](https://huggingface.co/oleost/visionstate-wheel-reader),
  revision563f365a: tảiONNX thật, verify SHA
  `37912f885b061a7b12298872fbdfa1b73ca0664363b293a55617b1d3680a98ac`, license
  Apache2, chạy ORT CPU. Trên33full labels:13 exact/19 false với cell geometry từ
  stage2; agreement với stage2 vẫn có1false. Không integrate runtime. Probe/source
  attribution/license kèm trong model_tools; [evidence](meter-ocr-wheel-study.json).
- [WattBot](https://github.com/NirKli/WattBot), revision
  `74e31a1d691df0d3865e144775825723e6de68e2`: tải checkpoint22MB thật từ Git LFS,
  SHA `acc5ef353194cead5fa9b2f5f981c45083e24434aec88a419513249730162833`, repo MIT.
  Inspect pickle globals/class map trước weights_only load:11 digit/dot classes,
  không phải4category. OBB26 không có trong exporter8.3.224, nên thử riêng offline
  package8.4.110 trong `.tools/yolo26-packages` (không đổi production dependency).
  Export ONNX thành công, input1×3×640×640/output1×300×7. Raw top-k parity **FAIL**
  (2.76% elements khác, maxdelta284.38); detections score≥.5 khớp bbox/class/score
  sau bỏ khác biệt thứ tự low-score. Native chỉ tìm4 trong6 digits trên crop LCD
  GELEX do người thử chọn; exact=false. Không integrate; đây không phải test
  automatic display detection. [Evidence của probe](meter-ocr-wattbot-study.json).
- [Seeed Swift-YOLO](https://github.com/Seeed-Studio/sscma-model-zoo/blob/main/docs/en/Digital_Meter_Water_Swift-YOLO_192.md):
  model card digit classes, không phải4category; repo tree không có weights ONNX
  và link chính thức đã gặp403. Không tuyên bố runtime support.
- [Cian911 smart-gas-meter](https://github.com/Cian911/smart-gas-meter): tree MIT có
  digit ONNX, nhưng gas-specific, không có4category hay representative BHOME
  electricity/digital-water data. Chưa inference; không thêm default model vô cớ.

Model/dataset license và quyền redistribution vẫn phải được project review trước
deployment; không suy repo MIT thành quyền của mọi underlying Ultralytics asset.
Không training/fine-tuning trong lượt này. Ảnh identity thật không dùng làm data.

## E. Regression và các kiểm tra thất bại/chưa chạy

| Gate                                                 | Kết quả thực thi                                                                         |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Backend Release build                                | PASS,0 warning/error                                                                     |
| Application / Domain                                 | 225 /83 pass                                                                             |
| OCR integration                                      | 107 pass, bao gồm model thật qua HTTP + GELEX180°                                        |
| Meter confirmation + invoice finalization PostgreSQL | 6 pass, disposable loopback55491; storage substitute                                     |
| Stage2 native/.NET parity                            | 10 crop pass, weights pinned                                                             |
| PP regression                                        | 18 synthetic fixtures pass                                                               |
| Mobile Vitest / TypeScript / ESLint                  | 372 pass;TypeScript/ESLint pass                                                          |
| Dataset Node tests / ESLint                          | 25 pass, lint pass                                                                       |
| Real MinIO                                           | NOT RUN: không có Docker pipe, listener9000/9001 hoặc native MinIO binary được provision |
| Phone E2E                                            | NOT RUN: không có phiên thiết bị/camera thật điều khiển được                             |
| Four-type independent90% acceptance                  | NOT ACHIEVED                                                                             |

Lỗi tìm thấy không bị giấu: lint CJS mới ban đầu fail18 lỗi do Node globals/test
override và tên `crypto`; đã sửa scoped config/identifier rồi25 tests+lint pass.
Calibration tool ban đầu fail vì exact-hash leakage; đã explicit exclusion và ghi
manifest, không bỏ kiểm tra. WattBot raw ONNX parity và crop exact fail, nên không
đưa model này vào runtime. Không biến false/synthetic/stub tests thành evidence
MinIO/phone thật. Git diff đã gặp blank EOF trong docs/license; sửa formatting
riêng, không rewrite commit history.

## F. Blockers và bước tiếp theo

Lệnh tái lập increment (sau khi provision PP-OCR như tài liệu cũ):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Prepare-PretrainedMeterDetector.ps1 -Python .tools/yolo-python/python.exe -IncludeStage2 -IncludeFullPublicTest -IncludeValidation
dotnet run --project tools/BHome.OcrSmoke -c Release -- --water-decision-audit .tools/ocr-models .tools/meter-detection-models .tools/meter-detection-validation .tools/audit-val
dotnet run --project tools/BHome.OcrSmoke -c Release -- --water-decision-audit .tools/ocr-models .tools/meter-detection-models .tools/meter-detection-all-test .tools/audit-test
.tools/yolo-python/python.exe tools/BHome.OcrSmoke/model_tools/evaluate_water_decisions.py .tools/audit-val/audit-public-only.json .tools/audit-test/audit-public-only.json .tools/decision-summary.json --exclude-exact-overlap
dotnet run --project tools/BHome.OcrSmoke -c Release -- --meter-completion-evaluate .tools/ocr-models .tools/meter-detection-models .tools/meter-detection-all-test .tools/runtime-after.json
node --test tests/scripts/MeterDataset.test.cjs
```

Provisionscript stage1+validation đã chạy, hash/parity đúng; không chạy exporter
đồng thời với runtime dùng cùng files model. `decision-summary.json` chấm policy
trên raw audit; `runtime-after.json` mới là full service result. Không gộp hai loại
metric để tuyên bố accuracy. Raw audits/cells là public-only trong `.tools`.

Chưa hoàn thành OCR feature tổng thể. Cần dữ liệu approved theo site/meter cho4
loại với window polygons, complete digit string/decimal boundary, billing register,
unreadable, glare/blur và negative/multi-register labels. Validator/template mới
giúp kiểm cấu trúc/leakage, không tự tạo ground truth, kiểm PII hay cấp quyền dùng
ảnh. Đề xuất test tối thiểu50 ảnh độc lập mỗi loại; đây là kế hoạch, không dữ liệu
đã thu hay bảo đảm statistical power/90%.

Sau khi dữ liệu đủ quyền và model/license đã review: chốt split theo site trước
calibration, đánh giá pretrained phù hợp trước, rồi mới quyết định fine-tune
classifier4 lớp/display detector và recognizer từng family. Không áp water-model
cho electricity/LCD chỉ để lấp đủ4 loại. Thêm phone/MinIO E2E khi môi trường có
sẵn; giữ Staff confirmation, previous reading/precision và invoice guards.

## G. Lịch sử commit của task

| Commit               | Message                                                            | Description                                   | Verification                                    |
| -------------------- | ------------------------------------------------------------------ | --------------------------------------------- | ----------------------------------------------- |
| 5247f22              | feat(ocr): add guarded YOLO water digit recognition                | Inference stage2 và ambiguity guards          | Build;15 detector/digit tests;225 Application   |
| c96e1ab              | feat(ocr): resolve meter technology from explicit device labels    | Text evidence và real-model HTTP              | 225 Application; HTTP model smoke               |
| 320c191              | feat(mobile): explain OCR conflicts and profile confirmation       | Thông điệp review tiếng Việt                  | 31 OCR Mobile;TS/lint                           |
| 77c8bbc              | test(ocr): add reproducible stage-2 evaluation tooling             | Pin/model parity/crop/runtime tooling         | Tool build;10 parity;summary52                  |
| b3dbfd1              | docs(ocr): record stage-2 results and remaining model gaps         | Lưu baseline và evidence không nhạy cảm       | JSON/diff checks                                |
| 26efe76              | feat(mobile): review OCR units and precision after capture         | Đọc lại precision, hiển thị unit              | 33 OCR Mobile;TS/lint                           |
| cc94d5f              | chore(ocr): validate meter dataset annotations and split isolation | Annotation/path/group validation              | 25 Node tests;ESLint                            |
| 410a659              | test(ocr): audit fallback causes with validation and model probes  | Leakage audit và probe model thật             | Tool build;52+101 public audits;ORT probe       |
| d09df31              | fix(ocr): recover guarded water readings from unparseable PP text  | Thêm7 correct review proposals trên52 test cũ | Build;107 OCR;225 App;83 Domain;PG6;benchmark52 |
| HEAD (report commit) | docs(ocr): report incremental development and verification         | Báo cáo cuối, cập nhật docs và trạng thái Git | JSON/Markdown/diff checks; final gate logs      |

`HEAD` trong hàng cuối chỉ chính commit chứa report này; không thể chèn literal
hash của một commit vào chính nội dung tạo ra hash đó. Lấy hash đầy đủ bằng
`git rev-parse HEAD`; câu trả lời cuối cung cấp hash cụ thể sau commit. Không amend,
rebase hoặc sửa lịch sử để điền hash.

## H. Working tree cuối

Branch `member/QHuy`;10 commit local được tạo (bao gồm report commit). Sau commit
cuối phải có `git status --short` rỗng; không stage `.tools/`, `.env`, model weights,
private images, secrets hoặc build outputs. Các model nghiên cứu/ảnh/log ở ignored
`.tools` không phải files còn chờ commit. Kiểm tra trạng thái thực tế sau commit
được báo trong câu trả lời cuối. Không push, merge, PR hay rewrite history.
