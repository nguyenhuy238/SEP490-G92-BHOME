# SEP490-G92-BHOME

BHOME - Nền tảng quản lý và vận hành chuỗi nhà trọ thông minh.

Project hiện có nền tảng backend ASP.NET Core 8, ba ứng dụng React/TypeScript và API đăng nhập
Identity/JWT cho tài khoản đã tồn tại. Các luồng nghiệp vụ, tạo/kích hoạt tài khoản, màn hình đăng
nhập và tích hợp nhà cung cấp bên ngoài chưa hoàn thiện. Migration không tạo tài khoản demo.

## Hướng dẫn nhanh khi mới clone

Hướng dẫn dùng **Windows PowerShell**, chạy lệnh tại **thư mục gốc repository** sau khi clone.
Các port bên dưới là giá trị local mặc định.

| Bước | Việc cần làm                                     | Lệnh hoặc kết quả                                                                                             |
| ---- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| 1    | Cài công cụ, bật Docker Desktop với Linux engine | .NET SDK 8 (8.0.400 trở lên trong nhánh 8.x), Node 22.13+ thuộc nhánh 22.x, npm 10+                           |
| 2    | Tạo `.env` riêng cho máy mới                     | `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Initialize-Local.ps1`                            |
| 3    | Cài dependency và tin cậy HTTPS local            | `dotnet restore src/backend/BHome.sln`, `dotnet tool restore`, `npm.cmd ci`, `dotnet dev-certs https --trust` |
| 4    | Chạy PostgreSQL và MinIO                         | `docker compose up -d --build`; kiểm tra `docker compose ps`                                                  |
| 5    | Tạo bảng database                                | Nạp connection string từ `.env`, rồi chạy migration theo mục 4 bên dưới                                       |
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

## 4. Áp dụng migration và tạo bucket

Trong PowerShell tại thư mục gốc, đọc connection string từ `.env` vào biến môi trường rồi chạy EF:

```powershell
$connectionLine = Get-Content .env |
    Where-Object { $_ -like 'ConnectionStrings__Database=*' }

$env:ConnectionStrings__Database = $connectionLine.Substring('ConnectionStrings__Database='.Length)

dotnet ef database update --project src/backend/BHome.Infrastructure --startup-project src/backend/BHome.Api
```

Migration tạo các bảng Identity, ba role cố định và bảng background jobs; không tạo user hoặc
dữ liệu nghiệp vụ mẫu. API không tự chạy migration khi khởi động. Chạy lại lệnh này sau khi pull
code có migration mới; nếu mở terminal mới, cần nạp lại connection string như trên.

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

Script nạp cấu hình backend từ `.env` vào process chạy API. **`dotnet run` không tự đọc `.env`.**
Nếu tự chạy `dotnet run --project src/backend/BHome.Api`, phải cấu hình biến môi trường hoặc
.NET user-secrets trước; xem [hướng dẫn local chi tiết](docs/development/LOCAL_DEVELOPMENT.md).

## 6. Cấu hình và chạy frontend

Copy các file dưới đây **một lần**, khi chưa có `.env.local` trong từng app:

```powershell
Copy-Item src/owner-web/.env.example src/owner-web/.env.local
Copy-Item src/mobile/.env.example src/mobile/.env.local
Copy-Item src/public-web/.env.example src/public-web/.env.local
```

Mặc định cả ba file đều có:

```dotenv
VITE_API_BASE_URL=https://localhost:7240
```

Mỗi frontend cần chạy dùng **một terminal riêng**, tại thư mục gốc:

```powershell
# Terminal Owner Web
npm.cmd run dev --workspace @bhome/owner-web
```

```powershell
# Terminal Mobile trên trình duyệt
npm.cmd run dev --workspace @bhome/mobile
```

```powershell
# Terminal Public Web
npm.cmd run dev --workspace @bhome/public-web
```

