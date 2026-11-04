# Kiểm toán và cải thiện Meter OCR — 04/11/2026

## Phạm vi và truy vết

Yêu cầu: audit hệ thống đang chạy, bảo toàn OCR nội bộ/Staff confirmation, sửa các lỗi
có thể kiểm chứng, chuẩn bị tích hợp detector khi có model/dataset phù hợp.

Nguồn đã đọc: `AGENTS.md`, `src/mobile/AGENTS.md`, SRS cục bộ
`docs/reports/BHome_Report-3_Software Requirement Specification (2).docx` (trích XML),
API conventions/status, các tài liệu `INTERNAL_OCR.md`, `OCR_ACCURACY_DELIVERY.md`,
`OCR_SIX_PROFILES_DELIVERY.md`, model card cục bộ và source/tests.
Tên các report cục bộ khác danh mục trong AGENTS.md; không khẳng định chúng là cùng
revision đã phê duyệt. Các số liệu trong báo cáo cũ không phải kết quả chạy lần này.

| Yêu cầu                         | Nguồn/ràng buộc                 | Thành phần                                             | Ca chấp nhận                                                                                      |
| ------------------------------- | ------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| OCR chỉ đề xuất, giữ nhập tay   | BF-05, UC-20, GBR-07            | OcrWorkflowService, LocalOcrService, MeterScreen       | đề xuất không tạo MeterReading; sửa tay rồi xác nhận riêng                                        |
| Đúng Staff/Location/Task        | GBR-01/02, SRS access matrix    | ResourceAccess, CaptureScope, OcrWorkflowService       | Owner/Tenant/Staff ngoài Location bị chặn trước OCR                                               |
| Giữ số lẻ, đối chiếu baseline   | UC-20; metadata Meter hiện có   | MeterReadingParser/Precision, CaptureWorkflowResources | không làm tròn/bỏ số lẻ; số thấp hơn baseline có cảnh báo; confirmation vẫn chặn reset chưa xử lý |
| Không chọn giữa nhiều vùng      | yêu cầu nhiệm vụ; GBR-07        | MeterReadingParser, MeterSceneSelection                | cùng/khác giá trị ở hai vùng đều fallback; không tự chọn box điểm cao nhất                        |
| Crop theo detector nếu có       | yêu cầu nhiệm vụ                | IMeterSceneDetector, OnnxOcrEngine                     | box đúng tọa độ/loại/confidence mới crop; model vắng giữ legacy có cảnh báo                       |
| Không phát hành hóa đơn từ OCR  | GBR-09; JOB-09/10 không đổi     | CaptureRepository và billing hiện có                   | chỉ ConfirmMeter tạo confirmed usage; xác nhận lặp không nhân đôi                                 |
| Proposal/fallback trong 10 giây | SRS NFR Internal OCR Processing | deadline LocalOcrService, OcrEvaluation                | đo số ca <=10 giây, p95/max; chưa nghiệm thu workload production                                  |

## Hệ thống trước thay đổi

1. Mobile [MeterScreen](../../src/mobile/src/app/meter.tsx) mở tác vụ từ server,
   chụp ảnh qua `CameraCapture` và POST binary JPEG/PNG đến
   `/api/v1/ocr/meter-tasks/{taskId}`. [OcrController](../../src/backend/BHome.Api/Controllers/Ocr/OcrController.cs)
   giữ role Staff, no-store và giới hạn upload; không có endpoint OCR bên ngoài.
2. [OcrWorkflowService.MeterAsync](../../src/backend/BHome.Application/Ocr/OcrWorkflowService.cs)
   đọc scope từ [CaptureWorkflowResources.FindMeterTaskAsync](../../src/backend/BHome.Infrastructure/Ocr/CaptureWorkflowResources.cs),
   kiểm tra quyền và task/meter đang cho phép capture trước khi đọc ảnh. UtilityType,
   Display và DecimalPlaces lấy từ Meter trên server; không phải visual classification.
