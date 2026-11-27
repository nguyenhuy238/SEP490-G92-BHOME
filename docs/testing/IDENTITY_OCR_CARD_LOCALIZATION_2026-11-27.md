# OCR CCCD: tách vùng thẻ và chọn mặt quét — 27/11/2026

Tiếp nối [đợt sửa timeout](IDENTITY_OCR_STAGING_2026-11-27.md). Ảnh màn hình người dùng
cho thấy trường rỗng nhưng có `ocr_partial`, cảnh báo lặp, và hai ô mặt thẻ chưa có
thao tác chọn quét riêng. Bộ ảnh cũ chỉ gồm văn bản trên nền trắng nên chưa kiểm tra
được trường hợp thẻ trong ảnh camera có chữ ở nền.

## Truy vết và phạm vi

BF-03, UC-13 (Manage Tenant and Occupant Information), GBR-02/13, NFR Internal OCR
Processing và bảo vệ dữ liệu trong SRS cục bộ
`docs/reports/BHome_Report-3_Software Requirement Specification.docx`.
Giữ nguyên API/DTO, quyền Staff theo cơ sở, bước xác nhận thủ công và ảnh tạm thời.
Không đổi model/provider, không sửa schema hay quy tắc xác minh danh tính.

| Yêu cầu                                  | Thay đổi                                                                                                                                          | Hồi quy                                                                                                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Đọc thẻ trong ảnh có nền                 | `IdentityCardCropper`, `ImagePreprocessor`: tìm một vùng thẻ rõ, tách trước khi thu nhỏ; giữ pixel gốc nếu thẻ thẳng, chỉnh phối cảnh nếu nghiêng | Thẻ thẳng/nghiêng, ảnh trống, hình không giống thẻ, hai thẻ mơ hồ, công tơ không bị crop                                                      |
| Tránh hết thời gian trước trường cần đọc | `IdentityTextRegionOrder`, `OnnxOcrEngine`: ưu tiên chữ lớn cùng nhãn gần phía trên khi ảnh có tỷ lệ thẻ                                          | Giữ đủ vùng, không áp thứ tự này cho công tơ hoặc trang văn bản dài                                                                           |
| Giữ chi tiết chữ nhỏ trong ảnh mobile    | `prepareCapture`: cạnh dài ảnh CCCD tối đa 2400, JPEG 0.95; backend thu nhỏ sau khi tách thẻ                                                      | Không phóng lớn ảnh nhỏ; vẫn giới hạn byte/pixel, xóa file tạm; ảnh minh chứng vẫn 1600/0.85                                                  |
| Chọn mặt và quét lại độc lập             | `IdentityPersonCard`, `IdentityWizard`, `HoldingNewTenant`, `OnboardingScreen`, `onboarding.ts`                                                   | Quét mặt sau trước, quét lại cùng mặt, đóng/mở lại, giữ dữ liệu mặt kia và sửa tay, dùng cùng resident                                        |
| Trạng thái đúng với dữ liệu              | Progress riêng: chưa quét, đã chụp, chưa đọc được, đọc một phần, đã nhận diện                                                                     | Không đánh dấu đã nhận diện khi không có trường; mặt trước thiếu trường bắt buộc là một phần                                                  |
| Cảnh báo dễ hiểu                         | `OcrFieldParser`, `ocrDiagnostics`, `IdentityWizard`                                                                                              | Không báo `ocr_partial` khi không có trường; gộp cảnh báo trùng, ghi rõ mặt; không hiện mã nội bộ trên màn xác minh, vẫn giữ mã ở diagnostics |

Ngưỡng hình học chỉ phục vụ định vị ảnh, không chứng minh đó là CCCD hợp lệ.
Nếu không có một vùng thẻ phù hợp hoặc có hai vùng thẻ riêng tương đương, giữ nguyên
ảnh cho luồng OCR cũ; không chọn bừa một thẻ. Kết quả vẫn cần Staff đối chiếu.

