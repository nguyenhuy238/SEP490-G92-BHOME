# Thông báo và tệp đính kèm sau kích hoạt Holding

Phạm vi BF-03/04/06, UC-14/15/22..25, GBR-01..04/10. Nguồn bổ sung là yêu cầu người dùng gửi thông báo Owner và email Tenant kèm hợp đồng, chứng từ sau kích hoạt Holding. Trước sửa, `HOLDING_CONFIRMED` chỉ gửi nội dung chữ tới email trong lời mời đã ký; nhánh audit kích hoạt không tạo inbox riêng cho Owner.

- `CompactNotificationEvents` phát `HOLDING_ACTIVATED` vào inbox đúng Owner, liên kết Contract, chưa đọc, khóa ổn định theo hợp đồng. Hai audit kích hoạt thủ công/tự động không tạo trùng. Không thêm email Owner.
- Outbox `holding-confirmed:{id}` và worker hiện có tiếp tục gửi tới `RecipientEmail` của lời mời đã Accepted, cùng snapshot và người đại diện. Không dùng email nhập thử, email tài khoản dự phòng hoặc tài khoản Staff. Chỉ gửi khi Holding Active, phòng OnHold, đủ bằng chứng ký và tổng tiền đã xác minh đúng nghĩa vụ.
- `NotificationEmailContent` đọc nguyên bản PDF cuối đã ký từ object storage, kiểm tra contract prefix, invitation/snapshot/Owner và SHA-256; không render lại hay chỉnh PDF đã ký. Thiếu file thì chờ thử lại trước gửi; file bị thay đổi thì dừng lỗi toàn vẹn. Không gửi email thiếu tệp một cách im lặng.
- Tạo biên nhận PDF bằng iText và font tiếng Việt đã có trong repo. Nội dung gồm hợp đồng, người giữ chỗ, cơ sở/phòng, thời hạn, các khoản phân bổ từ payment VERIFIED, ngày giao dịch, tham chiếu và tổng tiền. Không tạo Invoice tiền thuê, số hóa đơn thuế hay nghĩa vụ thanh toán mới cho khoản cọc Holding.
- `ChannelMessage` thêm danh sách attachment tùy chọn. Worker truyền hai PDF cho MailKit; multipart MIME chứa nguyên bytes, filename an toàn, giới hạn kích thước/số file và kiểm tra loại PDF. Các email khác giữ hành vi cũ.
- SMTP lỗi không hủy Active/OnHold; outcome chưa rõ vẫn PendingReview theo cơ chế hiện có, không tự gửi lặp. Outbox đã Sent không tự phát lại sau cập nhật. Bản cập nhật áp dụng cho các lần kích hoạt/gửi sắp tới; email cũ không thể được bổ sung tệp sau khi gửi.

Files chính: `NotificationChannels.cs`, `CompactNotificationEvents.cs`, `NotificationEmailContent.cs`, `NotificationChannelWorker.cs`, `MailKitEmailSender.cs`; regression ở `HoldingNotificationTests.cs` và `EmailTransportTests.cs`.

Kiểm tra hiện trạng local: P.103 đã có outbox Sent (SMTP tiếp nhận, không khẳng định đã vào inbox), nhưng chưa có inbox HOLDING_ACTIVATED trước sửa. Không phát lại email thật hoặc sửa trạng thái thanh toán để kiểm thử.

Xác minh: bộ integration notifications/email 112 PASS, không skip, database PostgreSQL tạm trên loopback. Bao gồm dedup, đúng Owner và target Contract, đúng email lời mời, PDF hợp đồng nguyên bytes, biên nhận đủ thông tin, SMTP outcome chưa rõ và chặn file sai hash. Biên nhận mẫu tổng hợp đã render PNG và kiểm tra font/hiển thị trực quan. Không thêm migration, endpoint hay dependency.

Sau bổ sung nhánh file chưa có, chạy lại riêng `HoldingActivationQueuesOneConfirmation`: 4/4 PASS (gửi thành công, SMTP chưa rõ, sai hash, thiếu tệp). Thiếu tệp giữ Pending để retry và không gọi provider; sai hash PermanentlyFailed. API cập nhật đang chạy và health readiness Healthy.
