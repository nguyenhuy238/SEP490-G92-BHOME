# Bỏ giới hạn người nhận email ở mọi môi trường — 23/11/2026

Yêu cầu trực tiếp của người dùng ngày 23/11/2026 thay chính sách thử nghiệm cũ:
Owner không cần thêm email Staff/Tenant vào danh sách người nhận trên bất kỳ môi trường nào.
Truy vết: BF-02 / UC-08, luồng tài khoản đã ghi tại
[Email xác thực](../api/AUTHENTICATION_EMAIL.md), JOB-04, GBR-01/02/13/18 theo AGENTS.md.
Không đổi quyền Owner/Staff/Tenant, hợp đồng, tài chính, schema hay provider.

## Vì sao merge develop vẫn lỗi

Commit `a0a3711e` chỉ bỏ allowlist trong Development. `EmailOptions` vẫn yêu cầu
danh sách trong Staging/Testing, đồng thời kiểm tra mọi danh sách không trống ở Production.
Staging đã chạy image từ `ceab7ce2` (merge #157), đúng phiên bản develop đó;
private Compose vẫn inject các khóa danh sách cũ. Đây là chính sách vẫn còn trong
code và cấu hình triển khai, không phải lỗi browser cache hay chưa merge.

## Thay đổi dùng chung

- `EmailOptions`: mọi môi trường chấp nhận địa chỉ email hợp lệ; không kiểm tra
  danh sách hoặc cờ opt-in. Các property/method cấu hình cũ chỉ còn để tương thích,
  không có tác dụng giới hạn, kể cả dữ liệu danh sách cũ không hợp lệ.
- Startup bỏ validator yêu cầu danh sách/cờ mở; chỉ xác thực transport, credential,
  TLS, sender, timeout và phạm vi Capture loopback.
- `AuthenticationEmailDelivery` kiểm tra cú pháp email trước khi thay credential/grant;
  `MailKitEmailSender` giữ kiểm tra cú pháp một mailbox, bỏ chặn theo danh sách.
- Công cụ preflight VPS không yêu cầu danh sách; `--recipient` chỉ kiểm tra cú pháp cơ bản.
  CI chạy test preflight để không vô tình tái áp đặt giới hạn khi deploy.
- `.env.staging.example`, integration Compose example và hướng dẫn nhóm không yêu cầu
  thêm người nhận. Thông báo Owner Web giữ xử lý email sai định dạng thay cho lỗi allowlist.

Không bỏ CORS/Host/trusted-origin allowlist: đó là kiểm soát bảo mật khác với giới hạn
người nhận email. Request gửi credential vẫn cần Owner, protected outbox và worker;
API không trả mật khẩu cho Owner. Retry/deduplication, revoke sessions và audit giữ nguyên.

## Khi các thành viên pull code

Rebuild và restart Backend sau khi tích hợp thay đổi này. Không cần mở khóa, thêm người
nhận hoặc xóa User Secrets/.env cũ. Khóa `Email:AllowedRecipients`,
`AllowAnyRecipientInDevelopment`, `AllowAnyDevelopmentSigningRecipient` cũ được bỏ qua.
Gmail SMTP vẫn cần credential hợp lệ riêng; secret không được đưa vào Git.
Mailpit mặc định chỉ thu thư local, không tự forward vào hộp thư Internet.

Thư đã `Sent`, `PermanentlyFailed` hoặc `PendingReview` không tự đổi trạng thái/gửi lại;
dùng thao tác gửi mới được nghiệp vụ cho phép. Không sửa queue bằng SQL để phát lại.

## Kiểm chứng

Các test hồi quy bao gồm startup với thiếu danh sách/danh sách sai/cờ cũ ở cả bốn
môi trường, cấp mật khẩu Staff và lời mời tới email ngoài danh sách cũ, 401/403,
deduplication, đăng nhập bằng credential được worker gửi và chặn email sai định dạng.
Kết quả cuối và tình trạng VPS được ghi sau kiểm tra thực tế, không coi HTTP 200 health
là bằng chứng gửi email hoặc coi SMTP accepted là bằng chứng vào Inbox.

Đã thực thi:

- `EnvironmentConfigurationTests`: 45/45 đạt.
- `EmailTransportTests`, `EmailCaptureTests`: 71/71 đạt; test startup không còn
  yêu cầu danh sách trong cả bốn môi trường và sender vẫn chặn địa chỉ sai định dạng.
- Tám trường hợp mới `OwnerInvitationIgnoresLegacyAllowlist...` và
  `OwnerIssuesStaffPasswordOutsideLegacyList...`: đạt ở Development/Testing/Staging/Production.
- `InvalidStaffEmailDoesNotChangePasswordOrQueueCredentials`: 1/1 đạt; email sai
  trả 400 và giữ password hash, không thêm protected credential outbox.
- `test_email_preflight.py`: 7/7 đạt; các script `LocalGmail.Tests.ps1`,
  `LocalEmail.Tests.ps1` đều đạt, không đổi credential thật.
- Owner Web `StaffApiPage.test.tsx`: 14/14 đạt; typecheck và lint file sửa đạt.
- Build Release toàn solution: 0 lỗi, 0 cảnh báo; `dotnet format` và Prettier file sửa đạt.
- Cả hai Compose validation và test Node về ranh giới bộ test CI đạt.

Lượt rộng đầu tiên `Compact24NotificationMvpTests`: 112 đạt, 4 skip opt-in và
1 lỗi 401 trong `HouseholdCrudIsEncryptedVersionedIdempotentCapacityCheckedAndTenantScoped`
tại bước xóa thành viên sau hủy Contract. Chạy riêng bài đó cùng tám test mới: 9/9 đạt.
Chạy lại toàn bộ nhóm trên PostgreSQL tạm mới: **113 đạt, 4 skip opt-in, 0 lỗi**.
Không đổi quyền hoặc code Household để làm xanh test. Bộ lọc theo tên file
`AuthenticationEmailTests` không chọn được các phương thức trong partial class;
kết quả cấp credential ở trên được xác minh bằng tên phương thức/class thực tế.

Lỗi trong quá trình chuẩn bị kiểm thử đã được sửa và chạy lại: fixture startup
Development ban đầu đặt origin HTTPS không khớp callback localhost (hai test lỗi);
đã dùng origin theo môi trường, nhóm transport/startup đạt 71/71. Lần build test email
sai định dạng trùng thời điểm một suite khác giữ DLL gặp MSB3021/MSB3027; chạy tuần tự
sau khi suite kết thúc đạt 1/1. Đây không phải các lượt PASS bị bỏ qua khỏi báo cáo.

## Áp dụng VPS

Đã thay API Staging và Production bằng source hotfix trên **đúng baseline image đang chạy**,
chỉ thay `EmailOptions.cs` dùng chung; không triển khai commit tính năng Public Web đang có
trên nhánh local. Các call site cũ dùng compatibility methods đã trở thành no-op/kiểm tra
cú pháp, nên không còn chặn người nhận hợp lệ. Source đầy đủ trong nhánh còn dọn validator,
call site, thông báo giao diện và tài liệu cho các lần release sau.

- Staging baseline: `ceab7ce2fa7f58101cb5f00014d4f9bfeba4cf4c`.
  Image vận hành: `bhome/email-no-allowlist-staging:20261123t042634`.
- Production baseline: `70406ecf8dceea6e84e4ddbaa3e325807af123f2`.
  Image vận hành: `bhome/email-no-allowlist-production:20261123t043142`.
- Xóa recipient keys trong private Compose và xác minh môi trường container không còn
  `Email__AllowedRecipients*`/cờ mở cũ. Giữ nguyên các cấu hình khác và volume dữ liệu.
- Recreate chỉ API; readiness nội bộ, release-safety và 401 cho request anonymous đạt.
  Đăng nhập Owner Staging 200, channel-status enabled; preflight user không tồn tại trả
  404 `staff_not_found`, không phải lỗi delivery 503.
- Probe nạp chính DLL trong từng image xác minh danh sách thiếu/cũ/sai và cờ true/false
  không chặn mailbox hợp lệ ở cả bốn host environment; email sai cú pháp vẫn bị chặn.
- Runtime MailKit trong từng image gửi **một thư tổng hợp đến chính sender** dù probe
  mô phỏng danh sách cũ khác mailbox nhận. Cả Staging và Production SMTP accepted và
  exact Message-ID được xác nhận trong Gmail INBOX bằng IMAP read-only.
- Không cấp lại mật khẩu hoặc gửi credential Staff thật để kiểm thử. Không xác nhận
  hộp thư cá nhân trong ảnh đã nhận thư; Owner có thể dùng thao tác gửi mới trên giao diện.

Backup/provenance root-only tại VPS:

- `/opt/bhome-backups/email-no-allowlist-staging-20261123T042634/`
- `/opt/bhome-backups/email-no-allowlist-production-20261123T043142/`

`current.json` của từng môi trường ghi image API mới và `operatorHotfixes` (baseline SHA,
hash source, image ID, evidence). Đây là hotfix vận hành, không giả là release từ GitHub Actions.
Rollback dùng private Compose/manifest backup đúng môi trường rồi recreate chỉ API và
kiểm readiness. Không reset queue, đổi schema, khóa JWT/Data Protection hoặc cấu hình SePay.

Source mới phải được tích hợp vào develop/main trước release kế tiếp; release từ source
cũ chưa chứa bản sửa có thể tái áp chính sách cũ. Máy thành viên cần pull **bản sửa 23/11**
rồi rebuild/restart, không chỉ commit Development ngày 22/11.
Evidence local ignored tại `.tools/email-no-allowlist-20261123/`.
