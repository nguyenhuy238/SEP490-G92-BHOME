# SePay/ngrok: sửa cấu hình 400 Invalid Hostname

Ngày kiểm tra: 13/11/2026, Asia/Ho_Chi_Minh. Branch: `member/QHuy`.

## Phạm vi và truy vết

- Nguồn: yêu cầu sửa lỗi ngrok của người dùng, `AGENTS.md`, `docs/api/SEPAY.md`,
  cấu hình và controller thực tế trong repository.
- BF-06 / UC-22/23/25 / GBR-10/18 / JOB-03 / NFR bảo mật API: cho phép đúng hostname
  tunnel để request tới handler, giữ xác thực HMAC và chống ghi nhận tiền không hợp lệ.
- Thành phần: `AllowedHosts` → Host Filtering của ASP.NET Core → health/controller
  hiện có → `SePayWebhookSecurity`. Không thay endpoint, DTO, nghiệp vụ, schema hay migration.
- Tiêu chí: localhost/LAN/tunnel được cấu hình tiếp tục dùng được; host lạ bị từ chối;
  webhook thiếu HMAC trả 401 và không tạo payment/allocation/inbox; Owner/Tenant API
  tiếp tục yêu cầu JWT; HTTPS không lặp redirect.

## Nguyên nhân và bằng chứng trước sửa

`src/backend/BHome.Api/appsettings.json:11` đặt
`AllowedHosts=localhost;127.0.0.1`. Profile `.env` đang có bổ sung IP/hostname LAN,
nhưng không có `casually-rendition-bagful.ngrok-free.dev`.
`.env.sepay.local` chưa tồn tại lúc bắt đầu tác vụ.

Đã chạy API bằng `Start-Api.ps1 -EnvironmentFile .env` và chỉ đổi Host header:

| Request tới cùng binding HTTPS | Kết quả thực tế |
| --- | --- |
| `GET https://localhost:7240/health/live` | 200, Healthy |
| Cùng URL, `Host: casually-rendition-bagful.ngrok-free.dev` | 400, trang HTML `Bad Request - Invalid Hostname` |
| `GET https://localhost:7240/health/ready` | 200 |

Đây là lỗi Host Filtering, không phải Kestrel không lắng nghe HTTPS hay lỗi controller
SePay. Trang lỗi giống lỗi người dùng cung cấp được tái hiện bằng hostname thiếu trong
allowlist, trước khi endpoint tạo correlation header. Host Filtering được đăng ký bởi
ASP.NET Core defaults khi `Program.cs` gọi `WebApplication.CreateBuilder(args)`.

Tại thời điểm bắt đầu, public health còn trả `404 ERR_NGROK_3200` (tunnel offline)
và API chưa chạy. Đây là một vấn đề vận hành riêng; không suy diễn nó thành HTTP 400.

## Kiểm tra cấu hình và thay đổi tối thiểu

`Start-Api.ps1` đã hỗ trợ `-EnvironmentFile`, resolve đường dẫn từ repository root,
đặt `BHOME_ENV_FILE` và export `AllowedHosts`/`SePay__*` trước khi gọi `dotnet run`.
Không phát hiện lỗi cần sửa trong script để xử lý profile không có dấu nháy này.
`DevelopmentEnvironmentFile` cũng hỗ trợ hai nhóm khóa đó. Fallback Development
chèn file sau appsettings và trước user-secrets/environment/CLI; script startup xuất
file thành process environment nên có thứ tự ưu tiên khác với fallback.

`launchSettings.json` dùng Project/Kestrel, môi trường Development và các URL
7240/5240. Không có IIS Express/HTTP.sys binding cần đổi. Không tìm thấy cấu hình
`UseForwardedHeaders`, `KnownProxies`/`KnownNetworks` riêng trong backend. Dockerfile
API dùng Kestrel; compose hiện có chỉ chạy dịch vụ dữ liệu, không nằm trên đường
request ngrok → local API được kiểm tra.

Thay đổi:

1. `.env.example`: khai báo `AllowedHosts` an toàn và hướng dẫn append hostname cụ thể.
2. `.env.sepay.local` (mới, Git ignore): giữ `localhost`, `127.0.0.1`,
   `192.168.1.242`, `desktop-fovlaml.local`, thêm đúng hostname ngrok.
3. `docs/api/SEPAY.md`: hướng dẫn profile, precedence, host filtering, tunnel và probe.
4. `HostFilteringTests.cs`: mặc định chặn tunnel chưa cấu hình; file cho phép hostname
   cụ thể, giữ localhost/LAN; chặn hostname khác và suffix giả; bỏ qua forwarded
   headers không đáng tin; giữ override có ưu tiên cao hơn.
