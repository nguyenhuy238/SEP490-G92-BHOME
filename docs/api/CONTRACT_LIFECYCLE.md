# Contract UI — bổ sung API D011/D012

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
- Chưa có renderer với mẫu hợp đồng được duyệt: trả 503 với code `contract_template_not_configured`.
  Client giải thích lỗi bằng tiếng Việt; không suy diễn thành Signed hoặc Active.
  `signing_certificate_not_valid` và `signing_certificate_no_longer_available` có thông báo riêng.
- Quyết định và giới hạn: [DIGITAL_SIGNING_COMPLETION.md](../development/DIGITAL_SIGNING_COMPLETION.md).
