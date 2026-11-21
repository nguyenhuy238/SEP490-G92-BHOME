# Kiểm kê trước bàn giao trên Staff Mobile (BF-01 / BF-02 / BF-07)

## Quy tắc đã chốt ngày 18/11/2026

- Khi hợp đồng thuê **Main** được kích hoạt lần đầu, Backend tạo tối đa một công việc kiểm kê tài sản trước bàn giao, gắn phòng/hợp đồng và deadline trước ngày Tenant nhận phòng. Không tạo công việc cho hợp đồng giữ chỗ, nháp, hoặc gia hạn tại cùng phòng nếu không có lần bàn giao mới.
- Công việc đi theo phân công Staff hiệu lực tại cơ sở. Nếu chưa có người phụ trách, phải giữ công việc chờ phân công và thông báo Owner; không được bỏ lỡ sự kiện kích hoạt.
- Mỗi nhóm tài sản trong một phòng giữ một Asset ID; checklist ghi số lượng dự kiến, số lượng thực tế, tình trạng `Good` (Đạt), `Missing` (Thiếu), hoặc `Damaged` (Hư hỏng cần sửa chữa), ghi chú và ảnh theo mục.
- Tất cả mục phải được kiểm tra và có bằng chứng hợp lệ. Khi thiếu/hỏng, Staff dùng **Báo cáo sự cố BF-07 hiện có** với cơ sở, loại Phòng, phòng, tài sản, mô tả và ảnh được điền sẵn. Lưu liên kết Incident ID vào mục kiểm kê.
- Staff nhấn hoàn thành trực tiếp, **không cần Owner nghiệm thu**. Owner có thể xem chi tiết checklist, ảnh, sự cố và nhận thông báo hoàn thành.
- Hoàn thành kiểm kê có sự cố không đồng nghĩa phòng sẵn sàng bàn giao. Kết quả bàn giao Tenant/Staff là quy trình riêng, lịch sử bàn giao không bị ghi đè.

## Chạy Staff Mobile với Backend/PostgreSQL local (Windows)

1. Mở Docker Desktop nếu sử dụng MinIO/PostgreSQL bằng Docker. Kiểm tra `docker compose ps` trước. **Nếu bạn đang dùng PostgreSQL local hiện có, không cần tạo hoặc khởi động PostgreSQL Docker mới**; chỉ khởi động MinIO bằng `docker compose up -d minio` khi cần. Không chạy `docker compose down -v`, không xóa volume dữ liệu.
2. Chuẩn bị `.env` tại root theo `LOCAL_DEVELOPMENT.md`. Không lưu hay chia sẻ mật khẩu, JWT, database credentials. Với Compact24 hiện có, không chạy `dotnet ef database update`, không chạy lệnh recreate.
3. Cài dependencies từ root nếu lần đầu: `npm.cmd ci`. Kiểm tra môi trường `.NET 8`, `Node 22` theo `LOCAL_DEVELOPMENT.md`.
4. Từ root, chạy **một lệnh** `npm.cmd run mobile:dev`. Launcher BHOME tự chọn IPv4 LAN, chuẩn bị HTTPS API và Metro, rồi hiển thị QR của Expo. Nếu API cũ đã chạy qua Visual Studio thì launcher dùng lại API đó, **không tự nạp mã Backend vừa chỉnh sửa**; hãy dừng tiến trình API cũ và khởi động lại trước khi thử luồng kiểm kê mới. Xóa cache Metro nếu cần bằng `npm.cmd run mobile:dev -- -Clear`.
5. Điện thoại cùng Wi-Fi, dùng **Expo Go** quét QR. Nếu launcher yêu cầu đăng nhập Expo, chạy `npx.cmd expo login` trong thư mục `src/mobile` với tài khoản Expo Go trên điện thoại.
6. Đăng nhập tài khoản Staff đã được phân công tại cơ sở có hợp đồng Main mới kích hoạt. Mở **Công việc vận hành**, tìm **Kiểm kê trước nhận phòng** và mở phiếu của từng tài sản. Chọn số lượng thực tế, tình trạng và ảnh; với tài sản thiếu/hỏng, dùng màn **Báo cáo sự cố** BF-07 và quay lại checklist.
7. Khi tất cả mục hợp lệ, Staff hoàn thành công việc. Owner xem kết quả ở **Công việc vận hành**; việc xử lý sự cố (nếu có) tiếp tục ở BF-07.

