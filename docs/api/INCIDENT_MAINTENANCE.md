# Incident và Maintenance API

BF-07 / FE-06 / UC-26–30; GBR-01–03,11–14,18; DBR-09/10/13. Nguồn: SRS local §2.7, §4.1–4.5, FE-06 §6; Report 4 §6; [quyết định D1–D8 A](INCIDENT_CORE_API_PROPOSAL.md) được người dùng chốt ngày 30/10/2026.

Chỉ Backend. Owner toàn hệ thống, Staff theo phân công Location hiện hành; Tenant theo `Contract.TenantUserId` và kỳ cư trú của representative trong Active Contract. Không dùng `Resident.OwnerUserId` để xác định Tenant. Co-occupant chưa có account mapping không được tự cấp quyền.

## Hợp đồng chung

- Base `/api/v1`; Bearer JWT; mọi response private `Cache-Control: no-store`.
- Mọi POST/PUT thay đổi nghiệp vụ trừ đánh dấu notification đã đọc cần `Idempotency-Key`: UUID khác rỗng. Cùng actor/key/input trả lại **các ID kết quả gốc**; khác input → 409. Quyền được kiểm tra lại trước replay. Retry upload dùng cùng bytes và cùng tham số; submit multipart dùng cùng thứ tự ảnh.
- Command response: `{ "incidentId": "uuid", "workOrderId": null, "resourceId": null }`. GET lại resource để lấy trạng thái/version hiện hành. Không tái sử dụng một key cho các command khác nhau.
- Các mutation nhận `version`: report version với Incident command; work-order version với Work Order command. Stale version → 409. Upload tăng report version; không tăng Work Order version.
- List: `page=1`, `pageSize=20` tối đa 100; `incidentId`, `locationId`, `roomId`, `assetId`, `status`, `severity`; Work Order còn có `workOrderStatus`. Dùng `/work-orders?incidentId=uuid` để lấy việc liên quan một Incident. Scope được lọc trước count/sort/paging. Không cung cấp full-text search trong slice này.
- Query enum nhận tên hoặc số. Form severity dùng `Normal`/`Emergency`. JSON `AssetStatus`: `0` Active, `1` NeedsRepair, `3` Retired; outcome UnderRepair `2` không được client chọn, do workflow tính.
- VND là JSON number decimal, số nguyên đồng, không âm, tối đa 18 chữ số. Backend dùng decimal/numeric(18,0). Client JS phải dùng decimal-aware parser khi xử lý số vượt `Number.MAX_SAFE_INTEGER`; không tính tiền bằng float. `actualCost` **bắt buộc có mặt và khác null**, 0 là quyết định rõ ràng; chưa biết phải chờ, không gửi 0 thay thế.
- Timestamp ISO 8601 có `Z`/offset; target completion bắt buộc offset và ở tương lai. Lưu UTC, ngày chi tính Asia/Ho_Chi_Minh.
- Lỗi ProblemDetails có `code`, `correlationId`; 400 input, 401 auth, 403 permission, 404 resource ngoài scope/không tồn tại, 409 state/version/key conflict, 413 quá lớn, 415 sai media type.

## Incident

