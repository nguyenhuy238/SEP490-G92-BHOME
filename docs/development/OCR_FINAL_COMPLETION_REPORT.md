# BHOME OCR — kết quả thực hiện master task 05/11/2026

**Chưa hoàn tất OCR tự động bốn loại; không đủ bằng chứng để bật model mới.**
Đã nghiên cứu/tải dữ liệu, gán nhãn, fine-tune GPU thật, export ONNX, kiểm tra
trong .NET và chạy regression với MinIO thật. Điểm thiếu chính là dữ liệu nước
điện tử và độ tin cậy nhận dạng ngoài tập nhỏ; không coi các test kỹ thuật qua
là nghiệm thu độ chính xác OCR.

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
