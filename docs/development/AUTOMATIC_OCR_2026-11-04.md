# OCR tự động một nút chụp — 04/11/2026

## Phạm vi, căn cứ và tiêu chí

Yêu cầu trực tiếp: bỏ chọn sáu profile trước khi chụp trong màn **Thử OCR trực tiếp**;
backend phải thực sự phân tích ảnh không có profile, định tuyến khi đủ căn cứ và hỏi
lại sau chụp khi chưa rõ. Nguồn: yêu cầu người dùng, AGENTS.md, src/mobile/AGENTS.md,
[audit Meter OCR](METER_OCR_AUDIT_2026-11-04.md), [dataset/model](METER_OCR_DATASET.md)
và source thực tế. SRS cục bộ vẫn là bản `(2).docx` đã đối chiếu ở audit; không suy
ra trùng revision với tên khác trong danh mục AGENTS.md.

| Hành vi                                            | Truy vết                        | Thành phần và kiểm thử                                                                                      |
| -------------------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Một nút chụp, định tuyến sau phân tích             | yêu cầu mới; BF-03/05, UC-13/20 | OcrTest, OnnxOcrEngine.Analyze, OcrCategoryRules, AutomaticOcrRouter; test UI/HTTP/routing                  |
| Không đoán loại hoặc confidence                    | yêu cầu mới; GBR-07             | unknown/ambiguous/unavailable; không có proposal trước khi biết loại; confidence quy tắc là null            |
| Kết quả chỉ để review, sửa tạm                     | GBR-07/09                       | IdentityProposal/MeterProposal tách slot; không gọi repository/confirmation/billing                         |
| Giữ giới hạn role và Development                   | GBR-01/02; diagnostics hiện có  | Owner/Staff, Development + MobileDevelopment.Enabled; 401/403/404 và no-store tests                         |
| Ảnh CCCD tạm, không lưu nghiệp vụ                  | GBR-13, NFR privacy             | buffer server zero trong finally; cache camera cũ xóa như trước; preview/buffer review trong RAM có cleanup |
| Deadline/đồng thời, không chạy sáu lần OCR         | NFR Internal OCR Processing     | semaphore/deadline chung; một lần đọc chữ trung lập, tối đa một lần thử chiều ngược có điều kiện            |
| Giữ task scope, human confirmation, invoice guards | UC-20/21, GBR-07/09             | API nghiệp vụ không đổi; PostgreSQL meter replay/validation và invoice finalization regression              |

Không thêm table, migration, package, dịch vụ bên ngoài hoặc Python runtime vào backend.
Không commit/push/merge hoặc triển khai production trong lượt này.

## Vì sao trước đây phải chọn profile

`src/mobile/src/app/ocr-test.tsx` trước đây mặc định `identity-front`, hiển thị sáu
profile và gửi `POST /api/v1/ocr/diagnostics/{profile}`. `OcrDiagnosticsController.Extract`
đổi path thành OcrDocumentKind trước khi gọi IOcrService. `LocalOcrService`/`OnnxOcrEngine`
đã cần kind để chọn profile tiền xử lý, bucket đọc dòng, refinement công tơ và parser.
Production meter workflow biết loại từ Meter server; direct-testing không có Meter Task.
Không có bước phân loại ảnh trước đó, nên chỉ xóa các nút sẽ vẫn chọn nhầm mặc định.

## Kiến trúc hiện tại

```text
Chụp ảnh OCR (không profile)
  -> POST /api/v1/ocr/diagnostics/auto
  -> role + Development opt-in + no-store
  -> LocalOcrService: chung concurrency/deadline/giới hạn/zero buffer
  -> OnnxOcrEngine.AnalyzeAsync: PrepareUnclassified (profile trung lập riêng)
       -> IImageCategoryClassifier nếu có adapter đã kiểm chứng (hiện chưa đăng ký)
       -> DBNet và recognition PP-OCR, giữ tọa độ vùng chữ
       -> quy tắc từ chữ; thử hướng ngược chỉ khi chưa có dấu hiệu phân loại
  -> AutomaticOcrRouter trong Application
       -> đủ căn cứ: OcrFieldParser đúng loại + kiểm precision cho Meter
       -> chưa đủ/xung đột: không xuất proposal, yêu cầu review
  -> preview, loại ảnh, trường có thể sửa trong RAM
       -> nếu cần làm rõ: chọn loại sau chụp -> endpoint profile cũ trên cùng ảnh tạm
```

