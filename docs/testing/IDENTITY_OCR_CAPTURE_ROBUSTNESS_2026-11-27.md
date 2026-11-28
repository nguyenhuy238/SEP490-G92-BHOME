# OCR CCCD: ảnh nghiêng, xoay và suy giảm chất lượng — 27/11/2026

## Phạm vi, nguồn và tiêu chí

Tiếp nối commit `985eba78`. Truy vết: BF-03 / UC-13, GBR-02/13 và NFR Internal OCR
Processing trong `docs/reports/BHome_Report-3_Software Requirement Specification.docx`.
Đọc thêm các báo cáo OCR staging, bố cục chip và mã tiền xử lý/nhận dạng hiện có.
Không có thay đổi chính sách xác minh danh tính, phân quyền, API/DTO, schema hay model.
Ảnh vẫn chỉ là đầu vào tạm; đề xuất phải được người dùng đối chiếu/xác nhận.

| Hành vi cần đạt                                         | Thành phần                             | Kiểm chứng                                                                                                         |
| ------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Tách và chỉnh thẻ nghiêng lớn/đặt dọc trước khi thu nhỏ | `IdentityCardCropper`                  | Góc -18/35/60/90°, thứ tự cạnh ở ±75°, giữ test không nhầm ảnh chân dung và hai thẻ mơ hồ                          |
| Chọn chiều đọc trước khi tiêu ngân sách vào chữ ngược   | `IdentityOrientation`, `OnnxOcrEngine` | Dò một dòng chữ trong bucket 640, so chiều 180° nếu cần, tái sử dụng kết quả; số đơn lẻ/MRZ không quyết định chiều |
| Đọc ngày cách nhãn song ngữ một khoảng trắng lớn        | `IdentityOcrLayout`                    | Cho phép khoảng cách theo chiều cao chữ; không vượt qua nhãn khác trên cùng hàng hoặc cột                          |
| Giữ dữ liệu khi gần deadline                            | `OnnxOcrEngine`                        | Tính cả tiền xử lý vào đồng hồ của engine; deadline tổng vẫn giữ nguyên                                            |
| Tái hiện ảnh khó mà không dùng danh tính thật           | `IdentityChallengeFixtures`, CLI smoke | Biến thể xoay, phối cảnh, blur, motion blur, bóng tối, tương phản thấp; có mẫu trống phải từ chối                  |

Không dùng sửa chính tả/từ điển tên để đoán dấu, không suy ngày sinh từ số CCCD,
không thêm provider hoặc tải ảnh sang OCR bên ngoài. Model/checksum giữ nguyên;
engine version đổi hậu tố thành `identity-card3`. Không cần migration/cấu hình mới.

## Những nguyên nhân đã sửa

1. Bộ tách thẻ cũ loại mọi khung dọc, bỏ qua thẻ xoay nhiều. Sắp góc theo cặp
   trái/phải cũng có thể đổi cạnh dài thành cạnh ngắn. Bản mới xếp đỉnh theo chu kỳ
   quanh tâm, xác định cặp cạnh dài và chuẩn hóa chiều; giữ chặn ảnh chân dung nằm
   trong thẻ đã chiếm gần toàn khung và không chọn giữa hai thẻ riêng tương đương.
2. Đọc toàn trang ngược rồi mới thử xoay có thể không còn đủ thời gian. Bản mới dò
   một dòng có chữ trước; dùng chênh lệch confidence như tín hiệu chọn chiều, không
   xem đó là bằng chứng xác thực. Lượt dò có deadline riêng và kết quả chiều đúng
   được dùng lại trong lượt đọc trang.
3. Một mẫu mặt sau được model đọc đúng cả nhãn lẫn `01/07/2024`, nhưng khoảng cách
   giữa hai vùng khoảng 4,25 lần chiều cao chữ vượt ngưỡng 4 cũ. Tăng giới hạn lên 6
   đi cùng chặn nhãn xen giữa; regression bảo vệ không lấy ngày hết hạn làm ngày cấp.
4. Đồng hồ engine trước đây bắt đầu sau tiền xử lý trong khi deadline của service
   đã chạy. Trên VPS, sự lệch này có thể làm mất toàn bộ kết quả ở cuối request.
   Đồng hồ engine mới bắt đầu trước tiền xử lý, dự phòng thêm thời gian để native
   inference kết thúc sau tín hiệu hủy rồi mới parse/trả kết quả. Sau khi xoay trang,
   đọc lại vùng giá trị đã phát hiện thay vì dùng kết quả crop xoay trước đó; khác
   biệt nội suy có thể làm thay đổi dấu tiếng Việt.

