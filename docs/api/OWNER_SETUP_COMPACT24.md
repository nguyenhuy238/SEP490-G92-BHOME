# Current configuration integration — 2026-11-09

Owner Web API mode now connects native Location/Room/physical Asset management,
local desired inventory, private verification evidence, asset metadata/history,
advanced utilities, operating policies and contract policy amendments. Confirmed
server responses determine persistence success; stale versions retain forms for review.
The global library and Location configuration copy are separate, approved capabilities:
see [Shared configuration](SHARED_CONFIGURATION.md), [runtime status](API_IMPLEMENTATION_STATUS.md)
and [executed validation](../development/CONFIGURATION_VALIDATION_2026-11-09.md).
Compact24 remains 24 physical tables; no migration or legacy operational RoomType
was added. Previous sections retain their dated scope/history where marked.

# Owner setup — API bổ sung P0–P2

## Policy history correction — 2026-11-09 (GAP-001)

`GET /api/v1/operating-policies/{id}/versions` returns persisted revisions of
that document ID in ascending `version` order. It does not list unrelated policies
in the same Location and does not infer a global policy family. Revision entries
retain the existing SetupDocument shape and include `recordedAt` and `recordedBy`
where available. Owner sees Draft and Published revisions. Assigned Staff can
query a currently Published policy and receives Published revisions only; Draft
history and other Locations remain hidden. Tenant uses its own Contract's
`agreed-operating-policy` endpoint. Signed-contract snapshots are unchanged.

## Owner Web native configuration — 2026-11-09 (GAP-004, property slice)

API mode now uses native paginated Location, Room and physical Asset APIs instead
of the prototype repository. Create/update requests carry current DTOs and loaded
versions. Owner actions are hidden for other roles; server authorization remains
authoritative. Rejected mutations retain the edit form and do not show success.
Location deactivation requires confirmation and the existing server obligation
checks. Location workspaces read their own server Location, preserve nested
Room/Asset/finance routes, and show real policy/Room-history reads. Pricing is
bound to the route Location. Demo mode continues through the existing explicit
mock path. Shared-library apply/copy is addressed in the separately approved
Shared Configuration phases, not by these native CRUD endpoints.

## Asset and policy UI integration — 2026-11-09 (GAP-004)

Location Assets now supports local template Draft item editing, clone, immutable
publish, per-Room sync outcomes, assignment and physical inventory verification
with private image upload. Inventory responses add `assignmentVersion` and
`assignedTemplateId`, allowing safe assignment after reload. Desired-inventory
`version`, assignment version and physical asset version are distinct. Verification
retries retain an already uploaded evidence key after an uncertain response.
Physical asset history, purchase metadata and confirmed replacement use the
existing server workflows; template publication never creates verified assets.

Location Rules supports Draft create/edit, publish and persisted document history.
The Contract detail panel reads the agreed snapshot and prepares a signed-policy
amendment using a retained UUID command key. It opens the resulting Contract for
the existing signing and Owner activation controls, without automatically signing,
activating or overwriting the parent agreement. Applied Addenda cannot be cancelled
through the proposal UI. Server permission/scope/state guards remain authoritative.

Ngày: 08/11/2026. Tài liệu mô tả implementation trong worktree; chưa phải biên bản nghiệm thu hay triển khai production. Base path: `/api/v1`. Schema runtime vẫn là Compact24, Location → Room; không Chain/RoomType.

## Quy tắc chung

- Owner cấu hình và quyết định; Staff chỉ thao tác vận hành tại Location đang được phân công. Tenant chỉ đọc nội quy đã thỏa thuận của chính hợp đồng mình. API kiểm tra scope trên server.
- `SetupDocument` trả `id`, `locationId`, `kind`, `status`, `version`, `data`, `recordedAt`. Các request có `expectedVersion` phải gửi đúng phiên bản đang đọc; tạo mới dùng 0. Conflict trả 409, validation 400, chưa đăng nhập 401, sai quyền/scope 403 hoặc 404 theo workflow hiện hữu.
- Các API yêu cầu `Idempotency-Key` dùng UUID. Gửi lại cùng key phải giữ nguyên nội dung. Không dùng key khác để cố ghi lặp một nghiệp vụ đã tồn tại.
- JSON utility phải gửi rõ `utilityType`, các giá trị tiền/sản lượng và các cờ bắt buộc trong DTO; không dựa vào giá trị mặc định khi bỏ field. Xem schema Swagger và `SetupWorkspaceContracts.cs` để lấy đầy đủ field/enum.
- Evidence được upload bằng raw body `image/jpeg` hoặc `image/png`, tối đa 5 MB, qua `POST /locations/{locationId}/setup-evidence`; response trả `objectKey`. Đọc riêng tư qua `GET /locations/{locationId}/setup-evidence/{id}`. Không nhận URL công khai hoặc key tự đặt làm bằng chứng. Không dùng API này lưu ảnh CCCD. Chưa nhận supplier PDF ở luồng này.

