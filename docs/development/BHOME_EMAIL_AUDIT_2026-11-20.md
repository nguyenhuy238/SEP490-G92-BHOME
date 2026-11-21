# Audit và hoàn thiện email BHOME — 20/11/2026

## A. Kiểm kê trước thay đổi

Baseline: `member/QHuy`, `d048cec7`, working tree sạch. Không pull/merge/reset,
không sửa `.env`, secrets, DNS, VPS hoặc dữ liệu thật trong công việc email.
Nguồn quyết định mới nhất: yêu cầu người dùng đính kèm ngày 20/11/2026;
`BHOME_ACCESS_LINKS_NOTE.md`, `BHOME_TEAM_ENVIRONMENT_SETUP.md`,
`BHOME_ENVIRONMENT_VALIDATION.md`, `AUTHENTICATION_EMAIL_IMPLEMENTATION.md`,
`docs/api/AUTHENTICATION_EMAIL.md` và source/test hiện tại. Tài liệu cũ nói không
gửi mật khẩu dạng rõ chưa phản ánh endpoint cấp mật khẩu Staff đã tồn tại.

| Loại email                                | Trigger thực tế                                                  | Backend service                                                                     | Người nhận                                         | Template hiện tại                                          | Link/Action                                     | Trạng thái trước sửa                                                        |
| ----------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------- |
| Cấp lại mật khẩu Staff                    | Owner POST `staff/{id}/issue-password`, Staff đã xác nhận email  | AccountInvitations → AuthenticationEmailDelivery                                    | Staff đang active                                  | EmailTemplate chung, text chứa mật khẩu 12 ký tự           | Mở app thủ công                                 | Đã triển khai; protected outbox, cooldown, revoke session; cần UX tốt hơn   |
| Staff mới                                 | Owner POST `staff`                                               | CompactOperationsRepository                                                         | Chưa gửi email khi tạo trong baseline              | Không có email credential tự động                          | Đang được member khác cập nhật                  | Ngoài phạm vi sửa theo xác nhận người dùng: member khác xử lý tạo là active |
| Invitation Staff cũ                       | Owner POST `staff/{id}/invitation`                               | AccountInvitations                                                                  | Staff chưa setup; Staff đã setup nhận reset        | EmailTemplate chung                                        | Web fragment + custom scheme ở body             | Đã triển khai; URL/token dài lặp lại                                        |
| Invitation Tenant                         | Active Main tenancy + Owner/job phê duyệt; không áp dụng Holding | PostActivationTenantProvisioning, AccountInvitationJob, AccountInvitations          | Tenant đại diện; co-occupant theo thao tác hiện có | EmailTemplate chung; Main có PDF xác thực khi đủ điều kiện | Web setup + custom scheme                       | Đã triển khai; giữ điều kiện hợp đồng/tài khoản và attachments              |
| Reset mật khẩu                            | Anonymous request, account đủ điều kiện                          | IdentityPasswordService, AuthenticationEmailDelivery                                | Mailbox đã lưu                                     | EmailTemplate chung                                        | Token Identity + grant hash, một lần, có expiry | Đã triển khai; generic 202, cooldown; UX URL dài                            |
| Xác nhận email                            | Anonymous request                                                | EmailVerificationService, AuthenticationEmailDelivery                               | Mailbox đã lưu                                     | EmailTemplate chung                                        | Token Identity + grant riêng                    | Đã triển khai; UX URL dài                                                   |
| Bảo mật tài khoản                         | Audit đổi/reset mật khẩu, khóa, kích hoạt/vô hiệu hóa/quyền      | CompactNotificationEvents → NotificationChannelWorker                               | Account liên quan                                  | Title/summary chung                                        | Mở BHOME                                        | Đã triển khai, giữ inbox khi SMTP lỗi                                       |
| Phân công Staff                           | Tạo/sửa/hủy/thay người phụ trách và job bắt đầu/kết thúc         | CompactAssignmentsRepository, AssignmentReconciliationJob, NotificationEmailContent | Staff cũ/mới liên quan                             | Thông tin phân công + portal nếu đã cấu hình               | StaffPortalUrl trusted, tùy chọn                | Đã triển khai; không được tự đoán URL Staff                                 |
| Ký hợp đồng / OTP                         | Owner gửi lời mời, signer yêu cầu mã                             | AnonymousContractSigningService → AnonymousSigningSecurity                          | Email signer được xác minh theo workflow hiện có   | Generic; URL nằm trong text                                | HTTPS signing fragment; fallback mã thủ công    | Đã triển khai; cần CTA, không đổi phương thức hoặc trạng thái ký            |
| Xác nhận giữ chỗ                          | Audit activation đã commit, ký và tiền đủ điều kiện              | CompactNotificationEvents, NotificationEmailContent                                 | Email signer không cần account                     | HTML chung + PDF hợp đồng/biên nhận                        | Attachments                                     | Đã triển khai; giữ subject và bằng chứng hiện có                            |
| Xác nhận Main hoạt động                   | Activation đã commit, điều kiện tài chính backend đủ             | NotificationEmailContent / Tenant invitation                                        | Tenant hợp lệ                                      | HTML chung + PDF                                           | Setup nếu chưa kích hoạt account                | Đã triển khai; giữ phép kiểm tra và tránh thư trùng                         |
| Hóa đơn/công nợ/thanh toán                | Finalized, due, overdue, partial/full verified payment           | NotificationEventPublisher, NotificationEmailContent                                | Tenant theo phạm vi backend                        | HTML chung, dữ liệu kỳ và phòng                            | Mở BHOME                                        | Đã triển khai; không sửa balance/status/financial jobs                      |
| Hết hạn hợp đồng, khẩn cấp, vận hành khác | Domain events/reminders hiện có                                  | NotificationEmailContent, NotificationChannelWorker                                 | Owner/Staff/Tenant được phép                       | HTML chung                                                 | Mở BHOME                                        | Đã triển khai; phải recheck scope và relevance trước gửi                    |
| Kiểm tra SMTP                             | Development Owner, TestEnabled                                   | DevelopmentEmailTest                                                                | TestRecipient đã cấu hình                          | HTML chung                                                 | Không                                           | Opt-in, không chạy với mailbox thật trong lượt này                          |

