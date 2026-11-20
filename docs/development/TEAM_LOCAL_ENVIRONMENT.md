# Môi trường Development local thống nhất cho nhóm BHOME

Tài liệu này dùng cho từng máy lập trình Windows, theo thay đổi ngày 19/11/2026.
Mỗi người có database, mật khẩu và chứng chỉ HTTPS riêng; tất cả dùng cùng tên biến,
địa chỉ cổng và lệnh chạy. Profile này dành riêng cho **Development**. Staging và
Production giữ cấu hình provider, secret và endpoint riêng.

## Thiết lập lần đầu

Cài .NET SDK 8 theo `global.json`, Node.js 22 (npm 10+), Docker Desktop Linux
engine và Git. Mở PowerShell tại thư mục gốc:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Initialize-TeamEnvironment.ps1 -SkipNetworkChecks
dotnet dev-certs https --trust
dotnet restore src/backend/BHome.sln
npm.cmd ci
docker compose up -d --build
docker compose ps
```

`Initialize-TeamEnvironment.ps1` tạo `.env` với secret ngẫu nhiên nếu file chưa
có, chuẩn hóa **chỉ các khóa không bí mật** của local profile, tạo
`src/owner-web/.env.local` khi thiếu và giữ nguyên file nếu đã có. Nó cấu hình OTP
Development ở .NET User Secrets qua `Initialize-LocalSigning.ps1` (không in key),
và xuất cặp PEM `.tools/team-tls/localhost.crt` +
`.tools/team-tls/localhost.key` để Vite HTTPS dùng. Hai file PEM nằm trong thư mục
git-ignore; không commit, gửi qua chat hoặc dùng lại trên máy khác. Lệnh
`dotnet dev-certs https --trust` dùng một lần để trình duyệt tin cậy HTTPS local.

`-SkipNetworkChecks` bỏ qua kiểm tra HTTP lúc API/Vite chưa chạy; việc xác thực cú pháp
Docker Compose vẫn được thực hiện. Sau khi đã chạy, kiểm tra lại không ghi dữ liệu:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Initialize-TeamEnvironment.ps1 -CheckOnly
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Test-TeamEnvironment.ps1
```

Nếu có `.env` cũ, script bảo toàn mật khẩu, JWT key, PostgreSQL database và port
đã cấu hình; khi `POSTGRES_PORT` không khớp `Port=` trong connection string,
script dừng và yêu cầu sửa khớp. Không chạy lệnh reset/seed database trong bước
cấu hình này. Dữ liệu hiện có và Docker named volumes được giữ nguyên.

## Chạy mỗi lần

Chạy ba lệnh dưới đây ở **ba terminal riêng**, sau khi bật Docker Desktop:

```powershell
docker compose up -d
```

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Start-Api.ps1
```

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Start-TeamOwnerWeb.ps1
```

Mở **terminal thứ tư** cho trang ký hợp đồng HTTPS:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Start-TeamOwnerWeb.ps1 -SigningHttps
```

Với **Mobile Expo Web** trên chính máy phát triển, dùng `npm.cmd run mobile:dev`
và mở `http://localhost:8081`. Expo Web gửi request trực tiếp tới API
`https://localhost:7240` (khác với Owner Web dùng Vite proxy). Vì vậy
Development CORS phải chứa chính xác `http://localhost:8081` và
`http://127.0.0.1:8081`. `Initialize-TeamEnvironment.ps1` cấu hình các origin
này trong `.env`; **cần khởi động lại Backend** sau khi thay đổi để có hiệu lực.
Không dùng `AllowAnyOrigin` hay tắt HTTPS để chữa lỗi kết nối. Trên điện thoại
thật, Expo Go cần API truy cập được qua LAN và chứng chỉ tin cậy trên thiết bị.

Cả hai lệnh Owner Web dùng chung code frontend; flag `BHOME_WEB_HTTPS=true`
chỉ được đặt trong process Vite chạy cổng 5176. API vẫn chạy trên HTTPS 7240.
Nếu port đã có process lắng nghe, đóng process cũ hợp lệ trước khi chạy lại,
không khởi động hai API trên cùng cổng.

## Thành phần và URL local