| Method / route tương đối                                        | Quyền / hành vi                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| POST `/incidents`                                               | Staff/Tenant submit multipart; trả 201 và Location                                                                                                                                                                                                                                         |
| GET `/incidents/reporting-rooms`, `/incidents/reporting-assets` | Staff/Tenant lấy Room/Asset có thể báo cáo, phân trang và lọc locationId/roomId; chỉ tên/scope/status, không giá/identity. Tenant thấy Room đang cư trú và Asset trong Room/common area cùng Location; Staff thấy Location hiện được giao. Owner đơn role không có quyền submit/lookup này |
| GET `/incidents`                                                | Owner toàn hệ thống; Staff Location hiện hành; Tenant chỉ report riêng                                                                                                                                                                                                                     |
| GET `/incidents/{id}`                                           | Scope như trên, không trả proposal/vendor/cost/PII của reporter                                                                                                                                                                                                                            |
| GET `/incidents/{id}/history`                                   | Phân trang; Tenant chỉ event công khai, không actor/internal JSON; Staff không internal JSON tài chính                                                                                                                                                                                     |
| POST `/incidents/{id}/review`                                   | Owner phân loại chính thức; tạo handling decision                                                                                                                                                                                                                                          |
| POST `/incidents/{id}/reject`                                   | Owner, bắt buộc reason; không còn Work Order mở                                                                                                                                                                                                                                            |
| POST `/incidents/{id}/duplicate`                                | Owner, reason + duplicateOfId khác chính nó, cùng Location/Room/Asset; không trỏ report đã Duplicate/Rejected/Cancelled                                                                                                                                                                    |
| POST `/incidents/{id}/cancel`                                   | Reporter trước Owner decision; sau đó chỉ Owner; reason, không còn Work Order mở                                                                                                                                                                                                           |
| POST `/incidents/{id}/resolve`                                  | Owner quyết định không cần xử lý; reason; không có Work Order hoặc toàn Cancelled; không còn emergency cost chờ quyết định                                                                                                                                                                 |
| POST `/incidents/{id}/work-orders`                              | Owner, sau review; assignee active đúng Location; trả 201 Work Order                                                                                                                                                                                                                       |
| POST `/incidents/{id}/direct-completion`                        | Owner; không có Work Order chưa Cancelled; review + result/ảnh/cost/condition bắt buộc                                                                                                                                                                                                     |
| GET `/incidents/{id}/expenses`                                  | Chỉ Owner, expense đã xác nhận; không đại diện thanh toán ngân hàng                                                                                                                                                                                                                        |

Submit là `multipart/form-data`: `locationId`, một trong `roomId` hoặc `commonArea`, `assetId` tùy chọn, `severity` bắt buộc, `description` 10–8000 ký tự sau trim, `images` 0–5 file PNG/JPEG. Server kiểm tra Room/Asset thuộc đúng Location và common area; Tenant chỉ Room của tenancy hoặc common area của Location đó. Report và ảnh được submit cùng workflow; upload lỗi không tạo report xác nhận. Không có Draft Incident.

Review:

```json
{ "version": 1, "type": "Technical", "category": "Water" }
```

Type/category do Owner nhập, tối đa 100 ký tự; không có taxonomy/AI tự phân loại. Review khóa quyền reporter tự cancel hoặc thêm ảnh report.

Assign:

```json
{
  "version": 2,
  "staffId": "uuid",
  "expectedOutcome": "Khắc phục rò nước",
  "targetCompletionAt": "2026-11-02T10:00:00+07:00"
}
```

Mỗi report có thể có nhiều Work Order. Giữ quyết định phân công hiện có: tối đa một Staff/Location/ngày. Không tự tạo Staff/ca trực. Thiếu Staff không cản submit; Owner thấy `staffAvailable=false` và không thể giao người không đủ điều kiện.

Lifecycle: Submitted → InProgress → Resolved/Rejected/Duplicate/Cancelled. Emergency acknowledgement và Owner review là metadata, không thêm status.

## Work Order