Giới hạn 2400 thay giới hạn 1600 của đợt sửa trước: giảm kích thước toàn ảnh quá sớm
làm mất chi tiết chữ trên thẻ nhỏ trong khung. Chỉ ảnh CCCD đổi giới hạn này; phần
chụp công tơ và ảnh minh chứng giữ chính sách hiện có.

## Bằng chứng nhận dạng

Ba ảnh JPEG tổng hợp mới trong `tests/fixtures/ocr/identity-camera`, sinh từ script
`scripts/New-IdentityCameraFixtures.ps1`, không chứa danh tính thật.

| Môi trường, cùng ảnh/model/deadline             | Chưa tách thẻ                   | Tách thẻ + ưu tiên vùng chữ                   |
| ----------------------------------------------- | ------------------------------- | --------------------------------------------- |
| Cục bộ Windows, ảnh theo giới hạn upload 2400   | 0/3 khớp đủ kỳ vọng; 2 fallback | 3/3 khớp, 0 fallback; khoảng 2.8–3.9 s        |
| VPS, container độc lập dùng image/model staging | 0/3; 3 fallback                 | 3/3 khớp, 0 fallback; 6.809 / 8.537 / 7.018 s |

Mặt trước kiểm tra khớp chính xác cả số, tên và ngày sinh; mặt sau kiểm ngày cấp.
Sáu mẫu OCR cũ cũng chạy lại đạt 6/6. Các con số này là kết quả của mẫu tổng hợp,
không phải tỷ lệ chính xác trên CCCD thật hoặc bảo đảm đọc mọi trường trong mọi ảnh.
Ở tải cao, ảnh khó hoặc mặt thẻ chưa được định vị, vẫn có thể cần bổ sung/quét lại.

Smoke VPS không thay API đang chạy hoặc truy cập DB nghiệp vụ: network disabled,
root filesystem read-only, model/ảnh mount read-only, báo cáo tạm trong tmpfs.

## Kiểm tra phần mềm

| Kiểm tra đã chạy                                 | Kết quả                                                |
| ------------------------------------------------ | ------------------------------------------------------ |
| Build solution Release                           | Đạt, 0 warning, 0 error                                |
| Application UnitTests, lọc `.Ocr.`               | 180/180 đạt                                            |
| IntegrationTests, lọc `.Ocr.`                    | 172 đạt, 29 test model tùy chọn bỏ qua, 0 lỗi          |
| Mobile workspace, `--maxWorkers=2`               | 167 file, 1809/1809 test đạt                           |
| Mobile typecheck                                 | Đạt                                                    |
| ESLint mã nguồn                                  | Đạt; bỏ `.artifacts/**` cục bộ không được Git theo dõi |
| `dotnet format --verify-no-changes --no-restore` | Đạt                                                    |
| Expo export web                                  | Đạt                                                    |
| Detector UI trên 4 component/screen sửa          | Không có finding                                       |

Kiểm thử còn bảo vệ trường hợp ảnh thẻ đã chiếm toàn khung: không nhầm ô ảnh chân dung
thành viền thẻ. Các test chọn mặt dùng API giả lập và dữ liệu tổng hợp; không thay thế
kiểm tra camera trên Android/iPhone thật. Trong quá trình sửa, các kỳ vọng cũ về tiến
độ và cấu hình ảnh minh chứng được cập nhật/kiểm tra lại; kết quả bảng là lần chạy cuối.

Các file thay đổi nằm trong bảng truy vết; test tại `onboarding-ui`,
`holding-new-tenant`, `prepare-capture`, `document-camera`, `OcrParserTests`,
`IdentityCardCropperTests`. Tool `IdentityCameraEvaluation` và nhánh CLI trong
`BHome.OcrSmoke/Program.cs` giúp lặp lại so sánh. Fixture, script sinh ảnh và README
được lưu cùng nguồn. Engine version thêm hậu tố `identity-card1` để phân biệt bản sửa.

Chưa push/merge/deploy, chưa thử thao tác chụp thực tế trên Android/iPhone. Cần cập nhật
cả backend lẫn mobile trên staging để nhận đủ bản sửa; CI GitHub chưa chạy cho thay đổi
chưa push. Không dùng hoặc gửi CCCD thật vào công cụ AI để kiểm tra.
