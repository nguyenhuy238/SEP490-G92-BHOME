# OCR CCCD nhiều chi tiết và kiểm tra CI — 27/11/2026

## Phạm vi và truy vết

BF-03, UC-13 (Manage Tenant and Occupant Information), GBR-02/13 và NFR
Internal OCR Processing trong `docs/reports/BHome_Report-3_Software Requirement Specification.docx`:
OCR trả đề xuất hoặc trạng thái nhập tay trong 10 giây ở tải đánh giá; thông tin
phải được người dùng đối chiếu/xác nhận; ảnh CCCD chỉ là đầu vào tạm thời.

Staging tại lúc kiểm tra chạy image revision `331b303b`, đã chứa bản tách vùng thẻ
`87098d8c`. Vì vậy không xử lý lỗi này bằng cách chỉ triển khai lại bản tách thẻ cũ.

| Hành vi                                                      | Thành phần thay đổi                                      | Kiểm chứng                                                                                                                                       |
| ------------------------------------------------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Ngày bị OCR chèn khoảng trắng quanh dấu phân cách            | `OcrFieldParser`                                         | Ngày sinh/ngày cấp có dấu `/`, `.` và khoảng trắng; vẫn kiểm ngày hợp lệ                                                                         |
| Ngày cấp nằm cạnh nhãn nhưng thứ tự vùng bị xen bởi cột khác | `OcrFieldParser`, dùng lại `IdentityOcrLayout.Following` | Tìm theo hình học; từ chối ngày xa nhãn, giữ các test không lấy nhầm ngày hết hạn                                                                |
| MRZ, tiêu đề, chữ ký và địa chỉ lớn chiếm ngân sách          | `IdentityTextRegionOrder`                                | Ưu tiên vùng số/tên/ngày, giữ toàn bộ vùng để đọc tiếp; không áp cho công tơ/trang dài                                                           |
| Dừng quá sớm sau dòng song ngữ chậm                          | `OnnxOcrEngine.ReadPage`                                 | Giới hạn ONNX riêng cho từng dòng CCCD; giữ các dòng đã đọc khi lượt tiếp theo hết thời gian; deadline request và hủy của client vẫn có hiệu lực |
| Script thử nghiệm bị lint/format quét                        | `eslint.config.js`, `.prettierignore`                    | Loại `.artifacts` đã được Git bỏ qua; mã nguồn vẫn được kiểm tra                                                                                 |

Không đổi model/checksum, provider, endpoint/DTO, schema hoặc quyền truy cập.
Không tự xác minh danh tính. Không dùng ảnh người dùng gửi làm fixture, không lưu ảnh
CCCD thật, không gửi ảnh sang dịch vụ OCR bên ngoài và không thêm log nội dung OCR.
Engine version có hậu tố `identity-card2` để phân biệt bản sửa.

## Mẫu và kết quả engine thật

`scripts/New-IdentityChipFixtures.ps1` tạo ba ảnh tổng hợp trong
`tests/fixtures/ocr/identity-chip`. Mặt trước có số toàn 0, tên/ngày sinh giả lập;
mặt sau có nhãn ngày cấp song ngữ, chữ lớn và chuỗi giống MRZ gây nhiễu.
Mẫu mặt trước chỉ có nhãn phải trả fallback, không tự tạo dữ liệu từ mẫu giấy tờ trống.
Không có quốc huy, chân dung, vân tay hoặc danh tính thật.

Trên VPS, chạy container riêng từ cùng image staging, model đã ghim, network disabled,
root filesystem read-only, không kết nối DB và giới hạn **1 CPU / 1 GiB**:

| Bản                        | Mặt trước: đủ số/tên/ngày sinh | Mặt sau: ngày cấp | Mẫu trống    |
| -------------------------- | ------------------------------ | ----------------- | ------------ |
| Assembly staging trước sửa | Thiếu trường                   | Thiếu trường      | Từ chối đúng |
| Bản sửa cuối               | Khớp đủ                        | Khớp              | Từ chối đúng |

Bản sửa cuối: 3/3 trường hợp đạt, 0 trường kỳ vọng sai/thiếu; thời gian lần lượt
8.974 / 8.683 / 8.681 giây. Hai mẫu có dữ liệu còn `ocr_partial` vì không đọc hết
mọi dòng trang trí/trường phụ; đề xuất đã đọc được vẫn cần đối chiếu.
Đây là kết quả mẫu tổng hợp trong điều kiện thử, không phải tỷ lệ chính xác trên CCCD thật.