## P0 — Holding và nguồn cọc

Giữ các API Holding/payment/signing/activation/conversion đang có, không tạo API cọc song song.

1. Nhiều Draft chưa ký/chưa cọc được phép cùng Room. Khi một hồ sơ có cam kết ký đang được xử lý hoặc đã nhận cọc hợp lệ, backend chặn hồ sơ cạnh tranh trên **cả phòng**, kể cả trước khi gửi yêu cầu ký ra provider.
2. Theo quyết định người dùng ngày 08/11: chỉ **đủ chữ ký Owner/Tenant và đủ cọc đã xác minh** mới khóa approved price snapshot. Trigger ghi `SigningAndDepositCompleted`. Nộp một phần hoặc chỉ ký chưa khóa giá, chưa tạo Holding Active.
3. Owner vẫn gọi activation hiện hữu để hình thành Holding Active và đưa Room sang OnHold. Tiền do frontend báo thành công không đủ điều kiện kích hoạt.
4. Manual verification và bank allocation dùng cùng canonical ledger. Không cộng lại khoản cọc đã chuyển sang Main. Generic tạo Main từ Holding dùng cùng kiểm tra như conversion, không được sửa lén giá/đối tượng/điều khoản nguồn.
5. Expiry xử lý cả Draft/Pending/Active, giữ bằng chứng. Hủy/hết hạn có tiền được giữ chờ Owner xử lý, không tự hoàn/khấu trừ. Tiền đến muộn hoặc gặp hồ sơ không hợp lệ chuyển review bền vững.

## P1 — Location, Staff và an toàn

| Method/path                                | Tác dụng                                                                                                 |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `GET /locations/{id}/closure-check`        | Owner xem các nhóm nghĩa vụ đang chặn đóng Location; chỉ số lượng, không lộ PII                          |
| `GET /locations/{id}/staff-change-preview` | Owner xem trách nhiệm đang mở trước thay/gỡ Staff                                                        |
| PUT/DELETE assignment hiện hữu             | Chuyển GENERAL, METER_READ, WorkOrder và inspection đang mở trong transaction; lưu lịch sử/thông báo     |
| PUT Location hiện hữu                      | Chặn đóng khi còn nghĩa vụ thực tế; Resident lịch sử đã kết thúc không bị xóa và không tự chặn vĩnh viễn |
| Readiness và activation hiện hữu           | Dùng nguồn sự cố Emergency đang mở/Asset hỏng để đánh giá và chặn chuyển trạng thái bắt buộc             |

Gỡ Staff mà còn WorkOrder/inspection đặc biệt chưa hoàn tất bị từ chối, cần thay người chịu trách nhiệm. Không thêm Staff tự chuyển việc, phân ca hoặc quyền quyết định tài chính.

## P2 — Tài sản

| Method/path                                                             | Quyền và tác dụng                                                                             |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `GET /asset-templates?locationId=…`, `GET /asset-templates/{id}`        | Owner đọc bộ mẫu                                                                              |
| `POST /asset-templates`, `PUT /asset-templates/{id}/draft`              | Owner tạo/sửa Draft: `locationId,name,items,expectedVersion`                                  |
| `POST /asset-templates/{id}/drafts`                                     | Owner clone bản thành Draft mới, giữ stable item ID                                           |
| `POST /asset-templates/{id}/publish`                                    | Owner publish với `expectedVersion`; bản publish bất biến; trả sync run                       |
| `POST /asset-templates/{id}/sync`, `GET /asset-template-sync-runs/{id}` | Owner chạy lại/xem kết quả từng Room                                                          |
| `PUT /rooms/{id}/asset-template`                                        | Owner gán `templateId`; null trở lại bộ mẫu mặc định Location; có `expectedVersion`           |
| `GET /rooms/{id}/asset-inventory` hoặc `/desired-assets`                | Owner/Staff đúng Location xem physical, desired, phiên bản hiện hành và discrepancy           |
| `POST /rooms/{id}/assets/verify`                                        | Owner/Staff xác nhận vật lý bằng evidence; trả `assetId`; có kiểm soát retry/số lượng/version |
| `GET /assets/{id}/history`                                              | Owner/Staff xem lịch sử tài sản theo scope                                                    |
| `GET/PUT /assets/{id}/metadata`                                         | Owner xem/sửa tracking, quantity, purchase cost/date, useful life và reason/version           |
| `POST /assets/{id}/replace`                                             | Owner thay tài sản có reason/version; giữ bản cũ và liên kết lịch sử                          |

