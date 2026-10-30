# Kết quả kiểm tra API cấu hình bất động sản

Thực thi ngày 29/10/2026, trên working tree nhánh `BE/THuy`. Không commit/push/merge hoặc
chuyển nhánh. Working tree ban đầu sạch. Nguồn, quyết định đã duyệt, giới hạn và hợp đồng API:
[PROPERTY_MANAGEMENT.md](../api/PROPERTY_MANAGEMENT.md).

## Môi trường

- .NET SDK 8.0.427, các project giữ nguyên net8.0 và package đang dùng.
- Docker không có trong PATH của phiên làm việc này.
- PostgreSQL 18.3 native chạy riêng tại 127.0.0.1:55491, thư mục tạm `bhome-property-pg-*`.
  Role chỉ dùng cho cluster tạm là `bhome_test_runner`. Không dùng tài khoản/dữ liệu thật.
- Fixture `AuthenticationDatabaseFixture` tạo và xóa database ngẫu nhiên cho từng lớp test;
  test migration có database tạm riêng. Không truy cập/thay đổi database phát triển/production.
- Report 4 và Testcontainers định hướng PostgreSQL 16. Kết quả native 18.3 không thay thế một
  lượt CI trên PostgreSQL 16. Không nâng version database dự án.

## Lệnh và kết quả cuối

```powershell
dotnet build src/backend/BHome.sln --no-restore -m:1 -p:UseSharedCompilation=false -v:minimal
```

PASS: 0 warning, 0 error.

```powershell
dotnet test src/backend/BHome.sln --no-build --no-restore --filter 'Category!=Docker' -m:1 --logger 'console;verbosity=minimal'
```

PASS: Application 76, Domain 55, Integration không cần DB/Docker 77; tổng 208, không skip/fail.
Bao gồm test mới service từ chối quyền trước persistence, rate không âm/bounded khi gọi trực tiếp,
pagination/overflow và ranh giới 17:00 UTC sang ngày Việt Nam mới.

```powershell
$env:BHOME_AUTH_TEST_POSTGRES_ADMIN = 'Host=127.0.0.1;Port=55491;Database=postgres;Username=bhome_test_runner'
dotnet test tests/backend/BHome.IntegrationTests/BHome.IntegrationTests.csproj --no-build --no-restore --filter 'FullyQualifiedName~PropertyApiTests|FullyQualifiedName~LocationAssignmentApiTests|FullyQualifiedName~PermissionApiTests|FullyQualifiedName~PostgresAuthenticationTests|FullyQualifiedName~AuthenticationSecurityTests' -m:1 --logger 'console;verbosity=minimal'
```

PASS: 94 test, 0 fail/skip. Trong đó PropertyApiTests có 16 test, LocationAssignmentApiTests có 4.
Các lớp còn lại là regression phân quyền/auth/session/audit trên database thực.

Các trường hợp liên quan đã thực thi:

- Tạo Location/Room Type/Room/Asset và cập nhật Asset có version/snapshot/actor/reason.
- Owner khác vẫn được quản lý toàn hệ thống; Staff chỉ đọc trong assignment hiện hành,
  lọc trước count/paging; hết assignment thì JWT đang dùng mất quyền đọc Location.
- Guest 401/Tenant 403 trên cả năm nhóm danh sách; Staff không tạo phòng/sửa Asset.
- Room Type và mã Asset trùng sau trim/chuyển hoa bị từ chối; Asset không mã được giữ đúng null.
- FK composite chặn Asset tham chiếu Room khác Location ngay ở DB.
- Cấm trạng thái phòng Occupied nhập tay; chặn ngừng Location/Room Type còn phòng vận hành;
  chặn đóng phòng có Resident; capture không tạo Resident vào phòng Unavailable.
