# Đồng bộ member/Long với develop ngày 25/11/2026

## Phạm vi

Yêu cầu: lấy code mới nhất từ `origin/develop`, giữ thay đổi của Long,
commit và push lên `member/Long`. Điểm đồng bộ develop: `e9e069ff`.
Phạm vi hợp đồng liên quan BF-03/BF-04, UC-13–17, GBR-04 và DBR-02;
thông báo liên quan JOB-04. Đây là ghi nhận tích hợp code hiện có,
không phải phê duyệt thay đổi chính sách ký hợp đồng.

## Xung đột và cách ghép

Merge develop phát sinh 13 file conflict; áp lại thay đổi chưa commit phát
sinh thêm 5 file conflict (có file trùng giữa hai lượt).

- `MainDraftContracts`, `MainDraftService`, `MainDraftRenderer` và
  `ContractSigningDocumentSource`: giữ kiểm soát mẫu ký theo môi trường của
  Long, đồng thời nhận DocumentVersion và bố cục tài liệu mới từ develop.
  Tài liệu review phải đúng phiên bản và đúng loại development/production.
- `ContractRepository`: giữ TimeProvider mới và bổ sung identity protection
  cho thông tin người giữ chỗ; truyền đủ tham số DTO trong EF projection.
- `ContractScreen`: giữ callback hoàn tất của Long, đồng thời giữ chế độ
  chỉ bàn giao và tránh gọi signing-methods bằng tài khoản Staff.
- `WorkspaceShell`, màn hình sự cố/công việc/dashboard Staff và các test:
  giữ điều hướng bàn giao mới, trạng thái tải và exit guard của Long.
  Dashboard giữ danh sách công việc ưu tiên của Long; chỉ số trả phòng mở
  danh sách bàn giao với tab MoveOut.
- Tài liệu seed dùng mô tả Owner generator mới, phù hợp code develop;
  danh mục thông báo lỗi giữ cả hai mã lỗi khác nhau.

## Kiểm tra và giới hạn

Mobile typecheck và lint đạt. Owner Web typecheck/build đạt; lint có hai
cảnh báo ở component biểu đồ và wizard cấu hình cơ sở, test invitation/
notification đạt 22/22. Unit test hạ tầng ký/email đạt 62/62.

Lượt Mobile đầy đủ có 1.755 passed và một test hóa đơn lỗi do kiểm tra trước
khi phần thanh toán tải xong; chạy lại riêng liveWorkspace/dashboard đạt
124/124. Đổi assertion sang findByText để đợi dữ liệu bất đồng bộ, giữ nguyên
nội dung mong đợi. Các conflict test Holding đã cập nhật fixture theo trường
holdingCustomer mới; test dashboard giữ import within và điều hướng MoveOut.
Lượt chạy Mobile đầy đủ cuối cùng đạt 164/164 file, 1.756/1.756 test.

Kiểm tra tích hợp hợp đồng đã biên dịch thành công nhưng không đủ điều kiện
chạy: Docker daemon không hoạt động, kể cả kiểm tra ngoài sandbox.
Lượt lọc AnonymousSigningTests/HoldingNotificationTests/MainDraft/
EnvironmentStartupTests có 9 passed, 25 failed do Docker và 22 skipped.

Lượt unit test mở rộng theo từ khóa Contract có 221 passed, 10 failed do
RangeAttribute phân tích decimal theo culture hiện tại trong PropertyService;
không sửa phần nghiệp vụ không liên quan này. Lọc lại đúng namespace Contracts
và OperationalTaskServiceTests đạt 214/214.

Build Owner Web ban đầu bị cấu hình API local chặn theo quy tắc deploy;
build với HTTPS origin tổng hợp giống CI (`https://api.example.com`) thành công.
Không thay đổi file môi trường cá nhân.

`.env.local` được Git bỏ qua và giữ nguyên. Hai tài liệu nhị phân chưa được
kiểm tra nội dung (`BHOME_Report-5.1_Unit_Test.xlsx` và
`docs/development/hop-dong-dat-coc-thue-tro.doc`) giữ tại máy, không đưa vào
commit đồng bộ code. Bản stash trước đồng bộ được giữ để đối chiếu/khôi phục.

Chưa xác minh E2E ký/thanh toán, test tích hợp PostgreSQL/Docker và hành vi
trên thiết bị thật. Không khẳng định toàn bộ nghiệp vụ hợp đồng đã đạt chuẩn.
