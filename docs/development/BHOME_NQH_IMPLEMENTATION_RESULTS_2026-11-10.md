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

## Kết quả slice điện/nước chốt — 11/11/2026

BR-14/15/19: Owner Web xem preview baseline đã tính tiền, chỉ số chốt, lượng đã thu, lượng bổ sung và số tiền; duyệt đúng reference/idempotency key. Khoản phải thu bất biến lưu trong contracts.history, dùng phân bổ ngân hàng/cấn trừ hiện có; Tenant Mobile xem và thanh toán theo quyền lịch sử của khoảng tiêu thụ. Không tạo Final Settlement Invoice, không thêm bảng/migration. Utility snapshot giữ biểu giá/định mức tích lũy; tính F(total)-F(previous) để không cấp lại bậc thấp hay thu lại khoản giảm giá. Hóa đơn Draft phải refresh/review nếu phí được duyệt trước; dòng utility đã phủ mang nguồn rõ và không giả chỉ số vật lý. Hai hợp đồng cùng phòng có thể xác nhận Final cùng ngày với chỉ số không giảm.

Files: SettlementFinalUtilities/Repository, SettlementChargeEvidence, MeterBillingCoverage, UtilityIncrementCalculation, InvoiceService/Repository, CaptureRepository, shared client, FinalUtilitiesPanel, TenantSettlementReceivables/TenantInvoiceCharges. Thiếu quota, baseline, phân bổ đồng hồ thay thế, policy lịch sử hoặc bằng chứng thì Amount=null/Pending; không ước lượng để tạo phí chính thức.

Đã chạy: Application unit 394 PASS; PostgreSQL disposable FinalUtilityRegressionTests (5 ca), Compact24InvoiceRegressionTests và SettlementReceivableRegressionTests: tổng 16 PASS. Owner/Mobile typecheck và changed-file ESLint PASS. Storage là test substitute; không phải MinIO live, bank sandbox hoặc UI E2E. Tiền thuê/phí khác theo BR-13 và xác nhận đầy đủ danh sách phí tiếp tục ở slice sau.

## 11/11/2026 — Tiền thuê/phí cố định tháng cuối theo chính sách

BR-13/15/19: nguồn FinalFixed bất biến trong contracts.history giữ kỳ, mã phí, giá, policy/version hoặc hash hợp đồng đại diện, lựa chọn FullMonth/OccupiedCalendarDays/làm tròn, số ngày phòng có người và giá lũy kế. Owner Web phải xác nhận chính sách áp dụng đúng điều khoản đã ký; backend tính tiền, không đọc tự động free text để đoán thỏa thuận. Khoản mới chỉ là chênh lệch giá chính sách chưa ghi nhận; hóa đơn định kỳ sau đó loại phần đã ghi nhận, Final cũ không đổi. Khoản giảm đã duyệt không bị thu lại. Tenant Mobile hiển thị căn cứ và số dư backend; không tự chia nợ phòng cho cá nhân.

Thiếu lịch, bản hợp đồng hoặc dữ liệu khoảng ở giữ Amount=null. Khi người khác còn tiếp tục thuê, tiền thuê vẫn đối chiếu qua hóa đơn chung của phòng, không bịa phần tiền riêng cho người đi. Tất cả khoản phải thu có thể thu tiền/cấn trừ qua ledger đã có. Không thêm bảng hoặc migration; database làm việc không thay đổi.

Files: FixedChargeCalculation, FixedChargeCoverageRepository, SettlementFinalFixedCharges/Repository, InvoiceService, SettlementReceivablesRepository/Controller, shared client, FinalFixedChargesPanel, TenantSettlementReceivables và thông tin nguồn trên dòng hóa đơn.

