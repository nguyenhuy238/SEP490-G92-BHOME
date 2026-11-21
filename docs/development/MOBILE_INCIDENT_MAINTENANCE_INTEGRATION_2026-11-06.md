# BHOME Mobile — Bàn giao tích hợp Incident & Maintenance

Ngày: **06/11/2026**. Nền source: `ec95481` và working tree hiện có. Thay đổi chưa commit/push.

## 1. Phạm vi, nguồn yêu cầu và quyết định

BF-07 / FE-06 / UC-26–30; GBR-01–03, GBR-11–14, GBR-18; DBR-09/10/13 theo hướng dẫn repository. Yêu cầu tích hợp của người dùng, `IncidentContracts.cs`, controllers, `IncidentService.cs`, enums/domain rules và `RolePermissions.cs` là nguồn đối chiếu cho hành vi hiện hành.

**Route thực tế là `/api/v1/incidents`, không phải `/api/v1/incident-reports` trong yêu cầu/tài liệu cũ.** Work Order dùng `/api/v1/work-orders`, hoàn toàn tách model và API khỏi `/operational-tasks`.

Không đổi backend, database/schema/migration, chính sách khấu trừ, SLA hoặc quy tắc nhắc khẩn cấp. OQ-04 không được tự chốt bằng deadline tự đặt. Owner nhập hạn hoàn thành cho từng lệnh theo DTO có sẵn.

Tiêu chí kiểm tra: báo cáo dùng dữ liệu thật; đúng multipart/binary; không fake ID/success; không gọi dữ liệu Work Order/chi phí khi Tenant xem; Staff chỉ thực thi lệnh do mình phụ trách; Owner duyệt/nghiệm thu; version/idempotency; loading/error/empty/retry; tải lại sau thành công; file có xác thực; DTO nullable hiển thị an toàn.

## 2. Luồng dữ liệu và điều hướng

`IncidentContracts.cs` → types trong `services/incidents.ts` → `incidentClient`/`useIncidentQuery` → component dùng chung → các route hiện có trong `workspace/[screen].tsx`.

- Tenant: `incidents` mở form; `tenant-requests` mở danh sách; `incident-detail` mở chi tiết thực tế.
- Staff: `report-incident`, `staff-incidents`, `staff-emergencies`, `staff-maintenance`; chi tiết `incident-detail`/`maintenance-detail`.
- Owner: `owner-incidents`, `owner-emergencies`, `owner-maintenance`, đi vào từ Tổng quan/Vận hành; cùng màn chi tiết nhưng action riêng theo quyền.
- `work-orders` cũ vẫn là Operational Task; không thay bằng bảo trì.
- Thông báo chung có thêm `IncidentInbox`, lấy inbox riêng của Incident và mở đúng hồ sơ.
- Dashboard Staff đếm sự cố mở bằng tổng `Submitted` + `InProgress` từ backend; không suy từ độ dài trang và không dùng số mẫu trong phiên thật.
- Chế độ preview của nhóm mới không gọi API, không ghi nhận thành công giả.

`useIncidentQuery` dùng transport/hook hiện có, tải lại khi quay lại màn và nhận invalidation của module. Mutation dùng khóa chống nhấn trùng, AbortSignal, idempotency key giữ lại cho retry cùng payload; không tự retry write khi mất phản hồi. Chỉ báo thành công sau response backend; sau thành công refetch incident/work/list/history/evidence/inbox đang mở.

## 3. Ma trận tích hợp API

Mọi route trong bảng có tiền tố **`/api/v1`**. `Page<T>` gồm `items`, `page`, `pageSize`, `totalCount`; các response được ghi `[]` là mảng trực tiếp. Các action ghi, trừ đọc thông báo, dùng `Idempotency-Key` UUID. Các command trả `IncidentCommandResult` gồm `incidentId`, `workOrderId?` nullable, `resourceId?` nullable.

T = Tenant, S = Staff, O = Owner. Quyền đọc/ghi còn được service kiểm theo đối tượng, Location, người phụ trách, trạng thái và tài khoản còn hiệu lực. “Đã nối” là source có điểm gọi và có kiểm tra frontend, không phải tuyên bố đã chạy native E2E/provider thật.

