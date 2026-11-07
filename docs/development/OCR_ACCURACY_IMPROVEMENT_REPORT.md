# OCR accuracy recovery — 07/11/2026

**Chưa có cải thiện production được chấp nhận.** Đã chẩn đoán bằng model thật,
thử recognizer khác và tải nguồn LCD điện mới. Historical typed pipeline vẫn10/33
exact digit strings,42/52 fallback. Không hạ safeguards để tăng coverage; không
đánh dấu bốn reader hoặc classifier là hoàn tất.

## Phạm vi, Git và traceability

Start thực tế `268a6688bb422f050b405902fa655c157ce7d5d1`, `member/QHuy`, working tree
sạch; khác0325559 dự kiến vì branch đã có merge trước lượt này. Giữ bảy commit OCR
trước; không push/merge/rebase/reset hoặc sửa lịch sử.

BF-05/UC-20/GBR-07: OCR là đề xuất, Staff có quyền tại Location phải xác nhận;
UC-21/JOB-10 chỉ dùng confirmed readings. Đã đọc SRS hiện có trong `docs/reports`.
Yêu cầu → smoke/model tools ghi actual stage outputs → fixed validation và oracle
comparison → regression scope/metadata/correction/confirmation/replay/invoice.
Không thay API, schema, Meter metadata, authorization hoặc billing. Không có diff
runtime trong `src/backend` và `src/mobile` so với start.

## Baseline và comparison cùng dữ liệu

Historical52 có33 publisher-complete digit labels. Validation101 loại1 SHA trùng
test còn100,69 complete labels. Đây là historical/development data, không phải
independent acceptance: physical-meter/site grouping, readability và decimal/
billing-register GT chưa được review độc lập. Không sửa nhãn bằng model output;
nghi vấn label thiếu digit ởvalidation317 vẫn được giữ và tính sai theo publisher.

| Metric | Baseline | Candidate / hiện trạng | Chênh lệch / quyết định |
| --- | --- | --- | --- |
| Historical typed exact /33 |10|10 hiện hành|0|
| Historical wrong proposals /33 complete |0|0 hiện hành|0; không suy an toàn trên GT thiếu|
| Historical fallback /52 |42|42 hiện hành|0|
| Historical correct /all |10/52|10/52|0|
| Historical automatic exact /33 |1, lần trước|NOT RUN mới|Classifier không đổi|
| Historical automatic fallback /52 |51, lần trước|NOT RUN mới|Không nhận là cải thiện|
| Validation exact /69 |12|13 mixed English|+1; REJECTED do bỏ numeric disagreement cũ|
| Validation wrong /69 |0|0 mixed|0 quan sát; chưa đủ qua safety gate|
| Validation fallback /100 |88|87 mixed|−1, không tích hợp|
| Validation correct /all |12%|13% mixed|+1 điểm %, bị loại|
| Validation exact /emitted |12/12|13/13 mixed|Chỉ theo publisher digit labels|
| Validation exact /69, strict English |12|11|−1; REJECTED|
| Validation fallback /100, strict |88|89|+1|
| Window IoU≥0,5 validation |100/100|100/100 geometry hypothesis|0 selection đổi|
| Window IoU≥0,5 historical |51/52|Không candidate mới qua gate|1 missing,0 unique wrong selection|
| Validation Stage2 predicted/oracle exact |47/69|49/69 oracle|+2; không phải production|
| Validation Stage2 predicted/oracle wrong |4/69|5/69 oracle|+1 sai; không triển khai|
| Classification recall/mAP mới |N/A|NOT RUN|Không train corpus62 cũ|
| Validation p95 diagnostic service ms |831,85|Mixed1911,30; strict1789,50|+1079,45/+957,65; wrapper lặp inference|

Latency chỉ là CPU local, không phải production/upload/camera. Historical trace
p95 khoảng922,2ms; không so với validation khác tập. Candidate được chọn/loại trên
validation trước khi trace historical được xem, không tune bằng historical test.

## Nguyên nhân và experiments

