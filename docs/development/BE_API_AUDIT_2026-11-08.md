# Rà soát API Backend BHOME — 08/11/2026

## Phạm vi và mức độ kết luận

Đã kiểm kê toàn bộ controller API chính và thư viện ký số, đối chiếu MVC action descriptors, DI/composition, service liên quan, client callsite và test source. Không lấy Backup/bin/obj làm bằng chứng nghiệp vụ. Đây là audit danh mục và cấu trúc luồng, không phải chứng nhận toàn bộ BE không lỗi.

- **372 cặp HTTP method–route** trong BHome.Api, gồm **12 anonymous**, 360 route còn lại không có AllowAnonymous. Có alias và Development route; không phải 372 chức năng.
- Đã build/run helper tạo MVC descriptors bằng ApplicationName BHome.Api và AddControllers, không chạy Program/Infrastructure, không kết nối DB. Inventory source khớp **372/372**, **0 cặp method–route trùng hoàn toàn**. Chưa gửi HTTP request tới từng endpoint.
- Anonymous: 5 auth (login/refresh/forgot/reset/accept invitation), 6 Public GET, 1 mobile CA có gate. Program còn map 2 health endpoint ngoài controller.
- Thư viện DigitalSigning có 15 controller routes, phục vụ Sandbox. Có 12 cặp tên route trùng wrapper API chính nhưng không collision do khác composition. Sandbox có thêm các minimal endpoint mô phỏng /sandbox/info, /sandbox/phone/requests và approve/reject, /sandbox/fake-signers; không tính vào API nghiệp vụ chính.
- Danh mục API_RUNTIME_ROUTES.md ngày 06/11 ghi 216 routes là snapshot lịch sử, chưa phản ánh code hiện tại. Không ghi đè tài liệu sinh tự động đó bằng kết quả audit này.
- “Có luồng” nghĩa là đã có entrypoint và implementation liên quan ở source; chưa đồng nghĩa provider thật/UI/native/mọi nhánh lỗi đã nghiệm thu. UC/BF/GBR/JOB là mapping theo AGENTS.md và tài liệu repo; lượt này chưa audit lại mọi DOCX/quyết định scope.

## API thừa hoặc chồng lấn

| API / nhóm | Bằng chứng và kết luận | Đề xuất |
| --- | --- | --- |
| GET /session | FoundationController chỉ trả UserId; comment nói probe sẽ được thay khi identity có; /auth/me trả UserId/SessionId/Roles | Ứng viên bỏ rõ nhất về chức năng. Chưa thấy client sản phẩm gọi trực tiếp khi dò; kiểm consumer ngoài repo/test trước deprecate. |
| GET rooms/{id}/desired-assets và /asset-inventory | Hai HttpGet cùng Inventory action, cùng service và response | Alias trùng trực tiếp; chọn asset-inventory làm canonical và migrate consumer trước bỏ alias. |
| PATCH và POST notifications/{id}/read | Hai attribute cùng Read action/ReadAsync | Giữ PATCH cho code mới; deprecate POST sau kiểm consumer. |
| POST capture/locations và capture/rooms | CaptureService chuyển sang cùng PropertyService.SaveLocationAsync/SaveRoomAsync | Chồng chức năng create; Mobile setup đang gọi capture/rooms, chưa xóa ngay. |
| POST capture/staff | Tạo Identity account qua CaptureRepository; POST /staff qua OperationsService có employment metadata | Hai đường tạo khác nhau, có nguy cơ lệch hành vi. Hợp nhất use case trước deprecate wrapper; chưa kết luận mọi đường đều lỗi. |
| POST capture/assignments | Chuyển sang cùng ILocationAssignments.CreateAssignmentAsync | Wrapper chồng staff-location-assignments; migrate consumer trước bỏ. |
| GET capture/locations/rooms/staff | NamedResource lookup; contracts/payments/finance/mobile đang gọi | Không thừa chỉ vì có CRUD list. Không ép client lấy DTO quản trị lớn/nhạy cảm. |
| Task/Incident notifications và inbox chung | DTO/service/quyền riêng; Mobile còn dùng task notifications | Chồng lấn kiến trúc, chưa phải alias; kiểm recipient/read-state/target/permission parity trước hợp nhất. |
| GET operating-policies/{id}/versions | Action lấy LocationId rồi ReadPoliciesAsync(LocationId), không lọc lineage của riêng policy | Cần làm rõ endpoint là location timeline hay lịch sử một policy; vấn đề ngữ nghĩa, không tự ý đổi contract. |
| debts và payment-invoices | Chung DebtAsync nhưng filter ép và quyền khác | Giữ; không phải hai endpoint tương đương. |
| billing-schedules và billing-automation | Lịch tính phí khác kế hoạch điều phối có snapshot/version lịch | Giữ, không gộp state model. |
| POST contracts và POST contracts/main-drafts | Khác DTO, dữ liệu soạn và signing review/release | Cần chốt flow chuẩn, kiểm invariant tương đương; chưa đủ bằng chứng kết luận duplicate hoặc bypass. |
| Preview/source/signed document/pages | Khác giai đoạn, định dạng và quyền | Không xóa chỉ vì đều là tài liệu hợp đồng. |
| Diagnostics/process-events/run-now/queue/attempts | Chẩn đoán hoặc vận hành | Tách tag và quyền/gate; không tính vào tỷ lệ hoàn thành nghiệp vụ. |
| Library ký số và wrapper host | Sandbox nạp library; API chính nạp wrapper | Không trùng runtime; nên kiểm contract drift giữa hai bộ controller. |

**Không xóa hoặc sửa API sản phẩm trong lượt audit.** Deprecate cần kiểm consumer và regression, không tự thay đổi contract hay quyền.

## Danh mục theo phần và luồng

Mọi API bên dưới đã đối chiếu source và MVC descriptor. Quyền trong bảng là metadata khai báo; service/repository còn kiểm đối tượng/Location/Tenant. Các Authorize nhiều cấp kết hợp với nhau. `{id:guid}` là route constraint; client truyền GUID thực. Action/parameter/quyền đầy đủ có trong descriptor JSON và CSV đi kèm.

## 01. Auth, tài khoản và hồ sơ — 14 API

**Truy vết:** FE-02; UC-01/02; GBR-01/02/13

**Luồng:** Mời tài khoản → accept invitation → login → refresh → xem/sửa hồ sơ → đổi/reset mật khẩu → logout/logout-all.

**Đánh giá:** Có API vòng đời phiên và lời mời. /session là probe cũ, gần như được /auth/me thay thế. Email delivery thật và lưu phiên trên thiết bị cần kiểm riêng.

