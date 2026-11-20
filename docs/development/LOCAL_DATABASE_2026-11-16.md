# PostgreSQL local và tài khoản demo — 16/11/2026

> Tài liệu lịch sử. Từ develop ngày 20/11/2026, cấu hình môi trường và callback
> theo [hướng dẫn chung](BHOME_TEAM_ENVIRONMENT_SETUP.md). Các bước tunnel ngrok,
> URL public local và cấu hình SePay local bên dưới không còn là hướng dẫn hiện hành.
> `Start-LocalPublicLinks.ps1` hiện chỉ chạy portal HTTPS local và giữ nguyên cấu hình;
> Internet callbacks dùng Staging. Xem [rà soát tương thích](BHOME_DEVELOP_COMPATIBILITY_2026-11-20.md).

Theo yêu cầu trực tiếp của người dùng, backend mặc định đã chuyển từ Neon sang PostgreSQL 18.6 đang cài trên máy. Database mới được tạo bằng toàn bộ migration `Compact24DbContext` của checkout hiện tại; không thay đổi schema hoặc dữ liệu trên Neon.

## Mở trong pgAdmin 4

- Server có sẵn: **PostgreSQL 18**, host `localhost`, port `5432`, user `postgres`; giữ mật khẩu server đã lưu trong pgAdmin.
- Nhấp phải **Databases → Refresh**.
- Mở **bhome_compact24_31ef9fcdc9ef447c93967be9424d4140 → Schemas → public → Tables**.
- Có 24 bảng nghiệp vụ; lịch sử 17 migration nằm riêng trong schema `bhome_meta`.

Tên database dùng định dạng local được công cụ migration/seed hiện tại cho phép. Database `bhome` cũ được giữ nguyên vì công cụ kiểm tra xác định schema đó không còn tương thích. Không archive, đổi tên hoặc xóa database cũ.

## Đăng nhập demo

| Vai trò                            | Email đăng nhập                       |
| ---------------------------------- | ------------------------------------- |
| Owner                              | `owner.sample@example.invalid`        |
| Staff                              | `staff.sample@example.invalid`        |
| Tenant                             | `tenant.sample@example.invalid`       |
| Tenant khác để kiểm tra phân quyền | `tenant.other.sample@example.invalid` |

Mật khẩu chung được tạo ngẫu nhiên, lưu trong [file tài khoản riêng](../../.tools/local-database-20261116/DEMO_ACCOUNTS.txt). File này nằm trong `.tools/`, bị Git bỏ qua. Không đưa mật khẩu vào tài liệu hoặc commit.

Bộ seed hiện có tạo 4 tài khoản, 2 cơ sở, 6 phòng, 6 tài sản, 12 công tơ, 8 biểu phí mẫu, 3 hồ sơ cư dân chờ xử lý và 4 tác vụ. Đây là dữ liệu tổng hợp để phát triển; chưa có hợp đồng/hóa đơn được seed và không phải bản sao dữ liệu Neon.

## Cấu hình và khởi chạy

Hai file riêng `.env` và `.env.local` đã trỏ tới database mới. `scripts/Start-Api.ps1` và launcher Mobile mặc định đọc `.env`; không cần sửa kết nối database phía frontend. Các profile `.env.neon*` được giữ nguyên.

Tắt `DevelopmentDatabase__InitializeOnStartup` vì database đã được tạo bằng EF migration, đồng thời công cụ khởi tạo local cũ chỉ nhận tên `bhome`. Worker Jobs vẫn giữ trạng thái tắt như trước khi chuyển local. Email, worker thông báo và SePay Test đã được bật lại; tài khoản nhận tiền Test được gắn vào BHOME SAMPLE 1 theo lựa chọn của người dùng. SMS giữ cấu hình Mock/tắt có sẵn. Thông tin xác thực nằm trong các file môi trường riêng/User Secrets. Không đổi policy đăng nhập, phân quyền, ký hoặc thanh toán.

API đã được khởi chạy sau khi thiết lập, tại `https://localhost:7240`. Những lần sau, khi chưa có API chạy:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Start-Api.ps1
```

Kiểm tra database theo cấu hình local:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Test-Database.ps1 -EnvironmentFile .env.local
```

Không dùng `Update-LocalDatabase.ps1` cho database mới này: script đó giới hạn tên `bhome`. Khi cần nâng cấp tiếp, dùng công cụ EF của `Compact24DbContext` với `BHOME_COMPACT24_DIRECT` nạp riêng từ cấu hình local, sau khi sao lưu và dừng API.

## Sao lưu và khôi phục

Thư mục riêng `.tools/local-database-20261116/` chứa:

- `bhome-before.dump`: sao lưu database `bhome` cũ trước thao tác.
- `env-before.backup`, `env-local-before.backup`: cấu hình trước khi chuyển local, có thể chứa secret.
- `local-demo-ready.dump`: bản sao lưu Custom của database mới sau migration và seed.
- `DEMO_ACCOUNTS.txt`: thông tin đăng nhập ứng dụng demo.
- `verification.json`: kết quả smoke API, không chứa mật khẩu/token.
- `api.stdout.log`, `api.stderr.log`, `api-launcher.pid`: log và PID launcher đã mở.

Để phục hồi bản demo vào database local khác: tạo database rỗng trong pgAdmin, chọn **Restore**, định dạng **Custom or tar**, chọn `local-demo-ready.dump`, rồi Restore. Bản dump chứa tài khoản demo ở dạng hash cùng dữ liệu mẫu. Chỉ dùng trong môi trường phát triển riêng.

Đã kiểm tra đọc được catalog bản dump bằng `pg_restore --list`; chưa thực hiện restore toàn bộ.

## Truy vết và kiểm chứng thực chạy

Nguồn phạm vi: yêu cầu chuyển môi trường local ngày 16/11/2026; AGENTS.md §6/7/9/10; GBR-01/02 về quyền truy cập; BF-01/BF-02 về dữ liệu cơ sở và phân công mẫu. Không bổ sung quy tắc nghiệp vụ hoặc coi seed là bằng chứng thực hiện ký/thanh toán. Thành phần dùng lại: `Compact24DbContext` và 17 migration hiện có, `Compact24SampleSeed`, `Start-Api.ps1`, `Test-Database.ps1`.

| Kiểm tra                                                     | Kết quả                                                                          |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Kiểm tra `bhome` cũ bằng `Update-LocalDatabase.ps1 -Check`   | Từ chối `unrecognized_existing_schema`; giữ nguyên database                      |
| EF update trên database mới                                  | PASS — áp dụng 17 migration                                                      |
| Build công cụ seed và database probe                         | PASS — 0 warning, 0 error                                                        |
| Probe schema/runtime EF                                      | PASS — 24 bảng, 17 migration đã áp dụng, 0 pending, 0 unknown                    |
| Seed lần đầu và chạy lại                                     | PASS — tạo dữ liệu; chạy lại báo `SAMPLE_ALREADY_PRESENT`, số bản ghi không tăng |
| Smoke API thực trên PostgreSQL local                         | PASS — 31 assertions                                                             |
| Sao lưu database cũ/mới và đọc catalog dump mới              | PASS                                                                             |
| Khôi phục đầy đủ dump, UI pgAdmin, UI trình duyệt/điện thoại | NOT RUN                                                                          |

31 assertions gồm liveness/readiness, chặn anonymous và mật khẩu sai, đăng nhập/session/vai trò cho cả 4 tài khoản, Owner đọc 2 cơ sở, Staff chỉ có 1 phân công và nhận 404 ở cơ sở khác, Staff/Tenant nhận 403 khi đọc danh sách cư dân, Tenant đọc danh sách hóa đơn trong phạm vi riêng, logout 4 session kiểm tra.

Không truy cập Neon trong lần thiết lập này. Không có bản export mới nhất từ Neon nên chưa thể khôi phục đầy đủ dữ liệu trên đó. Ảnh/PDF đã lưu ngoài database phụ thuộc MinIO và không nằm trong dump PostgreSQL. Không tuyên bố kiểm thử ngân hàng, nhà cung cấp ký, OCR hoặc toàn bộ luồng nghiệp vụ.

## Sửa email sau khi chuyển local — 16/11/2026

Nguyên nhân: bước thiết lập local ban đầu đặt `Email__Enabled`, `NotificationChannels__Enabled` và `NotificationChannels__AutomationEnabled` thành `false`. User Secrets trên máy cũng có ba cờ tương ứng đang tắt. Vì vậy SMTP không được sử dụng và outbox không được chuyển đi, dù tài khoản SMTP/App Password vẫn tồn tại trong User Secrets. Không phải lỗi PostgreSQL local hoặc thiếu migration email.

Đã sửa ba cờ trên thành `true` trong `.env`, `.env.local` và User Secrets `bhome-api-development`, để cả `Start-Api.ps1` và Visual Studio sử dụng cùng cấu hình bật email. Giữ nguyên SMTP credentials, URL reset/invitation/verification và quy tắc kiểm tra địa chỉ/email xác nhận. Không bật endpoint email-test hoặc financial jobs. Script thiết lập riêng trong `.tools/local-database-20261116/Configure-And-Seed.ps1` cũng được sửa để không tắt lại email.

Backend được phát hiện đang chạy qua Visual Studio. **Stop Debugging rồi F5 lại** để nạp cấu hình mới; không dừng phiên debugger của người dùng trong lần sửa này.

