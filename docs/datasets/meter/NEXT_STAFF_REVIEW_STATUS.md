# Focused OCR review — 08/11/2026

Human-verified images: **0**. Independently verified exact-reading/register/
precision labels: **0**. Không có reviewer mới; nhãn giữ provisional, Staff
promotion blocked. Không approve toàn bộ327 ảnh Kaggle đang quarantine.

[Pilot6](next-staff-review-pilot.json) tái dùng builder/UI của pilot8 hiện có;
không thay pilot8. Gói local `.tools/ocr-next-staff/review-v3/index.html` không
hiện nhãn nháp, digits hay model suggestions. SHA ảnh và author groups được pin.

| Vai trò nháp cần review, không phải GT           | Số ảnh |
| ------------------------------------------------ | -----: |
| Potential digital-electricity positives          |      3 |
| Negative controls: timer/counter, blank/inactive |      3 |
| Blank/inactive trong nhóm controls               |      2 |
| Thiếu independent register/precision labels      |      6 |
| Human-verified / independent consensus           |      0 |

Hai người tự xem full photo, vẽ meterBox và windowBox sát **numeric register**,
chọn category (đã mã hóa utility + mechanical/digital), unit, total register,
readability, digits giữ zeros, uncertain positions và decimal precision. Ghi
physicalMeterGroup khi xác minh được; các frame cùng meter phải chung nhóm.
Không đoán precision từ số chữ số hoặc dùng ảnh crop gần giống như hai bằng
chứng độc lập. Unknown được giữ unknown; reviewer IDs không tự chứng minh tính
độc lập. Tool hiện cho ghi kW/kVA/V/A/Hz/imp-kWh/flow/hour units để không ép nhãn
negative thành kWh/m³; các đơn vị đó không tạo billing metadata hợp lệ.

[Nguồn bổ sung nhỏ](next-staff-public-sources.json): hai full-frame LCD/keypad
thật từ hai tác giả mới vào TRAIN provisional; một ảnh keypad blank của tác giả
khác giữ làm test. Ba kết quả tìm kiếm khác trùng IDs development/holdout/TRAIN
cũ, đã loại khỏi data mới; alias không tạo thiết bị độc lập mới. Author separation
không chứng minh physical-meter independence. Các [probes4](next-staff-source-probes.json)
được freeze trước candidate inference, không dùng chọn threshold; không phải
human acceptance. Không nhập ảnh product illustration làm digital-water positive.

Digital-water vẫn thiếu readable LCD của nhiều thiết bị thật với tổng m³, decimal
và status/flow controls được review. Các ảnh tìm lại trên Commons là ảnh cũ,
không làm tăng số thiết bị đã xác minh. Cần review pilot và thêm ảnh có quyền sử
dụng rõ ràng; không tự gán meter/precision labels để mở gate.
