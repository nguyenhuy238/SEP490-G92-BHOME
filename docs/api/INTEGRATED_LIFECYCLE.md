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
