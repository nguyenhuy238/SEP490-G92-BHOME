# Thiết lập môi trường BHOME cho toàn team

Ngày chuẩn hóa: 19/11/2026. Chạy lệnh PowerShell tại thư mục gốc repository.
Đọc cùng [audit và kết quả kiểm thử](BHOME_ENVIRONMENT_VALIDATION.md).

## 1. Mô hình thống nhất

| Môi trường            | Frontend / API                                                                                                                         | Dữ liệu                           | Email                                   | SePay                                              |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | --------------------------------------- | -------------------------------------------------- |
| Local (`Development`) | Owner `http://localhost:5173`, API `https://localhost:7240`                                                                            | PostgreSQL và MinIO riêng mỗi máy | Mailpit loopback, không gửi ra Internet | Tắt mặc định                                       |
| VPS `Staging`         | Portal và API `https://api-sepay-test.103.146.23.157.sslip.io`                                                                         | Database/storage Staging riêng    | SMTP STARTTLS, chỉ allowlist            | Sandbox API, `Mode=Test`                           |
| VPS `Production`      | Owner `https://owner.103.146.23.157.sslip.io`, API `https://api.103.146.23.157.sslip.io`, Public `https://www.103.146.23.157.sslip.io` | Database/storage Production riêng | Gmail SMTP STARTTLS                     | Tắt; cấu hình `Mode=Live` chưa đồng nghĩa bật Live |

Không có Integration Hub. Không yêu cầu developer dùng chung backend/database hoặc tạo tunnel.
`sslip.io` hiện là hostname deployment hợp lệ. Đổi tên miền bằng cấu hình và build lại frontend.
Các hostname Staging hiện có API; để mở trang ký trên cùng host, người vận hành cần bổ sung
frontend Staging và route Caddy như mục 12. Không gửi link đến Owner Production cho dữ liệu Staging.

## 2. Phần mềm cần cài

- .NET SDK 8 theo `global.json` (8.0.400 trở lên thuộc nhánh 8.x).
- Node 22.13+ thuộc nhánh 22.x, npm 10+.
- Docker Desktop với Linux engine; Git; Windows PowerShell.
- Mobile native: Android Studio/JDK; iOS cần macOS/Xcode. Không bắt buộc để chạy Owner Web.

```powershell
dotnet --version
node --version
npm.cmd --version
docker compose version
docker info --format '{{.ServerVersion}}'
```

Nếu repo có công cụ portable riêng trong `.tools`, dùng `. ./scripts/Use-LocalTools.ps1`
trong phiên PowerShell cho phép chạy script. `.tools` không được chia sẻ qua Git.

## 3. Clone và nhánh làm việc

```powershell
git clone https://github.com/nguyenhuy238/SEP490-G92-BHOME.git
Set-Location SEP490-G92-BHOME
git status --short
git branch --show-current
```

Dùng nhánh cá nhân `member/<tên>` theo quy tắc Git của team; không push trực tiếp main/develop.
Không đổi nhánh hoặc ghi đè thay đổi chưa commit của người khác.

## 4. Cấu hình lần đầu

```powershell
dotnet dev-certs https --trust
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Initialize-TeamEnvironment.ps1
```

Script tái sử dụng `Initialize-Local.ps1`, tạo `.env` và frontend `.env.local` nếu chưa có,
sinh mật khẩu/key local riêng và export chứng chỉ dev vào `.tools/team-tls` cho Vite.
Script giữ nguyên file hiện có, không start/xóa container và không reset database.
Lần đầu script có thể báo PostgreSQL/API chưa chạy; làm các bước tiếp rồi chạy lại.

Chỉ tạo file và kiểm tra cấu hình/chứng chỉ, tạm bỏ qua probe dịch vụ:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Initialize-TeamEnvironment.ps1 -SkipNetworkChecks
```

Chỉ chẩn đoán, không tạo file:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Initialize-TeamEnvironment.ps1 -CheckOnly
```

