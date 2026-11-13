# SEP490-G92-BHOME

BHOME - Nền tảng quản lý và vận hành chuỗi nhà trọ thông minh.

Project hiện có nền tảng backend ASP.NET Core 8, ba ứng dụng React/TypeScript và API đăng nhập
Identity/JWT cho tài khoản đã tồn tại, phiên phía server, refresh xoay vòng, đăng xuất và đổi mật khẩu.
Owner Web/Mobile có màn hình đăng nhập. Các luồng nghiệp vụ, tạo/kích hoạt tài khoản và tích hợp
nhà cung cấp bên ngoài chưa hoàn thiện. Migration không tạo tài khoản demo.

Database phát triển hiện dùng **Compact24: 24 bảng, 383 cột, 83 FK**. Sau khi cấu hình `.env`
và bật PostgreSQL local, chạy API ở Development sẽ tự tạo database `bhome` nếu thiếu và dựng schema
nếu trống. Những lần chạy sau giữ nguyên dữ liệu. Có thể dùng PostgreSQL 16 qua Docker hoặc native
PostgreSQL qua pgAdmin. Xem [hướng dẫn database](docs/database/2026-11-03/README.md).

Nhóm dùng Neon đọc [thiết lập Neon](docs/database/NEON_SETUP.md),
[hướng dẫn 5 thành viên](docs/database/TEAM_DATABASE_GUIDE.md),
[quy trình schema/migration](docs/database/DATABASE_MIGRATION_WORKFLOW.md) và
[kết quả kiểm chứng](docs/database/DATABASE_VERIFICATION.md). Dùng `.env.neon` riêng,
tắt khởi tạo schema/worker trên laptop và giữ `.env` cho local. Shared development
đã bootstrap Compact24, có EF baseline/history riêng và đã kiểm chứng API bằng hai process.
35 EF migrations của `BHomeDbContext` thuộc schema nguồn cũ; migrations runtime
Compact24 dùng history trong `bhome_meta`. MinIO giữ local theo phạm vi đã chốt;
storage liên máy để giai đoạn sau.

## Hướng dẫn nhanh khi mới clone

Để test Authentication bằng Postman hoặc giao diện, làm theo
[hướng dẫn test bằng tay](docs/development/MANUAL_AUTH_TESTING.md). Có công cụ tạo ba tài khoản
tổng hợp local bằng Identity và collection Postman 30 request; bạn tự đặt mật khẩu ở prompt ẩn.

Hướng dẫn dùng **Windows PowerShell**, chạy lệnh tại **thư mục gốc repository** sau khi clone.
Các port bên dưới là giá trị local mặc định.

| Bước | Việc cần làm                                     | Lệnh hoặc kết quả                                                                                             |
| ---- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| 1    | Cài công cụ, bật Docker Desktop với Linux engine | .NET SDK 8 (8.0.400 trở lên trong nhánh 8.x), Node 22.13+ thuộc nhánh 22.x, npm 10+                           |
| 2    | Tạo `.env` riêng cho máy mới                     | `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Initialize-Local.ps1`                            |
| 3    | Cài dependency và tin cậy HTTPS local            | `dotnet restore src/backend/BHome.sln`, `dotnet tool restore`, `npm.cmd ci`, `dotnet dev-certs https --trust` |
| 4    | Chạy PostgreSQL và MinIO                         | `docker compose up -d --build`; kiểm tra `docker compose ps`                                                  |
| 5    | Chuẩn bị Compact24                               | API tự tạo schema; nếu máy còn 70 bảng cũ, chạy một lần `scripts/Update-LocalDatabase.ps1 -RecreateDatabase`  |
| 6    | Tạo bucket lưu trữ                               | Vào `http://localhost:9001`, tạo bucket private `bhome-private`                                               |
| 7    | Tạo cấu hình frontend                            | Copy `.env.example` thành `.env.local` trong từng ứng dụng; API mặc định `https://localhost:7240`             |
| 8    | Chạy API và frontend ở các terminal riêng        | Dùng `Start-Api.ps1` và lệnh `npm.cmd run dev --workspace ...` bên dưới                                       |
| 9    | Kiểm tra                                         | Mở Swagger, `/health/ready` và frontend tương ứng                                                             |

## 1. Chuẩn bị môi trường

- **.NET SDK 8**: phiên bản 8.0.400 hoặc bản 8.x mới hơn; chỉ cài .NET 9/10 sẽ không đáp ứng `global.json`.
- **Node.js 22.13+ thuộc nhánh 22.x**, **npm 10+**.
- **Docker Desktop**, bật Linux engine để chạy PostgreSQL, MinIO và các test dùng container.
- Android Studio/JDK chỉ cần khi phát triển mobile native Android; iOS cần macOS và Xcode.
  Chạy mobile trên trình duyệt chưa cần công cụ native.

