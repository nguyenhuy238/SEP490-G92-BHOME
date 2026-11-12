# Tích hợp Gmail SMTP — 12/11/2026

## Phạm vi và căn cứ

Yêu cầu triển khai Gmail SMTP của người dùng bổ sung kênh EMAIL trên hệ thống hiện tại.
Đã đối chiếu Report 3 trong `docs/reports/BHome_Report-3_Software Requirement Specification.docx`:
JOB-04 retry push/email; GBR-14 giới hạn người nhận và không rollback nghiệp vụ khi gửi lỗi;
GBR-18 idempotency. Quyền theo I.4.4, GBR-02/13; hóa đơn UC-21/JOB-10, thanh toán
UC-22..25/GBR-10/JOB-01, hợp đồng UC-19/JOB-02, emergency UC-26..30/GBR-11.
Không thay đổi lịch nhắc, quyền tạm trú, chính sách tài chính hoặc PUSH production.
Report 5 gốc chưa có trong `docs/reports`; không dùng số liệu mẫu làm bằng chứng.

| Hành vi                                | Thành phần hiện có / thay đổi                                                    | Tiêu chí kiểm thử                                                     |
| -------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Email thật, STARTTLS, bí mật ngoài Git | INotificationChannelProvider → MailKitEmailSender, EmailOptions                  | Địa chỉ sai, thiếu cấu hình, TLS bắt buộc, lỗi SMTP an toàn           |
| Inbox bền vững, email bất đồng bộ      | NotificationEventPublisher, CompactNotificationWriter, NotificationChannelWorker | Một outbox/inbox/channel, concurrent claim, không rollback/read-state |
| Chỉ người có quyền nhận                | InvoiceRecipient, scope/TargetAsync, assignment và users hiện hành               | Cross-Tenant/Location, inactive/unverified, assignment hết hiệu lực   |
| Retry và kết quả không chắc chắn       | notifications OUTBOX + lease + delivery_history (JOB-04)                         | 4xx retry hữu hạn; 5xx/auth dừng; timeout sau submit → PendingReview  |
| Nội dung Việt và dữ liệu thật          | EmailTemplate, builder từ Invoice/Contract/Location                              | HTML encoding, kỳ/hạn/phòng đúng, không lộ bank reference             |
| Test thật có kiểm soát                 | Development-only Owner endpoint, recipient cấu hình sẵn                          | Không token/Staff/Tenant/Production bị từ chối; giới hạn gửi          |

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

## Giai đoạn 3 — kết quả thực thi cuối

| Kiểm chứng thực tế                                                                   | Kết quả                                                                                               |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `dotnet restore src/backend/BHome.sln --verbosity quiet`                             | PASS                                                                                                  |
| `dotnet build src/backend/BHome.Api/BHome.Api.csproj --no-restore --verbosity quiet` | PASS, 0 warnings/errors                                                                               |
| Application.UnitTests toàn bộ                                                        | 450 passed, 0 failed/skipped                                                                          |
| Domain.UnitTests toàn bộ                                                             | 106 passed, 0 failed/skipped                                                                          |
| Bộ integration liên quan bên dưới                                                    | 92 passed, 0 failed/skipped, PostgreSQL Docker disposable                                             |
| Gmail smoke opt-in, Development Owner endpoint                                       | 1 passed; gửi một email tới chính hộp thư BHOME; không Tenant nào nhận thư test                       |
| SMTP acceptance                                                                      | `SMTP_ACCEPTED`: Gmail chấp nhận thư qua STARTTLS/auth thực tế                                        |
| Inbox verification                                                                   | `INBOX_CONFIRMED`: tìm đúng Message-Id trong INBOX bằng IMAP read-only, không fetch nội dung thư khác |
| API Development chạy bằng `dotnet run`, TLS mặc định                                 | `/health/live` 200; notifications/channel-status/email-test không token 401; Swagger có endpoint mới  |
| `/health/ready` với database đang cấu hình                                           | 503; nguyên nhân xác minh bên dưới, không che thành PASS                                              |
| DI/options/config                                                                    | Startup thành công với User Secrets; test thiếu AppPassword chặn startup; dotenv giữ thứ tự ưu tiên   |
| `git diff --check` và scan supplied App Password trên tracked files                  | PASS; không phát hiện secret được cung cấp                                                            |

