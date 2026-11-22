# Audit và bỏ Email Recipient Allowlist trong Development — 22/11/2026

## A. Audit ban đầu

Audit trên repository hiện tại, nhánh `member/QHuy`, baseline `2f3119d7`.
Working tree sạch trước khi sửa. Không clone/reset, không tích hợp nhánh khác trong tác vụ này.

Nguồn quyết định: yêu cầu trực tiếp ngày 22/11/2026 về chính sách email Development;
`AGENTS.md` về bảo mật và kiểm thử; tài liệu hiện hành
[Email xác thực](../api/AUTHENTICATION_EMAIL.md), [Gmail SMTP](../api/GMAIL_SMTP.md).
Truy vết theo AGENTS: BF-02 / UC-08 (Staff), BF-03/04 (Tenant và email hợp đồng),
JOB-04 (queue/delivery/retry), GBR-01/02/13/18 (quyền, bảo mật, idempotency).
Đây là thay đổi cấu hình kỹ thuật Development được người dùng yêu cầu;
không thay chính sách nghiệp vụ, cơ chế ký hay xác nhận thanh toán.

### Bằng chứng trước sửa

Số dòng trong bảng này thuộc baseline, không phải số dòng sau chỉnh sửa.

| Thành phần                     | File và dòng                                                                                                                                                                                                                                                     | Hành vi cũ                                                                                 |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Chính sách cấu hình/người nhận | `src/backend/BHome.Application/Notifications/EmailOptions.cs:30–47`                                                                                                                                                                                              | Development SMTP cần allowlist hoặc cờ mở; danh sách cũ vẫn được kiểm tra cú pháp.         |
| Startup validation             | `src/backend/BHome.Infrastructure/DependencyInjection.cs:154–161`                                                                                                                                                                                                | API có thể không khởi động nếu thiếu allowlist; hướng dẫn chạy script migration.           |
| Trước lời mời/cấp credential   | `src/backend/BHome.Infrastructure/IdentityAccess/AuthenticationEmailDelivery.cs:25–30`                                                                                                                                                                           | Kiểm tra allowlist trước thay grant/queue; có ngoại lệ cho tự động tạo Tenant Development. |
| Trước SMTP                     | `src/backend/BHome.Infrastructure/Modules/Notifications/MailKitEmailSender.cs:24–27`                                                                                                                                                                             | Chặn người nhận ngoài danh sách; có ngoại lệ theo event ký hợp đồng.                       |
| Tạo credential SMTP local      | `scripts/Configure-LocalGmail.ps1:72–96,121–179`                                                                                                                                                                                                                 | CheckOnly kiểm tra danh sách; script hỏi/lưu danh sách hoặc lưu cờ mở riêng.               |
| Migration local                | `scripts/Initialize-LocalEmail.ps1:44–56`                                                                                                                                                                                                                        | Tạo `AllowedRecipients:0` từ `TestRecipient` nếu chưa có.                                  |
| Onboarding                     | `.env.example:58`, `scripts/Initialize-TeamEnvironment.ps1:67`, `docs/development/BHOME_TEAM_ENVIRONMENT_SETUP.md:176–244`                                                                                                                                       | Hướng dẫn Development cần allowlist hoặc opt-in riêng.                                     |
| Regression cũ                  | `tests/backend/BHome.Infrastructure.UnitTests/EnvironmentConfigurationTests.cs:229–254`, `tests/backend/BHome.IntegrationTests/Notifications/EmailTransportTests.cs:17–35`, `tests/backend/BHome.IntegrationTests/Compact24/AuthenticationEmailTests.cs:131–154` | Bắt buộc opt-in/thiếu danh sách gây lỗi; chặn lời mời trước ghi grant/queue.               |

Có ba điểm thực thi: startup, kiểm tra trước lời mời/cấp credential, SMTP sender.
`QueueAsync` xác thực định dạng người nhận, tính sẵn sàng và transaction; worker gọi sender
chung. Không có allowlist độc lập trong queue. `TestRecipient` chỉ phục vụ endpoint thử email;
`AllowAnyDevelopmentSigningRecipient` là ngoại lệ cũ theo luồng, không phải chính sách chung.
Không tìm thấy cơ chế recipient whitelist khác trong source Backend/tools/scripts đã quét.
Client còn thông báo `email_recipient_not_allowed` để phục vụ môi trường vẫn có giới hạn.

### Code trong Git và cấu hình riêng máy

- `appsettings.json` có cấu hình email chung, mặc định tắt EMAIL; file Development không mở allowlist.
  `launchSettings.json` chọn Development. `.env.example` mặc định Mailpit Capture.