Lặp lại trên Windows:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/New-IdentityChipFixtures.ps1
dotnet run --project tools/BHome.OcrSmoke -c Release -- .tools/ocr-models --evaluate tests/fixtures/ocr/identity-chip/manifest.json
```

## Kiểm tra phần mềm

Lượt cuối dùng đúng layout `bin/Release/net8.0` và lệnh CI:
`dotnet test src/backend/BHome.CI.slnf -c Release --no-build --settings tests/backend/ci.runsettings --logger trx -m:1`.
Build solution theo layout chuẩn cũng đạt 0 warning/error.

| Assembly backend         |  Đạt | Skip được CI cho phép |
| ------------------------ | ---: | --------------------: |
| Application.UnitTests    |  780 |                     0 |
| Domain.UnitTests         |  115 |                     0 |
| IntegrationTests         | 1582 |                    32 |
| Infrastructure.UnitTests |  252 |                     0 |
| DigitalSigning.UnitTests |   41 |                     0 |
| Tổng                     | 2770 |                    32 |

0 test lỗi. `Verify-StagingRegressions.py` xác nhận đủ 21 nhóm hồi quy bắt buộc;
`Verify-BackendTrx.py` xác nhận cả năm assembly, inventory đã commit và discovery
hiện tại. Không đổi baseline hoặc danh sách skip để vượt kiểm tra.

| Kiểm tra đã chạy                                                          | Kết quả                                                     |
| ------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Build toàn solution Release, output riêng để tránh DLL đang được test giữ | Đạt, 0 warning/error                                        |
| `dotnet format --verify-no-changes --no-restore`                          | Đạt                                                         |
| Application UnitTests, lọc `.Ocr.`                                        | 183 đạt                                                     |
| IntegrationTests, lọc `.Ocr.`                                             | 177 đạt, 31 bỏ qua theo điều kiện môi trường/model tùy chọn |
| Lint, Prettier và mobile typecheck trên snapshot mã nguồn Linux / Node 22 | Đạt                                                         |
| Build client-core, Owner Web, Public Web                                  | Đạt; có cảnh báo kích thước bundle                          |
| Expo web export                                                           | Đạt                                                         |
| Deployment Python trên Linux                                              | 102 đạt                                                     |
| Email preflight Python trên Linux                                         | 7 đạt                                                       |
| Deployment Node                                                           | 26 đạt                                                      |
| SePay sandbox scripts                                                     | Đạt                                                         |
| Actionlint ba workflow                                                    | Đạt                                                         |
| Public Web unit / browser                                                 | 11 / 16 đạt                                                 |
| Owner Web toàn bộ                                                         | 1075 đạt, 3 timeout; chạy lại riêng ba file lỗi: 53/53 đạt  |
| Mobile toàn bộ                                                            | 1826 đạt, 1 timeout; chạy lại file camera: 39/39 đạt        |

Lượt chạy đồng thời ban đầu làm tăng thời gian I/O cục bộ: các test PostgreSQL
timeout khi tạo schema, smoke Windows quá hạn và một số test giao diện timeout.
Không tăng timeout test hoặc bỏ assertion để vượt lỗi. Lượt integration ban đầu
đã được dừng; giữ báo cáo lỗi trong evidence cục bộ, không coi đó là một lượt CI đạt.
PostgreSQL dùng cho kiểm thử là container riêng với dữ liệu tổng hợp; lượt chạy lại
tắt `fsync`/`synchronous_commit` để giảm chi phí đĩa của máy cục bộ, không sửa cấu hình
DB nghiệp vụ hoặc workflow GitHub. Thiết lập statement log và tắt log bind parameters
theo CI khi kiểm tra Compact24 independence. Lượt dùng output riêng còn gặp một
test CLI phụ thuộc layout `bin/Release`; lượt cuối chuyển về layout chuẩn và đạt,
không sửa assertion hoặc đường dẫn trong test.

Prettier phát hiện thêm tài liệu có sẵn, chưa được Git theo dõi:
`docs/development/PR185_STAGING_DEMO_2026-11-27.md`. Đã đối chiếu diff: chỉ căn chỉnh
bảng Markdown (khoảng trắng/dòng phân cách), giữ nguyên nội dung để tránh lỗi khi push kèm.

Các file sửa: `src/backend/BHome.Application/Ocr/OcrFieldParser.cs`,
`src/backend/BHome.Infrastructure/Ocr/IdentityTextRegionOrder.cs`,
`src/backend/BHome.Infrastructure/Ocr/OnnxOcrEngine.cs`, hai bộ test
`OcrParserTests.cs`/`IdentityCardCropperTests.cs`, `eslint.config.js`,
`.prettierignore`, `tests/fixtures/ocr/README.md`; thêm script sinh fixture,
ba ảnh JPEG/manifest trong `identity-chip` và tài liệu này. Tài liệu PR185 có sẵn
chỉ được căn chỉnh bảng Markdown như mô tả trên.

## Trạng thái bàn giao

Các thay đổi và fixture nằm trong repository để review trước khi push.
Chưa push/merge/deploy bản sửa vào API staging, chưa kiểm tra thao tác chụp trên
Android/iPhone thật. Kết quả CI GitHub của commit mới chỉ có sau khi push.
Ảnh mẫu mặt trước do người dùng cung cấp đã xóa nội dung nên không thể dùng để
chứng minh trích xuất số/tên/ngày sinh.
