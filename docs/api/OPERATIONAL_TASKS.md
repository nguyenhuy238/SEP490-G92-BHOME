# Operational Task API

Backend — BF-02 / FE-01 / UC-10–12 / DBR-01 / GBR-01..03,18.

Cập nhật runtime **06/11/2026**: [bàn giao](API_IMPLEMENTATION_STATUS.md),
[danh mục route hiện tại](API_RUNTIME_ROUTES.md). Contract Task bên dưới vẫn được dùng;
persistence đã chuyển sang Compact24. Tên entity CLR không phải tên bảng vật lý.

## Nguồn và quyết định ngày 30/10/2026

- SRS `docs/reports/BHome_Report-3_Software Requirement Specification (2).docx`: BF-02, OperationalTask lifecycle, permission matrix §I.4.4, UC-10–12, FE-01 §1.3.2–1.3.3, yêu cầu audit và persistent notification.
- Report 4 `docs/reports/Report-4_Software Design Specification (5).docx`: layered architecture, §3.12 operational_tasks, private object storage. Giữ Guid và convention EF thực tế, không sao chép BIGINT trong report.
- Quyết định 29/10 trong [Staff Location assignments](../development/STAFF_LOCATION_ASSIGNMENTS.md): Owner global; mỗi Location tối đa một Staff tại một ngày; Staff có thể nhiều Location; cả hai đầu ngày hiệu lực đều bao gồm; công việc gắn Location và Staff kế tiếp tiếp tục.
- Người dùng chọn D1-C (luồng vận hành đầy đủ) và D2-B (hợp nhất model); giao người triển khai chọn cách biểu diễn quá hạn và evidence phù hợp, mở rộng được.
- D3: giữ Assigned / InProgress / PendingVerification / Completed / Cancelled, trả thêm `isOverdue`. Quá hạn không thay thế trạng thái thực thi. PendingVerification vẫn có thể quá hạn cho tới quyết định của Owner; đây là cảnh báo công việc, không phải quy tắc phạt Staff. Lịch sử lưu `wasOverdue` trước update/verify/cancel để đổi deadline không xóa dấu vết.
- D4: ảnh PNG/JPEG private ngay trong slice này; metadata riêng, không đưa object key vào DTO. Kiểm tra header, giải mã ảnh và giới hạn 12 triệu pixels. Mặc định tối đa 10 ảnh mỗi Task và 5 MiB/ảnh là giới hạn tài nguyên kỹ thuật có thể cấu hình; không phải giới hạn Incident của SRS hoặc chính sách retention.

## Model và migration

Một entity CLR `OperationalTask` dùng chung. `Kind = MeterReading` (0) hoặc `AdHoc` (1).
Runtime Compact24 lưu trong `operational_tasks` với `task_type=METER_READ/GENERAL`;
technical command/job cũng nằm trong bảng này bằng discriminator riêng, không xuất qua generic Task API.

Chi tiết meter được adapter Compact24 ánh xạ vào cột/JSON tương ứng; không tạo bảng Task trùng
chức năng. Quyết định D2-B và namespace CLR `BHome.Domain.Billing.OperationalTask` được giữ.
Các record/history/evidence và service vận hành nằm trong StaffOperations.

- Meter Task: giữ ID, FK của MeterEvidence/MeterReading, purpose/period/final Contract và numeric status cũ. Staff xác nhận reading qua capture API vẫn hoàn thành theo UC-20; không qua Owner verify của generic Task.
- AdHoc Task: Location bắt buộc, nội dung, priority, dueAt, evidence requirement, snapshot assignment, version và Owner verification. Không có MeterId/ContractId/BillingPeriod.
- History/evidence nằm trong JSON của `operational_tasks`; command/file-upload intent là technical records;
  Task notification và inbox được ánh xạ vào `notifications`. Source mapping ở
  [Compact24Records.cs](../../src/backend/BHome.Infrastructure/Persistence/Compact24/Compact24Records.cs).
