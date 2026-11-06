# Contract UI — bổ sung API D011/D012

## Main Draft → tài liệu xem xét → ký (05/11/2026)

UC-15 / GBR-04 / DBR-03. Bổ sung vào controller Main Draft hiện hữu:

- `POST /api/v1/contracts/main-drafts/{id}/signing-review`: Owner hoặc Staff đang được phân công Location, trả `ContractDocumentView` với `kind=SigningReview`. Tái sử dụng file của snapshot hiện tại. PDF được chuyển đổi từ mẫu DOCX hiện hữu và lưu private, có hash/length. Mẫu hiện tại chỉ được phép Development/Testing và có nhãn tài liệu kiểm thử; Production trả 503 `main_draft_signing_template_not_approved`.
- `GET .../{id}/documents/{fileId}`: dùng endpoint download hiện hữu, kiểm quyền/snapshot/hash trước khi trả bytes. Tài liệu phiên bản cũ trả 409.
- `POST .../{id}/release`: chỉ Owner signer; bắt buộc `Idempotency-Key` UUID. Body `{ tenantUserId, expectedVersion, reviewedFileId, humanReviewed: true }`; trả `{ id }`. Kiểm tra bản nháp, cấu hình/giá hiện hành, tài khoản Tenant hoạt động, liên kết Resident, room conflict và đúng file đã xem xét. Không đổi signing mode đã ghi lúc tạo Draft. Lặp cùng key/payload trả cùng kết quả; khác payload trả 409.

Release ghi `PendingSigning`, liên kết Tenant đại diện và seal snapshot; giữ encrypted draft metadata và evidence cũ. Tạo Preview bất biến bằng đúng bytes/hash PDF đã xem xét, với object key riêng. `onboardingDraft` trong list/detail chỉ true khi vẫn là Draft; Owner Web chuyển sang workflow ký hiện hữu. Tenant dùng preview/private-download/signing/sync hiện hữu; cả adapter simulation và MySign lấy canonical PDF này thay vì dựng lại mẫu khác. Chưa ký/chưa cọc thì không tự Active hoặc Occupied.

Owner Web yêu cầu lưu hết thay đổi, chọn tài khoản, tải PDF và xác nhận xem xét trước release. Bản simulation luôn hiển thị nhãn thử nghiệm. Nghiệm thu nhà cung cấp thật vẫn BLOCKED vì chưa có MySign staging và mẫu production được duyệt. Các kiểm thử converter/MinIO cục bộ không thay thế nghiệm thu staging.

Kiểm chứng 06/11: `BHome.ContractVerification --finance --main-draft` dùng API thật, Compact24/MinIO tạm, Owner Web build thật và Staff/Tenant Mobile transport thật. Đạt review/release từ danh sách, bytes PDF giống nhau, scope âm, ký simulation/cọc tổng hợp/Owner activation. UI sau release chuyển khỏi editor; native device và MySign staging chưa nghiệm thu. Bằng chứng chi tiết ở [báo cáo triển khai](../development/NGUYEN_QUOC_HUY_E2E_IMPLEMENTATION.md).

UC-17 regression tiếp theo: evidence/meter baseline → Staff record → Tenant dispute/correction → same-version Tenant/Staff confirmation → Owner Web monitor/download đã đạt qua API/Compact24/MinIO thật. Shared hook không giữ record từ context cũ; Mobile consent gắn Contract/version và reset khi server trả version mới. Không đổi endpoint/DTO; native camera/device vẫn chưa chạy.

Truy vết: BF-03B/BF-04A, FE-03, UC-15/16/19, GBR-01/02/04/18, DBR-02/03.
Các mutation, state, idempotency và giới hạn provider/ledger giữ theo
[bàn giao backend](../development/CONTRACT_LIFECYCLE_DELIVERY.md).

## Danh sách phục vụ web/mobile

`GET /api/v1/contracts?page=1&pageSize=20&locationId={uuid}&status=Draft`

- Bearer; Owner/Staff/Tenant. Anonymous 401, sai vai trò 403.
- `page` >= 1, `pageSize` 1..100; `locationId` và `status` tùy chọn. Sai phân trang/trạng thái/UUID: 400.
- Lọc phạm vi trước count/page: Owner toàn hệ thống; Staff chỉ assignment có hiệu lực tại
  ngày Việt Nam; Tenant chỉ `TenantUserId` của mình. ID Location ngoài phạm vi trả trang rỗng.
  Tài khoản nhiều vai trò có hợp các phạm vi được server cho phép.
