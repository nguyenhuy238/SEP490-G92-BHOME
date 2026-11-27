# OCR CCCD trên Expo Go: thẻ nhỏ và nền bàn — 27/11/2026

## Truy vết, phạm vi và bằng chứng

Yêu cầu: ảnh CCCD chụp iPhone 14 Pro/Expo Go, phải chọn siêu rộng để chụp gần,
thường chỉ đọc vài trường hoặc báo không đọc được bố cục. Ảnh người dùng gửi có nền
bàn nhiều vân và thẻ chiếm một phần khung. Không đưa ảnh/danh tính thật vào fixture,
log, repo hoặc dịch vụ OCR ngoài. Chưa chạy OCR trên bản gốc các ảnh đính kèm bằng
engine cục bộ vì ảnh không có đường dẫn đầu vào trong workspace.

Nguồn: BF-03 / UC-13, GBR-02/13, NFR Internal OCR Processing và data protection
trong `docs/reports/BHome_Report-3_Software Requirement Specification.docx`,
AGENTS.md và mã nguồn/kiểm thử OCR hiện có. Không thay phân quyền, yêu cầu xác nhận,
API/DTO, model/checksum, schema hoặc quy tắc lưu dữ liệu danh tính.

| Yêu cầu                                                | Thành phần                                             | Tiêu chí kiểm tra                                                                                                                                                                    |
| ------------------------------------------------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Giữ ống kính người dùng chọn                           | `LiveCaptureCamera`, `CameraCapture`, `IdentityWizard` | Expo Go/iOS giữ siêu rộng qua preview/chụp lại/mặt trước-sau; chỉ khôi phục lens được thiết bị trả về; không bị reset bởi discovery rỗng tạm thời; mất lens thật thì trở về mặc định |
| Định vị thẻ khi viền cạnh yếu hoặc dính nền            | `IdentityCardCropper`                                  | Fallback Otsu trên ảnh làm mượt chỉ khi không có ứng viên cạnh; vẫn kiểm tứ giác, tỷ lệ, diện tích, hai thẻ mơ hồ và ô ảnh chân dung                                                 |
| Thẻ nhỏ không bị đưa vào detector ở tỷ lệ chữ quá thấp | `ImagePreprocessor`                                    | Resample bicubic thẻ ngang nhỏ lên cạnh 1200, giữ giới hạn MaxDimension; không áp công tơ; không tái tạo nét chữ đã mất                                                              |
| Có phép đo gần trường hợp bàn/siêu rộng hơn            | `IdentityDeskFixtures`, `New-IdentityDeskLayout.ps1`   | Nền vân dày, góc bo, thẻ rộng 600/800 trong khung 960×1280, nghiêng 0/8°, thiếu sáng; hai bố cục, số/tên/ngày khác nhau; mẫu trống phải từ chối                                      |

## Đối chiếu runtime

Staging được kiểm tra đang chạy revision `a1f7f3e6`, run `46019390585-1`, có OCR
bật và bản `identity-card3`. Vì vậy lỗi này không được giải thích bằng việc staging
chưa cập nhật bản trước. Không sửa cấu hình hay container API staging ở lượt này.

