# API tích hợp vòng đời

Phạm vi BF-01, BF-02, BF-03/04, BF-07 và FE-07/08 theo yêu cầu 16/11/2026.
Giữ một Owner mỗi deployment theo quyết định trong phiên. API mới trả 401/403/404,
400 cho dữ liệu không hợp lệ, 409 cho stale version hoặc transition bị từ chối.
Các route private dùng no-store. Danh sách mới nhận page/pageSize, tối đa 100.

## Location và Asset

- `GET /api/v1/locations/{location}/legal-records` dành Owner.
- `PUT .../legal-records/{id}` nhận multipart documentType, name, number, issuer,
  issuedOn, expiresOn nullable, note, status Active/Archived, expectedVersion,
  file PDF/PNG/JPEG tối đa 5 MB. File cần có ở bản đầu. ID do client giữ cho retry.
- `GET /api/v1/location-legal-records/{id}/versions` và
  `GET .../versions/{version}/file` dành Owner, giữ tệp cũ.
- `GET/PUT /api/v1/locations/{location}/asset-lifecycle-policies[/{id}]` dành Owner.
  DTO chuẩn là AssetLifecyclePolicyWrite. Draft được sửa bằng expectedVersion.
- `POST /api/v1/asset-lifecycle-policies/{id}/publish` nhận expectedVersion.
  Bản đã công bố bất biến. Phiên bản thay thế có ID mới và replacesId.
- `GET /api/v1/assets/{asset}/equipment-units` và `.../lifecycle-summary` cho
  Owner/Staff hiện được phân công. `PUT .../equipment-units/{id}` dành Owner.
  DTO chuẩn là EquipmentUnitWrite. Unit Retired giữ lịch sử và không sửa lại.
  Unsafe vẫn được tính vào số lượng tồn tại vật lý. Quantity giữ nguồn metadata cũ.
- Copy configuration hỗ trợ group `AssetLifecyclePolicies`, sao chép Published
  thành Draft độc lập. Không sao chép hồ sơ Location, serial, thiết bị và inspection.

## UC-18

Route `residence-tasks/{contract}/{resident}` và endpoint review kết quả hiện có
được giữ tương thích. Response bổ sung reference, trackingActive,
accommodationConfirmed, registrationDeadline nullable.

`POST .../accommodation-confirmation` dành Owner nhận note, expectedReference,
registrationDeadline nullable. Chỉ ghi nhận sau ngày cư trú thực tế trên hợp đồng
Active và trước ngày chuyển đi. Có thể ghi nhận trước kết quả đăng ký. Metadata
này lưu trong history của ContractResident, gắn với ngày cư trú thực tế.

Không tự tính deadline từ một chu kỳ chưa được xác minh. Owner có thể ghi nhận
hạn đã xác định. Thao tác này không chứng nhận VNeID đã xử lý thành công.
Review kết quả sau Completed là thao tác hiện có, độc lập với xác nhận chỗ ở.

Tenant status update nhận thêm expectedReference từ response. Client Web/Mobile
mới gửi token để phát hiện thay đổi đồng thời. Client cũ được giữ tương thích khi
chưa gửi token. Upload lấy reference trước đọc ảnh và đối chiếu trong transaction,
giữ file phiên bản trước để bảo toàn lịch sử. Không thêm recurring residence reminder.

## Kiểm tra thiết bị và BF-07

Owner cấu hình `GET/PUT /api/v1/assets/{asset}/inspection-schedules[/{id}]`.
Schedule chốt policy ID/version, ngày bắt đầu, chu kỳ nullable, cửa sổ hoàn thành.
Thay đổi cấu hình kỳ đã lưu yêu cầu schedule mới. Có thể vô hiệu hóa schedule.
`POST /api/v1/equipment-inspection-schedules/{id}/generate` tạo các kỳ đến hạn.
Job `equipment-inspections` dùng cùng scheduler, Location lock và ID bền vững
theo schedule/ngày. Dữ liệu thiếu unit hoặc category không phù hợp chuyển schedule
sang NeedsConfiguration. Kỳ cũ giữ snapshot và lịch sử.

- `GET /api/v1/assets/{asset}/inspections` phân trang theo phạm vi Location.
- `GET /api/v1/operational-tasks/{task}/equipment-inspection` dùng quyền task hiện có.
- `PUT /api/v1/equipment-inspections/{id}/answers` chỉ Staff đang phụ trách, nhận
  expectedVersion, answers và submit. Mỗi answer gắn unit, checklistCode, result,
  note, evidenceIds thuộc task. Kết quả thiếu giữ Incomplete và chặn submit.
- `POST .../{id}/review` chỉ Owner, nhận expectedVersion, action Verify/Rework/Cancel,
  note bắt buộc. Cancel chỉ áp dụng Draft/Submitted và đồng bộ task Cancelled.
- `POST .../{id}/remediation` chỉ Owner, chỉ kỳ Verified/Failed. Dùng proactive
  Work Order hiện có, khóa idempotency bền vững và liên kết ngược. Chi phí đi qua
  workflow bảo trì và expense hiện có.

Không đạt đánh dấu unit Unsafe ngay khi Staff ghi nhận, Quantity vẫn giữ nguyên.
Sửa metadata không được chuyển Unsafe sang InService. Kiểm tra lại được Owner
xác minh và không còn Work Order đang mở mới cho phép khôi phục sử dụng.
Các action task thông thường kiểm tra trạng thái inspection để chặn bỏ qua checklist.

## Finance và yêu cầu dữ liệu cá nhân

Owner sử dụng `GET/PUT /api/v1/finance/business-profiles[/{id}]` và
`GET/PUT /api/v1/finance/tax-obligations[/{id}]`. Hai loại đều có route
`GET .../{id}/versions`. Business profile liên kết nhiều Location. Tax obligation
chốt profile version, danh sách Location và thực thu tham chiếu tại thời điểm tạo.
Các lần cập nhật giữ snapshot, subject và kỳ. Amount dùng decimal, JSON string,
VND nguyên. PaidAmount dương cần ngày thực hiện và phiên bản chứng từ pháp lý
thuộc Location trong snapshot. Chứng từ tải bằng endpoint Owner-only của Location.
Ghi nhận thuế không tự sinh expense hay thay đổi nghĩa vụ của Tenant.

`GET /api/v1/personal-data-requests` trả queue toàn deployment cho Owner và chỉ
yêu cầu bản thân cho Staff/Tenant. `PUT .../{id}` tạo yêu cầu Access/Correction/
Restriction/Deletion với ID giữ nguyên khi retry. Owner phản hồi tại
`POST .../{userId}/{id}/decisions`, nhận expectedVersion, status, resolution, basis.
Status đóng Resolved/Rejected giữ bất biến, lịch sử quyết định được append.
Quyết định lưu phản hồi có căn cứ và thông báo in-app, không tự xóa User, Contract,
Invoice hay Payment.

`GET /api/v1/owner-attention/lifecycle` tổng hợp từ bản ghi thật, dành Owner.
Các bản ghi mới dùng container Compact24 hiện có. Không có DDL hoặc backfill mới.