- Hai request tạo số phòng trùng hoặc giá chồng kỳ chỉ một thành công; không có audit mồ côi.
- Hai request sửa cùng version chỉ một thành công, request còn lại 409.
- Tra giá Room ưu tiên Room Type/Location theo từng khoản; giữ mức 0 và decimal chính xác;
  WATER chưa cấu hình được trả là thiếu, không thành 0.
- Thay giá tách ngày bao gồm hai đầu; giữ amount cũ; lỗi xung đột bản tương lai rollback cả
  EffectiveTo/version/audit của bản trước.
- Từ chối giá âm, thiếu rate, sai method, precision vượt bốn số, hồi tố, sai kỳ, sai scope,
  enum/paging sai và overflow.
- PostgreSQL chặn sửa giá lịch sử và xóa PropertyChanges.
- Nâng migration từ CaptureWorkflowsMerged giữ GUID/số phòng cũ, không tự gán loại phòng/occupancy;
  trạng thái Unavailable, capacity kỹ thuật 1, version 1. Không còn migration pending.
  Hạ về baseline giữ RoomNumber cũ; database thử nghiệm được xóa sau test.

Kiểm tra EF:

```powershell
dotnet ef migrations has-pending-model-changes --project src/backend/BHome.Infrastructure --startup-project src/backend/BHome.Infrastructure --no-build
```

PASS: `No changes have been made to the model since the last migration.` Connection cho tooling
trỏ loopback test; lệnh kiểm tra model không thực hiện database update.

Kiểm tra whitespace trên các file C# thay đổi/mới:

```powershell
$propertyChangedFiles = @((git diff --name-only -- '*.cs'), (git ls-files --others --exclude-standard -- '*.cs')) | ForEach-Object { $_ } | Where-Object { $_ }
dotnet format whitespace src/backend/BHome.sln --no-restore --verify-no-changes --include $propertyChangedFiles --verbosity quiet
git diff --check
```

PASS. Git có cảnh báo chuẩn hóa CRLF/LF của snapshot, không có lỗi whitespace.

## Các lần thử chưa thành công và cách xử lý

- Lần build solution đầu mặc định parallel trả code 1, 0 compiler error, không có chẩn đoán hữu ích.
  Build tuần tự `-m:1` với compiler không chia sẻ đã thành công.
- Một lượt build test phát hiện CS0200 khi fixture cố gán trực tiếp ngày assignment chỉ đọc.
  Đã sửa fixture dùng SQL trên database thử nghiệm; không đổi setter hoặc nghiệp vụ production.
- EF CLI ban đầu bị hạn chế ghi file generated trong obj; chạy lại với quyền tooling được hệ
  thống phê duyệt đã tạo migration thành công. Không sửa schema ngoài EF.
- Khởi động pg_ctl trong sandbox chưa thành công; khởi động ẩn với quyền được hệ thống duyệt
  đã tạo cluster tạm hoạt động. Không dùng/chỉnh dịch vụ PostgreSQL đang có của người dùng.

## Chưa kiểm tra hoặc chưa triển khai

- NOT RUN: trọn bộ Testcontainers/PostgreSQL 16/MinIO và CaptureWorkflowTests cần container;
  fixture đã được cập nhật để tạo Room Type trước Room. Đường capture tạo phòng và Resident
  liên quan được kiểm tra bằng PropertyApiTests trên PostgreSQL native.
- NOT RUN: UI/mobile E2E, frontend build/lint, load/performance/coverage; không sửa frontend.
- Chưa áp dụng migration `20261029154537_PropertyConfiguration` lên database dự án.
- Client cũ phải cập nhật payload tạo Location/Room và page DTO Location theo tài liệu API.
- Chưa có model Contract/occupancy đầy đủ: kiểm tra Resident là bảo vệ phụ thuộc thận trọng,
  không được xem là đã chứng minh toàn bộ DBR-02 hoặc luồng activation/move-out.
- Không tính hóa đơn, áp dụng giá sang hợp đồng hiện hữu, sửa tài chính hay gửi thông báo ngoài.
