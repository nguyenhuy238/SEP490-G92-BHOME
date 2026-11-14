# Notification MVP trên Compact24

Ngày triển khai: 08/11/2026. Phạm vi được người dùng xác nhận sau báo cáo rà soát 07/11.
Áp dụng cho backend; các màn hình client cần gọi các API dưới đây. Không thay đổi schema vật lý,
không tạo bảng mới, không chạy EF migrations legacy trên Compact24.

## Căn cứ và quyết định

- SRS trong `docs/reports/`: FE-02/FE-07, UC-01/02/14–25/26–30/35–36;
  GBR-02/06/10/11/13/14/18; JOB-01/02/04/07/08/09/10; Report 4 Token Design/Notification integration.
- PDF `BHOME_Notification_BE_v1.1.pdf`: Q1/Q2/Q3/Q4/Q6, NOT-01..12, T01..09 và Q7.
- Bám theo quyết định giữ đúng 24 bảng. Các bảng logic Announcements/Devices/Deliveries trong PDF
  được ánh xạ vào container hiện có, không hiểu thành yêu cầu tạo thêm bảng.
- Q5 không có SLA mặc định: chỉ chạy escalation khi Owner bật và nhập cả hai ngưỡng hợp lệ.
  Q6 không có lịch mặc định: Owner phải chọn WEEKLY hoặc MONTHLY và giờ gửi địa phương.
- Lịch sử Staff vẫn lưu trong DB; việc đọc inbox của Staff tiếp tục yêu cầu assignment hiện hành.
  Không mở rộng quyền xem lịch sử sau khi hết phân công trong lượt này. Deep-link luôn kiểm quyền lại.

## Dữ liệu, transaction và chống trùng

| Bảng hiện có                          | Nội dung bổ sung                                                                                                          |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| notifications / INBOX                 | Một row/user/event; state có eventType, priority, source, channels; nội dung bất biến                                     |
| notifications / OUTBOX                | Intents/publication hiện có; thêm recordType=ChannelDelivery, một row/inbox/channel                                       |
| notifications.delivery_history        | ChannelClaim/ChannelAttempt, lease và kết quả từng lần gửi; không lưu email/push token/raw reset token                    |
| notifications / AUDIT                 | Nguồn bảo mật đã commit và audit hiện có; không xuất qua inbox                                                            |
| operational_tasks / SYSTEM_JOB        | recordType=Announcement: bản nháp, sender, audience, snapshot gửi; recordType=PushDevice: user, platform, token, lastSeen |
| locations.operating_settings          | notificationPolicy; thay đổi có actor/time/history và tăng version                                                        |
| users                                 | Reset/invitation grant hash/expiry/consumed hiện có; Identity hash/security stamp                                         |
| invoices/contract_residents/residents | Recipient theo kỳ, liên kết tài khoản/email và trạng thái tạm trú hiện có                                                 |

`ux_notification_inbox` chống trùng user+event. Publication khóa transaction cho event;
đọc nguồn audit/domain đã commit cùng nghiệp vụ. PaymentConfirmedEvent giữ snapshot paid/outstanding
ngay trong transaction phân bổ tiền. Worker trễ vẫn phân biệt được Partial và FullyPaid;
FullyPaid chỉ phát một lần/invoice, không suy tên người trả từ mã ngân hàng.
Thông báo ghi rõ mã xác nhận **nội bộ** rút gọn của allocation, không giả nó thành BankTransactionId.

Announcement resolve và distinct người nhận ở server khi send; lưu snapshot bằng các INBOX đã tạo
trong cùng transaction với chuyển trạng thái Sent. Gửi lại/concurrent send không tạo inbox mới.
Staff không gửi ALL_TENANTS hoặc ID ngoài Location được phân công.

Channel worker có lease riêng, timeout, retry backoff, số lần tối đa, key ổn định từng thiết bị.
Kết quả: Pending → Processing → Sent / Pending / PermanentlyFailed / PendingReview / Suppressed.
Sent nghĩa là adapter/provider chấp nhận, không có nghĩa người dùng đã đọc.
Nếu adapter không hỗ trợ idempotency (SMTP), lỗi mơ hồ/lease hết hạn cần PendingReview,
không tự gửi lại để tránh trùng. Retry provider không tạo thêm INBOX.
Trước gửi kiểm lại role, active user, assignment, quyền target và trạng thái reminder:
Paid/task hoàn tất/tạm trú Completed hoặc OwnerConfirmed/emergency acknowledged sẽ bị suppress.
Không đổi trạng thái nghiệp vụ từ notification.

