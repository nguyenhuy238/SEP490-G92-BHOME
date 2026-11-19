# Báo cáo chuẩn hóa cấu hình BHOME — 19/11/2026

Hướng dẫn vận hành: [BHOME_TEAM_ENVIRONMENT_SETUP.md](BHOME_TEAM_ENVIRONMENT_SETUP.md).
Phạm vi là source/config/scripts/tests; không đăng nhập hoặc thay đổi VPS.
Không commit/push, không thay nhánh làm việc của người dùng.

## Nguồn yêu cầu và traceability

Nguồn trực tiếp: task chuẩn hóa môi trường do người dùng cung cấp, đặc biệt §§2–12 và 14–15;
quy tắc `AGENTS.md` về cấu hình, secrets, server authorization và bằng chứng kiểm thử.
Các báo cáo SRS/Design có trong `docs/reports`; thay đổi này không diễn giải lại chính sách nghiệp vụ.

| Yêu cầu                                | Tham chiếu quy tắc liên quan                           | Thành phần                                                          | Kiểm tra chấp nhận                                                                             |
| -------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Phân tách URL Local/Staging/Production | GBR-01/02/13, NFR bảo mật                              | EnvironmentConfiguration, DevelopmentEnvironmentFile, launcher      | Callback đúng origin; reject Host/tunnel/cross-environment, không in giá trị nhạy cảm          |
| Email mời/xác thực/reset, link ký      | BF-03/04, UC-13..15, GBR-04; giữ nguyên phương thức ký | AuthenticationEmailDelivery/Options, AnonymousSigningSecurity, Vite | Link fragment được escape, token một lần/hết hạn theo flow hiện có, Mobile callback giữ nguyên |
| SePay theo môi trường                  | BF-06, UC-22/23/25, GBR-10/18, JOB-03                  | SePayOptions; không đổi service/repository/ledger                   | Staging Test dùng Sandbox; Production Test bị từ chối; HMAC/phân bổ/idempotency hồi quy        |
| Email delivery an toàn                 | JOB-04, NFR bảo mật                                    | EmailOptions, MailKitEmailSender                                    | Capture chỉ loopback Development/Testing; SMTP staging require allowlist, reject trước network |
| FE/config/onboarding                   | NFR khả dụng/bảo mật                                   | Vite, examples, Initialize-TeamEnvironment                          | Hai môi trường local riêng, HTTPS proxy xác minh cert, route SPA, không ghi đè file            |

Không đổi schema, quyền truy cập nghiệp vụ, quy tắc tiền/activation, provider ký, OTP TTL hay token lifecycle.
Không dùng kết quả lịch sử người dùng cung cấp như bằng chứng test của phiên này.

## Root cause và audit URL

1. `.env.example` trước đây để trống các Web callback và PublicSigningUrl; mỗi người tự điền URL public khác nhau.
2. `Start-Api.ps1` export một danh sách options riêng, khác allowlist của DevelopmentEnvironmentFile,
   đồng thời làm giá trị file thắng process/user-secrets khi được export. Nay một loader giữ đúng precedence.
3. SePayOptions chỉ nhận Test cho Development/Testing; môi trường ASP.NET `Staging` chưa được hỗ trợ.
4. Owner Vite có proxy/certificate verification phù hợp nhưng build chưa chặn URL local/tunnel/credential;
   Public Vite còn hardcode backend `https://localhost:7001`, khác cổng API thực tế 7240.
5. SMTP chỉ có đường gửi thật STARTTLS/auth; chưa có capture local hoặc allowlist cho mọi thư Staging.
6. Thiếu một entry point onboarding và ràng buộc đồng nhất URL deploy. Dockerfile Web còn dùng
   workspace `@bhome/$APP` dù package thực tế là `owner-web`/`public-web`; API Dockerfile thiếu dependency ký/docs.

Từ khóa audit: `localhost`, `127.0.0.1`, `trycloudflare.com`, `cloudflared`, `ngrok`, `sslip.io`,
`PublicSigningUrl`, `WebInvitationUrl`, `WebResetUrl`, `WebVerificationUrl`, `MobileInvitationUrl`,
`VITE_API_BASE_URL`, `AllowedHosts`, `AllowedOrigins`, `CallbackUrl`, `BaseUrl`, `RedirectUrl`, `WebhookUrl`.
Danh mục quét theo file và dòng: [URL inventory](BHOME_ENVIRONMENT_URL_INVENTORY.md).

