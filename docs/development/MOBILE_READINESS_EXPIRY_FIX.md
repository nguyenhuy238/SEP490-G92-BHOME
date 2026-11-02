# Sửa lỗi mobile readiness và nhắc hết hạn — 02/11/2026

## Phạm vi và truy vết

Khôi phục môi trường development cho `npm.cmd run mobile` và GET
`/api/v1/contracts/expiry-reminders`. Tham chiếu AGENTS.md, SRS BF-04 / UC-19 /
JOB-02 / GBR-01/02/18, [BH-40 traceability](BH40_TRACEABILITY.md),
[API lifecycle](../api/CONTRACT_LIFECYCLE.md) và
[API conventions](../api/API_CONVENTIONS.md).
Không thay đổi quy tắc nhắc hạn, quyền Owner/Tenant/Staff, API contract hoặc schema mới.

| Lỗi                                    | Bằng chứng                                                                                                                             | Khắc phục / acceptance                                                                                              |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| HTTPS readiness thất bại               | LAN TLS hợp lệ, live 200, ready 503; database `bhome` thiếu bảng `ContractExpiryNotices` và 21 migration sau `UnifiedOperationalTasks` | Sao lưu local, dừng API, áp dụng migration hiện có; ready 200 và không còn pending                                  |
| Log gây nhầm khi dùng API đang chạy    | Log standalone cũ có MSB3027/MSB3021 do API khác khóa DLL                                                                              | Supervisor chẩn đoán HTTPS hiện tại; chỉ dẫn output Visual Studio khi dùng lại API, cả stdout/stderr khi tự tạo API |
| Công cụ nâng cấp có thể chạy binary cũ | .NET 8 `dotnet run --artifacts-path` đã chạy default output cũ trong lần kiểm tra đầu                                                  | Build riêng rồi chạy đường dẫn DLL chính xác; chế độ `-Check` phải liệt kê migration hiện tại và không ghi database |

## Thay đổi

- `scripts/Start-OcrMobileApp.ps1`: khi readiness thất bại, chạy chẩn đoán HTTPS
  có xác minh CA và chỉ dẫn đúng nguồn log; cung cấp lệnh kiểm tra migration chỉ đọc.
- `scripts/Update-LocalDatabase.ps1`: thêm `-Check`; build/execute công cụ trong
  `.tools/database-upgrade` để tránh ghi DLL API đang chạy và tránh chạy binary cũ.
- `tools/BHome.DatabaseUpgrade/Program.cs`: `--check` liệt kê pending migrations
  trước transaction/lock; mã thoát 0 nếu đã cập nhật, 2 nếu còn pending.
  Script PowerShell hiển thị danh sách pending mà không coi đây là lỗi migration.
- `tests/scripts/MobileDevelopment.Tests.ps1`: kiểm tra cả API tự tạo và API dùng lại
  thất bại readiness, nguồn log, lệnh kiểm tra chỉ đọc và không dừng debugger API;
  kiểm tra wrapper thực thi đúng DLL, dừng khi build lỗi, khôi phục environment và
  từ chối database ngoài loopback.

## Sử dụng

Chẩn đoán chỉ đọc:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Update-LocalDatabase.ps1 -Check
```

Nếu còn pending: sao lưu database local, dừng API/Visual Studio debugging, chạy:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Update-LocalDatabase.ps1
```

Sau đó khởi động lại API hoặc chạy `npm.cmd run mobile`. Nếu Metro 8081 đã chạy,
dùng terminal cũ và tải lại; dừng Metro bằng Ctrl+C trước khi mở launcher lần nữa.
Giữ kiểm tra TLS, không tự đổi firewall/trust store và không tự migrate khi mở mobile.

## Kiểm chứng

| Kiểm tra thực thi                                                                                                                                                                                                                                                                               | Kết quả                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `powershell -NoProfile -ExecutionPolicy Bypass -File tests/scripts/MobileDevelopment.Tests.ps1`                                                                                                                                                                                                 | PASS 75 assertions                                                                                                                       |
| `npm.cmd run test --workspace src/mobile -- mobileApiProbe expoStartup` (Node 22 qua `Use-LocalTools.ps1`)                                                                                                                                                                                      | PASS 29/29, 2 files                                                                                                                      |
| `dotnet test tests/backend/BHome.IntegrationTests/BHome.IntegrationTests.csproj --artifacts-path .tools/mobile-readiness-tests --filter "FullyQualifiedName~ExpiryJobDeduplicatesParallelRunsPreservesOccupancyAndScopesRecipients\|FullyQualifiedName~ApiFoundationTests" --verbosity minimal` | PASS 21/21, PostgreSQL/MinIO Docker riêng; gồm endpoint expiry, phạm vi Tenant, Staff 403, chạy job lặp/song song và không đổi occupancy |
| `Update-LocalDatabase.ps1 -Check` trước sửa local                                                                                                                                                                                                                                               | 21 pending; đối chiếu SQL sau check vẫn chưa có bảng expiry, lịch sử không đổi                                                           |
| `Update-LocalDatabase.ps1` sau sao lưu/dừng API                                                                                                                                                                                                                                                 | PASS 21 migration commit atomically; không còn pending                                                                                   |
| `node scripts/Diagnose-MobileApi.cjs https://192.168.0.106:7240 .tools/mobile-tls/root-ca.cer`                                                                                                                                                                                                  | PASS live/ready 200, anonymous Contracts 401, CA sai và hostname sai bị từ chối                                                          |
| `node scripts/Test-ExpoMobile.cjs 192.168.0.106 8081`                                                                                                                                                                                                                                           | PASS status và manifest iOS đúng host LAN                                                                                                |
| `git diff --check`                                                                                                                                                                                                                                                                              | PASS                                                                                                                                     |

Backup local bằng `pg_dump --format=custom`, xác minh archive bằng `pg_restore --list`:
`.tools/mobile-repair-20261102-103026-before-upgrade.dump` (ignored, không commit).
Đã dừng đúng API của checkout được Visual Studio khởi chạy, nâng cấp rồi chạy lại
`Start-OcrMobile.ps1 -SkipDatabase` ở background. Giữ Metro 8081 hiện có.
Log API mới: `.tools/mobile-repair-api.stdout.log` / `.tools/mobile-repair-api.stderr.log`.

Các lượt Vitest/MSBuild đầu trong sandbox bị chặn tạo process (`EPERM` hoặc build
không có compiler error); chạy lại ngoài sandbox được cấp phép đã thành công.
Lượt đầu regression script thiếu reset đồng hồ/đếm IP của fixture đã được sửa và chạy lại.
Chưa xác minh thao tác trên iPhone vật lý hoặc phiên Owner trong trình duyệt; không
dùng tài khoản thật để chạy test. Chưa chạy toàn bộ backend/mobile suite.
