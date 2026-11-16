# Bàn giao camera OCR ngày 16/11/2026

## Phạm vi và truy vết

Yêu cầu trực tiếp của tác vụ được áp dụng trên `member/QHuy`. Working tree ban đầu sạch. Các thay đổi tập trung vào camera Mobile, mã hóa ảnh và giữ biểu mẫu CCCD trong phiên khi chuyển nền.

Đã đọc SRS tại `docs/reports/BHome_Report-3_Software Requirement Specification.docx`, quy tắc repo, app config, các màn hình gọi camera, SDK đang cài, mã native camera, API upload, tiền xử lý backend, các test và `.github/workflows/ci.yml`.

| Yêu cầu                                         | Nguồn liên quan                            | Thành phần                                             | Kiểm chứng                                                         |
| ----------------------------------------------- | ------------------------------------------ | ------------------------------------------------------ | ------------------------------------------------------------------ |
| Chụp CCCD hai mặt, OCR đề xuất, sửa và xác nhận | BF-03/04, UC-13, GBR-13, yêu cầu tác vụ    | CameraCapture, IdentityWizard                          | Document camera và onboarding UI tests                             |
| Chụp điện/nước, xem ảnh, OCR rồi Staff xác nhận | BF-05, UC-20, GBR-07                       | CameraCapture, MeterCameraView, màn hình meter hiện có | Camera, meter-flow và meterScreen tests                            |
| Camera thống nhất, xử lý quyền và phiên cũ      | Yêu cầu tác vụ phần 4–6, NFR khả dụng      | LiveCaptureCamera, CameraCapture                       | Readiness, lens, zoom, permission, background và late-result tests |
| Bảo toàn chi tiết, giới hạn upload và ảnh tạm   | GBR-13, NFR riêng tư, cấu hình API thực tế | prepareCapture, captureFiles, MobileApi.image          | Pixel/byte bounds, cleanup và raw-upload tests                     |

## A. Nguyên nhân

- Đưa quá gần có thể vượt khoảng lấy nét tối thiểu. Code JavaScript hiện tại không cung cấp khoảng cách lấy nét hay sự kiện báo AF đã khóa. Cần đo trên thiết bị để xác định đóng góp cụ thể của phần cứng, rung tay và ánh sáng.
- `autofocus="off"` đang đúng với SDK 58. Type definitions và Swift ánh xạ giá trị này sang continuous autofocus. Android dùng CameraX, thuộc tính này không cung cấp chọn ống kính vật lý hoặc đo nét qua API JavaScript.
- Test OCR dùng cấu hình camera riêng với lens/zoom. CCCD, meter và evidence có các bản `CameraView` khác. Test OCR remount khi đổi lens và nút lấy nét cũng remount toàn camera.
- Camera trước đây luôn resize cạnh dài xuống 1600 px rồi mã hóa JPEG 0.85. Backend tiếp tục tiền xử lý, có `MaxDimension=1600`. Hai bước thu ảnh và JPEG phía Mobile có thể làm mất thêm chi tiết. Chưa có đo ảnh thật để định lượng mức suy giảm.
- Zoom chuẩn hóa của Expo nằm trong 0–1 và phụ thuộc thiết bị. Cùng một giá trị có thể cho mức phóng khác nhau giữa máy và nền tảng. Zoom số có thể giảm chi tiết, đồng thời không thay đổi khoảng lấy nét vật lý tối thiểu.
- SDK đang cài đã có lựa chọn virtual multi-camera mặc định trên iOS và ưu tiên hệ camera hỗ trợ macro khi có. Mã mới giữ lựa chọn tự động của native. Sự hiện diện của ultra-wide không xác nhận khả năng macro.

