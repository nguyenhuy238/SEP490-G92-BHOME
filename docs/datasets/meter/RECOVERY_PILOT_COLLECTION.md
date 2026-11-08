# Pilot ảnh OCR cần người kiểm nhãn

Mục đích: lấp khoảng trống positive **độc lập thiết bị** cho BF-05/UC-20; ảnh
không tự tạo chỉ số billing. Chỉ Staff xác nhận qua workflow hiện hành mới dùng
cho hóa đơn. Đây là hướng dẫn thu ảnh, không phải dữ liệu/test đã hoàn thành.

Bắt đầu với **8 đồng hồ vật lý**,2 chiếc mỗi loại: điện cơ, điện LCD, nước cơ,
nước LCD. Mỗi chiếc chụp3 điều kiện → khoảng24 ảnh: thẳng/rõ, nghiêng vừa phải,
ánh sáng khó nhưng vẫn an toàn. Ưu tiên hai site và brand/model khác nhau. Không
cần mua thiết bị hoặc đạt hàng trăm ảnh ngay. Nước LCD và điện cơ là thiếu hụt
positive nghiêm trọng nhất; một chiếc Badger với nhiều ảnh vẫn chỉ là một group.

## Thao tác cho mỗi chiếc

1. Lấy phép Owner/người có quyền cho mục đích nghiên cứu nội bộ. Ghi permission
   reference dạng mã; không ghi tên/địa chỉ Tenant vào manifest. Không thu CCCD,
   hợp đồng, khuôn mặt, số điện thoại hoặc tài khoản ngân hàng.
2. Gán mã opaque như `pilot_water_lcd_a`, không dùng serial/Room/địa chỉ thật làm
   ID. Ghi technology, utility, brand/model nếu đọc chắc. Ghi một `meterGroup`
   cố định cho mọi ảnh của cùng chiếc và `siteGroup` ẩn danh cho cùng địa điểm.
3. Giữ ảnh toàn body đủ xác minh loại đồng hồ và ảnh display rõ. Cặp ảnh cùng lần
   chụp có cùng `captureGroup`; chúng không được tách sang hai split. Che PII trước
   khi đưa vào dataset; giữ context về unit/register cần để đọc đúng màn hình.
4. Ghi **chuỗi hiển thị nguyên vẹn**, kể cả leading zeros; thập phân được ghi
   riêng, không làm tròn và không suy từ reading kỳ trước. JSON giữ digits là string.
   Cần hai reviewer đọc độc lập trước khi dùng làm GT; khi bất đồng, giữ pending.
5. Với LCD, chụp cả nhãn unit và mã/register trên màn hình, ghi lý do xác định tổng
   kWh hoặc tổngm³. Điện áp/dòng/Hz/kW, flowm³/h, nhiệt độ, status/error/blank là
   control riêng; không gán thành total consumption. Nếu chưa xác minh được register,
   ghi unknown. Không suy từ nhãn model hoặc chữ “digital water” trên website.
6. Khi bánh số chuyển tiếp/mờ/lóa, đánh dấu vị trí chưa đọc được và giữ digits=null;
   không chọn chữ số bằng model hoặc tự cộng0,5. Readability=unreadable/uncertain
   phải dựa trên review ảnh, không chỉ vì OCR fallback.
7. Gán body polygon và display quadrilateral trên đúng ảnh, normalized0..1, thứ tự
   TL/TR/BR/BL. Ảnh nhiều meter phải ghi đủ đối tượng hoặc giữ challenge multiple;
   không chỉ label một body rồi nói ảnh có một chiếc. Không dùng body box thay window.

## Freeze và kiểm tra

Trong pilot nhỏ, một meter mỗi loại thuộc development, meter còn lại đóng băng
validation trước augmentation. Không gọi validation này là final acceptance;
final test cần nhóm thiết bị/site mới ở vòng sau. Không chuyển validation vào train
khi model thất bại. Mọi augmentation/crop/thời điểm của cùng meter giữ cùng split.

Tính SHA256 cho ảnh, kiểm pHash với corpus cũ và mọi split trước khi train. Review
duplicate candidates; hash gần nhau không tự chứng minh cùng meter. License/private
permission phải rõ. Chỉ chuyển manifest đã review sang schema hiện có và chạy:

```powershell
node scripts/Validate-MeterDataset.cjs <reviewed-manifest.json> <authorized-local-image-root>
```

Validator kiểm cấu trúc/hash/group/polygon, **không xác minh GT đọc đúng**. Không
đẩy private images lên Git/CI hoặc dịch vụ AI. Ảnh được giữ offline/đúng chính sách
được duyệt. Biểu mẫu bên cạnh là draft chưa có ảnh/GT; không dùng để train.
