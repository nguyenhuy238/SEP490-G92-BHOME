# Triển khai và kiểm chứng các nhiệm vụ Nguyễn Quốc Huy

## Tiếp tục yêu cầu remaining E2E — 06/11/2026

TASK: BE-19 / BE-X07
SLICE: Owner Web hoàn cọc và xem số liệu quyết toán từ API

IMPLEMENTED:
- ContractLifecyclePanel mở RefundPanel nguồn SecurityDeposit theo Contract đang xem; tái sử dụng flow request/approve/reject/manual execution/private download, không tạo frontend mới hoặc tính lại tiền ở client.
- Shared client bổ sung depositSource/createDeposit và nullable source union; server calculation hiển thị issued/payable/paid, cọc dùng/hoàn/giữ chỗ/khả dụng. Unknown giữ Chờ đối chiếu.
- Không tự chọn người nhận; bắt buộc xác nhận nguồn, người nộp theo evidence và không khấu trừ. Consent/key gắn source fingerprint/balance/requests; source đổi reset consent và tạo key cho payload mới. Lỗi 503 giữ cùng key/payload, không báo Completed.
- Blockers chặn create/approve/execution; vẫn cho Reject để giải phóng reservation. Owner settlement review gắn summary.reference; NoAdditionalCharges gắn inspection/version, không dùng consent cũ cho dữ liệu mới.

CHANGED FILES:
- packages/client-core/src/{contracts,refunds,useContractLifecycle}.ts
- src/owner-web/src/features/payments/{RefundPanel,RefundPanel.test}.tsx
- src/owner-web/src/features/contracts/{ContractLifecyclePanel,ContractLifecyclePanel.test}.tsx
- API inventory/status/REFUNDS docs, generator và báo cáo này.

TESTS:
- `npm.cmd run test --workspace src/owner-web -- src/features/payments/RefundPanel.test.tsx src/features/payments/Payments.test.tsx src/features/contracts/ContractLifecyclePanel.test.tsx --maxWorkers=1`: **20/20 đạt**, 3 files.
- `npm.cmd run build --workspace src/owner-web` và `npm.cmd run lint --workspace src/owner-web`: **đạt**.
- `npm.cmd run typecheck --workspace src/mobile`: **đạt** trên shared DTO/client mới.
- Có deposit route/body/attestations đúng, retry key, snapshot đổi reset consent/key, unknown balance, blocked approval nhưng được reject, receipt multipart/recovery regression và settlement consent stale. Logs .tools/huy-deposit-owner-{ui,build,lint}.log; .tools/huy-deposit-shared-mobile-typecheck.log.
- Generator 215 routes/234 callsites, diff check đạt. Component network được mock; chưa gọi đây là browser/MinIO/native E2E.

COMMIT:
- Message: feat(moveout): [BE-19] integrate Owner deposit return and settlement review
- SHA: `15d8204b42577cf37cd665701d8ff77a6b013ff5` (ghi sau commit, đưa vào slice Mobile).

FRONTEND HANDOFF:
- Owner Web: Vũ Xuân Trường review UI/UX. Mobile: Bùi Bảo Long; client/DTO tương thích, chưa bổ sung hiển thị Mobile trong slice này.

STATUS: PARTIAL — Owner API UI đã nối và kiểm component/build/lint; BE-19/BE-X07 chưa DONE.

REMAINING:
- Browser Web/API/Compact24/MinIO thật cho move-out/cọc mới, Mobile visibility/native acceptance, khấu trừ có phí, notification và Finance classification. Không tự payout hoặc bỏ backend guards.

TASK: BE-19 / BE-X07
SLICE: Hoàn cọc không khấu trừ bằng xác minh thủ công, giữ source riêng và chặn closure sớm

IMPLEMENTED:
- UC-19/GBR-01/02/18, OQ-01/05 và ủy quyền triển khai → GET/POST contracts/{id}/deposit-refunds; reuse decision/execution/evidence hiện hữu nhưng source_deposit_contract_id riêng, source_payment_id null.
- Chỉ nhánh Owner xác nhận inspection không phát sinh phí, invoice Final/paid, Final readings billed/khớp, không Adjustment/bank/excess/holding/allocation chưa xử lý. Không tự đặt damage fee hoặc chia nợ phòng.
- Owner phải xác nhận đã kiểm người nộp/người nhận và không khấu trừ; choices chỉ là occupant Verified/liên kết tài khoản, không suy representative là depositor. Ghi attestation và obligation fingerprint trong history SecurityDepositRefundV1.
- Reservation/approval/execution dùng ledger lock/version/key; external refund thực hiện ngoài BHOME, Owner đối chiếu sao kê và upload ảnh private. Intent bền vững trước Put, kiểm readback/hash trước Completed; mất kết nối vẫn Approved, đúng key/bytes phục hồi. Demo nguồn chặn Production, kể cả replay.
- Root deposit không đếm lặp renewal; hai nguồn refund loại trừ nhau. FinancialReference không tự stale vì reservation/return của chính workflow, nhưng nghĩa vụ đổi chặn approve/execute. Reject giải phóng reservation.
- Chỉ toàn bộ cọc đã hoàn được phân loại, không reservation, không phí và mọi guard đạt mới xác nhận 0 deductions/VerifiedManual; Owner vẫn review settlement rồi complete. Unknown/legacy Completed không release dù bằng đủ cọc. Receipt excess PendingReview cũng được kiểm trước settlement.

CHANGED FILES:
- RefundsController.cs; Application/Finance/RefundService.cs; Application/Contracts/{ContractContracts,SettlementCalculation}.cs
- Infrastructure/Finance/{RefundRepository,DepositRefundSource}.cs; Infrastructure/Contracts/{ContractDepositPosition,ContractSettlementLedger}.cs
- RefundModeTests.cs; PaymentsDebt/{DepositRefundTests,ContractClosureTests}.cs; Compact24/{Compact24WorkflowRegressionTests,Compact24DepositRecoveryTests}.cs
- API module/status/index/runtime docs, inventory generator và báo cáo này.

TESTS:
- `dotnet test tests/backend/BHome.Application.UnitTests --no-restore --filter 'FullyQualifiedName~SettlementCalculationTests|FullyQualifiedName~RefundModeTests' --verbosity minimal`: **13/13 đạt**.
- `dotnet test tests/backend/BHome.IntegrationTests --no-restore --filter 'FullyQualifiedName~Compact24PaymentRegressionTests.DepositReturn|FullyQualifiedName~Compact24PaymentRegressionTests.DepositPositions|FullyQualifiedName~Compact24PaymentRegressionTests.SettlementCalculation|FullyQualifiedName~Compact24RefundTests|FullyQualifiedName~Compact24DepositRecoveryTests|FullyQualifiedName~RealLedgerRequiresReviewedSnapshot|FullyQualifiedName~NewAdjustmentAfterSettlement|FullyQualifiedName~Compact24ApiAuditTests' --verbosity minimal`: **18/18 đạt, 0 skip**; 12 workflow/refund/closure + 6 audit. PG disposable riêng 55440; storage test boundary.
- Audit: **215 routes, 210 protected trả 401, 5 anonymous, 106 Owner GET probes, 0 HTTP5xx**: 200=32, 204=2, 400=10, 403=3, 404=59. Generator tái sinh từ manifest mới; không thêm schema.
- Có duplicate requests/parallel approval/parallel execution replay, stale obligation/reject release, private proof, unknown full refund, source identity, tenant/staff denial, loss after Put/recovery/changed image conflict, manual-return→settlement→closure. Fixtures inspection/invoices là persisted synthetic preconditions, không phải full onboarding/browser acceptance.
- Lỗi đã sửa: chạy build đồng thời gây CS2012 nên tách build tuần tự; fixture ExecuteUpdate không dùng được với Compact24 SQL projection nên dùng tracked fixture updates; regex hash trong interpolated SQL bị coi {64} là parameter, sửa thành parameter regex đầy đủ, không bỏ integrity guard. Logs .tools/huy-deposit-refund-{unit,pg,build}.log.

COMMIT:
- Message: feat(deposit): [BE-X07] return undisputed security deposits with verified evidence
- SHA: `1d1eb1be94e6893dd02e8d551bc4e58f7cc36702` (ghi sau commit, đưa vào slice UI).

FRONTEND HANDOFF:
- Owner Web Vũ Xuân Trường; Mobile Bùi Bảo Long. Chưa nối hai deposit routes trong slice backend này; Tenant hiện xem settlement summary, không evidence/Owner actions.

STATUS: PARTIAL — nhánh backend không khấu trừ đã kiểm chứng; chưa đánh dấu BE-19/BE-X07 DONE.

REMAINING:
- Khấu trừ có phí/damage/debt journal, Owner/Mobile UI, actual Web/API/MinIO E2E, refund notification và Finance classification. Bank/provider/native acceptance chưa chạy; không auto payout, không hợp thức hóa simulation/signature.

TASK: BE-19 / BE-X07
SLICE: Tổng hợp nghĩa vụ và vị thế nguồn cọc trước quyết định Owner

IMPLEMENTED:
- UC-19 (SRS p1812–1851), GBR-01/02/18, OQ-01/05 và ủy quyền người dùng → existing SettlementSummary/ledger → calculator + Compact24 source-position reader; không tự quyết định phí/deduction/deadline.
- Tổng hợp issued/approved Final delta/payable/verified allocations/room outstanding/excess riêng; shared debt chưa chia không gán hết cho Tenant. Không cộng cọc vào doanh thu hoặc cộng rent theo số người.
- Cọc khả dụng trừ net deposit allocations, Completed refunds và Requested/Approved reservations. Rejected không giữ chỗ; unknown/mismatch/âm không thay bằng 0. Root verifications không cộng lặp theo renewal; position đọc các ID trong chain.
- Source position nằm trong reference snapshot hiện hữu; thay source làm đổi reference. API Owner/Tenant vẫn qua role/object scope và payment-ledger/Location/Room lock; Staff/cross-Tenant không mở quyền tài chính.
- Giữ blocker cọc và mọi guard inspection/readings/invoices/settlement/closure. Số dư khả dụng chưa phải approved refund hoặc authorization chi tiền.

CHANGED FILES:
- src/backend/BHome.Application/Contracts/{ContractContracts.cs,SettlementCalculation.cs}
- src/backend/BHome.Infrastructure/Contracts/{ContractSettlementLedger.cs,ContractDepositPosition.cs}; DependencyInjection.cs
- tests/backend/BHome.Application.UnitTests/Contracts/SettlementCalculationTests.cs
- tests/backend/BHome.IntegrationTests/PaymentsDebt/ContractSettlementTests.cs; Compact24/Compact24WorkflowRegressionTests.cs
- docs/api/CONTRACT_LIFECYCLE.md và báo cáo này.

TESTS:
- `dotnet test tests/backend/BHome.Application.UnitTests --no-restore --filter FullyQualifiedName~SettlementCalculationTests --verbosity minimal`: **9/9 đạt**.
- `dotnet test tests/backend/BHome.IntegrationTests --no-restore --filter 'FullyQualifiedName~Compact24PaymentRegressionTests.SettlementCalculation|FullyQualifiedName~Compact24PaymentRegressionTests.DepositPositions|FullyQualifiedName~RealLedgerRequiresReviewedSnapshot|FullyQualifiedName~NewAdjustmentAfterSettlement' --verbosity minimal`: **5/5 đạt, 0 skip**, Compact24 thật + legacy closure regression; PG riêng port 55440.
- Có tiền chính xác 18 chữ số, shared/exclusive debt, approved Adjustment/paid totals, overdraw/mismatch/unknown, source transfer/refund/reservation, private scope và snapshot đổi. SQL refund/transfer trong fixture là synthetic preconditions để kiểm read model, không phải nghiệm thu workflow tạo/duyệt/chi cọc.
- Lượt đầu compile fail CS8361 do conditional interpolation trong fixture; đã thêm parentheses, không nới guard/assertion. Logs .tools/huy-settlement-calculation-{unit,pg}.log.

COMMIT:
- Message: feat(moveout): [BE-19] calculate settlement obligations and available deposit
- SHA: `f4e0f70ba433c159f504d32f696807e7db548f75` (ghi sau commit, được đưa vào slice tiếp theo).

FRONTEND HANDOFF:
- Owner Web: Vũ Xuân Trường; Mobile: Bùi Bảo Long. Optional calculation DTO chưa hiển thị ở client trong slice này; nối sau bằng số server, không tính lại bằng Number.

STATUS: PARTIAL — calculation slice đã kiểm chứng; toàn bộ BE-19/BE-X07 chưa DONE.

REMAINING:
- Owner-supported deductions/final-charge decisions, source-specific deposit refund/beneficiary verification, Owner/Mobile UI, notification và full move-out browser/native E2E. Không coi existing receipt-excess refund là deposit refund; không fake Resolved/Completed hoặc bank payout.

## Tiếp tục sau merge af97676 ngày 05/11/2026

### Kết quả hồi quy đã chốt ngày 06/11/2026

Commit chốt evidence trước slice hoàn tiền: `8abd2b1926c37c8d6dfc964873617f43f63a5a9f`. Các số full suite trong mục này là trước slice hoàn tiền mới bên dưới; không suy ra kết quả toàn bộ bản mới nếu chưa chạy lại.

Sau commit OCR `565eb8d`, `dotnet test src/backend/BHome.sln --no-restore --verbosity minimal` với PostgreSQL riêng 55440/query-log/evidence-directory: **Domain 90/90, Application 250/250, Integration 612 đạt / 1 opt-in skip / 0 lỗi (613 tổng)**. Bài model OCR opt-in đã chạy riêng trên cùng bản code **1/1 đạt**, không cộng lần chạy riêng vào số full suite. Owner Web full **137/137**, Mobile full **376/376**, Digital Signing unit **41/41**; Owner build/lint, Mobile typecheck/lint và harness build đạt. Browser/harness **15/15 nhóm** như slice bên dưới. Không công bố coverage, ST/AT hay benchmark hiệu năng từ số đếm này.

Audit runtime mới: **208 routes, 203 protected/5 anonymous, 103 Owner GET probes, 0 HTTP5xx**; GET 200=32, 204=2, 400=10, 403=3, 404=56. 13 manifest synthetic populated migration đều committed/source-read-only và toàn bộ 70 nguồn đối chiếu keys/values khớp. Đã thực thi rollback/error/privacy/legacy-independence tests trong full suite; không migration database làm việc. Các artifacts/logs nằm .tools ignored, chỉ metadata/kết quả được ghi báo cáo. Cluster test TEMP 55440 được xác minh đúng port, còn 0 database fixture rồi đã dừng; không dừng PostgreSQL dự án.