Đã đọc tài liệu [Expo SDK 58 Camera](https://docs.expo.dev/versions/v58.0.0/sdk/camera/)
và mã package `expo-camera ~58.0.14` cài trong repo: `FocusMode.off` trên iOS ánh xạ
thành `continuousAutoFocus`, còn `on` là autofocus một lần. Không đổi thành `on`
chỉ dựa trên tên prop. Expo Go không có extension lấy nét chạm tùy chỉnh BHOME;
đường chọn physical lens chuẩn vẫn có hiệu lực khi thiết bị trả danh sách lens.
Không khẳng định đã kiểm camera trên iPhone thật từ các test giả lập.

Lựa chọn ống kính chỉ giữ trong phiên UI bằng ref, không ghi storage hoặc ảnh.
Zoom trở về 0 khi mở lại camera; không ép siêu rộng cho thiết bị khác và không
quảng cáo siêu rộng đồng nghĩa hỗ trợ macro/lấy nét gần trên mọi iPhone.

## Đo lường và lặp lại

`--generate-identity-desk` sinh biến thể từ fixture chip cũ.
`scripts/New-IdentityDeskLayout.ps1` sinh bố cục dày hơn với danh tính tổng hợp khác;
`--generate-identity-desk-dense` đưa bố cục này vào các khung bàn tương tự.
Các biến thể không phải các CCCD/người độc lập. Thẻ có chữ tổng hợp,
không có quốc huy, chân dung hay vân tay thật. Đánh giá khớp đúng toàn bộ trường
kỳ vọng; không thay nhãn kỳ vọng để khớp đầu ra model.

```powershell
dotnet run --project tools/BHome.OcrSmoke -c Release -- --generate-identity-desk tests/fixtures/ocr .tools/identity-desk/fixtures
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/New-IdentityDeskLayout.ps1
dotnet run --project tools/BHome.OcrSmoke -c Release -- --generate-identity-desk-dense .tools/identity-desk/source .tools/identity-desk/dense
dotnet run --project tools/BHome.OcrSmoke -c Release -- .tools/ocr-models --evaluate .tools/identity-desk/dense/manifest.json .tools/identity-desk/dense-result.json
```

So sánh Windows với `1d41add1`, cùng model và nhãn kỳ vọng. Các lần đo sau thay
logic nhưng trước khi đổi chuỗi version thành `identity-desk1`:

| Bộ tổng hợp                              | Trước | Sau   | Trường còn sai sau sửa | Thời gian lớn nhất sau sửa |
| ---------------------------------------- | ----- | ----- | ---------------------- | -------------------------- |
| Bố cục chip cũ trên nền bàn, 17 biến thể | 11/17 | 13/17 | 4 họ tên sai dấu       | 5.567 ms                   |
| Bố cục dày mới trên nền bàn, 17 biến thể | 16/17 | 16/17 | 1 họ tên sai dấu       | 4.090 ms                   |

Mỗi bộ bao gồm một mẫu trống được từ chối đúng. Không thiếu trường kỳ vọng nào
ở hai bộ sau sửa; không gộp các biến thể thành số lượng CCCD độc lập. Đặc biệt,
phép đo này **không tái hiện đầy đủ** lỗi không đọc được trường nào mà người dùng
gặp: nó kiểm tra hình học, tỷ lệ chữ và nhận dạng trong các điều kiện tổng hợp.
Không dùng tỷ lệ trên để quảng cáo accuracy thực tế hoặc xác nhận các ảnh người
dùng gửi đã đọc được.

Đối chiếu hồi quy Windows `identity-desk1`: bộ nghiêng/mờ/thiếu sáng cũ vẫn đạt
29/31, như bản `1d41add1`; hai lỗi còn lại là tên ở biến thể Gaussian blur 3.2 và
motion blur 7. Các benchmark trả exit code 1 khi còn trường sai; đây là kết quả
đo accuracy, không được ghi là một bộ OCR đạt 100%.

## Kiểm tra CI cục bộ

- Build solution Release: thành công, 0 cảnh báo/lỗi.
- Toàn bộ mobile: 1.829/1.829 test trong 167 file; JUnit được
  `Verify-FrontendEvidence.py` xác nhận không failed/skipped.
- Sau sửa tên ref để tuân thủ React Hooks lint: camera 41/41 và onboarding UI
  52/52 chạy lại thành công; typecheck cũng chạy lại thành công.
- `npm run lint`, `npm run format:check` và `dotnet format --verify-no-changes`
  thành công. Hai lỗi kiểm tra ban đầu (tên ref và thụt dòng công cụ sinh fixture)
  đã được sửa, không tắt quy tắc lint/format.
- Expo export web với Node 22 và URL API giả: thành công; đây là kiểm tra bundle,
  không phải bằng chứng camera iPhone thật.

Các tệp sản xuất thay đổi là `IdentityCardCropper.cs`, `ImagePreprocessor.cs`,
`OnnxOcrEngine.cs` (chuỗi version), `LiveCaptureCamera.tsx`, `CameraCapture.tsx`
và `IdentityWizard.tsx`. Kiểm thử cập nhật `IdentityCardCropperTests.cs` và
`document-camera.test.tsx`; công cụ đo thêm `IdentityDeskFixtures.cs`,
`New-IdentityDeskLayout.ps1` và nhánh lệnh trong `tools/BHome.OcrSmoke/Program.cs`.
Hai tệp báo cáo là tài liệu này và JSON đi kèm.

## Bàn giao

Không commit/push/deploy trong lượt này. CI/CD xanh của nhánh trước là kết quả
commit trước, không phải chứng minh cho thay đổi chưa push. Cần cập nhật bundle
mobile đang dùng trong Expo Go cùng backend sau khi review/push; deploy API không
tự thay JavaScript đang mở trong Expo Go.

Chưa xác nhận hoạt động camera iPhone thật sau sửa hoặc accuracy trên tập CCCD
thực tế được phê duyệt. Không cam kết đọc đúng ảnh mất nét/mất dấu/chói. Dữ liệu OCR
vẫn là đề xuất cần người dùng đối chiếu, trường thiếu cho phép nhập bổ sung.