Không dùng OcrInputKind mặc định để tự coi ảnh là CCCD mặt trước hoặc công tơ điện tử.
Chế độ đọc dòng trung lập dùng lại khả năng đọc dòng dài của recognizer; chỉ sau khi
phân loại mới chạy parser identity/meter. Không gọi cả sáu pipeline để chọn kết quả
có nhiều số nhất. Các endpoint profile/task cũ tiếp tục đi qua các bước xử lý như trước.

Nếu một visual adapter sau này trả Meter kind đủ confidence, `Analyze` dùng điểm
tích hợp `IMeterSceneDetector`/`MeterSceneSelection` trước text OCR. Không thấy hoặc
có nhiều Meter/Display, box sai, loại mâu thuẫn hay confidence thấp đều yêu cầu review.
Chưa có weights thực cho nhánh visual này; mock routing không phải bằng chứng model.

### Cơ chế phân loại thực sự đang chạy

Chỉ xét các dòng có recognition confidence >=0.9, hữu hạn, trong [0,1]. Đây là ngưỡng
chọn bằng chứng chữ, **không phải xác suất phân loại ảnh đã hiệu chuẩn**.

- **CCCD trước:** heading căn cước/identity card, nhãn họ tên, ngày sinh và chuỗi 12 số.
- **CCCD sau:** nhãn ngày cấp cùng một dấu hiệu độc lập như nơi cấp/đặc điểm nhận dạng/
  cơ quan chức danh phù hợp hoặc MRZ IDVNM. Một ngày riêng lẻ không đủ nhận là mặt sau.
- **Công tơ:** kWh hoặc m³/m3 chỉ thu hẹp utility; không chứng minh cơ/điện tử. Trả
  ambiguous với hai candidate khi đủ dấu hiệu đơn vị; chưa đọc được đơn vị thì unknown.
- Dấu hiệu nhiều loại/mặt cùng xuất hiện -> ambiguous. Blur/low detail, orientation
  conflict hoặc text-region limit -> unknown. Không tự suy Room, ownership hoặc serial.

Nguồn được trả rõ `classificationSource: "text_rules"`, confidence số là **null**.
Đây là heuristic có kiểm thử, không phải classifier thị giác sáu lớp đã được xác thực.
Classifier/crop thật, nhận biết bánh số/LCD/LED và billing register vẫn cần dữ liệu/model.
Không suy kiểu cơ/điện tử từ chữ số, font hoặc nhãn synthetic "DIEN TU".

### API mới và tương thích

`POST /api/v1/ocr/diagnostics/auto`, body binary JPEG/PNG, không yêu cầu profile,
residentId, taskId hoặc Meter metadata. Controller `Automatic` trả:

```json
{
  "analysis": {
    "classificationStatus": "ambiguous",
    "detectedCategory": "unknown",
    "classificationConfidence": null,
    "classificationSource": "text_rules",
    "candidateCategories": ["water_mechanical", "water_digital"],
    "warnings": ["classification_requires_review"],
    "identityProposal": null,
    "meterProposal": null,
    "requiresReview": true
  },
  "elapsedMilliseconds": 0
}
```

Ví dụ trên minh họa schema, không phải số đo latency. ClassificationStatus: classified,
ambiguous, unknown hoặc unavailable. Category: cccd_front, cccd_back,
electricity_mechanical, electricity_digital, water_mechanical, water_digital hoặc unknown.
Classified trả đúng **một** slot IdentityProposal hoặc MeterProposal dùng DTO proposal
hiện có; slot còn lại null. Proposal vẫn requiresConfirmation/manualEntryAvailable.
Không có classification thì cả hai null. `classified` không có nghĩa dữ liệu đã đúng
hoặc đã xác minh. Numeric confidence chỉ dành cho visual adapter có score hợp lệ.

401/403, Development opt-in, MIME, giới hạn 5 MiB/12 MP và no-store được giữ nguyên.
Timeout, engine bận/hỏng hoặc không hỗ trợ neutral analysis trả unavailable có warning.
Caller cancellation được truyền tiếp. IOcrService và IAutomaticOcrService dùng chung
**một LocalOcrService singleton và semaphore**, không tạo hàng đợi/model session mới.
Không truy cập Resident/Meter Task, không lưu MinIO, không tạo Reading/Invoice từ auto.
`POST diagnostics/{profile}` giữ nguyên schema, được dùng khi người dùng chọn sau chụp;
`OcrController`/`OcrWorkflowService` cho nghiệp vụ vẫn kiểm role/Location/task như trước.

