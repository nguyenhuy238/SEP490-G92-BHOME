# Sửa xung đột EF Core migration sau merge Contract và Property

Ngày kiểm chứng: 30/10/2026. Nhánh hiện tại: `bugfix/fix-efcore-migration-conflicts/QHuy`.

## Phạm vi, nguồn và tiêu chí chấp nhận

- BF-01 / UC-04, BF-03 / UC-15, BF-04 / UC-16/19, DBR-02: giữ mapping Room,
  Contract và lịch sử; đây là sửa metadata/migration, không đổi quyền hoặc chính sách nghiệp vụ.
- Đã đọc `AGENTS.md`, `docs/api/API_CONVENTIONS.md`,
  `CONTRACT_LIFECYCLE_DELIVERY.md`, `ROOM_STATUS_BUILD_FIX.md`, model/configuration,
  toàn bộ chuỗi migration và các test liên quan.
- Đã đối chiếu các đoạn UC-15/16, DBR-02 trong
  `docs/reports/BHome_Report-3_Software Requirement Specification (2).docx` và thiết kế
  EF Core/PostgreSQL trong `docs/reports/Report-4_Software Design Specification (5).docx`.
- Tiêu chí: snapshot khớp model hiện tại; target model của mỗi migration chứa đủ bảng đã tạo;
  chỉ migration Property thêm/xóa `Rooms.Status`; nâng cấp, rollback riêng Contract và chạy lại
  phải giữ cả bốn giá trị trạng thái phòng. Dùng PostgreSQL 16 tách biệt, dữ liệu tổng hợp.
- File `CONTRACT_LIFECYCLE_UI.md` được nêu trong IDE không có trong checkout tại thời điểm sửa.

## Nguyên nhân và thay đổi

1. `BHomeDbContextModelSnapshot.cs` thiếu định nghĩa Contract và các entity liên quan nhưng còn
   tham chiếu/navigation, gây lỗi `Contract.Residents was not found`. Khôi phục đầy đủ các block
   entity, khóa, index, check constraint và quan hệ từ model Contract đã có.
2. `20261029170352_ContractActivationLifecycle.cs` thêm `Rooms.Status` sau khi
   `20261029154537_PropertyConfiguration.cs` đã thêm cột đó. Bỏ cả `AddColumn` trong `Up`
   và `DropColumn` trong `Down` của Contract; giữ cột và mặc định `3` của migration Property.
3. Đồng bộ ba file Designer của ContractActivationLifecycle, SingleSystemChain và
   FlexibleFutureBillingPolicies. Target model Contract trước đây thiếu phần Property đã chạy
   trước nó; hai target model sau đó thiếu phần Contract. Giữ đúng trạng thái lịch sử của
   Chain, Location và BillingPolicy tại từng mốc, không đưa thay đổi tương lai vào model cũ.
4. Thêm `MigrationConsistencyTests.cs` và test hồi quy trong `PostgresFoundationTests.cs`.
   Trước sửa, test snapshot và test duy nhất migration sở hữu `Rooms.Status` đều FAIL,
   tái hiện đúng hai lỗi được báo.

## Kiểm chứng thực tế

Các lệnh chạy từ thư mục gốc repository:

```powershell
dotnet tool restore
dotnet build src/backend/BHome.sln --verbosity minimal
dotnet test tests/backend/BHome.IntegrationTests/BHome.IntegrationTests.csproj --no-restore --filter 'FullyQualifiedName~MigrationConsistencyTests|FullyQualifiedName~PostgresFoundationTests' --verbosity minimal
dotnet test tests/backend/BHome.Application.UnitTests/BHome.Application.UnitTests.csproj --no-build --no-restore --filter 'FullyQualifiedName~Contracts.ContractServiceTests' --verbosity minimal
dotnet test tests/backend/BHome.IntegrationTests/BHome.IntegrationTests.csproj --no-build --no-restore --filter 'FullyQualifiedName~Contracts.ContractLifecycleApiTests|FullyQualifiedName~PropertyManagement' --verbosity minimal
$env:ConnectionStrings__Database = 'Host=127.0.0.1;Database=synthetic_migration_metadata;Username=unconfigured;Timeout=1'
dotnet ef migrations has-pending-model-changes --project src/backend/BHome.Infrastructure --startup-project src/backend/BHome.Api --no-build
git diff --check
```

| Kiểm tra | Kết quả |
| --- | --- |
| Tool restore / build backend | PASS; build 0 warning, 0 error |
| Metadata và PostgreSQL foundation | PASS: 7/7, không skip |
| Contract service unit tests | PASS: 24/24, không skip |
| EF kiểm tra model drift | PASS: không có thay đổi model chưa được phản ánh |
| Diff whitespace | PASS |
| Integration mở rộng Contract + Property | FAIL: 14 pass, 30 fail, không skip |

Các lỗi mở rộng còn tồn tại ngoài phạm vi hai lỗi migration:

- Fixture `ContractLifecycleApiTests.Setup()` tạo Location không có `ChainId`; migration
  SingleSystemChain hiện yêu cầu cột này khác null. Các ca này dừng ở bước chuẩn bị dữ liệu.
- Một số ca Property/SingleChain nhận HTTP 500 thay cho 400/404/409 mong đợi.
  `ApiExceptionHandler` hiện không có nhánh ánh xạ exception của Property Management.
  Không thay đổi middleware hoặc nới ràng buộc dữ liệu để làm các ca này pass.

## Áp dụng và giới hạn

- Không thêm migration mới, không thay đổi cấu hình/provider/API/quyền.
- Đã chạy toàn bộ chuỗi migration trên DB test mới, kiểm tra rollback về InitialFoundation,
  và riêng Property → Contract → Property → latest → latest; trạng thái Room giữ nguyên.
- Bản sửa không cần reset/xóa database. Môi trường dừng trước Contract có thể chạy lại lệnh
  cập nhật EF theo quy trình hiện có; migration đã được ghi trong history sẽ không chạy lại.
- Không sửa database local đang chạy hoặc database triển khai; schema/history của các môi trường
  đó chưa được kiểm chứng. Không xác minh E2E UI hoặc provider ký/ngân hàng thật.
- Chưa commit, push hoặc merge. Không khẳng định toàn bộ backend đã đạt kiểm thử tích hợp.