Commit tiếp tục gần nhất: `e9103a7` test route query, `3a683f9` historical occupancy, `dc7ed48` shared billing clients, `565eb8d` OCR identical-input cache. Tất cả commit local trên member/QHuy; không push/merge. Ma trận cuối tài liệu là trạng thái cập nhật, bảng audit ban đầu giữ để truy vết lịch sử.

### Slice BE-X07 / BE-22 / BE-X08 — hoàn phần tiền thừa receipt

UC-22/25, BF-06, GBR-01/02/10/18 và ủy quyền chính sách OQ-01/02/05 → RefundService/Repository/Controller, shared refund client, RefundPanel trong đối soát Owner, PaymentRepository.PendingReview và FinancialReportRepository. Contract trước code ghi tại [REFUNDS.md](../api/REFUNDS.md). Tái sử dụng bảng refund_requests/JSON history/private storage hiện hữu và ledger lock; không thêm bảng/cột/dependency. Chỉ source VERIFIED đã allocated/actual payer xác định, beneficiary Resident đúng Room đã verified. Requested/Approved/Completed giữ chỗ, reject giải phóng; version/UUID key/race guard. Owner lập/duyệt và ghi nhận giao dịch hoàn bên ngoài đã đối chiếu sao kê, không tự chuyển ngân hàng.

Execution lưu durable intent/hash/ref trước Put, sau storage readback đúng mới Completed. Retry/pending reopen dùng cùng key/bytes/time/ref; chứng từ private kiểm hash trước download. History snapshots append-only đúng trigger, actor/time/reason/audit đủ. Demo flag theo source và chặn mutation trong Production. Không sửa Invoice/Allocation/Payment hoặc tạo credit. Cờ invoice pendingReview hết khi phần excess được Completed đủ; refund chưa phân loại vẫn chặn cashflow/recovery, v1 excess refund hợp lệ không thành OPEX vì excess chưa tính vào revenue.

Backend `dotnet test tests/backend/BHome.Application.UnitTests --no-restore --filter 'FullyQualifiedName~Finance' --verbosity minimal`: **11/11 đạt**. `dotnet test tests/backend/BHome.IntegrationTests --no-restore --filter 'FullyQualifiedName~Compact24RefundTests|FullyQualifiedName~Compact24FinanceLedgerTests|FullyQualifiedName~Compact24PaymentRegressionTests' --verbosity minimal` với PostgreSQL riêng: **32/32 đạt, 0 skip** trên bản cuối. Có role/service bypass rejection, Production demo denial, reservation race/under-over history regression, stale/reject/unknown payer, hai refunds/receipt, reference collision, oversized/malformed/tampered evidence, storage interruption/recovery và Completed replay/parallel/audit một lần. Fixture cũ không ghi actual payer đã lộ đúng chặn; bổ sung tham số test-only chọn actual payer qua service, không update allocation bất biến trực tiếp.

Owner `npm.cmd run test --workspace src/owner-web -- src/features/payments/RefundPanel.test.tsx src/features/payments/Payments.test.tsx --maxWorkers=1`: **12/12 đạt**. Có human consent, retry key, API failure không báo Completed, pending upload/recovery, server-only status và multipart boundary; shared API client chỉ bỏ JSON Content-Type khi body thực là FormData. JSON/auth handling giữ nguyên. Owner build/lint, Mobile typecheck và harness build đạt. Không thêm màn Finance Owner vào Mobile.

Harness `dotnet run --project tools/BHome.ContractVerification --no-build -- --finance --main-draft`: **16/16 nhóm đạt**, exit 0, API/Web build/Compact24/MinIO thật. Từ Main Draft ba Resident → confirmed readings/Invoice/Adjustment/partial/excess → Owner browser reserve/approve/record synthetic refund 10.000 VND, private evidence reload/download đúng bytes. Ba Tenant không đọc refund source/chứng từ của người khác; invoice vẫn Paid/hai allocations, pendingReview chỉ tắt sau Completed; report totals/capital unchanged. DB giữ một Final Invoice/ba recipients/hai allocations và một refund Completed có evidence. Không có actual bank transfer/MySign hoặc native camera/device acceptance.

Changed files: RefundService, RefundRepository, RefundsController/DI; PaymentRepository/FinancialReportRepository; refunds.ts/api.ts; RefundPanel/useRefundApi/OwnerInvoicePaymentPanel và test; Compact24RefundTests/RefundModeTests/PaymentLedgerTests helper; Verify-ExcessRefundClients/Verify-SharedBillingClients/FinanceVerificationCli; REFUNDS/FINANCE/PAYMENTS và báo cáo. Lỗi các vòng đầu được ghi: decimal DTO read handling, fixture payer null, history trigger chống overwrite và browser locator; đã sửa không tắt guard, tăng timeout hoặc fake outcome. Handoff Vũ Xuân Trường/Bùi Bảo Long; slice DONE cho manual receipt-excess refund. Deposit deductions/refund, Adjustment-created excess, payer chuyển Room, native/provider/reviewer còn lại; BE-X07 tổng vẫn PARTIAL. Commit `12043f02590d44189fc14b38bc36c96bc3812643`. Full regression bản mới chạy sau commit, chưa suy rộng focused results.

### Slice BE-X07 — UI giữ đúng consent và trạng thái xử lý excess

Review sau commit tìm được hai lỗi UI: reason đối soát lịch sử vẫn hiển thị “đang chờ” sau khi refund Completed; upload intent mới tới server không đổi version nên component có thể giữ fields/consent của intent cũ. Đổi caption đối soát thành mô tả nguồn lịch sử và dẫn tới trạng thái refund; remount form theo id/version/intent key để lấy metadata đúng và bỏ consent cũ. Khóa lập yêu cầu khi server báo available=0; không tự tính/refund bằng UI. Không đổi endpoint hoặc server financial effects.

`npm.cmd run test --workspace src/owner-web -- src/features/payments/RefundPanel.test.tsx src/features/payments/Payments.test.tsx --maxWorkers=1`: **13/13 đạt**. Bài mới cập nhật intent mà version không đổi, kiểm ref/reason từ server và consent reset. Files RefundPanel/RefundPanel.test, OwnerInvoicePaymentPanel/Payments.test và báo cáo; handoff Vũ Xuân Trường. Owner build/lint **đạt**. Commit `17c4228936ce8389c47b79c201d3ca80e998d6a3`; full Owner suite kiểm tiếp sau backend.

### Hồi quy sau manual excess refund

`dotnet test src/backend/BHome.sln --no-restore --verbosity minimal` với test-admin/query-log/evidence-directory riêng: **Domain 90/90, Application 253/253, Integration 615 đạt / 1 opt-in OCR skip / 0 lỗi (616 tổng)**. OCR production không thay sau smoke model thật 1/1 đã ghi ở slice trước; không tính skip thành pass. Log .tools/huy-refund-full-backend.log. `npm.cmd run test --workspace src/mobile -- --maxWorkers=1`: **376/376 đạt, 38 files** trên shared client mới, log .tools/huy-refund-full-mobile.log. Owner full chạy riêng sau backend/Mobile: `npm.cmd run test --workspace src/owner-web -- --maxWorkers=1` **144/144 đạt, 23 files**, 151,88 giây, không tăng timeout/giảm assertions; log .tools/huy-refund-full-owner.log.

Audit mới **213 routes / 208 protected / 5 anonymous, 105 Owner GET probes, 0 HTTP5xx** (200=32, 204=2, 400=10, 403=3, 404=58). 13 migration manifest vẫn committed/source-read-only, 70 nguồn keys/values đối chiếu khớp trong mỗi manifest. Không migration database làm việc. Hai route GET và ba POST mới là refund workflow, không nhân số đếm Finance cũ. Build backend/harness 0 warning/error, Owner Web build/lint đạt, Mobile typecheck đạt. Browser 16/16 nhóm exit 0; không chạy lại NFR/coverage/production bank. Đã xác minh 0 database fixture còn lại, dừng riêng cluster TEMP 55440 đúng port; không còn API/browser helper, không dừng PostgreSQL dự án. Không push/merge; mọi bank/signing operation trong browser vẫn synthetic. Postman workspace/collection không được dùng hoặc publish trong lượt này; kiểm chứng qua contracts và test runner hiện hữu của repository.

Working tree đầu lượt tiếp tục sạch trên member/QHuy. Đã xác minh các commit triển khai trước; merge mới chứa thay đổi Location của nhóm, không khôi phục phiên bản trước merge. Truy vết slice đầu: UC-15 / GBR-04 / DBR-03 yêu cầu tài liệu ký và evidence đúng phiên bản, private download có quyền và kiểm tra integrity → ContractService.CopyDocumentAsync + storage → kiểm thử Owner/Tenant đọc đúng, Staff/cross-Tenant bị chặn, bytes bị sửa trả 409 và không sửa trạng thái ký. Không đổi route/DTO/schema.

TASK BE-15 / BE-X06 — SLICE integrity tài liệu đã ký: đã kiểm tra snapshot/hash và đọc vào buffer trước khi trả nội dung; chỉ chấp nhận Signed/Simulated đúng chế độ hợp đồng. Backend thay ContractService.CopyDocumentAsync; không sửa UI/Mobile vì giữ nguyên endpoint/error contract. `dotnet test tests/backend/BHome.IntegrationTests --no-restore --filter 'FullyQualifiedName~SignedDocumentDownloadRejects|FullyQualifiedName~SignedDocumentIntegrity' --verbosity minimal`: **2/2 đạt**, legacy+MinIO và Compact24. Fixture signing là test boundary được gắn nhãn, không phải MySign staging. STATUS DONE cho slice; BE-15/BE-X06 vẫn PARTIAL. Handoff Vũ Xuân Trường/Bùi Bảo Long, lỗi 409 được client hiện hữu xử lý. Commit `133863548bb42dfd514bb070ee7cc07bd78e9208`.

### Slice BE-15 / BE-X06 — phát hành Main Draft đã xem xét

Truy vết: UC-15 / GBR-01/02/04 / DBR-02/03 → MainDraftService, MainDraftRenderer, ContractSigningDocumentSource, hai signing adapters, MainDraftReleasePanel/shared client → test stale version/configuration/file, integrity, Owner-only, cross-Tenant, replay/parallel release và chuỗi review → signing simulation → verified deposit → activation.

Khoảng trống đã sửa: Main Draft trước đây không có bước chuyển sang lifecycle ký; snapshot bản nháp khác seal của Contract. Owner Web nay tải đúng PDF của phiên bản đã lưu, chọn Tenant đại diện, xác nhận xem xét rồi release. Backend kiểm lại mọi điều kiện, giữ encrypted metadata, ghi canonical Preview nguyên bytes/hash và liên kết Tenant trong transaction. Adapter dùng đúng nguồn đã xem xét; không dựng lại mẫu khác. Chế độ signing ghi ngay khi tạo Draft và không đổi sau đó. Không thêm bảng/cột nghiệp vụ.

Mẫu DOCX hiện tại chưa được duyệt production: review PDF mang nhãn thử nghiệm và chỉ Development/Testing; Production trả 503. MySign staging vẫn BLOCKED. Integration simulation không phải chữ ký số hợp pháp. MinIO thực trong Docker và LibreOffice thực được dùng ở regression legacy; Compact24 dùng storage boundary test. Không truy cập database làm việc `bhome`.

Owner Web: 16/16 component tests (MainDraftReleasePanel, MainDraftSettingsPanel, Contracts) đạt; build và lint đạt. Kiểm tra chọn file/version, human confirmation, chống double submit, retry giữ idempotency key, unsaved changes, lỗi template không báo thành công. Mobile chưa sửa; released Contract đi qua preview/signing hiện hữu, cần kiểm thử bổ sung và browser acceptance sau commit. Handoff Vũ Xuân Trường/Bùi Bảo Long: INITIAL_API_UI_READY, cần review UI. BE-15/BE-X06 vẫn PARTIAL.

Backend: `dotnet test tests/backend/BHome.IntegrationTests --no-restore --filter 'FullyQualifiedName~Compact24MainDraftRegressionTests|FullyQualifiedName~Compact24ContractRegressionTests|FullyQualifiedName~ReviewedMainDraftReleasesOnce|FullyQualifiedName~ReleaseRejectsStaleReview|FullyQualifiedName~ContractPdfRendererTests' --verbosity minimal`: **57/57 đạt, 0 skip**. Đã sửa lỗi storage key trùng và giữ signing mode bất biến được phát hiện qua legacy regression; không nới ràng buộc DB. Backend build 0 warning/error. PostgreSQL riêng port 55440, dữ liệu tổng hợp; các fixture tự xóa database riêng.

Commit slice release: `0e0c3aeed0b8c3c91e3c739df29ac9d6f18f9948` — `feat(contract): [BE-15] release reviewed Main Draft into signing`.

### Slice BE-15 — kiểm chứng client thực ngày 06/11/2026

Đã sửa nhánh Owner Web mở Main Draft từ danh sách: sau release chuyển sang ContractDetailPanel thay vì tiếp tục hiển thị editor. Truy vết UC-15/GBR-04/18; không đổi API/DB. Mở rộng harness hiện hữu bằng `--finance --main-draft`, sử dụng bản build thật của Owner Web, API thật, PostgreSQL Compact24 tạm và MinIO Docker riêng. Không thêm ứng dụng UI khác, không intercept/mock API, không đổi CA trust của Windows. Browser chỉ bỏ kiểm CA trong context localhost tổng hợp; không công bố đây là nghiệm thu TLS production.

`dotnet run --project tools/BHome.ContractVerification --no-build -- --finance --main-draft`: **8/8 nhóm đạt**, exit 0: 5 nhóm Finance/settings cũ và 3 nhóm Main Draft mới. Staff dùng MobileApi + shared mainDraftClient thật để tạo/xác nhận Resident tổng hợp, lưu/đọc lại Draft sử dụng cấu hình Owner. Owner dùng browser tải PDF từ LibreOffice/MinIO, human confirmation, chọn Tenant, release từ danh sách. Tenant dùng MobileApi thật tải đúng bytes/hash canonical PDF; Tenant khác 404, Staff 403. Owner/Tenant ký **simulation được gắn nhãn**, xác nhận sao kê tổng hợp, Owner kích hoạt; Tenant thấy Active/2 Simulated signatures/1 deposit và Room Occupied. Kích hoạt thiếu điều kiện bị 409. Không có MySign thật hoặc giao dịch ngân hàng thật; nghiệm thu provider vẫn BLOCKED.