- `20261030074118_UnifiedOperationalTasks` và các tên bảng phụ OperationalTaskHistory/Commands/
  Evidence/Notifications/FileUploads là lịch sử EF persistence cũ, không phải bảng cần tạo thêm cho Compact24.

Không chạy `dotnet ef database update` từ hướng dẫn Task cũ để cập nhật Compact24.
[Delivery note 30/10](../development/OPERATIONAL_TASKS_DELIVERY.md) giữ bằng chứng migration local
ở thời điểm persistence cũ; không mô tả schema hiện tại hoặc chứng minh đã triển khai Production.
Import/rollback Compact24 phải dùng quy trình riêng, có reconciliation và bảo toàn dữ liệu.

## HTTP và quyền

Base: `/api/v1/operational-tasks`. Bearer session hợp lệ; response no-store. Không có Guest/Tenant access.

| Method / suffix                 | Quyền                              | Kết quả                                                                     |
| ------------------------------- | ---------------------------------- | --------------------------------------------------------------------------- |
| POST /                          | Owner/manage                       | 201, TaskView, Location header; tạo và tự assign trong transaction          |
| GET /                           | Owner/Staff view + current scope   | TaskPage<TaskView>, list AdHoc tasks                                        |
| GET /{id}                       | Owner/Staff view + current scope   | TaskView                                                                    |
| PUT /{id}                       | Owner/manage                       | Cập nhật thông tin khi Assigned/InProgress, có reason/version               |
| POST /{id}/assign               | Owner/manage                       | Đồng bộ snapshot với phân công Location hiện tại, không chọn Staff tùy ý    |
| POST /{id}/start                | Staff/execute + current scope      | Assigned → InProgress                                                       |
| POST /{id}/progress             | Staff/execute + current scope      | Thêm progress history khi InProgress                                        |
| POST /{id}/blockers             | Staff/execute + current scope      | Thêm blocker history, giữ InProgress, thông báo Owner                       |
| POST /{id}/coordinate           | Owner/manage                       | Thêm hướng dẫn xử lý khi Task đang mở, thông báo Staff                      |
| POST /{id}/submit               | Staff/execute + current scope      | InProgress → PendingVerification; cần result và evidence theo cấu hình Task |
| POST /{id}/verify               | Owner/verify                       | PendingVerification → Completed; ghi verifier/time                          |
| POST /{id}/rework               | Owner/verify                       | PendingVerification → InProgress; reason bắt buộc                           |
| POST /{id}/cancel               | Owner/manage                       | Task đang mở → Cancelled; reason bắt buộc; giữ history/evidence             |
| GET /{id}/history               | View + current scope               | Phân trang lịch sử append-only                                              |
| GET /{id}/evidence              | View + current scope               | Metadata ảnh, không trả object key                                          |
| PUT /{id}/evidence              | Staff/execute + current scope      | Raw image/png hoặc image/jpeg; chỉ khi InProgress                           |
| GET /{id}/evidence/{evidenceId} | View + current scope               | Download attachment, MIME từ nội dung đã xác thực, nosniff                  |
| GET /notifications              | Own recipient + view/current scope | Phân trang persistent notifications của module Task                         |
| POST /notifications/{id}/read   | Own recipient + view/current scope | 204; đánh dấu đọc idempotent                                                |

Read detail/history của meter Task chỉ trả thông tin chung; meter details/reading vẫn qua capture API. List AdHoc không trộn meter workflow. Generic write vào meter Task trả `409 meter_workflow_required`.

Mỗi lệnh POST/PUT cần header `Idempotency-Key: <non-empty UUID>`, ngoại trừ notification/read tự idempotent. Namespace key theo authenticated actor trên toàn module. Cùng key/operation/target/payload trả lại response ban đầu; payload/target/operation khác trả 409. Vì response replay là snapshot, dùng GET để lấy version/responsibility/isOverdue hiện tại.