| Phân loại                | Kết quả và xử lý                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Hardcode gây lỗi         | Public Vite cổng 7001 đã thay bằng cấu hình, mặc định local 7240                                              |
| Defaults local hợp lệ    | launchSettings 7240/5240, PostgreSQL/MinIO loopback, dev CORS và test fixtures giữ lại                        |
| Deployment hiện tại      | Giữ các hostname sslip.io trong examples; không hardcode chúng trong generator backend                        |
| Runtime email/ký         | Controllers/templates không tự chọn hostname; URL lấy từ options, được kiểm tra trước startup                 |
| Provider BaseUrl         | SePay Sandbox/Live và các adapter provider riêng giữ theo contract hiện có; không đổi thành hostname ứng dụng |
| Tài liệu/công cụ lịch sử | Cloudflare/ngrok docs và script opt-in giữ lại có ghi chú; không còn là quy trình mặc định                    |
| Mobile deep links        | `bhome://...`, Expo/LAN là nhóm riêng, giữ nguyên Mobile source                                               |
| Private config hiện tại  | Doctor đọc có kiểm soát và phát hiện 15 vấn đề; không in secret/URL thực tế, không sửa `.env` riêng           |

## Cấu hình đã chuẩn hóa

Local: Owner HTTP 5173, API HTTPS 7240, trang ký HTTPS 5176 (Vite cùng source/API), PostgreSQL 5432,
MinIO 9000/9001 và Mailpit 1025/8025. `.env` được sinh riêng; SePay tắt. Không cần tunnel.

Deploy: `Deployment:Environment`, `OwnerOrigin`, `ApiOrigin`, tùy chọn `PublicOrigin` là nguồn URL mặc định.
Callback cũ được hỗ trợ nhưng không được mâu thuẫn. Defaults chỉ điền khóa chưa tồn tại, không ghi đè khóa cũ.
Validation kiểm tra HTTPS, credentials/query/fragment, CORS/AuthWeb/TrustedOrigins/AllowedHosts,
origin tương ứng, env name, SePay mode và guard database Development. Không dùng Host header để tạo URL.

Staging mặc định dùng cùng hostname `api-sepay-test...` cho API và frontend Staging mới,
cần người vận hành review route/network alias Caddy trước khi phục vụ các trang Web.
Production giữ nguyên owner/www/api sslip.io, SePay disabled. API template dùng `Mode=Live`
để không mang cấu hình Test sang Production; đây không phải kích hoạt giao dịch Live.

Hai origin deploy là nguồn mặc định duy nhất; `AuthenticationEmail__*`/`AnonymousSigning__*` cũ là
override tương thích được đối chiếu. Thay tên miền chỉ đổi cấu hình và build lại Web.

## Kiểm thử đã thực hiện

Máy kiểm thử: .NET SDK 8.0.427; Node portable 22.23.4 được chọn bằng `Use-LocalTools.ps1`.
Docker CLI có nhưng engine tắt. Có PostgreSQL 18 native local; fixture kiểm tra loopback/admin database
`postgres`, tạo database tên ngẫu nhiên riêng và chỉ dọn database do fixture tạo.
Không chạy test trên database Production/Staging hoặc xóa dữ liệu database local của người dùng.

