# Luồng OCR điện nước Mobile — 03/11/2026

## Cập nhật UI mới nhất: đồng bộ bốn bước

Phần này thay thế các mô tả giao diện Page riêng của lượt triển khai ban đầu bên dưới.
Phạm vi vẫn chỉ Frontend Mobile, API và phân quyền hiện có; không thay đổi backend/database.

### Giao diện

- Cả danh sách và chi tiết dùng `WorkspaceShell` hiện có: header BHOME Staff, thông tin phạm vi,
  thông báo, safe area, keyboard scroll và bốn tab dưới. Route `meter` ẩn header Stack mặc định,
  tránh header trắng “BHOME” hoặc hai header chồng nhau.
- `MeterFlowHeader` dùng chung tiêu đề “Ghi chỉ số điện nước”, một câu phụ đề theo bước và
  tiến trình Chọn tác vụ → Chụp ảnh → OCR → Xác nhận. Bước OCR sáng ngay khi bắt đầu nhận diện.
- Shell cho phép callback Quay lại riêng, khóa nút khi đang gửi và cuộn về đầu khi đổi bước,
  giữ component camera/ảnh đang dùng. Các màn khác giữ hành vi mặc định.
- Android Back đi lùi từng bước; gesture pop của riêng route meter được tắt để dùng điều hướng
  theo bước. Quay về danh sách dùng `router.back()` khi có lịch sử, giữ bộ lọc của màn trước;
  deep link không có lịch sử dùng route danh sách thay thế.
- Card tác vụ gọn hơn, giảm padding/khoảng cách; giữ phòng, điện/nước, mã công tơ, kỳ,
  chỉ số trước và trạng thái. Chỉ hiện hạn khi API có dữ liệu. Empty state còn một câu ngắn.
- UtilityType từ DTO hiện tại: `0` = Điện/kWh/“Chụp công tơ điện”; `1` = Nước/m³/
  “Chụp đồng hồ nước”. Không gộp hai công tơ cùng phòng hoặc tạo task tại frontend.

### Camera và xác nhận

- `CameraCapture` có presentation `meter`, dùng lại toàn bộ pipeline permission/chụp/nén/
  cache/zero buffer và API hiện hữu. `MeterCameraView` chỉ trình bày giao diện.
- Trước chụp: placeholder và một nút chụp theo loại công tơ. Khi mở: preview, Chụp ảnh,
  Đóng camera. Sau chụp: ảnh lớn và đúng hai nút Dùng ảnh này / Chụp lại.
- Không hiện zoom, đổi ống kính, lấy nét lại hoặc hướng dẫn dài trong mode meter.
  Presentation inline/document và hành vi OCR CCCD hiện có vẫn được giữ.
- Chỉ Dùng ảnh này mới gửi OCR và evidence. Bước OCR có ảnh nhỏ, kết quả đề xuất, ô sửa,
  đơn vị, chỉ số trước, Tiếp tục và tùy chọn Thử lại OCR. Không nhận diện được thì báo ngắn:
  “Không nhận diện được chỉ số. Hãy thử lại hoặc nhập tay.”
- Bước xác nhận có ảnh, thông tin task, số trước/OCR/số xác nhận và tiêu thụ dự kiến hợp lệ;
  sửa bằng Quay lại. Checkbox đối chiếu và nút Xác nhận & lưu vẫn bắt buộc.
- Lùi về ảnh rồi tiến lại với cùng ảnh/evidence giữ số đã chỉnh; không tự chạy OCR lại.
  Chụp lại hoặc rời feature/chuyển nền xóa ảnh và kết quả cũ. Lưu lỗi giữ dữ liệu để retry;
  upload evidence lỗi không cho qua bước xác nhận. Chỉ báo đã lưu sau kết quả backend.
- Không còn nhắc lại các đoạn giải thích kỹ thuật trong giao diện. Thành công có kết quả
  server và nút Chọn tác vụ tiếp theo; danh sách tải lại khi focus.

### File thay đổi trong lượt refactor

- `src/mobile/src/app/meter.tsx`: điều phối bước, back, giao diện OCR/xác nhận gọn và nhãn động.
- `src/mobile/src/app/_layout.tsx`: cấu hình header/gesture riêng cho route meter.
- `src/mobile/src/components/WorkspaceShell.tsx`: callback back, disabled và scroll revision tùy chọn;
  khoảng cách gọn áp dụng riêng cho screen meter-reading.