Đã chạy: Release solution build PASS; Application unit 398 PASS; PostgreSQL disposable final-fixed/final-utility/invoice regression 16 PASS (bao gồm thiếu policy, còn người tiếp tục thuê, từ chối Staff/Tenant, xác nhận điều khoản, concurrent replay, thứ tự invoice/charge); Owner UI 20 PASS; Mobile 4 PASS; Owner/Mobile typecheck và changed-file ESLint PASS. Inspection metadata trong test fixed-charge là fixture synthetic; không coi đó là UI E2E hay kiểm thử live storage. Tiếp tục xác nhận đầy đủ danh sách phí, hoàn cọc sau offset, Holding và các phase còn lại.

## 11/11/2026 — Owner xác nhận đủ khoản thu và hoàn cọc sau cấn trừ

BR-15/20/21/22/23: SettlementChargeReviewV1 bất biến gắn phiên bản/Owner decision/biên bản và danh sách khoản thu. Backend yêu cầu đủ điện, nước, rent/phí đã đối chiếu; nguồn thiếu hoặc reference cũ trả 409. Owner Web có bước xem/chấp thuận riêng, không biến việc duyệt phí thành nhận tiền. Tháng cuối đã phủ bằng khoản phải thu và review không cần Final Settlement Invoice. Từng offset khớp native allocation và Owner approval; deposit-refund source cho hoàn phần còn lại sau offset, cần xác minh người nộp và xác nhận offset. Cọc dùng hết không tạo refund giả. Refund vẫn Requested → Approved → Completed chỉ sau bằng chứng thực chi private; giữ phòng đã Available và quyền lịch sử.

Files: SettlementChargeReview, SettlementReceivablesRepository/Controller, ContractSettlementLedger/LifecycleService/Contracts, RefundService/Repository/DepositRefundSource; shared client; FinalChargeReviewPanel, RefundPanel. JSON history, không đổi schema/migration. Tenant summary che operation keys/fingerprints và charge IDs ngoài quyền.

Đã chạy: Application unit 398 PASS; PostgreSQL disposable final charge/fixed/utility/contract/receivable/physical release regression 36 PASS; Owner review/receivable/refund UI 15 PASS; Owner/Mobile typecheck, changed-file ESLint PASS. Luồng mới kiểm incomplete/stale review, partial/full offsets, physical release trước thanh toán, full cọc không cần refund, phần dư thực chi sau release và execute lặp không hoàn hai lần. Object-storage substitute và synthetic bank evidence, không phải provider hay UI E2E thật.

Các lần chạy đầu đã phát hiện và sửa: test variable name trùng, TextField API không hỗ trợ inputProps, thiếu mốc InspectedAt trong fixture. Hồi quy recovery rộng phát hiện fault injection đứt kết nối ngay khi seed ảnh meter; đã giới hạn lỗi vào upload refund để giữ đúng assertion phục hồi intended. Kết quả rerun recovery/payment/invoice/snapshot sẽ ghi tiếp sau khi hoàn tất.

Còn tiếp tục: điều chỉnh rent đã Final trước ngày đi thực tế, legacy deduction creation/corrections, Holding cancellation, whole/external-payer excess, finance aggregation, Owner Mobile scope, retention/residence, demo/UI E2E và full CI-equivalent. Không coi toàn bộ dự án hoàn thành.

Rerun sau sửa fault injection: Compact24DepositRecoveryTests + Compact24InvoiceRegressionTests + Compact24PaymentRegressionTests + exact runtime migration snapshot: 49/49 PASS. Assertion về durable upload intent, sai ảnh khi retry, reserved balance và không double refund vẫn giữ nguyên. Full CI-equivalent và provider/native UI E2E chưa chạy.

## 11/11/2026 — Đối chiếu ngày đi sớm với điều chỉnh rent đã duyệt