- Chỉ đọc các `.env` local và API User Secrets; không in địa chỉ cá nhân/password/key.
  User Secrets có SMTP, credential, hai phần tử allowlist và cờ mở Development đang bật.
  `.env`/`.env.local` có các cờ bật email/channel. Không có override email trong
  environment variables Process/User/Machine tại thời điểm audit.
- Máy này đã có cờ mở riêng nên không thể kết luận lỗi đang tái hiện ở mọi máy.
  Cơ chế gây chặn vẫn tồn tại trong source. Member thiếu cờ hoặc giữ danh sách khác vẫn bị chặn.
- `Start-Api.ps1` dùng loader Development; `Start-OcrMobile.ps1` không import `Email__*`
  thành process override; Prepare/Mobile không đồng bộ đè Email User Secrets.
  Không thấy launcher tự tạo allowlist. Script migration cũ có thể tạo danh sách khi chạy thủ công.
- Pull/merge không đồng bộ User Secrets. Trước bản sửa này, cờ local và danh sách cũ vẫn quyết định
  hành vi sau restart; process đang chạy cũng chưa nạp source/cấu hình mới cho đến khi restart.
  Đây là cơ chế tái diễn có bằng chứng, không phải xác nhận lịch sử thao tác trên máy member khác.

## B. Thay đổi thực tế

| Môi trường      | Trước                                                                            | Sau                                                                                                    |
| --------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Development     | Cần allowlist hoặc cờ mở; một số event có ngoại lệ riêng                         | Mọi email hợp lệ được qua kiểm tra người nhận. Danh sách/cờ cũ không giới hạn, không cần xóa thủ công. |
| Testing/Staging | SMTP cần danh sách hợp lệ; ngoài danh sách bị chặn                               | Giữ nguyên.                                                                                            |
| Production      | Danh sách trống cho mọi người nhận; danh sách có phần tử giới hạn theo danh sách | Giữ nguyên. Không chỉnh deployment.                                                                    |

`EmailOptions` tập trung chính sách theo environment, gồm validation startup và người nhận.
Lời mời và SMTP sender dùng cùng chính sách; bỏ ngoại lệ riêng theo loại email trong hai nơi này.
Giữ property/parameter cũ để nhận được cấu hình/caller cũ; không cần bật chúng trong Development.
Cờ Development-only vẫn không được phép bật tại Testing/Staging/Production như trước.

`Configure-LocalGmail.ps1` vẫn yêu cầu chọn SMTP rõ ràng, credential riêng và STARTTLS;
không hỏi/tạo allowlist, không ghi cờ mở riêng. Giữ các khóa cũ và credential không liên quan;
endpoint thử email tắt mặc định. `Initialize-LocalEmail.ps1` là lệnh tương thích không ghi cấu hình.
Sửa hướng dẫn hiện hành; các báo cáo lịch sử được chú thích là đã có chính sách mới thay thế.

Giữ nguyên: xác thực định dạng mailbox/header injection, SMTP auth và TLS/certificate validation,
loopback-only Capture, timeout, authorization/Location scope, rate limiting, token một lần/hết hạn,
protected outbox, kiểm tra lại điều kiện trước gửi, retry/lease/idempotency và phản hồi recovery
chống lộ tài khoản. Không chỉnh database làm việc, migration, dữ liệu nghiệp vụ hoặc credential thật.

### Danh sách file thay đổi dự kiến đưa vào commit

```text
.env.example
docs/api/GMAIL_SMTP.md
docs/development/BHOME_EMAIL_RECIPIENT_POLICY_2026-11-22.md
docs/development/BHOME_EMAIL_REPAIR_2026-11-21.md
docs/development/BHOME_ENVIRONMENT_VALIDATION.md
docs/development/BHOME_TEAM_ENVIRONMENT_SETUP.md
scripts/Configure-LocalGmail.ps1
scripts/Initialize-LocalEmail.ps1
scripts/Initialize-TeamEnvironment.ps1
src/backend/BHome.Application/Notifications/EmailOptions.cs
src/backend/BHome.Infrastructure/DependencyInjection.cs
src/backend/BHome.Infrastructure/IdentityAccess/AuthenticationEmailDelivery.cs
src/backend/BHome.Infrastructure/Modules/Notifications/MailKitEmailSender.cs
tests/backend/BHome.Infrastructure.UnitTests/EnvironmentConfigurationTests.cs
tests/backend/BHome.IntegrationTests/Compact24/AuthenticationEmailTests.cs
tests/backend/BHome.IntegrationTests/Compact24/MailpitEmailTests.cs
tests/backend/BHome.IntegrationTests/Notifications/EmailCaptureTests.cs
tests/backend/BHome.IntegrationTests/Notifications/EmailTransportTests.cs
tests/scripts/LocalEmail.Tests.ps1
tests/scripts/LocalGmail.Tests.ps1
```