`npm.cmd run test --workspace src/mobile -- signing-ui.test.tsx contracts.test.ts --maxWorkers=1` với Node 22: **27/27 đạt**. Test bổ sung Tenant consent, pending response, chống double submit, chỉ callback success sau backend; đây là component test, không phải native device E2E. Không thấy adb trong PATH, native acceptance NOT RUN. Không sửa production Mobile vì màn ký và private download đã có.

`npm.cmd run test --workspace src/owner-web -- src/app/router.test.tsx --maxWorkers=1`: **37/37 đạt**. Timeout lịch sử không tái hiện khi chạy riêng; không tăng timeout, không giảm assertion, chưa kết luận đã sửa một lỗi router sản phẩm. Lần browser dev-server đầu timeout navigation; harness chuyển sang bản build production trong TEMP và đã đạt. Một lỗi locator test chọn cả Drawer và action dialog đã sửa bằng accessible dialog name, không thay logic sản phẩm.

Changed files: ContractsPage, FinanceVerificationCli/ContractVerificationCli, Verify-FinanceClients/Verify-MainDraftClients, mobile signing-ui test, báo cáo/API notes. Handoff Owner Web Vũ Xuân Trường và Mobile Bùi Bảo Long; task tổng BE-15/BE-X06 vẫn PARTIAL do provider/mẫu production và native acceptance.

Validation slice: harness .NET build **0 warning/error**; Owner Web build/lint đạt; Mobile typecheck/lint đạt với Node 22. Các lệnh/kết quả chỉ áp dụng các thay đổi đã nêu, chưa thay cho full regression cuối đợt.

Commit kiểm chứng client: `51c0d3f7065c6b46fda4c82258335fb21f543fd0` — `fix(contract): [BE-15] leave draft editor after release and verify real clients`.

### Slice BE-17 — xác nhận đúng phiên bản bàn giao, 06/11/2026

UC-17 / GBR-01/02/18 → shared useContractHandover, Mobile ContractHandoverPanel, API hiện hữu → test đổi Contract, phiên bản server thay đổi, quyền Staff/Tenant và bàn giao với evidence thật. Lỗi tìm được: Mobile giữ checkbox từ phiên bản trước khi server trả phiên bản mới; shared hook cũng giữ record cũ khi đổi context/tải lại lỗi. Đã gắn dữ liệu với client/Contract/role/revision và xác nhận với Contract/version. UI phải hiển thị đúng record trước khi cho xác nhận; backend vẫn kiểm version và quyền như cũ. Không đổi schema, API hay quy tắc xác nhận.

`npm.cmd run test --workspace src/mobile -- handover-ui.test.tsx signing-ui.test.tsx --maxWorkers=1`: **8/8 đạt**. Test mới kiểm consent của phiên bản mới, ẩn nội dung cũ khi đổi Contract/read bị từ chối, Staff bị khóa trước Tenant confirmation và lỗi server không báo thành công. Mobile typecheck/lint đạt. `npm.cmd run test --workspace src/owner-web -- src/features/contracts/Contracts.test.tsx src/features/contracts/ContractLifecyclePanel.test.tsx --maxWorkers=1`: **13/13 đạt**.

Harness hiện hữu `--finance --main-draft` mở rộng `Verify-HandoverClients.cjs`: **9/9 nhóm đạt**. Hai Initial tasks/ảnh PNG tổng hợp thật được upload MinIO và Staff human-confirm qua MobileApi; test thiếu human confirmation, sai utility, duplicate reading replay. Tạo Asset qua API, upload ảnh bàn giao riêng tư, Staff save/replay, Tenant dispute, Staff sửa, stale confirmation 409, Tenant xác nhận v2 rồi Staff hoàn tất. Owner browser đọc đúng inventory/confirmed v2 và tải ảnh private; Tenant tải đúng ảnh bàn giao/điện, cross-Tenant 404. History có đủ 5 event, không cho sửa bản Confirmed. Không seed reading/Active trực tiếp vào DB. Đây là Mobile transport + component evidence; native camera/device E2E vẫn NOT RUN.

Changed files: useContractHandover, ContractHandoverPanel, handover-ui test, Verify-HandoverClients/Verify-MainDraftClients và tài liệu. Handoff Vũ Xuân Trường/Bùi Bảo Long; BE-17 chưa đóng native acceptance.

Commit bàn giao: `1481972ae408da539b0918e34b642ac5baa991fe` — `fix(handover): [BE-17] bind consent to the displayed contract version`. Owner Web build/lint và Mobile typecheck/lint đạt.

### Slice BE-31 — chứng từ khoản chi private, 06/11/2026

UC-31 / GBR-01/02/18, SDS private storage → ExpenseEvidenceService/Repository/Controller, shared finance client, ExpenseEvidencePanel → test upload/download, Owner-only, hash, version/source preservation, failure recovery và browser. Dùng cột evidence của expenses và SecurityAudit hiện hữu; không thêm bảng/cột/dependency. Không sửa Finance formulas hoặc số tiền.

Đã bổ sung GET list/POST ảnh/GET private download; JPEG/PNG thật tối đa 5 MB, giới hạn kỹ thuật 20 evidence. Intent PendingUpload được commit trước storage, chỉ Uploaded sau hash readback; cùng key/file replay không nhân bản, khác file 409. Lỗi sau external write giữ key liên kết expense để retry hoàn tất, không có row Uploaded trỏ object chưa kiểm. Owner Web mở lại có thể dùng lại Pending key bằng đúng ảnh. Server kiểm hash/length trước download, không gửi object key trong DTO. Raw metadata cũ được giữ nguyên; API mới chỉ hiển thị envelope mới. Evidence không đổi version mảng history dùng chỉnh sửa tiền; audit upload được lưu riêng.

`dotnet test tests/backend/BHome.IntegrationTests --no-restore --filter 'FullyQualifiedName~Compact24ExpenseTests' --verbosity minimal`: **6/6 đạt**, 0 skip. Storage fault/tamper là test boundary được gắn nhãn; có parallel same-key upload, interruption sau external write, replay/audit một lần, malformed/oversize, Staff/Tenant/cross-expense denial và schema readiness. `npm.cmd run test --workspace src/owner-web -- src/features/expenses --maxWorkers=1`: **7/7 đạt**; Owner Web build/lint và harness build 0 warning/error đạt. Không thêm Node types/dependency khi test crypto cần import runtime.

`dotnet run --project tools/BHome.ContractVerification --no-build -- --finance --main-draft`: **10/10 nhóm đạt**; nhóm mới upload/reload/download chứng từ qua Owner Web build, API, Compact24 và MinIO Docker thật. So sánh length/hash của file người dùng tải xuống với PNG tổng hợp gốc; không coi response body rỗng trong browser network capture là nội dung file. Các nhóm hợp đồng/bàn giao/Finance trước vẫn đạt. Chưa phải staging/production hoặc native acceptance.

Browser dùng PNG tổng hợp >32 KB và <5 MB, xác nhận action upload trên Kestrel thật không bị giới hạn JSON 32 KB của controller. Ảnh đã lưu/download đúng hash. Không thay request-size policy chung.

Changed files: ExpenseEvidenceService/Repository, ExpensesController, DI, finance client, ExpenseEvidencePanel/test, ExpensesApiPage/test, Compact24ExpenseEvidenceTests, browser helper và docs. Handoff Vũ Xuân Trường, INITIAL_API_UI_READY. BE-31 vẫn PARTIAL vì chọn Asset/Work Order và reviewer còn lại. Holding giữ chặn OQ-03/Q-H1 (hạn hiệu lực/payment deadline/thời điểm chuyển và hoàn tác cọc chưa có quyết định); không tự chọn deadline. Refund/settlement giữ explicit Pending theo phạm vi đã ghi.

Commit chứng từ: `b7ac7fb034288fc481601678729bbdcee264c1c7` — `feat(finance): [BE-31] store private expense evidence with recoverable uploads`.

### Slice BE-31 — tham chiếu tài sản/công việc nguồn, 06/11/2026

UC-31 / FE-08 / GBR-01/02/18 và liên kết OperatingExpense với Work Order trong BF-07 → ExpenseService/Repository/Controller và ExpensesApiPage → acceptance nguồn cùng Location/Room/Asset, task type, immutable links, key replay và old fingerprint. Đã kiểm schema thực: expenses có asset_id/task_id/incident_report_id; operational_tasks phân biệt WORK_ORDER với các loại khác. Không thêm bảng/cột hoặc backend Work Order trùng module của nhóm.

Thêm Owner-only reference-choices và optional assetId/taskId. UI lấy Rooms/Assets/Work Orders thật theo scope, auto chọn Asset khi Work Order có nguồn cụ thể. Tạo expense khóa Location và kiểm lại scope; ghi incident link từ Work Order; chỉ OPERATING liên kết Work Order. Correction giữ nguyên source links. Null optional fields không thay hash của request cũ. Không tự hạch toán lại khoản chi hoặc tự approve plan/cost theo Work Order status.

`dotnet test tests/backend/BHome.IntegrationTests --no-restore --filter 'FullyQualifiedName~Compact24ExpenseTests' --verbosity minimal`: **8/8 đạt**, 0 skip. Có wrong Room/Location Asset, General task, inconsistent Incident source, missing Asset cho Work Order, Owner/Staff quyền, source preservation/correction và tương thích fingerprint cũ. Work Order fixtures là dữ liệu nguồn tổng hợp có sẵn bằng SQL trên schema test, không phải chứng minh workflow BF-07 đã có. `npm.cmd run test --workspace src/owner-web -- src/features/expenses --maxWorkers=1`: **8/8 đạt**, có UI chọn đúng IDs; Owner Web build/lint và harness build 0 warning/error đạt.

Browser `--finance --main-draft`: **10/10 nhóm đạt** với fixture Asset thật tại Room. Owner chọn Room/Asset khi ghi chi, mở correction thấy đúng liên kết bất biến; upload chứng từ và các nhóm Finance/contract/handover vẫn đạt. Handover kiểm toàn inventory kể cả Asset có sẵn. Không có production Work Order API để chạy browser tạo Work Order; UI không điền mock. Handoff Vũ Xuân Trường: INITIAL_API_UI_READY; reviewer và nghiệm thu upstream Work Order còn lại.

Commit tham chiếu: `d628680426666109a46679b85df9cfa247c26144` — `feat(finance): [BE-31] link expenses to scoped assets and existing Work Orders`.

### Regression BE-15/BE-X06 — dependency nguồn PDF, 06/11/2026

Full regression lần đầu sau các slice: Domain **90/90**, Application **249/249**; Integration **600 đạt / 9 lỗi / 1 optional skip**, 610 tổng; Mobile **376/376**. Owner Web **130/132**, hai timeout router khi chạy đồng thời backend/Mobile. Đây là kết quả thất bại đã thực thi, không công bố full suite đạt. Không tăng timeout hoặc giảm assertions; chạy lại lần lượt sau khi sửa nguyên nhân.

Hai lỗi PDF simulation do adapter mới phụ thuộc concrete source repository trong bài kiểm thử PDF thuần không cấu hình database. Đã đưa `IContractSigningDocumentSource` vào Application và inject qua interface; DI production vẫn dùng concrete kiểm database/hash. Bài PDF/mode thuần cấp explicit source boundary trả generic renderer; không mock chữ ký hoặc domain outcome. MainDraftReleaseTests tiếp tục dùng source thật. Không thêm fallback database hoặc bỏ integrity check.

`dotnet test tests/backend/BHome.IntegrationTests --no-restore --filter 'FullyQualifiedName~ContractWorkflowGuardTests|FullyQualifiedName~PropertyContractDockerTests|FullyQualifiedName~ReviewReleaseAndActivation|FullyQualifiedName~ReviewedMainDraftReleasesOnce' --verbosity minimal`: sau sửa các nguyên nhân dưới đây **21/21 đạt**, gồm guard môi trường simulation, PDF không có chữ ký điện tử, Main Draft source thật và Compact24 Property/Contract. Task BE-X06 vẫn chờ MySign staging/production template.

Commit dependency signing: `062034fe6f67ab70ba79dde095ec628183bd8d02`.

### Regression BE-X04 — UTC occupancy và fixture hợp lệ

BF-01 / NFR UTC / API occupancy-summary: BusinessInstant tạo mốc ngày Việt Nam với offset +07 rồi truyền vào query timestamptz; Npgsql yêu cầu offset UTC nên trả 500. Đã chuyển cùng instant sang UTC trước query, không thay ngày nghiệp vụ hoặc công thức. Bài read-only/scope/audit/occupancy cũ giữ nguyên và bổ sung wrapper chạy trên Compact24 Docker, không bỏ legacy regression.

Fixture Property/Contract/Invoice dùng chung một Owner Compact24 nhưng ba helper đặt ba mật khẩu tổng hợp khác nhau, khiến kết quả phụ thuộc test nào chạy trước. Đã dùng một constant test-only; vẫn đăng nhập/xác thực HTTP thật, không reset account hoặc bypass authentication. Property race/remaining-contract fixture cũng tạo Final tasks trước approved move-out; nay Tenant yêu cầu và Owner duyệt qua API trước, sau đó mới thiết lập settlement test boundary được gắn nhãn. Không nới backend guard để hợp thức hóa test.

Lệnh focused phía trên bổ sung `|FullyQualifiedName~RoomInsightsAreReadOnlyScoped`: **22/22 đạt**, 0 skip; có cả legacy PostgreSQL và Compact24 Room insights. Backend build đạt. Full suite được chạy lại sau đó; xem kết quả hồi quy mới nhất, không suy rộng kết quả focused sang toàn bộ hệ thống. Commit `7243ff9b58e820e695dd0af801ac5582babb4a79`.

### Regression Owner Web — truy vấn accessibility trong bài điều hướng

TASK BE-X04 / regression Location Workspace sau merge. Bài kiểm thử cũ tính accessible name/visibility lặp lại trên nhiều liên kết trong toàn trang, timeout khi chạy full suite. Profiling router 37/37 ghi nhận riêng bài này khoảng 9,6 giây, trong đó nhóm sidebar tới 3,5 giây và tìm link toàn trang tới 7,6 giây. Đã gộp truy vấn sidebar theo đúng tên, kiểm chính xác href/uniqueness; link Xem cơ sở được chọn theo exact anchor text rồi vẫn kiểm role, accessible name và visible từng link. Giữ nguyên kiểm tab, heading, Room đúng/sai Location và timeout 15 giây; không đổi production UI.

`npm.cmd run test --workspace src/owner-web -- --maxWorkers=1` với Node 22: **132/132 đạt, 22 files**, 151,36 giây. Owner Web lint đạt. Đây là kết quả full suite thực thi sau tối ưu truy vấn; không suy ra đã sửa lỗi router sản phẩm hoặc cam kết performance production. File thay đổi router.test.tsx và báo cáo. Handoff Vũ Xuân Trường; slice test DONE, task tổng vẫn PARTIAL. Commit `e9103a7a947930ee34cb1871066f1316f05093d4`.

