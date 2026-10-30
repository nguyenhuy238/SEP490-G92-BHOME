# Sửa nhận dạng CCCD mặt sau và chỉ số công tơ — 30/10/2026

Cập nhật tiếp theo: [OCR_ACCURACY_DELIVERY.md](OCR_ACCURACY_DELIVERY.md) bổ sung ảnh thực tế,
sửa crop/rotation, precision và đã khắc phục smoke tên mặt trước còn FAIL trong báo cáo này.

## Phạm vi và truy vết

Yêu cầu: sửa lỗi `unsupported_or_unreadable_layout` của mặt sau CCCD, hỗ trợ nhãn của
CCCD gắn chip 2021 và Căn cước 2024; sửa đường đọc công tơ điện/nước cơ khí/điện tử.

Nguồn đã đối chiếu trực tiếp:

- `docs/reports/BHome_Report-3_Software Requirement Specification (2).docx`:
  BF-03 / UC-13, BF-05 / UC-20, GBR-07 (OCR chỉ là đề xuất, có nhập tay),
  NFR Internal OCR Processing và bảo vệ/xóa ảnh CCCD tạm thời.
- `docs/reports/Report-4_Software Design Specification (5).docx`:
  Internal OCR, CCCD OCR, OCR confirmation, Reliability & Recoverability.
- `docs/api/API_CONVENTIONS.md`, `INTERNAL_OCR.md`, `OCR_MOBILE_DELIVERY.md`,
  controller/service/parser/engine thực tế và các test OCR sẵn có.
- Model card tại `.tools/ocr-models/README.md`, metadata ONNX đã chạy thật:
  recognizer có chiều rộng động, dùng hai bucket 320/640 của model đã pin.

Tên/version báo cáo cục bộ khác danh mục AGENTS.md; không suy ra các bản đó giống nhau.
Không thay chính sách còn mở, role, endpoint, xác nhận, schema, migration hay provider.

| Hành vi cần sửa                                 | Thành phần                     | Tiêu chí chấp nhận                                                                                                       |
| ----------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Nhãn mặt sau 2021/2024, nhãn song ngữ tách dòng | `OcrFieldParser`               | Đọc ngày cấp từ nhãn tương ứng; ngày lỗi/xung đột không được đoán; không mượn ngày hết hạn                               |
| Dòng dài bị nén mất chữ                         | `OnnxOcrEngine.ReadLine`       | Mặt sau dùng bucket 640 khi cần; giữ bucket 320 cho đường mặt trước hiện có                                              |
| Chỉ số lẫn số sê-ri/thông số                    | `MeterReadingParser`           | Ưu tiên số đi cùng nhãn chỉ số/đúng đơn vị; nhiều màn hình vẫn báo mơ hồ; không lấy điện áp/năm sản xuất làm chỉ số      |
| Đơn vị bị ghép vào chữ số                       | `MeterDisplaySplitter`, engine | Tách theo khoảng trắng của ảnh, đọc lại số và đơn vị; chỉ nhận bản tách khi đơn vị được nhận dạng rõ và parser chấp nhận |
| Bánh số bị detector tách thành ô riêng          | `OcrLine.Bounds`, parser       | Chỉ ghép các ô chữ số liền nhau theo tọa độ; giữ số 0 đầu và dấu thập phân quan sát được                                 |
| Lỗi hiển thị mã tiếng Anh                       | `ocrDiagnostics.ts`            | Thông báo tiếng Việt có hướng dẫn xử lý, giữ mã hỗ trợ kỹ thuật                                                          |

## Nguyên nhân và thay đổi

Parser cũ chỉ có nhãn `Ngày cấp / Date of issue`, chưa có `Ngày, tháng, năm /
Date, month, year`, chưa đọc nơi cấp; nhãn/giá trị tách dòng có thể bị bỏ qua.
Parser mới so nhãn không phụ thuộc dấu nhưng giữ nguyên dấu trong giá trị, tách nhãn
song ngữ, chấp nhận ngày có một/hai chữ số ngày/tháng và vẫn kiểm tra ngày thực tế.
Không suy diễn ngày không có nhãn, nơi cấp theo tên cơ quan, thế kỷ MRZ hoặc thông tin chip.

Parser công tơ cũ lấy mọi số trong ảnh và yêu cầu chỉ có một số duy nhất. Do đó ảnh đầy
đủ mặt công tơ thường bị từ chối; ảnh chỉ có `220 V` hoặc `S/N: ...` lại có thể thành
đề xuất sai. Parser mới dùng nhãn/đơn vị và quan hệ tọa độ, bỏ số kỹ thuật, không tự chọn
khi có nhiều chỉ số cùng đơn vị. Không suy ra phần thập phân từ màu đỏ hoặc loại công tơ.

