# Tích hợp hồ sơ, vòng đời tài sản, cư trú và quyền dữ liệu

## Nguồn và quyết định

Yêu cầu triển khai người dùng ngày 16/11/2026, các mục 2–14, bổ sung vào BF-01,
BF-02, BF-03/04, BF-05/06, BF-07 và FE-07/08. Người dùng xác nhận trong phiên
giữ mô hình một Owner mỗi deployment. `ux_users_single_owner` và quyền quản trị
toàn deployment được bảo toàn. Kiểm thử cách ly tập trung Staff/Location và Tenant.

Đã đọc README, AGENTS gốc/Web/Mobile, architecture/module map, quy ước API,
quy trình Compact24 migrations, tài liệu asset handover, retention và workflow CI.
Report 1, 2, SRS và SDD trong `docs/reports` được trích văn bản XML để đối chiếu.
Các tài liệu Actor/Feature/UC, DB Table Details, workshop, Latest Decisions Handover,
bộ workbook UT/IT/ST/AT và tài liệu Git gốc chưa tìm thấy trong `docs/reports`.
Áp dụng quy tắc Git trong AGENTS và tài liệu repository hiện có.

SRS UC-18 và JOB-08 còn mô tả Staff/reminder, đối chiếu GBR-06 và quyết định mới
loại Staff khỏi xử lý cư trú, giữ đăng ký chính thức bên ngoài và không thêm reminder.
Owner confirmation là ghi nhận hành động trên kênh chính thức.

## Audit ban đầu

| Nghiệp vụ                             | Backend / database                          | Web                             | Mobile                  | Test hiện có                                 | Khoảng trống / tích hợp                                                               |
| ------------------------------------- | ------------------------------------------- | ------------------------------- | ----------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------- |
| Location, wizard, copy, mẫu phiên bản | Implemented but incomplete                  | Có API workspace MUI            | Setup hiện có           | Compact24OwnerSetup, CommonAssetRequirements | Tái sử dụng cấu hình, không copy dữ liệu vật lý riêng cơ sở                           |
| Asset nhóm và kiểm kê                 | Implemented but incomplete                  | AssetOperationsPanel, inventory | Handover hiện có        | AssetHandover, owner setup                   | Thiếu policy vòng đời và thiết bị con                                                 |
| Hồ sơ pháp lý Location                | Missing                                     | Missing                         | Missing                 | Missing                                      | Tài liệu phiên bản trong Location Settings, file private                              |
| Task và phân công                     | Implemented but incomplete                  | Công việc Owner                 | Staff task và evidence  | OperationalTasks                             | Tái sử dụng assignee hiệu lực, submit/verify/rework                                   |
| Cư trú                                | Implemented but incorrect                   | Có trang theo dõi thật          | Owner/Tenant API thật   | ResidenceQuery                               | Owner chỉ xác nhận sau Completed, cập nhật Tenant xóa confirmation, thiếu stale token |
| Contract, giá và billing              | Implemented but incomplete                  | Có giao diện API                | Contract API thật       | ContractRegression, Invoice, pricing lock    | Giữ snapshots và versioning, kiểm thử regression                                      |
| Incident / maintenance                | Implemented but incomplete                  | BF-07 API thật                  | Staff và Owner API thật | BF07, expense                                | Có proactive maintenance, nối kết quả kiểm tra vào Work Order                         |
| Finance, thuế                         | Finance hiện có, thuế Missing               | Finance hiện có                 | Overview hiện có        | Expense / financial reports                  | Thêm hồ sơ chủ thể nhiều Location và chứng từ nghĩa vụ                                |
| Quyền dữ liệu                         | Retention metadata hiện có, request Missing | Retention hiện có               | Profile hiện có         | IdentityRetention                            | Thêm request/review, giữ lịch sử tài chính                                            |
| File / audit / notification           | Private storage và audit append-only        | Client dùng auth                | Client dùng auth        | Storage, inbox, auth                         | Hồ sơ pháp lý cần download Owner-only riêng                                           |

