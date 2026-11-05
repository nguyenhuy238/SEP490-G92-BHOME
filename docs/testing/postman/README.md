# Test API với Postman — DB mới 24 bảng

Cập nhật 04/11/2026. Backend dùng Compact24: **24 bảng, 383 cột, 83 khoá ngoại**. Location → Room; đã bỏ Chain và RoomType. Không gửi `chainId` hoặc `roomTypeId`.

## 1. Chạy API và chọn đúng environment

Tại thư mục gốc repository:

```powershell
./scripts/Update-LocalDatabase.ps1 -Check
./scripts/Start-Api.ps1
```

`-Check` phải báo `READY`. Postman mặc định dùng `https://localhost:7240`; `GET /health/ready` phải trả **200 Healthy**. Không chạy legacy EF migration lên DB này.

Nếu cần tạo tài khoản tổng hợp, dùng `./scripts/New-LocalTestUsers.ps1` và nhập mật khẩu test. Script giữ nguyên tài khoản đã tồn tại. Điền đúng email/mật khẩu của tài khoản test đang có; collection không tạo tài khoản hoặc tự đặt mật khẩu.

## 2. Import để test JWT, scope, tài sản, giá/phí, task và incident

Chỉ import hai file cho API của bạn:

- [BHome.Simple.postman_collection.json](BHome.Simple.postman_collection.json) — **180 request**: JWT/refresh/logout, RBAC, Staff Location scope, Location, Room, Asset, giá/phí, task và Incident/Work Order. Tất cả request nằm cùng cấp, không chia folder. Incident được đánh số tiếp **119–181**.
- [BHome.Local.postman_environment.json](BHome.Local.postman_environment.json) — environment dùng chung **BHOME Local**.

Chọn **BHOME Local** trong Postman. Điền `ownerEmail`/`ownerPassword`, `staffEmail`/`staffPassword`; nếu test Tenant thì điền thêm `tenantEmail`/`tenantPassword`. Mật khẩu và token trong file luôn để trống. Không export credential thật vào Git.

## 3. Thứ tự test phần core

Gửi từng request; số request cũ được giữ để dễ tìm, nên có khoảng trống sau khi bỏ API cũ.

1. **24** đăng nhập Owner, **25** đăng nhập Staff; **25T** đăng nhập Tenant nếu cần. Script lưu token và Staff/Tenant user ID khi đăng nhập thành công.
2. **26** tạo Location; **28** phân công Staff tại Location đó. Ngày bắt đầu/kết thúc phải bao gồm hôm nay theo Việt Nam. Gán Staff làm tăng version của Location: muốn sửa Location, chạy **36 GET → 37 PUT**. GET tự lưu `locationVersion`; PUT dùng `{{locationVersion}}` và lưu version mới sau khi thành công. Không giữ cứng `version: 1`.
3. **42** tạo Room trực tiếp trong Location; **46** tạo Asset trong Room. Script lưu `locationId`, `roomId`, `roomVersion`, `assetId` và các alias `incidentLocationId`, `incidentRoomId`, `incidentAssetId` cho collection Incident.
4. **52**, **54–57** cấu hình giá Location/Room và đơn giá điện/nước/phí. **51**, **58–59** đọc lại. `dateD0` mặc định là hôm nay, `dateD1` ngày mai, `dateD2` sau 30 ngày; có thể điền trước trong environment để chọn kỳ khác.
5. **60a–60e**, **61** kiểm tra giá tương lai, thay phiên bản và stale version. Đọc mô tả từng request; các nhánh này có điều kiện dữ liệu khác nhau.
6. **81–118** test task: Owner tạo → Staff start/progress/blocker → upload evidence → submit → Owner verify hoặc rework. Dùng ảnh tổng hợp trong `fixtures/`; chọn file ở Body trước khi upload.

Request **77/79** thay đổi trạng thái Room/Location: chỉ chạy khi đã xong các luồng cần Location active. Các bài JWT reuse/logout cũng làm mất hiệu lực token thử nghiệm; đăng nhập lại nếu cần.

## 4. Test Incident và Work Order

Gửi request **119 — Staff gửi báo cáo sự cố Normal** trong collection Simple sau khi đã phân công Staff. Dùng cùng environment và ID vừa tạo, không cần dựng hợp đồng Tenant cho nhánh Staff.