- `src/mobile/src/components/MeterFlowHeader.tsx` (mới): header và progress chung.
- `src/mobile/src/components/MeterCameraView.tsx` (mới): trình bày camera điện nước tối giản.
- `src/mobile/src/components/CameraCapture.tsx`: mode meter và cleanup khi mất focus.
- `src/mobile/src/screens/MeterTasksScreen.tsx`: danh sách/task card và empty state gọn hơn.
- Tests: `meter-flow.test.tsx`, `document-camera.test.tsx`, `workspace-navigation.test.tsx`
  trong `src/mobile/src/__tests__`; `tests/mobile/ocr/liveWorkspace-ui.test.tsx`.
- Các adapter `meterService`, `meterClient`, `MobileApi`, `useSession`, validator và phép tính
  tiêu thụ dự kiến được tái sử dụng. Các HTTP routes bên dưới không thay đổi.

### Kiểm chứng lượt refactor

- Full Mobile suite, Node 22.23.4: **39 files / 359 tests PASS**.
- `npm run typecheck --workspace ./src/mobile`: **PASS**.
- `npm run lint --workspace ./src/mobile`: **PASS**.
- Expo export Web: **PASS**, output `.tools/meter-ocr-ui-refactor-web`.
- Test bổ sung: cả điện/nước xuyên suốt OCR/xác nhận/thành công; cùng Staff shell qua các bước;
  override back trong shell thật; Android back giữ correction mà không chạy OCR lại;
  bộ nút camera tối giản, preview giữ sau OCR và cleanup; không xác nhận khi upload ảnh lỗi.
- Chưa kiểm thử camera/permission native hoặc bố cục trên thiết bị thật. Không thực hiện được
  visual smoke qua công cụ UI vì native pipe và browser host không kết nối trong phiên này.
  Test camera dùng mock native, không phải bằng chứng camera đã chạy trên điện thoại.
- Không có API mới cần bổ sung cho luồng bốn bước. Giới hạn hiện hữu: lọc kỳ tại client trên
  các trang API theo scope, lựa chọn cơ sở/phòng giới hạn 100; chưa có image picker trong dự án.

