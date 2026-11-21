# Gửi lại email mời ký — 18/11/2026

Nguồn: yêu cầu người dùng cho phép gửi lại email sau lần đầu; phạm vi BF-03/04, UC-14/15, GBR-01..04. Nút trước đây bị ẩn khi có invitation đang hoạt động để ngăn tạo trùng; việc gửi lại chưa có thao tác riêng.

- Mobile Holding giữ nút **Gửi lại email** khi Tenant chưa ký và có lời mời chưa hết hạn/thu hồi. Hiển thị trước khi gửi rằng link và OTP mới thay thế lần trước. Chỉ Owner/Staff được gửi trong phạm vi quyền hiện có; Staff không ký thay Owner/Tenant.
- Tái sử dụng `POST /api/v1/contracts/{id}/signing-invitations`, bổ sung trường tùy chọn `resend: true` (mặc định false). Client cũ giữ nguyên tính idempotent: gọi lặp không tự gửi thêm email.
- Theo yêu cầu bổ sung cùng ngày, Mobile giữ ô **Email nhận lời mời mới** sau lần gửi đầu. Để trống dùng lại email hiện tại; nhập email khác sẽ sửa địa chỉ nhận của người đại diện. Backend kiểm tra định dạng, quyền Owner/Staff và giới hạn gửi hiện có; không cho đổi email co-occupant qua thao tác này. Gửi lại giữ invitation ID, PDF/hash và expiry đã review, không render lại PDF dù Owner vừa ký.
- Địa chỉ trong invitation là dữ liệu chờ xác thực phục vụ gửi email/OTP, không tự cập nhật hồ sơ. Chỉ `AcceptAsync` hoàn tất xác thực session OTP, consent đúng PDF và chữ ký mới gán `Resident.ContactEmail` từ invitation đã ký trong cùng transaction. Gửi lỗi, nhập email sai, mới gửi hoặc chỉ xác nhận OTP đều giữ nguyên email hồ sơ. Token/session cũ bị vô hiệu khi sửa email; email đã ký không thể bị sửa bằng resend. Không thay email đăng nhập của tài khoản hiện có.
- Tái sử dụng giới hạn OTP hiện có: ít nhất một phút giữa lần gửi, tối đa 5 lần trên lời mời. Giới hạn kiểm tra trong transaction phòng; FE khóa nút khi request đang chạy và trong thời gian chờ. Server vẫn áp dụng giới hạn khi mở lại app hoặc client khác gọi.
- Token và OTP được xoay, phiên OTP đã xác minh bị vô hiệu hóa. Link/OTP cũ không dùng tiếp được. Không lưu raw token vào persistence hoặc đưa vào UI Staff.
- SMTP dùng service và bảo mật hiện có. Delivery key của resend có số lần gửi để tránh bị idempotency provider coi là lần gửi cũ. Audit `InternalSigningInvitationResent` thay cho lặp sự kiện yêu cầu Owner ký, không tạo notification Owner trùng. Email lỗi không tự ghi thành công.
- Không gửi lại sau Tenant đã ký, lời mời hết hạn/thu hồi hoặc snapshot/contact thay đổi. Kết quả chưa xác định do mạng phải kiểm tra trạng thái trước, không gửi lặp tự động.

Kiểm thử cập nhật: backend Contracts 143 PASS; hai file Mobile `contract-signing-step` và `holding-signing-flow` 39 PASS. Bao gồm gửi đầu lỗi SMTP rồi sửa email, định dạng email sai, giới hạn phút/số lần, giữ ID/hash/expiry, token cũ không mở được, session cũ bị xóa, chỉ lưu email hồ sơ sau ký, không gửi thêm do gọi lặp thông thường, không sửa bằng chứng sau ký; UI có ô sửa email, gửi lại địa chỉ hiện tại hoặc địa chỉ mới và chống double tap. Không gửi email thật trong test.

Không thêm service, endpoint, bảng hoặc migration; đây là mở rộng DTO tương thích ngược trên API đang có.
