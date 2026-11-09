# API cấu hình sau reset DB — 04/11/2026

## Mobile Setup compatibility — 2026-11-09 (GAP-002)

Mobile Setup now posts native `POST /api/v1/locations` with `name,address` and
`POST /api/v1/rooms` with `locationId,roomNumber,capacity`. It reads current
Location/Room lookup endpoints and no longer calls Chain or RoomType APIs.
Capacity is explicitly entered by Owner and validated as an integer 1–32767;
the server remains authoritative. Staff loading failure does not discard a
successful Location lookup. Configuration actions remain Owner-only and only
show persistence success after a confirmed server response. Staff assignment,
meter setup and reading-task operations retain their existing capture APIs.

Bổ sung ngày 08/11: [Owner setup P0–P2](OWNER_SETUP_COMPACT24.md) mô tả closure-check, Staff responsibility, asset template/inventory, điện nước nâng cao và nội quy/phụ lục.

Quyết định mới: bỏ Chain và RoomType. Location là cấp cao nhất, Room thuộc trực tiếp Location. Tài liệu này thay các phần Chain/RoomType và thứ tự giá cũ trong PROPERTY_MANAGEMENT.md, SINGLE_SYSTEM_CHAIN.md và API_CONVENTIONS.md.

## API và quyền

Các đường dẫn dưới đây có tiền tố `/api/v1`. Owner quản lý toàn hệ thống. Staff chỉ đọc tài nguyên tại Location đang được phân công theo ngày Việt Nam; scope được đọc lại ở server trên mỗi request, trước count/paging. Tenant không truy cập nhóm API quản trị này.

| Tài nguyên             | API                                                                                                                                          |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Location               | `GET/POST /locations`, `GET/PUT /locations/{id}`                                                                                             |
| Location của Staff     | `GET /locations/assigned-to-me`                                                                                                              |
| Phân công Staff        | `GET/POST /staff-location-assignments`; giữ contract ngày bắt đầu/kết thúc hiện có                                                           |
| Room                   | `GET/POST /rooms`, `GET/PUT /rooms/{id}`                                                                                                     |
| Asset                  | `GET/POST /assets`, `GET/PUT /assets/{id}`                                                                                                   |
| Giá/phí                | `GET/POST /billing-policies`, `GET/PUT /billing-policies/{id}`, `POST /billing-policies/{id}/replacement`, `POST /billing-policies/{id}/end` |
| Giá hiệu lực của phòng | `GET /rooms/{id}/prices?effectiveOn=YYYY-MM-DD`                                                                                              |

`/chain`, `/room-types` và `/capture/chains` đã bỏ. DTO Location không có `chainId`; DTO Room/Policy không có `roomTypeId`. Các write DTO mới từ chối JSON field không được hỗ trợ với 400, tránh hiểu nhầm một giá theo RoomType thành giá toàn Location.

Tạo Location:

```json
{ "name": "Cơ sở thử nghiệm", "address": "Địa chỉ thử nghiệm", "isActive": true }
```

Tạo Room:

```json
{ "locationId": "<uuid>", "roomNumber": "P101", "floor": "1", "capacity": 2, "status": 0 }
```

Tạo giá/phí: `locationId`, `roomId` tùy chọn, `category`, `chargeCode`, `name`, `method`, `rate`, `effectiveFrom`, `effectiveTo` tùy chọn, `reason`. Không gửi `roomTypeId`. Enum/đơn vị giữ các giá trị hiện có trong OpenAPI, không thêm phương pháp tính mới.

## Invariants giữ nguyên

Location dùng optimistic concurrency qua `version`. Tạo mới thường trả version 1; gán Staff cũng tăng version của Location vì assignment nằm trong cùng aggregate. Trước PUT, GET `/locations/{id}` để lấy version hiện tại. Gửi version cũ trả 409 với `code: stale_version`; đọc lại và xem thay đổi trước khi gửi lại. Trong Postman: **28 → 36 → 37**, không tự tăng version bằng suy đoán.

- Giá riêng Room được ưu tiên hơn giá Location theo từng `chargeCode` và ngày hiệu lực. Trả về các khoản bắt buộc còn thiếu, không tự ước tính.
- Giá không âm; giữ chính xác bốn chữ số thập phân của rate. Response rate là decimal string.
- Không tạo giá hồi tố, không cho trùng phạm vi/mã khoản/khoảng ngày. Ngày bắt đầu và kết thúc là inclusive.
- Giá đã hiệu lực/đã dùng không sửa trực tiếp; tạo version thay thế. Giá tương lai chưa dùng chỉ sửa với expected version. Mọi thay đổi có actor/reason/history và transaction.
- Cấm tự đặt Room thành OnHold/Occupied qua API cấu hình. Cấm đóng Room còn người ở hoặc thay đổi capacity khi còn nghĩa vụ.
- Asset thuộc Room hoặc khu chung; Room và Asset phải cùng Location. Owner không ghi đè condition/status khi Asset còn Work Order mở.
- Capture và Main Draft dùng cùng mô hình Location → Room; không đòi bootstrap Chain hoặc RoomType.

## DB và vận hành

Schema `compact24-2026-11-04-location-room`: **24 bảng, 383 cột, 83 FK**, không thêm bảng/cột. Bỏ `locations.room_types`, `rooms.room_type_id`, `billing_policies.room_type_id`. SQL, DBML, diagram JSON và readiness được đồng bộ.

Model/migrations legacy vẫn được giữ cho công cụ import offline và kiểm thử nguồn cũ. Metadata Chain/RoomType từ import lịch sử có thể được giữ trong JSON hiện có; đây không phải catalog/API đang vận hành. Không chạy legacy `Database.Migrate()` lên Compact24.

```powershell
./scripts/Update-LocalDatabase.ps1 -Check
./scripts/Update-LocalDatabase.ps1 -InspectSchema
./scripts/Update-LocalDatabase.ps1 -UpgradePropertySchema
```

Upgrade chỉ nhận Development/loopback `bhome`, chạy transaction, kiểm chứng readiness trước commit và không tạo bảng/cột. Hỗ trợ schema cũ 386 cột hoặc DB đã bỏ ba cột nhưng thiếu guard. Nếu còn catalog/reference RoomType ở schema cũ, từ chối và rollback; không tự bỏ giá hoặc dữ liệu.

Kết quả kiểm thử và giới hạn nằm trong [biên bản rà soát](../development/API_RESET_REVIEW_2026-11-04.md).