| Method / route tương đối                      | Payload / hành vi                                                                                                                                                                             |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET `/work-orders`, GET `/work-orders/{id}`   | Owner/Staff theo scope; Staff chưa là assignee không thấy cost/vendor                                                                                                                         |
| POST `/work-orders/{id}/reassign`             | Owner: version, staffId, reason; giữ assignment/proposal/approval history                                                                                                                     |
| POST `/work-orders/{id}/proposal`             | Assigned Staff: version, inspectionResult, solution, estimatedMinutes (>0), estimatedCost nullable, evidenceIds (0–5 ảnh Inspection staged)                                                   |
| POST `/work-orders/{id}/plan-decision`        | Owner: version, approve bắt buộc, reason bắt buộc khi reject, vendor tùy chọn ≤500 ký tự                                                                                                      |
| POST `/work-orders/{id}/start`                | Assigned Staff: version; approval phải khớp proposal version                                                                                                                                  |
| POST `/work-orders/{id}/progress`, `/blocker` | Assigned Staff: version, note bắt buộc, evidenceIds tùy chọn (Completion staged)                                                                                                              |
| POST `/work-orders/{id}/submit`               | Assigned Staff: version, note kết quả và ít nhất một ảnh Completion staged                                                                                                                    |
| POST `/work-orders/{id}/verify`               | Owner: version, actualCost, result, costVarianceReason nếu actual khác estimate/estimate chưa biết, assetCondition và assetStatus khi có Asset                                                |
| POST `/work-orders/{id}/rework`               | Owner: version, note lý do; lần submit tiếp theo cần lựa chọn ảnh staged mới                                                                                                                  |
| POST `/work-orders/{id}/cancel`               | Owner: version, reason, assetStatus và assetCondition khi có Asset                                                                                                                            |
| GET `/work-orders/maintenance-history`        | Owner theo filters; Staff chỉ history Work Order được giao trong Location hiện hành; có action/activityId để phân biệt verified, direct completion và cancellation cùng condition/status/cost |

Lifecycle: Assigned → PendingApproval → InProgress → PendingVerification → Verified/Cancelled. Proposal rejected → Assigned; rework → InProgress.

Owner approve **giữ PendingApproval**; DTO `planApproved=true`, `canStart=true`. Staff start mới InProgress và Asset UnderRepair. Sửa proposal trong PendingApproval xóa approval cũ, tăng proposalVersion. Không có trạng thái Approved mới.

Staff hết phân công mất quyền đọc/ghi ngay dù JWT chưa hết hạn. Staff mới xem được công việc ở Location nhưng không thực thi trước Owner reassign. Approval đã lưu được giữ khi đổi người theo D7-A.

Verify và direct completion tạo MaintenanceHistory, OperatingExpense category Maintenance nếu actualCost >0, cùng transaction với status, audit và notification. Không tạo expense 0 đồng, không cập nhật expense cũ, không ghi thêm expense tổng Incident.

`actualCost` của Work Order/direct completion **không bao gồm khoản Emergency đã được xác nhận riêng**. Khoản ứng cứu ghi thành expense riêng, mỗi source chỉ một lần. Chi phí này chưa phải hóa đơn thu Tenant; không tự khấu trừ cọc hoặc tạo Invoice charge.

Asset không về Active nếu còn việc mở khác: giữ UnderRepair nếu việc khác đang InProgress/PendingVerification, còn lại NeedsRepair. Không ghi đè Retired. Owner chỉ được Retired khi không còn việc mở khác. Property API bị chặn đổi condition/status trong lúc còn Work Order mở, kể cả lúc Assigned.

Incident tự Resolved khi mọi Work Order Verified/Cancelled và ít nhất một Verified, đồng thời không còn emergency cost chờ quyết định. Toàn Cancelled không tự Resolved: Owner tạo việc khác, direct-handle hoặc resolve bằng note.

## Emergency

| Route                                                            | Quyền / payload                                                                                     |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| POST `/incidents/{id}/acknowledge`                               | Staff hiện hành: version; ack lần đầu lưu actor/time; retry cùng key replay, key khác sau ack → 409 |
| POST `/incidents/{id}/emergency-actions`                         | Staff đủ điều kiện sau acknowledge hoặc Owner: version, note, evidenceIds, requestedCost nullable   |
| GET `/incidents/{id}/emergency-actions`                          | Owner/Staff; Staff chỉ thấy cost claim của chính mình                                               |
| POST `/incidents/{id}/emergency-actions/{entryId}/cost-decision` | Owner: version của report, approve bắt buộc, reason; mỗi khoản quyết định một lần                   |

Staff tự báo Emergency được auto-acknowledge. Ghi action append-only; chi phí >0 cần ít nhất một ảnh receipt. Staff ghi requestedCost chưa tạo expense. Owner approve mới ghi expense riêng; reject giữ claim/history và lý do. Các khoản chờ quyết định giữ report mở. `staffAvailable` là thông tin điều phối Owner/Staff; Tenant nhận null.