BR-13/16/19: hóa đơn Final tính trước ngày bàn giao không bị sửa. Nếu daily policy cho tiền thuê thấp hơn, preview giữ Pending cho tới khi phần giảm đủ được Owner duyệt trên đúng mã phí; Pending/Rejected không có hiệu lực, các quyết định tăng lại được tính net. Snapshot lưu ID quyết định, giá policy theo ngày thực tế và vị trí giá gốc đã ghi nhận; không thu lại discount ở lần tính sau. FullMonth vẫn theo lựa chọn Owner, không tự giảm theo ngày. Owner Web hiển thị căn cứ giảm và số phải thu thêm; Tenant Mobile nêu nguồn điều chỉnh.

Files: FixedChargeCalculation, FixedChargeCoverageRepository, shared contracts, FinalFixedChargesPanel, TenantSettlementReceivables và regression tests. Không schema/migration. Đã chạy: Application unit 399 PASS; PostgreSQL disposable fixed/utility/invoice regression 19 PASS, gồm Tenant gửi điều chỉnh → Pending chưa được dùng → Owner approve → zero acknowledgement, Final không đổi; Owner fixed-charge component 3 PASS; Owner/Mobile typecheck, changed-file ESLint PASS trước lần bổ sung hiển thị cuối (sẽ kiểm tra lại trong commit gate). Storage/inspection fixtures synthetic, không UI E2E/provider thật.

## 11/11/2026 — Hủy Holding: mất cọc hoặc hoàn do Owner không cung cấp phòng

BR-08/09/10/11/18: Owner phải chọn Cause TenantVoluntary/OwnerCannotProvideRoom và HumanConfirmed. Voluntary ghi nhận forfeiture; Owner failure tạo nghĩa vụ hoàn số tiền verified, không tự Completed. Cancellation review bất biến giữ nguyên nhân/tiền/actor/ref; chặn nguồn đã chuyển, đang dùng hoặc đã hoàn. Refund sử dụng request/approve/evidence/execute hiện có, classification HoldingDepositRefundV1 riêng với Security Deposit. Có thể hoàn cho Resident verified chưa có User; không tạo account/Resident giả. Canceled Holding không chuyển Main; phòng được giải phóng, history/payment/signing evidence giữ lại. Expiry không tự bị coi là tự nguyện hủy, không thêm max duration.

Owner Web chọn nguyên nhân và xác nhận riêng, xem disposition/hoàn thực chi; đóng entry phân bổ cọc đã hủy. Mobile chỉ theo dõi tiền/trạng thái Holding, hướng dẫn xử lý tại Owner Web. Staff không nhận thêm chi tiết refund/forfeiture qua HoldingDeposit DTO. Thông báo cancellation/refund có dedup, Owner được nhận khi chưa có Tenant account. Finance phân loại Holding principal return; đồng thời nhận đúng Security Deposit return sau explicit offsets, tránh gắn nhầm là expense hoặc unknown.

Files: HoldingCancellation, ContractHoldingService/Contracts/Controller, ContractService DI; HoldingRefundSource, RefundService/Repository/ContractDepositPosition; FinancialReportRefunds, SettlementNotificationPublisher; shared client, ContractActionDialog/HoldingDepositPanel/RefundPanel, Mobile ContractScreen/WorkflowPanel; tests. Vẫn Compact24/5 migrations, không schema change và không migrate DB làm việc.

Đã chạy: Application unit 400 PASS; PostgreSQL Holding/anonymous/finance/new-offset-refund nhóm 6 PASS, rồi contract/finance/recovery/Holding/final-utility hồi quy 29 PASS; Owner contracts/refund UI 24 PASS; Mobile holding/sections 13 PASS. Typecheck Owner/Mobile và changed-file ESLint tiếp tục qua commit gate. Storage/PDF/email test substitutes và bank evidence synthetic; không phải real provider hoặc UI E2E.

Lần chạy đầu đã sửa helper test thiếu idempotency-key argument, raw JSON fingerprint thay đổi sau jsonb canonicalization (nay hash typed v1), SQL dùng nhầm string status (nay dùng enum smallint thực tế). Assertions về source reference, money, không account, no duplicate refund, notifications và report classification đều được giữ và chạy lại.

