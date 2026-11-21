# Camera OCR continuous autofocus và tap-to-focus

## A. Nguyên nhân và truy vết

Yêu cầu được triển khai trên `member/QHuy`, từ commit `edc0a3b6`. Working tree ban đầu sạch. SRS và quy tắc repo áp dụng BF-03/04, UC-13, GBR-13 cho CCCD, BF-05, UC-20, GBR-07 cho chỉ số điện/nước. OCR tiếp tục là đề xuất cần người dùng kiểm tra và xác nhận. Thay đổi này mở rộng camera native theo yêu cầu trực tiếp của tác vụ.

| Hành vi yêu cầu                     | Thành phần                                    | Kiểm chứng                                                                  |
| ----------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------- |
| AF tự động và thay đổi khoảng cách  | LiveCaptureCamera, BhomeCameraFocus.swift/.kt | Props AF, capability, native source, native tests, cần kiểm chứng phần cứng |
| Chạm vào preview và lấy nét thật    | Gesture native, AVFoundation/CameraX          | Native command, tọa độ qua preview factory/layer, request generation        |
| Hiển thị kết quả có căn cứ          | cameraFocus, LiveCaptureCamera                | Native event validation, trạng thái, callback cũ và fallback tests          |
| Đồng nhất CCCD, điện/nước, Test OCR | CameraCapture → LiveCaptureCamera hiện có     | Tests component và workflow                                                 |
| Giữ pipeline và giới hạn ảnh        | prepareCapture hiện có                        | Tests pipeline, API raw bytes và kiểm tra diff                              |

Camera mờ khi quá gần có thể do khoảng lấy nét tối thiểu, rung, ánh sáng hoặc khả năng AF của ống kính. Digital zoom có thể giảm chi tiết. Phần cứng cần phép thử thật để xác định mức đóng góp của từng nguyên nhân.

Commit trước đã thống nhất camera và cải thiện pipeline. SDK đang dùng là Expo 58, expo-camera 58.0.14. TypeScript definitions xác định `autofocus="off"` là tự động lấy nét khi cần. Native iOS ánh xạ sang continuousAutoFocus, Android giao cho CameraX. API JavaScript chuẩn chưa có focus point, tap-focus request hoặc focus result.

Cần mở rộng native để đáp ứng tap-to-focus. Config plugin mở rộng chính module/view Expo đang dùng. Bản build có thêm capability `bhomeFocusVersion=1`, prop bật focus và sự kiện `onBhomeFocusChanged`. Helper thao tác trên camera trong session Expo hiện hữu. Library và phiên bản SDK được giữ trong kiến trúc hiện tại.

## B. Giải pháp triển khai

### iOS

- Dùng AVCaptureDeviceInput trong AVCaptureSession hiện tại của Expo CameraView.
- Khi thiết bị thay đổi hoặc tính năng được bật, kiểm tra continuousAutoFocus/autoFocus/focusPointOfInterest và khôi phục continuous AF nếu có hỗ trợ.
- UITapGestureRecognizer nhận vị trí trong native CameraView. AVCaptureVideoPreviewLayer.captureDevicePointConverted(fromLayerPoint:) chuyển đổi crop, video gravity, orientation và mirroring trước khi cập nhật focusPointOfInterest.
- Chạm kích hoạt autoFocus tại điểm nếu có, sau đó trở lại continuous AF khi KVO báo kết thúc điều chỉnh hoặc hết thời gian chờ.
- KVO isAdjustingFocus được theo dõi. UI dùng “Đã điều chỉnh tiêu cự” khi một chu kỳ điều chỉnh kết thúc. AVFoundation không cung cấp kết quả sharpness tương đương FocusMeteringResult.
- subjectAreaDidChangeNotification đặt lại vùng trung tâm và continuous AF khi chủ thể thay đổi. isSubjectAreaChangeMonitoringEnabled được bật.
- Serial queue của session bảo vệ cập nhật cấu hình. Request ID, timeout và observer được hủy khi đóng view hoặc đổi thiết bị.

### Android

