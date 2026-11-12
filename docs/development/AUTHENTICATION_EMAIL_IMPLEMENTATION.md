# Email xác thực BHOME — 12/11/2026

Yêu cầu tiếp nối Gmail SMTP, FE-02/UC-01..02, GBR-02/13/14/18, JOB-04 và Report 4 Identity/token design.
Giữ Identity hashing, password policy, JWT/session/revocation, quyền Owner/Staff/Tenant hiện có.
Không thay đổi nghiệp vụ tài chính hoặc migration SePay. Baseline: nhánh member/QHuy sạch,
3 commit Gmail trước đã hoàn tất. App Password đã có và được cập nhật trong User Secrets,
không vào repository. Không dùng mật khẩu tài khoản Google để SMTP.

## Audit và traceability

| Yêu cầu | Hiện trạng và phần bổ sung | Tiêu chí kiểm chứng |
| --- | --- | --- |
| Recovery qua email | IdentityPasswordService có reset/hash grant/expiry/session revoke; trước chỉ tìm username và gửi mã đồng bộ | Tìm theo email, generic response, cooldown, link, invalid/expired/reused/weak token, login mật khẩu mới |
| UI recovery | Web có form reset thủ công; Mobile nút chưa nối API | Web đọc fragment, Mobile có route/link và form; không persist token |
| Staff/Tenant invite | AccountInvitations, Owner endpoints, tenancy approval job và UI accept có sẵn | Role-aware email, pending setup, resend, duplicate/scope, không tạo login cho Resident không được provision |
| Security email | Audit đã commit → CompactNotificationEvents → Account inbox/EMAIL | Đúng actor/event/time, không failed action, không double-notify/reset rollback |
| Retry | JOB-04 ChannelDelivery lease/status/history có sẵn | Grant + protected payload + outbox atomic; transient retry, invalid/expired/consumed/superseded suppress |

Token đang chờ gửi được mã hóa/xác thực bằng ASP.NET Data Protection với purpose riêng;
raw token chỉ tồn tại trong bộ nhớ và email riêng. Database giữ grant hash hiện có và protected
payload trong notifications OUTBOX; không thêm bảng/migration hoặc đưa token vào inbox/API/log.
Key ring phải được lưu bền vững, bảo vệ và chia sẻ giữa các instance deployment như Identity keys.
Không có quyền tự chọn một kho key production mới trong tác vụ này.

## Giai đoạn 1

Recovery tái sử dụng IPasswordResetDelivery và NotificationChannelWorker. Adapter durable queue
trong transaction grant, retry không tạo token mới, recheck user/email/expiry/hash/consumed trước gửi.
Fallback test adapter giữ tương thích. API `userName` giữ tên field và hỗ trợ username cũ, thêm
lookup email; không trả token, account existence hoặc kết quả SMTP trong public response.
Lịch cooldown 60 giây cấu hình được, không áp dụng thay lịch nhắc nghiệp vụ.
Web nhận token qua URL fragment rồi xóa fragment khỏi history; Mobile dùng scheme bhome đã có.
Trusted origins/path scheme được kiểm tra; localhost HTTP chỉ Development; Production cần HTTPS
được cấu hình rõ ràng. Không lấy callback từ Host header hoặc dữ liệu tùy ý của caller.

Khi global AutomationEnabled=false và URL xác thực đã được cấu hình, worker hiện có chỉ xử lý
protected auth outbox; không publish/gửi backlog nghiệp vụ hoặc bật job tài chính.
NotificationChannels.Enabled vẫn là công tắc kênh bắt buộc. Không thêm worker/hàng đợi mới.

Kiểm chứng giai đoạn 1: API build 0 warning/error; 13 test backend đầu tiên passed;
Web 13 test recovery/login và Mobile 3 test recovery passed; typecheck/lint hai client passed;
Owner Web production build passed (cảnh báo chunk >500 kB đã tồn tại, không lỗi build).

## Giai đoạn 2

Staff/Tenant invitation giữ endpoint/actor mapping hiện có: Owner gửi qua thao tác quản trị hiện có;
Tenant chỉ được provision khi tenancy active/approved theo AccountInvitations và job đã có.
Không mở quyền mới cho Staff và không tạo login chỉ vì một Resident tồn tại.
Email lời mời có tên/tài khoản, hướng dẫn thiết lập, link một lần và thời hạn; Staff/Tenant dùng
template riêng. Grant + protected outbox commit cùng nhau; SMTP lỗi chỉ đổi delivery status.
Resend trong cooldown giữ invitation cũ; sau cooldown tạo grant mới và tự suppress link cũ.
Đã được mời nhưng chưa thiết lập thì không đăng nhập; cấp invitation thu hồi session cũ và
rotate security stamp trước khi sinh token để chặn login race. Không bắt buộc email confirmation
cho mọi tài khoản đang tồn tại. Accept vẫn dùng Identity token purpose AccountInvitation,
password validator, EmailConfirmed và revoke sessions như trước.
Web/Mobile accept tự đọc link; thao tác gửi invitation trên Owner Web giữ nguyên API có sẵn.
Không tự gửi một email thứ hai từ frontend khi account đã được provision bởi job.

