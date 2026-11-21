# Mobile thích ứng khi đổi mạng — 01/11/2026

Luồng cho nhiều máy được bổ sung sau bản sửa này: xem
[Mobile development cho team](MOBILE_TEAM_DEVELOPMENT.md), gồm hostname được kiểm chứng,
fallback LAN, chuẩn bị model trên máy clone mới và cấu hình Visual Studio.

## Phạm vi và truy vết

Yêu cầu: sửa lỗi transport khi đăng nhập Mobile, thích ứng khi đổi mạng.
Đã đọc `AGENTS.md`, `src/mobile/AGENTS.md`, SRS thực tế tại
`docs/reports/BHome_Report-3_Software Requirement Specification (2).docx`
(UC-01, NFR HTTPS/TLS), `docs/api/API_CONVENTIONS.md` (login/refresh/reuse),
tài liệu mạng/iPhone và code/test liên quan. Không thay nghiệp vụ, quyền, API contract,
provider hoặc schema. Không có DBR/JOB mới. Quy tắc quyền/privacy GBR-01/02/13 theo
guardrail repository tiếp tục được giữ; không suy diễn mapping GBR từ tên tài liệu cũ.

| Hành vi                                                         | Thành phần                               | Kiểm thử chấp nhận                                                                                               |
| --------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| UC-01/NFR kết nối: địa chỉ không gắn với IP DHCP                | `apiEndpoint`, launcher, TLS preparation | Đổi IP manifest giữ tên API `.local`; ưu tiên public HTTPS; release bỏ dev URL                                   |
| NFR khả dụng: phục hồi yêu cầu đọc khi mạng chập chờn           | `MobileApi`                              | GET retry đúng một lần/cùng origin; cancellation dừng chờ; POST không retry                                      |
| UC-01/NFR bảo mật: không làm mất phiên do offline trước refresh | `MobileSessions`, `SessionProvider`      | Probe anonymous lỗi giữ SecureStore; reconnect coalesced; background không poll; foreground phục hồi             |
| Chính sách refresh hiện có                                      | `MobileSessions`, backend không đổi      | Mất phản hồi refresh đã gửi không retry token; logout thắng request đang chờ; khác origin/CA không nhận token cũ |
| UC-01: form theo địa chỉ hiện tại                               | `LoginScreen`                            | Dùng `baseUrl` hiện tại khi người dùng chưa override cấu hình                                                    |

## Nguyên nhân và thay đổi

Resolver cũ dùng IP trong manifest và provider chỉ tạo resolver lúc mount. App đã tải không
nhận IP mới khi launcher khởi động lại Metro. Ngoài ra public API cấu hình có thể bị LAN
manifest ghi đè. Launcher hiện truyền tên DNS `<computer-name>.local`; TLS SAN/AllowedHosts
được chuẩn bị cho cùng tên và IP hiện tại. CA cũ được giữ khi cấp lại leaf certificate.
API HTTPS public cấu hình được ưu tiên để phục vụ Wi-Fi/4G; private IPv4 legacy vẫn có
fallback theo manifest khi không dùng launcher.

Client thêm retry có giới hạn cho read, readiness probe trước refresh và phục hồi phiên
khi app foreground. Chỉ probe bị lỗi mới được thử lại tự động; refresh đã gửi vẫn giữ chính
sách chống reuse hiện có. Không lưu access token vào SecureStore, không log credential.
Login form lấy URL mới từ session cho đến khi người dùng nhập override.

## Cách kiểm chứng trên thiết bị

1. Chạy `npm.cmd run mobile:dev` tại root. Máy chủ/DB/storage phải sẵn sàng; launcher chỉ mở
   Metro sau HTTPS readiness. Quét QR mới một lần để nhận bản sửa và hostname ổn định.
2. Điện thoại cùng LAN, bật Local Network và trust CA public của máy theo
   [checklist iPhone](IPHONE_CONNECTIVITY.md). Mở Safari
   `https://<computer-name>.local:7240/health/ready`: phải Healthy, không cảnh báo TLS.
3. Cho máy và điện thoại chuyển sang LAN khác có mDNS; giữ launcher chạy. Khi Windows cập
   nhật certificate/config, app đã tải tiếp tục dùng cùng hostname. Không cần sửa IP.
   Nếu cần reload Expo, quét QR Metro mới. Router chặn mDNS/client isolation cần xử lý ở mạng
   hoặc dùng API public, app không thể tự vượt qua.
