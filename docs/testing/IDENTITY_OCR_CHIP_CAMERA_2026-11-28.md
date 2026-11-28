# OCR CCCD gắn chip trong ảnh chụp — 28/11/2026

## Phạm vi và truy vết

Yêu cầu: cải thiện đọc hai mặt CCCD gắn chip theo bố cục người dùng cung cấp,
đặc biệt khi thẻ nhỏ trong ảnh nền bàn, nghiêng, thiếu sáng hoặc mờ; kiểm tra đủ
trường đang được hỗ trợ thay vì chỉ số/tên/ngày sinh.

Nguồn đối chiếu: `AGENTS.md`, BF-03 / UC-13, GBR-02/13, NFR Internal OCR
Processing và bảo vệ dữ liệu trong SRS; các ghi chú truy vết OCR hiện có
`IDENTITY_OCR_CHIP_LAYOUT_2026-11-27.md` và
`IDENTITY_OCR_EXPO_GO_DESK_2026-11-27.md`. Không thay quy tắc nghiệp vụ,
quyền truy cập, API/DTO, schema, model/checksum hoặc yêu cầu người dùng xác nhận.
Không suy ra nơi cấp từ tên người ký/cơ quan in trên thẻ khi không có nhãn tương ứng.

| Hành vi / lỗi                                            | Thành phần                             | Kiểm chứng                                                                                                                                                   |
| -------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Thẻ dưới 12% khung hình bị bỏ qua                        | `IdentityCardCropper`                  | Thẻ 420×265 trong khung 960×1280, góc 0/17/-25°; vẫn từ chối hai thẻ, ô chân dung và vật thể quá nhỏ                                                         |
| Một ô nhỏ có cạnh rõ ngăn bước tìm vùng sáng chạy        | `IdentityCardCropper`                  | Kết hợp ứng viên cạnh/vùng sáng, xếp theo diện tích, giữ kiểm tra mơ hồ; nền vân và inset                                                                    |
| Chữ/dấu nhỏ sau phóng ảnh; ảnh tối                       | `ImagePreprocessor`                    | Lấy mẫu Lanczos khi phóng trên 2,25 lần, giữ bicubic cho mức phóng còn lại; gamma nhẹ 0,85 khi trung bình xám dưới 110; chỉ áp CCCD ngang, không đổi công tơ |
| Ngày sinh nằm cách xa nhãn song ngữ                      | `IdentityOcrLayout`                    | Mở khoảng ngang có giới hạn; nhãn trường khác nằm giữa vẫn chặn ghép dữ liệu                                                                                 |
| Địa chỉ bắt đầu bên phải nhãn rồi xuống dòng về lề trái  | `IdentityOcrLayout`, `OcrFieldParser`  | Ghép dòng theo cả nhãn gốc và dòng trước; không ghép cột khác, MRZ hoặc nhãn kế tiếp                                                                         |
| Trường phụ/ngày cấp đầu mặt sau bị đọc sau chữ trang trí | `IdentityTextRegionOrder`              | Ưu tiên số/tên/ngày, tiếp theo địa chỉ/hạn dùng, rồi tiêu đề; mở vùng đầu mặt sau; không bỏ vùng phát hiện được                                              |
| Cần đo đủ trường, gồm cả địa chỉ nhiều dòng              | Script và `IdentityChipCameraFixtures` | 8 trường mặt trước + ngày cấp mặt sau; mẫu chỉ có nhãn phải trả fallback                                                                                     |

Version engine: `ocrdoc-ppocrv6-vi-run6-9b534643-yolo2-cache1-category2-identity-chip-camera1`.

## Bộ mẫu và cách chạy

`scripts/New-IdentityChipCameraLayout.ps1` tạo mặt trước, mặt sau và mặt trước
chỉ có nhãn bằng Arial/GDI+. Nội dung hoàn toàn tổng hợp, có dấu đánh dấu thử
nghiệm; không có danh tính thật, quốc huy, ảnh chân dung, dữ liệu QR hoặc vân tay.
Ảnh và dữ liệu nhận dạng người dùng gửi không được đưa vào repo hoặc fixture.