Kiểm chứng giai đoạn 2: API build 0 warning/error; 38 test backend passed trước hardening stamp,
28 notification test + 2 test invitation mục tiêu passed sau hardening; Web invitation 4 passed,
Mobile recovery/invitation 4 passed; lint/typecheck hai client passed.

## Giai đoạn 3

Audit đã commit → security notice có thời gian Việt Nam và hướng dẫn liên hệ Owner:
PASSWORD_CHANGED, PASSWORD_RESET_COMPLETED, ACCOUNT_ACTIVATED/DEACTIVATED,
ACCOUNT_SETUP_COMPLETED, ACCOUNT_ACCESS_CHANGED. Giữ PASSWORD_CHANGED cho change flow cũ;
reset dùng event riêng để tránh email hai lần cho một thao tác. StaffCreated chỉ tạo in-app,
lời mời role-aware đã chịu trách nhiệm email thiết lập tài khoản.
Lockout lấy từ lockout_end thực tế do Identity thiết lập; dedup theo user + lockout window,
không thêm thuật toán suspicious-login hoặc thay ngưỡng lockout hiện tại.
Đã sửa đọc audit Succeeded (PascalCase lẫn camelCase), bảo đảm PasswordChange thất bại không phát email.
Auth-only worker cũng publish/send các security notice này, không đợi bật business automation.
Tất cả vẫn qua channel outbox/retry; lỗi SMTP không rollback thay đổi mật khẩu/trạng thái đã commit.
Không thêm mandatory email verification; invitation acceptance vẫn xác nhận email theo quy trình sẵn có.

Kiểm chứng: API build 0 warning/error; 40 test auth/notification backend passed;
Application UT 450 passed, Domain UT 106 passed. Lượt compile test đầu giai đoạn 3 bị xUnit2031
chặn vì dùng Where trước Assert.Single; đã sửa đúng overload, không tắt analyzer và rerun passed.

## Giai đoạn 4 — xác minh và vận hành

Đã bổ sung kiểm tra rate limit, unconfirmed/invalid identifier không phát email, reset hoàn tất
không phát thêm PASSWORD_CHANGED và controlled real authentication smoke.
API/config/template/manual test chi tiết tại [Email xác thực](../api/AUTHENTICATION_EMAIL.md).

Kết quả thực thi cuối:

| Kiểm tra | Kết quả |
| --- | --- |
| API build cuối | PASS, 0 warnings/errors |
| Application UT / Domain UT | 450 / 106 passed, không fail/skip |
| Integration auth/notification/invoice/payment/inbox | 101 passed, không fail/skip; DB PostgreSQL disposable |
| Mobile toàn bộ, Node 22.23.4 | 77 files, 889 passed, không fail |
| Owner Web toàn bộ, Node 22.23.4 | 69 files, 343 passed, không fail |
| Web tests mục tiêu recovery/login/invitation | 13 recovery/login + 4 invitation passed |
| Typecheck/lint Web và Mobile cuối | PASS |
| Owner Web production build | PASS; cảnh báo chunk >500 kB, không phải lỗi build |
| Gmail authentication smoke thật | 1 passed, 11.7 giây; không gửi Tenant thật |

SMTP thực tế: một recovery email về chính mailbox sender/test đã cấu hình → Gmail accepted →
IMAP read-only tìm đúng Message-Id trong INBOX và chỉ đọc thư test → lấy link → reset Owner tổng hợp
trong DB disposable → reuse bị từ chối → login bằng mật khẩu mới thành công. Không log token/link.
Không bật business/security-email automation thật trong smoke; DB tổng hợp được fixture xóa sau test.
Test này opt-in, mặc định skip, không chạy trong CI thường. SMTP Send vẫn chỉ nghĩa provider accepted;
việc xác nhận INBOX trong lượt này là bằng chứng riêng từ IMAP, không thay semantics API.

Evidence local ignored: `.tmp/auth-email-final/` và `.tmp/auth-email-real-smoke/` (TRX).
Filter 101 integration test:

```text
FullyQualifiedName~Compact24NotificationMvpTests|FullyQualifiedName~Compact24InboxTests|FullyQualifiedName~Compact24AuthTests|FullyQualifiedName~Compact24PaymentRegressionTests|FullyQualifiedName~Compact24InvoiceRegressionTests|FullyQualifiedName~EmailTransportTests
```

Lượt đầu Mobile full suite dưới Node 24 ngoài engines dự án có 12 runtime-test failures; rerun đúng
Node 22 qua toàn bộ. Một suite onboarding chưa mock expo-router nên parser native Flow báo typeof;
đã bổ sung native boundary mock, giữ assertions nghiệp vụ và rerun passed. Lượt đầu build smoke có
nullable TextBody warning-as-error; đã guard, không tắt nullable, rerun smoke thật passed.
PowerShell chặn npm.ps1/dot-source script ở policy mặc định: dùng npm.cmd và PATH Node 22 trong process,
không thay execution policy toàn hệ thống. Không cộng các lượt rerun vào số test cuối.
Lượt Owner Web full dưới Node 24 đã được dừng khi chưa có kết quả; lượt Node 22 đầy đủ sau đó passed.

