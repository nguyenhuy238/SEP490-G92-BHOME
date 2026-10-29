# Ảnh OCR tổng hợp

Ba PNG được tạo bằng `scripts/New-SyntheticOcrFixtures.ps1` (Arial/Windows GDI+).
Không phải ảnh CCCD hoặc đồng hồ thật; không chứa danh tính có thật. Chuỗi 12 chữ số toàn 0
là dữ liệu kiểm thử, chỉ kiểm tra format và không chứng minh CCCD hợp lệ.

`identity-front.png`/`identity-back.png` là văn bản giả lập, không phải bố cục thẻ thật.
`meter.png` là một chuỗi số in; dùng cùng ảnh cho bốn profile chỉ kiểm tra đường xử lý,
không chứng minh khả năng đọc mặt số cơ khí, số đỏ, LED/LCD hoặc góc chụp thực tế.

Smoke test so khớp chính xác tên tiếng Việt/ngày cấp/chỉ số và trả exit 1 nếu không khớp.
Không chỉnh nhãn kỳ vọng theo kết quả model. Không suy ra accuracy hay p95 từ ba ảnh này.
