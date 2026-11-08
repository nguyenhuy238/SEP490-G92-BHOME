# Gói review OCR — 08/11/2026

Human reviews **0**, independent register/precision labels **0**. Giữ toàn bộ
nhãn mới provisional; chưa mở gate Staff. Không approve collection327, không đổi
TRAIN/validation/test cũ. BF-05/UC-20/GBR-07: OCR là đề xuất, Staff phải xác nhận.

Gói ưu tiên vẫn là **6 ảnh hiện có**:
`.tools/ocr-next-staff/review-v3/index.html`. SHA và manifest ở
[next-staff-review-pilot.json](next-staff-review-pilot.json). Không dựng lại hoặc
thay pilot này. Hai người làm độc lập khi khả thi, dùng reviewer IDs thật, mỗi
người export JSON riêng; dùng `meter_review.py merge` hiện có để so consensus.
Không xem model suggestions hoặc nhãn nháp trước khi tự annotate.

Mỗi ảnh cần category/technology, meterBox, windowBox sát toàn bộ numeric row,
accumulated register, complete visible digits giữ zeros, decimal/precision,
unit, readability, uncertain positions và physicalMeterGroup/sourceGroup.
Không suy ra precision từ số chữ số, metadata caption hoặc kết quả OCR. Không
coi credit balance, PF, voltage, current, flow/status hay timer là tổng tiêu thụ.
Unknown và ảnh không đọc được phải được giữ đúng trạng thái.

Gói bổ sung water dùng lại **cùng builder/UI**, không phải dataset train mới:
`.tools/ocr-accuracy-next/water-review/index.html`, manifest
[accuracy-next-water-review.json](accuracy-next-water-review.json).
Ba ảnh nguồn cũ gồm hai màn hình có chữ số cần review và một LCD không hoạt động.
Đây chưa phải ba thiết bị readable đã xác minh; source-author separation không
chứng minh physical-device independence. Một ảnh có nhãn số nháp không thống
nhất, nên chưa được dùng làm exact-reading GT mới. Package không hiện các chuỗi
nháp hoặc model output đó. Cần thêm view đọc được của ít nhất ba thiết bị thật.
Tải bản gốc gặp HTTP429; đã dừng, không bypass hoặc đoán URL khác.

[Ba ảnh mới có giấy phép](accuracy-next-public-sources.json) chỉ thêm probes
category/negative: hai digital-electricity blank/status-unverified và một
mechanical-water rolling digit. Không có numeric GT mới, không đưa vào TRAIN.
Audit SHA/dHash giữ cả trường hợp cùng tác giả với ảnh lịch sử; không tính thành
nguồn độc lập. Cần xác minh thêm ảnh/frame cùng thiết bị trước mọi acceptance.

Staff activation vẫn cần nhãn human về register, complete reading, decimal,
unit, nguồn/thiết bị tách riêng, positive coverage và negative rejection theo
[gates hiện có](next-staff-recognition-gates.json). Gói nhỏ này chuẩn bị dữ liệu,
không chứng nhận đạt target ≥90% trên ≥50 ảnh.