- Dùng Camera/CameraControl đã bind của ExpoCameraView, giữ continuous-picture AF mặc định của CameraX. cancelFocusAndMetering() khôi phục AF mặc định sau thao tác tại điểm.
- GestureDetector nhận một lần chạm trong PreviewView. PreviewView.meteringPointFactory chuyển tọa độ view sang MeteringPoint phù hợp scale/crop, display/sensor orientation và mirroring.
- FocusMeteringAction FLAG_AF chỉ chạy khi AF modes và isFocusMeteringSupported xác nhận hỗ trợ.
- Chỉ FocusMeteringResult.isFocusSuccessful mới tạo trạng thái “Đã lấy nét”. Fixed-focus được kiểm tra riêng vì CameraX có thể trả thành công cho no-op trên máy thiếu AF.
- Lần chạm mới hủy thao tác trước. Callback kiểm tra request ID và camera hiện tại. Auto-cancel 3 giây, deadline 3,5 giây đảm bảo UI thoát trạng thái chờ khi future không trả.
- Cleanup tháo listener và hủy focus trước khi Expo unbind camera.

### Giao diện, fallback và chất lượng ảnh

LiveCaptureCamera dùng chung cho CCCD hai mặt, điện, nước và Test OCR. Camera tiếp tục dùng autofocus tự động, người dùng có thể chạm để chọn điểm. Khung focus được vẽ từ sự kiện native tại vị trí normalized trong preview. Callback cũ, payload không hợp lệ và tọa độ ngoài vùng bị bỏ qua.

Trạng thái focus nằm trên lớp phủ của preview, để giữ diện tích ngắm ảnh trên màn hình nhỏ. Guard theo request ID vẫn loại kết quả đã thuộc phiên trước khi zoom hoặc đổi ống kính, kể cả khi sự kiện đến sau thời gian ổn định preview.

Khởi tạo, đang điều chỉnh, thành công Android, đã kết thúc điều chỉnh iOS, thất bại, hết thời gian và thiếu hỗ trợ có thông báo riêng. Người dùng vẫn có thể chụp khi AF chưa có kết quả. Khoảng chờ ổn định preview không tạo trạng thái focus thành công.

Expo Go hoặc binary cũ dùng camera chuẩn cùng hướng dẫn kiểm tra ảnh, qua capability check. Tap-to-focus native cần build mới. Ultra-wide được hiển thị theo discovery, macro phụ thuộc khả năng thực tế của thiết bị. Zoom vẫn mặc định 0 và ceiling chuẩn hóa hiện có 0.12, chưa hiệu chuẩn theo thiết bị.

Pipeline hiện có giữ JPEG 0.95, tối đa 12 triệu pixel và 5 MiB theo backend. Source PictureRef → resize theo giới hạn → JPEG → file review → raw bytes upload. Backend tiếp tục MaxDimension 1600 theo cấu hình model. API client gửi nguyên byte JPEG. Tác vụ này giữ pipeline đã được kiểm chứng bằng mock ở commit trước. So sánh ảnh gốc/resize/JPEG/upload, orientation, độ nét và bộ nhớ trên máy thật vẫn chưa thực hiện.

### Expo, CNG và rollback

Plugin chỉ áp dụng source patch khi prebuild chạy, trước native compilation. Nó xác minh phiên bản 58.0.14 và SHA-256 của bốn file upstream trước khi ghi. Chạy lặp giữ nguyên kết quả. Khi source upstream thay đổi, prebuild yêu cầu kiểm tra lại patch.

`expo.autolinking.android.buildFromSource` và `ios.buildFromSource` chọn riêng expo-camera để biên dịch phần mở rộng. Module registration hiện có của Expo được giữ. New Architecture đi qua Expo Modules API hiện tại. EAS cần native build mới để phát hành tính năng, OTA JavaScript dùng capability fallback trên binary cũ.

Rollback bằng cách gỡ plugin và cấu hình source build, chạy npm ci để khôi phục package source rồi prebuild/build lại. Binary cũ tiếp tục khả năng của camera chuẩn. Không có migration dữ liệu.

