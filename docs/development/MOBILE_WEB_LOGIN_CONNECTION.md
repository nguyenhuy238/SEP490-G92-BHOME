# Lỗi kết nối khi đăng nhập Mobile Web local

Phạm vi: cấu hình kết nối cho UC-01 (đăng nhập), giữ nguyên xác thực và phân quyền
GBR-01/02. Không thay đổi hợp đồng API hoặc dữ liệu nghiệp vụ.

Mobile Web tại `http://localhost:8081` gọi API HTTPS tại `https://localhost:7240`.
Nếu API trả `/health/ready` thành công nhưng đăng nhập báo gián đoạn kết nối,
kiểm tra CORS preflight:

```powershell
curl.exe -i -X OPTIONS https://localhost:7240/api/v1/auth/login `
  -H "Origin: http://localhost:8081" `
  -H "Access-Control-Request-Method: POST" `
  -H "Access-Control-Request-Headers: content-type,x-bhome-client"
```

Kết quả cần có HTTP 204 **và**
`Access-Control-Allow-Origin: http://localhost:8081`. Chỉ HTTP 204 chưa chứng minh
trình duyệt được phép gửi yêu cầu đăng nhập.

.NET hợp nhất mảng cấu hình theo chỉ số. Trong `appsettings.Development.json`,
`Cors:AllowedOrigins:3` là `http://localhost:8081`; đặt URL ngrok tại
`Cors__AllowedOrigins__3` trong `.env`, user-secrets hoặc biến môi trường sẽ ghi đè
origin này. Giữ các chỉ số 0–6 theo `.env.example`, thêm origin tùy chỉnh từ chỉ số
7 trở đi. Kiểm tra cả profile `.env.local` nếu dùng nó để chạy backend.
Script `scripts/Start-LocalPublicLinks.ps1` dành sẵn các chỉ số CORS trong cấu hình
Development trước khi thêm URL tunnel. Nếu user-secrets đã chứa origin tunnel tại
chỉ số 3 từ lần chạy cũ, chuyển origin đó sang chỉ số trống từ 7 trở đi và khôi phục
origin Mobile Web tại chỉ số 3.

Sau khi sửa, khởi động lại API. Nếu chạy bằng Visual Studio, dừng phiên debug cũ
trước khi F5 lại; nếu chạy bằng terminal, dùng `scripts/Start-Api.ps1`. Tải lại
trang Mobile Web rồi đăng nhập bằng tài khoản của database đang chọn.

Kiểm tra thêm origin không được cấu hình phải không nhận header CORS, truy cập
API bảo vệ khi chưa đăng nhập phải trả 401, đăng nhập sai phải trả 401, đăng nhập
demo hợp lệ phải trả 200. Test cấu hình Development nằm tại
`tests/backend/BHome.IntegrationTests/MobileWebCorsTests.cs`.

Giữ nguyên kiểm tra HTTPS. Chứng chỉ LAN dùng cho điện thoại có thể chưa được
Windows tin cậy; trình duyệt local dùng chứng chỉ localhost đã được tin cậy.