| Lệnh/nhóm                                                                                                                                     | Kết quả                                                      | Phạm vi chứng minh                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `dotnet restore src/backend/BHome.sln --verbosity quiet`                                                                                      | PASS                                                         | Restore solution                                                                                                           |
| `dotnet build src/backend/BHome.sln -c Release --no-restore --verbosity quiet`                                                                | PASS, 0 warnings/errors                                      | Release build                                                                                                              |
| Application.UnitTests filter `FullyQualifiedName~SePay`                                                                                       | PASS, 19 tests                                               | HMAC, parsing, mode guard, testing context                                                                                 |
| Infrastructure.UnitTests filter `EnvironmentConfigurationTests\|SigningInvitationLinkTests`                                                   | PASS, 31 tests                                               | Môi trường, trusted origin, Public Web không được dùng cookie auth, Mobile links, SMTP guard                               |
| IntegrationTests filter `EnvironmentStartupTests\|EmailCaptureTests\|EmailTransportTests\|SePayApiClientTests\|SePayHoldingPreviewGuardTests` | PASS, 62 tests                                               | Host startup, loopback SMTP transport, URL generation, MIME, allowlist trước network, fake SePay client                    |
| PostgreSQL 18 IT: `AnonymousSigningTests`, `SePayIntegrationTests`, `Compact24NotificationMvpTests.Authentication*`, `...Gmail*`              | PASS, 49 tests                                               | Token/account invitation/reset one-use; signing regression; payment allocations/idempotency; notification failure handling |
| `npm.cmd run lint --workspace ./src/owner-web`                                                                                                | PASS, có warning tồn tại ở `DigitalSigningPage.test.tsx:103` | Oxlint; không sửa test UI ngoài phạm vi                                                                                    |
| `npm.cmd run typecheck --workspace ./src/owner-web`                                                                                           | PASS                                                         | TypeScript app/Vite config                                                                                                 |
| `npm.cmd run test --workspace ./src/owner-web`                                                                                                | PASS, 112 files / 806 tests                                  | Full frontend suite trước khi thêm test malformed-URL cuối cùng                                                            |
| Owner tests cuối: `src/services/environment.test.tsx src/services/config.test.tsx`                                                            | PASS, 25 tests                                               | Guard sau bổ sung malformed URL và không lộ credential                                                                     |
| Owner `npm.cmd run build --workspace ./src/owner-web` với origin Production                                                                   | PASS                                                         | Production bundle; cảnh báo chunk >500 kB                                                                                  |
| Owner build `--mode staging` với origin Staging                                                                                               | PASS                                                         | Staging bundle                                                                                                             |
| Public Web `build`, `lint`                                                                                                                    | PASS                                                         | Scaffold và Vite config dùng cổng đúng; chưa có chức năng catalog thật                                                     |
| `powershell ... -File tests/scripts/TeamEnvironment.Tests.ps1`                                                                                | PASS                                                         | Hai profile độc lập, random secrets, URLs local, chạy lại không ghi đè, PowerShell syntax                                  |
| `node tests/scripts/WebEnvironment.test.mjs`                                                                                                  | PASS, DeveloperA và DeveloperB                               | Vite HTTP/HTTPS thật, proxy đến HTTPS API loopback riêng, xác minh cert, bốn SPA routes trả HTML 200                       |
| `docker compose --env-file .env.example config --quiet`                                                                                       | PASS                                                         | Compose syntax/interpolation, không chứng minh container chạy                                                              |
| Compose environment + integrations overlays trên base kiểm tra tạm, dùng placeholders tổng hợp                                                | PASS                                                         | Cú pháp overlay/env_file/interpolation; không khẳng định khớp stack private trên VPS                                       |
| Doctor `-CheckOnly -SkipNetworkChecks` trên `.env` riêng hiện tại                                                                             | FAIL có chủ đích: phát hiện 15 vấn đề                        | URL tunnel cũ/SePay bật, không sửa file chứa credential                                                                    |

Các vòng kiểm tra ban đầu có lỗi compile/typecheck trong code mới và đã sửa trước lần PASS ở trên.
Vòng PostgreSQL đầu có 4 failure / 26 pass vì fixture SMTP cũ thiếu allowlist; fixture đã bổ sung
mailbox tổng hợp được phép, sau đó nhóm hồi quy mở rộng chạy lại 49/49 PASS. Không nới validation để làm test qua.
Full Owner tests có stderr cảnh báo canvas của jsdom; runner kết thúc 806/806 pass.

Các test unit/integration chạy bằng `dotnet test <project> -c Release --no-build --filter ... --logger 'console;verbosity=minimal'`.
Admin connection cho PostgreSQL được truyền qua biến process private `BHOME_COMPACT24_TEST_ADMIN`,
không nằm trong command line hoặc tài liệu. Không dùng credential thật của provider trong automated tests.

## NOT TESTED và giới hạn

- Docker image build/runtime, Mailpit container và PostgreSQL **16**: NOT TESTED vì engine chưa chạy.
  SMTP capture đã kiểm thử qua TCP loopback bằng protocol probe; không đồng nghĩa đã chạy container Mailpit.
