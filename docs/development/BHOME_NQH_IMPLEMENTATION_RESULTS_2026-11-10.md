# Kết quả triển khai BHOME NQH

Kế hoạch và quyết định mang ngày yêu cầu 10/11/2026; thực thi tiếp tục ngày 11/11/2026. Không coi kết quả unit/API là UI E2E.

## Commits và bằng chứng theo phase

| Phase        | Thay đổi                                                                                                                                                                                                                    | Verification                                                                                                              | Commit                                            |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| 0            | Baseline, matrix BR-01–29, quyết định thay thế SRS/audit và external blockers                                                                                                                                               | Git baseline + đọc source/CI/contracts; docs format                                                                       | e7d86c0 docs(plan): map approved business changes |
| 1 foundation | Resident contact_email + case-insensitive uniqueness; anonymous invitation/history mapping; signing mode/evidence không cần user giả; Active metadata cho Holding trước account; migration additive, baseline cũ giữ nguyên | dotnet restore PASS; Release build PASS; disposable upgrade/data preservation/email-conflict + runtime snapshot: 2/2 PASS | Xem local commit feat(db) tương ứng               |

Phase 1 chưa được công nhận toàn bộ demo-ready: MinIO/Docker và provider access chưa có; demo scenarios và E2E tiếp tục các phase sau. Database làm việc không migrate/seed.

## Chi tiết phase 1

- BR-01/05/07, UC-13/14/15: Domain Resident.ContactEmail; Contract.SigningMode/InternalAcceptance; ContractSigningInvitation lưu hash/session/OTP state và evidence references trong contracts.history, không raw token/password.
- Physical schema vẫn 24 bảng. Chỉ thêm contact_email/index và thay active constraint để Holding không đòi tài khoản Tenant. Service signing/payment gates vẫn bắt buộc; không dùng SQL để kích hoạt demo contract.
- LifecycleAlignment migration giữ nguyên immutable InitialCompact24 baseline. Canonical fresh DDL và generated EF snapshot đồng bộ.
- Test LifecycleMigrationTests tạo database tên bhome_compact24_<random>, migrate baseline, giữ account qua upgrade, kiểm email khác hoa/thường bị từ chối, replay migration không mất data, rồi chỉ xóa database test do test tự tạo.
- Một invocation filter ban đầu match thêm PostgresFoundationTests dùng Docker: 1 test BLOCKED bởi DockerUnavailable, 2 test liên quan PASS. Chạy lại filter đầy đủ namespace: 2/2 PASS. Không skip/delete assertion.

## External readiness

Phase 10, slice bàn giao — BR-23/25: hoàn tất bàn giao dựa trên Owner-reviewed inspection và final readings/evidence thật; không đợi hết nợ/refund. Giữ tài chính/lịch sử, Room còn người khác vẫn Occupied; đóng đúng residence và current-room link, profile/contract/payer lịch sử vẫn đọc được. Nullable Resident.RoomId, migration ngày actual không bịa ngày bắt đầu, strict runtime schema readiness; Owner UI phân biệt bàn giao với tài chính. Checks hiện tại: Contract unit 39 PASS; PostgreSQL physical release/move-out/refund/migration snapshot 8 PASS; Owner contracts/tenants UI 21 PASS. Tiếp tục hoàn thiện sổ phải thu/cấn trừ ở slice sau; đây chưa phải toàn bộ phase 10.

Phase 6 — BR-12: TenantMeterReadingService/API và Tenant Mobile đọc confirmed readings + ảnh private trước Draft; scope theo khoảng ở/InvoiceRecipient lịch sử; notification in-app + EMAIL intent với target reauthorization, không lộ OCR proposal. PostgreSQL integration và hồi quy Invoice/notification: 12/12 PASS; Mobile meter-history/notification-state: 6/6 PASS; Mobile typecheck, ESLint và Release solution build PASS. Test phát hiện projection constructor EF không dịch được và fixture meter precision sai; đã sửa và rerun qua. Chi tiết tại docs/api/TENANT_CONFIRMED_METER_READINGS.md. Không schema change, không real email/native UI E2E.

Phase 3 — BR-01–07/09/11: đã triển khai nhánh ký INTERNAL_OTP_DRAWN trước tài khoản, OTP/session/hash/revoke/replay, PDF/bằng chứng private, Owner confirmation, activation gate và provisioning sau Main Active cùng transactional dispatch intent. Owner Web và Mobile có màn public ký/thiết lập mật khẩu; Owner Main Draft có lựa chọn người mới không account. Holding/Main hỗ trợ subject Resident và chuyển cọc một lần. API/thiết kế tại docs/api/ANONYMOUS_CONTRACT_SIGNING.md.

Validation phase 3: Application unit 387/387 PASS; migration snapshot + Compact24 Contract regressions + luồng anonymous Main/Holding trên PostgreSQL disposable 21/21 PASS; Owner auth/contracts 16 files/67 tests PASS; Mobile anonymous/onboarding 3 files/24 tests PASS. Typecheck Owner/Mobile PASS. Đã sửa thiếu DOM.Iterable trong cấu hình TypeScript Owner (lỗi build ở test MeterQueries hiện có). Lỗi FK thứ tự persist khi provision đã được test phát hiện và sửa trong cùng transaction. Kiểm thử giao diện thật/native và SMTP thật chưa chạy; không coi component/API là E2E.