| Method | Route | Action | Quyền khai báo | Source |
| --- | --- | --- | --- | --- |
| POST | `/api/v1/auth/login` | Login | Anonymous | [controller](../../src/backend/BHome.Api/Controllers/IdentityAccess/AuthController.cs#L18) |
| POST | `/api/v1/auth/refresh` | Refresh | Anonymous | [controller](../../src/backend/BHome.Api/Controllers/IdentityAccess/AuthController.cs#L36) |
| POST | `/api/v1/auth/logout` | Logout | sessions.revoke-own | [controller](../../src/backend/BHome.Api/Controllers/IdentityAccess/AuthController.cs#L47) |
| POST | `/api/v1/auth/logout-all` | LogoutAll | sessions.revoke-own | [controller](../../src/backend/BHome.Api/Controllers/IdentityAccess/AuthController.cs#L51) |
| GET | `/api/v1/auth/me` | Me | account.view-own | [controller](../../src/backend/BHome.Api/Controllers/IdentityAccess/AuthController.cs#L55) |
| POST | `/api/v1/auth/change-password` | ChangePassword | account.change-password | [controller](../../src/backend/BHome.Api/Controllers/IdentityAccess/AuthController.cs#L59) |
| POST | `/api/v1/auth/forgot-password` | ForgotPassword | Anonymous | [controller](../../src/backend/BHome.Api/Controllers/IdentityAccess/AuthController.cs#L69) |
| POST | `/api/v1/auth/reset-password` | ResetPassword | Anonymous | [controller](../../src/backend/BHome.Api/Controllers/IdentityAccess/AuthController.cs#L77) |
| POST | `/api/v1/residents/{id:guid}/invitation` | Invite | Owner | [controller](../../src/backend/BHome.Api/Controllers/IdentityAccess/AccountInvitationsController.cs#L12) |
| POST | `/api/v1/staff/{id:guid}/invitation` | InviteStaff | Owner | [controller](../../src/backend/BHome.Api/Controllers/IdentityAccess/AccountInvitationsController.cs#L14) |
| POST | `/api/v1/auth/accept-invitation` | Accept | Anonymous | [controller](../../src/backend/BHome.Api/Controllers/IdentityAccess/AccountInvitationsController.cs#L16) |
| GET | `/api/v1/account/profile` | Get | Authenticated | [controller](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs#L11) |
| PUT | `/api/v1/account/profile` | Update | Authenticated | [controller](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs#L12) |
| GET | `/api/v1/session` | Get | account.view-own | [controller](../../src/backend/BHome.Api/Controllers/FoundationController.cs#L13) |

## 02. Cơ sở, phòng và occupancy — 17 API

**Truy vết:** BF-01; UC-04..07; DBR-02

**Luồng:** Tạo Location → Room → cấu hình giá → readiness → quản lý trạng thái → occupancy/history → closure-check.

**Đánh giá:** Có CRUD, readiness, history, occupancy-summary, closure-check và staff-change-preview. Lịch sử thay đổi phòng khác lịch sử người ở và thống kê công suất; không coi chúng là API trùng.

| Method | Route | Action | Quyền khai báo | Source |
| --- | --- | --- | --- | --- |
| POST | `/api/v1/locations` | Create | locations.manage | [controller](../../src/backend/BHome.Api/Controllers/LocationsController.cs#L17) |
| GET | `/api/v1/locations` | List | property.view | [controller](../../src/backend/BHome.Api/Controllers/LocationsController.cs#L26) |
| GET | `/api/v1/locations/{id:guid}` | Get | property.view | [controller](../../src/backend/BHome.Api/Controllers/LocationsController.cs#L31) |
| GET | `/api/v1/locations/{id:guid}/occupancy-summary` | OccupancySummary | property.view | [controller](../../src/backend/BHome.Api/Controllers/LocationsController.cs#L34) |
| PUT | `/api/v1/locations/{id:guid}` | Update | property.manage | [controller](../../src/backend/BHome.Api/Controllers/LocationsController.cs#L38) |
| GET | `/api/v1/locations/{id:guid}/closure-check` | ClosureCheck | property.manage | [controller](../../src/backend/BHome.Api/Controllers/LocationsController.cs#L41) |
| GET | `/api/v1/locations/{id:guid}/staff-change-preview` | StaffChangePreview | property.manage | [controller](../../src/backend/BHome.Api/Controllers/LocationsController.cs#L43) |
| GET | `/api/v1/locations/assigned-to-me` | ListAssigned | locations.view-assigned | [controller](../../src/backend/BHome.Api/Controllers/LocationsController.cs#L46) |
| GET | `/api/v1/rooms` | List | property.view | [controller](../../src/backend/BHome.Api/Controllers/PropertyManagement/PropertyControllers.cs#L12) |
| GET | `/api/v1/rooms/{id:guid}` | Get | property.view | [controller](../../src/backend/BHome.Api/Controllers/PropertyManagement/PropertyControllers.cs#L13) |
| GET | `/api/v1/rooms/{id:guid}/prices` | Prices | property.view | [controller](../../src/backend/BHome.Api/Controllers/PropertyManagement/PropertyControllers.cs#L14) |
| GET | `/api/v1/rooms/{id:guid}/readiness` | Readiness | property.view | [controller](../../src/backend/BHome.Api/Controllers/PropertyManagement/PropertyControllers.cs#L16) |
| GET | `/api/v1/rooms/{id:guid}/history` | History | property.view | [controller](../../src/backend/BHome.Api/Controllers/PropertyManagement/PropertyControllers.cs#L20) |
| POST | `/api/v1/rooms` | Create | property.view + property.manage | [controller](../../src/backend/BHome.Api/Controllers/PropertyManagement/PropertyControllers.cs#L23) |
| PUT | `/api/v1/rooms/{id:guid}` | Update | property.view + property.manage | [controller](../../src/backend/BHome.Api/Controllers/PropertyManagement/PropertyControllers.cs#L28) |
| GET | `/api/v1/occupancy` | List | Authenticated | [controller](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs#L58) |
| GET | `/api/v1/rooms/{id:guid}/occupancy-history` | History | Authenticated | [controller](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs#L65) |

## 03. Staff và trách nhiệm Location — 8 API

**Truy vết:** BF-02; UC-08/09; DBR-01

**Luồng:** Tạo Staff → invitation → phân công Location theo ngày → preview thay Staff → thay/gỡ trách nhiệm.

**Đánh giá:** Có quản lý Staff và assignment. Cần kiểm xuyên GENERAL task, meter task, Work Order và inspection khi thay Staff; có API reassignment chưa chứng minh mọi loại việc được chuyển đồng bộ.

| Method | Route | Action | Quyền khai báo | Source |
| --- | --- | --- | --- | --- |
| GET | `/api/v1/staff` | List | Authenticated | [controller](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs#L19) |
| GET | `/api/v1/staff/{id:guid}` | Get | Authenticated | [controller](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs#L20) |
| POST | `/api/v1/staff` | Create | Authenticated | [controller](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs#L21) |
| PUT | `/api/v1/staff/{id:guid}` | Update | Authenticated | [controller](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs#L27) |
| POST | `/api/v1/staff-location-assignments` | Assign | staff-assignments.manage | [controller](../../src/backend/BHome.Api/Controllers/LocationsController.cs#L63) |
| GET | `/api/v1/staff-location-assignments` | ListAssignments | staff-assignments.manage | [controller](../../src/backend/BHome.Api/Controllers/LocationsController.cs#L94) |
| PUT | `/api/v1/staff-location-assignments/{locationId:guid}` | Replace | staff-assignments.manage | [controller](../../src/backend/BHome.Api/Controllers/LocationsController.cs#L108) |
| DELETE | `/api/v1/staff-location-assignments/{locationId:guid}` | Remove | staff-assignments.manage | [controller](../../src/backend/BHome.Api/Controllers/LocationsController.cs#L114) |

## 04. Task vận hành và việc định kỳ — 23 API

**Truy vết:** BF-02; UC-10..12; JOB-06/07

**Luồng:** Owner tạo/gán → Staff start/progress/blockers/evidence → submit → Owner verify/rework. Template → job sinh việc định kỳ.

**Đánh giá:** Có vòng đời chính, coordinate/cancel/history/evidence và thông báo riêng. Template API không chứng minh worker đã chạy đúng lịch/chống trùng. GENERAL task khác Work Order.

| Method | Route | Action | Quyền khai báo | Source |
| --- | --- | --- | --- | --- |
| POST | `/api/v1/operational-tasks` | Create | operational-tasks.view + operational-tasks.manage | [controller](../../src/backend/BHome.Api/Controllers/StaffOperations/OperationalTasksController.cs#L15) |
| GET | `/api/v1/operational-tasks` | List | operational-tasks.view | [controller](../../src/backend/BHome.Api/Controllers/StaffOperations/OperationalTasksController.cs#L19) |
| GET | `/api/v1/operational-tasks/{id:guid}` | Get | operational-tasks.view | [controller](../../src/backend/BHome.Api/Controllers/StaffOperations/OperationalTasksController.cs#L21) |
| PUT | `/api/v1/operational-tasks/{id:guid}` | Update | operational-tasks.view + operational-tasks.manage | [controller](../../src/backend/BHome.Api/Controllers/StaffOperations/OperationalTasksController.cs#L23) |
| POST | `/api/v1/operational-tasks/{id:guid}/assign` | Assign | operational-tasks.view + operational-tasks.manage | [controller](../../src/backend/BHome.Api/Controllers/StaffOperations/OperationalTasksController.cs#L25) |
| POST | `/api/v1/operational-tasks/{id:guid}/start` | Start | operational-tasks.view + operational-tasks.execute | [controller](../../src/backend/BHome.Api/Controllers/StaffOperations/OperationalTasksController.cs#L27) |
| POST | `/api/v1/operational-tasks/{id:guid}/progress` | Progress | operational-tasks.view + operational-tasks.execute | [controller](../../src/backend/BHome.Api/Controllers/StaffOperations/OperationalTasksController.cs#L29) |
| POST | `/api/v1/operational-tasks/{id:guid}/blockers` | Blockers | operational-tasks.view + operational-tasks.execute | [controller](../../src/backend/BHome.Api/Controllers/StaffOperations/OperationalTasksController.cs#L31) |
| POST | `/api/v1/operational-tasks/{id:guid}/coordinate` | Coordinate | operational-tasks.view + operational-tasks.manage | [controller](../../src/backend/BHome.Api/Controllers/StaffOperations/OperationalTasksController.cs#L33) |
| POST | `/api/v1/operational-tasks/{id:guid}/submit` | Submit | operational-tasks.view + operational-tasks.execute | [controller](../../src/backend/BHome.Api/Controllers/StaffOperations/OperationalTasksController.cs#L35) |
| POST | `/api/v1/operational-tasks/{id:guid}/verify` | Verify | operational-tasks.view + operational-tasks.verify | [controller](../../src/backend/BHome.Api/Controllers/StaffOperations/OperationalTasksController.cs#L37) |
| POST | `/api/v1/operational-tasks/{id:guid}/rework` | Rework | operational-tasks.view + operational-tasks.verify | [controller](../../src/backend/BHome.Api/Controllers/StaffOperations/OperationalTasksController.cs#L39) |
| POST | `/api/v1/operational-tasks/{id:guid}/cancel` | Cancel | operational-tasks.view + operational-tasks.manage | [controller](../../src/backend/BHome.Api/Controllers/StaffOperations/OperationalTasksController.cs#L41) |
| GET | `/api/v1/operational-tasks/{id:guid}/history` | History | operational-tasks.view | [controller](../../src/backend/BHome.Api/Controllers/StaffOperations/OperationalTasksController.cs#L43) |
| GET | `/api/v1/operational-tasks/{id:guid}/evidence` | Evidence | operational-tasks.view | [controller](../../src/backend/BHome.Api/Controllers/StaffOperations/OperationalTasksController.cs#L45) |
| PUT | `/api/v1/operational-tasks/{id:guid}/evidence` | Upload | operational-tasks.view + operational-tasks.execute | [controller](../../src/backend/BHome.Api/Controllers/StaffOperations/OperationalTasksController.cs#L47) |
| GET | `/api/v1/operational-tasks/{id:guid}/evidence/{evidenceId:guid}` | Download | operational-tasks.view | [controller](../../src/backend/BHome.Api/Controllers/StaffOperations/OperationalTasksController.cs#L49) |
| GET | `/api/v1/operational-tasks/notifications` | Notifications | operational-tasks.view + notifications.read-own | [controller](../../src/backend/BHome.Api/Controllers/StaffOperations/OperationalTasksController.cs#L61) |
| POST | `/api/v1/operational-tasks/notifications/{id:guid}/read` | Read | operational-tasks.view + notifications.read-own | [controller](../../src/backend/BHome.Api/Controllers/StaffOperations/OperationalTasksController.cs#L63) |
| GET | `/api/v1/operational-task-templates` | List | Authenticated | [controller](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs#L120) |
| POST | `/api/v1/operational-task-templates` | Create | Authenticated | [controller](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs#L121) |
| PUT | `/api/v1/operational-task-templates/{id:guid}` | Update | Authenticated | [controller](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs#L127) |
| DELETE | `/api/v1/operational-task-templates/{id:guid}` | Delete | Authenticated | [controller](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs#L128) |

## 05. Tài sản và kiểm kê theo mẫu — 23 API

**Truy vết:** BF-01; UC-05; quyết định mở rộng setup

**Luồng:** Draft template → publish → gán phòng → sync desired inventory → kiểm kê/verify → condition/metadata → replace/history.

**Đánh giá:** Có mẫu, sync run, kiểm kê và xác minh. desired-assets và asset-inventory là hai URL cùng action/cùng InventoryAsync. Setup evidence là bằng chứng chung theo Location, khác evidence chuyên biệt.

| Method | Route | Action | Quyền khai báo | Source |
| --- | --- | --- | --- | --- |
| GET | `/api/v1/assets` | List | property.view | [controller](../../src/backend/BHome.Api/Controllers/PropertyManagement/PropertyControllers.cs#L36) |
| GET | `/api/v1/assets/{id:guid}` | Get | property.view | [controller](../../src/backend/BHome.Api/Controllers/PropertyManagement/PropertyControllers.cs#L37) |
| POST | `/api/v1/assets` | Create | property.view + property.manage | [controller](../../src/backend/BHome.Api/Controllers/PropertyManagement/PropertyControllers.cs#L38) |
| PUT | `/api/v1/assets/{id:guid}` | Update | property.view + property.manage | [controller](../../src/backend/BHome.Api/Controllers/PropertyManagement/PropertyControllers.cs#L43) |
| PATCH | `/api/v1/assets/{id:guid}/condition` | UpdateCondition | property.view + assets.update-condition | [controller](../../src/backend/BHome.Api/Controllers/PropertyManagement/PropertyControllers.cs#L45) |
| GET | `/api/v1/asset-templates` | Templates | Owner,Staff + Owner | [controller](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L12) |
| GET | `/api/v1/asset-templates/{id:guid}` | Template | Owner,Staff + Owner | [controller](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L14) |
| POST | `/api/v1/asset-templates` | Create | Owner,Staff + Owner | [controller](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L16) |
| PUT | `/api/v1/asset-templates/{id:guid}/draft` | Update | Owner,Staff + Owner | [controller](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L18) |
| POST | `/api/v1/asset-templates/{id:guid}/drafts` | Clone | Owner,Staff + Owner | [controller](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L20) |
| PUT | `/api/v1/rooms/{id:guid}/asset-template` | Assign | Owner,Staff + Owner | [controller](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L22) |
| POST | `/api/v1/asset-templates/{id:guid}/publish` | Publish | Owner,Staff + Owner | [controller](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L24) |
| POST | `/api/v1/asset-templates/{id:guid}/sync` | Sync | Owner,Staff + Owner | [controller](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L26) |
| GET | `/api/v1/asset-template-sync-runs/{id:guid}` | SyncRun | Owner,Staff + Owner | [controller](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L28) |
| GET | `/api/v1/assets/{id:guid}/history` | History | Owner,Staff | [controller](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L30) |
| GET | `/api/v1/rooms/{id:guid}/desired-assets` | Inventory | Owner,Staff | [controller](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L32) |
| GET | `/api/v1/rooms/{id:guid}/asset-inventory` | Inventory | Owner,Staff | [controller](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L33) |
| POST | `/api/v1/rooms/{id:guid}/assets/verify` | Verify | Owner,Staff | [controller](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L35) |
| PUT | `/api/v1/assets/{id:guid}/metadata` | Metadata | Owner,Staff + Owner | [controller](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L37) |
| GET | `/api/v1/assets/{id:guid}/metadata` | GetMetadata | Owner,Staff + Owner | [controller](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L39) |
| POST | `/api/v1/assets/{id:guid}/replace` | Replace | Owner,Staff + Owner | [controller](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L41) |
| POST | `/api/v1/locations/{locationId:guid}/setup-evidence` | Upload | Owner,Staff | [controller](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L105) |
| GET | `/api/v1/locations/{locationId:guid}/setup-evidence/{id:guid}` | Download | Owner,Staff | [controller](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L107) |

## 06. Giá, phí và điện nước nâng cao — 27 API

**Truy vết:** BF-01/05; UC-06/20/21; GBR-08

**Luồng:** Billing policy theo hiệu lực; tariff → source meter/link → quota/profile → source reading/bill → reconciliation preview/save/review → tính hóa đơn.

**Đánh giá:** BillingPolicies khác UtilityTariffs. UtilityWorkspaceService được đăng ký IUtilityBilling và InvoiceService dùng kết quả; đã có liên kết tính phí. Cần kiểm thay giá giữa kỳ, variance, thiếu dữ liệu và finalize gate; không tự coi mọi phạm vi mở rộng đã được nghiệm thu.

| Method | Route | Action | Quyền khai báo | Source |
| --- | --- | --- | --- | --- |
| GET | `/api/v1/billing-policies` | List | property.view | [controller](../../src/backend/BHome.Api/Controllers/PropertyManagement/PropertyControllers.cs#L53) |
| GET | `/api/v1/billing-policies/{id:guid}` | Get | property.view | [controller](../../src/backend/BHome.Api/Controllers/PropertyManagement/PropertyControllers.cs#L54) |
| POST | `/api/v1/billing-policies` | Create | property.view + property.manage | [controller](../../src/backend/BHome.Api/Controllers/PropertyManagement/PropertyControllers.cs#L55) |
| POST | `/api/v1/billing-policies/{id:guid}/replacement` | Replace | property.view + property.manage | [controller](../../src/backend/BHome.Api/Controllers/PropertyManagement/PropertyControllers.cs#L60) |
| PUT | `/api/v1/billing-policies/{id:guid}` | Update | property.view + property.manage | [controller](../../src/backend/BHome.Api/Controllers/PropertyManagement/PropertyControllers.cs#L65) |
| POST | `/api/v1/billing-policies/{id:guid}/end` | End | property.view + property.manage | [controller](../../src/backend/BHome.Api/Controllers/PropertyManagement/PropertyControllers.cs#L67) |
| GET | `/api/v1/utility-tariffs` | Tariffs | Owner | [controller](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L49) |
| GET | `/api/v1/utility-tariffs/{id:guid}` | Tariff | Owner | [controller](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L50) |
| POST | `/api/v1/utility-tariffs` | CreateTariff | Owner | [controller](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L51) |
| POST | `/api/v1/utility-tariffs/{id:guid}/replacement` | ReplaceTariff | Owner | [controller](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L52) |
| GET | `/api/v1/utility-source-meters` | Meters | Owner | [controller](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L54) |
| POST | `/api/v1/utility-source-meters` | Meter | Owner | [controller](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L55) |
| POST | `/api/v1/utility-meter-links` | Link | Owner | [controller](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L56) |
| POST | `/api/v1/utility-quotas` | Quota | Owner | [controller](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L57) |
| GET | `/api/v1/utility-quotas` | Quotas | Owner | [controller](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L58) |
| POST | `/api/v1/utility-profiles` | Profile | Owner | [controller](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L59) |
| POST | `/api/v1/utility-profiles/{id:guid}/replacement` | ReplaceProfile | Owner | [controller](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L60) |
| GET | `/api/v1/utility-profiles` | Profiles | Owner | [controller](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L61) |
| POST | `/api/v1/utility-source-bills` | Bill | Owner | [controller](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L62) |
| GET | `/api/v1/utility-source-bills/{id:guid}` | Bill | Owner | [controller](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L64) |
| GET | `/api/v1/utility-source-bills` | Bills | Owner | [controller](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L65) |
| POST | `/api/v1/utility-reconciliations/preview` | Preview | Owner | [controller](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L66) |
| POST | `/api/v1/utility-reconciliations` | Reconcile | Owner | [controller](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L67) |
| GET | `/api/v1/utility-reconciliations/{id:guid}` | Reconciliation | Owner | [controller](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L68) |
| POST | `/api/v1/utility-reconciliations/{id:guid}/review` | Review | Owner | [controller](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L69) |
| POST | `/api/v1/utility-period-breakdowns` | Breakdown | Owner | [controller](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L71) |
| POST | `/api/v1/utility-source-readings` | Confirm | Owner,Staff | [controller](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L79) |

## 07. Nội quy và phụ lục nội quy — 9 API

**Truy vết:** BF-03/04; GBR-04; quyết định scope nội quy

**Luồng:** Tạo/sửa Draft → publish → snapshot vào hợp đồng → xem agreed policy → tạo phụ lục → ký/kích hoạt hoặc hủy.

**Đánh giá:** Có workflow và snapshot Terms. GET operating-policies/{id}/versions hiện lấy LocationId rồi trả ReadPoliciesAsync(LocationId), chưa lọc lineage của riêng policy. Cần làm rõ ngữ nghĩa trước đổi contract.

| Method | Route | Action | Quyền khai báo | Source |
| --- | --- | --- | --- | --- |
| GET | `/api/v1/operating-policies` | List | Authenticated + Owner,Staff | [controller](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L86) |
| GET | `/api/v1/operating-policies/{id:guid}` | Get | Authenticated + Owner,Staff | [controller](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L87) |
| GET | `/api/v1/operating-policies/{id:guid}/versions` | Versions | Authenticated + Owner,Staff | [controller](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L88) |
| POST | `/api/v1/operating-policies` | Create | Authenticated + Owner | [controller](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L90) |
| PUT | `/api/v1/operating-policies/{id:guid}/draft` | Update | Authenticated + Owner | [controller](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L91) |
| POST | `/api/v1/operating-policies/{id:guid}/publish` | Publish | Authenticated + Owner | [controller](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L92) |
| GET | `/api/v1/contracts/{id:guid}/agreed-operating-policy` | Agreed | Authenticated | [controller](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L93) |
| POST | `/api/v1/contracts/{id:guid}/operating-policy-amendments` | Amend | Authenticated + Owner | [controller](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L94) |
| POST | `/api/v1/contracts/{id:guid}/operating-policy-amendment-cancellation` | Cancel | Authenticated + Owner | [controller](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L96) |

## 08. Capture người ở, công tơ và OCR — 21 API

**Truy vết:** BF-03/05; UC-13..15/20; GBR-07

**Luồng:** Lookup Location/Room → resident → OCR transient → Staff confirm identity; meter/task → ảnh/OCR proposal → Staff confirm reading → đọc evidence.

**Đánh giá:** OCR và human confirmation tách biệt. Capture lookup dùng DTO NamedResource và đang có nhiều client gọi. Capture create Location/Room dùng chung PropertyService; tạo Staff có đường riêng. Capture reading controller chỉ cho Owner/Staff; cần kiểm Tenant đã xem được chỉ số trước Draft qua DTO/màn khác hay chưa.

| Method | Route | Action | Quyền khai báo | Source |
| --- | --- | --- | --- | --- |
| GET | `/api/v1/capture/locations` | Locations | Owner,Staff | [controller](../../src/backend/BHome.Api/Controllers/Ocr/CaptureController.cs#L12) |
| GET | `/api/v1/capture/locations/{id:guid}/rooms` | Rooms | Owner,Staff | [controller](../../src/backend/BHome.Api/Controllers/Ocr/CaptureController.cs#L13) |
| GET | `/api/v1/capture/staff` | Staff | Owner,Staff | [controller](../../src/backend/BHome.Api/Controllers/Ocr/CaptureController.cs#L14) |
| POST | `/api/v1/capture/staff` | Staff | Owner,Staff + Owner | [controller](../../src/backend/BHome.Api/Controllers/Ocr/CaptureController.cs#L15) |
| POST | `/api/v1/capture/locations` | Location | Owner,Staff + Owner | [controller](../../src/backend/BHome.Api/Controllers/Ocr/CaptureController.cs#L16) |
| POST | `/api/v1/capture/rooms` | Room | Owner,Staff + Owner | [controller](../../src/backend/BHome.Api/Controllers/Ocr/CaptureController.cs#L17) |
| POST | `/api/v1/capture/assignments` | Assignment | Owner,Staff + Owner | [controller](../../src/backend/BHome.Api/Controllers/Ocr/CaptureController.cs#L18) |
| GET | `/api/v1/capture/locations/{id:guid}/residents` | Residents | Owner,Staff | [controller](../../src/backend/BHome.Api/Controllers/Ocr/CaptureController.cs#L19) |
| POST | `/api/v1/capture/residents` | Resident | Owner,Staff | [controller](../../src/backend/BHome.Api/Controllers/Ocr/CaptureController.cs#L20) |
| POST | `/api/v1/capture/residents/{id:guid}/confirm` | Identity | Owner,Staff + Staff | [controller](../../src/backend/BHome.Api/Controllers/Ocr/CaptureController.cs#L21) |
| GET | `/api/v1/capture/locations/{id:guid}/meters` | Meters | Owner,Staff | [controller](../../src/backend/BHome.Api/Controllers/Ocr/CaptureController.cs#L22) |
| POST | `/api/v1/capture/meters` | Meter | Owner,Staff + Owner | [controller](../../src/backend/BHome.Api/Controllers/Ocr/CaptureController.cs#L23) |
| GET | `/api/v1/capture/meter-tasks` | Tasks | Owner,Staff | [controller](../../src/backend/BHome.Api/Controllers/Ocr/CaptureController.cs#L24) |
| GET | `/api/v1/capture/meter-tasks/{id:guid}` | TaskDetail | Owner,Staff | [controller](../../src/backend/BHome.Api/Controllers/Ocr/CaptureController.cs#L25) |
| GET | `/api/v1/capture/readings/{id:guid}` | Reading | Owner,Staff | [controller](../../src/backend/BHome.Api/Controllers/Ocr/CaptureController.cs#L26) |
| POST | `/api/v1/capture/meter-tasks` | Task | Owner,Staff + Owner | [controller](../../src/backend/BHome.Api/Controllers/Ocr/CaptureController.cs#L27) |
| PUT | `/api/v1/capture/meter-tasks/{id:guid}/evidence` | Evidence | Owner,Staff + Staff | [controller](../../src/backend/BHome.Api/Controllers/Ocr/CaptureController.cs#L28) |
| POST | `/api/v1/capture/meter-tasks/{id:guid}/confirm` | ConfirmMeter | Owner,Staff + Staff | [controller](../../src/backend/BHome.Api/Controllers/Ocr/CaptureController.cs#L30) |
| GET | `/api/v1/capture/readings/{id:guid}/evidence` | EvidenceFile | Owner,Staff | [controller](../../src/backend/BHome.Api/Controllers/Ocr/CaptureController.cs#L31) |
| POST | `/api/v1/ocr/identity/{residentId:guid}/{side}` | Identity | Owner,Staff | [controller](../../src/backend/BHome.Api/Controllers/Ocr/OcrController.cs#L14) |
| POST | `/api/v1/ocr/meter-tasks/{taskId:guid}` | Meter | Staff | [controller](../../src/backend/BHome.Api/Controllers/Ocr/OcrController.cs#L26) |

## 09. Soạn hợp đồng Main Draft — 12 API

**Truy vết:** BF-03; UC-15/16; GBR-04

**Luồng:** Preparation/settings → tạo/sửa draft → sinh tài liệu → PDF/pages → signing-review → Owner release → ký/kích hoạt.

**Đánh giá:** Có chuỗi soạn và release, kiểm người ở/settings/tài liệu. POST contracts vẫn là đường tạo khác DTO/quy trình; cần chọn flow chuẩn và kiểm invariant tương đương, chưa kết luận duplicate hoàn toàn.

| Method | Route | Action | Quyền khai báo | Source |
| --- | --- | --- | --- | --- |
| GET | `/api/v1/contracts/main-drafts/preparation` | Prepare | Owner,Staff | [controller](../../src/backend/BHome.Api/Controllers/MainDraftsController.cs#L14) |
| GET | `/api/v1/contracts/main-drafts/settings/{locationId:guid}` | Settings | Owner,Staff + Owner | [controller](../../src/backend/BHome.Api/Controllers/MainDraftsController.cs#L16) |
| PUT | `/api/v1/contracts/main-drafts/settings/{locationId:guid}` | Settings | Owner,Staff + Owner | [controller](../../src/backend/BHome.Api/Controllers/MainDraftsController.cs#L18) |
| POST | `/api/v1/contracts/main-drafts` | Create | Owner,Staff | [controller](../../src/backend/BHome.Api/Controllers/MainDraftsController.cs#L20) |
| GET | `/api/v1/contracts/main-drafts/{id:guid}` | Get | Owner,Staff | [controller](../../src/backend/BHome.Api/Controllers/MainDraftsController.cs#L22) |
| PUT | `/api/v1/contracts/main-drafts/{id:guid}` | Update | Owner,Staff | [controller](../../src/backend/BHome.Api/Controllers/MainDraftsController.cs#L24) |
| POST | `/api/v1/contracts/main-drafts/{id:guid}/documents` | Generate | Owner,Staff | [controller](../../src/backend/BHome.Api/Controllers/MainDraftsController.cs#L26) |
| POST | `/api/v1/contracts/main-drafts/{id:guid}/signing-review` | SigningReview | Owner,Staff | [controller](../../src/backend/BHome.Api/Controllers/MainDraftsController.cs#L28) |
| POST | `/api/v1/contracts/main-drafts/{id:guid}/release` | Release | Owner,Staff + Owner | [controller](../../src/backend/BHome.Api/Controllers/MainDraftsController.cs#L30) |
| GET | `/api/v1/contracts/main-drafts/{id:guid}/documents/{fileId:guid}` | Download | Owner,Staff | [controller](../../src/backend/BHome.Api/Controllers/MainDraftsController.cs#L32) |
| GET | `/api/v1/contracts/main-drafts/{id:guid}/documents/{fileId:guid}/preview` | Preview | Owner,Staff | [controller](../../src/backend/BHome.Api/Controllers/MainDraftsController.cs#L39) |
| GET | `/api/v1/contracts/main-drafts/{id:guid}/documents/{fileId:guid}/pages/{page:int}` | Page | Owner,Staff | [controller](../../src/backend/BHome.Api/Controllers/MainDraftsController.cs#L41) |

## 10. Hợp đồng, Holding, ký, bàn giao và move-out — 58 API

**Truy vết:** BF-03/04; UC-14..19; GBR-04; DBR-02/03; JOB-02/05

**Luồng:** Holding → approve → ký + tiền xác minh → activate → convert Main. Main → ký/sync/recover → deposit/readiness → Owner activate → handover hai bên. Renewal hoặc termination/expiry → approve/schedule → inspection/review → settlement → complete.

**Đánh giá:** Có action cho các chặng chính, history/versions, private file và dispute bàn giao. Sự tồn tại route không chứng minh provider thật. Move-out complete không thay settlement/refund; previews/source/signed document khác giai đoạn.

| Method | Route | Action | Quyền khai báo | Source |
| --- | --- | --- | --- | --- |
| GET | `/api/v1/contracts` | List | Owner,Staff,Tenant | [controller](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L16) |
| GET | `/api/v1/contracts/configuration` | Configuration | Owner,Staff,Tenant | [controller](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L21) |
| GET | `/api/v1/contracts/expiry-reminders` | ExpiryReminders | Owner,Staff,Tenant + Owner,Tenant | [controller](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L23) |
| GET | `/api/v1/contracts/preparation` | Preparation | Owner,Staff,Tenant + Owner,Staff | [controller](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L25) |
| GET | `/api/v1/contracts/preparation/accounts` | TenantAccounts | Owner,Staff,Tenant + Owner | [controller](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L27) |
| POST | `/api/v1/contracts/preparation/residents/{residentId:guid}/account` | LinkTenant | Owner,Staff,Tenant + Owner | [controller](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L29) |
| GET | `/api/v1/contracts/{id:guid}/history` | History | Owner,Staff,Tenant | [controller](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L32) |
| GET | `/api/v1/contracts/{id:guid}/versions` | Versions | Owner,Staff,Tenant | [controller](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L34) |
| GET | `/api/v1/contracts/move-out-assignments` | Assignments | Owner,Staff,Tenant + Staff | [controller](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L36) |
| GET | `/api/v1/contracts/{id:guid}/move-out/history` | MoveHistory | Owner,Staff,Tenant | [controller](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L38) |
| GET | `/api/v1/contracts/{id:guid}/move-out/inspection-preparation` | InspectionPreparation | Owner,Staff,Tenant + Owner,Staff | [controller](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L40) |
| GET | `/api/v1/contracts/{id:guid}/move-out/inspections` | Inspections | Owner,Staff,Tenant | [controller](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L42) |
| POST | `/api/v1/contracts/{id:guid}/move-out/inspection-review` | InspectionReview | Owner,Staff,Tenant + Owner | [controller](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L44) |
| GET | `/api/v1/contracts/{id:guid}/move-out/settlement-summary` | SettlementSummary | Owner,Staff,Tenant + Owner,Tenant | [controller](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L46) |
| GET | `/api/v1/contracts/{id:guid}/deposit-verifications` | Deposits | Owner,Staff,Tenant + Owner,Tenant | [controller](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L48) |
| GET | `/api/v1/contracts/{id:guid}/previews` | Previews | Owner,Staff,Tenant + Owner,Tenant | [controller](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L50) |
| POST | `/api/v1/contracts/{id:guid}/previews` | GeneratePreview | Owner,Staff,Tenant + Owner,Tenant | [controller](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L52) |
| GET | `/api/v1/contracts/{id:guid}/previews/{fileId:guid}` | PreviewFile | Owner,Staff,Tenant + Owner,Tenant | [controller](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L54) |
| POST | `/api/v1/contracts` | Create | Owner,Staff,Tenant + Owner,Staff | [controller](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L58) |
| POST | `/api/v1/contracts/holdings` | CreateHolding | Owner,Staff,Tenant + Owner,Staff | [controller](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L61) |
| POST | `/api/v1/contracts/{id:guid}/holding-approval` | ApproveHolding | Owner,Staff,Tenant + Owner | [controller](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L64) |
| GET | `/api/v1/contracts/{id:guid}/holding-deposit` | HoldingDeposit | Owner,Staff,Tenant | [controller](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L66) |
| POST | `/api/v1/contracts/{id:guid}/holding-activation` | ActivateHolding | Owner,Staff,Tenant + Owner | [controller](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L68) |
| POST | `/api/v1/contracts/{id:guid}/holding-cancellation` | CancelHolding | Owner,Staff,Tenant + Owner | [controller](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L70) |
| POST | `/api/v1/contracts/{id:guid}/holding-conversion` | ConvertHolding | Owner,Staff,Tenant + Owner,Staff | [controller](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L72) |
| GET | `/api/v1/contracts/{id:guid}` | Get | Owner,Staff,Tenant | [controller](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L74) |
| GET | `/api/v1/contracts/{id:guid}/activation-readiness` | Readiness | Owner,Staff,Tenant + Owner,Tenant | [controller](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L76) |
| POST | `/api/v1/contracts/{id:guid}/activate` | Activate | Owner,Staff,Tenant + Owner | [controller](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L78) |
| POST | `/api/v1/contracts/{id:guid}/deposit-verifications` | Deposit | Owner,Staff,Tenant + Owner | [controller](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L80) |
| POST | `/api/v1/contracts/{id:guid}/signing` | Sign | Owner,Staff,Tenant + Owner,Tenant | [controller](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L82) |
| GET | `/api/v1/contracts/{id:guid}/signing/layout` | SigningLayout | Owner,Staff,Tenant + Owner,Tenant | [controller](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L85) |
| GET | `/api/v1/contracts/{id:guid}/signing/pages/{page:int}` | SigningPage | Owner,Staff,Tenant + Owner,Tenant | [controller](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L87) |
| POST | `/api/v1/contracts/{id:guid}/signing/sync` | Sync | Owner,Staff,Tenant + Owner,Tenant | [controller](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L90) |
| POST | `/api/v1/contracts/{id:guid}/signing/recover` | Recover | Owner,Staff,Tenant + Owner,Tenant | [controller](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L92) |
| GET | `/api/v1/contracts/{id:guid}/document` | Document | Owner,Staff,Tenant + Owner,Tenant | [controller](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L94) |
| POST | `/api/v1/contracts/{id:guid}/renewals` | Renewal | Owner,Staff,Tenant + Owner,Staff | [controller](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L97) |
| GET | `/api/v1/contracts/{id:guid}/handover` | Handover | Owner,Staff,Tenant | [controller](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L100) |
| GET | `/api/v1/contracts/{id:guid}/handover/history` | HandoverHistory | Owner,Staff,Tenant | [controller](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L102) |
| GET | `/api/v1/contracts/{id:guid}/handover/choices` | HandoverChoices | Owner,Staff,Tenant + Staff | [controller](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L104) |
| POST | `/api/v1/contracts/{id:guid}/handover` | SaveHandover | Owner,Staff,Tenant + Staff | [controller](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L106) |
| POST | `/api/v1/contracts/{id:guid}/handover/tenant-confirmation` | TenantHandover | Owner,Staff,Tenant + Tenant | [controller](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L108) |
| POST | `/api/v1/contracts/{id:guid}/handover/disputes` | DisputeHandover | Owner,Staff,Tenant + Tenant | [controller](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L110) |
| POST | `/api/v1/contracts/{id:guid}/handover/staff-confirmation` | StaffHandover | Owner,Staff,Tenant + Staff | [controller](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L112) |
| POST | `/api/v1/contracts/{id:guid}/handover/evidence` | UploadHandover | Owner,Staff,Tenant + Staff | [controller](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L114) |
| GET | `/api/v1/contracts/{id:guid}/handover/evidence/{fileId:guid}` | HandoverFile | Owner,Staff,Tenant | [controller](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L116) |
| GET | `/api/v1/contracts/{id:guid}/handover/meter-evidence/{readingId:guid}` | HandoverMeterFile | Owner,Staff,Tenant | [controller](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L119) |
| POST | `/api/v1/contracts/{id:guid}/renewal-cancellation` | CancelRenewal | Owner,Staff,Tenant + Owner | [controller](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L122) |
| POST | `/api/v1/contracts/{id:guid}/termination-requests` | Termination | Owner,Staff,Tenant + Tenant | [controller](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L124) |
| POST | `/api/v1/contracts/{id:guid}/expiry-move-out` | Expiry | Owner,Staff,Tenant + Owner | [controller](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L126) |
| GET | `/api/v1/contracts/{id:guid}/move-out` | MoveOut | Owner,Staff,Tenant | [controller](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L128) |
| POST | `/api/v1/contracts/{id:guid}/move-out/approve` | Approve | Owner,Staff,Tenant + Owner | [controller](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L130) |
| POST | `/api/v1/contracts/{id:guid}/move-out/schedule` | Schedule | Owner,Staff,Tenant + Owner,Staff | [controller](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L132) |
| POST | `/api/v1/contracts/{id:guid}/move-out/inspection` | Inspect | Owner,Staff,Tenant + Staff | [controller](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L134) |
| POST | `/api/v1/contracts/{id:guid}/move-out/evidence` | UploadEvidence | Owner,Staff,Tenant + Staff | [controller](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L136) |
| GET | `/api/v1/contracts/{id:guid}/move-out/evidence/{evidenceId:guid}` | Evidence | Owner,Staff,Tenant | [controller](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L138) |
| POST | `/api/v1/contracts/{id:guid}/move-out/settlement` | Settle | Owner,Staff,Tenant + Owner | [controller](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L141) |
| GET | `/api/v1/contracts/{id:guid}/move-out/settlement-history` | SettlementHistory | Owner,Staff,Tenant + Owner,Tenant | [controller](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L143) |
| POST | `/api/v1/contracts/{id:guid}/move-out/complete` | Complete | Owner,Staff,Tenant + Owner | [controller](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L145) |

## 11. Cấu hình và tài nguyên ký số — 13 API

**Truy vết:** GBR-04; Electronic Contract Provider

**Luồng:** Owner cấu hình/test MySign → signer quản lý certificate → ảnh hiển thị chữ ký → contract signing.

**Đánh giá:** Ảnh chỉ là appearance, không thay chữ ký provider. API chính có wrapper; thư viện Sandbox có controller khác nhưng không được nạp vào API chính trong lượt kiểm descriptor.

| Method | Route | Action | Quyền khai báo | Source |
| --- | --- | --- | --- | --- |
| GET | `/api/v1/digital-signing/signature-image` | Mine | Owner,Tenant | [controller](../../src/backend/BHome.Api/Controllers/ContractSigningAccountsController.cs#L20) |
| GET | `/api/v1/digital-signing/signature-image/content` | Content | Owner,Tenant | [controller](../../src/backend/BHome.Api/Controllers/ContractSigningAccountsController.cs#L22) |
| PUT | `/api/v1/digital-signing/signature-image` | Save | Owner,Tenant | [controller](../../src/backend/BHome.Api/Controllers/ContractSigningAccountsController.cs#L26) |
| POST | `/api/v1/digital-signing/signature-image/generate` | Generate | Owner,Tenant | [controller](../../src/backend/BHome.Api/Controllers/ContractSigningAccountsController.cs#L34) |
| DELETE | `/api/v1/digital-signing/signature-image` | Remove | Owner,Tenant | [controller](../../src/backend/BHome.Api/Controllers/ContractSigningAccountsController.cs#L38) |
| GET | `/api/v1/digital-signing/settings/viettel` | View | Owner | [controller](../../src/backend/BHome.Api/Controllers/ContractSigningAccountsController.cs#L49) |
| PUT | `/api/v1/digital-signing/settings/viettel` | Save | Owner | [controller](../../src/backend/BHome.Api/Controllers/ContractSigningAccountsController.cs#L51) |
| DELETE | `/api/v1/digital-signing/settings/viettel` | Reset | Owner | [controller](../../src/backend/BHome.Api/Controllers/ContractSigningAccountsController.cs#L63) |
| POST | `/api/v1/digital-signing/settings/viettel/test` | Test | Owner | [controller](../../src/backend/BHome.Api/Controllers/ContractSigningAccountsController.cs#L66) |
| GET | `/api/v1/digital-signing/certificates` | Mine | Owner,Tenant | [controller](../../src/backend/BHome.Api/Controllers/ContractSigningCertificatesController.cs#L15) |
| POST | `/api/v1/digital-signing/certificates` | Declare | Owner,Tenant | [controller](../../src/backend/BHome.Api/Controllers/ContractSigningCertificatesController.cs#L16) |
| DELETE | `/api/v1/digital-signing/certificates/{id:guid}` | Remove | Owner,Tenant | [controller](../../src/backend/BHome.Api/Controllers/ContractSigningCertificatesController.cs#L20) |
| POST | `/api/v1/digital-signing/certificates/{id:guid}/lock` | Lock | Owner,Tenant | [controller](../../src/backend/BHome.Api/Controllers/ContractSigningCertificatesController.cs#L22) |

## 12. Tạm trú và phòng riêng của Tenant — 8 API

**Truy vết:** UC-18; GBR-06; FE-07; GBR-01/02

**Luồng:** Tenant xem phòng riêng; đăng ký tạm trú bên ngoài → cập nhật trạng thái/evidence → Owner confirmation → xem kết quả.

**Đánh giá:** Đã có residence workflow API riêng; tài liệu cũ ghi chỉ có metadata không còn đúng. OperationsService chặn Staff và ép Tenant scope. Không có API nộp VNeID.

| Method | Route | Action | Quyền khai báo | Source |
| --- | --- | --- | --- | --- |
| GET | `/api/v1/residence-tasks` | List | Authenticated | [controller](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs#L34) |
| GET | `/api/v1/residence-tasks/{contractId:guid}/{residentId:guid}` | Get | Authenticated | [controller](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs#L35) |
| PUT | `/api/v1/residence-tasks/{contractId:guid}/{residentId:guid}` | Update | Authenticated | [controller](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs#L36) |
| POST | `/api/v1/residence-tasks/{contractId:guid}/{residentId:guid}/owner-confirmation` | Confirm | Authenticated | [controller](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs#L37) |
| PUT | `/api/v1/residence-tasks/{contractId:guid}/{residentId:guid}/evidence` | Upload | Authenticated | [controller](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs#L38) |
| GET | `/api/v1/residence-tasks/{contractId:guid}/{residentId:guid}/evidence` | Download | Authenticated | [controller](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs#L40) |
| GET | `/api/v1/tenant/rooms` | Rooms | Authenticated | [controller](../../src/backend/BHome.Api/Controllers/Notifications/NotificationWorkspaceController.cs#L30) |
| GET | `/api/v1/tenant/rooms/{id:guid}` | Room | Authenticated | [controller](../../src/backend/BHome.Api/Controllers/Notifications/NotificationWorkspaceController.cs#L32) |

## 13. Hóa đơn, lịch billing và adjustment — 26 API

**Truy vết:** BF-05/06; UC-20/21/24; JOB-09/10; DBR-06/07

**Luồng:** Lịch → automation theo kỳ → meter task → confirmed usage → Draft/refresh → Owner finalize hoặc automation được ủy quyền → Tenant yêu cầu adjustment → Owner approve/reject.

**Đánh giá:** Có thao tác trực tiếp và preview/queue/attempts/executions của job. BillingSchedules là lịch/quy tắc tính; BillingAutomation là kế hoạch điều phối có snapshot/version lịch. Adjustment sau Final giữ record riêng; thiếu PUT Invoice không phải thiếu API.

| Method | Route | Action | Quyền khai báo | Source |
| --- | --- | --- | --- | --- |
| GET | `/api/v1/invoices` | List | Owner,Tenant | [controller](../../src/backend/BHome.Api/Controllers/Billing/InvoicesController.cs#L15) |
| GET | `/api/v1/invoices/{id:guid}` | Get | Owner,Tenant | [controller](../../src/backend/BHome.Api/Controllers/Billing/InvoicesController.cs#L16) |
| POST | `/api/v1/invoices/drafts` | Draft | Owner,Tenant + Owner | [controller](../../src/backend/BHome.Api/Controllers/Billing/InvoicesController.cs#L17) |
| POST | `/api/v1/invoices/{id:guid}/refresh` | Refresh | Owner,Tenant + Owner | [controller](../../src/backend/BHome.Api/Controllers/Billing/InvoicesController.cs#L18) |
| POST | `/api/v1/invoices/{id:guid}/finalize` | FinalizeInvoice | Owner,Tenant + Owner | [controller](../../src/backend/BHome.Api/Controllers/Billing/InvoicesController.cs#L19) |
| GET | `/api/v1/billing-schedules/{locationId:guid}` | Get | Owner | [controller](../../src/backend/BHome.Api/Controllers/Billing/InvoicesController.cs#L27) |
| PUT | `/api/v1/billing-schedules` | Save | Owner | [controller](../../src/backend/BHome.Api/Controllers/Billing/InvoicesController.cs#L28) |
| GET | `/api/v1/billing-automation/{locationId:guid}` | Get | locations.manage | [controller](../../src/backend/BHome.Api/Controllers/Billing/BillingAutomationController.cs#L12) |
| GET | `/api/v1/billing-automation/{locationId:guid}/history` | History | locations.manage | [controller](../../src/backend/BHome.Api/Controllers/Billing/BillingAutomationController.cs#L14) |
| PUT | `/api/v1/billing-automation` | Save | locations.manage | [controller](../../src/backend/BHome.Api/Controllers/Billing/BillingAutomationController.cs#L16) |
| GET | `/api/v1/billing-automation/executions` | Executions | locations.manage | [controller](../../src/backend/BHome.Api/Controllers/Billing/BillingAutomationController.cs#L18) |
| POST | `/api/v1/billing-automation/run-now` | Run | locations.manage | [controller](../../src/backend/BHome.Api/Controllers/Billing/BillingAutomationController.cs#L20) |
| GET | `/api/v1/billing-automation/preview` | Preview | locations.manage | [controller](../../src/backend/BHome.Api/Controllers/Billing/BillingAutomationController.cs#L22) |
| GET | `/api/v1/billing-automation/attempts` | Attempts | locations.manage | [controller](../../src/backend/BHome.Api/Controllers/Billing/BillingAutomationController.cs#L24) |
| GET | `/api/v1/billing-automation/queue` | Queue | locations.manage | [controller](../../src/backend/BHome.Api/Controllers/Billing/BillingAutomationController.cs#L26) |
| POST | `/api/v1/billing-automation/meter-tasks/{taskId:guid}/assignment` | Assign | locations.manage | [controller](../../src/backend/BHome.Api/Controllers/Billing/BillingAutomationController.cs#L28) |
| GET | `/api/v1/billing-automation/representative` | Representative | locations.manage | [controller](../../src/backend/BHome.Api/Controllers/Billing/BillingAutomationController.cs#L30) |
| PUT | `/api/v1/billing-automation/representative` | Select | locations.manage | [controller](../../src/backend/BHome.Api/Controllers/Billing/BillingAutomationController.cs#L32) |
| GET | `/api/v1/invoice-adjustments` | List | Owner,Tenant | [controller](../../src/backend/BHome.Api/Controllers/Billing/InvoiceAdjustmentsController.cs#L15) |
| GET | `/api/v1/invoice-adjustments/{id:guid}` | Get | Owner,Tenant | [controller](../../src/backend/BHome.Api/Controllers/Billing/InvoiceAdjustmentsController.cs#L16) |
| GET | `/api/v1/invoices/{invoiceId:guid}/adjustments` | Effects | Owner,Tenant | [controller](../../src/backend/BHome.Api/Controllers/Billing/InvoiceAdjustmentsController.cs#L17) |
| POST | `/api/v1/invoice-adjustments/{id:guid}/approve` | Approve | Owner,Tenant + invoice-adjustments.approve | [controller](../../src/backend/BHome.Api/Controllers/Billing/InvoiceAdjustmentsController.cs#L20) |
| POST | `/api/v1/invoice-adjustments/{id:guid}/reject` | Reject | Owner,Tenant + invoice-adjustments.approve | [controller](../../src/backend/BHome.Api/Controllers/Billing/InvoiceAdjustmentsController.cs#L22) |
| POST | `/api/v1/invoices/{invoiceId:guid}/adjustment-requests` | Submit | Owner,Tenant + invoice-adjustments.request | [controller](../../src/backend/BHome.Api/Controllers/Billing/InvoiceAdjustmentsController.cs#L24) |
| PUT | `/api/v1/invoices/{invoiceId:guid}/adjustment-evidence` | Upload | Owner,Tenant + invoice-adjustments.request | [controller](../../src/backend/BHome.Api/Controllers/Billing/InvoiceAdjustmentsController.cs#L26) |
| GET | `/api/v1/invoice-adjustments/{id:guid}/evidence/{evidenceId:guid}` | Evidence | Owner,Tenant | [controller](../../src/backend/BHome.Api/Controllers/Billing/InvoiceAdjustmentsController.cs#L28) |

## 14. Thanh toán, công nợ, hoàn tiền và khấu trừ — 23 API

**Truy vết:** BF-06; UC-22..25; GBR-10/18; OQ-01/02/05

**Luồng:** Receiving account/transfer instructions → Owner ghi khoản tiền xác minh → allocate Invoice/Holding → payment/debt/history → refund request → decision → execution/evidence; deduction/deposit refund nối move-out.

**Đánh giá:** Có phân bổ và hoàn thủ công. Chưa thấy bank webhook/callback tự động trong host. /debts ép OutstandingOnly=true và cho Staff; /payment-invoices không ép và chỉ Owner/Tenant: không phải alias tương đương.

| Method | Route | Action | Quyền khai báo | Source |
| --- | --- | --- | --- | --- |
| GET | `/api/v1/payment-transactions` | List | Owner | [controller](../../src/backend/BHome.Api/Controllers/PaymentsDebt/PaymentTransactionsController.cs#L15) |
| GET | `/api/v1/payment-transactions/{id:guid}` | Get | Owner | [controller](../../src/backend/BHome.Api/Controllers/PaymentsDebt/PaymentTransactionsController.cs#L16) |
| POST | `/api/v1/payment-transactions` | Register | Owner | [controller](../../src/backend/BHome.Api/Controllers/PaymentsDebt/PaymentTransactionsController.cs#L17) |
| POST | `/api/v1/payment-transactions/{id:guid}/allocate` | Allocate | Owner | [controller](../../src/backend/BHome.Api/Controllers/PaymentsDebt/PaymentTransactionsController.cs#L18) |
| POST | `/api/v1/payment-transactions/{id:guid}/allocate-holding-deposit` | AllocateDeposit | Owner | [controller](../../src/backend/BHome.Api/Controllers/PaymentsDebt/PaymentTransactionsController.cs#L19) |
| POST | `/api/v1/payment-transactions/{id:guid}/reject` | Reject | Owner | [controller](../../src/backend/BHome.Api/Controllers/PaymentsDebt/PaymentTransactionsController.cs#L20) |
| GET | `/api/v1/payment-transactions/{id:guid}/reconciliation-history` | History | Owner | [controller](../../src/backend/BHome.Api/Controllers/PaymentsDebt/PaymentTransactionsController.cs#L21) |
| GET | `/api/v1/invoices/{id:guid}/payment` | Get | Owner,Tenant | [controller](../../src/backend/BHome.Api/Controllers/PaymentsDebt/PaymentTransactionsController.cs#L28) |
| GET | `/api/v1/invoices/{id:guid}/payment/eligible-payers` | Payers | Owner,Tenant + Owner | [controller](../../src/backend/BHome.Api/Controllers/PaymentsDebt/PaymentTransactionsController.cs#L29) |
| GET | `/api/v1/receiving-bank-accounts/{locationId:guid}` | Get | Owner | [controller](../../src/backend/BHome.Api/Controllers/PaymentsDebt/ReceivingAccountsController.cs#L13) |
| PUT | `/api/v1/receiving-bank-accounts` | Save | Owner | [controller](../../src/backend/BHome.Api/Controllers/PaymentsDebt/ReceivingAccountsController.cs#L14) |
| GET | `/api/v1/invoices/{id:guid}/transfer-instructions` | Get | Owner,Tenant | [controller](../../src/backend/BHome.Api/Controllers/PaymentsDebt/ReceivingAccountsController.cs#L20) |
| GET | `/api/v1/debts` | List | Owner,Staff,Tenant | [controller](../../src/backend/BHome.Api/Controllers/PaymentsDebt/DebtsController.cs#L13) |
| GET | `/api/v1/payment-invoices` | List | Owner,Tenant | [controller](../../src/backend/BHome.Api/Controllers/PaymentsDebt/DebtsController.cs#L21) |
| GET | `/api/v1/payment-history` | List | Owner,Tenant | [controller](../../src/backend/BHome.Api/Controllers/PaymentsDebt/DebtsController.cs#L27) |
| GET | `/api/v1/payment-transactions/{id:guid}/refunds` | Source | Owner | [controller](../../src/backend/BHome.Api/Controllers/RefundsController.cs#L13) |
| POST | `/api/v1/payment-transactions/{id:guid}/refunds` | Create | Owner | [controller](../../src/backend/BHome.Api/Controllers/RefundsController.cs#L15) |
| GET | `/api/v1/contracts/{id:guid}/deposit-refunds` | DepositSource | Owner | [controller](../../src/backend/BHome.Api/Controllers/RefundsController.cs#L17) |
| POST | `/api/v1/contracts/{id:guid}/deposit-refunds` | CreateDeposit | Owner | [controller](../../src/backend/BHome.Api/Controllers/RefundsController.cs#L19) |
| POST | `/api/v1/refund-requests/{id:guid}/decision` | Decision | Owner | [controller](../../src/backend/BHome.Api/Controllers/RefundsController.cs#L21) |
| POST | `/api/v1/refund-requests/{id:guid}/execution` | Execute | Owner | [controller](../../src/backend/BHome.Api/Controllers/RefundsController.cs#L23) |
| GET | `/api/v1/refund-requests/{id:guid}/evidence` | Evidence | Owner | [controller](../../src/backend/BHome.Api/Controllers/RefundsController.cs#L31) |
| POST | `/api/v1/contracts/{id:guid}/deposit-deductions` | Approve | Owner | [controller](../../src/backend/BHome.Api/Controllers/DepositDeductionsController.cs#L12) |

## 15. Chi phí, báo cáo tài chính và What-if — 13 API

**Truy vết:** FE-08; UC-31..34; GBR-15/16

**Luồng:** OPEX + reference/evidence → report → analyze What-if → lưu scenario → xem lại.

**Đánh giá:** Có chi phí, báo cáo và mô phỏng. Analyze khác lưu scenario. Cần đối soát phạm vi số liệu thật; không suy thành kế toán pháp định, payroll hay toàn bộ nghĩa vụ cọc.

| Method | Route | Action | Quyền khai báo | Source |
| --- | --- | --- | --- | --- |
| GET | `/api/v1/expenses` | List | Owner | [controller](../../src/backend/BHome.Api/Controllers/ExpensesController.cs#L12) |
| GET | `/api/v1/expenses/reference-choices` | References | Owner | [controller](../../src/backend/BHome.Api/Controllers/ExpensesController.cs#L13) |
| GET | `/api/v1/expenses/{id:guid}` | Get | Owner | [controller](../../src/backend/BHome.Api/Controllers/ExpensesController.cs#L15) |
| POST | `/api/v1/expenses` | Create | Owner | [controller](../../src/backend/BHome.Api/Controllers/ExpensesController.cs#L16) |
| PUT | `/api/v1/expenses/{id:guid}` | Update | Owner | [controller](../../src/backend/BHome.Api/Controllers/ExpensesController.cs#L19) |
| GET | `/api/v1/expenses/{id:guid}/evidence` | Evidence | Owner | [controller](../../src/backend/BHome.Api/Controllers/ExpensesController.cs#L20) |
| POST | `/api/v1/expenses/{id:guid}/evidence` | Upload | Owner | [controller](../../src/backend/BHome.Api/Controllers/ExpensesController.cs#L22) |
| GET | `/api/v1/expenses/{id:guid}/evidence/{fileId:guid}` | Download | Owner | [controller](../../src/backend/BHome.Api/Controllers/ExpensesController.cs#L25) |
| GET | `/api/v1/financial-reports` | Get | Owner | [controller](../../src/backend/BHome.Api/Controllers/FinancialReportsController.cs#L12) |
| POST | `/api/v1/financial-scenarios/analyze` | Analyze | Owner | [controller](../../src/backend/BHome.Api/Controllers/FinancialScenariosController.cs#L12) |
| POST | `/api/v1/financial-scenarios` | Save | Owner | [controller](../../src/backend/BHome.Api/Controllers/FinancialScenariosController.cs#L13) |
| GET | `/api/v1/financial-scenarios` | List | Owner | [controller](../../src/backend/BHome.Api/Controllers/FinancialScenariosController.cs#L16) |
| GET | `/api/v1/financial-scenarios/{id:guid}` | Get | Owner | [controller](../../src/backend/BHome.Api/Controllers/FinancialScenariosController.cs#L17) |

## 16. Inbox, announcement, delivery và reminder — 19 API

**Truy vết:** FE-07; UC-35/36; JOB-01/04/07/08; GBR-18

**Luồng:** Business event → persisted inbox → target/read; Owner preview audience → create/send; device → delivery/retry → monitoring; Location reminder policy.

**Đánh giá:** PATCH/POST read cùng action, trùng trực tiếp. Inbox Task/Incident riêng còn DTO/quyền/client, chỉ hợp nhất sau kiểm parity. process-events là thao tác vận hành. Có device/retry chưa chứng minh provider push/email thật.

| Method | Route | Action | Quyền khai báo | Source |
| --- | --- | --- | --- | --- |
| GET | `/api/v1/notifications` | List | notifications.read-own | [controller](../../src/backend/BHome.Api/Controllers/Notifications/NotificationsController.cs#L11) |
| GET | `/api/v1/notifications/unread-count` | Unread | notifications.read-own | [controller](../../src/backend/BHome.Api/Controllers/Notifications/NotificationsController.cs#L12) |
| GET | `/api/v1/notifications/{id:guid}` | Get | notifications.read-own | [controller](../../src/backend/BHome.Api/Controllers/Notifications/NotificationsController.cs#L13) |
| PATCH | `/api/v1/notifications/{id:guid}/read` | Read | notifications.read-own | [controller](../../src/backend/BHome.Api/Controllers/Notifications/NotificationsController.cs#L14) |
| POST | `/api/v1/notifications/{id:guid}/read` | Read | notifications.read-own | [controller](../../src/backend/BHome.Api/Controllers/Notifications/NotificationsController.cs#L15) |
| POST | `/api/v1/notifications/read-all` | ReadAll | notifications.read-own | [controller](../../src/backend/BHome.Api/Controllers/Notifications/NotificationsController.cs#L16) |
| GET | `/api/v1/notifications/{id:guid}/target` | Target | notifications.read-own | [controller](../../src/backend/BHome.Api/Controllers/Notifications/NotificationsController.cs#L17) |
| GET | `/api/v1/notifications/delivery-status` | List | locations.manage | [controller](../../src/backend/BHome.Api/Controllers/Notifications/NotificationDeliveryController.cs#L9) |
| POST | `/api/v1/notifications/process-events` | Publish | locations.manage | [controller](../../src/backend/BHome.Api/Controllers/Notifications/NotificationAutomationController.cs#L8) |
| POST | `/api/v1/announcements/preview-recipients` | Preview | Authenticated | [controller](../../src/backend/BHome.Api/Controllers/Notifications/NotificationWorkspaceController.cs#L10) |
| POST | `/api/v1/announcements` | Create | Authenticated | [controller](../../src/backend/BHome.Api/Controllers/Notifications/NotificationWorkspaceController.cs#L12) |
| POST | `/api/v1/announcements/{id:guid}/send` | Send | Authenticated | [controller](../../src/backend/BHome.Api/Controllers/Notifications/NotificationWorkspaceController.cs#L14) |
| GET | `/api/v1/announcements/sent` | Sent | Authenticated | [controller](../../src/backend/BHome.Api/Controllers/Notifications/NotificationWorkspaceController.cs#L16) |
| POST | `/api/v1/notifications/devices` | Register | Authenticated | [controller](../../src/backend/BHome.Api/Controllers/Notifications/NotificationWorkspaceController.cs#L18) |
| DELETE | `/api/v1/notifications/devices/{id:guid}` | Remove | Authenticated | [controller](../../src/backend/BHome.Api/Controllers/Notifications/NotificationWorkspaceController.cs#L20) |
| GET | `/api/v1/notifications/{id:guid}/deliveries` | Deliveries | Authenticated | [controller](../../src/backend/BHome.Api/Controllers/Notifications/NotificationWorkspaceController.cs#L22) |
| GET | `/api/v1/notifications/channel-status` | ChannelOverview | Authenticated | [controller](../../src/backend/BHome.Api/Controllers/Notifications/NotificationWorkspaceController.cs#L24) |
| GET | `/api/v1/locations/{id:guid}/notification-policy` | Policy | Authenticated | [controller](../../src/backend/BHome.Api/Controllers/Notifications/NotificationWorkspaceController.cs#L26) |
| PUT | `/api/v1/locations/{id:guid}/notification-policy` | Policy | Authenticated | [controller](../../src/backend/BHome.Api/Controllers/Notifications/NotificationWorkspaceController.cs#L28) |

## 17. Incident, Emergency và Work Order — 36 API

**Truy vết:** BF-07; UC-26..30; GBR-11/12

**Luồng:** Submit/evidence → review/reject/duplicate → assign Work Order → proposal → Owner plan-decision → start/progress/blocker → submit → verify/rework → resolve. Emergency acknowledge/actions/cost-decision; Owner direct-completion là nhánh khác.

**Đánh giá:** Có action vòng đời, history/reassign/expense/maintenance-history. Resolve và direct-completion có payload/service khác. Emergency không thay formal review/approval. Chưa chứng minh mọi transition và permission đã pass.

| Method | Route | Action | Quyền khai báo | Source |
| --- | --- | --- | --- | --- |
| POST | `/api/v1/incidents` | Submit | incidents.view + incidents.report | [controller](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/IncidentReportsController.cs#L29) |
| GET | `/api/v1/incidents` | List | incidents.view | [controller](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/IncidentReportsController.cs#L51) |
| GET | `/api/v1/incidents/reporting-rooms` | ReportingRooms | incidents.view + incidents.report | [controller](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/IncidentReportsController.cs#L53) |
| GET | `/api/v1/incidents/reporting-assets` | ReportingAssets | incidents.view + incidents.report | [controller](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/IncidentReportsController.cs#L55) |
| GET | `/api/v1/incidents/{id:guid}` | Get | incidents.view | [controller](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/IncidentReportsController.cs#L57) |
| GET | `/api/v1/incidents/{id:guid}/history` | History | incidents.view | [controller](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/IncidentReportsController.cs#L59) |
| POST | `/api/v1/incidents/{id:guid}/review` | Review | incidents.view + incidents.manage | [controller](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/IncidentReportsController.cs#L61) |
| POST | `/api/v1/incidents/{id:guid}/reject` | Reject | incidents.view + incidents.manage | [controller](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/IncidentReportsController.cs#L63) |
| POST | `/api/v1/incidents/{id:guid}/duplicate` | Duplicate | incidents.view + incidents.manage | [controller](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/IncidentReportsController.cs#L65) |
| POST | `/api/v1/incidents/{id:guid}/cancel` | Cancel | incidents.view | [controller](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/IncidentReportsController.cs#L67) |
| POST | `/api/v1/incidents/{id:guid}/resolve` | Resolve | incidents.view + incidents.manage | [controller](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/IncidentReportsController.cs#L69) |
| POST | `/api/v1/incidents/{id:guid}/work-orders` | Assign | incidents.view + incidents.manage | [controller](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/IncidentReportsController.cs#L71) |
| POST | `/api/v1/incidents/{id:guid}/direct-completion` | Direct | incidents.view + incidents.manage | [controller](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/IncidentReportsController.cs#L75) |
| POST | `/api/v1/incidents/{id:guid}/acknowledge` | Acknowledge | incidents.view + incidents.respond | [controller](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/IncidentReportsController.cs#L77) |
| POST | `/api/v1/incidents/{id:guid}/emergency-actions` | EmergencyAction | incidents.view | [controller](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/IncidentReportsController.cs#L79) |
| GET | `/api/v1/incidents/{id:guid}/emergency-actions` | EmergencyActions | incidents.view + work-orders.view | [controller](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/IncidentReportsController.cs#L81) |
| POST | `/api/v1/incidents/{id:guid}/emergency-actions/{entryId:guid}/cost-decision` | EmergencyCost | incidents.view + incidents.manage | [controller](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/IncidentReportsController.cs#L83) |
| GET | `/api/v1/incidents/{id:guid}/expenses` | Expenses | incidents.view + incidents.manage | [controller](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/IncidentReportsController.cs#L85) |
| GET | `/api/v1/incidents/{id:guid}/evidence` | Evidence | incidents.view | [controller](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/IncidentReportsController.cs#L87) |
| PUT | `/api/v1/incidents/{id:guid}/evidence` | Upload | incidents.view | [controller](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/IncidentReportsController.cs#L89) |
| GET | `/api/v1/incidents/{id:guid}/evidence/{imageId:guid}` | Download | incidents.view | [controller](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/IncidentReportsController.cs#L92) |
| GET | `/api/v1/incidents/notifications` | Notifications | incidents.view | [controller](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/IncidentReportsController.cs#L104) |
| POST | `/api/v1/incidents/notifications/{id:guid}/read` | Read | incidents.view | [controller](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/IncidentReportsController.cs#L106) |
| GET | `/api/v1/work-orders` | List | work-orders.view | [controller](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/WorkOrdersController.cs#L14) |
| GET | `/api/v1/work-orders/{id:guid}` | Get | work-orders.view | [controller](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/WorkOrdersController.cs#L16) |
| GET | `/api/v1/work-orders/maintenance-history` | Maintenance | work-orders.view | [controller](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/WorkOrdersController.cs#L18) |
| POST | `/api/v1/work-orders/{id:guid}/reassign` | Reassign | work-orders.view + incidents.manage | [controller](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/WorkOrdersController.cs#L20) |
| POST | `/api/v1/work-orders/{id:guid}/proposal` | Propose | work-orders.view + work-orders.execute | [controller](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/WorkOrdersController.cs#L22) |
| POST | `/api/v1/work-orders/{id:guid}/plan-decision` | Plan | work-orders.view + work-orders.approve-plan | [controller](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/WorkOrdersController.cs#L24) |
| POST | `/api/v1/work-orders/{id:guid}/start` | Start | work-orders.view + work-orders.execute | [controller](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/WorkOrdersController.cs#L26) |
| POST | `/api/v1/work-orders/{id:guid}/progress` | Progress | work-orders.view + work-orders.execute | [controller](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/WorkOrdersController.cs#L28) |
| POST | `/api/v1/work-orders/{id:guid}/blocker` | Blocker | work-orders.view + work-orders.execute | [controller](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/WorkOrdersController.cs#L30) |
| POST | `/api/v1/work-orders/{id:guid}/submit` | Submit | work-orders.view + work-orders.execute | [controller](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/WorkOrdersController.cs#L32) |
| POST | `/api/v1/work-orders/{id:guid}/verify` | Verify | work-orders.view + work-orders.verify | [controller](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/WorkOrdersController.cs#L34) |
| POST | `/api/v1/work-orders/{id:guid}/rework` | Rework | work-orders.view + work-orders.verify | [controller](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/WorkOrdersController.cs#L36) |
| POST | `/api/v1/work-orders/{id:guid}/cancel` | Cancel | work-orders.view + incidents.manage | [controller](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/WorkOrdersController.cs#L38) |

## 18. Nội dung công khai và xuất bản — 18 API

**Truy vết:** UC-37; GBR-17

**Luồng:** Owner sửa nội dung/ảnh → publish/unpublish Location/Room → Guest đọc danh sách/chi tiết/ảnh đã công bố.

**Đánh giá:** Có 12 admin và 6 anonymous GET routes. Không thấy Guest POST enquiry/reservation/payment. Admin publish và Guest read khác ranh giới quyền, cần giữ.

| Method | Route | Action | Quyền khai báo | Source |
| --- | --- | --- | --- | --- |
| GET | `/api/v1/public-content/locations/{id:guid}` | Location | Authenticated | [controller](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs#L72) |
| PUT | `/api/v1/public-content/locations/{id:guid}` | UpdateLocation | Authenticated | [controller](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs#L73) |
| POST | `/api/v1/public-content/locations/{id:guid}/publish` | PublishLocation | Authenticated | [controller](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs#L74) |
| POST | `/api/v1/public-content/locations/{id:guid}/unpublish` | UnpublishLocation | Authenticated | [controller](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs#L75) |
| PUT | `/api/v1/public-content/locations/{id:guid}/photos` | LocationPhoto | Authenticated | [controller](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs#L76) |
| DELETE | `/api/v1/public-content/locations/{id:guid}/photos/{index:int}` | RemoveLocationPhoto | Authenticated | [controller](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs#L78) |
| GET | `/api/v1/public-content/rooms/{id:guid}` | Room | Authenticated | [controller](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs#L82) |
| PUT | `/api/v1/public-content/rooms/{id:guid}` | UpdateRoom | Authenticated | [controller](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs#L83) |
| POST | `/api/v1/public-content/rooms/{id:guid}/publish` | PublishRoom | Authenticated | [controller](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs#L84) |
| POST | `/api/v1/public-content/rooms/{id:guid}/unpublish` | UnpublishRoom | Authenticated | [controller](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs#L85) |
| PUT | `/api/v1/public-content/rooms/{id:guid}/photos` | RoomPhoto | Authenticated | [controller](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs#L86) |
| DELETE | `/api/v1/public-content/rooms/{id:guid}/photos/{index:int}` | RemoveRoomPhoto | Authenticated | [controller](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs#L88) |
| GET | `/api/v1/public/locations` | Locations | Anonymous | [controller](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs#L97) |
| GET | `/api/v1/public/locations/{id:guid}` | Location | Anonymous | [controller](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs#L98) |
| GET | `/api/v1/public/locations/{id:guid}/rooms` | Rooms | Anonymous | [controller](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs#L99) |
| GET | `/api/v1/public/rooms/{id:guid}` | Room | Anonymous | [controller](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs#L100) |
| GET | `/api/v1/public/locations/{id:guid}/photos/{index:int}` | LocationPhoto | Anonymous | [controller](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs#L101) |
| GET | `/api/v1/public/rooms/{id:guid}/photos/{index:int}` | RoomPhoto | Anonymous | [controller](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs#L102) |

## 19. Chẩn đoán và hỗ trợ phát triển — 4 API

**Truy vết:** NFR; công cụ phát triển

**Luồng:** OCR diagnostics/profile/experimental; tải CA cho thiết bị local.

**Đánh giá:** 3 OCR diagnostic routes có gate Development + MobileDevelopment.Enabled; mobile CA có gate riêng. Hai health endpoint nằm ngoài 372 controller routes. Không tính các route này thành tính năng nghiệp vụ.

| Method | Route | Action | Quyền khai báo | Source |
| --- | --- | --- | --- | --- |
| GET | `/api/v1/ocr/diagnostics` | Availability | Owner,Staff | [controller](../../src/backend/BHome.Api/Controllers/Ocr/OcrDiagnosticsController.cs#L20) |
| POST | `/api/v1/ocr/diagnostics/auto` | Automatic | Owner,Staff | [controller](../../src/backend/BHome.Api/Controllers/Ocr/OcrDiagnosticsController.cs#L23) |
| POST | `/api/v1/ocr/diagnostics/{profile}` | Extract | Owner,Staff | [controller](../../src/backend/BHome.Api/Controllers/Ocr/OcrDiagnosticsController.cs#L44) |
| GET | `/development/mobile-ca.cer` | Certificate | Anonymous | [controller](../../src/backend/BHome.Api/Controllers/MobileDevelopmentController.cs#L10) |

## Kiểm chứng trong lượt audit

- Build/run helper descriptor thành công: 372 descriptors / 12 anonymous / 0 duplicate; inventory source khớp 372/372. Helper dùng framework/project reference hiện có, không thêm dependency sản phẩm.
- Lần chạy helper đầu build được nhưng ghi output thất bại do đường dẫn tương đối tính từ thư mục project; đổi output sang đường dẫn tuyệt đối, chạy lại thành công.
- Đã chạy focused unit tests: **42 passed, 0 failed, 0 skipped**. Lệnh:

```powershell
dotnet test tests/backend/BHome.Application.UnitTests/BHome.Application.UnitTests.csproj --no-restore --filter "FullyQualifiedName~OperationsServiceTests|FullyQualifiedName~UtilityTariffMathTests|FullyQualifiedName~ResourceAccessTests|FullyQualifiedName~PermissionAccessTests" --logger "trx;LogFileName=be-audit-focused.trx" --results-directory D:/SEP490-G92-BHOME/.tools/be-audit-2026-11-08/test-results --verbosity minimal
```

- Chưa chạy: HTTP probe 372 routes, PostgreSQL/Docker integration, MySign/bank/email/push thật, native/browser E2E, performance/concurrency/security full suite. Không dùng 42 unit tests để suy ra % bao phủ BE.
- Không sửa source sản phẩm, không migration/commit/push. Chỉ tạo tài liệu và helper/evidence trong .tools.

## Kiểm thử và ưu tiên nghiệm thu tiếp

1. Auth/isolation: AuthenticationSecurityTests, PermissionApiTests, LocationAssignmentApiTests, Compact24AuthTests, Compact24NotificationMvpTests.
2. Setup: PropertyApiTests, Compact24OwnerSetupTests, UtilityTariffInvoiceTests. Kiểm tariff giữa kỳ, quota/variance, publish/snapshot nội quy và kiểm kê tài sản.
3. Task/Incident: OperationalTaskApiTests, IncidentApiTests. Kiểm role/Location, evidence, emergency, rework và điều kiện đóng Incident.
4. Contract: MainDraftApiTests, MainDraftReleaseTests, ContractLifecycleApiTests, ContractWorkflowGuardTests, Compact24WorkflowRegressionTests. Kiểm Holding/Main cạnh tranh, thiếu ký/tiền và move-out còn nghĩa vụ.
5. Billing/payment: InvoiceApiTests, BillingMeterAutomationTests, BillingDraftAutomationTests, BillingFinalAutomationTests, PaymentLedgerTests, DepositRefundTests, DepositDeductionTests, ContractSettlementTests. Kiểm retry không nhân tiền/hóa đơn.
6. Residence/public: OperationsServiceTests đã chạy phần unit; cần kiểm HTTP/DB scope, public photos, Owner publication và Tenant evidence.

Ưu tiên sửa tài liệu 216 routes cũ bằng lượt runtime integration audit mới; xác nhận policy versions; chọn canonical cho các alias; hợp nhất create Staff/capture trước migrate client. Không báo cáo đã hoàn tất bank callback, chữ ký pháp lý hoặc delivery thật chỉ vì có adapter/route.
