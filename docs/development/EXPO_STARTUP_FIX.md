# Sửa lỗi Expo Go/Metro ngày 30/10/2026

> Cập nhật 31/10/2026: trên Windows, `npm start` mặc định chạy supervisor API + HTTPS + Metro.
> Muốn chỉ mở Metro dùng `npm start -- --metro-only`. `--check` vẫn chỉ kiểm tra Expo.
> Xem [chẩn đoán lỗi đăng nhập và kết quả sửa](MOBILE_LOGIN_CONNECTION_FIX.md).

## Nguyên nhân đã kiểm chứng

CLI đang đăng nhập đúng tài khoản Expo Go, nhưng Metro cũ ở cổng 8081 trả manifest iOS
HTTP 200 thiếu `extra.expoGo.username`. Mã Expo CLI đang cài cho thấy:

- `api/rest/client.js` gọi `disableNetwork()` khi lỗi DNS/connect timeout.
- `api/settings.js` đặt `EXPO_OFFLINE=1` trong tiến trình và in “Networking has been disabled”.
- `api/user/user.js` không truy vấn tài khoản khi offline, nên manifest có thể thiếu username.
- `api/rest/wrapFetchWithOffline.js` gắn signal đã abort vào request khi offline;
  GraphQL client bọc lỗi này thành `UnexpectedServerError`, dẫn đến lỗi manifest HTTP 500.

Internet tới Expo có lúc timeout trong lượt kiểm tra. Chưa có bằng chứng xác định nguyên nhân
ngoài máy như ISP/VPN. Khởi động lại Metro sau khi kết nối phục hồi đã sửa manifest.
Không sửa manifest, bỏ kiểm tra tài khoản, tắt TLS hoặc vá `node_modules`.

