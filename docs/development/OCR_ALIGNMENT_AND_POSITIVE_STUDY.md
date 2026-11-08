# Kiểm chứng vùng chữ số và positive OCR — 06/11/2026

BF-05 / UC-20 / GBR-07; không thay đổi billing UC-21 hoặc runtime recognizer.
Mục tiêu là tìm nguyên nhân fallback có bằng chứng trước khi chỉnh threshold.

## Thử nghiệm mới: căn PP theo polygon chữ số Stage2

Khác các lượt canonical/margin/CLAHE trước, ROI mới là MinAreaRect của **toàn bộ
polygon chữ số đã qua assembly guard**, cộng context đối xứng 8% cạnh ngắn.
Không dùng GT/count/value để dựng crop; giữ confidence/unknown/geometry gate.
Input cùng Mobile resize1600/JPEG85. Script xác minh hash ảnh/nhãn, loại mọi SHA
trùng test trước inference. Validation100 ảnh,69 nhãn digit đầy đủ; loại ảnh
`wm_clean_000386.jpg` và label tương ứng vì trùng byte test. Physical-meter/site
independence chưa rõ. Không chạy candidate trên test hoặc dùng test để lựa chọn.

| Policy offline trên validation100 | Exact digits /69 | False /69 | Fallback /100 |
| --- | --- | --- | --- |
| Runtime baseline hiện tại | 12 | 0 | 88 |
| PP căn theo polygon, vẫn cho Stage2-only nếu PP malformed | 13 | 0 | 87 |
| PP căn theo polygon bắt buộc parse đủ và khớp Stage2 | 7 | 0 | 93 |

**REJECTED cả hai biến thể, không tích hợp.** Biến thể permissive13 có thể làm
PP mới malformed, rồi đi nhánh Stage2-only và xóa bất đồng numeric hợp lệ trước
đó. Điều này vi phạm safeguard giữ disagreement, dù tập nhỏ chưa ghi nhận sai.
Biến thể strict7 làm giảm coverage. Không kết hợp chọn kết quả thuận tiện theo
test, không giảm confidence, không thay weights hoặc bật classifier bị loại.
Decimal/register GT chưa có: đây là digit accuracy, không phải billing accuracy.

[Kết quả theo ảnh](ocr-priority-alignment-results.json). Raw public-only
`.tools/ocr-priority-alignment-validation.json` có hash được pin trong report.

```powershell
dotnet run --project tools/BHome.OcrSmoke -c Release -- --water-digit-alignment-study .tools/ocr-models .tools/meter-detection-models .tools/meter-detection-validation tools/BHome.OcrSmoke/model_tools/evaluation-validation-deduplicated-manifest.json tools/BHome.OcrSmoke/model_tools/evaluation-full-test-manifest.json .tools/ocr-priority-alignment-validation.json
.tools/yolo-python/python.exe tools/BHome.OcrSmoke/model_tools/summarize_water_alignment.py .tools/ocr-priority-alignment-validation.json docs/development/ocr-priority-alignment-results.json
.tools/yolo-python/python.exe tests/scripts/test_water_alignment_summary.py
```

## Hai ứng viên positive khác nguồn

[Manifest](../datasets/meter/licensed-meter-positive-candidates.json) được đóng
băng trước inference. Đã kiểm source/license/hash, agent xem ảnh gốc và window;
human review độc lập còn thiếu. Không dùng hai ảnh để sửa reader/chọn threshold.
Body polygon chỉ hỗ trợ chỉ định đối tượng; không dùng làm detection GT đầy đủ
cho ảnh ba meter. Chạy riêng full-frame trusted profile, automatic và window do
annotation cung cấp (oracle). Các phép đo không cộng gộp với training/validation.

| Category / ảnh | Trusted full-frame | Automatic full-frame | Oracle PP page/direct | Oracle Stage2 |
| --- | --- | --- | --- | --- |
| Nước cơ / `commons_88598855`, digits35558 | Fallback: display không tìm thấy | Unknown, không proposal | 0/1 đúng mỗi mode, fallback | 0/1, unclear_digit |
| Điện LCD / `commons_52855795`, selected digits000059 | Từ chối ảnh ba meter | Timeout/manual trong8.018s | 0/1 đúng mỗi mode, fallback | Không áp dụng water model |

Không có đề xuất numeric sai ở hai ảnh, nhưng cũng **không có positive đúng**.
Full-frame điện là rejection control cho nhiều meter, không đưa vào mẫu số
positive full-frame của selected window. Oracle crop không chứng minh display
detection. Hai ảnh đều thiếu precision đã xác minh; billing accuracy=null.
Latency là một lượt CPU local, không phải benchmark tải hoặc regression tốc độ.
Chưa có positive điện cơ/nước LCD độc lập đầy đủ; không thêm numeric GT suy đoán.

[Evidence inference thật](ocr-priority-positive-results.json).

```powershell
dotnet run --project tools/BHome.OcrSmoke -c Release -- --reviewed-positive-evaluate .tools/ocr-models .tools/meter-detection-models docs/datasets/meter/licensed-meter-positive-candidates.json . docs/development/ocr-priority-positive-results.json
```

Exit0 của evaluator nghĩa là đã tạo report, không phải đạt quality gate. Không
đăng ký reader mới từ các kết quả này. Bộ ảnh public giữ ngoài Git.