Chỉ cần chạy frontend đang làm việc. Nếu thay API URL, cập nhật `VITE_API_BASE_URL` rồi khởi động
lại Vite. Khi chạy trên điện thoại thật, dùng địa chỉ HTTPS mà thiết bị truy cập được và chứng chỉ
được tin cậy; `localhost` trên điện thoại trỏ về chính điện thoại. Xem
[hướng dẫn mobile native](docs/development/LOCAL_DEVELOPMENT.md#capacitor-platforms).
Production build cần cấu hình rõ `VITE_API_BASE_URL` bằng địa chỉ HTTPS của API triển khai.

## 7. Địa chỉ kiểm tra

| Thành phần     | Địa chỉ mặc định                    | Kết quả cần kiểm tra                                              |
| -------------- | ----------------------------------- | ----------------------------------------------------------------- |
| Swagger API    | https://localhost:7240/swagger      | Mở được tài liệu API                                              |
| API liveness   | https://localhost:7240/health/live  | API đang chạy                                                     |
| API readiness  | https://localhost:7240/health/ready | HTTP 200 khi kết nối database được và migration đã áp dụng đầy đủ |
| Owner Web      | http://localhost:5173               | Mở được ứng dụng                                                  |
| Mobile browser | http://localhost:5174               | Mở được ứng dụng                                                  |
| Public Web     | http://localhost:5175               | Mở được ứng dụng                                                  |
| MinIO Console  | http://localhost:9001               | Đăng nhập được và có bucket private `bhome-private`               |

API hiện hỗ trợ `POST /api/v1/auth/login` cho tài khoản Identity đã tồn tại. Chưa có tài khoản demo,
luồng tạo/kích hoạt tài khoản hoặc màn hình đăng nhập; xem
[hợp đồng API đăng nhập](docs/api/API_CONVENTIONS.md#existing-account-login) và
[báo cáo kiểm tra ngày 28/10](docs/development/SPRINT_2_AUDIT.md).

## Những lần chạy tiếp theo

- Bật Docker Desktop, chạy `docker compose up -d` tại thư mục gốc.
- Chạy backend như mục 5 và frontend cần dùng như mục 6.
- Sau khi pull code: chạy `npm.cmd ci` nếu lockfile thay đổi, restore .NET khi dependency thay đổi,
  cập nhật các biến mới từ `.env.example` và chạy migration nếu có migration mới.
- Dừng API/frontend bằng `Ctrl+C`; dừng dịch vụ dữ liệu bằng `docker compose stop` để giữ dữ liệu.

## Xử lý lỗi thường gặp

| Lỗi                             | Cách kiểm tra                                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Không tìm thấy .NET SDK phù hợp | `dotnet --list-sdks` phải có SDK 8 đáp ứng `global.json`                                                      |
| Docker không kết nối được       | Bật Docker Desktop, chờ Linux engine sẵn sàng                                                                 |
| Port PostgreSQL bị chiếm        | Đổi `POSTGRES_PORT` và port trong connection string cho khớp; không cần xóa database cũ                       |
| PostgreSQL báo sai mật khẩu     | Kiểm tra connection string; thay mật khẩu trong `.env` không tự đổi mật khẩu database đã tồn tại trong volume |
| EF yêu cầu connection string    | Nạp `ConnectionStrings__Database` trong cùng terminal chạy migration theo mục 4                               |
| API báo thiếu cấu hình          | Dùng `Start-Api.ps1`; kiểm tra `.env` có connection string và JWT key hợp lệ                                  |
| `/health/ready` trả HTTP 503    | Kiểm tra PostgreSQL đang chạy, thông tin kết nối và migration đã áp dụng                                      |
| Frontend không gọi được API     | Kiểm tra API đang chạy, chứng chỉ HTTPS được tin cậy, `VITE_API_BASE_URL` và CORS đúng origin                 |
| Upload/download lỗi             | Kiểm tra MinIO, endpoint, access key/secret key và bucket private đã tạo                                      |

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
src/mobile/              React + Vite + Capacitor
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