4. Tắt mạng khi khởi động app có phiên đã lưu: không gửi refresh token, giữ credential.
   Bật lại mạng: phiên phục hồi khi active; không có refresh song song. Thử logout trong
   khi chờ mạng: không tự đăng nhập lại.
5. Với API HTTPS public đã cấu hình, chuyển Wi-Fi → 4G/5G và gọi lại API.
   Kiểm tra thao tác ghi không tự gửi lại khi mất phản hồi; tải lại để đối chiếu trạng thái.

## Tài liệu API nền tảng đã đối chiếu

- [Expo Constants SDK 58](https://docs.expo.dev/versions/v58.0.0/sdk/constants/): manifest host là thông tin Expo, không phải discovery API backend.
- [React Native AppState](https://reactnative.dev/docs/appstate): foreground/background và cleanup subscription.
- [Microsoft New-SelfSignedCertificate](https://learn.microsoft.com/en-us/powershell/module/pki/new-selfsignedcertificate): DNS/IP subject alternative names cho leaf certificate.

## Kết quả kiểm chứng

Các lệnh npm chạy bằng Node 22 từ `.tools` qua `Use-LocalTools.ps1`.

| Lệnh/phạm vi                                                                                       | Kết quả thực chạy                                                                                                  |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `npm.cmd run test --workspace src/mobile`                                                          | PASS 164/164, 13 files                                                                                             |
| `npm.cmd run typecheck --workspace src/mobile`                                                     | PASS                                                                                                               |
| `npm.cmd run lint --workspace src/mobile`                                                          | PASS                                                                                                               |
| ESLint bốn file test Mobile thay đổi                                                               | PASS                                                                                                               |
| `powershell -NoProfile -ExecutionPolicy Bypass -File tests/scripts/MobileDevelopment.Tests.ps1`    | PASS 26 assertions, gồm giữ API DNS qua hai mạng giả lập                                                           |
| `Prepare-OcrMobile.ps1 -SkipDatabase`                                                              | PASS; cập nhật leaf SAN DNS và Development User Secrets, giữ CA hiện có; không migrate DB/trust store/firewall     |
| `Diagnose-MobileApi.cjs https://desktop-fovlaml.local:7240 .tools/mobile-tls/root-ca.cer`          | PASS: live/ready 200; Contracts anonymous 401; TLS authorized; SAN DNS khớp; CA sai và TLS hostname sai bị từ chối |
| `expo export --platform ios --output-dir ../../.tools/mobile-network-recovery-ios` từ `src/mobile` | PASS; Hermes bundle 3,7 MB và assets; không phải native/device build                                               |
| Prettier code/test và `git diff --check`                                                           | PASS                                                                                                               |

Lượt test đầu: 147/153, sáu fixture cũ chưa mô phỏng readiness trước refresh; đã cập nhật fixture
và thêm kiểm thử các nhánh phục hồi trước khi chạy lại đạt 164/164. Một số lệnh shell đầu lỗi
ExecutionPolicy/quoting/working directory; đã chạy lại thành công bằng PowerShell process có
ExecutionPolicy Bypass, Node 22 và đúng thư mục. Không đổi policy toàn máy.

API chỉ được mở để probe HTTPS, sau đó đã dừng đúng cây process do phiên kiểm thử tạo.
Log/export nằm trong `.tools` ignored. Khởi động phiên phát triển bình thường bằng
`npm.cmd run mobile:dev`, quét QR một lần để nhận bundle mới. Chưa xác minh chuyển
Wi-Fi/4G trên iPhone vật lý hoặc API public triển khai; chưa chạy toàn bộ backend regression.
Không sử dụng tài khoản thật hay gửi credential vào probe HTTPS.

## Tệp thay đổi

- Mobile: `src/mobile/src/lib/apiEndpoint.ts`, `api.ts`, `sessions.ts`,
  `SessionProvider.tsx`; `src/mobile/src/screens/LoginScreen.tsx`.
- Launcher/TLS: `scripts/MobileNetwork.ps1`, `Prepare-OcrMobile.ps1`, `Start-OcrMobileApp.ps1`.
- Test: `tests/mobile/ocr/apiEndpoint.test.ts`, `connectivity.test.ts`, `sessions.test.ts`,
  `sessionProvider.test.tsx`; `tests/scripts/MobileDevelopment.Tests.ps1`.
- Tài liệu: `README.md`, `docs/development/MOBILE_NETWORK_DEVELOPMENT.md`, tài liệu này.

`package-lock.json` và `src/mobile/package.json` đã được người dùng sửa trước phiên này;
không chỉnh các thay đổi đó hoặc thêm dependency.