| Vai trò / màn                | Method | Endpoint                                                  | Request                                     | Response                        | Tích hợp / điều kiện                                                                                   |
| ---------------------------- | ------ | --------------------------------------------------------- | ------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------ |
| T/S · Báo cáo                | POST   | /incidents                                                | IncidentSubmitForm multipart + images       | IncidentCommandResult, HTTP 201 | Đã nối; tối đa 5 PNG/JPEG, 5.000.000 byte/ảnh                                                          |
| T/S · Chọn phòng             | GET    | /incidents/reporting-rooms                                | IncidentLookupQuery                         | Page<IncidentReportingRoom>     | Tenant dùng lookup có quyền; Staff giữ capture scope                                                   |
| T/S · Chọn tài sản           | GET    | /incidents/reporting-assets                               | IncidentLookupQuery                         | Page<IncidentReportingAsset>    | Tenant dùng; lọc đúng phòng/khu vực; không dùng /assets của Staff                                      |
| T/S/O · Danh sách            | GET    | /incidents                                                | IncidentQuery                               | Page<IncidentView>              | Đã nối phân trang, Status, Severity; server lọc phạm vi                                                |
| T/S/O · Chi tiết             | GET    | /incidents/{id}                                           | ID                                          | IncidentView                    | Đã nối                                                                                                 |
| T/S/O · Lịch sử              | GET    | /incidents/{id}/history                                   | page, pageSize                              | Page<IncidentActivityView>      | Tenant chỉ public history; không hiện actor/internal data                                              |
| O · Phân loại                | POST   | /incidents/{id}/review                                    | IncidentReview                              | IncidentCommandResult           | Đã nối; type/category do Owner nhập                                                                    |
| O · Từ chối                  | POST   | /incidents/{id}/reject                                    | IncidentDecision                            | IncidentCommandResult           | Đã nối; backend kiểm lệnh mở/chi phí chờ                                                               |
| O · Trùng                    | POST   | /incidents/{id}/duplicate                                 | IncidentDecision + duplicateOfId            | IncidentCommandResult           | Đã nối chọn báo cáo gốc cùng phạm vi, có phân trang                                                    |
| O/T · Hủy                    | POST   | /incidents/{id}/cancel                                    | IncidentDecision                            | IncidentCommandResult           | Owner hoặc Tenant trước quyết định Owner; Staff-cancel giới hạn nêu mục 9                              |
| O · Đóng                     | POST   | /incidents/{id}/resolve                                   | IncidentDecision                            | IncidentCommandResult           | Đã nối; backend chặn khi còn lệnh/chi phí chưa xử lý                                                   |
| O · Giao việc                | POST   | /incidents/{id}/work-orders                               | WorkOrderAssign                             | IncidentCommandResult, HTTP 201 | Đã nối; cần phân loại; chọn Staff đang phụ trách Location; hạn tương lai                               |
| O · Trực tiếp                | POST   | /incidents/{id}/direct-completion                         | DirectCompletion                            | IncidentCommandResult           | Đã nối; phân loại + ảnh Direct + chi phí thực tế + kết quả; backend kiểm không có lệnh cần nghiệm thu  |
| S · Khẩn cấp                 | POST   | /incidents/{id}/acknowledge                               | WorkOrderAction                             | IncidentCommandResult           | Đã nối; chỉ Emergency chưa tiếp nhận tại Location được giao                                            |
| O/S · Khẩn cấp               | POST   | /incidents/{id}/emergency-actions                         | EmergencyEntry                              | IncidentCommandResult           | Đã nối; Staff phải tiếp nhận trước; khoản chi >0 cần ảnh                                               |
| O/S · Chi tiết               | GET    | /incidents/{id}/emergency-actions                         | ID                                          | EmergencyActionView[]           | Đã nối; server mask khoản chi của Staff khác                                                           |
| O · Chi phí khẩn cấp         | POST   | /incidents/{id}/emergency-actions/{entryId}/cost-decision | EmergencyCostDecision                       | IncidentCommandResult           | Đã nối duyệt/từ chối + lý do, dùng version incident                                                    |
| O · Chi phí                  | GET    | /incidents/{id}/expenses                                  | ID                                          | ExpenseView[]                   | Đã nối; không gọi khi Tenant/Staff                                                                     |
| T/S/O · Ảnh                  | GET    | /incidents/{id}/evidence                                  | ID                                          | IncidentEvidenceView[]          | Đã nối; Tenant chỉ Report                                                                              |
| T/S/O theo kind · Ảnh        | PUT    | /incidents/{id}/evidence                                  | PNG/JPEG binary; kind; workOrderId tùy loại | IncidentCommandResult           | Đã nối Report của Tenant, Direct của O, EmergencyAction của O/S, Inspection/Completion của S được giao |
| T/S/O · Xem ảnh              | GET    | /incidents/{id}/evidence/{imageId}                        | ID                                          | PNG/JPEG binary                 | Đã nối tải có xác thực và preview toàn màn hình                                                        |
| T/S/O · Inbox                | GET    | /incidents/notifications                                  | page, pageSize                              | Page<IncidentNotificationView>  | Đã nối trong thông báo mobile                                                                          |
| T/S/O · Đọc inbox            | POST   | /incidents/notifications/{id}/read                        | ID                                          | 204 No Content                  | Đã nối; đọc thành công rồi mở report                                                                   |
| O/S · Bảo trì                | GET    | /work-orders                                              | IncidentQuery                               | Page<WorkOrderView>             | Đã nối; lọc WorkOrderStatus, IncidentId khi cần                                                        |
| O/S · Chi tiết bảo trì       | GET    | /work-orders/{id}                                         | ID                                          | WorkOrderView                   | Đã nối; tài chính theo projection của backend                                                          |
| O/S · Lịch sử bảo trì        | GET    | /work-orders/maintenance-history                          | IncidentQuery                               | Page<MaintenanceHistoryView>    | Đã nối theo incident; trang có thể chứa nhiều lệnh, UI lọc bản ghi của lệnh đang xem                   |
| O · Đổi người                | POST   | /work-orders/{id}/reassign                                | WorkOrderReassign                           | IncidentCommandResult           | Đã nối; lệnh chưa kết thúc, Staff hiện hành                                                            |
| S được giao · Phương án      | POST   | /work-orders/{id}/proposal                                | RepairProposal                              | IncidentCommandResult           | Đã nối; Assigned/PendingApproval; ảnh Inspection, thời gian phút, chi phí tùy chọn                     |
| O · Duyệt phương án          | POST   | /work-orders/{id}/plan-decision                           | PlanDecision                                | IncidentCommandResult           | Đã nối; PendingApproval chưa được duyệt; từ chối cần lý do                                             |
| S được giao · Bắt đầu        | POST   | /work-orders/{id}/start                                   | WorkOrderAction                             | IncidentCommandResult           | Đã nối; chỉ khi canStart do backend trả true                                                           |
| S được giao · Tiến độ        | POST   | /work-orders/{id}/progress                                | WorkOrderAction                             | IncidentCommandResult           | Đã nối; InProgress, note; ảnh Completion tùy chọn                                                      |
| S được giao · Vướng mắc      | POST   | /work-orders/{id}/blocker                                 | WorkOrderAction                             | IncidentCommandResult           | Đã nối; InProgress, note; không dùng route blockers của OperationalTask                                |
| S được giao · Gửi nghiệm thu | POST   | /work-orders/{id}/submit                                  | WorkOrderAction                             | IncidentCommandResult           | Đã nối; InProgress, ít nhất 1 ảnh Completion mới, result/note                                          |
| O · Nghiệm thu               | POST   | /work-orders/{id}/verify                                  | MaintenanceVerification                     | IncidentCommandResult           | Đã nối; PendingVerification; chi phí khác dự toán kể cả null cần lý do; asset outcome khi có tài sản   |
| O · Làm lại                  | POST   | /work-orders/{id}/rework                                  | WorkOrderAction                             | IncidentCommandResult           | Đã nối; PendingVerification; note; không gửi ảnh                                                       |
| O · Hủy lệnh                 | POST   | /work-orders/{id}/cancel                                  | IncidentDecision                            | IncidentCommandResult           | Đã nối; lệnh còn mở; asset outcome khi có tài sản                                                      |

### Lookup bổ sung và tên hiển thị

Staff giữ `GET /capture/locations`, `/capture/locations/{id}/rooms`, `/assets` cho form hiện hành. Owner chọn assignee từ `/staff-location-assignments?locationId=...` và `/capture/staff`, lọc ngày nghiệp vụ Việt Nam. Chi tiết Owner/Staff bổ sung tên qua `/locations/{id}`, `/rooms/{id}`, `/assets/{id}`. Tenant chỉ dùng reporting lookup có quyền; nếu tenancy lịch sử không còn lookup thì vẫn hiển thị được report và mã tham chiếu, không giả tên.

