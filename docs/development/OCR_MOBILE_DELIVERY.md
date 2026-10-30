# OCR dùng thử trên mobile — triển khai tiếp

Cập nhật đủ sáu loại: [OCR_SIX_PROFILES_DELIVERY.md](OCR_SIX_PROFILES_DELIVERY.md),
engine `-layout4`, cải thiện riêng CCCD, bánh số và LCD, kèm kết quả từng profile.

Cải thiện tiếp: [độ chính xác OCR, ảnh thực tế và dấu thập phân](OCR_ACCURACY_DELIVERY.md),
engine `-layout3`, xử lý ảnh nghiêng/xoay và công cụ đánh giá có nhãn.

Sửa nhận dạng ngày 30/10/2026: xem [CCCD mặt sau và chỉ số công tơ](OCR_RECOGNITION_FIX.md)
cho nguyên nhân, thay đổi engine/parser, kiểm thử và giới hạn ảnh thực tế.

## Camera bị mờ khi đưa gần (28/10/2026)

Người dùng báo iPhone 14 Pro không lấy nét khi đưa gần và yêu cầu hỗ trợ cả thiết bị khác.
Phạm vi: chất lượng ảnh đầu vào cho internal OCR BF-03/UC-13, BF-05/UC-20 và NFR usability;
không đổi phân quyền, API, engine, schema hoặc quy tắc xác nhận dữ liệu.

