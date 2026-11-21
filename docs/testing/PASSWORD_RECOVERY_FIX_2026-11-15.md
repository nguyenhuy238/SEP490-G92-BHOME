# Sửa email khôi phục mật khẩu — 15/11/2026

Phạm vi: yêu cầu đính kèm “Fix Forgot Password Email Recovery and Ensure CI Passes”,
ITC-AUTH-PWD-004/005. Nhánh `member/QHuy`; working tree sạch trước khi thực hiện.
Không đổi endpoint/DTO, giao diện, database schema, package, secret hoặc cấu hình riêng của thành viên.

## Traceability và nguyên nhân

SRS hiện có: `docs/reports/BHome_Report-3_Software Requirement Specification.docx`,
FE-02 §2.1 Authentication (UC-01/UC-02), GBR-02/13/18, JOB-04.
Password recovery chi tiết và yêu cầu xác nhận email dựa trên yêu cầu tác vụ này cùng
quyết định đã ghi tại `docs/development/EMAIL_VERIFICATION_FIX_2026-11-12.md`;
không coi UC-02 (Sign Out) là một UC Forgot Password riêng.

| Yêu cầu                                                      | Thành phần                                                                                            | Acceptance/regression                                                                                                                           |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 202 chung cho email/username đủ điều kiện hoặc không tồn tại | IdentityPasswordService, AuthController hiện có                                                       | Owner/Staff/Tenant, username/email, inactive/unconfirmed/missing email, generic response                                                        |
| Callback theo thao tác                                       | AuthenticationEmailOptions, AuthenticationEmailDelivery, AccountInvitations, EmailVerificationService | Reset không cần invitation/verification; invite/verify không cần reset; trusted origin/HTTPS/native/Web fallback                                |
| Durable acceptance không phụ thuộc SMTP                      | AuthenticationEmailDelivery, CompactIdentityPersistence hiện có                                       | SMTP tắt vẫn có grant và một Outbox; HTTP không gọi provider; provider hồi phục gửi một lần                                                     |
| Không chấp nhận giả khi database lỗi                         | IdentityPasswordService, admission savepoint, transaction hiện có                                     | Outbox lỗi cho mọi identifier; lỗi Outbox hoặc save grant rollback grant/INBOX/OUTBOX/audit; request sau phục hồi thành công                    |
| Retry và token lifecycle                                     | NotificationChannelWorker hiện có                                                                     | Transient retry cùng key/link; không dùng retry khi provider chưa cấu hình; suppress expired/consumed/superseded; single use và revoke sessions |
| Tách khỏi financial automation                               | NotificationAutomationWorker                                                                          | Chỉ reset callbacks + Jobs.Enabled=false + AutomationEnabled=false vẫn gửi; không publish invoice/contract/incident backlog                     |

Code gốc có ba điểm liên quan trực tiếp:

- `IdentityPasswordService.RequestResetAsync` kiểm tra delivery trước lookup. Đây là vị trí
  cần giữ kiểm tra cấu hình chung để không lộ tài khoản; lỗi nằm ở ý nghĩa quá rộng của availability.
- `AuthenticationEmailDelivery.IsAvailable` yêu cầu channel enabled, SMTP provider configured và
  `AuthenticationEmailOptions.Configured()`. `Configured()` buộc cả reset lẫn invitation URLs;
  `VerificationConfigured()` lại phụ thuộc toàn bộ điều kiện đó.
- `NotificationAutomationWorker` dùng cùng kiểm tra tổng hợp khi chạy authentication-only;
  chỉ bỏ guard trong request sẽ chưa giải quyết startup worker hoặc `QueueAsync`.

Không có bằng chứng lỗi Gmail credentials hay cấu hình runtime của backend dùng cổng 7240.
Correlation ID do báo lỗi cung cấp không được đối chiếu với log triển khai trong tác vụ này.