Kiểm tra sau khi cài:

```powershell
dotnet --list-sdks
node --version
npm.cmd --version
docker compose version
```

Phát triển thanh toán SePay: xem [hướng dẫn Sandbox cho team](docs/development/SEPAY_TEAM_SETUP.md)
để tạo profile/database riêng, seed Invoice tổng hợp, chạy webhook/polling và kiểm tra trước khi tạo PR.
Không sao chép token, webhook secret, database hoặc `.tmp` của thành viên khác.

Thư mục `.tools/` trên máy khởi tạo không được lưu trong Git. Thành viên mới cần tự cài công cụ.
Nếu đã có bộ công cụ portable trong `.tools/`, nạp PATH cho phiên PowerShell hiện tại bằng
`. ./scripts/Use-LocalTools.ps1`.

## 2. Tạo và kiểm tra cấu hình local

Chạy **một lần** sau khi clone:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Initialize-Local.ps1
```

Script tạo `.env` từ `.env.example`, sinh mật khẩu PostgreSQL, MinIO và JWT key ngẫu nhiên,
đồng thời điền thông tin tương ứng cho backend. Script từ chối ghi đè nếu `.env` đã tồn tại.
Mỗi thành viên dùng cấu hình local riêng; không cần nhận file `.env` của người khác.

Có thể tự copy `.env.example` thành `.env` thay cho script, nhưng phải thay các placeholder
PostgreSQL, JWT và storage trước khi chạy. Placeholder tích hợp bên ngoài có thể giữ nguyên
vì adapter chưa được triển khai.

| Nhóm                   | Biến trong `.env`                                                                      | Cách cấu hình                                                                      |
| ---------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| PostgreSQL             | `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_PORT`                   | Database, tài khoản, mật khẩu và port Docker công bố; mặc định port `5432`         |
| Kết nối API → database | `ConnectionStrings__Database`                                                          | Host, port, database, username và password phải khớp PostgreSQL đang dùng          |
| JWT                    | `Jwt__SigningKey`                                                                      | Khóa ngẫu nhiên tối thiểu 32 byte; script đã sinh sẵn                              |
| MinIO                  | `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `MINIO_API_PORT`, `MINIO_CONSOLE_PORT`       | Tài khoản local và port; mặc định API `9000`, console `9001`                       |
| Kết nối API → MinIO    | `ObjectStorage__Endpoint`, `ObjectStorage__AccessKey`, `ObjectStorage__SecretKey`      | Endpoint mặc định `localhost:9000`; script dùng tài khoản MinIO local vừa tạo      |
| Bucket và SSL          | `ObjectStorage__Bucket`, `ObjectStorage__UseSsl`                                       | Mặc định `bhome-private`, `false`; bucket phải tạo thủ công                        |
| CORS                   | `Cors__AllowedOrigins__0`, `Cors__AllowedOrigins__1`, `Cors__AllowedOrigins__2`        | Mặc định `http://localhost:5173`, `http://localhost:5174`, `http://localhost:5175` |
| Background jobs        | `Jobs__Enabled`                                                                        | Giữ `false` khi bắt đầu                                                            |
| Tích hợp bên ngoài     | `BankIntegration__*`, `NotificationIntegration__*`, `ElectronicContractIntegration__*` | Chưa cần cấu hình để chạy local; chỉ thêm API key không tự kích hoạt provider      |

**Nếu port `5432` đã được sử dụng:** đổi `POSTGRES_PORT=5433` và sửa `Port=5433` trong
`ConnectionStrings__Database` trước khi khởi tạo Docker. Nếu đổi port MinIO API, sửa cả
`ObjectStorage__Endpoint` cho khớp.

Các file `.env`, `.env.local`, `.env.compose` tại thư mục gốc là cấu hình riêng từng máy,
không được Git phân phối. Hướng dẫn này mặc định dùng `.env`. Không commit file chứa
mật khẩu/token; các biến `VITE_*` hiển thị công khai trong trình duyệt, không chứa secret.

## 3. Cài dependency và chạy dịch vụ dữ liệu

```powershell
dotnet dev-certs https --trust
dotnet restore src/backend/BHome.sln
dotnet tool restore
npm.cmd ci

docker compose config --quiet
docker compose up -d --build
docker compose ps
```