Trạng thái trên dựa trên source, chưa thay thế bằng chứng SMTP nhận thư.

## B. Vấn đề và phạm vi sửa

- HTML in nguyên URL/token sau CTA và lặp custom scheme trong body. Tách action
  khỏi nội dung hiển thị, giữ nguyên token, fragment, one-use và expiry.
- Template chung hiện CTA trước lời chào, nội dung dài, thiếu footer nhất quán.
  Hoàn thiện layout xanh BHOME, table/inline CSS, fallback plain text.
- Staff password được sinh CSPRNG đúng 12 ký tự, chỉ hash trong User; mật khẩu
  phải tồn tại trong envelope Data Protection để retry đúng giá trị, không nằm
  dạng rõ trong audit/inbox/outbox. Đây vẫn là rủi ro của nghiệp vụ gửi mật khẩu.
- Worker đã có row lock, lease, durable idempotency key, retry bounded và
  PendingReview khi SMTP có kết quả không rõ. SMTP không cung cấp exactly-once;
  không tuyên bố Message-ID tự chống trùng ở provider.
- Test SMTP thật phát hiện connection refused (`SocketException`) bị phân loại
  `email_unexpected_failure` và chuyển PermanentlyFailed ngay. Bổ sung phân loại
  socket lỗi trước gửi là retryable; socket lỗi sau khi bắt đầu gửi vẫn phải
  PendingReview. Không thay số lần retry hoặc quy tắc chống trùng.
