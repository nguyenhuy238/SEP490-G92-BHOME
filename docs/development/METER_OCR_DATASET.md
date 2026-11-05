# Dữ liệu và model cho Meter OCR

Cập nhật05/11: stage2 digit model đã export/integrate thật;52 ảnh author test đã
được pin hash và đo riêng crop/runtime. Chưa có holdout BHOME đủ4 loại hay
accuracy90%. Xem [completion report](METER_OCR_COMPLETION_REPORT.md).

Baseline trước đợt pretrained ngày 04/11/2026: chưa có dataset đồng hồ được gán bounding box, checkpoint
detector/classifier hoặc pipeline training trong repository. Các fixture GDI+/OpenCV
hiện có chỉ kiểm thử bố cục chữ. Không dùng chúng làm bằng chứng detector hoạt động.

Cập nhật sau baseline: đã tích hợp detector pretrained thật; xem phần bổ sung cuối
tài liệu và [báo cáo triển khai](PRETRAINED_YOLO_METER_OCR_IMPLEMENTATION.md).

Luồng tự động một nút chụp nay có điểm tích hợp classifier sáu lớp và script kiểm
tra dữ liệu/sinh kế hoạch training/export offline (chưa train hoặc thêm weights).
Xem [AUTOMATIC_OCR_2026-11-04.md](AUTOMATIC_OCR_2026-11-04.md) cho mapping sáu lớp,
quy tắc phân biệt CCCD bằng chữ, kiểm chứng thực tế và cách chuẩn bị dữ liệu.

## Chọn model và giấy phép

