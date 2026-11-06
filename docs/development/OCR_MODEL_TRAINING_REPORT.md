# Báo cáo huấn luyện model OCR — 05/11/2026

**Đã huấn luyện và export thật; chưa có model mới đủ điều kiện bật trong ứng dụng.**
Ba cấu hình thử nghiệm, sáu lượt train gồm các lượt chạy lại để xác minh guard
dữ liệu. Không tạo model bốn lớp từ những lớp không có dữ liệu. Nước điện tử
chỉ có một ảnh đã duyệt, được giữ ở open-set test.

## Dữ liệu, môi trường và cấu hình

[Nghiên cứu nguồn](OCR_DATASET_RESEARCH.md), [workflow tái lập](../datasets/meter/TRAINING.md),
[bằng chứng JSON](ocr-master-results.json) lưu provenance/hash/metrics chi tiết.
Checkpoint/ONNX/ảnh/raw log nằm trong `.tools/`, không đưa vào Git.

- Base: Ultralytics YOLOv8n COCO từ [assets v8.3.0](https://github.com/ultralytics/assets/releases/tag/v8.3.0).
  SHA256 `f59b3d833e2ff32e194b5bb8e08d211dc7c5bdf144b90d2c8412c47ccfc83b36`.
  Chọn nano đã tương thích môi trường hiện có, không đổi framework production.
- GPU: RTX 3070 Laptop 8 GB, driver 546.30; CPU Ryzen 7 5800H, RAM khoảng24 GB.
  Python3.11.9, torch2.6.0+cu118, torchvision0.21.0+cu118, ultralytics8.3.224,
  numpy1.26.4, onnx1.17.0, ORT1.20.1. CUDA overlay riêng; môi trường OCR CPU giữ nguyên.
- 416×416, batch8, AdamW lr0=.001, seed42, deterministic requested, AMP off,
  workers0, tối đa100 epoch, early stopping patience20. Mosaic.3, degrees15,
  translate.1, scale.25, perspective.0003; không flip chữ số.
- Validation chọn checkpoint theo fitness của thư viện; grid confidence
  `.25,.5,.7,.8,.9,.95,.99` chạy riêng trên validation để kiểm tra chính sách
  proposal. Test không dùng làm supervised train hoặc để chọn threshold.
- Các lần đánh giá lại cùng development holdout không phải nghiệm thu độc lập
  mới. Đây là nghiên cứu trên ảnh công khai, không chứng minh khả năng áp dụng
  cho công tơ nhà trọ Việt Nam.
- [Điều khoản Ultralytics](https://www.ultralytics.com/license) áp dụng riêng
  với code/weights; giấy phép ảnh không thay thế nghĩa vụ này. Không triển khai
  thương mại hoặc tự đổi giấy phép toàn bộ BHOME trong công việc này.

## Ba cấu hình đã chạy

| Candidate             | Train / val / test                                                                       | Epoch thực tế / tốt nhất | Thời gian lượt cuối | Quyết định                                                  |
| --------------------- | ---------------------------------------------------------------------------------------- | ------------------------ | ------------------- | ----------------------------------------------------------- |
| Body detector ba lớp  | 33 train gồm1 negative; 10 val gồm1 negative; 14 test hỗ trợ +1 water digital open-set   | 43 /23                   | 48.875s             | Loại: sai loại trên val/test và thiếu lớp thứ tư            |
| LCD digits từ ảnh gốc | 163 train; val1 đọc được +1 LCD trống; test3 đọc được +1 màn hình không hiển thị reading | 31 /11                   | 160.688s            | Loại: không có exact sequence trên val                      |
| LCD digits từ hàng số | Cùng nguồn/split; crop hàng số chỉ trong train từ COCO digit boxes                       | 47 /27                   | 174.5s              | Loại khỏi runtime: còn hai false proposals trên4 test crops |

Mendeley:169 ảnh,168 có COCO, loại exact duplicates `150,51,65,15,7` và ảnh97
không có nhãn →163 train. Không random split nguồn này vì physical identity/session
chưa rõ. Commons tách toàn photographer/uploader group; pHash DCT63/Hamming≤6
trên ảnh nguồn trước crop/augmentation không tìm thấy cross-split candidate.
Đây không phải bằng chứng không còn mọi dạng leakage. Body labels được agent
xem ảnh và overlay; chưa có independent human annotation review.

Lượt body đầu và các lượt LCD hàng số đầu được chạy lại sau khi bổ sung guard
hash labels/YAML, coarse quality annotation và source pHash. Supervised boxes,
class/split không sửa để khớp dự đoán. Sáu lượt, thời gian/hash đều có trong
`trainingRuns` của JSON. CSV loss/metrics thực tế:

- [Body](ocr-model-body-training.csv).
- [LCD ảnh gốc](ocr-model-lcd-full-training.csv).
- [LCD hàng số](ocr-model-lcd-row-training.csv).

Raw log tương ứng `.tools/master-body-verified-training.log`,
`.tools/master-lcd-training.log`, `.tools/master-lcd-final-training.log`.
JSON lưu SHA256 raw logs và CSV; không commit log tạm hoặc environments.

## Detection và phân loại

Body validation mAP50=.8850, mAP50–95=.49954 trên9 objects/10 ảnh; test
mAP50=.38874, mAP50–95=.25019 trên8 supported objects/14 ảnh. Open-set water
digital nằm ngoài phép tính mAP nhưng vẫn được kiểm tra phân loại riêng.

Không có threshold trong grid vượt được chính sách validation không sai loại/
không false detection. Ngưỡng .99 bên dưới là phép đo tham chiếu bị loại,
**không phải threshold đã được phê duyệt**.

| Lớp test hỗ trợ        | TP / FP / FN ở .99                     | Precision / recall  | AP50 thư viện |
| ---------------------- | -------------------------------------- | ------------------- | ------------- |
| electricity_mechanical | 3 /6 /0                                | .3333 /1.0          | .9950         |
| electricity_digital    | 0 /0 /3                                | Không có dự đoán /0 | .11912        |
| water_mechanical       | 0 /0 /2                                | Không có dự đoán /0 | .05211        |
| water_digital          | Không có supervised head/dữ liệu train | Không được xác lập  | Không tính    |

Strict category output:3/9 ảnh công tơ đúng loại,5 sai loại,1 chưa xác định;
negative reject5/6,1 negative bị nhận nhầm. Confusion matrix đầy đủ và từng
threshold nằm trong JSON. mAP riêng không thay được phân loại/reading cuối luồng.
Baseline ứng dụng hiện tại trên cùng15 ảnh:0/9 phân loại đúng,0 gán sai,
15/15 chưa phân loại; không có GT reading đầy đủ để tính numeric accuracy.

## Recognition trên cùng bốn crop test

Chỉ đo chuỗi digit, giữ leading zeros, bỏ dấu phân cách khi so sánh. Không đo
decimal precision, tự phát hiện window hay billing-register eligibility.

| Phương án             | Exact /3 crop có nhãn số | False proposals /4 ảnh | Fallback /4 |
| --------------------- | ------------------------ | ---------------------- | ----------- |
| PP-OCR trực tiếp      | 0/3                      | 2                      | 2           |
| PP-OCR qua DBNet/page | 0/3                      | 1                      | 3           |
| YOLO LCD ảnh gốc      | 0/3                      | 1                      | 3           |
| YOLO LCD hàng số      | 2/3                      | 2                      | 0           |

Val hàng số tại.25 và.5:1 exact/1 readable,0 false/2 ảnh; chọn.25 theo quy tắc
đã ghi. Cỡ val này quá nhỏ. Test hàng số đọc đúng `004046`, `21594`, nhưng
trả `88888` cho màn hình chưa hiển thị reading và `00088058` thay vì `000880578`
ở water LCD. Không chữa GT, không thêm digit, không hạ guard runtime để lấy kết quả.
Register ở ảnh `21594` chưa được chứng minh phù hợp billing.

Probe điện cơ độc lập với training Stage2: crop Commons45290164, GT `131313`,
precision1 được chứng minh bằng trọng số in `1/10` trên mặt. Water Stage2 và
typed PP đều fallback (0/1 exact,0 false). Một mẫu không xác lập generalization;
không mở water recognizer cho điện cơ. Crop và lệnh ở `.tools/master-mechanical-probe`;
source hash, tọa độ crop, kết quả có trong JSON.

## ONNX và .NET

FP32, opset17, static batch1, no embedded NMS, input `[1,3,416,416]`.
RGB/255, bilinear, centered letterbox114, padding làm tròn thực tế. Output:

- Body `[1,7,3549]`: cxcywh +3 class scores, thứ tự electricity mechanical,
  electricity digital, water mechanical; không phải OBB, không có objectness.
- LCD `[1,14,3549]`: cxcywh +digits0..9, không objectness.
- Decode/NMS class-aware IoU.45 được đánh giá trong Python. Không có adapter
  category/NMS mới được register trong HTTP runtime.

Native PyTorch/ORT allclose rtol=.002, atol=.002: body10 ảnh, LCD-full6,
LCD-row6; max absolute delta lần lượt .001862/.001724/.000534.
`.NET --trained-yolo-parity` dùng letterbox của backend:22/22 lượt đối chiếu
qua, input/output delta=0 so với Python ORT. Checksum bị sửa bị từ chối với
exit2. Parity chỉ xác nhận phép tính; không chứng minh nhận dạng đúng.

| Artifact cuối | PT SHA256                                                          | ONNX SHA256                                                        |
| ------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Body          | `7b42fbb82a461d224c6978065cc0d86f6853dfe723ef5a2be3d5220ad06a73e4` | `b7fc13aa09262c46ced335f31d5726c8f8369b5f8e2c4ce7ed5994f4166278af` |
| LCD full      | `583d12735c743b61f101eb1134f7199cba159cf3a5cf042dc6127d8423315263` | `0634dde757a873d26900873784d3cd7651498cb962a1589006aad481a4c06963` |
| LCD rows      | `a234a35bfdf3dba4bd115dbf71531c3b37a444c99c197a8a77b84e1d324bdc46` | `89ee6d85878974aacd8ceb3b981671acf2993b4f80893483d2eb4e18eac2138b` |

Local export dirs: `.tools/master-body-verified-export`,
`.tools/master-lcd-full-final-export`, `.tools/master-lcd-final-export`.
CPU ORT2 threads p50/p95 forward-only khoảng29.64/41.62ms,25.23/31.42ms,
24.08/35.13ms; không gồm toàn pipeline, không phải production load benchmark.

Kết quả chưa đạt acceptance bốn loại hoặc ≥90% trên bộ ảnh đại diện. Các model
mới giữ ngoài ứng dụng; không thay thế PP/Stage1/Stage2 hiện hành.

## Lượt tiếp nối LCD ngày 06/11/2026

Đã chạy GPU thật trên RTX 3070 Laptop, cùng base YOLOv8n/hash, môi trường,
seed42 và config ở trên. Dataset: 206 train (163 Mendeley +43 LCD preview),
2 val, 4 test; source mới giữ toàn bộ train. Giấy phép preview CC-BY-NC-4.0
chỉ dùng nghiên cứu offline phi thương mại; không phân phối weights/ảnh.
Dataset audit SHA256 `28049194dd1a8641e53c6f12719903eab5ca19a70f96fd3c0fa3231931c33570`.

49 epoch thực tế, best fitness epoch29, early stopping patience20, thời gian
229.062s. [CSV](ocr-20261106-lcd-training.csv) và
[kết quả/provenance](ocr-20261106-lcd-results.json) được lưu trong Git.
Checkpoint/ONNX/log/crop ở `.tools/ocr-20261106-lcd-*`, không commit.

- PT SHA256: `0f686ac3f5d55b0f011fd792afe92efdcc3c46e848c4d60bd04dffd57fe109a2`.
- ONNX SHA256: `a4c655bf7b5bd78fdb7200c0a0a177542e1f4fcd9b2628d93f5d29a3618976fc`.
- FP32/opset17/input `[1,3,416,416]`, output `[1,14,3549]`, digit classes0..9.
- Validation chọn threshold.25: exact0/1 readable, false0/2, fallback2/2.
- Development test: exact2/3 readable, false2/4 inputs, fallback0/4; correct
  proposal/all inputs2/4, conditional correct proposals2/4. Không suy đây là
  kết quả billing vì chưa đánh giá precision/register/full-frame localization.
- Native PyTorch/ORT parity6/6; .NET preprocessing/tensor parity6/6.
- CPU forward-only p50=25.38ms, p95=27.62ms, max=27.76ms; không phải latency E2E.

**REJECTED**: không cải thiện false proposals so với candidate hàng số trước,
không qua validation và không phải four-class model. Không dùng test để tune
thêm hoặc bật runtime. Đây là cùng development holdout đã dùng ngày05/11,
không phải nghiệm thu độc lập mới. Chưa thể train detector bốn lớp vì nước
điện tử vẫn không có train/val; không tạo head giả để điền checklist.

## Four-class feasibility tiếp nối sau 83317cb

Đã có thêm ba public water LCD previews thực sự, cùng một publisher TRAIN;
ảnh water digital cũ được hạ từ development test thành validation, không train;
blank LCD Commons mới ở test. [Dataset revision](../datasets/meter/four-class-development-v2.json)
được freeze trước training:36 train /11 val /15 test,62 ảnh. Riêng nước LCD
chỉ3/1/1, partial-body/low resolution; đây là feasibility, không đủ đại diện.

Chạy YOLOv8n GPU thật cùng pinned base/hash/dependencies/config/seed42,29 epoch,
best fitness epoch9,35.969s. Early stopping patience20; không tăng epoch để
chạy lại theo test. Bốn supervised classes đúng thứ tự adapter, không có class
head giả hoặc nhãn từ prediction. [CSV](ocr-next-four-class-training.csv),
[provenance và kết quả đầy đủ](ocr-next-four-class-results.json).

- PT SHA256 `57366ec4d8f477c812635b9644ef1e58c805e8adb63adec454c3996d03904593`.
- ONNX SHA256 `c40c7f3bf9acb774528179e4b78749d1ed19c0872c63d46ee117e873a1b5ced7`.
- FP32/opset17, `[1,3,416,416]`→`[1,8,3549]`, metadata có4 class names thật.
- PyTorch/ORT10/10 và .NET tensor parity10/10 PASS. Adapter thật load/infer trên
  11 val +15 test; ngưỡng hiện hành candidate.25/classification.9/NMS.45 được
  giữ trước benchmark:0 classified,26 fallback,0 false classification. Không
  gọi reject-all là thành công hoặc dùng nó để suy accuracy100%.
- Grid selection Python trên validation không qua gate per-class/false positives.
  Confusion, per-class P/R/mAP, raw tensor parity và latency nằm trong JSON.
  Python argmax detection metrics và adapter multi-label rejection là hai phép
  đo riêng; mAP không phải confidence calibration hoặc end-to-end reading.

**REJECTED, KHÔNG ACTIVATE.** Four-class weights hiện đã tồn tại local và chạy
thật qua ONNX/.NET, nhưng chưa đủ chất lượng để dùng trong HTTP workflow.
Artifacts trong `.tools/ocr-next-four-class-*`, không commit weights/ảnh. Test
ba lớp cũ đã từng được xem là development history; không tái gọi chúng là final
acceptance độc lập. One new blank LCD source không thay được50 ảnh/lớp.

Chạy lại: preparer với manifest trên và image root repository; trainer hiện có
không dùng `--allow-partial-development`; export `--name body`; OcrSmoke
`--trained-yolo-parity <export> <report>` và
`--visual-category-benchmark <export> <dataset> <report>`. Benchmark mới luôn
gọi chính `YoloMeterCategoryClassifier`, không register model trong appsettings.