## 4. State, validation và ảnh

- Incident mở: `Submitted`, `InProgress`; kết thúc: `Resolved`, `Rejected`, `Duplicate`, `Cancelled`.
- Work Order: `Assigned` → gửi phương án `PendingApproval` → Owner duyệt (vẫn PendingApproval, `planApproved=true`) → Staff start `InProgress` → submit `PendingVerification` → Owner verify `Verified`. Từ chối phương án về Assigned; rework về InProgress. Không tự chuyển Completed tại frontend.
- Request enum số đúng source: IncidentSeverity Normal=0, Emergency=1; EvidenceKind Report=0, EmergencyAction=1, Inspection=2, Completion=3, Direct=4; AssetStatus Active=0, NeedsRepair=1, UnderRepair=2, Retired=3. Owner chỉ chọn outcome 0/1/3 theo service.
- Báo cáo phải có đúng phòng **hoặc** tên khu vực chung, mô tả 10–8000 ký tự. Submit không có title/type/category; không tự thêm các field đó.
- Mức tiền module này backend trả JSON number, không phải decimal string của invoice. Form chỉ nhận số nguyên VND an toàn trong JavaScript; số nhận vượt giới hạn hiển thị chính xác được báo rõ, không giả số làm tròn. Không đổi backend contract.
- Upload riêng làm tăng **incident.version**, không tăng work.version. Trước command cấp incident có upload, form đọc lại version và giữ payload/version đó khi retry mơ hồ; command work dùng work.version.
- Idempotency upload gắn với report/work/kind/photo, không đổi chỉ vì sửa note; retry cùng ảnh dùng cùng key. Không tự retry write khi offline/timeout.
- Tạo báo cáo gửi multipart UTF-8 có binary ảnh, không gửi file:// hoặc object key. Upload sau tạo gửi PUT binary đúng MIME.
- Camera dùng component có sẵn. Thêm `expo-image-picker` phiên bản SDK 58 qua Expo CLI để chọn thư viện native/web; plugin có mô tả quyền tiếng Việt, tắt microphone. Cần rebuild native development client khi thêm module.
- Ảnh lưu tạm trong state màn; download bằng authenticated transport (có refresh token hiện có), chỉ tải khi bấm xem, hiển thị loading/error/retry và Modal toàn màn hình. Không truy cập MinIO trực tiếp.
- Backend không có upload-progress byte stream; UI chỉ báo giai đoạn và ảnh thứ n/tổng, không bịa phần trăm.

## 5. Backend → TypeScript → UI: mapping từng trường

TypeScript đều ở `src/mobile/src/services/incidents.ts`; hook `useIncidentQuery`/`useIncidentMutation` ở `features/incidents/useIncidentData.ts`. “Có” nghĩa là UI thể hiện dữ liệu hoặc dùng làm giá trị của control/điều hướng đúng chức năng; không phải cam kết mọi field đều nằm trên card chính. ID/version nằm trong khu vực mở rộng.

