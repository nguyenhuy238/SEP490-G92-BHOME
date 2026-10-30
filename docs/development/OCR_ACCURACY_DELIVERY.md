# Cải thiện độ chính xác OCR — 30/10/2026

Pha tiếp theo: [cải thiện đủ sáu luồng OCR](OCR_SIX_PROFILES_DELIVERY.md), engine `-layout4`.
Số liệu `-layout3` bên dưới giữ lại theo đúng lượt kiểm tra của pha trước.

## Phạm vi, nguồn và tiêu chí

Yêu cầu: nhận dạng tốt hơn trong điều kiện chụp thực tế, nhiều loại công tơ; tiếp tục
BF-03 / UC-13 (CCCD) và BF-05 / UC-20 (điện/nước), GBR-02/07, NFR Internal OCR
Processing, privacy và manual fallback. Đây là bước tiếp theo của
[sửa bố cục OCR](OCR_RECOGNITION_FIX.md).

Nguồn đối chiếu: SRS cục bộ `docs/reports/BHome_Report-3_Software Requirement Specification (2).docx`,
Report 4 `(5).docx`, API conventions, `OCR_MOBILE_DELIVERY.md`, model card đã pin,
engine/parser/authorization và các test hiện có. Bản báo cáo cục bộ khác tên/version
trong danh mục AGENTS.md; không suy ra chúng giống nhau.