## Mobile và dữ liệu tạm

- Header **Thử OCR trực tiếp**, mô tả ngắn theo yêu cầu, một CTA **Chụp ảnh OCR**.
  Không có selector trước chụp. CameraCapture chỉ thêm prop buttonMode, giữ luồng camera,
  quyền truy cập, chống chụp lặp và xóa cache đã có.
- Hiển thị trạng thái phân tích/đọc bằng một thông báo chung; không dùng timer giả để
  khẳng định server đã đi đến stage cụ thể. Camera hiện tại xử lý mở camera/shutter.
- Kết quả có preview, nhãn loại, cảnh báo bằng tiếng Việt và Field sửa tạm; ngày theo
  dd/MM/yyyy. Không hiển thị engine version, raw warning codes hoặc phần trăm model.
- Unknown/ambiguous/unavailable mới hiện câu yêu cầu chọn loại và sáu lựa chọn. Sau
  chọn, nút **Đọc theo loại đã chọn** gọi endpoint cũ trên đúng ảnh đang review; Meter
  có tùy chọn precision sau capture. Nhãn kết quả ghi **Loại ảnh đã chọn**, không gọi
  lựa chọn đó là nhận diện tự động. Không giữ lựa chọn làm mặc định cho ảnh tiếp theo.
- Camera xóa file tạm sau callback như trước. Preview là data URI trong RAM; chỉ giữ
  một bản copy byte trong RAM khi còn cần chọn loại, zero khi xóa/thay hoặc khi đã
  có kết quả classified/manual. Preview và trường tạm xóa khi background, rời màn,
  thay phiên/API, bấm xóa/hủy, chụp lại hoặc timeout review 60 giây tính từ capture.
  Đây là timeout UI tạm, không phải chính sách lưu hồ sơ identity. Chuỗi JS không có
  bảo đảm cryptographic wipe; ứng dụng bỏ reference, không ghi AsyncStorage/file mới.
- Giữ screenshot prevention/app-switcher protection hiện có. Epoch + AbortController
  bỏ response cũ; lock chặn request lặp. Không có nút lưu/xác minh nghiệp vụ.

Direct test xét từng ảnh độc lập, hiển thị mặt phát hiện; không yêu cầu chụp đủ hai
mặt hoặc ghép hồ sơ mới. Có thể chụp mặt kia bằng **Chụp lại**. Luồng onboarding
nghiệp vụ yêu cầu hai mặt không thay đổi trong task này.

## Model, dataset và kế hoạch training

Vẫn chỉ dùng `.tools/ocr-models/{detection.onnx,recognition.onnx,charset.txt}` đã kiểm
SHA256 khớp `scripts/Get-OcrModels.ps1`: DBNet + Vietnamese PP-OCRv6 recognition Run 6,
revision `9b5346432fb84a447fdc4d780a7741126b446b0f`. Model card tự khai Apache-2.0.
Không thêm/download weights; version pipeline theo dõi `...-auto1`.

Đã thêm `IImageCategoryClassifier` thread-safe contract trên Mat đã chuẩn bị; chưa có
implementation inference model được đăng ký vì thiếu weights, class order/output spec
và evaluation. `Ocr:AutomaticClassificationMinConfidence` mặc định 0.9 và AutomaticProfile
là cấu hình kỹ thuật riêng; chưa hiệu chuẩn threshold visual trên dữ liệu thật.