| Backend DTO              | Trường JSON / kiểu client           | Component                            | Hiển thị / sử dụng | Ghi chú                                                                                                                           |
| ------------------------ | ----------------------------------- | ------------------------------------ | ------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| IncidentView             | `id: string`                        | IncidentListScreen / IncidentDetail  | Có                 | Nội dung/trạng thái/vị trí hoặc tham chiếu mở rộng; định danh/phiên bản dùng ở phần tham chiếu, scope hoặc command.               |
| IncidentView             | `code: string`                      | IncidentListScreen / IncidentDetail  | Có                 | Nội dung/trạng thái/vị trí hoặc tham chiếu mở rộng                                                                                |
| IncidentView             | `locationId: string`                | IncidentListScreen / IncidentDetail  | Có                 | Nội dung/trạng thái/vị trí hoặc tham chiếu mở rộng; định danh/phiên bản dùng ở phần tham chiếu, scope hoặc command.               |
| IncidentView             | `roomId: string \| null`            | IncidentListScreen / IncidentDetail  | Có                 | Nội dung/trạng thái/vị trí hoặc tham chiếu mở rộng; định danh/phiên bản dùng ở phần tham chiếu, scope hoặc command.               |
| IncidentView             | `commonArea: string \| null`        | IncidentListScreen / IncidentDetail  | Có                 | Nội dung/trạng thái/vị trí hoặc tham chiếu mở rộng                                                                                |
| IncidentView             | `assetId: string \| null`           | IncidentListScreen / IncidentDetail  | Có                 | Nội dung/trạng thái/vị trí hoặc tham chiếu mở rộng; định danh/phiên bản dùng ở phần tham chiếu, scope hoặc command.               |
| IncidentView             | `description: string`               | IncidentListScreen / IncidentDetail  | Có                 | Nội dung/trạng thái/vị trí hoặc tham chiếu mở rộng                                                                                |
| IncidentView             | `severity: 'Normal' \| 'Emergency'` | IncidentListScreen / IncidentDetail  | Có                 | Nội dung/trạng thái/vị trí hoặc tham chiếu mở rộng                                                                                |
| IncidentView             | `status: IncidentStatus`            | IncidentListScreen / IncidentDetail  | Có                 | Nội dung/trạng thái/vị trí hoặc tham chiếu mở rộng                                                                                |
| IncidentView             | `type: string \| null`              | IncidentListScreen / IncidentDetail  | Có                 | Nội dung/trạng thái/vị trí hoặc tham chiếu mở rộng                                                                                |
| IncidentView             | `category: string \| null`          | IncidentListScreen / IncidentDetail  | Có                 | Nội dung/trạng thái/vị trí hoặc tham chiếu mở rộng                                                                                |
| IncidentView             | `acknowledgedAt: string \| null`    | IncidentListScreen / IncidentDetail  | Có                 | Nội dung/trạng thái/vị trí hoặc tham chiếu mở rộng                                                                                |
| IncidentView             | `resolutionNote: string \| null`    | IncidentListScreen / IncidentDetail  | Có                 | Nội dung/trạng thái/vị trí hoặc tham chiếu mở rộng                                                                                |
| IncidentView             | `version: number`                   | IncidentListScreen / IncidentDetail  | Có                 | Nội dung/trạng thái/vị trí hoặc tham chiếu mở rộng; định danh/phiên bản dùng ở phần tham chiếu, scope hoặc command.               |
| IncidentView             | `createdAt: string`                 | IncidentListScreen / IncidentDetail  | Có                 | Nội dung/trạng thái/vị trí hoặc tham chiếu mở rộng                                                                                |
| IncidentView             | `staffAvailable: boolean \| null`   | IncidentListScreen / IncidentDetail  | Có                 | Nội dung/trạng thái/vị trí hoặc tham chiếu mở rộng; null có thể do chưa có dữ liệu hoặc bị mask theo quyền.                       |
| IncidentView             | `escalationEnabled: boolean`        | IncidentListScreen / IncidentDetail  | Có                 | Nội dung/trạng thái/vị trí hoặc tham chiếu mở rộng                                                                                |
| WorkOrderView            | `id: string`                        | WorkDetail / IncidentActionPanel     | Có                 | Chi tiết bảo trì, phương án, kết quả hoặc tham chiếu; định danh/phiên bản dùng ở phần tham chiếu, scope hoặc command.             |
| WorkOrderView            | `incidentId: string`                | WorkDetail / IncidentActionPanel     | Có                 | Chi tiết bảo trì, phương án, kết quả hoặc tham chiếu; định danh/phiên bản dùng ở phần tham chiếu, scope hoặc command.             |
| WorkOrderView            | `locationId: string`                | WorkDetail / IncidentActionPanel     | Có                 | Chi tiết bảo trì, phương án, kết quả hoặc tham chiếu; định danh/phiên bản dùng ở phần tham chiếu, scope hoặc command.             |
| WorkOrderView            | `roomId: string \| null`            | WorkDetail / IncidentActionPanel     | Có                 | Chi tiết bảo trì, phương án, kết quả hoặc tham chiếu; định danh/phiên bản dùng ở phần tham chiếu, scope hoặc command.             |
| WorkOrderView            | `assetId: string \| null`           | WorkDetail / IncidentActionPanel     | Có                 | Chi tiết bảo trì, phương án, kết quả hoặc tham chiếu; định danh/phiên bản dùng ở phần tham chiếu, scope hoặc command.             |
| WorkOrderView            | `assignedStaffId: string`           | WorkDetail / IncidentActionPanel     | Có                 | Hiện Bạn khi trùng user hiện hành; mã người phụ trách trong tham chiếu; không giả tên Staff.                                      |
| WorkOrderView            | `expectedOutcome: string`           | WorkDetail / IncidentActionPanel     | Có                 | Chi tiết bảo trì, phương án, kết quả hoặc tham chiếu                                                                              |
| WorkOrderView            | `targetCompletionAt: string`        | WorkDetail / IncidentActionPanel     | Có                 | Chi tiết bảo trì, phương án, kết quả hoặc tham chiếu                                                                              |
| WorkOrderView            | `isOverdue: boolean`                | WorkDetail / IncidentActionPanel     | Có                 | Chi tiết bảo trì, phương án, kết quả hoặc tham chiếu                                                                              |
| WorkOrderView            | `status: WorkStatus`                | WorkDetail / IncidentActionPanel     | Có                 | Chi tiết bảo trì, phương án, kết quả hoặc tham chiếu                                                                              |
| WorkOrderView            | `inspectionResult: string \| null`  | WorkDetail / IncidentActionPanel     | Có                 | Chi tiết bảo trì, phương án, kết quả hoặc tham chiếu                                                                              |
| WorkOrderView            | `proposedSolution: string \| null`  | WorkDetail / IncidentActionPanel     | Có                 | Chi tiết bảo trì, phương án, kết quả hoặc tham chiếu                                                                              |
| WorkOrderView            | `estimatedMinutes: number \| null`  | WorkDetail / IncidentActionPanel     | Có                 | Chi tiết bảo trì, phương án, kết quả hoặc tham chiếu                                                                              |
| WorkOrderView            | `estimatedCost: number \| null`     | WorkDetail / IncidentActionPanel     | Có                 | Theo projection backend; chỉ Owner hoặc Staff được giao có dữ liệu tài chính. Null không bị đổi thành 0.                          |
| WorkOrderView            | `vendor: string \| null`            | WorkDetail / IncidentActionPanel     | Có                 | Theo projection backend; chỉ Owner hoặc Staff được giao có dữ liệu tài chính. Null không bị đổi thành 0.                          |
| WorkOrderView            | `proposalVersion: number`           | WorkDetail / IncidentActionPanel     | Có                 | Chi tiết bảo trì, phương án, kết quả hoặc tham chiếu; định danh/phiên bản dùng ở phần tham chiếu, scope hoặc command.             |
| WorkOrderView            | `planApproved: boolean`             | WorkDetail / IncidentActionPanel     | Có                 | Chi tiết bảo trì, phương án, kết quả hoặc tham chiếu                                                                              |
| WorkOrderView            | `canStart: boolean`                 | WorkDetail / IncidentActionPanel     | Có                 | Chi tiết bảo trì, phương án, kết quả hoặc tham chiếu                                                                              |
| WorkOrderView            | `approvedById: string \| null`      | WorkDetail / IncidentActionPanel     | Có                 | Chi tiết bảo trì, phương án, kết quả hoặc tham chiếu; định danh/phiên bản dùng ở phần tham chiếu, scope hoặc command.             |
| WorkOrderView            | `approvedAt: string \| null`        | WorkDetail / IncidentActionPanel     | Có                 | Chi tiết bảo trì, phương án, kết quả hoặc tham chiếu                                                                              |
| WorkOrderView            | `result: string \| null`            | WorkDetail / IncidentActionPanel     | Có                 | Chi tiết bảo trì, phương án, kết quả hoặc tham chiếu                                                                              |
| WorkOrderView            | `actualCost: number \| null`        | WorkDetail / IncidentActionPanel     | Có                 | Theo projection backend; chỉ Owner hoặc Staff được giao có dữ liệu tài chính. Null không bị đổi thành 0.                          |
| WorkOrderView            | `verifiedById: string \| null`      | WorkDetail / IncidentActionPanel     | Có                 | Chi tiết bảo trì, phương án, kết quả hoặc tham chiếu; định danh/phiên bản dùng ở phần tham chiếu, scope hoặc command.             |
| WorkOrderView            | `verifiedAt: string \| null`        | WorkDetail / IncidentActionPanel     | Có                 | Chi tiết bảo trì, phương án, kết quả hoặc tham chiếu                                                                              |
| WorkOrderView            | `version: number`                   | WorkDetail / IncidentActionPanel     | Có                 | Chi tiết bảo trì, phương án, kết quả hoặc tham chiếu; định danh/phiên bản dùng ở phần tham chiếu, scope hoặc command.             |
| IncidentActivityView     | `id: string`                        | IncidentTimeline                     | Có                 | Timeline; dataJson chỉ Owner qua eventFacts với key có nhãn; định danh/phiên bản dùng ở phần tham chiếu, scope hoặc command.      |
| IncidentActivityView     | `workOrderId: string \| null`       | IncidentTimeline                     | Có                 | Timeline; dataJson chỉ Owner qua eventFacts với key có nhãn; định danh/phiên bản dùng ở phần tham chiếu, scope hoặc command.      |
| IncidentActivityView     | `action: string`                    | IncidentTimeline                     | Có                 | Timeline; dataJson chỉ Owner qua eventFacts với key có nhãn                                                                       |
| IncidentActivityView     | `note: string`                      | IncidentTimeline                     | Có                 | Timeline; dataJson chỉ Owner qua eventFacts với key có nhãn                                                                       |
| IncidentActivityView     | `occurredAt: string`                | IncidentTimeline                     | Có                 | Timeline; dataJson chỉ Owner qua eventFacts với key có nhãn                                                                       |
| IncidentActivityView     | `actorId: string \| null`           | IncidentTimeline                     | Có                 | Timeline; dataJson chỉ Owner qua eventFacts với key có nhãn; định danh/phiên bản dùng ở phần tham chiếu, scope hoặc command.      |
| IncidentActivityView     | `dataJson: string \| null`          | IncidentTimeline                     | Có                 | Không dump JSON. Owner mở chi tiết có nhãn; Tenant không hiện; Staff backend trả null.                                            |
| IncidentEvidenceView     | `id: string`                        | EvidenceImage                        | Có                 | Loại, MIME, kích thước; ID liên kết mở rộng; tải ảnh có xác thực; định danh/phiên bản dùng ở phần tham chiếu, scope hoặc command. |
| IncidentEvidenceView     | `workOrderId: string \| null`       | EvidenceImage                        | Có                 | Loại, MIME, kích thước; ID liên kết mở rộng; tải ảnh có xác thực; định danh/phiên bản dùng ở phần tham chiếu, scope hoặc command. |
| IncidentEvidenceView     | `activityId: string \| null`        | EvidenceImage                        | Có                 | Loại, MIME, kích thước; ID liên kết mở rộng; tải ảnh có xác thực; định danh/phiên bản dùng ở phần tham chiếu, scope hoặc command. |
| IncidentEvidenceView     | `kind: EvidenceKind`                | EvidenceImage                        | Có                 | Loại, MIME, kích thước; ID liên kết mở rộng; tải ảnh có xác thực                                                                  |
| IncidentEvidenceView     | `contentType: string`               | EvidenceImage                        | Có                 | Loại, MIME, kích thước; ID liên kết mở rộng; tải ảnh có xác thực                                                                  |
| IncidentEvidenceView     | `length: number`                    | EvidenceImage                        | Có                 | Loại, MIME, kích thước; ID liên kết mở rộng; tải ảnh có xác thực                                                                  |
| EmergencyActionView      | `id: string`                        | IncidentDetail / IncidentActionPanel | Có                 | Khoản đề nghị/duyệt và tham chiếu hoạt động; định danh/phiên bản dùng ở phần tham chiếu, scope hoặc command.                      |
| EmergencyActionView      | `activityId: string`                | IncidentDetail / IncidentActionPanel | Có                 | Khoản đề nghị/duyệt và tham chiếu hoạt động; định danh/phiên bản dùng ở phần tham chiếu, scope hoặc command.                      |
| EmergencyActionView      | `requestedCost: number \| null`     | IncidentDetail / IncidentActionPanel | Có                 | Khoản đề nghị/duyệt và tham chiếu hoạt động; null có thể do chưa có dữ liệu hoặc bị mask theo quyền.                              |
| EmergencyActionView      | `costApproved: boolean \| null`     | IncidentDetail / IncidentActionPanel | Có                 | Khoản đề nghị/duyệt và tham chiếu hoạt động; null có thể do chưa có dữ liệu hoặc bị mask theo quyền.                              |
| MaintenanceHistoryView   | `id: string`                        | WorkDetail                           | Có                 | Hiện trạng/trạng thái trước-sau, chi phí, xác minh, tham chiếu; định danh/phiên bản dùng ở phần tham chiếu, scope hoặc command.   |
| MaintenanceHistoryView   | `activityId: string`                | WorkDetail                           | Có                 | Hiện trạng/trạng thái trước-sau, chi phí, xác minh, tham chiếu; định danh/phiên bản dùng ở phần tham chiếu, scope hoặc command.   |
| MaintenanceHistoryView   | `action: string`                    | WorkDetail                           | Có                 | Hiện trạng/trạng thái trước-sau, chi phí, xác minh, tham chiếu                                                                    |
| MaintenanceHistoryView   | `incidentId: string`                | WorkDetail                           | Có                 | Hiện trạng/trạng thái trước-sau, chi phí, xác minh, tham chiếu; định danh/phiên bản dùng ở phần tham chiếu, scope hoặc command.   |
| MaintenanceHistoryView   | `workOrderId: string \| null`       | WorkDetail                           | Có                 | Hiện trạng/trạng thái trước-sau, chi phí, xác minh, tham chiếu; định danh/phiên bản dùng ở phần tham chiếu, scope hoặc command.   |
| MaintenanceHistoryView   | `roomId: string \| null`            | WorkDetail                           | Có                 | Hiện trạng/trạng thái trước-sau, chi phí, xác minh, tham chiếu; định danh/phiên bản dùng ở phần tham chiếu, scope hoặc command.   |
| MaintenanceHistoryView   | `assetId: string \| null`           | WorkDetail                           | Có                 | Hiện trạng/trạng thái trước-sau, chi phí, xác minh, tham chiếu; định danh/phiên bản dùng ở phần tham chiếu, scope hoặc command.   |
| MaintenanceHistoryView   | `conditionBefore: string \| null`   | WorkDetail                           | Có                 | Hiện trạng/trạng thái trước-sau, chi phí, xác minh, tham chiếu                                                                    |
| MaintenanceHistoryView   | `conditionAfter: string \| null`    | WorkDetail                           | Có                 | Hiện trạng/trạng thái trước-sau, chi phí, xác minh, tham chiếu                                                                    |
| MaintenanceHistoryView   | `statusBefore: string \| null`      | WorkDetail                           | Có                 | Hiện trạng/trạng thái trước-sau, chi phí, xác minh, tham chiếu                                                                    |
| MaintenanceHistoryView   | `statusAfter: string \| null`       | WorkDetail                           | Có                 | Hiện trạng/trạng thái trước-sau, chi phí, xác minh, tham chiếu                                                                    |
| MaintenanceHistoryView   | `actualCost: number`                | WorkDetail                           | Có                 | Hiện trạng/trạng thái trước-sau, chi phí, xác minh, tham chiếu                                                                    |
| MaintenanceHistoryView   | `verifiedById: string`              | WorkDetail                           | Có                 | Hiện trạng/trạng thái trước-sau, chi phí, xác minh, tham chiếu; định danh/phiên bản dùng ở phần tham chiếu, scope hoặc command.   |
| MaintenanceHistoryView   | `verifiedAt: string`                | WorkDetail                           | Có                 | Hiện trạng/trạng thái trước-sau, chi phí, xác minh, tham chiếu                                                                    |
| ExpenseView              | `id: string`                        | IncidentDetail                       | Có                 | Owner: số tiền/ngày/loại chi phí và tham chiếu; định danh/phiên bản dùng ở phần tham chiếu, scope hoặc command.                   |
| ExpenseView              | `incidentId: string`                | IncidentDetail                       | Có                 | Owner: số tiền/ngày/loại chi phí và tham chiếu; định danh/phiên bản dùng ở phần tham chiếu, scope hoặc command.                   |
| ExpenseView              | `workOrderId: string \| null`       | IncidentDetail                       | Có                 | Owner: số tiền/ngày/loại chi phí và tham chiếu; định danh/phiên bản dùng ở phần tham chiếu, scope hoặc command.                   |
| ExpenseView              | `emergencyActionId: string \| null` | IncidentDetail                       | Có                 | Owner: số tiền/ngày/loại chi phí và tham chiếu                                                                                    |
| ExpenseView              | `category: string`                  | IncidentDetail                       | Có                 | Owner: số tiền/ngày/loại chi phí và tham chiếu                                                                                    |
| ExpenseView              | `amount: number`                    | IncidentDetail                       | Có                 | Owner: số tiền/ngày/loại chi phí và tham chiếu                                                                                    |
| ExpenseView              | `expenseDate: string`               | IncidentDetail                       | Có                 | Owner: số tiền/ngày/loại chi phí và tham chiếu                                                                                    |
| IncidentNotificationView | `id: string`                        | IncidentInbox                        | Có                 | Sự kiện, khẩn cấp, thời gian, đã đọc và target; định danh/phiên bản dùng ở phần tham chiếu, scope hoặc command.                   |
| IncidentNotificationView | `incidentId: string`                | IncidentInbox                        | Có                 | Sự kiện, khẩn cấp, thời gian, đã đọc và target; định danh/phiên bản dùng ở phần tham chiếu, scope hoặc command.                   |
| IncidentNotificationView | `event: string`                     | IncidentInbox                        | Có                 | Sự kiện, khẩn cấp, thời gian, đã đọc và target                                                                                    |
| IncidentNotificationView | `highPriority: boolean`             | IncidentInbox                        | Có                 | Sự kiện, khẩn cấp, thời gian, đã đọc và target                                                                                    |
| IncidentNotificationView | `createdAt: string`                 | IncidentInbox                        | Có                 | Sự kiện, khẩn cấp, thời gian, đã đọc và target                                                                                    |
| IncidentNotificationView | `readAt: string \| null`            | IncidentInbox                        | Có                 | Sự kiện, khẩn cấp, thời gian, đã đọc và target                                                                                    |
| IncidentNotificationView | `deliveryState: string`             | IncidentInbox                        | Có                 | Sự kiện, khẩn cấp, thời gian, đã đọc và target                                                                                    |
| IncidentReportingRoom    | `roomId: string`                    | IncidentReportForm / IncidentPlace   | Có                 | Nhãn phòng-cơ sở; ID cho control/phạm vi; định danh/phiên bản dùng ở phần tham chiếu, scope hoặc command.                         |
| IncidentReportingRoom    | `roomNumber: string`                | IncidentReportForm / IncidentPlace   | Có                 | Nhãn phòng-cơ sở; ID cho control/phạm vi                                                                                          |
| IncidentReportingRoom    | `locationId: string`                | IncidentReportForm / IncidentPlace   | Có                 | Nhãn phòng-cơ sở; ID cho control/phạm vi; định danh/phiên bản dùng ở phần tham chiếu, scope hoặc command.                         |
| IncidentReportingRoom    | `locationName: string`              | IncidentReportForm / IncidentPlace   | Có                 | Nhãn phòng-cơ sở; ID cho control/phạm vi                                                                                          |
| IncidentReportingAsset   | `assetId: string`                   | IncidentReportForm / IncidentPlace   | Có                 | Nhãn tên/loại/trạng thái; scope filter phòng/khu vực; định danh/phiên bản dùng ở phần tham chiếu, scope hoặc command.             |
| IncidentReportingAsset   | `name: string`                      | IncidentReportForm / IncidentPlace   | Có                 | Nhãn tên/loại/trạng thái; scope filter phòng/khu vực                                                                              |
| IncidentReportingAsset   | `category: string`                  | IncidentReportForm / IncidentPlace   | Có                 | Nhãn tên/loại/trạng thái; scope filter phòng/khu vực                                                                              |
| IncidentReportingAsset   | `status: string`                    | IncidentReportForm / IncidentPlace   | Có                 | Nhãn tên/loại/trạng thái; scope filter phòng/khu vực                                                                              |
| IncidentReportingAsset   | `locationId: string`                | IncidentReportForm / IncidentPlace   | Có                 | Nhãn tên/loại/trạng thái; scope filter phòng/khu vực; định danh/phiên bản dùng ở phần tham chiếu, scope hoặc command.             |
| IncidentReportingAsset   | `roomId: string \| null`            | IncidentReportForm / IncidentPlace   | Có                 | Nhãn tên/loại/trạng thái; scope filter phòng/khu vực; định danh/phiên bản dùng ở phần tham chiếu, scope hoặc command.             |
| IncidentReportingAsset   | `commonArea: string \| null`        | IncidentReportForm / IncidentPlace   | Có                 | Nhãn tên/loại/trạng thái; scope filter phòng/khu vực                                                                              |
| IncidentCommandResult    | `incidentId: string`                | incidentClient / form / invalidation | Có                 | ID backend: điều hướng, liên kết ảnh hoặc refetch dữ liệu; định danh/phiên bản dùng ở phần tham chiếu, scope hoặc command.        |
| IncidentCommandResult    | `workOrderId: string \| null`       | incidentClient / form / invalidation | Có                 | ID backend: điều hướng, liên kết ảnh hoặc refetch dữ liệu; định danh/phiên bản dùng ở phần tham chiếu, scope hoặc command.        |
| IncidentCommandResult    | `resourceId: string \| null`        | incidentClient / form / invalidation | Có                 | ID backend: điều hướng, liên kết ảnh hoặc refetch dữ liệu                                                                         |
| IncidentPage<T>          | `items: T[]`                        | Pagination / list / dashboard        | Có                 | Items cho list, page/pageSize/totalCount cho phân trang/số lượng                                                                  |
| IncidentPage<T>          | `page: number`                      | Pagination / list / dashboard        | Có                 | Items cho list, page/pageSize/totalCount cho phân trang/số lượng                                                                  |
| IncidentPage<T>          | `pageSize: number`                  | Pagination / list / dashboard        | Có                 | Items cho list, page/pageSize/totalCount cho phân trang/số lượng                                                                  |
| IncidentPage<T>          | `totalCount: number`                | Pagination / list / dashboard        | Có                 | Items cho list, page/pageSize/totalCount cho phân trang/số lượng                                                                  |