### Slice BE-32 / BE-X08 — lấp đầy lịch sử trong snapshot báo cáo

UC-07/UC-32, FE-08, GBR-01/02/16 → FinancialReportRepository/Service, shared finance DTO, FinancialReportsApiPage → acceptance so sánh Property history, ngày-phòng/zero denominator, thiếu audit, kỳ tương lai, scope/quyền và không đổi tiền. Đã đọc lại SRS và nguồn occupancy sau merge; tái sử dụng IRoomInsightsRepository/PropertyService.CalculateHistorical hiện hữu trong cùng DbContext/RepeatableRead, không dựng thuật toán khác. Không thêm bảng, endpoint hoặc dependency. Toàn chuỗi/Room filter/kỳ trên giới hạn kỹ thuật 366 ngày chưa hỗ trợ history; trả trạng thái rõ ràng. Kỳ tương lai không báo là lịch sử. Current room counts và financial/capital formulas giữ nguyên. Saved What-if baseline cũ thiếu field mới vẫn đọc được, không tính lại snapshot cũ.

Owner Web hiển thị kỳ dd/MM/yyyy và số ngày-phòng/tỷ lệ do backend trả; null khi thiếu evidence hoặc không có ngày có thể cho thuê, không lấy tỷ lệ phòng hiện tại bù vào. File: FinancialReportService, FinancialReportRepository, finance.ts, FinancialReportsApiPage/test, FinancialReportTests, Compact24FinanceOccupancyTests, Verify-HistoricalOccupancyClients/Verify-MainDraftClients và FINANCE.md/báo cáo. Mobile không thêm màn báo cáo Owner; typecheck đạt cho DTO optional.

`dotnet test tests/backend/BHome.IntegrationTests --no-restore --filter 'FullyQualifiedName~Compact24ExpenseTests|FullyQualifiedName~Compact24FinanceLedgerTests' --verbosity minimal`: **11/11 đạt, 0 skip**. Property tạo/sửa bằng HTTP thật cho positive path; fixture migrated-like cố ý không có audit dùng cho negative completeness. Lần đầu fixture này bị API cấu hình Location từ chối đúng; đã sửa fixture, không nới product guard. `dotnet test tests/backend/BHome.Application.UnitTests --no-restore --filter 'FullyQualifiedName~Finance' --verbosity minimal`: **8/8 đạt**. Owner reports **7/7**, build/lint đạt; harness build 0 warning/error.

`dotnet run --project tools/BHome.ContractVerification --no-build -- --finance --main-draft`: **11/11 nhóm đạt** với PostgreSQL Compact24/MinIO riêng, API và Owner Web build thật. Nhóm mới kiểm Room đang Occupied nhưng thiếu audit trả InsufficientData; tạo Location/Room qua API, so sánh history chính xác với Property endpoint, browser hiện 1 rentable room-day/0 occupied/0%; mở kỳ trước creation thì browser hiển thị thiếu lịch sử và bỏ tỷ lệ cũ. Không tạo dữ liệu giả trong UI, không chạm database làm việc. Handoff Vũ Xuân Trường: INITIAL_API_UI_READY, chờ review UI. Slice DONE; BE-32/BE-X08 vẫn PARTIAL do chain/Room historical, Staff cost nguồn tự động và refund classification còn lại. Commit `3a683f91a6fdb606252a28f08f9f7b98486ce06d`.

### Slice BE-21/22/24/25 — ba Tenant, một hóa đơn từ hợp đồng thật trong test

UC-15/17/20..25, BF-05/06, GBR-01/02/07..10/18, DBR-06/07 → harness hiện hữu/Verify-SharedBillingClients và shipped Web/Mobile clients → thiếu reading/Owner-only finalization, ba recipients/một tiền thuê, payer privacy, partial/excess, immutable Final/Adjustment, private evidence, replay/parallel. Không sửa API hoặc production UI vì đường gọi có sẵn hoạt động. Một representative và hai co-occupants xác minh riêng qua capture; Owner liên kết hai Tenant, Staff làm thay bị 403; release vẫn chỉ hai signer Owner/representative. Không tạo ba hợp đồng riêng hoặc seed Invoice để chứng minh chia sẻ.

Fixture ban đầu gồm Room/Asset/biểu giá tổng hợp có từ ngày trước. API thật cấm biểu giá lùi ngày (400 invalid_policy) nên fixture cung cấp cấu hình có sẵn, không nới guard cho demo. Main Draft, signing simulation, deposit tổng hợp, activation, handover, Initial/Periodic readings với ảnh, Invoice, Adjustment, receipts và allocations đều qua API thật. Lịch billing/rates là input kiểm thử được ghi ở FINANCE.md, không phải default business policy. Các lỗi trong vòng đầu là fixture backdate, decimal string giữ .0000 hợp lệ và locator bỏ sót dấu required; đã sửa test giữ phép so sánh decimal chính xác và validation UI, không tăng timeout hoặc đổi quy tắc sản phẩm.

`dotnet run --project tools/BHome.ContractVerification --no-build -- --finance --main-draft`: **15/15 nhóm đạt**, exit 0, gồm các nhóm trước và shared billing + kiểm DB cuối. Owner browser không phát hành Draft thiếu mandatory readings; Staff xác nhận 100→120 cho hai utility, ba Tenant thấy cùng tổng 3.430.000. Owner browser phân bổ partial 1.000.000 đúng payer; co-occupant gửi ảnh private, Owner browser duyệt điện 70.000→50.000, Adjustment -20.000 riêng, toàn bộ Final Invoice DTO vẫn deep-equal (không phải kiểm raw HTTP bytes). Ba Tenant thấy nghĩa vụ 3.410.000/còn nợ 2.410.000. Giao dịch tiếp 2.420.000 phân bổ 2.410.000, giữ 10.000 chưa phân bổ; ba Tenant Paid/QR Settled/history hai lần, payer khác ẩn userId. Ba retry allocate đồng thời vẫn chỉ hai allocation/two distinct payer; DB xác nhận một Final Invoice/ba recipients/ba lines, không có refund_requests và schema 24 bảng không đổi.

Harness build 0 warning/error. Changed files: FinanceVerificationCli, Verify-FinanceClients/Verify-MainDraftClients/Verify-HandoverClients, Verify-SharedBillingClients và FINANCE.md/báo cáo. Test lỗi chỉ ghi status/code/path, không dump credentials/response/PII. PostgreSQL/MinIO/API/browser disposable đã cleanup sau run; không có production data. Đường Mobile là transport/shared client với component regression đã có, native device vẫn NOT RUN. Bank account/receipts isDevelopmentDemo; không có bank/MySign thật. Worker notifications tắt trong browser harness nên không tuyên bố delivery acceptance từ run này. Handoff Vũ Xuân Trường/Bùi Bảo Long; slice acceptance DONE, task tổng còn PARTIAL cho native/provider/reviewer. Commit `dc7ed489ab4f3bfb6d7dfd0bbc4ee0f8143fa5cc`.

### Slice BE-20 — OCR model thật và timeout ảnh xoay

Full suite ban đầu skip bài model opt-in. Local đã có artifacts pinned/public nên chạy riêng với BHOME_OCR_LOCAL_EVALUATION_ROOT; phát hiện GELEX180° trả unavailable/ocr_timeout, không phải thiếu phân loại đơn thuần. Sửa OnnxOcrEngine tránh tính lại cùng recognizer input 320 trong cùng ảnh/hướng; cache không chung giữa request/hướng, vùng rộng vẫn đọc lại, numeric refinement/conflict và human confirmation giữ nguyên. Deadline mặc định vẫn 8 giây. Không đổi model, API/DB hoặc client. Engine version có hậu tố cache1.

Bản cuối: real ONNX HTTP **1/1 đạt** (nước, điện thẳng, điện xoay); OCR Application **125/125**, OCR integration với PostgreSQL riêng **119/119, 0 skip**. Lượt OCR không gắn test-admin trước đó có 5 capture tests skip; đã rerun với môi trường đúng và không coi skip là pass. Bài real model dùng auth/resource test boundary, không phải nghiệm thu authorization production, 50-image accuracy hoặc NFR load. Chi tiết commands/failure/giới hạn tại [OCR_RECOGNITION_CACHE_REGRESSION.md](OCR_RECOGNITION_CACHE_REGRESSION.md). Commit `565eb8d9afec22f328962ab7f033c2f595f13246`. Handoff Vũ Xuân Trường/Bùi Bảo Long, native camera còn NOT RUN; BE-20 vẫn PARTIAL.

Ngày bắt đầu: 05/11/2026. Nhánh `member/QHuy`; baseline `5357b39`. Working tree ban đầu sạch. Đây là báo cáo tiến độ thực thi; không phải xác nhận hoàn tất 22 nhiệm vụ. Không push/merge, không ghi vào database làm việc `bhome`.

## Nguồn và truy vết

Đã đọc AGENTS gốc và hai client, API_CONVENTIONS, thiết kế/DDL/báo cáo Compact24, source/DTO/DI/tests, nội dung SRS `(2)`, SDS `(5)` và Report 2 `(3)` trong `docs/reports`. SRS: BF-03/04, UC-14..19, GBR-01/02/04, DBR-02/03; BF-05/06, UC-20..25; FE-08, UC-31..34, GBR-15/16/18. Không tìm thấy workbook `BHOME_Checklist_Phan_Cong_Tich_Hop_Tien_Do.xlsx` hoặc Reports 5–7; chưa có căn cứ để sửa checklist hay công bố ST/AT theo các mẫu đó.

Ở audit ban đầu, người dùng chỉ xác nhận OQ-01/02/05 đã đóng nhưng chưa có nội dung quyết định trong tài liệu. Sau đó người dùng ủy quyền rõ: “nếu chưa có hãy triển khai theo hướng của bạn và báo cáo cho tôi”. Quyết định triển khai thiếu/thừa tiền được ghi tại PAYMENTS.md: Owner xác minh, phân bổ min(receipt,dư nợ), tiền thừa giữ gắn receipt, chưa tự refund/credit. Refund/deposit settlement execution còn là công việc chưa triển khai, không ghi là đang chờ người dùng duyệt lại OQ-01/02/05. Ủy quyền này chưa cung cấp nội dung OQ-03/Q-H1 về Holding deadline/transfer.

## Ma trận 22 nhiệm vụ sau kiểm tra nguồn ban đầu

| ID     | Đã có / dữ liệu / UI                                                                       | Khoảng trống và nghiệm thu còn lại                                                                                 | Trạng thái |
| ------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ---------- |
| BE-X04 | DI mặc định Compact24, worker/Identity/readiness; 24/386/83                                | Regression server riêng, SQL log không legacy đã đạt 1 test; cần toàn bộ regression                                | PARTIAL    |
| BE-14  | Contract Holding boundary và test transfer                                                 | `UnconfiguredContractHoldingLedger` vẫn đăng ký; chưa có Holding E2E thật                                          | BLOCKED    |
| BE-15  | Owner settings/Main Draft/documents/signing/deposit/activation; Web/Mobile; contracts JSON | Sửa trạng thái UI cấu hình; provider staging, tenant document review và browser E2E chưa nghiệm thu                | PARTIAL    |
| BE-16  | Renewal API/client, giữ phiên bản và chữ ký                                                | Test Compact24 đạt; provider thật và UI E2E chưa chạy                                                              | PARTIAL    |
| BE-17  | Handover API/client, baseline, evidence, hai xác nhận                                      | Test Compact24 đạt; native Staff/Tenant E2E chưa chạy                                                              | PARTIAL    |
| BE-19  | Move-out/inspection/settlement state machine                                               | Positive test dùng ledger test; policy cụ thể/refund và E2E thật chưa đủ                                           | PARTIAL    |
| BE-20  | Capture/OCR/confirmation, Web monitor/Mobile; meters/readings                              | Regression nguồn hiện có; chưa chạy lại detector/device acceptance trong lượt này                                  | NOT RUN    |
| BE-21  | Room/kỳ invoices/items/recipients, billing schedule/automation, Web/Mobile                 | Cần chạy regression Compact24 và E2E                                                                               | NOT RUN    |
| BE-22  | Verified transactions/allocation, receiving account; Web/Mobile                            | Cần regression thực và bank integration; không tự nới under/overpayment                                            | NOT RUN    |
| BE-23  | Debt/due date/reminders/inbox                                                              | Cần regression Compact24, UI                                                                                       | NOT RUN    |
| BE-24  | Request/evidence/Owner decision và lịch sử, Web/Mobile                                     | Cần regression Compact24, quyết định OQ cụ thể, UI                                                                 | NOT RUN    |
| BE-25  | Payment history và scope                                                                   | Cần regression và UI                                                                                               | NOT RUN    |
| BE-31  | Bảng `expenses`; UI Investments hiện demo                                                  | Chưa có service/repository/controller Finance trong DI; cần API và UI thật                                         | PARTIAL    |
| BE-32  | UI reports/demo                                                                            | Chưa có backend reports thực được đăng ký                                                                          | PARTIAL    |
| BE-33  | UI demo tính recovery                                                                      | Chưa có backend recovery từ ledger thực                                                                            | PARTIAL    |
| BE-34  | `financial_scenarios`; UI demo                                                             | Chưa có backend analyze/save/list/get và isolation tests                                                           | PARTIAL    |
| BE-X05 | CLI/preflight/mapping/reconciliation tests và artifacts                                    | Cần chạy lại populated synthetic migration, không dùng dữ liệu thật                                                | NOT RUN    |
| BE-X06 | MinIO adapter, PDF signer, MySign adapter native                                           | Không thấy bằng chứng provider staging; PDF conversion baseline lỗi; storage test substitute không phải MinIO thật | PARTIAL    |
| BE-X07 | Bank claim/exact reconciliation/deposit guards                                             | Chưa có nội dung chính sách đã đóng; Holding/refund chưa nghiệm thu                                                | PARTIAL    |
| BE-X08 | Invoice/payment unit và integration tests                                                  | Chưa có finance/report regression thực                                                                             | PARTIAL    |
| DOC-01 | Reports 2/3/4 originals, docs kỹ thuật                                                     | Báo cáo này bổ sung discrepancy; không sửa bản gốc để biến giới hạn thành yêu cầu                                  | PARTIAL    |
| DOC-03 | Báo cáo bằng chứng này                                                                     | Report 7 không có tại repository; chưa thể đóng final evidence                                                     | PARTIAL    |

## Slice BE-15 cấu hình hợp đồng trên Owner Web