## 11/11/2026 — Báo cáo nguồn phải thu/tiền thu/cấn trừ

BR-15/17/18/19/20/21/22, FE-08: financial report cộng khoản phải thu trả phòng vào issued/debt theo Room/Location, chỉ cộng verified bank allocation vào collections. Breakdown riêng cho approved charges/outstanding/bank collections/deposit offsets/Holding forfeitures; offset không là tiền chuyển mới, dư/unmatched/simulator không là doanh thu. Giữ công thức lợi nhuận/cashflow hiện có; Holding forfeiture chỉ hiện riêng, principal return không OPEX. Unknown/invalid source trả 409 cần đối chiếu. Owner Web và CSV hiển thị nguồn, decimal strings và date basis; What-if vẫn read-only.

Files: FinancialReportSettlements/Repository/Service, shared finance, FinancialReportsApiPage/financeExport và tests. Không schema/migration, database làm việc giữ nguyên. API/basis: docs/api/SETTLEMENT_FINANCIAL_REPORTING.md.

Đã chạy: Release solution build PASS; Application unit 401 PASS; PostgreSQL disposable receivable/Holding/finance/final-utility/fixed regression 17 PASS; Owner report/export/What-if 23 PASS. Owner typecheck PASS; Mobile typecheck và changed-file lint/format qua commit gate. Ca 600.000 damage + 400.000 offset → 200.000 debt sau release; receipt 50.000 + 150.000 đúng nguồn, 50.000 dư được hoàn không cộng collections; unknown kind buộc 409; đúng scope/date. Các lỗi đầu: sai tên kind (TenantDamage) trong source guard, số expected fixture bank 200.000/offset 400.000, và thiếu required fields ở CSV fixture đã sửa và rerun.

Chưa phải toàn bộ CI/E2E. Tiếp tục corrections/legacy deduction, whole/external-payer excess, Owner Mobile scope, retention/residence, isolated demo, UI E2E và final validation. Real bank/MySign/Email/SMS còn chờ cấu hình đã xác nhận từ người dùng.
# 11/11/2026 — Hoàn toàn bộ receipt nhận sau khi nghĩa vụ đã đủ

BR-17/18/19/23; BF-06, UC-22/25, GBR-10/18. Thêm Owner context/confirmation bất biến, claim bank reference và tái dùng refund request/approve/external execution có bằng chứng. Không allocation 0, không Tenant Credit, không cộng doanh thu. Invoice và settlement giữ pending/unresolved đến khi hoàn đủ. Chặn reject/phân bổ lại receipt đang hoặc đã hoàn; native allocation guard bảo vệ cả receipt/refund reservation. Hỗ trợ Holding Resident verified chưa có User và settlement đã physical release.

Files: ReceiptExcessDisposition/Repository/Controller; PaymentService/Repository; RefundService/Repository; FinancialReportRefunds; ContractSettlementLedger; migration SQL-only thứ 6 và fresh DDL; shared payments; Owner ReceiptExcessPanel/Picker, ReconcileTransfer, SettlementBankPanel, HoldingDepositPanel, invoice picker và tests. API chi tiết tại docs/api/REFUNDS.md. Không thay model/snapshot hoặc migrate DB làm việc; vẫn 24 bảng.

Đã chạy: PostgreSQL migration/baseline nhóm 9 PASS; whole-receipt 3 PASS (invoice race/replay/full return/no reuse, Holding chưa có account, receipt sau release/offset); Holding/receivable regression 7 PASS; refund/recovery/invoice/payment regression 53 PASS; Owner payments/refund component 24 PASS; Owner và Mobile typecheck PASS. Một lần UI test fail vì picker cũ chỉ lọc Unpaid đã dẫn tới bổ sung filter Paid rõ ràng, giữ mặc định Unpaid. Một lần chạy build test chồng với testhost đang chạy bị khóa DLL (MSB3027/3021); sau khi runner cũ hoàn tất, chạy tuần tự whole-receipt 3 PASS. Các fixtures dùng PostgreSQL disposable và storage/photo tổng hợp; chưa phải browser/native/real provider E2E.