Phase 2 — BR-01/05, UC-13: Staff Mobile onboarding và route Resident yêu cầu email riêng hợp lệ. Backend chuẩn hóa và chặn trùng email, giữ dữ liệu CCCD được mã hóa, không tạo User tại bước xác minh. Kiểm thử PostgreSQL disposable 1/1 PASS (email thiếu/sai/trùng, ngoài Location, persisted identity và số User không đổi); Mobile 48/48 PASS; Mobile typecheck và lint các file thay đổi PASS. Lần chạy đầu test dùng nhầm ID RoomType làm Location không tìm thấy fixture; đã sửa dữ liệu test và chạy lại thành công. UI E2E chưa chạy.

| Dependency                             | Status                                                             |
| -------------------------------------- | ------------------------------------------------------------------ |
| MySign sandbox                         | BLOCKED — người dùng chưa có access                                |
| Bank sandbox/provider contract         | BLOCKED — người dùng sẽ bổ sung                                    |
| OTP/invitation Email/SMS thật          | BLOCKED — chưa có delivery credentials                             |
| Docker/MinIO/PDF container integration | BLOCKED — chưa có Docker daemon; tiếp tục kiểm tra phương án local |
| Native Android/iOS UI E2E              | NOT RUN                                                            |

NOT PUSHED — USER PUSH REQUIRED.

## 11/11/2026 — Khoản phải thu thiệt hại và cấn trừ có nguồn

BR-15/19/20/21/22: thêm khoản phải thu bất biến trong contracts.history, cấn trừ Owner duyệt riêng và money effect trong payment_allocations hiện có. Thiệt hại không bị giới hạn bằng cọc; thử 600.000đ phải thu / 400.000đ cọc còn 200.000đ sau bàn giao. Snapshot quyền cho người thuê cùng phòng, lịch sử còn sau release, không cấp cho người ngoài/người mới. Owner Web tạo/duyệt; Tenant Mobile xem số dư máy chủ. Không tạo Final Settlement Invoice. Migration bổ sung giữ 24 bảng, chỉ áp dụng trong DB kiểm thử disposable; DB làm việc chưa thay đổi.

Đã chạy: Release build trong integration runner; Application unit 387 PASS; payment/contract/invoice/refund/finance regression 71 PASS; nhóm mới + physical release + migration/snapshot 8 PASS sau thay đổi cuối; Owner UI 20 PASS; Mobile UI 1 PASS; Owner/Mobile typecheck và changed-file ESLint PASS. Các lần thử đầu lỗi test đếm hóa đơn, test assertion matcher và test TypeScript đã sửa; Python không có nên dùng Node có sẵn cho thao tác file. Không dùng các lỗi ban đầu làm bằng chứng PASS.

Còn tiếp tục: điện/nước chốt không trùng, tiền thuê tháng lẻ theo policy, xác nhận đủ danh sách phí, thu tiền trực tiếp cho khoản phải thu, hoàn dư sau cấn trừ, chuyển endpoint khấu trừ cũ và báo cáo tài chính. Provider thật vẫn BLOCKED do chưa có access. Chi tiết: docs/api/SETTLEMENT_RECEIVABLES.md.

## 11/11/2026 — Thu khoản phải thu và hoàn dư đúng người trả

BR-17/18/19/20/22/23: dùng verified PaymentTransfer hiện có để phân bổ vào settlement receivable; hỗ trợ thiếu/đủ/dư, chặn replay/duplicate reference/cross-target, giữ phần dư cho quy trình hoàn Receipt. Ca tổng hợp xác minh thủ công đã hoàn 50.000đ cho người thực trả khác đại diện. Thêm hướng dẫn chuyển khoản/QR từ tài khoản Owner cấu hình; Tenant không tự xác nhận thành công. In-app/email intent bền vững, target reauthorization và navigation tới khoản phải thu. Nhóm chịu nghĩa vụ được chụp theo thời điểm kiểm tra, loại người vào cùng ngày sau kiểm tra và người đã rời trước đó. Native guard chỉ thêm function/trigger, vẫn 24 bảng, không migrate DB làm việc.

Đã chạy sau thay đổi cuối: integration khoản phải thu/migration/snapshot 5 PASS; payment/refund/finance/inbox hồi quy 46 PASS; Application unit 387 PASS; Owner 3 file/10 PASS; Mobile 3 file/25 PASS; Owner/Mobile typecheck, changed-file ESLint và diff check PASS. Các lỗi typecheck totalCount và dictionary key trùng đã sửa và kiểm tra lại. Kiểm thử là PostgreSQL disposable + object-storage substitute + dữ liệu synthetic, không phải ngân hàng sandbox/Email/MySign thật.

Còn tiếp tục điện nước chốt, rent theo policy, manifest phí/điều chỉnh, hoàn cọc sau offset, tổng hợp finance, Holding cancel disposition, Mobile Owner scope, retention/residence, demo/E2E và CI-equivalent đầy đủ. Không đánh dấu toàn bộ yêu cầu hoàn thành. docs/api/SETTLEMENT_RECEIVABLES.md có API và giới hạn hiện tại.
