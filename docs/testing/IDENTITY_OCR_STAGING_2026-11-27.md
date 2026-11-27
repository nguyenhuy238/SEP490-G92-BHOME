# Sửa luồng chụp CCCD và OCR staging — 27/11/2026

## Phạm vi và truy vết

Yêu cầu: bỏ thông báo thiếu hỗ trợ lấy nét che camera; khắc phục OCR không điền
thông tin trên Android/iPhone và kiểm tra các bước CI liên quan.

Nguồn đã đọc: `docs/reports/BHome_Report-3_Software Requirement Specification.docx`,
UC-13 (Manage Tenant and Occupant Information), BF-03, GBR-02/13 và NFR Internal OCR
Processing: trả đề xuất hoặc trạng thái nhập thủ công trong 10 giây ở tải đánh giá;
ảnh CCCD chỉ là đầu vào tạm, trường nhận dạng cần Staff xác nhận.

| Hành vi                                           | Thành phần                                | Tiêu chí kiểm tra                                                                                                                         |
| ------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Camera chuẩn không hiện thông báo thiếu extension | `cameraFocus.ts`, `LiveCaptureCamera.tsx` | Camera vẫn chụp được, không có khối chữ che preview; bản hỗ trợ focus vẫn nhận sự kiện                                                    |
| Giảm dữ liệu tải ảnh CCCD                         | `prepareCapture.ts`, `CameraCapture.tsx`  | Giữ tỷ lệ, cạnh dài tối đa 1600 px như backend, JPEG 0.95, không phóng lớn ảnh nhỏ; xóa ảnh tạm và giải phóng tham chiếu                  |
| OCR không đánh đồng cảnh báo chất lượng với lỗi   | `IdentityWizard.tsx`                      | Đề xuất có cảnh báo vẫn điền form; fallback giải thích timeout/bận/không có chữ/engine chưa sẵn sàng; giữ thông tin mặt trước và sửa tay  |
| Giảm chi phí CPU và bảo vệ kết quả lần đọc đầu    | `OnnxOcrEngine.cs`                        | Giữ thứ tự kênh RGB/BGR, normalization và vị trí pixel; hạn chế thread theo CPU; không spin khi chờ; lượt xoay thử CCCD có deadline riêng |
| Deadline phù hợp ngân sách NFR                    | `OcrOptions.cs`, `appsettings.json`       | Mặc định 9000 ms thay 8000 ms, vẫn trong giới hạn cấu hình hiện có; hủy request thật vẫn được truyền về                                   |

Không đổi model/checksum, endpoint, schema, quyền truy cập hoặc yêu cầu xác nhận.
Không sử dụng CCCD thật, lưu ảnh vào MinIO hoặc ghi nội dung OCR vào log.

## Chẩn đoán

- Container staging đang bật OCR, có đủ model đã ghim; không tìm thấy lỗi khởi tạo
  OCR trong phần log 48 giờ được kiểm tra. Điều này không chứng minh mọi request đã thành công.
- `LocalOcrService` tính cả thời gian đọc request body trong deadline. Mobile trước đây
  gửi ảnh tới 12 MP, trong khi backend thu nhỏ về cạnh dài 1600 px. Gửi ảnh CCCD ở cùng
  độ phân giải xử lý giúp giảm thời gian truyền; không áp thay đổi này cho ảnh công tơ.
- Smoke bằng ảnh tổng hợp trên VPS tái hiện `ocr_timeout`. Ở giới hạn 1 CPU, nhiều mẫu
  không kịp hạn 8 giây. Đây là thử nghiệm tải hạn chế, không phải khẳng định container
  staging đang bị cấu hình giới hạn 1 CPU.
- Thông báo cũ xuất hiện với mọi warning, kể cả `possible_glare` khi OCR đã đọc được
  dữ liệu. Bản sửa chỉ báo fallback khi thất bại và giữ cảnh báo chi tiết ở màn kiểm tra.
