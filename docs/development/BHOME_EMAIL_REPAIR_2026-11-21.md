# Khắc phục gửi email tài khoản ngày 21/11/2026

## Phạm vi và truy vết

Yêu cầu sửa gửi email trên localhost, Staging, Production → BF-02 / UC-08
(quản lý tài khoản Staff), JOB-04 (delivery/retry), GBR-01/02/13/18 theo
AGENTS.md và SRS thực tế trong `docs/reports/BHome_Report-3_Software Requirement Specification.docx`.
Luồng credential hiện có theo quyết định đã ghi tại [Email xác thực](../api/AUTHENTICATION_EMAIL.md).
Không thay đổi quyền, DTO, password generation, transaction, schema hoặc chính sách nghiệp vụ.

Thành phần liên quan: `AccountInvitations.IssueStaffPasswordAsync` →
`AuthenticationEmailDelivery` → protected notification outbox →
`NotificationAutomationWorker` / `NotificationChannelWorker` → `MailKitEmailSender`.
Acceptance: Owner cấp credential được queue; recipient bị chặn không đổi grant;
401/403 cho caller không đủ quyền; retry/idempotency và protected payload giữ nguyên;
SMTP thực xác thực và thư tổng hợp đến mailbox kiểm thử.

## Nguyên nhân được xác minh

| Môi trường | Nguyên nhân |
| --- | --- |
| Localhost | SMTP đã bật nhưng User Secrets giữ allowlist không chứa địa chỉ nhận trong yêu cầu; Backend trả `email_recipient_not_allowed` trước khi đổi mật khẩu. |
| Staging | Container hiệu lực có `Email__Enabled=false`, `NotificationChannels__Enabled=false`; chưa có cấu hình SMTP/allowlist ở API. Endpoint từ chối delivery với 503. |
| Production | File `compose.integrations.yml` đã bật email và có credential hợp lệ, nhưng file `compose.production-environment.yml` được nạp sau ghi đè cả hai cờ thành false. |

Đã kiểm tra STARTTLS/certificate và SMTP login từ VPS trước khi sửa: thành công.
Không phải lỗi mật khẩu Gmail hay lỗi giao diện. Health 200 đơn thuần không chứng minh email bật.

## Cấu hình đã áp dụng

- Localhost: dùng lại API User Secrets hiện có, chủ động bật
  `Email:AllowAnyRecipientInDevelopment=true`; giữ allowlist cũ và credential riêng tư.
  Khởi động lại API để nạp cấu hình.
- Staging: bổ sung SMTP vào private `compose.sepay-stage-api.yml`, bật email/channel;
  allowlist gồm mailbox kiểm thử theo yêu cầu và mailbox sender. Địa chỉ thử mới phải
  được người vận hành thêm vào private allowlist rồi recreate API; không bỏ kiểm tra này.
- Production: sửa các cờ trong private overlay được nạp cuối
  `compose.production-environment.yml`, không chỉ sửa integration file được nạp trước.
- Cả hai VPS: `Email__Enabled=true`, `DeliveryMode=Smtp`, STARTTLS=true,
  `NotificationChannels__Enabled=true`, Mode=Unconfigured.
  `NotificationChannels__AutomationEnabled=false`, `Jobs__Enabled=false` được giữ để
  chỉ bật worker xác thực hiện có, không bật publisher phát lại thông báo nghiệp vụ.
  Protected authentication outbox vẫn được worker xác thực riêng xử lý.
- Recreate đúng API với image hiện có, `--no-deps --no-build --pull never`;
  kiểm image ID, các biến môi trường ngoài email không đổi, readiness và release-safety.
  Không rebuild/redeploy frontend, đổi database, JWT, storage, SePay hoặc signing.

Sender SMTP được dùng lại từ cấu hình Production đã có, không tạo hoặc xuất secret mới;
Staging/Production hiện dùng cùng tài khoản Gmail, còn callback/recipient scope tách theo môi trường.
Nếu cần cô lập quota/credential SMTP giữa hai môi trường, cấp sender/App Password Staging
riêng qua secret store; đây không phải thay đổi đã được thực hiện trong lần sửa này.

Backup private trước khi sửa, root-only trên VPS:

- `/opt/bhome-backups/email-repair-staging-20261121T111909/`
- `/opt/bhome-backups/email-repair-production-20261121T112000/`

