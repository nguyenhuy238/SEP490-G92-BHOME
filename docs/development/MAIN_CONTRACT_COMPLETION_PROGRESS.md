# Main Contract: kiểm tra và sửa luồng đưa bản nháp sang ký

## Phạm vi và trạng thái

Yêu cầu ngày 13/11/2026 liên quan BF-03/BF-04, UC-13..17, GBR-04 và thanh toán BF-06/UC-22. Đây là báo cáo tiến độ, **chưa phải báo cáo hoàn thành toàn bộ luồng trong prompt**. Không thay đổi schema hoặc dữ liệu Owner/CCCD thật, không tạo hồ sơ giả lập để vượt cấu hình bắt buộc.

Source thực tế có 3 bước tiếp nhận (`onboardingSteps`: Chọn phòng, Người ở, CCCD), tiếp theo 4 bước hợp đồng (`rentalContractSteps`: Xem hợp đồng, Ký hợp đồng, Tạo mã QR, Kích hoạt hợp đồng). Chưa có danh sách 8 bước Main độc lập. Danh sách 8 bước hiện có là Holding. Đã hỏi xác nhận thứ tự Main đề xuất: Chọn phòng → Người thuê → CCCD → Bản nháp → Owner phê duyệt → Ký hợp đồng → Thanh toán QR → Kích hoạt & tài khoản. Chưa đổi stepper khi chưa có quyết định.

## Đã sửa

- `MainDraftSigningReview.tsx`: người ở mới có lựa chọn ký OTP mà chưa cần tài khoản; release gửi `tenantUserId:null`. Giữ lựa chọn tài khoản đã có. Owner vẫn phải xem PDF hiện tại và tích xác nhận. Staff không được release hoặc ký thay Owner. Không cấp tài khoản trước kích hoạt.
- `MainDraftService.ReleaseAsync`: canonical document phải có `IsInternalResidentAcceptance` khi phát hành để ký OTP. Thiếu cờ này làm hash khác với tài liệu API ký sử dụng, có thể bị từ chối `signed_terms_changed`.
- `MainDraftScreen.tsx`: hiển thị từng blocker backend qua thông báo đã có; không gộp mọi lỗi thành thiếu cọc/chính sách. Khi Staff chờ duyệt, polling 5 giây đọc bản nháp; chỉ điều hướng khi backend đã thay đổi trạng thái. Không sửa dữ liệu đã nhập hay tạo nháp mới qua polling.
- `mainDrafts.ts`: sửa thông báo release, tránh yêu cầu tài khoản Tenant trước ký OTP.

## API đã có

- `/api/v1/contracts/main-drafts/preparation`: pricing, người đã xác minh, cấu hình Owner/cọc/chính sách, blockers theo ngày.
- `POST /api/v1/contracts/main-drafts`, `PUT /{id}`, `GET /{id}`: lưu/đọc nháp, version và idempotency.
- `POST /{id}/documents`, `POST /{id}/signing-review`, các route tài liệu/preview: tạo và đọc tài liệu đúng snapshot.
- `POST /{id}/release`: Owner xác nhận PDF, chuyển PendingSigning; cho phép không có tài khoản và dùng INTERNAL_OTP_DRAWN.
- `/api/v1/contracts/{id}/signing-invitations`, `/internal-signing/owner-confirmation`, `/api/v1/contract-signing/{info,otp,verify,document,accept}`: email/OTP/nét ký thật; xác minh OTP chưa phải ký.
- `POST /api/v1/contracts/{id}/holding-conversion`: tạo Main từ Holding đủ điều kiện, giữ liên kết và phân bổ cọc; chưa xóa Holding. Main activation cập nhật Holding Converted và phòng Occupied trong transaction.
- API nhận tiền, payment allocation, SePay và QR hóa đơn đã phát hành hiện có; không đồng nghĩa đã có nghĩa vụ thanh toán gộp ban đầu cho Main.
- Provisioning Tenant sau Main Active hiện có; email mời thiết lập mật khẩu có dispatch/retry, không cần mật khẩu cố định.

