# Gmail SMTP cho Notification

EMAIL sử dụng MailKit, `smtp.gmail.com:587`, STARTTLS bắt buộc và Google App Password.
Sender hiện tại: BHOME / `bhome.notification@gmail.com`. Mật khẩu tài khoản Google không dùng
cho SMTP. Không commit App Password vào appsettings, `.env.example`, test hoặc tài liệu.

Lỗi gửi tài khoản Staff trên cả ba môi trường ngày 21/11/2026 là do cấu hình:
localhost có allowlist cũ; Staging/Production tắt `Email.Enabled` và
`NotificationChannels.Enabled`. Xem [nguyên nhân, cấu hình đã áp dụng và kiểm thử](../development/BHOME_EMAIL_REPAIR_2026-11-21.md).

## Chính sách người nhận cho mọi môi trường (23/11/2026)

Development, Testing, Staging và Production đều cho phép mọi địa chỉ email hợp lệ khi
SMTP và credential đã cấu hình. Không cần `AllowedRecipients`,
`AllowAnyRecipientInDevelopment` hoặc người nhận trùng `TestRecipient`.
Các khóa danh sách/cờ cũ được bỏ qua hoàn toàn, kể cả danh sách chứa giá trị lỗi thời;
thành viên không cần xóa User Secrets hay `.env` cũ sau khi pull.
Capture vẫn chỉ kết nối loopback trong Development/Testing, không forward ra Gmail.

Mọi lời mời, credential, reset/confirmation, OTP/ký và notification qua sender chung
dùng chính sách này. `TestRecipient` chỉ phục vụ endpoint thử email. Sau khi tích hợp/pull
commit, rebuild/restart Backend; từng máy vẫn cần credential riêng nếu muốn SMTP thật.
Xem [quyết định và kết quả sửa Staging](../development/BHOME_EMAIL_NO_ALLOWLIST_2026-11-23.md).

## Cấu hình

Các giá trị không bí mật đã có tại `BHome.Api/appsettings.json`. Mặc định repository tắt EMAIL.
Khi `Email.Enabled=true`, startup kiểm tra host/port/username/from/password/STARTTLS/timeout;
thiếu App Password trả lỗi cấu hình an toàn, không in giá trị. `Email.TimeoutSeconds` mặc định 30;
worker còn có timeout riêng `NotificationChannels.TimeoutSeconds` mặc định 15, giới hạn ngắn hơn
sẽ được áp dụng khi xử lý thông báo nghiệp vụ.

Local dùng .NET User Secrets ID `bhome-api-development`, project `src/backend/BHome.Api`:

```powershell
dotnet user-secrets set 'Email:AppPassword' '<google-app-password>' --project src/backend/BHome.Api
dotnet user-secrets set 'Email:Enabled' 'true' --project src/backend/BHome.Api
```

Không chạy `user-secrets list` trong log/CI/báo cáo vì lệnh in cả secret. Trong phiên triển khai này
App Password và sender/test recipient đã được lưu ngoài repository bằng User Secrets.
Environment `Email__AppPassword` hoặc deployment secret dùng cho container/Production;
User Secrets chỉ tự nạp trong Development. `Start-Api.ps1` và DevelopmentEnvironmentFile
đã hỗ trợ nhóm `Email__*`. Khi chạy trực tiếp, dotenv fallback thấp hơn User Secrets,
process environment và command line; script Start-Api đọc file thành process environment.

Ví dụ environment triển khai (không chứa secret):

```dotenv
Email__Enabled=true
Email__Host=smtp.gmail.com
Email__Port=587
Email__Username=bhome.notification@gmail.com
Email__FromEmail=bhome.notification@gmail.com
Email__FromName=BHOME
Email__UseStartTls=true
Email__TestEnabled=false
NotificationChannels__Enabled=true
NotificationChannels__AutomationEnabled=true
NotificationChannels__Mode=Unconfigured
NotificationChannels__MaxAttempts=4
NotificationChannels__RetrySeconds=60
NotificationChannels__TimeoutSeconds=30
```

Inject riêng `Email__AppPassword` từ secret store vào **process Backend**, không chỉ vào
PostgreSQL/MinIO. Docker Compose gốc hiện không chạy Backend; không có Rancher manifest được
kiểm chứng trong tác vụ này. Người triển khai tự cấp secret vào workload Backend thực tế.
EMAIL hoạt động khi Email.Enabled=true ngay cả Mode=Unconfigured; Mode vẫn phục vụ
Sandbox/adapter cũ. PUSH production đã có adapter Expo, chỉ bật bằng cấu hình
`ExpoPush__Enabled=true` và access token riêng (xem [Expo Push](EXPO_PUSH.md)).
Không dùng Sandbox để xác nhận gửi thật.
Cấu hình cũ Mode=Smtp + SmtpHost/SmtpPort/SmtpUser/SmtpPassword/FromAddress còn được map
khi Email.Enabled=false; cần bỏ cấu hình cũ nếu muốn tắt SMTP bằng Email.Enabled.