Item có `id,name,category,trackingMode,quantity`; tracking là `Serialized` hoặc `BulkQuantity`. Verify nhận `templateId,itemId,code,quantity,condition,evidenceObjectKey,expectedVersion` (phiên bản desired), và `existingAssetId` tùy chọn để liên kết tài sản đã có thay vì tạo trùng. Serialized kiểm kê từng mã, quantity 1. `condition` là mô tả tình trạng; trạng thái Asset vẫn theo enum/domain hiện hữu.

Publish/sync chỉ tạo **desired inventory** cho Room Available đủ điều kiện. Không tự mua/lắp hoặc xác nhận tài sản thật. Room đang có người/cam kết/sự cố được bỏ qua và xem lại khi đủ điều kiện. Item bị bỏ khỏi bộ mẫu tạo cảnh báo review, không tự xóa/retire physical asset. Retire vẫn qua PUT Asset hiện hữu; transfer, copy Location, khấu hao không thuộc gói này. Staff không nhận purchase cost trong inventory.

Tự sync dùng job `asset-template-sync` khi Jobs bật. Khi Jobs tắt, có thể bật riêng `OwnerSetup:AssetSyncEnabled=true`; worker này chỉ đồng bộ desired inventory, không bật job tài chính. Development đã bật cờ này; môi trường khác cần cấu hình rõ.

## P2 — Điện nước nâng cao

Các API sau dành cho Owner, riêng source reading cho Owner/Staff đúng Location.

| Method/path                                                          | Tác dụng                                                                                                      |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `GET/POST /utility-tariffs`, `GET /utility-tariffs/{id}`             | Biểu giá theo Location/type/effective dates, supplier/classification/source, tiers, rounding, verified        |
| `POST /utility-tariffs/{id}/replacement`                             | Thêm phiên bản biểu giá có hiệu lực mới, giữ nguồn cũ                                                         |
| `GET/POST /utility-source-meters`                                    | Công tơ tổng/khu chung; không giả làm Room meter                                                              |
| `POST /utility-meter-links`                                          | Liên kết Room meter hiện hữu vào công tơ tổng đúng scope/type/thời hạn                                        |
| `POST /utility-source-readings`                                      | Ghi chỉ số đầu/cuối, tháng, evidence, `humanConfirmed=true`                                                   |
| `GET/POST /utility-quotas`                                           | Định mức miễn phí Room/type/tháng, nguồn xác minh/version                                                     |
| `GET/POST /utility-profiles`                                         | Room áp tariff theo thời gian; gửi rõ `requireQuota,requireReconciliation`                                    |
| `POST /utility-profiles/{id}/replacement`                            | Thay profile từ ngày mới, `expectedVersion` của bản nguồn; lịch sử không bị sửa                               |
| `GET/POST /utility-source-bills`, `GET /utility-source-bills/{id}`   | Hóa đơn đầu vào tháng/source meter, sản lượng, số tiền VND, reference/evidence; POST cần UUID key             |
| `POST /utility-reconciliations/preview`                              | Tính chênh lệch source − room − common, không ghi dữ liệu                                                     |
| `POST /utility-reconciliations`, `GET /utility-reconciliations/{id}` | Lưu/đọc đối soát với tolerance do Owner chỉ định và input hash                                                |
| `POST /utility-reconciliations/{id}/review`                          | Owner chấp nhận chênh lệch có reason/version; không tự thu thêm/hoàn tiền                                     |
| `POST /utility-period-breakdowns`                                    | Xác nhận phân đoạn kỳ khi thay tariff/profile giữa tháng, có bằng chứng và tổng lượng khớp chỉ số đã xác nhận |

GET list nhận `locationId`. Tháng gửi ngày đầu tháng. Tiers dùng `through` tăng dần, bậc cuối `through:null`; `rate` do Owner nhập, không có biểu giá pháp lý hardcode. `rounding` theo enum VndRounding. Verified là xác nhận nghiệp vụ của Owner, không phải backend chứng nhận pháp lý của nhà cung cấp. Giới hạn kỹ thuật: tối đa 50 bậc, rate/sản lượng ≤ 1 tỷ; source bill VND nguyên không âm < 10^18.

