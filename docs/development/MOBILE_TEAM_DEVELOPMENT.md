# Mobile development cho nhiều máy trong team

**Sửa hồi quy sau phản hồi quét QR bị kẹt:** mặc định dùng IP LAN, không tự chọn `.local`.
Chỉ dùng hostname qua `--hostname-api` sau khi xác minh trên điện thoại. Chi tiết và kết quả
kiểm tra mới tại [Mobile QR loading](MOBILE_QR_LOADING_FIX.md); số liệu dưới đây là lượt trước.

## Phạm vi và tiêu chí

Yêu cầu trực tiếp 01/11/2026: cùng checkout chạy được trên các máy phát triển khác nhau,
không giữ địa chỉ của máy trước. Truy vết UC-01 / FE-02 và NFR kết nối, HTTPS/privacy theo
`AGENTS.md`, SRS hiện có tại `docs/reports`, `docs/api/API_CONVENTIONS.md` và
`MOBILE_NETWORK_RECOVERY.md`. Không thay API nghiệp vụ, role, schema, policy hoặc provider.

| Yêu cầu                      | Thành phần                            | Tiêu chí chấp nhận                                                                                                                                        |
| ---------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chọn đúng máy hiện tại       | Resolver Mobile, launcher             | Local IPv4/IPv6, localhost hoặc `.local` cũ không ghi đè URL launcher; public HTTPS explicit vẫn ưu tiên                                                  |
| Máy/mạng thiếu mDNS          | Launcher, HTTPS readiness probe       | Chỉ chọn hostname sau khi probe đúng IP LAN + CA/hostname/body/status; thất bại tự dùng IP LAN; có cờ ép LAN cho điện thoại không phân giải được hostname |
| Máy clone mới chưa có models | Launcher, `Get-OcrModels.ps1` hiện có | Chuẩn bị bộ model qua script kiểm checksum trước mở API; lỗi tải phải hiển thị trước khi mở Metro                                                         |
| Visual Studio trên máy mới   | Prepare/User Secrets                  | Đồng bộ cấu hình backend từ `.env` local qua stdin; không in secret hoặc dùng secret máy khác                                                             |
| Isolation giữa máy A/B       | SecureStore/server binding hiện có    | Không gửi refresh token máy A sang máy B, kể cả cùng IP hoặc cùng tên máy                                                                                 |

## Kiểm chứng

Kiểm thử mô phỏng nhiều máy không thay thế chạy trên từng máy/điện thoại của team. CA trust,
Local Network, firewall/router và khả năng truy cập API qua 4G vẫn phụ thuộc môi trường;
không thể tự bỏ qua trong app.

