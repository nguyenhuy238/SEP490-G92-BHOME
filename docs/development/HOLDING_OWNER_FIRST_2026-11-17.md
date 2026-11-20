# Holding: hai bên ký theo bất kỳ thứ tự nào — cập nhật 18/11/2026

## Phạm vi và nguồn

Thực hiện task người dùng “CHỈNH SỬA LUỒNG HOLDING HIỆN CÓ — KHÔNG XÂY DỰNG LẠI HỆ THỐNG”. Người dùng xác nhận Holding nằm trên Mobile và màn nhập tên nằm trước CCCD; thay đổi Mobile giới hạn trong các nhánh Holding tương ứng.

Quyết định mới ngày 18/11/2026: người dùng xác nhận **Owner hoặc Tenant đều được ký trước; Tenant nhận email ngay khi Staff gửi hợp đồng**. Quyết định này thay thế yêu cầu Owner-first của task ban đầu. Tên file được giữ để các liên kết báo cáo trước vẫn hoạt động.

Traceability: BF-03A/B, BF-04, UC-13/14/15, GBR-01..04, DBR-02/03/08, JOB-05; mapping tham chiếu `docs/development/HOLDING_CONTRACT_PHASE2.md`, `docs/api/HOLDING_OWNER_WEB.md`, `docs/api/ANONYMOUS_CONTRACT_SIGNING.md`. Quyết định mới của người dùng thay thế thứ tự approval/ký Holding trong tài liệu cũ. Không quyết định lại thời hạn Holding hoặc các OQ ngoài phạm vi.

## Hành vi sau sửa

1. Mobile chọn phòng → CCCD qua IdentityWizard hiện có → xác minh Resident → tạo Holding. Bỏ bước nhập tên riêng; giữ wizard mounted khi Back/Next cùng phòng để giữ state. Dùng label phòng sẵn có cho capture API; tên xác minh vẫn lấy từ CCCD. Giữ cơ chế chống tạo Resident trùng.
2. Staff gửi lời mời: lưu email vào invitation hiện có và gửi email/token/OTP cho Tenant ngay, không đợi Owner ký. Retry cùng snapshot/email trả lại invitation cũ; thay đổi email của invitation còn hiệu lực bị từ chối.
3. Owner nhận notification chưa đọc, mở đúng Contract và ký qua router/adapter hiện có. Không cần approve trước. Kiểm tra phòng, giá, snapshot, quyền ký vẫn ở BE.
4. Owner và Tenant đều có thể ký trước. Lời mời đang hoạt động giữ nguyên token, OTP, PDF review; chữ ký Owner hoàn tất không làm gửi lại email/OTP hoặc xoay token. Trạng thái `AwaitingOwnerSignature` chỉ còn được xử lý để tiếp tục lời mời cũ, không được tạo mới.
5. Tenant ký qua link/OTP/chữ ký hiện có. Owner ký trước khi tạo invitation: Tenant review PDF đã ký. Invitation có trước: Owner dùng đúng PDF review của invitation. Owner đã bắt đầu ký trước invitation: lưu source PDF cùng artifact chữ ký để không phụ thuộc PDF render lại. Nếu hai bên hoàn tất đan xen trên cùng source hash, renderer append bằng chứng Tenant đã lưu vào PDF Owner đã ký; kiểm tra snapshot, source hash và hash ảnh chữ ký trước khi ghép. Không cần bên nào ký lại; test mật mã kiểm tra chữ ký Owner vẫn hợp lệ sau append.
6. Thanh toán được BE xác minh; activation vẫn yêu cầu đủ chữ ký, đúng tiền, snapshot, thời hạn, không xung đột phòng. Contract Active và Room OnHold như cũ.
7. Publisher đọc audit đã commit để xếp email xác nhận vào OUTBOX hiện có. Worker kiểm tra lại Active, OnHold, chữ ký và tổng allocation VERIFIED trước khi gửi.

Không tự gán `Contract.ApprovedAt/ApprovedByUserId`. Endpoint approve cũ vẫn giữ nguyên cho client cũ. Holding đã approve tiếp tục dùng dữ liệu giá đã được chấp thuận; bằng chứng Tenant đã ký theo thứ tự cũ vẫn có đường hoàn tất Owner. Không đổi signing mode đã chọn, HTTP API, database schema, package hoặc signing/email provider.

## Các file thay đổi

Đường dẫn dưới đây tương đối từ repository root; chỉ liệt kê thay đổi của task này, không bao gồm các thay đổi đã tồn tại trong workspace.