Engine thật tái hiện việc `m3` bị đọc dính vào số và `kWh` bị đọc sai trong cả ảnh in rõ.
Bản sửa tách vùng số/đơn vị theo khoảng trắng, cắt nền dư và thêm viền tỷ lệ với chiều cao
chữ trước khi đọc lại. Tối đa bốn vùng được thử lại, vẫn dùng deadline/concurrency hiện có.
Không đổi weights, checksum, dịch vụ bên ngoài hoặc ghi ảnh/raw OCR text vào log.
Engine version mới: `ocrdoc-ppocrv6-vi-run6-9b534643-layout2`.

Không đổi authorization: Owner/Staff và scope Location vẫn được kiểm tra ở luồng hiện có.
Ảnh CCCD chỉ xử lý tạm thời, không thêm lưu trữ; kết quả vẫn cần xác nhận và có nhập tay.
Không có thay đổi trạng thái hay giao dịch dữ liệu trong bước nhận dạng.

## Kiểm chứng thực tế

- Trước sửa: 12 test parser mới FAIL / 17 PASS. Các ảnh bố cục mới tái hiện lỗi trên engine,
  không đổi nhãn kỳ vọng theo output để làm xanh kiểm thử.
- `dotnet build src/backend/BHome.sln -c Release --no-restore -m:1 -nodeReuse:false`:
  **PASS**, 0 warning/error.
- `dotnet test src/backend/BHome.sln -c Release --no-build -m:1 -nodeReuse:false -v minimal --logger trx`:
  **PASS 340 test**: Application 116, Domain 38, Integration 186, không skip.
  Có PostgreSQL/MinIO disposable, test scope/negative, xác nhận, bộ đệm ảnh, timeout,
  concurrency/cancellation và native OpenCV. Không migrate database của người dùng.
- `npm.cmd run test --workspace src/mobile`: **PASS 44 test**.
  `npm.cmd run typecheck --workspace src/mobile`, `npm.cmd run lint --workspace src/mobile`:
  **PASS**. Chỉ đổi helper thông báo thuần TypeScript, không đổi API Expo/camera.
- `dotnet run --no-restore --project tools/BHome.OcrSmoke -- .tools/ocr-models tests/fixtures/ocr`:
  **11 PASS / 1 FAIL**, exit 1. Sáu ảnh bố cục mới (hai biến thể mặt sau + bốn profile
  công tơ) đều PASS. FAIL còn lại là so khớp chính xác tên có dấu của fixture mặt trước
  đã FAIL trước thay đổi; giữ nguyên ảnh và kỳ vọng gốc.
- `docker compose -f deploy/docker/compose.ocr-smoke.yml run --build --rm smoke`:
  build **PASS**, inference **11 PASS / 1 FAIL** giống Windows, exit 1 do mặt trước.
  Sáu ca mới mất 1156–1254 ms/ảnh trên Linux 2 CPU; đây là smoke mẫu nhỏ, không phải p95/SLA.
  Lần build đầu FAIL vì Dockerfile smoke thiếu dependency digital-signing đang được
  Infrastructure tham chiếu; bổ sung đúng các project/source cần thiết rồi build lại.
- `dotnet format src/backend/BHome.sln --verify-no-changes --no-restore` toàn solution:
  **FAIL** do định dạng có sẵn ở các file Contract/migration/ApiExceptionHandler ngoài phạm vi.
  Không định dạng lại các file đó. Kiểm tra riêng các file C# thay đổi bằng cùng lệnh với
  `--include`: **PASS**; Prettier các file TS/Markdown mới hoặc thay đổi nội dung kiểm thử
  và `git diff --check`: **PASS**.

## Chạy lại và giới hạn

Khởi động lại API đang dùng để nạp assembly mới, reload ứng dụng mobile; màn thử phải hiện
engine có hậu tố `-layout2`. Không cần migration, tải lại model hoặc đổi cấu hình OCR.

Ảnh được tạo bằng `scripts/New-SyntheticOcrFixtures.ps1`; xem `tests/fixtures/ocr/README.md`.
Các ảnh công tơ mới kiểm số và đơn vị giữa thông số gây nhiễu, vẫn là chữ in Arial.
Chưa xác minh ảnh chụp thực tế của hai đời thẻ, mặt số cơ khí/LCD bảy đoạn, ảnh nghiêng/lóa,
bộ tối thiểu 50 ảnh hoặc E2E iPhone. Ảnh người dùng cung cấp là màn báo lỗi, không phải
ảnh đầu vào OCR nên chưa thể xác nhận chính xác trường hợp trên thiết bị đã hết lỗi.
Không tuyên bố đọc đủ mọi trường/loại mặt số hoặc đạt mục tiêu accuracy >=90%.
