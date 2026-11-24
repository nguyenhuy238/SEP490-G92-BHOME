# Công việc kiểm kê tài sản toàn cơ sở khi phân công Staff

Phạm vi: BF-01 (tài sản Location/Room), BF-02 / UC-08..12 (phân công Staff, công việc, tiến độ, vướng mắc), UC-17 (bàn giao Room với Tenant), GBR-01..03 và DBR-01 (phân quyền theo Location). Đây là checklist và biên bản bàn giao trách nhiệm quản lý tài sản cơ sở; **không phải** Incident hoặc Maintenance Work Order BF-07.

State machine, permission matrix và quy tắc liên kết BF-07 có tài liệu tổng hợp tại [`docs/architecture/BF07_AND_LOCATION_ASSET_HANDOVER_STATE_MODEL.md`](../architecture/BF07_AND_LOCATION_ASSET_HANDOVER_STATE_MODEL.md). Tài liệu này giữ các chi tiết triển khai riêng cho checklist.

## 1. Kích hoạt, task identity và successor

- `CompactLocationAssignments.ReconcileLocationAsync` chạy trong Location transaction/lock khi Staff responsibility thực sự có hiệu lực.
- Mỗi Location có tối đa **một LocationAssetHandover Operational Task đang mở**. ID ban đầu được tạo từ assignment đầu tiên, nhưng task chưa hoàn thành là công việc thuộc Location; khi assignment thay đổi, `CompactLocationAssignments` cập nhật Staff/Assignment trên cùng task ID, không tạo task thứ hai.
- Nếu không có Staff hiện hành, task chưa hoàn thành vẫn được giữ mở nhưng Staff cũ không còn quyền đọc/ghi. Khi Staff successor có hiệu lực, task được chuyển sang assignment mới. Nếu task đang `PendingVerification`, task trở về `InProgress` và result tổng hợp cũ bị xóa để successor chủ động rà soát/gửi lại; history cũ vẫn được giữ.
- Item đã kiểm tra chỉ được carry forward khi physical identity không mơ hồ và Room/Asset ID, tên, số lượng, common area, trạng thái inherited/source vẫn khớp baseline mới. Giữ note, IncidentId, checked state và provenance `PriorStaffTaskId`/`PriorStaffUserId`. Nhiều lần đổi Staff phải giữ người kiểm tra gốc, không biến successor trung gian thành người kiểm tra gốc.
- Task đã `Completed` không bị chuyển sang successor. Assignment mới có thể tạo task mới; report/PDF đã ký trước đó giữ nguyên lịch sử.
- Reconcile/job chạy lặp phải idempotent; không tạo nhiều open task cho cùng Location.

## 2. Nguồn checklist chính xác

Checklist Staff chỉ có các nhóm tài sản vật lý mà Owner đã kiểm kê/xác nhận, không sao chép đơn thuần từ catalog mẫu, `DesiredAssets` hoặc Asset chưa xác minh.

- Nhóm phòng cần `RoomInventoryChecklistReview` ở trạng thái `Matched`/`PartiallyChecked` với item `checked=true` khớp `DesiredAssets` ID+Version hiện hành; `AssetVerification(Status=Verified, source=OwnerAttestation)` phải khớp Room/template/item/quantity; Asset vật lý còn `Active`, đúng tên, loại, số lượng và đơn vị.
- Khu vực chung cần `CommonAssetInventoryVerification(Status=Verified)` có fingerprint khớp cấu hình hiện hành và Asset vật lý phù hợp.
- Một nhóm tài sản tại một Room có một Asset ID và một quantity. Không tạo Asset ID riêng cho từng chiếc trong nhóm.
- Phòng được Owner xác nhận thực sự không có tài sản chỉ tạo dòng `Quantity=0` khi có `RoomNoAssets(Status=Confirmed)` và baseline khớp cấu hình/assignment hiện hành.
- Phòng hoặc common assets chưa đủ xác nhận Owner được trả riêng qua `PendingOwnerRooms` / `PendingOwnerCommonAssets`; chúng không phải item có thể tick và chặn Staff submit.
- Item kế thừa từ biên bản Tenant chỉ được tự động checked khi cùng một tài sản/nhóm và quantity đã có trong baseline Owner-confirmed, hợp đồng Tenant hiện hành hợp lệ và biên bản bàn giao Tenant hợp lệ/đã xác nhận. Item kế thừa read-only, được tính vào snapshot và tiến độ; không tự tạo Asset hoặc item mới, không thay thế Owner confirmation. Tài sản khu vực chung luôn do Staff kiểm tra.

## 3. Checklist Staff và điều kiện submit

- `GET /api/v1/operational-tasks/{taskId}/location-asset-inventory` trả snapshot, `TotalCount`/`CheckedCount`, version, trạng thái task, item phòng/common và Owner-pending blockers.
- `PUT /api/v1/operational-tasks/{taskId}/location-asset-inventory/items/{itemId}` cập nhật `Version`, `Checked`, `Condition`, `Note`, `IncidentId` với `Idempotency-Key`. Chỉ Staff đang phụ trách assignment hiện hành và task `InProgress` được ghi.
- `Intact` không cần note. `Missing`/`Damaged` cần note và Incident liên kết đúng Location/Room/Asset. `NotAccessible` cần note. Item Tenant-inherited không cho Staff sửa baseline; nếu phát hiện thiếu/hỏng, Staff vẫn tạo Incident và chỉ gắn IncidentId, giữ nguyên checked/condition/note/source gốc.
- Staff chỉ submit khi payload đầy đủ; mọi item checked; không còn Owner-pending Room/common; Missing/Damaged có note+Incident; NotAccessible có note; source Owner-confirmed và inherited evidence còn khớp; version hiện hành được xác nhận.
- Task actions `start`, `progress`, `blockers`, `submit` dùng Operational Task API hiện có. `verify`/`cancel`/`rework` generic không thay thế quy trình bàn giao riêng.