| Lệnh/phạm vi                                                                                    | Kết quả thực chạy                                                                                                                             |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm.cmd run test --workspace src/mobile`                                                       | PASS 188/188, 14 files                                                                                                                        |
| `powershell -NoProfile -ExecutionPolicy Bypass -File tests/scripts/MobileDevelopment.Tests.ps1` | PASS 52 assertions: máy A/B, đổi mạng, hostname thiếu/không hợp lệ, ép LAN, model thiếu/tải lỗi, giữ debugger và reject API của checkout khác |
| `npm.cmd run typecheck --workspace src/mobile`                                                  | PASS                                                                                                                                          |
| `npm.cmd run lint --workspace src/mobile`                                                       | PASS                                                                                                                                          |
| ESLint các file Node/test sửa trong lượt này                                                    | PASS                                                                                                                                          |
| API HTTPS thật + probe mới trên Windows hiện tại                                                | PASS: LAN và hostname đúng CA/IP/body; reject expected IP khác; giữ nguyên CA cũ                                                              |
| Prettier các file thay đổi và `git diff --check`                                                | PASS                                                                                                                                          |

API thật được mở bằng launcher riêng chỉ trong phiên kiểm chứng rồi dừng đúng cây process
đã tạo. Không migrate/reset database, sửa firewall/trust store hoặc dùng tài khoản thật.
Prepare đồng bộ Development User Secrets theo `.env` local; log/harness ở `.tools` ignored.
Lượt harness đầu thất bại vì fixture giữ số lượt gọi IP từ scenario trước; đã reset fixture
và chạy lại đạt 52/52. Bộ model download dùng script checksum hiện có; test máy mới/tải lỗi
mô phỏng ranh giới download, không tuyên bố đã tải trên máy teammate thật.

Chưa thử trên các laptop/iPhone thực tế của team hoặc macOS/Linux; chưa chạy toàn bộ backend
regression/native export trong lượt này (không sửa C# hoặc thêm native module).

Tài liệu đã đối chiếu: [Expo Constants SDK 58](https://docs.expo.dev/versions/v58.0.0/sdk/constants/)
và [biến môi trường Expo](https://docs.expo.dev/guides/environment-variables/). URL do launcher
truyền là cấu hình cho bundle hiện tại; phải reload khi chuyển sang máy/manifest khác.

## Cách dùng cho từng thành viên

1. Cài Node 22.13–22.x, .NET 8 SDK và chạy `npm ci` ở root. Chuẩn bị PostgreSQL/MinIO,
   database/migrations theo [Local development](LOCAL_DEVELOPMENT.md). `.tools` của máy hiện
   tại không được commit; máy khác cần có công cụ tương ứng của riêng mình.
2. Chạy `npm.cmd run mobile` hoặc `npm.cmd run mobile:dev` tại root. Nếu chưa có `.env`,
   launcher tạo file local với secret ngẫu nhiên. Cấu hình DB/storage phải khớp dịch vụ local;
   không sao chép `.env`/PFX/private key từ thành viên khác. Model OCR còn thiếu được tải qua
   script checksum sẵn có trước khi mở API. Mất Internet/tải lỗi dừng sớm, không mở Metro giả sẵn sàng.
3. Launcher chọn LAN, chuẩn bị CA/leaf certificate của máy hiện tại, dùng lại API đúng checkout
   hoặc mở API riêng; `/health/ready` phải trả 200 và body `Healthy` qua TLS hợp lệ.
   Database thiếu migration cần nâng cấp có chủ đích, không reset hay tự migrate từ launcher.
4. Mặc định dùng IP LAN. Nếu chủ động bật `--hostname-api`, hostname chỉ được dùng sau probe
   HTTPS với CA và remote IP đúng LAN; nếu thất bại, tự fallback IP LAN.
   Mỗi laptop có CA riêng. Visual Studio nhận DB/JWT/storage/network config từ
   `.env` local bằng User Secrets qua stdin; không in secret hoặc đặt secret trên process command line.
5. Điện thoại cùng LAN, cài/trust **CA public của đúng máy đang quét QR** một lần, bật Local
   Network và quét QR của thành viên đó. Hướng dẫn tại [checklist iPhone](IPHONE_CONNECTIVITY.md).
   Khi chuyển sang máy khác, đăng nhập tài khoản trong DB của máy mới; không dùng lại refresh
   token của máy cũ, kể cả trùng IP hoặc hostname. Đây là isolation có chủ đích.

Nếu Windows truy cập `.local` được nhưng điện thoại không được, khởi động lại:

```powershell
npm.cmd run mobile -- --lan-api
```

Lệnh vẫn tự chọn IP, certificate và CA, không sửa IP trong `.env.local`. Khi IP thay đổi ở chế
độ LAN, quét QR/reload để nhận địa chỉ mới. Chế độ hostname đã kiểm chứng giữ địa chỉ API
ổn định cho app đã tải; tải lại Expo trên mạng mới vẫn cần QR Metro mới.

Nếu team dùng một API triển khai chung qua HTTPS, đặt `EXPO_PUBLIC_API_BASE_URL` trong
`src/mobile/.env.local` theo [mẫu](../../src/mobile/.env.example), rồi chỉ mở Metro:

```powershell
npm.cmd run mobile -- --metro-only --lan
```

Không copy `EXPO_PUBLIC_DEV_SERVER_ID`/`EXPO_PUBLIC_DEV_API_BASE_URL` giữa máy; launcher
tạo các giá trị này trong process, không ghi IP/cert/password vào Git. Public API HTTPS
explicit vẫn được ưu tiên trong app. Tunnel Expo chỉ phục vụ Metro, không tự public backend.

## Giới hạn

Supervisor/cấp CA hiện dành cho Windows, phù hợp script của repository. macOS/Linux dùng
Metro riêng với API HTTPS đã chuẩn bị; chưa bổ sung supervisor đa hệ điều hành. Các máy
có thể chạy cùng port 7240/8081 vì mỗi máy có địa chỉ riêng. Không có thay đổi schema hoặc
quyền backend. Mạng chặn thiết bị ngang hàng, thiếu trust CA hoặc chưa chạy DB/storage vẫn
cần chuẩn bị môi trường; code không tắt TLS/firewall để vượt các điều kiện này.

## Tệp được bổ sung/sửa trong lượt này

- `scripts/MobileNetwork.ps1`, `Prepare-OcrMobile.ps1`, `Start-OcrMobileApp.ps1`,
  `Start-ExpoMobile.cjs`, `Test-MobileApi.cjs`.
- `src/mobile/src/lib/apiEndpoint.ts`, `src/mobile/.env.example`.
- `tests/scripts/MobileDevelopment.Tests.ps1`, `tests/mobile/ocr/apiEndpoint.test.ts`,
  `expoStartup.test.ts`, `mobileApiProbe.test.ts`.
- `README.md`, `MOBILE_NETWORK_DEVELOPMENT.md`, `MOBILE_NETWORK_RECOVERY.md`, tài liệu này.

Không chỉnh các thay đổi dependency có sẵn trong `package-lock.json`/`src/mobile/package.json`.
