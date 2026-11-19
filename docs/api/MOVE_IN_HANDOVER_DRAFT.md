# Biên bản bàn giao phòng Draft — Main Contract

Phạm vi: BF-03/BF-04, UC-17, GBR-01/02/03/04/18, quy trình bàn giao được yêu cầu ngày 19/11/2026.
Triển khai **phần bàn giao bên cạnh quy trình tạo/ký/kích hoạt hợp đồng hiện có**; không thay endpoint hay rule tạo hợp đồng, không ký số thay Tenant, không đổi xác thực thanh toán.

## Luồng vận hành

1. Khi Main Contract **mới** được ghi vào transaction hợp đồng, Backend tự khởi tạo duy nhất một `handover.preparation` tại JSONB của bản ghi hợp đồng, trạng thái `Draft`, version 1, gắn `snapshotHash` hợp đồng. Main phát sinh từ Holding cũng được xử lý; Renewal/Addendum/Holding không tạo baseline mới. Không có migration bảng mới.
2. Cùng transaction, backend gọi công việc bàn giao đang có: một tác vụ phòng `AdHoc` và các tác vụ công tơ `Initial` cho công tơ điện/nước đang hoạt động. ID từ Contract và Meter cố định; gọi lại khi activation không tạo trùng. Staff **phải chủ động bấm Bắt đầu công việc** qua `POST /api/v1/operational-tasks/{moveInTask.id}/start` với `TaskAction {version:moveInTask.version}` và `Idempotency-Key`; API Task kiểm phân quyền, tăng version nhiệm vụ và ghi lịch sử. Backend không tự bắt đầu công việc. Công tơ Initial vẫn có các tác vụ độc lập để bảo toàn kiểm toán/OCR, nhưng Mobile hiển thị chung trong một thẻ công việc bàn giao.
3. Chỉ khi tác vụ phòng ở trạng thái `InProgress` **và đúng Staff được giao**, Backend mới cho `POST handover/draft` hoặc `POST handover/draft/evidence`. Staff chỉ **kiểm tra và ghi nhận** tình trạng phòng, 7 hạng mục, chìa khóa, từng nhóm/physical asset, số lượng tốt/hao mòn/hỏng/thiếu, ghi chú và ảnh riêng tư; không được giao sửa chữa, chỉ định người thực hiện, đề xuất phương án hay ấn định hạn sửa. Tình trạng bất thường ghi `roomChecks[].status=Issue`, `notes` và ảnh; **Owner** quyết định có sửa hay không và phương án xử lý qua bước Ready. Mỗi POST `draft` có thể chỉ chứa **các nhóm tài sản hoặc mục kiểm tra đã làm**; Backend giữ nguyên các mục đã lưu trước đó.
4. `GET handover/draft` và `GET handover/draft/pdf` cập nhật theo dữ liệu hợp đồng, chỉ số `Initial` đã xác nhận, kiểm kê và evidence hiện tại. PDF này luôn là **bản nháp**; không được dùng làm biên bản đã ký.
5. Owner đọc lại checklist và ảnh/PDF, tick xác nhận và `POST handover/draft/ready`. Chỉ cho phép khi hợp đồng Active và đủ các mục bắt buộc: Tenant gắn đúng hợp đồng, điện/nước cùng ngày có ảnh/chỉ số đã xác minh, ảnh phòng, 7 mục kiểm tra hiện trạng, chìa khóa/thẻ thực giao, mọi nhóm tài sản được kiểm, inventory token còn hiệu lực, Staff đã ghi nhận. Mục hiện trạng `Issue` phải có ghi chú và **ảnh riêng**; **không cần** Staff khai `outstandingIssues`, `responsibleParty` hay `dueDate`. Nếu tài sản hoặc hiện trạng có vấn đề, chỉ **Owner** cung cấp **lý do quyết định và phương án xử lý** (hai trường bắt buộc) khi Ready. Backend xác thực lại toàn bộ file/hash và phiên bản.
6. Tenant của đúng hợp đồng xem biên bản `Ready` trong Mobile. Tenant có thể `POST .../requests` nêu lý do cần sửa; trạng thái `ChangesRequested` tạm khóa Staff chỉnh sửa, Tenant xác nhận. Owner `POST .../requests/{requestId}/decision` chấp thuận (quay về Draft để Staff sửa rồi Owner duyệt lại) hoặc từ chối có lý do (quay về Ready nếu dữ liệu không thay đổi). Mỗi quyết định tăng version và lưu lịch sử trong bản nháp.
7. Tenant xác nhận **đúng version đã được Owner duyệt** qua `POST .../tenant-confirmation`. Backend kiểm chứng đọc/chụp/đồ vật và quyền lần cuối rồi khóa snapshot `ContractHandover` ở `Confirmed`, đóng task bàn giao, render **PDF final bất biến** với ảnh phòng, ảnh tài sản, ảnh công tơ điện/nước đầu kỳ và lịch sử yêu cầu sửa/duyệt. ID tài khoản Tenant xác nhận (`actorId`), thời điểm và ghi chú tùy chọn được lưu trong `TenantFeedback` của snapshot. PDF lưu private với content hash/length; Tenant và Owner xem/tải qua endpoint tài liệu đã có. Hiện xác nhận bằng thao tác trong app; phần chữ ký điện tử để tích hợp sau, **không hiển thị như chữ ký số hợp lệ**.