Nếu `Jobs.Enabled=false`, bật AutomationEnabled để publisher thông báo nghiệp vụ riêng hoạt động.
Nếu Jobs.Enabled=true, queue/scheduler hiện có xử lý JOB-04, worker riêng nhường lại.
Không cần bật financial jobs chỉ để gửi email. Kiểm tra backlog và lựa chọn riêng
AutomationEnabled trước khi bật publisher; không bật nó chỉ để smoke credential Staff.

Luồng cấp mật khẩu Staff chỉ cần `Email.Enabled=true`, SMTP hợp lệ và
`NotificationChannels.Enabled=true`. Với `Jobs.Enabled=false`, worker xác thực riêng
vẫn xử lý protected outbox khi `NotificationChannels.AutomationEnabled=false`.
Giữ AutomationEnabled=false khi chỉ bật email tài khoản và chưa duyệt phát thông báo
nghiệp vụ cũ. Bật AutomationEnabled=true là lựa chọn riêng cho publisher thông báo
nghiệp vụ, không phải điều kiện bắt buộc để gửi credential Staff.

Kiểm tra **cấu hình hiệu lực của container**, sau tất cả Compose overlays, bằng công cụ
chỉ đọc (Python 3 standard library, Docker CLI):

```sh
python3 deploy/vps/check-email.py staging --smtp
python3 deploy/vps/check-email.py production --smtp
```

`--smtp` kiểm tra certificate STARTTLS và đăng nhập SMTP, không gửi thư. Có thể thêm
`--recipient` để kiểm tra cú pháp một mailbox; không dùng danh sách giới hạn người nhận.
Tránh đưa email cá nhân vào command/log dùng chung.
Công cụ chỉ hỗ trợ hai container VPS hiện có và không thay thế validation của Backend.
Nếu dùng bản cài tại VPS hiện tại, đường dẫn là `/opt/bhome-config/check-email.py`.
Không in `docker inspect` đầy đủ hoặc `docker compose config` vì chúng có thể chứa secrets.

## Sự kiện và nội dung

| Sự kiện                                          | Người nhận/kênh                                                         |
| ------------------------------------------------ | ----------------------------------------------------------------------- |
| INVOICE_FINALIZED                                | InvoiceRecipient và Owner hiện có, mỗi recipient một EMAIL              |
| INVOICE_DUE_SOON / INVOICE_OVERDUE               | Theo policy Location hiện có; không tự bật lịch nhắc                    |
| PAYMENT_PARTIALLY_CONFIRMED / INVOICE_FULLY_PAID | Chỉ từ event allocation đã commit và verified; không từ pending payment |
| CONTRACT_EXPIRY_REMINDER                         | Các bên/Staff theo luồng hết hạn hiện có                                |
| INCIDENT_EMERGENCY_SUBMITTED                     | Owner và Staff được phân công; không mở rộng sang Tenant                |
| ANNOUNCEMENT_SENT                                | Người nhận được phép theo API announcements, khi chọn EMAIL             |

Hóa đơn/thanh toán có Location, Room, kỳ và hạn thanh toán từ backend; hợp đồng có hạn hết;
emergency có Location/Room và hướng dẫn xử lý. Nội dung hướng người dùng mở BHOME để xem
chi tiết, không chứa CCCD, mật khẩu, JWT, tham chiếu ngân hàng hoặc mã allocation. Template có
HTML encode, UTF-8, plain-text alternative và subject `[BHOME]`. Announcement giữ body đã
được tác giả có quyền nhập; HTML vẫn được encode, không thực thi markup.
Template v2 ngày 20/11/2026 giữ subject đã có tiền tố BHOME để không lặp thương hiệu;
giữ subject xác nhận giữ chỗ và subject credential Staff theo loại thư. URL action
không hiện dài trong HTML; plain text vẫn giữ liên kết đầy đủ. Email credential
Staff là ngoại lệ đã được quyết định cho nội dung mật khẩu, xem [email tài khoản](AUTHENTICATION_EMAIL.md).
Không backfill/replay publication đã phát trước thay đổi này. Account reset/invitation dùng
abstraction EMAIL hiện có; luồng link, protected outbox và token-expiry-aware retry được cập nhật
tại [Email xác thực](AUTHENTICATION_EMAIL.md). Raw token không vào inbox/log/API.