- Thứ tự `startDate DESC, id ASC`; `Cache-Control: no-store`.
- Trả `{ items, page, pageSize, totalCount }`; item chỉ gồm `id`, `roomId`, `locationId`,
  `locationName`, `roomNumber`, `kind`, `status`, `startDate`, `endDate`, `monthlyRent`.
  Tiền là chuỗi số nguyên VND. Không trả CCCD, tài khoản Tenant, object key hoặc toàn bộ điều khoản.

## Metadata tương thích ngược

- `GET /api/v1/contracts/{id}` bổ sung `locationId` từ Room được server truy vấn.
- `GET /api/v1/capture/meter-tasks` bổ sung `contractId` và `confirmedReadingId` nullable,
  giữ nguyên scope Owner/Staff và giới hạn 100 tác vụ hiện có. UI Staff dùng để chọn reading
  Final (`purpose=2`) đúng hợp đồng, loại đồng hồ và ngày kiểm tra; backend kiểm tra lại tất cả.
  Tenant không được gọi API capture.
- UI Owner dùng API capture hiện có để tạo Final task, không tạo reading giả. Sau khi Staff
  chụp ảnh và xác nhận, reading ID được dùng trong inspection.

## Client

Mọi Contract mutation dùng `Idempotency-Key` UUID, kể cả request không có body; giữ lại key
cho cùng payload sau lỗi chưa rõ kết quả. Không tự retry lỗi mạng/409/503. Chỉ refresh token
và gửi lại một lần sau 401 theo transport hiện có. Sync ký là thao tác do người dùng yêu cầu.
Tải PDF/ảnh qua bearer, không đưa token vào URL; không có URL công khai cho file riêng tư.
Ngày date-only giữ nguyên ISO trên wire; giờ lịch nhập ở Việt Nam được đổi UTC.

## Chứng thư và bộ ký PDF — cập nhật 30/10/2026

- API chứng thư hiện có: `GET /api/v1/digital-signing/certificates`, `POST` cùng đường dẫn
  với `{ providerUserId, serialNumber? }`, `POST /api/v1/digital-signing/certificates/{id}/lock`
  với `{ locked: true|false }`. Không thêm endpoint ở lượt này.
- Chỉ Owner/Tenant đã đăng nhập; Staff 403. GET chỉ trả chứng thư của actor; khóa/mở khóa
  chứng thư người khác trả 404. Mutation được ghi `ContractCertificateLocked`/`Unlocked`
  vào SecurityAudit. Khóa áp dụng cho yêu cầu ký mới, không thu hồi chữ ký đã có hoặc hủy
  giao dịch đang chờ tại nhà cung cấp.
- Khóa/mở khóa là gán trạng thái đích, không phải toggle; lặp cùng body không đảo trạng thái.
  Client tải lại danh sách sau mutation, kể cả lỗi không xác định kết quả. Không tự gửi lại ký.
- Web/mobile hiển thị chứng thư, trạng thái và hạn dùng; chỉ cho chọn chứng thư server đánh dấu
  `usable`, không khóa và đang trong `[validFrom, validTo)`. Server vẫn kiểm tra lại trước ký.
- Backend chính đã đăng ký iText qua `AddContractPdfSigning()`, chỉ dùng bộ ký PDF,
  không đăng ký DbContext/controller/settings của sandbox. Chữ ký thứ hai là incremental revision.
- Đã có concrete renderer dùng snapshot sealed và mẫu Development/Testing có phiên bản; chưa có mẫu production được duyệt.
  Mặc định chưa chọn template vẫn trả 503 với code `contract_template_not_configured`.
  Chọn mẫu thử ngoài Development/Testing trả 503 `contract_template_not_approved`, kể cả khi tiếp tục ký PDF của bên thứ nhất.
  Cấu hình, dữ liệu PDF và kết quả kiểm chứng: [BH-16 PDF renderer](../development/BH16_CONTRACT_PDF_RENDERER.md).
  Client giải thích lỗi bằng tiếng Việt; không suy diễn thành Signed hoặc Active.
  `signing_certificate_not_valid` và `signing_certificate_no_longer_available` có thông báo riêng.
