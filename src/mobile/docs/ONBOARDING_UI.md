# Staff onboarding và tiến trình hợp đồng

Phạm vi: chỉ Frontend Mobile trong `src/mobile`. Yêu cầu nguồn: tác vụ người dùng
“Refactor BHOME Mobile Frontend – Tenant Onboarding, CCCD OCR UI, Progress Stepper & Bottom Navigation”.
Liên quan UC-13 (tiếp nhận/CCCD), UC-15/16 (hợp đồng), quy tắc xác nhận thủ công và trạng thái hợp đồng do backend quyết định.
Đối chiếu trực tiếp controller/DTO/service hiện có; không thay đổi backend, database, API hoặc dependency.

## Các file triển khai

- `src/screens/OnboardingScreen.tsx`: wizard Chọn phòng → Người ở → CCCD → Xác nhận.
- `src/features/onboarding/OnboardingPeopleStep.tsx`: phần trình bày bước Người ở, tách hình thức thuê/danh sách/form; các callback và điều kiện nghiệp vụ vẫn do OnboardingScreen quản lý.
- `src/components/OnboardingStepper.tsx`: stepper có số bước, tên bước và danh sách bước hoàn thành cấu hình được; dùng chung cho hợp đồng.
- `src/features/onboarding/onboarding.ts`: kiểu người ở, trạng thái và điều kiện chuyển bước.
- `src/features/onboarding/IdentityWizard.tsx`: chụp mặt trước CCCD, cảnh báo OCR, nhập/sửa thủ công và xác nhận thực từ server. Theo yêu cầu bổ sung, bỏ giao diện chụp mặt sau; không bắt buộc chụp cả hai mặt để kiểm tra/xác nhận thông tin.
- `src/features/workspace/navigation.ts`: bốn tab Staff và ánh xạ màn con về tab tương ứng.
- `src/components/WorkspaceShell.tsx`: navigation 60dp + bottom safe area một lần, icon 22dp, label 11sp, active màu xanh.
- `src/features/workspace/WorkspaceProvider.tsx`: xác nhận trước khi điều hướng ra khỏi bản nháp, gồm nút header/tab/thoát preview.
- `src/features/contracts/ContractProgress.tsx`: tiến trình hợp đồng và trạng thái ký riêng Owner/Tenant.
- `src/features/contracts/ContractScreen.tsx`: tích hợp tiến trình vào chi tiết hợp đồng hiện có.
- `src/theme/theme.ts`: navy và nền active Staff theo yêu cầu.
- `src/__tests__/*`: kiểm tra tương tác, trạng thái, điều hướng và safe area.
- `vitest.config.ts`: bổ sung vị trí test bên trong Mobile, giữ toàn bộ test cũ.

## Hành vi

- Chỉ tiếp tục sau khi chọn phòng hợp lệ trong danh sách được cấp quyền.
- Nếu chỉ có một cơ sở được phân công: tự chọn cơ sở, tải phòng ngay và hiển thị cơ sở cố định thay dropdown.
  Nếu có nhiều cơ sở: vẫn yêu cầu chọn đúng cơ sở; không tự chọn ngẫu nhiên. Khi phân công bị thu hồi, xóa lựa chọn/phòng cũ.
- Thêm người ở, chọn đại diện, chỉnh nhãn/xóa các bản nháp chưa gửi lên server.
- Hộ gia đình: đại diện dùng residentType=0, thành viên dùng 1. Cá nhân/nhóm bạn: mỗi hồ sơ dùng 0.
- Sau khi một hồ sơ được tạo, khóa phòng, hình thức và đại diện để không đổi nhãn nhóm trái với dữ liệu đã gửi.
- Giữ form CCCD riêng cho từng người trong bộ nhớ khi đi lại giữa các bước. Camera chỉ được mount cho người và bước đang mở.
- Xóa thông tin định danh chưa xác nhận khi ứng dụng vào background; giữ cơ chế xóa ảnh tạm của CameraCapture.
- OCR có thể thất bại mà vẫn cho nhập thủ công. Đề xuất OCR không tự động được lưu vào hồ sơ chính thức.
- Sau khi OCR trả kết quả (kể cả fallback) hoặc báo lỗi, tự mở form kiểm tra/nhập bổ sung; không để người dùng bị kẹt ở màn chụp với trạng thái chờ xác nhận.
- Xác nhận chỉ thành công sau POST confirm trả đúng residentId và verificationStatus=1. Chặn gửi lặp khi đang xử lý.
- Chỉ mở bước kiểm tra cuối sau khi tất cả người ở được xác nhận. “Hoàn tất tiếp nhận” kết thúc phần kiểm tra tại giao diện; không gọi một API hoàn tất nhóm giả định.
- Chuyển đến route chuẩn bị hợp đồng hiện có bằng thao tác riêng; không tự tạo hoặc kích hoạt hợp đồng.
- Chữ ký `Simulated` và `Failed` không được coi là chữ ký đã xác minh. Một bên ký xong vẫn chờ bên còn lại.
- Không suy ra thanh toán thành công hoặc Active từ việc hai bên đã ký. Không tự sinh QR.