5. `SePayIntegrationTests.cs`: host tunnel hợp lệ vẫn phải có HMAC; unsigned request
   không tăng payment hoặc inbox trong PostgreSQL riêng.
6. Biên bản này lưu bằng chứng và giới hạn kiểm tra.

Không cần thay `Program.cs`, `ApiFoundation`, auth, xử lý tiền hoặc ngrok Host rewrite.
Không đặt wildcard hoặc bật forwarded headers toàn cục.
Theo [Microsoft](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/servers/kestrel/host-filtering?view=aspnetcore-8.0),
`AllowedHosts` của Host Filtering phù hợp khi proxy giữ Host.
Topology HTTPS public → HTTPS upstream đã được kiểm tra trực tiếp, không cần tin
cậy `X-Forwarded-Proto` để chữa lỗi hoặc tránh redirect.

## Môi trường kiểm tra đang chạy

API và ngrok được khởi động nền, cửa sổ ẩn, để người dùng tiếp tục cấu hình Dashboard.
Ngrok local API xác nhận public URL dưới đây forward tới `https://localhost:7240`.
Không dùng `--host-header=rewrite`.

Để không xử lý retry/polling trên database làm việc, profile mới sử dụng container
PostgreSQL riêng `bhome-sepay-host-3078392f`, cổng loopback 50545, database mang tên
`bhome_compact24_dev_<random hex>`. Startup đã tạo schema bằng initializer hiện có.
Không sửa database làm việc. Container được giữ lại cùng API cho phiên test này.
Script kiểm thử tích hợp tạo và tự dọn một container disposable khác.

**Binding receiving account/Location hiện là dữ liệu tổng hợp để kiểm tra kết nối,
chưa đại diện cho tài khoản SePay Test Mode hoặc Location đã cấu hình nghiệp vụ.**
HMAC secret ngẫu nhiên riêng được tạo trong file private; không xuất vào báo cáo.
Polling token để trống, Email và notification automation tắt trong profile test.

Cấu hình cần giữ/điền trong `.env.sepay.local` (placeholder không phải giá trị chạy):

```dotenv
AllowedHosts=localhost;127.0.0.1;192.168.1.242;desktop-fovlaml.local;casually-rendition-bagful.ngrok-free.dev
ConnectionStrings__Database=<PRIVATE_DEDICATED_TEST_CONNECTION_STRING>
Jwt__SigningKey=<PRIVATE_RANDOM_KEY_AT_LEAST_32_BYTES>
DevelopmentDatabase__InitializeOnStartup=true
Jobs__Enabled=false
NotificationChannels__Enabled=false
NotificationChannels__AutomationEnabled=false
Email__Enabled=false
SePay__Enabled=true
SePay__Mode=Test
SePay__ApiBaseUrl=https://userapi-sandbox.sepay.vn/v2
SePay__ApiToken=
SePay__WebhookSecret=<PRIVATE_RANDOM_SECRET_AT_LEAST_32_CHARACTERS>
SePay__WebhookPath=/api/v1/integrations/sepay/webhook
SePay__PaymentCodePrefix=BH
SePay__ReceivingAccounts__0__LocationId=<TEST_LOCATION_GUID>
SePay__ReceivingAccounts__0__BankIdentifier=<BANK_BIN_6_DIGITS>
SePay__ReceivingAccounts__0__Gateway=<TEST_GATEWAY_NAME>
SePay__ReceivingAccounts__0__AccountNumber=<TEST_ACCOUNT_NUMBER>
```

Các cấu hình chứng chỉ/storage/identity hiện có đã được giữ trong profile private.
`Api:UseHttpsRedirection` tiếp tục dùng mặc định `true`. Không thay secret thật bằng
placeholder khi sử dụng file đang chạy. Giá trị mới trong profile dùng dòng không dấu nháy.

## Lệnh khởi động lại

Hiện API/tunnel đã chạy; chỉ chạy lại sau khi dừng phiên cũ hoặc sau reboot:

```powershell
docker start bhome-sepay-host-3078392f
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Start-Api.ps1 `
  -EnvironmentFile .env.sepay.local
```

Trong PowerShell khác:

```powershell
ngrok http https://localhost:7240 `
  --url=https://casually-rendition-bagful.ngrok-free.dev