Tạo high-priority in-app notifications cùng transaction cho mọi Owner active và Staff active hiện được giao Location. Không có ca trực nên không route theo ca. External delivery dùng job `incident.notification`, unique notification key và provider idempotency key. Provider chưa cấu hình không trả fake success; notification vẫn Pending và handler ghi Failed ở lượt lỗi cuối. Job queue giới hạn bốn attempts; timeout/cancellation có thể để notification Pending trong khi job Failed, cần operator kiểm tra BackgroundJobs và replay có kiểm soát. Account/Location scope được recheck khi delivery; recipient không còn quyền → Suppressed.

**OQ-04 vẫn Open**: không reminder 15/30 phút, không SLA acknowledgement overdue; `escalationEnabled=false`. BHOME hỗ trợ vận hành, không thay thế cơ quan ứng cứu. Slice này không xây UI gọi dịch vụ khẩn cấp hoặc thêm Owner post-incident submission permission.

## Evidence và thông báo

- `PUT /incidents/{id}/evidence?kind=Report|EmergencyAction|Inspection|Completion|Direct[&workOrderId=uuid]`: raw `image/png`/`image/jpeg`, tối đa **5.000.000 bytes**, trả resourceId của ảnh.
- Report tối đa 5 ảnh tổng. Các nhóm action/proposal/completion/direct chọn tối đa 5 ảnh mỗi entry; tối đa 5 ảnh staged chưa liên kết cho mỗi actor/kind/Work Order tại một thời điểm.
- Inspection/Completion cần workOrderId đúng Incident và đúng assignee/state. EmergencyAction/Direct/Report không nhận workOrderId. Direct chỉ Owner. Tenant chỉ thêm Report evidence trước Owner decision và vẫn thuộc đúng tenancy gốc.
- Chỉ PNG/JPEG có header hợp lệ và decode được; giới hạn 12 triệu pixel để bảo vệ tài nguyên. Không tin MIME hoặc filename; không trả object key/public URL.
- `GET /incidents/{id}/evidence`: metadata theo scope; `GET .../evidence/{imageId}` authorize lại trước tải. Tenant chỉ thấy ảnh Report của chính report mình; không ảnh internal repair/receipt.
- Evidence được chọn phải đúng kind/Work Order/actor, chưa gắn entry khác, tồn tại trong storage. Completion history đã liên kết được giữ khi rework; không sửa hoặc chuyển sang lần nộp khác.
- Upload intent riêng tồn tại qua rollback; cleanup mỗi 5 phút, sau lease kỹ thuật 1 giờ, chỉ xóa object không có evidence metadata. Không tự đặt thời hạn xóa bằng chứng nghiệp vụ đã lưu.
- `GET /incidents/notifications?page=1&pageSize=20`: chỉ recipient và resource còn trong scope; `POST /incidents/notifications/{id}/read` idempotent, không cần command key.

## Migration và vận hành

Migration `20261030162807_IncidentMaintenanceCore` thêm 10 bảng, không đổi numeric enum hoặc bảng Task/Meter hiện có. DbContext và PostgreSQL triggers chặn UPDATE/DELETE/TRUNCATE các bảng activity/command/maintenance history/expense. FK Restrict, state/cost checks và unique expense source/command/notification.

Trước rollout: backup DB, review migration/schema hiện hành, cấu hình private MinIO/S3, áp migration bằng EF, rồi chạy binary mới. Chưa áp migration lên DB local `bhome` trong task này. Các job chỉ chạy khi `Jobs:Enabled=true`; push thật cần provider đã triển khai/cấu hình. Default hiện vẫn disabled/unconfigured. Downgrade tự chặn nếu có Incident hoặc upload intent để bảo vệ dữ liệu; không dùng drop/reset làm rollback.

Xem [bàn giao và kiểm chứng](../development/INCIDENT_CORE_API_DELIVERY.md), [Postman](../testing/postman/README.md). Không claim hoàn tất OQ-04, co-occupant, UAT, performance hoặc tích hợp provider production.
