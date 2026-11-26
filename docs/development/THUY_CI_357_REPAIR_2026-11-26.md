# Sửa CI member/THuy — 26/11/2026

## Phạm vi và truy vết

Yêu cầu: cập nhật `member/THuy`, tích hợp `origin/develop` để chuẩn bị PR vào
`develop`, sửa nguyên nhân CI thất bại; không phát hành ứng dụng.

- Nhánh trước thao tác: `member/QHuy`, working tree sạch.
- `origin/member/THuy`: `e1d502354f326725ea6ee181f7b52c0ce4fcf71c`.
- `origin/develop` đã fetch: `98ecb6cb`.
- Evidence gốc: [CI #357](https://github.com/nguyenhuy238/SEP490-G92-BHOME/actions/runs/45758705230),
  artifact `backend-trx-attempt-1` (ID `15089342025`).
- CI #357 chạy head `82759806a2ca3cf51e07b311e10acd2af53f6776`; PR #174 hiện
  đã ở `e1d50235`. Vì vậy kiểm tra cả source mới nhất, không chỉ sửa theo log cũ.
- BF-05/UC-21/JOB-10: giữ lập hóa đơn tháng của THuy, đồng thời giữ quyết định
  tính `FixedPerPersonPerMonth` theo sức chứa trên develop, được ghi rõ trong
  [INVOICES.md](../api/INVOICES.md#quyết-định-phí-theo-sức-chứa--26112026).
- BF-06/UC-24/GBR-10, UC-19: test điều chỉnh, quyết toán, hoàn cọc theo
  `AdjustmentService`, `ContractSettlementLedger`, `PaymentService` và các
  tài liệu [điều chỉnh](../api/INVOICE_ADJUSTMENTS.md),
  [bàn giao billing](BILLING_REFERENCE_CONTRACT_HANDOFF.md).
- UC-35/36, JOB-04, GBR-18: thông báo đúng người nhận, không lộ private reason/
  bank reference, chạy lặp không nhân đôi theo [NOTIFICATIONS.md](../api/NOTIFICATIONS.md).

Không sửa công thức thanh toán, quyền, API hoặc workflow CI để bỏ qua test.
Các phần SRS chưa thống nhất không được giải quyết trong bản sửa CI này.

Quyết định sau đối chiếu hai nhánh: người dùng xác nhận giữ quy tắc THuy
thu tiền thuê tháng kế tiếp, phí đủ tháng, đồng thời giữ tính phí theo sức chứa.
Đã cập nhật INVOICES.md và tài liệu bàn giao để ghi nhận quyết định này.

## Nguyên nhân và thay đổi

Artifact gốc có 6 test fail trong IntegrationTests. Chạy lại cả 6 trên PostgreSQL
disposable sau khi tích hợp develop tái hiện **6 fail, 0 pass**:

- Test hoàn cọc và bàn giao gửi điều chỉnh mới sau khi fixture đã trả đủ hóa đơn;
  backend từ chối đúng bằng `adjustment_invoice_paid`.
- Test bù trừ cọc cũng gửi điều chỉnh quá muộn. Fixture nay tạo request trước
  thanh toán và Owner duyệt request đã tồn tại sau thanh toán.
- Test thông báo dùng khoản thanh toán thiếu tiền nhưng chạy cả persistence
  legacy, vốn không hỗ trợ phân bổ lệch số tiền. HTTP 200 chứa `PendingReview`
  từng bị coi là đã phân bổ. Nay dùng đủ số tiền của invoice thực tế, kiểm tra
  `Allocated`, gửi request trước thanh toán, giữ kiểm tra replay và riêng tư.
- Test hoàn cọc đổi nguồn nay kiểm tra cả việc từ chối request trên hóa đơn đã
  trả đủ và receipt mới chờ đối soát làm approval cũ bị stale; từ chối refund vẫn
  giải phóng reservation. Không xóa hoặc sửa giao dịch cũ.
- Test bàn giao giữ dư nợ từ đầu để request sau review hợp lệ; vẫn kiểm tra
  request pending tồn tại sau bàn giao.

Bản THuy mới nhất còn có lỗi format initializer trong
`BillingReferenceContractTests.cs`; sửa whitespace theo formatter hiện có.

Hai xung đột merge được xử lý tại:

- `InvoiceService.cs`: FullMonth của THuy kết hợp số lượng theo sức chứa của develop.
- `CompactNotificationReminders.cs`: giữ `billingToday` và residence date alerts;
  lượt publish riêng billing không chạy residence alerts.

Lượt chạy toàn bộ đầu tiên phát hiện thêm test quyết toán còn dùng giả định
RENT cùng kỳ. Đã dừng lượt chạy này để build lại source mới:

- Fixture review/refund nay ghi nhận cả tiền thuê tháng hiện tại chưa thanh toán
  và tiền thuê tháng kế tiếp trong invoice; tăng cọc synthetic tương ứng, không
  thay production amount để giữ expected cũ.
- Test hóa đơn lịch sử seed rõ snapshot đã phát hành theo kỳ/ngày lẻ cũ, không
  gọi generator mới để dựng lịch sử. Vẫn kiểm tra bất biến Final, điều chỉnh
  khi ngày trả thay đổi và không thu trùng coverage cùng kỳ.
- Phòng đã kết thúc toàn bộ hợp đồng không đủ điều kiện thu trước tháng kế
  tiếp: test kiểm tra từ chối tạo invoice mới sau quyết toán.
- Thêm regression qua API/database thật: generator mới thu RENT N+1 và phí
  đủ sức chứa dù cấu hình legacy là ngày lẻ và phòng có ít người ở hơn sức chứa.

Đã xác định lỗi tích hợp thật khi hợp đồng đối chiếu tự động khác hợp đồng
đang trả phòng: `SettlementReceivablesRepository` bỏ sót hóa đơn chung và từ chối
đích cấn trừ; trigger PostgreSQL cũng chỉ chấp nhận invoice mang hợp đồng trong
chuỗi riêng. Sửa đồng bộ truy vấn xem số dư và xác minh đích ghi bằng cùng điều
kiện: hóa đơn Final cùng phòng, PERIODIC trong kỳ thuê và có Tenant trong
recipient snapshot. Hóa đơn riêng theo chuỗi hợp đồng giữ hành vi cũ. Tenant
vẫn không nhận danh sách invoice cấn trừ của Owner; Staff vẫn bị từ chối.

Migration `20261126000100_SharedInvoiceDepositOffsets` cập nhật duy nhất guard
`bhome24_settlement_allocation_guard`. Giữ exact Owner approval, allocation ID,
nguồn cọc, cùng phòng, ngân sách đã trừ reservation, số dư và reversal guard.
Không sửa bảng, số tiền, invoice Final, allocation hoặc history đã lưu.
Active schema reference được cập nhật để DB trống và readiness cùng quy tắc;
`InitialCompact24.sql` và các migration cũ giữ nguyên.

Regression buộc hợp đồng đối chiếu là người khác trong phòng. Các ca refund/
close kiểm tra cấn trừ thật, replay/concurrency và remaining deposit. Test âm
kiểm tra cả repository và trigger thực tế với invoice sai phòng, trước kỳ thuê,
sau kỳ trả phòng hoặc thiếu recipient; từng write thất bại rollback transaction.

## Áp dụng database

Chỉ database disposable local được thay đổi trong phiên này. Database local
có dữ liệu, shared development, Staging và Production chưa áp migration mới.
Operator cần review migration theo
[DATABASE_MIGRATION_WORKFLOW.md](../database/DATABASE_MIGRATION_WORKFLOW.md)
và quy trình phát hành hiện có. Không chạy lại baseline lên DB đã có dữ liệu;
không sửa migration history để ép trạng thái READY. Down từ chối vì allocation
đã ghi theo quy tắc mới phải tiếp tục đối chiếu được; recovery cần kế hoạch
được review thay vì tự đảo lịch sử tài chính.

## Tiêu chí kiểm tra

- Cả 6 test gốc phải thực thi và pass; không đổi filter hoặc skip để né lỗi.
- Backend build, format, discovery, toàn bộ CI test inventory và các script
  xác minh TRX/Staging regressions phải được kiểm tra.
- Kiểm tra frontend sau tích hợp develop bằng lint, format và workspace tests.
- Không dùng database làm việc hoặc provider/bank thật; chỉ fixture synthetic.

## Kết quả thực thi

- Release solution build: PASS, 0 warning, 0 error.
- 6 test lỗi gốc sau sửa: PASS 6/6, không skip.
- Lượt regression cuối, gồm 6 ca gốc, billing/quyết toán/quyền/trigger và
  `RuntimeSchemaUpgradeTests`: PASS **21/21**, không skip; bao gồm nâng DB từ
  baseline EF cũ, giữ dữ liệu và kiểm readiness.
- `dotnet format src/backend/BHome.sln --verify-no-changes --no-restore`: PASS.
- Frontend workspace tests: Owner Web **1.072 PASS**, Mobile **1.790 PASS**,
  Public Web **11 PASS**. Không đổi frontend source ngoài nội dung merge develop.
- Client-core build, Mobile typecheck, Owner Web/Public Web production build: PASS.
- ESLint source và Prettier source: PASS. Lệnh `npm run lint` đầu tiên bị
  41 lỗi trong `.artifacts/finance-ux-20261126` là script local ignored;
  chạy lại ESLint với `--ignore-pattern '.artifacts/**'` PASS. Không sửa rule
  repository để bỏ qua source. Prettier dùng cả `.prettierignore` và `.gitignore`.
- `Test-SePaySandboxScripts.ps1`: PASS qua PowerShell `-ExecutionPolicy Bypass`
  sau khi lần gọi trực tiếp bị execution policy của máy chặn.
- `node --test tests/deployment/ci-backend-test-boundary.test.cjs`: PASS 1/1.
- Toàn bộ backend CI suite cuối: **2.698 PASS, 32 SKIP, 0 FAIL** trong 9 TRX.
  Integration **1.535 PASS/32 SKIP**; Application **756 PASS**, Domain **115 PASS**,
  Infrastructure **251 PASS**, DigitalSigning **41 PASS**.
- `Verify-BackendTrx.py` với committed inventory và current discovery: PASS.
- `Verify-StagingRegressions.py`: PASS cả **9** nhóm bắt buộc.

Test `SharedMainInitialPaymentMigrationTests` trước đây chỉ cho phép hai
function thay đổi khi upgrade lên latest. Bổ sung guard cấn trừ mới vào danh sách
thay đổi chính xác và assert body thực sự đổi; mọi function khác và bản ghi cũ
vẫn được so sánh nguyên vẹn. Chạy lại test này cùng migration CLI trên layout
build chuẩn: **2 PASS**, không skip. Một lượt kiểm tra phụ dùng
`--artifacts-path` không đáp ứng đường dẫn CLI cố định của test và đã dừng;
không dùng lượt đó làm evidence PASS hoặc sửa assertion để che lỗi đường dẫn.

Lượt kiểm tra toàn bộ cuối giữ cùng bộ lọc Suite của `ci.runsettings`. Nhóm
`FullyQualifiedName!~BHome.IntegrationTests.Compact24.` chạy riêng; Compact24
được chia theo 73 lớp thành bốn nhóm không giao nhau. Bốn unit assemblies
chạy riêng. `Verify-BackendTrx.py --integration-shards 5 --discovery` đối chiếu
toàn bộ test ID/discovery và phát hiện thiếu/trùng kết quả. Không đổi workflow
CI. Inventory chỉ cập nhật năm định danh đã thay đổi ở các commit THuy có sẵn
(nêu dưới đây), giữ nguyên count bắt buộc và toàn bộ mục khác. TRX được giữ
nguyên nội dung; bằng chứng cuối
không sử dụng các lượt bị dừng hoặc thất bại trước đó.

Inventory cũ chưa theo kịp hai commit THuy:

- `82759806`: `MeterJobPreservesUnassignedWorkAndReportsMissingMetersUntilOwnerAssigns`
  được đổi thành `MeterJobPreservesUnassignedWorkAndMakesItVisibleOnLocationAssignment`.
  Cập nhật đúng identity/ID của test đã đổi tên; test phân công theo Location hiện tại
  và test từ chối Staff cũ vẫn thực thi trong suite.
- `6052b388`: worker billing tách khỏi general jobs. Một dòng theory của
  `ManualStagingOptInIsIndependentOfWorkersAndOtherDeveloperActions` đổi expected
  `worker: False` thành `True`. Ba dòng guard cũ coi billing tự động là cấu hình
  không an toàn được thay bằng ba dòng `DedicatedBillingDoesNotRequireGeneralJobs`
  cho Development/Staging/Production. Cập nhật inventory theo đúng bốn dòng thay thế;
  không giảm count, không bỏ test và không sửa verifier để chấp nhận thiếu kết quả.

Đối chiếu lịch sử, TRX artifact cũ và TRX hiện tại trước khi cập nhật từng identity.
Không regenerate inventory hàng loạt từ kết quả hiện tại. Mọi phương thức/theory
trong discovery hiện tại đều được verifier kiểm tra đã chạy.

Catalog test cũng cần bổ sung chính xác ID migration mới vào danh sách kỳ vọng.
Đồng hồ host có lần nhảy lùi hơn 40 phút trong quá trình kiểm tra, khiến DLL có
mtime trong tương lai và build tăng dần bỏ qua source mới. Đã dùng
`dotnet build ... -t:Rebuild -p:UseSharedCompilation=false -m:1`, sau đó chạy
catalog preflight PASS trước lượt chia nhóm cuối. Không bỏ kiểm tra migration/
snapshot để né lỗi. Một ca gia hạn gặp 401 trong giai đoạn đổi giờ; chạy lại
riêng PASS, không thay JWT validation hoặc quyền.

Collector SQL log qua PowerShell bị trễ khiến independence test đọc thiếu
bằng chứng. Đổi collector local sang redirection trực tiếp của process, theo
`docker logs --follow --tail 0`, rồi chạy independence test PASS và chạy lại
nguyên nhóm Compact24. Không sửa assertion/query guard của test này.

Deployment bổ sung: Node **25 PASS**, cả hai Compose config PASS. Python native
Windows lỗi import `fcntl` ở hai module; chạy lại trong `python:3.12-slim`,
repository mount read-only và network disabled: **94 test, 0 lỗi, 1 skip**.

## File sửa trực tiếp ngoài nội dung đồng bộ develop

- Billing: `InvoiceService.cs` và `BillingReferenceContractTests.cs`.
- Notifications: `CompactNotificationReminders.cs`.
- Settlement: `SettlementReceivablesRepository.cs`; migration C#/SQL
  `SharedInvoiceDepositOffsets`, resource trong `BHome.Infrastructure.csproj`
  và active schema `BHOME_24_TABLES.sql`.
- Tests billing: `FinalChargeReviewTests.cs`, `FinalFixedChargeTests.cs`,
  `FinalUtilityTests.cs`, `FinalFixedChargeRegressionTests.cs`.
- Tests migration: `SharedMainInitialPaymentMigrationTests.cs`,
  `Compact24MigrationBaselineTests.cs`.
- CI metadata: năm identity/ID trong `tests/backend/ci-test-inventory.json`.
- Tests payment/settlement: `ContractClosureTests.cs`, `DepositDeductionTests.cs`,
  `DepositRefundTests.cs`, `NotificationEventTests.cs`, `SettlementReceivableTests.cs`.
- Docs: `INVOICES.md`, `BILLING_AUTOMATION.md`,
  `BILLING_REFERENCE_CONTRACT_HANDOFF.md` và báo cáo này.

Lúc phát triển fixture mới có lỗi compile `GetDateOnly` (đổi sang deserialize
DateOnly), một lượt build bị testhost đang chạy khóa DLL, và assertion exception
âm ban đầu chưa xét `DbUpdateException` bọc PostgresException. Đã sửa và chạy
lại build cùng 21 regression PASS. Lượt full cũ bị dừng khi phát hiện giả định
kỳ RENT cũ; không sử dụng kết quả thiếu đó làm evidence PASS.

Evidence cuối: `.tools/thuy-rebuilt-ci/trx` và discovery/verifier log trong
`.tools/thuy-rebuilt-ci` (ignored); các kiểm tra frontend/deployment nằm trong
`.tools/thuy-*`. Helper local có exit code không ổn định qua Start-Process;
kết luận PASS lấy từ từng TRX và hai verifier chạy trực tiếp, không lấy exit code
của helper làm bằng chứng. Container PostgreSQL disposable đã dừng sau kiểm tra.
Chưa push hoặc chạy GitHub Actions cho bản sửa này; kết quả local không thay thế
kết quả CI trên PR.