Chấp nhận yêu cầu tin cậy chứng chỉ HTTPS nếu hệ điều hành hiển thị. `npm.cmd ci` cài dependency
cho tất cả workspace từ lockfile gốc; không cần cài riêng trong từng app. Dùng `npm.cmd` để tránh
lỗi execution policy của `npm.ps1` trên Windows.

Docker Compose chỉ chạy **PostgreSQL và MinIO**; API và frontend chạy riêng ở các bước sau.
Lần đầu build MinIO từ source có thể mất vài phút và cần kết nối mạng. Chờ cả hai service
hiển thị `healthy` trong `docker compose ps` trước khi tiếp tục.

## 4. Database Compact24 và bucket

Không cần chạy `dotnet ef database update` khi pull code. Backend Development tự khởi tạo
Compact24 trước khi nhận request hoặc chạy worker, chỉ cho PostgreSQL loopback và database `bhome`.
Tài khoản PostgreSQL cần quyền tạo database khi database chưa tồn tại, cùng quyền tạo extension
`btree_gist` trong database của mình. Nếu dùng Docker, role/database từ `.env` được tạo khi volume
PostgreSQL khởi tạo lần đầu. Nếu dùng PostgreSQL native, sửa connection trong `.env` cho đúng máy.

**Thành viên đang dùng database 70 bảng cũ:** chạy một lần:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Update-LocalDatabase.ps1 -RecreateDatabase
```

Lệnh giữ toàn bộ database cũ dưới tên `bhome_legacy_<UTC timestamp>_<suffix>`, kiểm schema mới
trước khi đổi tên thành `bhome`, không DROP dữ liệu cũ. Tài khoản/hợp đồng/hóa đơn cũ vẫn nằm trong
bản dự phòng; database mới bắt đầu trống. Không dùng lệnh này để reset database đã là Compact24:
trường hợp đó công cụ giữ nguyên dữ liệu. Khởi động API bình thường sẽ từ chối schema cũ, không
tự archive hoặc xóa dữ liệu.

Kiểm tra không ghi dữ liệu: `scripts/Update-LocalDatabase.ps1 -Check`. Khởi tạo trước khi mở IDE
nếu muốn: chạy cùng script không có switch. Runtime Production/Testing không tự tạo database.
Tạo tài khoản test tổng hợp một lần bằng `scripts/New-LocalTestUsers.ps1` và nhập mật khẩu riêng
ở prompt ẩn. Không có mật khẩu dùng chung được commit vào Git.

Muốn có dữ liệu mẫu để phát triển, chạy `scripts/Seed-LocalDevelopmentData.ps1` sau khi schema
sẵn sàng. Công cụ tạo bốn account `*.sample@example.invalid`, cơ sở/phòng/đồng hồ/biểu phí và công việc;
chạy lại giữ nguyên dữ liệu. Thêm `-SetSamplePasswords` để chọn lại mật khẩu các account mẫu.
Xem [hướng dẫn seed](docs/database/2026-11-03/README.md) và
[danh mục API, trạng thái nối frontend/backend](docs/api/API_IMPLEMENTATION_STATUS.md).

Tiếp theo:

1. Mở `http://localhost:9001` (hoặc console port đã cấu hình).
2. Đăng nhập bằng `MINIO_ROOT_USER` và `MINIO_ROOT_PASSWORD` trong `.env` của máy mình.
3. Tạo bucket **private** tên `bhome-private`, khớp `ObjectStorage__Bucket`.

Storage adapter không tự tạo bucket. Tài khoản root MinIO do script cấu hình chỉ phục vụ local;
môi trường triển khai cần tài khoản storage được giới hạn quyền.

## 5. Chạy backend