## Mẫu biên bản và nguồn dữ liệu

| Mục trong PDF | Nguồn dữ liệu |
| --- | --- |
| Cơ sở, địa chỉ, phòng | Contract → Room → Location |
| Thời hạn, tiền thuê, cọc, điều khoản | Snapshot/thông tin hợp đồng đã lưu |
| Chỉ số điện/nước khởi tạo | MeterReading của task `Initial` *đúng Contract*, ảnh/hashes đã xác nhận |
| Nhóm tài sản, số dự kiến/số thực giao, tình trạng và ghi chú | RoomInventoryReview + Staff inspection theo group ID/physical ID, không đoán từ tên |
| Tình trạng phòng, chìa khóa/thẻ, ảnh kèm theo | Staff cập nhật Draft, evidence private |
| Checklist tường/trần/sàn; cửa/khóa; điện/đèn/ổ cắm; nước/thoát nước; nhà vệ sinh; vệ sinh; thiết bị an toàn | `roomChecks[]` với `code`, `status=Passed/Issue/NotApplicable`, `notes`, `evidenceIds`; không suy đoán từ ô ghi chú chung |
| Chìa khóa, thẻ, remote và quyền ra vào điện tử đã giao | `accessItems[]` gồm `type`, `quantity`, `notes` |
| Phát hiện bất thường | `roomChecks[]` status `Issue` + mô tả/ảnh thật từ Staff. Owner quyết định ngoại lệ qua `reason` và `handlingPlan` khi Ready; trường `outstandingIssues` cũ chỉ giữ để đọc biên bản lịch sử |
| Chủ thể xác nhận, thời điểm, ngoại lệ, yêu cầu sửa | Owner/Tenant actor + version/audit events |
| Chữ ký | **Chưa triển khai**; không giả lập chữ ký số |

## API

Tất cả đường dẫn dưới `/api/v1/contracts/{id}/`. GET có Bearer và object scope; POST JSON cần `Idempotency-Key: <uuid>` đúng chuẩn hợp đồng. Sai role 403, ngoài scope 404, stale version/điều kiện 409, input sai 400, ảnh >5 MB 413.

| Method | Đường dẫn | Vai trò / chức năng |
| --- | --- | --- |
| GET | `handover/draft` | Owner/Staff/Tenant được phép: DTO snapshot, `status`, `version`, `missing[]`, `requests[]`, `moveInTask?: {id,status,version,canInspect}`. `canInspect=true` chỉ khi Staff đang được giao đã bắt đầu nhiệm vụ |
| GET | `handover/draft/pdf` | Bản PDF **nháp**, xem/tải authenticated |
| POST | `handover/draft` | Staff chỉ khi `moveInTask.canInspect`: `{version,roomCondition?,keysAndAccess?,notes?,assets?,evidenceIds?,inventoryToken?,roomChecks?,accessItems?}`. `roomChecks` merge theo code, `accessItems` thay cả danh sách; `outstandingIssues:[]` từ client cũ chỉ xóa dữ liệu đề xuất cũ, gửi phần tử mới bị từ chối `staff_repair_decision_forbidden` |
| POST | `handover/draft/evidence` | Staff chỉ khi `moveInTask.canInspect`: raw PNG/JPEG, tối đa 5 MB; trả `{id}` |
| POST | `/api/v1/operational-tasks/{moveInTask.id}/start` | Staff đã được giao: `{version:moveInTask.version}` + Idempotency-Key. Phải bắt đầu trước kiểm kê/tải ảnh; không thay phiên bản Draft |
| GET | `handover/draft/evidence/{fileId}` | Xem ảnh đã gắn vào đúng Draft, kiểm file, scope và hash |
| POST | `handover/draft/ready` | Owner: `{version,reason?,handlingPlan?}`; hai trường sau bắt buộc nếu có ngoại lệ |
| POST | `handover/draft/requests` | Tenant: `{version,reason}` |
| POST | `handover/draft/requests/{requestId}/decision` | Owner: `{version,accepted,reason}` |
| POST | `handover/draft/tenant-confirmation` | Tenant: `{version,note?}`; lưu final PDF đúng phiên bản |
| GET | `handover/documents` | Bản final `kind=MoveInReport` trong các tài liệu hợp đồng |
| GET | `handover/documents/{documentId}` | PDF bất biến, kiểm quyền + hash/length (giữ endpoint hiện có) |