Các trạng thái audit ghi nhận khoảng trống qua mã nguồn. Chỉ kết quả thực thi trong
báo cáo kiểm thử mới chứng minh từng scenario đã được xác minh.

## Baseline và môi trường

- Working tree sạch, branch `member/QHuy` trước chỉnh sửa.
- `dotnet restore src/backend/BHome.sln` thành công.
- Release build solution thành công, 0 warning, 0 error.
- `npm run lint` thành công trước chỉnh sửa.
- PostgreSQL native 18.6 local, Compact24 metadata probe thành công, 24 bảng,
  17 migration đã áp dụng, 0 pending. Tên database riêng nằm trong cấu hình local.
- Docker Linux daemon chưa sẵn sàng. Full backend baseline gặp lỗi Testcontainers.
  Testhost baseline được dừng để giải phóng DLL trước build test mới.
- CI dùng .NET 8, Node 22, npm workspace, PostgreSQL 16, Docker MinIO và LibreOffice.
  Kết quả native PostgreSQL 18 phải phân biệt với CI PostgreSQL 16.

## Kế hoạch và traceability

1. BF-01 / UC-04..07, GBR-01/02/08/13. Hồ sơ Location, category, lifecycle policy,
   equipment children. Dùng `ISetupWorkspaceStore`, transaction advisory lock theo
   Location, version compare và history. Kiểm thử expiry nullable, replacement,
   quyền file, immutable published policy, số lượng và lịch sử thiết bị.
2. BF-03/04 / UC-18, GBR-06/18. Bổ sung phần thiếu ở luồng cư trú hiện có,
   confirmation và concurrency. Kiểm thử người đến sau, retry, Staff/Tenant isolation.
3. BF-02/07 / UC-10..12, UC-26..30, GBR-11/12/18. Snapshot checklist/policy,
   recurring inspection với business key bền vững, Staff batch save, Owner review,
   remediation qua proactive maintenance và expense hiện có.
4. FE-07/08 / UC-31..36, GBR-13/15/16. Theo dõi chứng từ thuế, privacy requests,
   cảnh báo từ nguồn, regression snapshots và tài chính. Không suy diễn thuế suất,
   chu kỳ pháp lý hoặc retention policy chưa được duyệt.
5. Chạy lại lệnh tương đương `.github/workflows/ci.yml`, kiểm tra Web/Mobile,
   private file, regression, diff và commit từng phase.

## Lựa chọn persistence

Tài liệu phiên bản dùng JSONB container `operational_tasks` với `task_type=SYSTEM_JOB`,
`recordType=Setup<kind>`, PK ID và `source_key` duy nhất hiện có. Service kiểm tra
scope, quan hệ và trạng thái. API danh sách mới phân trang tại PostgreSQL.
File hồ sơ pháp lý có namespace `location-legal`, chỉ tải qua endpoint Owner-only,
giữ object cũ cho từng revision. Upload lỗi ghi DB sẽ dọn object mới.

Asset Quantity giữ trong metadata hiện có. Thiết bị con ngừng sử dụng giữ lịch sử,
không bị tính vào thiết bị hiện có. Unsafe vẫn tính tồn tại vật lý. Giới hạn số
thiết bị hiện có được kiểm tra dưới cùng Location lock, kiểm tra giảm quantity ở
đường ghi metadata. Không backfill serial hoặc kết quả kiểm tra.

Không cần DDL cho các loại tài liệu JSONB mới. Nếu phát sinh index/constraint vật lý,
phải có migration additive và kiểm thử upgrade trước áp dụng.

## Căn cứ PCCC

Đã tìm nguồn chính thức Nghị định 105/2025/NĐ-CP, hiệu lực 01/07/2025.
Việc xác định cơ sở thuộc danh mục nào và yêu cầu kỹ thuật của từng thiết bị vẫn
cần Owner đánh giá. Chu kỳ/checklist do người có trách nhiệm cấu hình với căn cứ,
không seed ví dụ thành yêu cầu pháp lý bắt buộc.

[Nghị định trên Công báo Chính phủ](https://congbao.chinhphu.vn/van-ban/nghi-dinh-so-105-2025-nd-cp-44912/56374.htm)
