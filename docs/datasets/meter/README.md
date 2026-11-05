# Gán nhãn và kiểm tra dataset công tơ

Dataset công khai đã duyệt và workflow fine-tune offline mới:
[TRAINING.md](TRAINING.md). `annotationLevel: "meter"` cho phép chỉ có
`meterPolygon`, còn `windowPolygon` và `reading` phải là `null`; không được
bịa nhãn chỉ số để dùng ảnh cho detection. Nhãn đầy đủ hiện có vẫn giữ cách
kiểm tra cũ. Các nhóm tùy chọn `sourceGroup`, `captureGroup`,
`nearDuplicateGroup` cũng bị chặn nếu xuất hiện ở nhiều split.

Mẫu [manifest](manifest.example.json) chỉ minh họa cấu trúc; file ảnh, hash, reading,
permission reference và polygon phải được thay bằng dữ liệu đã kiểm tra. Mẫu chưa
phải dataset nghiệm thu hoặc bằng chứng có quyền sử dụng ảnh.

```powershell
node scripts/Validate-MeterDataset.cjs .tools/meter-dataset/manifest.json .tools/meter-dataset/images
node --test tests/scripts/MeterDataset.test.cjs
```

Lệnh chỉ đọc file và in số lượng/category, index lỗi + mã lỗi; không ghi ảnh,
upload, train, hoặc log đường dẫn/số đọc. Exit0=nhãn hợp cấu trúc; exit1=không hợp
lệ; exit2=không thể đọc manifest. Validation không chứng minh accuracy hay thay
project review quyền sử dụng dữ liệu. Không commit ảnh private hoặc CCCD.

Quy trình thu thập/gán nhãn:

1. Chỉ thu ảnh công tơ được phép. Ghi nguồn/license cho public; với private ghi
   mã quyết định cho phép opaque, không ghi địa chỉ/người thuê/CCCD/credential.
2. Gán `siteGroup`, `meterGroup` opaque cho mỗi site/physical meter. Mọi frame,
   augmentation và lần chụp của cùng meter **và cùng site** phải cùng split;
   validator chặn cả hash ảnh trùng qua split. Không chia theo reading giống nhau.
3. Chọn category từ `electricity_mechanical`, `electricity_digital`,
   `water_mechanical`, `water_digital`; ảnh negative dùng `not_meter`, polygons
   và reading=null. Không đưa ảnh CCCD vào cả negative meter dataset.
4. Body/window là4 điểm normalized0..1 theo chiều kim đồng hồ hoặc ngược lại,
   convex, không tự cắt, window nằm trong body. Một mẫu mô tả một vùng chỉ số;
   ảnh nhiều vùng phải được người gán nhãn đánh dấu state/register, không tự chọn
   số serial hoặc màn hình flow rate làm tổng tiêu thụ.
5. `digits` là **string** giữ leading zeros, chưa chèn dấu thập phân. Precision
   thực tế0..4 hoặc null nếu chưa xác định. `digitCount` là tổng số vị trí quan sát
   được; nếu có chữ số không rõ, `digits=null` và liệt kê index0-based trong
   `unreadablePositions`, không điền số đoán. Không đổi annotation để hợp model.
6. Register: `total_energy` (điện), `total_volume` (nước), `flow_rate` (nước),
   `other`, `unknown`; `displayState`: single/multiple/unknown. Flag blur/glare
   phản ánh ảnh gốc. Cần hai người đối chiếu GT và phân xử bất đồng trước nghiệm thu.
7. Chốt train/validation/test theo site trước calibration. Tối thiểu50 ảnh test
   độc lập mỗi loại là kế hoạch đề xuất, không phải con số đã thu hay bảo đảm90%.
   Các ảnh public Rwanda cũ thiếu group metadata/decimal ground truth đầy đủ,
   không được tự nâng thành tập độc lập chỉ bằng validator này.

Hash kiểm tra toàn bộ bytes; path tuyệt đối, traversal và symlink thoát image root
bị chặn. Giới hạn file20MiB dành cho dataset nguồn; runtime upload vẫn tuân giới
hạn backend và Mobile resize riêng. Công cụ không tự phát hiện nội dung PII hoặc
thẩm định license, cần kiểm duyệt trước khi đưa ảnh vào root.
