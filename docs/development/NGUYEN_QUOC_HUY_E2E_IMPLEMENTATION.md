# Triển khai và kiểm chứng các nhiệm vụ Nguyễn Quốc Huy

Ngày bắt đầu: 05/11/2026. Nhánh `member/QHuy`; baseline `5357b39`. Working tree ban đầu sạch. Đây là báo cáo tiến độ thực thi; không phải xác nhận hoàn tất 22 nhiệm vụ. Không push/merge, không ghi vào database làm việc `bhome`.

## Nguồn và truy vết

Đã đọc AGENTS gốc và hai client, API_CONVENTIONS, thiết kế/DDL/báo cáo Compact24, source/DTO/DI/tests, nội dung SRS `(2)`, SDS `(5)` và Report 2 `(3)` trong `docs/reports`. SRS: BF-03/04, UC-14..19, GBR-01/02/04, DBR-02/03; BF-05/06, UC-20..25; FE-08, UC-31..34, GBR-15/16/18. Không tìm thấy workbook `BHOME_Checklist_Phan_Cong_Tich_Hop_Tien_Do.xlsx` hoặc Reports 5–7; chưa có căn cứ để sửa checklist hay công bố ST/AT theo các mẫu đó.

Người dùng xác nhận OQ-01/02/05 đã đóng trong phiên này. Chưa nhận được nội dung quyết định; các tài liệu đang lưu vẫn ghi mở. Cần tìm/đưa quyết định cụ thể vào nguồn truy vết trước khi thay công thức khấu trừ/hoàn tiền. Không suy ra một chính sách từ việc câu hỏi đã đóng.

## Ma trận 22 nhiệm vụ sau kiểm tra nguồn ban đầu

| ID | Đã có / dữ liệu / UI | Khoảng trống và nghiệm thu còn lại | Trạng thái |
| --- | --- | --- | --- |
| BE-X04 | DI mặc định Compact24, worker/Identity/readiness; 24/386/83 | Regression server riêng, SQL log không legacy đã đạt 1 test; cần toàn bộ regression | PARTIAL |
| BE-14 | Contract Holding boundary và test transfer | `UnconfiguredContractHoldingLedger` vẫn đăng ký; chưa có Holding E2E thật | BLOCKED |
| BE-15 | Owner settings/Main Draft/documents/signing/deposit/activation; Web/Mobile; contracts JSON | Sửa trạng thái UI cấu hình; provider staging, tenant document review và browser E2E chưa nghiệm thu | PARTIAL |
| BE-16 | Renewal API/client, giữ phiên bản và chữ ký | Test Compact24 đạt; provider thật và UI E2E chưa chạy | PARTIAL |
| BE-17 | Handover API/client, baseline, evidence, hai xác nhận | Test Compact24 đạt; native Staff/Tenant E2E chưa chạy | PARTIAL |
| BE-19 | Move-out/inspection/settlement state machine | Positive test dùng ledger test; policy cụ thể/refund và E2E thật chưa đủ | PARTIAL |
| BE-20 | Capture/OCR/confirmation, Web monitor/Mobile; meters/readings | Regression nguồn hiện có; chưa chạy lại detector/device acceptance trong lượt này | NOT RUN |
| BE-21 | Room/kỳ invoices/items/recipients, billing schedule/automation, Web/Mobile | Cần chạy regression Compact24 và E2E | NOT RUN |
| BE-22 | Verified transactions/allocation, receiving account; Web/Mobile | Cần regression thực và bank integration; không tự nới under/overpayment | NOT RUN |
| BE-23 | Debt/due date/reminders/inbox | Cần regression Compact24, UI | NOT RUN |
| BE-24 | Request/evidence/Owner decision và lịch sử, Web/Mobile | Cần regression Compact24, quyết định OQ cụ thể, UI | NOT RUN |
| BE-25 | Payment history và scope | Cần regression và UI | NOT RUN |
| BE-31 | Bảng `expenses`; UI Investments hiện demo | Chưa có service/repository/controller Finance trong DI; cần API và UI thật | PARTIAL |
| BE-32 | UI reports/demo | Chưa có backend reports thực được đăng ký | PARTIAL |
| BE-33 | UI demo tính recovery | Chưa có backend recovery từ ledger thực | PARTIAL |
| BE-34 | `financial_scenarios`; UI demo | Chưa có backend analyze/save/list/get và isolation tests | PARTIAL |
| BE-X05 | CLI/preflight/mapping/reconciliation tests và artifacts | Cần chạy lại populated synthetic migration, không dùng dữ liệu thật | NOT RUN |
| BE-X06 | MinIO adapter, PDF signer, MySign adapter native | Không thấy bằng chứng provider staging; PDF conversion baseline lỗi; storage test substitute không phải MinIO thật | PARTIAL |
| BE-X07 | Bank claim/exact reconciliation/deposit guards | Chưa có nội dung chính sách đã đóng; Holding/refund chưa nghiệm thu | PARTIAL |
| BE-X08 | Invoice/payment unit và integration tests | Chưa có finance/report regression thực | PARTIAL |
| DOC-01 | Reports 2/3/4 originals, docs kỹ thuật | Báo cáo này bổ sung discrepancy; không sửa bản gốc để biến giới hạn thành yêu cầu | PARTIAL |
| DOC-03 | Báo cáo bằng chứng này | Report 7 không có tại repository; chưa thể đóng final evidence | PARTIAL |

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
