# Phase 1B — Room Readiness, Room History và Occupancy Analytics

Ngày 05/11/2026. Quyết định hiện hành cho phép triển khai Phase 1B read-only trong khi Docker Linux Engine
không khả dụng. Quyết định này không thể hiện Phase 1A đã accepted và không thay thế 10 PostgreSQL concurrency
tests đang bị chặn.

## Traceability

| Hành vi | Nguồn | Code/dữ liệu | Chấp nhận |
| --- | --- | --- | --- |
| Readiness theo operation | BF-01; UC-04 A2/A4; UC-05; UC-06; BF-03/04 | PropertyService, IRoomInsightsRepository; Room/Contract/Resident/BillingPolicy/Meter/Handover/Asset | blocker có code; Holding indeterminate; không mutation |
| Room history | UC-07; GBR-01..03/13; DBR-13 | PropertyChange, Contract lifecycle, ContractResident intervals | stable paging; tách source; không PII; completeness |
| Occupancy snapshot/history | UC-07; DBR-02 | Room status, Active Contract, verified Resident, audit status timeline | distinct Room; Vietnam dates; không dùng current status để bịa history |

Report 3 v1.3 đã đọc trực tiếp từ DOCX: BF-01 (trigger/end condition), UC-04..06 và UC-07 (Owner chain-wide,
Staff assigned Location, history rỗng là hợp lệ, không mutation). API conventions và báo cáo Phase 1A đã được
đối chiếu trước khi sửa.

## Kiến trúc và dữ liệu

Controller → `PropertyService` → `IRoomInsightsRepository` → `PostgresRoomInsightsRepository` →
`BHomePersistenceContext`/Compact24. Không repository generic/CQRS/MediatR. Projection không trả tên resident,
identity envelope, signing evidence hay payment. Runtime vẫn Compact24 24 physical tables; RoomType vẫn là
catalog JSONB trong `locations.room_types`; PropertyChange vẫn trong audit infrastructure hiện có.
MoveIn gọi `IAdministrativeContractReadiness` do `ContractService` hiện hữu triển khai, nên dùng cùng validator
activation cho signature, deposit, signer, resident, renewal và conflict nhưng chỉ đưa blocker code ra DTO quản trị.

Không thêm table/column/index/migration/enum value. Không đổi write path Contract, Payment, Room, Meter, Asset.
Không truy cập shared database.

## Giới hạn có chủ đích

- Holding workflow chưa hoàn chỉnh: không bao giờ trả Ready chắc chắn cho Holding.
- Không có nguồn Incident/Work Order đủ tin cậy trong slice này; MoveIn ghi unverified condition.
- Audit trước khi append-only PropertyChange được bật có thể thiếu. Lịch sử chỉ trả event đã lưu.
- Historical rate chỉ trả khi Location và tất cả Room có evidence Created/status bao phủ kỳ; ngược lại trả
  `InsufficientData` và null, không fabricate.
- PostgreSQL/Compact24 query translation và date-boundary test đã thêm nhưng chưa thể chạy khi Docker Linux
  Engine không khả dụng.

## Verification 05/11/2026

| Lệnh/nhóm | Kết quả thực thi |
| --- | --- |
| `dotnet build src/backend/BHome.sln --no-restore` | PASS — 0 warning, 0 error |
| `RoomInsightsServiceTests` | PASS — 9/9, 0 fail, 0 skip |
| Full backend `Category!=Docker` | PASS — Domain 90, Application 228, Integration 215; tổng 533 PASS, 0 FAIL, 126 SKIP |
| `PropertyApiTests.RoomInsightsAreReadOnlyScopedAndUseCompact24AuditDates` | BLOCKED BY ENVIRONMENT — Testcontainers không kết nối được `npipe://./pipe/docker_engine`; 0 business assertion executed |
| PostgreSQL Phase 1B | 0 PASS, 0 product FAIL, 1 BLOCKED BY ENVIRONMENT |

126 SKIP là Compact24 PostgreSQL tests cần môi trường opt-in, không được tính PASS. Docker CLI 29.4.0 có mặt
nhưng `docker version`/`docker info` không có Server và không tìm thấy
`npipe:////./pipe/dockerDesktopLinuxEngine`. Không khởi động/cấu hình lại Docker và không dùng shared database.

Trạng thái: **IMPLEMENTED – PENDING POSTGRESQL VERIFICATION**.