### Trường không có trong DTO

IncidentView không trả reporterId/reporterName, tên Location/Room/Asset hay assignee. Không tạo các giá trị giả. Tên địa điểm/tài sản ở chi tiết lấy từ lookup có quyền; assignee chỉ có trên WorkOrderView. Incident không có title riêng hoặc priority ngoài severity.

WorkOrder không có phần trăm tiến độ riêng; dùng note/activity timeline. Thời điểm tạo lệnh và completedAt không có trong WorkOrderView, không tự dùng timestamp khác thay thế.

`DataJson` là snapshot sự kiện Owner; chỉ những trường có nhãn rõ ràng (loại/nhóm, nhân viên, kết quả, phương án, thời gian, chi phí, quyết định, hiện trạng, mã ảnh/hoạt động) được trình bày. Key không biết hoặc JSON lỗi không bị dump ra UI.

Tổng **105 trường response** trong các model ở bảng đã đối chiếu tên với DTO C# tự động. Các field nullable được giữ nguyên trong TypeScript; không đổi null thành 0 hoặc “đã duyệt”.

## 6. Chức năng hoàn thành theo vai trò

- **Tenant:** chọn phòng/tài sản theo reporting lookup, phòng hoặc khu vực chung, Normal/Emergency, mô tả/ảnh, submit multipart; mở report ID thật; danh sách có phân trang/lọc; chi tiết/ảnh/lịch sử public; hủy hoặc bổ sung ảnh khi Submitted chưa phân loại. Điều chỉnh hóa đơn/hợp đồng vẫn điều hướng sang luồng cũ.
- **Staff:** giữ capture scope hiện hành; gửi report; list relevant incident/Emergency/Work Order; tiếp nhận khẩn cấp; ghi hành động/khoản chi có evidence; đề xuất phương án; bắt đầu khi canStart; note tiến độ/vướng mắc; upload ảnh và gửi nghiệm thu. Không tự duyệt/phê duyệt chi phí hoặc chuyển Verified.
- **Owner:** list/detail; phân loại; giao/đổi Staff hiện hành; duyệt/từ chối phương án; xem tiến độ/ảnh/history/chi phí; direct completion có evidence; duyệt/từ chối khoản chi khẩn cấp; nghiệm thu/rework; hủy lệnh/báo cáo, đánh dấu trùng và đóng theo backend guard.
- **Cả ba:** inbox Incident riêng, đã đọc rồi mở report; loading/empty/error/retry; không coi HTTP lỗi là thành công; command và dữ liệu sau thao tác đồng bộ từ server.