Đã đối chiếu [Camera SDK 58](https://docs.expo.dev/versions/v58.0.0/sdk/camera/), [config plugins](https://docs.expo.dev/config-plugins/introduction/), [Expo source builds](https://docs.expo.dev/guides/prebuilt-expo-modules/), [CameraX PreviewView](https://developer.android.com/reference/androidx/camera/view/PreviewView), [FocusMeteringAction](https://developer.android.com/reference/androidx/camera/core/FocusMeteringAction), [FocusMeteringResult](https://developer.android.com/reference/androidx/camera/core/FocusMeteringResult) và [AVCaptureVideoPreviewLayer conversion](<https://developer.apple.com/documentation/avfoundation/avcapturevideopreviewlayer/capturedevicepointconverted(fromlayerpoint:)>).

## C. File thay đổi

| File                                                      | Nội dung                                                         |
| --------------------------------------------------------- | ---------------------------------------------------------------- |
| `src/mobile/app.json`                                     | Đăng ký config plugin focus                                      |
| `src/mobile/package.json`                                 | Biên dịch expo-camera từ source trên hai nền tảng                |
| `scripts/mobile/withCameraFocus.cjs`                      | Patch native view/module có kiểm tra version/hash và idempotency |
| `src/mobile/plugins/camera-focus/BhomeCameraFocus.swift`  | AVFoundation adapter trên session hiện hữu                       |
| `src/mobile/plugins/camera-focus/BhomeCameraFocus.kt`     | CameraX adapter trên camera hiện hữu                             |
| `src/mobile/plugins/camera-focus/BhomeCameraFocusTest.kt` | Native Robolectric tests cho focus, tọa độ, hủy, fallback        |
| `src/mobile/src/lib/cameraFocus.ts`                       | Capability, event validation và thông báo trạng thái             |
| `src/mobile/src/components/LiveCaptureCamera.tsx`         | Bật native focus, hiển thị điểm và trạng thái                    |
| `src/mobile/src/__tests__/setup.ts`                       | Mock optional native module trong môi trường Node                |
| `src/mobile/src/__tests__/camera-focus.test.ts`           | Trạng thái focus, capability, payload, tọa độ và request cũ      |
| `src/mobile/src/__tests__/document-camera.test.tsx`       | Camera dùng chung, callback native và fallback                   |
| `tests/mobile/ocr/cameraFocusPlugin.test.ts`              | Kiểm tra patch hai nền tảng, idempotency và conflict             |
| `docs/testing/CAMERA_FOCUS_2026-11-16.md`                 | Truy vết, thiết kế native và kết quả thực thi                    |

## D. Kết quả test

Các test JavaScript dùng mocks cho API/camera. Native Android dùng Robolectric và MockK, trực tiếp chạy helper Kotlin với CameraX metering point factory và future kết quả focus. Chưa có thiết bị thật kết nối, `adb devices` xác nhận 0 thiết bị.

| Hạng mục                       | Kết quả    | Bằng chứng                                                                             |
| ------------------------------ | ---------- | -------------------------------------------------------------------------------------- |
| TypeScript                     | PASS       | Mobile typecheck, exit 0                                                               |
| ESLint                         | PASS       | Root lint, 0 lỗi/cảnh báo                                                              |
| Unit/component/API tests       | PASS       | Owner Web 106 file/743 test, Mobile 126 file/1.340 test, 0 thất bại                    |
| Focus JS và component          | PASS       | camera-focus 19, cameraFocusPlugin 5, document-camera 35 test                          |
| Native Android tests           | PASS       | BhomeCameraFocusTest 9/9, failures 0, errors 0, skipped 0                              |
| Integration tests              | PASS       | Component/API integrations trong bộ Mobile, các workflow hiện có tiếp tục đạt          |
| iOS autofocus                  | NOT TESTED | Chưa chạy trên iPhone hoặc simulator native                                            |
| Android autofocus              | NOT TESTED | Native capability/khôi phục AF được test bằng Robolectric, chưa đo phần cứng           |
| iOS tap-to-focus               | NOT TESTED | Đã viết adapter, chưa có Xcode build và thiết bị                                       |
| Android tap-to-focus           | NOT TESTED | Lệnh native, tọa độ, result và cancellation đạt native tests, chưa đo trên camera thật |
| CCCD                           | PASS       | Onboarding UI 39 và camera hai mặt trong nhóm document-camera                          |
| Điện/nước                      | PASS       | meter-flow 23, meterScreen 5 và các nhóm meter hiện có                                 |
| Test OCR                       | PASS       | automaticOcrScreen 14 và luồng camera inline                                           |
| Android module build           | PASS       | compileDebugKotlin và assembleDebug, tạo expo-camera-debug.aar                         |
| Android APK debug              | PASS       | app:assembleDebug, BUILD SUCCESSFUL, APK debug đã tạo                                  |
| iOS build/prebuild             | BLOCKED    | Expo CLI từ chối iOS prebuild trên Windows, thiếu macOS/Xcode                          |
| Web builds                     | PASS       | npm run build                                                                          |
| Mobile web/iOS/Android bundles | PASS       | Expo export trên cả ba nền tảng                                                        |
| Prettier                       | PASS       | Root format:check và kiểm tra lại báo cáo sau cập nhật                                 |
| Compose config                 | PASS       | Cấu hình chính và SePay                                                                |
| Git diff check                 | PASS       | git diff --check                                                                       |

Tổng số test đã đạt là 2.092, gồm 2.083 JavaScript và 9 native Android. Kết quả này không bao gồm kiểm thử camera trên phần cứng hoặc backend OCR qua mạng thật.

## E. CI và môi trường native

Đã đọc toàn bộ `.github/workflows/ci.yml`, workflow duy nhất trong repo. Job frontend dùng Ubuntu 24.04, Node 22, npm. Trigger PR vào main/develop/release hoặc workflow_dispatch. Job backend dùng .NET 8 và Docker fixtures. Tác vụ không thay đổi backend.

Đã chạy thành công các lệnh local tương đương job frontend bằng Node 22.23.4 và npm 10.9.9.

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

Mobile có thêm lượt JSON reporter đạt 1.340 test tại `.tmp/focus-mobile-results.json`. Expo iOS/Android bundle export đều exit 0. Build web dùng VITE_API_BASE_URL=https://api.example.com. Expo export dùng EXPO_NO_DOTENV=1 và EXPO_PUBLIC_API_BASE_URL=https://api.example.invalid giống workflow.

Android prebuild được chạy trong bản sao project tại .tmp. Expo config-plugins trên Windows truyền glob có backslash vào tinyglobby, khiến bước PackageRefactor quét symlink và bị kẹt. Đã chẩn đoán stack của process kiểm chứng, dùng shim tạm chuyển absolute Windows glob sang slash trong riêng lệnh prebuild. Android prebuild sau shim đã hoàn tất. Đây là kiểm chứng có workaround, cần chạy prebuild chuẩn trên môi trường Linux/macOS dùng cho build.

iOS prebuild đã thử bằng CLI. Expo bỏ qua iOS trên Windows và trả CommandError. iOS native build cần macOS/Xcode. Các kết quả này được giữ là BLOCKED.

Đã cài Android CLI/SDK vào `.tmp/camera-focus-sdk`, kiểm tra checksum công cụ từ repository chính thức Google, dùng JDK 21.0.8 và Gradle 9.4.1. SDK platform 37.0, build-tools 37/36 và NDK 27.1.12297006 phục vụ build hiện có. Các công cụ và project sinh ra đều nằm trong thư mục được Git ignore.

Autolinking Android nhận `expo.modules.camera.CameraViewModule` cùng sourceDir của expo-camera. Log Gradle xác nhận expo-camera biên dịch từ source, các module khác dùng chính sách precompiled hiện có. Không đăng ký thêm camera module hoặc session.

```text
gradlew.bat :expo-camera:compileDebugKotlin :expo-camera:testDebugUnitTest --no-daemon
gradlew.bat :expo-camera:testDebugUnitTest :expo-camera:assembleDebug --no-daemon
gradlew.bat :app:assembleDebug --no-daemon --max-workers=2
```

Gradle lần đầu thiếu SDK. Sau khi cài SDK/NDK, Kotlin camera đã compile thành công. Download thư viện test gặp socket Permission denied: getsockopt, được khắc phục bằng JAVA_TOOL_OPTIONS=-Djava.net.preferIPv4Stack=true. Lượt Robolectric đầu lỗi fixture static mock, đã sửa theo Kotlin companion của CameraX 1.6 rồi chạy lại đạt 9/9. Lượt cuối module test/assemble báo BUILD SUCCESSFUL. Báo cáo XML nằm tại `node_modules/expo-camera/android/build/test-results/testDebugUnitTest/TEST-expo.modules.camera.BhomeCameraFocusTest.xml`.

Các cảnh báo jsdom canvas ở Owner Web, deprecated npm package và API Gradle/Kotlin hiện có vẫn xuất hiện. Các test frontend và module native cuối đều đạt. Mechanical UI detector trả danh sách rỗng. Chưa có kiểm tra giao diện trên điện thoại thật.

APK debug trên Windows vướng Ninja 1.10.2 đi kèm CMake 3.22.1 khi tạo thư mục object C++ dài trong các dependency Screens/Worklets/Reanimated. Đã dùng drive mapping `R:` vào workspace và init script `.tmp/focus-native-paths.gradle` để đặt staging ngắn, cùng CMAKE_OBJECT_PATH_MAX=128 cho Reanimated/app. Sau đó dùng Ninja 1.13.2 từ nguồn chính thức trong SDK tạm. Thao tác xóa cache CMake từng bị automatic approval review chặn với thông báo chung “blocked by policy”, các lượt tiếp theo dùng cache hiện có. Các workaround này thuộc môi trường kiểm chứng, không nằm trong diff ứng dụng. [Ninja v1.13.2](https://github.com/ninja-build/ninja/releases/tag/v1.13.2)

Lệnh APK cuối dùng thêm `--max-workers=2 --init-script R:/.tmp/focus-native-paths.gradle`, NODE_OPTIONS=`--preserve-symlinks --preserve-symlinks-main`, JDK 21, SDK/Gradle cache trong `.tmp` và IPv4 như trên. Build toàn ứng dụng với New Architecture và bốn ABI đã báo BUILD SUCCESSFUL trong `.tmp/focus-android-app-ninja.log`. APK tại `.tmp/camera-focus-prebuild/android/app/build/outputs/apk/debug/app-debug.apk`, 240.276.678 byte. Đây là APK debug cần Metro khi chạy ứng dụng. Chưa có thiết bị để cài và kiểm tra camera thực tế.

Log `.tmp/focus-*.log` được giữ để đối chiếu. GitHub Actions chưa chạy cho diff hiện tại. Job backend chưa chạy trong tác vụ này vì phần thay đổi thuộc Mobile/native và test liên quan.

## F. Git

Branch member/QHuy. Working tree ban đầu sạch. Tác vụ có 13 file trong bảng C, gồm 5 file sửa và 8 file mới. Tác vụ hiện tại chưa commit, push, merge hoặc tạo PR. Lockfile, backend và workflow không có diff. Các project native sinh ra và công cụ SDK được Git ignore.

## G. Điều kiện bàn giao

Đã triển khai camera focus native dùng chung, continuous AF theo khả năng thiết bị, tap-to-focus thật, trạng thái có căn cứ, timeout, fallback và hủy request cũ. Android Kotlin, native AAR, APK debug toàn ứng dụng và 9 Robolectric test đã được thực thi thành công. Các bước local tương đương job frontend đạt.

Cần Xcode build cho iOS và camera thật để nghiệm thu đầy đủ. Cần thử iPhone macro/non-macro, Android nhiều camera/camera đơn/fixed-focus, đổi khoảng cách, chạm các góc preview, thiếu sáng, zoom, capture trong lúc focus và background/foreground. Độ chính xác point trên sensor, độ nét thực tế, bộ nhớ ảnh lớn và thời gian upload cần đo tại đây.

Code có thể chuyển sang review và push để chạy GitHub Actions. Mục tiêu hoạt động ổn định trên cả iPhone/Android chưa được xác nhận bằng phần cứng. Các lựa chọn JPEG 0.95, chờ ổn định 500 ms và ceiling zoom 0.12 từ phiên trước tiếp tục cần hiệu chuẩn. Tap-to-focus cần native build mới, Expo Go/binary cũ dùng fallback.