Mở một terminal tại thư mục gốc:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Start-Api.ps1
```

Script nạp cấu hình backend từ `.env` vào process chạy API. Development cũng đọc `.env` ở repository
khi chạy trực tiếp `dotnet run --project src/backend/BHome.Api` hoặc F5, với độ ưu tiên thấp hơn
user-secrets, process environment và CLI arguments. Script hỗ trợ `-EnvironmentFile` để chọn file
riêng. Không tự đọc `.env` hoặc khởi tạo database trong Production/Testing. Xem
[hướng dẫn local chi tiết](docs/development/LOCAL_DEVELOPMENT.md).

## 6. Cấu hình và chạy frontend

Copy các file dưới đây **một lần**, khi chưa có `.env.local` trong từng app:

```powershell
Copy-Item src/owner-web/.env.example src/owner-web/.env.local
Copy-Item src/public-web/.env.example src/public-web/.env.local
```

Mặc định hai ứng dụng web đều có:

```dotenv
VITE_API_BASE_URL=https://localhost:7240
```

Mỗi frontend cần chạy dùng **một terminal riêng**, tại thư mục gốc:

```powershell
# Terminal Owner Web
npm.cmd run dev --workspace @bhome/owner-web
```

```powershell
# Terminal Mobile (Expo Go)
npm.cmd run mobile:dev
```

```powershell
# Terminal Public Web
npm.cmd run dev --workspace @bhome/public-web
```

Mobile dùng Expo Router, đã kết nối đăng nhập email và luồng OCR với backend.
Lệnh `npm.cmd run mobile:dev` tự chọn IP, chuẩn bị HTTPS, dùng lại hoặc mở API rồi chạy Expo.
Quét QR trên điện thoại cùng mạng. Launcher mặc định tự chọn IP LAN cho cả Metro và API,
không cần nhập IP hoặc dựa vào `.local`. Sau khi Metro chạy, launcher kiểm tra `/status` và
manifest iOS; kết quả từ máy tính không thay thế kiểm tra kết nối trên điện thoại.
Máy mới tự tải OCR models còn thiếu qua script kiểm checksum.
Để dùng qua 4G/5G hoặc Wi-Fi khác mạng máy chủ, cấu hình `EXPO_PUBLIC_API_BASE_URL`
bằng địa chỉ API HTTPS công khai; xem hướng dẫn bên dưới.
Các thành viên dùng cùng lệnh trên máy riêng. Điện thoại cần tin cậy CA của từng máy một lần.
Xem [hướng dẫn kết nối tự động](docs/development/MOBILE_NETWORK_DEVELOPMENT.md).
Xem [thiết lập Mobile cho các máy trong team](docs/development/MOBILE_TEAM_DEVELOPMENT.md).
Nếu quét QR bị kẹt trước màn đăng nhập, xem [kiểm tra đường tới Metro](docs/development/MOBILE_QR_LOADING_FIX.md).
Trên Windows, `npm.cmd run mobile` từ root hoặc `npm.cmd start` trong `src/mobile` cũng chạy
luồng API + HTTPS + Metro này; hỗ trợ `-- --clear` và `-- --port 8082`.
`npm.cmd run mobile -- --metro-only` và `npx expo start` chỉ mở Metro;
dùng khi chủ động chuẩn bị API/HTTPS riêng.

Chỉ cần chạy frontend đang làm việc. Với hai ứng dụng web, nếu thay API URL, cập nhật
`VITE_API_BASE_URL` rồi khởi động lại Vite. Production build cần cấu hình rõ biến này bằng địa chỉ
HTTPS của API triển khai. Khi tích hợp mobile với API trên điện thoại thật, dùng địa chỉ HTTPS mà
thiết bị truy cập được và chứng chỉ được tin cậy; `localhost` trên điện thoại trỏ về chính điện thoại.

## 7. Địa chỉ kiểm tra

| Thành phần    | Địa chỉ mặc định                    | Kết quả cần kiểm tra                                                    |
| ------------- | ----------------------------------- | ----------------------------------------------------------------------- |
| Swagger API   | https://localhost:7240/swagger      | Mở được tài liệu API                                                    |
| API liveness  | https://localhost:7240/health/live  | API đang chạy                                                           |
| API readiness | https://localhost:7240/health/ready | HTTP 200 khi PostgreSQL kết nối được và schema Compact24 đúng phiên bản |
| Owner Web     | http://localhost:5173               | Mở được ứng dụng                                                        |
| Mobile Expo   | Địa chỉ và mã QR trong terminal     | Expo Go tải được ứng dụng demo                                          |
| Public Web    | http://localhost:5175               | Mở được ứng dụng                                                        |
| MinIO Console | http://localhost:9001               | Đăng nhập được và có bucket private `bhome-private`                     |

API hỗ trợ login/refresh/logout/logout-all/me/change-password và lõi reset mật khẩu.
Chưa có tài khoản demo hay luồng tạo/kích hoạt tài khoản. Gửi email reset/MFA và lưu token native
an toàn còn cần tích hợp. Owner Web dùng cookie Secure nên cần HTTPS và cùng site với API;
đặt `AuthWeb__AllowedOrigins__0` đúng origin Owner Web (khác với danh sách CORS chung). Xem
[hợp đồng API đăng nhập](docs/api/API_CONVENTIONS.md#existing-account-login) và
[báo cáo kiểm toán bảo mật](docs/development/AUTH_SECURITY_AUDIT.md).

## Những lần chạy tiếp theo

- Bật Docker Desktop, chạy `docker compose up -d` tại thư mục gốc.
- Chạy backend như mục 5 và frontend cần dùng như mục 6.
- Sau khi pull code: chạy `npm.cmd ci` nếu lockfile thay đổi, restore .NET khi dependency thay đổi,
  cập nhật các biến mới từ `.env.example` và chạy API. Development tự kiểm/khởi tạo Compact24;
  schema legacy cần lệnh archive một lần theo mục 4, không áp dụng lại EF migrations cũ.
- Dừng API/frontend bằng `Ctrl+C`; dừng dịch vụ dữ liệu bằng `docker compose stop` để giữ dữ liệu.

## Xử lý lỗi thường gặp

| Lỗi                              | Cách kiểm tra                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Không tìm thấy .NET SDK phù hợp  | `dotnet --list-sdks` phải có SDK 8 đáp ứng `global.json`                                                      |
| Docker không kết nối được        | Bật Docker Desktop, chờ Linux engine sẵn sàng                                                                 |
| Port PostgreSQL bị chiếm         | Đổi `POSTGRES_PORT` và port trong connection string cho khớp; không cần xóa database cũ                       |
| PostgreSQL báo sai mật khẩu      | Kiểm tra connection string; thay mật khẩu trong `.env` không tự đổi mật khẩu database đã tồn tại trong volume |
| Schema cũ hoặc không tương thích | Chạy `Update-LocalDatabase.ps1 -Check`; chỉ dùng `-RecreateDatabase` để archive schema legacy đã nhận diện    |
| API báo thiếu cấu hình           | Dùng `Start-Api.ps1`; kiểm tra `.env` có connection string và JWT key hợp lệ                                  |
| `/health/ready` trả HTTP 503     | Kiểm tra PostgreSQL, connection string và schema Compact24 bằng lệnh `-Check`                                 |
| Frontend không gọi được API      | Kiểm tra API đang chạy, chứng chỉ HTTPS được tin cậy, `VITE_API_BASE_URL` và CORS đúng origin                 |
| Upload/download lỗi              | Kiểm tra MinIO, endpoint, access key/secret key và bucket private đã tạo                                      |

## Kiến trúc và cấu trúc thư mục

Ba client React/TypeScript gọi một API ASP.NET Core 8 qua HTTPS/REST/JSON. Backend theo luồng
Controller → Application Service → Data Access → Data, dùng PostgreSQL, MinIO/S3 và các boundary
cho background jobs, OCR và tích hợp bên ngoài.

```text
src/backend/
  BHome.sln
  BHome.Api/             HTTP, phân quyền, health, OpenAPI
  BHome.Application/     Use case và hợp đồng ứng dụng
  BHome.Domain/          Định nghĩa domain
  BHome.Infrastructure/  EF/Identity/JWT, storage, jobs, integration adapters