- Key ring Data Protection phải tồn tại qua restart và được bảo vệ giữa các
  instance. Source deployment chưa chứng minh mount/key protection; đây là điều
  kiện nghiệm thu production, không tự thay khóa hoặc cấu hình triển khai thật.

Truy vết: BF-02/UC-08..12, luồng xác thực hiện có; BF-03/04/GBR-04,
BF-05/06/GBR-10, BF-07/GBR-11/12, FE-07/JOB-04/GBR-13/18.
Thay đổi chỉ ở nội dung/transport email và luồng cấp Staff đã được người dùng
quyết định; giữ phân quyền, tài chính, hợp đồng, Tenant và invitation tương thích.
Người dùng xác nhận member khác đang sửa tạo/kích hoạt Staff theo hướng tạo là
active: không sửa repository/service/UI tạo Staff hoặc điều kiện kích hoạt trong
lượt này. Kiểm thử credential dùng endpoint cấp mật khẩu đã tồn tại; kiểm thử tạo
Staff tự động sẽ cần chạy lại sau khi tích hợp thay đổi của member đó.

Tiêu chí kiểm thử: render/escaping/missing variables/URL scheme; MIME HTML + text;
SMTP loopback nhận thư; credentials login/change/revoke; rollback queue;
retry giữ password/key, concurrent claim gửi một lần, stale/expired suppress;
invitation cũ validate/accept/reuse/expiry; frontend/mobile callbacks và build.

## C. Thay đổi đã thực hiện

