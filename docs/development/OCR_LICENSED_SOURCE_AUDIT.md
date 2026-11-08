# Kiểm tra nguồn dữ liệu OCR bổ sung — 06/11/2026

Phạm vi BF-05 / UC-20 / GBR-07: dữ liệu cho OCR gợi ý có Staff xác nhận.
Không thay đổi billing UC-21, runtime, weights hay các tập train/val/test đã đóng băng.

## Nguồn đã tải và kiểm tra thực tế

[Badger55 của Three](https://huggingface.co/datasets/S3CUR/badger-55-watermeter/tree/b49bf7505cf1212de4e4e803bc39e8ce70c6d37e)
công bố CC BY 4.0. Đã tải `slots.parquet` 29.511.245 bytes, kiểm SHA256 theo
metadata LFS, decode toàn bộ 4.548 JPEG; có 4.546 SHA256 riêng biệt, hai nhóm
trùng byte và 670 nhóm dHash bằng nhau cần xem lại. Đã xem thêm 20 mẫu phân tầng
digit/mechanism: đây là crop bánh số cơ với nhiều trạng thái chuyển tiếp.

**Toàn bộ chỉ từ một công tơ/một camera.** Không cộng thành 4.548 công tơ mới,
không dùng publisher split để tuyên bố đánh giá độc lập. Nhãn nguồn có hỗ trợ
model, chưa được BHOME xác minh từng ảnh. Giữ dữ liệu ở quarantine; toàn nhóm
thiết bị phải ở cùng một split nếu được duyệt về sau. Không suy chữ số billing
đã ổn định từ góc chuyển tiếp. Chưa bổ sung ảnh supervised hay test độc lập.

[Audit máy đọc được](../datasets/meter/licensed-meter-source-audit-badger.json)
ghi revision, giấy phép, attribution, hash, phân bố nhãn và giới hạn. Inventory
từng crop ở `.tools/licensed-meter-source-audit/inventory.json`, ảnh và parquet
ngoài Git. Không tải `captures.parquet` ~1 GB: nhãn full-frame pha trộn
human/SDR/model, không giải quyết thiếu GT billing độc lập.

## Nguồn mới được xác minh nhưng chưa đưa vào corpus

| Nguồn gốc | Bằng chứng và quyết định |
| --- | --- |
| [Dryad word-wheel water](https://datadryad.org/dataset/doi:10.5061/dryad.7d7wm3860) | Metadata API công khai xác nhận CC0, version `422392`. Đây là nguồn nước cơ mới có detection/segmentation và nhãn chuỗi 5/6 số; có thể giải quyết một phần thiếu dữ liệu địa điểm khác sau khi tải và audit. Link file được trang cung cấp trả HTTP403, không tải/vượt hạn chế. Không tính số ảnh publisher là số ảnh BHOME đã kiểm. |
| [RF100-VL water-meter](https://universe.roboflow.com/rf100-vl/water-meter-jbktv-7vz5k-ftoz-z2ysc), [HF mirror](https://huggingface.co/datasets/gatilin/rf100-vl-datasets/tree/c74f8bb3dff8eb3f587ac3b2796c69116c4ec71c/water-meter) | 684 ảnh, 10 nhãn digit; README mirror ghi MIT. Các tên `id_<id>_value_<reading>` gợi khả năng chung nguồn Toloka/UniData, nơi giấy phép công bố CC BY-NC-ND. Chưa xác minh chuỗi quyền; không lấy MIT mirror làm quyền ghi đè, không tải/train. Đây là nghi vấn provenance, chưa khẳng định hai corpus trùng hoàn toàn. |
| [UniData water-meter-image](https://huggingface.co/datasets/ud-smart-city/water-meter-image) | Card ghi CC BY-NC-ND 4.0; viewer60 hàng gồm ảnh/collage/mask, không phải60 thiết bị hoặc5.000 ảnh mở. Không dùng derivative/training để tránh lặp nguồn ND đã bị loại. |
| [UtilityMeters raw LCD](https://huggingface.co/datasets/utilitimetersai/Raw-LCD-Utility-Meter-Display-Images), [raw mixed](https://huggingface.co/datasets/utilitimetersai/Raw-Mix-Mechanical-LCD-Utility-Meter-Display-Images) | API xác nhận cả hai `gated=auto`, CC BY-NC4.0; biểu mẫu yêu cầu thông tin tổ chức/quốc gia/mục đích. Không gửi biểu mẫu hoặc tải file. Tag water không xác minh có ảnh nước LCD. |
| [SCUT-WMN](https://github.com/HCIILAB/Water-Meter-Number-DataSet) | Chỉ nghiên cứu phi thương mại; nguồn mô tả5.000 noisy +1.000 clean crops, có mid-state classes10..19. Là nước cơ, không giải quyết nước LCD; không tự dùng cách cộng0,5 của nghiên cứu làm chính sách billing BHOME. Chưa tải. |
| [Nghiên cứu Việt Nam/Citywork](https://jst.tnu.edu.vn/jst/article/viewFile/8741/pdf) | Có mô tả tập ảnh do nhóm tự thu cho pipeline hai giai đoạn; chưa thấy release ảnh/annotation có quyền tải và sử dụng rõ ràng. Không lấy ảnh bài báo hoặc suy giấy phép article cho corpus. |

Metadata Dryad có API download chính thức cho archive:
`https://datadryad.org/api/v2/files/4579939/download`, size `2613710367`,
SHA256 `3b7d3d8168ab924314a7c71987ce09f54dec95818a9cb484b46ea804fc1d90e6`.
Đây chỉ là thông tin nguồn; **chưa xác minh bytes hoặc annotation archive**.
README API metadata và file list lấy được200; browser file link403 được giữ như
blocker, không thử thay đổi endpoint để né lỗi.

Đã tìm bằng English và Vietnamese trên Hugging Face, Kaggle, Roboflow, GitHub,
Dryad/academic, Commons và nguồn Việt Nam; thêm từ khóa LCD, ultrasonic,
Kamstrup, Hydrus. Chưa có nguồn nước LCD mới vừa mở quyền vừa đủ ảnh/GT đại diện.
Kết quả là tăng khả năng tái lập acquisition/audit nước cơ, **chưa mở khóa training
bốn lớp hoặc benchmark billing positive độc lập**. Không retrain lại62 ảnh cũ.

## Tái lập và kiểm chứng

Tool chỉ dùng cho offline acquisition, pin revision/checksum và dừng khi dữ liệu
khác nguồn. `requests`/Pillow đã có trong môi trường công cụ; `pyarrow==19.0.1`
được cài riêng để đọc parquet, không thêm dependency vào backend/mobile.

```powershell
& .tools/yolo-python/python.exe -m pip install --target .tools/licensed-meter-audit-packages pyarrow==19.0.1
& .tools/yolo-python/python.exe -c "import sys,runpy; sys.path.insert(0,'.tools/licensed-meter-audit-packages'); sys.argv=['audit_badger_digit_source.py','.tools/licensed-meter-source-audit','docs/datasets/meter/licensed-meter-source-audit-badger.json','--download']; runpy.run_path('tools/BHome.OcrSmoke/model_tools/audit_badger_digit_source.py',run_name='__main__')"
& .tools/yolo-python/python.exe -m unittest discover -s tests/scripts -p test_licensed_meter_source_audit.py -v
```

Kết quả: audit4.548 rows thành công; **5/5 tests PASS** cho checksum/size,
duplicate và cross-split reporting, dữ liệu lỗi, quarantine và giữ transition
khỏi confirmed reading. Lần chạy đầu lỗi import `pyarrow` vì embedded Python bỏ
qua `PYTHONPATH`; đã sửa cách gọi bằng `sys.path` và chạy lại thành công.
Không có training, inference, accuracy hoặc camera E2E trong work unit này.

## Duyệt lại ảnh Commons hiện có cho positive benchmark

Đã lọc bỏ ID và author xuất hiện trong toàn bộ `four-class-development-v2`,
`lcd-evaluation` và `independent-reading-controls`, rồi xem9 contact sheets với
106 ảnh còn lại từ hai catalog Commons hiện có. Nhiều ảnh là nắp hộp, nhiều
meter, vỏ kín, công trình hoặc ảnh không đọc được. Không gán các ảnh này thành
negative tự động. Sau đó xem nguồn đầy đủ và overlay hai ứng viên:

- `commons_88598855`: nước cơ, năm chữ số `35558`, m³ in bên cạnh, một window
  chéo. Giữ `decimalPlaces=null` để không suy precision từ hình thức bánh số.
- `commons_52855795`: điện LCD, window trên phải có `000059`; ảnh gốc có ba
  meter. Đây chỉ là digit GT trên vùng được người review chỉ rõ; full-frame
  phải xử lý sự mơ hồ nhiều meter. Không xác nhận billing register/decimal.

[Manifest hai ứng viên](../datasets/meter/licensed-meter-positive-candidates.json)
giữ source/hash/license/group, window polygons và giới hạn; không đưa vào train
hoặc chọn threshold. Author khác các reference; khoảng cách pHash nhỏ nhất tới
corpus body62 ảnh lần lượt24 và22 (>ngưỡng audit6). Hash các reference manifests
được ghi để tái lập phạm vi kiểm. Điều này không biết overlap với pretraining
của model và chưa thay thế independent human review thứ hai.

`node scripts/Validate-MeterDataset.cjs docs/datasets/meter/licensed-meter-positive-candidates.json .`
đã chạy: **valid=true, hai mẫu**. Validation kiểm cấu trúc/hash, không chứng minh
GT chính xác hoặc model đọc đúng. Chưa chạy inference trên hai mẫu trong work
unit này. **Không có ứng viên positive nước LCD độc lập đọc được**, cũng chưa
có điện cơ với đầy đủ digit/precision/register chắc chắn sau bước lọc trên.
Ảnh `commons_38382735` có cột m³/litre nhưng bánh số cuối đang chuyển4→5;
`commons_18880869` có bánh cuối điện cơ không chắc chắn. Không điền numeric GT
để hoàn thành số lượng. Billing accuracy của cả bốn loại vẫn NOT MEASURED bởi
work unit dữ liệu này.
