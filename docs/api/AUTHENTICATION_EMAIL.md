# Email xác thực và tài khoản

Tiếp nối [Gmail SMTP](GMAIL_SMTP.md), dùng cùng MailKit, notification inbox/outbox,
lease/history và worker JOB-04. Không thêm bảng/migration hoặc gửi mật khẩu dạng rõ.

## Cấu hình sử dụng

Máy Development đã có Email:AppPassword, Email:Enabled=true và sender trong .NET User Secrets
ID `bhome-api-development`. Các callback Development cũng đã được cấu hình: Web localhost:5173,
Mobile dùng scheme bhome có sẵn trong app.json. Khởi động lại Backend để nạp cấu hình.
Không chép password vào appsettings hoặc chạy `user-secrets list` vào log/báo cáo.
Máy/tài khoản Windows khác cần cấp secret riêng; Production dùng deployment secrets.

Ví dụ environment **không bí mật**, thay domain ví dụ bằng domain client thực tế:

```dotenv
Email__Enabled=true
NotificationChannels__Enabled=true
NotificationChannels__Mode=Unconfigured
AuthenticationEmail__WebResetUrl=https://owner.example.invalid/reset-password
AuthenticationEmail__WebInvitationUrl=https://owner.example.invalid/accept-invitation
AuthenticationEmail__MobileResetUrl=bhome://reset-password
AuthenticationEmail__MobileInvitationUrl=bhome://accept-invitation
AuthenticationEmail__WebVerificationUrl=https://owner.example.invalid/confirm-email
AuthenticationEmail__MobileVerificationUrl=bhome://confirm-email
AuthenticationEmail__TrustedOrigins__0=https://owner.example.invalid
AuthenticationEmail__TrustedOrigins__1=bhome://reset-password
AuthenticationEmail__TrustedOrigins__2=bhome://accept-invitation
AuthenticationEmail__TrustedOrigins__3=bhome://confirm-email
AuthenticationEmail__ResendCooldownSeconds=60
```

Inject riêng Email__AppPassword từ secret store vào process Backend. Không dùng localhost HTTP
trong Production. Callback có query/fragment/userinfo hoặc origin ngoài allowlist bị từ chối;
không dựng link từ Host header hoặc callback tùy ý do caller gửi.
Owner dùng Web callback; Staff/Tenant dùng Mobile callback. Native link cần ứng dụng được cài
có scheme bhome; chưa nghiệm thu Expo Go/universal links. Có thể cấu hình Mobile callback bằng
HTTPS của client triển khai các route tương ứng; không tự tạo domain association/analytics redirect.

Khi Jobs.Enabled=false và callback hợp lệ, worker hiện có vẫn xử lý email xác thực nếu
NotificationChannels.AutomationEnabled=false: chỉ publish/deliver Account notices, không xử lý
backlog hóa đơn/thanh toán/hợp đồng hoặc bật financial jobs. NotificationChannels.Enabled vẫn
phải true. Nếu Jobs.Enabled=true, scheduler/queue hiện có xử lý JOB-04. Không thêm worker mới.

## API và client

| API | Hành vi |
| --- | --- |
| POST `/api/v1/auth/forgot-password` | Anonymous `{userName}`; email đăng ký hoặc username legacy; generic 202 khi adapter sẵn sàng |
| POST `/api/v1/auth/request-email-verification` | Anonymous `{userName}`; generic 202; gửi link tới email đã lưu của tài khoản đủ điều kiện |
| POST `/api/v1/auth/confirm-email` | `{userName,token}`; Identity + verification grant hợp lệ → 204; lỗi chung 400 |
| POST `/api/v1/auth/reset-password` | `{userName,token,newPassword}`; Identity + grant hợp lệ → 204; lỗi chung 400 |
| POST `/api/v1/auth/change-password` | Phiên xác thực; body cũ; giữ 204/400 và revoke sessions |
| POST `/api/v1/staff/{id}/invitation` | Owner; dùng email Staff đã lưu |
| POST `/api/v1/residents/{id}/invitation` | Owner; `{email}` khớp Resident/contact và active tenancy hiện có |
| POST `/api/v1/auth/accept-invitation` | `{userName,token,newPassword}`; Identity AccountInvitation token một lần |