Đã đối chiếu công thức mở rộng vùng chữ DB với
[PaddleOCR DB postprocess](https://github.com/PaddlePaddle/PaddleOCR/blob/main/ppocr/postprocess/db_postprocess.py)
và chuẩn hóa dòng với
[PaddleOCR recognizer](https://github.com/PaddlePaddle/PaddleOCR/blob/main/tools/infer/predict_rec.py).
Đây là tham chiếu thuật toán, không phải bằng chứng accuracy của BHOME. Giữ nguyên
ONNX/OpenCV, weights/checksum, CPU, deadline 8 giây và giới hạn concurrency hiện có.

| Tiêu chí chấp nhận                                                | Thành phần / kiểm thử                                                                       |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Không cắt dấu tiếng Việt, không xoay sai dòng dài khi ảnh nghiêng | `OcrImageGeometry`, engine; góc -20/-8/0/8/20 độ, smoke tên đầy đủ                          |
| Đọc được ảnh quay 90/180/270 độ trong ngân sách xử lý             | Phát hiện trục chữ, thử chiều ngược có giới hạn; tập đánh giá biến đổi                      |
| Tăng tương phản LCD có căn cứ từ vùng chỉ số/đơn vị               | `OcrNumericRefinement`; ảnh thực tế, kiểm thử polarity/giữ dấu chấm                         |
| Hai kết quả số hợp lệ khác nhau không được chọn theo điểm cao hơn | Cảnh báo `conflicting_reading`, proposal rỗng, nhập tay                                     |
| Không nhầm hệ số 10 khi model bỏ dấu thập phân                    | `MeterReadingPrecision`, metadata server; API và PostgreSQL integration                     |
| Không mở thêm quyền hoặc tự ghi chỉ số xác nhận                   | Test chéo Location/role sẵn có, query không ghi đè precision server, không tạo MeterReading |
| Accuracy có thể đo lại, không log giá trị/ảnh                     | CLI manifest, exact-match từng trường, kiểm thử ảnh rỗng và manifest lỗi                    |

## Những lỗi đã sửa

Detector trả vùng chữ đã co nhỏ. Mở rộng cố định nửa chiều cao làm mất nét/dấu;
engine nay dùng mở rộng chữ nhật theo diện tích/chu vi. Mặt trước cũng dùng bucket
640 khi dòng dài, khắc phục fixture tên tiếng Việt đã FAIL ở lần giao trước.

Cách sắp góc cũ lấy hai điểm có Y nhỏ nhất làm cạnh trên. Với dòng dài nghiêng nhẹ,
hai điểm đó có thể cùng thuộc cạnh trái, làm crop bị xoay sai 90 độ. Cách mới sắp
cặp trái/phải rồi lấy trên/dưới. Có kiểm thử hình học độc lập với model.

Engine kiểm trục chữ trước khi nhận dạng. Khi kết quả còn thiếu và còn ngân sách,
thử thêm chiều ngược 180 độ, tái sử dụng các vùng đã detect; không thử vô hạn.
Chỉ thay kết quả khi có thêm trường hợp lệ và các trường chung không xung đột.
Không thử đổi chiều để che một xung đột chỉ số đã phát hiện.

Với công tơ điện tử, chỉ tăng tương phản/Otsu ở vùng chữ số có đúng đơn vị gần nó,
không áp dụng threshold toàn ảnh hay đọc lại số sê-ri thành chỉ số. Nếu hai lần đọc
trả hai số hợp lệ khác nhau, trả fallback; không tự thay `O` thành `0`, `H` thành `4`,
hoặc chọn số có confidence lớn hơn. Nếu một lần giữ được dấu thập phân và lần kia
chỉ làm mất dấu giữa cùng dãy chữ số, giữ bản có dấu.

Engine mới: `ocrdoc-ppocrv6-vi-run6-9b534643-layout3`. Confidence vẫn chỉ là điểm
recognizer, chưa được hiệu chuẩn thành xác suất đúng. Kết quả vẫn cần người xác nhận.

## Dấu thập phân và ảnh thực tế

Người dùng cung cấp `docs/image.png`, công tơ GELEX/EMIC CE-38, và xác nhận chỉ số
đúng là **03251.4 kWh**. Bản cũ không khớp; bản mới khớp khi precision thực tế là 1.
Ảnh chỉ dùng đánh giá local, không đưa vào fixtures kiểm thử tự động, container image
hoặc gửi tới OCR/AI provider bên ngoài. File gốc không bị sửa.

`Meter.DecimalPlaces` đã tồn tại; màn tạo Meter ghi rõ “Số chữ số thập phân thực tế
(0–4)”. Nay repository đưa metadata đó vào `OcrWorkflowResource`, application đặt
dấu theo precision trước khi lưu proposal. **Precision nghiệp vụ luôn lấy từ Meter
trên server**, không lấy query/body của Staff. Sai số chữ số sau dấu chấm hoặc dãy
thiếu chữ số phải fallback, không cắt hay làm tròn để vừa cấu hình.

Màn thử không có Meter nghiệp vụ nên bổ sung lựa chọn precision, mặc định “Chưa xác
định”. API diagnostics nhận `?decimalPlaces=0..4`, chỉ cho profile công tơ. Khi không
có cấu hình và model không đọc dấu chấm, cảnh báo `decimal_separator_unverified`;
không mặc định mọi chữ số cuối đều là phần lẻ. Đổi profile đưa lựa chọn về mặc định.

Đây là chuẩn hóa theo mặt số đã cấu hình, **không phải quy tắc bỏ phần lẻ để tính tiền**.
Không thêm công thức hóa đơn, sửa lịch sử chỉ số hoặc tự xác nhận lượng tiêu thụ.
Không cần migration hoặc thay cấu hình model.

## Đánh giá có thể lặp lại

Sinh tập tổng hợp từ các fixture có sẵn, không tái tạo/sửa ảnh kỳ vọng cũ:

```powershell
dotnet run --project tools/BHome.OcrSmoke -- --generate-evaluation tests/fixtures/ocr .tools/ocr-evaluation
dotnet run --project tools/BHome.OcrSmoke -- .tools/ocr-models --evaluate .tools/ocr-evaluation/manifest.json .tools/ocr-evaluation/report.json
```

Có **58 ca**: 7 ảnh nguồn × 8 biến thể (nguyên bản, nghiêng 8 độ, phối cảnh, giảm
tương phản, JPEG quality 55, quay 90/180/270) và 2 ca ảnh rỗng. Đây không phải 58
ảnh công tơ/thẻ thật độc lập. So khớp đúng toàn bộ trường được gán nhãn, giữ số 0 đầu
và dấu thập phân; không dùng confidence làm nhãn đúng.

| Cùng tập tổng hợp                      | Trước, layout2 | Sau, layout3 |
| -------------------------------------- | -------------: | -----------: |
| Ca khớp chính xác / tổng               |        24 / 58 |      58 / 58 |
| p95 inference của lượt Windows đã chạy |        1703 ms |      2233 ms |

Các p95 này chỉ thuộc tập nhỏ và máy local, không chứng minh NFR ở 100 phiên đồng
thời. Runtime vẫn trả proposal hoặc fallback trong deadline; không tăng timeout để
làm benchmark qua. Ảnh thật CE-38: 0/1 → 1/1, lượt sau 2638 ms, dùng metadata 1
chữ số thập phân. **Một ảnh thật chưa đủ kết luận accuracy >=90% hoặc hỗ trợ mọi hãng.**

Để đánh giá bộ ảnh công tơ khác, đặt ảnh và `manifest.json` trong cùng thư mục local
được bỏ qua bởi Git, ví dụ `.tools/ocr-real/`:

```json
{
  "dataset": "meter-evaluation",
  "cases": [
    {
      "file": "meter-001.jpg",
      "kind": "DigitalElectricity",
      "decimalPlaces": 1,
      "expectedFields": { "reading": "00012.3" }
    }
  ]
}
```

Ví dụ trên dùng nhãn tổng hợp; thay bằng nhãn được con người kiểm tra cho từng ảnh.
`kind` nhận `MechanicalElectricity`, `DigitalElectricity`, `MechanicalWater`,
`DigitalWater`; không áp dụng cùng precision cho mọi loại công tơ.

```powershell
dotnet run --project tools/BHome.OcrSmoke -- .tools/ocr-models --evaluate .tools/ocr-real/manifest.json .tools/ocr-real/report.json
```

CLI trả exit 0 khi tất cả ca khớp, 1 khi có sai/thiếu, 2 khi input lỗi. Manifest giới
hạn 1000 ca/2 MiB, file ảnh trong thư mục manifest, field name theo allowlist. Dataset
`meter-evaluation` không nhận profile CCCD; CCCD chỉ dùng tổng hợp. Report ghi index,
field đúng/sai, thiếu/sai bao nhiêu trường, số nguồn, phiên bản engine, fallback và
latency; không ghi đường dẫn ảnh, raw OCR text, giá trị kỳ vọng hay giá trị đọc được.
`falseProposals` đếm riêng proposal ngoài dự kiến ở các ca `expectFallback`, không
phải tổng số trường nhận sai; xem `incorrectExpectedFields` và `missingExpectedFields`.

## Kiểm chứng và giới hạn

- Build Release: PASS, 0 warning/error. Smoke engine Windows và Linux: **12/12 PASS**,
  gồm tên CCCD mặt trước giữ nguyên kỳ vọng gốc.
- Mobile: **45 test PASS**, typecheck và lint PASS.
- Bộ test mới kiểm crop nghiêng, quay trục, LCD hai polarity, xung đột số, dấu chấm,
  precision, API invalid/identity/disabled, không tin query precision, và persistence
  proposal dùng `DecimalPlaces` trong PostgreSQL, không tạo MeterReading.
- Lượt full backend đầu: Application 128 PASS, Domain 38 PASS, Integration 206 PASS /
  1 FAIL ở test cạnh tranh LocationAssignment ngoài phần OCR. Chạy riêng test đó lại
  PASS; không sửa logic hoặc bỏ test. Lượt cuối **373/373 PASS**, không skip:
  Application 128, Domain 38, Integration 207, có PostgreSQL/MinIO disposable.
  Chưa kết luận test cạnh tranh đó đã hết tính không ổn định qua nhiều lượt CI.
- Lỗi build trung gian CS0854 do optional constructor trong EF expression đã được
  sửa bằng truyền null tường minh. Test host OCR mới ban đầu 401 vì dùng token của
  host khác; đã chuyển sang đăng nhập trên chính host kiểm thử, không nới auth.
- CLI negative: **3/3 PASS** cho `cases: null`, đường dẫn vượt thư mục manifest và
  field name ngoài allowlist; exit 2, thông báo chung, không lộ marker dữ liệu/path.
  Lượt đầu phát hiện thiếu catch `InvalidDataException`, đã sửa và chạy lại cả ba.
- Lượt evaluation cuối tiếp tục **58/58 PASS**, 8 nguồn kể cả ảnh rỗng, không có
  trường kỳ vọng sai/thiếu; p95 3252 ms khi chạy cùng build/test. Ảnh thật tiếp tục
  **1/1 PASS**, 3652 ms. Các lượt lặp không được tính thành ảnh thực tế độc lập mới.
- Kiểm tra format riêng C# thay đổi, Prettier TS/Markdown mới/thay đổi và
  `git diff --check` được chạy riêng. Không định dạng lại các Contract/migration
  ngoài phạm vi đang có lỗi format đã ghi trong báo cáo trước.

Các lệnh kiểm tra chính đã chạy:

```powershell
dotnet build src/backend/BHome.sln -c Release --no-restore -m:1 -nodeReuse:false
dotnet test src/backend/BHome.sln -c Release --no-build -m:1 -nodeReuse:false -v minimal --logger trx
docker compose -f deploy/docker/compose.ocr-smoke.yml run --build --rm smoke
npm.cmd run test --workspace src/mobile
npm.cmd run typecheck --workspace src/mobile
npm.cmd run lint --workspace src/mobile
git diff --check
```

Chưa xác minh bộ tối thiểu 50 ảnh thật với nhiều hãng/model, ảnh bánh số chuyển tiếp,
LCD đổi màn, phản quang nặng, số đỏ không có cấu hình precision, E2E iPhone hoặc
confidence calibration. Các trường hợp không chắc chắn vẫn phải chụp lại/nhập tay.
Đây là cải thiện pipeline đã đo được, không phải chứng nhận production accuracy.

Khởi động lại API và reload mobile để nạp `-layout3`. Với Meter nghiệp vụ, kiểm tra
precision thực tế trong cấu hình hiện có; với màn thử, chọn theo mặt số trước khi chụp.