Nếu đã có `.env` cũ, so sánh với `.env.example` và sửa từng khóa cần thiết. Không copy đè
template lên file có credential hoặc đổi mật khẩu database hiện có. `POSTGRES_*` và
`ConnectionStrings__Database` phải cùng database/user/password/port.

## 5. Chạy PostgreSQL, MinIO và Mailpit

```powershell
docker compose config --quiet
docker compose up -d --build postgres minio mailpit
docker compose ps
```

MinIO build từ Dockerfile hiện có nên lần đầu có thể lâu. Các cổng chỉ bind loopback.
Nếu đang dùng PostgreSQL native, không khởi động thêm service `postgres` trùng cổng;
điền connection string local tương ứng rồi chạy `docker compose up -d --build minio mailpit`.
Vào `http://localhost:9001`, dùng credential **của chính máy**, tạo bucket private `bhome-private`.
Không dùng `docker compose down -v`, không chạy script seed/reset trong quá trình onboarding cấu hình.

## 6. Chạy Backend

```powershell
dotnet restore src/backend/BHome.sln
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Start-Api.ps1
```

Launcher chỉ dành cho Development. Muốn chọn profile local riêng:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Start-Api.ps1 -EnvironmentFile .env.local
```

API dùng một loader `.env` duy nhất, không đánh giá biểu thức shell trong file.
Thứ tự ưu tiên: CLI/process environment > .NET user-secrets > `.env` được chọn > appsettings.
F5/`dotnet run` Development cũng đọc `.env` làm fallback; Staging/Production không đọc `.env` local.
`ASPNETCORE_ENVIRONMENT` được chọn trước khi ứng dụng khởi động; deployment phải truyền biến môi trường thực.

Development mặc định khởi tạo Compact24 chỉ khi database thiếu/trống, không reset dữ liệu cũ.
Nếu không muốn khởi tạo, cấu hình `DevelopmentDatabase__InitializeOnStartup=false`.
Startup kiểm tra môi trường trước bước này. Database Development phải là loopback;
profile remote Development có chủ đích phải opt-in `DevelopmentDatabase__AllowRemoteDatabase=true`.
Opt-in không phải quyền dùng database Staging/Production. Không dùng SSH forward để lách kiểm tra này.

```powershell
Invoke-WebRequest -UseBasicParsing https://localhost:7240/health/live
Invoke-WebRequest -UseBasicParsing https://localhost:7240/health/ready
```

`live=200` chỉ xác nhận API sống. `ready` kiểm tra database/schema. Swagger ở
`https://localhost:7240/swagger` chỉ bật trong Development.

## 7. Chạy Owner Web

```powershell
npm.cmd ci --no-fund --no-audit
npm.cmd run dev --workspace ./src/owner-web
```

`src/owner-web/.env.local`:

```dotenv
VITE_API_MODE=api
VITE_API_BASE_URL=https://localhost:7240
```

Mở `http://localhost:5173`. Trình duyệt gọi `/api` trên origin frontend; Vite proxy đến
API cấu hình và xác minh chứng chỉ TLS. Không dùng `secure:false` hay tắt kiểm tra chứng chỉ.
Cookie Secure/HttpOnly/SameSite hiện có giữ nguyên. Port frontend cố định; nếu bị chiếm,
dừng đúng tiến trình hoặc chủ động đổi cả port, callback URL và origins cho nhất quán.

Public Web hiện còn giao diện scaffold, chưa có API client nghiệp vụ; proxy đã thống nhất
với backend cổng 7240. Chạy riêng bằng `npm.cmd run dev --workspace ./src/public-web` ở cổng 5174.

## 8. Mobile

Không sửa Mobile để chuẩn hóa cấu hình lần này. `bhome://accept-invitation`,
`bhome://reset-password`, `bhome://confirm-email` và `bhome://sign-contract` giữ nguyên.
Tham khảo `src/mobile/.env.example` và launcher hiện có:

```powershell
npm.cmd run mobile:dev
```

