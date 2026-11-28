# Mobile local kết nối Staging hoặc Production

## Production

Dừng Metro cũ (Ctrl+C), rồi từ thư mục gốc repository chạy:

```powershell
npm run mobile:product
```

Nếu PowerShell chặn `npm.ps1`, dùng `npm.cmd run mobile:product`.
Lệnh này kết nối API `https://api.103.146.23.157.sslip.io`, bỏ qua `.env.local`
và các cấu hình API local/Staging, tắt đồng hồ demo và SMS demo.
Không cần chạy Docker, PostgreSQL hay API local.

Nhấn `w` để mở Mobile Web trên localhost, hoặc quét QR bằng Expo Go.
Mobile Web dùng proxy Metro riêng `/__bhome_product`, chỉ nhận kết nối loopback;
Expo Go gọi trực tiếp API Production qua HTTPS. Proxy dùng cùng cơ chế xác thực TLS,
lọc header và chặn redirect như Staging; không thay đổi CORS hay cấu hình trên VPS.
Nếu cổng mặc định bận, có thể chạy `npm run mobile:product -- --port 8082`.
Lệnh luôn xóa cache Metro khi khởi động để nạp đúng môi trường.

Các thao tác trên ứng dụng kết nối dữ liệu Production thật.

Phạm vi thay đổi: cấu hình chạy mobile theo yêu cầu trực tiếp của người dùng;
không thay đổi BF/UC/GBR/DBR/JOB, API contract hoặc schema. Kiểm tra hồi quy gồm
chọn đúng API, bỏ cấu hình local/Staging, tắt demo trên Product, giới hạn proxy,
giữ kết nối trực tiếp trên native/release và kiểm tra kết nối qua API công khai.

Đã xác minh ngày 28/11/2026: 85 kiểm thử trong `expoStartup.test.ts`,
`stagingMobileProxy.test.ts`, `connectivity.test.ts` đạt; ESLint cho toàn bộ
`src/mobile/src`, các script/config/test liên quan, TypeScript mobile và Prettier
cho các file thay đổi đều đạt. Chạy thực tế `npm.cmd run mobile:product -- --port 8094`
khởi động Metro thành công; `/status` và proxy `/__bhome_product/api/v1/public/locations`
đều trả HTTP 200 với định dạng mong đợi. API công khai Production qua HTTPS trực tiếp
cũng trả HTTP 200. Chưa kiểm tra giao diện hoặc Expo Go trên thiết bị thật.

## Staging

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
