# Đối chiếu môi trường local chung — 19/11/2026

Phạm vi: cấu hình Team Development cho PostgreSQL/MinIO/Mailpit, email capture
localhost, callback trang tài khoản và ký hợp đồng OTP; không thay đổi database,
secrets thật, Staging hoặc Production. Các kiểm thử bên dưới có giá trị tại
thời điểm chạy trên máy Windows phát triển, không thay cho browser E2E với tài
khoản Owner/Tenant thật.

| Kiểm tra                                                                                                                                                        | Trạng thái                            | Bằng chứng                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docker compose --env-file .env.example config --quiet`                                                                                                         | PASS                                  | Cú pháp Compose hợp lệ; ba dịch vụ PostgreSQL, MinIO, Mailpit                                                                                                    |
| `Initialize-TeamEnvironment.ps1 -CheckOnly -SkipNetworkChecks -EnvironmentFile .env.example`                                                                    | PASS                                  | Profile ví dụ khớp yêu cầu và không ghi file                                                                                                                     |
| `Test-TeamEnvironment.ps1`                                                                                                                                      | PASS                                  | Fixture tổng hợp: phát hiện drift, bảo toàn secret, đưa SMTP về loopback, xóa Cloudflare managed origin, chạy lại idempotent, chặn duplicate key và lệch port DB |
| `dotnet test tests/backend/BHome.IntegrationTests/BHome.IntegrationTests.csproj --filter FullyQualifiedName~EmailTransportTests --no-restore --verbosity quiet` | PASS                                  | 28/28 test, gồm capture loopback, chặn Production, và SMTP giả lập không auth/TLS                                                                                |
| `dotnet dev-certs https --export-path <fixture>/localhost.crt --format Pem --no-password --quiet`                                                               | PASS                                  | Tạo đúng `localhost.crt` và `localhost.key` trên Windows .NET 8, fixture tạm đã xóa                                                                              |
| Gửi một lời mời ký bằng API đang chạy và xem Inbox Mailpit                                                                                                      | NOT RUN trong phạm vi kiểm thử script | Cần API, Docker daemon, database và người kiểm thử mở link qua UI                                                                                                |
| E2E Owner HTTP 5173 → Anonymous Signing HTTPS 5176 → xác nhận                                                                                                   | NOT RUN trong phạm vi kiểm thử script | Kiểm tra bằng browser khi cả hai Vite listener và API đã khởi động                                                                                               |

Trong lần chạy `docker compose ps` của worker kiểm thử, Docker Desktop Linux
engine trả HTTP 500 qua local named pipe nên chưa xác nhận container Mailpit hoạt
động. Kiểm tra cấu hình Compose vẫn PASS vì không cần daemon. Sau khi Docker
Desktop khỏe và API chạy, cần gửi một email tổng hợp thật tới Mailpit để xác
nhận toàn bộ luồng.

## Kiểm thử bổ sung trên máy Development

- `scripts/Initialize-TeamEnvironment.ps1 -CheckOnly -SkipNetworkChecks`:
  **PASS**, không thay đổi `.env` hiện tại.
- `scripts/Start-TeamOwnerWeb.ps1 -SigningHttps`: **PASS**, Vite mở đúng
  `https://localhost:5176` và `Invoke-WebRequest
https://localhost:5176/contract-signing` trả **HTTP 200** với chứng chỉ TLS
  được Windows xác minh; không tắt kiểm tra chứng chỉ.
- `AnonymousSigningUrlTests`: **6/6 PASS**; `InternalSigningPanel.test.tsx`:
  **8/8 PASS** (jsdom phát cảnh báo canvas chưa mô phỏng, không làm fail test).
- `SePaySecurityTests`: **19/19 PASS**; Staging chỉ có thể cấu hình Sandbox/Test,
  Production từ chối chế độ Test khi SePay được bật.
- `dotnet build src/backend/BHome.sln --no-restore`: **PASS**, 0 lỗi và
  0 cảnh báo; `git diff --check`: **PASS**.
- `docker info` / `docker version` vẫn nhận HTTP **500** qua
  `dockerDesktopLinuxEngine`, kể cả khi giảm Docker API version; chưa có bằng
  chứng thực tế SMTP Mailpit nhận thư hoặc ghi chữ ký vào PostgreSQL.

Ghi chú: Email Capture chỉ phản ánh SMTP đã nhận vào inbox local; không xác
nhận email tới nhà cung cấp bên ngoài. Signing OTP Development là luồng kiểm
thử ký nội bộ và không phải chữ ký số Viettel MySign có giá trị pháp lý.