### Cấu hình đã hoàn tất

- App Password được cập nhật trong .NET User Secrets ngoài Git; Email.Enabled=true, sender/username
  đã có. Không lưu mật khẩu đăng nhập Gmail. Email.TestEnabled vẫn false sau smoke.
- Web callbacks localhost:5173 và native bhome callbacks/allowlist đã có trong User Secrets.
  Restart Backend Development để nạp; không cần commit credential hoặc sửa appsettings chứa secret.
- NotificationChannels.Enabled cần true (Development mặc định đã true). Global AutomationEnabled
  trong .env đang false được giữ nguyên; auth-only worker vẫn xử lý reset/invitation/security Account.
  Không thay bất kỳ lịch nhắc tài chính/tạm trú hoặc bật financial jobs.

### Giới hạn và bước còn lại

Cập nhật sau lượt này: migration SePay development đã được áp dụng và readiness 200;
xem [Mobile readiness fix](MOBILE_SEPAY_READINESS_FIX_2026-11-12.md). Các ghi nhận pending dưới đây
là trạng thái tại thời điểm nghiệm thu email, không còn là bước vận hành còn thiếu trên development này.

- Database Neon cấu hình ở lượt Gmail trước còn pending migration có sẵn
  `20261112000100_SePayIntegration`, readiness 503. Tác vụ auth không migrate/schema-edit Neon;
  không thêm migration mới. Review/backup và áp dụng migration hiện có theo quy trình database
  trước khi nghiệm thu vận hành đầy đủ; không dùng EnsureCreated/reset/legacy migrations.
- Production: cấp SMTP secret, callback HTTPS/domain thực tế và key ring Data Protection bền vững,
  được bảo vệ/chia sẻ giữa instances. Không có deployment/Rancher/Backend container để tự nghiệm thu.
- Native bhome callback cần dev/production build đã cài; chưa nghiệm thu Android/iOS thiết bị thật,
  Expo Go/Gmail client click behavior hoặc universal link. UI unit/component và backend/email thật
  đã được kiểm chứng riêng, không coi đó là E2E thiết bị thật.
- Standalone email verification và suspicious-login detection không được thêm vì không có lifecycle
  tương ứng đã phê duyệt. Invitation vẫn xác nhận email như flow cũ; Identity lockout hiện có được tái sử dụng.
- Không đo performance/coverage/SLA, không chạy mọi backend test trong repository và không gửi
  email thật cho Staff/Tenant ngoài mailbox test. Không tuyên bố Production acceptance.

## Commit

| Hash | Message | Short English description | Kiểm chứng trước commit |
| --- | --- | --- | --- |
| f185655 | feat(auth): implement password recovery via email | Add secure password reset links, protected delivery retries, and web/mobile recovery forms. | Build; 14 backend; 13 Web; 3 Mobile; lint/typecheck/build |
| f729d0f | feat(auth): add staff and tenant invitation emails | Queue protected role-aware invitations, preserve pending setup, and connect web/mobile activation links. | Build; 28 backend + 2 focused after guard; 4 Web + 4 Mobile; lint/typecheck |
| 7aaa220 | feat(auth): add account security email notifications | Notify committed password and account changes, cover Identity lockout, and suppress failed-action alerts. | Build; 40 backend; 450 Application UT; 106 Domain UT |
| Final phase | test(auth): verify authentication email workflows | Verify real recovery delivery and document configuration, reliability, and client flows. | 101 IT; real SMTP/INBOX/reset/login; 889 Mobile; 343 Web; final checks |

## Thành phần thay đổi

Backend tái sử dụng AuthController/DTOs/UserManager/token providers; mở rộng IPasswordResetDelivery,
IdentityPasswordService, AccountInvitations, AccountInvitationJob, IdentityCredentialVerifier.
Thêm AuthenticationEmailOptions/AuthenticationEmailDelivery; worker/channel/template hỗ trợ protected
auth payload và trusted action link; CompactNotificationEvents xử lý audit/security/lockout.
Không đổi JWT, policy mật khẩu, route hiện có hoặc mô hình quyền provisioning.

Client: client-core authLinks; Web ResetPasswordPage/AcceptInvitationPage và tests;
Mobile PasswordRecoveryScreen + forgot/reset routes, LoginScreen/_layout/AcceptInvitationScreen và tests.
Cấu hình: .env.example, Start-Api, DevelopmentEnvironmentFile hỗ trợ AuthenticationEmail__*.
Test backend: AuthenticationEmailTests và GmailAuthenticationSmokeTests; tài liệu API email/auth cập nhật.

Nguồn kỹ thuật: [Microsoft Data Protection](https://learn.microsoft.com/en-us/aspnet/core/security/data-protection/configuration/overview?view=aspnetcore-8.0),
[Expo SDK 58](https://docs.expo.dev/versions/v58.0.0/),
[Expo Router params](https://docs.expo.dev/router/reference/url-parameters/).