- `packages/client-core/src/{contracts.ts,internalSigning.ts}`: điều kiện action Holding và nhãn/lỗi lời mời chờ Owner.
- `src/mobile/src/features/contracts/{ContractDraftForm.tsx,HoldingProgress.tsx,holdingSteps.ts,ContractSigningStep.tsx,HoldingContractFlow.tsx,HoldingSigningConfirmation.tsx,HoldingSandboxFlow.tsx}`: chuyển bước CCCD, gửi lời mời, bỏ approval gate riêng cho Holding, cho hai bên ký trước trong real/sandbox.
- `src/owner-web/src/features/contracts/{ContractDetailPanel.tsx,InternalSigningPanel.tsx,HoldingDepositPanel.tsx}`: ẩn action approve Holding, cho Owner ký trước hoặc sau Tenant, cho gửi email khi Owner chưa ký.
- `src/backend/BHome.Application/Contracts/{ContractHoldingService.cs,ContractWorkflowService.cs,ContractService.cs}`: validation/giá/activation, thứ tự ký, ghi bằng chứng Owner, tải PDF đang chờ Tenant và gọi notifier sau commit.
- `src/backend/BHome.Application/Contracts/{AnonymousContractSigningService.cs,AnonymousSigningContracts.cs,ContractSigningMethods.cs}`: invitation chờ Owner, dispatch invitation hiện có, BE guard, bằng chứng Tenant và hợp đồng renderer/notifier nội bộ.
- `src/backend/BHome.Application/PaymentsDebt/{ContractDepositInstructionsService.cs,DepositReceiptAllocation.cs,SePay/SePayService.cs}`: thay gate approval bằng approval cũ hoặc chữ ký Owner hợp lệ; giữ logic phân bổ/đối soát.
- `src/backend/BHome.Api/Controllers/PaymentsDebt/SePayHoldingPreviewController.cs`: Tenant mô phỏng có thể ký trước Owner; QR/activation vẫn cần đủ hai bên, giữ route cũ.
- `src/backend/BHome.Infrastructure/Contracts/{OtpContractSigning.cs,InternalAcceptanceRenderer.cs}`: nối notifier tới invitation hiện có; PDF append mode riêng cho Holding.
- `src/backend/BHome.Infrastructure/Modules/Notifications/{CompactNotificationEvents.cs,NotificationEmailContent.cs,NotificationChannelWorker.cs,EmailTemplate.cs,MailKitEmailSender.cs}`: event mapping, email xác nhận, OUTBOX delivery và subject chính xác. MailKit chỉ truyền eventType cho template; không viết lại transport.
- Mobile tests: `src/mobile/src/__tests__/{contract-signing-step,holding-draft,holding-new-tenant,holding-progress,holding-sandbox-flow,holding-signing-flow}.test.tsx`.
- Owner Web test: `src/owner-web/src/features/contracts/InternalSigningPanel.test.tsx`.
- Backend tests: `tests/backend/BHome.Application.UnitTests/Contracts/{ContractServiceTests.cs,AnonymousSigningSecurityTests.cs}`, `tests/backend/BHome.IntegrationTests/Contracts/ContractVisibleSignatureTests.cs`, `tests/backend/BHome.IntegrationTests/Notifications/EmailTransportTests.cs`, `tests/backend/BHome.IntegrationTests/Compact24/HoldingNotificationTests.cs` (mới).

## Notification và email

- `InviteAsync` ghi audit `HoldingSigningSubmitted` cùng transaction thành công. `CompactNotificationEvents.Audits` phát `HOLDING_OWNER_SIGNING_REQUIRED` cho đúng `OwnerSignerId`, channel IN_APP, target Contract. Dùng unread/count/navigation hiện có; không thêm mapping FE riêng. Khóa chống trùng: `holding-owner-signing:{contract.Id}:{snapshotHash}`.
- Kích hoạt thủ công/tự động cùng được bắt qua audit `HoldingActivated` và `Automatic:HoldingActivated`. Chỉ tạo OUTBOX sau khi audit có thể đọc được từ transaction đã commit. Khóa chung: `holding-confirmed:{contract.Id:N}`; unique constraint hiện có chặn webhook/job lặp.
- `NotificationEmailContent.HoldingConfirmationAsync` lấy đúng `RecipientEmail` của invitation đã Accepted, chưa revoked, khớp Resident và snapshot. Không fallback sang email tài khoản khác. Tên Tenant dùng dữ liệu CCCD đã xác nhận; không ghi thông tin đó vào log/outbox.
- `NotificationChannelWorker` → `NotificationChannelProvider` → `MailKitEmailSender` → cấu hình SMTP hiện có. Subject: **BHOME – Xác nhận giữ chỗ thành công**.
- Dùng lease, trạng thái delivery và retry hiện có. Lỗi transient đã biết an toàn có thể retry; SMTP không xác định đã nhận hay chưa chuyển `PendingReview`, không tự gửi lại để tránh trùng. SMTP không cung cấp bảo đảm exactly-once; khóa OUTBOX ngăn tạo nhiều delivery cho cùng activation.
- Email lỗi không rollback activation. Không gửi xác nhận ở draft, lúc mới ký, hoặc lúc hiện QR. Development demo không gửi email xác nhận thật.

