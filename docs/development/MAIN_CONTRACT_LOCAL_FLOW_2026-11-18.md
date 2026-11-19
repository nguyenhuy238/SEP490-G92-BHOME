# Hợp đồng chính thức, Holding và PostgreSQL local — 18/11/2026

## Nguồn và tiêu chí

Yêu cầu trực tiếp của người dùng ngày 18/11: dùng DB local; Main bỏ nhập tên hồ sơ và vào CCCD; dùng lại Holding của phòng OnHold cùng Resident/CCCD; mặc định Cá nhân, tối đa một người, Hộ gia đình mới thêm thành viên; Main/Holding ký bất kỳ thứ tự; Staff gửi ký phải thông báo đúng Owner; sau xác minh thanh toán và Main Active gửi thông tin tiền, hợp đồng, tài khoản active và link tự đặt mật khẩu. Người dùng xác nhận không gửi mật khẩu qua email.

Traceability: BF-03/04, UC-13/14/15, GBR-01..04, DBR-02/03/08; xác minh thanh toán theo BF-06/UC-22..25. Dùng luồng conversion, ký, provisioning, notification/outbox hiện có; không thêm endpoint, schema hoặc provider.

## Kết quả và điểm nối

- Runtime dùng `.env` và PostgreSQL Docker local hiện có. Đồng bộ `ConnectionStrings:Database` của Development user-secrets về local cho F5. Không thay dữ liệu/schema local; không dùng profile Neon. Cloudflare tiếp tục chuyển tiếp tới API chạy trên máy.
- `OnboardingScreen`, `OnboardingPeopleStep`, `MainContractProgress`: chọn phòng → CCCD; bỏ input tên hồ sơ. Dùng label người ở tạm đã được UI hỗ trợ; tên pháp lý vẫn từ CCCD xác nhận. Giữ wizard mounted để Back/Next không tạo lại Resident hoặc mất dữ liệu đang nhập. Giữ các trạng thái timeout/creationUncertain và xác nhận OCR phía server.
- Mặc định Cá nhân. Nút thêm người ở bị khóa khi có một người; handler cũng chặn thêm ở chế độ Cá nhân. Chọn Hộ gia đình trước khi tạo hồ sơ để thêm CoOccupant. Không tự xóa người đã nhập khi chuyển loại; không đổi loại sau khi đã tạo Resident. MainDraftStart áp dụng cùng mặc định cho đường chọn hồ sơ có sẵn.
- Phòng OnHold xuất hiện trong onboarding và contract preparation. Component `HoldingMainStart` dùng danh sách Active trong Location được cấp quyền, lọc Holding đúng phòng, chưa hết hạn/chưa chuyển đổi, đọc chi tiết và CCCD đã xác minh qua preparation hiện có. UI hiển thị tên và CCCD che số; không chụp/quét lại hoặc tạo Resident mới.
- Khi tiếp tục, gọi endpoint `holding-conversion` hiện có với cọc Main cấu hình bởi Owner và yêu cầu thanh toán ban đầu. BE giữ nguyên phòng, danh sách Resident, đại diện, signing/payment mode, ngày/điều khoản/giá đã ký của Holding và phân bổ cọc bằng ledger hiện có. Mở Main được trả về trong luồng hợp đồng hiện có. Retry sử dụng cùng idempotency key cho cùng nguồn.
- `AnonymousContractSigningService`, `ContractWorkflowService`, `ContractService`: Main và Holding cho Owner/Tenant ký trước hoặc sau; Main vẫn phải hoàn tất bước review/release tài liệu hiện có trước khi gửi ký. Chỉ cho hoàn tất khi đủ hai bằng chứng hợp lệ. Invitation/token/OTP đang hoạt động không bị xoay khi bên kia ký. Dùng cùng PDF review và append Tenant evidence khi hai bên hoàn tất đan xen, bảo vệ snapshot/source/image hash. Renewal giữ thứ tự cũ.
- Mobile dùng `ContractSigningStep` cho Main Owner thực, thay nút sandbox confirm. Owner Web mở ký Main trước Tenant. Sandbox giữ phân biệt với bằng chứng ký thật.
- Staff gửi Main ghi `MainSigningSubmitted` trong transaction. `CompactNotificationEvents` phát `MAIN_OWNER_SIGNING_REQUIRED` cho đúng OwnerSignerId, trạng thái chưa đọc, target Contract; khóa `main-owner-signing:{id}:{snapshot}`. Dùng unread count và navigation mapping hiện có.
- Publisher nhận cả `ContractActivated` và `Automatic:ContractActivated`, dùng cùng key publication cho activation lặp. Chỉ đọc audit đã commit. Notification email xác nhận Main đọc Contract Active, Room Occupied, tài khoản IsActive và ledger thanh toán ban đầu; tiền lấy từ allocation thuộc payment VERIFIED, cọc Holding áp dụng hiển thị riêng.
- Tài khoản mới vẫn dùng `PostActivationTenantProvisioning` hiện có, tạo/link một lần trong transaction activation. Native account `IsActive=true`; Tenant tự đặt mật khẩu bằng grant một lần qua `AccountInvitations`. Không cấp mật khẩu mặc định, không tự bỏ xác minh email/consumed grant.
- `AuthenticationEmailDelivery` bổ sung nội dung hợp đồng/tiền đã xác minh vào email thiết lập tài khoản của đại diện Main Active. Email có tài khoản đăng nhập, trạng thái account và link đặt mật khẩu. Khi thiết lập mật khẩu, đường accept-invitation hiện có xác nhận email và cho đăng nhập. Với account đã hoàn tất setup, email `CONTRACT_ACTIVATED` chứa cùng thông tin xác nhận. Account chưa setup được chặn email activation chung để tránh trùng với email có link đặt mật khẩu.
- Dùng worker/outbox/retry và MailKit/Gmail SMTP hiện có; email lỗi không rollback activation. Địa chỉ tài khoản mới lấy từ invitation ký đã Accepted qua provisioning, không tự liên kết account khác chỉ vì trùng email. Các email xác minh/reset/Staff không đổi.

