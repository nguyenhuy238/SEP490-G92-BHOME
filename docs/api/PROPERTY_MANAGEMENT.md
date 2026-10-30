# API quản lý Location, Room Type, Room, Asset và giá phí

## Phạm vi và quyết định đã duyệt

**Cập nhật 30/10/2026:** chỉ có một Chain chung; Owner chỉ đổi tên qua GET/PUT `/chain`.
Location tự gắn Chain này và không nhận chainId. Quyết định mới thay nội dung chọn/tạo Chain
trong bản ngày 29/10. Chi tiết chuyển đổi và quyền: [Single system Chain](../development/SINGLE_SYSTEM_CHAIN.md).

Ngày 29/10/2026, chủ dự án duyệt các đề xuất 1–8 trong cuộc trao đổi triển khai.
Nguồn đối chiếu là Report 3 `BHome_Report-3_Software Requirement Specification (2).docx`
và Report 4 `Report-4_Software Design Specification (5).docx` trong `docs/reports/`.
Các quyết định bên dưới giải quyết phạm vi chưa thống nhất trong màn hình SRS và schema thiết kế;
không khẳng định đã triển khai toàn bộ BF-01 hoặc billing.

| Yêu cầu                                                     | Nguồn                                             | Dữ liệu và xử lý                                                                              | Kiểm thử chấp nhận                                                                        |
| ----------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Location → Room Type → Room                                 | BF-01; UC-04; Report 4 §3.1–3.4                   | Location, RoomType, Room; PropertyService; FK cùng Location                                   | Tạo/cập nhật; thiếu Chain/type; type sai Location; ngừng hoạt động có phòng đang vận hành |
| Owner toàn hệ thống; Staff đọc Location hiện được phân công | GBR-01..03; DBR-01; quyết định global Owner đã có | property.view / property.manage; PermissionAccess; query lọc trước count/paging               | Guest 401; Tenant 403; Staff ngoài phạm vi 404; phân công hết hạn có hiệu lực với JWT cũ  |
| Từng tài sản tại phòng hoặc khu chung                       | UC-05; Report 4 §3.5                              | Asset; FK cùng Location; lịch sử cấu hình                                                     | Sai vị trí; trùng mã; Staff không sửa; chặn ghi đè trạng thái UnderRepair                 |
| Giá có phiên bản và ngày hiệu lực                           | UC-06; GBR-08; Report 4 §3.20                     | BillingPolicy; transaction; exclusion constraint                                              | Giá âm/hồi tố; trùng kỳ; hai request đồng thời; rollback thay giá lỗi                     |
| Trạng thái phòng không được thay nghĩa vụ hợp đồng          | UC-04 A2; DBR-02                                  | Chỉ Available ↔ Unavailable khi được phép                                                     | Cấm nhập tay OnHold/Occupied; cấm đóng phòng có Resident                                  |
| Lưu lịch sử cấu hình                                        | UC-04..06; GBR-13; DBR-13                         | PropertyChanges chứa actor/UTC/reason/before/after; SecurityAudit tham chiếu cùng transaction | Snapshot, actor, stale version; DB chặn UPDATE/DELETE/TRUNCATE lịch sử                    |

Hoãn: copy Location, ảnh, nội dung public, UC-07 lịch sử cư trú, bộ tài sản mặc định theo Room Type,
chuyển tài sản, billing, hợp đồng, thuế, bậc thang, theo người và chia tiền theo ngày.
Các JOB-09/10 và OQ về tiền cọc/điều chỉnh không được triển khai trong đợt này.

## Quyền và giao thức

Các route dưới `/api/v1`, yêu cầu Bearer JWT. Owner tạo/sửa mọi Location; Staff chỉ đọc các
Location đang được phân công theo ngày Việt Nam. Tenant và Guest không truy cập các DTO quản trị này.
Quyền Tenant xem phòng của mình sẽ đi qua luồng tenancy riêng; permission `rooms.view` hiện có
không mở quyền đọc danh sách quản trị cho Tenant. Các action mới dùng fixed permission
`property.view` (Owner, Staff) và `property.manage` (Owner), kiểm tra cả ở service.

