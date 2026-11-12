# Resident onboarding trước tài khoản

BR-01/04/05, UC-13: POST /api/v1/capture/residents thêm email bắt buộc, tối đa 256 ký tự. Email được chuẩn hóa trim/lowercase; mỗi Resident giữ contact identity độc lập users. Thiếu/sai email trả 400, email đã liên kết Resident khác trả 409. Staff chỉ thao tác Location hiện được phân công; Owner có phạm vi quản trị.

Identity OCR/confirmation không tạo login account. Confirmed identity vẫn AES-GCM/HMAC; ảnh CCCD tạm không upload MinIO. Family representative/co-occupants hoặc friends separate contracts giữ nguyên.

Mobile onboarding và route thêm Resident đều có email field; validation chặn email trùng trong nhóm và giữ form khi lỗi. Tài khoản/invitation thực hiện sau Main Active theo BR-01/02; không thay thế ký anonymous bằng account seed.