[Root-cause report](OCR_FAILURE_ROOT_CAUSE_ANALYSIS.md) có lệnh tái tạo và13 ca cụ
thể. [Validation stages](ocr-recovery-validation-stages.json),
[historical stages](ocr-recovery-historical-stages.json),
[digit/localization audit](ocr-recovery-localization-digits.json) pin hash raw trace.
Actual Stage1 boxes/crop points/quality, Stage2 positions/order/confidence, PP raw
lines/numeric candidates, parser/fusion warnings và latency nằm ở `.tools` ignored.
Oracle là quadrilateral annotation của publisher, không phải crop production.

Stage1 validation tìm đúng window100/100 nhưng scene policy chỉ cho75 qua. Stage2
predicted47 exact, PP page5, full fusion12; oracle fusion15 exact nhưng2 wrong. Nút
thắt chính ở corpus này là recognition/fusion; crop đúng chưa giải quyết domain
mismatch. Historical Stage2 có23 exact, full fusion10. Trong13 ca bị loại:9 có PP
numeric cạnh tranh thật,3 nhiều vùng/phân mảnh,1 mờ; cả13 thiếu register/decimal GT.
Không coi mọi string đúng publisher label là proposal có thể phục hồi an toàn.

Digit matching Hungarian/IoU0,3 chỉ dùng đánh giá, không đổi threshold production.
Predicted crops:571 known digits,6 missing,18 extra boxes,13 matched wrong digits,
8u predictions tại known digits,0 ordering inversions. Oracle:739 known,10 missing,
22 extra,20 wrong,13u,0 inversions. Số crop tạo được khác nhau nên mẫu số khác;
không cộng lỗi chồng lấp hoặc suy u nghĩa là thực sự unreadable.

| Work unit | Trạng thái và bằng chứng |
| --- | --- |
| Per-image diagnostic |IMPLEMENTED/VALIDATED với actual inference, hash ảnh/label, predicted/oracle/full pipeline|
| AABB/OBB u-center hypothesis |REJECTED:0 AABB-only cases,75→75 allowed; không đổi detector/NMS/sortX|
| Scaling/CLAHE/padding/multiscale mới |NOT RUN; không tuyên bố cải thiện chưa đo hoặc fine-tune thiếu verified groups|
| Official English PP-OCRv5 mobile |IMPLEMENTED offline, Apache-2.0, pin model/config/charset, Python/.NET parity4/4 PASS|
| English∩Stage2 |REJECTED: predicted21 proposals,19 exact,1 wrong complete,1 unknownGT; oracle19/17/1/1|
| Mixed confidence policy |REJECTED:12→13 exact nhưng bỏ một số valid numeric disagreement của baseline|
| Strict policy giữ mọi disagreement |REJECTED:12→11 exact,88→89 fallback|
| PP-primary/calibrated billing fusion |NOT RUN: thiếu independent register/precision GT, không bypass veto|
| Candidate trên historical heldout |NOT RUN sau khi đã fail validation; không dùng test chọn model|

English revision `3fafbc3b5dcf93dd72add9f48368be8a3a2cd33b`; CTC/resize pin theo
reference. Adapter chỉ trong smoke tools, không DI/config runtime. Confidence grid
chỉ chạy validation, fixed0,95 không thành threshold production.
[English comparison](ocr-recovery-english-results.json),
[13 rejected cases](ocr-recovery-rejected-cases.json). Không tạo fix/feature commit
cho candidate fail gate. Non-billing-unit, numeric disagreement, missing/unreadable
digits, wrong register/category và Staff confirmation được giữ nguyên.

## Dữ liệu mới và leakage controls

[Source research](ocr-recovery-source-research.json) ghi nguồn/license/restrictions.
Ba Roboflow preview CC-BY-4.0 đều mechanical water dù tên nguồn cóLCD;200×200, không
exact GT, không nhận làm digital-water train. WMeter-Reader/legacy digit models chưa
xác minh đủ license; gated sources không vượt gate. Badger4548 crops vẫn một thiết
bị, quarantine; Dryad403 không coi đã tải được.