Body/route cũ giữ nguyên. Lookup email giải quyết username khác email. Unknown/invalid identifier,
unconfirmed/ineligible account không tạo reset email, vẫn generic 202. Required/length validation
giữ 400. Thiếu SMTP/callback configuration trả unavailable chung cho mọi tên, không lộ account existence.
Auth rate limit hiện có áp dụng; thêm cooldown user-row lock giữa request/instance: mặc định 60 giây,
cấu hình 30–3600. Thời hạn token giữ Sessions.PasswordResetMinutes hiện có, mặc định 15 phút (1–60).

Web Login/Reset/Accept giữ màn hình; link Web dùng fragment, đọc vào memory rồi xóa khỏi history.
Mobile có forgot-password/reset-password/accept-invitation không đòi login; link vào form, chỉ POST
token sau thao tác xác nhận. Không ghi token vào storage/log/diagnostics hoặc analytics.
Reset thành công về login; accept có trạng thái thành công và nút về login; mã thủ công vẫn dùng được.

Staff creation và Owner gửi invitation vẫn là các thao tác API/UI hiện có, không suy đã gửi email
từ response tạo tài khoản. Tenant chỉ provision khi Owner hoặc job active-tenancy đã được phê duyệt
thực hiện; Resident đơn thuần không mặc nhiên có login. Không mở thêm quyền provision cho Staff.

## Invitation và trạng thái tài khoản

`{userId,deliveryState:"Queued"}` nghĩa grant/outbox đã commit, chưa phải SMTP accepted.
ExistingInvitationPreserved nghĩa giữ grant trong cooldown, không tạo email/account trùng.
SMTP failure không xóa account/Resident link. Resend sau cooldown thay grant; link cũ bị suppress.
Tài khoản có invitation chưa dùng phải hoàn tất setup trước login; cấp invitation rotate stamp và
revoke sessions để chặn login race. Không áp đặt confirmed-email bắt buộc cho mọi account hiện có.
Accept giữ Identity validation, đánh dấu EmailConfirmed, consume grant và revoke sessions.
Theo quyết định bổ sung ngày 12/11/2026, có luồng email-verification độc lập; không thêm suspicious-login detection.

## Xác nhận email để dùng quên mật khẩu

Nếu tài khoản đang hoạt động nhưng `EmailConfirmed=false`, yêu cầu quên mật khẩu vẫn trả 202 chung và không tạo email khôi phục. Trên Web/Mobile, chọn **Chưa xác nhận email? Gửi liên kết xác nhận**, nhập email đã đăng ký, mở thư và bấm **Xác nhận email**. Sau khi thành công, quay lại quên mật khẩu để nhận thư đặt lại mật khẩu.

Không tự đánh dấu email đã xác nhận. Link dùng Identity email-confirmation token, chỉ dùng một lần, có thời hạn Sessions.PasswordResetMinutes và cooldown AuthenticationEmail.ResendCooldownSeconds. Chỉ link mới nhất còn hiệu lực; email, security stamp, trạng thái tài khoản hoặc invitation thay đổi sẽ chặn link cũ. Verification có grant riêng trong outbox và không thay reset/invitation grant, mật khẩu, session, role hay IsActive.

Tài khoản đang có invitation chưa dùng hoặc có provisioning invitation job phải hoàn tất luồng lời mời của Owner; verification không bỏ qua setup. Không bắt mọi tài khoản cũ xác nhận email trước login. Hai verification URL cần được cấu hình riêng; thiếu chúng chỉ làm request verification trả 503 chung, không ảnh hưởng reset/invitation đã cấu hình.

## Templates và security events

