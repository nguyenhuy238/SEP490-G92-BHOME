# Dataset bốn loại — 07/11/2026

**Không có independent numeric GT mới đã được nhận.** Đã xây gói review mù327 ảnh
và công cụ đối chiếu hai reviewer; chưa có người gửi review thật. Không đổi nhãn
Kaggle nháp thành ground truth. [Counts máy đọc được](ocr-four-dataset-counts.json).

## View A: whole-meter classification

Giữ manifest62 development cũ để so sánh pretrained model, không retrain YOLO trên
tập yếu này. Body/category do agent review, chưa có human acceptance độc lập.

| Category | Train cũ | Validation cũ | Test cũ |
| --- | ---: | ---: | ---: |
| electricity_mechanical |15|3|3|
| electricity_digital |7|3|3|
| water_mechanical |10|3|2|
| water_digital |3|1|1|
| not_meter |1|1|6|

Ba train water_digital chỉ là preview200×150 cùng một nguồn; không coi là ba thiết
bị độc lập. Một test LCD trống không thay được nhiều water LCD readable positives.
327 source images Kaggle mới chưa có body/category annotations được hai người
xác minh; trạng thái category/whole-body completeness giữ unreviewed. Không tự
gán nhãn bốn loại từ tên file hoặc OCR. Split cũ không đổi lượt này.

## View B: reading-region localization

Kaggle meter-data v1:327 source images, MIT theo publisher metadata; source SHA và
label SHA đã kiểm lại. Dùng300 ảnh có reading annotation hợp lệ để fine-tune
detector reading/serial.27 ảnh còn lại giữ quarantine vì missing reading hoặc có
dòng nhãn vượt biên/không hợp lệ, không biến thành negative rỗng. Toàn nguồn ở
TRAIN vì physical identity chưa rõ; không dùng random publisher train/val split.

Validation2 và historical test4 là source-separated Commons full images với crop
annotations đã dùng nghiên cứu LCD trước. Đây là **numeric-region proxy boxes**,
khác nhau về độ chặt với publisher screen boxes, không phải GT billing register.
Blank LCD vẫn là vùng hiển thị để đo localization; không phải positive reading.
Không có complete serial GT ở validation/test nên không báo serial precision/mAP.
Hash và pHash cross-split được kiểm trước augmentation. Model chỉ nghiên cứu, không
đủ dữ liệu để xác lập accuracy95% hoặc bật runtime.

## View C: recognition

CRNN train trên163 crop Mendeley CC0 có publisher digit labels; toàn source giữ
TRAIN. Validation:1 readable+1 blank; test:3 readable+1 blank, labels agent-reviewed
đóng băng trước lượt này. Precision/register eligibility còn thiếu nên chỉ so chuỗi
digit.12 nháp Kaggle vẫn bị loại khỏi train/acceptance; không sửa theo output mới.
Không đưa historical water validation/test vào train của bất kỳ model nào.

## Review và nguồn nước LCD

[Hướng dẫn review độc lập](../datasets/meter/INDEPENDENT_REVIEW.md): ảnh opaque ID,
không hiện model suggestions; vẽ body/window, ghi uncertain positions, unit,
register, precision và physical group. Merge kiểm bytes ảnh, reviewers khác nhau,
đồng thuận nhãn và geometry. A/B không mang theo digits chưa thống nhất. C chưa có
precision chỉ hỗ trợ digit-string review, không billing GT. Output vẫn pending
project review: công cụ không thể chứng minh hai ID là hai người độc lập.

Commons API tìm thêm water LCD assets nhưng download trả429; một lần retry sau
backoff vẫn429, Retry-After10, đã dừng. Không thay host hoặc vượt hạn chế.
[MR-AMR v2](https://www.kaggle.com/datasets/ayush02102001/watermeter-data-recognition)
có mô tả publisher CC BY-NC3.0; đây là binarized digit crops và augmented challenge,
không phải corpus full-meter LCD đa thiết bị; không tải hoặc nhập làm four-class
data. Giấy phép bài báo không tự thay giấy phép dataset. Digital-water gap vẫn mở.

Ảnh, crop, model weights và review package chỉ nằm trongignored `.tools`; không
commit private data/CCCD/secrets hoặc gửi ảnh Tenant tới dịch vụ AI. Splits phải
được chốt theo source/site/physical meter trước augmentation, không theo số lượng
crop. Các số trong bảng là development counts, không số acceptance đã xác minh.