Thiết bị thật không hiểu localhost là máy developer. Local Mobile cần cấu hình LAN/chứng chỉ
theo script Mobile hiện có. Kiểm thử người dùng Internet nên dùng API Staging và một bản Mobile
được cấu hình **cùng môi trường**. Native deep link không mang định danh môi trường;
phải kiểm tra backend của bản app trước khi mở thư. Không cài bản app Production để thử token Staging.

## 9. Email local và Staging

Local mặc định `Email__DeliveryMode=Capture`, host localhost, port 1025. Mở
`http://localhost:8025` để xem thư. Mailpit chỉ thu thư, không forward đến mailbox thật;
không cần tài khoản Gmail hay SMTP password. SMTP không mã hóa chỉ được chấp nhận cho
Capture loopback trong Development/Testing; SMTP thực luôn yêu cầu STARTTLS.

Các luồng mời Staff/Tenant, xác nhận email, reset và thư ký vẫn dùng queue/template hiện có.
`NotificationChannels__Enabled=true` và `AutomationEnabled=true` cho phép worker xử lý thư.
Thực hiện luồng trên giao diện bằng tài khoản tổng hợp local rồi kiểm tra action link trong Mailpit.

Muốn thử SMTP thật trong Development hoặc Staging: chọn `DeliveryMode=Smtp`, điền user/sender,
App Password riêng qua secrets và `Email__AllowedRecipients__0`, `__1`, ... là từng mailbox được phép.
Không cấu hình wildcard. Người nhận ngoài allowlist bị từ chối **trước khi mở kết nối SMTP**;
không tự chuyển hướng thư chứa token của người khác vào mailbox test.
`Email__TestRecipient` chỉ thuộc endpoint thử thư, không thay thế allowlist của mọi email.

Nếu máy đã cấu hình Gmail trước khi pull bản chuẩn hóa, API có thể dừng vì thiếu
`Email:AllowedRecipients:0`; Web nhận 502 và Mobile báo ECONNREFUSED vì API chưa mở cổng.
Với mailbox thử nghiệm đã được xác định trong `Email:TestRecipient`, chủ động chuyển đổi bằng:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Initialize-LocalEmail.ps1 -UseConfiguredTestRecipient
```

Script chỉ thêm mailbox test có sẵn vào Development user-secrets khi chưa có allowlist;
giữ nguyên allowlist đã có, mật khẩu/credential và `.env`. Không gửi thư, không suy ra người nhận
từ địa chỉ SMTP sender, không tự chuyển sang SMTP nếu profile đang chọn Mailpit Capture.
Thiếu mailbox test hợp lệ thì script dừng. Không dùng script này để cấu hình Staging/Production.
Profile local riêng có thể chọn bằng `-EnvironmentFile .env.local`.

Sau khi chuyển đổi: **Shift+F5 rồi F5 trong Visual Studio**, chờ API mở cổng 7240,
reload Owner Web rồi chạy lại `npm.cmd run mobile`. Đừng mở thêm một API khi Visual Studio đang chạy.
Nếu không còn cookie hợp lệ thì đăng nhập lại; HTTP 401 khi thử refresh không có cookie là bình thường.

Production dùng Gmail SMTP theo credential hiện có. Không thay mật khẩu/key đang sử dụng.
Test tự động mặc định dùng địa chỉ `.invalid`/capture/fake provider, không gửi thư thật.

## 10. Mở link ký local

Link ký ẩn danh yêu cầu HTTPS. Owner mặc định HTTP 5173 vẫn phục vụ thao tác quản trị;
chạy thêm một terminal cho trang ký HTTPS, cùng mã nguồn và cùng API local:

```powershell
$env:BHOME_WEB_HTTPS='true'
npm.cmd run dev --workspace ./src/owner-web
```

Mở `https://localhost:5176/contract-signing`; chứng chỉ/key được export ở bước 4.
Mặc định `AnonymousSigning__PublicSigningUrl=https://localhost:5176/contract-signing`.
Thư mời mang token ở fragment `#token=...`, không đưa token lên URL query của web server.
Luồng tài khoản dùng `/accept-invitation`, `/reset-password`, `/confirm-email` ở HTTP 5173;
token tài khoản Web cũng ở fragment. Không copy token/link thật vào log, ticket hoặc ảnh chụp.