3. [LocalOcrService.ExtractAsync](../../src/backend/BHome.Infrastructure/Ocr/LocalOcrService.cs)
   giữ semaphore, read có giới hạn, kiểm header/dimensions, timeout mặc định 8000 ms,
   xử lý inference/native failure thành manual fallback, xóa buffer và hash ảnh Meter.
4. [ImagePreprocessor.Prepare](../../src/backend/BHome.Infrastructure/Ocr/ImagePreprocessor.cs)
   decode OpenCV, resize xuống giới hạn, quarter-turn theo profile, đo blur/glare.
   CLAHE/median/adaptive threshold là tùy chọn, không bật đồng loạt. Không bổ sung
   biến đổi ảnh mới khi chưa có dữ liệu chứng minh lợi ích.
5. [OnnxOcrEngine](../../src/backend/BHome.Infrastructure/Ocr/OnnxOcrEngine.cs) dùng DBNet
   trên toàn ảnh đã chuẩn bị; detector này tìm **chữ**, không tìm Meter/Display.
   `Detect` resize chiều lớn nhất xuống 960, lấy contour, mở rộng box chữ;
   `Crop` hiệu chỉnh phối cảnh từng dòng rồi `ReadLine` chạy CTC recognition.
   Có kiểm trục chữ, thử chiều ngược khi thiếu dữ liệu, split số/đơn vị và numeric
   refinement có kiểm xung đột. Sessions sống dài, không tải weights mỗi request.
6. [MeterReadingParser](../../src/backend/BHome.Application/Ocr/MeterReadingParser.cs)
   chọn số theo nhãn/đơn vị và geometry; ghép digit boxes có bằng chứng. Không chọn
   đơn giản số lớn nhất. Không có box Meter hoặc detector Display trước recognition.
7. [MeterReadingPrecision](../../src/backend/BHome.Application/Ocr/MeterReadingPrecision.cs)
   áp precision server, giữ mọi chữ số và cảnh báo; không tự cắt phần thập phân.
   `CaptureWorkflowResources.RecordMeterProposalAsync` lưu proposal/hash/version trên
   task, chưa tạo confirmed reading hoặc Invoice.
8. Mobile upload ảnh riêng đến API evidence, cho sửa và bắt tick xác nhận.
   [CaptureRepository.ConfirmMeterAsync](../../src/backend/BHome.Infrastructure/Ocr/CaptureRepository.cs)
   khóa Meter/Task, recheck quyền, evidence, ngày/precision/baseline, chống replay khác
   payload; chỉ dùng proposal khi hash khớp evidence. Ảnh ở private storage, confirmed
   reading có actor/thời điểm/previous/consumption; billing dùng dữ liệu đã xác nhận.

### Model và thư viện thực tế

Backend .NET 8; `BHome.Infrastructure.csproj`: ONNX Runtime **1.24.4**, OpenCvSharp4
**4.13.0.20260627** (native Windows/Linux), EF Core **8.0.32**, Npgsql EF **8.0.11**,
Minio **6.0.4**. Mobile Expo **58.0.22**, React Native **0.88.1** theo package.json.
Không thêm dependency, provider, microservice hoặc Python runtime.

Weights đã kiểm SHA256 tại `.tools/ocr-models`:

| Artifact         | Mô tả theo model card đã pin                                              | SHA256                                                           |
| ---------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| detection.onnx   | PP-OCRv6 DBNet text detector                                              | eb13b44b25bb36f89528b68720af8a61d9cf381176107f465db1757b65d086e1 |
| recognition.onnx | Vietnamese PP-OCRv6 medium recognition Run 6, fine-tune identity/passport | 767305d37d06728fe9578ff8132595ce23f66139df5e2937fd4131bd1dc34f12 |
| charset.txt      | dictionary đi kèm recognizer                                              | 5d801bf60472c4c1b184b6b6843aa2c754d8daf1429247e07658ee0bd79ab448 |

Provisioning pin revision `9b5346432fb84a447fdc4d780a7741126b446b0f` trong
`scripts/Get-OcrModels.ps1`; model card tự khai Apache-2.0. Không có weights YOLO,
Meter detector/classifier hoặc Display detector đã được kiểm chứng trong repository.