Task mutation cần `version` hiện tại; stale version trả 409, không tự ghi đè. Upload có cùng khóa transaction và làm tăng version; sau upload dùng GET để lấy version mới trước submit. `/assign` khi assignment không đổi là no-op, không tăng version hoặc thêm assignment history.

Unknown JSON fields bị từ chối 400: không nhận status, actor, Owner hoặc assignee giả từ client. Permission được kiểm lại ở service; Staff phải là người phụ trách Location hiệu lực từ DB, kể cả tài khoản có thêm role Owner. Tenant không được quyền chỉ do có Location/Task ID.

## Payloads

Create:

```json
{
  "locationId": "11111111-1111-4111-8111-111111111111",
  "work": {
    "title": "Kiểm tra khu vực chung",
    "requirements": "Kiểm tra và ghi nhận kết quả vệ sinh",
    "priority": "Normal",
    "dueAt": "2026-10-31T10:00:00+07:00",
    "evidenceRequired": true
  }
}
```

Update: `{ "version": 1, "work": { ... }, "reason": "Lý do thay đổi" }`.

Action: `{ "version": 2, "note": "Tiến độ/blocker/kết quả/lý do", "evidenceIds": [] }`.

- `start`, `assign`, `verify`: note không bắt buộc. `progress`, `blockers`, `coordinate`, `submit`, `rework`, `cancel`: note bắt buộc.
- `submit`: note là result, evidenceIds là các ảnh được chọn cho lần nộp này. Khi evidenceRequired=true, ít nhất một ảnh hợp lệ thuộc chính Task phải tồn tại trong private storage.
- `progress`/`blockers` có thể tham chiếu ảnh thuộc Task; không thay thế completion submission.
- Rework giữ kết quả/evidence/history cũ; reset lựa chọn submission hiện tại, lần submit tiếp theo phải chọn evidence rõ ràng. Có thể chọn lại ảnh cũ còn phù hợp; không ép chụp mới khi SRS chưa có quy tắc đó.
- Không sửa requirements khi PendingVerification: Owner yêu cầu rework trước, rồi update để không thay tiêu chí của kết quả đang chờ duyệt.
- Title 1–200, requirements 1–8000, update reason 1–2000, action note tối đa 8000 ký tự; chuỗi toàn khoảng trắng không hợp lệ.
- Priority Normal/High. dueAt ISO-8601 có Z/offset; chuẩn hóa UTC. Deadline mới phải ở tương lai; update trường khác được giữ nguyên deadline đã quá hạn. Không tự thêm reminder cadence hoặc thời hạn nghiệp vụ.
- Không đổi Location trên Task đã tạo; công việc và history giữ nguyên scope.

TaskView: id, locationId, kind, title, requirements, priority, dueAt, evidenceRequired, status, isOverdue, currentResponsibleStaffUserId, recordedStaffUserId, responsibilityAvailable, result, version, verifiedByUserId, verifiedAt, createdAt, updatedAt.

`currentResponsibleStaffUserId` là live lookup; `recordedStaffUserId` là snapshot ghi nhận gần nhất. Khi Staff kế tiếp thực hiện mutation/upload, server đồng bộ snapshot và thêm responsibility_changed history trong cùng transaction. Không có Staff: Owner vẫn đọc được task và thấy responsibilityAvailable=false; không tạo/assign hoặc cho Staff thực thi mới. Không có Staff-to-Staff transfer API.

List filters: page mặc định 1, pageSize mặc định 20 (tối đa 100), locationId, staffUserId (Owner only), status, priority, isOverdue, dueFrom, dueTo. `staffUserId` lọc theo Staff đang phụ trách hiện tại; Staff caller luôn bị giới hạn bởi Staff userId của token, không thể dùng query để xem Staff khác. History/notifications dùng page/pageSize. TaskPage gồm items/page/pageSize/totalCount. Tất cả phân trang/query scope trên server.

## Lỗi