- Quyết định và giới hạn: [DIGITAL_SIGNING_COMPLETION.md](../development/DIGITAL_SIGNING_COMPLETION.md).

# BH-40 — Contract lifecycle

Tái sử dụng `/api/v1/contracts/{id}` renewal/signing/activation, termination-requests,
expiry-move-out, move-out/approve/schedule/inspection/settlement/complete hiện có.
Mutation JSON cần Idempotency-Key GUID. Auth ở service, object scope lấy từ DB.

- GET `{id}/versions`: Owner/Tenant sở hữu, Staff assigned; cùng chain previous/next;
  Staff chỉ dates/status, không rent/terms. Renewal chỉ Active khi ngày hiệu lực và đủ ký/cọc.
- POST `{id}/move-out/schedule`: Owner hoặc Staff assigned, `{scheduledAt UTC,staffUserId?,
expectedVersion?}`. Staff không chỉ định người ngoài assignment Location. Owner để trống
  assignee sẽ hiển thị chưa phân công; không tự chọn một người. Không đóng Contract.
- GET `move-out-assignments`: Staff, tối đa 100 lịch được giao trong Locations hiện có quyền.
- GET `{id}/move-out/history`: Owner/Tenant của Contract hoặc Staff assigned; append-only.
  MoveOut response bổ sung inspectionStaffId/version. Version 1 request, tăng khi approve/schedule.
  Không thêm reject/cancel termination. Không dùng tenancy của người khác để mở evidence.

GET `{id}/move-out/inspection-preparation`: Owner/Staff lấy confirmed handover snapshot của
Contract hoặc ancestor renewal và danh sách confirmed Final readings hôm nay đúng Contract.
InspectionInput thêm assets `{id,condition}[]`, roomCondition, keysAndAccess, expectedVersion.
Snapshot baseline không lấy Asset condition hiện tại. Legacy inspection thiếu baseline giữ
blocker; không thể resolve production settlement. Final reading là observation của Contract,
không reset baseline hoặc tự tạo phí cho cả phòng khi co-Tenants vẫn ở.
GET `{id}/move-out/inspections`: so sánh baseline/observed và Owner review, scoped như Contract.
POST `{id}/move-out/inspection-review`: Owner `{version,confirmed,reason}`; confirmed=false
yêu cầu reinspection, giữ lần cũ. Mỗi version chỉ một review, không ghi đè snapshot/ảnh.

GET `{id}/move-out/settlement-summary`: Owner/Tenant của Contract, Staff 403. Cọc lấy từ
root Contract của renewal chain, không cộng lại từng phiên bản; shared invoices là context,
không liability cá nhân. Summary trả source financials BH-41, unresolvedItems, reference hash,
resolved, nullable deductions/refund/final charges. Owner inspection review có thêm
noAdditionalCharges để xác nhận không có khoản inspection riêng cần tính; nếu chưa xác nhận
giữ Pending, không tự tính damage fee. Kỳ chưa Final, usage chưa billed, pending disputes,
bank review, excess, deposit/holding chưa giải quyết đều chặn resolved.
POST settlement bổ sung expectedReference (bắt buộc khi resolved) chống xác nhận snapshot cũ.
History lưu FinancialSnapshot bất biến và source reference, không tạo allocation/refund mới.

JOB-02: `contract-expiry` dùng BackgroundJobs hiện có, scheduler chạy lúc khởi động và mỗi
ngày theo Asia/Ho_Chi_Minh khi `Jobs:Enabled=true`. Worker bounded retry/lease hiện có;
handler re-read dưới Room lock, unique Contract/enddate/stage/recipient. Upcoming30 áp dụng
0..30 ngày trước hạn; Expired khi ngày hiện tại vượt EndDate. Không tự đóng hoặc đổi Room.
GET `expiry-reminders`: Owner xem nhắc hợp đồng hiện hành (mỗi hợp đồng một nhắc), Tenant
chỉ nhận nhắc của mình; Staff 403. Tối đa 100 nhắc mới nhất, loại hợp đồng đã kết thúc/gia hạn.
Notices được lưu để xem trong Web/Mobile; external push/email consumer vẫn chưa triển khai.