Ưu tiên đánh giá một detector nhỏ cho sáu lớp object, để giữ được trường hợp nhiều
vật thể thay vì classifier toàn ảnh chỉ có một softmax winner. Một ứng viên là YOLO
nhỏ fine-tune; chưa chọn provider production. Generic COCO không có sáu lớp này.
Tham chiếu chính thức: [định dạng dataset](https://docs.ultralytics.com/datasets/detect/),
[training](https://docs.ultralytics.com/modes/train/),
[ONNX export](https://docs.ultralytics.com/modes/export/) và
[giấy phép](https://www.ultralytics.com/license). Không suy giấy phép weights OCR
áp dụng cho detector. Chốt model/code/data license trước khi train hoặc thêm dependency.

Mapping ID cho dataset mới: 0 cccd_front; 1 cccd_back; 2 electricity_mechanical;
3 electricity_digital; 4 water_mechanical; 5 water_digital. Unknown là rejection/background,
không tự biến thành positive thứ bảy. Gán **mọi** object, không bỏ object phụ. Display
detector vẫn là tầng riêng trên crop Meter như METER_OCR_DATASET.md. Giữ nhóm vật thể,
phiên chụp, near-duplicate cùng split; augmentation/crop sau chia tập. CCCD training chỉ
dùng synthetic/anonymized template được phép, không lưu ảnh CCCD thật của Tenant.

`scripts/Prepare-AutomaticOcrTraining.ps1` làm offline preparation, không chạy train:

1. Kiểm checkpoint local `.pt` theo SHA256 người dùng đã review và version tool chính xác.
2. Kiểm `groups.json`: licenseReviewed, identityImagesSynthetic, samples với file, split,
   sha256, objectGroups, captureGroup và nearDuplicateGroup. Chặn path ngoài dataset,
   reparse point, ảnh trùng hash/nhóm vượt split, ảnh không khai báo, bbox/class sai.
3. Đọc YOLO labels cùng tên ảnh; yêu cầu có đủ sáu lớp ở train/val/test để lập kế hoạch
   đánh giá. Không coi số mẫu ít hoặc metadata tự khai là chứng nhận chất lượng dataset.
4. Sinh dataset.yaml và training-plan.json có class order, seed, deterministic flag,
   arguments train/val test/ONNX export và hash đầu vào; không cài package/tải model.

```text
dataset/
  groups.json
  images/{train,val,test}/*.png
  labels/{train,val,test}/*.txt     # class cx cy width height trong [0,1]
```

Mẫu sample (giá trị SHA256/IDs cần thay bằng metadata thật của dữ liệu được phép):

```json
{
  "licenseReviewed": true,
  "identityImagesSynthetic": true,
  "samples": [
    {
      "file": "images/train/example.png",
      "split": "train",
      "sha256": "<SHA256>",
      "objectGroups": ["opaque-object-group"],
      "captureGroup": "capture-group",
      "nearDuplicateGroup": "reviewed-near-duplicate-group"
    }
  ]
}
```

Sau khi có dữ liệu/model và môi trường Python/Ultralytics/torch/onnx đã pin, được review
và cô lập mạng, có thể chạy các argument arrays trong plan bằng CLI đã pin. Cần ghi
package lock, phần cứng, config và checkpoint hashes. Đối chiếu native/ONNX logits,
boxes, normalization/letterbox/NMS/class order trên test đóng băng rồi calibrate threshold
trước khi đăng ký adapter .NET. Khai báo nearDuplicateGroup không thay perceptual review.
Chưa chạy training/export, chưa có native-vs-ONNX parity hoặc accuracy six-class.

## Kiểm chứng thực thi

Các test adapter mock chỉ xác minh routing/gating, không xác minh visual detection/
classification accuracy. Không dùng số liệu từ lượt audit trước để điền kết quả này.

| Đã thực thi                                                                                                           | Kết quả                                                        |
| --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Backend solution build Release                                                                                        | PASS, 0 warning/error                                          |
| Application UnitTests toàn project                                                                                    | 211 PASS, 0 fail/skip; gồm 20 ca automatic OCR mới             |
| Domain UnitTests toàn project                                                                                         | 83 PASS, 0 fail/skip                                           |
| IntegrationTests namespace Ocr, trừ Docker/CompactPostgres                                                            | 90 PASS, 0 fail/skip                                           |
| PostgreSQL 16.15 riêng: MeterCaptureRegressionTests + invoice Finalization                                            | 6 PASS, 0 fail/skip; storage substitute, không phải real MinIO |
| Mobile toàn suite                                                                                                     | 368 PASS; gồm 29 ca automatic helper/UI mới                    |
| Workspace mobile typecheck và lint                                                                                    | PASS                                                           |
| Script chuẩn bị training: dữ liệu hợp lệ, group leak, hash duplicate, class sai, identity provenance, path ngoài root | 6/6 PASS; checkpoint chỉ là fixture giả, không train/infer     |
| PP-OCR thật: smoke sáu profile cũ                                                                                     | 18/18 PASS                                                     |

Đánh giá **model OCR thật** riêng bằng fixture mới (8 nguồn synthetic, 14 ca gồm
xoay 0/90/180/270 của hai mặt):

- 8/8 biến thể CCCD được gợi ý đúng mặt theo bằng chứng chữ và được định tuyến.
- Cả 6 ảnh còn lại vào nhánh review, không phát proposal: mixed sides, công tơ điện,
  công tơ nước, nhiều vùng hiển thị, nhãn không hỗ trợ và ảnh trống.
- **9/14 ca đạt exact-match đầy đủ, tool exit 1.** 13/14 status khớp nhãn chính xác.
  Bốn ca mặt sau sai exact field nơi cấp vì recognizer đọc `SYNTH ETIC` thay vì từ
  synthetic nguyên vẹn. Một ảnh nước trả unknown thay vì ambiguous vì recognition
  confidence của dòng m3 khoảng 0.894, dưới ngưỡng 0.9 của quy tắc. Unknown vẫn yêu
  cầu chọn loại, không đoán display. Giữ nguyên fixture/expected, không đổi nhãn để xanh.
- Field exact-match **12/16**; chạy endpoint/profile cũ trên cùng tám ảnh CCCD cũng
  **12/16**, dictionary kết quả **8/8 giống hệt**. Đây là lỗi recognition đã có ở
  baseline, không sửa bằng cách đoán/ghép chữ trong nơi cấp.
- Review/fallback rate trên bộ được thiết kế này **6/14 = 42.86%**; false proposal
  trên sáu ca yêu cầu review **0/6**. Đây không phải accuracy/fallback production.
- Tất cả 14 ca trong lượt đo <=10 giây; p95/max **3282 ms**. Chỉ đo service local,
  model đã khởi tạo, request tuần tự; không gồm camera/upload, không phải 100 sessions.
  Evaluation chạy thêm explicit-profile baseline riêng ngoài khoảng đo của auto.

Classification accuracy/confusion matrix sáu lớp, object/display recall và held-out
accuracy trên >=50 ảnh thật: **NOT MEASURED**, report để null. Chưa có dataset/model
để đo các chỉ số này. Chưa thử native iPhone/Android E2E hoặc real MinIO/Docker trong
lượt này. PostgreSQL tạm loopback đã dừng; fixture chỉ tạo/xóa database test riêng.

Đã bắt và sửa lỗi trong các vòng kiểm tra: patch đầu gộp Delete/Add cùng path bị tool
từ chối (đã tách), lint phát hiện ref đọc trong render/setState trong effect (đã sửa),
test recapture phát hiện reset nhầm trạng thái availability khi bắt đầu OCR (đã sửa).
Các suite cuối đạt như bảng. Lượt model evaluation vẫn exit 1 vì giới hạn ở trên.

### Lệnh tái lập

```powershell
dotnet build src/backend/BHome.sln -c Release
dotnet test tests/backend/BHome.Application.UnitTests -c Release --no-build
dotnet test tests/backend/BHome.Domain.UnitTests -c Release --no-build
dotnet test tests/backend/BHome.IntegrationTests -c Release --no-build --filter '(FullyQualifiedName~.Ocr.&Category!=Docker&Category!=CompactPostgres)'
# Cần BHOME_COMPACT24_TEST_ADMIN cho PostgreSQL test loopback được phép dùng:
dotnet test tests/backend/BHome.IntegrationTests -c Release --no-build --filter '(FullyQualifiedName~MeterCaptureRegressionTests|FullyQualifiedName~Compact24InvoiceRegressionTests.Finalization)'
npm.cmd run test --workspace mobile
npm.cmd run typecheck --workspace mobile
npm.cmd run lint --workspace mobile
powershell -NoProfile -ExecutionPolicy Bypass -File tests/scripts/AutomaticOcrTraining.Tests.ps1

powershell -NoProfile -ExecutionPolicy Bypass -File scripts/New-AutomaticOcrFixtures.ps1
dotnet run --project tools/BHome.OcrSmoke -c Release -- --auto-evaluate .tools/ocr-models .tools/automatic-ocr/manifest.json .tools/automatic-ocr/report.json
dotnet run --project tools/BHome.OcrSmoke -c Release -- .tools/ocr-models tests/fixtures/ocr

# Chỉ chuẩn bị kế hoạch khi có dataset và checkpoint local đã review:
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Prepare-AutomaticOcrTraining.ps1 -DatasetDirectory <dataset> -ApprovedWeights <local-checkpoint.pt> -ExpectedWeightsSha256 <SHA256> -UltralyticsVersion <exact-version> -OutputDirectory <new-output-directory>
```

Phiên này dùng Node 22.23.4 cục bộ phù hợp engines của repo; Node mặc định máy là 24.
Report/fixtures đầy đủ và weights ở `.tools/` bị gitignore; summary kiểm chứng được
lưu trong [2026-11-04-results.json](../testing/automatic-ocr/2026-11-04-results.json),
không chứa raw identity text hoặc ảnh.

### Mức hoàn thành

| Mức                                  | Chức năng                                                                                                                                              |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Đã triển khai và kiểm thử            | một CTA trước chụp, endpoint không profile, neutral analysis, tách proposal, sửa tạm, fallback sau chụp, auth/limits/privacy/cancellation              |
| Đã triển khai có giới hạn bằng chứng | gợi ý CCCD trước/sau bằng chữ; utility chỉ tạo candidate; không có confidence phân loại giả                                                            |
| Chuẩn bị, chờ model                  | visual classifier/detector adapter, Meter/Display crop hook, dataset validation và training/export argument plan                                       |
| Chưa triển khai/kiểm định            | tự phân biệt cơ/điện tử từ ảnh thật, detector/Display weights, real six-class accuracy, training/export/parity, billing register/Room identity tự động |

## Cách thử thủ công

1. Khởi động lại API đang dùng để nạp controller/DI mới. Dùng Development,
   MobileDevelopment:Enabled=true, Ocr:Enabled=true và ModelDirectory đã provision.
   Nếu dùng Visual Studio, F5 lại instance đó; không mở API thứ hai cùng port.
2. Reload Mobile, đăng nhập Owner/Staff, chọn **Test OCR** trên trang chủ Development.
3. Chọn **Chụp ảnh OCR**, cấp quyền camera và chụp CCCD synthetic/công tơ. Không chọn
   loại trước đó. Dùng fixture có đủ heading + nhãn để thử nhận diện CCCD tự động.
4. Khi đủ dấu hiệu, đối chiếu preview và sửa trường đọc được. Với công tơ hoặc ảnh
   chưa rõ, chọn loại **sau** thông báo yêu cầu review rồi đọc lại cùng ảnh.
5. Thử **Chụp lại**, **Dừng xử lý**, xóa kết quả, đưa app xuống nền và mở lại; ảnh/trường
   cũ phải được bỏ. Không có Resident, Reading hoặc Invoice mới từ các thao tác này.
6. Ảnh thật/ảnh thiếu chữ có thể yêu cầu chọn lại. Chưa có classifier thị giác nên
   việc yêu cầu chọn cơ/điện tử là giới hạn được hiển thị, không phải model đã nhận sai.

## Bổ sung pretrained sau báo cáo này

Đã có adapter YOLOv8n-OBB ONNX thật, crop hiển thị trên Mobile và provisional
meter proposal khi tìm được một window. Các nhận xét chưa có detector ở phần
audit phía trên mô tả baseline trước lượt bổ sung. Chưa có classifier bốn loại;
định vị10/10 ảnh public không đồng nghĩa đọc đúng số (hiện1/7 nhãn đầy đủ).
Chi tiết, provenance, lệnh bật Development và giới hạn:
[Pretrained YOLO + PP-OCR](PRETRAINED_YOLO_METER_OCR_IMPLEMENTATION.md).

## File thay đổi

- Application: mới `Ocr/AutomaticOcr.cs` (contract, category rules, router).
- Infrastructure: `Ocr/LocalOcrService.cs`, `OnnxOcrEngine.cs`, `ImagePreprocessor.cs`,
  `OcrOptions.cs`, mới `IImageCategoryClassifier.cs`; `DependencyInjection.cs`.
- API: `Controllers/Ocr/OcrDiagnosticsController.cs`.
- Mobile: `src/mobile/src/app/ocr-test.tsx`, `components/CameraCapture.tsx`, mới
  `lib/automaticOcr.ts`.
- Tests: mới `Application.UnitTests/Ocr/AutomaticOcrTests.cs`,
  `IntegrationTests/Ocr/AutomaticLocalOcrTests.cs`; sửa `OcrApiTests.cs`; mới
  `tests/mobile/ocr/automaticOcr.test.ts`, `automaticOcrScreen.test.tsx` và
  `tests/scripts/AutomaticOcrTraining.Tests.ps1`.
- Tools/scripts: `tools/BHome.OcrSmoke/Program.cs`, mới `AutomaticOcrEvaluation.cs`,
  `scripts/New-AutomaticOcrFixtures.ps1`, `scripts/Prepare-AutomaticOcrTraining.ps1`.
- Docs: báo cáo này, API_IMPLEMENTATION_STATUS.md, OCR_MOBILE_DELIVERY.md,
  METER_OCR_DATASET.md và summary JSON kiểm chứng.