Link mở app của tài khoản hiện có đi qua
`https://localhost:7240/open/sign-contract?contractId=...` rồi đến `bhome://sign-contract`.
Đường dẫn này không mang token ký ẩn danh; xác thực/quyền/OTP vẫn do backend hiện có xử lý.

**Link localhost chỉ mở được trên chính máy đó. Cấu hình không làm link này truy cập được từ Internet.**
Khi cần người nhận bên ngoài ký, triển khai backend, frontend và database Staging cùng nhau.
Không tạo hợp đồng local rồi gửi người nhận link Production/Staging; token chỉ thuộc database phát hành.

## 11. SePay local và Staging

Local chuẩn: `SePay__Enabled=false`; không cần token/polling/tunnel và không đăng ký lại webhook.
Các test HMAC/API client dùng dữ liệu tổng hợp và fake provider trong test hiện có.
Các script Sandbox local cũ chỉ dành cho thử nghiệm riêng có chủ đích, không phải bước onboarding bắt buộc.

Staging giữ project `bhome-sepay-stage`, `SePay__Enabled=true`, `Mode=Test`,
`ApiBaseUrl=https://userapi-sandbox.sepay.vn/v2`; webhook giữ nguyên:

```text
https://api-sepay-test.103.146.23.157.sslip.io/api/v1/integrations/sepay/webhook
```

Không thay HMAC, tài khoản nhận, ledger, fixture hoặc database đang chạy. Source chỉ mở hỗ trợ
môi trường ASP.NET `Staging` cho Test mode/testing-context; không đổi phân bổ tiền hay idempotency.
Production vẫn tắt SePay. Khi chưa được duyệt Live/đủ credential, không tự bật integration.

## 12. Chuyển sang Staging / Production

Root `.env.staging.example` và `.env.production.example` là template **biến môi trường API**,
không phải file để chạy `Start-Api.ps1`. Giữ file thật ngoài Git dưới `/opt/bhome-config/`.
Không copy chúng đè lên file đang chạy. PostgreSQL user/database trong template là ví dụ cấu hình mới;
khi nâng cấp VPS hiện tại phải dùng lại đúng giá trị có sẵn, không tạo lại database.

Nguồn URL deploy là `Deployment__OwnerOrigin` và `Deployment__ApiOrigin`;
`Deployment__PublicOrigin` tùy chọn cho Public Web. Các callback/trusted origins/CORS chưa được cấu hình
sẽ được sinh từ hai origin này. Các khóa cũ được giữ nguyên nếu đã cấu hình, nhưng phải khớp môi trường;
startup từ chối URL override mâu thuẫn. Không suy luận từ HTTP Host header.
`Deployment__Environment` phải khớp `ASPNETCORE_ENVIRONMENT`.

Frontend mẫu ở `src/owner-web/.env.staging.example` và `.env.production.example`.
Build Production từ PowerShell, không thay `.env.local` đang dùng:

```powershell
$env:VITE_API_MODE='api'
$env:VITE_API_BASE_URL='https://owner.103.146.23.157.sslip.io'
$env:VITE_DEPLOYMENT_ORIGIN=$env:VITE_API_BASE_URL
npm.cmd run build --workspace ./src/owner-web
```

Build Staging thay API base/deployment origin bằng `https://api-sepay-test.103.146.23.157.sslip.io`.
Build nhúng URL lúc compile; đổi hostname cần build lại. Xóa các biến process này hoặc mở terminal mới
trước khi quay về local. `.env.local` luôn được Vite nạp, biến process có ưu tiên cao nhất.
`VITE_DEPLOYMENT_ORIGIN` là guard tùy chọn cho cùng origin; nên đặt trong CI để chặn nhầm đích.

VPS cần người vận hành review:

1. Thêm các khóa `Deployment__*` vào cấu hình riêng theo đúng project; giữ nguyên credential/DB.
2. Production: `SePay__Enabled=false`, `SePay__Mode=Live`; không bật Live.
3. Staging: chuyển host environment sang `Staging`, giữ SePay Sandbox và thêm allowlist email.
4. Bổ sung Owner frontend Staging. Caddy trên hostname staging chuyển `/api/*`, `/open/*`
   sang API Staging, các page route sang frontend Staging; API webhook không đổi đường dẫn/đích.