Lỗi dùng ProblemDetails và `correlationId`; lỗi nghiệp vụ thêm `code` an toàn.
400: dữ liệu sai; 401: chưa xác thực; 403: thiếu quyền; 404: không tồn tại/ngoài phạm vi;
409: trùng, chồng kỳ, stale version hoặc phụ thuộc nghiệp vụ. Không có DELETE.
Request tối đa 32 KiB cho các controller quản lý tài sản/cấu hình. Response thành công không cache.

| Method    | Route                                                                 | Hành vi                                                      |
| --------- | --------------------------------------------------------------------- | ------------------------------------------------------------ |
| GET, POST | `/locations`, `/room-types`, `/rooms`, `/assets`, `/billing-policies` | Danh sách có phân trang / tạo mới                            |
| GET       | `/{resource}/{id}`                                                    | Chi tiết                                                     |
| PUT       | `/locations/{id}`, `/room-types/{id}`, `/rooms/{id}`, `/assets/{id}`  | Thay cấu hình, gửi version hiện tại                          |
| GET       | `/rooms/{id}/prices?effectiveOn=YYYY-MM-DD`                           | Giá từng khoản theo ngày, kèm khoản bắt buộc còn thiếu       |
| POST      | `/billing-policies/{id}/replacement`                                  | Kết thúc bản trước và tạo bản kế tiếp trong cùng transaction |
| PUT       | `/billing-policies/{id}`                                              | Sửa tên/giá/kỳ của policy tương lai chưa sử dụng, giữ ID     |
| POST      | `/billing-policies/{id}/end`                                          | Kết thúc hiệu lực tương lai, giữ lịch sử                     |

POST trả 201 và Location trỏ tới GET chi tiết; PUT/end trả 200. Gửi lại request tạo trùng hoặc
version cũ trả 409; không tự retry một mutation sau lỗi mạng mơ hồ. Đọc lại trạng thái trước khi thử lại.
Các API đồng bộ này không có hợp đồng HTTP Idempotency-Key; không tạo hiệu ứng thanh toán.

GET danh sách nhận `page` mặc định 1, `pageSize` mặc định 20, tối đa 100; từ chối giá trị sai
hoặc offset vượt int32. Response `{ items, page, pageSize, totalCount }`.
Thứ tự ổn định: `createdAt ASC, id ASC`. Lọc Staff thực hiện trước count/pagination.
`search` tối đa 200 ký tự, tìm chuỗi phân biệt hoa/thường theo collation DB.

| Resource         | Bộ lọc được hỗ trợ                                                           |
| ---------------- | ---------------------------------------------------------------------------- |
| locations        | isActive, search (tên/địa chỉ); không có locationId                          |
| room-types       | locationId, roomTypeId, isActive, search (tên)                               |
| rooms            | locationId, roomTypeId, roomId, roomStatus, search (số phòng)                |
| assets           | locationId, roomId, assetStatus, search (tên/mã)                             |
| billing-policies | locationId, roomTypeId, roomId, chargeCategory, effectiveOn, search (mã/tên) |

`GET /locations` liệt kê mọi Location trong phạm vi quyền theo từng trang; không lọc theo ID.
Owner thấy toàn hệ thống, Staff chỉ thấy Location hiện được phân công. Xem riêng một Location
dùng `GET /locations/{id}`.

`GET /locations/assigned-to-me` tiếp tục giữ DTO danh sách tối thiểu hiện có cho Staff.
Chain được hệ thống khởi tạo/giữ duy nhất; Owner xem/đổi tên qua GET/PUT `/chain`. Không còn POST `/capture/chains`; GET cũ vẫn là danh sách chỉ đọc một phần tử.

## Request cấu hình

POST bỏ `version`; PUT gửi `version` từ GET gần nhất. Mỗi cập nhật thành công tăng version.
Có thể gửi `reason` tối đa 500 ký tự để lưu cùng snapshot; field này bắt buộc khi kết thúc policy.
LocationId của Room Type/Room/Asset không được đổi; Location luôn dùng Chain chung, chainId không còn là field ghi.