Các điểm sửa chính có thể đối chiếu trực tiếp:
[request/transaction](../../src/backend/BHome.Infrastructure/IdentityAccess/IdentityPasswordService.cs#L40),
[operation availability và Outbox probe](../../src/backend/BHome.Infrastructure/IdentityAccess/AuthenticationEmailDelivery.cs#L25),
[callback validation](../../src/backend/BHome.Infrastructure/IdentityAccess/AuthenticationEmailOptions.cs#L20),
[worker startup](../../src/backend/BHome.Infrastructure/Modules/Notifications/NotificationAutomationWorker.cs#L20).

Danh sách file thuộc commit:

```text
src/backend/BHome.Application/IdentityAccess/IAuthenticationSessions.cs
src/backend/BHome.Infrastructure/IdentityAccess/AccountInvitations.cs
src/backend/BHome.Infrastructure/IdentityAccess/AuthenticationEmailDelivery.cs
src/backend/BHome.Infrastructure/IdentityAccess/AuthenticationEmailOptions.cs
src/backend/BHome.Infrastructure/IdentityAccess/EmailVerificationService.cs
src/backend/BHome.Infrastructure/IdentityAccess/IdentityPasswordService.cs
src/backend/BHome.Infrastructure/Modules/Notifications/NotificationAutomationWorker.cs
tests/backend/BHome.IntegrationTests/Compact24/AuthenticationEmailTests.cs
tests/backend/BHome.IntegrationTests/Compact24/GmailNotificationTests.cs
tests/backend/BHome.IntegrationTests/Compact24/PasswordRecoveryRegressionTests.cs
docs/api/AUTHENTICATION_EMAIL.md
docs/testing/PASSWORD_RECOVERY_FIX_2026-11-15.md
```

## Thay đổi và giới hạn vận hành

Kiểm tra reset/invitation/verification độc lập; `IsAvailableFor` có default implementation
để adapter/fixture hiện có vẫn tương thích. Adapter production kiểm tra callback của đúng thao tác
và NotificationChannels.Enabled, không cần provider sẵn sàng để queue. Trước lookup,
một Outbox INSERT không chứa identifier/token được thử trong savepoint rồi rollback ngay.
Probe kiểm tra lỗi ghi sink chung, không để lại record hay tạo delivery. Không che lỗi persistence
bằng 202. Không đảm bảo các lỗi riêng một bản ghi có timing/response hoàn toàn giống mọi bản ghi khác.

Grant thực, inbox, protected email Outbox và audit vẫn nằm trong một transaction hiện có.
Lock user-row giữ thứ tự request đồng thời và cooldown; chỉ sinh token sau khi qua cooldown.
Raw token vẫn dùng ASP.NET Identity; chỉ hash grant và Data Protection payload được lưu.
Không đổi lifetime mặc định 15 phút, password policy, email-confirmation eligibility,
single-use, revoke session/refresh-token, rate limit hay API response.

Không sửa transport/worker retry policy: provider chưa cấu hình giữ Pending và không tăng attempt;
lỗi SMTP transient dùng retry có giới hạn/backoff; outcome không rõ chuyển PendingReview để tránh
gửi lại thiếu kiểm soát. SMTP không có bảo đảm exactly-once; stable delivery key/Message-ID và
lease/recovery hiện có được giữ. Worker kiểm tra lại grant trước gửi; token không còn hiện hành
bị Suppressed. Không tự gia hạn token trong email chờ; người dùng có thể yêu cầu link mới.

Authentication-only worker khởi động khi có ít nhất một cặp callback hợp lệ hoặc SMS recovery
được bật. Không bật Jobs.Enabled hay NotificationChannels.AutomationEnabled để sửa recovery.
Không đổi các job hóa đơn, hợp đồng, thanh toán, BF-07 hoặc public frontend.

HTTP bỏ phụ thuộc thời gian phản hồi SMTP. Admission thêm một INSERT/savepoint rollback cho mỗi
identifier hợp lệ; các request không tồn tại cũng đi qua sink này. Không có phép đo p95/load hoặc
chứng minh constant-time trong lần kiểm thử; generic response không phải bảo đảm timing tuyệt đối.

## Cấu hình thành viên và deployment

Hướng dẫn cập nhật tại [AUTHENTICATION_EMAIL.md](../api/AUTHENTICATION_EMAIL.md).
Không cần migration hay package mới khi pull. SMTP/secret riêng không được copy qua Git.

Deployment owner cần kiểm tra:

- NotificationChannels.Enabled=true; ít nhất cặp reset callbacks và TrustedOrigins đúng deployment.
  AutomationEnabled có thể false. Web callback dùng HTTPS ở deployed environment;
  HTTP loopback chỉ Development. Native `bhome://reset-password` cần origin được allowlist
  và Web fallback hợp lệ. Invitation/verification cấu hình riêng nếu dùng.
- Gmail SMTP: Email.Enabled=true, Host=smtp.gmail.com, Port=587, UseStartTls=true;
  Username/FromEmail hợp lệ, AppPassword từ secret store. Sender phải được Gmail cho phép.
  MailKit hiện có bắt buộc STARTTLS, không hạ TLS/certificate validation.
- Các khóa Email được bind trực tiếp. Cấu hình NotificationChannels.Mode=Smtp cũ vẫn được
  chuyển sang Email nếu Email.Enabled=false như trước. Khi tạm tắt provider để queue,
  đặt Email.Enabled=false và NotificationChannels.Mode=Unconfigured; giữ channel Enabled=true.
- `.env` Development là fallback sau appsettings và trước User Secrets, process environment,
  command-line. Deployment dùng process secrets. Giá trị mới cần restart để nạp lại.
- Giữ Data Protection key ring bền vững/chia sẻ giữa các instance, đồng hồ đúng, worker chạy
  và PostgreSQL có quyền transaction/savepoint/ghi notifications và user reset grant như hiện có.

Không đọc/sửa secrets riêng, không chạy automated tests trên Neon và không gửi email thật.
Chưa triển khai/restart hoặc xác nhận runtime backend cổng 7240.

## Kiểm chứng

Máy Windows, .NET SDK 8.0.427, Node 22.23.5 tải vào thư mục temp riêng (SHA-256 kiểm tra
theo SHASUMS chính thức), PostgreSQL 16-alpine disposable ở loopback cổng 55432.
Không thay Node hệ thống. Build đúng hai image MinIO và contract converter trong CI.
PostgreSQL ghi statement để chạy kiểm tra Compact24 independence, tắt bind parameter logging.
TRX/log đặt ở temp, không commit.

Đã chạy đủ các lệnh tương đương workflow `.github/workflows/ci.yml` trên máy Windows;
chưa chạy GitHub Actions hoặc một Ubuntu runner mới. Kết quả cuối:

| Kiểm tra                                                                                                           | Kết quả thực chạy                                                                            |
| ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `dotnet restore src/backend/BHome.sln`                                                                             | PASS                                                                                         |
| Release build `--no-restore`                                                                                       | PASS, 0 warnings, 0 errors                                                                   |
| Docker build MinIO và contract converter                                                                           | Cả hai PASS                                                                                  |
| Toàn bộ backend: `dotnet test ... -c Release --no-build --settings tests/backend/ci.runsettings --logger trx -m:1` | Exit 0; **1.877 passed, 0 failed, 168 skipped**, tổng 2.045                                  |
| BHome.Application.UnitTests                                                                                        | 521 passed, 0 failed, 0 skipped                                                              |
| BHome.Domain.UnitTests                                                                                             | 114 passed, 0 failed, 0 skipped                                                              |
| BHome.Infrastructure.UnitTests                                                                                     | 34 passed, 0 failed, 0 skipped                                                               |
| BHome.IntegrationTests, PostgreSQL thực + Docker                                                                   | 1.167 passed, 0 failed, 26 skipped; 13 phút 30 giây                                          |
| BHome.PlanIntegrationTests                                                                                         | 0 passed, 0 failed, 142 skipped; cần API chạy và fixture nghiệp vụ bên ngoài                 |
| BHome.DigitalSigning.UnitTests trong solution                                                                      | 41 passed, 0 failed, 0 skipped                                                               |
| **20 regression cases mới** trong PasswordRecoveryRegressionTests                                                  | **20 passed, 0 failed, 0 skipped** trong full suite                                          |
| Toàn bộ Compact24NotificationMvpTests, gồm email/invitation/verification/SMS/worker                                | **84 passed, 0 failed, 0 skipped** trong full suite                                          |
| `dotnet format ... --verify-no-changes --no-restore`                                                               | PASS                                                                                         |
| `scripts/Test-SePaySandboxScripts.ps1`                                                                             | PASS: parsing, isolated synthetic profile, port/no-overwrite/ignored-output/Test-only guards |
| Digital signing chạy riêng theo workflow                                                                           | 41 passed, 0 failed, 0 skipped                                                               |
| Node 22 `npm ci --no-fund --no-audit`                                                                              | PASS; không thay package-lock                                                                |
| `npm run lint`                                                                                                     | PASS                                                                                         |
| `npm run typecheck --workspace ./src/mobile`                                                                       | PASS                                                                                         |
| `npm test`, VITE_API_BASE_URL=https://api.example.com và CI=true                                                   | Owner Web: 100 files, **658 passed**; Mobile: 119 files, **1.236 passed**; 0 failed/skipped  |
| `npm run build`, cùng VITE_API_BASE_URL                                                                            | PASS; warning chunk size hiện có, không có build error                                       |
| Mobile `expo export --platform web --max-workers 2 --output-dir dist`                                              | PASS, EXPO_NO_DOTENV=1, EXPO_PUBLIC_API_BASE_URL=https://api.example.invalid                 |
| `npm run format:check`                                                                                             | PASS sau format Markdown thuộc tác vụ                                                        |
| Hai `docker compose ... config --quiet` với `.env.example` và `.env.sepay.example`                                 | Cả hai PASS                                                                                  |
| `git diff --check`                                                                                                 | PASS                                                                                         |

Đếm skipped từ từng kết quả `UnitTestResult outcome=NotExecuted` và console, không từ thuộc tính
TRX Counters.notExecuted (logger ghi 0 dù có các test opt-in bị bỏ qua).
26 skipped trong integration là browser opt-in, Gmail thật và các bộ OCR model/artifact bổ sung.
142 skipped của PlanIntegrationTests là suite gọi API ngoài: API mặc định https://localhost:7240
không chạy trong môi trường test này, đồng thời thiếu các BHOME_IT_* fixture nghiệp vụ.
Không dựng hoặc trỏ suite này vào shared Neon để lấy số pass. Các filter QA/Report-5.2 hiện có
trong ci.runsettings được dùng nguyên trạng. Các skipped này không phải bằng chứng các luồng live
đã đạt; regression authentication cốt lõi chạy thực qua HTTP test host + PostgreSQL disposable.

TRX cuối được giữ trong `%TEMP%/bhome-auth-ci-results/full-backend/`; log frontend và build trong
`%TEMP%/bhome-auth-ci-*.log`. Bộ PostgreSQL disposable dùng riêng được dừng sau kiểm chứng;
không thay container/database triển khai của team.

Lượt test đầu phát hiện lỗi fixture mới: không dùng Owner được helper trả về và không khôi phục
email null sau một negative test, ảnh hưởng các test SMS dùng chung fixture. Đã sửa fixture,
chạy lại nhóm authentication/notification được 82 passed, 0 failed, 0 skipped trước khi thêm
hai case deferred-token cuối. Lượt build đầu cũng bắt tham số constructor không còn dùng;
đã loại bỏ. Formatting test mới và Markdown được sửa trong đúng file của tác vụ.

CI workflow và các điều kiện skip/filter hiện có được giữ nguyên. Không coi một test bị skip
hoặc chưa chạy là bằng chứng pass.