ProblemDetails kèm correlationId và code cho lỗi Task:

| HTTP | Ví dụ code                                                                                                                                                                                           |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400  | invalid_task_input, invalid_task_work_or_deadline, task_note_required, invalid_task_evidence, invalid_task_image, invalid_pagination, idempotency_key_required                                       |
| 401  | authentication_required hoặc lỗi session nền                                                                                                                                                         |
| 403  | task_permission_denied hoặc lỗi policy nền                                                                                                                                                           |
| 404  | task_resource_not_found, không tiết lộ Task/ảnh ngoài scope                                                                                                                                          |
| 409  | no_responsible_staff, location_inactive, stale_version, idempotency_conflict, invalid_task_transition, task_not_editable, completion_evidence_required, task_evidence_limit, meter_workflow_required |
| 413  | task_evidence_too_large hoặc body vượt trần HTTP                                                                                                                                                     |
| 415  | MIME khai báo không hỗ trợ                                                                                                                                                                           |

Lỗi validation/model binding của framework dùng ValidationProblemDetails, không đảm bảo có code nghiệp vụ. Lỗi DB/provider bất ngờ vẫn được sanitize; không đổi thành thành công.

## Evidence, transactions và notification

- `OperationalTasks:Evidence:MaximumFilesPerTask` mặc định 10, cấu hình 1–50.
- `OperationalTasks:Evidence:MaximumFileBytes` mặc định 5242880, cấu hình 1024–20971520. HTTP hard limit 20 MiB. Không cần thay appsettings nếu dùng mặc định.
- Object key do server sinh; không dùng filename/path/URL từ client. Staging intent tồn tại độc lập trước external write; nếu upload hoặc transaction lỗi, cleanup có thể xóa orphan. Lease một giờ là kỹ thuật upload, không phải retention cho evidence nghiệp vụ.
- Cleanup chạy mỗi 5 phút, giữ object đã được liên kết vào TaskEvidence. Không xóa ảnh đã dùng chỉ vì Task Completed/Cancelled hoặc đổi Staff.
- Task/history/audit/notification/dedup commit cùng transaction. Khóa actor+command trước, rồi advisory lock Location dùng chung với property configuration và create Staff assignment; version chống stale request khác key. Kiểm lại scope sau lock.
- Compact24 Staff assignment adapter khóa hàng Location bằng `FOR UPDATE`, kiểm overlap inclusive
  trên `locations.staff_assignments` rồi append trong cùng transaction. Không dùng tên bảng/exclusion
  constraint StaffLocationAssignments của persistence legacy để mô tả runtime hiện tại.
- History/command append-only tại DbContext; các quyết định quan trọng có thêm SecurityAudit không ghi nội dung nhạy cảm vào log.
- In-app notification theo event cho responsible Staff hoặc active Owners, lưu DB trong transaction và dedup theo event+recipient. Task API đọc/chưa đọc vẫn tương thích; publisher đã đưa sang inbox chung và đồng bộ read-state của đúng recipient, không nhân đôi inbox live.
- Delivery retry/lease/monitoring JOB-04 đã có trong [Notifications](NOTIFICATIONS.md); push/email provider thật mặc định Unconfigured. Không báo đã gửi hoặc rollback Task do provider chưa cấu hình.

## Phạm vi còn lại

JOB-06/07 recurrence/deadline workflow và tích hợp Work Order chưa hoàn chỉnh; không có endpoint giả
nhận Recurring rồi bỏ qua. JOB-09 meter-task generation đã có ở [Billing automation](BILLING_AUTOMATION.md),
không qua AdHoc lifecycle. Task API không cấp quyền Temporary Residence hoặc Work Order plan/cost approval.

Chưa đo performance/UAT/coverage; không suy ra tuân thủ toàn bộ SRS từ slice Task. Bằng chứng lệnh và kết quả kiểm tra sẽ ghi tại [delivery note](../development/OPERATIONAL_TASKS_DELIVERY.md).