```json
{
  "name": "Cơ sở A",
  "address": "Địa chỉ cơ sở",
  "isActive": true
}
```

```json
{
  "locationId": "<location-guid>",
  "name": "Studio",
  "description": "Phòng có ban công",
  "defaultCapacity": 2,
  "areaM2": 20.5,
  "amenities": ["Ban công"],
  "isActive": true
}
```

Room Type có sức chứa mặc định, Room lưu sức chứa riêng do Owner nhập rõ; cập nhật mặc định
không thay ngầm phòng hiện có. Sức chứa 1..32767, diện tích dương tối đa 999999.99 với tối đa
hai chữ số thập phân. Tiện ích tối đa 50 mục, mỗi mục 1..100 ký tự sau trim.

```json
{
  "locationId": "<location-guid>",
  "roomTypeId": "<room-type-guid>",
  "roomNumber": "A-01",
  "floor": "1",
  "capacity": 2,
  "status": 0
}
```

Enum JSON theo thiết lập số hiện có: Room `Available=0, OnHold=1, Occupied=2, Unavailable=3`;
Asset `Active=0, NeedsRepair=1, UnderRepair=2, Retired=3`.
Tạo phòng chỉ chấp nhận Available hoặc Unavailable. Cấu hình không tạo OnHold/Occupied;
chỉ workflow hợp đồng tương lai mới được quyết định chúng. Có Resident hoặc trạng thái do
hợp đồng kiểm soát thì không được đổi trái trạng thái, đổi Room Type đã gán hay sức chứa.

Schema hiện chưa có Contract/occupancy có vòng đời đầy đủ: mọi Resident tham chiếu phòng được coi
là phụ thuộc cần bảo vệ, không suy ra đó là một hợp đồng Active hoặc tự sửa Room thành Occupied.
Đây là giới hạn tích hợp cần thay bằng kiểm tra nghĩa vụ thật khi triển khai hợp đồng/move-out.
Ngừng Location/Room Type bị chặn nếu còn phòng khác Unavailable hoặc có Resident liên quan.

```json
{
  "locationId": "<location-guid>",
  "roomId": "<room-guid>",
  "commonArea": null,
  "code": "AC-01",
  "name": "Máy lạnh",
  "category": "Điện lạnh",
  "condition": "Hoạt động bình thường",
  "status": 0
}
```

Asset là từng món, không có quantity. Chọn đúng một trong roomId hoặc commonArea có nội dung.
Room phải cùng Location. Không chuyển phòng/khu chung/Location trong đợt này. Staff chỉ đọc;
không dùng quyền `assets.update-condition` của luồng tác nghiệp để sửa cấu hình này.
Không ghi đè tình trạng/status của tài sản UnderRepair hoặc khôi phục tài sản Retired qua PUT.
Chưa có workflow Work Order; API này không xác nhận hoàn thành bảo trì.

Tên Location có thể trùng. Số Room, tên Room Type và mã Asset (nếu có) không trùng trong cùng
Location sau trim và chuyển hoa, được bảo vệ bởi unique index PostgreSQL. Chỉ trim hai đầu;
không tự đổi nội dung ở giữa. Ngừng sử dụng không giải phóng mã cũ để tái dùng gây nhầm lịch sử.

## Chính sách giá và phí

```json
{
  "locationId": "<location-guid>",
  "roomTypeId": null,
  "roomId": null,
  "category": 0,
  "chargeCode": "RENT",
  "name": "Tiền thuê",
  "method": 0,
  "rate": 2500000,
  "effectiveFrom": "2026-11-01",
  "effectiveTo": null
}
```

| Category JSON   | ChargeCode               | Method JSON              | Đơn vị          |
| --------------- | ------------------------ | ------------------------ | --------------- |
| Rent = 0        | RENT                     | FixedPerRoomPerMonth = 0 | VND/phòng/tháng |
| Electricity = 1 | ELECTRICITY              | Metered = 1              | VND/kWh         |
| Water = 2       | WATER                    | Metered = 1              | VND/m³          |
| ServiceFee = 3  | Mã riêng, ví dụ INTERNET | FixedPerRoomPerMonth = 0 | VND/phòng/tháng |

