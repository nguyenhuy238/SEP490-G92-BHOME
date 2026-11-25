# Mobile local kết nối Staging

Từ thư mục gốc repository, dừng Metro cũ (Ctrl+C) rồi chạy:

```powershell
npm.cmd run mobile:staging
```

Nhấn `w` để mở Mobile Web tại `http://localhost:8081`, hoặc quét QR bằng Expo Go.
Địa chỉ API mặc định là `https://api-staging.103.146.23.157.sslip.io`.
Không cần Docker, PostgreSQL hay API local. `npm.cmd run mobile:dev` vẫn dùng môi trường local như cũ.
Có thể thêm `-- --clear` nếu cần xóa cache Metro.

Mobile Web ở loopback dùng proxy phát triển cố định của Metro; upstream HTTPS vẫn được xác thực.
Proxy chỉ chuyển tiếp API Staging từ máy local, không chuyển cookie, không theo redirect và không có trong bản release.
Expo Go gọi Staging trực tiếp qua HTTPS. Không mở Mobile Web qua IP LAN nếu VPS chưa cho phép origin đó.
Nút kiểm tra kết nối Staging dùng API danh sách cơ sở công khai; `/health/*` tiếp tục chỉ dành cho vận hành nội bộ.
Để dùng Mobile Web trực tiếp mà không qua proxy, người vận hành có thể triển khai các origin loopback
được bổ sung trong `deploy/vps/compose.staging-public.example.yml` vào cấu hình API Staging đang hoạt động.
Không sửa cấu hình Production, không thêm origin wildcard, không thay đổi `AuthWeb__AllowedOrigins`.

Mọi thao tác đăng nhập, tạo/sửa/xóa trên Mobile Staging đều tác động tới dữ liệu Staging thật.
Không dùng tài khoản hoặc dữ liệu Production để kiểm thử.
