# Sửa lỗi rebuild do Room.Status bị khai báo trùng

Ngày kiểm chứng: 30/10/2026. Nhánh: `member/QHuy`.

## Nguồn và phạm vi

- Đã đọc `AGENTS.md`, `docs/api/API_CONVENTIONS.md`, entity, service và test liên quan.
- Đối chiếu `docs/reports/BHome_Report-3_Software Requirement Specification (2).docx`:
  BF-01 / UC-04, mô hình trạng thái Room gồm Available / On Hold / Occupied / Unavailable;
  DBR-02 và luồng hợp đồng UC-15/19 liên quan đến tính nhất quán trạng thái phòng.
- Tham khảo `CONTRACT_LIFECYCLE_DELIVERY.md` và `PROPERTY_MANAGEMENT_VALIDATION.md`.
- Đây là sửa lỗi biên dịch; không bổ sung chính sách, quyền hay chuyển trạng thái nghiệp vụ.

## Nguyên nhân và thay đổi

`PropertyRecords.cs` khai báo hai thuộc tính `Room.Status`, gây CS0102 tại project Domain.
Các project phụ thuộc sau đó báo CS0006 vì thiếu DLL. `TenantContracts/Contract.cs` còn định
nghĩa một enum RoomStatus riêng chỉ có Available/Occupied, xung đột với enum đủ bốn trạng thái
của Property Management.

- Xóa thuộc tính trùng và enum riêng của TenantContracts; giữ enum Property Management,
  bao gồm giá trị mặc định `RoomStatus.Unavailable` của entity hiện có.
- `ContractService.cs` import enum dùng chung; giữ nguyên kiểm tra quyền và điều kiện nghiệp vụ.
- Fixture trong `ContractServiceTests.cs` và `ContractLifecycleApiTests.cs` khai báo rõ
  `Status = RoomStatus.Available` cho phòng đủ điều kiện ký hợp đồng.
- Bổ sung ba trường hợp từ chối tạo hợp đồng với phòng OnHold/Occupied/Unavailable (409),
  xác nhận trạng thái phòng không đổi và không ghi Contract/operation mới. Các test hiện có
  kiểm tra kích hoạt, trả phòng, quyền Staff/Tenant và tính idempotent tiếp tục chạy.
- Không sửa migration, model snapshot, database hoặc cấu hình.

## Kiểm chứng

- Trước sửa: `dotnet build src/backend/BHome.sln --no-restore -v minimal` FAIL, CS0102.
- Lượt test đầu sau sửa mã: 21 test hợp đồng FAIL do fixture chưa khai báo phòng Available;
  đã sửa fixture như trên, giữ nguyên mặc định an toàn của entity.
- `dotnet build src/backend/BHome.sln --no-restore --target:Rebuild -v minimal`:
  PASS, 0 warning, 0 error, SDK 8.0.427.
- `dotnet test src/backend/BHome.sln --no-build --no-restore --filter 'Category!=Docker' --logger 'console;verbosity=minimal'`:
  PASS, Domain 56 + Application 161 + Integration 110 = 327 test, 0 fail/skip.
- `dotnet format whitespace src/backend/BHome.sln --verify-no-changes --no-restore --include src/backend/BHome.Application/Contracts/ContractService.cs src/backend/BHome.Domain/PropertyManagement/PropertyRecords.cs src/backend/BHome.Domain/TenantContracts/Contract.cs tests/backend/BHome.Application.UnitTests/Contracts/ContractServiceTests.cs tests/backend/BHome.IntegrationTests/Contracts/ContractLifecycleApiTests.cs -v quiet`:
  FAIL, phát hiện định dạng có sẵn trong các đoạn service/test ngoài phần sửa; không reformat
  toàn bộ file trong bản sửa build này.
- `git diff --check`: PASS.
- Nhóm test Category=Docker (bao gồm ContractLifecycleApiTests trên PostgreSQL): NOT RUN.
  Chưa kiểm chứng migration/database hoặc tích hợp provider thật trong bản sửa này.
- Không commit, push hoặc merge.
