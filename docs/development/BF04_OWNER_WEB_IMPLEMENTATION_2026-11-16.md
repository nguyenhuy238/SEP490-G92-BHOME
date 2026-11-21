# BF-04 Owner Web — rà soát và tích hợp

## Phạm vi và nguồn

Nguồn triển khai: yêu cầu BF-04 UI Framework người dùng cung cấp ngày 16/11/2026; `docs/api/BF04_BACKEND_API_AUDIT_2026-11-16.md`, `CONTRACT_LIFECYCLE.md`, `SETTLEMENT_RECEIVABLES.md`, tài liệu move-out/renewal/release và source controller/service/DTO hiện hành. Áp dụng BF-04, FE-03, UC-19 (theo mapping tài liệu repository), GBR-01/02/18, JOB-02. Không quyết định thêm chính sách cọc/bồi thường còn mở OQ-01/02/05.

Owner Web dùng React/MUI và backend thật qua client-core. `ProtectedRoute` yêu cầu Owner; repository không có ứng dụng Staff Web/Tenant Web riêng. Không mở quyền Staff/Tenant vào Owner Web, không sửa Mobile. Không tạo state machine, HTTP client hoặc hệ thống notification thứ hai. Không chạy mutation trên dữ liệu/tiền thật.

Không tìm thấy `nghiepvutemanation.docx` hoặc swimlane BF-04 có tên tương ứng trong danh sách tài liệu đã dò; không suy diễn nội dung của tài liệu thiếu. Hành vi đóng cư trú trước quyết toán được giữ đúng yêu cầu mục 11.3 trong task mới.

## Inventory trước → sau

| Nghiệp vụ / màn hình        | Trước                                                              | Hành động triển khai                                                                              | API hiện hữu                                                 |
| --------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Danh sách/chi tiết hợp đồng | Có, API thật; selection chỉ giữ state lúc mở                       | Giữ route `/contracts`; lưu contractId trong URL để refresh/back mở đúng hồ sơ                    | contracts list/detail                                        |
| Nhắc hết hạn/gia hạn        | Đã nối API                                                         | Giữ panel và hành động hiện hữu                                                                   | expiry-reminders, renewals, signing, activate                |
| Owner không gia hạn/duyệt   | Có dialog, API thật                                                | Giữ contract action dialog và state backend; thêm empty state chỉ đường                           | expiry-move-out, move-out/approve                            |
| Tenant gửi yêu cầu          | API có; không có Tenant Web trong repo                             | Không tạo màn hình giả trong portal Owner; ghi rõ giới hạn nền tảng                               | termination-requests                                         |
| Từ chối/hủy yêu cầu         | Backend chưa có                                                    | Không thêm nút/API giả                                                                            | Chưa có                                                      |
| Lịch kiểm tra Staff         | Panel có, lấy Staff thật và UTC conversion                         | Đưa vào một workspace; giữ expectedVersion và scope; hiển thị lịch/người phụ trách                | inspection-staff, move-out/schedule                          |
| Staff kiểm kê               | Backend có, không có Staff Web                                     | Tái sử dụng dữ liệu baseline/finalReading cho Owner; không thay Staff gửi inspection              | inspection-preparation, inspections, evidence                |
| Owner duyệt/kiểm tra lại    | Có, API thật                                                       | Bổ sung confirmation, hiện ảnh baseline/quan sát, giữ nguồn đã tải khi nguồn khác lỗi             | inspection-review                                            |
| Chi phí cuối kỳ             | Panel đầy đủ, API thật                                             | Giữ preview/ref, thêm dialog trước khi duyệt                                                      | final-fixed-charges, final-utilities, damage, charge-review  |
| Cấn trừ cọc                 | Panel có                                                           | Giữ endpoint mới; bổ sung xác nhận trước mutation                                                 | deposit-offsets                                              |
| Đối soát/hoàn cọc           | Dùng lại Payment/Refund có sẵn                                     | Thêm xác nhận theo từng bước; không coi tạo request là đã hoàn                                    | bank-allocations, deposit-refunds, refund decision/execution |
| Quyết toán sau trả phòng    | Các panel tài chính còn, nhưng form quyết toán bị ẩn khi Completed | Cho tiếp tục Owner review sau Completed; tách trạng thái vật lý/tài chính                         | settlement-summary, move-out/settlement                      |
| Tiến trình/lịch sử          | Thông tin phân tán, lặp hai khu vực, có raw ID/reference           | Gom workspace, tiến trình server-derived; parse snapshot an toàn; không in fingerprint/object key | move-out/history, inspections, settlement-history            |

## Tiêu chí kiểm chứng