Kaggle meter-data v1 tải public HTTP200:327 ảnh, MIT theo metadata API, ZIP33.039.810
byte, SHA pin trong [audit](../datasets/meter/KAGGLE_ELECTRICITY_DEVELOPMENT_AUDIT.md).
Không trùng SHA/pHash63 distance≤6, nhưng physical independence vẫn unknown.293 ảnh
có một reading box hợp lệ. Nguồn không có numeric/decimal/register GT hoặc body boxes;
không dùng publisher split như meter-separated và không train lượt này.

12 crop ghi bản đọc nháp trước inference: PP direct/page đều0/12 khớp nháp, English
4/12; p95 tương ứng99,98/457,33/21,06ms trên crop. Sau inference phát hiện030/038/053/
065 cần second review về leading zeros/ký tự cuối; không sửa theo model hoặc bỏ
khỏi mẫu số. Tất cả12 vẫn draft, không phải ground truth được xác minh, train hoặc
acceptance. Không regex bỏ ký tự thừa để tính exact. Đây chỉ là tín hiệu nghiên cứu
component, **không phải validated accuracy improvement**.
[Manifest](../datasets/meter/kaggle-electricity-development-candidates.json),
[audit/raw comparison](ocr-recovery-kaggle-results.json).

Trên hai ảnh public từ nguồn khác bộ nước lịch sử của lượt trước, English oracle-crop đọc đúng
water35558 (min character0,9941); electricity000059 có dấu ngoặc kép thừa, không
exact. Agent-reviewed crop observation không phải full-frame hoặc billing accuracy.

[Pilot collection](../datasets/meter/RECOVERY_PILOT_COLLECTION.md):8 thiết bị,2/loại,
3 điều kiện/thiết bị,24 ảnh dự kiến; chưa thu được, không phải benchmark thực hiện.
Cần blinded human review chỉ số/register/precision và nhóm thiết bị rồi freeze
splits. Public crops/weights ởignored `.tools`; không commit ảnh/weights/secrets,
không gửi ảnh toàn cảnh có serial hoặc dữ liệu Tenant ra AI service.

## Trạng thái bốn loại

| Loại | Evidence mới | Kết luận |
| --- | --- | --- |
| Water mechanical |Full historical10/33; oracle/English thử thật|Chưa có candidate an toàn được chấp nhận|
| Electricity mechanical |Chưa có corpus mới với GT đầy đủ, độc lập|Reader chuyên biệt BLOCKED data|
| Electricity digital |English khớp4/12 bản nháp, vẫn sai/thừa ký tự|Offline; chưa xác minh register/precision|
| Water digital |Thiếu nhiều thiết bị độc lập với exact GT|BLOCKED data|

Four-class adapter/config vẫn disabled; không train lại weak62. Recall/precision/
unknown/open-set/mAP/runtime mới NOT RUN. Không coi all-unknown là thành công hoặc
PP/manual fallback là category-specific reader hoàn tất.

## Regression đã thực sự chạy

Không cộng suite chồng lấp thành một tổng. Logs/TRX ở`.tools`/TestResults ignored.
Runtime không thay đổi so với start; không sửa lỗi Contract/incident ngoài scope.

| Check | Kết quả |
| --- | --- |
| Backend API Release build |PASS,0 warnings/errors|
| Smoke tools Release build, kể cả LCD comparison mới |PASS,0 warnings/errors|
| Backend solution Release build |FAIL:14 CS1503 ở ContractServiceTests56/57/126/127, DTO constructor không khớp|
| Full Application tests |Compile-blocked bởi14 lỗi trên; không báo321 suite cũ pass|
| Focused original OCR Application files, temporary project |154 PASS,0 skip; không phải full Application suite|
| Domain |106 PASS,0 skip|
| OCR Integration với local ONNX |125 PASS,0 skip|
| PostgreSQL/ONNX Staff workflow + invoice filters |7 PASS,0 skip; evidence storage in-memory|
| Stage2 pinned native/.NET parity |10/10 PASS|
| English Python/.NET parity |4/4 PASS|
| Dataset Node validators |29 PASS|
| Existing Python model tools |29 PASS|
| New geometry/integrity Python tests |3 PASS: corner winding, crop warp, corrupt model rejected before network|
| Python compile scripts mới |PASS|
| Mobile Vitest Node22 |54 suites PASS,2 FAIL collection;544 executed tests PASS|
| Mobile TypeScript |FAIL: missing installed expo-image-picker và URL/Node iterator type mismatch|
| Mobile ESLint |PASS, exit0|