- Giữ recognizer PP-OCR đang pin; đo riêng trên crop đúng trước khi quyết định fine-tune.
- Đánh giá detector nhẹ chạy CPU trong .NET/ONNX. YOLO là một ứng viên, chưa được chọn
  làm provider mới. Danh sách lớp của [COCO](https://docs.ultralytics.com/datasets/detect/coco/)
  không có lớp đồng hồ điện/nước tương ứng; weights COCO không phải detector đồng hồ.
- [YOLO11](https://docs.ultralytics.com/models/yolo11/) có hỗ trợ fine-tune/export ONNX.
  Kiểm tra [giấy phép Ultralytics](https://www.ultralytics.com/license) và quyền sử dụng
  từng dataset/weights trước khi thêm package hoặc weights. Chưa thêm phụ thuộc này.
- Model card weights OCR hiện có tự khai Apache-2.0; bản đã pin nằm tại
  `.tools/ocr-models/README.md`, provisioning trong `scripts/Get-OcrModels.ps1`.
  Không suy diễn giấy phép đó áp dụng cho detector hay dữ liệu thu thập mới.

## Thu thập và gán nhãn

Thu ảnh được phép sử dụng, tránh người, tên Tenant, giấy tờ, màn hình cá nhân và dữ
liệu định danh. Giữ ảnh nội bộ; không tự đưa dữ liệu lên dịch vụ AI/gán nhãn bên ngoài.
Ảnh thật phải có điện/nước, cơ/điện tử, nhiều hãng/model, khoảng cách/độ phân giải,
tường/ống/dây, lệch tâm, nghiêng, phản quang, mờ, che khuất, chuyển tiếp bánh số,
hai đồng hồ, không có đồng hồ và LCD có nhiều register/trang đo.

Hai tầng gán nhãn đơn giản:

| Tầng                      | Class ID | Nhãn                   |
| ------------------------- | -------- | ---------------------- |
| Meter                     | 0        | mechanical_electricity |
| Meter                     | 1        | digital_electricity    |
| Meter                     | 2        | mechanical_water       |
| Meter                     | 3        | digital_water          |
| Display (trên crop Meter) | 0        | reading_display        |

Gán **tất cả** đồng hồ và vùng hiển thị nhìn thấy. Không xóa vùng phụ để biến ảnh
mơ hồ thành ảnh một vùng. Không gán serial, điện áp, tần số, hằng số xung hoặc lưu
lượng m³/h thành tổng chỉ số. Đánh dấu riêng `billingRegisterVerified`, trang/register,
đơn vị, occlusion, glare, wheel-transition và trường hợp không thể đọc chắc chắn.
Không đoán chữ số bị che/mờ. Nhãn recognition là chuỗi chính xác giữ số 0 đầu và
dấu thập phân; ghi precision từ cấu hình thiết bị, không suy ra chỉ từ màu đỏ.

```text
meter-dataset/
  provenance.json                 # quyền sử dụng, nguồn, revision, SHA256
  groups.jsonl                    # opaque physicalMeterGroup, captureSession, split
  meter/images/{train,val,test}/
  meter/labels/{train,val,test}/   # class cx cy width height, chuẩn hóa 0..1
  display/images/{train,val,test}/ # crop cùng nhóm/split với ảnh gốc
  display/labels/{train,val,test}/
  readings.jsonl                  # chuỗi chỉ số, đơn vị, register, cờ chất lượng
  held-out/manifest.json          # chỉ số/fallback theo schema OcrEvaluation
```

Ảnh negative dùng nhãn detector rỗng; không đồng nhất mọi ảnh không đọc được với
"không có đồng hồ". Phân loại/recall chỉ tính trên những nhãn có ground truth phù hợp.

Chia tập theo **đồng hồ vật lý và phiên chụp**, trước augmentation/crop. Kiểm tra
SHA256 cho bản sao chính xác và perceptual similarity để rà ảnh gần trùng; không để
cùng thiết bị/burst/ảnh đã xoay hoặc nén xuất hiện ở train và test. Tách một nhóm
hãng/model chưa thấy để đo khả năng tổng quát. Chốt split và test labels trước train;
không đổi expected theo kết quả model. NFR mục tiêu accuracy cần ít nhất 50 ảnh thật
được phép sử dụng; fixture tổng hợp không thay thế tập này.

## Tích hợp và đánh giá tái lập

1. Chốt giấy phép, model/version, dataset revision/splits và môi trường training;
   lưu config, seed, package lock, hardware và checkpoint SHA256. Chưa thực hiện training.
2. Fine-tune detector Meter bốn lớp và detector Display một lớp nếu đánh giá baseline
   chứng minh cần; ưu tiên metadata thay vì thêm classifier thứ ba.
3. Trước OCR, adapter phải trả tất cả candidate sau NMS, confidence gốc, category
   confidence riêng, và quy đổi box về ảnh `ImagePreprocessor` cung cấp. Box display
   cũng dùng hệ tọa độ ảnh đó, phải nằm trong box Meter. Adapter cần thread-safe, dùng
   session sống dài, không giữ ảnh sau inference, tôn trọng CancellationToken/deadline.
4. Export ONNX bằng toolchain đã pin. Đối chiếu output native/ONNX trên cùng ảnh,
   kiểm tra normalization, letterbox/padding, layout/tensor, class order, NMS và box
   transform; đo sai khác số và quyết định ngưỡng chấp nhận trước khi bật adapter.
5. Implement `IMeterSceneDetector`, đăng ký singleton trong DI sau khi đạt điều kiện
   triển khai. `Ocr:MeterDetectionMinConfidence` mặc định 0.8 chỉ là ngưỡng kỹ thuật
   ban đầu, chưa được hiệu chuẩn thành accuracy. Không có đăng ký detector mặc định.
6. Cùng tập test đóng băng phải chạy cả baseline và candidate. Đo Meter recall,
   category accuracy, Display recall (ghi rõ ngưỡng IoU đã chọn), exact reading accuracy
   trên ảnh dương, tỷ lệ proposal sai trên toàn proposal, tỷ lệ fallback, p50/p95/max
   và số ca proposal/fallback <=10 giây. Báo denominator và confidence interval khi có
   đủ mẫu. Không gọi proposal-only accuracy là E2E Staff-confirmation accuracy.
7. Chạy lại HTTP role/Location/Task/evidence tests và confirmation/billing regression.
   Đo workload đánh giá thực tế và E2E thiết bị trước nghiệm thu NFR 10 giây.

`tools/BHome.OcrSmoke` đã hỗ trợ manifest `dataset: "meter-evaluation"` cho ảnh đồng
hồ thật nội bộ (không cho profile identity trong mode này). Đường dẫn ảnh phải nằm
dưới thư mục manifest. Có thể dùng baseline executable đã lưu riêng và candidate
để chạy cùng manifest; report không ghi raw text/chỉ số/đường dẫn ảnh.

**Chưa thực hiện:** thu/gán nhãn dataset thật, training/fine-tune, kiểm chứng model
detector/classifier, so sánh native/ONNX hoặc đo recall/classification accuracy. Chưa
có căn cứ nhận diện đúng phòng/serial từ ảnh hoặc xác định register tính tiền tự động.
## Bổ sung đánh giá pretrained 04/11/2026

Đã dùng10 ảnh test công khai của tác giả model analog-water, lưu riêng trong
`.tools/meter-detection-evaluation`, không đưa vào dữ liệu BHOME/holdout độc lập.
Ba ảnh chứa digit `u` nên chỉ7 ảnh có nhãn chuỗi đầy đủ. Localization body/window
10/10 IoU≥.5, exact PP reading sau crop1/7; chưa đủ≥50 ảnh hoặc mục tiêu90%.
Không train/fine-tune. Hash, nguồn, bias và kết quả trong
[báo cáo pretrained](PRETRAINED_YOLO_METER_OCR_IMPLEMENTATION.md).