## Các khoảng trống còn phải làm

- MainDraftStart chưa kế thừa Holding tự động; Onboarding đang loại OnHold. MainDraftService.Prepare cũng chỉ cho Available/Occupied. Holding conversion có guard riêng về Active, thời hạn, price lock và khoản cọc; không được bỏ guard chỉ để phòng xuất hiện.
- Source chưa có API tính/gộp cọc + tiền thuê tháng đầu + phí ban đầu thành một nghĩa vụ thanh toán và QR Main trước kích hoạt. QR hiện có dành cho hóa đơn Final, registry định danh Invoice/Deposit. Đã hỏi giữ hai nghĩa vụ riêng hay bổ sung gộp; chưa tạo đối soát mới.
- Công thức theo yêu cầu: không Holding = cọc cấu hình + thuê tháng đầu + phí ban đầu áp dụng; có Holding = chỉ phần cọc còn thiếu theo allocation backend + thuê tháng đầu và phí áp dụng. Chênh lệch cọc và phí Metered không thể được coi đã thu hoặc tự ước lượng.
- Cá nhân/nhóm hiện đang dùng Hộ gia đình và Cá nhân/Nhóm bạn; UI cho nhiều người và backend kiểm tra vai trò đại diện. Chưa hoàn tất đổi quy tắc Cá nhân một người và nhóm nhiều người xuyên suốt.
- Nút mô phỏng Tenant và xác nhận Owner Sandbox mới áp dụng Holding; chưa mở rộng cho Main hoặc nới điều kiện kích hoạt thật.
- Luồng Mobile sau release chưa hỗ trợ đầy đủ INTERNAL_OTP_DRAWN; còn cần đồng bộ trạng thái ký, QR, tiền cọc và provisioning/email theo 8 bước được chốt.
- Cấu hình hợp đồng của BHOME JOB09 TEST vẫn cần hồ sơ bên cho thuê và chính sách thanh toán hợp lệ. Yêu cầu dữ liệu Owner ngẫu nhiên trước đó chưa được ghi vào database; yêu cầu mới cấm mock thay dữ liệu thật nên không tự điền để vượt blocker.

## Kiểm tra đã chạy

- 23 Mobile tests: `main-draft-screen.test.tsx`, `rental-contract-flow.test.tsx`; thêm trường hợp release không tài khoản và nhận Owner release qua polling mà không tạo trùng nháp. Typecheck/lint Mobile đạt.
- 14 backend tests, không skip: 13 regression `MainDraftApiTests` trên PostgreSQL/MinIO disposable và 1 `MainDraftReleaseBeforeAccountsTests` trên Compact24 disposable. Kiểm tra Staff không release, Owner release idempotent, TenantUserId vẫn null, canonical hash và PDF source khớp, số lượng tài khoản không tăng.
- Lưu ý archived legacy schema cố ý giữ constraint TenantForLifecycle, không hỗ trợ pre-account OTP; kiểm thử tính năng mới dùng runtime Compact24. Không sửa legacy schema để vượt constraint.
- 8 Owner Web MainDraft tests đạt; typecheck Owner Web đạt.
- Chưa chạy đủ 18 trường hợp end-to-end trong prompt vì các khoảng trống phía trên chưa được triển khai. Không báo toàn bộ Main flow đã hoàn thành.

## File sửa trong đợt này

`packages/client-core/src/mainDrafts.ts`, `src/backend/BHome.Application/Contracts/MainDraftService.cs`, `src/mobile/src/features/contracts/MainDraftScreen.tsx`, `MainDraftSigningReview.tsx`, `src/mobile/src/__tests__/main-draft-screen.test.tsx`, `rental-contract-flow.test.tsx`, `tests/backend/BHome.IntegrationTests/Compact24/MainDraftReleaseBeforeAccountsTests.cs`.