Mã được trim và chuyển hoa; chỉ ASCII chữ/số/gạch ngang/gạch dưới, tối đa 80 ký tự.
Ba mã RENT/ELECTRICITY/WATER được dành riêng. Cho phép nhiều mã phí dịch vụ cùng lúc và mức 0
được cấu hình rõ. Rate dùng decimal(18,4), không âm, tối đa bốn chữ số thập phân;
không tự làm tròn đầu vào hay tính tiền hóa đơn trong API này.

Không roomId/roomTypeId = Location; có roomTypeId = Room Type; có roomId = Room.
Không cho gửi cả hai. Không có giá cấp Chain trong bản đầu. Khi tra cứu, ưu tiên
Room → Room Type → Location **riêng từng chargeCode**, không cộng các bản cùng mã.
Không tìm thấy RENT/ELECTRICITY/WATER thì trả `missingRequiredCharges`, không tự tạo giá 0.
API trả `charges` gồm policy ID và phạm vi nguồn để downstream có thể lưu tham chiếu/snapshot.

Ngày hiệu lực dùng DateOnly theo Asia/Ho_Chi_Minh, cả hai đầu bao gồm; ngày cuối có thể null.
Không tạo hồi tố. Không được chồng kỳ cùng Location + phạm vi + chargeCode; PostgreSQL kiểm tra
bằng exclusion constraint, kể cả khi gọi song song hoặc bỏ qua service.

UC-06 A3/A4 và GBR-08 yêu cầu không nhập nhằng giá cùng kỳ và giữ phiên bản đã dùng cho billing.
**Quyết định linh hoạt ngày 30/10/2026** thay lựa chọn cũ cấm mọi chỉnh sửa: Owner được PUT policy
có EffectiveFrom sau hôm nay và FirstUsedAt null. Giữ nguyên ID/scope/category/chargeCode;
cho sửa name/rate/effectiveFrom/effectiveTo, tăng version, lưu audit trước/sau. Cả ngày bắt đầu
cũ và mới đều phải còn trong tương lai; giá đã bắt đầu, kể cả hôm nay, hoặc đã sử dụng trả 409.
Không nới hồi tố hoặc hiệu lực ngay trong ngày. Xem [thiết kế và giới hạn tích hợp](../development/FLEXIBLE_FUTURE_PRICING.md).

Không có mốc ngày cố định trong API. GET danh sách policy không bắt buộc effectiveOn; bỏ field
này sẽ xem mọi phiên bản theo bộ lọc/phân trang. GET giá áp dụng cho Room cần effectiveOn để
xác định giá tại một ngày cụ thể và cho phép tra quá khứ/tương lai. D0/D1/D2 chỉ là tên hướng dẫn
trong Postman, không phải field hoặc mốc ngày bị khóa ở server.

Thay giá dùng POST `/{id}/replacement`:

```json
{
  "expectedVersion": 1,
  "policy": {
    "locationId": "<location-guid>",
    "category": 0,
    "chargeCode": "RENT",
    "name": "Tiền thuê",
    "method": 0,
    "rate": 2700000,
    "effectiveFrom": "2026-12-01",
    "reason": "Điều chỉnh giá kỳ tiếp theo"
  }
}
```

Bản mới phải cùng scope/mã/category, bắt đầu sau hôm nay và sau ngày bắt đầu bản cũ, nằm trong
kỳ bản cũ. Bản cũ kết thúc ngày trước bản mới; amount và ngày bắt đầu bản cũ được giữ nguyên.
Transaction khóa advisory theo Location, ghi cả hai bản và audit; lỗi chồng kỳ rollback toàn bộ.
`version` là concurrency token của mỗi record, không phải số thứ tự chung của cả chuỗi giá.
Không có PUT sửa giá lịch sử/đã dùng. DB chỉ cho sửa nội dung và kỳ của policy tương lai chưa dùng;
không cho đổi identity/scope/category/code, xóa policy hoặc xóa/ghi lại FirstUsedAt đã ghi nhận.