`--generate-identity-chip-camera` tạo 7 điều kiện cho mỗi mẫu: thẳng, xa
(rộng 420 px), nghiêng 17°, phối cảnh, tối, mờ nhẹ và phối hợp tối/mờ/nghiêng/phối
cảnh. Những biến thể này chỉ xuất phát từ **hai mẫu có dữ liệu và một mẫu trống**,
không phải 21 CCCD/người độc lập. Mờ nhẹ được áp trước thu nhỏ; bộ challenge cũ
được dùng bổ sung cho mức mờ mạnh hơn.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/New-IdentityChipCameraLayout.ps1
dotnet run --project tools/BHome.OcrSmoke -c Release -- --generate-identity-chip-camera .tools/identity-chip-camera/source .tools/identity-chip-camera/fixtures
dotnet run --project tools/BHome.OcrSmoke -c Release -- .tools/ocr-models --evaluate .tools/identity-chip-camera/fixtures/manifest.json .tools/identity-chip-camera/final.json
```

Không thay nhãn kỳ vọng theo đầu ra model. Đánh giá yêu cầu khớp chính xác,
kể cả dấu tiếng Việt và toàn bộ địa chỉ. Các ảnh sinh nằm trong `.tools`, đã được
Git bỏ qua. JSON evidence chỉ chứa số liệu, kết quả theo trường và mã cảnh báo.

## Kết quả trên bộ mới

Đo engine ONNX thật trên Windows, cùng model đã ghim, timeout 9.000 ms và
2 inference threads. Bản trước là `identity-desk1` từ checkout đầu phiên;
bản sau dùng toàn bộ thay đổi cuối. Đây là thời gian trên máy phát triển,
không phải benchmark container 1 CPU hay thiết bị di động thật.

| Tiêu chí                     |            Trước |              Sau |
| ---------------------------- | ---------------: | ---------------: |
| Mặt trước khớp đủ 8 trường   |              0/7 |              7/7 |
| Mặt sau khớp ngày cấp        |              7/7 |              7/7 |
| Mẫu chỉ có nhãn được từ chối |              7/7 |              7/7 |
| Tổng trường kỳ vọng khớp     |            52/63 |            63/63 |
| Trường kỳ vọng sai / thiếu   |            7 / 4 |            0 / 0 |
| Toàn bộ ca khớp              |            14/21 |            21/21 |
| p95 / lớn nhất               | 5.762 / 6.506 ms | 4.630 / 4.820 ms |

Trường được đo: số CCCD, họ tên, ngày sinh, giới tính, quốc tịch, quê quán,
nơi thường trú (bắt đầu cùng hàng nhãn và xuống dòng), ngày hết hạn và ngày cấp.
Không kiểm nội dung chip, giải mã QR, đối sánh khuôn mặt, vân tay hoặc xác thực giấy tờ.

## Hồi quy và kiểm tra phần mềm

Đã chạy lại ba bộ ảnh cũ qua engine cuối. Các exit code 1 dưới đây là lỗi so
khớp chính xác còn tồn tại, không phải một bộ OCR đạt hoàn toàn:

| Bộ tổng hợp             | Khớp đủ trường | Sai / thiếu trường | Đề xuất sai trên mẫu trống | Đối chiếu báo cáo 27/11                                     |
| ----------------------- | -------------: | -----------------: | -------------------------: | ----------------------------------------------------------- |
| Challenge, 31 biến thể  |          29/31 |              2 / 0 |                          0 | Giữ 29/31; tên sai dấu ở Gaussian blur 3,2 và motion blur 7 |
| Nền bàn, bố cục dày     |          16/17 |              1 / 0 |                          0 | Giữ 16/17; một họ tên sai dấu                               |
| Nền bàn, bố cục chip cũ |          13/17 |              4 / 0 |                          0 | Giữ 13/17; bốn họ tên sai dấu                               |

Các kết quả này cho thấy giới hạn nhận dạng dấu tiếng Việt vẫn còn ở một số
ảnh xa/mờ. Không dùng kết quả 21/21 của bộ mới để tuyên bố đọc đúng mọi ảnh
trong thực tế. [JSON evidence](identity-ocr-chip-camera-2026-11-28.json) lưu cả
before/after bộ mới và toàn bộ kết quả hồi quy cuối.

| Kiểm tra thực thi                                                                                       | Kết quả                                                                 |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `dotnet build src/backend/BHome.sln -c Release --no-restore`                                            | Thành công, 0 warning/error                                             |
| Application UnitTests, lọc `.Ocr.`                                                                      | 186 đạt, 0 bỏ qua                                                       |
| IntegrationTests: IdentityCardCropper, IdentityOrientation, LocalOcr, OcrRecognition, AutomaticLocalOcr | 74 đạt, 0 bỏ qua                                                        |
| IntegrationTests, toàn bộ `.Ocr.` trong lượt rộng trước hiệu chỉnh ảnh cuối                             | 185 đạt, 31 skip theo điều kiện test, 12 lỗi khởi tạo Docker/PostgreSQL |
| `dotnet format --verify-no-changes --no-restore` trên các file C# thay đổi của solution/công cụ         | Đạt                                                                     |
| Prettier trên hai tài liệu Markdown và JSON evidence; `git diff --check`                                | Đạt                                                                     |

12 lỗi ở lượt rộng đều thuộc `CaptureWorkflowTests`, phát sinh vì Testcontainers
không kết nối được Docker named pipe; không coi đây là kiểm chứng workflow DB
đã đạt. Chưa kiểm lại các workflow này với PostgreSQL trong lượt này. 31 test
được bỏ qua do điều kiện môi trường/model tùy chọn có sẵn; không sửa skip/baseline.
Hai lượt kiểm tra phần mềm 186/74 đã chạy lại sau build cuối.

Lượt build toàn solution đầu tiên bị khóa DLL của `BHome.OcrSmoke` do benchmark
đang chạy; sau khi benchmark kết thúc, build lại thành công như bảng trên.
Lỗi format ban đầu ở dictionary của công cụ sinh mẫu đã được sửa và kiểm lại.
Không thay timeout hay assertion để vượt kiểm tra.

```powershell
dotnet test tests/backend/BHome.Application.UnitTests -c Release --no-build --filter FullyQualifiedName~.Ocr.
dotnet test tests/backend/BHome.IntegrationTests -c Release --no-build --filter 'FullyQualifiedName~.Ocr.IdentityCardCropperTests|FullyQualifiedName~.Ocr.IdentityOrientationTests|FullyQualifiedName~.Ocr.LocalOcrTests|FullyQualifiedName~.Ocr.OcrRecognitionTests|FullyQualifiedName~.Ocr.AutomaticLocalOcrTests'
```

## Giới hạn và bàn giao

Chưa chạy engine cục bộ trên bốn ảnh người dùng đính kèm vì chúng không có đường
dẫn file trong workspace. Chưa xác nhận camera iPhone/Android thật hoặc hiệu quả
trên tập CCCD thực tế được phê duyệt. Kết quả tổng hợp không phải tỷ lệ chính xác
thực tế; ảnh mất nét nặng/chói/mất chữ vẫn có thể sai hoặc cần nhập tay.

Ảnh đầu vào tiếp tục được xử lý tạm trong RAM. Không thêm log nội dung OCR,
không gửi ảnh sang OCR/AI bên ngoài, không lưu ảnh CCCD vào MinIO/DB. Đề xuất
vẫn phải được người dùng đối chiếu/xác nhận. Chưa commit, push hoặc deploy;
backend đang chạy cần được cập nhật bản build này để áp dụng thay đổi.

## Tệp thay đổi

- Sản xuất: `IdentityCardCropper.cs`, `ImagePreprocessor.cs`,
  `IdentityTextRegionOrder.cs`, `OnnxOcrEngine.cs` (version),
  `IdentityOcrLayout.cs`, `OcrFieldParser.cs`.
- Kiểm thử: `OcrParserTests.cs`, `IdentityCardCropperTests.cs`.
- Công cụ: `scripts/New-IdentityChipCameraLayout.ps1`,
  `tools/BHome.OcrSmoke/IdentityChipCameraFixtures.cs`, `tools/BHome.OcrSmoke/Program.cs`.
- Tài liệu/evidence: báo cáo này, JSON đi kèm và `tests/fixtures/ocr/README.md`.
