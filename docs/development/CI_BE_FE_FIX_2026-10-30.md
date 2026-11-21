# Sửa CI Backend và Frontend — 30/10/2026

## Phạm vi và nguyên nhân

- BF-01 / UC-04..07 / GBR-01..03,08 / DBR-01; contract lỗi HTTP theo
  `docs/api/PROPERTY_MANAGEMENT.md` và `docs/api/API_CONVENTIONS.md`. Không thay đổi quy tắc
  nghiệp vụ, quyền truy cập, schema hoặc package version.
- Log CI cung cấp: 15 Integration tests Property/Chain nhận 500 thay vì 400/404/409.
  `ApiExceptionHandler` thiếu mapping `PropertyException`, nên rơi vào fallback 500.
- Frontend lint: `PropertyUI.tsx` export cả component và ba hàm thường; `Rooms.tsx` import
  `DoorOpen` không dùng. CI đặt `--max-warnings 0`, nên cả warning cũng làm job thất bại.

## Thay đổi

- Map `PropertyException.Status` và `.Code` vào ProblemDetails; giữ correlationId, không trả
  message/exception detail hoặc thay đổi fallback cho lỗi bất ngờ.
- Thêm bốn ca hồi quy qua HTTP cho status 400/403/404/409, kiểm tra code, correlation và redaction.
  Probe chỉ đăng ký trong test host, không có trong API production.
- Chuyển currency/dateLabel/matches sang `propertyUtils.ts`, cập nhật imports và bỏ icon không dùng.
- Bỏ qua `.tmp` trong ESLint giống thư mục tooling `.tools`; không tắt rule lint.
- Chạy đúng gate formatter của workflow: Prettier chuẩn hóa 22 file được báo; dotnet formatter
  sửa whitespace/encoding của tám file C# được báo. Các thay đổi này chỉ là trình bày.
- Khi chạy toàn bộ tests, phát hiện thêm hai giả định của fixture:
  - Ca expired password reset dùng biểu thức UtcNow bị dịch thành SQL now() từ đồng hồ container;
    nay truyền timestamp đã quá hạn từ ứng dụng bằng parameter và kiểm tra đúng một grant bị đổi.
  - EF commit từng migration, không rollback cả chuỗi khi một Down phía sau bị chặn; test
    kiểm tra billing guard và dữ liệu giữ nguyên, rồi áp lại migration mới hơn để khôi phục fixture.
    Không nới assertion bảo vệ giá đã dùng hoặc logic reset password.

## Kiểm chứng

Chạy trên Windows local, .NET 8 Release, PostgreSQL/MinIO Testcontainers dùng một lần.
Không thao tác DB phát triển/production và không push workflow lên GitHub.

| Lệnh                                                                   | Kết quả                                                                 |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `npm.cmd run lint`                                                     | PASS, không warning                                                     |
| `npm.cmd test`                                                         | PASS: Owner Web 49, Mobile 83                                           |
| `npm.cmd run build`                                                    | PASS các workspace có build script                                      |
| `npm.cmd run format:check`                                             | PASS                                                                    |
| `dotnet build src/backend/BHome.sln -c Release --no-restore`           | PASS                                                                    |
| `dotnet test src/backend/BHome.sln -c Release --no-build --logger trx` | PASS: Application 170, Domain 62, Integration 262; tổng 494, không skip |
| `dotnet format src/backend/BHome.sln --verify-no-changes --no-restore` | PASS sau tất cả thay đổi                                                |

Lệnh thực tế có thêm `-m:1 -nr:false` khi build và lưu TRX vào ignored `TestResults/ci-fix`.
Các lần lỗi đã xử lý: Vitest trong sandbox bị spawn EPERM (chạy ngoài sandbox); lượt test đầu
Owner Web timeout tải route khi chạy đồng thời các lượt build/format nặng (lượt chạy lại đầy đủ
49/49 PASS, không tăng timeout/skip test). Lượt Backend đầy đủ đầu sau sửa mapping có 260/262
Integration PASS và phát hiện hai vấn đề fixture nêu trên, không ghi nhận là PASS.

GitHub Actions chưa chạy lại từ checkout này; kết quả ở đây là kiểm chứng local theo các lệnh CI.