## C. Kiểm thử

Chỉ dùng dữ liệu tổng hợp, fake provider, SMTP loopback hoặc Mailpit riêng.
Integration dùng PostgreSQL container tạm và database do fixture tạo/hủy;
không dùng connection string/database làm việc. Mailpit không cấu hình relay ra Internet.
Container test được dọn sau chạy. Không chạy smoke gửi Gmail thật.

| Kiểm tra thực thi                               | Passed | Failed | Skipped |
| ----------------------------------------------- | -----: | -----: | ------: |
| `EnvironmentConfigurationTests`                 |     39 |      0 |       0 |
| `NotificationEmailPolicyTests`                  |     11 |      0 |       0 |
| `EmailTemplateTests`                            |     16 |      0 |       0 |
| Integration email/notification/startup/recovery |    174 |      0 |       1 |
| Integration OTP/ký hợp đồng hiện có             |     13 |      0 |       0 |
| Preflight Staging/Production Python             |      6 |      0 |       0 |

Integration bỏ qua đúng một browser E2E cần opt-in `BHOME_RUN_EMAIL_BROWSER_E2E=true`.
Test Mailpit/worker thực tế đã chạy, không bị skip. Regression mới kiểm tra Development với
danh sách cũ, thiếu danh sách, cờ mở false/true, entry allowlist lỗi thời; địa chỉ sai vẫn bị từ chối;
SMTP thiếu credential vẫn không gửi. Direct SMTP test dùng cổng loopback đóng để chứng minh
đã qua kiểm tra người nhận, không coi lỗi kết nối là gửi thành công.
Staging/Production kiểm tra cả người nhận trong/ngoài danh sách và không nới chính sách cũ.

Worker thực nhận email tại Mailpit cho lời mời, credential Staff, xác nhận email Tenant,
notification ngoài danh sách cũ; gọi lặp/song song vẫn chỉ gửi một lần.
Tenant invitation và reset Development dùng fake provider, kiểm tra token một lần,
không lộ tài khoản, grant được bảo vệ và revoke session.
13 test OTP/ký hợp đồng hiện có cũng đạt với fake provider, gồm Owner/Tenant ký,
giữ bằng chứng/chữ ký PDF và điều kiện trước kích hoạt. Không sửa cơ chế ký hiện tại.
Tổng .NET: 253 Passed, 0 Failed, 1 Skipped; Python: 6 Passed, 0 Failed, 0 Skipped.

Các lệnh đã chạy:

```powershell
dotnet build src/backend/BHome.CI.slnf --no-restore --verbosity minimal
dotnet test tests/backend/BHome.Infrastructure.UnitTests/BHome.Infrastructure.UnitTests.csproj --no-build --no-restore --filter FullyQualifiedName~EnvironmentConfigurationTests
dotnet test tests/backend/BHome.Infrastructure.UnitTests/BHome.Infrastructure.UnitTests.csproj --no-build --no-restore --filter FullyQualifiedName~EmailTemplateTests
dotnet test tests/backend/BHome.Application.UnitTests/BHome.Application.UnitTests.csproj --no-build --no-restore --filter FullyQualifiedName~NotificationEmailPolicyTests
powershell -NoProfile -ExecutionPolicy Bypass -File tests/scripts/LocalGmail.Tests.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File tests/scripts/LocalEmail.Tests.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File tests/scripts/TeamEnvironment.Tests.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File tests/scripts/MobileDevelopment.Tests.ps1
.tools/yolo-python/python.exe -m unittest discover -s tests/scripts -p test_email_preflight.py
git diff --check
```

Build đạt 0 warnings/errors. Bốn script regression đạt; riêng Mobile ghi 105 assertions.
Đã parse bảy script email/API/Mobile không lỗi. Format whitespace lần đầu phát hiện initializer
test mới chưa đúng định dạng; đã sửa và chạy lại `dotnet format whitespace` với
`--verify-no-changes --no-restore --include` trên chín file C# thay đổi: đạt.