## Trạng thái và vận hành

Inbox/outbox/history/lease dùng bảng notifications Compact24 có sẵn; không migration mới.
Một outbox cho mỗi inbox/channel bằng unique event key; kiểm tra lại active role, email confirmed,
quyền target, Staff assignment và độ phù hợp nghiệp vụ trước gọi SMTP. Mỗi email chỉ có một To.

| Channel status    | Ý nghĩa                                                            |
| ----------------- | ------------------------------------------------------------------ |
| Pending           | Chờ lần đầu hoặc retry; NextRetryAt có thời gian chạy lại          |
| Processing        | Đã claim có lease                                                  |
| Sent              | SMTP chấp nhận; chưa xác nhận thư vào INBOX                        |
| PermanentlyFailed | Lỗi vĩnh viễn hoặc hết giới hạn                                    |
| PendingReview     | Kết quả không chắc chắn sau submit/lease timeout; không tự gửi lại |
| Suppressed        | Người nhận mất quyền hoặc sự kiện không còn cần gửi                |

Lịch mặc định tối đa 4 lần: ngay → sau 1 phút → sau 5 phút → sau 15 phút tính từ lần lỗi trước.
SMTP 4xx và connection failure trước submit retry được; 5xx/auth/TLS/địa chỉ không hợp lệ dừng.
Timeout/mất kết nối trong SendAsync không được coi là thất bại an toàn để gửi lại. Message-Id ổn định
giúp đối chiếu; Gmail SMTP không cung cấp cam kết idempotency/exactly-once.
PendingReview cần người vận hành kiểm tra tình trạng thực tế trước quyết định tiếp; không reset
trạng thái bằng SQL hoặc tự gửi lại. Tác vụ này không thêm API resend không giới hạn.

API inbox/list/unread/read/read-all/filter giữ nguyên. Dùng
`GET /api/v1/notifications/{id}/deliveries` để xem từng kênh (chỉ của chính recipient);
`GET /api/v1/notifications/channel-status` dành cho Owner. Inbox Delivered là aggregate
model cũ; PUSH chưa cấu hình có thể giữ aggregate Pending trong khi EMAIL đã Sent.
Không cần thay React/React Native để bật EMAIL.

## Test SMTP có kiểm soát

`POST /api/v1/notifications/email-test`, không body:

- Owner đã xác thực; service cũng kiểm tra Owner.
- Chỉ Development, `Email.Enabled=true`, `Email.TestEnabled=true`, TestRecipient hợp lệ cấu hình sẵn.
- Không chấp nhận recipient/subject/body từ caller; 1 lần mỗi 10 phút cho toàn API instance.
- Production và khi tắt test trả 404 cho Owner; không token 401; Staff/Tenant 403; vượt giới hạn 429.
- Trả `{status:"SmtpAccepted",providerReference:"smtp-accepted:...",inboxDeliveryConfirmed:false}`.
  API không tuyên bố hộp thư đã nhận chỉ từ SMTP receipt.

Local bật test bằng User Secrets `Email:TestEnabled=true`, `Email:TestRecipient` là hộp thư test;
tắt lại sau kiểm tra. Kiểm thử tự động thông thường chỉ dùng fake/synthetic addresses.
Smoke opt-in gửi **một** thư tới chính sender, dùng DB PostgreSQL disposable và tắt cả channel
worker/financial jobs. Có thể kiểm tra đúng Message-Id trong INBOX bằng IMAP read-only;
không fetch nội dung các thư khác:

```powershell
$env:BHOME_GMAIL_SMOKE='1'
$env:BHOME_GMAIL_VERIFY_INBOX='1' # optional, requires Gmail IMAP access
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Test-Compact24Isolated.ps1 `
  -Filter 'FullyQualifiedName~GmailSmtpSmokeTests' -ResultsDirectory .tmp/gmail-smtp-smoke
Remove-Item Env:BHOME_GMAIL_SMOKE,Env:BHOME_GMAIL_VERIFY_INBOX
```

Không đưa test smoke vào CI tự động. Nếu IMAP bị chặn, SMTP accepted và inbox chưa kiểm chứng
là hai kết quả khác nhau. Kết quả thực thi và giới hạn hiện tại tại
[Gmail implementation](../development/GMAIL_SMTP_IMPLEMENTATION.md).
