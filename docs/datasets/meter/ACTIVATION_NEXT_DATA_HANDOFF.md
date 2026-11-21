# Review và data OCR — 08/11/2026

Human reviews0, independent register/precision labels0. Hai slot dưới đây chưa
được giao cho người nào; không phải reviewer identities hoặc consensus giả.
Mỗi slot là bản sao riêng của **package6 và package water3 hiện có**, giữ model
suggestions=false, SHA ảnh và nguồn. Không dựng lại annotation UI.

- Slot A: `.tools/ocr-activation-next/reviewer-A/index.html`.
- Slot B: `.tools/ocr-activation-next/reviewer-B/index.html`.

Bản ZIP tách riêng là `reviewer-A.zip`, `reviewer-B.zip` cùng thư mục task;
có source attribution, không có model/draft labels. SHA archive ở manifest slots.

Mỗi người tự annotate và export riêng từng pilot, dùng reviewer ID thật. Không
xem draft/model outputs trước khi đọc ảnh. Cần category/technology, numeric
display box, total register, đủ digits/zeros, uncertain positions, unit, decimal,
readability và physical-meter/source group. So sánh bằng `meter_review.py merge`
hiện có sau khi hai người hoàn tất; chưa tạo export hoặc chạy consensus.
[Trạng thái slots](activation-next-review-slots.json):9 ảnh khác nhau, không phải18.

[Nguồn water mới](activation-next-source-probes.json) lấy17 frame theo indices
cố định từ archive publisher trước inference. Repo tuyên bố dùng phi thương mại;
chỉ dùng nghiên cứu offline, không phân phối ảnh hay bật Staff từ các nhãn này.
Các frame320×240 chứa một phần body/register, nhiều transition và cùng thiết bị
lặp lại. Chỉ3 complete strings là **agent visual drafts**, không phải human GT;
unit/register/precision chưa xác minh. Filenames chỉ để provenance, không làm
GT hoặc input feature. SHA không trùng historical152 frame đã kiểm; dHash không
thấy near-duplicate, nhưng không chứng minh tách thiết bị hoặc không có overlap
với pretraining của model công khai. Một JPEG có header hỏng bị backend từ chối;
không nới validation hoặc sửa bytes để biến thành accepted input.

Nguồn mới là development/evaluation của iteration này; sau phân tích lỗi không
được tái gọi nó là một fresh final holdout. Chưa có independent holdout mới.
Proposal `00000` trên một frame transition vẫn unverified và đã tồn tại ở cả
baseline/full-row/geometry candidate; không dùng nó làm nhãn đúng hoặc proof
hai recognizers độc lập.

[Technology training](activation-next-technology-training.json) bổ sung50 frame
LCD đã có license CC-BY-NC-4.0, kiểm SHA và xem đủ3 sheets. Đó không phải50 thiết
bị độc lập: có nhiều frame cùng manufacturer/device. Tất cả cùng nguồn được
giữ TRAIN; chỉ annotate technology provisional, không gán utility/register/
digits/precision. CLIP và utility head frozen, chỉ technology head được fit một
recipe cố định. Candidate gây thêm wrong acceptance nên **REJECTED**, không
được dùng cho Staff; không dùng licenses này để tuyên bố quyền triển khai thương mại.

Digital-water: source mới tìm được vẫn không cung cấp readable full-resolution
LCD hợp lệ trong session. Repository LCD khác có manual access gate; chỉ đọc
metadata/card công khai, không tải ảnh gated hoặc bypass. Ba ảnh water LCD cũ
vẫn cần review và thêm view đọc được từ≥3 thiết bị thật. Category tiếp tục
**BLOCKED_BY_DATA**; mọi nhãn hiện tại giữ provisional.