| Event/template | Nội dung |
| --- | --- |
| PASSWORD_RESET_REQUESTED | Giải thích reset, link một lần, hạn dùng, hướng dẫn nếu không yêu cầu |
| ACCOUNT_INVITATION / StaffInvitation | Lời mời Staff, tên/tài khoản và hướng dẫn thiết lập |
| ACCOUNT_INVITATION / TenantInvitation | Chào mừng Tenant, tài khoản riêng và cách mở ứng dụng |
| PASSWORD_CHANGED | Đổi mật khẩu thành công, thời gian Việt Nam, liên hệ Owner nếu trái phép |
| PASSWORD_RESET_COMPLETED | Reset thành công, không chứa token/password hoặc email change trùng |
| ACCOUNT_SETUP_COMPLETED | Hoàn tất invitation theo audit đã commit |
| ACCOUNT_ACTIVATED / DEACTIVATED / ACCESS_CHANGED | Thay đổi trạng thái/quyền từ audit hiện có |
| ACCOUNT_LOCKED | Lockout thực tế do Identity thiết lập, dedup user + lockout window |

Subject [BHOME], UTF-8/Vietnamese, HTML encoding + plain-text. Link chỉ từ callback tin cậy.
StaffCreated giữ in-app để không trùng invitation email. Audit thất bại không phát security email;
hỗ trợ cờ Succeeded PascalCase/camelCase. Không thay lockout policy hiện có.

## Persistence, retry và key ring

Grant hash + safe Account inbox + ChannelDelivery OUTBOX commit cùng transaction. Protected payload
dùng ASP.NET Data Protection purpose riêng cho token cần retry; không có raw token/link trong
inbox/API/log/grant row. Không export OUTBOX event_data. Recipient chỉ xem delivery status của mình.
Trước gửi, recheck role, email hiện hành, active state, grant hash/expiry/consumed.
Invalid/expired/superseded/consumed → Suppressed; retry không tạo/gia hạn token.
4xx/connection failure trước submit retry hữu hạn theo JOB-04; permanent failure dừng;
unknown submission → PendingReview, không tự gửi lại. Sent chỉ nghĩa SMTP accepted.

Persist và bảo vệ Data Protection key ring, chia sẻ giữa API/worker instances như Identity keys;
không tự chọn kho key Production mới. Protected payload nằm trong immutable envelope theo mô hình
notifications hiện có; grant expiry/consume/hash làm link cũ vô hiệu. Không tự đặt retention policy.
[Microsoft Data Protection](https://learn.microsoft.com/en-us/aspnet/core/security/data-protection/configuration/overview?view=aspnetcore-8.0)
mô tả yêu cầu bảo vệ/chia sẻ key ring.

## Kiểm tra thủ công và real smoke

Trên environment tổng hợp: recovery → email → link → reset → login; thử reuse/expired token.
Owner tạo Staff rồi gửi invitation → thiết lập → login. Tenant tương tự nhưng cần active tenancy.
Thử sai actor/scope, duplicate email, cooldown, lỗi SMTP với fake; lỗi gửi không rollback account/password.
Không tắt mạng hoặc đổi credential của hệ thống phục vụ người thật để mô phỏng lỗi.

```powershell
$env:BHOME_GMAIL_SMOKE='1'
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Test-Compact24Isolated.ps1 `
  -Filter 'FullyQualifiedName~GmailAuthenticationSmokeTests' -ResultsDirectory .tmp/auth-email-real-smoke
Remove-Item Env:BHOME_GMAIL_SMOKE
```

Opt-in gửi một verification và một recovery email về chính mailbox sender được cấu hình, dùng DB disposable.
IMAP read-only tìm đúng Message-Id và chỉ đọc thư test để xác nhận email rồi reset Owner tổng hợp,
thử reuse và login mới. Không gửi Tenant thật/tiếp security email thật, không log link/token.
Không chạy trong CI; domain .invalid trong smoke chỉ là fixture.
Kết quả/giới hạn tại [báo cáo triển khai](../development/AUTHENTICATION_EMAIL_IMPLEMENTATION.md).
