# SePay cho team BHOME

Phạm vi chuẩn hoá: BF-06, UC-22/23/25, GBR-10/18 và JOB-03. Tái sử dụng webhook,
polling, registry BH, QR và ledger hiện có. Chỉ thêm công cụ tạo fixture tổng hợp trên
database Sandbox riêng; không đổi chính sách tiền, quyền hoặc schema.

Truy vết: khởi tạo từ checkout sạch → `.env.sepay.example`, Docker Compose riêng và
`SePaySandboxSeed` → kiểm thử từ chối Production/remote DB, chạy lại không reset tiền,
port mapping sau restart và toàn bộ các gate CI hiện có.

## Clone mới và cấu hình riêng

Cần .NET 8, Node 22.13+ dưới 23, npm 10+, PowerShell và Docker Linux engine.
Cài SDK/tool theo README; `.tools` trên máy của người khác không được chia sẻ.

```powershell
dotnet restore src/backend/BHome.sln
npm.cmd ci --no-fund --no-audit
dotnet dev-certs https --trust
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/Initialize-SePaySandbox.ps1
```

Initializer tạo `.env.sepay.local` bị Git ignore từ `.env.sepay.example`, sinh riêng
database ID, Location ID, tên container, mật khẩu PostgreSQL/fixture, JWT key và webhook
secret. Không ghi đè profile đã có, không copy `.env`/Neon và không gọi SePay.
Muốn nhiều Sandbox trên cùng máy: dùng `-EnvironmentFile .env.sepay.other.local -PostgresPort 55433`.

Trong file private, điền từ **tài khoản Test Mode của chính bạn**:

| Khóa                                          | Giá trị                                                                        |
| --------------------------------------------- | ------------------------------------------------------------------------------ |
| `SePay__ReceivingAccounts__0__BankIdentifier` | BIN ngân hàng, 6 số                                                            |
| `SePay__ReceivingAccounts__0__Gateway`        | Gateway đúng của SePay, ví dụ tên ngân hàng trong payload                      |
| `SePay__ReceivingAccounts__0__AccountNumber`  | Tài khoản Sandbox 6–19 số, không dùng tài khoản thật                           |
| `SePaySandbox__AccountHolder`                 | Tên chủ tài khoản Test Mode, ASCII hoa, 5–50 ký tự                             |
| `SePay__ApiToken`                             | Token API Access Test Mode riêng nếu cần polling; webhook-only có thể để trống |

Giữ bí mật token và `SePay__WebhookSecret`. API token là bearer credential cho truy vấn
server-to-server; webhook secret là HMAC key khác, không dùng thay nhau. Không đưa credential
vào frontend, ảnh chụp, tài liệu PR, CI variable công khai hoặc chia sẻ `.env` giữa thành viên.

## Khởi tạo dữ liệu và chạy