PUT policy tương lai dùng `{ "policy": { ...PolicyWrite }, "expectedVersion": 1 }`, giống cấu trúc
replacement. `firstUsedAt` là field response chỉ đọc, không phải field nhận trong PolicyWrite.
Đây là mốc dành cho luồng billing ghi lần dùng đầu cùng transaction/snapshot; hiện repository chưa
có Invoice nên chưa chứng minh tích hợp Invoice thực. Không có API tự mở khóa policy đã dùng.

Kết thúc một policy dùng `{ "effectiveTo": "YYYY-MM-DD", "version": 1, "reason": "..." }`.
Chỉ kết thúc từ hôm nay trở đi và không trước ngày bắt đầu; không kéo dài lại một bản đã kết thúc.
Không tự cập nhật hợp đồng, hóa đơn, thanh toán hoặc giá đã chốt. Các trường hợp thiếu giá
và quyết định áp dụng giá mới cho hợp đồng hiện hữu thuộc tích hợp billing sau này.

## Migration và tương thích

Migrations: `20261029154537_PropertyConfiguration`, `20261030023603_SingleSystemChain` và
`20261030032653_FlexibleFutureBillingPolicies`. Dùng cấu hình kết nối được bảo vệ sẵn có:

```powershell
dotnet ef database update --project src/backend/BHome.Infrastructure --startup-project src/backend/BHome.Infrastructure
```

Các migration trên đã áp dụng lên database `bhome` local ngày 30/10/2026 sau khi người dùng
cho phép; 8 migration đã áp dụng, 0 pending. Chưa triển khai production. Cần quyền tạo extension `btree_gist` (migration phân công trước
đã dùng extension này). Đối chiếu dữ liệu trùng chuẩn hóa trước khi áp dụng; unique index sẽ
từ chối nếu có xung đột, không âm thầm đổi mã hoặc gộp dữ liệu.

Giữ nguyên GUID/quan hệ cũ. Migration SingleSystemChain gắn Location cũ vào Chain chung. Location có địa chỉ trống vẫn đọc được; Owner phải
bổ sung địa chỉ trước khi tạo Room Type/phòng hoặc cấu hình giá. Room cũ giữ RoomTypeId null, được đặt
Unavailable và capacity kỹ thuật 1; Owner phải xác nhận lại sức chứa và chọn loại phòng.
Không suy ra sức chứa, occupancy hay hợp đồng từ dữ liệu OCR.

Thay đổi API có chủ đích theo quyết định đã duyệt:

- POST `/locations` cần name/address; không gửi chainId. Payload chỉ có name vẫn trả 400 do thiếu địa chỉ.
- GET `/locations` trả page DTO; `/assigned-to-me` giữ contract cũ.
- POST `/capture/rooms` cần roomTypeId, nhận capacity (mặc định 1); thiếu loại phòng trả 400.
- `/capture/locations` và `/capture/rooms` gọi chung PropertyService, tránh đường ghi bỏ qua quy tắc.
- Tạo Resident qua capture khóa cùng Location và kiểm tra lại phòng/loại phòng/Location còn vận hành.

Client OCR cũ cần cập nhật bước chọn Room Type trước khi dùng chức năng tạo phòng;
không có thay đổi UI trong đợt backend này. Các luồng OCR đọc/xác nhận hiện có vẫn dùng cùng Room ID.
Rollback migration giữ dữ liệu Room/Location nền nhưng xóa bảng cấu hình mới; chỉ dùng trên môi
trường thử nghiệm hoặc sau kế hoạch sao lưu/rollback được duyệt.

## Kiểm tra

Test chính: `PropertyApiTests`, `PropertyRulesTests`, `PropertyServiceTests` và regression
`LocationAssignmentApiTests`. Có kiểm tra quyền, scope, validation, stale version, race, overlap,
fallback theo từng khoản, mức 0, thiếu cấu hình, audit, bảo vệ Resident, migration up/down dữ liệu cũ.
Kết quả thực thi và giới hạn môi trường được ghi trong `docs/development/PROPERTY_MANAGEMENT_VALIDATION.md`.