## API giữ nguyên

- GET `/api/v1/capture/locations`
- GET `/api/v1/capture/locations/{locationId}/rooms`
- POST `/api/v1/capture/residents`: `{ roomId, displayLabel, residentType, email }` (email riêng bắt buộc theo BR-01/05 được ghi nhận ngày 10/11/2026).
- POST `/api/v1/ocr/identity/{residentId}/{front|back}`: bytes ảnh qua MobileApi.image, xác thực hiện có.
- POST `/api/v1/capture/residents/{residentId}/confirm`: dữ liệu đã chỉnh + humanConfirmed=true.
- Các truy vấn hợp đồng và readiness dùng client/hook hiện có.

## Khôi phục khi trùng email — 14/11/2026

Truy vết: BF-03/04, UC-13, GBR-01/02/13; BR-01/05 trong `docs/development/BHOME_NQH_IMPLEMENTATION_RESULTS_2026-11-10.md`. Không đổi chính sách email duy nhất, quyền Staff hoặc lưu trữ CCCD.

Trước khi mở nhập tay/camera, Mobile tạo hồ sơ qua POST residents. `409 resident_email_already_associated` nghĩa là email đã gắn với Resident; chưa phải lỗi OCR. UI trước đây hiện lỗi 409 chung và không có đường khôi phục cụ thể.

- Hiện thông báo đúng mã lỗi, giữ dữ liệu nháp và cho quay lại sửa email của người đang thao tác.
- Sau xung đột, chỉ đọc GET `/api/v1/capture/locations/{locationId}/residents` hiện có. Nếu đúng một summary khớp email (không phân biệt hoa/thường) và đúng phòng, cho thao tác mở hồ sơ cũ qua `residentId`/`locationId`. Trang chi tiết tải lại scoped summary và dùng trạng thái xác minh từ backend.
- Không tự nối hồ sơ cũ vào nhóm mới, xác nhận CCCD hoặc tạo lại hồ sơ. Không truy vấn global email hoặc dữ liệu định danh đã giải mã. Khác phòng, không tìm thấy, response không có email hoặc lookup thất bại: hướng dẫn kiểm tra danh sách trong phạm vi hiện có. Không lộ ID/phòng ngoài phạm vi.
- `IdentityWizard` chỉ mount hook chống chụp màn hình trên native; Web không gọi API ScreenCapture không được hỗ trợ. Giữ bảo vệ native và xóa dữ liệu tạm khi background.

Kiểm tra tự động: **101 files / 1.119 tests Mobile PASS**, lint và typecheck PASS. Thêm 10 ca: pending/verified existing profile, sửa email rồi vào manual/camera, khác phòng/email/không thấy/lookup lỗi, Web không gọi native hook, Android giữ hook. Các fixture dùng dữ liệu tổng hợp; không thay dữ liệu live, schema, API hoặc backend.

Chrome với Web export và transport tổng hợp PASS: đăng nhập Staff → tạo bị 409 → thông báo/mở hồ sơ đúng phòng → xác nhận rời phiên qua guard hiện có → tải lại hồ sơ scoped → mở/đóng nhập tay. Chỉ một POST create, không gọi OCR/confirm, không page error hoặc ScreenCapture error; không tràn ngang ở 360/768/1280px. Browser script/artifacts ở `.tools/owner-pdf-validation/onboarding-email*` (ignored). Lượt đầu dùng development export với static server bị lỗi module resolution, không được tính PASS. Camera/OCR thật, thiết bị Android/iOS và backend live: **NOT RUN** cho lượt sửa UI này.

