# Mobile development: tự chọn địa chỉ mạng

> Khi readiness trả 503 hoặc iPhone không tải được dữ liệu, xem
> [chẩn đoán và checklist iPhone](IPHONE_CONNECTIVITY.md), gồm đường nâng cấp có bảo toàn
> dữ liệu từ migration CaptureWorkflows cũ. Không reset DB hoặc sửa history để né lỗi.

## Cách dùng chung cho team trên Windows

Từ repository root, mỗi người chạy cùng một lệnh:

```powershell
npm.cmd run mobile:dev
```

Trên Windows, `npm.cmd run mobile` từ root hoặc `npm.cmd start` trong `src/mobile` dùng cùng
supervisor. Tham số `-- --clear` và `-- --port 8082` được chuyển thành tham số PowerShell tương ứng.
IP LAN tự chọn là mặc định. `-- --lan-api` giữ tương thích; chỉ dùng `-- --hostname-api`
khi đã kiểm tra `.local` hoạt động trên điện thoại. Hai cờ này không dùng cùng nhau.
Chỉ dùng `-- --metro-only` khi đã tự chuẩn bị/chạy API; cờ này bỏ qua supervisor, vẫn giữ kiểm tra
Expo online/tài khoản. `--check` chỉ kiểm tra Expo, không xác nhận API BHOME sẵn sàng.
Xem [lỗi đăng nhập do API/TLS/migration](MOBILE_LOGIN_CONNECTION_FIX.md).

Quét QR hoặc mở URL Expo do terminal in ra trên điện thoại cùng LAN/Wi-Fi. Không nhập IP,
không sửa `.env.local`, không dùng IP của máy thành viên khác. Giữ terminal này chạy.
Đăng nhập BHOME bằng email; tài khoản và database thuộc backend đang phục vụ QR đó.

Script tự chọn IPv4 private trên adapter hoạt động có default gateway, theo tổng route metric
và interface metric; loại VPN/card mạng ảo đã biết. Script chuẩn bị chứng chỉ HTTPS theo IP đó,
đồng bộ User Secrets Development và buộc Expo quảng bá cùng địa chỉ.
Nếu API của checkout đang debug thì dùng lại; nếu chưa chạy, script tự mở API và chỉ mở Expo
sau khi HTTPS `/health/ready` trả 200 với chain/hostname hợp lệ theo CA local.
Không tự dừng API/Metro của checkout khác khi cổng bị chiếm.

Khi đổi Wi-Fi trong lúc chạy, script phát hiện theo chu kỳ khoảng 3 giây (cộng thời gian truy vấn
mạng), cấp lại chứng chỉ server bằng CA cũ, cập nhật cấu hình API và restart Metro do nó tạo.
**Quét QR mới** để Expo Go tải manifest trên mạng mới; không sửa cấu hình IP.
**Sửa hồi quy 01/11/2026:** mặc định dùng IP LAN tự chọn cho API lẫn Metro. Không tự chọn
`.local` từ kết quả probe Windows vì kết quả đó không chứng minh iPhone hỗ trợ mDNS.
Chỉ khi bật `--hostname-api`, launcher kiểm tra hostname bằng CA/IP LAN hiện tại trước khi
chọn; nếu không đạt thì dùng IP LAN. Tên máy không hợp lệ cho DNS cũng dùng IP LAN.
URL hiện tại được truyền qua `EXPO_PUBLIC_DEV_API_BASE_URL`; SAN/AllowedHosts cho phép đúng
DNS/IP. Ở chế độ IP LAN, quét QR/reload sau đổi mạng để nhận URL mới. Máy chủ kiểm tra được
hostname không chứng minh điện thoại cũng phân giải được; dùng `--lan-api` khi cần.
Launcher kiểm tra thêm Metro `/status` và manifest iOS; ghi rõ đây là phép thử từ máy tính.
Xem [hướng dẫn nhiều máy trong team](MOBILE_TEAM_DEVELOPMENT.md) và
[chẩn đoán QR bị kẹt](MOBILE_QR_LOADING_FIX.md).
Mất Wi-Fi tạm thời giữ nguyên tiến trình và chờ mạng trở lại.
Khi dừng launcher, nó chỉ dọn API/Metro do nó tạo, giữ API đang debug từ trước.
Không chạy thêm một Metro độc lập trên cùng cổng. Tùy chọn `-- -Port 8082` dùng cho phiên riêng.