5. Tham khảo `deploy/vps/Caddyfile.example`; alias `bhome-sepay-stage-api` và
   `bhome-sepay-stage-owner` phải được khai báo trên network proxy của stack Staging trước khi dùng.
   Chỉ API/frontend nối network proxy; không nối PostgreSQL/MinIO.
6. `deploy/vps/compose.environment.example.yml` là overlay tùy chọn cho stack đã review.
   `BHOME_API_ENV_FILE` trỏ file private tuyệt đối; `BHOME_OWNER_ORIGIN` là origin frontend tương ứng.
   Compose `--env-file` chỉ cấp interpolation; service `env_file` mới cấp options API.
   Các mục `environment` từ overlay cũ có ưu tiên cao hơn `env_file`: phải review giá trị URL/env cũ.
7. Giữ project `bhome-vps` và `bhome-sepay-stage`, dữ liệu, volume và DataProtection keys.
   Không chạy lại phần tạo secrets/schema/fixture trong tài liệu dựng VPS mới.

Các lệnh **chỉ kiểm tra** trên VPS (Bash), dựa trên tên file Production trong hướng dẫn hiện có:

```bash
cd /opt/bhome
git status --short
docker compose --project-name bhome-vps --env-file /opt/bhome-config/stack.env \
  -f docker-compose.yml -f /opt/bhome-config/compose.vps.yml config --quiet
docker compose --project-name bhome-vps --env-file /opt/bhome-config/stack.env \
  -f docker-compose.yml -f /opt/bhome-config/compose.vps.yml \
  exec -T caddy caddy validate --config /etc/caddy/Caddyfile
docker compose --project-name bhome-sepay-stage ps
```

Lệnh cuối chỉ hiển thị trạng thái theo project label; không cần biết tên file Compose Staging hiện tại.
Không dùng `docker compose config` không có `--quiet` vì có thể in secrets.
Tài liệu không khẳng định các thay đổi này đã triển khai; phiên chuẩn hóa source không truy cập/sửa VPS.

## 13. Bảng URL và quy tắc validation

| URL                               | Local                                          | Staging / Production                                             |
| --------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| Auth callbacks Web                | HTTP loopback hoặc HTTPS, trong TrustedOrigins | HTTPS, cùng OwnerOrigin                                          |
| AnonymousSigning PublicSigningUrl | HTTPS 5176                                     | HTTPS, cùng OwnerOrigin                                          |
| ContractSigning PublicOpenUrl     | HTTPS API 7240                                 | HTTPS, cùng ApiOrigin                                            |
| Mobile callbacks                  | `bhome://...`                                  | Giữ nguyên; bản app phải dùng backend tương ứng                  |
| CORS/AuthWeb origins              | Origin frontend thực tế                        | Origin của deployment; AuthWeb là tập con của CORS               |
| Web API build                     | Local chỉ dùng dev server                      | Bắt buộc HTTPS; chặn loopback/tunnel, credential, query/fragment |

Hostname riêng và sslip.io đều được chấp nhận. Guard phát hiện URL thiếu scheme, có credential,
HTTP ký, callback sang môi trường khác, CORS sai, SePay Test trong Production, remote DB local
chưa opt-in và biến frontend có tên credential. Validation không chứng minh DNS/backend thực sự
thuộc database dự kiến; phải kiểm tra deployment/network và build artifact trước khi phát hành.

## 14. Khi nào phải dùng Staging

Người ký nhận link từ Internet, callback provider, SePay Sandbox thật, thử email trên thiết bị khác,
hoặc kiểm thử xuyên FE–BE–database giữa nhiều máy. Deploy một bộ đồng nhất lên Staging;
không chỉ đổi link email của backend local sang hostname VPS.

## 15. Lỗi thường gặp và chuyển từ Cloudflare/ngrok