## Kiểm tra đã chạy

- PASS: `dotnet build src/backend/BHome.Api/BHome.Api.csproj --no-restore --verbosity minimal` — 0 warnings/errors.
- PASS: `dotnet test tests/backend/BHome.Application.UnitTests/BHome.Application.UnitTests.csproj --no-restore --filter 'FullyQualifiedName~Contracts' --verbosity minimal` — kết quả cập nhật ở phần kiểm tra ngày 18/11 bên dưới.
- Integration project, filter `FullyQualifiedName~HoldingNotification|FullyQualifiedName~HoldingSubmission|FullyQualifiedName~HoldingActivationQueues|FullyQualifiedName~EmailTransportTests|FullyQualifiedName~ContractVisibleSignatureTests|FullyQualifiedName~SePayHoldingPreviewGuardTests`; kết quả cập nhật ở phần kiểm tra ngày 18/11 bên dưới.
- PASS: Mobile `vitest run` với filter `holding` và `contract-signing-step` — 101 passed; `npm.cmd run typecheck --prefix src/mobile`; `npm.cmd run lint --prefix src/mobile`.
- PASS: Owner Web focused test files `InternalSigningPanel.test.tsx`, `Contracts.test.tsx`, `OwnerSigningPanel.test.tsx`, `AnonymousSigningPage.test.tsx`, `HoldingSettingsPage.test.tsx` — 40 passed; `npm.cmd run build --prefix src/owner-web`; `npm.cmd run lint --prefix src/owner-web`. Lint còn warning có sẵn ở `DigitalSigningPage.test.tsx:103` về biến navigate; exit code 0. Build bao gồm typecheck.
- Chạy test chữ ký PDF thật với append mode và kiểm tra subject email/CRLF. Không suy diễn thành kiểm chứng MySign production hoặc email Gmail thực tế.

Kết quả ngày 18/11/2026 cho yêu cầu ký bất kỳ thứ tự nào: 113 unit Contracts PASS; 40 integration PASS, 2 SKIP; 101 Mobile PASS; 40 Owner Web PASS. Bổ sung kiểm tra Tenant ký trước, Owner ký trước, invitation tạo trong lúc Owner đang ký, token/email/OTP không đổi khi retry và PDF render lại khác bytes, từ chối source hash sai, ghép ảnh chữ ký đã lưu mà vẫn giữ nguyên tính hợp lệ chữ ký PDF Owner.

## Chưa kiểm chứng và giới hạn

- Hai test PostgreSQL mới (Owner inbox/dedup/target và email activation/SMTP failure) đã compile nhưng SKIP vì thiếu `BHOME_COMPACT24_TEST_ADMIN` cho DB dùng một lần. Không chạy migration/reset trên DB thật.
- NOT TESTED: toàn bộ 14 bước trên thiết bị/trình duyệt nối DB thật; Gmail mailbox, webhook ngân hàng và MySign production. Không dùng CCCD/email/thanh toán thật để tạo bằng chứng test.
- Email xác nhận mới cần invitation đã Accepted để chứng minh địa chỉ Staff nhập. Holding legacy hoặc external hai tài khoản không có invitation này giữ luồng ký cũ, nhưng email xác nhận bị Suppressed; không tự chọn email tài khoản thay thế.
- Main/Renewal giữ nhánh Tenant-first và renderer mặc định. Các test hợp đồng hiện có trong filter Contracts và test UI Main vẫn chạy; không tuyên bố đã kiểm thử toàn hệ thống.
- Không có migration/config mới. Deployment vẫn cần bật notification automation/channel/email và cấu hình SMTP hợp lệ như hệ thống hiện có.