## File thay đổi của đợt này

- Mobile: `screens/OnboardingScreen.tsx`, `features/onboarding/OnboardingPeopleStep.tsx`, `features/contracts/{HoldingMainStart.tsx,MainDraftStart.tsx,MainContractProgress.tsx,ContractSigningStep.tsx}`, `features/owner/OwnerMainContractFlow.tsx`.
- Owner Web: `features/contracts/InternalSigningPanel.tsx` và test tương ứng.
- Application: `Contracts/{AnonymousContractSigningService.cs,ContractService.cs,ContractWorkflowService.cs}`.
- Infrastructure: `Contracts/ContractWorkflowRepository.cs`, `IdentityAccess/AuthenticationEmailDelivery.cs`, `Modules/Notifications/{CompactNotificationEvents.cs,NotificationEmailContent.cs,NotificationChannelWorker.cs}`.
- Tests: Mobile `onboarding-ui.test.tsx`, `holding-main-start.test.tsx`; backend `ContractServiceTests.cs`, `HoldingNotificationTests.cs`, `TenantAccountAutomationTests.cs`.

Không revert/reformat các thay đổi khác đã tồn tại trong workspace.

## Kiểm chứng

- Backend Contracts unit: **117 PASS**, bao gồm Main/Holding Owner-first, Tenant-first và Owner đang ký khi Tenant hoàn tất; giữ token/email/OTP; từ chối source hash sai.
- Integration: **36 PASS, 0 SKIP** trên database PostgreSQL dùng một lần của test fixture. Nhóm `SubmissionNotifiesOnlyDesignatedOwner`, `HoldingActivationQueues`, `AuthOnlyWorkerDispatchesApprovedMain`, `ApprovedExistingTenantLink`, `MatchingEmailWithoutAnApproved`, `ContractVisibleSignatureTests`, `EmailTransportTests`, `MainDraftReleaseBeforeAccountsTests`.
- Test PostgreSQL xác nhận Owner notification dedup/target, Holding SMTP failure không rollback, email Main có số tiền VERIFIED, account active, link đặt mật khẩu dùng một lần và hoàn tất setup; test không dùng Gmail hoặc người nhận thật. Không reset DB ứng dụng local.
- Mobile filter `main onboarding holding contract-signing-step`: **190 PASS**. Sau chỉnh trạng thái tải Holding, chạy lại `holding-main-start main-draft-start`: **8 PASS**. Typecheck và lint PASS.
- Owner Web 4 test files liên quan: **39 PASS**; chạy lại InternalSigningPanel với Main chưa có Tenant acceptance: **6 PASS**. Typecheck PASS.
- Backend build PASS, 0 warnings/errors. Web build và lint PASS (lint còn warning có sẵn ở `DigitalSigningPage.test.tsx:103`). Runtime mới dùng DB local: `/health/live` và `/health/ready` đều HTTP 200 Healthy sau khi khởi động lại.

Chưa kiểm chứng chuyển khoản ngân hàng thật, Gmail delivery thật hoặc toàn bộ thao tác end-to-end trên điện thoại. Điều kiện Active vẫn do BE quyết định; UI không tự báo đã thanh toán từ việc hiển thị QR.