| Thành phần           | URL/cổng mặc định                                                                  | Ghi chú                                                                        |
| -------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| PostgreSQL Docker    | `127.0.0.1:5434`                                                                   | `POSTGRES_PORT`, cũng phải khớp connection string; máy cũ có thể giữ port khác |
| MinIO API / Console  | `127.0.0.1:9000` / [localhost:9001](http://localhost:9001)                         | Tạo bucket private `bhome-private` nếu chưa có                                 |
| Mailpit SMTP / Inbox | `127.0.0.1:1025` / [localhost:8025](http://localhost:8025)                         | Thư chỉ được capture tại máy local                                             |
| Backend              | [https://localhost:7240/health/ready](https://localhost:7240/health/ready)         | HTTP 200 khi database và schema sẵn sàng                                       |
| Owner Web            | [http://localhost:5173](http://localhost:5173)                                     | Quản lý, reset password, nhận lời mời, xác minh email                          |
| Ký hợp đồng local    | [https://localhost:5176/contract-signing](https://localhost:5176/contract-signing) | Trang ký OTP HTTPS riêng                                                       |

Docker Compose công bố **chỉ loopback**; từ mạng LAN hoặc Internet không truy cập
được Mailpit/PostgreSQL/MinIO bằng các cổng này. Cấu hình `Email__DeliveryMode=Capture`
bật MailKit gửi SMTP không TLS/không đăng nhập **chỉ** khi hostname SMTP là
`localhost` hoặc IP loopback trong Development/Testing. SMTP có xác thực ngoài
Development vẫn dùng `DeliveryMode=Smtp` và STARTTLS; khi chọn Capture ở Production,
adapter không cho phép gửi. Username/AppPassword cũ lưu ở User Secrets không được
gửi tới Mailpit.

Profile local bật `NotificationChannels__Enabled=true` và
`NotificationChannels__AutomationEnabled=true` để email mời/OTP thực sự xuất
hiện trong Mailpit. `Jobs__Enabled=false` giữ các job nghiệp vụ tài chính tắt;
`SePay__Enabled=false` tắt webhook/polling thanh toán local.
`ContractSigning__Methods__Otp=true` và `ViettelMySign=false` để test luồng ký
nội bộ. Kết quả ký OTP local là bằng chứng kiểm thử chức năng; không thay thế chữ
ký số qua nhà cung cấp chứng thư được chấp nhận cho Production.

## Các liên kết trong email

- Reset mật khẩu: `http://localhost:5173/reset-password`
- Mời thiết lập tài khoản: `http://localhost:5173/accept-invitation`
- Xác minh email: `http://localhost:5173/confirm-email`
- Mời ký hợp đồng nội bộ: `https://localhost:5176/contract-signing#token=...`
- Trang mở hợp đồng cho tài khoản đã có: `https://localhost:7240/open/sign-contract`

Chỉ mở những URL localhost đó trên **chính máy đang chạy ứng dụng**.
Nếu người nhận mở từ điện thoại/máy khác, `localhost` trỏ về thiết bị của họ;
chuyển sang địa chỉ HTTPS được phê duyệt cho kịch bản liên thiết bị. Không tiếp
tục dùng Cloudflare để thử trên cùng máy. Sau khi đổi callback, **khởi động lại
Backend và tạo email mời mới**; email đã gửi không tự thay URL.

Khi kiểm tra email, mở Mailpit Inbox trên `http://localhost:8025`, chọn thư
và nhấn link. Thư chứa token/OTP test, nên không chia sẻ nội dung Inbox hoặc ảnh
chụp thư có token. Mailpit không gửi thư tới hộp thư Gmail thật.

## Kiểm tra và xử lý lỗi

```powershell
docker compose --env-file .env config --quiet
docker compose ps
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Initialize-TeamEnvironment.ps1 -CheckOnly -SkipNetworkChecks
```

Nếu script báo thiếu cặp `.tools/team-tls/localhost.*`, chạy lại
`Initialize-TeamEnvironment.ps1 -SkipNetworkChecks` để tạo PEM. Nếu cặp chứng
chỉ chỉ còn một file, kiểm tra và xử lý thủ công trên máy đó, script không ghi
đè một nửa cặp khóa. Nếu `/health/ready` trả 503, kiểm tra port PostgreSQL,
`docker compose ps` và `Update-LocalDatabase.ps1 -Check`; không reset dữ liệu
để chữa lỗi mạng. Nếu không có thư trong Mailpit, kiểm tra Docker Mailpit,
`Email__DeliveryMode=Capture`, `NotificationChannels__Enabled=true` và trạng
thái notification trong API. Nếu Vite HTTPS lỗi chứng chỉ, kiểm tra trust của
ASP.NET dev-certs và hai file PEM; không tắt kiểm tra TLS của Vite API proxy.

Đối chiếu kết quả kiểm thử và các giới hạn còn lại tại
[BHOME_ENVIRONMENT_VALIDATION.md](BHOME_ENVIRONMENT_VALIDATION.md).