### Nguyên nhân hạn chế

- Chữ ở tường/serial/thông số vẫn vào DBNet; chữ nhỏ có thể mất khi downsize toàn ảnh.
  Parser đơn vị/geometry giảm sai nhưng không chứng minh ảnh chứa đúng đồng hồ.
- Trước sửa, parser gộp các candidate có cùng chuỗi số thành một giá trị duy nhất;
  hai vùng cùng số bị nhận là chắc chắn. Nhãn `Chỉ số điện/nước` chưa khớp utility.
- Giới hạn số vùng chữ có cảnh báo nhưng vẫn cho parser chọn từ tập đã bị cắt;
  cảnh báo chiều xoay xung đột cũng chưa chặn proposal.
- Nhận dạng được chữ số không đồng nghĩa đúng billing register; thiếu dữ liệu LCD
  đa trang, bánh số chuyển tiếp, glare/che khuất và nhiều hãng đồng hồ thật.
- Mobile chỉ hiển thị fallback/thành công chung, không dùng warning codes; khi chụp
  lại và OCR lỗi có thể giữ giá trị cũ. UI/backend không có cơ sở tự xác định physical
  Meter thuộc Room chỉ từ ảnh.

## Thứ tự cải thiện

| Ưu tiên         | Công việc                                                   | Phụ thuộc                                                    | Trạng thái                           |
| --------------- | ----------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------ |
| P0              | Chặn số mơ hồ/sai utility; cảnh báo baseline; sửa review UI | code và fixture sẵn có, không training                       | đã triển khai và kiểm thử            |
| P1              | Điểm tích hợp crop Meter/Display, confidence và fallback    | chưa cần weights để kiểm thử orchestration                   | đã triển khai; chưa có detector thật |
| P1 tiếp theo    | Đo và fine-tune detector Meter/Display                      | ảnh đã gán box, split không rò rỉ, giấy phép/model được chốt | chưa thực hiện                       |
| P2              | Kiểm chứng category/register trên ảnh thật                  | ground truth, confidence được hiệu chuẩn; vẫn dùng metadata  | chưa thực hiện                       |
| P3 có điều kiện | Fine-tune recognition nếu crop đúng vẫn sai nhiều           | benchmark crop riêng chứng minh bottleneck, chuỗi nhãn đúng  | chưa có căn cứ để train              |

## Thay đổi và mức hoàn thành

**Đã triển khai:**

- Parser từ chối nhiều candidate kể cả cùng số; thêm `multiple_reading_regions` để
  không cho lần thử chiều ảnh sau chọn mất một vùng hợp lệ. Lỗi thiếu ngữ cảnh do ảnh
  lộn ngược vẫn được thử sửa chiều. Chặn proposal khi text limit/orientation conflict.
- Nhãn utility sai và đơn vị sai có `meter_type_mismatch`; không đoán chữ số thay thế.
- Resource query lấy baseline của đúng Meter trên server; sau precision, chỉ số thấp
  có `reading_below_previous`. Đây là cảnh báo, không sửa số và không thêm policy
  rollover/replacement. Confirmation vẫn kiểm lại trạng thái trong transaction.
- Mobile hiển thị hướng dẫn tiếng Việt cho ambiguity/utility/quality/decimal/baseline,
  tiến trình OCR/upload, xóa số cũ khi chụp lại và bỏ response muộn sau hủy. Nhập tay,
  checkbox, upload evidence và khóa chống gửi lặp vẫn được giữ.
- Evaluator bổ sung exact-reading accuracy trên ảnh dương, false-reading rate trên
  proposal đã xuất (kể cả số sai trên ảnh dương), max và số ca <=10 giây. Không ghi
  raw text/giá trị đọc/ảnh vào report.

**Tích hợp một phần, chưa có model hoạt động:**