## API inbox và kênh gửi

| Method / route                                  | Quyền và hành vi                                               |
| ----------------------------------------------- | -------------------------------------------------------------- |
| GET /api/v1/notifications                       | Chính user; page/pageSize/category/unread hiện có              |
| GET /api/v1/notifications/{id}                  | Chính recipient; 404 với bản ghi người khác/AUDIT/OUTBOX       |
| GET /api/v1/notifications/unread-count          | Chính user                                                     |
| POST hoặc PATCH /api/v1/notifications/{id}/read | Chính recipient; giữ POST để tương thích                       |
| POST /api/v1/notifications/read-all             | Chính user                                                     |
| GET /api/v1/notifications/{id}/target           | Kiểm lại quyền business object; 404 khi hết quyền              |
| POST /api/v1/notifications/devices              | Chính user; `{pushToken,platform}` với Android/iOS/Web         |
| DELETE /api/v1/notifications/devices/{id}       | Chính user; xóa token khỏi payload, vô hiệu thiết bị           |
| GET /api/v1/notifications/{id}/deliveries       | Chính recipient; chỉ channel/status/attempt/nextRetryAt        |
| GET /api/v1/notifications/channel-status        | Owner; mode, enable flags, tổng hợp số delivery/channel/status |

Notification DTO giữ các field cũ và thêm `eventType`, `priority`, `source`, `isRead`, `action`.
Category nhận thêm Account/Incident/Announcement/Residence/Other. Action là gợi ý điều hướng,
không cấp quyền. Client phải resolve `/target` rồi fetch API nghiệp vụ, không tự coi thông báo là payment success.
Push token không xuất trong response; token còn active của user khác trả 409, cần unregister trước khi chuyển account.

## API thông báo thủ công

- POST `/api/v1/announcements/preview-recipients`: audience, trả recipientCount/missingEmailCount.
- POST `/api/v1/announcements`: `{title,body,audience,channels,priority}` → Draft.
- POST `/api/v1/announcements/{id}/send`: resolve lại scope/người nhận hiện hành → Sent.
- GET `/api/v1/announcements/sent?page=1&pageSize=20`: Owner hoặc lịch sử do Staff hiện tại tạo.

Audience: ALL_TENANTS, LOCATION + locationIds, ROOM + roomIds, USER hoặc SELECTED_USERS + userIds.
Recipient lấy từ active tenancy và cư trú hiện hành; không dùng danh sách userIds FE như quyền truy cập.
Channels chứa IN_APP, thêm PUSH/EMAIL nếu cần. Priority chỉ P1/P2; source=Manual,
eventType luôn ANNOUNCEMENT_SENT, không nhận eventType bảo mật/thanh toán từ request.

## Cấu hình nhắc theo Location

Owner GET/PUT `/api/v1/locations/{id}/notification-policy`:

```json
{
  "debtEnabled": false,
  "debtWindowDays": null,
  "taskEnabled": false,
  "taskWindowHours": null,
  "residenceEnabled": false,
  "residenceFrequency": null,
  "localSendHour": null,
  "emergencyEnabled": false,
  "emergencyFirstEscalationMinutes": null,
  "emergencyOverdueMinutes": null,
  "invoiceDueSoonDays": null
}
```

Đây là cấu hình mặc định tắt, không phải ví dụ SLA đã duyệt. Owner bật chức năng nào phải nhập
tham số hợp lệ của chức năng đó. Monthly/weekly tính theo lịch Asia/Ho_Chi_Minh; không gửi cả hai.
JOB-08 chỉ lấy người thực tế đã bắt đầu cư trú, chưa Completed/OwnerConfirmed và hợp đồng active.
Tenant thực hiện qua VNeID ngoài hệ thống; Staff không đăng ký hoặc xác nhận thay.
Emergency gửi Owner và Staff assignment đang có hiệu lực, không phụ thuộc ca trực.
Đọc thông báo không acknowledge sự cố. Life-safety phải gọi cơ quan khẩn cấp phù hợp.

Các event bổ sung gồm account security, Draft/Final, Partial/FullyPaid, Unmatched, DueSoon/Overdue,
MeterConfirmed, incident/work order, task assigned/completion/rework/unassigned, contract signing/activation/
renewal/expiry, move-out/refund và residence. Thông báo lịch sử hóa đơn dùng recipient snapshot theo kỳ;
hợp đồng cá nhân không gửi cho Tenant khác cùng Room.

## Invitation và quyền Tenant