- Caddy validate/runtime trên VPS: NOT TESTED; chỉ cung cấp example và lệnh review, không chỉnh Caddy đang chạy.
- Gmail thật, SePay Sandbox Internet/VPS, ký từ thiết bị Internet, provider ký ngoài: NOT TESTED ở phiên này.
  Không tự gửi thư thật, đăng ký webhook hoặc dùng các fixture thanh toán có sẵn trên VPS.
- End-to-end trên thiết bị Mobile thật và thử token xuyên hai database đang deploy: NOT TESTED.
  Deep-link unit tests, backend token lifecycle hồi quy và Vite proxy tách hai API đã chạy.
- Frontend HTTP probes xác nhận SPA fallback/proxy, không thay thế browser E2E cho người ký.
- Scan bundle vẫn tìm được chuỗi `http://localhost` nội bộ **React Router** dùng làm URL base khi parse/memory navigation.
  Không phải API target BHOME. Fallback `https://localhost:7240` đã loại khỏi browser client; build guard chặn
  loopback/tunnel làm API deployment. Không sửa dependency chỉ để xóa chuỗi parser nội bộ.
- Domain validation không xác minh DNS/backend/database ownership. Nếu đổi toàn bộ anchors sang môi trường sai,
  không có cách suy ra điều đó chỉ từ URL tùy ý; người vận hành vẫn phải review mapping stack/database.
- `.env` riêng còn cấu hình cũ, được bảo toàn theo yêu cầu. Cần làm bước chuyển đổi từng khóa trong guide;
  không tuyên bố máy hiện tại đã hoàn tất onboarding hoặc VPS đã được cập nhật.

## File thay đổi/tạo mới

| Nhóm                    | File                                                                                                                                                                                                                                                                                                                 |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Template                | `.env.example`, `.env.staging.example`, `.env.production.example`, `.gitignore`; `src/owner-web/.env.staging.example`, `.env.production.example`; `src/public-web/.env.example`                                                                                                                                      |
| Backend bootstrap/guard | `src/backend/BHome.Api/Program.cs`, `Configuration/DevelopmentEnvironmentFile.cs`; `BHome.Infrastructure/EnvironmentConfiguration.cs`, `DependencyInjection.cs`                                                                                                                                                      |
| Email/signing           | `BHome.Application/Notifications/EmailOptions.cs`; `BHome.Infrastructure/IdentityAccess/AuthenticationEmailDelivery.cs`, `Modules/Notifications/MailKitEmailSender.cs`, `Contracts/AnonymousSigningSecurity.cs`                                                                                                      |
| SePay                   | `src/backend/BHome.Application/PaymentsDebt/SePay/SePayOptions.cs`                                                                                                                                                                                                                                                   |
| FE                      | `packages/client-core/src/config.ts`, `packages/client-core/viteEnvironment.ts`; `src/owner-web/vite.config.ts`, `src/public-web/vite.config.ts`, Owner `src/services/environment.test.tsx`                                                                                                                          |
| Docker/VPS examples     | `docker-compose.yml`, `deploy/docker/Api.Dockerfile`, `Web.Dockerfile`, `README.md`; `deploy/vps/compose.integrations.example.yml`, `compose.environment.example.yml`, `Caddyfile.example`                                                                                                                           |
| Scripts                 | `scripts/Initialize-Local.ps1`, `Initialize-TeamEnvironment.ps1`, `Start-Api.ps1`, `Validate.ps1`, ghi chú trong `Configure-CloudflareEmailLinks.ps1`; `tests/scripts/TeamEnvironment.Tests.ps1`, `WebEnvironment.test.mjs`                                                                                          |
| Backend tests           | Infrastructure `EnvironmentConfigurationTests.cs`; Application `PaymentsDebt/SePaySecurityTests.cs`; Integration `EnvironmentStartupTests.cs`, `Notifications/EmailCaptureTests.cs`, `EmailTransportTests.cs`, `GmailAuthenticationSmokeTests.cs`, `Compact24/AnonymousSigningTests.cs`, `GmailNotificationTests.cs` |
| Docs                    | `README.md`; `docs/development/LOCAL_DEVELOPMENT.md`, `CLOUDFLARE_ACCOUNT_EMAIL_LINKS.md`, `SEPAY_TEAM_SETUP.md`, `BHOME_TEAM_ENVIRONMENT_SETUP.md`, báo cáo này và URL inventory                                                                                                                                    |

