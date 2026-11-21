# Mobile kẹt tải sau quét QR — 01/11/2026

## Phạm vi và kết quả chẩn đoán

Truy vết FE-02 / UC-01, NFR kết nối/HTTPS; nguồn: `AGENTS.md`,
`src/mobile/AGENTS.md`, các tài liệu mạng hiện có, mã Expo SDK 58 đang cài và
[Expo CLI](https://docs.expo.dev/more/expo-cli/). Không thay nghiệp vụ, quyền, DTO hoặc DB.

Người dùng xác nhận Expo Go kẹt trước màn đăng nhập và Safari trên iPhone không mở được
`http://192.168.0.106:8081/status`. Đây là bước truy cập Metro, trước khi chạy JS/gọi API.
Không thể kết luận `.local`, mật khẩu hay OCR controller là nguyên nhân của bước này.

Đã mở phiên kiểm chứng riêng trên máy hiện tại, API dùng LAN IPv4:

- Metro `/status` trả `packager-status:running` qua LAN từ Windows.
- Manifest iOS HTTP 200, SDK `58.0.0`, host và bundle cùng `192.168.0.106:8081`.
- Tải bundle iOS thật HTTP 200 (7.622.141 bytes); bundle dùng API LAN và không có URL
  `https://desktop-fovlaml.local:7240`. Dòng `iOS Bundled` trong phép thử này do **Windows
  probe yêu cầu bundle**, không phải bằng chứng iPhone đã tải được app.
- Wi-Fi Windows có profile Public; rule Node 22 cho TCP/Public đang Allow, remote/local Any;
  không tìm thấy inbound Block rule. Chưa đủ bằng chứng quy lỗi firewall. Không sửa firewall,
  trust store hoặc profile mạng.

## Sửa mã và tiêu chí chấp nhận

| Hành vi                             | Thành phần                        | Kiểm chứng                                                                                              |
| ----------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------- |
| IP LAN tự chọn là mặc định          | Supervisor                        | Không tự chọn `.local` khi chỉ Windows probe thành công; hostname là opt-in                             |
| Kiểm tra Metro riêng với API        | `Test-ExpoMobile.cjs`, supervisor | Đúng body `/status`, manifest iOS, URL bundle cùng origin; lỗi phải dừng/chỉ rõ bước Metro              |
| Phân biệt self-probe và thiết bị    | Supervisor                        | Self-IP/loopback không báo thiết bị; quan sát TCP peer mới báo kết nối; TCP chưa chứng minh tải JS xong |
| Không chia sẻ cấu hình Expo của máy | `.gitignore`                      | Bỏ qua mọi thư mục `.expo` theo [hướng dẫn Expo](https://docs.expo.dev/more/expo-cli/#expo-directory)   |

Không đổi dependency hoặc tự nâng Expo chỉ vì CLI thông báo có bản mới.
`--lan-api` vẫn dùng được; `--hostname-api` chỉ dành cho môi trường đã xác minh hostname
trên điện thoại. Không gửi credential trong probe hoặc tự tắt xác minh TLS.

## Dùng và phân biệt lỗi

Chạy tại root rồi quét QR mới:

```powershell
npm.cmd run mobile -- --clear
```

1. Trên iPhone Safari mở **đúng HTTP** `http://<IP-terminal>:8081/status`.
   Nếu không mở được, app chưa tới Metro: kiểm tra IP/mạng Wi-Fi của điện thoại, VPN, Local
   Network và router client isolation. Không sửa login/OCR để xử lý lỗi đường mạng này.
2. Nếu Safari tới được nhưng Expo Go không tới: cho phép Expo Go trong Settings → Privacy &
   Security → Local Network, mở lại Expo Go/quét QR, kiểm tra app/account/SDK tương ứng.
3. Sau khi JS đã tải/màn đăng nhập hiện, kiểm tra riêng
   `https://<IP-terminal>:7240/health/ready` và CA trust. Mở được Metro không chứng minh API
   HTTPS đã được tin cậy trên iPhone.
4. Không thấy thông báo peer chỉ có nghĩa chưa quan sát được TCP peer qua vòng poll; các request
   ngắn có thể đã kết thúc giữa hai lần kiểm tra. Không dùng thông báo này làm bằng chứng tuyệt đối.

## Kiểm tra thực chạy

| Lệnh/phạm vi                                                                                    | Kết quả thực chạy                                                                    |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `npm.cmd run test --workspace src/mobile`                                                       | PASS 199/199, 15 files                                                               |
| `powershell -NoProfile -ExecutionPolicy Bypass -File tests/scripts/MobileDevelopment.Tests.ps1` | PASS 56 assertions                                                                   |
| Mobile typecheck và lint                                                                        | PASS                                                                                 |
| ESLint launcher/probe và test thay đổi                                                          | PASS                                                                                 |
| Prettier các file thay đổi, `git diff --check`                                                  | PASS                                                                                 |
| `git check-ignore .expo/settings.json src/mobile/.expo/settings.json`                           | Hai đường dẫn được ignore                                                            |
| Lượt khởi động thực mặc định trên cổng 8082 (không `--lan-api`)                                 | PASS: chọn LAN IPv4, status + manifest iOS đạt từ Windows; đã dọn process kiểm chứng |
| Manifest và tải bundle iOS thực cổng 8081                                                       | HTTP 200 từ Windows; chi tiết ở trên                                                 |

Lượt harness thực ban đầu lỗi đọc logfile đang được process ghi và logfile rỗng; đã sửa
harness ignored trong `.tools` dùng `Get-Content -Raw`/chuỗi mặc định rồi chạy lại đạt.
Không sửa code sản phẩm để bỏ qua các lỗi test. Không chạy toàn bộ backend regression vì
không sửa C# hoặc DB. API dùng CA hiện có, không thay trust store/firewall.

**Chưa xác minh iPhone tải được app**. Người dùng xác nhận Safari không tới Metro; đang cần
IP Wi-Fi của điện thoại và kết quả sau tắt VPN để phân biệt đường mạng/thiết bị. Không đánh
dấu lỗi kết nối vật lý đã giải quyết chỉ vì test, manifest hoặc bundle từ Windows đạt.

Tệp sửa: `scripts/Start-OcrMobileApp.ps1`, `scripts/Start-ExpoMobile.cjs`,
`scripts/Test-ExpoMobile.cjs`, `.gitignore`, test launcher/Expo connectivity và tài liệu mạng.
Không có migration, thay đổi quyền server hoặc credential được ghi vào source.