Filter integration cuối:

```text
FullyQualifiedName~Compact24NotificationMvpTests|
FullyQualifiedName~Compact24InboxTests|
FullyQualifiedName~Compact24AuthTests|
FullyQualifiedName~Compact24PaymentRegressionTests|
FullyQualifiedName~Compact24InvoiceRegressionTests|
FullyQualifiedName~EmailTransportTests
```

Lệnh:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Test-Compact24Isolated.ps1 `
  -Filter '<filter trên một dòng>' -ResultsDirectory .tmp/gmail-final-regression
```

Kết quả TRX local (ignored): `.tmp/gmail-final-regression/` và `.tmp/gmail-real-smoke/`.
Không cộng các lượt rerun 9/19/21 test vào 92 test cuối. Smoke thật chỉ chạy thành công một lần;
build smoke trước đó có lỗi namespace ApplicationUser/nullable, đã sửa trước khi thực thi gửi thư.
Sau smoke đã tắt `Email:TestEnabled` trong User Secrets và dừng process API do tác vụ khởi chạy.
App Password và sender vẫn được cấu hình ngoài Git; không lưu mật khẩu đăng nhập Google.

### Readiness của database hiện tại

Cập nhật sau nghiệm thu Gmail: migration SePay còn thiếu đã được xử lý; development hiện có
9 applied / 0 pending và readiness 200. Xem [Mobile readiness fix](MOBILE_SEPAY_READINESS_FIX_2026-11-12.md).
Phần chẩn đoán bên dưới ghi lại trạng thái trước lần sửa đó.

`scripts/Test-Database.ps1` kiểm tra metadata trong transaction **read-only**: kết nối Neon có
VerifyFull/ChannelBinding.Require, 24 bảng public, Compact24 EF history 8 migration đã áp dụng,
1 migration có sẵn chưa áp dụng: `20261112000100_SePayIntegration`.
Schema checker mong `compact24-2026-11-12-sepay`, nên native readiness trả 503.
Không sửa/migrate database Neon hoặc dữ liệu nghiệp vụ trong tác vụ Gmail.
Đây là migration đã có từ tích hợp SePay; thay đổi Gmail không thêm migration/bảng/cột.
Database disposable hiện hành trong smoke trả health ready 200 và vượt qua toàn bộ test liên quan.

### Cấu hình đã hoàn tất và bước vận hành còn lại

Đã cấu hình local qua User Secrets: Email.Enabled=true, sender/username, AppPassword,
TestRecipient=sender, TestEnabled=false sau kiểm tra. SMTP production secret chưa triển khai.
File `.env` đang dùng đã có `NotificationChannels__AutomationEnabled=false`; giữ nguyên để
không gửi backlog tới tài khoản thật khi kiểm thử. Không bật thay người dùng bất kỳ reminder policy nào.

Trước khi vận hành với database đang chọn:

1. Review/backup và áp dụng migration SePay còn thiếu theo quy trình database hiện có, xác nhận
   `/health/ready` 200. Không chạy migration legacy/EnsureCreated/reset database để sửa readiness.
2. Khi sẵn sàng gửi thông báo nghiệp vụ, bật `NotificationChannels.Enabled=true` và
   `AutomationEnabled=true` trong môi trường Backend; dùng Mode=Unconfigured cho EMAIL thật
   mà không nhận receipt Sandbox. Nếu chạy trực tiếp, có thể dùng command line ưu tiên cao:

   ```powershell
   dotnet run --project src/backend/BHome.Api -- --NotificationChannels:Enabled=true --NotificationChannels:AutomationEnabled=true --NotificationChannels:Mode=Unconfigured
   ```

