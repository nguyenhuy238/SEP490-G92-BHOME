# Ảnh OCR tổng hợp

Các PNG được tạo bằng `scripts/New-SyntheticOcrFixtures.ps1` (Arial/Windows GDI+).
Không phải ảnh CCCD hoặc đồng hồ thật; không chứa danh tính có thật. Chuỗi 12 chữ số toàn 0
là dữ liệu kiểm thử, chỉ kiểm tra format và không chứng minh CCCD hợp lệ.

`identity-front.png`/`identity-back.png` là văn bản giả lập, không phải bố cục thẻ thật.
`meter.png` là một chuỗi số in; dùng cùng ảnh cho bốn profile chỉ kiểm tra đường xử lý,
không chứng minh khả năng đọc mặt số cơ khí, số đỏ, LED/LCD hoặc góc chụp thực tế.

`identity-back-layout.png` bổ sung nhãn “Ngày, tháng, năm / Date, month, year” tách khỏi
ngày cấp, tương ứng biến thể nhãn mặt sau CCCD gắn chip. `identity-back-2024.png` bổ sung
nhãn ngày cấp và nơi cư trú của Căn cước 2024. Đây vẫn là văn bản tổng hợp, không phải
bản sao thiết kế thẻ, không kiểm chip/MRZ hay xác thực căn cước.

`electricity-mechanical.png`, `electricity-digital.png`, `water-mechanical.png` và
`water-digital.png` chứa chỉ số + đơn vị + số sê-ri + thông số gây nhiễu. Chúng kiểm tra
phân biệt chỉ số với thông số và lỗi recognizer ghép đơn vị vào chữ số; các ảnh này dùng
chữ in Arial, chưa mô phỏng LCD bảy đoạn hoặc bánh số thực tế. Kiểm thử parser riêng kiểm
các ô chữ số rời bằng tọa độ, giữ nguyên dấu thập phân quan sát được.

`scripts/New-OcrProfileFixtures.ps1` bổ sung `identity-front-layout.png`,
`identity-back-residence.png`, hai ảnh `*-mechanical-wheels.png` và hai ảnh
`*-digital-lcd.png`. Chúng kiểm trường cùng hàng, địa chỉ nhiều dòng, ô bánh số đen/đỏ,
LCD tương phản thấp và đơn vị trên/dưới. Đây vẫn là Arial/Consolas tổng hợp, không phải
ảnh thiết bị thật hoặc mọi dạng LED/LCD bảy đoạn. Dấu chấm có trong ảnh; màu đỏ không
tự quyết định precision. Không chứa danh tính thật.

Smoke test so khớp chính xác tên tiếng Việt/ngày cấp/chỉ số và trả exit 1 nếu không khớp.
Không chỉnh nhãn kỳ vọng theo kết quả model. Không suy ra accuracy thực tế từ ảnh tổng hợp.
Xem [kết quả theo sáu profile](../../../docs/development/OCR_SIX_PROFILES_DELIVERY.md).