- [IMeterSceneDetector / MeterSceneSelection](../../src/backend/BHome.Infrastructure/Ocr/MeterSceneSelection.cs)
  nhận box/confidence/category/reading regions, kiểm 0/nhiều Meter, sai loại,
  confidence thấp/NaN, bounds sai/tràn số, 0/nhiều Display trước khi crop.
  OnnxOcrEngine thực sự crop vùng được chấp nhận **trước DBNet/recognition**.
- Adapter chưa được đăng ký trong DI. Mặc định chạy legacy với
  `meter_localization_unavailable` và `reading_region_unverified`. `ReadingRegions=null`
  nghĩa adapter không hỗ trợ Display và cho OCR trên box Meter; `[]` nghĩa đã dò mà
  không thấy, phải fallback. Confidence visual thấp dùng metadata với cảnh báo;
  confident category mismatch chuyển nhập tay. Digital display có cảnh báo register.
- Các box/category/confidence là hợp đồng nội bộ; chưa thêm trường public API hay
  preview box khi không có model để cung cấp dữ liệu đáng tin cậy.

**Chưa triển khai:** detector/classifier/display model thật, tự xác minh đúng Room/serial,
fine-tune/training, nhận diện billing register, ngưỡng tiêu thụ bất thường theo chính sách,
quy trình reset/rollover mới và UI preview vùng thật. Không tự đặt ngưỡng tiêu thụ
hoặc thay đổi billing để hoàn tất checklist. Thiết kế dataset/training và giấy phép:
[METER_OCR_DATASET.md](METER_OCR_DATASET.md).

Tái sử dụng toàn bộ model, preprocessing/refinement, DI/deadline, authorization,
evidence/transaction/confirmation và billing. Không thay schema/table/endpoint/DTO,
không sửa logic CCCD OCR hay retention. Engine version mới `...-meter5` theo dõi
pipeline; weights vẫn giữ nguyên. Test capture được dùng qua persistence base và
fixture user helper sẵn có để chạy được cả legacy và Compact24.

Luồng sau thay đổi:

```text
Task metadata + server authorization
  -> bounded input/header validation + preprocessing
  -> optional Meter/Display adapter
       unavailable: legacy text OCR + warnings
       ambiguous/invalid: manual fallback
       one accepted ROI: crop before text detection
  -> DBNet text regions + PP-OCR recognition
  -> unit/layout/ambiguity parser -> server precision -> baseline advisory
  -> OCR proposal on Task (not a confirmed reading)
  -> private evidence upload -> Staff review/correction + explicit confirmation
  -> existing transactional confirmation -> confirmed usage for billing
```

## Kiểm chứng trong phiên này

Tổng hợp có thể đọc bằng máy:
[2026-11-04-results.json](../testing/meter-ocr/2026-11-04-results.json).
Không lấy kết quả lịch sử trong tài liệu khác để điền bảng này.

| Kiểm tra đã chạy                                                     | Kết quả                                                   |
| -------------------------------------------------------------------- | --------------------------------------------------------- |
| `dotnet build src/backend/BHome.sln -c Release`                      | PASS, 0 warning/error                                     |
| Application UnitTests, toàn project                                  | 191 PASS, 0 fail/skip                                     |
| Domain UnitTests, toàn project                                       | 83 PASS, 0 fail/skip                                      |
| IntegrationTests, namespace Ocr, trừ Category Docker/CompactPostgres | 78 PASS, 0 fail/skip                                      |
| MeterCaptureRegressionTests trên PostgreSQL 16.15 riêng              | 5 PASS, 0 fail/skip; storage substitute rõ ràng           |
| Mobile Vitest, toàn suite                                            | 331 PASS                                                  |
| Mobile workspace TypeScript 6 typecheck và ESLint                    | PASS                                                      |
| Model SHA256 và smoke adapter/crop + PP-OCR thật                     | 3 artifact khớp; 32/32 PASS (category/box do fixture cấp) |

Đối chiếu cùng ảnh, cùng model weights giữa executable baseline lưu **trước sửa**
(`.tools/meter-audit-baseline`, `...-layout4`) và candidate (`...-meter5`):

