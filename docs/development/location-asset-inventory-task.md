# Công việc kiểm kê tài sản toàn cơ sở khi phân công Staff

Phạm vi: BF-01 (tài sản cơ sở và phòng), BF-02 / UC-08..12 (phân công Staff, công việc, tiến độ, vướng mắc), UC-17 (bàn giao phòng và tài sản với Tenant), GBR-01..03 và DBR-01 (phân quyền theo cơ sở). Đây là phần tạo checklist và thực hiện kiểm kê trước giai đoạn Owner duyệt/ký biên bản.

## Kích hoạt và tính toàn vẹn

`CompactLocationAssignments.ReconcileLocationAsync` chạy trong giao dịch khoá theo cơ sở, tại lúc phân công Staff thực sự có hiệu lực. Khi có phân công, `LocationAssetInventoryTaskFactory` tạo **một** `OperationalTask.Kind=LocationAssetHandover` gắn `AssignmentId` và Staff. Task ID cố định từ assignment ID, job chạy lại không tạo bản sao. Phân công tương lai chỉ tạo task khi đến ngày bắt đầu; task của đợt trước giữ lịch sử và không được chuyển sang Staff khác.

**Nguồn chính xác:** checklist Staff chỉ có các nhóm tài sản Owner đã kiểm kê/xác nhận thực tế, không sao chép đơn thuần từ danh mục mẫu, `DesiredAssets` hoặc Asset chưa xác minh. Nhóm phòng cần cả `RoomInventoryChecklistReview` ở trạng thái `Matched`/`PartiallyChecked` có item `checked=true` khớp `DesiredAssets` ID+Version hiện hành, `AssetVerification(Status=Verified, source=OwnerAttestation)` khớp room/template/item/quantity và Asset còn `Active` đúng tên, loại, số lượng. Khu vực chung cần `CommonAssetInventoryVerification(Status=Verified)` có fingerprint đúng cấu hình hiện hành và Asset vật lý khớp. Không hợp thức hóa tài sản có sẵn nhưng không có xác nhận Owner.

Phòng được Owner xác nhận **thực sự không có tài sản** chỉ được tạo một mục `Quantity=0` khi có `RoomNoAssets(Status=Confirmed)` và baseline khớp phiên bản cấu hình/assignment hiện tại. Những phòng khác chưa đủ xác nhận Owner sẽ nằm ở `PendingOwnerRooms` (không phải item có thể tick), và tài sản chung chưa xác minh được báo bằng `PendingOwnerCommonAssets`; hai trạng thái này **chặn gửi duyệt và ký**, tránh hợp thức hóa toàn cơ sở khi Owner chưa hoàn tất kiểm kê. Một cơ sở hoàn toàn chưa có xác nhận Owner không thể gửi checklist rỗng để ký.

Một mục phòng chỉ được tự xác nhận kế thừa nếu hiện có đúng một hợp đồng thuê `Active`, nằm trong thời hạn thuê, phòng `Occupied`, tài khoản Tenant đang hoạt động và mang vai trò Tenant; biên bản bàn giao của hợp đồng hoặc chuỗi gia hạn cùng Tenant phải `Confirmed`, Tenant và Staff đã xác nhận phiên bản hiện tại, và tài sản/nhóm cùng số lượng đã được bàn giao. Item kế thừa giữ `SourceHandoverContractId`, không cho Staff sửa trực tiếp. Tài sản chung luôn được Staff kiểm tra.

## API và trạng thái

- `GET /api/v1/operational-tasks/{taskId}/location-asset-inventory` — xem checklist, thống kê `TotalCount`/`CheckedCount`, trạng thái task và phiên bản.
- `GET /api/v1/operational-tasks/{taskId}/location-asset-inventory/reconcile-preview` — chỉ Owner, đọc trạng thái chênh lệch source Owner đã xác nhận so với snapshot cũ, số mục cần thêm/xóa và lý do chặn nếu có; **không thay đổi dữ liệu**.
- `POST /api/v1/operational-tasks/{taskId}/location-asset-inventory/reconcile` — chỉ Owner với `{version, confirmed:true}` và `Idempotency-Key` GUID; chạy dưới Location transaction lock, chỉ cho `Assigned`/`InProgress`, từ chối nếu xóa/sửa hạng mục Staff đã check/ghi chú/liên kết sự cố hoặc kế thừa Tenant. Giữ lịch sử Staff, cập nhật task version và ghi audit `location_asset_inventory_owner_reconciled`; không ghi đè hồ sơ đã `PendingVerification`/ký.
- `PUT /api/v1/operational-tasks/{taskId}/location-asset-inventory/items/{itemId}` — gửi `Version`, `Checked`, `Note`, `IncidentId` (tùy chọn), bắt buộc header `Idempotency-Key` GUID. Chỉ Staff phụ trách đúng assignment hiện tại và task đang `InProgress` được cập nhật.
- Dùng tác vụ thường `POST /api/v1/operational-tasks/{taskId}/start`, `progress`, `blockers`, `submit`, các API lịch sử/tải bằng chứng hiện hành. `submit` chỉ hợp lệ nếu checklist đã xác nhận hết, Owner xác nhận toàn bộ phòng/tài sản và nguồn xác nhận hiện tại còn khớp snapshot; chuyển `Assigned -> InProgress -> PendingVerification`. Mục liên kết sự cố phải thuộc cùng Location/Room/Asset và Staff báo cáo hoặc đã liên kết hợp lệ.
- `verify`/`cancel`/`rework` thông thường bị khoá cho loại task này. Quy trình Owner review và Owner+Staff ký độc lập phụ trách hoàn tất `Completed` sau khi có đủ hai bên xác nhận.

Không định nghĩa SLA mới hoặc thời hạn kiểm kê tự động vì chưa có quyết định nghiệp vụ về hạn hoàn thành. Task chưa ký khi phân công hết hiệu lực được giữ để Owner thấy hồ sơ lịch sử, trong khi Staff cũ mất quyền sửa; nếu cần trạng thái kết thúc/chuyển trách nhiệm riêng cho biên bản ký dở phải thống nhất nghiệp vụ trước khi thêm.

## Kiểm chứng

- Domain: `OperationalTaskRulesTests.LocationAssetHandoverRequiresExplicitSigningAfterStaffSubmits`.
- Application: `OperationalTaskServiceTests.LocationAssetInventoryRequiresAllChecksAndPreservesInheritedEvidence` và `NewAssignmentCannotAlterPreviousAssignmentInventory`.
- Integration PostgreSQL: `LocationAssetInventoryAssignmentTests.EffectiveAssignmentCreatesOneScopedTaskWithInheritedTenantHandoverAndStaffBlockers` dùng DB disposable khi `BHOME_COMPACT24_TEST_ADMIN` được cấu hình. Bao gồm chỉ Owner-attested item, loại cấu hình thiếu, kế thừa Tenant, scope Staff, idempotency, báo vướng mắc và chặn submit nếu Owner chưa xác nhận đủ.