- Completed không đánh dấu tài chính xong; chỉ dữ liệu summary.resolved + quyết định Owner mới thể hiện đã quyết toán.
- Khi source summary lỗi tạm thời, inspection/history còn xem được; lỗi mất quyền phải xóa toàn bộ dữ liệu cũ.
- Mọi hành động tài chính cần xem và xác nhận, không mutation lúc mở dialog. Đổi reference/form trong lúc xác nhận buộc xem lại.
- Retry giữ idempotency key cho cùng payload; conflict refresh nguồn, không tự submit lại.
- Dùng các preview của backend và nullable money, không tạo tổng quyết toán trên frontend.
- `/contracts?contractId=...` giữ hồ sơ qua refresh/back; không tạo route Termination mới.

## Backend gap giữ nguyên

Thiếu reject/cancel termination; Staff audience của Scheduled chưa có; không tự phát hành hóa đơn cuối từ settlement; chưa có rule tự chuyển Maintenance theo inspection; chưa xác nhận nhắc lặp riêng cho mọi khoản thiếu. Legacy deposit-deductions không dùng tạo mới. Không tự sửa quy tắc đóng cư trú/tài chính hoặc bổ sung số tiền/phí không được phê duyệt.

## Các file triển khai

- Route hiện hữu: `src/owner-web/src/features/contracts/pages/ContractsPage.tsx`. Selection được lưu trong query string; dùng lại menu Hợp đồng, không đăng ký route mới.
- Điều phối và duyệt: `ContractDetailPanel.tsx`, `ContractLifecyclePanel.tsx`, `ContractActionDialog.tsx` trong `src/owner-web/src/features/contracts`.
- Phí/đối soát: `FinalFixedChargesPanel.tsx`, `FinalUtilitiesPanel.tsx`, `FinalChargeReviewPanel.tsx`, `SettlementReceivablesPanel.tsx`, `SettlementBankPanel.tsx` trong cùng thư mục; `src/owner-web/src/features/payments/RefundPanel.tsx`.
- Component mới: `src/owner-web/src/components/common/ConfirmActionButton.tsx`. Helper trạng thái, history và giới hạn cấn trừ: `src/owner-web/src/features/contracts/termination.ts`.
- API/types/query hooks dùng lại: `packages/client-core/src/contracts.ts` (bổ sung kiểu snapshot history), `useContractLifecycle.ts` (tách lỗi nguồn, xóa dữ liệu khi mất quyền), `useContractDetail.ts` (history lỗi tạm thời không che toàn bộ hồ sơ).
- Test: `ConfirmActionButton.test.tsx`, `termination.test.tsx`, `ContractLifecyclePanel.test.tsx`, `Contracts.test.tsx`, `DigitalSigningPage.test.tsx` và các test tương ứng của sáu panel tài chính nêu trên.
- Không có migration, endpoint mới, sửa Mobile hoặc thay đổi backend trong task UI này. `NotificationAutomationWorker.cs`, script Cloudflare/LAN và test PowerShell đang thay đổi trong workspace là công việc trước task, được giữ nguyên.

## Cách mở và sử dụng

Owner đăng nhập portal, vào **Hợp đồng** (`/contracts`), chọn **Chi tiết**; đường dẫn hồ sơ là `/contracts?contractId=<id>`. Refresh hoặc Back/Forward mở đúng hồ sơ đã chọn. Tại môi trường local web đang chạy, mở `http://127.0.0.1:5174/contracts`.

1. Với hợp đồng Active chưa có hồ sơ trả phòng: dùng **Lập yêu cầu trả phòng khi hết hạn**. Với yêu cầu Tenant đã gửi: dùng **Duyệt yêu cầu trả phòng**. Nếu các bên gia hạn, dùng quy trình gia hạn/ký đang có, tránh tạo thêm hồ sơ trả phòng.
2. Trong **Kết thúc hợp đồng**, xem trạng thái hợp đồng/trả phòng/tài chính riêng biệt, đặt lịch theo giờ Việt Nam và chọn Staff trong cơ sở. Có thể tạo tác vụ chỉ số chốt ở phần chi tiết.
3. Staff thực hiện kiểm tra ở ứng dụng hiện hữu. Owner mở **Biên bản**, đối chiếu hiện trạng, tài sản, điện nước và bằng chứng riêng tư. Ảnh nhận phòng dùng API handover của hợp đồng gốc; ảnh trả phòng dùng move-out; ảnh chỉ số chốt dùng Capture. Nếu cần kiểm tra lại, nhập lý do rồi xác nhận hành động hiện hữu.
4. Tại **Quyết toán**, dùng preview tiền thuê/phí/điện nước của máy chủ, duyệt khoản thu thiệt hại có chứng từ, xác nhận đủ khoản thu, cấn trừ cọc và đối soát ngân hàng. **Mở hóa đơn** dẫn đến `/invoices?invoiceId=...`; **Bảo trì sau bàn giao** mở `/maintenance`.
5. Với cọc còn lại, lập yêu cầu hoàn, phê duyệt rồi chuyển khoản thực tế và lưu chứng từ. Mỗi bước có xác nhận riêng. Tạo/duyệt request chưa phải hoàn thành chuyển tiền.
6. Lưu xem xét quyết toán, đọc kết quả summary mới nhất. Owner có thể **Hoàn tất trả phòng** khi backend chấp nhận biên bản/ngày thực tế; hồ sơ đã Completed vẫn cho tiếp tục xử lý tài chính. Hệ thống không khẳng định phòng đã Available hoặc cư trú đã kết thúc chỉ từ thao tác frontend.

