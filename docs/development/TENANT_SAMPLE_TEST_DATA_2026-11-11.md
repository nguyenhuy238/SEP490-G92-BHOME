# Dữ liệu kiểm tra Mobile Tenant — 11/11/2026

Tài khoản đích: `tenant.sample@example.invalid`, trên Neon development đã được xác minh trong cấu hình dự án. Nguồn: yêu cầu trực tiếp của người dùng; BF-03/BF-04/BF-05/BF-07, UC-03/13..24/26..30, FE-07, GBR-01/02/04/06/07/18; các DTO và service hiện có. Đây là fixture tổng hợp phục vụ kiểm tra UI, không phải bằng chứng hoàn thành nghiệp vụ thật.

Không đổi mật khẩu, security stamp hoặc role. Hợp đồng có sẵn trước khi seed được giữ nguyên. Không chạy migration hoặc reset database. Các ID mới dùng prefix `bd110000-0000-4000-8000-…`; dữ liệu được đặt trong cơ sở riêng `[TEST] BHOME Tenant Sample`.

## Dữ liệu và cách kiểm tra

- **Trang chủ / Phòng của tôi:** phòng đang thuê `TEST-T101`, tài sản máy lạnh/vòi nước, số dư hóa đơn và thông báo. Hợp đồng hiện tại kết thúc sau 25 ngày tính từ ngày seed, có nhắc `Upcoming30`.
- **Hợp đồng:** thêm 3 hợp đồng demo: Active tại T101, Terminated tại T102, PendingSigning tại T103. Giữ thêm hợp đồng đã tồn tại của tài khoản. Có PDF xem trước từ template Development, chứa thông báo dữ liệu mẫu; không tạo chữ ký giả hoặc tài liệu đã ký.
- **Bàn giao:** biên bản Draft cho T101, 2 tài sản và 2 chỉ số đầu kỳ có ảnh PNG tổng hợp. Có thể thử xác nhận/tranh chấp qua API hiện có.
- **Hóa đơn:** 5 kỳ, từ tháng seed trở về 4 tháng trước; 4 Final và 1 Draft. Mỗi kỳ có tiền phòng 3.000.000, điện 350.000, nước 150.000 và Internet 100.000 VND. Đây là số liệu mẫu, không phải phí phải thu thực tế.
- **Thanh toán:** kỳ hiện tại chưa thanh toán; kỳ trước có 1.000.000 VND phân bổ mẫu; kỳ trước nữa đã phân bổ đủ 3.600.000 VND; một kỳ cũ còn nợ quá hạn. Backend vẫn có thể trả `paymentStatus=Unpaid` khi đã trả một phần; UI phân biệt bằng paidAmount/outstandingAmount. Không tạo trạng thái backend mới.
- **QR:** cấu hình nhận tiền Development có cờ demo, tên `BHOME SYNTHETIC TEST DO NOT PAY`, số tài khoản toàn số 0. Không dùng QR này để chuyển tiền thật.
- **Điều chỉnh:** 3 yêu cầu kèm ảnh tổng hợp: Pending, Approved, Rejected. Yêu cầu được duyệt giảm Internet từ 100.000 xuống 80.000 VND trên kỳ đã trả một phần; giữ nguyên số tiền hóa đơn đã phát hành và thể hiện tác động riêng.
- **Điện nước:** 2 công tơ, 12 chỉ số xác nhận tổng hợp (đầu kỳ và 5 kỳ hóa đơn), có file PNG được lưu trong MinIO. Không sử dụng ảnh/CCCD thật.
- **Sự cố / Yêu cầu của tôi:** 3 phiếu có ảnh và lịch sử: Submitted, InProgress (đã phân công Staff mẫu), Rejected. Không tạo chi phí sửa chữa thật hoặc gửi thông báo ra ngoài.
- **Tạm trú:** hồ sơ T101 ở trạng thái InProgress, có ảnh minh họa ghi rõ không phải minh chứng VNeID. Không đánh dấu Completed hoặc OwnerConfirmed. Các hồ sơ khác vẫn dùng trạng thái thực tế được API trả về.
- **Thông báo:** thêm 26 thông báo trong ứng dụng, có cả đã đọc/chưa đọc để thử phân trang. Không gửi email/push.
- **Tài khoản / Đổi mật khẩu:** dùng tài khoản hiện có, không đổi thông tin xác thực để seed. Không tự điền số điện thoại hoặc dữ liệu định danh không có thật.

## Chạy lại và xác minh

Từ repository:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Seed-TenantMobileDemo.ps1 -Mode --inspect
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Seed-TenantMobileDemo.ps1 -Mode --seed
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Seed-TenantMobileDemo.ps1 -Mode --verify
```

Mặc định chỉ inspect. Script giới hạn tài khoản đích và endpoint Neon development, giữ Jobs/email/push worker tắt trong tiến trình công cụ. Seed dùng ID/key ổn định, giữ trạng thái đã thao tác, không đặt lại password hoặc đọc/chưa đọc. Chỉ sửa file fixture do chính lần seed này tạo nếu lần upload đầu bị lỗi cấu hình lưu trữ; không thay tài liệu đã ký hoặc minh chứng thật.

Verification đăng nhập bằng secret demo đã có trong file local, gọi API bằng session bình thường, không in password/token và chỉ logout session kiểm tra. Cấu hình MinIO trong file môi trường Neon local được đồng bộ với MinIO đang chạy; database vẫn là Neon. File môi trường chứa secret bị Git ignore.

Lỗi SQL có sẵn ở cập nhật/upload tạm trú được sửa: dùng `cr.history` để tránh cột `history` mơ hồ trong UPDATE JOIN, và gán kiểu timestamptz/text cho giá trị null. Không đổi policy, trạng thái hay contract API. Regression PostgreSQL kiểm tra cập nhật, gắn minh chứng và chặn Tenant khác; chạy trên database local disposable, không trên Neon.

## Giới hạn

Kết quả thực chạy 11/11/2026: build công cụ/API thành công (0 warning/error); 2/2 regression PostgreSQL PASS; 30 API GET và 12 lượt tải ảnh/PDF đều trả 200; hash PDF và ảnh bàn giao khớp. Chạy lại seed giữ số lượng 4 hợp đồng (gồm 1 có sẵn), 5 hóa đơn, 3 adjustment requests, 3 incident reports, 2 giao dịch phân bổ mẫu và 26 thông báo; không reset trạng thái đã đọc hoặc thông tin xác thực. Cloudflare readiness trả 200. Log xác minh an toàn nằm trong `.tools/tenant-mobile-demo-final.log` bị Git ignore.

Các trạng thái Active/Terminated trong fixture không chứng minh đã ký hoặc giao dịch thật. Ký qua nhà cung cấp và tải PDF đã ký vẫn phụ thuộc provider/chứng thư hợp lệ; seed không tạo chúng. Không có kết quả đăng ký chính thức VNeID. MinIO hiện chạy trên máy local, nên ảnh/PDF cần backend và MinIO cùng hoạt động. Không tuyên bố đã kiểm thử thao tác trên điện thoại thật.
