# Tích hợp Gmail SMTP — 12/11/2026

## Phạm vi và căn cứ

Yêu cầu triển khai Gmail SMTP của người dùng bổ sung kênh EMAIL trên hệ thống hiện tại.
Đã đối chiếu Report 3 trong `docs/reports/BHome_Report-3_Software Requirement Specification.docx`:
JOB-04 retry push/email; GBR-14 giới hạn người nhận và không rollback nghiệp vụ khi gửi lỗi;
GBR-18 idempotency. Quyền theo I.4.4, GBR-02/13; hóa đơn UC-21/JOB-10, thanh toán
UC-22..25/GBR-10/JOB-01, hợp đồng UC-19/JOB-02, emergency UC-26..30/GBR-11.
Không thay đổi lịch nhắc, quyền tạm trú, chính sách tài chính hoặc PUSH production.
Report 5 gốc chưa có trong `docs/reports`; không dùng số liệu mẫu làm bằng chứng.

| Hành vi | Thành phần hiện có / thay đổi | Tiêu chí kiểm thử |
| --- | --- | --- |
| Email thật, STARTTLS, bí mật ngoài Git | INotificationChannelProvider → MailKitEmailSender, EmailOptions | Địa chỉ sai, thiếu cấu hình, TLS bắt buộc, lỗi SMTP an toàn |
| Inbox bền vững, email bất đồng bộ | NotificationEventPublisher, CompactNotificationWriter, NotificationChannelWorker | Một outbox/inbox/channel, concurrent claim, không rollback/read-state |
| Chỉ người có quyền nhận | InvoiceRecipient, scope/TargetAsync, assignment và users hiện hành | Cross-Tenant/Location, inactive/unverified, assignment hết hiệu lực |
| Retry và kết quả không chắc chắn | notifications OUTBOX + lease + delivery_history (JOB-04) | 4xx retry hữu hạn; 5xx/auth dừng; timeout sau submit → PendingReview |
| Nội dung Việt và dữ liệu thật | EmailTemplate, builder từ Invoice/Contract/Location | HTML encoding, kỳ/hạn/phòng đúng, không lộ bank reference |
| Test thật có kiểm soát | Development-only Owner endpoint, recipient cấu hình sẵn | Không token/Staff/Tenant/Production bị từ chối; giới hạn gửi |

## Kết quả audit trước thay đổi

- Nhánh `member/QHuy`, working tree sạch khi bắt đầu.
- Runtime Compact24 dùng bảng `notifications` chứa INBOX/OUTBOX/AUDIT; đã có unique key,
  lease, history, scope, channel-status và automation worker độc lập với financial jobs.
- Adapter EMAIL cũ dùng System.Net.Mail, không có MailKit/HTML và chưa phân loại lỗi SMTP.
  Development dùng Sandbox; Sandbox receipt không chứng minh email thật.
- Invoice issued và fully-paid đã chọn EMAIL. Partial-payment, nhắc nợ, contract expiry và
  emergency chủ yếu chỉ chọn PUSH. Announcement đã có recipient selection và channels.
- Legacy NotificationDeliveryService chỉ xử lý notices không có Channels; không thêm SMTP vào
  adapter legacy để tránh gửi đôi. Worker channel hiện tại là nơi mở rộng JOB-04.
- Không cần bảng/cột/migration: envelope và delivery_history hiện tại đủ chứa trạng thái và receipt.
- Docker Compose hiện chỉ có PostgreSQL/MinIO, không có Backend container để inject cấu hình.

## Giai đoạn 1

Thêm MailKit (theo yêu cầu), EmailOptions và HTML/plain-text UTF-8, giữ abstraction kênh hiện có.
STARTTLS bắt buộc; kiểm chứng chứng chỉ mặc định; Message-Id ổn định nhưng SMTP không cung cấp
idempotency. Không lưu raw lỗi provider/địa chỉ/secret trong log hoặc exception. `Sent` sẽ chỉ có
nghĩa SMTP chấp nhận. Giữ cấu hình SMTP legacy qua mapping, cấu hình mới dùng `Email:*`.

Kiểm chứng giai đoạn 1: restore solution thành công; build API 0 warning/error;
`EmailTransportTests`: 9 passed, 0 failed/skipped (không gọi SMTP thật).

## Giai đoạn 2

- EMAIL được thêm tại lúc publish mới cho invoice finalized/due-soon/overdue, payment partial/full,
  contract expiry; emergency submitted chỉ Owner/Staff. Announcement giữ nguyên kênh được chọn và
  recipient selection hiện có. Không replay publication cũ hoặc mở rộng quyền của người nhận.
- Nội dung Invoice/Payment lấy Room, Location, kỳ và due date thật sau khi kiểm tra TargetAsync;
  không đưa mã phân bổ/tham chiếu ngân hàng hay chi tiết tài chính vào email. Contract và emergency
  có context thật; tất cả nội dung HTML được encode. Giữ nguyên API inbox/count/read/filter.
- JOB-04 dùng outbox/channel hiện tại; unique key `channel:<inboxId>:<channel>`, claim bằng row lock,
  lease, kiểm tra tài khoản/email đã xác nhận/scope trước gửi. Lưu receipt an toàn trong history.
- Retry mặc định tối đa 4 lần: ngay, sau 1/5/15 phút tính từ lần lỗi trước. SMTP 4xx/connection failure
  trước submit được retry; 5xx/auth/TLS/địa chỉ không hợp lệ → PermanentlyFailed; mất kết nối/timeout
  trong submit hoặc lease SMTP hết hạn → PendingReview, không tự gửi lại. Inbox vẫn tồn tại.
- Trạng thái giữ model hiện có: Pending = chờ hoặc đã lên lịch retry, Processing = đang claim,
  Sent = SMTP accepted, PermanentlyFailed = dừng, PendingReview = kết quả không chắc chắn,
  Suppressed = không còn quyền/không còn phù hợp. Inbox Delivered là aggregate tương thích,
  **không phải bằng chứng thư đã vào hộp thư**. PUSH chưa cấu hình có thể khiến aggregate Pending
  dù EMAIL đã Sent; kiểm tra từng channel qua API deliveries.
- `POST /api/v1/notifications/email-test`: Owner đã đăng nhập, Development + Email.TestEnabled;
  recipient cấu hình sẵn, không nhận body; giới hạn toàn instance 1 lần/10 phút. Production trả 404.
  Không ghi email test thành sự kiện nghiệp vụ; không bật worker tài chính để kiểm tra email.

Đã chạy: build API 0 warning/error; toàn bộ Application UT 450 passed;
Compact24NotificationMvpTests 21 passed, 0 failed/skipped trên PostgreSQL disposable.
Bao gồm sự kiện hóa đơn, thanh toán partial/full thực sự qua API, dedup, scope, retry, lease và endpoint test.
Lệnh script đầu tiên bị PowerShell ExecutionPolicy chặn; đã chạy lại bằng process riêng
`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Test-Compact24Isolated.ps1 ...`, không đổi policy hệ thống.
