# Xác nhận email trước khi khôi phục mật khẩu

## Chẩn đoán và quyết định

Ngày 12/11/2026, kiểm tra read-only database Development cho thấy tài khoản được người dùng báo lỗi đang hoạt động nhưng chưa xác nhận email; không có reset grant hoặc authentication email outbox. `IdentityPasswordService` giữ điều kiện EmailConfirmed nên phản hồi 202 chung mà không gửi SMTP. Đây chưa phải bằng chứng Gmail từ chối thư.

Chủ dự án đã chọn rõ: **thêm luồng xác nhận email bằng liên kết, sau đó cho phép quên mật khẩu**. Không cập nhật thủ công cờ xác nhận. Không thay đổi điều kiện đăng nhập của tài khoản hiện có.

Traceability: yêu cầu bổ sung đã duyệt trong hội thoại → FE-02/UC-01..02, GBR-02/13/18, JOB-04 và phần 5.3 của yêu cầu Authentication Email → IEmailVerification, EmailVerificationService, AuthenticationEmailDelivery, auth controller, client-core, Owner Web/Mobile → kiểm thử xác nhận một lần, hết hạn/superseded/email thay đổi, invitation isolation, generic response, cooldown, SMTP retry và recovery sau xác nhận.

## Thiết kế

- Hai POST `/api/v1/auth/request-email-verification` và `/api/v1/auth/confirm-email`; dùng Auth rate limit, transport/origin guard, validation và response no-store.
- Request trả 202 chung cho tài khoản không tồn tại, inactive, đã xác nhận hoặc đang chờ invitation. Không tiết lộ account existence.
- Identity sinh/kiểm tra email-confirmation token. Token được bảo vệ trong durable authentication outbox; metadata chỉ chứa hash và expiry. Không tái sử dụng reset/invitation grant, không đổi mật khẩu/session/role/status.
- Chỉ liên kết mới nhất được dùng, có thời hạn bằng Sessions.PasswordResetMinutes; cooldown AuthenticationEmail.ResendCooldownSeconds. Khi email/stamp/status thay đổi hoặc invitation xuất hiện, link cũ không dùng được.
- Invitation grant chưa dùng và provisioning invitation job chặn verification, giữ bước setup được Owner phê duyệt. Confirmation không thay thế invitation acceptance.
- Callback mới là cấu hình riêng; không cấu hình verification không làm hỏng reset/invitation đang hoạt động. Development dùng User Secrets; Production dùng URL HTTPS đã cho phép.
- Không đổi schema, không thêm dependency, không bật business automation.

## Kiểm chứng

- API Release build: passed, 0 warnings/errors.
- 50 test backend auth/notification/verification: passed, không fail/skip, PostgreSQL disposable. Trong đó một test Gmail thật xác nhận cả hai email tới INBOX qua exact Message-Id, sử dụng link xác nhận → link reset → login bằng mật khẩu mới, từ chối token reuse. Không thay đổi mật khẩu tài khoản người dùng.
- Owner Web: 21 test xác nhận/recovery/login/SessionClient security passed (16 + 5); Mobile: 8 test recovery/invitation/verification passed. Typecheck và lint cả hai client passed. Owner Web production build passed, còn cảnh báo chunk lớn hơn 500 kB.
- Lượt test ban đầu có lỗi test do sửa event payload bất biến và dữ liệu Owner dùng chung. Đã sửa test sang TimeProvider và Tenant riêng, chạy lại các test liên quan passed.
- Filter ban đầu quá rộng chọn cả legacy authentication fixture: nhiều test trả 500. Đã kiểm tra lại một test đại diện `EveryBearerRequestRevalidatesTheSessionInsteadOfCachingPermission` bằng Debug test binary có từ trước thay đổi (`--no-build`): cùng lỗi 500. Không sửa legacy fixture ngoài phạm vi; không khẳng định toàn bộ suite backend passed.
- Package client-core không có npm test script; kiểm tra SessionClient bằng test ở Owner Web.
- Cấu hình callback mới đã lưu trong User Secrets local, không commit secrets. Đã dừng/chạy lại đúng API Visual Studio và probe HTTPS readiness passed với CA hợp lệ.
- Gọi endpoint mới một lần cho tài khoản người dùng đã báo lỗi: HTTP 202; outbox EMAIL_CONFIRMATION_REQUESTED chuyển Sent sau một claim, có provider receipt, không có error code. Đây là SMTP accepted, chưa xác nhận INBOX của người dùng; bước bấm link xác nhận do chủ email thực hiện. Không sửa trực tiếp dữ liệu tài khoản.