## Sửa form nhập tay trống trên Web — 14/11/2026

Truy vết: UC-13 / GBR-13 → `IdentityFlowFrame` (modal dùng chung cho nhập tay và kiểm tra OCR). Không đổi dữ liệu xác nhận hoặc business rules.

Tái hiện bằng Chrome: các input có trong DOM nhưng ScrollView cao **0px**; SafeAreaView có `paddingBottom: 900px` trên viewport cao 900px. Safe-area-context 5.10.1 của Mobile đo provider trong lúc modal `slide` đang dịch xuống ngoài màn hình, giữ nhầm phần dịch chuyển thành safe-area inset. Kiểm tra browser ở lượt trước chỉ chờ input tồn tại, chưa kiểm tra clipping/khả năng nhập nên bỏ sót lỗi này.

Modal Web đổi sang `fade` để provider không bị dịch chuyển khi đo; native giữ `slide`. Không sửa node_modules, dependency hoặc safe-area toàn ứng dụng. Test component xác minh Web/native chọn animation tương ứng. Browser regression được lưu ở `tests/mobile/onboarding.browser.cjs`: tái hiện lỗi trước sửa, sau sửa input có viewport khác 0, nhập được CCCD/họ tên/ngày sinh/ngày cấp, cuộn tới nút xác nhận, nút vẫn bị khóa khi chưa đối chiếu giấy tờ, đóng/mở lại giữ dữ liệu tạm. PASS trên 360/768/1280/1920px, không page error/ScreenCapture error; ảnh kiểm tra ở `.tools/onboarding-browser` (ignored). Dùng synthetic transport và dữ liệu tổng hợp, không gọi OCR/confirm hoặc sửa hồ sơ thật. Thiết bị native/camera thật: **NOT RUN**. Full Mobile **101 files / 1.119 tests PASS**; lint/typecheck/format PASS.

Chạy lại từ repo root với Node 22: export Mobile Web tới `src/mobile/.expo/onboarding-email-browser` bằng `EXPO_NO_DOTENV=1` và `EXPO_PUBLIC_API_BASE_URL=https://api.example.invalid`, rồi `node tests/mobile/onboarding.browser.cjs`. Có thể đặt `BHOME_MOBILE_WEB_DIST` cho thư mục export khác và `BHOME_BROWSER_EXECUTABLE` cho executable Chrome/Chromium hiện có. Script không truy cập API live.

## Khôi phục hồ sơ đã xác nhận nhưng UI còn 0/1 — 14/11/2026

Truy vết: BF-03/04, UC-13 → UC-15/16; GBR-01/02/13. Response người dùng cung cấp: POST confirm trả **409 `identity_already_confirmed`**. `CaptureRepository.ConfirmIdentityAsync` chỉ trả mã này khi Resident đã Verified và payload nhập lại khác nội dung được bảo vệ đã lưu. Không phải bằng chứng OCR hoặc lưu ban đầu thất bại; không được bỏ guard bất biến hoặc ghi đè identity để làm nút tiếp tục bật.