3. Với container/Production, inject Email__AppPassword bằng deployment secrets và các giá trị
   không bí mật trong [Gmail SMTP](../api/GMAIL_SMTP.md). Giữ Email.TestEnabled=false.
   Không có Backend container/Rancher deployment để xác minh injection trong repository hiện tại.

### Giới hạn / chưa kiểm thử / ngoài phạm vi

- **Implemented + tested:** MailKit, UTF-8/HTML encoding, config validation, durable delivery,
  transient/permanent/ambiguous failures, concurrent claims, invoice/payment/reminder/expiry/emergency
  recipients, Staff assignment revocation, announcement selection, inbox isolation/read-state và endpoint guard.
- **Tested thật:** một SMTP/email về hộp thư test và xác nhận INBOX. Các sự kiện nghiệp vụ dùng fake;
  không gửi email thật cho Tenant hoặc seeded accounts.
- **Blocked trong môi trường đang chọn:** readiness database Neon vì migration SePay có sẵn chưa áp dụng;
  chưa bật gửi tự động trên database đó.
- **Not tested:** Production/deployment secrets trong container/Rancher, deliverability tới provider khác,
  full repository suite, frontend/mobile E2E, load/performance/coverage. Không báo SLA/coverage mới.
- **Out of scope:** PUSH production, hệ thống mail hàng loạt mới, thay đổi hợp đồng/thanh toán/lịch nhắc,
  migration SePay, chính sách tạm trú và UI Web/Mobile. SMTP không bảo đảm exactly-once/final inbox delivery.

## Danh sách file

Tạo mới:

- `src/backend/BHome.Application/Notifications/EmailOptions.cs`
- `src/backend/BHome.Infrastructure/Modules/Notifications/EmailTemplate.cs`
- `src/backend/BHome.Infrastructure/Modules/Notifications/MailKitEmailSender.cs`
- `src/backend/BHome.Infrastructure/Modules/Notifications/NotificationEmailContent.cs`
- `src/backend/BHome.Infrastructure/Modules/Notifications/DevelopmentEmailTest.cs`
- `src/backend/BHome.Api/Controllers/Notifications/DevelopmentEmailTestController.cs`
- `tests/backend/BHome.Application.UnitTests/NotificationEmailPolicyTests.cs`
- `tests/backend/BHome.IntegrationTests/Notifications/EmailTransportTests.cs`
- `tests/backend/BHome.IntegrationTests/Notifications/GmailSmtpSmokeTests.cs`
- `tests/backend/BHome.IntegrationTests/Compact24/GmailNotificationTests.cs`
- `docs/api/GMAIL_SMTP.md`
- `docs/development/GMAIL_SMTP_IMPLEMENTATION.md`

Chỉnh sửa:

- `.env.example`, `scripts/Start-Api.ps1`
- `src/backend/BHome.Api/appsettings.json`
- `src/backend/BHome.Api/Configuration/ApiFoundation.cs`
- `src/backend/BHome.Api/Configuration/DevelopmentEnvironmentFile.cs`
- `src/backend/BHome.Application/Notifications/NotificationChannels.cs`
- `src/backend/BHome.Infrastructure/BHome.Infrastructure.csproj`
- `src/backend/BHome.Infrastructure/DependencyInjection.cs`
- `src/backend/BHome.Infrastructure/Modules/Notifications/NotificationChannelProvider.cs`
- `src/backend/BHome.Infrastructure/Modules/Notifications/NotificationChannelWorker.cs`
- `src/backend/BHome.Infrastructure/Modules/Notifications/NotificationEventPublisher.cs`
- `src/backend/BHome.Infrastructure/Modules/Notifications/CompactNotificationWriter.cs`
- `tests/backend/BHome.IntegrationTests/Compact24/Compact24NotificationMvpTests.cs`
- `docs/api/NOTIFICATION_MVP_COMPACT24.md`

Tham khảo API provider: [MailKit SendAsync](https://mimekit.net/docs/html/M_MailKit_Net_Smtp_SmtpClient_SendAsync_1.htm),
[SMTP error codes](https://mimekit.net/docs/html/T_MailKit_Net_Smtp_SmtpErrorCode.htm).