## 4. Owner review, rework và chữ ký

- Owner đối soát snapshot và lập biên bản revision bất biến. Report status lần lượt: `PendingOwnerSignature` → `PendingStaffSignature` → `Completed`.
- Owner ký trước; chỉ đúng StaffId trên report, đang có responsibility hiện hành, được đọc PDF và ký đúng revision + snapshot hash. Sau khi Staff ký, task chuyển `Completed` và tạo PDF cuối có đủ hai chữ ký.
- Owner có thể rework khi task `PendingVerification`: chọn 1..1000 item và lý do 10..2000 ký tự. Chỉ item được chọn reset; Tenant-inherited item bị tranh chấp chuyển thành item Staff kiểm tra trực tiếp, còn biên bản cũ vẫn bất biến và bị đánh dấu `Superseded` theo task version.
- Assignment/version thay đổi trước Staff signature cũng làm report cũ `Superseded`; Staff không được ký bản cũ. Successor tiếp tục task hiện hành và phải submit/approve revision mới.
- Former Staff không đọc/act trên checklist, evidence, history hoặc report chưa ký/current sau khi hết responsibility. Owner giữ quyền đọc. Former Staff chỉ được read-only report/PDF đã ký bởi chính mình; không được ký lại.

## 5. API

| API                                                                                   | Quyền / tác dụng                                                                                                         |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/v1/operational-tasks/{taskId}/location-asset-inventory`                     | Owner hoặc Staff có responsibility hiện hành; xem snapshot và blockers                                                   |
| `PUT /api/v1/operational-tasks/{taskId}/location-asset-inventory/items/{itemId}`      | Staff hiện hành, task `InProgress`; update item theo version + idempotency                                               |
| `GET /api/v1/operational-tasks/{taskId}/location-asset-inventory/reconcile-preview`   | Owner; preview chênh lệch, không ghi dữ liệu                                                                             |
| `POST /api/v1/operational-tasks/{taskId}/location-asset-inventory/reconcile`          | Owner; reconcile baseline trong transaction/Location lock, chỉ `Assigned`/`InProgress`, không phá item Staff đã ghi nhận |
| `GET /api/v1/operational-tasks/{taskId}/location-asset-handover`                      | Owner/current Staff; former Staff không dùng route task hiện hành                                                        |
| `POST /api/v1/operational-tasks/{taskId}/location-asset-handover/approve`             | Owner; đối soát snapshot và lập revision/PDF preview                                                                     |
| `POST /api/v1/operational-tasks/{taskId}/location-asset-handover/rework`              | Owner; chọn item reset, tăng version và trả task về `InProgress`                                                         |
| `POST /api/v1/operational-tasks/{taskId}/location-asset-handover/sign`                | Owner ký trước; sau đó đúng Staff hiện hành ký cùng revision/hash                                                        |
| `GET /api/v1/operational-tasks/{taskId}/location-asset-handover/document`             | Owner/current Staff; former Staff không dùng route task hiện hành                                                        |
| `GET /api/v1/location-asset-handovers/archive`                                        | Staff chỉ nhận report revision đã có Owner signature + chính Staff đã ký                                                 |
| `GET /api/v1/location-asset-handovers/archive/{taskId}/revisions/{revision}`          | Chỉ snapshot của revision đã ký của chính Staff                                                                          |
| `GET /api/v1/location-asset-handovers/archive/{taskId}/revisions/{revision}/document` | Chỉ final signed PDF; không có preview/fallback                                                                          |

Các endpoint task detail/history/evidence cũng phải kiểm tra responsibility hiện hành. UI ẩn nút không thay thế Backend authorization. Khi quyền không còn, Mobile không nên mount checklist/report/evidence reads.

## 6. Kiểm chứng

- Domain: `OperationalTaskRulesTests.LocationAssetHandoverRequiresExplicitSigningAfterStaffSubmits`.
- Application: `OperationalTaskServiceTests.LocationAssetInventoryRequiresAllChecksAndPreservesInheritedEvidence`, `NewAssignmentCannotAlterPreviousAssignmentInventory`.
- Integration PostgreSQL: `LocationAssetInventoryAssignmentTests.EffectiveAssignmentCreatesOneScopedTaskWithInheritedTenantHandoverAndStaffBlockers`.
- Handover/signature: `LocationAssetHandoverSigningTests` covers owner/staff signature, rework, former Staff restrictions, successor transfer and archive list/detail/final-PDF access. CompactPostgres execution still requires `BHOME_COMPACT24_TEST_ADMIN`.
- Mobile: `location-asset-inventory-ui.test.tsx`, `location-asset-handover.test.ts`, `staff-task-detail-screen.test.tsx`.