[Expo CLI authentication](https://docs.expo.dev/more/expo-cli/#authentication) quy định tài khoản
Expo Go iPhone phải khớp CLI; [offline mode](https://docs.expo.dev/more/expo-cli/#offline)
có thể tự bật khi mất kết nối. Đã đọc tài liệu SDK 58 và đối chiếu source CLI thực tế.

Node mặc định là 24.22.1, trong khi repo yêu cầu >=22.13 và <23 và đã có Node 22.23.4 trong `.tools`.
Không coi Node 24 là nguyên nhân đã chứng minh của lỗi mạng; launcher cần chọn runtime đúng repo.

## Phạm vi và thay đổi

Sửa NFR môi trường phát triển/kết nối; không thay BF, nghiệp vụ UC-01, phân quyền hoặc JWT BHOME.
Đã đọc AGENTS toàn repo/mobile, package.json, source Expo và scripts/tài liệu kết nối hiện có.

- `scripts/Start-ExpoMobile.cjs`: chọn Node 22 local nếu runtime mặc định không phù hợp;
  tải môi trường như Expo, kiểm tra metadata SDK và `expo whoami` có timeout trước khi mở Metro.
  Dùng cùng HTTP transport với Expo để hỗ trợ HTTP_PROXY và giữ nguyên TLS. Không in credential,
  session hoặc stderr của lệnh kiểm tra; không tự đăng nhập/đăng xuất.
- Khi offline/mất mạng/API Expo lỗi/không xác minh được tài khoản: dừng với hướng xử lý,
  không tiếp tục mở Metro như thể kiểm tra đã thành công.
- `src/mobile/package.json`: `npm start` đi qua launcher; tham số Expo như `--clear`, `--port`
  được chuyển tiếp bằng argument array.
- `scripts/Start-OcrMobileApp.ps1`: supervisor hiện có dùng launcher mới khi chạy hoặc đổi Wi-Fi;
  giữ kiểm tra API HTTPS và chỉ quản lý process do chính nó tạo.
- Tests: `tests/mobile/ocr/expoStartup.test.ts` và assertion launcher trong
  `tests/scripts/MobileDevelopment.Tests.ps1`.

Tiêu chí chấp nhận: chọn Node 22, chặn lỗi kết nối/tài khoản trước Metro, manifest iOS đúng username,
bundle HTTP 200, không đổi dependencies, database, secrets hoặc tài khoản. Không migration.

## Cách chạy

Trong `src/mobile`:

```cmd
npm start -- --clear
```

Chỉ kiểm tra môi trường: `npm start -- --check`. Từ root: `npm run mobile -- --clear`.
Supervisor API + Metro vẫn dùng `npm run mobile:dev -- -Clear`.
`npx expo start` là CLI trực tiếp và bỏ qua kiểm tra của launcher BHOME.

Nếu phiên hết hạn, tự chạy `npx expo login` trong terminal với cùng tài khoản Expo Go.
Nếu báo lỗi mạng, kiểm tra Internet/proxy/VPN rồi thử lại. Metro đã tự chuyển offline cần được
dừng và chạy tiến trình mới. Không yêu cầu người dùng gửi password/token qua chat.

## Kiểm chứng đã thực hiện

- `node scripts/Start-ExpoMobile.cjs --check`: PASS, tự dùng Node 22 và xác minh tài khoản.
  Một lần trước đó timeout tới Expo và dừng đúng trước Metro; chạy lại khi mạng phục hồi đã PASS.
- `npm run test --workspace src/mobile`: PASS 142/142, gồm 6 test launcher mới.
- `powershell -NoProfile -ExecutionPolicy Bypass -File tests/scripts/MobileDevelopment.Tests.ps1`:
  PASS 26 assertions về chọn mạng/supervisor, dùng OS/process giả lập.
- `npm run typecheck --workspace src/mobile`, `npm run lint --workspace src/mobile`:
  PASS với Node 22.23.4.
- `npm exec -- eslint scripts/Start-ExpoMobile.cjs tests/mobile/ocr/expoStartup.test.ts --max-warnings 0`:
  PASS. Prettier và `git diff --check`: PASS.
- Chỉ dừng Metro có PID/executable/command line khớp checkout này; không dừng API/debugger.
  Khởi động lại trên `exp://192.168.0.106:8081` bằng Node 22.
- Manifest iOS thực tế: HTTP 200, username khớp CLI, có launch asset.
  Bundle iOS thực tế: HTTP 200, 7.618.214 bytes. Chỉ in trạng thái/kích thước, không in bundle.

Chưa thao tác trực tiếp trên iPhone để xác nhận ứng dụng mở được. Probe máy tính không thay thế
native E2E, quyền mạng cục bộ hoặc cấu hình tin cậy CA của API HTTPS trên thiết bị.

## Sửa dependency bundle web ngày 01/11/2026

Phạm vi: NFR môi trường phát triển, không thay đổi BF/UC/GBR/DBR/JOB nghiệp vụ.
Yêu cầu: sửa `Unable to resolve "react-native-web/dist/index"` khi Metro nhận yêu cầu web.
Đối chiếu `src/mobile/package.json`, dependency thực tế và
[hướng dẫn Expo web](https://docs.expo.dev/workflow/web/): workspace thiếu `react-native-web`
và chưa khai báo trực tiếp `react-dom`, `@expo/metro-runtime`.

Đã chạy `expo install react-dom react-native-web @expo/metro-runtime --npm` bằng Node 22.23.4
trong `src/mobile`. Expo chọn phiên bản tương thích SDK 58; `react-dom` khớp React 19.3.0
của mobile. Cập nhật manifest và lockfile để `npm ci` cài đủ dependency trên máy khác.

Tiêu chí chấp nhận: Expo export web giải quyết được import bị thiếu, export iOS vẫn thành công,
typecheck/lint và test mobile hiện có không lỗi. Kiểm chứng đã thực hiện bằng Node 22.23.4:

- `expo export --platform web --output-dir ../../.tools/expo-web-dependency-fix`: PASS.
- `expo export --platform ios --output-dir ../../.tools/expo-web-fix-ios`: PASS.
- `npm.cmd run typecheck --workspace ./src/mobile`: PASS.
- `npm.cmd run lint --workspace ./src/mobile`: PASS.
- `npm.cmd run test --workspace ./src/mobile`: PASS, 199 test / 15 file.

Chạy lại từ root bằng `npm.cmd run mobile -- --clear`. Thông báo
`No device TCP connection observed yet` là cảnh báo kết nối thiết bị riêng;
export/test trên máy tính không xác nhận kết nối hoặc thao tác thực tế trên iPhone.

## Sửa lỗi SessionProvider trên web ngày 01/11/2026

Traceability: khởi động web sau khi bundle thành công → NFR tương thích nền tảng,
UC-01 / GBR-01, GBR-13 về phiên đăng nhập và bảo vệ thông tin → `captureFiles.ts`,
`credentialStore.ts`, `SessionProvider.tsx`, `LoginScreen.tsx` → kiểm tra cleanup theo nền tảng,
đăng nhập/đăng xuất, đăng nhập bị từ chối và tải lại trang.

Nguyên nhân: `clearAbandonedCaptures()` chạy trên mọi nền tảng, gọi `Paths.cache` rồi
`new Directory(...)`. Implementation web không có `validatePath`, khiến effect khởi tạo
SessionProvider ném lỗi và giao diện dừng hoạt động. Đối chiếu source dependency đã cài và
[Expo FileSystem SDK 58](https://docs.expo.dev/versions/v58.0.0/sdk/filesystem/): API này dành cho
native. [SecureStore SDK 58](https://docs.expo.dev/versions/v58.0.0/sdk/securestore/) cũng không
hỗ trợ web; chỉ sửa cleanup sẽ còn lỗi lưu phiên khi đăng nhập.

- Web bỏ qua cleanup thư mục cache native; iOS/Android vẫn xóa các thư mục tạm như trước.
- Credential store trên web chỉ giữ token trong bộ nhớ của SessionProvider. Tải lại/đóng trang
  hoặc unmount provider kết thúc phiên ở client; không ghi token vào localStorage/sessionStorage.
- iOS/Android tiếp tục dùng SecureStore với cùng key và `WHEN_UNLOCKED_THIS_DEVICE_ONLY`.
- Màn đăng nhập mô tả đúng thời hạn lưu phiên trên web. Không đổi endpoint, phân quyền backend,
  schema, dependency hay quy trình xử lý ảnh native.

Kiểm chứng bằng Node 22.23.4:

- `npm.cmd run test --workspace ./src/mobile`: PASS, 207 test / 17 file, gồm regression mới
  tại `captureFiles.test.ts`, `credentialStore.test.ts` và `sessionProvider.test.tsx`.
- `npm.cmd run typecheck --workspace ./src/mobile`, `npm.cmd run lint --workspace ./src/mobile`
  và ESLint riêng ba file test: PASS.
- `expo export --platform web --platform ios --output-dir ../../.tools/expo-session-web-fix`: PASS.
- Edge headless + Playwright, API giả lập với dữ liệu tổng hợp: tái hiện lỗi `validatePath` trên
  export cũ; bản sửa hiện màn đăng nhập, từ chối sai thông tin, đăng nhập Tenant thành công,
  tải lại quay về đăng nhập; không lưu token vào web storage; không có page error.
  Script và ảnh kiểm chứng cục bộ tại `.tools/expo-session-browser.cjs`,
  `.tools/expo-session-web-fix.png` (không commit).

Chưa kiểm tra trực tiếp trên iPhone/Android hoặc đăng nhập backend thật từ trình duyệt.
Kiểm tra trình duyệt dùng response giả lập không chứng minh cấu hình CORS/TLS của backend thật.
Cảnh báo Animated dùng JS fallback trên web không phải nguyên nhân crash này.