`docs/development/VPS_DEMO_UBUNTU_24.md` là file untracked đã có trước task và được giữ nguyên.
Không ghi đè `.env`, user-secrets hoặc `/opt/bhome-config`; chứng chỉ test chỉ export vào `.tools` bị ignore.
Không có dependency package mới, schema/migration mới hoặc thay đổi Mobile.

## Bước bàn giao

Kiểm tra cuối: `git diff --check`, ESLint cho các TypeScript/Vite/Node files thay đổi,
liên kết tài liệu và scan common-token đều PASS. Build artifact đã xác nhận origin Production
và không chứa fallback API `https://localhost:7240`. Scan common-token không thay thế secret scanner đầy đủ.

Thành viên mới: trust dev certificate → chạy `Initialize-TeamEnvironment.ps1` → bật data services →
chạy `Start-Api.ps1` và Owner Vite → kiểm tra Mailpit, health và doctor. Khi mở link ký local, chạy thêm
Vite HTTPS với `BHOME_WEB_HTTPS=true` như guide.

Thành viên có Cloudflare cũ: giữ credential, thay từng URL/CORS/trusted origin theo template Local,
tắt SePay mặc định, loại override tunnel khỏi process/user-secrets có chủ đích rồi restart API/Vite.
Không trỏ backend local đến database VPS. Luồng người nhận Internet chuyển sang bộ Staging riêng.

VPS: chỉ người vận hành mới áp dụng anchors/environment/allowlist và thêm frontend Staging sau review;
dùng `config --quiet` và `caddy validate` trong guide. Giữ hai project, webhook, data, volumes,
DataProtection/HMAC/JWT keys; không reset/seed/rotate secrets hoặc tự bật Live.

## Bổ sung: sửa startup SMTP trên máy có cấu hình cũ (19/11/2026)

Sau commit chuẩn hóa, cấu hình Gmail cũ trên máy vẫn có Enabled/Username/AppPassword/STARTTLS
và TestRecipient nhưng không có AllowedRecipients. Validation đúng chủ đích đã dừng API;
thông báo gộp nhiều nguyên nhân khiến việc chuyển đổi chưa rõ. Web 502 và Mobile ECONNREFUSED
là hệ quả API chưa bind cổng, không phải lỗi session hoặc chứng chỉ trong tình huống này.

Đã tách thông báo validation theo cấu hình SMTP, giới hạn Capture và allowlist; thiếu allowlist
sẽ nêu đúng `Email:AllowedRecipients:0` và lệnh chuyển đổi. Thêm `Initialize-LocalEmail.ps1`
với lựa chọn tường minh `-UseConfiguredTestRecipient`; không tự cho phép toàn bộ người nhận
và không bỏ guard khi khởi động. Script đã được chạy trên máy này: thêm đúng mailbox test đã có
vào user-secrets, xác nhận mọi giá trị secret trước đó và hash `.env` giữ nguyên. Không gửi email.

Kết quả kiểm tra bổ sung thực sự đã chạy:

- Release solution build: PASS, 0 warnings/errors.
- Integration `EmailTransportTests|EmailCaptureTests|EnvironmentStartupTests`: 41 PASS;
  gồm regression thiếu allowlist báo chính xác khóa/lệnh và không làm lộ secret.
- Infrastructure `EnvironmentConfigurationTests`: 21 PASS; Capture/Staging/Production và guard SMTP giữ nguyên.
- `tests/scripts/LocalEmail.Tests.ps1`: PASS; migration, bảo toàn credential/env, chạy lại không ghi đè,
  cần lựa chọn tường minh, thiếu mailbox và từ chối profile Staging. Dùng UserSecretsId tổng hợp riêng để test.
- API thật chạy ở Development với worker SMTP/jobs/polling SePay tắt bằng biến process trong phiên kiểm tra.
  Postman CLI 1.80.0 chạy duy nhất folder Health từ collection hiện có, target HTTPS LAN,
  CA Mobile hiện tại dạng PEM: 2 requests / 2 assertions PASS, exit 0, `--no-report-events`.
  Không đăng nhập hoặc xuất report lên Postman. Lượt localhost ban đầu thất bại do chọn CA khác
  certificate đang được phục vụ; không dùng `--insecure` để vượt TLS.