Đối chiếu chính thức với [Camera SDK 58](https://docs.expo.dev/versions/v58.0.0/sdk/camera/) và [ImageManipulator SDK 58](https://docs.expo.dev/versions/v58.0.0/sdk/imagemanipulator/). Đã kiểm tra trực tiếp `node_modules/expo-camera/src/Camera.types.ts`, `CameraView.tsx`, `ios/Common/DeviceDiscovery.swift`, `ios/Current/CameraSessionManager.swift`, `CameraViewModule.swift` và `android/src/main/java/expo/modules/camera/ExpoCameraView.kt`.

## B. Code đã triển khai

| File                                                    | Thay đổi                                                                                                                           | Lý do                                                    |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `src/mobile/src/components/LiveCaptureCamera.tsx`       | CameraView dùng chung, AF liên tục, readiness, lens discovery, đổi lens tại chỗ, zoom, hướng dẫn khoảng cách                       | Đồng nhất CCCD hai mặt, điện/nước và Test OCR            |
| `src/mobile/src/components/CameraCapture.tsx`           | Một camera node cho các presentation, guard theo phiên, chống chụp đồng thời, xử lý permission/inactive/background và kết quả muộn | Vòng đời nhất quán, giải phóng file và native references |
| `src/mobile/src/components/DocumentCameraView.tsx`      | Tách guide vào vùng preview của camera                                                                                             | Khung căn CCCD không che điều khiển                      |
| `src/mobile/src/components/MeterCameraView.tsx`         | Tăng vùng camera để chứa điều khiển dùng chung                                                                                     | Giữ preview đủ chỗ khi có điều khiển                     |
| `src/mobile/src/lib/captureLenses.ts`                   | Tên riêng cho wide, ultra-wide và tele được native báo cáo                                                                         | Hiển thị đúng khả năng thiết bị                          |
| `src/mobile/src/lib/prepareCapture.ts`                  | JPEG 0.95, giữ độ phân giải trong ngân sách pixel/byte, retry mã hóa có giới hạn, cleanup                                          | Giữ chi tiết và tuân thủ backend                         |
| `src/mobile/src/features/onboarding/IdentityWizard.tsx` | Giữ trường đã nhập trong bộ nhớ phiên khi chuyển nền, hủy OCR đang chạy, bỏ xác nhận cũ                                            | Đáp ứng yêu cầu bảo toàn dữ liệu đã nhập                 |
| `src/mobile/src/__tests__/document-camera.test.tsx`     | Bổ sung kiểm thử nền tảng, lens, zoom, ready, quyền, retry, ảnh xem trước và upload                                                | Kiểm tra cơ chế dùng chung                               |
| `src/mobile/src/__tests__/prepare-capture.test.ts`      | Kiểm thử kích thước, byte limit, cancellation, lỗi và cleanup                                                                      | Bắt hồi quy pipeline                                     |
| `src/mobile/src/__tests__/onboarding-ui.test.tsx`       | Kiểm thử giữ sửa tay qua background và tiếp tục xác nhận riêng                                                                     | Bảo toàn biểu mẫu                                        |
| `tests/mobile/ocr/captureLenses.test.ts`                | Kiểm thử tele và fallback                                                                                                          | Nhãn đúng ống kính                                       |
| `docs/testing/CAMERA_OCR_2026-11-16.md`                 | Báo cáo và truy vết                                                                                                                | Bàn giao kết quả thực thi                                |

`CameraCapture` tiếp tục sở hữu quyền, chụp, file tạm và upload. `LiveCaptureCamera` quản lý native preview, lens và zoom cho mọi presentation. Evidence sử dụng camera dùng chung, đồng thời giữ chính sách ảnh 1600 px/JPEG 0.85 và giao diện riêng hiện có.

### Pipeline ảnh

| Giai đoạn        | Xử lý sau thay đổi                                                                                                         |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Camera → Capture | Native PictureRef, tránh lưu thêm bản gốc CCCD trên đĩa                                                                    |
| Resize           | Ảnh OCR trong 12.000.000 pixel được giữ kích thước, ảnh lớn hơn được thu đều hai chiều. Không crop hoặc upscale            |
| Compress         | JPEG 0.95. Nếu vượt 5 MiB thì thu kích thước từ nguồn native rồi mã hóa lại, tối đa ba lần                                 |
| Review           | Hiển thị chính file JPEG sắp đọc để upload với `contain`                                                                   |
| Upload           | `File.bytes()` gửi nguyên byte qua MobileApi.image, `Content-Type=image/jpeg`. Không có resize/recompress trong API client |
| Backend          | Request limit 5 MiB, OcrOptions.MaxPixels 12.000.000, tiền xử lý MaxDimension 1600 giữ nguyên theo cấu hình repo           |
| Cleanup          | Xóa file bị loại, ảnh CCCD sau xử lý, file tạm khi đóng/rời nền, giải phóng PictureRef/context/image, zero buffer upload   |

Ngưỡng 5 MiB được đối chiếu với `OcrController`, `OcrDiagnosticsController` và `CaptureController`. `CaptureRepository` kiểm tra 12 triệu pixel cho minh chứng công tơ. Timeout Mobile API thông thường là 15 giây, màn hình OCR dùng AbortController 20 giây, backend OCR cấu hình mặc định 8 giây. Tác vụ giữ các giới hạn này.

Đã kiểm tra bằng mock các bất biến về kích thước, tỷ lệ, JPEG options, file cleanup và byte chuyển sang upload. So sánh độ nét ảnh gốc, ảnh mã hóa và ảnh backend nhận trên camera thật vẫn cần thiết bị. Test OCR hiện có còn giữ một bản byte để retry và data URI cho preview trong cửa sổ 60 giây. Cần đo bộ nhớ thực tế khi dùng ảnh lớn hơn trước.

Ở iOS, SDK xử lý orientation, crop theo tỷ lệ preview và mã hóa mặc định quality 1 trước khi tạo PictureRef. Pipeline ứng dụng không crop thêm. Android decode theo orientation trước khi trả PictureRef. Khung CCCD là hướng dẫn căn ảnh. Cần kiểm tra đủ góc giấy tờ và mặt số trong preview/ảnh chụp trên từng thiết bị.

## C. Kết quả kiểm thử

Toàn bộ lệnh kiểm tra frontend của workflow đã chạy thành công tại local. Kiểm thử component/API dùng native mocks và fetch mocks. Kiểm thử phần cứng chưa được thực hiện.

| Hạng mục                  | Trạng thái | Kết quả                                                                       |
| ------------------------- | ---------- | ----------------------------------------------------------------------------- |
| TypeScript                | PASS       | npm run typecheck --workspace ./src/mobile                                    |
| ESLint                    | PASS       | Root và Mobile, 0 lỗi/cảnh báo                                                |
| Unit/component/API tests  | PASS       | 230 file, 2.050 test đạt, 0 thất bại. Owner Web 743 và Mobile 1.307           |
| Integration tests         | PASS       | Component/API integration trong bộ Mobile. Chưa chạy native/server E2E        |
| Camera dùng chung         | PASS       | document-camera 26 và captureLenses 4 test                                    |
| Pipeline ảnh              | PASS       | prepare-capture 10 test và API raw upload 9 test                              |
| CCCD                      | PASS       | onboarding-ui 39 test và camera hai mặt trong nhóm camera                     |
| Điện/nước                 | PASS       | meter-flow 23 test, meterScreen 5 test và các nhóm meter khác trong bộ Mobile |
| Test OCR                  | PASS       | automaticOcrScreen 14 test và camera inline trong nhóm camera                 |
| iOS native build          | BLOCKED    | Windows, thiếu Xcode và thiết bị iOS                                          |
| Android native build      | BLOCKED    | Không có Java/Gradle/Android SDK/adb trong môi trường, repo dùng CNG          |
| Mobile web export         | PASS       | Lệnh đúng workflow                                                            |
| iOS/Android bundle export | PASS       | Expo export JavaScript/Hermes trên cả hai nền tảng                            |
| Prettier                  | PASS       | Toàn repo theo workflow                                                       |
| Git diff check            | PASS       | git diff --check                                                              |

## D. Kết quả CI

Workflow đã đọc là `.github/workflows/ci.yml`. Workflow chạy khi pull request vào `main`, `develop`, `release/**`, hoặc workflow_dispatch. Job frontend dùng Ubuntu 24.04, Node 22 và npm. Job backend dùng .NET 8 cùng PostgreSQL/MinIO/LibreOffice Docker fixtures. Các thay đổi của tác vụ thuộc Mobile và test/docs liên quan.

Các lệnh local tương đương job frontend được chạy bằng Node 22.23.4 và npm 10.9.9 có sẵn trong `.tools`. Windows dùng `npm.cmd`/`npx.cmd` do PowerShell chặn launcher `.ps1`.

```text
npm ci --no-fund --no-audit
npm run lint
npm run typecheck --workspace ./src/mobile
npm test
npm run build
npx --no-install expo export --platform web --max-workers 2 --output-dir dist
npm run format:check
docker compose --env-file .env.example config --quiet
docker compose --project-name bhome-sepay-ci --env-file .env.sepay.example -f deploy/compose.sepay.yml config --quiet
```

Web build dùng `VITE_API_BASE_URL=https://api.example.com`. Expo export dùng `EXPO_NO_DOTENV=1` và `EXPO_PUBLIC_API_BASE_URL=https://api.example.invalid` giống CI. Có thêm kiểm tra Mobile riêng và JavaScript/Hermes bundle cho iOS/Android, được báo tách khỏi native compilation.

Job backend chưa chạy trong tác vụ này. Backend, schema, provider và API contract không có thay đổi. GitHub Actions chưa có lần chạy cho working tree hiện tại. Báo cáo này ghi kết quả local.

Log thực thi nằm trong `.tmp/camera-*.log`, được Git ignore. Những lần thất bại ban đầu do test mock chưa bổ sung `reset`, expectation điều khiển cũ, assertion checkbox và lint đọc ref trong render đã được sửa và được kiểm tra lại trong bộ cuối.

npm ci đạt với 903 package. Root tests đạt 2.050/2.050. Root lint, Mobile lint/typecheck, web builds, Mobile web export, iOS/Android bundle export, format check và cả hai Compose config checks đều đạt. Lượt Mobile riêng bằng JSON reporter xác nhận 124 file và 1.307 test đạt. Báo cáo JSON tại .tmp/camera-mobile-results.json.

Owner Web có cảnh báo jsdom HTMLCanvasElement.prototype.getContext trong các test ký hợp đồng hiện có, kết quả 106 file/743 test đều đạt. npm ci có cảnh báo deprecated whatwg-encoding. Mechanical UI detector trả về danh sách rỗng. Chưa có kiểm tra hình ảnh giao diện trên điện thoại.

## E. Rủi ro và giới hạn

- Chưa có iPhone macro/non-macro, Android nhiều camera/camera đơn hoặc máy fixed-focus để đo AF, độ nét và chuyển camera.
- Giữ ceiling zoom chuẩn hóa 0.12 từ code cũ. Mức này chưa được hiệu chuẩn theo thiết bị, chưa thể xác nhận đạt chất lượng OCR trên toàn bộ máy. Zoom mặc định bằng 0.
- Khoảng chờ 500 ms sau ready/zoom/lens là thời gian cho preview ổn định. SDK không báo hoàn tất AF cho JavaScript. Người dùng vẫn cần kiểm tra chữ rõ trong preview và ảnh chụp.
- JPEG 0.95 là lựa chọn triển khai nhằm giữ chi tiết. Chưa có phép đo độ nét/OCR trên phần cứng để xác nhận lợi ích định lượng.
- Ảnh gốc độ phân giải cao vẫn được native tạo trước khi thu về giới hạn backend. Cần đo peak memory, thời gian mã hóa/upload và phản hồi trên thiết bị RAM thấp/mạng yếu.
- Ánh sáng yếu, lóa và rung tay có thể làm mờ ngay ảnh gốc. Camera fixed-focus hoặc thiết bị không macro cần khoảng cách phù hợp.
- Backend tiếp tục thu về kích thước phục vụ model đang dùng. Muốn thay đổi mức này cần đánh giá thuật toán/dataset riêng.
- Native compilation, entitlement/permission thực tế và OCR qua máy chủ thật chưa được chứng minh bằng các mock/bundle export.

## F. Trạng thái cuối

Branch hiện tại là member/QHuy. Working tree có 12 file thay đổi trong bảng B, gồm bốn file mới. Working tree ban đầu sạch nên toàn bộ diff được tạo trong tác vụ này. Không có thay đổi lockfile, dependency, backend hoặc workflow.

Các kiểm tra local tương đương job frontend đạt, có thể chuyển sang bước review và push do người dùng thực hiện. GitHub Actions chưa được kiểm chứng cho diff hiện tại. Chưa có commit, push, PR hoặc merge trong tác vụ.

Mục tiêu ổn định trên phần cứng vẫn cần native build và kiểm thử iPhone/Android thật. Cần đo ảnh gốc → JPEG → byte backend, độ nét gần/zoom/thiếu sáng, mức zoom phù hợp từng thiết bị, macro, bộ nhớ và độ trễ upload trước khi xác nhận hoàn thành toàn bộ tác vụ.
