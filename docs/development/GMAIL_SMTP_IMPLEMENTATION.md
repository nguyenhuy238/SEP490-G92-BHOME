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