Ví dụ Staff lưu tiến độ từng mục:

```json
{
  "version": 3,
  "roomCondition": "Tường và sàn đã kiểm tra, cửa hoạt động tốt",
  "keysAndAccess": "2 chìa khóa phòng, 1 thẻ cổng",
  "assets": [{"id": "<group-uuid>", "condition": "Tốt", "checked": true,
    "observedQuantity": 2, "handedOverQuantity": 2,
    "goodQuantity": 2, "wornQuantity": 0, "damagedQuantity": 0,
    "missingQuantity": 0, "notes": "Đã đối chiếu thực tế", "evidenceIds": []}],
  "inventoryToken": "<token-from-GET>",
  "roomChecks": [{"code":"walls_ceiling_floor","status":"Passed","notes":"Không ghi nhận nứt/vỡ","evidenceIds":[]}],
  "accessItems": [{"type":"RoomKey","quantity":2,"notes":"Đã kiểm đếm"}]
}
```

Các `version`/UUID/token ở đây chỉ mang tính minh họa; lấy từ API thật. Không có đường dẫn storage công khai. API đọc ảnh công tơ vẫn theo quyền của Contract và reading đã xác minh; không sử dụng ảnh của hợp đồng khác. Những endpoint legacy `handover`, `handover/owner-review`, `handover/staff-confirmation`, move-out và gia hạn vẫn giữ để tương thích dữ liệu cũ. Hợp đồng **đã có** `handover.preparation` không thể ghi/chốt bằng legacy POST để bỏ qua duyệt Owner; hợp đồng lịch sử **đã có** `ContractHandover` theo legacy workflow trả 404 tại GET draft để client quay lại màn bàn giao cũ, không tạo biên bản song song.

7 code checklist bắt buộc: `walls_ceiling_floor`, `doors_windows_locks`, `electrical_lighting_outlets`, `water_plumbing_drainage`, `bathroom_toilet`, `cleanliness`, `safety_equipment`. `Issue` phải có mô tả và ít nhất một ảnh bằng chứng gắn riêng với mục đó; `NotApplicable` phải có lý do. Staff không nhập trường sửa chữa hoặc hạn xử lý; Owner chịu trách nhiệm quyết định. Biên bản legacy cũ có thể giữ `OutstandingIssues` trong snapshot lịch sử; bản nháp mới không cho Staff thêm. Ảnh giả lập chỉ phục vụ **hợp đồng demo trên Mobile Web development localhost**, nhãn rõ là ảnh TEST, không dùng thay bằng chứng của phòng thật hay chữ ký.

## Trạng thái phòng, giới hạn còn cần thống nhất

**Quy tắc hiện có**: Main Contract được Backend kích hoạt sau xác minh ký/thanh toán theo chính sách, khi đó `RoomStatus` chuyển sang `Occupied` trong `ContractService.ActivateAsync`. Tính năng mới **không can thiệp quy tắc này** và chỉ đánh dấu bàn giao vật lý hoàn tất khi `HandoverDraft.Status == Confirmed`; vì vậy có thể tồn tại `RoomStatus=Occupied` nhưng bàn giao vẫn `Draft/Ready`.

Muốn đổi `RoomStatus` thành `Occupied` **chỉ sau khi Tenant xác nhận**, cần một quyết định nghiệp vụ riêng về trạng thái giữ chỗ ở giai đoạn Active nhưng chưa nhận phòng, tác động tới availability, tính tiền/hoá đơn, tenancy nhiều người và quy tắc chuyển trạng thái. Không tự áp dụng thay đổi này khi yêu cầu không sửa luồng hợp đồng/thanh toán của người khác.

## Kiểm thử và vận hành

Phần Backend có các integration trên PostgreSQL 16 **disposable** (`Compact24MoveInDraftTests`): tạo Main→Draft & tác vụ theo contract, không cho Staff lưu/ảnh trước `start`, bắt đầu thật qua Task API với phân quyền, version, Staff lưu nhóm kiểm kê từng phần, Owner xử lý ngoại lệ (không cần Staff đề xuất sửa), Tenant request/decision, PDF final/ảnh và rollback khi thiếu điều kiện. Chạy trong CI qua `BHOME_COMPACT24_TEST_ADMIN` của service PostgreSQL tạm; không chạy trên Neon Development/Production.

Sau merge cần restart Backend để nạp API mới. Không có auto-migrate hay auto-finalize các hợp đồng đang Active; các hồ sơ lịch sử có thể xuất hiện bản nháp version 0 khi GET, và chỉ ghi state khi Staff thực hiện lần đầu.
