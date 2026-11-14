# Holding Mobile: giao diện và kiểm tra trạng thái

## Nguyên nhân và quy tắc hiện tại

Yêu cầu: sửa chi tiết Holding, phân biệt quyền và trạng thái phê duyệt/ký, giữ API và nghiệp vụ hiện có. Đối chiếu trực tiếp ContractsController, ContractService, ContractHoldingService, AnonymousContractSigningService, ContractRepository/Compact24 và client-core. Không thay đổi enum, schema hoặc quyền backend trong lần sửa này.

- `POST /api/v1/contracts/holdings`: tạo `Draft`, chưa có `approvedAt`. Không có enum `PendingApproval` riêng trong luồng này.
- `POST /api/v1/contracts/{id}/holding-approval`: Owner phê duyệt hợp đồng Draft chưa hết hạn, không xung đột phòng và giá phòng khớp. Lưu `approvedAt`, người duyệt và snapshot giá; vẫn `Draft`.
- `POST /api/v1/contracts/{id}/signing-invitations`: Owner được chỉ định, Holding đã duyệt/chưa hết hạn, snapshot khớp, hồ sơ và cấu hình ký hợp lệ. Tạo lời mời và chuyển `PendingSigning`. Phê duyệt không tự tạo lời mời.
- Gửi email là trạng thái riêng: tạo lời mời không đồng nghĩa email đã được tiếp nhận. UI giữ các nhãn delivery backend, không khẳng định người dùng đã nhận email.
- Public `/api/v1/contract-signing/{info,otp,verify,document,accept}`: người giữ chỗ chưa có tài khoản vẫn ký bằng link, OTP và session. Chấp thuận yêu cầu đúng hash PDF/consent và nét ký; chưa có Owner confirmation thì vẫn `PendingSigning`.
- `POST /api/v1/contracts/{id}/internal-signing/owner-confirmation`: Owner được chỉ định xác nhận đúng tài liệu đã được người giữ chỗ chấp thuận; chuyển `PendingActivation`. Không đánh dấu Active ở bước này.
- `POST /api/v1/contracts/{id}/holding-activation`: vẫn cần điều kiện backend về chữ ký, cọc, hạn giữ chỗ và phòng. UI chỉ thông báo thành công khi đọc được cả contract Active và room OnHold.

Vì vậy Draft sau phê duyệt là trạng thái đúng. Lỗi UI là dùng một badge Draft cho cả tiến trình, cho người dùng chọn bước thủ công và không tải lại contract sau tạo lời mời. Trạng thái PDF preview không phải trạng thái contract.

## Giao diện đã sửa

- Topbar đăng ký tiêu đề “Hợp đồng giữ chỗ”, giữ Back về màn trước và cơ chế refresh/pull-to-refresh của shell.
- Ba tab chia đều chiều ngang: Tổng quan, Ký hợp đồng, Lịch sử. Main giữ các tab hiện có.
- Một khu vực tóm tắt phòng/cơ sở, người giữ chỗ, thời gian, tiền giữ chỗ và nhãn tiến trình.
- Bỏ bộ chọn bước 5–8 thủ công. Draft đã tạo mở bước phê duyệt; approval/PendingSigning mở bước ký; PendingActivation/Active mở bước cọc. Không lưu bước thay thế trạng thái server.
- Bỏ footer Tiếp tục/Quay lại/Làm mới và nút tải lại trạng thái trùng lặp của Holding. Staff chờ duyệt chỉ thấy một thông báo ngắn, không có nút hành động Owner hay PDF.
- Sau thao tác invitation/confirmation/revoke/refresh tiến trình ký, yêu cầu tải lại contract. Khi mở lại, bước và nhãn được tính lại từ contract backend.
- API PDF và internal-signing chi tiết vẫn không mở quyền cho Staff. Staff chỉ thấy tiến trình tổng quát từ status/approvedAt; không tự suy đoán tenantAcceptedAt. Owner thấy riêng lời mời, người giữ chỗ chấp thuận, Owner xác nhận.

## File sửa trong lần này

- `src/mobile/src/features/contracts/ContractScreen.tsx`
- `src/mobile/src/features/contracts/HoldingContractFlow.tsx`
- `src/mobile/src/features/contracts/HoldingProgress.tsx`
- `src/mobile/src/features/contracts/holdingStage.ts` (mới)
- `src/mobile/src/components/WorkspaceShell.tsx`
- Tests: `holding-signing-flow.test.tsx`, `holding-progress.test.tsx`, `holding-stage.test.ts` (mới), `contract-sections.test.tsx`.

## Kiểm tra đã thực hiện

- 57/57 frontend tests trong 7 file: tạo Holding đúng route, form, Staff không gọi Owner PDF/status hay thực hiện quyết định Owner, Draft/approval/PendingSigning/PendingActivation/Active, không gửi lời mời trùng, lỗi cấu hình/transport, consent/hash xác nhận, tải lại và mở lại, gate readiness và OnHold.
- Mobile typecheck và lint đạt.
- 2/2 integration tests `AnonymousSigningTests` đạt trên PostgreSQL loopback/database dùng một lần. Có public OTP/accept, Owner confirmation, cọc, Holding Active/room OnHold, conversion và provisioning. Delivery là test double; không gửi email thật trong lần kiểm thử này.
- Không thay đổi dữ liệu Neon. Chưa kiểm tra trực quan trên emulator/màn hình nhỏ hoặc chạy ký qua email thật; các kiểm tra layout hiện ở mức cấu trúc component (tab flex đều, không có footer che form, không thêm ScrollView).