- `IdentityWizard` hiển thị lỗi rõ và thao tác **Dùng hồ sơ đã xác nhận**. Sau thao tác chủ động, đọc scoped ResidentSummary hiện có và bắt buộc trùng Resident ID, Room ID, VerificationStatus=Verified trước khi cập nhật UI. Không POST confirm lần nữa, không nhận nội dung vừa nhập làm nội dung đã lưu, không gọi `onVerifiedSummary` bằng dữ liệu nhập lại. Nếu cần sửa identity đã xác nhận, liên hệ Owner theo quy trình hiện có.
- `OnboardingScreen` có **Kiểm tra trạng thái đã lưu** cho trường hợp response bị mất/ứng dụng background sau khi server commit. Chỉ khôi phục ID đã tạo trong phiên tại đúng phòng; không tự ghép theo email. Callback xóa dữ liệu tạm không hạ trạng thái đã được server xác nhận. Không mở contract khi pending, sai ID/phòng hoặc lookup bị từ chối.
- Lỗi confirm được giữ trên card sau đóng modal; Web đặt ô đối chiếu, nút lưu và lỗi ở footer dễ thấy. Native giữ controls trong vùng cuộn có xử lý bàn phím. Không đổi yêu cầu humanConfirmed, privacy background, API hoặc backend.
- Regression bao gồm đúng mã 409, explicit recovery, negative scope/status, mất response lúc background và check-saved-state. Browser có hai chế độ: lỗi 503 rồi retry thành công; và `BHOME_ONBOARDING_CONFIRM_CONFLICT=1` cho 409 rồi đọc lại Verified. Cả hai đi tới **1/1 → prepare-contract với đúng IDs**; 409 chỉ một POST confirm, không ghi đè. Browser mock preparation dùng DTO đầy đủ; các lượt fixture thiếu trường trước đó thất bại, không được tính PASS. Dùng dữ liệu tổng hợp, không xác nhận CCCD hoặc sửa hồ sơ live.
- Đã chạy sau sửa: **101 files / 1.131 tests Mobile PASS**, Mobile lint/typecheck, browser-script ESLint, Prettier và diff whitespace PASS. Expo Web export và cả hai browser modes PASS. Camera/OCR thật, API live và thiết bị native: **NOT RUN**; không dùng số test này làm bằng chứng đã lưu lại dữ liệu người dùng.

## Phần chưa có API tương ứng

- Lưu nhóm hộ gia đình và đại diện của cả nhóm như một thực thể riêng: các lựa chọn hiện lưu tạm trong phiên.
- Xóa/chỉnh nhãn hồ sơ đã tạo: giao diện khóa các thao tác đó; vẫn cho bổ sung CCCD chưa xác nhận.
- Hoàn tất tiếp nhận cả nhóm trên server: chưa có endpoint; không giả lập một lệnh ghi dữ liệu thành công.
- Phê duyệt hợp đồng riêng biệt: DTO hiện có không cung cấp trạng thái này nên bước đó chưa được đánh dấu hoàn thành.
- `placeOfIssue` có thể xuất hiện trong OCR nhưng không nằm trong payload xác nhận hiện tại: hiển thị tham khảo, không âm thầm gửi/lưu.

## Kiểm tra

Chạy từ repository root với Node 22 qua `scripts/Use-LocalTools.ps1`:

```powershell
npm run typecheck --workspace ./src/mobile
npm run lint --workspace ./src/mobile
npm run test --workspace ./src/mobile -- src/__tests__
npm run test --workspace ./src/mobile
```

Test mới kiểm tra chuyển bước, giữ form, nhiều người, OCR lỗi/đề xuất chưa xác nhận,
xác nhận server thất bại, xóa dữ liệu tạm khi background, chữ ký một/hai bên,
navigation có cảnh báo và safe area bottom 24dp chỉ được cộng một lần ngoài thanh 60dp.

Test cũ `tests/mobile/ocr/workspace.test.ts` từng yêu cầu Staff chỉ có hai tab, trái yêu cầu
onboarding mới bốn tab. Theo yêu cầu sửa lỗi CI ngày 02/11/2026, đã cập nhật test cũ để kiểm tra
đúng thứ tự `staff-home`, `work-orders`, `notifications`, `profile`. Không đổi navigation,
không bỏ qua test hoặc giảm các kiểm tra phân quyền; giữ nguyên kiểm tra tab Owner/Tenant.
Các số liệu một test thất bại ở những giai đoạn bên dưới là kết quả trước lần sửa CI này.

Lượt sửa CI này cũng ổn định test chụp ảnh khi app chuyển nền: chờ shutter được bật và native
capture đã bắt đầu trước khi phát AppState background, thay vì giả định camera sẵn sàng ngay khi mount.
Giữ nguyên kiểm tra hủy preview, giải phóng file và không gửi ảnh. Kết quả kiểm tra lại:
mobile 310/310 PASS; Owner Web 97/97 PASS; lint toàn dự án PASS. Không sửa code camera hoặc nghiệp vụ.

Android JS/assets đã được export kiểm tra bằng Expo CLI vào `.expo/qa-android` (ignored).
Export bundle không thay thế kiểm thử camera, bàn phím và bố cục trên điện thoại Android thực tế.