```

Nếu hostname tunnel đổi, sửa `AllowedHosts`, restart API và cập nhật URL Dashboard.
Không cần thêm CORS origin cho webhook server-to-server.

## Kết quả thực thi

Các probe TLS dùng `curl.exe`, không có `-k`, không dùng JWT hoặc chữ ký HMAC hợp lệ.

| Kiểm tra thực tế | HTTP/kết quả |
| --- | --- |
| Local `/health/live` | 200 |
| Local `/health/ready` | 200 |
| Local live với Host ngrok đã cấu hình | 200 |
| Host `unexpected.example.invalid` | 400 |
| Host `other.ngrok-free.dev` | 400 |
| Local unsigned webhook `{}` | 401 |
| Public `/health/live` | 200 |
| Public `/health/ready` | 200 |
| Public unsigned webhook `{}` | 401, `sepay_authentication_failed` |
| Public Owner `/api/v1/integrations/sepay/events`, không JWT | 401 |
| Public Tenant `/api/v1/payment-history`, không JWT | 401 |
| Local HTTP live, follow redirect | 307 → HTTPS local → 200 |
| Public HTTP live, follow redirect | 307 → HTTPS public → 200 |

Sau khi tạo secret ngẫu nhiên và restart API, đã probe lại local live/ready, public
live, unsigned public webhook và invalid Host, cùng kết quả trên. Truy vấn chỉ đếm
database test trước/sau unsigned public POST: `payments=0`, `payment_allocations=0`,
inbox `SePayEventV1=0` cả hai lần.

| Lệnh/check đã chạy | Kết quả |
| --- | --- |
| `.tools/dotnet/dotnet.exe build src/backend/BHome.sln -c Release --no-restore` | PASS, 0 warning, 0 error |
| Unit tests, filter `FullyQualifiedName~SePaySecurityTests`, Release | PASS 12, fail 0, skip 0 |
| `Test-Compact24Isolated.ps1 -Configuration Release`, filter dưới đây | PASS 93, fail 0, skip 0 |
| `git diff --check` | PASS |
| `git check-ignore .env.sepay.local` | Ignored |
| `git diff --cached --name-only` | Trống; không có file/secret được stage |

Filter tích hợp đã thực thi:

```text
FullyQualifiedName~SePayIntegrationTests|FullyQualifiedName~SePayApiClientTests|FullyQualifiedName~HostFilteringTests|FullyQualifiedName~ApiFoundationTests|FullyQualifiedName~DevelopmentDatabaseSafetyTests|FullyQualifiedName~EmailTransportTests|FullyQualifiedName~LoginApiTests
```

Các signed-event tests chỉ chạy trong fixture test cô lập. Không gửi signed payment
webhook lên public tunnel và không gọi dịch vụ ngân hàng production.
Log/TRX local đặt trong `.tmp/sepay-host/` (ignored). Không commit hoặc push.

Ghi chú công cụ: lần đầu dot-source `Use-LocalTools.ps1` trực tiếp bị ExecutionPolicy
chặn, nên build cuối gọi `.tools/dotnet/dotnet.exe` trực tiếp. Helper chuẩn bị môi
trường ban đầu dùng static `RandomNumberGenerator.GetBytes` không có trong Windows
PowerShell 5; đã chuyển sang instance RNG. Một lệnh gộp đọc config Docker/khởi động
process bị công cụ từ chối (`blocked by policy`, không kèm lý do chi tiết); phương
án hoàn tất dùng role tổng hợp riêng trong container test, không đọc credential Docker.
Một kiểm tra label Docker dùng Go-template gặp lỗi quoting và được thay bằng filter
label. Các lỗi công cụ này không phải kết quả build/test; kết quả thực thi cuối ở trên.

## URL và bước Dashboard tiếp theo

URL đã được kiểm tra nhận request và thực thi xác thực:

```text
https://casually-rendition-bagful.ngrok-free.dev/api/v1/integrations/sepay/webhook
```

Người dùng vào **Test mode → Tích hợp Webhook → Thêm webhook** hoặc sửa webhook test
hiện có: dán URL trên, chọn Tiền vào, JSON, bật gửi lại khi lỗi; chọn đúng tài khoản
Test Mode. Chọn HMAC-SHA256 và dùng cùng `SePay__WebhookSecret` trong file private.
Xem [hướng dẫn Dashboard chính thức](https://developer.sepay.vn/vi/tien-ich-khac/test-mode/tao-webhook)
và [công thức HMAC](https://developer.sepay.vn/vi/sepay-webhooks/xac-thuc).

Trước khi mô phỏng thanh toán, thay binding tổng hợp bằng Location/receiving account
demo đã cấu hình trong database test, giữ marker demo và chọn đúng tài khoản Test Mode;
restart API sau khi sửa file. Dùng mã BH đã được Backend cấp cho obligation test.
Signed delivery thật từ SePay, thanh toán end-to-end và thao tác Dashboard chưa thực hiện
trong tác vụ này. Kết quả kết nối không khẳng định các bước đó đã đạt.