## 7. Tệp được tạo hoặc sửa trong lượt tích hợp

Các tệp vốn đã có thay đổi của người dùng được sửa trong đúng phần liên quan, không commit toàn bộ working tree:

- `src/mobile/src/services/incidents.ts`: response/request types, enum/query/label, multipart encoder, API command/upload/download, error mapping, action rules.
- `src/mobile/src/features/incidents/useIncidentData.ts`: query theo phiên/focus, invalidation, mutation lock, abort, key retry.
- `src/mobile/src/features/incidents/IncidentReportForm.tsx`: form Staff/Tenant dùng dữ liệu thật, validation, submit.
- `src/mobile/src/features/incidents/IncidentActions.tsx`: action forms Owner/Staff/Tenant, evidence theo kind, version và phê duyệt.
- `src/mobile/src/features/incidents/IncidentScreens.tsx`: list/detail Incident, list/detail WorkOrder, maintenance history, expense và inbox.
- `src/mobile/src/features/incidents/IncidentUi.tsx`: dữ liệu có nhãn, metadata mở rộng, timeline, tên từ lookup, protected evidence/fullscreen.
- `src/mobile/src/components/IncidentEvidencePicker.tsx`: component hiện có được nâng cấp thành controlled picker/camera/gallery, giữ byte ảnh cho submit.
- `src/mobile/src/screens/StaffIncidentScreens.tsx`: giữ entry components, thay placeholder bằng module thật, guard Staff.
- `src/mobile/src/screens/TenantServiceScreens.tsx`: thay form/list Incident placeholder; giữ nguyên tạm trú.
- `src/mobile/src/screens/NotificationsScreen.tsx`: thêm IncidentInbox, giữ luồng thông báo chung.
- `src/mobile/src/screens/OwnerOverviewScreen.tsx`, `LiveWorkspaceScreens.tsx`: thêm lối vào Owner Incident/Maintenance.
- `src/mobile/src/screens/StaffDashboard.tsx`, `features/workspace/useStaffDashboard.ts`: số sự cố mở thật, refresh và điều hướng.
- `src/mobile/src/features/workspace/navigation.ts`, `app/workspace/[screen].tsx`: route theo role/tab, session key cho screen state; Incident preview không dùng form thành công giả.
- `src/mobile/package.json`, `package-lock.json`, `src/mobile/app.json`: Expo image picker tương thích SDK và cấu hình quyền.
- `src/mobile/src/__tests__/incident-api.test.ts`: transport, multipart UTF-8, auth, binary, route parity, validation/action rights.
- `src/mobile/src/__tests__/incident-integration.test.tsx`: kiểm tra UI bằng response synthetic qua client/hook; không coi là backend/live native E2E.
- `src/mobile/src/__tests__/staff-incidents.test.tsx`: thay expectation placeholder bằng boundary/navigation thật.
- `tests/mobile/ocr/liveWorkspace-ui.test.tsx`: cập nhật hai kịch bản Tenant từ draft/unavailable sang API thật; giữ các luồng khác.
- `docs/development/MOBILE_API_RESPONSE_FIELDS_2026-11-06.md`: sửa trạng thái tích hợp và route cũ.
- Tài liệu này: inventory, mapping, kiểm chứng và giới hạn.