## Đổi giữa Wi-Fi và 4G/5G

API local không thể truy cập từ Internet chỉ bằng việc đổi IP trong ứng dụng. Để điện thoại
dùng qua mạng khác, cung cấp API đã triển khai qua HTTPS với chứng chỉ được thiết bị tin cậy,
cấu hình trong `src/mobile/.env.local` rồi khởi động lại Metro:

```dotenv
EXPO_PUBLIC_API_BASE_URL=https://api.example.invalid
```

Thay hostname ví dụ bằng API BHOME thật của môi trường. URL HTTPS cấu hình bằng DNS/public IP
được ưu tiên cả khi Metro chạy LAN. Địa chỉ local cũ trong `.env.local` (private IPv4/IPv6,
loopback hoặc `.local`) không ghi đè URL của launcher hiện tại; chế độ Metro riêng tiếp tục
suy ra LAN từ manifest. Không suy ra API từ
tunnel Expo; tunnel Metro không làm API backend truy cập được từ Internet.

Yêu cầu GET/HEAD gặp mất kết nối được thử lại một lần sau 750 ms, cùng API origin; không retry
lỗi HTTP hoặc timeout. POST/PUT/PATCH/DELETE, upload, login và refresh không được tự gửi lại
khi kết quả chưa rõ. Trước mỗi refresh, client kiểm tra `/health/ready` không kèm credential.
Probe lỗi giữ refresh token trong SecureStore; khi app active, thử phục hồi mỗi 5 giây hoặc
khi trở lại foreground. Chỉ khi probe thành công mới gửi refresh. Nếu refresh đã gửi mà mất
phản hồi thì vẫn xóa credential/yêu cầu đăng nhập lại theo chính sách chống reuse của backend.
Không gửi credential sang origin khác, không hạ xuống HTTP hoặc bỏ xác minh chứng chỉ.

Chi tiết truy vết và kiểm chứng: [sửa lỗi thích ứng mạng Mobile](MOBILE_NETWORK_RECOVERY.md).

## Chuẩn bị một lần cho mỗi máy/điện thoại

- Máy phát triển đã cài Node 22.13–22.x, .NET 8 SDK, chạy `npm ci`; database/migrations,
  object storage và OCR models được chuẩn bị theo `LOCAL_DEVELOPMENT.md`/`OCR_MOBILE_DELIVERY.md`.
  Launcher tạo `.env` ngẫu nhiên nếu chưa có và tải models còn thiếu qua `Get-OcrModels.ps1`
  có kiểm checksum. Không tự migrate/reset database hoặc cài công cụ toàn máy.
- Lần đầu điện thoại kết nối **một máy phát triển mới**, cài và tin cậy CA public của máy đó
  từ URL `/development/mobile-ca.cer` do terminal in ra; xem hướng dẫn iPhone trong
  `OCR_MOBILE_DELIVERY.md`. Đây là bước tin cậy TLS của hệ điều hành, không thể tự chấp thuận
  trong Expo Go. Đổi Wi-Fi trên cùng máy giữ CA; không cài lại trừ khi CA phải được thay mới.
- Không chia sẻ `.env`, PFX, CA private key hoặc khóa identity giữa thành viên. Nếu cùng điện thoại
  test nhiều máy, tin cậy từng CA riêng. Điện thoại cần quyền Local Network và mạng phải cho phép
  các thiết bị truy cập nhau; tự chọn IP không vượt qua client isolation/firewall.

Nếu dùng Visual Studio, các thông số mạng của API phải đến từ Development User Secrets do
launcher đồng bộ. Không đặt `AllowedHosts` hoặc `Kestrel__*` cố định trong environment/launch profile;
các giá trị đó có ưu tiên cao hơn User Secrets và cản việc nạp IP/chứng chỉ mới.
`Start-OcrMobile.ps1` tự loại các override này trong process do nó khởi chạy.
Không đóng debugger để chạy thêm API vào cùng cổng; nếu cấu hình cũ không reload được, Stop/F5
một lần sau khi launcher đã chuẩn bị cấu hình.

## Thiết kế và truy vết

Yêu cầu trực tiếp 29/10/2026: đổi mạng và các máy team không phải cấu hình IP riêng.
Phạm vi: FE-02 / UC-01, GBR-01/02/13 và NFR HTTPS/privacy; SRS tại `docs/reports`,
Report 4 Authentication/Authorization và `JWT_EMAIL_AUTHENTICATION.md`.
Đây là sửa công cụ local development, không thay công nghệ/provider, quyền, trạng thái nghiệp vụ,
endpoint nghiệp vụ hoặc schema. Không có DBR/JOB nghiệp vụ mới hoặc migration.