Mobile: `meterScreen.test.tsx` paper mock thiếu `MD3LightTheme`; incident suite không
resolve `expo-image-picker`. Package/lock có dependency nhưng local node_modules
thiếu. Build đầu song song có output-copy locks; chạy lại tuần tự cuối chỉ còn14
lỗi DTO nêu trên. Không báo full regression xanh.

Lệnh backend chính:

```powershell
dotnet build src/backend/BHome.sln -c Release --no-restore
dotnet build src/backend/BHome.Api/BHome.Api.csproj -c Release --no-restore
dotnet build tools/BHome.OcrSmoke -c Release --no-restore
dotnet test tests/backend/BHome.Domain.UnitTests -c Release
$env:BHOME_OCR_LOCAL_EVALUATION_ROOT=(Get-Location).Path
dotnet test tests/backend/BHome.IntegrationTests -c Release --filter 'FullyQualifiedName~Ocr&Category!=Docker&Category!=CompactPostgres'
.tools/yolo-python/python.exe tests/scripts/test_ocr_diagnostic_geometry.py
```

Focused temporary `.tools/ocr-recovery-focused-tests/FocusedOcr.Tests.csproj` compile
nguyên OCR files, same packages/assembly name; không sửa source test để né lỗi.
Workflow filter: `FullyQualifiedName~CompactMeterOcrWorkflowTests|FullyQualifiedName~Compact24InvoiceRegressionTests.Finalization|FullyQualifiedName~Compact24PaymentRegressionTests.MeterAutomation`.
PostgreSQL16 isolated loopback55493 chỉ synthetic data; đã dừng sau test.
Mobile chạy Vitest, tsc và ESLint bằng local Node22; raw logs
`.tools/ocr-recovery-mobile{,-types,-lint-final}.log`.

## Camera và MinIO

**NOT RUN** physical camera→upload→backend→Staff review→PostgreSQL→MinIO: không
adb/device, không listener MinIO9000/9001 hoặc Docker daemon dùng được. Bảy workflow
tests dùng PostgreSQL/ONNX thật nhưng storage RAM. Không gọi đây là MinIO transport
hoặc physical E2E; latency gồm upload/camera chưa đo. Scope/metadata/correction/
confirmation/replay và confirmed reading→invoice được regression ở mức integration.

## Local commits và final state

| Commit | Short English description |
| --- | --- |
| d0fa932 |Compare full-frame, oracle crop, recognizer and fusion failures|
| 0e715af |Prepare a practical positive capture pilot|
| cb2bccc |Evaluate water localization and digit geometry|
| 7d27876 |Evaluate pinned English water recognition candidates|
| 8324263 |Verify thirteen rejected historical water readings|
| 55193e8 |Audit licensed electricity LCD candidates and draft crops|
| 1d83599 |Protect diagnostic geometry and model artifact integrity|
| Commit chứa report này |Record measured results, rejected gates and blockers|

Final HEAD đầy đủ và working-tree status **sau commit** được ghi tại
`.tools/ocr-recovery-final-state.json`; full history tại `.tools/ocr-next-git-history.md`.
Commit chứa report này là final reporting HEAD; không tự nhúng hash của commit chưa
được tạo. Báo cáo trước chỉ phản ánh lượt trước, không thay kết quả đỏ hiện tại.

Diagnostics và thử nghiệm khả thi đã thực hiện; **mục tiêu tăng số đọc đúng an toàn
chưa đạt**. Gate tiếp theo: blinded review và nhóm thiết bị của LCD mới, thêm digital
water đa thiết bị và register/precision GT, freeze validation/test trước training/
calibration. Không thay dữ liệu thiếu bằng bỏ veto, đo trên train hoặc gọi fallback
là reader hoàn tất.