Truy vết: yêu cầu sửa lỗi gửi email; JOB-04, GBR-14/18 và quy tắc auth đã mô tả trong [GMAIL_SMTP_IMPLEMENTATION.md](GMAIL_SMTP_IMPLEMENTATION.md) và [AUTHENTICATION_EMAIL_IMPLEMENTATION.md](AUTHENTICATION_EMAIL_IMPLEMENTATION.md). Không thay đổi service, DTO, schema hoặc policy nghiệp vụ.

Kiểm chứng đã thực chạy:

- Build probe riêng: PASS, 0 warning/error. Lần build đầu lỗi chọn overload `AddUserSecrets`; đã sửa helper riêng và build lại thành công.
- Kiểm tra cấu hình hiệu lực: PASS cho SMTP, kênh thông báo, automation và cả ba loại callback reset/invitation/verification.
- Kết nối SMTP, STARTTLS với kiểm chứng chứng chỉ và xác thực bằng credential hiện có: PASS. Không gửi thư trong probe này; chưa xác nhận SMTP submission hoặc thư đến Inbox.
- `EmailTransportTests` cùng các test `Compact24NotificationMvpTests.Authentication*` và `EmailVerification*`: **39 passed, 0 failed, 0 skipped** trên PostgreSQL local disposable. Bao gồm outbox, reset mật khẩu, invitation, email verification, lỗi cấu hình và lỗi gửi. Test dùng provider kiểm thử, không gửi email thật.
- Log TRX riêng: `.tools/local-email-fix-20261116/results/email-regressions.trx`. Bản sao cấu hình trước sửa nằm trong cùng thư mục riêng; không chứa trong Git.

Tại thời điểm kiểm tra, database local có 4 tài khoản, cả 4 email đều là `@example.invalid` và chưa xác nhận email. Đây là địa chỉ tổng hợp, không có hộp thư nhận thật. Muốn kiểm tra nhận thư cần dùng tài khoản/người nhận có email thật và làm đúng luồng xác nhận hoặc mời tài khoản; không đổi email demo sang địa chỉ thật khi chưa có người nhận được chỉ định. Các thư nghiệp vụ còn tuân theo điều kiện `email_confirmed` hiện có.

## Khôi phục SePay và các link công khai — 16/11/2026

Theo yêu cầu tiếp theo, người dùng chọn link HTTPS dùng được trên cả điện thoại/máy tính, và chọn **BHOME SAMPLE 1** làm cơ sở nhận tiền SePay Test.

### Cấu hình đã sửa

- `.env`, `.env.local`, User Secrets: khôi phục các tùy chọn SePay Test từ profile Sandbox đã có; không bật Live. Đổi LocationId binding sang SAMPLE 1. API Sandbox xác nhận tài khoản đang hoạt động, khớp ngân hàng/gateway/số tài khoản.
- Profile Sandbox cũ trỏ tới một database không còn trên PostgreSQL local. Vì vậy tài khoản nhận tiền được đọc trực tiếp từ API Sandbox đã xác thực, rồi lưu vào database mới qua `PUT /api/v1/receiving-bank-accounts` bằng session Owner; dùng tên chủ tài khoản do provider trả về, không tự đặt tên. Giữ cờ Test/demo, version và audit của service hiện có. Không tạo giao dịch thanh toán.
- Callback tài khoản: `AuthenticationEmail:WebInvitationUrl`, `WebResetUrl`, `WebVerificationUrl` dùng HTTPS công khai; giữ các deep link `bhome://` cho Mobile. Thêm đúng origin công khai vào trusted origins, AuthWeb và CORS, giữ origin localhost đang dùng.
- Link ký: đặt `AnonymousSigning:PublicSigningUrl` tới `/contract-signing`, `ContractSigning:InvitationLink:PublicOpenUrl` tới `/open/sign-contract`. Không thay phương thức ký, HMAC key hoặc quy tắc ký.
- `scripts/Start-Api.ps1`: bổ sung nạp `Sms`, `SmsRecovery`, `ContractSigning` để cùng nhóm cấu hình với loader của Visual Studio.
- `src/owner-web/vite.config.ts`: proxy thêm đúng đường `/open/sign-contract` tới API HTTPS, giữ kiểm chứng chứng chỉ. Proxy `/api` hiện có phục vụ các trang callback và webhook qua cùng public origin.
- Bỏ override tắt SMS do lần chuyển local thêm vào; cấu hình gốc hiện vẫn Mock/disabled. Giữ financial Jobs disabled như trước, vì worker SePay/thông báo hoạt động độc lập. Không bật gửi SMS thật, billing jobs hoặc provider chưa được cấu hình.

### Sử dụng public link

Tunnel ngrok và một Owner Web Development riêng trên `127.0.0.1:5176` đã được mở; không dừng server Owner Web trên 5173 của người dùng. Chỉ thêm chính xác hostname tunnel vào allowed hosts của frontend. API vẫn tại `https://localhost:7240`.