Không có Staff Web/Tenant Web trong repository để cung cấp URL đăng nhập tương ứng. Tenant gửi yêu cầu/xem nghĩa vụ, Staff nhận việc/chụp chỉ số/gửi biên bản qua ứng dụng hiện hữu; task này chỉ kiểm chứng các API liên quan bằng test, không tuyên bố đã nghiệm thu Mobile.

## Kết quả kiểm chứng thực thi

- `npm run build --workspace ./src/owner-web`: đạt; chạy `tsc -b` và Vite build thật. Có cảnh báo bundle >500 kB, không có lỗi compile.
- `npm run lint --workspace ./src/owner-web`: đạt.
- Kiểm tra tập trung lần sau sửa: 58/58 test tại 12 file đạt (bao gồm test cấu hình phòng từng timeout). Điều hướng/hook bổ sung: 28/28 đạt; sau bổ sung conflict complete và nguồn ảnh baseline/Capture: 26/26 đạt. Các lượt có test trùng, không cộng số lượng thành tổng.
- Lượt toàn Owner Web ban đầu: 724/726 đạt; hai lỗi là fixture ContractPolicy trả object thay vì list và một test LocationSetupWizardCopy timeout. Đã sửa đúng fixture, giữ các assertion, chạy lại cả hai thành công.
- **Lượt toàn Owner Web cuối trên mã cố định: 734/734 test đạt, 103/103 file đạt, không skip, không test fail.** Command: `npm run test --workspace ./src/owner-web -- --reporter=dot`; thời gian 399 giây. Log local: `.tmp/bf04-frozen-full-tests.log`. Lượt chạy đồng thời với lần sửa cuối từng có 733/734 đạt vì đã nạp module cũ (DOM vẫn hiện header cũ); đã xác nhận lại bằng cả focused test và lượt toàn bộ sạch này. Không disable test, không nới timeout hoặc thay assertion để che lỗi.
- API: 12/12 integration test đạt, không skip, trên PostgreSQL 16 container riêng `bhome-bf04-ui-20261116`, database tạm do fixture quản lý. Object storage dùng test substitute của fixture, không phải nghiệm thu MinIO thật. Kết quả TRX: `tests/backend/BHome.IntegrationTests/TestResults/bf04-api.trx` (artifact local).
- Trình duyệt Chrome headless: component sản xuất với fixture cô lập ở desktop 1280×900 và narrow 390×844. Đã kiểm tra không tràn ngang, Completed vẫn xem xét quyết toán, không lộ fingerprint, mở/hủy confirmation không gửi POST. Ảnh local: `.tmp/bf04-desktop.png`, `.tmp/bf04-narrow.png`. Đây là kiểm tra component/layout, không phải E2E tất cả vai trò với một tài khoản thật.
- Impeccable mechanical detector: không có finding tại lifecycle/detail/confirmation targets (`.tmp/bf04-design-detect.json`).
- Không giao dịch tiền thật, không gửi email mới, không chỉnh hợp đồng production và không migrate database người dùng để test.

### Đối chiếu A–J và giới hạn nghiệm thu

