# Holding bước 6: Owner xác nhận thật, Tenant ký qua email

Yêu cầu ngày 13/11/2026 thay thế cơ chế mô phỏng cả hai bên trước đó. Phạm vi BF-03/BF-04, UC-15/16, GBR-04: chỉ Owner/Tenant thực hiện chấp thuận thật; Staff hỗ trợ trong cơ sở được phân công. Tái sử dụng luồng INTERNAL_OTP_DRAWN đã có theo yêu cầu hiện tại; đây là chấp thuận điện tử nội bộ, không phải chữ ký số CA/MySign. Không thay đổi luồng ký số bên ngoài hoặc nghiệp vụ thanh toán.

## API hiện có được sử dụng

- `POST /api/v1/contracts/{id}/holding-approval`: Owner duyệt Holding. Phê duyệt chưa phải ký.
- `GET /api/v1/contracts/{id}/internal-signing`: trạng thái ký. Owner xem hợp đồng của mình. Staff chỉ xem Holding đã duyệt trong cơ sở đang được phân công, email đã che, không trả token hoặc documentHash cho Staff.
- `POST /api/v1/contracts/{id}/signing-invitations`: tạo lời mời và gọi dịch vụ email thật. Owner giữ quyền cũ; Staff chỉ được hỗ trợ gửi trên Holding đã duyệt trong phạm vi phân công. Backend chặn lời mời Staff trùng đang còn hiệu lực. Staff không nhận token. Body `{snapshotHash, expiresAt}`; thời gian UTC, trong 24 giờ theo API hiện có.
- `POST /api/v1/contract-signing/info`: đọc lời mời bằng token từ fragment liên kết email.
- `POST /api/v1/contract-signing/otp`: gửi OTP thật qua email.
- `POST /api/v1/contract-signing/verify`: xác minh OTP, cấp phiên xem/ký ngắn hạn. Chưa đánh dấu Tenant đã ký.
- `POST /api/v1/contract-signing/document`, `/document/layout`, `/document/pages/{page}`: đọc đúng tài liệu trong phiên OTP.
- `POST /api/v1/contract-signing/accept`: lưu đồng ý, nét ký và bằng chứng tài liệu của Tenant.
- `POST /api/v1/contracts/{id}/internal-signing/owner-confirmation`: chỉ Owner của hợp đồng gọi, body `{documentHash, consent:true, consentVersion:"internal-acceptance-v1"}`. Luồng thật yêu cầu Tenant ký trước, kiểm tra đúng tài liệu rồi lưu xác nhận Owner. Staff luôn bị từ chối.
- `POST /api/v1/integrations/sepay/testing/holdings/{id}/simulation/signatures`: chỉ nhận `{participant:"Tenant", simulationOnly:true}`. Gửi participant Owner bị 403. Không tạo chữ ký Tenant pháp lý.
- API QR/kiểm tra cọc/hoàn tất Test Mode giữ nguyên đường dẫn và điều kiện tiền cọc đã xác minh.

## Hoàn tất bước 6

Luồng thật: bằng chứng ký Tenant và xác nhận Owner phải hợp lệ với snapshot hiện tại; backend trả `canContinue:true`. OTP đã xác minh mà chưa `/accept` vẫn chờ ký. Mobile không suy đoán từ việc bấm nút hay email đã gửi.

Sandbox: Tenant được mô phỏng riêng trong metadata; Owner vẫn phải đăng nhập Web và tự gọi API owner-confirmation. API này có nhánh test được kiểm soát, lưu OwnerConfirmedBy/OwnerConfirmedAt, chuyển PendingActivation; không tạo bằng chứng Tenant thật. Backend trả cả `canContinue` và `canShowQr`; Mobile kiểm tra cả hai trước khi mở QR. Cờ OwnerAt mô phỏng cũ không được tin cậy. Nút mô phỏng Tenant không tự mở QR. Luồng kích hoạt thật vẫn yêu cầu bằng chứng thật.

## Bật/tắt Sandbox

Mobile phải là development build, hợp đồng là development demo và API kiểm tra khả năng Sandbox thành công. Backend yêu cầu Development/Testing, SePay bật và Test Mode hợp lệ, database loopback sandbox đúng định dạng; hoặc Neon được opt-in rõ bằng `HoldingTesting:Enabled`, chính xác host/database, TLS VerifyFull + ChannelBinding Require và location trong danh sách cho phép. Hiện cấu hình Neon local chỉ cho BHOME JOB09 TEST. Production/Live/non-demo/ngoài phân công bị chặn. Bỏ HoldingTesting Enabled để tắt opt-in Neon; không đánh dấu lại hợp đồng cũ.

## Email local và cách kiểm tra