Luồng: launcher → chọn adapter/default route → Prepare TLS/User Secrets → API readiness → Expo QR
→ `Constants.expoConfig.hostUri` → `resolveApiEndpoint` → `MobileSessions` → API HTTPS.

- `resolveApiEndpoint` chỉ suy ra `https://<IPv4 private của Metro>:7240` khi `__DEV__` bật.
  Release/standalone tiếp tục dùng HTTPS `EXPO_PUBLIC_API_BASE_URL`; không suy ra API từ manifest.
  LAN development ưu tiên manifest hơn IP cũ trong biến môi trường, kể cả trên máy đồng đội.
- Refresh token vẫn gắn với origin; Development còn gắn với fingerprint CA public của máy
  (`EXPO_PUBLIC_DEV_SERVER_ID` do launcher tự truyền). Hai máy vô tình có cùng IP cũng không
  dùng lại credential của nhau. Phiên cũ chưa có binding này yêu cầu đăng nhập lại một lần.
  Không thử gửi token cũ sang origin/máy mới, không dò/quét server trên mạng và không tự retry mutation.
- TLS vẫn kiểm tra CA/hostname; không dùng HTTP cho API dữ liệu hay tắt certificate validation.
  Endpoint-specific certificate trong User Secrets cho phép Kestrel reload dù process trước đó
  có cấu hình default certificate. CA/private key ở máy local; CA public tải bằng route Development.
- Chỉ cấp lại leaf certificate khi đổi IP, file thiếu/không đọc được hoặc sắp hết hạn; giữ khóa
  identity và CA còn phù hợp. Mỗi lần cập nhật mạng không chạy migration.

Nguồn API đã đối chiếu: [Expo SDK 58 Constants](https://docs.expo.dev/versions/v58.0.0/sdk/constants/),
[Expo CLI server URL](https://docs.expo.dev/more/expo-cli/#server-url),
[Kestrel reload endpoints](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/servers/kestrel/endpoints?view=aspnetcore-8.0#reload-endpoints-from-configuration).

## Kiểm chứng 29/10/2026

- `npm.cmd run test --workspace src/mobile`: **43 PASS**; gồm host của nhiều máy/subnet,
  IP cũ trong env, release build, host không hỗ trợ/không hợp lệ và isolation refresh token,
  kể cả hai developer dùng trùng IP nhưng khác CA.
- `npm.cmd run typecheck --workspace src/mobile`, `npm.cmd run lint --workspace src/mobile`: PASS.
- `powershell -NoProfile -ExecutionPolicy Bypass -File tests/scripts/MobileDevelopment.Tests.ps1`:
  **26 assertions PASS**, adapter/route metric, VPN, mất mạng tạm thời, đổi IP, restart Metro,
  tự mở/dọn API riêng, giữ debugger, cổng bị chiếm và HTTPS readiness lỗi. Các nhánh đổi adapter
  và lifecycle này dùng OS/process boundaries giả trong checkout tạm, không đổi NIC/database thật.
- Launcher thật ở cổng test 8082: manifest HTTP 200 với `hostUri=10.33.59.31:8082`;
  bundle iOS HTTP 200 chứa resolver/host Expo và email login; kiểm chứng HTTPS readiness bằng CA local PASS.
- `expo export --platform ios --output-dir ../../.tools/mobile-auto-ios` từ `src/mobile`: PASS,
  bundle Hermes và assets xuất thành công. Root ESLint cũng PASS.
- Ép nhánh gia hạn leaf certificate trên IP hiện tại: API giữ nguyên PID debugger, HTTPS PASS,
  CA và identity keys không đổi; chạy Prepare lần nữa không đổi certificate. Harness local
  tại ignored `.tools/Test-MobileTlsReload.ps1`, không đổi cấu hình adapter mạng thật.

Chưa xác minh: chuyển Wi-Fi vật lý khi Expo Go đang mở, toàn bộ máy thành viên, một điện thoại
qua nhiều CA, chạy bản release trên thiết bị hoặc hệ điều hành phát triển khác Windows. Không sửa C# nên không
build/test lại backend suite; kiểm tra API thật ở trên không thay thế toàn bộ backend regression.