| Hiện tượng                      | Cách xử lý                                                                                      |
| ------------------------------- | ----------------------------------------------------------------------------------------------- |
| Docker/API chưa chạy            | Chạy dịch vụ theo mục 5/6, chạy doctor lại. Không xóa volume                                    |
| HTTPS proxy báo certificate     | `dotnet dev-certs https --trust`, chạy onboarding để export cert; không tắt TLS verification    |
| Cert dev đã đổi nhưng PEM cũ    | Đổi tên hai file trong `.tools/team-tls` để giữ bản cũ, chạy onboarding export lại              |
| Cổng 5173/5176/7240 bị chiếm    | Dùng `Get-NetTCPConnection -State Listen`; dừng đúng tiến trình hoặc đồng bộ URL/cổng           |
| SMTP local không nhận           | Kiểm tra Mailpit 1025/8025, DeliveryMode=Capture và notification worker                         |
| Staging email không gửi         | Thêm chính mailbox tổng hợp vào `Email__AllowedRecipients__N`, kiểm tra App Password/STARTTLS   |
| Token invalid/not found         | Xác nhận trang Web/app gọi đúng API và database đã phát hành; tạo lời mời mới đúng môi trường   |
| Startup báo Deployment mismatch | Kiểm tra Deployment origins, host environment, URL override cũ, Compose và user-secrets         |
| Build còn chọn API local        | Set VITE_API_BASE_URL bằng origin deploy ở terminal build; không dùng chung terminal có biến cũ |

Chuyển cấu hình cũ: dừng tunnel của chính mình khi không còn dùng; giữ nguyên file private;
sửa URL runtime trong `.env` theo template Local, giữ credential local cũ. Kiểm tra các override
trong user-secrets/process/F5 và frontend `.env*`; không xuất toàn bộ user-secrets ra terminal/log.
Xóa các override URL cũ có chủ đích rồi khởi động lại API/Vite. Script doctor báo tên khóa có tunnel
nhưng không in giá trị. Các script `Configure-CloudflareEmailLinks.ps1`, `Set-PublicDevelopmentUrls.ps1`
và tài liệu Cloudflare/ngrok là công cụ/tài liệu cũ, không còn là quy trình chuẩn.
Không dùng chúng để trộn link local với database VPS. Luồng Internet chuyển sang Staging.

## 16. Không commit secrets

Commit `.env*.example`; file `.env`, `.env.local`, `.env.staging`, `.env.production`, user-secrets,
`.tools`, certificate/private key và `/opt/bhome-config` phải ngoài Git. Các example dùng placeholder.
Không đưa API token, HMAC, JWT key, SMTP password vào `VITE_*`/`EXPO_PUBLIC_*`.
Không chia sẻ `.env` của người khác. Không xoay secret đang dùng chỉ để đồng bộ template.

## 17. Checklist thành viên mới

- [ ] Đúng SDK/Node/npm, Docker Linux engine hoạt động.
- [ ] `.env` local riêng, không nhận secret của người khác; frontend dùng API local 7240.
- [ ] Chứng chỉ HTTPS trusted, Vite proxy không bỏ qua TLS.
- [ ] PostgreSQL/MinIO/Mailpit local chạy; private bucket đã có.
- [ ] `/health/live` và `/health/ready` đúng kết quả.
- [ ] Owner HTTP 5173 hoạt động; HTTPS 5176 dùng khi mở link ký local.
- [ ] Thư xuất hiện trong Mailpit, callbacks đúng local; SePay mặc định tắt.
- [ ] Khi thử Internet, dùng FE/BE/DB/Mobile cùng Staging.
- [ ] Không thay webhook, dữ liệu/fixture/key Production và Staging.
- [ ] Chạy doctor, test liên quan và kiểm tra `git diff --check` trước PR.

Tham chiếu kỹ thuật: [ASP.NET configuration](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/configuration/?view=aspnetcore-8.0),
[Vite environment/mode](https://vite.dev/guide/env-and-mode), [Mailpit SMTP](https://mailpit.axllent.org/docs/configuration/smtp/).