## 8. Kết quả kiểm chứng

Full suite trả exit code 1 vì suite Meter không load; không ghi nhận full suite là PASS. Báo cáo JSON local: `TestResults/mobile-incident/frontend-results.json` (ignored, không chứa dữ liệu production).

Kết quả cuối được ghi sau khi chạy các lệnh trên source cuối, không suy từ test template:

- TypeScript: `npm run typecheck --workspace src/mobile` — PASS trên source cuối.
- ESLint: `npm run lint --workspace src/mobile` — PASS trên source cuối.
- Client/UI Incident mới: **36/36 PASS** trên source cuối (29 component/integration + 7 service/contract checks), gồm tạo báo cáo, chống submit trùng/retry cùng key, evidence/version, role boundary, phản hồi concurrency, Owner assign/direct/approve/verify/rework/cost, Staff acknowledge/progress/blocker/submit/start và refetch trạng thái.
- Backend unit Incident: Application **8/8 PASS**, Domain **8/8 PASS**, chạy bộ hiện có bằng Release `--no-build --no-restore`; backend source không đổi.
- Expo web export SDK 58: PASS trên source cuối; bundle gồm module ImagePicker. Đây là kiểm tra Metro/build, không phải thao tác browser hoặc điện thoại.
- Full mobile trên source cuối: **570 test PASS, 55 file test đạt**, **0 test assertion fail**, **1 suite không load** ở `tests/mobile/ocr/meterScreen.test.tsx` do mock thiếu `MD3LightTheme`, đã tồn tại trước task. Không sửa module Meter ngoài phạm vi để làm xanh kết quả.
- PostgreSQL Incident integration: **NOT RUN**. Guard chỉ chấp nhận admin loopback cho DB tạm; cấu hình local hiện có không đạt guard, không ép kết nối hoặc chạy trên DB làm việc.
- Native camera/gallery/iOS/Android, MinIO thật, push/email provider, live multi-role E2E, UAT/performance: **NOT RUN**. Cần chạy với API/storage có cấu hình, tài khoản test theo role và development client đã rebuild.

