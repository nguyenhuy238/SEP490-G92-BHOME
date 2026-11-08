# OCR ưu tiên luồng Staff — 06/11/2026

Điểm bắt đầu: `9932bdd607fc9e7812c931aa39ca68b3cb3e5d9a`, nhánh
`member/QHuy`, working tree sạch. Không tái tạo các commit OCR trước đó.

Đã đọc SRS thực tế `docs/reports/BHome_Report-3_Software Requirement Specification.docx`:
§I.2.5 BF-05A/B, UC-20/21, màn hình §4.2.1, yêu cầu clear confirmation/manual fallback
và Internal OCR Processing. Đối chiếu GBR-01/02/07 và JOB-09/10 trong AGENTS.md.
OCR phải dựa trên Meter của tác vụ, Staff được phân công, giữ đề xuất riêng và
chỉ dùng chỉ số đã xác nhận cho billing. Không có thay đổi policy tính tiền.

| Yêu cầu | Thành phần hiện tại | Kiểm chứng dự kiến |
| --- | --- | --- |
| Quyền Staff/Location và Meter server | CaptureScope, CaptureWorkflowResources, ResourceAccess, OcrWorkflowService | Cross-Location/role, nhiệm vụ đóng; từ chối trước đọc ảnh |
| Metadata chọn reader, không mặc định sai loại | Meter.UtilityType/Display/DecimalPlaces, OcrWorkflowResource | Bốn profile đúng; thiếu/invalid profile, precision, previous reading → review, không inference |
| OCR/correction/confirmation tách biệt | LocalOcrService, MeterReadingPrecision, CaptureRepository | Chỉ proposal được ghi; evidence hash, correction và duplicate confirmation; không tạo MeterReading từ OCR |
| Nước cơ có đối chứng | Stage1, Crop, Stage2, PP, Fusion, Parser | Frozen baseline52; thử nghiệm chỉ chọn trên validation đã loại SHA overlap; giữ mọi veto về loại/register/u |
| Đánh giá trung thực | OcrSmoke + taxonomy | Phân biệt digit GT với decimal/register/display GT còn thiếu; không suy unreadable từ nhãn u |
| UI review tiếng Việt | meterOcrFeedback | Giải thích cấu hình không hợp lệ, không lộ mã kỹ thuật |

Meter hiện **bắt buộc** UtilityType, Display, DecimalPlaces; không có verified
billing-register hoặc serial-identity recognition. Không thêm field/schema giả để
hoàn tất checklist. Kiểu profile nullable chỉ là kết quả resolve nội bộ khi dữ liệu
không thuộc enum hợp lệ; không thêm trường API hoặc sửa Meter metadata.
Ảnh cùng utility/profile nhưng khác thiết bị vật lý vẫn cần Staff đối chiếu mã;
classifier không thể tự chứng minh đúng Meter ID.

Không thay đổi thresholds hoặc bật checkpoint bốn lớp đã bị loại. Các target
95% classification/90% exact reading và camera E2E chỉ được đánh dấu đạt khi có
bằng chứng thích hợp; dữ liệu thiếu sẽ được báo riêng.

Kiểm chứng work unit metadata: Release build PASS, 0 warning/error;
OCR Application 154 PASS (10 ca mới); Mobile feedback 19 PASS, typecheck/lint PASS.
OCR integration không Docker 121 PASS, 4 opt-in model cases SKIPPED trong lượt
ban đầu; sẽ chạy model thật riêng với biến opt-in. Không coi unit test là accuracy.