- `Diagnose-MobileApi.cjs`: live=200, ready=200, contracts=401 cho request chưa đăng nhập;
  TLS authorized=true, CA không tin cậy và hostname sai đều bị từ chối đúng.
- Owner Web `POST /api/v1/auth/refresh` qua Vite không kèm cookie: HTTP 401, không còn 502.

Phiên API kiểm tra đã đóng, không dừng API/debugger có sẵn. Cần restart Visual Studio để process mới
nạp cấu hình đã sửa. Kiểm tra từ máy phát triển không thay thế E2E trên iPhone hoặc gửi Gmail thật.

## Bổ sung: người nhận lời mời bị allowlist chặn (19/11/2026)

Hàng đợi Staff ghi nhận `PermanentlyFailed` với mã `email_recipient_not_allowed`.
Lời mời do Owner thực hiện nay kiểm tra chính sách người nhận trước khi đổi grant hoặc ghi email
vào hàng đợi; địa chỉ bị chặn trả HTTP 503 với mã này và thông báo tiếng Việt trên Owner Web.
Luồng khôi phục mật khẩu công khai giữ nguyên phản hồi tổng quát để tránh lộ tài khoản.

Release build PASS; 48 test backend gồm regression không đổi grant/hàng đợi khi bị chặn,
retry sau khi cho phép và khôi phục mật khẩu PASS. Staff UI 12 tests, typecheck và lint PASS
(lint còn warning có sẵn ở DigitalSigningPage.test.tsx). Kiểm tra kết nối/xác thực SMTP không gửi thư PASS.
Địa chỉ đang thử đã được thêm riêng vào Development user-secrets; dữ liệu này không nằm trong Git.
Các lần gửi cũ đã thất bại không tự chạy lại. Chưa xác nhận một thư mới đã đến inbox người nhận.

## Bổ sung: thư còn trỏ ngrok offline (19/11/2026)

Thư đã đến mailbox nhưng URL tài khoản bị override bằng domain ngrok cũ trong cả `.env`
và Development user-secrets. Ngrok báo `ERR_NGROK_3200` vì endpoint đó offline. Đây là lỗi
đích callback; thay URL của backend local sang Production sẽ làm token trỏ sai database.

Thêm `Initialize-LocalUrls.ps1`: mặc định preview, `-Apply` chỉ chuyển các khóa callback,
public signing/open URL và origin tunnel cũ trong hai nguồn cấu hình. Giữ database,
credentials, keys, native deep links và các origin LAN hợp lệ. Có regression cho trường hợp
hai nguồn có giá trị khác nhau ở cùng một chỉ số origin. Profile Production/Staging bị từ chối.
Development startup cũng từ chối các URL/origin ngrok/trycloudflare đã biết và chỉ rõ lệnh migration.
Hostname HTTPS riêng và sslip.io vẫn được hỗ trợ theo cấu hình.

Đã áp dụng migration trên máy phát triển và so sánh toàn bộ nhóm cấu hình nhạy cảm trước/sau:
giữ nguyên. Đã restart đúng phiên debug Visual Studio, không bật tunnel hoặc sửa VPS.
Các callback tài khoản mới dùng Owner local 5173; link ký vẫn yêu cầu HTTPS 5176.

Kiểm chứng thực tế: Release build PASS (0 warnings/errors); 37 test cấu hình/deep-link,
41 test startup/email/capture và script LocalUrls.Tests.ps1 PASS. API live/ready HTTP 200
với TLS được xác minh bằng các chứng chỉ development hiện có; ba route tài khoản local HTTP 200;
Owner proxy refresh không cookie trả 401 đúng. Probe chỉ dùng CA Mobile riêng ban đầu không
khớp certificate SNI localhost; đã dùng bộ certificate development tương ứng, không tắt TLS.

Email cũ không được sửa hoặc gửi lại tự động. Cần yêu cầu một lời mời mới sau khi restart.
Localhost chỉ phục vụ chính máy phát triển; người nhận qua Internet cần bộ Staging riêng.
Chưa gửi một email mới hoặc xác nhận thao tác chấp nhận lời mời trên thiết bị người nhận ở lần sửa này.
