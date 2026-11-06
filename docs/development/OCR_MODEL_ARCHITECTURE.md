# Kiến trúc OCR và gate model — 06/11/2026

Truy vết: BF-05 / UC-20 / GBR-07 cho OCR proposal/xác nhận; GBR-01/02 cho
Staff/Location scope; UC-21 / GBR-09 cho billing từ confirmed readings. Yêu cầu
master cho phép adapter bốn lớp và thử nghiệm Development, không cho bật model
chưa đạt đánh giá trong Production. SRS cục bộ có tên revision khác danh mục
AGENTS.md; không coi tài liệu này là thay đổi baseline nghiệp vụ.

## Pipeline đang chạy

`OcrWorkflowService` xác thực scope và lấy Meter metadata từ server trước khi
`LocalOcrService` đọc ảnh. Service giới hạn bytes/pixels/concurrency/deadline,
xóa buffer; `OnnxOcrEngine` dùng OpenCV + PP-OCR DBNet/CTC nội bộ. Scene detector
water OBB và Stage2 water digits giữ nguyên checksum, opt-in và phạm vi nước cơ.
`MeterRecognitionFusion` từ chối mâu thuẫn; `MeterReadingParser` giữ leading zeros,
đơn vị, decimal và ambiguity guards. Precision tác vụ lấy từ server.

Automatic diagnostic giữ một nút chụp; text rules có confidence=null. Detector
window không được gán thành classifier. Crop preview là dữ liệu review tạm,
không lưu/log. Meter proposal không tạo confirmed reading hay hóa đơn. Staff
sửa/xác nhận qua workflow transaction/evidence hiện có; API và schema không đổi.

## Adapter bốn lớp bổ sung

`YoloMeterCategoryClassifier` được DI inject qua `IImageCategoryClassifier`,
**mặc định Disabled**. Không có weights bốn lớp đạt yêu cầu đi kèm. Adapter chỉ
chạy ở Development khi cấu hình rõ `Ocr:VisualClassifier:Enabled`, `ModelPath`,
SHA256 của artifact đã được đánh giá. Không thay appsettings để bật. Production
trả unavailable và tiếp tục pipeline cũ với warning, kể cả ai bật nhầm flag.

Hợp đồng được kiểm trước inference:

- FP32 input `[1,3,416,416]`, output `[1,8,3549]`, cxcywh +4 scores, không
  objectness/embedded NMS. `names` metadata phải đúng thứ tự electricity mechanical,
  electricity digital, water mechanical, water digital. Model ba lớp cũ bị từ chối.
- SHA256 được kiểm trên chính bytes dùng để tạo session, tránh hash/open race.
  Lazy singleton/session thread-safe, warmup trước listener, ORT RunOptions gắn
  CancellationToken; tensors/native results được giải phóng. Không có Python/network.
- Letterbox RGB/255/padding114 dùng helper hiện có; decode đảo scale/padding và
  class-aware NMS IoU.45. Giữ cạnh tranh khác lớp ngay cùng anchor và mọi meter
  hậu NMS trên candidate threshold.25; không chỉ lấy score cao nhất toàn ảnh.
- Chỉ một detection đạt classification threshold hiện có.9 mới classified.
  Nhiều detection/mâu thuẫn → ambiguous; không detection → unknown. Scores là
  model confidence, chưa có calibration/accuracy claim. Bounds/tensor/NaN/giới hạn
  bất hợp lệ → unavailable, không tự đoán category.

`OnnxOcrEngine` giữ CCCD/text route khi classifier unavailable. Model chỉ có
meter classes không được chặn CCCD khi không phát hiện meter nhưng PP-OCR có
bằng chứng identity mạnh. Trường hợp nhiều meter vẫn fallback bảo thủ.

Trong tác vụ Staff, `MeterCategoryValidation` chỉ kiểm ảnh so với kind đã lấy từ
Meter: mismatch đủ confidence hoặc multiple meters → không phát reading;
unknown/low confidence/unavailable → giữ kind server và warning. Không cập nhật
ownership, loại meter, precision, trạng thái task hoặc quyền theo visual prediction.

Adapter phát hiện **thân**, chưa định vị display mới. Display detector nước cơ
vẫn chỉ hỗ trợ nước cơ. Điện cơ/điện tử/nước điện tử giữ PP/manual fallback;
digital register chưa verified phải có warning. Không dùng body box/detection
mAP làm chứng cứ chọn đúng billing display. Cần model display và dữ liệu/GT
register độc lập trước khi thay đổi recognizer đang chạy.

## Offline training và rollback

Workflow pinned trong [TRAINING](../datasets/meter/TRAINING.md); source ảnh,
checkpoint, crop, environment nằm ngoài Git. Nghiên cứu LCD mới dùng thêm preview
phi thương mại, train206/val2/test4, có quarantine và source-group isolation.
[Training report](OCR_MODEL_TRAINING_REPORT.md) ghi model bị loại và hashes.

Synthetic Constant ONNX graph trong test chỉ kiểm loader/ORT/mapping/concurrency;
không phải trained weights, accuracy hay bằng chứng nhận diện bốn loại. Ba lớp
research checkpoint bị từ chối thật. Model LCD train thật chạy native/ORT/.NET
parity riêng; chưa đạt quality gate nên không được nối vào runtime.

Rollback: tắt `VisualClassifier:Enabled` và restart process; disabled không đọc
model hoặc đổi text/scene/recognizer hiện hành. Không bật Production trong task
này. Gate còn thiếu: đủ dữ liệu bốn lớp train/val/test, independent representative
evaluation, calibration/open-set/multi-meter và display/register/precision accuracy,
cùng device E2E. Xem [báo cáo cuối](OCR_FINAL_COMPLETION_REPORT.md).