Nguồn: UC-15, GBR-01/02/04; API hiện hữu GET/PUT `/api/v1/contracts/main-drafts/settings/{locationId}`. Thành phần: `MainDraftSettingsPanel`, shared `mainDraftClient`, `MainDraftService`/`MainDraftData`; settings trong cấu hình Location Compact24. Không đổi DTO, endpoint, schema hoặc quyền.

Thay đổi: xóa dữ liệu cũ khi đổi cơ sở/đóng dialog; chặn lưu khi đang tải; bỏ qua response đã abort; reset thông báo khi mở lại; dùng form validation và khóa các trường trong lúc lưu; chỉ báo thành công sau GET đọc lại persisted settings. Owner Web reviewer: Vũ Xuân Trường, trạng thái `INITIAL_API_UI_READY`. Không sửa Mobile trong slice này (cấu hình thuộc Owner Web).

Acceptance tự động: lưu đúng expectedVersion và đọc lại dữ liệu; đổi Location khi response cũ chưa về không ghi đè dữ liệu mới; lỗi tải/lưu không hiển thị thành công hoặc cho lưu dữ liệu cũ. 3/3 component tests đạt. Owner Web build và lint đạt. Chưa có browser E2E cho slice.

## Bằng chứng kiểm thử thực thi

- `dotnet test src/backend/BHome.sln --no-restore --verbosity minimal`: Domain 83 đạt; Application 225 đạt; Integration 456 đạt, 1 lỗi, 127 skip (thiếu biến Compact24 và optional model). Lỗi: `ActualLibreOfficeConversionPersistsPrivatePdfWithVietnameseAndIssueDate`, trả `contract_pdf_conversion_failed`.
- `npm.cmd run test --workspace src/owner-web`: baseline 99 đạt, 12 timeout, 111 tổng; chạy đồng thời gây tải cao. Sẽ chạy lại giới hạn worker, không tăng timeout để che lỗi.
- `npm.cmd run test --workspace src/mobile`: baseline 358 đạt, 14 lỗi, 372 tổng; 12 startup tests bị runtime Node ngoài dải hỗ trợ, 2 onboarding timeout. Cần xác minh lại với Node 22 đã có trong `.tools`.
- PostgreSQL 18 riêng trong thư mục TEMP, loopback port 55439, chỉ dữ liệu tổng hợp, query logging không parameter. Các fixture tự tạo/xóa database `bhome_compact24_<uuid>`.
- `dotnet test tests/backend/BHome.IntegrationTests --no-build --filter 'FullyQualifiedName~Compact24MainDraftRegressionTests|FullyQualifiedName~Compact24ContractRegressionTests|FullyQualifiedName~Compact24IndependenceTests' --logger 'trx;LogFileName=huy-contract-baseline.trx' --verbosity quiet` với biến kết nối server riêng: **24/24 đạt, 0 skip**. Có settings/effective dates/onboarding/docx, signing/activation/replay/race/authorization/renewal/handover/move-out và runtime independence. Signing/storage/settlement dùng boundary test được ghi trong fixture; không chứng minh MySign/MinIO thật.
- `npm.cmd run test --workspace src/owner-web -- src/features/contracts/MainDraftSettingsPanel.test.tsx --maxWorkers=2`: **3/3 đạt**.
- `npm.cmd run build --workspace src/owner-web`: đạt (TypeScript và Vite).
- `npm.cmd run lint --workspace src/owner-web`: đạt, không warning sau sửa.

## Nhật ký commit

Commit được ghi ngay sau mỗi slice đã kiểm tra. Chỉ stage đường dẫn cụ thể; không push.

- `5e2c68f` — `fix(contract): [BE-15] guard configuration loading and verify saved settings`: 3 file (panel, component test, báo cáo này); 3/3 tests, build/lint đạt; BE-15 vẫn PARTIAL; handoff Vũ Xuân Trường.
- `ff2f315` — `feat(finance): [BE-31] persist Owner expenses with real API interface`: 13 file liệt kê trong slice Expenses; 3/3 PostgreSQL + 3/3 UI, build/lint đạt; PARTIAL, handoff Vũ Xuân Trường.
- `8196b89` — `feat(finance): [BE-32][BE-33] report actual revenue costs and capital recovery`: 13 file liệt kê trong slice report; 5 formula tests, report/ledger PostgreSQL và 2 UI tests đạt; build/lint đạt, PARTIAL.
- `dd087f3` — `feat(finance): [BE-34] save and compare isolated financial scenarios`: 15 file trong slice What-if và compatibility DI; 25/25 Finance/ApiFoundation, 2 formula + 2 UI tests, build/lint đạt; PARTIAL.
- `68761b4` — `feat(payment): [BE-22][BE-X07] retain partial debt and isolate excess receipts`: 13 file trong slice payment; 8 domain/4 PostgreSQL/6 UI tests đạt, build/lint đạt; refund execution còn thiếu.
- `886acca` — `fix(finance): [BE-31] retain expense scope inside Location Workspace`: 3 file; 4 UI tests/build đạt.
- `4865902` — `test(finance): [BE-15][BE-34] verify real browser workflows on disposable Compact24`: thêm harness/browser script, tài liệu và fallback reason cho allocation import; build 0 warning/error, browser đạt, full integration 588/589 (1 optional skip).
- `72638db` — `fix(finance): [BE-31] render real expenses in Location investment route`: sửa Outlet/API boundary, thêm regression route/browser và cập nhật inventory; route test 1/1, browser 5/5, build/lint đạt.

## Slice BE-31 Expenses API và Owner Web

Đã thêm Controller → ExpenseService → IExpenseRepository → ExpenseRepository → Compact24 expenses, shared finance client và màn hình thật vào `Investments` khi API mode. Truy vết UC-31/FE-08: Owner nhập/sửa đúng dữ liệu, Location/Room hợp lệ, audit correction, chặn destructive delete và Staff/Tenant. Dùng source_key hiện hữu cho idempotency, history cho version/before/after/reason; không đổi 24 bảng/386 cột/83 FK. Không ghi database `bhome`.

3/3 PostgreSQL integration tests đạt: persist/reload/filter/correction/history/schema; parallel create/replay/key conflict/update race; 401/403/invalid amount/invalid Room/filter, không ghi tiền sai. 3/3 UI tests đạt: API list/create/one submit/readback; detail/version/reason; API failure/retry stable key/no fake data. Owner Web build/lint đạt. Backend test build đạt không warning/error. Chi tiết API/DTO/ví dụ và fixture: `docs/api/FINANCE.md`.

Changed files: `Application/Finance/ExpenseService.cs`, `Infrastructure/Finance/ExpenseRepository.cs`, `Api/Controllers/ExpensesController.cs`, DI, exception handler, `packages/client-core/src/finance.ts`, `ExpensesApiPage`/test/useFinanceApi, `property/FinancePages.tsx`, `Compact24ExpenseTests.cs`, tài liệu Finance và báo cáo này. Dữ liệu: expenses; đọc users/locations/rooms. Handoff Owner Web: Vũ Xuân Trường, `INITIAL_API_UI_READY`. Mobile không thay. Trạng thái task **PARTIAL**: chưa upload/download chứng từ riêng, chọn Asset/Work Order trong UI, browser E2E và reviewer.

## Cập nhật baseline sau sửa môi trường

- Chạy lại Mobile bằng Node 22 `.tools/node-v22.23.4-win-x64`, `--maxWorkers=2`: **372/372 đạt**. Không sửa test hoặc startup code để che lỗi Node ngoài engines.
- Owner Web Node 22 `--maxWorkers=2`: 112 đạt, 2 router timeout; đang kiểm tra serial.
- Dựng thành công image hiện hữu bằng `docker build -f deploy/docker/ContractConverter.Dockerfile -t bhome/contract-converter:local .`. Chạy lại `ActualLibreOfficeConversion...`: **1/1 đạt** (trong lượt 4 test: PDF đạt, 1 expense đạt, 2 expense lỗi serialization đã sửa rồi chạy lại expenses 3/3 đạt). Đây là PDF thật, không phải chữ ký MySign thật.
- Tìm cấu hình MySign trong các file cấu hình hiện hữu không thấy section được cấu hình; Development chỉ có MainDraft converter. Không xuất giá trị secret vào báo cáo/chat. Tài liệu `DIGITAL_SIGNING_COMPLETION.md` vẫn yêu cầu môi trường/tài khoản provider và quy trình liên kết chủ chứng thư. Chưa tìm thấy tài liệu quyết định OQ-01/02/05 cụ thể thay các ghi chú cũ.

## Slice BE-32/BE-33/BE-X08 báo cáo và hoàn vốn

Thêm FinancialReportsController → FinancialReportService → IFinancialReportRepository → FinancialReportRepository và shared client/Owner Web `/reports` API mode. Nguồn UC-32/33, FE-08, GBR-15/16; DTO/formula/giới hạn được ghi trong `docs/api/FINANCE.md`. Không ghi financial ledger; đọc invoices/adjustments/allocations/payments/expenses/locations/rooms/refunds dưới snapshot RepeatableRead. Không thêm schema/table. Không sửa Mobile.

5/5 application formula tests đạt: phát hành khác thực thu, điều chỉnh/OPEX/nợ/hoàn vốn, không vốn/không dòng tiền/lỗ/no-data/đã hoàn vốn, refund uncertainty. PostgreSQL `Compact24ExpenseTests` 4/4 đạt (bao gồm 3 expense tests trước); report thực đọc chi phí/vốn, scope/role/invalid. `Compact24FinanceLedgerTests` 1/1 đạt: chạy payment workflow thật trên Compact24 rồi kiểm report issued/verified collections/debt/occupancy; giao dịch chưa phân bổ không bị tính doanh thu. UI report 2/2 tests đạt (figures/null payback/API failure), build/lint đạt.

Changed files: `Application/Finance/FinancialReportService.cs`, `Infrastructure/Finance/FinancialReportRepository.cs`, `Api/Controllers/FinancialReportsController.cs`, DI, shared `finance.ts`, `FinancialReportsApiPage`/test và `ReportsPage`, `FinancialReportTests`, `Compact24ExpenseTests`, `Compact24FinanceLedgerTests`, docs. Handoff `INITIAL_API_UI_READY`, Vũ Xuân Trường. Task **PARTIAL**: browser E2E/reviewer, historical occupancy, classified refunds/Staff cost integration và optional Room UI selector chưa đủ; không gọi đây là BE-32/33 hoàn tất toàn bộ.

Owner Web full serial với Node 22: 116 đạt, 1 router Location Workspace timeout; không thay timeout hoặc sửa assertion để lấy PASS. Slice tests riêng đạt như trên. Tiếp tục điều tra regression toàn bộ.

## Slice BE-34 What-if

Controller → FinancialScenarioService → repository → financial_scenarios; shared API client; Owner Web API mode `/what-if`. UC-34/GBR-15/16: analyze không ghi, save chỉ ghi scenario; giữ nguyên input/baseline/result/version; xem/compare không tính lại. Khai báo đầy đủ giả định thuê/lấp đầy/thu tiền/OPEX, số tháng, baseline và công thức quản trị trong FINANCE.md. Dedupe đồng thời bằng UUID/advisory lock, key đổi input bị 409, list/get Owner-scoped. Không thêm bảng, không sửa Mobile.

2/2 formula tests và 2/2 component tests đạt. PostgreSQL ledger/scenario regression đạt: phân tích/lưu đồng thời/replay/get/list/changed-key/validation/không thay report hoặc expenses, schema vẫn hợp lệ. Chạy nhóm Finance + ApiFoundation sau sửa DI **25/25 đạt**. Owner build/lint đạt. Trạng thái **PARTIAL**, handoff Vũ Xuân Trường `INITIAL_API_UI_READY`; browser E2E/review cuối chưa chạy.

Full regression ban đầu phát hiện legacy test fixture gỡ Compact24DbContext khiến DI validation của Finance thất bại. Đã sửa constructor repository dùng `BHomePersistenceContext` hiện hữu; production vẫn resolve Compact24, SQL vẫn bảng Compact24 và không có fallback legacy. ApiFoundation + Finance đã kiểm tra lại. Full run cũ đã dừng sau phát hiện lỗi; không coi là PASS.

Router test từng timeout đã chạy riêng với Node22 và giữ nguyên timeout: **1/1 đạt** (35 test khác không được chọn), xác nhận vấn đề tải máy; chưa coi full Owner suite PASS.

## Quyết định chính sách theo ủy quyền người dùng

05/11/2026: người dùng yêu cầu “nếu chưa có hãy triển khai theo hướng của bạn và báo cáo cho tôi”. Đây là ủy quyền chọn hướng triển khai trong phiên, thay việc phải chờ nội dung OQ cũ. Hướng thực hiện: thiếu tiền được ghi nhận từng phần sau Owner đối soát; tiền thừa chỉ phân bổ tối đa dư nợ, phần còn lại giữ chờ Owner, không tự doanh thu/refund/credit. Khấu trừ/hoàn cọc cần quyết định và bằng chứng Owner, không tự phí phạt/hạn hoàn. Mỗi phần phải có validation, snapshot, concurrency/idempotency và test trước khi đánh dấu triển khai; ghi chú này chưa phải bằng chứng tất cả các nhánh đã được viết.

## Slice BE-22/BE-X07 thanh toán thiếu và tiền thừa

Đã triển khai chính sách min(receipt,dư nợ) trên service và Compact writer, giữ transaction/claim/dedupe/actor hiện hữu. Bổ sung số đã/chưa phân bổ, reason đúng khi replay/list/GET, PendingReview cho tiền thừa, giao diện giải thích trước Owner xác nhận và hiện số dư. Không tự refund, không ghi thừa vào invoice, không sửa chứng từ Final, không thay bảng. Backend tiếp tục trả Unpaid nếu còn nợ, Paid khi hết nợ; Mobile nhận paid/outstanding như hiện hữu, shared labels bổ sung tiếng Việt.

8/8 domain PaymentRules tests đạt; 4/4 PostgreSQL tests đạt gồm 2 Compact24 under/over mới và 2 legacy exact-policy regression. Compact test kiểm partial debt, paid/history sau transfer tiếp theo, cap dư nợ, tiền thừa chưa phân bổ và replay đúng reason. 6/6 Owner payment UI tests đạt, build/lint đạt. Full regression đang được chạy lại; lượt trước phát hiện Compact writer còn exact guard và legacy test schema exact, đã sửa writer và tách capability rõ ràng, không sửa historical migration để che lỗi. Full run cũ đã dừng; chưa báo PASS tổng.