Kết quả thực thi: TypeScript PASS; lint PASS; 14 test mới PASS;
bộ hồi quy 276 PASS, 1 FAIL do kỳ vọng hai tab cũ nêu trên; `git diff --check` PASS.
Chưa kiểm thử trực tiếp trên điện thoại Android hoặc nhận dạng ảnh thực tế trong lần chỉnh UI này.

## Dữ liệu local để thử chọn phòng

Theo yêu cầu bổ sung của người dùng, đã tạo qua API hiện có trong database local `bhome`:

- Cơ sở: `BHOME TEST - Cơ sở Staff`.
- Hai loại phòng test: Tiêu chuẩn (2 người, 22 m²) và Gia đình (4 người, 35 m²).
- Phòng trống: T101, T102, T103, T201, T202, T203.
- Phân công `staff.dev` từ 02/11/2026 đến 02/11/2027.

Đã đăng nhập bằng Staff để xác minh API chỉ trả một cơ sở được phân công và sáu phòng này.
Chạy lại seed không tạo thêm bản ghi trùng. Không sửa backend hoặc schema.
Test mới cho tự chọn cơ sở, nhiều cơ sở, thu hồi phân công, phản hồi phòng đến trễ và hành vi
mặc định của màn hình khác nằm trong `src/__tests__/capture-scope.test.tsx`.

## Refactor giao diện bước Người ở

- Tiêu đề riêng và subtitle Bước 2/4, stepper 32dp với label 12sp; các bước khác giữ kích thước mặc định.
- Card trắng/viền xám, trạng thái selected bằng nền xám nhẹ; badge đại diện riêng, trạng thái CCCD giữ nguyên.
- Sửa và xóa dùng icon với touch target 44dp. Chỉ hiện chọn đại diện khi điều kiện hiện có cho phép.
- Form tên hồ sơ tách khỏi danh sách, có placeholder, helper và bộ đếm 150 ký tự; giữ maxLength/validation/disabled cũ.
- Vùng nút Quay lại/Tiếp tục nằm cuối nội dung cuộn, không dùng overlay/sticky để tránh che form/bàn phím.
- Không đổi state, cách thêm/xóa hồ sơ, mô hình thuê, API, phân quyền hoặc quy trình CCCD.
- Test bổ sung xác nhận dữ liệu nháp giữ nguyên khi sửa/chọn đại diện/xóa và các thao tác đã khóa sau khi tạo hồ sơ vẫn được khóa.

## Phase 2 – Camera CCCD toàn màn hình

Ghi chú: yêu cầu tiếp nối bên dưới đã thay luồng một mặt của Phase 2 bằng hai mặt.

Nguồn yêu cầu: Phase 2 do người dùng cung cấp, mục 2–4 và acceptance criteria mục 7.
Thay đổi presentation/lifecycle của luồng OCR hiện hữu; giữ nguyên payload, endpoint,
quyền Staff, validation `confirmedIdentity` và điều kiện xác nhận từng người ở.

- `OnboardingScreen.tsx`: bước CCCD chỉ hiện danh sách và thao tác; mở camera/nhập thủ công
  cho đúng người. Đóng modal hoặc blur route không reset bước, phòng hoặc danh sách.
- `IdentityFlowFrame.tsx`: native full-screen Modal, Safe Area, tiêu đề/tên người và Android Back.
  Camera không nằm trong ScrollView; form riêng có ScrollView và KeyboardAvoidingView.
- `DocumentCameraView.tsx`: camera ưu tiên diện tích, khung tỷ lệ 1.586 với bốn góc và vùng tối;
  nút chụp 80dp, preview contain, Chụp lại/Sử dụng ảnh, trạng thái quyền camera và OCR loading.
- `CameraCapture.tsx`: tái sử dụng pipeline ảnh JPEG/cache hiện có, khóa gửi trùng bằng ref,
  chỉ mount camera ở màn chụp. Retake/đóng/background xóa ảnh tạm; OCR xong zero buffer.
- `IdentityWizard.tsx`: giữ draft từng người khi đóng, hủy request và bỏ qua response đến trễ;
  OCR thất bại vẫn giữ form. Sau server xác nhận thành công, đóng modal về danh sách.