## 9. Giới hạn còn lại và capability thiếu

- Không có endpoint capability/action list trong DTO; frontend gate bằng role/assignee/status/approval đã kiểm source, backend tiếp tục quyết định scope/state thực tế. Các lệnh đóng/hủy/direct có thể bị 409 khi tồn tại lệnh mở, chi phí chưa quyết định hoặc trạng thái thay đổi; UI hiện lỗi và yêu cầu tải lại.
- IncidentView không trả reporterId hoặc ownerDecisionAt. UI chỉ mở hủy/bổ sung ảnh cho Tenant qua dữ liệu của chính họ khi Submitted/chưa có type. Không mở hủy/bổ sung ảnh cho Staff ở danh sách chung vì không thể xác minh chắc chắn ai là reporter. Backend hỗ trợ nhưng thiếu dữ liệu để gate an toàn phía UI; không tạo endpoint mới.
- Không có ảnh delete endpoint; upload thành công rồi hỏng command có thể để lại staged evidence. Retry cùng form/ảnh giữ key để không tạo lặp; đổi/xóa ảnh sau partial failure không đồng nghĩa xóa file server.
- Backend history query chỉ lọc theo Incident, không có WorkOrderId filter. Timeline hiển thị đúng cấp Incident; maintenance history phân trang theo Incident và chỉ render record của WorkOrder đang xem, không giả totalCount sau lọc client.
- Tên người báo và tên người duyệt không có trong DTO. Actor IDs đúng quyền nằm trong metadata; không suy tên từ ID. Tenant không thấy actor/internal data/cost.
- Số tiền module Incident là JSON number; giá trị vượt độ chính xác nguyên an toàn của JavaScript không được trình bày thành số tiền giả chính xác. Cần thay đổi contract backend có phê duyệt riêng nếu phải hỗ trợ đầy đủ mức tối đa decimal.
- Inbox Incident tách khỏi `/notifications`; badge unread chung chưa có endpoint đếm Incident chưa đọc tương ứng nên không bịa cộng số từ một trang.
- Không thêm quy tắc SLA/escalation/reminder khi OQ-04 còn mở; `escalationEnabled` hiển thị theo backend.
- Native gallery thêm module cần rebuild; chưa khẳng định quyền/camera/upload hoạt động trên thiết bị thật chỉ dựa vào unit test/export.

## 10. Nguồn đối chiếu

- [IncidentContracts.cs](../../src/backend/BHome.Application/IncidentMaintenance/IncidentContracts.cs).
- [IncidentService.cs](../../src/backend/BHome.Application/IncidentMaintenance/IncidentService.cs).
- [IncidentRecords.cs](../../src/backend/BHome.Domain/IncidentMaintenance/IncidentRecords.cs).
- [IncidentReportsController.cs](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/IncidentReportsController.cs).
- [WorkOrdersController.cs](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/WorkOrdersController.cs).
- [RolePermissions.cs](../../src/backend/BHome.Domain/IdentityAccess/RolePermissions.cs).
- [IncidentRepository.cs](../../src/backend/BHome.Infrastructure/Modules/IncidentMaintenance/Persistence/IncidentRepository.cs).
- Expo SDK 58: [ImagePicker](https://docs.expo.dev/versions/v58.0.0/sdk/imagepicker/), [Router](https://docs.expo.dev/router/introduction/). Đã đối chiếu API và type plugin đang cài, không dùng API Expo theo trí nhớ.