| Bộ ảnh                                                   | Baseline              | Sau sửa               | p95 baseline → sau sửa                                  |
| -------------------------------------------------------- | --------------------- | --------------------- | ------------------------------------------------------- |
| 68 ca Meter từ bộ tổng hợp hiện có                       | 68/68                 | 68/68                 | 3603 → 5058 ms                                          |
| 16 ca layout an toàn mới                                 | 12/16, 4 proposal sai | 16/16, 0 proposal sai | 2105 → 2487 ms                                          |
| Một ảnh điện tử có sẵn, cùng SHA256 với `docs/image.png` | 1/1                   | 1/1                   | 2650 → 2622 ms (một mẫu, không phải phân bố có ý nghĩa) |

Bộ cũ gồm 64 ca dương (8 nguồn Meter × 8 biến thể original/tilt/perspective/dim/JPEG/
90/180/270) và 4 ca ảnh trống; không phải 68 ảnh thật độc lập. Bộ mới có 4 ca dương
và 12 ca từ chối (hai vùng cùng số, khác số, sai đơn vị cho từng profile), được tạo
bằng `New-MeterSafetyFixtures.ps1`. Cải thiện chính được chứng minh là **từ chối bốn
ảnh hai vùng cùng số**; không phải tăng accuracy detector. Một ảnh thật dùng nhãn
đã được xác nhận trong tài liệu trước, không phải một tập gán nhãn độc lập mới.

Candidate giữ đúng 64/64 chỉ số bộ cũ và 4/4 chỉ số bộ mới; các ca từ chối đều không
phát proposal. `meterProposalMetrics` nêu mẫu số của exact accuracy và false-reading
rate; các số này chỉ áp dụng cho từng bộ nhỏ nói trên. Meter recall, Display recall,
visual classification accuracy và E2E Staff-confirmation accuracy: **NOT MEASURED**.

Trong lượt cuối, 68/68 và 16/16 ca tổng hợp tạo proposal/fallback <=10 giây;
max tương ứng **5305 ms** và **2487 ms**. Đây là request tuần tự vào service nội bộ,
không gồm upload/evidence/HTTP trên điện thoại, không phải workload 100 phiên hay
benchmark kiểm soát toàn máy. p95 bộ cũ tăng trong phép đo này; **không kết luận tăng
tốc hoặc đã nghiệm thu NFR production**. Model initialization được báo riêng bởi tool.

Các kiểm tra phát hiện lỗi trong quá trình làm và đã giải quyết:

- Build đầu bị `CS0854` do thêm optional constructor argument trong EF expression;
  đã truyền null tường minh ở projection identity, không đổi xử lý CCCD.
- Lượt thử đầu với guard xoay quá rộng chỉ đạt 52/68; đã giữ nguyên retry của identity,
  phân biệt nhiều vùng hợp lệ với thiếu ngữ cảnh do lộn ảnh, chạy lại 68/68.
- Lượt đầu PostgreSQL regression lỗi fixture legacy user/context và JWT của host khác;
  đã tái sử dụng persistence/user helper và login của đúng host. Kiểm chứng object
  MinIO công khai giữ ở Docker test riêng, không chạy vào URL storage giả lập.
- Vitest từ sai working directory không tìm thấy test; component test thiếu DOM
  matchers; typecheck dùng TypeScript root thay vì workspace không tương thích. Đã
  sửa cách chạy/setup, chạy lại toàn mobile suite, workspace typecheck và lint PASS.

Docker daemon không truy cập được (`docker info` thất bại). Real MinIO/Docker
capture tests: **NOT RUN**. PostgreSQL tạm tại loopback port 55491 đã được dừng sau
kiểm thử; fixture tạo/xóa database riêng, không sửa database BHOME đang dùng.
Chưa chạy native Android/iPhone E2E, load test, coverage, dataset >=50 ảnh thật,
training hoặc đo tính tương đương native/ONNX của detector mới.

### Lệnh tái lập chính