Chưa hoàn thành toàn bộ yêu cầu. Payer ngoài Resident, Main Deposit overage, Tenant refund status, legacy deduction/corrections, Owner Mobile scope, retention/residence và full UI E2E/CI còn tiếp tục; real bank/MySign/Email/SMS chờ cấu hình người dùng đã xác nhận.
## 11/11/2026 — Tenant refund history sau trả phòng

BR-18/19/23, FE-07, UC-25/31/32: API Tenant chỉ liệt kê refund cho beneficiary Resident của authenticated user, áp quyền trước pagination và không phụ thuộc RoomId hiện tại. DTO tám trường chỉ có số tiền/nguồn/trạng thái/thời điểm/demo; không chứng từ, bank reference, audit actor, lý do nội bộ hay người nhận khác. Tenant Mobile mở từ Lịch sử thanh toán, không có mutation hoàn; APPROVED vẫn chờ thực chi. Backend/client/loader/components giữ isolation và lỗi/empty/retry/pagination.

Files: TenantRefundsController, TenantRefunds/RefundService/IRefundRepository, TenantRefundRepository, shared refunds, Mobile tenantRefunds/TenantRefundPanel/TenantPaymentHistoryScreen và tests. Không schema/migration hoặc thay DB làm việc. Chi tiết route/DTO trong docs/api/REFUNDS.md.

Đã chạy: Application unit 406 PASS (thêm role/pagination guards); PostgreSQL whole-receipt 3 PASS gồm Tenant own list/isolation/status sau RoomId null và exact DTO keys; sau bổ sung Security Deposit own history/closure nhóm 4 PASS. Mobile refund/history 29 PASS; Owner/Mobile typecheck PASS, changed-file ESLint PASS. Component/API không là native device hoặc real bank acceptance; receipt refund notification và external-payer/corrections vẫn còn tiếp tục.
## 11/11/2026 — Owner Mobile theo BR-26

Owner Mobile giữ contract/payment/adjustment/settlement/incident/work-order status, lịch sử, notification destinations và danh sách thông báo đã gửi. Gỡ các form Owner phân bổ/reject payment, duyệt điều chỉnh, quyết toán/inspection financial decisions, Owner contract activation/renewal/cancellation/draft preparation, phương án/chi phí/nghiệm thu sửa chữa và soạn/gửi thông báo. Có OwnerWebNotice chỉ dẫn dùng cổng đã được quản trị viên cung cấp; không hardcode địa chỉ hoặc dựng provider success. Các deep entry Owner cũ không mở draft form. Tab đổi Theo dõi duyệt. Staff/Tenant operations và shared/backend Owner Web authorization/actions giữ nguyên.

Files: Mobile OwnerDecisionScreens/OwnerOverviewScreen, ContractScreen/contractSections/ContractLifecyclePanel, IncidentActionPanel, navigation, OwnerWebNotice và tests. Không API/schema/backend change. Test Owner mutation UI cũ được thay bằng acceptance monitoring/không POST theo BR-26; test Emergency evidence version và concurrency vẫn chạy trên Staff được phép. Kiểm tra domain/API payload phía backend/Owner Web không bị gỡ. Tài liệu Mobile cũ mô tả Owner action nay là lịch sử trước quyết định BR-26.

Đã chạy: Mobile affected regression 107 PASS; sau thêm sent-announcement monitoring, component 3 PASS; Mobile typecheck và changed-file ESLint PASS. Lần đầu navigation test còn nhãn cũ Phê duyệt và TypeScript fixture status suy thành string đã sửa, chạy lại đạt. Chưa chạy Android/iOS device hoặc browser native acceptance; không coi component test là full E2E.
## 11/11/2026 — Retention metadata, giữ hồ sơ và rà soát

