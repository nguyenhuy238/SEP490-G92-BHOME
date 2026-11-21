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

## Bổ sung hiển thị liên kết email

Người dùng báo thư tới INBOX nhưng không thấy link. Thư Gmail đang mở có dấu thu gọn nội dung; accessibility chỉ biểu diễn nhãn action cũ như text, không có link bấm được. Kiểm tra UI an toàn (chỉ xuất boolean) cho thấy callback thực tế trong thư của tài khoản này là deep link `bhome://confirm-email`, trong khi người dùng đọc Gmail trên máy tính. Web callback Development dùng localhost. Không thay trust policy hay bỏ validation để xử lý vấn đề hiển thị.

Traceability: email xác thực hiển thị thao tác được → yêu cầu Authentication Email §3.1/5.3, FE-02/UC-01..02, JOB-04 → EmailTemplate/MailKitEmailSender → test HTML còn URL đầy đủ sau khi bỏ anchor và kiểm tra HTML nhận thực tế qua Gmail.

Sửa mẫu dùng bảng presentation và inline style, đưa nút có nhãn theo thao tác và đường dẫn đầy đủ có thể sao chép lên trước phần nội dung lặp. Plain text giữ đầy đủ link. Không ghi token/link người dùng vào log, không đổi API, schema, lifetime hoặc trạng thái xác nhận.

Với callback native, nút email dùng Web callback đã cấu hình để mở được trang anonymous confirm/reset/accept trên trình duyệt, giữ native deep link làm lựa chọn phụ. Hai link cùng user/token; không tạo grant thứ hai và không cấp quyền Owner cho Staff/Tenant. Callback Web phải tiếp tục hợp lệ theo trusted origins; không suy từ Host header/caller.

Kiểm chứng lượt sửa hiển thị:

- Build Release và 55 test transport/auth/notification passed, không fail/skip, database PostgreSQL disposable. Lượt test đầu có assertion so sánh nhãn Unicode chưa encode với HTML đã encode; đã sửa assertion và chạy lại passed.
- Real Gmail smoke cuối dùng Tenant tổng hợp, tìm đúng hai email test qua Message-Id, kiểm tra HTML có nút đúng nhãn, href Web nguyên vẹn và URL đầy đủ có thể sao chép trước nội dung lặp; native link vẫn có trong body. Dùng link Web xác nhận → reset → login và từ chối reuse. Test integration cũng so sánh cùng token/user giữa Web/native. Các assertion chỉ xuất mã lỗi an toàn, không xuất HTML/link/token thật.
- Đã chạy API Visual Studio với bản sửa, HTTPS readiness passed. Gửi lại một verification email cho địa chỉ được người dùng cung cấp: HTTP 202, outbox mới Sent sau một claim, không có error code.
- Kiểm tra trực tiếp Gmail sau bản browser fallback: thư mới lúc 21:38 ngày 12/11/2026 có nút Xác nhận email và URL Web đầy đủ đều được accessibility biểu diễn bằng hyperlink, cùng callback localhost đã cấu hình; native link vẫn có trong nội dung. Chỉ xuất boolean và loại node, không xuất URL/token thật, không bấm xác nhận thay người dùng.
- Chỉ tài khoản mailbox test dùng SMTP smoke mới được xác nhận/reset tự động. Tài khoản người dùng vẫn chờ người dùng mở link và xác nhận.

Mẫu dùng inline CSS theo [Gmail CSS support](https://developers.google.com/workspace/gmail/design/css). Hiển thị href do email client quyết định; URL dạng text là fallback bắt buộc, đặc biệt với callback localhost/native trong Development.

## Kết quả triển khai xác nhận email ban đầu

- API Release build: passed, 0 warnings/errors.
- 50 test backend auth/notification/verification: passed, không fail/skip, PostgreSQL disposable. Trong đó một test Gmail thật xác nhận cả hai email tới INBOX qua exact Message-Id, sử dụng link xác nhận → link reset → login bằng mật khẩu mới, từ chối token reuse. Không thay đổi mật khẩu tài khoản người dùng.
- Owner Web: 21 test xác nhận/recovery/login/SessionClient security passed (16 + 5); Mobile: 8 test recovery/invitation/verification passed. Typecheck và lint cả hai client passed. Owner Web production build passed, còn cảnh báo chunk lớn hơn 500 kB.
- Lượt test ban đầu có lỗi test do sửa event payload bất biến và dữ liệu Owner dùng chung. Đã sửa test sang TimeProvider và Tenant riêng, chạy lại các test liên quan passed.
- Filter ban đầu quá rộng chọn cả legacy authentication fixture: nhiều test trả 500. Đã kiểm tra lại một test đại diện `EveryBearerRequestRevalidatesTheSessionInsteadOfCachingPermission` bằng Debug test binary có từ trước thay đổi (`--no-build`): cùng lỗi 500. Không sửa legacy fixture ngoài phạm vi; không khẳng định toàn bộ suite backend passed.
- Package client-core không có npm test script; kiểm tra SessionClient bằng test ở Owner Web.
- Cấu hình callback mới đã lưu trong User Secrets local, không commit secrets. Đã dừng/chạy lại đúng API Visual Studio và probe HTTPS readiness passed với CA hợp lệ.
- Gọi endpoint mới một lần cho tài khoản người dùng đã báo lỗi: HTTP 202; outbox EMAIL_CONFIRMATION_REQUESTED chuyển Sent sau một claim, có provider receipt, không có error code. Đây là SMTP accepted, chưa xác nhận INBOX của người dùng; bước bấm link xác nhận do chủ email thực hiện. Không sửa trực tiếp dữ liệu tài khoản.