Đã kiểm tra `CameraCapture.tsx`, Expo SDK 58 docs và native source của `expo-camera` đang cài.
SDK này mặc định lấy nét liên tục: **`autofocus="off"` là continuous autofocus**, còn `on`
lấy nét một lần rồi khóa. Không thể kết luận lỗi do autofocus bị tắt và không sửa thành `on`.
Nguồn: [Expo Camera SDK 58](https://docs.expo.dev/versions/v58.0.0/sdk/camera/),
`node_modules/expo-camera/ios/Current/CameraEnums.swift`, `CameraSessionManager.swift`.
[Apple hướng dẫn](https://support.apple.com/en-bw/guide/iphone/iphfaacf2eb0/ios) thử lùi máy
hoặc dùng Ultra Wide khi chụp gần bị mờ trên model hỗ trợ; không đồng nghĩa mọi máy có macro.

Thay đổi trong component dùng chung cho màn OCR thử, identity và meter:

- Giữ lấy nét liên tục rõ ràng theo API SDK; mặc định vẫn để native chọn camera.
- iOS chỉ hiện lựa chọn Camera chính/Siêu rộng khi native thực sự báo có lens đó. Không suy ra
  macro/autofocus từ tên model hoặc chỉ từ việc có ultra-wide; dữ liệu discovery không hỗ trợ
  sẽ bỏ qua an toàn. Android và iPhone một camera vẫn dùng camera mặc định.
- Nút **Lấy nét lại** mở lại camera session để thử lấy nét; không giả lập tap-to-focus ở tọa độ
  vì public CameraView API đang dùng không cung cấp API đó. `onCameraReady` không phải chứng
  nhận ảnh đã nét. Có xử lý lỗi mở camera và chặn chụp trước camera ready.
- Nút Phóng thêm/Thu bớt dùng zoom chuẩn hóa của Expo, giới hạn 0–0.12; không gắn nhãn 2x vì
  hệ số thực tùy thiết bị. Lùi máy đến khi rõ rồi phóng nhẹ; phóng không khôi phục ảnh đã mất nét.
- Nút Chụp ảnh/Hủy chụp ngay dưới preview; chọn ống kính Tự động/Chính/Siêu rộng trên một hàng
  để tránh phải cuộn qua các hướng dẫn mới bấm được chụp.
- Đóng/mở camera reset lens/zoom về mặc định. Không sửa cơ chế xóa ảnh tạm/zero upload buffer.

Tiêu chí: thiết bị không báo lens không có nút lens giả; không hardcode iPhone 14 Pro;
preview/chụp thường vẫn dùng được; thử lùi/tiến và camera chính/siêu rộng trên thiết bị có lens;
chỉ chụp khi chữ rõ. Không thể bảo đảm autofocus ở mọi khoảng cách vượt giới hạn quang học
hoặc trên camera không có phần cứng autofocus. Cần kiểm iPhone một camera và Android thực tế
trước khi tuyên bố hỗ trợ toàn bộ thiết bị.

Kiểm tra hiện tại: `npm run typecheck --workspace ./src/mobile`, `npm run lint --workspace
./src/mobile` PASS; `npm run test --workspace ./src/mobile` **17 PASS**, gồm capability fallback,
thiếu ultra-wide, payload lens không hỗ trợ và deduplication. Không chạy backend tests/migration
vì thay đổi chỉ thuộc camera client. Người dùng đã xác nhận sau bản sửa trên **iPhone 14 Pro**:
**“Đã rõ và đọc được OCR”** khi thử chụp gần. Đây là xác nhận của một thiết bị, không phải kết quả
kiểm định accuracy hoặc bằng chứng cho mọi model. iPhone khác và Android thực tế chưa kiểm thử.
Export bản cuối iOS và Android: PASS (`expo export --platform ios --platform android`, output
ignored `.tools/ocr-camera-final`); `git diff --check`: PASS. Bundle thành công không thay thế
kiểm tra autofocus trên phần cứng từng dòng máy.

## Thử nhận dạng ngay, không thiết lập nghiệp vụ (28/10/2026)

Yêu cầu mới trực tiếp của người dùng: cần giao diện kiểm tra engine OCR trước khi thiết lập
Location/Room/Staff. Truy vết đến internal assisted OCR BF-03/UC-13, BF-05/UC-20,
GBR-07/13 và NFR privacy/manual fallback trong SRS tại `docs/reports`; đây là harness
Development, không mở rộng quyền xử lý dữ liệu nghiệp vụ của Owner/Staff.

Thiết kế/tiêu chí: `index -> ocr-test -> OcrDiagnosticsController -> IOcrService` đang dùng
chung ONNX/preprocessor/parser thật; không tạo Resident, Task, Reading, evidence hay ghi storage.
Chỉ Owner/Staff đã đăng nhập, **Development + MobileDevelopment:Enabled=true** mới được gọi;
production hoặc tắt opt-in trả 404. Các route OCR nghiệp vụ giữ kiểm scope hiện tại.
Kiểm tra phải phân biệt có dữ liệu, không trích xuất được trường và fallback; ảnh lỗi/oversize/MIME
bị từ chối; hủy/background/rời màn hình phải bỏ kết quả đến muộn và xóa dữ liệu tạm.
Không có migration, policy tài chính hoặc state nghiệp vụ mới.

Cách sử dụng:

1. Nếu API đang chạy từ Visual Studio, Stop rồi Start/F5 để nạp controller mới. Cấu hình mobile
   Development đã được prepare ở các bước trước. Không mở thêm API cạnh tranh cùng cổng.
2. Reload trong Expo Go. Đăng nhập tài khoản hiện có rồi chọn **Thử OCR ngay** ở trang chính.
3. Chọn một trong sáu loại CCCD trước/sau, điện/nước cơ khí/điện tử. Bấm **Mở camera để thử OCR**,
   cấp quyền camera, đưa ảnh vào khung và bấm **Chụp ảnh**.
4. Xem từng trường, thời gian API, engine version, confidence, trường thiếu và mã cảnh báo.
   Dữ liệu trả về chưa phải bằng chứng đọc đúng; cần đối chiếu trực tiếp. Không có nút lưu nghiệp vụ.
5. Có thể mở `tests/fixtures/ocr/meter.png`, `identity-front.png`, `identity-back.png` trên máy tính
   rồi chụp bằng iPhone để thử với dữ liệu tổng hợp. Không dùng CCCD thật làm fixture/báo cáo lỗi.

API harness: GET `/api/v1/ocr/diagnostics` kiểm availability; POST binary JPEG/PNG <=5 MiB vào
`/api/v1/ocr/diagnostics/{profile}` với profile `identity-front`, `identity-back`,
`electricity-mechanical`, `electricity-digital`, `water-mechanical`, `water-digital`.
Trả `{ proposal, elapsedMilliseconds }`, không trả paths/hash ảnh. Ảnh và proposal không được log,
persist hay tự xác nhận. Mobile chỉ giữ kết quả trong RAM và bỏ khi background/rời màn hình.
Camera tái sử dụng cơ chế cache cleanup; không lưu ảnh vào thư viện ảnh.

Smoke engine thật trên Windows ngày 28/10/2026: model khởi tạo 590 ms; mặt sau CCCD PASS tiêu chí
ngày cấp (403 ms); bốn profile đồng hồ PASS tiêu chí `00123.45` (240–278 ms) với cùng một ảnh số
tổng hợp. **Mặt trước CCCD FAIL** tiêu chí họ tên có dấu (1347 ms), mới trích xuất được các key
fullName/dateOfBirth. Lệnh smoke exit 1 được giữ nguyên; không đổi expected để làm xanh.
Đây không phải accuracy trên đồng hồ thật hoặc xác nhận E2E camera iPhone.

Kiểm chứng cho màn thử mới (28/10/2026):

- `dotnet test tests/backend/BHome.Application.UnitTests/BHome.Application.UnitTests.csproj
--artifacts-path .tools/ocr-diagnostics-unit`: **44 PASS**.
- `dotnet test tests/backend/BHome.IntegrationTests/BHome.IntegrationTests.csproj
--artifacts-path .tools/ocr-diagnostics-build --filter
'FullyQualifiedName~OcrApiTests|FullyQualifiedName~LocalOcrTests|FullyQualifiedName~IdentityProtectionTests'`:
  **31 PASS**. Bao gồm login/role, production/opt-in guard, sáu profile, input/MIME/size và
  fallback không giả thành nhận dạng thành công. Principal trong các test API là test-only;
  không lấy đó làm chứng cứ xác minh JWT thật.
- `npm run test --workspace ./src/mobile`: **14 PASS**; mobile `typecheck` và `lint`: PASS.
  Lần gọi npm đầu bị execution policy chặn; đã chạy lại bằng `npm.cmd` với Node 22 local.
  Warning hook cleanup đã được sửa và lint cuối không còn warning.
- iOS export: PASS, **1375 modules**, output ignored `.tools/ocr-diagnostics-ios`.
  `dotnet format whitespace` cho hai file C# liên quan và `git diff --check`: PASS.
- Probe API đang do Visual Studio chạy, TLS xác minh CA/hostname, dùng tài khoản tổng hợp local:
  login `200`, diagnostic availability `200`, ba POST ảnh tổng hợp điện điện tử/CCCD trước/sau
  đều `200`, `isFallback=false`, lần lượt **336/887/438 ms**. Chỉ log tên trường và cảnh báo,
  không log credential/token/nội dung identity; logout phiên probe `204`.
- Lỗi đầu trên iPhone “máy chủ chưa bật” xảy ra khi API vẫn chạy bản build trước controller mới.
  Sau Stop/Build/Start, probe availability thành công; mobile có thêm **Kiểm tra lại máy chủ**.
- Người dùng đã xác nhận trên iPhone/Expo Go: chọn điện điện tử, chụp bằng camera và **hiện chỉ số
  OCR**. Luồng camera → HTTPS API → engine → hiển thị kết quả đã dùng được trên thiết bị.
  Chưa nhận bộ ảnh/đối chiếu ground truth, nên không suy ra accuracy từ xác nhận này. CCCD camera,
  cleanup sau kill app và lưu/xác nhận dữ liệu nghiệp vụ chưa được xác nhận trong lượt thử này.
  Không chạy lại PostgreSQL/MinIO suite hoặc migration trong lần thêm harness này.

Người dùng yêu cầu hoàn thiện để test trên iPhone với Expo Go và đã chấp thuận xây dựng
module nghiệp vụ tối thiểu trong repository (28/10/2026).

Quyết định đã chốt trực tiếp: **tác vụ ghi chỉ số theo UC-20, Staff xác nhận thì Completed**.
Quyết định này giải quyết khác biệt với lifecycle tác vụ tổng quát BF-02/UC-11–12;
không đổi lifecycle các loại tác vụ khác.

Truy vết: BF-01/UC-04–05 (scope Location/Room), BF-02/UC-08/10 (phân công),
BF-03/UC-13/GBR-07/13 (identity có xác nhận, mã hóa), BF-05/UC-20/GBR-09
(chỉ số xác nhận + evidence), GBR-02 (scope), NFR privacy/manual fallback.
Nguồn: SRS report trong docs/reports, phần entity/screen/UC-20; Report 4 §3.1–3.4,
3.8, 3.12–3.13. Phần meters của Report 4 còn trống; thiết kế tối thiểu bám entity Meter
và MeterReading trong SRS, không nhận là schema đã hoàn thiện của toàn hệ thống.

Kế hoạch: entity + EF migration -> repository/use case có phân quyền -> API setup/list/confirm
-> mobile login/camera/review/confirm -> test PostgreSQL/MinIO và bundle iOS.
Giữ GUID theo code hiện tại, không đổi sang BIGSERIAL của tài liệu thiết kế.

Tiêu chí: scope lấy từ DB mỗi request; Staff chỉ task được giao và Location còn hiệu lực;
proposal không tự verified; confirm identity có khóa row và unique HMAC theo Owner;
manual entry dùng cùng kiểm tra; không có ảnh CCCD trong DB/MinIO; meter evidence private,
confirmed reading/task/audit commit cùng transaction; retry cùng nội dung trả cùng kết quả,
nội dung khác bị 409; lock Meter chống hai kỳ xác nhận ngược thứ tự;
chỉ số initial không tạo tiền, periodic cần baseline Staff-confirmed;
không tự tính rollover/reset, tiền hoặc invoice khi chưa có workflow/chính sách.

iPhone cần API HTTPS truy cập được và chứng chỉ được tin cậy. Không gửi ảnh/tài khoản test
qua tunnel của bên thứ ba. Chuẩn bị TLS trong LAN và hướng dẫn trust CA; chỉ dùng dữ liệu
tổng hợp/ẩn danh trong kiểm thử tự động. Không yêu cầu gửi CCCD thật vào cuộc trò chuyện.

## Chạy trên iPhone với Expo Go

**Luồng hiện tại cho cả team, không cấu hình IP:** từ repository root chạy
`npm.cmd run mobile:dev`, rồi quét QR. Launcher tự chọn mạng, chuẩn bị HTTPS, dùng lại hoặc
khởi chạy API và cập nhật khi IP đổi. Đổi Wi-Fi thì quét QR mới; không sửa `.env.local`.
Xem [cách dùng, bước trust CA một lần và kiểm chứng](MOBILE_NETWORK_DEVELOPMENT.md).
Các bước khởi chạy tách biệt bên dưới chỉ dành cho nhu cầu debug riêng.

Địa chỉ LAN kiểm tra ngày 28/10/2026: API `https://192.168.0.106:7240`, Expo
`exp://192.168.0.106:8081`. Đây là địa chỉ LAN tại lúc thiết lập, không phải hosting public.
**Không dùng lại IP này khi đổi mạng.** Luôn dùng IP do script in ra trong lần chạy hiện tại.
Nếu IP máy tính đổi, chạy lại script với `-LanIp <IPv4 trong Wi-Fi của bạn>`.
Người dùng đã xác nhận Safari trên iPhone tải được chứng chỉ từ máy tính.

Khi cần chuẩn bị cấu hình Visual Studio riêng (launcher mới đã tự làm bước này):

```powershell
powershell -ExecutionPolicy Bypass -File scripts/Prepare-OcrMobile.ps1 -SkipDatabase
```

Script cập nhật `.env`, chứng chỉ server và User Secrets theo IP mới,
giữ CA hiện có nếu còn phù hợp. Khởi động lại API trong Visual Studio; dừng Metro cũ bằng Ctrl+C,
rồi chạy `scripts/Start-OcrMobileApp.ps1 -Clear` bằng lệnh ở bước 4 và quét lại QR.
Trên iPhone cùng mạng, mở `https://<LAN_IP>:7240/health/ready` bằng Safari; phải thấy `Healthy`
trước khi đăng nhập. Nếu Safari không kết nối được, kiểm tra IP, quyền mạng nội bộ, firewall
và mạng Wi-Fi có chặn các thiết bị truy cập nhau hay không. Không tắt kiểm chứng HTTPS để né lỗi.
Màn hình đăng nhập dùng **email**, ví dụ tài khoản local Owner là `owner.dev@example.invalid`;
`owner.dev` là username cũ, không phải định danh đăng nhập được API hiện tại chấp nhận.

1. Bật Docker Desktop và dịch vụ dữ liệu: `docker compose up -d`.
2. Nếu dùng Visual Studio để chạy backend, chuẩn bị từ repository root rồi nhấn F5 trong IDE:

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts/Prepare-OcrMobile.ps1 -SkipDatabase
   ```

   `-SkipDatabase` dành cho database local đã được chuẩn bị. Bỏ cờ này nếu cần áp dụng migrations
   theo quy trình local. Script đồng bộ TLS, endpoint LAN, OCR/identity/storage sang User Secrets
   của `BHome.Api` vì Visual Studio không tự đọc `.env`. Không ghi đè cấu hình database/JWT có sẵn
   trong User Secrets. Development tự nạp cấu hình này; mật khẩu/khóa truyền qua stdin và không
   ghi vào source hoặc command line. Chỉ chạy **một** API: Visual Studio **hoặc** terminal.

   Nếu không dùng Visual Studio, chạy API bằng terminal:

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts/Start-OcrMobile.ps1
   ```

   Script chỉ migrate PostgreSQL loopback/database `bhome`, tạo khóa mã hóa/HMAC riêng nếu
   chưa có và giữ nguyên khóa đã tạo. Khi đổi IP, script cấp lại chứng chỉ server bằng CA
   hiện có nếu còn private key và thời hạn phù hợp; chỉ khi phải tạo CA mới thì cần cài/trust lại
   CA trên iPhone. Model pin/checksum nằm trong `.tools/ocr-models`;
   nếu chưa tải, chạy `scripts/Get-OcrModels.ps1` trước. Mật khẩu, PFX, private key không
   được in ra hoặc đưa vào Git. Script không sửa Windows firewall/trusted-root store.

3. Trên iPhone cùng mạng, Safari mở
   `http://<LAN_IP>:5240/development/mobile-ca.cer`, cài profile **BHOME Local Mobile CA**.
   **Tải về chưa phải đã cài:** mở **Cài đặt → Đã tải về hồ sơ → BHOME Local Mobile CA → Cài đặt**,
   nhập mã khóa iPhone và hoàn tất các bước xác nhận. Nếu không thấy hồ sơ đã tải, tải lại bằng
   Safari rồi cài ngay; Apple cho biết hồ sơ chưa cài sẽ tự bị xóa sau 8 phút:
   https://support.apple.com/en-us/102400 .
   Đối chiếu thumbprint với terminal máy tính, sau đó bật tin cậy tại **Cài đặt → Cài đặt chung
   → Giới thiệu → Cài đặt tin cậy chứng nhận**. Apple xác nhận profile tự cài cần bật trust TLS
   riêng: https://support.apple.com/en-us/102390 . Địa chỉ HTTP này chỉ tải chứng chỉ public
   trong Development có opt-in; mọi API dữ liệu dùng HTTPS. Không dùng `-k`/bỏ kiểm chứng TLS
   trên mobile. Sau khi tin cậy, mở `https://<LAN_IP>:7240/health/ready` và kiểm tra Healthy.

4. Terminal mobile:

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts/Start-OcrMobileApp.ps1 -Clear
   ```

   Script chọn Node 22 trong `.tools` nếu đã cài, chạy Expo LAN từ workspace mobile. Dùng
   QR trong terminal hoặc mở `exp://<LAN_IP>:8081` trên iPhone để vào Expo Go. Nếu dùng
   terminal Expo không có QR, mở URL này trong Safari để chuyển sang Expo Go. Cấp quyền
   mạng nội bộ/camera khi được hỏi. Màn hình đăng nhập tự lấy API URL từ host trong Expo manifest
   ở chế độ development, không cần IP trong `.env.local`. Script tự chuẩn bị HTTPS và kiểm tra API
   trước khi mở Expo; `npx expo start` riêng chỉ mở Metro, không cập nhật IP/chứng chỉ.
   Script yêu cầu Node `>=22.13 <23`, từ chối mở thêm Metro nếu cổng 8081 đã có tiến trình.
   Dừng terminal cũ bằng Ctrl+C; chỉ dùng `-Port 8082` khi chủ động cần cổng khác.
   `-Clear` xóa cache Metro theo Expo CLI, hữu ích sau khi đổi phiên bản Node; lần chạy thường
   có thể bỏ cờ này. Không chạy `npm ci` khi Metro còn đang chạy.
   Trên iPhone thật, Expo Go và Expo CLI cần đăng nhập cùng tài khoản Expo. Kiểm tra bằng
   `npx expo whoami`; nếu cần thì dùng `npx expo login` và tự đăng nhập trong terminal/browser.
   Tài khoản Expo khác với tài khoản BHOME `owner.dev@example.invalid`. Xem
   [hướng dẫn Expo Go sign-in](https://docs.expo.dev/troubleshooting/expo-go-sign-in-required/).

5. Đăng nhập Owner bằng email. Môi trường local đã tạo các username `owner.dev`, `staff.dev`,
   `tenant.dev` với email tương ứng `owner.dev@example.invalid`, `staff.dev@example.invalid`,
   `tenant.dev@example.invalid` bằng công cụ
   fixture, với mật khẩu ngẫu nhiên chỉ nằm trong `.tools/ocr-mobile-test-login.txt` (ignored).
   Không dùng các tài khoản này ngoài local. `staff.dev` chưa gắn Owner/Location nên không có
   quyền OCR; Owner tạo Staff mới theo bước dưới. Lần thiết lập mới có thể dùng:

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts/New-LocalTestUsers.ps1
   ```

   Script cho bạn tự nhập mật khẩu và không reset tài khoản đã tồn tại. Không gửi mật khẩu
   hoặc CCCD thật vào chat/log/screenshot.

### Build backend khi đang chạy API local

`Start-OcrMobile.ps1` chạy API từ `src/backend/BHome.Api/bin/Debug/net8.0`.
Trước khi Build/Rebuild trong Visual Studio, dừng API bằng `Ctrl+C` tại terminal đã chạy script;
nếu chạy bằng debugger thì dùng **Stop Debugging**. Sau build mới chạy lại API để test iPhone.
Không chạy API nền từ cùng thư mục output trong lúc Visual Studio cần ghi đè các DLL.

Ngày 28/10/2026, lỗi copy DLL (vượt 10 lần retry) xuất phát từ API nền PID `27868` giữ file;
`CS0006` ở IntegrationTests là lỗi tiếp theo do API chưa build thành công. Đã xác minh đường dẫn
process thuộc repository rồi dừng nó. Chạy
`dotnet build src/backend/BHome.sln --no-restore --configuration Debug --no-incremental`
thành công: **0 warnings, 0 errors**. Sau kiểm tra để API dừng nhằm phục vụ build/debug trong IDE.
Phạm vi là vòng đời tiến trình local, không thay đổi nghiệp vụ/schema; không chạy lại test nghiệp vụ
trong lần xử lý lỗi khóa file này. Kết quả CLI không xác nhận trạng thái cache IntelliSense trong IDE.

### Dữ liệu và thao tác thử

Owner chọn **Thiết lập cơ sở và phân công**, đi từ trên xuống:

- Tạo chuỗi → chọn chuỗi → tạo cơ sở → chọn cơ sở → tạo phòng → chọn phòng.
- Tạo Staff mới bằng tên đăng nhập, email hợp lệ và mật khẩu do bạn chọn. Dữ liệu thử có thể
  dùng `staff.ocr` / `staff.ocr@example.invalid`; Identity vẫn áp dụng chính sách mật khẩu thật.
- Chọn Staff và phân công Location từ ngày hiện tại hoặc trước đó; đến ngày có thể để trống.
- Tạo đồng hồ, chọn điện/nước, cơ khí/điện tử và **số chữ số thập phân thật** (0–4), ngày lắp.
- Giao tác vụ **Ban đầu** cho Staff, ngày ghi không trước ngày lắp và không sau ngày hiện tại
  khi Staff xác nhận. Không điền kỳ hóa đơn cho chỉ số initial.

Đăng xuất Owner, đăng nhập Staff vừa tạo:

- **CCCD:** chọn cơ sở → thêm hồ sơ cư dân → chọn phòng/loại đại diện hoặc cùng ở → nhập nhãn
  hồ sơ như `HS-TEST-01` → chụp từng mặt hoặc nhập tay. Ảnh tại
  `tests/fixtures/ocr/identity-*.png` là văn bản giả lập có thể hiển thị trên PC để thử chụp;
  không phải thẻ thật. Dữ liệu xác nhận thử: số `000000000000`, tên `NGƯỜI KIỂM THỬ`, ngày
  `01/01/2000`. Model có thể đọc sai dấu: sửa trước khi tick xác nhận và lưu. Không tự ghi đè
  giá trị đang có nếu hai mặt khác nhau. Thành công chỉ hiện sau phản hồi lưu từ server.
- **Đồng hồ:** mở tác vụ → chụp ảnh mặt số → xem đề xuất và ảnh → nhập/sửa → tick xác nhận →
  lưu. Có thể thử initial `100.00`. Tác vụ định kỳ tiếp theo cần ngày lớn hơn ngày initial,
  kỳ `MM/yyyy` khớp tháng ngày ghi; thử `105.50` thì server tính lượng dùng `5.50`.
  Dùng đồng hồ/ảnh số giả lập khi thử, không coi ảnh số in là kiểm định đồng hồ cơ khí/LED thật.
- Manual identity không cần OCR; manual meter vẫn phải có ảnh evidence. Chỉ số giảm trả cảnh
  báo cần Owner xử lý quy trình thay/reset/rollover, không tự ước lượng hoặc tạo tiền.

Nếu Safari/Expo không kết nối: kiểm tra cùng Wi-Fi, IP hiện tại, quyền Local Network và firewall
cho cổng 5240/7240/8081 trên mạng private. Wi-Fi doanh nghiệp có client isolation có thể chặn
thiết bị dù cùng SSID; đổi sang LAN thử nghiệm cho phép các thiết bị liên lạc. Không mở API này
ra Internet bằng port forwarding. Sau đổi cấu hình, khởi động lại API và Expo.

### Sửa lỗi đăng nhập do đổi mạng (28/10/2026)

Truy vết: FE-02/UC-01 (Sign In), GBR-01/02 và NFR HTTPS/TLS trong SRS v1.3
`BHome_Report-3_Software Requirement Specification (2).docx`; quy ước HTTPS tại
`docs/api/API_CONVENTIONS.md`. Thay đổi chỉ thuộc cấu hình local và script khởi động,
không đổi quyền, API contract, dữ liệu hoặc schema.

Triệu chứng: Expo chạy bình thường tại `192.168.0.106:8081`, nhưng `.env.local` còn API
`10.33.59.31` và backend lắng nghe `127.0.0.1`/`::1`. iPhone không thể gọi backend đó.
Chạy `Prepare-OcrMobile.ps1` rồi khởi động backend từ Visual Studio, hoặc dùng
`Start-OcrMobile.ps1` để bind LAN và đồng bộ IP/chứng chỉ. Có thể thêm `-LanIp <IPv4>` khi máy
có nhiều adapter; `-SkipDatabase` bỏ bước migration nếu database local đã được chuẩn bị.

Tiêu chí kiểm chứng: HTTPS `/health/ready` trả `200 Healthy` qua CA local và đúng tên/IP;
API riêng tư vẫn trả `401` khi chưa đăng nhập; chạy prepare lại cùng IP giữ nguyên CA/PFX/khóa;
IP không hợp lệ bị từ chối; script mobile từ chối IP cũ hoặc backend chỉ lắng nghe loopback.
Sau khi cập nhật `.env.local`, dừng/mở lại Expo và quét QR mới; nếu cần, sửa ô API trên màn hình
đăng nhập theo địa chỉ mà script in ra. Kiểm tra Safari/đăng nhập thực tế trên iPhone vẫn cần
thực hiện từ thiết bị, không suy ra từ kiểm tra trên máy tính.

Kết quả kiểm tra lần sửa này (28/10/2026):

- `dotnet build src/backend/BHome.sln --no-restore`: PASS, 0 warning/error.
- `npm run test --workspace ./src/mobile`: PASS, 12 tests; `npm run typecheck --workspace
./src/mobile` và `npm run lint --workspace ./src/mobile`: PASS (Node 22 local).
- Probe Node HTTPS với CA public chỉ định, giữ kiểm tra TLS và hostname: LAN readiness
  `200 Healthy`, capture locations chưa xác thực `401`; tải CA qua HTTP khớp file public local.
- Kiểm tra script tự động local: chạy prepare lại giữ nguyên hash `.env`, mobile env, PFX và
  CA; IP public bị từ chối trước khi sửa file; parser PowerShell không lỗi; mock IP cũ và
  listener loopback đều bị launcher mobile từ chối trước khi chạy Expo.
- Sau restart Metro, tải bundle iOS qua HTTP trả `200`, có API `192.168.0.106:7240`, không
  còn API `10.33.59.31:7240`. Firewall đã có rule cho BHome API; không sửa firewall/trust store.
- Lần này dùng `-SkipDatabase`: không chạy migration. Docker daemon chưa chạy; không thực hiện
  lại integration test PostgreSQL/MinIO hoặc xác nhận camera/OCR/đăng nhập từ iPhone.

### Kết nối khi chạy từ Visual Studio và lỗi cache Metro (28/10/2026)

Phạm vi FE-02/UC-01, NFR Transport Security và cấu hình môi trường local. Lần tái hiện sau đó,
API do Visual Studio quản lý vẫn bind localhost; `.env` chỉ được các launcher PowerShell nạp.
`Prepare-OcrMobile.ps1` hiện đồng bộ các mục cần cho mobile sang User Secrets và cấu hình rõ
`Kestrel:Endpoints:MobileHttps`/`MobileHttp`, vượt URL localhost trong launch profile.
User Secrets được nạp trong Development theo
[tài liệu Microsoft](https://learn.microsoft.com/en-us/aspnet/core/security/app-secrets?view=aspnetcore-8.0).
Không cần API nền thứ hai; Visual Studio quản lý việc Stop/Build/Start bình thường.
Để quay lại bind localhost, dừng API rồi chạy `dotnet user-secrets remove
"Kestrel:Endpoints:MobileHttps:Url" --project src/backend/BHome.Api` và tương tự cho
`Kestrel:Endpoints:MobileHttp:Url`; chạy prepare lần nữa sẽ bật lại LAN.

Log Expo có Node 24 trái yêu cầu Node 22 của repository, hai Metro cạnh tranh cổng và lỗi
deserialize cache. Launcher mobile hiện kiểm tra phiên bản Node/cổng và hỗ trợ `-Clear` theo
[hướng dẫn Expo](https://docs.expo.dev/troubleshooting/clear-cache-windows/).
Không hạ kiểm tra TLS hoặc đổi chính sách đăng nhập để xử lý lỗi kết nối.

Đã probe API **đang chạy từ Visual Studio** bằng HTTPS xác minh CA/hostname: readiness `200 Healthy`,
API capture chưa xác thực `401`, đăng nhập bằng tài khoản giả không tồn tại `401`.
Người dùng đã xác nhận Safari trên iPhone mở địa chỉ API và hiện **Healthy** trong lượt sửa này.
Đã kiểm tra thêm tài khoản tổng hợp `owner.dev` qua HTTPS: login `200`, đọc danh sách Location
được phép `200`, logout phiên probe `204`. Credential đọc trực tiếp từ file ignored trong tiến trình
local; token chỉ ở RAM, không in response hoặc nội dung bản ghi. Đây là probe trên máy tính;
đăng nhập/camera/OCR end-to-end trên app vẫn cần xác nhận từ iPhone.

Kiểm chứng cho lần sửa Visual Studio/Metro:

- `npm ci --no-fund --no-audit` từ repository root với Node 22: PASS, khôi phục cả workspace tooling.
- `npm run test --workspace ./src/mobile`: **12 PASS**; `npm run typecheck --workspace ./src/mobile`
  và `npm run lint --workspace ./src/mobile`: PASS.
- Kiểm tra script local: idempotence gồm User Secrets, IP không hợp lệ, cú pháp PowerShell,
  IP cũ, API loopback, Node 24 không hỗ trợ, Metro trùng cổng và API trùng cổng: **8 PASS**.
- Metro Node `22.23.4`, cổng `8081`, `--clear`: bundle iOS `200`, API đúng IP hiện tại,
  không còn IP cũ. Không thay đổi package versions, code nghiệp vụ hoặc chạy migrations.
- `npm audit --json` vẫn báo **8 mục (5 low, 3 high)** ở dependency tooling Expo; đề xuất tự động
  cho nhóm high là hạ Expo về `51.0.39` (đổi major). Chưa xử lý nhóm dependency này trong bản sửa
  kết nối; không dùng `audit fix --force`. Đây không phải bằng chứng lỗi đăng nhập qua mạng.
- Không build/restart API nền thứ hai; giữ API đang do Visual Studio quản lý. Không chạy lại
  integration suite PostgreSQL/MinIO trong lần sửa cấu hình này.

Khi mở lại trên iPhone xuất hiện thêm thông báo Expo Go đã đăng nhập `bhome` nhưng CLI chưa
đăng nhập. Thực tế `expo whoami` trả `bhome`; Metro trước đó đã tự chuyển offline sau lỗi mạng
khi kiểm tra version, nên chưa phân giải tài khoản vào manifest. Đã khởi động lại Metro online
và probe `/manifest` với platform iOS: HTTP `200`, `extra.expoGo.username` khớp `bhome`.
Nếu gặp lại, kiểm tra kết nối tới Expo, chạy `expo whoami`, khởi động lại Metro rồi chọn
**Try Again** trên iPhone. Không sửa manifest hoặc bỏ qua kiểm tra tài khoản của Expo Go.

### iPhone chưa có CA trong danh sách tin cậy (28/10/2026)

Sau các kiểm tra server thành công, người dùng vẫn gặp lỗi mạng trong app và xác nhận
**không thấy chứng chỉ BHOME** tại Cài đặt tin cậy chứng nhận. Vì vậy chưa thể coi việc Safari
hiện Healthy là bằng chứng thiết bị đã hoàn tất cài đặt và bật tin cậy hoàn toàn cho CA.
Hướng dẫn thực hiện đủ hai bước độc lập: cài hồ sơ đã tải, sau đó bật tin cậy TLS cho root CA;
đóng/mở lại Expo Go rồi kiểm tra đăng nhập thực tế.

Probe endpoint public CA trả `200`, MIME `application/x-x509-ca-cert`, attachment `.cer`;
bytes tải xuống khớp `.tools/mobile-tls/root-ca.cer`. Chứng chỉ có Basic Constraints `CA=true`,
Key Usage certificate signing, subject/issuer `BHOME Local Mobile CA`, còn hạn. Thumbprint:
`FE8C7A2FC7F4A35C22C42F55A0CB7222CB5FD6B8`.
Đây là xác minh file CA từ máy tính, không phải xác nhận đã cài thành công trên iPhone.
Lần kiểm tra này không sửa code, đổi chứng chỉ, bỏ kiểm tra TLS hoặc chạy migrations.

## API và dữ liệu thực tế

Luồng `CaptureController -> CaptureService -> ICaptureRepository/CaptureRepository -> EF Core`,
scope query riêng trong `CaptureScope`. Role được kiểm trong Application; repository chỉ chọn
tài nguyên thuộc scope hiện tại và re-read sau khóa transaction cho confirmation. OCR inference
vẫn dùng `OcrWorkflowService -> CaptureWorkflowResources -> IOcrService`.

| Method / `/api/v1/capture/`                      | Quyền                       | Nội dung                                                          |
| ------------------------------------------------ | --------------------------- | ----------------------------------------------------------------- |
| GET/POST `chains`                                | Owner                       | Danh sách/tạo chuỗi thuộc Owner                                   |
| GET/POST `locations`                             | Owner/Staff xem; Owner tạo  | Cơ sở có quyền truy cập                                           |
| GET `locations/{id}/rooms`, POST `rooms`         | Owner/Staff xem; Owner tạo  | Phòng thuộc Location được phép                                    |
| GET/POST `staff`                                 | Owner                       | Chỉ Staff thuộc Owner; tạo bằng userName/email/password           |
| POST `assignments`                               | Owner                       | Gán Staff thuộc Owner vào Location thuộc Owner, có ngày hiệu lực  |
| GET `locations/{id}/residents`, POST `residents` | Owner/Staff có scope        | Hồ sơ chờ xác nhận, summary không có identity plaintext           |
| POST `residents/{id}/confirm`                    | Staff được gán Location     | JSON `humanConfirmed:true` + trường đã đối chiếu                  |
| GET `locations/{id}/meters`, POST `meters`       | Scope xem; Owner tạo        | Meter điện/nước, precision, ngày lắp                              |
| GET/POST `meter-tasks`                           | Owner/Staff xem; Owner giao | Staff chỉ thấy task giao cho mình và còn scope                    |
| PUT `meter-tasks/{id}/evidence`                  | Staff được giao task        | Binary JPEG/PNG tối đa 5 MiB, trả evidenceId                      |
| POST `meter-tasks/{id}/confirm`                  | Staff được giao task        | `humanConfirmed`, `confirmedValue` (decimal string), `evidenceId` |
| GET `readings/{id}/evidence`                     | Owner/Staff còn scope/task  | Download qua API kiểm quyền; không có public MinIO URL            |

Các list giới hạn 100 bản ghi cho lần triển khai tối thiểu; chưa có phân trang đầy đủ. Decimal
trả ra dưới dạng chuỗi để tránh mất precision trong JavaScript, vẫn chấp nhận numeric JSON cũ
khi confirm. Errors dùng ProblemDetails + correlationId + `code` an toàn, không echo CCCD hay
credential. Staff/Owner đọc summary chứ không được nhận lại toàn bộ identity qua list.

Migration `20261028103339_CaptureWorkflows` thêm 9 bảng:
`Chains`, `Locations`, `Rooms`, `StaffLocationAssignments`, `Residents`, `Meters`,
`OperationalTasks`, `MeterEvidence`, `MeterReadings`; thêm `AspNetUsers.ManagingOwnerId`
và `SecurityAudit.TargetType/TargetId`. GUID theo kiến trúc code hiện tại.

- Linking Staff vào Owner là phần bổ sung cần thiết cho isolation; không tự suy ra từ email,
  JWT Location claim hoặc gán lại tài khoản cũ. Tài khoản cũ giữ ManagingOwnerId null.
- Resident đang là hồ sơ onboarding gắn Room/context, không tự tạo Contract, occupancy hoặc
  tài khoản Tenant. Representative/co-occupant được lưu riêng. Không xử lý residence registration.
- Toàn bộ confirmed identity nằm trong AES-GCM envelope JSONB; index HMAC theo Owner/version,
  metadata actor/time riêng; không lưu ảnh hoặc raw OCR identity text. HMAC tra tất cả phiên bản
  key còn giữ, khóa Owner row để tránh hai request trùng đồng thời, unique index ở DB là lớp bảo vệ
  bổ sung. Khi xoay HMAC, các replica phải giữ keyring tương thích và backfill trước khi bỏ key cũ.
- Confirmed reading khóa Meter rồi Task, kiểm task/Staff/Location/date/precision/baseline/kỳ,
  ghi Reading + task Completed + audit + link evidence cùng transaction. Retry cùng task/value/
  evidence trả cùng record; khác nội dung trả 409. Không dùng proposal làm billing input.
- Ảnh meter upload có durable cleanup intent trước external write, object key ngẫu nhiên/private;
  không commit reference confirmed nếu storage thiếu/lỗi. Cleanup mỗi phút xử lý ảnh staging quá
  30 phút bằng khóa `SKIP LOCKED`, retry được sau lỗi; giữ nguyên evidence đã linked. Đây là lease
  kỹ thuật cho upload bỏ dở, không phải chính sách xóa evidence nghiệp vụ đã được duyệt.
- ConfirmedValue/OcrProposedValue riêng; proposal chỉ được gắn vào reading khi SHA-256 của ảnh
  OCR khớp ảnh evidence. Hash này chỉ dùng cho meter evidence integrity, không dùng bảo vệ CCCD.

Chỉ chạy migration đã review trên local/test trước. Schema thay đổi additive, không sửa tài khoản
hay xóa dữ liệu cũ. Sau khi có identity/readings thật, **không chạy migration Down để rollback**:
nó sẽ xóa bảng nghiệp vụ mới. Giữ backup/keys, forward-fix hoặc khôi phục backup theo quy trình
được duyệt. Chưa áp dụng migration production.

## Mobile: phiên đăng nhập và dữ liệu tạm

Expo Router với các route `index`, `setup`, `resident`, `identity`, `meter`; thay entry demo cũ.
Development lấy API từ host của Expo manifest; release/standalone dùng `EXPO_PUBLIC_API_BASE_URL`,
chỉ chấp nhận origin HTTPS. Access token
ở RAM; refresh credential và API binding ở SecureStore/Keychain `WHEN_UNLOCKED_THIS_DEVICE_ONLY`.
Coalesce refresh/restore, serialize Keychain writes, chặn refresh đến muộn phục hồi phiên đã
logout; đổi API không gửi credential của host cũ sang host mới. Không retry refresh bị lỗi mạng
mơ hồ bằng credential cũ, không tự retry confirmation 409/500/network failure.

Camera dùng native PictureRef trước resize/JPEG (không lưu original full-res), giới hạn 1600px,
không gallery, không base64/nav-state/analytics. Ảnh derived tạm nằm trong cache app; identity
xóa sau request kể cả lỗi/hủy, meter giữ preview tạm đến khi rời màn hình. Background/unmount
xóa ảnh và hủy request; identity fields ở RAM được xóa khi app không active. Startup dọn cache
`bhome-ocr`/`ImageManipulator` của chính app sau đóng bất thường. Việc xóa native cache khi kill
ngay giữa native write phải kiểm tra trên iPhone; không tuyên bố đã đo forensic erasure/swap.
Màn identity yêu cầu chặn screen capture và blur app switcher qua Expo, nhưng cần kiểm thực tế
trên phiên bản iOS/Expo Go của người dùng. Hủy chờ phản hồi không đồng nghĩa server đã rollback:
tải lại list để xác định kết quả; confirm retry được thiết kế idempotent.

## Kiểm chứng và phần còn giới hạn

Đã chạy (28/10/2026): build .NET; toàn bộ backend test PostgreSQL/MinIO disposable **149 PASS**
(1 Domain + 44 Application + 104 Integration); mobile **12 PASS**; mobile typecheck/lint PASS;
root npm test/lint PASS; Owner Web/client-core build PASS; iOS Expo export PASS ở lần triển khai
trước; bản thêm harness có kết quả riêng ở đầu tài liệu. HTTPS readiness đã trả Healthy qua CA local;
người dùng xác nhận iPhone tải được chứng chỉ public. Màn thử OCR đồng hồ đã được người dùng
xác nhận hiển thị chỉ số từ camera iPhone (xem cập nhật đầu tài liệu); chưa đánh dấu E2E lưu/xác nhận
nghiệp vụ trên thiết bị là PASS.

Test mới có: quyền Owner/Staff/Tenant và cross-Location/Owner, assignment hết hiệu lực, AES/HMAC
persistence không có plaintext trong DB/list, human-confirm flag, trùng identity song song không
merge, parallel confirm trả một Reading, evidence private/download scope, baseline/kỳ/precision,
MinIO nhận upload rồi mất phản hồi → không tạo reading và cleanup retry xóa object/intent.
Client test kiểm HTTPS origin, bearer/binary MIME, không cookies, conflict/network không retry,
ngày lịch thật, hai mặt không ghi đè xung đột, manual payload, refresh/restore coalescing,
Keychain không lưu access token/profile, refresh cũ không hồi sinh phiên đã clear.

Chưa đánh dấu hoàn thành: accuracy/SLA trên ảnh thực tế và bộ >=50 ảnh; model hiện vẫn có thể
sai tên có dấu (smoke ban đầu có FAIL, giữ nguyên expected), iPhone CCCD camera và cleanup sau
kill app; OCR không xác thực chip hoặc danh tính pháp lý. Không có invoice engine/JOB-09/10,
Contract/handover/Tenant confirmation, meter replacement/reset/rollover approval, ngưỡng tiêu thụ
bất thường chưa được duyệt, chỉnh identity sau Verified, quản lý toàn bộ lifecycle Staff/Location,
hay notification push. Chỉ số initial không được coi là hoàn tất handover UC-17.

Kiểm tra ngoài phạm vi: `npm run build` toàn repo FAIL ở Public Web
`HomePage.tsx` (`Typography` không có prop `fontWeight`); không sửa code đó trong task OCR.
`npm audit` hiện báo 8 mục (3 high qua zod/@expo/cli/expo, 5 low). Zod trong Expo CLI còn constraint
v3; audit đề xuất downgrade Expo major không tương thích nên không chạy `audit fix --force`.
Đây là issue tooling đang ghi nhận, không công bố production-ready. Cần review SDK-compatible
dependency patch trước release.

## Sửa lỗi GitHub CI (29/10/2026)

Truy vết: BF-03/UC-13, BF-05/UC-20, GBR-02/07/13 và NFR privacy/manual fallback;
FE-02/UC-01 cho fixture đăng nhập; FE-09/UC-37 chỉ sửa kiểu prop giao diện public.
Nguồn đối chiếu: SRS tại `docs/reports`, ghi chú phạm vi/decision trong tài liệu này,
workflow `.github/workflows/ci.yml`, API login hiện tại và các test OCR thực tế.
Không thay quyền, trạng thái nghiệp vụ, schema, migration hoặc chính sách đang mở.

Nguyên nhân và thay đổi:

- Frontend lint áp rule TypeScript lên `scripts/inspect-owner-stitch.cjs`, thiếu Node globals.
  Thêm override CommonJS chỉ cho `scripts/**/*.cjs`; vẫn lint script và giữ rule TypeScript.
- Runner mới chưa có `bhome/minio-local:2025-10-15`, trong khi fixture dùng image này.
  CI build từ Dockerfile/source MinIO đã pin của repo trước khi chạy Testcontainers;
  không đổi provider, bỏ test hoặc phụ thuộc image local có sẵn.
- EF Core bọc lỗi kết nối Npgsql tạm thời trong `InvalidOperationException`, nên catch cũ
  bỏ sót và API trả 500. Adapter OCR xử lý đúng wrapper có inner Npgsql exception, trả 503.
  Test hai route identity/meter dùng endpoint DB không khả dụng, kiểm 503/no-store và không
  lộ tên database/chi tiết lookup. Đã tái hiện 2 FAIL trước sửa, sau sửa 2 PASS.
- Fixture capture còn gửi `userName` thay vì `email` theo contract login hiện tại, dẫn đến
  400 khi vượt qua bước khởi tạo MinIO. Sửa cả hai chỗ login; cleanup chịu được khởi tạo
  chưa hoàn tất và vẫn dispose các tài nguyên còn lại.
  Test `LoginPage.test.tsx` của Owner cũng còn assertion `userName`; cập nhật theo
  `AuthController.LoginRequest` và `SessionClient.login` hiện tại, dùng email tổng hợp.
- Public Web `Typography` chuyển `fontWeight` vào `sx`, khắc phục lỗi build đã ghi nhận ở
  phần trước. Các file frontend/script có format lỗi được Prettier định dạng lại;
  giữ nguyên văn bản AGENTS.md và bỏ qua báo cáo Visual Studio sinh tự động trong formatter.

Tiêu chí chấp nhận: CI tạo đủ dependency trước test; lỗi DB trả 503 thay vì 500;
test capture dùng login contract đúng; vẫn kiểm scope/negative/concurrency/private storage;
lint, test, build, format phải được chạy và ghi nhận riêng. Không nới lỏng quyền để test qua.

Kiểm chứng local Windows, SDK 8.0.427, Docker Desktop Linux containers:

- `docker build -f deploy/docker/Minio.Dockerfile -t bhome/minio-local:2025-10-15 .`: PASS
  (build stage Go có cache; runtime stage được build lại).
- `dotnet build src/backend/BHome.sln -c Release --no-restore -m:1 -nodeReuse:false`: PASS,
  0 warning/error.
- `dotnet test src/backend/BHome.sln -c Release --no-build -m:1 -nodeReuse:false --logger trx`:
  PASS **272 tests** (Application 71, Domain 37, Integration 164), fail 0, skip 0;
  có PostgreSQL/MinIO disposable và migration trên DB test, không migrate DB người dùng.
- `dotnet format src/backend/BHome.sln --verify-no-changes --no-restore`: PASS.
- `docker compose --env-file .env.example config --quiet`: PASS.
- Frontend Node 22.23.4: `npm ci --no-fund --no-audit`, `npm run lint`, `npm run build`,
  `npm run format:check`: PASS. Cài dependencies từ lockfile, không đổi phiên bản/lockfile.
- `npm test`: PASS **63 tests** theo scripts hiện tại (Owner Web 46, Mobile 17).
  Lượt đầu sau cài dependencies có 1 FAIL do assertion login cũ; đã sửa và chạy lại toàn bộ.
- `git diff --check`: PASS. Frontend test/build trong sandbox ban đầu bị `spawn EPERM`;
  kết quả PASS trên được chạy lại ngoài sandbox. Không tính lần bị chặn là test thành công.

Đây là kết quả local; chưa push hoặc chạy lại GitHub Actions trên runner Ubuntu.
Các cảnh báo Node runtime của GitHub Actions trong ảnh log không phải bước gây exit code 1.

## Sửa đăng nhập mobile sau đổi mạng/pull code (29/10/2026)

Truy vết: FE-02 / UC-01, GBR-01/02/13, NFR HTTPS; SRS tại `docs/reports`, Report 4
Authentication/Authorization và quyết định email tại `JWT_EMAIL_AUTHENTICATION.md`.
Không thay đổi quyền, nghiệp vụ, schema hoặc migration.

Nguyên nhân kiểm chứng tại máy phát triển:

- IP Wi-Fi đổi từ `192.168.0.106` sang `10.33.59.31`, nhưng `.env.local`/chứng chỉ còn theo IP cũ.
- Mobile vẫn gửi `{ userName, password }`, trong khi `AuthController.LoginRequest` yêu cầu
  `{ email, password }` theo quyết định đã được duyệt. Đây là lỗi tiếp theo sau khi sửa kết nối.
- Metro đang chạy vẫn giữ IP cũ trong bundle sau khi `.env.local` đã đổi; cần restart Metro.

Thay đổi: form `index.tsx` dùng Email và lấy URL từ session hiện tại nếu chưa chỉnh tay;
`MobileSessions.login` gửi email đã trim, giữ nguyên mật khẩu; lỗi 401 lúc đăng nhập hiển thị
thông báo email/mật khẩu chung. Thông báo lỗi mạng hướng dẫn kiểm tra IP khi đổi Wi-Fi.
Tests bao phủ payload đúng, 400/401/mất mạng không retry hoặc lưu phiên, từ chối HTTP trước khi
gửi credential, và đổi origin không gửi refresh token cũ sang server mới; giữ test refresh đồng thời.

Cấu hình local đã chạy:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Prepare-OcrMobile.ps1 -LanIp 10.33.59.31 -SkipDatabase
```

Giữ CA cũ; không migrate DB, sửa firewall hoặc tắt kiểm chứng TLS. API đang debug đã nạp được
chứng chỉ mới; không dừng API. Restart riêng Metro bằng `Start-OcrMobileApp.ps1 -Clear`.
Lần gọi trực tiếp script đầu tiên bị PowerShell ExecutionPolicy chặn; lệnh ở trên thành công,
không thay ExecutionPolicy toàn máy.

Kiểm chứng thực tế trong lần sửa này:

- `npm.cmd run test --workspace src/mobile`: PASS **22 tests**, fail 0.
- `npm.cmd run typecheck --workspace src/mobile`: PASS.
- `npm.cmd run lint --workspace src/mobile`: PASS; ESLint riêng test thay đổi cũng PASS.
- Prettier kiểm tra 5 file thay đổi và `git diff --check`: PASS.
- HTTPS `/health/ready` ở IP mới: **200 Healthy**, kiểm chứng bằng CA local. curl Schannel
  ban đầu không tra được revocation của CA local; lần kiểm tra dùng `--ssl-revoke-best-effort`
  vẫn kiểm tra chain/hostname. Smoke Node bên dưới cũng xác minh TLS, không dùng `-k`.
- Bundle iOS từ Metro: HTTP 200, chứa IP mới và payload email, không chứa IP cũ/payload username.
- Smoke local dùng chính `MobileSessions` đã bundle, tài khoản tổng hợp sẵn có và CA local:
  email login PASS, `/api/v1/auth/me` PASS, `/api/v1/capture/locations` PASS, logout/thu hồi phiên PASS.
  Credential chỉ xử lý trong bộ nhớ; không in mật khẩu/token. Harness tại `.tools` (ignored).

Chưa xác minh: Safari/Expo Go trên iPhone thật với mạng mới, cấu hình cách ly thiết bị của Wi-Fi,
quyền mạng nội bộ/chứng chỉ trên iPhone, E2E OCR. Không build/test lại backend vì không sửa C#;
không tuyên bố lần kiểm tra này thay thế toàn bộ backend suite hay E2E thiết bị.