### Lệnh kiểm tra không cần điện thoại

```powershell
# Từ thư mục root
npm.cmd run typecheck --workspace ./src/mobile
npm.cmd run test --workspace ./src/mobile
npm.cmd run build --workspace ./src/owner-web

# Từ src/mobile: kiểm tra Metro bundle, không thay thế kiểm thử thiết bị thật
npx.cmd expo export --platform android --output-dir ../../.tools/mobile-export-check
```

Nếu điện thoại không truy cập API, kiểm tra Wi-Fi, QR của phiên Metro đang chạy, chứng chỉ CA HTTPS local và `/health/ready`; xem `MOBILE_NETWORK_DEVELOPMENT.md` và `IPHONE_CONNECTIVITY.md`. Chỉ thử phiên API mới sau khi chạy lại Backend để nạp những endpoint vừa triển khai. Không mở hai API/Metro tranh cùng cổng.

### Chuẩn bị dữ liệu để thử tính năng

Để có một công việc thực sự, cần một hợp đồng **Main** mới được kích hoạt, phòng có nhóm tài sản thực tế và Staff đang phụ trách cơ sở. Không sử dụng lại hợp đồng Active cũ để mặc định kỳ vọng sinh tác vụ lịch sử nếu hệ thống chỉ phát công việc trên sự kiện kích hoạt. Không sửa dữ liệu Tenant hoặc tạo thanh toán giả trong database thật để ép điều kiện hợp đồng.

### Checklist thử nghiệm thủ công

1. Kích hoạt Main lần đầu cho phòng có tài sản, kiểm tra trong **Công việc vận hành** có đúng một công việc `Kiểm kê trước nhận phòng`. Thử tải lại và gọi lại yêu cầu kích hoạt với cùng khóa hợp lệ: không được có công việc trùng. Hợp đồng gia hạn không tạo phiếu mới.
2. Staff mở công việc, nhấn **Bắt đầu kiểm kê**, mở phiếu từng tài sản. Nhập đủ số lượng, chọn **Đạt**, chụp ít nhất một ảnh cho mỗi mục, lưu nháp, mở lại để xác nhận dữ liệu đã lưu từ máy chủ, rồi nhấn **Hoàn thành kiểm kê**. Owner xem báo cáo và không có nút nghiệm thu.
3. Ở một hợp đồng thử nghiệm khác, ghi **Thiếu** (số lượng thấp hơn dự kiến) hoặc **Hư hỏng cần sửa chữa**, nhập ghi chú và ảnh. Từ phiếu kiểm kê nhấn **Báo cáo sự cố**, xác nhận form BF-07 đã tự điền cơ sở/phòng/tài sản/nội dung/ảnh. Gửi một lần, kiểm tra mã sự cố được liên kết vào phiếu và Owner nhận thông báo.
4. Kiểm kê có sự cố liên kết được phép hoàn thành, nhưng **chưa sẵn sàng bàn giao** khi BF-07 chưa giải quyết. Sau khi sự cố được xử lý và chuyển `Resolved` theo quy trình BF-07, kiểm tra lại trạng thái sẵn sàng và xác nhận bàn giao theo luồng hợp đồng.
5. Thử thay Staff phụ trách sau khi sự cố đã được báo cáo. Staff mới vẫn phải thấy phiếu và sự cố được liên kết trước đó; không được buộc tạo báo cáo BF-07 trùng.

**Phạm vi kiểm thử hiện tại:** build/TypeScript/lint và test tự động đã chạy; kiểm thử end-to-end qua PostgreSQL testcontainer và thao tác thực tế trên điện thoại vẫn phải xác minh riêng. Ảnh hoặc trường đang chỉnh **chưa nhấn lưu** chỉ giữ trong bộ nhớ ứng dụng, có thể mất khi đóng hoàn toàn hoặc mất kết nối.