- Lượt thử xoay 180° là cải thiện tùy chọn cho CCCD; nếu lượt này hết thời gian riêng,
  giữ kết quả lần đầu cùng `orientation_uncertain`, vẫn yêu cầu đối chiếu/xác nhận.
  Kiểm tra xung đột chỉ số công tơ không được nới lỏng.
- Với CCCD nhiều dòng, trước khi đọc vùng tiếp theo engine dự phòng gấp đôi thời gian
  của vùng chậm nhất đã đọc. Khi ngân sách không đủ, trả các dòng đã hoàn tất với
  `ocr_partial` để parser trích xuất; trường thiếu vẫn để trống. Không áp cơ chế dừng
  sớm này cho công tơ. Deadline cứng và hủy request vẫn hoạt động như trước.

## Kiểm tra và giới hạn bàn giao

Không coi build/test cục bộ là kết quả GitHub Actions của commit chưa push.
Smoke VPS chạy container độc lập, network
disabled, root filesystem read-only, ảnh tổng hợp và cùng image/model staging; không
thay container API hoặc dữ liệu nghiệp vụ đang chạy.

| Kiểm tra đã chạy                                                                                                                                   | Kết quả                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `dotnet build src/backend/BHome.sln -c Release --no-restore`                                                                                       | Đạt, 0 warning/error; đã kiểm tra thêm build sạch                                                         |
| `dotnet format src/backend/BHome.sln --verify-no-changes --no-restore`                                                                             | Đạt                                                                                                       |
| `dotnet test tests/backend/BHome.IntegrationTests -c Release --no-build --filter FullyQualifiedName~.Ocr. --settings tests/backend/ci.runsettings` | 165 đạt, 29 bỏ qua do bộ test model tùy chọn, 0 lỗi                                                       |
| Hai test tensor mới, lọc theo tên `TensorPreservesChannelOrderNormalizationAndPixelPositions`                                                      | 2/2 đạt                                                                                                   |
| Mobile workspace typecheck                                                                                                                         | Đạt                                                                                                       |
| Lint mã nguồn, bỏ thư mục `.artifacts` không được Git theo dõi                                                                                     | Đạt; lint toàn thư mục vướng 41 lỗi ở các script thử nghiệm có sẵn trong `.artifacts/finance-ux-20261126` |
| Prettier toàn repository                                                                                                                           | Đạt trước lần cập nhật tài liệu cuối; các file sửa được kiểm tra lại                                      |
| Expo export web với API URL giả, không đọc dotenv                                                                                                  | Đạt                                                                                                       |
| Detector UI trên ba component sửa                                                                                                                  | Không có finding                                                                                          |
| Smoke engine thật với manifest `identity-smoke.json` trên VPS                                                                                      | 6/6 đạt, 0 fallback; 2.434–6.971 giây; kiểm cả số/tên/ngày sinh trên hai mẫu mặt trước                    |

Một lần chạy test backend gặp 401 ở test tài khoản trùng; chạy lại riêng đạt và bộ OCR
cuối đạt. Một lần chạy toàn bộ mobile gặp lỗi ở test `tenant-refund-requests` ngoài phạm
vi sửa; các lần chạy trước đạt 1807/1807. Chạy lại toàn bộ với `--maxWorkers=2`: 167/167 file, 1807/1807 test đạt.

Chưa kiểm tra thao tác trên thiết bị Android/iPhone thật sau sửa. Chưa commit, push,
merge hay triển khai bản sửa vào API staging. Cần cập nhật cả backend lẫn mobile rồi
quét lại trên hai nền tảng; ảnh mờ hoặc tải máy chủ quá cao vẫn có thể yêu cầu nhập bổ sung.

Danh sách thay đổi: các thành phần trong bảng trên; bốn file test mobile
`camera-focus`, `document-camera`, `onboarding-ui`, `prepare-capture`;
`ocrDiagnostics.ts` dịch cảnh báo `ocr_partial`; `OcrRecognitionTests.cs`; `tools/BHome.OcrSmoke/Program.cs` bổ sung thông số runtime
vào kết quả khởi tạo; `tests/fixtures/ocr/identity-smoke.json`, README và tài liệu này.