Lệnh integration dùng harness local `.tools/Run-EmailPolicyTests.ps1`: khởi tạo Mailpit
`axllent/mailpit:v1.27` với hai port loopback ngẫu nhiên, đặt `BHOME_MAILPIT_SMTP_PORT`/
`BHOME_MAILPIT_UI_PORT`, rồi gọi:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Test-Compact24Isolated.ps1 -Filter 'FullyQualifiedName~Compact24NotificationMvpTests|FullyQualifiedName~EmailTransportTests|FullyQualifiedName~EmailCaptureTests|FullyQualifiedName~EnvironmentStartupTests|FullyQualifiedName~EmailVerificationTests|FullyQualifiedName~PasswordRecovery' -ResultsDirectory .tools/email-policy-results
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Test-Compact24Isolated.ps1 -Filter 'FullyQualifiedName~AnonymousSigningTests|FullyQualifiedName~OwnerThenTenantSignWithEmailedOtp|FullyQualifiedName~OwnerSessionThenTenantOtp' -ResultsDirectory .tools/email-policy-results
```

TRX/log thực thi nằm trong `.tools/email-policy-results/`, `email-policy-build.log`,
`email-policy-integration.log`, `email-policy-format-final.log` (đều bị Git ignore).
Lượt ký dùng harness tương tự `.tools/Run-EmailPolicySigningTests.ps1` và log
`.tools/email-policy-signing.log`; cả hai lượt đã dọn container riêng.
Harness chỉ phục vụ phiên kiểm thử; test source và runner PostgreSQL dùng chung nằm trong Git.

## D. Git và cấu hình liên thành viên

Kiểm tra CI bổ sung theo `.github/workflows/ci.yml`: build toàn bộ
`src/backend/BHome.sln -c Release --no-restore` đạt, 0 warnings/errors;
`dotnet format src/backend/BHome.sln --verify-no-changes --no-restore` đạt.
Prettier toàn repository phát hiện ba Markdown chưa đúng định dạng: báo cáo này,
`BHOME_EMAIL_REPAIR_2026-11-21.md`, `BHOME_ENVIRONMENT_VALIDATION.md`.
Đã chuẩn hóa ba file bằng Prettier; không đổi logic email.
Chạy lại Prettier và ESLint toàn repository: đạt, exit 0.
Regression liên quan chạy lại ở Release với `tests/backend/ci.runsettings`:
253 Passed, 0 Failed, 1 Skipped (browser E2E chưa opt-in), gồm 187 integration tests đạt.
Kết quả nằm trong `.tools/email-ci-results/`, log `.tools/email-ci-*.log`.
Hai lệnh `docker compose ... config --quiet` của CI cho `.env.example` và
`deploy/compose.sepay.yml` đều đạt. Hai script regression email local chạy lại đều đạt.
Đây là các bước CI liên quan đã chạy local trên Windows; chưa chạy toàn workflow
GitHub Actions trên Ubuntu, frontend E2E/build/export hoặc build image phát hành trong phiên kiểm tra này.

- Nhánh `member/QHuy`; chưa stage/commit/push/merge trong tác vụ này.
- Commit message đề xuất: `fix(email): remove recipient allowlist restrictions in Development`.
- `.gitignore` giữ `.env`, `.env.*`, User Secrets, `.tools` ngoài Git; chỉ sửa `.env.example`.
- So sánh hash 12 file cấu hình local/User Secrets trước và sau: không đổi.
- Quét các dòng diff thêm mới đối chiếu giá trị credential riêng trên máy: không phát hiện
  credential thật. `.env` thật và `secrets.json` không được Git track.
- `.env.staging.example`, `.env.production.example`, deployment preflight và test preflight
  không có diff; không truy cập hay sửa Staging/Production thật.

Sau khi commit được review/tích hợp rồi member pull: rebuild và restart Backend/phiên debug;
launcher Mobile dùng Backend đã restart. Không cần thêm/xóa allowlist hay bật cờ riêng.
Máy dùng Capture tiếp tục xem thư ở Mailpit. Máy muốn SMTP thật vẫn phải tự cấu hình
credential riêng và chọn `DeliveryMode=Smtp`. Không tự phát lại email thất bại cũ hoặc sửa queue.

## E. Kết luận nghiệm thu và giới hạn

1. Development bỏ giới hạn người nhận theo allowlist ở startup, trước lời mời và sender chung.
2. Không cần mở khóa riêng trên máy; allowlist/cờ cũ không chặn người nhận Development.
3. Credential SMTP vẫn thuộc từng member; không đồng bộ qua Git.
4. Testing/Staging/Production giữ chính sách cũ; không đổi triển khai ngoài phạm vi.
5. Source và regression test được chuẩn bị để đồng bộ qua commit; member pull commit đã
   tích hợp, rebuild/restart sẽ dùng logic mới. Chưa có xác minh trên máy member khác.

Chưa xác nhận Gmail Internet/inbox thật, browser E2E được opt-in, thao tác trên thiết bị Mobile thật
hoặc restart debugger đang chạy của người dùng. Không khẳng định mọi member đã hết lỗi;
SMTP credential/network và việc restart đúng process vẫn phải được kiểm tra tại từng máy.
