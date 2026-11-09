# Sửa CI cho PR 71 — 09/11/2026

Baseline: `bef6412`, nhánh `member/QHuy`. Workflow được báo lỗi:
[run 42628468789](https://github.com/nguyenhuy238/SEP490-G92-BHOME/actions/runs/42628468789).

## Phạm vi và nguyên nhân

Đối chiếu `.github/workflows/ci.yml`, quy tắc kiểm thử trong `AGENTS.md`,
`docs/api/RESIDENT_ADMINISTRATION.md` (UC-13, GBR-02/13) và các regression test hiện có.
Đây là sửa lint và cấu hình/dữ liệu test; không thay đổi nghiệp vụ, quyền, API hay schema.

- Frontend dừng ở biến `_id` không dùng trong `StaffApiPage.tsx`. Sao chép employment
  rồi loại `id` khỏi bản sao giữ nguyên payload hiện có. Test kiểm tra payload không có
  `id` và đối tượng employment gốc vẫn giữ `id`.
- Backend có 38 Integration test lỗi. Host legacy loại `Compact24DbContext` nhưng
  vẫn đăng ký repository/service quản trị Resident phụ thuộc context này. Loại hai
  đăng ký khỏi riêng host legacy; composition test kiểm tra chúng chỉ có ở Compact24.
- Fixture OCR và Property tạo nhiều Owner, trái với phạm vi định danh một Owner
  đang được triển khai. Hai nhóm test chủ động dùng lại Owner tổng hợp bằng helper
  hiện có. Những fixture khác giữ cách tạo tài khoản cũ.
- Hai kịch bản định danh từng dùng chung số tổng hợp trong database của class.
  Mỗi instance test nay có số tổng hợp riêng, vẫn dùng cùng số trong các request
  kiểm tra retry và chống trùng song song. Giữ các kiểm tra mã hóa, không lộ dữ liệu,
  xác nhận bởi người dùng, phân quyền và chỉ một request trùng được chấp nhận.
- Kiểm tra thêm Resident do Staff tạo mang phạm vi Owner, còn audit giữ đúng Staff.

## Cách xác minh

Chạy các lệnh của workflow bằng Node 22 và .NET SDK 8 trong môi trường Linux cô lập,
với source được archive từ Git rồi chép các thay đổi đang kiểm tra. Backend dùng
PostgreSQL/MinIO Testcontainers và image chuyển đổi hợp đồng đúng tên trong workflow.
Runner chia sẻ loopback network và thư mục tạm với Docker daemon riêng để giữ nguyên
kiểm tra chỉ cho phép loopback và bind mount của bộ chuyển đổi PDF.

Frontend dùng `VITE_API_BASE_URL=https://api.example.com`:

```sh
npm ci --no-fund --no-audit
npm run lint
npm test
npm run build
npm run format:check
docker compose --env-file .env.example config --quiet
```

Backend:

```sh
dotnet restore src/backend/BHome.sln
dotnet build src/backend/BHome.sln -c Release --no-restore
docker build -f deploy/docker/Minio.Dockerfile -t bhome/minio-local:2025-10-15 .
docker build -f deploy/docker/ContractConverter.Dockerfile -t bhome/contract-converter:local .
dotnet test src/backend/BHome.sln -c Release --no-build --logger trx
dotnet format src/backend/BHome.sln --verify-no-changes --no-restore
```

Không sửa file audit chưa được Git theo dõi của người dùng. File đó không thuộc source
archive dùng để xác minh CI và không được đưa vào commit sửa lỗi này.

## File thay đổi

- `src/owner-web/src/features/staff/StaffApiPage.tsx`
- `src/owner-web/src/features/staff/StaffApiPage.test.tsx`
- `tests/backend/BHome.IntegrationTests/Fixtures/LegacyPersistenceRegistration.cs`
- `tests/backend/BHome.IntegrationTests/PersistenceCompositionTests.cs`
- `tests/backend/BHome.IntegrationTests/Compact24/WorkflowTestUsers.cs`
- `tests/backend/BHome.IntegrationTests/Ocr/CaptureWorkflowTests.cs`
- `tests/backend/BHome.IntegrationTests/PropertyManagement/PropertyApiTests.cs`
- Báo cáo này.

## Kết quả và giới hạn

Backend Linux: restore và Release build PASS với 0 warning, 0 error. Lượt toàn bộ
solution sau khi thêm các assertion phạm vi Owner/audit PASS: Domain 106/106,
Application 373/373, Integration 561 PASS, 0 FAIL, 264 SKIP (825 test Integration).
`dotnet format --verify-no-changes --no-restore` PASS; composition regression PASS
cả legacy và Compact24. Không chạy migration trên database làm việc.

Frontend Linux: cài dependency sạch, lint, 260/260 Owner Web test, 851/851 Mobile test,
build các workspace và Prettier đều PASS. Hai image Docker build và Compose config PASS.
Test riêng StaffApiPage với assertion không sửa đối tượng gốc PASS 2/2 trên Windows
và Linux; lint được chạy lại sau assertion này và PASS.

Lượt kiểm tra Windows ban đầu gặp một timeout ở smoke test `/schedules` khi chạy nhiều
kiểm tra đồng thời; đủ 38 router test đã PASS trong lượt Linux. Prettier tại workspace
Windows báo file audit chưa theo dõi nêu trên; source Git dùng cho CI đã PASS Prettier.
Lần cài npm Linux đầu bị ngắt kết nối ECONNRESET; chạy lại cài sạch thành công.

Không tắt test, nới timeout, bỏ assertion hoặc giảm CI gate. Các test phụ thuộc cấu hình
Compact24/model/môi trường tùy chọn vẫn giữ điều kiện skip sẵn có; skip không tính là PASS.
Không push hoặc merge trong tác vụ này; kết quả GitHub Actions cho commit mới chỉ có sau
khi nhánh được push và workflow chạy lại.
