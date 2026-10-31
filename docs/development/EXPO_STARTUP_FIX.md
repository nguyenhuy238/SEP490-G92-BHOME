# Sửa lỗi Expo Go/Metro ngày 30/10/2026

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
