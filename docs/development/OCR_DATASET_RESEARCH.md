# Nghiên cứu dữ liệu OCR công tơ — 05/11/2026

## Phạm vi và truy vết

Yêu cầu hiện tại cho phép nghiên cứu/tải dữ liệu công khai có quyền sử dụng,
fine-tune và tạo commit local trên `member/QHuy`; không push/merge/deploy.
Liên quan BF-05 / UC-20 / GBR-07: OCR chỉ đề xuất, Staff xác nhận; UC-21 /
GBR-09: không thay đổi billing. Baseline tại `efab534` được giữ để so sánh.
Không thay đổi quyền truy cập, CCCD hay mô hình dữ liệu nghiệp vụ.

Luồng thực hiện: catalog có giấy phép → kiểm tra ảnh/nhãn → nhóm trước split →
fine-tune offline → đánh giá riêng detection/recognition → export/parity → chỉ
tích hợp inference khi có bằng chứng. Kiểm tra gồm leakage, corruption,
nhãn thiếu, ảnh không phải công tơ, nhiều công tơ và nhận nhầm loại.

## Các nguồn đã kiểm tra

| Nguồn                                                                                                                                                                                                                                                                    | Giấy phép                                                                                | Loại / số lượng xác minh                                       | Nhãn                                                    | Tải / quyết định                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Mendeley fnn44p4mj8 v1](https://data.mendeley.com/datasets/fnn44p4mj8/1), KARTHICK K và Kavaskar S, DOI 10.17632/fnn44p4mj8.1                                                                                                                                           | CC0 1.0; public API cũng xác nhận                                                        | 169 ảnh điện tử, 168 ảnh trong COCO, 977 chữ số                | COCO từng chữ số; không có box toàn thân/nhãn precision | Đã tải ZIP và JSON, SHA256 khớp nhà cung cấp; dùng cho nghiên cứu LCD. Không coi union chữ số là box thân công tơ                                              |
| [Commons electricity kWh](<https://commons.wikimedia.org/wiki/Category:Electricity_meters_(kWh)>), [LCD](https://commons.wikimedia.org/wiki/Category:Electricity_meters_with_liquid_crystal_displays), [water](https://commons.wikimedia.org/wiki/Category:Water_meters) | Theo từng ảnh: CC0, public domain, CC BY hoặc CC BY-SA 2/3/4; lọc whitelist              | Catalog 176 asset đủ điều kiện ảnh; tải thành công 152, 24 lỗi | Chưa có supervised label; phải xem ảnh và annotate      | Chấp nhận quyền dùng các asset trong catalog, chưa tự động chấp nhận nhãn. Lưu author, credit, license URL; nhãn/biến thể CC BY-SA phải giữ nghĩa vụ tương ứng |
| [UFPR-AMR](https://github.com/raysonlaroca/ufpr-amr-dataset), [Copel-AMR](https://github.com/raysonlaroca/copel-amr-dataset)                                                                                                                                             | Academic/noncommercial, yêu cầu license agreement và liên hệ tác giả                     | 2,000 / 12,500 theo tác giả, chưa tải                          | Counter, digits, reading                                | Chưa được cấp quyền truy cập; không gửi email/thay mặt người dùng ký thỏa thuận; loại khỏi training hiện tại                                                   |
| [Roboflow Nad1976](https://universe.roboflow.com/nad1976/electricity-meter-reading)                                                                                                                                                                                      | Trang công bố CC BY 4.0                                                                  | 115 ảnh theo trang                                             | 37 ký tự; không phải bốn loại công tơ                   | Chưa export/download; không có API credential, không vượt cơ chế đăng nhập                                                                                     |
| [Roboflow Meters LCD](https://universe.roboflow.com/meters-lcd/water-meter-reading-ipqvl)                                                                                                                                                                                | Trang công bố CC BY 4.0                                                                  | 1,573 theo trang                                               | Digits/counter/liters                                   | Chưa tải. Tên workspace LCD không chứng minh ảnh water digital; không chuyển nhãn dựa vào tên                                                                  |
| [Kaggle/Toloka water](https://www.kaggle.com/datasets/tapakah68/yandextoloka-water-meters-dataset), mirror [UniDataPro](https://huggingface.co/datasets/UniDataPro/water-meters)                                                                                         | Mirror ghi CC BY-NC-ND 4.0                                                               | Chưa xác minh đủ asset của nguồn gốc                           | Water segmentation                                      | Không dùng train/biến đổi khi quyền derivative chưa rõ; không suy giấy phép bài báo sang dataset                                                               |
| [UtilityMeters mixed](https://huggingface.co/datasets/utilitimetersai/Annotated-Mechanical-And-LCD-Utility-Meter-Dials-Dataset)                                                                                                                                          | Card CC BY-NC 4.0 cho demo, bản đầy đủ thương mại                                        | API thấy danh sách demo, yêu cầu authentication khi đọc file   | Dial/digit/serial, chưa kiểm tra ảnh                    | Gated; không tải/vượt kiểm soát, không mua dữ liệu                                                                                                             |
| [goodcoffee/Meter_Reading](https://huggingface.co/datasets/goodcoffee/Meter_Reading) `adf4e72b8d12ffc357ad67eb8d92e587135d726e`                                                                                                                                          | Apache-2.0 trên card                                                                     | Kiểm tra sample + schema                                       | Needle/face/casing cho đồng hồ kim đo công nghiệp       | Không phù hợp bốn category billing; không gán thành water/electricity                                                                                          |
| [pianistprogrammer/meter2800](https://huggingface.co/datasets/pianistprogrammer/meter2800) `5e05c06acc1a169814bbae595477f6a2b998f25b`                                                                                                                                    | MIT                                                                                      | Audio rhythm/music                                             | Nhịp nhạc                                               | Loại vì không phải ảnh công tơ                                                                                                                                 |
| [Mbarira water](https://github.com/Ntarekp/Mbarira-Watermeter-model)                                                                                                                                                                                                     | GitHub API không tìm thấy repository license; model card MIT không tự động cấp quyền ảnh | Các tập author từng dùng trong baseline BHOME                  | OBB/digits                                              | Giữ làm so sánh lịch sử; không đưa ảnh vào fine-tune mới khi quyền ảnh chưa được xác minh                                                                      |

Catalog và attribution từng asset: [public-sources.json](../datasets/meter/public-sources.json).
Tải lại bằng `download_public_meter_assets.py`; ảnh/receipts ở `.tools/master-dataset/commons`,
ngoài Git. Không lấy thumbnail từ công cụ tìm kiếm. Commons là derivative do
chính nguồn cung cấp dưới giấy phép ảnh; các lỗi HTTP được ghi và bỏ qua,
không tìm cách vượt hạn chế. Catalog không phải chứng nhận quyền đối với asset
bên ngoài nó hoặc nhãn công tơ.

## Hash và tính tái lập

- Mendeley COCO `export-coco-2019-06-11T14_40_00.348423.json`:
  `5b23d2380d433c218f2f26d800639c54dff51d74cb15ea9c842b0a552db3200b`.
- Mendeley `RAW IMAGES.zip` (104,176,444 bytes):
  `d4dadbd2e51a8e85809a035afa390e8312d6c9206ae6bcd98e094fa61f623529`.
- Commons: original SHA1 từ API + SHA256 derivative tải thành công trong catalog.
  URL/revision nội dung ảnh được khóa bằng hash; metadata lấy ngày 05/11/2026,
  không giả định URL/metadata sẽ bất biến.

## Giới hạn dữ liệu

200 ảnh/lớp và 50 ảnh test/lớp là mục tiêu, chưa đạt. Không tăng số đếm bằng
augmentation/duplicate. Ảnh cơ khí có hàng số vẫn là mechanical, dù nguồn gọi
chung là digital reading. Ảnh thân bị cắt, nhiều công tơ, đồng hồ nhiệt/gas,
chỉ số lưu lượng hay register chưa xác định phải được đánh dấu/loại theo mục đích.
Không tự suy precision từ màu đỏ. Nhãn số chưa rõ phải để thiếu, không điền
bằng dự đoán model. Tập author water đã dùng nhiều lần không trở thành test độc
lập mới. Kết quả nghiên cứu này chưa chứng minh accuracy bốn lớp hoặc ≥90%.

## Tài nguyên huấn luyện xác minh

RTX 3070 Laptop 8 GB, khoảng 6.7 GB VRAM trống lúc kiểm tra; RAM khoảng 24 GB;
ổ C còn khoảng 230 GB. Python 3.11.9. Môi trường export hiện có torch 2.6.0 CPU.
Đã cài riêng `.tools/yolo-cuda-packages`: torch 2.6.0+cu118 và torchvision
0.21.0+cu118 từ index chính thức, không thay package runtime. CUDA tensor/matmul
đã chạy thật trên GPU. Lựa chọn wheel theo [PyTorch official previous versions](https://docs.pytorch.org/get-started/previous-versions/).

## Kết quả sau khi duyệt và huấn luyện

Catalog ban đầu176 asset/tải152 được bổ sung3 ảnh có metadata license riêng:
[Digital Water Meter](https://commons.wikimedia.org/wiki/File:Digital_Water_Meter.jpg),
[Digitaler Wasserzaehler](https://commons.wikimedia.org/wiki/File:Digitaler_Wasserzaehler.jpg),
[Itron Water Meter](https://commons.wikimedia.org/wiki/File:Itron_Water_Meter.jpg).
Tổng cuối179 candidates,155 tải được,24 lỗi. Xem ảnh cho thấy ảnh đầu và ảnh
Itron là mechanical, chỉ ảnh Kamstrup flowIQ là water digital; tên file không
được dùng thay kiểm tra công nghệ hiển thị.

58 ảnh body/negative được gán nhãn và xem lại overlay:21 electricity mechanical,
13 electricity digital,15 water mechanical,1 water digital,8 negative. Các ảnh
còn lại chưa đủ nhãn/phù hợp mục tiêu hoặc có nhiều meter nên không đưa vào
supervised data. Không tự xếp các ảnh chưa duyệt là negative. Nhãn đầy đủ số
đọc/window/precision của58 ảnh chưa được lập; detection-only mode ghi rõ thiếu.

Mendeley169 ảnh có168 COCO entries;5 exact duplicates và1 ảnh thiếu nhãn được
loại, còn163 train. Toàn bộ nguồn giữ cùng train; validation/test LCD đến từ
Commons đã duyệt theo author group. Phát hiện pHash chỉ là candidate audit,
không chứng minh không còn leakage. Nhãn/quality hiện là agent-reviewed,
chưa đủ hai người để nghiệm thu theo quy tắc dataset của dự án.

[Báo cáo huấn luyện](OCR_MODEL_TRAINING_REPORT.md) ghi các lượt fine-tune thật,
model hashes và false proposals. [Báo cáo cuối](OCR_FINAL_COMPLETION_REPORT.md)
ghi các gate đã qua/chưa đạt. Không chấp nhận model mới chỉ vì nguồn có license
hoặc export/parity chạy được.

## Tiếp tục nghiên cứu ngày 06/11/2026

HEAD đầu phiên `8f5c751`, nhánh `member/QHuy`. Hai file tài liệu đang sửa bởi
người dùng được giữ nguyên: API_IMPLEMENTATION_STATUS và evidence ngày 06/11.
Không tạo lại các commit nghiên cứu/huấn luyện ngày 05/11.

Nguồn mới kiểm tra trực tiếp bằng Hugging Face API và tải qua revision cố định:
[LCD preview của 2005JIAZHI](https://huggingface.co/datasets/2005JIAZHI/Annotated-Digital-LCD-Utility-Meter-And-Serial-Numbers-Dataset/tree/4b0837a012d2062ac702d7f400e991cedfd6f64d).
Đã tải **50 JPEG, 50 YOLO TXT, 50 VOC XML và README** vào
`.tools/ocr-20261106-lcd-preview`; receipt SHA256 nằm cùng thư mục. Card ghi
CC-BY-NC-4.0 và cho phép thử training preview; chỉ dùng nghiên cứu offline phi
thương mại. Đoạn quảng cáo quyền thương mại của bản đầy đủ không được coi là
quyền thương mại của preview. Không phân phối ảnh/weights từ nguồn này.

Xem contact sheet toàn bộ 50 ảnh: đều là điện tử, nhiều ảnh cùng công tơ/góc
chụp; **không bổ sung được lớp nước điện tử**. Không coi 50 ảnh là 50 thiết bị.
VOC phân biệt digit màn hình, serial và scoreboard; không có box thân hoặc GT
precision/register đủ để tính billing accuracy. Ảnh 00008 và 00037 không thấy
chỉ số nhưng nguồn gán tám số 0; ảnh 00048 hiển thị segment test toàn số 8.
Loại ba ảnh này khỏi supervised digit training, không dùng nhãn nguồn như GT
nghiệm thu. Nhãn còn lại vẫn là publisher labels sau kiểm tra cấu trúc và audit
bằng ảnh, chưa có independent human review. Giữ toàn nguồn ở train, kiểm pHash
trước crop với các nguồn hiện có, không random split ảnh cùng thiết bị.

`utilitimetersai/Utility-Meters-LCD-Electricity-v1`: API trả HTTP 401.
`utilitimetersai/Annotated-Mechanical-And-LCD-Utility-Meter-Dials-Dataset`:
API xác nhận gated=manual tại revision `a2f544860f20b3c2098adeb091759ed30df5ff1c`.
Không tải hoặc vượt quyền. [MR-AMR](https://data.mendeley.com/datasets/8xjhrrk9rx/1)
ghi 140.000 ảnh digit, CC BY-NC 3.0; đó không phải 140.000 ảnh thân công tơ
bốn lớp, chưa đưa vào train. Nguồn nước LCD đại diện tiếp tục thiếu.

Truy vết công việc tiếp: BF-05 / UC-20 / GBR-07 → dataset guards và recognizer
offline → parity, false-proposal/blank controls; GBR-01/02 → kiểm quyền task
trước OCR; UC-21 / GBR-09 → regression xác nhận/hóa đơn. Không thay policy,
schema, API, precision hoặc quyền. Model chỉ có thể bật khi qua gate dữ liệu và
đánh giá; mọi model bị loại vẫn tắt.

Build baseline Release đã chạy: 0 warning/error. Application OCR: 125/125 PASS.
Chạy lại automatic baseline trên đúng 15 ảnh public development holdout; đây
không phải tập độc lập mới hoặc số liệu production. Báo cáo tiếp nối sẽ ghi
metrics thực tế, kết quả huấn luyện và các commit mới.
