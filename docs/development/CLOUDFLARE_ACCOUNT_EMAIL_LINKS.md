# Cloudflare HTTPS URL cho email tài khoản BHOME

## Cấu hình hiện có

Backend không tự lấy hostname từ email hay request HTTP. Nó ghép một lần token vào fragment của các callback đã khai báo:

| Cấu hình | Trang công khai |
| --- | --- |
| `AuthenticationEmail__WebResetUrl` | `https://<domain>/reset-password` |
| `AuthenticationEmail__WebInvitationUrl` | `https://<domain>/accept-invitation` |
| `AuthenticationEmail__WebVerificationUrl` | `https://<domain>/confirm-email` |
| `AuthenticationEmail__TrustedOrigins__0` | `https://<domain>` |
| `AuthWeb__AllowedOrigins__N` | `https://<domain>` (script thêm một slot có đánh dấu riêng) |
| `AnonymousSigning__PublicSigningUrl` | `https://<domain>/contract-signing` — trang ký hợp đồng bằng OTP, PDF và nét vẽ |

Các liên kết trong email dùng dấu `#` để giữ token bên phía trình duyệt. `AuthenticationEmail__Mobile*Url` và các origin `bhome://` hiện có được giữ nguyên. Người nhận không thể truy cập `localhost` trên máy chạy BHOME từ thiết bị khác.

## Dùng hostname Cloudflare ổn định

1. Cài `cloudflared`, có domain do bạn quản lý tại Cloudflare. Tại Cloudflare **Networking > Tunnels**, tạo named tunnel. Trong **Routes > Add route > Published application**, chọn hostname HTTPS công khai (ví dụ `owner-dev.example.com`) và service URL `http://localhost:5173`. Chạy connector trên máy có Owner Web. Nếu Vite đang dùng cổng `5174`, cấu hình service URL đúng cổng đó.
2. Đối với Vite chạy thử qua tunnel, chỉ thêm **hostname cụ thể** vào danh sách Vite allowed hosts, ví dụ chạy trước khi khởi động Vite trong cùng phiên PowerShell:

   ```powershell
   $env:__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS='owner-dev.example.com'
   cd src/owner-web
   npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
   ```

   Nếu có hostname `*.trycloudflare.com` để test, thay giá trị bằng đúng tên được cấp. Không đặt `allowedHosts: true` vì sẽ chấp nhận host bất kỳ. Dùng hosting web có HTTPS ổn định cho triển khai thật, thay vì chia sẻ máy phát triển cho người dùng thực.
3. Trước khi ghi lại URL email, mở cả `https://owner-dev.example.com/reset-password`, `/accept-invitation`, `/confirm-email` và `/contract-signing` từ thiết bị ngoài máy chủ. Không được hiện 502, 403, login Cloudflare Access, hoặc lỗi không tìm thấy trang. Vite proxy `/api` đã chuyển tiếp vào Backend HTTPS; kiểm tra API thực tế tại origin đó khi làm smoke test có tài khoản tổng hợp.
4. Preview rồi áp dụng vào file `.env` (đang được git-ignore):

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Configure-CloudflareEmailLinks.ps1 -PublicWebOrigin 'https://owner-dev.example.com'
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Configure-CloudflareEmailLinks.ps1 -PublicWebOrigin 'https://owner-dev.example.com' -Apply
   ```

   Script mặc định gọi bốn public page và chỉ chấp nhận HTTP 200. Nó kiểm tra URL phải là HTTPS public origin không kèm path/query/userinfo/port, cập nhật các callback, trang ký nội bộ qua OTP, email trusted origin và Origin allowlist dành cho cookie-auth request, từ chối key trùng, và không in hoặc thay đổi SMTP credential, token, Mobile deep link hoặc cấu hình SePay. Nó giữ nguyên các Origin khác đã có và sử dụng lại đúng slot có đánh dấu khi chạy lần sau. Chỉ dùng `-SkipRemoteProbe` khi kiểm tra ngoại tuyến với dữ liệu giả; bỏ công tắc này khi cấu hình thực.
5. Khởi động lại Backend sau khi thay `.env`, theo đúng cách API đang nhận `.env` hoặc process environment. Kiểm tra `Email__Enabled`, `NotificationChannels__Enabled`, worker JOB-04 và `Email__AppPassword` trong secret store; Cloudflare chỉ cung cấp URL mở trang, không gửi SMTP thay Gmail. **Tạo lời mời ký hợp đồng mới** bằng nút Owner; email đã gửi trước khi cập nhật cấu hình không tự bổ sung link. Lời mời mới thu hồi lời mời ký trước, vì vậy không dùng mã OTP/token trong email cũ. Link ký chứa `#token=` và được trang `/contract-signing` đọc từ fragment; không gửi token trong query/Referer.

Nếu dùng **Quick Tunnel** để trình diễn, lệnh `cloudflared tunnel --url http://localhost:5173` cung cấp hostname `*.trycloudflare.com` ngẫu nhiên. Địa chỉ sẽ thay đổi khi tạo lại tunnel, và link đã gửi không tự cập nhật. Sau mỗi lần tunnel đổi, chạy lại script bằng URL mới, restart Backend rồi gửi email mới. Không dùng Quick Tunnel cho email production hoặc luồng đòi URL ổn định.

`ContractSigning:InvitationLink` là luồng email gọi app cho người đã có tài khoản, khác với `AnonymousSigning__PublicSigningUrl` cho người ký nội bộ chưa có tài khoản. Script chỉ thiết lập luồng ký nội bộ qua OTP; luồng mời người có tài khoản vẫn có thể cần cấu hình `ContractSigning__InvitationLink__PublicOpenUrl` riêng khi triển khai.

Kiểm thử ngoại tuyến:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Test-CloudflareEmailLinks.ps1
```

Tham khảo: [Cloudflare Tunnel setup](https://developers.cloudflare.com/tunnel/get-started/), [Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/), [BHOME authentication email](../api/AUTHENTICATION_EMAIL.md).