Chạy từ root (trừ các lệnh workspace ghi rõ). Node 22.23.4 cục bộ được dùng trong
phiên này vì Node mặc định máy là 24, ngoài engines của repository.

```powershell
dotnet build src/backend/BHome.sln -c Release
dotnet test tests/backend/BHome.Application.UnitTests -c Release --no-build
dotnet test tests/backend/BHome.Domain.UnitTests -c Release --no-build
dotnet test tests/backend/BHome.IntegrationTests -c Release --no-build --filter '(FullyQualifiedName~.Ocr.&Category!=Docker&Category!=CompactPostgres)'
# Chỉ sau khi cấu hình BHOME_COMPACT24_TEST_ADMIN cho PostgreSQL test loopback riêng:
dotnet test tests/backend/BHome.IntegrationTests -c Release --no-build --filter FullyQualifiedName~MeterCaptureRegressionTests

npm.cmd run test --workspace mobile
npm.cmd run typecheck --workspace mobile
npm.cmd run lint --workspace mobile

powershell -NoProfile -ExecutionPolicy Bypass -File scripts/New-MeterSafetyFixtures.ps1
dotnet run --project tools/BHome.OcrSmoke -c Release -- .tools/ocr-models --evaluate .tools/meter-safety/manifest.json .tools/meter-safety/report.json
dotnet run --project tools/BHome.OcrSmoke -c Release -- --meter-scene-smoke .tools/ocr-models .tools/meter-safety

# Tái tạo bộ tổng hợp hiện có vào thư mục mới; chỉ chọn Meter cho đợt audit này:
dotnet run --project tools/BHome.OcrSmoke -c Release -- --generate-evaluation tests/fixtures/ocr .tools/meter-evaluation
$manifest = Get-Content -Raw -Encoding utf8 .tools/meter-evaluation/manifest.json | ConvertFrom-Json
$manifest.cases = @($manifest.cases | Where-Object { $_.kind -notlike 'Identity*' })
$manifest | ConvertTo-Json -Depth 20 | Set-Content -Encoding utf8 .tools/meter-evaluation/meter-manifest.json
dotnet run --project tools/BHome.OcrSmoke -c Release -- .tools/ocr-models --evaluate .tools/meter-evaluation/meter-manifest.json .tools/meter-evaluation/report.json
```

Weights và executable/report đầy đủ trong `.tools/` là artifact local bị gitignore,
không commit ảnh thật/model. Summary JSON đã đưa vào docs không chứa raw reading,
OCR text, ảnh, token hoặc dữ liệu Tenant. Để so sánh lại baseline, build source trước
thay đổi vào output riêng và dùng cùng manifest; không cập nhật nhãn theo output.

## Danh mục file thay đổi

- Application: `MeterReadingParser.cs`, `OcrFieldParser.cs`, `OcrWorkflowService.cs`.
- Infrastructure: `CaptureWorkflowResources.cs`, `OcrOptions.cs`, `OnnxOcrEngine.cs`,
  mới `MeterSceneSelection.cs` (đều dưới `src/backend/.../Ocr/`).
- Mobile: `src/mobile/src/app/meter.tsx`, mới `src/mobile/src/services/meterOcrFeedback.ts`.
- Tests: `OcrParserTests.cs`, `OcrWorkflowTests.cs`, `CaptureWorkflowTests.cs`, mới
  `MeterSceneSelectionTests.cs`, `MeterCaptureRegressionTests.cs`,
  `tests/mobile/ocr/meterOcrFeedback.test.ts`, `meterScreen.test.tsx`.
- Tools: `tools/BHome.OcrSmoke/OcrEvaluation.cs`, `Program.cs`, mới `MeterSceneSmoke.cs`;
  mới `scripts/New-MeterSafetyFixtures.ps1`.
- Docs: báo cáo này, `METER_OCR_DATASET.md`, ghi chú trong `docs/api/API_IMPLEMENTATION_STATUS.md`.

Không commit, push, merge hoặc triển khai. Nhánh làm việc `member/QHuy`.
