# Review ảnh độc lập, không hiện dự đoán model

Đã tạo gói 327 ảnh public tại `.tools/ocr-four-review/index.html`. Không có người
review thật trong lượt này; số numeric labels đủ điều kiện acceptance mới là **0**.
Không nhập bản nháp12 ảnh Kaggle hoặc dự đoán model làm ground truth.

Tạo lại trong thư mục trống và chạy ở loopback:

```powershell
.tools/yolo-python/python.exe tools/BHome.OcrSmoke/model_tools/meter_review.py build .tools/ocr-recovery-kaggle .tools/ocr-four-review-new
.tools/yolo-python/python.exe -m http.server 8766 --bind 127.0.0.1 --directory .tools/ocr-four-review-new
```

Mở `http://127.0.0.1:8766/`. Mỗi reviewer dùng một mã opaque riêng, tự xem ảnh và
kéo khung thân công tơ/vùng đọc. Nhập loại, khả năng đọc, nhóm thiết bị khi biết,
digits giữ leading zeros, precision/unit/register đã xác minh. Trường chưa rõ để
unknown/null. Có digit mờ thì để digits trống, ghi vị trí không rõ; không đoán.
Nhấn lưu từng ảnh và xuất JSON trước khi đóng trang. Hai người review riêng,
không chia sẻ bản đọc hoặc xem output model trước khi xuất file.

```powershell
.tools/yolo-python/python.exe tools/BHome.OcrSmoke/model_tools/meter_review.py merge .tools/ocr-four-review-new/package.json reviewer-a.json reviewer-b.json .tools/ocr-four-review-consensus.json
```

Merge kiểm lại bytes ảnh, reviewer khác nhau, SHA, cấu trúc nhãn và bất đồng.
View A chỉ nhận category/body box; B chỉ nhận region/register; C chỉ nhận exact
digits khi hai người đồng ý, single display, readable và không digit chưa rõ.
Box agreement IoU≥0,8 chỉ là kiểm đồng thuận annotation, không phải runtime threshold.
Giữ khung người thứ nhất khi khớp; không sinh tọa độ mới từ model.
Thiếu precision/register thì không đánh dấu billing metadata đầy đủ. Bất đồng ở
digits không được lọt vào A/B thành numeric GT. Các review còn thiếu vẫn pending.

File chỉ ghi **declared consensus pending project review**; hai tên reviewer không
tự chứng minh hai người độc lập. Người phụ trách dataset xác nhận nguồn/license,
thẩm định consensus, nhóm thiết bị/site rồi freeze source-separated splits trước
augmentation. Tất cả unknown physical meters của Kaggle giữ một source group;
không random split để tạo vẻ độc lập. Không tự train/activate bằng file review.
Toàn bộ ảnh/gói review/output nằm ngoài Git; không dùng dữ liệu Tenant hoặc CCCD.