Nguồn API nền tảng đã đối chiếu: [Expo Camera SDK 58](https://docs.expo.dev/versions/v58.0.0/sdk/camera/)
và [Expo Router layouts](https://docs.expo.dev/router/basics/navigation-layouts/).

## Phạm vi và căn cứ

Chỉ sửa Frontend Mobile, dùng API hiện hữu; không sửa backend, schema hoặc dữ liệu demo.
Traceability: BF-05 / UC-20, GBR-07..09 theo hướng dẫn SRS trong `AGENTS.md`;
OCR là đề xuất, Staff trong Location được phân công kiểm tra và xác nhận trước khi lưu.
Đối chiếu DTO `CaptureContracts.cs`, controller Capture/OCR và `CaptureRepository.ConfirmMeterAsync`.
Không tạo tác vụ hoặc hóa đơn từ màn ghi chỉ số.

## Giao diện và hành vi

- Dashboard Staff → Ghi điện nước → danh sách tác vụ theo quyền API.
- Chọn cơ sở/phòng; bộ lọc kỳ ghi, trạng thái và hạn ghi có thể thu gọn.
- Card phân biệt điện/nước; hiển thị kỳ, công tơ, chỉ số trước, hạn và trạng thái.
- Chọn tác vụ → tải chi tiết từ server → chụp ảnh → preview/chụp lại → bấm Nhận diện chỉ số.
- Chụp ảnh không tự gửi OCR. Ảnh giữ trong cache tạm để đối chiếu và thử lại; xóa khi chụp lại,
  xóa ảnh, rời màn hình hoặc ứng dụng chuyển nền. Buffer gửi API được zero sau xử lý.
- OCR xong mới cho chỉnh chỉ số, xem độ tin cậy/cảnh báo nếu có và tiêu thụ dự kiến.
- Tiêu thụ dự kiến dùng phép trừ fixed-point, không làm tròn qua số thực JavaScript.
- Bước xác nhận riêng yêu cầu Staff đánh dấu đã đối chiếu và bấm “Xác nhận & lưu chỉ số”.
- Chặn số trống/âm/sai định dạng/sai precision. Chỉ số giảm được giải thích theo lỗi backend
  `meter_reset_or_rollover_requires_review`; không tự xử lý reset hay quay vòng.
- Không tự đặt ngưỡng tiêu thụ bất thường khi chưa có chính sách; cảnh báo chỉ số giảm,
  không thay đổi và cảnh báo OCR hiện có. Không thay thế kiểm tra chính thức của server.
- Khi OCR không khả dụng, cho nhập tay sau khi ảnh bằng chứng được tải thành công.
- Khóa yêu cầu trùng; khi lưu lỗi giữ ảnh, giá trị và evidence để thử lại cùng payload.
  Backend hiện đối chiếu kết quả đã lưu bằng task/value/evidence khi retry.
- Thành công hiển thị kết quả trả từ backend, có nút về danh sách/chọn tác vụ tiếp theo.
  Danh sách tải lại khi được focus; không tự đánh dấu task Completed ở client.
- Màn ghi ảnh dùng Page/keyboard scroll hiện hữu và safe area dưới, không có bottom tab che nút lưu.

## API dùng lại

- `GET /api/v1/capture/locations`
- `GET /api/v1/capture/locations/{id}/rooms`
- `GET /api/v1/capture/meter-tasks?page=...&locationId=...&roomId=...&status=...&dueDate=...`
- `GET /api/v1/capture/meter-tasks/{id}`
- `POST /api/v1/ocr/meter-tasks/{id}` — ảnh OCR, chỉ trả đề xuất.
- `PUT /api/v1/capture/meter-tasks/{id}/evidence` — ảnh bằng chứng.
- `POST /api/v1/capture/meter-tasks/{id}/confirm` — `humanConfirmed`, `confirmedValue`, `evidenceId`.
- `GET /api/v1/capture/readings/{id}` — mở kết quả đã xác nhận.

API chưa có lọc billingPeriod phía server. Mobile tải đủ các trang 100 tác vụ trong phạm vi
cơ sở/phòng/trạng thái/hạn đã chọn, rồi lọc kỳ và phân trang hiển thị 20 mục. Không gửi query
billingPeriod giả. Cần đo hiệu năng với phạm vi nhiều tác vụ; nên chọn cơ sở/phòng để thu hẹp.
Danh sách lựa chọn cơ sở/phòng hiện bị API giới hạn 100 mục, chưa có endpoint phân trang lựa chọn.
Không bổ sung chọn ảnh thư viện: dự án chưa cài image picker, camera hiện có đáp ứng phạm vi.
Quyền camera bị từ chối được báo rõ; nhập tay vẫn yêu cầu ảnh bằng chứng, không bỏ qua điều kiện này.

## File triển khai

- `src/mobile/src/screens/MeterTasksScreen.tsx` — danh sách/bộ lọc, tải lại khi focus.
- `src/mobile/src/screens/LiveWorkspaceScreens.tsx` — dùng lại màn tách riêng.
- `src/mobile/src/app/meter.tsx` — wizard chi tiết/OCR/xác nhận/kết quả.
- `src/mobile/src/components/MeterProgress.tsx` — tiến trình bốn bước.
- `src/mobile/src/components/CameraCapture.tsx` — giữ preview khi opt-in và thông báo ảnh bị xóa;
  luồng CCCD vẫn xóa ảnh sau xử lý như trước.
- `src/mobile/src/features/workspace/meterReading.ts` — validation và tiêu thụ dự kiến.
- `src/mobile/src/__tests__/meter-flow.test.tsx`, `meter-reading.test.ts`, `document-camera.test.tsx`.
- `tests/mobile/ocr/liveWorkspace-ui.test.tsx` — kiểm tra lọc kỳ qua nhiều trang và empty state.

## Kiểm chứng

- Mobile suite chạy bằng Node 22.23.4 của dự án: **39 files / 353 tests PASS**.
- Mobile TypeScript và ESLint: **PASS**.
- Expo export Web: **PASS**, artifact local tại `.tools/meter-ocr-web-check`.
- Có test preview không tự gửi OCR, retake xóa dữ liệu cũ, camera bị từ chối,
  sửa OCR/nhập tay khi OCR lỗi, validation, lưu thành công/thất bại, khóa double tap,
  retry cùng payload, quay lại giữ chỉ số, role/failed scope và lọc kỳ qua trang API thứ hai.
- Lần đầu chạy suite bằng Node mặc định có lỗi launcher do tự chuyển Node 22;
  chạy lại toàn bộ bằng Node 22 của dự án đạt như trên. Không sửa launcher ngoài phạm vi.
- Chưa kiểm thử thiết bị Android/iOS thật, camera/OCR live, upload live, visual smoke,
  hiệu năng dữ liệu lớn hay nghiệm thu backend. Unit/component tests dùng mock và dữ liệu tổng hợp.

Checklist thiết bị cần chạy: Staff chọn đúng phòng và hai công tơ; từ chối quyền; chụp/preview/retake;
OCR live và mất mạng; upload lỗi; sửa số; lưu rồi quay về thấy trạng thái mới; đổi mạng/chuyển nền;
safe area, bàn phím, scroll và double tap trên Android/iOS. Không dùng ảnh/dữ liệu cá nhân thật.