BR-27/GBR-13/OPEN-02: Owner Web có metadata policy, start basis/duration/reference mặc định null, các ràng buộc cư trú/hợp đồng/ledger/hoàn tiền, giữ theo từng hold và audit Review/PlaceHold/ReleaseHold. Reference/replay/transaction bảo vệ source mới nhất; gỡ manual hold không xóa restriction tài chính. Whole-receipt claim chưa tạo refund request cũng giữ refund_pending. Không select/decrypt envelope/HMAC để tạo view này; mọi CanDelete=false, không route xóa/ẩn danh hóa hoặc tự phê duyệt pháp lý. Duration/start basis/phạm vi dữ liệu vẫn chờ quyết định, hướng triển khai deletion sau này ghi trong docs/api/IDENTITY_RETENTION.md.

Files: IdentityRetentionService/Repository/Controller/options DI, safe null config; ReceiptExcessRecords thêm filter payer; shared identityRetention, Owner IdentityRetentionPanel/TenantsApiPage/error mapping và tests. Lưu append-only trong residents.history, không thêm bảng/migration, không đổi identity/HMAC/email/User/contract và không migrate DB làm việc.

Đã chạy: forced Release integration-project rebuild 0 warning/error; Application unit 411 PASS; PostgreSQL disposable retention/whole-excess/Owner resident administration 6 PASS; Owner retention/resident component 5 PASS; Owner force typecheck và Mobile typecheck PASS; changed-file ESLint/Prettier PASS. Có parallel/replay hold, stale context, gỡ hold sai, cấm Delete, private fields không lộ, identity/HMAC giữ nguyên, refund obligation trước/sau execution. Phát hiện clock/file timestamp trên máy lệch làm incremental .NET dùng DLL cũ (chỉ discover 3 test thay vì 4); đã force rebuild và chạy lại đúng 4, rồi 6 test với bản mới. Không coi lượt cũ là bằng chứng retention PASS. Chưa native/browser E2E hoặc legal approval.
## 11/11/2026 — Residence recurring reminders theo BR-28

JOB-08/UC-18/GBR-06/18: giữ policy WEEKLY/MONTHLY/hour đã cấu hình, mặc định tắt. Khóa row cư trú khi xét/publish, ngừng khi actual_move_out_date đã đóng hoặc Completed, không coi Owner legacy stamp là Completed. Chỉ Owner signer/Tenant occupant được nhận, loại Staff kể cả liên kết dữ liệu cũ sai role. Delivery kiểm exact Contract trong event key và tình trạng cư trú hiện tại; contract mới của cùng Resident không hợp thức hóa thông báo cũ. Dedupe window bền vững, không gọi VNeID/cadence mới.

Files: CompactNotificationReminders, NotificationChannelWorker, Compact24NotificationMvpTests, docs/api/NOTIFICATIONS.md. Không schema/API/UI hoặc migration DB làm việc. Đã chạy: non-incremental Release integration-project build 0 warning/error; PostgreSQL notification/residence 15 PASS. Có concurrent/repeated pumps, advance qua ba tuần, Owner/Tenant isolation, Completed/closed stop, wrong-role no Staff, suppressed old-contract delivery với channel probe tổng hợp. Ca đầu clock test trả UTC+7 bị Npgsql từ chối timestamptz; sửa GetUtcNow fixture trả UTC và chạy lại đạt. Không phải SMTP/push/VNeID thật.
## 11/11/2026 — Ngừng mutation legacy khấu trừ gộp