- **119–140:** báo sự cố Normal → giao việc → đề xuất/duyệt → thực hiện → xác minh.
- **141–145:** yêu cầu làm lại và nộp lại kết quả.
- **146–158:** Emergency và chi phí xử lý khẩn cấp.
- **159–165:** Owner xử lý trực tiếp.
- **166–173:** danh sách, lịch sử và thông báo.
- **174–181:** các trường hợp từ chối quyền hoặc dữ liệu không hợp lệ.

Luồng chính:

1. Staff submit Normal → GET Incident để lấy version mới.
2. Owner classify → GET lại version → Owner assign Work Order cho Staff hiện được phân công.
3. Staff inspection/proposal → Owner plan decision → Staff start/progress.
4. Upload ảnh completion → Staff submit → Owner verify; dùng nhánh rework nếu cần.
5. Đọc report, history, maintenance history, expenses và tải evidence bằng đúng role.

Các request GET cập nhật version. Gửi GET lại sau mutation trước khi gửi lệnh tiếp theo. `Idempotency-Key` mặc định mới cho mỗi lần gửi; điền `incidentIdempotencyKey` khi chủ động kiểm tra replay, rồi xoá giá trị để trở lại thao tác mới.

Ảnh PNG/JPEG tối đa 5.000.000 bytes mỗi ảnh, tối đa 5 ảnh cho mỗi nhóm bằng chứng được phép. Chọn ảnh tổng hợp ở Body; không dùng CCCD hoặc dữ liệu thật. Tenant submit cần Active Contract của tài khoản đó; tự đăng nhập Tenant không tạo tenancy. Emergency/direct-completion/cancel/reject là các nhánh riêng, không chạy tất cả trên cùng một Incident.

Giới hạn hiện hành theo D3-A/D6-A: chưa bật nhắc Emergency 15/30 phút, routing theo ca hoặc mở rộng quyền co-occupant. Push/email/provider và MinIO thật cần cấu hình riêng; collection không giả định gửi thông báo bên ngoài thành công.

## 5. Các luồng hợp đồng, hoá đơn và thanh toán

Các collection, environment, coverage, hướng dẫn và generator của **NguyenQuocHuy được giữ nguyên bản gốc**, không thuộc lần cập nhật API của bạn. Không cần import chúng để test 180 request ở Simple. Xem [hướng dẫn riêng](NGUYEN_QUOC_HUY_POSTMAN_GUIDE.md) nếu làm việc với phần đó; bản gốc có thể còn contract Chain/RoomType cũ và không được tính vào kết quả kiểm tra dưới đây.

## Kết quả kiểm tra bản cập nhật này

- Đã khởi động backend hiện tại với connection `.env` và gọi thật `GET /health/ready`: **200 Healthy**.
- `Update-LocalDatabase.ps1 -Check`: **READY**, schema `compact24-2026-11-04-location-room`, **24 bảng / 383 cột / 83 FK**. Production DI dùng `Compact24DbContext`; không chọn DB legacy.
- **180 request definitions** của bạn trong Simple đã qua kiểm tra JSON body, cú pháp script, loại bỏ route/field cũ và đối chiếu route/method với Swagger hiện tại. Script tạo key Incident được giữ riêng trên từng request; đã kiểm tra cả key mới và key replay cố định sau khi bỏ folder.
- Không chạy mutation từ collection lên DB của bạn trong lần cập nhật Postman này. Kết quả trên xác nhận collection khớp API và DB readiness; không phải tuyên bố cả 180 kịch bản nghiệp vụ đã chạy HTTP.

Kiểm tra offline bằng Node, không cần thêm dependency:

```powershell
node scripts/postman/Validate-CurrentCollections.cjs
# Nếu đã tải swagger.json từ API đang chạy:
node scripts/postman/Validate-CurrentCollections.cjs path/to/swagger.json
```

API chi tiết: [Location/Room/Asset/giá phí](../../api/LOCATION_ROOM_API.md), [Incident/Work Order](../../api/INCIDENT_MAINTENANCE.md), [Task](../../api/OPERATIONAL_TASKS.md).
