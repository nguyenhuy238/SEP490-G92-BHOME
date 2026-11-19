# Mobile local API (không cần Cloudflare Tunnel)

## Chạy hằng ngày

Từ thư mục gốc BHOME trên Windows:

```powershell
npm.cmd run mobile:dev
```

Launcher `scripts/Start-OcrMobileApp.ps1` tự chọn IP IPv4 của Wi-Fi/LAN, chuẩn bị API HTTPS `:7240` và Metro `:8081`, kiểm tra `/health/ready` trước khi mở Expo. Nếu BE đã chạy từ Visual Studio trên `5240`/`7240`, launcher **dùng lại BE đó** (không chạy một BE thứ hai). Muốn thay cấu hình Kestrel/DB đang được BE sử dụng, phải dừng và khởi động lại BE.

| Nơi chạy Mobile | Địa chỉ Backend Development |
| --- | --- |
| Trình duyệt trên máy tính, `http://localhost:8081` | `https://localhost:7240` |
| Expo Go trên điện thoại cùng Wi-Fi/LAN | `https://<IP-LAN-của-PC>:7240` (tự động từ launcher) |

Không cần Quick Tunnel, không cần copy URL và không cần đặt IP cố định trong source. `src/mobile/.env.local` nên để `EXPO_PUBLIC_API_BASE_URL=` (trống). **Ngay cả khi file đó còn URL public cũ, lệnh `mobile:dev` vẫn ưu tiên API LAN đã xác minh** (dùng địa chỉ localhost làm dấu hiệu cấu hình local, địa chỉ LAN thật lấy từ `EXPO_PUBLIC_DEV_API_BASE_URL`), sau đó khôi phục biến môi trường cho terminal gọi. Để thử API staging/public, khởi động Expo độc lập thay vì dùng chế độ local này.

Điện thoại và máy tính phải ở mạng LAN cho phép truy cập ngang hàng; các mạng Wi-Fi có *client isolation* có thể chặn truy cập. HTTPS luôn xác minh chứng chỉ: trên iPhone cần cài và bật tin cậy chứng chỉ CA phát triển BHOME **một lần trên mỗi thiết bị/CA**, xem `docs/development/MOBILE_LIVE_WORKSPACE.md` và dòng `Public CA download` do `Prepare-OcrMobile.ps1` hiển thị. Không tắt TLS hay đưa PFX/private key lên điện thoại. Khi đổi Wi-Fi/IP, launcher sẽ làm mới chứng chỉ server và restart Metro để xuất QR phù hợp.

`Expo Go` có thể cần Internet/tài khoản Expo để khởi động dev client, **nhưng các request API BHOME không đi qua Cloudflare**. Mạng 4G/5G hoặc một mạng Wi-Fi khác sẽ không truy cập được BE LAN; khi thực sự cần kiểm thử từ xa hãy dùng staging HTTPS riêng hoặc VPN riêng tư như Tailscale.

Nếu chạy API riêng mà gặp `Failed to bind 0.0.0.0:5240: address already in use`, BE đã có tiến trình chiếm cổng: dùng lại BE đó, hoặc dừng tiến trình cũ bằng công cụ quản lý tiến trình trước khi chạy cái mới. Không đổi business rules, API contracts hay cấu hình DB cho mục đích này.

## Kiểm tra

```powershell
Invoke-WebRequest -UseBasicParsing https://localhost:7240/health/live
Invoke-WebRequest -UseBasicParsing http://localhost:8081/status
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests/scripts/MobileDevelopment.Tests.ps1
```

Trên điện thoại, mở `http://<IP-LAN-của-PC>:8081/status` trong Safari/Chrome và kiểm tra giá trị `packager-status:running`. Kết quả trên PC không thay thế được thử nghiệm kết nối từ điện thoại thật.