BR-20/21: DepositDeductionService chỉ cho Owner replay đúng quyết định đã có; mọi new/revision key bị 409 hướng dẫn SettlementReceivable + DepositOffsetApproval, không giới hạn thiệt hại bằng số cọc theo luồng cũ. Bỏ repository write/context tạo plan, Owner Web legacy plan chỉ đọc. Shared/backend DTO đọc, ledger/refund/report/evidence verification giữ nguyên; Production vẫn chặn demo replay. Không retroactively chuyển/xóa quyết định cũ hoặc sửa Final invoice.

Files: DepositDeductionService/Repository, shared contract error, Owner DepositDeductionsPanel/ContractLifecyclePanel và tests. Historical regression được đổi sang seed explicit typed legacy plan/proof/audit, giữ replay/versions/refund remainder/full retention/no double charge/report/tamper guards. Đây là dữ liệu tổng hợp trước thay đổi, không phải production creation đã thành công. Không schema/migration/DB làm việc.

Đã chạy: Release non-incremental integration build 0 warning/error; Application unit 412 PASS; PostgreSQL historical legacy + canonical receivable/offset/payment regression 6 PASS; Owner legacy/lifecycle/refund component 19 PASS; Owner force typecheck/Mobile typecheck và changed-file lint/format PASS. Browser/native/real bank chưa chạy; correction workflow tổng quát và payer ngoài Resident/Main Deposit overage vẫn cần tiếp tục.
## 11/11/2026 — Hoàn tiền cho payer bên ngoài không có Resident/User

BR-17/18/19/23: Owner attests actual external payer theo verified receipt/sao kê với immutable source fingerprint/key/actor/reason. Payer không phải hồ sơ Tenant/Resident giả; native refund beneficiary phân biệt RESIDENT/EXTERNAL, XOR identity, source/budget/completion-proof guards và không relabel thành Tenant allocation. Partial/whole excess dùng refund workflow hiện hữu, replay/parallel execution không double return. Source/proof được phân loại trong finance, không revenue/OPEX/credit. Tenant payment history chỉ nhãn chung, own-refund list không chứa payer ngoài. Settlement nay giữ pending cho cả allocated excess còn phải hoàn sau physical release, không chỉ whole-excess.

Files: ExternalPaymentPayer service/repository/controller, payment guards/history, receipt-excess/Refund DTO/service/repository, FinancialReportRefunds, ContractSettlementLedger, migration SQL-only thứ 7 + fresh DDL/readiness, shared clients và Owner ExternalPaymentPayerPanel/Refund/ReceiptExcess/Reconcile/SettlementBank UI, tests. Native schema vẫn 24 bảng/model không đổi. Không migrate DB làm việc, không thêm provider/fake real-bank callback. API và giới hạn: docs/api/EXTERNAL_PAYMENT_PAYERS.md.

Đã chạy: non-incremental Release integration build 0 warning/error; Application unit 415 PASS; PostgreSQL payer + upgrade 6→7 2 PASS, rồi external/whole/receivable/refund/historical regression 16 PASS. Migration giữ recipient/amount cũ, readiness phát hiện body proof function bị thay; source/payer mismatch và native Tenant relabel bị chặn. Owner payments/refund/payer UI 27 PASS; Owner force typecheck/Mobile typecheck và changed-file ESLint/Prettier PASS. Assertions không tăng Resident/User, không allocation 0, actual payer private không lộ Tenant, paid/collections không tăng khi hoàn, legacy Resident request hash shape giữ nguyên. Lỗi compile đầu thiếu namespace PaymentRules đã sửa; các test được chạy sau rebuild. Chưa browser/native/live bank/SMTP acceptance.

Chưa giải quyết Main Deposit overage, excess do adjustment/reversal, principal deposit payer ngoài hoặc sửa payer đã chốt sai; các nguồn không đủ chứng cứ vẫn cần Owner đối chiếu, không lách bằng account/Resident giả. Tiếp tục các slice nội bộ và full CI/UI E2E, provider thật vẫn chờ cấu hình đã được người dùng xác nhận.