Changed files: PaymentRecords/PaymentRulesTests, PaymentContracts/PaymentService, PaymentRepository, Compact24EventsAndLedger, Compact24WorkflowRegressionTests/PaymentLedgerTests, shared payments.ts, OwnerInvoicePaymentPanel/Payments.test.tsx, PAYMENTS.md và báo cáo. Handoff Vũ Xuân Trường `INITIAL_API_UI_READY`; Bùi Bảo Long kiểm tra màn hình số tiền đã trả/còn nợ trên thiết bị. BE-X07 vẫn PARTIAL vì giải ngân refund/credit và quyết toán cọc chưa có đầy đủ UI/ledger.

Mobile typecheck và lint hiện tại đều đạt với Node22; không thay Mobile source trong các slice này.

## Sửa phạm vi Expenses trong Location Workspace

Khi vào `/locations/:locationId/investment`, API page nay ưu tiên Location của route cho list/create và khóa selector phạm vi; không mở mặc định toàn chuỗi trong một workspace đã chọn. `/expenses` độc lập vẫn lọc mọi cơ sở Owner được phép. Regression UI 4/4 đạt (bao gồm scope mới); TypeScript/Vite build đạt. Không đổi API/backend/schema. Changed files: ExpensesApiPage.tsx và test; handoff Vũ Xuân Trường `INITIAL_API_UI_READY`.

## Browser E2E thật và hồi quy cuối

`dotnet build tools/BHome.ContractVerification --no-restore --verbosity quiet`: đạt 0 warning/error. `dotnet run --no-build --project tools/BHome.ContractVerification -- --finance` với server riêng: **exit 0, 4/4 nhóm browser acceptance đạt**. Source harness: `FinanceVerificationCli.cs`, `Verify-FinanceClients.cjs`, cờ `--finance` trong tool hiện hữu. Chi tiết môi trường/TLS/cleanup ở FINANCE.md. Không thêm dependency hoặc OS trust. Không dùng kết quả ký mô phỏng làm chữ ký thật.

Đã kiểm chứng trên trình duyệt Owner: nhập/lưu/reload/sửa khoản chi; báo cáo đọc đúng khoản vừa sửa; không tự có ước tính payback khi chưa có vốn; What-if tính từ input rồi lưu/reload snapshot; cấu hình hợp đồng Owner lưu/reload đúng tiền cọc và hồ sơ mã hóa. Các slice này được nâng lên `E2E_PASSED` cho đường đi đã test; final UI ownership/review vẫn Vũ Xuân Trường.

`dotnet test tests/backend/BHome.IntegrationTests --no-build --logger 'trx;LogFileName=huy-verified-integration.trx' --verbosity minimal` với BHOME_COMPACT24_TEST_ADMIN và BHOME_COMPACT24_QUERY_LOG: **588 đạt / 0 lỗi / 1 skip / 589 tổng**, 6m19s. Bao gồm native Compact24 contracts/invoice/payment/jobs/authorization/independence và populated synthetic migration/reconciliation/rollback. Skip duy nhất optional `RealModelsReadWaterThroughDiagnosticHttpAndResolveElectricLabelWithoutPersistence`; không tuyên bố đã chạy model HTTP acceptance đó.

Domain full hiện tại: **83/83**; Application full: **232/232**; DigitalSigning riêng: **41/41**. Mobile: **372/372** với Node22, typecheck/lint đạt. Owner Web full cuối đang chờ kết quả; timeout /schedules từng xuất hiện khi chạy cùng integration, không sửa assertion hoặc tăng timeout.

Các lần chạy lỗi trước được giữ trong nhật ký ở trên; không cộng double-count các nhóm test nằm trong full suite. Logs/TRX raw nằm trong `.tools`/TestResults bị ignore; báo cáo không chứa secrets, UUID Tenant thật hoặc bank credentials. Các database tổng hợp và artifacts TLS được cleanup bởi fixture/harness.

## Sửa route Vốn và Chi phí và kết quả kiểm tra bổ sung

Phát hiện `LocationWorkspace` liệt kê tab investment nhưng không render Outlet cho tab này; API mode còn bị chặn bởi prototype property provider. Đã cho child route Finance sử dụng nguồn API riêng và render Outlet đúng. Không thay các tab khác. Browser kiểm `/locations/<synthetic-id>/investment`, dữ liệu đúng cơ sở và selector khóa phạm vi: đạt. Browser toàn bộ cuối **5/5 nhóm đạt, exit 0** (4 nhóm trước cộng Location route). Test route mới đạt 1/1 (36 case khác không chọn); cold lazy import được chờ trong 10s ở test mới, không tăng timeout các test có sẵn. Build/lint Owner Web đạt.

Full Owner Web Node22/maxWorkers=1 sau khi backend nghỉ: **122 đạt / 1 timeout / 123 tổng**, case `keeps property functions inside the selected Location Workspace` vượt 15s ở mock room view. Lượt chạy đồng thời trước timeout `/schedules`; các case đã đạt khi chạy riêng. Chưa sửa production prototype Room view hoặc nới timeout để che vấn đề; **không tuyên bố full Owner suite PASS**. Test mới của investment chạy sau full suite, không cộng nó để công bố một full suite khác.

Audit routes được chạy lại với evidence output: **1/1 đạt**, 199 routes (194 protected/5 anonymous), 97 Owner GET probes, 0 HTTP5xx. Phân bố GET: 200=32, 204=2, 400=9, 403=3, 404=51. Đây là audit khả dụng/quyền và negative lookups; không chứng minh mọi happy path. `docs/api/API_IMPLEMENTATION_STATUS.md` được cập nhật số liệu và Finance.

## Trạng thái bàn giao cập nhật ngày 06/11/2026

Không đóng toàn bộ 22 nhiệm vụ. Các phần được triển khai/kiểm chứng và phần còn lại cụ thể:

| Task   | Kết quả hiện tại                                                                                                 | Việc còn lại                                                                                                               | Trạng thái              |
| ------ | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| BE-X04 | Fresh Compact24, DI/Identity/worker/readiness/SQL log independence và regression đạt                             | Không có legacy runtime dependency được phát hiện trong phạm vi đã test                                                    | DONE                    |
| BE-14  | Boundary và transfer guard được test                                                                             | OQ-03/Q-H1 về validity/payment deadline/transfer chưa có nội dung quyết định; Holding ledger/API/UI chưa triển khai          | BLOCKED (policy)        |
| BE-15  | Owner review/release canonical PDF, Mobile onboarding/signing/deposit/activation transport + Owner browser đạt | Mẫu production được duyệt, MySign test/staging thật và native device acceptance                                            | PARTIAL                 |
| BE-16  | Renewal/history/state/scope regression đạt                                                                       | Provider staging + Owner/Tenant UI E2E với renewal đã ký                                                                   | PARTIAL                 |
| BE-17  | Staff/Tenant handover v2, dispute/stale guards, Initial readings/private evidence và Owner browser đạt           | Native camera/device E2E, reviewer                                                                                       | PARTIAL                 |
| BE-19  | Inspection/final readings/pending settlement/room release guards đạt                                             | Deposit deductions/refund/settlement journal thực và UI đầy đủ; không fake Resolved                                        | PARTIAL                 |
| BE-20  | Sửa timeout ảnh xoay; real-model HTTP 1/1, OCR unit 125/125, integration 119/119 đạt                            | Independent >=50-image/90% acceptance và native camera chưa đạt; không gọi smoke là accuracy benchmark                     | PARTIAL                 |
| BE-21  | Owner browser Draft/Final từ readings, một Invoice/ba Tenant, không nhân rent; immutable/scope/jobs tests đạt    | Tenant native xuyên chu kỳ, reviewer, notification delivery acceptance                                                     | PARTIAL                 |
| BE-22  | Owner browser partial/excess + manual excess refund approved/evidence/Completed; source/ledger/replay/race đạt | Bank provider/callback thật, deposit/Adjustment-created excess refund, credit và native/reviewer                          | PARTIAL                 |
| BE-23  | Debt/overdue/notification/current assignment regression đạt                                                      | Full UI/device reminder acceptance và cấu hình delivery thật                                                               | PARTIAL                 |
| BE-24  | Co-occupant gửi private evidence, Owner browser approve separate Adjustment; Final DTO giữ nguyên, ba balances đúng | Tenant native request-decision và reviewer; các nhánh khác đã có backend/component regression                          | PARTIAL                 |
| BE-25  | Hai allocations/hai payer, ba Tenant history/ẩn payer ID; Owner browser và parallel retry đạt                    | Native device/history screen acceptance                                                                                  | PARTIAL                 |
| BE-31  | CRUD/browser + private evidence hash/recovery + Asset/Work Order scoped refs/correction regression đạt          | UI reviewer; browser tạo Work Order phụ thuộc module BF-07 chưa triển khai                                                 | PARTIAL                 |
| BE-32  | Actual finance/current counts + Location historical occupancy cùng snapshot; API/UI/browser đạt               | Chain/Room historical phạm vi chưa hỗ trợ; Staff cost tự động/OQ-06 và classified refund                                   | PARTIAL                 |
| BE-33  | Recovery/payback/no-data guards, classified receipt-excess refund không ghi OPEX/revenue reversal; tests đạt   | Deposit/other cash refund classification và nguồn vốn ngoài expenses cần tích hợp                                        | PARTIAL                 |
| BE-34  | Analyze/save/list/get/compare, immutable snapshots/isolation/role/idempotency; browser save/reload đạt           | Vũ Xuân Trường review UX; không thay actual ledger                                                                         | DONE (functional slice) |
| BE-X05 | Populated synthetic 70→24 mapping/reconciliation/rollback/privacy/evidence tests trong full suite đạt            | Không chạy migration trên working bhome; chưa có pilot với một dataset legacy ngoài fixtures được chủ dự án chỉ định       | PARTIAL                 |
| BE-X06 | DOCX/PDF converter thật và MinIO/authorization regressions; PDF signing 41 tests đạt                             | Không thấy cấu hình MySign staging; cần account/provider/ownership verification, không có chữ ký thật trong lượt này       | PARTIAL                 |
| BE-X07 | Under/over policy + manual receipt-excess refund API/UI/private evidence/Completed được test và browser đạt   | Credit, deposit deductions/refund/settlement, Adjustment-created excess chưa triển khai                                   | PARTIAL                 |
| BE-X08 | Finance unit 11/11, payment/refund/finance 32/32, excess-refund classification và shared billing/browser đạt      | Deposit settlement/refund regression khi triển khai; không suy rộng mẫu sang NFR coverage/performance                      | PARTIAL                 |
| DOC-01 | API inventory/Finance/Payments/progress có source traceability và kết quả thật                                   | Bản gốc Reports 2/3/4 chưa sửa; supplement này ghi discrepancy, không thay approved baseline bằng claims                   | PARTIAL                 |
| DOC-03 | Bằng chứng/commands/commits/handoff và gaps trong báo cáo này                                                    | Report 7/checklist workbook không có trong repository; chưa thể hoàn tất hồ sơ final theo mẫu                              | PARTIAL                 |

Manual receipt-excess refund đã có API/UI/evidence và kiểm thử như slice mới; không suy việc này thành hoàn tất deposit refund/settlement. Chưa tìm thấy MySign configuration trong files/process đã kiểm; không suy đoán secret trong nguồn ngoài repository. Không push/merge hoặc thay production data.

Đã kiểm tra thêm UserSecretsId thực tế `bhome-api-development`: file user-secrets có tồn tại nhưng không có key DigitalSigning/Viettel/MySign; chỉ xuất trạng thái có/không, không đọc/in giá trị bí mật ra log. Không sửa file cấu hình hoặc secrets. PostgreSQL test riêng port 55439 đã dừng sau khi các bài kiểm tra DB/browser kết thúc; không dừng instance PostgreSQL của dự án. Không còn API/browser helper của harness đang chạy sau cleanup.

## Danh sách file thay đổi qua các commit triển khai

- docs/api/API_IMPLEMENTATION_STATUS.md
- docs/api/FINANCE.md
- docs/api/PAYMENTS.md
- docs/development/NGUYEN_QUOC_HUY_E2E_IMPLEMENTATION.md
- packages/client-core/src/finance.ts
- packages/client-core/src/payments.ts
- scripts/Verify-FinanceClients.cjs
- src/backend/BHome.Api/Controllers/ExpensesController.cs
- src/backend/BHome.Api/Controllers/FinancialReportsController.cs
- src/backend/BHome.Api/Controllers/FinancialScenariosController.cs
- src/backend/BHome.Api/Middleware/ApiExceptionHandler.cs
- src/backend/BHome.Application/Finance/ExpenseService.cs
- src/backend/BHome.Application/Finance/FinancialReportService.cs
- src/backend/BHome.Application/Finance/FinancialScenarioService.cs
- src/backend/BHome.Application/PaymentsDebt/PaymentContracts.cs
- src/backend/BHome.Application/PaymentsDebt/PaymentService.cs
- src/backend/BHome.Domain/PaymentsDebt/PaymentRecords.cs
- src/backend/BHome.Infrastructure/DependencyInjection.cs
- src/backend/BHome.Infrastructure/Finance/ExpenseRepository.cs
- src/backend/BHome.Infrastructure/Finance/FinancialReportRepository.cs
- src/backend/BHome.Infrastructure/Finance/FinancialScenarioRepository.cs
- src/backend/BHome.Infrastructure/PaymentsDebt/PaymentRepository.cs
- src/backend/BHome.Infrastructure/Persistence/Compact24/Compact24EventsAndLedger.cs
- src/owner-web/src/app/router.test.tsx
- src/owner-web/src/features/contracts/MainDraftSettingsPanel.test.tsx
- src/owner-web/src/features/contracts/MainDraftSettingsPanel.tsx
- src/owner-web/src/features/expenses/ExpensesApiPage.test.tsx
- src/owner-web/src/features/expenses/ExpensesApiPage.tsx
- src/owner-web/src/features/expenses/useFinanceApi.ts
- src/owner-web/src/features/locations/pages/LocationWorkspace.tsx
- src/owner-web/src/features/payments/OwnerInvoicePaymentPanel.tsx
- src/owner-web/src/features/payments/Payments.test.tsx
- src/owner-web/src/features/property/FinancePages.tsx
- src/owner-web/src/features/reports/FinancialReportsApiPage.test.tsx
- src/owner-web/src/features/reports/FinancialReportsApiPage.tsx
- src/owner-web/src/features/reports/pages/ReportsPage.tsx
- src/owner-web/src/features/what-if/FinancialScenariosApiPage.test.tsx
- src/owner-web/src/features/what-if/FinancialScenariosApiPage.tsx
- src/owner-web/src/features/what-if/pages/WhatIfPage.tsx
- tests/backend/BHome.Application.UnitTests/Finance/FinancialReportTests.cs
- tests/backend/BHome.Application.UnitTests/Finance/FinancialScenarioTests.cs
- tests/backend/BHome.Domain.UnitTests/PaymentsDebt/PaymentRulesTests.cs
- tests/backend/BHome.IntegrationTests/Compact24/Compact24ExpenseTests.cs
- tests/backend/BHome.IntegrationTests/Compact24/Compact24FinanceLedgerTests.cs
- tests/backend/BHome.IntegrationTests/Compact24/Compact24WorkflowRegressionTests.cs
- tests/backend/BHome.IntegrationTests/PaymentsDebt/PaymentLedgerTests.cs
- tools/BHome.ContractVerification/ContractVerificationCli.cs
- tools/BHome.ContractVerification/FinanceVerificationCli.cs

