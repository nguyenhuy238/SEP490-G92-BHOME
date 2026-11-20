# Container foundation

Root Compose starts local PostgreSQL, MinIO and loopback-only Mailpit. It reads ignored `.env`, binds host ports to
loopback, has named volumes and health checks, and does not deploy clients/API. PostgreSQL is pinned
to major 16. MinIO is built from the official `RELEASE.2025-10-15T17-29-55Z` source tag because community
distribution is source-only. This preserves the required MinIO/S3 architecture without using an
unverified third-party image. Its first build is slower and requires network access to GitHub/Go
modules. Upstream now describes the community repository as unmaintained; assess a supported S3
deployment separately before production. See [upstream guidance](https://github.com/minio/minio).

Build API artifacts from the repository root:

```sh
docker build -f deploy/docker/Api.Dockerfile -t bhome-api .
docker build -f deploy/docker/Web.Dockerfile --build-arg APP=owner-web --build-arg VITE_API_BASE_URL=https://api.example.com -t bhome-owner-web .
docker build -f deploy/docker/Web.Dockerfile --build-arg APP=public-web --build-arg VITE_API_BASE_URL=https://api.example.com -t bhome-public-web .
```

`Api.Release.Dockerfile` is the release runtime used by VPS Staging and Production image builds.
It includes the LibreOffice Writer, Poppler and font packages required by contract document/PDF
workflows, plus the `schema-output` and `seed` targets retained for separately reviewed operations.
The normal release pipeline builds only `--target api`; it never applies migrations or runs seeds.
Keep the older `Api.Dockerfile` available for the lightweight local image. Do not replace an
existing VPS image until the release image has passed the Staging acceptance checks.

The two web clients share a parameterized Dockerfile and serve SPA fallback with unprivileged Nginx
on port 8080. Vite's API URL is embedded at build time and must never be a secret. Native mobile uses
React Native and Expo. CI validates its Expo web export. Docker build contexts exclude private env files,
generated output and local tool downloads.

The API runs as the .NET image's unprivileged app user on port 8080 and requires runtime connection,
JWT and storage configuration. No credentials are baked in, and no migration is applied automatically.

These are deployment building blocks, not a complete production deployment. Before release, provide
TLS termination/trusted proxy forwarding, configured public hosts and exact CORS origins, production
secret management/key rotation, scoped database/storage accounts, private bucket policies, audited
migrations, backup/restore procedures, log retention, durable job monitoring and a supported S3
deployment. If TLS terminates at a proxy, configure trusted forwarded headers before redirection;
disable app redirection only with verified edge enforcement. Health endpoints should be routed through
an appropriate operations boundary. Review/pin image digests in the release process.

No infrastructure container was started during initialization because the local Docker daemon was
stopped. Compose syntax validation does not prove image build/runtime behavior.

## Incident và Maintenance demo

Hướng dẫn seed và chạy Incident/Maintenance trên database local riêng nằm trong
[BF07 demo walkthrough](../../docs/testing/BF07_DEMO_2026-11-15.md).
Các migration bổ sung, quyền truy cập và API được ghi trong
[Incident và Maintenance API](../../docs/api/INCIDENT_MAINTENANCE.md).

## Cấu hình SMS OTP thật qua eSMS

Phạm vi xác thực và bảo vệ thông tin theo GBR-01/02/13/18, NFR bảo mật và quyết định SMS ngày
13/11/2026 được ghi trong [SMS_IMPLEMENTATION.md](../../docs/development/SMS_IMPLEMENTATION.md).
Các thành phần liên quan gồm `SmsGateway`, `EsmsSmsSender`, `SmsPasswordRecovery` và job
`sms-recovery-delivery`. Kiểm tra chấp nhận gồm cấu hình đủ/thiếu, gửi đúng mẫu SMS-01,
từ chối của nhà cung cấp, timeout và nhận OTP trên điện thoại.

eSMS yêu cầu tài khoản có quyền gửi, Brandname được kích hoạt và nội dung được đăng ký với nhà mạng.
Đăng ký mẫu SMS-01 theo nội dung ứng dụng, với mã OTP sáu chữ số và thời hạn là biến của mẫu.

```text
BHOME: Ma OTP dat lai mat khau la {OTP}. Ma co hieu luc trong {MINUTES} phut. Khong chia se ma nay.
```

Đối chiếu tên Brandname và mẫu được eSMS duyệt trước khi bật các cờ tương ứng.
Hướng dẫn của nhà cung cấp có tại [API SMS OTP/CSKH](https://developers.esms.vn/esms-api/ham-gui-tin/tin-nhan-sms-otp-cskh).

### Chạy Development bằng User Secrets

API sử dụng User Secrets ID `bhome-api-development`. Lưu `Sms:ApiKey` và `Sms:SecretKey` trong
User Secrets qua công cụ quản lý secrets trên máy. Sau khi eSMS duyệt Brandname và mẫu OTP,
chạy tại repository root, thay `BRANDNAME_DA_DUYET` bằng tên thực tế.

```powershell
$env:DOTNET_ENVIRONMENT = 'Development'
dotnet user-secrets set 'Sms:Enabled' 'true' --project src/backend/BHome.Api
dotnet user-secrets set 'Sms:Mode' 'Production' --project src/backend/BHome.Api
dotnet user-secrets set 'Sms:ProductionEnabled' 'true' --project src/backend/BHome.Api
dotnet user-secrets set 'Sms:Brandname' 'BRANDNAME_DA_DUYET' --project src/backend/BHome.Api
dotnet user-secrets set 'Sms:EnabledTemplates:0' 'SMS-01' --project src/backend/BHome.Api
dotnet user-secrets set 'Sms:ApprovedTemplates:0' 'SMS-01' --project src/backend/BHome.Api
dotnet user-secrets set 'SmsRecovery:Enabled' 'true' --project src/backend/BHome.Api
dotnet user-secrets set 'Jobs:Enabled' 'true' --project src/backend/BHome.Api
```

Tạo khóa HMAC riêng cho OTP một lần, rồi giữ ổn định qua các lần khởi động. Nếu đã có khóa hợp lệ,
tiếp tục sử dụng khóa hiện có. Đoạn PowerShell sau đưa khóa qua stdin vào User Secrets.

```powershell
$smsRecoveryBytes = New-Object byte[] 32
$smsRecoveryRandom = [Security.Cryptography.RandomNumberGenerator]::Create()
try {
    $smsRecoveryRandom.GetBytes($smsRecoveryBytes)
    @{ 'SmsRecovery:HashKey' = [Convert]::ToBase64String($smsRecoveryBytes) } |
        ConvertTo-Json -Compress |
        dotnet user-secrets set --project src/backend/BHome.Api
} finally {
    $smsRecoveryRandom.Dispose()
    [Array]::Clear($smsRecoveryBytes, 0, $smsRecoveryBytes.Length)
}
```

Kiểm tra cấu hình bằng lệnh sau. Kết quả hiển thị tên thiết lập cùng `OK` hoặc `MISSING`.
Exit code 0 nghĩa là cấu hình cục bộ đủ điều kiện, exit code 1 chỉ ra phần cần bổ sung.

```powershell
dotnet run --project tools/BHome.LocalDevelopment -c Release -- check-sms-configuration
```

Sau đó khởi động lại API để nhận cấu hình mới. `Sms:Mode=Production` chọn gửi SMS thật và có thể
phát sinh phí ngay cả khi API chạy môi trường Development. Biến môi trường có độ ưu tiên cao hơn
User Secrets. CLI SMS đọc User Secrets khi môi trường là Development và đọc biến môi trường ở
mọi môi trường. Khi cấu hình bằng `.env`, nạp các giá trị đó vào process chạy CLI để đối chiếu.

### Chạy API trong container

Truyền cấu hình ở runtime bằng secret manager hoặc env file riêng có quyền truy cập hạn chế.
Các khóa tương ứng dùng dấu `__`, ví dụ `Sms__Mode=Production`,
`Sms__EnabledTemplates__0=SMS-01`, `Sms__ApprovedTemplates__0=SMS-01`,
`SmsRecovery__HashKey` và `Jobs__Enabled=true`. Có thể dùng `.env.example` làm danh sách thiết lập.
Docker Compose gốc khởi chạy PostgreSQL và MinIO. Container API cần được truyền cấu hình SMS riêng.

OTP được gửi qua PostgreSQL job queue. `Jobs:Enabled=true` cho phép worker xử lý các handler đã
đăng ký. Kiểm tra log khởi động có `Background worker started` và khả năng kết nối database.
Lưu bền vững ASP.NET Core Data Protection key ring qua các lần tạo lại container. Với nhiều API
instance, dùng chung key ring và cấu hình ứng dụng Data Protection để các instance giải mã được
job OTP của nhau. Hạ tầng lưu key ring hiện cần được cấu hình khi triển khai.

### Kiểm tra nhận OTP

Để thử riêng mẫu OTP sau khi đã xác nhận số nhận thử, đặt `BHOME_SMS_TEST_PHONE` riêng trong
process và chạy các lệnh sau. Giữ các cờ live-test trong process thử nghiệm.

```powershell
$env:Sms__LiveTestEnabled = 'true'
$env:BHOME_SMS_CONFIRM_LIVE = 'true'
try {
    dotnet run --project tools/BHome.LocalDevelopment -c Release -- test-sms-provider --otp
} finally {
    Remove-Item Env:Sms__LiveTestEnabled -ErrorAction SilentlyContinue
    Remove-Item Env:BHOME_SMS_CONFIRM_LIVE -ErrorAction SilentlyContinue
}
```

Probe gửi một mã ngẫu nhiên theo SMS-01 để kiểm tra nhận tin. Luồng khôi phục mật khẩu thực tế
bắt đầu tại màn hình quên mật khẩu qua SMS hoặc `POST /api/v1/auth/sms-recovery/request`.
Tài khoản cần đang hoạt động, có số di động Việt Nam và `PhoneNumberConfirmed=true` từ việc xác minh
quyền sở hữu số điện thoại. Repo hiện còn thiếu luồng xác minh quyền sở hữu số điện thoại thật.
Đánh dấu phone-confirmed cần bằng chứng xác minh phù hợp. Thiếu số đã xác minh sẽ khiến yêu cầu
trả về thông báo chung và bỏ qua việc gửi OTP để bảo vệ thông tin tài khoản.

Kiểm tra đầy đủ bằng cách yêu cầu mã, nhận trên điện thoại, xác minh, đặt lại mật khẩu và đăng nhập
bằng mật khẩu mới. Các ca sai mã, hết hạn, gửi lại và dùng lại mã được kiểm tra trong luồng tương ứng.
eSMS `CodeResult=100` xác nhận tiếp nhận yêu cầu. Xác nhận giao tin qua điện thoại hoặc callback
cuối cùng. Có thể cấu hình `Sms:CallbackUrl=https://<api-host>/api/v1/sms/esms/callback` khi ingress
đã giữ đúng IP nguồn theo [hướng dẫn SMS](../../docs/development/SMS_IMPLEMENTATION.md).
Sandbox dùng `Sandbox=1` để kiểm tra tích hợp và trả trạng thái `SandboxAccepted`.

# Internal OCR CPU smoke

Tải model có pin/checksum bằng `scripts/Get-OcrModels.ps1`, sau đó chạy từ repository root:

```powershell
docker compose -f deploy/docker/compose.ocr-smoke.yml build
docker compose -f deploy/docker/compose.ocr-smoke.yml run --rm smoke
```

Container chạy non-root, không có mạng, 2 CPU/768 MiB và model mount read-only.
Exit 1 nghĩa là có ca so khớp ảnh tổng hợp thất bại; không được coi build/inference thành công
là accuracy đạt yêu cầu. API mặc định tắt OCR, và chưa có repository nghiệp vụ để cấp scope thật.
Xem [tài liệu OCR](../../docs/development/INTERNAL_OCR.md) về cấu hình, API và các phần chưa tích hợp.
