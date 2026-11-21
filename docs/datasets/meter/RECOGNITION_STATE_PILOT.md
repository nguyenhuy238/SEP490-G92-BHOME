# Pilot trạng thái màn hình — 12 ảnh, chưa có human review

Người dùng xác nhận hiện chưa có hai reviewer; tiếp tục với nhãn provisional.
[Manifest](recognition-state-pilot.json) giữ 12 ảnh public:11 điện LCD,1 nước LCD;
6 Kaggle và6 Commons. Có9 bản đọc nháp,2 blank/inactive và1 ca digit tranh chấp.
Không dùng các số này như independent accuracy hoặc supervised numeric training.
Không có SHA trùng hoặc cặp pHash63 distance≤6 trong pilot; physical independence
vẫn unknown, toàn Kaggle giữ một source group. Không đổi các historical splits.

Gói review mù tại `.tools/ocr-next-pilot-review/index.html`, không hiện annotation
nháp hay model output. Mỗi reviewer tự nhập nhãn, trạng thái màn hình, confidence,
group và vẽ body/window. Có link mở ảnh gốc để phóng to. Mỗi source group được giữ
riêng khi merge; view D chứa negative states. Exact digits từ blank/segment-test/
obscured bị chặn, không lọt vào recognition view. Mọi consensus vẫn pending project
review; hai ID không chứng minh hai người độc lập.

```powershell
.tools/yolo-python/python.exe tools/BHome.OcrSmoke/model_tools/prepare_recognition_pilot.py . docs/datasets/meter/recognition-state-pilot.json
.tools/yolo-python/python.exe tools/BHome.OcrSmoke/model_tools/meter_review.py build-manifest docs/datasets/meter/recognition-state-pilot.json . .tools/ocr-next-pilot-review-replay
```

Không overwrite review pack. Ảnh/crop/alias chỉ nằm trongignored `.tools`; tên file
opaque không công bố publisher filenames chứa mã thiết bị. Body bbox chưa review
ở6 Kaggle giữ null, không lấy toàn ảnh thay body. Window boxes là publisher hoặc
numeric-region proxies cũ, không được gọi là verified billing register.

Ba điểm phải kiểm lại trước thí nghiệm:

- `commons_141189268`: ảnh gốc có glyph ởindex7 cần phân biệt1/7. Giữ nguyên frozen
  label000880578; bản nháp mới để digits=null và uncertainPositions=[7]. Không sửa
  benchmark theo English OCR, không loại ca khỏi historical wrong-output counts.
- Preview8/37 trước bị loại vì nhãn blank: ảnh vẫn có dấu vết000000.00 và mã giống
  2.8.0. Chưa đủ bằng chứng để dùng chúng làm negative blank GT; chuyển phạm vi
  nghiên cứu mới sang unknown, giữ nguyên dữ liệu/lịch sử cũ. Không suy registry
  billable từ mã này. Preview48 thể hiện toàn segment/annunciators, chỉ dùng làm
  provisional segment-test control trong nghiên cứu phi thương mại theo source license.
- [Mendeley fnn44p4mj8 v1](https://data.mendeley.com/datasets/fnn44p4mj8/1) là ảnh
  **seven-segment digital energy meters**, CC0, không phải mechanical-water data.
  163 prepared crops không giải quyết thiếu dữ liệu wheel-water hoặc water LCD.

Source digital-water mới tìm được trên Commons vẫn trả429 khi tải public; không
đổi host/vượt hạn chế. Ảnh nước thứ hai đã có trong control cũ có glare che chữ số
và nhiều thiết bị: chỉ hỗ trợ state/scene review, không tạo exact numeric GT mới.
Các phần thiếu: readable water LCD đa thiết bị, precision/register GT, mechanical
electricity wheel digits đủ rõ và independent human review.