TASK: BE-19 / BE-17
SLICE: Tenant Mobile xem cọc/hoàn tiền; giữ Staff inspection consent độc lập

IMPLEMENTED:
- Existing ContractLifecyclePanel hiển thị số liệu server: issued/payable/paid, deposit used/refunded/reserved/available và PendingReview/VerifiedManual/NotRequired. Null giữ Chờ xác minh, không tự tính hoặc suy ngân hàng đã chuyển.
- Tenant chỉ đọc summary của Contract được backend cấp quyền; không có Owner request/approve/execution/private-proof actions. Staff không gọi hoặc hiển thị summary tài chính.
- Owner consent hiện hữu gắn summary.reference/inspection version. Staff inspection consent riêng gắn Contract/move-out version/baseline/readings/observed fields/evidence; thay input phải xác nhận lại, không khóa nhầm Staff theo financial summary Owner.

CHANGED FILES:
- src/mobile/src/features/contracts/ContractLifecyclePanel.tsx
- src/mobile/src/__tests__/moveout-settlement.test.tsx
- docs/api/REFUNDS.md và báo cáo này.

TESTS:
- npm.cmd run test --workspace src/mobile -- src/__tests__/moveout-settlement.test.tsx --maxWorkers=1: 5/5 đạt.
- npm.cmd run typecheck --workspace src/mobile: đạt; npm.cmd run lint --workspace src/mobile: đạt.
- Typed generic Vitest mock ban đầu không khớp ContractRequest; bọc generic như convention test hiện hữu. Không sửa DTO runtime/permission để che lỗi.
- Không có adb trên PATH hoặc LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe. Native Android/iOS E2E NOT RUN; mock renderer/component không phải camera/device acceptance. Logs .tools/huy-deposit-mobile-{ui,typecheck,lint}.log.

COMMIT:
- Message: feat(mobile): [BE-19] show authorized deposit settlement and return status
- SHA: `9d6aaaccaa84ab00fac0530e3aef01b078997c00`.

FRONTEND HANDOFF:
- Bùi Bảo Long review Mobile UX/device. Vũ Xuân Trường tiếp tục Owner Web; không nhân bản quản trị hoàn cọc Owner lên Mobile.

STATUS: PARTIAL — Mobile visibility component/typecheck/lint đạt; BE-19/BE-17 chưa DONE.

REMAINING:
- Browser real Web/API/Compact24/MinIO và native acceptance. Repro native: đăng nhập Staff đúng Location → mở inspection, chọn Final readings/ảnh, sửa field kiểm consent reset → Tenant đăng nhập đọc own summary → Owner Web hoàn theo sao kê → Tenant reload thấy VerifiedManual; Staff/cross-Tenant không thấy tài chính. Không có provider/bank thật trong lượt này.

TASK: BE-19
SLICE: Sửa cache eligibility cọc sau Owner lifecycle decision
IMPLEMENTED:
- Browser harness phát hiện nguồn deposit-refunds vẫn giữ blockers cũ trong staleTime=10000 của PortalProvider sau khi inspection-review đã commit.
- ContractLifecyclePanel nay invalidate đúng source SecurityDeposit/Contract ID trước reload; manual reload cũng làm mới source. Receipt/Contract khác giữ cache riêng. Consent source hiện hữu tiếp tục reset khi snapshot thực sự đổi.
CHANGED FILES:
- src/owner-web/src/features/contracts/{ContractLifecyclePanel,ContractLifecyclePanel.test}.tsx; docs/api/REFUNDS.md; báo cáo này.
TESTS:
- Owner Lifecycle/Refund/Payments focused: 21/21 đạt, thêm QueryClient regression với staleTime=10000 và scope isolation.
- Owner build/lint đạt; logs .tools/huy-deposit-cache-{ui,build,lint}.log.
- Harness đầy đủ chưa pass tại lúc sửa; còn chạy lại sau commit. Các lỗi locator nhầm nhãn Mobile và datetime-local trailing-zero normalization là ở harness, không tăng timeout/giảm guard.
COMMIT:
- Message: fix(moveout): [BE-19] refresh scoped deposit eligibility after decisions
- SHA: `a7aa72eb987fa3090a6ac8890cd20d1a2d2d571a`.
FRONTEND HANDOFF:
- Owner Web: Vũ Xuân Trường; Mobile không đổi trong fix này.
STATUS: DONE cho defect cache được tái hiện; BE-19 vẫn PARTIAL.
REMAINING:
- Tiếp tục E2E real Web/API/MinIO của nhánh cọc mới; khấu trừ có phí/native/provider chưa hoàn tất.

TASK: BE-19 / BE-X07
SLICE: Real Web/API/Compact24/MinIO move-out và hoàn cọc không khấu trừ
IMPLEMENTED:
- Mở rộng harness hiện hữu sau shared billing/historical occupancy, không seed trạng thái move-out/Final reading/refund/closed Contract trực tiếp. Thêm otherStaff account không assignment để kiểm scope âm.
- Tenant request → Owner browser approve → Owner schedule qua client → Staff MobileApi tạo/confirm Final120, inspection theo confirmed handover v2/assets/private evidence → Owner browser review NoAdditionalCharges.
- Owner browser xác minh người nộp theo statement fixture, request/approve/manual execution cọc 3.000.000 kèm ảnh MinIO, private download đúng bytes → Tenant authorized summary VerifiedManual → Owner review đúng snapshot và complete → Room Available.
- Approved/pending refund không cho complete; cross-Tenant/co-occupant không có Contract entitlement và Staff ngoài Location không đọc Final tasks/inspection. Tenant không tải Owner refund proof. Giữ một Final Invoice/ba recipients/hai allocations và hai refund source riêng (receipt10.000, deposit3.000.000).
CHANGED FILES:
- scripts/Verify-MoveOutClients.cjs (mới); scripts/Verify-MainDraftClients.cjs; scripts/Verify-ExcessRefundClients.cjs
- tools/BHome.ContractVerification/FinanceVerificationCli.cs; docs/api/REFUNDS.md, API_IMPLEMENTATION_STATUS.md; báo cáo này.
TESTS:
- dotnet build tools/BHome.ContractVerification --no-restore: đạt, 0 warning/error.
- dotnet run --project tools/BHome.ContractVerification --no-build -- --finance --main-draft: exit0, 19/19 nhóm PASS, DB/MinIO/API/browser fixture cleanup. Log .tools/huy-moveout-browser.log.
- node --check các script mới/sửa và git diff --check đạt.
- Lượt đầu dùng nhầm label Mobile thay label Owner; sau đó consent reset do cached eligibility dẫn tới fix a7aa72e (21/21 UI tests). Datetime-local trailing-zero .900 bị Chromium normalize nên dùng chuỗi canonical giữ nguyên instant, không tăng timeout/đổi clock/giảm approval guard.
COMMIT:
- Message: test(moveout): [BE-19] verify manual deposit return and room release E2E
- SHA: `2c1c3c5fb074cff2d1ddb8d124cb8cee69d0baee`.
FRONTEND HANDOFF:
- Owner Web Vũ Xuân Trường; Mobile Bùi Bảo Long. Actual Owner build/API mode được chạy; Staff/Tenant dùng shipped MobileApi/shared client, không native UI.
STATUS: DONE cho nhánh E2E không khấu trừ; BE-19/BE-X07 vẫn PARTIAL.
REMAINING:
- Khấu trừ có phí/damage/debt journal chưa triển khai, Finance deposit refund classification tiếp tục pending guard, notification worker tắt nên không claim notification E2E. MySign thật/native bank/device acceptance vẫn chưa đạt; không payout thật hoặc tuyên bố simulation có giá trị pháp lý.

TASK: BE-19 / BE-X07
SLICE: Backend Owner quyết định khấu trừ TenantDamage có evidence và hoàn phần còn lại
IMPLEMENTED:
- Truy vết UC-19/SRS p1833–1840, GBR-01/02/18, OQ-01/05 theo ủy quyền người dùng → DepositDeductionService/repository/ledger/refund source → unit/PG role/race/history/evidence/closure tests.
- POST contracts/{id}/deposit-deductions Owner-only, expectedVersion/current summary reference, UUID key và human approval. Chỉ TenantDamage do Owner nhập, evidence linked đúng inspection/Room/Asset, một item/Room/Asset, tổng <=available deposit. Không auto phí/phạt/lãi hoặc bù debt trực tiếp.
- Append DepositDeductionV1 vào contracts.history với version/actor/reason/source/proof hashes và audit; không thêm bảng/cột. Revision thay current plan, giữ tất cả bản cũ, không cộng lặp; sau reserve/refund không sửa plan.
- Nguồn thiếu/đổi/không khớp giữ pending. Available trừ approved deduction một lần. Source refund giữ deposit principal riêng, chỉ request phần còn lại, bắt buộc review plan ID/fingerprint và xác minh depositor. Không dùng cờ no-deduction cho plan có phí.
- Partial deduction + verified refund hoặc full retained deposit mới đủ đối ứng nguồn; full retention không tạo refund0/bank success. Actual proof bị thay chặn refund/settlement/closure. Invoice/allocations gốc không đổi, không tự tạo OPEX/Work Order.
CHANGED FILES:
- Application/Contracts/DepositDeductionService.cs; ContractContracts.cs; SettlementCalculation.cs; Finance/RefundService.cs
- Infrastructure/Contracts/{DepositDeductionRepository,DepositDeductionEvidence,ContractDepositPosition,ContractSettlementLedger}.cs
- Infrastructure/Finance/{RefundRepository,DepositRefundSource}.cs; DependencyInjection.cs; Api/Controllers/DepositDeductionsController.cs
- Application.UnitTests/Contracts/DepositDeductionTests.cs; IntegrationTests/PaymentsDebt/DepositDeductionTests.cs; Compact24WorkflowRegressionTests.cs
- docs/api/DEPOSIT_DEDUCTIONS.md, index/conventions/refund/status/runtime docs và báo cáo này.
TESTS:
- dotnet test Application.UnitTests --filter DepositDeductionTests|SettlementCalculationTests|RefundModeTests: 25/25 đạt (log huy-deduction-unit.log).
- dotnet test IntegrationTests --filter damage/fullDamage/depositReturn/Recovery/Refund/legacyClosure/ApiAudit: 19/19 đạt, 0 skip (log huy-deduction-pg.log). 3 damage + 7 existing refund + 3 legacy closure + 6 audit.
- Có canonical exact money/version serialization, unsupported reason/negative/fraction/excess/unknown evidence, unauthorized before lookup, Production simulation denial, concurrent same/different keys, stale/revision/history, proof tamper, remainder return/full retention/closure và invoice immutable.
- API audit mới 216 routes, 211 protected, 5 anonymous, 106 Owner GET, 0 5xx; generated inventory khớp manifest riêng. Build 0 warning/error. Không chạy browser có phí/native/provider trong slice backend.
COMMIT:
- Message: feat(deposit): [BE-X07] approve evidenced damage deductions and refund remainders
- SHA: `83cda815f9659c896cd9c7d8b9297efffd5b75fe`.
FRONTEND HANDOFF:
- Owner Web Vũ Xuân Trường: cần plan editor và approved-plan consent. Mobile Bùi Bảo Long: authorized fee breakdown/read-only; không cấp Staff quyền duyệt.
STATUS: PARTIAL — backend supported TenantDamage branch đã test; BE-19/BE-X07 chưa DONE.
REMAINING:
- Owner UI/bank-evidence E2E có phí, Finance classification/retained compensation, notification. Debt offset/fees vượt cọc/semantic duplicate fee nhập tay không tự suy quyết định; xem DEPOSIT_DEDUCTIONS.md. Không tuyên bố native/bank/MySign acceptance.

TASK: BE-19 / BE-X07
SLICE: Owner Web quyết định thiệt hại và review hoàn phần cọc còn lại
IMPLEMENTED:
- Reuse Contract lifecycle và RefundPanel; shared client gọi POST deposit-deductions, không frontend mock fallback.
- Owner chọn Room/Asset/ảnh inspection, nhập số tiền/căn cứ và xác nhận chưa tính invoice. Summary đổi remount editor; sửa input reset consent. Server quyết định tổng/eligibility, reservation hoặc unknown source giữ read-only.
- Retry ambiguous response giữ UUID/payload; lỗi không báo đã duyệt. Empty items chỉ gửi khi Owner nhập căn cứ và xác nhận quyết định rõ ràng.
- Refund source hiện plan/version/items; bắt buộc review đúng plan ID, deductionsConfirmed và không dùng no-deduction attestation cho plan có phí. Nguồn khác giữ flow cũ.
CHANGED FILES:
- packages/client-core/src/{contracts,refunds,useContractLifecycle}.ts
- src/owner-web/src/features/contracts/{DepositDeductionsPanel,DepositDeductionsPanel.test,ContractLifecyclePanel}.tsx
- src/owner-web/src/features/payments/{RefundPanel,RefundPanel.test}.tsx
- docs/api/{DEPOSIT_DEDUCTIONS,REFUNDS}.md và báo cáo này.
TESTS:
- Owner focused DepositDeductionsPanel/ContractLifecyclePanel/RefundPanel/Payments: 26/26 đạt.
- npm.cmd run build và lint --workspace src/owner-web: đạt; npm.cmd run typecheck --workspace src/mobile: đạt.
- Logs .tools/huy-damage-owner-{ui,build,lint}.log, huy-damage-mobile-typecheck.log. Chưa chạy browser có khấu trừ/native/provider ở slice này.
COMMIT:
- Message: feat(moveout): [BE-19] review evidenced deposit deductions in Owner Web
- SHA: `03fc9be8ccad333bd0c7db553908c34ff7d8692f`.
FRONTEND HANDOFF:
- Owner Web Vũ Xuân Trường review UX; Mobile Bùi Bảo Long giữ role-scoped read-only.
STATUS: PARTIAL — UI được kiểm component/build/lint, toàn BE-19/BE-X07 chưa DONE.
REMAINING:
- Real browser có khấu trừ/private proof/closure, Finance deposit source classification và notification. Debt offset/over-deposit fees chưa hỗ trợ; MySign/bank thật và native acceptance vẫn blocked/NOT RUN.