src/owner-web/           React + Vite + Ant Design
src/mobile/              Expo + React Native
src/public-web/          React + Vite
packages/client-core/    API/auth/localization dùng chung
tests/                  Test backend và client
docs/                   Tài liệu kiến trúc, phát triển và API
deploy/docker/          Dockerfile và cấu hình triển khai
scripts/                Script cấu hình và kiểm tra local
.github/workflows/      CI cho pull request
```

## Kiểm tra chất lượng trước khi tạo PR

```powershell
dotnet build src/backend/BHome.sln
dotnet test src/backend/BHome.sln --filter "Category!=Docker"
# Khi Docker đang chạy: chạy toàn bộ test, gồm PostgreSQL container test
dotnet test src/backend/BHome.sln
dotnet format src/backend/BHome.sln --verify-no-changes
npm.cmd run lint
npm.cmd test
npm.cmd run build
npm.cmd run format:check
docker compose --env-file .env.example config --quiet
```

Dùng `npm.cmd run format` và `dotnet format src/backend/BHome.sln` để áp dụng định dạng.
Trên Windows, `scripts/Validate.ps1` chạy các kiểm tra; thêm `-IncludeDockerTests` để chạy test
container. CI chạy đầy đủ các test container. Kết quả kiểm tra trước đây được ghi tại
[VALIDATION.md](docs/development/VALIDATION.md).

## Tài liệu cho team

- [Kiến trúc và quyết định kỹ thuật](docs/architecture/ARCHITECTURE.md)
- [Phân chia module](docs/architecture/MODULES.md)
- [Quy ước API](docs/api/API_CONVENTIONS.md)
- [Phát triển local và mobile](docs/development/LOCAL_DEVELOPMENT.md)
- [Vận hành background jobs](docs/development/BACKGROUND_JOBS.md)
- [Cấu hình triển khai](deploy/docker/README.md)
- [Quy trình đóng góp](CONTRIBUTING.md)
