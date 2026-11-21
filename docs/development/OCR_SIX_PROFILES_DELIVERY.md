# Cải thiện đủ sáu luồng OCR — 30/10/2026

Phạm vi: BF-03 / UC-13, BF-05 / UC-20, GBR-02/07, NFR privacy, manual fallback và
Internal OCR Processing. Tiếp nối [pha accuracy](OCR_ACCURACY_DELIVERY.md).

Nguồn: SRS cục bộ `docs/reports/BHome_Report-3_Software Requirement Specification (2).docx`,
Report 4 `(5).docx`, AGENTS.md, API conventions, code và các test OCR hiện có. Tên/version
báo cáo khác danh mục AGENTS.md; không suy ra chúng giống nhau. Không đổi provider,
weights/checksum, schema, endpoint, role hoặc các OQ/policy đang mở. Engine: **`-layout4`**.

## Truy vết theo từng loại

| Luồng          | Đã bổ sung                                                                                              | Chấp nhận / từ chối                                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| CCCD mặt trước | Chia dòng song ngữ dài tại khoảng trắng; tách nhiều trường cùng hàng; chọn đúng cột; địa chỉ nhiều dòng | Tên/số/ngày sinh, giới tính/quốc tịch không lẫn nhau; không lấy ngày làm tên        |
| CCCD mặt sau   | Địa chỉ nơi cư trú nhiều dòng; giữ nhãn ngày cấp 2021/2024 đã hỗ trợ; ảnh nghiêng/xoay                  | Không ghép MRZ, vân tay, tiêu đề cơ quan vào địa chỉ; không suy diễn ngày từ MRZ    |
| Điện cơ khí    | kWh trên/dưới; cụm bánh số có dấu thập phân rời; đọc lại vùng số nếu lần đầu không hợp lệ               | Giữ số 0 đầu/phần lẻ; không ghép hai màn hình độc lập; không lấy imp/kWh làm chỉ số |
| Điện điện tử   | Hình học/đơn vị dùng chung với parser; detect lại vùng sau xoay                                         | Giữ Otsu/xung đột hai lần đọc; ảnh CE-38 thật vẫn phải khớp precision server        |
| Nước cơ khí    | Cụm bánh số, số đen/đỏ, đơn vị trên/dưới, alias m3/m³/m^3/㎥                                            | Màu đỏ không quyết định dấu chấm; precision lấy từ Meter; không đoán đổi L thành m³ |
| Nước điện tử   | LCD tương phản thấp; đơn vị đúng loại nằm trên/dưới                                                     | Không coi m3/h hoặc L/min là tổng chỉ số; hai số hợp lệ xung đột phải nhập tay      |

## Mã nguồn và nguyên tắc xử lý

- `OcrFieldParser`, `IdentityOcrLayout`: giữ tọa độ khi chuẩn hóa NFC; tách nhãn khác
  nhau cùng hàng; tìm giá trị gần nhãn trong cùng cột; ghép các dòng địa chỉ liền kề,
  dừng trước trường khác/MRZ/boilerplate. Không dùng từ điển đoán tên hoặc địa chỉ.
- `OcrLineSegmentation`, `OnnxOcrEngine`: dòng vượt bucket 640 được chia tại khoảng
  trắng quan sát được, tối đa bốn đoạn. Ghép lại với confidence thấp nhất; không tăng
  width tùy ý hoặc sửa chuỗi kỳ vọng để né lỗi dấu tiếng Việt.
- `OcrImageGeometry`: đưa tọa độ về mặt phẳng đã hiệu chỉnh góc dòng chủ đạo. Bounding
  box nghiêng không còn làm chiều cao phình ra rồi nhầm dòng dưới thành giá trị cùng
  hàng. Xoay 180 độ detect lại vì polygon co nhỏ của DBNet không bất biến theo chiều xoay.
- `MeterOcrLayout`: parser/refinement dùng cùng quy tắc đơn vị và khoảng cách, hỗ trợ
  bên phải, trên, dưới và đơn vị đứng trước số; từ chối sai utility.
- `MeterReadingParser`: ghép cụm số khi có bằng chứng ô chữ số/dấu chấm. Chuỗi thô
  `12 34`, nhiều số cùng đơn vị, serial, điện áp/lưu lượng vẫn bị từ chối.
- `OcrNumericRefinement`: cả bốn loại Meter có đường đọc lại. Cơ khí giữ lần đầu nếu
  số đã hợp lệ để tránh mất chữ số màu khi threshold; không refine hằng số xung/serial
  thành chỉ số. Hai số hợp lệ khác nhau vẫn fallback.
- `SyntheticEvaluation`, `OcrEvaluation`, smoke runner: bổ sung ảnh/nhãn cho từng loại;
  JSON `profiles` có số ca đúng/tổng, số nguồn, ca chủ động từ chối và p95 riêng.

Authorization vẫn được kiểm tra ở workflow trước đọc ảnh: Owner/Staff đúng scope cho
identity, Staff đúng Location cho Meter task. Không có quyền mới từ profile/đơn vị/tọa độ.
Chỉ proposal, không tự xác minh Resident/MeterReading hoặc phát hành Invoice. Không thêm
lưu ảnh CCCD, không log raw text/ảnh/giá trị. Precision tiếp tục lấy từ Meter trên server,
không tự bỏ chữ số cuối hoặc làm tròn phần lẻ. Không cần migration/config model mới.

## Dữ liệu và cách chạy lại

Thêm sáu nguồn tổng hợp, không sửa ảnh/kỳ vọng cũ:

- `identity-front-layout.png`: tên/số/ngày sinh, giới tính/quốc tịch cùng hàng, địa chỉ hai dòng.
- `identity-back-residence.png`: ngày cấp và nơi cư trú nhiều dòng.
- `electricity-mechanical-wheels.png`, `water-mechanical-wheels.png`: ô bánh số giả lập,
  số đen/đỏ, dấu chấm tường minh, precision khác nhau.
- `electricity-digital-lcd.png`, `water-digital-lcd.png`: cửa sổ LCD giả lập tương phản thấp,
  số khác nhau, đơn vị trên/dưới và thông số gây nhiễu.

Ảnh dùng Arial/Consolas/GDI+, không mô phỏng đầy đủ chuyển động bánh số hoặc mọi kiểu
bảy đoạn. Không chứa danh tính hay dữ liệu Tenant thật. Đọc script bằng UTF-8 trên Windows:

```powershell
$scriptText = Get-Content -Raw -Encoding utf8 scripts/New-OcrProfileFixtures.ps1
& ([ScriptBlock]::Create($scriptText)) -Destination tests/fixtures/ocr
dotnet run --project tools/BHome.OcrSmoke -- --generate-evaluation tests/fixtures/ocr .tools/ocr-six-profiles
dotnet run --project tools/BHome.OcrSmoke -- .tools/ocr-models --evaluate .tools/ocr-six-profiles/manifest.json .tools/ocr-six-profiles/report.json
```

**110 ca**: 13 ảnh nguồn × 8 biến thể, cộng ảnh rỗng cho mỗi loại. Tổng 14 nguồn kể cả
ảnh rỗng; không phải 110 ảnh thật độc lập. Exact-match từng trường được gán nhãn, giữ
dấu, số 0 đầu, dấu câu và phần thập phân. Không thay expected theo output của model.

Lưu executable layout3 trước sửa tại `.tools/ocr-layout3-baseline` rồi chạy cùng manifest:
**62/110 khớp**, exit 1. Test parser đầu tiên **14 FAIL / 43 PASS**, sau đó đã sửa.
Lượt engine trung gian **103/110** chỉ ra lỗi tọa độ nghiêng/polygon xoay; đã sửa và
chạy lại toàn bộ. Kết quả cuối **109/110**, exit 1 vì ca dấu phẩy mô tả bên dưới:

| Profile        | Layout3 trước sửa | Layout4 sau sửa |
| -------------- | ----------------: | --------------: |
| CCCD mặt trước |              9/17 |           16/17 |
| CCCD mặt sau   |             17/25 |           25/25 |
| Điện cơ khí    |              9/17 |           17/17 |
| Điện điện tử   |              9/17 |           17/17 |
| Nước cơ khí    |              9/17 |           17/17 |
| Nước điện tử   |              9/17 |           17/17 |

Mỗi hàng gồm một ca ảnh rỗng yêu cầu từ chối, không phải toàn ảnh dương tính. Lượt cuối
không có trường kỳ vọng bị thiếu, có một trường sai exact-match (dấu câu địa chỉ),
và cả sáu ca ảnh rỗng không tạo proposal. p95 toàn tập 3599 ms trên máy local, không
chứng minh p95 ở workload đánh giá 100 phiên. Confidence chưa được hiệu chuẩn accuracy.

## Kiểm chứng

- Build Release: **PASS**, 0 warning/error.
- `dotnet test src/backend/BHome.sln -c Release --no-build -m:1 -nodeReuse:false -v minimal --logger trx`:
  **402 PASS**, không skip: Application 147, Domain 38, Integration 217, có PostgreSQL/MinIO
  disposable và kiểm thử quyền/negative/precision hiện có.
- `docker compose -f deploy/docker/compose.ocr-smoke.yml run --build --rm smoke`:
  build và inference **18/18 PASS** trên Linux CPU, gồm cả sáu nguồn mới.
- Đánh giá nguồn nguyên bản: **13/13 khớp**; không coi kết quả này là kiểm ảnh thực tế.
- Ảnh thật `docs/image.png` đã hồi quy local: **03251.4 kWh**, precision 1 do người dùng
  xác nhận; lượt cuối **1/1 khớp**, 2801 ms. Đây vẫn chỉ là một ảnh điện tử CE-38;
  không đưa ảnh vào fixtures/container.
- Không đổi frontend/API contract, không chạy lại frontend ở pha này. Format C# thay đổi,
  Prettier tài liệu và `git diff --check` kiểm tra riêng; không định dạng lại module ngoài phạm vi.

## Giới hạn còn lại

Một ảnh CCCD mặt trước biến thể JPEG quality 55 mất dấu phẩy trong địa chỉ. Các từ,
số/tên/ngày sinh/giới tính/quốc tịch của ca đó đúng nhưng exact-match địa chỉ FAIL.
Giữ nguyên nhãn; không thêm dấu câu đoán hoặc nới phép so sánh để làm xanh.

Chưa có ảnh thực tế bổ sung cho hai mặt CCCD, điện cơ khí, nước cơ khí và nước điện tử;
chưa đo >=50 ảnh thật nhiều hãng/model, bánh số đang chuyển tiếp, LCD nhiều trang,
phản quang nặng hoặc E2E iPhone. Không suy ra accuracy production từ tập tổng hợp.
Mọi kết quả vẫn cần đối chiếu, sửa nếu cần và xác nhận.

Khởi động lại API để dùng **`ocrdoc-ppocrv6-vi-run6-9b534643-layout4`**; sáu profile và
cấu hình precision hiện có tiếp tục dùng được.
