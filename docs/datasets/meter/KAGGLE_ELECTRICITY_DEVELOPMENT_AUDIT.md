# Nguồn LCD điện mới — development, chưa phải ground truth

Nguồn [meter-data v1](https://www.kaggle.com/datasets/saarthaksrivastav/meter-data)
được tác giả liên kết trong [Meter_Ocr](https://github.com/saarthak-s/Meter_Ocr).
Metadata API công khai ghi MIT; code GitHub có AGPL-3.0 riêng, không nhập code đó.
HTTP download công khai trả 200, không dùng token hoặc vượt gate. ZIP 33.039.810 byte,
SHA256 `f459b1d39ff68cab8e2ee909f9f095bc3244b1efa23ff848ac2bd572c73bd4a4`.
Ảnh/ZIP/crop chỉ nằm trong `.tools`, không commit hoặc gửi ảnh toàn cảnh sang dịch vụ AI.

Audit 327 ảnh: không trùng SHA; không có cặp pHash63 distance≤6. Điều này **không
chứng minh 327 thiết bị độc lập**. Giữ toàn nguồn trong một nhóm quarantine; không
dùng publisher train/val như bằng chứng tách thiết bị. Không train model lượt này.
Nhận 319 boxes class0 và295 class1 hợp lệ theo tọa độ chuẩn hóa;7 dòng nhãn chạm/vượt
biên hoặc không hợp lệ bị audit từ chối. Có293 ảnh đúng một class0 hợp lệ. Audit trước
đó cắt first-class0 ở306 ảnh chỉ là preview, không phải tập đánh giá được xác minh.
Nguồn chỉ có bounding boxes display/serial, không có exact numeric GT, decimal,
billing register, body/category boxes hoặc physical-meter grouping đã xác minh.

Chọn12 crop nhìn đọc được trong64 preview đầu, ghi chuỗi nháp **trước** khi chạy
candidate. Manifest pin hash ảnh nguồn, nhãn và crop. Chỉ lưu crop display mang ID
opaque; không công bố serial. Sau inference phát hiện cần second review ở030/038/
053/065 về ký tự cuối/leading zeros; giữ nguyên chuỗi nháp, không sửa theo model,
không loại ca khỏi mẫu số để tăng kết quả. Tất cả12 vẫn cần independent human review.

Trên cùng12 crop, PP direct0/12 vàPP page0/12 khớp nguyên văn nháp; English direct4/12.
Không regex bỏ chữ/ký hiệu để biến output sai thành đúng. Đây là tín hiệu nghiên cứu
component, **không phải exact accuracy đã xác minh**, end-to-end hoặc billing accuracy.
Không chọn lại threshold, không bật reader điện, không thay category/register veto.

[Manifest nháp](kaggle-electricity-development-candidates.json),
[audit và raw outputs nhỏ](../../development/ocr-recovery-kaggle-results.json).
Các thông số p95 chỉ là quan sát local trên12 crop, gồm warm-up, không phải latency HTTP.

Tái tạo sau khi tải ZIP và giải nén an toàn vào `.tools/ocr-recovery-kaggle`:

```powershell
.tools/yolo-python/python.exe tools/BHome.OcrSmoke/model_tools/audit_public_meter_data.py .tools/ocr-recovery-public/meter-data.zip .tools/ocr-recovery-kaggle .tools/ocr-recovery-kaggle/audit.json
dotnet build tools/BHome.OcrSmoke -c Release --no-restore
dotnet tools/BHome.OcrSmoke/bin/Release/net8.0/BHome.OcrSmoke.dll --reviewed-window-compare .tools/ocr-models .tools/ocr-recovery-english docs/datasets/meter/kaggle-electricity-development-candidates.json . .tools/ocr-recovery-kaggle/reader-comparison.json
```

Trước khi nhận làm benchmark/train: blinded review toàn bộ chữ số, precision và
register; review vùng display so với serial; tạo nhóm thiết bị thực; tách nguồn/
thiết bị rồi freeze splits. Digital-water vẫn thiếu nguồn đa thiết bị phù hợp;
nguồn LCD điện này không giải quyết thiếu hụt đó.
