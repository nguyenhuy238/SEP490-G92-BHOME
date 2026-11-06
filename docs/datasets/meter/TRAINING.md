# Huấn luyện offline có kiểm chứng

Revision tiếp nối sau83317cb: [four-class-development-v2.json](four-class-development-v2.json),
image root là repository (`.`). Provision ảnh Commons cũ vào `.tools/master-dataset/commons`,
catalog mở rộng vào `.tools/ocr-next-public-images-expanded`, ba public examples vào
`.tools/ocr-next-publisher-previews` bằng `download_meter_previews.py` và catalog
`water-lcd-public-previews.json`. Không dùng `--allow-partial-development` cho revision này.

Negative reading holdout riêng: [independent-reading-controls](independent-reading-controls.json),
8 ảnh/17 profile observations, author/hash/pHash không trùng body train/val hiện tại.
Không có positive GT để tính exact accuracy; chưa biết toàn bộ pretraining của
provider. Chuẩn bị trước khi chấm bằng:

```powershell
& $py tools/BHome.OcrSmoke/model_tools/prepare_meter_challenges.py docs/datasets/meter/independent-reading-controls.json .tools/ocr-next-public-images-expanded . .tools/ocr-next-reading-controls
```

Không overwrite output frozen. Blank LCD giữ đúng category water digital với
`visibility=blank`, `digitCount=0`, `digits=null`, `decimalPlaces=null`, register
unknown; không gán số0. [Annotation đã kiểm](blank-lcd-annotation.json) dùng window
rectangle thô, không phải GT để công bố display IoU/recall. Validator vẫn giữ
quy tắc exact digits/unreadable cho ảnh có chỉ số; chỉ trạng thái blank/status
mới cho phép không có digit positions. Tất cả ảnh nguồn/crop ở `.tools`, ngoài Git.

Đọc [nghiên cứu nguồn](../../development/OCR_DATASET_RESEARCH.md) trước khi tải.
Ảnh, weights, caches, runs nằm trong `.tools/`, không đưa vào Git. Catalog ghi
license/author/credit từng ảnh. Nhãn Commons mới phát hành CC BY-SA 4.0; giữ
giấy phép ảnh gốc. Code/model Ultralytics dùng AGPL-3.0, không suy từ giấy phép
dataset sang quyền phân phối model/sản phẩm thương mại.

Môi trường thực tế: Python 3.11.9; các dependency trong
`tools/BHome.OcrSmoke/model_tools/requirements-export.txt`; riêng training sử dụng
torch 2.6.0+cu118 + torchvision 0.21.0+cu118, cài `--no-deps --target
.tools/yolo-cuda-packages` từ `https://download.pytorch.org/whl/cu118`.
CLI `--cuda-packages` ưu tiên overlay trong process; không sửa môi trường OCR CPU.
GPU cần driver tương thích; có thể chọn `--device cpu` và bỏ overlay.

## Dataset thân công tơ

```powershell
$py = '.tools/yolo-python/python.exe'
& $py tools/BHome.OcrSmoke/model_tools/download_public_meter_assets.py docs/datasets/meter/public-sources.json .tools/master-dataset/commons
node scripts/Validate-MeterDataset.cjs docs/datasets/meter/development-body-annotations.json .tools/master-dataset/commons
& $py tools/BHome.OcrSmoke/model_tools/prepare_meter_training.py docs/datasets/meter/development-body-annotations.json .tools/master-dataset/commons .tools/reproduced-body-dataset --allow-partial-development
```

Mặc định preparer từ chối thiếu train/val/test của bất kỳ lớp nào. Flag partial
chỉ phục vụ thử nghiệm, không chứng minh đủ bốn lớp. Tập hiện tại có 21 điện cơ,
13 điện tử, 15 nước cơ, 1 nước điện tử và 8 negative. Một số ảnh khó/bị cắt thân
vẫn được giữ. Một ảnh nước điện tử chỉ ở test/open-set; không tạo nhãn giả cho
train. Chỉ ba lớp có supervised train/val/test. Không dùng ảnh nhiều công tơ
khi chưa có đủ box từng đối tượng; kiểm thử nhiều công tơ vẫn là gate còn thiếu.

`sourceGroup/siteGroup/meterGroup/captureGroup` gom toàn bộ tác giả/uploader
Commons vào cùng split theo cách bảo thủ; không khẳng định đây là site/meter
identity thực. Alias Petr.adamek đã gom; tác giả không rõ gom chung. Không lấy
hai góc chụp Krishna làm hai meter độc lập. Exact hashes và DCT pHash 63 bit,
Hamming ≤6 kiểm tra trước augmentation; pHash không chứng minh đã phát hiện mọi
crop/rotation/near-duplicate. Nhãn do agent xem ảnh và xem lại overlay; chưa có
independent human annotation review. Quality flags chỉ là ghi nhận thô.

## Dataset chữ số LCD

Tiếp nối 06/11, preview LCD có giấy phép CC-BY-NC-4.0 chỉ phục vụ nghiên cứu
phi thương mại offline, không triển khai/phân phối model thương mại. Nguồn,
revision, exclusions và leakage audit ở [metadata](lcd-preview-preparation.json).
Không dùng tên dataset làm nhãn bốn loại. Toàn nguồn mới giữ trong TRAIN:

```powershell
& $py tools/BHome.OcrSmoke/model_tools/download_lcd_preview.py .tools/ocr-20261106-lcd-preview
& $py tools/BHome.OcrSmoke/model_tools/prepare_lcd_digits.py .tools/master-dataset docs/datasets/meter/public-sources.json .tools/master-dataset/commons docs/datasets/meter/lcd-evaluation.json .tools/reproduced-lcd-preview --crop-training-rows --preview .tools/ocr-20261106-lcd-preview
```

Preparer giữ nguyên guard output rỗng; dùng thư mục mới cho mỗi revision. Kiểm
checksum của 151 asset, kích thước XML/ảnh, display containment, digit row và
serial namespace. Quarantine nhãn không nhất quán thay vì sửa/cắt box. Ba ảnh
blank/segment-test đã duyệt bị loại riêng. Kết quả thực thi: 163+43 train,
2 val, 4 development test; pHash trên ảnh nguồn trước crop. Val/test giữ nguyên
manifest cũ, không gọi chúng là independent acceptance mới. Fine-tune dùng
script/config/seed/base-weight guard hiện có; Python không chạy trong backend.

Tải đúng hai asset của Mendeley v1 (không dùng URL Labelbox trong COCO):

```powershell
Invoke-WebRequest 'https://data.mendeley.com/public-files/datasets/fnn44p4mj8/files/b5130583-7852-4995-8421-36bf7b2857b7/file_downloaded' -OutFile '.tools/master-dataset/RAW IMAGES.zip'
Invoke-WebRequest 'https://data.mendeley.com/public-files/datasets/fnn44p4mj8/files/cb924bf8-101d-41f1-9206-4958a7f867ec/file_downloaded' -OutFile '.tools/master-dataset/export-coco-2019-06-11T14_40_00.348423.json'
& $py tools/BHome.OcrSmoke/model_tools/prepare_lcd_digits.py .tools/master-dataset docs/datasets/meter/public-sources.json .tools/master-dataset/commons docs/datasets/meter/lcd-evaluation.json .tools/reproduced-lcd-dataset --crop-training-rows
```

Preparer kiểm tra SHA256 ZIP/COCO trước khi đọc; không extract đường dẫn ZIP.
169 ảnh, 168 có annotation, loại 5 exact duplicates → 163 train; ảnh 97 không
có nhãn bị loại. Toàn nguồn Mendeley ở train do không xác minh được physical
identity/session. Val dùng 1 crop đọc được +1 LCD trống từ Commons; test có 3
crop có chữ số +1 màn hình không hiển thị reading. Tập val quá nhỏ để xác lập
generalization. Nhãn số không chứa thông tin decimal/billing eligibility.
Không gọi crop-level digit accuracy là full-frame end-to-end reading accuracy.

## Fine-tune và kiểm tra export

```powershell
Invoke-WebRequest 'https://github.com/ultralytics/assets/releases/download/v8.3.0/yolov8n.pt' -OutFile .tools/master-dataset/yolov8n.pt
& $py tools/BHome.OcrSmoke/model_tools/train_meter_yolo.py .tools/reproduced-body-dataset .tools/master-dataset/yolov8n.pt .tools/reproduced-body-run --cuda-packages .tools/yolo-cuda-packages --allow-partial-development
& $py tools/BHome.OcrSmoke/model_tools/evaluate_finetuned_yolo.py .tools/reproduced-body-run .tools/reproduced-body-dataset .tools/reproduced-body-export
& $py tools/BHome.OcrSmoke/model_tools/train_meter_yolo.py .tools/reproduced-lcd-dataset .tools/master-dataset/yolov8n.pt .tools/reproduced-lcd-run --cuda-packages .tools/yolo-cuda-packages --name lcd-digits
& $py tools/BHome.OcrSmoke/model_tools/evaluate_finetuned_yolo.py .tools/reproduced-lcd-run .tools/reproduced-lcd-dataset .tools/reproduced-lcd-export --name lcd-digits
```

Trainer khóa hash pretrained, class order, ảnh/labels/YAML; từ chối ảnh/nhãn
thêm ngoài manifest và xóa cache labels cũ để Ultralytics tạo lại. Không ghi đè
dataset/run đã tồn tại. Seed42, deterministic requested, AdamW, AMP off,
workers0, augmentation train-only, validation early stopping; không dùng test
để chọn checkpoint/threshold. GPU nondeterminism và version/hardware vẫn có
thể làm checkpoint khác hash; phải đánh giá artifact mới.

Export FP32 ONNX opset17, static416, no embedded NMS; đối chiếu tensor native /
ORT và class order. Body: `[1,7,3549]` cho ba lớp; LCD `[1,14,3549]` cho mười chữ
số. Cả hai RGB/255, letterbox114; cxcywh + scores, không objectness. Class-aware
NMS .45 giữ các class conflict để review. Không bỏ digit trùng/thiếu để ép tạo
reading. Threshold grid dùng val; test được báo cả sai và fallback.

Kết quả có trong `training-provenance.json`, `body|lcd-digits/results.csv`,
`audit.json`, `evaluation.json`; xem [báo cáo huấn luyện](../../development/OCR_MODEL_TRAINING_REPORT.md).
Các script không tự register DI, sửa appsettings, secrets, bật Production hay
thay thế weights đang hoạt động. Model thử nghiệm cần vượt gate riêng trước
khi được tích hợp luồng OCR; parity đúng không chứng minh reading đúng.

## Kiểm tra công cụ

```powershell
node --test tests/scripts/MeterDataset.test.cjs
& $py -m unittest discover -s tests/scripts -p test_meter_model_tools.py -v
```