Nguyên nhân cấu hình: profile Neon có SMTP nhưng thiếu `AnonymousSigning__OtpHmacKey` và `AnonymousSigning__PublicSigningUrl`. Đã bổ sung khóa ngẫu nhiên riêng trong các profile ignored, không đưa vào Git. URL trang ký hiện được lấy từ tunnel HTTPS Owner Web; tunnel tạm thay đổi thì phải cập nhật PublicSigningUrl và restart API. Không gửi mật khẩu/OTP/token vào log.

Đã kiểm tra OTP key hợp lệ, dịch vụ email được cấu hình, link HTTPS hợp lệ; SMTP Gmail STARTTLS và xác thực thành công. Không gửi email đến Tenant thực trong kiểm tra cấu hình này. Kiểm thử tích hợp sử dụng hộp thư giả lập để kiểm tra nội dung lời mời, OTP, ký và quyền. Việc email thật tới Inbox/Spam cần kiểm tra khi người dùng thực hiện gửi trên UI. `InvitationAcceptedByProvider` chỉ có nghĩa dịch vụ tiếp nhận, chưa chứng minh tới Inbox.

## Bấm ở đâu để test

1. Owner Web → **Hợp đồng** → chọn Holding → xem đúng tài liệu/điều khoản → **Phê duyệt hợp đồng giữ chỗ** (thao tác phê duyệt hiện có).
2. Mở phần **Ký nội bộ qua OTP** trong chi tiết. Tích **Tôi đã đọc đúng PDF và đồng ý nội dung hợp đồng** → **Duyệt và tạo lời mời ký**. Hoặc Staff tại Mobile bước 6 bấm **Gửi thông báo ký hợp đồng**. Chỉ chọn một cách; không gửi trùng lời mời đang còn hiệu lực.
3. Người giữ chỗ mở email **BHOME — Lời mời ký hợp đồng** → mở link → **Gửi mã OTP** → nhập 6 số nhận qua email → **Xác minh và xem hợp đồng** → đọc tài liệu → vẽ chữ ký → tích đồng ý → bấm **Chấp thuận hợp đồng**.
4. Owner quay lại chi tiết, phần **Ký nội bộ qua OTP** sẽ tự cập nhật mỗi 5 giây; có thể bấm **Cập nhật trạng thái ký**. Sau Tenant ký, tích đồng ý và bấm **Xác nhận chấp thuận của Owner**. Đây mới là xác nhận Owner, không phải nút phê duyệt trước đó.
5. Mobile hiển thị Owner đã xác nhận và thời gian; backend đủ điều kiện mới cho tiếp tục QR. Sandbox: bấm **Tiếp tục: tạo QR**. Dùng đúng số tiền/mã backend cấp để kiểm thử SePay; không chuyển tiền thật vào tài khoản Test Mode.
6. Muốn test không ký Tenant thật: tạo Holding demo tại cơ sở test, sau duyệt bấm **Mô phỏng người giữ chỗ đã ký** trên Mobile. Owner Web sẽ có cảnh báo Tenant mô phỏng; Owner tích đồng ý rồi bấm **Xác nhận chấp thuận của Owner**. Mobile chỉ mở nút QR sau phản hồi backend. Không gọi đây là chữ ký Tenant thật.

Nếu gửi email thất bại hoặc lời mời chưa giao được: xem trạng thái trên Web, kiểm tra SMTP/cấu hình, **Thu hồi lời mời chưa ký**, sau đó tạo lại. Nếu chỉ xác minh OTP mà chưa ký, UI vẫn báo chờ ký.

## Thành phần thay đổi trong yêu cầu này

- Mobile: `HoldingSigningConfirmation.tsx` (mới), `HoldingSandboxFlow.tsx`, `HoldingContractFlow.tsx`.
- Owner Web: `InternalSigningPanel.tsx` (polling, trạng thái email, cảnh báo Tenant mô phỏng, xác nhận Owner).
- Client: `internalSigning.ts`, `holdingSandbox.ts`.
- Backend: `AnonymousContractSigningController.cs`, `AnonymousContractSigningService.cs`, `AnonymousSigningContracts.cs`, `SePayHoldingPreviewController.cs`, `HoldingTestScope.cs`.
- Tests: `holding-sandbox-flow.test.tsx`, `holding-signing-flow.test.tsx`, `AnonymousSigningTests.cs`, `SePayIntegrationTests.cs`.

Kiểm tra đã chạy: 17 backend tests (không skip), gồm luồng email/OTP/ký thật, Staff chỉ gửi Holding trong phạm vi, không lộ token, không ký thay Owner, OTP chưa đủ, QR cần Owner thật và cọc đã xác minh; 33 Mobile tests; 21 Owner Web tests. Typecheck và lint Mobile/Owner Web đều đạt. Build API đạt, không cảnh báo/lỗi. Trang ký HTTPS trả 200; API Neon đăng nhập và trả đúng cơ sở/phòng.

Trang ký HTTPS local hiện tại: https://types-talented-grid-bruce.trycloudflare.com/contract-signing (liên kết mời thực có token riêng trong fragment; không chia sẻ công khai).