| File/nhóm file                                                                                      | Trước → sau và lý do                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BHome.Infrastructure/Modules/Notifications/EmailTemplate.cs`                                       | Layout v2 580px, header/footer xanh BHOME, lời chào trước CTA, HTML encode từng biến, plain text, validation biến thiếu/URL scheme. HTML chỉ có nhãn CTA/fallback, không in token dài. Giữ subject Holding; không lặp tiền tố BHOME; subject credential Staff riêng.                                        |
| `BHome.Application/Notifications/NotificationChannels.cs`                                           | Bổ sung optional `MobileActionUrl` và `EmailCredentials` cho message nội bộ. `EmailCredentials.ToString()` redacted. Không đổi HTTP DTO hoặc serialize credential ra response.                                                                                                                              |
| `AuthenticationEmailDelivery.cs`, `NotificationChannelWorker.cs`                                    | Native action và credential đi riêng đến renderer thay vì nối vào body. Không đổi envelope protected, grant, expiry, eligibility, password generation/hash, queue, transaction hoặc Tenant activation. StaffPortalUrl chỉ tạo CTA khi đã được cấu hình và trusted; thiếu URL thì hướng dẫn mở app thủ công. |
| `MailKitEmailSender.cs`                                                                             | MIME dùng renderer HTML/text chung, attachments gốc giữ nguyên; classify `SocketException` theo giai đoạn trước/sau submit để retry đúng và không phát trùng trong tình huống bất định.                                                                                                                     |
| `AnonymousSigningContracts.cs`, `AnonymousSigningSecurity.cs`, `AnonymousContractSigningService.cs` | Optional action URL nội bộ, tất cả implementation/caller/mock được đối chiếu. URL ký chuyển từ body sang CTA; OTP vẫn ở nội dung, expiry hiển thị giờ Việt Nam. Giữ fallback mã thủ công khi không có URL và toàn bộ trạng thái/quy tắc ký hiện tại.                                                        |
| Tests template, transport, auth/email verification/reset, signing                                   | Kiểm tra vị trí action mới, MIME giữ nguyên token Web/native, escaping/missing variables, subject, socket retry; cập nhật assertions từ body sang action field mà không bỏ kiểm tra token equality/one-use/expiry.                                                                                          |
| `MailpitEmailTests.cs`, `Test-EmailInvitationBrowser.mjs`                                           | Test opt-in, loopback PostgreSQL/Mailpit thật; actual provider/outbox/login/change password; CTA tới Web thật và token scrub/reuse. Không dùng SMTP secrets hoặc cấu hình .env của ứng dụng.                                                                                                                |
| `docs/api/AUTHENTICATION_EMAIL.md`, `GMAIL_SMTP.md`, report và preview                              | Cập nhật đúng nội dung credential hiện có, template v2, cảnh báo vận hành và minh chứng tổng hợp.                                                                                                                                                                                                           |

Không sửa repository/service/UI tạo Staff, không thay `.env`, user-secrets,
configuration mẫu, DNS, VPS, certificate, CI/CD, migration hoặc dữ liệu thật.

## D. Kết quả kiểm thử

Môi trường: Windows, .NET SDK 8.0.427, Node 22. Các lượt email ban đầu dùng
PostgreSQL 18 disposable riêng có ICU `en-US`; lượt backend đầy đủ cuối dùng
Docker PostgreSQL 16 và các fixture MinIO/LibreOffice của repository.
Mailpit v1.27.10 tải từ release chính thức, chỉ bind loopback, không relay ra
Internet. Các fixture tạo/xóa database tổng hợp riêng, khác database làm việc
của người dùng. PostgreSQL 18 không thay thế bằng chứng PostgreSQL 16.

| Test                                              | Command/scenario                                                                                                                                                                                                                                      | Result                                                                                                                                              | Evidence                                                        |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Restore/build backend                             | `dotnet restore src/backend/BHome.sln`; `dotnet build src/backend/BHome.sln -c Release --no-restore`                                                                                                                                                  | PASS, 0 warning/error ở build chuẩn                                                                                                                 | `.tools/email-audit/build.log`, `build-final.log`               |
| Domain unit                                       | `dotnet test tests/backend/BHome.Domain.UnitTests/BHome.Domain.UnitTests.csproj -c Release --no-build --settings tests/backend/ci.runsettings`                                                                                                        | PASS 115                                                                                                                                            | Output thực thi                                                 |
| Application unit                                  | Cùng lệnh cho `BHome.Application.UnitTests`                                                                                                                                                                                                           | PASS 650, gồm signing callbacks                                                                                                                     | Output thực thi                                                 |
| Infrastructure unit                               | Cùng lệnh cho `BHome.Infrastructure.UnitTests`                                                                                                                                                                                                        | PASS 100, gồm template v2/URL/escaping                                                                                                              | `results/unit/*.trx`                                            |
| SMTP/Mailpit và transport                         | Filter `FullyQualifiedName~MailpitReceives\|FullyQualifiedName~MailpitInvitation\|FullyQualifiedName~EmailTransportTests`                                                                                                                             | PASS 45; Staff credential nhận thực tế, login/change/revoke, retry không sinh password mới, concurrent claims gửi một thư; invitation/reset một lần | `results/mailpit-fixed/*.trx`                                   |
| Hồi quy integration rộng                          | Filter `Category=CompactPostgres\|FullyQualifiedName~AnonymousSigningTests\|FullyQualifiedName~EmailTransportTests\|FullyQualifiedName~EmailCaptureTests\|FullyQualifiedName~EnvironmentStartupTests\|FullyQualifiedName~PersistenceCompositionTests` | Lượt đầu: 507 PASS, 1 FAIL, 2 SKIP; assertion cũ còn đọc native link từ body đã được sửa sang action field; lượt email cuối chạy lại ghi bên dưới   | `results/integration/*.trx`                                     |
| Owner Web/Mobile tests                            | `npm test -- --maxWorkers=2`                                                                                                                                                                                                                          | PASS 826 Owner Web + 1418 Mobile                                                                                                                    | `frontend-tests.log`; jsdom có cảnh báo canvas, runner vẫn PASS |
| Lint/typecheck                                    | `npm run lint`; `npm run typecheck --workspace ./src/owner-web`; tương tự Mobile                                                                                                                                                                      | PASS                                                                                                                                                | `frontend-checks.log`; script browser mới được eslint riêng     |
| Staging build                                     | `VITE_API_BASE_URL=https://api-staging.103.146.23.157.sslip.io`, `VITE_API_MODE=api`, `VITE_DEPLOYMENT_ENVIRONMENT=Staging`, `npm run build`                                                                                                          | PASS client-core/Owner/Public; có cảnh báo chunk lớn                                                                                                | `frontend-checks.log`                                           |
| Mobile Web export                                 | `EXPO_NO_DOTENV=1`, `EXPO_PUBLIC_API_BASE_URL` Staging, `expo export --platform web --max-workers 2 --output-dir ../../.tools/email-audit/mobile-web`                                                                                                 | PASS                                                                                                                                                | `mobile-export.log`                                             |
| Backend format                                    | `dotnet format src/backend/BHome.sln --verify-no-changes --no-restore`                                                                                                                                                                                | PASS sau sửa whitespace của test mới                                                                                                                | `backend-format-verified.log`                                   |
| Trình bày                                         | Renderer thật → Edge headless 900px/360px                                                                                                                                                                                                             | PASS không tràn ngang, đã mở kiểm tra 6 ảnh trước/sau                                                                                               | [Bằng chứng](../testing/email-2026-11-20/README.md)             |
| Gmail/Outlook native, Android/iPhone              | Không gửi tới mailbox thật hoặc dùng thiết bị thật                                                                                                                                                                                                    | NOT RUN                                                                                                                                             | Chỉ có SMTP capture và browser render                           |
| GitHub Actions                                    | Không push/workflow_dispatch                                                                                                                                                                                                                          | NOT RUN                                                                                                                                             | Không khẳng định GitHub CI PASS                                 |
| Docker PostgreSQL 16/MinIO/LibreOffice full suite | dotnet test src/backend/BHome.sln -c Release --no-build --settings tests/backend/ci.runsettings -m:1                                                                                                                                                  | Exit 0: 2.221 PASS, 0 FAIL, 170 SKIP; chi tiết dưới đây                                                                                             | full-backend.log; results/full-backend/*.trx                    |

Lượt backend đầy đủ cuối **exit code 0: 2.221 PASS, 0 FAIL, 170 SKIP**.
Command và fixture giữ nguyên CI, bổ sung opt-in Mailpit/browser. Kết quả theo
project từ TRX tại `.tools/email-audit/results/full-backend/`:

| Project                  |  PASS | FAIL | SKIP |
| ------------------------ | ----: | ---: | ---: |
| Application.UnitTests    |   650 |    0 |    0 |
| Domain.UnitTests         |   115 |    0 |    0 |
| Infrastructure.UnitTests |   100 |    0 |    0 |
| IntegrationTests         | 1.315 |    0 |   28 |
| PlanIntegrationTests     |     0 |    0 |  142 |
| DigitalSigning.UnitTests |    41 |    0 |    0 |

Ba test Mailpit mới, gồm browser CTA, đều **PASS trong lượt PostgreSQL 16**.
28 test integration SKIP là các opt-in OCR/model, Gmail/SMTP ngoài, browser khác
và kiểm tra độc lập schema. 142 PlanIntegration tests SKIP do chưa chuẩn bị API
hộp đen/tài khoản/dữ liệu theo cấu hình riêng hoặc là scenario thủ công đã có;
đó không phải 142 test PASS. Không dùng API/dữ liệu thật để lấp điều kiện này.
Các QA suites bị loại theo `ci.runsettings` hiện có cũng không được tính là đã
chạy. Chưa chạy GitHub Actions hoặc xác nhận độ bao phủ nghiệp vụ toàn hệ thống.

Lượt email tập trung cuối: **150/150 PASS, 0 SKIP**, filter
`FullyQualifiedName~Compact24NotificationMvpTests|FullyQualifiedName~EmailTransportTests|FullyQualifiedName~EmailCaptureTests`,
Release, `--settings tests/backend/ci.runsettings`, PostgreSQL 18 disposable.
TRX: `.tools/email-audit/results/email-verified/`. Bao gồm browser acceptance
bấm CTA từ MIME Mailpit trên viewport 390px, Web/API thật: setup thành công,
token đã scrub khỏi URL, reuse bị từ chối, login đúng credential mới. Test browser
riêng cũng PASS tại `results/browser-fixed/`. Không mock response API hoặc bỏ
validation production: HTTP loopback test chỉ dùng Development fixture.

Đã chạy thêm 5 test `FullyQualifiedName~IssueStaffPasswordAsync` của bộ
AccountProvisioning trên PostgreSQL 16 Testcontainers, **5/5 PASS** (không dùng
filter loại QA của CI trong lượt kiểm tra riêng này). Bao gồm rollback khi queue
lỗi, hash/password 12 ký tự, revoke session, cooldown, quyền và provider chưa sẵn
sàng. Không chạy hoặc sửa nghiệp vụ tạo Staff mới của member khác.
TRX: `.tools/email-audit/results/staff-password/`.

Digital signing unit suite riêng: **41/41 PASS** với
`dotnet test src/digital-signing/tests/BHome.DigitalSigning.UnitTests/BHome.DigitalSigning.UnitTests.csproj -c Release --settings tests/backend/ci.runsettings --logger trx`.
Evidence: `results/digital-signing/*.trx`, `digital-signing.log`.
Hai Compose profiles đều parse thành công bằng `config --quiet` với
`.env.example` và `.env.sepay.example`. `Test-SePaySandboxScripts.ps1` PASS khi
chạy bằng PowerShell với execution policy chỉ áp dụng cho process test; lượt gọi
trực tiếp ban đầu bị execution policy của máy chặn, không thay policy hệ thống.
Evidence: `sepay-scripts.log`. Không gọi API ngân hàng hoặc dùng credential thật.

Lượt đầu Mailpit thực phát hiện socket refused bị gán lỗi vĩnh viễn: test FAIL
rồi đã sửa và chạy lại PASS. Lỗi compile nullable/analyzer và whitespace của
test mới cũng đã được sửa trước các lượt PASS; không bỏ assertions để xanh.
Test browser ban đầu dùng nhầm environment Testing cho callback HTTP loopback
nên bị guard từ chối; fixture đã đổi về Development đúng quy ước. Selector exact
của password field cũng không khớp dấu required của MUI; sửa selector theo nhãn
mà không thay UI/logic validation, sau đó test đã PASS.
Lượt build vào một output folder thử nghiệm có 7 cảnh báo copy file đồng thời
(MSB3026) rồi thành công; build chuẩn dùng folder từng project không có cảnh báo.
Trong lượt hồi quy rộng ban đầu, hai test OCR thực SKIP vì thiếu opt-in/model
fixture, không thuộc email.

## E. Minh chứng email

[HTML và ảnh desktop/mobile trước–sau](../testing/email-2026-11-20/README.md)
được render bằng chính renderer baseline/candidate với dữ liệu ghi rõ DEMO ONLY.
Đây không phải chụp mailbox người thật và không chứa credential hoạt động.

Mailpit nhận MIME qua SMTP thật, tests đọc lại subject, sender, HTML, text và CTA.
Không đồng nhất `Sent` với inbox của Gmail/Outlook: trong test Mailpit đã xác minh
thư xuất hiện tại inbox capture; trong deployment `Sent` chỉ là SMTP accepted.

## F. Mức sẵn sàng

- **Ready for Development** trong phạm vi email đã kiểm thử: nhóm email tập trung
  150/150 PASS, backend đầy đủ 2.221 PASS/0 FAIL/170 SKIP, frontend/build/typecheck/
  format đã đạt. Các scenario SKIP vẫn chưa được kiểm chứng.
- **Ready for Staging:** candidate để review/triển khai có kiểm soát; chưa nghiệm
  thu inbox SMTP thật, link từ Gmail native, key ring qua restart hoặc thay đổi
  tạo Staff của member khác. Không khẳng định staging đã triển khai phiên bản này.
- **Ready for Production: chưa đạt.** Cần giải quyết các điều kiện tại mục G.

## G. Còn lại, triển khai và rollback

1. Tích hợp phần tạo/kích hoạt Staff của member phụ trách rồi chạy lại luồng tạo
   → queue email → nhận → login → Profile đổi mật khẩu. Bản sửa này chỉ kiểm thử
   endpoint cấp mật khẩu đã có và giữ tương thích invitation đang phát hành.
2. Kiểm tra key ring Data Protection bền vững/được bảo vệ, quyền file và chia sẻ
   đúng application identity giữa các instance. `Api.Release.Dockerfile` đặt
   `HOME=/home/app` nhưng source Compose được đọc chưa chứng minh volume/protection
   tương ứng. Recreate container mất key có thể làm token/outbox cũ không đọc được.
   Không tự xoay hoặc thay khóa production trong công việc này.
3. Xác minh sender thật và SPF/DKIM/DMARC tại domain gửi, TLS/SMTP credentials,
   allowlist Staging và các URL theo anchors hiện tại. Không có sender domain thật
   được phép kiểm chứng trong lượt này; không đoán bản ghi DNS. Không dùng ví dụ
   `.invalid` hoặc callback localhost cho Staging/Production.
4. StaffPortalUrl chỉ trỏ tới frontend Staff có thật và trusted; Owner Web login
   dành Owner. Khi chưa có URL phù hợp thì không hiển thị nút dẫn sai. Các trang
   Web accept/reset/confirm dùng được không cần cài app. Custom scheme `bhome`
   vẫn giữ, nhưng source `app.json` chưa cấu hình verified App Links/Universal
   Links; cần kiểm tra trên Gmail Android/iPhone và app build thật.
5. Mật khẩu Staff gửi qua email là rủi ro nghiệp vụ hiện có: mailbox bị truy cập
   có thể lộ credential. Không tự đổi quyết định; đề xuất chuyển về link đặt mật
   khẩu một lần hoặc OTP kích hoạt khi có phê duyệt. Outbox vẫn giữ envelope
   Data Protection để retry, không giữ password dạng rõ; không tuyên bố password
   chỉ tồn tại dưới dạng hash ở mọi nơi vì email delivery cần nội dung được bảo vệ.
6. SMTP không bảo đảm exactly-once. Sau `PendingReview` phải kiểm tra provider
   trước khi thao tác phục hồi; không tự reset lease để gửi lại. Retry an toàn
   chỉ áp dụng khi biết chưa submit. Không replay backlog hoặc regenerate password
   hàng loạt khi release/rollback.
7. Deploy code qua quy trình PR/review/CI chuẩn, không có migration hoặc đổi config
   bắt buộc cho template. Rollback bằng image code trước; giữ DB/outbox/key ring,
   các URL cũ và grant đã phát hành. Optional fields chỉ trong message runtime,
   format envelope protected không đổi. Email đã gửi không thể thu hồi bằng rollback.

Không thay host/secret của môi trường thật trong lượt này. Log/TRX runtime nằm
trong `.tools/email-audit/` bị Git bỏ qua; preview và bản tóm tắt bộ đếm TRX tại
`docs/testing/email-2026-11-20/verification.json` được đưa vào docs.
`npm run format:check` và `git diff --check` đều PASS.
Đã tắt PostgreSQL 18, gỡ container PostgreSQL 16 có nhãn riêng của task và tắt
Mailpit riêng sau kiểm thử. Container MinIO đang dùng của người dùng được giữ
nguyên. Các thay đổi source vẫn chưa commit/push.