- POST `/api/v1/residents/{residentId}/invitation` (Owner): `{email}`. Chỉ occupant thuộc Main tenancy active
  của Owner; nếu chưa có user tạo user Tenant với credential ngẫu nhiên không gửi cho người dùng.
  Email đã thuộc tài khoản khác yêu cầu luồng liên kết có xác nhận hiện có, không tự chiếm tài khoản.
- POST `/api/v1/staff/{userId}/invitation` (Owner): Staff active, có email chưa xác nhận.
- POST `/api/v1/auth/accept-invitation` (anonymous, rate-limited): `{userName,token,newPassword}`.
  Token Identity đúng purpose, hết hạn theo Session.PasswordResetMinutes, hash-only grant, dùng một lần;
  xác nhận email, đổi mật khẩu và revoke phiên trong cùng transaction.
- Invitation trả `{userId,deliveryState}`; AcceptedByProvider chỉ là adapter chấp nhận (có thể Sandbox).
  PendingRetry nghĩa email thất bại sau khi đã commit; Owner gửi lại invitation để phát grant mới.
  Không lưu raw invitation/reset token vào Notification, Outbox hoặc log. Reset email thuộc AuthModule;
  không xếp raw token vào JOB-04 để retry.
- Đổi mật khẩu/refresh/logout vẫn giữ contract HTTP hiện có. Đổi mật khẩu thành công revoke mọi phiên.
- GET `/api/v1/tenant/rooms` và `/api/v1/tenant/rooms/{id}`: chỉ Room của chính Tenant theo cư trú hiện hành,
  DTO chỉ id/locationId/locationName/roomNumber/status/capacity; không trả occupant/PII/hợp đồng khác.
- API quản trị `/rooms`, occupancy/history vẫn Owner/Staff. Tenant khác không xem hợp đồng/PDF của nhau
  dù cùng phòng. Hóa đơn chung chỉ chia sẻ qua entitlement riêng của Invoice.
- Co-occupant thiếu account/email hợp lệ làm Draft có `occupant_account_email_required`;
  chưa được final cho tới khi Owner liên kết/mời tài khoản và refresh/review Draft. Không bỏ sót người nhận âm thầm.

## Chạy và cấu hình provider

Development mặc định bật `NotificationChannels.Enabled=true`, `AutomationEnabled=true`, `Mode=Sandbox`.
Notification-only worker xử lý inbox/nhắc/kênh gửi khi Jobs.Enabled=false; **không bật các job thay đổi
hóa đơn, hợp đồng hoặc thanh toán**. Khi Jobs.Enabled=true, scheduler/queue hiện có xử lý notification,
worker riêng nhường lại để không chạy hai lịch độc lập. Dedup/lease vẫn bảo vệ nhiều API instance.

Sandbox chỉ dùng được ở Development/Testing; receipt `sandbox:*` không chứng minh email/push đã đến thiết bị.
Production mặc định Unconfigured/tắt. EMAIL hiện dùng MailKit với STARTTLS bắt buộc;
cấu hình, retry và endpoint kiểm tra được cập nhật tại [Gmail SMTP](GMAIL_SMTP.md).
PUSH production chưa chọn Firebase/Expo; thay INotificationChannelProvider bằng adapter được duyệt,
còn MVP dùng sandbox/mock như Q7. Không gọi provider thật khi chưa cấu hình.

Biến môi trường được Start-Api.ps1 và DevelopmentEnvironmentFile hỗ trợ:

```text
NotificationChannels__Enabled=true
NotificationChannels__AutomationEnabled=true
NotificationChannels__Mode=Sandbox
NotificationChannels__MaxAttempts=4
NotificationChannels__RetrySeconds=30
NotificationChannels__TimeoutSeconds=15
```

SMTP mới dùng Email.Enabled và Email:AppPassword qua environment/user-secrets; mapping cấu hình
Mode=Smtp/SmtpHost/SmtpPort/SmtpUseTls/SmtpUser/SmtpPassword/FromAddress cũ vẫn được giữ.
Không commit credential. `.env.example` chỉ có giá trị không bí mật.
Staff lịch sử và production provider là giới hạn vận hành cần giữ rõ khi tích hợp UI.

## Kiểm thử

Xem kết quả lệnh thực tế và danh sách file trong báo cáo bàn giao
`docs/development/NOTIFICATION_MVP_DELIVERY_2026-11-08.md`.
Test Compact24 dùng DB disposable `bhome_compact24_<uuid>` trên loopback PostgreSQL;
không dùng DB 70 bảng hoặc ghi test vào DB `bhome` hiện hành.