Địa chỉ hiện tại nằm trong file riêng `.tools/local-public-links/public-origin.txt`. Các đường dẫn:

| Chức năng          | Đường dẫn trên public origin         |
| ------------------ | ------------------------------------ |
| Lời mời tài khoản  | `/accept-invitation`                 |
| Đặt lại mật khẩu   | `/reset-password`                    |
| Xác nhận email     | `/confirm-email`                     |
| Lời mời ký ẩn danh | `/contract-signing`                  |
| Mở ứng dụng để ký  | `/open/sign-contract`                |
| SePay webhook      | `/api/v1/integrations/sepay/webhook` |

Sau khi khởi động lại máy, dùng ngrok đã được cài/đăng nhập và dependencies hiện có:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Start-LocalPublicLinks.ps1
```

Script mở hoặc dùng lại đúng tunnel/frontend, cập nhật URL và origin trong profile đã chọn cùng User Secrets, không in credential hoặc đổi cấu hình tài khoản SePay. Mặc định chọn `.env`; có thể dùng `-EnvironmentFile .env.local` nếu chạy API bằng profile đó. Restart API sau khi URL thay đổi. Script đã thực chạy nhánh dùng lại tunnel/frontend hiện tại, PowerShell syntax PASS.

Webhook trên trang quản trị SePay cần trỏ đúng public origin + webhook path ở bảng trên. Chưa xác minh/cập nhật cấu hình dashboard SePay trong lần này. Laptop, tunnel, frontend 5176 và backend phải cùng hoạt động. Link trước đây trỏ localhost hoặc chứa token từ database Neon cần được phát hành lại từ database local; không sao chép token hoặc bỏ kiểm tra hết hạn/one-time.

### Kiểm chứng và giới hạn

- SePay Sandbox GET `bank-accounts` và `transactions`: HTTP 200; binding khớp tài khoản active.
- Audit cấu hình: PASS — local DB, SePay Test/options/binding, callback/trusted origin, HMAC link ký còn tồn tại, MinIO credentials/private bucket truy cập được, OCR options/model directories/classifier file tồn tại.
- Backend regression: **43 integration + 10 signing-link unit passed**, 0 failed/skipped. PostgreSQL test dùng database disposable; không phát sinh giao dịch ngân hàng thật.
- Owner Web: typecheck PASS; **15 tests passed** cho trang nhận lời mời và ký ẩn danh; Prettier file Vite PASS.
- Public web: 4 đường trang trả HTTP 200; cả 4 trang render trong Edge headless ở desktop và viewport điện thoại. Chưa thử trên điện thoại vật lý.
- Sau khi người dùng restart Visual Studio API: **12 assertions public API PASS**, gồm anonymous 401, Owner login với public Origin và cookie Secure, SePay Test context 200, Owner xem events 200, webhook không có chữ ký nhận 401, public app-entry 200 và ID rỗng 404, logout session kiểm tra. Lượt probe đầu gặp 502 vì API đang dừng; không nới TLS hoặc permission để khắc phục.
- Bản backup mới có cấu hình ngân hàng local: `.tools/local-integrations-20261116/local-with-sepay.dump`. Private logs/results/payload metadata nằm trong cùng thư mục bị Git bỏ qua. Tool chuyển DB một lần cũ được chặn chạy lại sau khi đã tạo tài khoản để tránh ghi đè cấu hình tích hợp mới.

MySign: kiểm tra read-only cho thấy database mới và `bhome` local cũ đều chưa có tài khoản Viettel lưu trong `users.business_profile.digitalSigning.viettel`; User Secrets cũng chưa có ClientId/ClientSecret MySign. Nếu tài khoản từng được cấu hình trên Neon, cần cấu hình lại qua Owner → cài đặt ký số hoặc phục hồi từ bản backup phù hợp. Không tự tạo hoặc sao chép chứng thư/private key. Chưa thử ký thật qua provider, gửi SMS thật, gửi email thật hoặc nhận webhook SePay thực từ dashboard trong lượt kiểm tra này.

Truy vết: yêu cầu trực tiếp, BF-03/04 và GBR-04 cho link ký hiện có; BF-06/UC-22..25/GBR-10/18/JOB-03 cho SePay; JOB-04/GBR-14 cho thông báo. Dùng lại DTO/service/permission/migration hiện có, không thêm endpoint, sửa schema hoặc thay chính sách tài chính. Nguồn thiết kế đã đối chiếu: `SEPAY_IMPLEMENTATION.md`, `SEPAY_UNIFIED_PAYMENT_2026-11-15.md`, `AUTHENTICATION_EMAIL_IMPLEMENTATION.md`, source controller/service/config và test hiện có.