Tham khảo kỹ thuật: [biến đổi hình học OpenCV](https://docs.opencv.org/4.13.0/da/d6e/tutorial_py_geometric_transformations.html)
và [pipeline tiền xử lý PaddleOCR](https://www.paddleocr.ai/latest/en/version3.x/pipeline_usage/doc_preprocessor.html).
Các nguồn này mô tả kỹ thuật, không phải số liệu chính xác của BHOME.

## Đo trước/sau và giới hạn

Hai bố cục có dữ liệu và một bố cục trống đều là fixture tổng hợp đã commit.
Tên giả lập, số toàn 0; không có chân dung/vân tay hoặc CCCD thật.
**31 biến thể không phải 31 CCCD độc lập.** Bộ bổ sung bảy biến thể dùng góc/mức
nhòe kết hợp khác, nhưng vẫn từ cùng hai bố cục và được dùng trong kiểm tra hồi quy
thời gian. Đây không phải bộ holdout kín/độc lập.
Không dùng các tỷ lệ này để công bố độ chính xác trên khách thuê thực tế.

Các thử nghiệm CLAHE/làm nét đại trà làm giảm kết quả ở một số ảnh rõ; làm nét
chọn lọc cũng không tăng số mẫu khớp đủ. Chúng không được đưa vào bản bàn giao.
Hai trường hợp nhòe mạnh còn sai dấu trong tên phải được xem là lỗi nhận dạng,
không điều chỉnh nhãn kỳ vọng theo đầu ra model hoặc tự sửa thành tên mong muốn.

Kết quả có cấu trúc tại `IDENTITY_OCR_CAPTURE_ROBUSTNESS_2026-11-27.json`.
Đếm khớp chính xác toàn bộ trường kỳ vọng, không chỉ việc có trả về proposal;
mẫu trống đạt khi trả fallback và không sinh trường.

| Môi trường / bộ mẫu                   |                      Trước sửa | Bản cuối |
| ------------------------------------- | -----------------------------: | -------: |
| Windows, 31 biến thể                  |                          20/31 |    29/31 |
| Windows, bảy tổ hợp bổ sung           |                            4/7 |      7/7 |
| Windows, chín mẫu hồi quy rõ/camera   | Chưa đo lại baseline ở đợt này |      9/9 |
| VPS 2 CPU / 1 GiB, sáu mẫu rõ         | Chưa đo lại baseline ở đợt này |      6/6 |
| VPS 2 CPU / 1 GiB, ba mẫu camera      | Chưa đo lại baseline ở đợt này |      3/3 |
| VPS 2 CPU / 1 GiB, bảy tổ hợp bổ sung | Chưa đo lại baseline ở đợt này |      7/7 |

Hai ảnh chưa đạt trên bộ 31 là `front-blur3.2.jpg` và `front-motion7.jpg`:
đúng số/ngày sinh nhưng sai dấu trong tên. Mẫu trống bị từ chối đúng ở cả hai bộ.
VPS có thời gian cao nhất 8.480 giây; 16/16 trường hợp trả proposal/fallback dưới
10 giây trong lượt này. Các lượt VPS trước bản cuối có timeout; chúng không được
tính là kết quả đạt của bản bàn giao.

## Kiểm tra mã nguồn đã thực chạy

| Lệnh / phạm vi                                                         | Kết quả cuối                                                   |
| ---------------------------------------------------------------------- | -------------------------------------------------------------- |
| `dotnet build src/backend/BHome.sln -c Release --no-restore -m:2`      | Đạt, 0 warning/error                                           |
| Application UnitTests lọc `.Ocr.`                                      | 184 đạt, 0 lỗi                                                 |
| IntegrationTests lọc `.Ocr.`                                           | 189 đạt, 31 skip do điều kiện môi trường/model tùy chọn, 0 lỗi |
| `dotnet format src/backend/BHome.sln --verify-no-changes --no-restore` | Đạt                                                            |
| `git diff --check`                                                     | Đạt                                                            |

Một lượt build trung gian gặp DLL bị tool smoke đang chạy giữ; bản build/test cuối
đã chạy xong thành công. Không đổi timeout kiểm thử hoặc bỏ assertion để làm xanh.
Chưa chạy lại toàn bộ backend CI hoặc frontend test cho đợt này; không có sửa mã
frontend. Các con số toàn bộ CI ở báo cáo trước thuộc commit `985eba78`.

## Lặp lại kiểm tra

```powershell
dotnet run --project tools/BHome.OcrSmoke -c Release -- --generate-identity-challenges tests/fixtures/ocr .tools/identity-challenges
dotnet run --project tools/BHome.OcrSmoke -c Release -- --generate-identity-validation tests/fixtures/ocr .tools/identity-validation
dotnet run --project tools/BHome.OcrSmoke -c Release -- .tools/ocr-models --evaluate .tools/identity-challenges/manifest.json .tools/identity-challenges/result.json
dotnet test tests/backend/BHome.Application.UnitTests -c Release --filter FullyQualifiedName~.Ocr. --settings tests/backend/ci.runsettings
dotnet test tests/backend/BHome.IntegrationTests -c Release --filter FullyQualifiedName~.Ocr. --settings tests/backend/ci.runsettings
```

Sinh dữ liệu và đo không cần truy cập DB nghiệp vụ. Smoke VPS dùng container riêng,
network disabled, root filesystem read-only, 2 CPU / 1 GiB, cùng image nền/model
staging, không thay API đang chạy; file tạm được dọn khi smoke kết thúc.

## Bàn giao và phần chưa xác minh

Files: `IdentityOcrLayout.cs`, `IdentityCardCropper.cs`, `IdentityOrientation.cs`,
`OnnxOcrEngine.cs`, các test parser/cropper/orientation, `IdentityChallengeFixtures.cs`,
nhánh CLI trong `Program.cs`, README fixture và tài liệu/evidence này.
Không sửa giao diện mobile hoặc quy trình lưu thông tin đã xác nhận.

Chưa commit/push/deploy bản này, chưa chụp thử bằng Android/iPhone thật.
Chưa có bộ ảnh CCCD thực tế được phê duyệt và gán nhãn để xác nhận độ chính xác
ngoài đời. Trước nghiệm thu, cần chụp giấy tờ giả lập trên thiết bị thật với ánh sáng,
góc, khoảng cách và rung tay khác nhau; không đưa ảnh CCCD thật vào repo/prompt AI.
Ảnh mất nét/chói che mất nét chữ vẫn có thể cần chụp lại hoặc nhập bổ sung.