Bật Docker Desktop. Dừng API khác đang chiếm 7240/5240, rồi chạy:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/Start-SePaySandbox.ps1 -Seed
```

Lệnh sử dụng `deploy/compose.sepay.yml`, PostgreSQL 16 với named volume riêng và cổng
loopback **cố định 55432**; có thể chọn cổng khác lúc initialize. Không chạy MinIO hoặc job
nghiệp vụ khác. Nếu schema thiếu/rỗng, chạy công cụ Compact24 hiện hành để chuẩn bị; không
chạy `--archive-legacy`, không xóa hoặc tự upgrade schema populated khác.

Seed chỉ được phép trên Development/Testing, host loopback, database GUID dành riêng,
SePay Test Mode, đúng một binding và tên chủ tài khoản hợp lệ. Lần đầu yêu cầu Users/Locations
trống; dữ liệu không thuộc fixture bị từ chối. Các bản ghi Contract/occupancy/Final Invoice
là **preconditions tổng hợp**, không phải thao tác ký/activate thực và không tạo Payment.

Tạo `[TEST] BHOME SePay Sandbox`, phòng `SEPAY-101`, một Invoice 2.500.000 VND với hai Tenant
có entitlement, receiving account demo và BH code từ registry thật. Đăng nhập bằng:

- `owner.sepay.test@example.invalid`
- `tenant1.sepay.test@example.invalid`, `tenant2.sepay.test@example.invalid`
- `staff.sepay.test@example.invalid` để kiểm tra từ chối quyền tài chính

Mật khẩu chung **chỉ của fixture local** nằm ở `BHOME_SEPAY_FIXTURE_PASSWORD` trong profile
private. Chạy lại seed giữ nguyên mật khẩu, invoice đã thanh toán, allocations và BH code;
không reset tiền để mô phỏng lại. Muốn một bộ thử nghiệm mới, tạo một profile/database mới.

Các lựa chọn:

```powershell
# Chuẩn bị schema/fixture rồi thoát, chưa chạy API:
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/Start-SePaySandbox.ps1 -Seed -PrepareOnly
# Các lần chạy thông thường, không seed lại:
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/Start-SePaySandbox.ps1
# Chỉ bật container, không sửa schema hoặc fixture:
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/Start-SePaySandbox.ps1 -DatabaseOnly
```

Owner Web: `npm.cmd run dev --workspace ./src/owner-web`, chế độ API mặc định, dùng cùng backend.
Sau khi đổi profile/database, **đăng xuất và đăng nhập lại**. Vào Thanh toán → Webhook SePay
→ Kiểm thử SePay; bộ lọc Location/Room phải có fixture vừa tạo. Mobile dùng cùng API và Tenant
fixture; tài khoản của database Neon không tự tồn tại trong database Sandbox.

## Webhook, tunnel và polling

Chạy ngrok trong **terminal riêng và giữ nó chạy**. Không dùng hostname của thành viên khác.
Ví dụ với HTTPS local đã được tin cậy:

```powershell
ngrok http https://localhost:7240 --url https://YOUR-NGROK-HOST --upstream-tls-verify
```

Thêm chính xác hostname đó vào `AllowedHosts` của profile, giữ localhost/127.0.0.1; restart API.
Không bật wildcard hoặc tắt HMAC để chữa lỗi tunnel. Nếu dùng CA tự ký và muốn xác minh TLS upstream
tường minh, dùng `--upstream-tls-verify --upstream-tls-verify-cas <CA-public.pem>` với public CA
đã cấp chứng chỉ local, không commit private key. Hosted endpoint lâu dài thuộc cấu hình deployment
của team; ngrok local không phải hosting Production.

Trong SePay **Test Mode**, cấu hình URL `https://YOUR-NGROK-HOST/api/v1/integrations/sepay/webhook`,
Tiền vào, JSON, HMAC-SHA256 và cùng secret của backend, đúng tài khoản Sandbox, prefix BH + 8 số,
bật retry. Kiểm tra trước khi mô phỏng:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/Test-SePayWebhook.ps1 -PublicBaseUrl https://YOUR-NGROK-HOST
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/Test-SePayConnection.ps1
```

Probe webhook chỉ GET health và POST `{}` không ký, không tạo giao dịch. Kỳ vọng health 200,
unsigned webhook 401. `ERR_NGROK_3200` là tunnel offline; 400 có thể do AllowedHosts;
401 trên webhook SePay thật cần kiểm tra HMAC/timestamp, còn 401 của probe là kết quả mong muốn.
Checker API chỉ GET, chặn redirect, không xuất token/payload và trả lỗi khi binding không khớp.

Tạo giao dịch qua Dashboard simulator bằng đúng amount và mã BH backend cấp. ACK 200 chỉ chứng minh
đã nhận/classify; kiểm tra receipt/allocation và số dư. Webhook lỗi nhưng Invoice vẫn Paid có thể
do JOB-03 polling đã phục hồi giao dịch. Xem timestamp lượt gửi mới, không nhầm bản ghi lỗi cũ.
Replay cùng giao dịch kiểm tra idempotency, không tạo thêm transfer để thử trên Invoice đã Paid.
Hướng dẫn hợp đồng HMAC và ledger chi tiết: [SEPAY.md](../api/SEPAY.md).

## Profile cũ trên máy tác giả

Không yêu cầu clone container có tên cố định, `.tmp`, password hoặc token của tác giả.
Để giữ một profile/container cũ và đồng bộ cổng động sau Docker restart:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/Start-SePaySandbox.ps1 `
  -EnvironmentFile .env.sepay.local -ExistingContainer YOUR-EXISTING-BHOME-SEPAY-CONTAINER
```

Tên container phải có tiền tố `bhome-sepay-`, mapping loopback, và profile phải trỏ database
Sandbox GUID. Wrapper chỉ cập nhật Port tương ứng; không đổi database/user/password/token/secret.
Không dùng `-Seed` cho profile cũ thiếu metadata fixture; dữ liệu đã Paid được giữ.
Người mới nên dùng initializer và Compose có cổng cố định.

## Các gate trước PR

`.github/workflows/ci.yml` chạy khi PR tới main/develop/release hoặc workflow_dispatch;
chỉ push member branch không tự kích hoạt workflow hiện tại. Dùng PR tới **develop**, reviewer
khác và CI thật trước merge. Không commit credential hoặc thêm SePay token thật vào CI.

- Backend restore, Release build, full solution tests trên PostgreSQL disposable có log SQL
  không bind parameters; Docker MinIO/LibreOffice; dotnet format; signing unit suite.
- Frontend clean `npm ci`, lint, Mobile typecheck, full npm tests/build, Expo web export,
  format:check, Compose config của môi trường thường và Sandbox template.
- PowerShell configuration checks không mạng: `scripts/Test-SePaySandboxScripts.ps1`.
- SePay unit/integration dùng dữ liệu tổng hợp, HTTP loopback và DB cô lập, không phụ thuộc
  token, ngrok, Dashboard, `.env.sepay.local` hoặc một giao dịch phải có trước.

Kiểm thử provider thật, Dashboard delivery và mobile device là acceptance riêng; không thay
thế bằng green unit test hoặc kiểm tra HTTP 401. Kết quả local không bảo đảm mọi điều kiện trên
runner GitHub; chỉ kết quả CI của PR xác lập gate remote đã đạt.

Kết quả và các lỗi CI đã tìm/sửa trong lượt chuẩn hoá: [biên bản kiểm chứng](SEPAY_TEAM_VALIDATION_2026-11-13.md).