InvoiceService dùng profile này nếu có; Room chưa có profile giữ cách tính BillingPolicy hiện hữu. Thiếu tariff/quota/reconciliation bắt buộc hoặc phân đoạn có bằng chứng thì Draft còn missing inputs và Finalize bị chặn. Input đổi sau đối soát phải xác nhận lại. Không ước lượng lượng dùng chính thức hoặc tự chia chênh lệch cho Tenant.

Line invoice trả `utilityCalculationSnapshot`: lượng, bậc giá và tham chiếu phiên bản của chính Room, không chứa tài chính tổng Location hoặc evidence của người khác. `amount` là số tiền authoritative; `rate` cũ vẫn để tương thích BillingPolicy, client không tính lại advanced amount bằng `rate * quantity`. Finalized snapshot được giữ nguyên; sửa sau final vẫn theo workflow InvoiceAdjustment.

## P2 — Nội quy có phiên bản và phụ lục

| Method/path                                                                                                     | Quyền và tác dụng                                                                   |
| --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `GET /operating-policies?locationId=…`, `GET /operating-policies/{id}`, `GET /operating-policies/{id}/versions` | Owner đọc; Staff đúng Location chỉ đọc bản đã publish                               |
| `POST /operating-policies`, `PUT /operating-policies/{id}/draft`                                                | Owner tạo/sửa Draft: location/title/content/effectiveFrom/version                   |
| `POST /operating-policies/{id}/publish`                                                                         | Owner publish với expectedVersion, lưu phiên bản bất biến và thông báo              |
| `GET /contracts/{id}/agreed-operating-policy`                                                                   | Đọc nội quy đã thỏa thuận theo quyền Contract; Tenant chỉ hợp đồng mình             |
| `POST /contracts/{id}/operating-policy-amendments`                                                              | Owner tạo Addendum: policyId/effectiveFrom/reason, UUID key; trả contractId phụ lục |
| `POST /contracts/{id}/operating-policy-amendment-cancellation`                                                  | ID là phụ lục; Owner hủy bản chưa Applied với reason và UUID key                    |

Draft Main/Renewal bind policy đang hiệu lực vào đúng nội dung và hash đem ký. Publish V2 không đổi điều khoản V1 đã ký. Hợp đồng cũ không có bằng chứng binding trả NotRecorded, không tự coi Tenant đã đồng ý.

Phụ lục dùng quy trình provider ký và activation hiện hữu của Contract: đủ chữ ký hợp lệ, đúng ngày và Owner activation mới chuyển `Applied` (enum status 9; kind Addendum 3). Bằng chứng bản ký phải khớp nội dung/hash. Phụ lục không đổi rent/deposit/Room occupancy; Parent snapshot giữ nguyên và agreed-policy đọc kết quả phụ lục có hiệu lực. Bản PDF được ghi rõ là phụ lục nội quy. Thông báo không thay thế chữ ký. Chưa kiểm thử provider thật trong lượt triển khai này.

## Lưu trữ và giới hạn

Không thêm bảng/migration/dependency. Tài sản, hợp đồng, chỉ số, hóa đơn và tiền vẫn dùng record native; tài liệu setup versioned dùng JSON/history trong operational_tasks SYSTEM_JOB sẵn có. Khóa Location trong transaction, version check, stable key và audit/history bảo vệ replay và race. Đây là lựa chọn tương thích Compact24; JSON documents cần được tính vào bảo trì/query/index nếu dữ liệu tăng lớn.

Chi tiết kiểm thử và traceability: [báo cáo triển khai](../development/OWNER_SETUP_DELIVERY_2026-11-08.md). Frontend integration, provider thật, load/performance và nghiệm thu người dùng vẫn cần thực hiện trước production.

# Utility workspace integration — 2026-11-09

The Owner Web Location utility workspace now uses the persisted tariff, profile,
quota, source meter/reading, supplier bill, reconciliation and period-breakdown APIs.
GET `/api/utility-meter-links`, `/api/utility-reconciliations`,
`/api/utility-period-breakdowns` and `/api/utility-source-readings` accept `locationId`.
The first three are Owner-only. Source readings also permit currently assigned Staff.
Tenant access is rejected. Existing object and Location permission checks apply.

Setup document data serializes fractional decimals and integers outside JavaScript's
exact integer range as strings. Small integer counts remain numbers. Callers must
preserve monetary/quantity strings rather than converting them through `Number`.
Reconciliation preview quantities are strings; preview does not persist a review.
Variance approval recalculates the input hash and rejects changed inputs until the
Owner saves a fresh reconciliation. Upload evidence remains private and confirmed
source readings remain separate from OCR proposals.