TASK: BE-19 / BE-X07
SLICE: Real browser khấu trừ có chứng từ, hoàn phần còn lại và regression không khấu trừ
IMPLEMENTED:
- Harness hiện hữu có --damage-settlement; vẫn dùng shipped Owner production build, HTTPS API, disposable Compact24 và MinIO thật.
- Owner duyệt inspection có thiệt hại, nhập TenantDamage100.000/ảnh/căn cứ/human review từ cọc3.000.000. Backend chốt inspection version/hash; chỉ hoàn2.900.000, trừ đúng một lần. Không seed quyết định/refund/closure.
- Owner browser lập/duyệt/ghi nhận manual execution với proof private, Tenant đọc approved deductions/refund/status, pending chặn closure; Owner review/complete mới RoomAvailable. Invoice Final/allocations/payer và history giữ nguyên.
CHANGED FILES:
- scripts/Verify-MoveOutClients.cjs; tools/BHome.ContractVerification/{ContractVerificationCli,FinanceVerificationCli}.cs
- docs/api/DEPOSIT_DEDUCTIONS.md và báo cáo này.
TESTS:
- dotnet build tools/BHome.ContractVerification --no-restore: đạt, 0 warning/error.
- dotnet run --project tools/BHome.ContractVerification --no-build -- --finance --main-draft --damage-settlement: exit0, 20/20 nhóm PASS.
- Cùng lệnh bỏ --damage-settlement: exit0, 19/19 nhóm PASS. Logs huy-damage-moveout-browser.log và huy-undisputed-moveout-browser.log.
- node --check, git diff --check đạt. API/browser fixture cleanup hoàn tất. Sao kê/bank/signing synthetic, không payout thật; Staff/Tenant là shipped MobileApi/shared transport, không native UI. Notification worker tắt.
COMMIT:
- Message: test(moveout): [BE-19] verify evidenced deductions and remainder return E2E
- SHA: `be28d6dd2fa6712967684dcd464bee6ca617b470`.
FRONTEND HANDOFF:
- Vũ Xuân Trường review Owner UX; Bùi Bảo Long thực hiện native acceptance khi có thiết bị.
STATUS: DONE cho hai nhánh browser nêu trên; tổng BE-19/BE-X07 PARTIAL.
REMAINING:
- Finance classification/retained compensation và notification; unsupported debt offset/fees vượt cọc. Native/MySign/bank-provider acceptance chưa có; không suy rộng kết quả fixture.

TASK: BE-19 / BE-25 / BE-X07
SLICE: Không cho unclassified receipt refund tự xóa pending-review
IMPLEMENTED:
- Trace UC-19/22/25, GBR-10/18 → PaymentRepository.PendingReviewAsync → Compact24RefundTests và closure regression.
- Tổng Completed khớp tiền thừa chưa đủ. Kiểm state ExcessReceiptRefundV1 cuối cùng, đúng payer/beneficiary, source riêng, execution time/key/reference/SHA256 và Completed event; giữ ledger amount/Final invoice nguyên vẹn.
- Dùng tổng allocations của receipt, không chỉ một allocation. Unknown legacy hoặc metadata không khớp giữ pending để settlement không bỏ qua nghĩa vụ.
CHANGED FILES:
- Infrastructure/PaymentsDebt/PaymentRepository.cs; IntegrationTests/Compact24/Compact24RefundTests.cs
- docs/api/REFUNDS.md và báo cáo này.
TESTS:
- dotnet test IntegrationTests --filter Compact24RefundTests|DepositReturn|RealLedgerRequiresReviewedSnapshot|NewAdjustmentAfterSettlement: 11/11 đạt, 0 skip; log huy-refund-review-guard-pg.log.
- Có raw legacy Completed đúng bằng excess, appended last state thiếu hash/sai reference, recovery bằng append state hợp lệ, paid amount không đổi và valid workflow regression.
- Fixture đầu cố thay history bị trigger append-only chặn; sửa fixture thành append đúng lịch sử, giữ trigger/production invariant. Không bỏ hoặc nới guard.
COMMIT:
- Message: fix(payment): [BE-25] retain review for unclassified completed excess returns
- SHA: `c39a58b910a92c380453e3ff043685b54c9b4739`.
FRONTEND HANDOFF:
- Owner/Mobile tiếp tục dùng pendingReview server, không thay UI hoặc tự suy payment success.
STATUS: DONE cho defect đối soát này; các task nghiệp vụ còn giới hạn như đã ghi.
REMAINING:
- Finance phân loại deposit principal returns và làm rõ treatment retained damage. Bank/native/provider acceptance chưa có.

TASK: BE-31 / BE-32 / BE-X07 / BE-X08
SLICE: Phân loại hoàn gốc cọc riêng trong Finance, giữ mô hình Invoice/OPEX
IMPLEMENTED:
- Trace UC-19/31..34, GBR-10/15/16/18 và OQ-01/05 user authorization → FinancialReportRepository/Service và Owner report → unit/PG/UI.
- Phân loại SecurityDepositRefundV1 cuối cùng với source Contract/occupant, attestation, plan ID nếu có, budget cọc, Completed event và proof key/reference/hash. Receipt-excess giữ nguồn riêng; malformed events giữ unknown thay vì query500.
- Thêm verifiedDepositReturns chuỗi tiền, theo executed_at/kỳ Việt Nam/Location/Room, loại demo và pending requests. Không thay issued/collections/OPEX/profit/net/recovery; incomplete legacy/unknown vẫn guard toàn chuỗi.
- Owner report hiện subtotal hoàn gốc và giải thích khoản giữ cọc bồi thường chưa nhập mô hình Invoice/OPEX. Saved What-if cũ thiếu optional field giữ null; không hồi tố snapshot.
- Không tạo/sửa ledger, auto OPEX hoặc doanh thu từ approved plan. Chưa có liability rollup/realized compensation accounting.
CHANGED FILES:
- Application/Finance/FinancialReportService.cs; Infrastructure/Finance/{FinancialReportRepository,FinancialReportRefunds}.cs; PaymentsDebt/PaymentRepository.cs
- Shared finance DTO; Owner FinancialReportsApiPage và test; FinancialReportTests; DepositDeductionTests/DepositRefundTests/Compact24RefundTests
- API status/FINANCE/DEPOSIT_DEDUCTIONS và báo cáo này.
TESTS:
- Finance report/scenario unit: 9/9 đạt, exact decimal lớn và saved snapshot compatibility.
- Compact24 damage/full-retention/undisputed/recovery/refund/finance/history tests: 13/13 đạt, 0 skip; có pending không tính, period/scope, demo exclusion, legacy/malformed-last-state guard, profit/collection/OPEX không đổi.
- Owner report UI: 9/9 đạt, missing khác verified0; Owner build/lint đạt.
- Logs huy-finance-deposit-{unit,pg,ui,build,lint}.log. Fixture assert ban đầu đặt ở reservation thay Completed và nhầm 1 invoice với 2 invoice đã trả; sửa theo actual fixture preconditions, không đổi formula/guard để làm xanh.
COMMIT:
- Message: feat(finance): [BE-X08] classify verified deposit principal returns separately
- SHA: `43a8318a14bfa5e5db2538b18ac8421525991ccd`.
FRONTEND HANDOFF:
- Owner Web Vũ Xuân Trường review report note; Mobile không thêm quản trị Finance.
STATUS: DONE cho principal-return classification được test; Finance/BE-19/BE-X07 PARTIAL theo giới hạn.
REMAINING:
- Browser report regression sau classification, full suites, report evidence package; realized compensation/liability report/upstream Work Order/native/MySign/bank/notification không được suy hoàn tất.

TASK: BE-19 / BE-X07 / FE-07 / JOB-04
SLICE: Inbox trả phòng, quyết định khấu trừ và hoàn cọc sau committed history
IMPLEMENTED:
- Trace UC-19/35/36, GBR-01/02/18, JOB-04 → existing NotificationEventPublisher → PG inbox/target/retry tests.
- Reuse transaction/advisory publication lock và unique recipient/eventKey. Quét ContractMoveOutHistory và Compact24 DepositDeductionV1/SecurityDepositRefundV1, batch25/source; chỉ Owner signer/Tenant Contract có quyền xem settlement.
- Generic status/link Contract, không amounts/private reason/bank reference/evidence; Staff/co-occupant khác không nhận dữ liệu tài chính. Approved báo chờ thực hiện; Completed cần actual execution/proof metadata. Không thêm contact rule/cadence/provider hoặc bảng.
- Nguồn tài chính commit trước; asynchronous publish/retry không rollback contract/refund. Existing clients dùng inbox/target hiện hữu.
CHANGED FILES:
- Infrastructure/Modules/Notifications/{NotificationEventPublisher,SettlementNotificationPublisher}.cs
- IntegrationTests/PaymentsDebt/{MoveOutNotificationTests,DepositDeductionTests,DepositRefundTests}.cs
- docs/api/{NOTIFICATIONS,REFUNDS,API_IMPLEMENTATION_STATUS}.md và báo cáo này.
TESTS:
- Focused IntegrationTests 11/11 đạt, 0 skip: partial/full deduction/no-charge return, notifications/inbox/target và existing delivery failure/retry/lease regressions.
- Có concurrent pump/replay/no duplicate, pending không báo completed, deep-link authorized/cross-Tenant404, Staff/otherTenant không thấy finance và no private payload. External delivery giữ Unconfigured, tài chính không đổi.
- Lượt đầu consumer nhầm tên event decision Approved thay actual persisted APPROVED; test pending-stage phát hiện, sửa theo contract hiện hữu. Không sửa event đã phát hành hoặc nới assertion.
- Log huy-settlement-notifications-pg.log. Chưa browser pump trong slice backend này; không claim email/push/native.
COMMIT:
- Message: feat(notification): [BE-19] publish scoped move-out and deposit settlement events
- SHA: `e3467b76fb2aa008bdc09fb8de9637b93af67667`.
FRONTEND HANDOFF:
- Owner Web Vũ Xuân Trường, Mobile Bùi Bảo Long dùng inbox/Contract target hiện có; native acceptance còn thiếu.
STATUS: DONE cho backend in-app consumer được kiểm chứng; external delivery BLOCKED bởi provider Unconfigured.
REMAINING:
- Browser E2E explicit event pump và report classification; full regression/evidence package. Receipt-excess consumer riêng chưa triển khai trong slice này.

TASK: BE-X08 / BE-X05
SLICE: Khôi phục xUnit activation cho Compact24 workflow fixtures
IMPLEMENTED:
- Full regression phát hiện 23 test IClassFixture không được chạy vì xUnit coi optional IObjectStorage constructor argument là dependency bắt buộc.
- Fixture có một public constructor không tham số; overload storage dành riêng test recovery là internal. Giữ nguyên factory/storage/default Compact24 và toàn bộ assertions/schema.
CHANGED FILES:
- tests/backend/BHome.IntegrationTests/Compact24/Compact24WorkflowRegressionTests.cs và báo cáo này.
TESTS:
- Full integration lần đầu: 603 pass, 23 fail fixture activation, 1 optional real-OCR skip / 627 total. Không tính 23 lỗi là skip/pass.
- Focused Compact24ContractRegressionTests/MeterCaptureRegressionTests/Compact24DepositRecoveryTests sau fix: 24/24 đạt, 0 skip; log huy-fixture-constructor-pg.log.
- Domain90, Application276, DigitalSigning41 pass và Owner155/Mobile381 pass ở lượt regression vừa chạy; full integration cần chạy lại sau fix.
COMMIT:
- Message: fix(test): [BE-X08] initialize Compact24 workflow fixtures through xUnit
- SHA: `d7fec61e7c1ce42547a68dd4b9486c956ffbfb1e`.
FRONTEND HANDOFF:
- Không thay frontend/business behavior; QA Nguyễn Quang Huy tiếp tục dùng cùng regression commands.
STATUS: DONE cho fixture defect; final integration regression còn chờ chạy lại.
REMAINING:
- Full integration, browser report/inbox E2E, cập nhật evidence package và docs/audit links.

TASK: BE-19 / BE-X07 / BE-X08 / JOB-04
SLICE: Browser kiểm report classification và persistent settlement inbox
IMPLEMENTED:
- Extend real move-out harness sau manual return/closure; API report so với trước return giữ totals/capital và loại isDevelopmentDemo principal returns.
- Explicit Testing-only process-events pump khi worker tắt. Owner browser mở closure notice → reauthorized Contract target; Tenant nhận đúng deduction/refund/closure, chạy lại không trùng. Staff/unassigned Staff/cross-Tenant/co-occupant không entitlement không nhận finance notice.
- Owner report hiện verifiedDepositReturns và note retained damage chưa nằm trong Invoice/OPEX model; không fallback mock.
CHANGED FILES:
- scripts/Verify-MoveOutClients.cjs; docs/api/{CONTRACT_LIFECYCLE,REFUNDS,NOTIFICATIONS}.md và báo cáo này.
TESTS:
- dotnet build tools/BHome.ContractVerification --no-restore sau full testhost kết thúc: đạt, 0 warning/error.
- --finance --main-draft --damage-settlement: exit0, 22/22 nhóm PASS; --finance --main-draft: exit0, 21/21 nhóm PASS.
- Logs huy-final-{damage,undisputed}-browser.log, huy-final-harness-build-rerun.log. MinIO/API/browser/disposable DB cleanup hoàn tất; node --check và diff check đạt.
- Build ban đầu chạy cùng testhost bị Windows khóa DLL (18 copy errors); tách tuần tự và build lại đạt. Script từng trùng local const target, node syntax check phát hiện và sửa trước chạy browser. Không tăng timeout/giảm assertions hoặc sửa production để che lỗi.
- Manual pump chỉ nghiệm thu persistent inbox/deep-link, không JOB scheduling/email/push. Signing/bank synthetic; Mobile transport, không native UI.
COMMIT:
- Message: test(moveout): [BE-19] verify settlement inbox and finance reporting in browser
- SHA ghi sau commit final settlement browser.
FRONTEND HANDOFF:
- Owner Vũ Xuân Trường review UX; Mobile Bùi Bảo Long chạy native; QA Nguyễn Quang Huy chuyển evidence sang Report5.
STATUS: DONE cho các browser paths nêu trên; external/native acceptance còn PARTIAL/BLOCKED.
REMAINING:
- Chốt current status/evidence package và cleanup test cluster. Không có Holding policy, staging MySign, bank/email/push hoặc device mới trong lượt này.
