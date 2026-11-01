# BH-21 — phạm vi và quyết định triển khai

Ngày 01/11/2026, nhánh `member/QHuy`. Nguồn: AGENTS.md, SRS v1.3 trong
`docs/reports/BHome_Report-3_Software Requirement Specification (2).docx` (đọc nội dung XML),
Report 4 `(5)`, `HUY_SOURCE_CODE_AUDIT.md`, `HUY_DEPENDENCY_MATRIX.md`,
`CONTRACT_MANAGEMENT_WORKFLOW.md`, `PROPERTY_MANAGEMENT.md` và `FLEXIBLE_FUTURE_PRICING.md`.
Không tìm thấy tài liệu Git gốc `Quy-tắc-làm-việc-Git.txt` trong checkout; áp dụng mục 9
của AGENTS.md và yêu cầu task: chỉ commit local trên `member/QHuy`, không push/merge.

| Hành vi                                         | Nguồn                               | Thành phần                                     | Kiểm chứng yêu cầu                                                                                        |
| ----------------------------------------------- | ----------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Staff chụp/nhập tay, xác nhận và lưu ảnh/chỉ số | BF-05, UC-20 A1/A2, GBR-07/09       | CaptureService/Repository, meter Mobile        | Không human confirmation, thiếu baseline/evidence, giảm số, replay, storage failure, Staff ngoài Location |
| Đọc lại kết quả đã xác nhận và lượng tiêu thụ   | UC-20 bước 8–10, GBR-01/02          | Capture GET task/reading, Mobile, Owner meters | Reload giữ previous/consumption đúng; ID ngoài scope 404; Tenant không đọc DTO quản trị                   |
| Owner cấu hình utility rates có hiệu lực        | UC-06, GBR-08; API Property hiện có | BillingPolicy, Owner pricing                   | API thật, ngày hiệu lực, version conflict, loading/error/empty; không tính tiền trên client               |
| Draft/Final, Tenant Invoice                     | UC-21, DBR-06/07, GBR-08/09; JOB-10 | Chưa tạo persistence khi chưa chốt             | Chờ quyết định bên dưới; không tạo trạng thái Paid hoặc endpoint giả                                      |

## Quyết định người dùng đã phê duyệt trong phiên 01/11/2026

- Nhóm khách chung phòng: mỗi khách ký hợp đồng riêng; phòng có một đại diện. Gia đình:
  một hợp đồng và một người đại diện. Các hợp đồng cùng phòng vẫn phải tuân sức chứa và
  không cho một occupant có hợp đồng Active trùng kỳ; kiểm tra trong service/Room lock và DB trigger.
- Một hóa đơn chung Room + tháng. Mọi Tenant trong kỳ cùng chịu trách nhiệm, được xem,
  giữ quyền xem kỳ đã ở khi rời phòng. Đây là thay đổi được duyệt so với SRS DBR-06 Contract + kỳ.
  Snapshot `InvoiceRecipients` giữ quyền; không dựa vào danh sách người đang ở để đọc hóa đơn cũ.
- Owner có chức năng cấu hình nguồn tiền thuê, ngày chọn rate, xử lý tháng thiếu, làm tròn,
  ngày Draft/Final/Due. Không dùng giá trị mặc định khi Location chưa có cấu hình.
- Lựa chọn cấu hình được biểu diễn rõ: rate tại đầu/cuối kỳ; tiền thuê từ Room policy hoặc
  Contract đại diện Owner chọn; phí cố định cả tháng hoặc theo số ngày có người ở/tháng;
  làm tròn từng dòng về VND (AwayFromZero/ToEven); ngày 29–31 co về ngày cuối tháng ngắn.
  Đây là cơ chế cấu hình để Owner chọn; không tự coi một công thức là policy đã được chọn.
  Không hỗ trợ bậc thang, phí theo người, tự chia tiền giữa Tenant hoặc nhiều mức giá trong tháng.
  Phòng có thay meter/baseline không liền kỳ giữ Draft thiếu input để review, không tự ước lượng.

## Nội dung câu hỏi trước khi chốt

1. **D-01 — định danh nghĩa vụ**: SRS DBR-06 quy định Contract + kỳ; code giữ một Active
   Contract/Room (`UX_Contract_ActiveRoom`). Task đề cập nhiều Contract cùng Room và hóa đơn chung.
   Chọn giữ một tenancy nhiều occupants, hoặc duyệt Room + kỳ cùng thay đổi occupancy, chia tiền,
   trách nhiệm thanh toán và quyền xem lịch sử. Không xóa constraint hiện có để chạy demo.
2. **D-02 — tính tiền/kỳ**: chọn Contract.MonthlyRent hay resolved rent; thời điểm lấy utility rate;
   xử lý giá thay đổi giữa kỳ, tháng không đủ/chuyển tenancy; quy tắc làm tròn VND.
3. **D-03 — lịch billing**: ngày Draft/Final/Due do Owner cấu hình theo UC-21; chưa có model lịch
   được duyệt. Không tự đặt hạn thanh toán hoặc suy ra từ UI minh họa.

Các câu hỏi này đã được trả lời bằng các quyết định bên trên. Audit/kế hoạch cũ được giữ nguyên
như bằng chứng lịch sử; tài liệu này ghi quyết định mới và phạm vi thay đổi.