- **A:** API `Compact24ContractRegressionTests.MoveOut` thực thi Tenant request → approve → schedule → Staff inspection → Owner review → pending → concurrent complete → settlement sau Completed. Kết quả tài chính cuối trong test này dùng ledger substitute; các test receivables/refund bên dưới kiểm tra ledger thật.
- **B:** UI expiry/reminder/actions đã nối API hiện hữu; test API Expiry/Renewal/ExpiryAndMeterNotices đạt. Chưa thực hiện một E2E trình duyệt riêng bắt đầu từ Owner expiry-move-out đến mọi khoản quyết toán.
- **C:** Giao diện yêu cầu kiểm tra lại dùng đúng inspection-review/version và giữ lịch sử; chưa chạy một E2E Staff gửi lại biên bản mới qua Mobile. Không gắn PASS cho toàn kịch bản này chỉ từ đọc source.
- **D:** `DamageDebtAndOffsetsSurvivePhysicalRelease`, `DamageEvidenceAndInvoiceOffsetsAreValidated`, `BankPaymentsAndActualPayerRefunds` đạt trên persistence thật: nợ lớn hơn cọc, offset riêng, tiền trả một phần/dư và người nhận thực tế. UI giữ decimal strings và kiểm tra giới hạn bằng BigInt; không tự tính số quyết toán chính thức.
- **E:** `DepositReturnAndClosure`, `DepositReturnAgreedRecipient`, `DepositReturnChangedSource`, `DepositReturnUnknownHistory` đạt. UI test kiểm tra approved/completed chỉ theo response và execution multipart/chứng từ; không chuyển khoản ngoài hệ thống trong test.
- **F:** Có kiểm tra calculation/giới hạn offset/nguồn cọc; chưa bổ sung E2E riêng cọc đúng bằng toàn bộ nghĩa vụ của một hồ sơ từ đầu đến cuối. Không suy diễn từ case cọc thiếu hoặc dư.
- **G:** API MoveOut, receivables sau physical release và UI Completed giữ review đều đạt; không coi Terminated/Completed là đã thanh toán.
- **H:** Test receivables/settlement dùng phòng chung có người còn thuê; UI hiện đúng cảnh báo không tự giải phóng phòng. Chưa thử thủ công tất cả biến thể room status/bảo trì trên dữ liệu thật.
- **I:** API kiểm tra replay/concurrent complete, nguồn cọc đổi, bằng chứng/offset/reference; UI kiểm tra cùng payload giữ idempotency key, dialog đổi snapshot bị khóa, conflict reset consent và refresh, complete conflict phải mở lại. Chưa dựng hai browser Owner session cùng thao tác toàn bộ A–F.
- **J:** Test MoveOut kiểm tra Staff không được approve/xem financial history, complete khi thiếu điều kiện, dùng sai final reading; test receivable kiểm tra chứng từ và scope. Hook test xóa dữ liệu khi 403 và đổi role. Không tuyên bố đã bao phủ mọi mã 400/401/403/404/409/413/503 của toàn backend chỉ bằng 12 test đã chọn.

## Đánh giá thiết kế và rủi ro

UX giữ một hồ sơ và một tuyến điều hướng, có anchor đến lịch/biên bản/tài chính/lịch sử. Timeline và ba trạng thái giúp nhìn thấy hồ sơ đã bàn giao nhưng còn nợ; các bảng trên màn hình hẹp có vùng cuộn riêng. Các biểu mẫu tài chính hiện hữu được giữ lại để tránh hai cách tính hoặc hai sổ đối soát.

Đảm bảo nghiệp vụ dựa trên backend: null vẫn là chờ xác minh, tổng/preview/reference do máy chủ cung cấp, room/residence chỉ thay đổi sau API complete thành công. Retry cùng payload giữ operation key; 409 tải nguồn và yêu cầu duyệt lại. Khóa click nhanh chỉ ngăn thao tác lặp tại một tab; unique constraints, idempotency và transaction backend vẫn là bảo đảm cuối cùng cho nhiều phiên.

Rủi ro bảo mật được giảm bằng API bằng chứng xác thực, không nhúng storage URL, không in snapshot JSON/reference/operation key, và xóa snapshot khi mất quyền. Session/authorization chung không được nới. Các quyết định refund vẫn phải xác minh nguồn, người nhận và chứng từ; frontend không thể tự xác nhận một khoản chuyển tiền bên ngoài đã xảy ra.

Rủi ro còn lại: hồ sơ dài khi có nhiều biên bản/khoản thu; reload gọi một số nguồn song song và invalidation danh sách/reminder/notification có thể tốn request ở quy mô lớn; cần đo bằng dữ liệu thực trước khi thêm lazy loading/pagination. Cache settlement/refund được invalidation theo contract/source, nhưng Rooms và Residence dùng state/module riêng nên phải mở/tải lại trang tương ứng để xem trạng thái mới; không báo rằng đã cập nhật tức thời toàn app. Các hook trong client-core dùng chung: dù không sửa Mobile, nên chạy CI Mobile trước release.

Khi deploy phải dùng frontend/backend cùng phiên bản DTO và có API Capture/private evidence hoạt động; không thêm migration cho thay đổi UI. Chunk lớn là hạn chế hiệu năng bundle hiện hữu. Các gap reject/cancel/Staff notification/final-invoice/maintenance/reminder cần được chốt yêu cầu, authorization và policy rồi triển khai riêng, tránh giả lập chức năng bằng state frontend.