Rollback: khôi phục đúng private Compose file từ thư mục tương ứng, validate Compose,
recreate chỉ API bằng cùng danh sách overlay/environment file hiện có rồi kiểm readiness.
Các file private đang được release script hiện tại sử dụng, nên deploy ứng dụng tiếp theo
giữ cấu hình email này. Chạy `check-email.py` sau mỗi deploy hoặc thay cấu hình để phát hiện
overlay ghi đè; preflight này chưa được gắn thành gate tự động trong GitHub Actions.

## Thay đổi trong Git cho các thành viên

- `scripts/Configure-LocalGmail.ps1`: thêm `-UseExistingCredentials` và
  `-CheckOnly -Recipient`; không in/copy secret vào Git, không tự gửi thư.
- `tests/scripts/LocalGmail.Tests.ps1`: kiểm thử thiếu credential, recipient bị chặn,
  dùng lại credential, opt-in Development và giữ nguyên `.env`/secret khi bị từ chối.
- `deploy/vps/check-email.py` và `tests/scripts/test_email_preflight.py`: kiểm tra
  cấu hình hiệu lực/allowlist; tùy chọn kiểm STARTTLS/login, không gửi thư.
- Integration Compose example bổ sung delivery mode/timeout và lưu ý precedence;
  tài liệu nhóm phân biệt Mailpit mặc định với SMTP gửi ra mailbox thật.

Máy mới pull code vẫn dùng Mailpit theo mặc định. Muốn gửi Gmail thật, mỗi thành viên
phải cấu hình sender/App Password một lần bằng script tương tác; máy đã có credential dùng:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Configure-LocalGmail.ps1 -UseExistingCredentials -AllowAnyRecipient
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Configure-LocalGmail.ps1 -CheckOnly -Recipient 'your-approved-mailbox@example.com'
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Start-Api.ps1
```

Secrets không đi theo Git. Không thể cam kết máy chưa được cấp SMTP credentials gửi
ra Internet chỉ bằng pull code. Xem [hướng dẫn nhóm](BHOME_TEAM_ENVIRONMENT_SETUP.md#9-email-local-và-staging).

## Bằng chứng kiểm thử

| Kiểm tra đã chạy | Kết quả |
| --- | --- |
| `tests/scripts/LocalGmail.Tests.ps1` | PASS, credential tổng hợp và UserSecretsId tạm, không gửi email. |
| Python unittest `test_email_preflight.py` | 6/6 PASS, không mạng/secret thật. |
| `Test-Compact24Isolated.ps1` với `AuthenticationEmailTests`, `EmailTransportTests`, `EmailCaptureTests` | 45/45 PASS, PostgreSQL disposable; gồm cấp mật khẩu/đăng nhập/đổi mật khẩu Staff, 401/403, mã hóa outbox, dedup/retry và allowlist. |
| `GmailSmtpSmokeTests` opt-in với read-only IMAP | 1/1 PASS; API Development trên DB tạm gửi một email tổng hợp đến chính sender; SMTP accepted và đúng Message-ID có trong INBOX. |
| VPS preflight Staging và Production `--smtp` | PASS ở cả hai; TLS/certificate/login hợp lệ. |
| Thư tổng hợp tự gửi từ cấu hình Staging và Production | Mỗi môi trường một thư đến chính sender; SMTP accepted và exact Message-ID trong INBOX, không đọc thư khác. Đây là transport smoke, không gọi cấp lại mật khẩu Staff thật. |
| Readiness localhost và readiness nội bộ container Staging/Production; release-safety VPS | PASS. |
| Public ingress Staging/Production | `/health/ready` trả 404 đúng chính sách `smoke-release.sh`; issue-password không xác thực trả 401 ở cả ba môi trường. |
| Staging: đăng nhập Owner, xem channel-status, gọi issue-password với UUID không tồn tại | Login 200, channel enabled; 404 `staff_not_found` thay vì lỗi delivery 503, không đổi tài khoản thật. |

Evidence local ignored: `.tools/email-repair-20261121/tests/` và `gmail-smoke/`.
Không coi test với SMTP probe là bằng chứng thư thật; transport smoke/IMAP là bằng chứng riêng.
Không cấp lại mật khẩu tài khoản Staff thật để kiểm thử. Đăng nhập Owner localhost bằng
credential Staging không thành công; do đó chưa xác minh thao tác UI với phiên Owner
localhost hoặc Production. Bộ kiểm thử API đầy đủ chạy trên DB tạm như nêu trên.
Chưa chạy UI/E2E trên ba website và chưa kiểm chứng mọi nhà cung cấp mailbox ngoài Gmail.
Cấu hình private và secrets trên máy/VPS không nằm trong commit source.
