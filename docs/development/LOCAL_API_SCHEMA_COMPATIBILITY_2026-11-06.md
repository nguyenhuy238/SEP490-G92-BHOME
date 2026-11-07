# Local API: giữ nguyên database khi khởi động mobile

Ngày kiểm tra: 06/11/2026. Yêu cầu: sửa API startup, không sửa database.

## Nguyên nhân

API dừng trước khi mở cổng vì `property_upgrade_requires_explicit_command`.
Database local vẫn dùng Compact24 trước thay đổi Location/Room, còn ba cột
`locations.room_types`, `rooms.room_type_id`, `billing_policies.room_type_id`.
Vì vậy mobile gặp `ECONNREFUSED`. Dòng `wrong TLS server name` thuộc phép thử
chứng chỉ sai tên có chủ đích, không chứng minh chứng chỉ thật bị sai.

## Thay đổi

`DevelopmentDatabase:AllowPreviousPropertySchema=true` trong cấu hình Development
cho phép nhận diện đúng schema Compact24 trước đó trên database Development
loopback có tên được cho phép. Production và các môi trường khác vẫn kiểm tra
schema hiện hành. Tắt cờ này sẽ trở lại yêu cầu nâng cấp như trước.

Reference cũ lấy từ `cbb3f09:docs/database/2026-11-03/compact-24/BHOME_24_TABLES.sql`,
được nhúng với đuôi `.schema-reference` để đối chiếu metadata bằng SELECT;
không thực thi nội dung reference. Kiểm tra dùng cùng logic xác minh cột/kiểu/null,
foreign key, nội dung hàm bảo vệ, trigger và index của schema tương ứng.
Không chấp nhận tùy ý database có thêm cột hoặc thiếu guard cần thiết của reference.

Startup và health check cùng dùng profile tương thích. CLI `-Check` vẫn kiểm tra
schema hiện hành và có thể báo `PROPERTY_UPGRADE_REQUIRED`; không tự động nâng cấp.
Log startup ghi `READY_PREVIOUS_PROPERTY_COMPATIBILITY` để phân biệt rõ hai schema.

Đây là hỗ trợ khởi động Development với dữ liệu cũ. Các cột và guard RoomType cũ
được giữ nguyên; chưa xác minh toàn bộ thao tác ghi nghiệp vụ trên schema này.
Không xem readiness là bằng chứng các nghiệp vụ đã được nghiệm thu, đặc biệt
thao tác danh mục hoặc bảo trì chịu ràng buộc khác giữa hai schema.

## Kiểm chứng thực hiện

- Build API Release: thành công, 0 warning/error.
- `dotnet test tests/backend/BHome.IntegrationTests/BHome.IntegrationTests.csproj --no-restore --filter FullyQualifiedName~Compact24CompatibilityTests`:
  9/9 qua. Các test này chỉ kiểm tra offline, không mở kết nối hoặc tạo database.
- Khởi động bằng `scripts/Start-OcrMobile.ps1 -SkipDatabase`, jobs đã tắt trong
  `.env` hiện có. API mở HTTPS 7240 và HTTP 5240.
- `Diagnose-MobileApi.cjs`: live/ready HTTP 200, contracts không có phiên HTTP 401;
  TLS authorized=true; CA không tin cậy và tên server sai đều bị từ chối đúng.
  Không bỏ kiểm tra TLS.
- Đối chiếu SHA-256 trước/sau bằng kết nối ép `default_transaction_read_only=on`:
  toàn bộ hàng dữ liệu, metadata cột, constraint, hàm và trigger giữ nguyên.
  Không xuất dữ liệu hàng hoặc thông tin đăng nhập ra log.
- Không chạy migration, seed, upgrade, reset hoặc tạo/xóa database trong lượt sửa này.
  Không đăng nhập hay chạy request ghi dữ liệu khi smoke test.

API đang chạy có thể được launcher mobile sử dụng lại. Có thể chạy lại lệnh mở
mobile thông thường. Các lần thao tác nghiệp vụ sau đó vẫn có khả năng ghi dữ liệu
theo chức năng ứng dụng; chế độ tương thích không biến API thành read-only.