- `identityFieldErrors.ts`: hiển thị lỗi theo từng trường dựa trên cùng quy tắc validation cũ.
  Không thêm điều kiện tiếp nhận, trường API hoặc lưu ảnh lâu dài.

Không thêm thư viện. Không sửa các bước chọn phòng, người ở, kiểm tra cuối hoặc backend/database.
SDK camera hiện dùng không công bố cờ xác định phần cứng có flash; chưa hiển thị nút flash
để tránh đưa thao tác không được hỗ trợ lên thiết bị. Các nút camera khác của màn hình cũ giữ nguyên.

Kết quả Phase 2: TypeScript và lint PASS; bộ test mobile 293 PASS, 1 FAIL là kỳ vọng hai tab cũ
đã nêu ở trên. Trong đó 21 test camera/onboarding/field-errors PASS: preview/retake,
quyền bị từ chối, giải phóng tài nguyên, chống gửi OCR lặp, background trong lúc chụp,
Android Back, form theo người, validation và response trả về sau khi đóng.
Kiểm thử camera dùng native mocks và dữ liệu tổng hợp; chưa xác minh camera, notch,
bàn phím, flash và layout thực tế trên thiết bị iOS/Android. Bundle export không thay thế kiểm tra này.

## Tiếp nối – Tái sử dụng OCR mặt sau

Nguồn: yêu cầu người dùng “Refactor CCCD OCR UI/UX & Reuse Existing Back-side OCR”, mục 2–8.
Đã đối chiếu code backend bằng thao tác đọc: `OcrController.Identity` nhận `front`/`back`
qua cùng route `POST /api/v1/ocr/identity/{residentId}/{side}`; `OcrFieldParser` trả
`proposedFields.dateOfIssue`; payload xác nhận hiện có hỗ trợ `dateOfIssue`.
Không sửa backend, OCR parser/service, API contract hoặc database.

- `IdentityPersonCard.tsx` mới: avatar, vai trò, badge, tiến độ riêng hai mặt và phân cấp primary/outline.
- `onboarding.ts`, `OnboardingScreen.tsx`: tiến độ chụp/OCR độc lập cho từng người; thao tác tiếp tục
  mở đúng mặt chưa hoàn thành, nhập thủ công luôn có sẵn trước xác nhận.
- `IdentityWizard.tsx`: gọi API từng mặt ngay sau Sử dụng ảnh để không giữ ảnh chờ mặt còn lại;
  trước → sau → form chung. Có chụp lại riêng mỗi mặt; chỉ thay đề xuất OCR của chính mặt đó,
  giữ dữ liệu mặt kia và không ghi đè chỉnh sửa của Staff. Warnings tổng hợp, bỏ trùng.
- `CameraCapture.tsx`, `DocumentCameraView.tsx`: callback tiến độ sau khi tạo preview thật,
  tên mặt/nút chụp/hướng dẫn tương ứng; giữ pipeline cache tạm và khóa gửi trùng.
- Ngày cấp nằm riêng ở Thông tin mặt sau, hiển thị dd/MM/yyyy, cho chỉnh sửa và gửi ISO qua
  payload cũ. OCR thiếu trường thì để trống và nhắc nhập theo giấy tờ; không thêm validation bắt buộc.
- `onboarding-ui.test.tsx`, `document-camera.test.tsx`: cập nhật/bổ sung kiểm tra hai endpoint,
  ngày cấp thực từ response và chỉnh sửa, retake mặt sau, bảo vệ Staff edits, resume, fallback,
  tiến độ preview thật; các test nhiều người và bước 2/4 tiếp tục chạy.

Nút Xem thông tin của người đã xác minh mở thông báo/trạng thái lưu hiện có. Không thêm tải lại
CCCD nhạy cảm cho Staff: API capture hiện không cung cấp GET chi tiết định danh, và wizard vẫn
xóa dữ liệu định danh khỏi state sau xác nhận như trước.

Kết quả lượt này: TypeScript/lint PASS; 296 test PASS, 1 FAIL là test hai tab cũ nêu trên.
Camera/onboarding có 23 test PASS dùng native mocks; chưa có kiểm thử thiết bị iPhone/Android
hoặc OCR ảnh thật. Các số liệu Phase 2 phía trên là kết quả trước yêu cầu tiếp nối này.
