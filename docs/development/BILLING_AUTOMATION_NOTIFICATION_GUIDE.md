# JOB-09 / JOB-10 & Automated Notifications

Ngày kiểm chứng: **02/11/2026**. Branch `member/QHuy`. Chỉ local commits; không push/merge/deploy.

## 1. Nguồn và phạm vi

- Yêu cầu JOB-09/JOB-10 & Automated Notifications do Owner giao trong phiên này.
- SRS thực tế: `docs/reports/BHome_Report-3_Software Requirement Specification (2).docx`;
  BF-05A/B, BF-06A/B/C, UC-20/21/22/24/35/36, JOB-01/02/04/09/10,
  GBR-01/02/07/09/10/18. Traceability trước triển khai: [JOBS_TRACEABILITY.md](JOBS_TRACEABILITY.md).
- [BILLING_WORKFLOW_GUIDE.md](BILLING_WORKFLOW_GUIDE.md),
  [PAYMENT_WORKFLOW_GUIDE.md](PAYMENT_WORKFLOW_GUIDE.md),
  [INVOICE_ADJUSTMENT_WORKFLOW_GUIDE.md](INVOICE_ADJUSTMENT_WORKFLOW_GUIDE.md),
  [CONTRACT_RENEWAL_MOVEOUT_GUIDE.md](CONTRACT_RENEWAL_MOVEOUT_GUIDE.md).
- Quyết định Owner đã xác nhận thay DBR-06 Contract/kỳ bằng **một Invoice chung Room/kỳ**;
  ba Tenant có thể ký ba hợp đồng, cùng chịu trách nhiệm và giữ entitlement kỳ đã ở.
  Cấu hình tiền/ngày/ủy quyền do Owner lưu; không suy ra từ số người hoặc OCR proposal.

Git rules gốc không tìm thấy trong checkout; áp dụng AGENTS.md và chỉ dẫn branch/atomic commits
trực tiếp của Owner. Không thêm thư viện production. Không triển khai cadence JOB-01 chưa duyệt,
refund/credit/deposit policy hoặc provider thật khi chưa có specification/credentials.

## 2. Workflow đã nối

| Workflow                   | Backend / DB                              | Owner Web                     | Staff Mobile                   | Tenant Mobile                       | Demo thật                                                       |
| -------------------------- | ----------------------------------------- | ----------------------------- | ------------------------------ | ----------------------------------- | --------------------------------------------------------------- |
| Lịch tự động theo cơ sở/kỳ | Version + snapshot bất biến               | Cấu hình, lịch sử, preview    | Không có quyền sửa             | Không có quyền sửa                  | API/DB + Web                                                    |
| JOB-09                     | Room/type/kỳ unique; current assignment   | Theo dõi lỗi, phân công task  | Lọc và mở luồng ghi số hiện có | Không có quyền tác nghiệp           | API/MinIO; Web Mobile xem kết quả                               |
| JOB-10 Draft               | InvoiceService và snapshots hiện có       | Xem Draft, missing inputs     | Không có quyền tài chính       | Viewer entitlement hiện có          | API tạo Draft thiếu dữ liệu                                     |
| JOB-10 Final               | Opt-in Owner, revalidate, immutable Final | Lịch, kết quả, manual hiện có | Không có quyền phát hành       | Xem Final chung của phòng           | API/worker + cả ba Tenant mở UI                                 |
| Inbox và nguồn sự kiện     | Persistent + recipient/event unique       | Bell, inbox, read, deep links | Inbox Task, quyền hiện tại     | Invoice/Payment/Adjustment/Contract | Web/Mobile web + DB                                             |
| JOB-04                     | Lease/retry/attempts bền vững             | Theo dõi delivery             | Inbox vẫn hoạt động            | Inbox vẫn hoạt động                 | Provider **Unconfigured**; retry provider bằng integration test |

Ghi số và upload ảnh tổng hợp đã thực hiện qua API thật. Smoke Mobile web mở task đã xác nhận;
không coi đây là bằng chứng camera/native notification trên iPhone/Android thật.

## 3. Scheduler, queue và khóa nghiệp vụ

Tái sử dụng `ContractExpiryScheduler`, `PostgresJobQueue`, `PostgresJobWorker` và JOB-02.
Scheduler nhận thêm `IJobScheduleContributor`; không tạo scheduler/queue thứ hai.
`Jobs:Enabled` bật/tắt cả scheduler/worker, `Jobs:PollSeconds` mặc định 5, hợp lệ 1–300.
JOB-02 vẫn enqueue theo ngày nghiệp vụ; DB unique key đảm bảo restart không tạo hiệu ứng trùng.

`BillingAutomationScheduling` kiểm tra tháng hiện tại và hai tháng trước, tương ứng giới hạn
month-offset 0–2 của calendar hiện có. Ngày nghiệp vụ dùng `BillingAutomationDates.BusinessDate`
ở `Asia/Ho_Chi_Minh`; timestamps lưu UTC. Ngày 29–31 co về cuối tháng ngắn bằng InvoiceMath.
Không tự tạo lịch nếu Location chưa có cấu hình.

| Mục              | Khóa / hành vi                                                                  |
| ---------------- | ------------------------------------------------------------------------------- |
| Plan             | Location + Version; chọn EffectiveFrom lớn nhất ≤ kỳ, sau đó Version lớn nhất   |
| Queue billing    | Handler + plan/period/phase/UTC-minute; enqueue ON CONFLICT DO NOTHING          |
| Execution        | PlanId + BillingPeriod + Phase; lease 2 phút, lock token, append-only attempts  |
| Meter task       | Room + UtilityType + BillingPeriod, dùng chung manual/auto, kể cả task đã hủy   |
| Invoice          | Room + BillingPeriod, dùng chung manual/auto và financial locks hiện có         |
| Issuance event   | InvoiceId unique, commit cùng transaction chuyển Final                          |
| In-app           | RecipientUserId + EventKey unique; publication marker và inbox cùng transaction |
| External request | `notification/{notificationId:N}/external`, ổn định qua retry                   |

Worker chỉ claim `Name = ANY(registered handler names)`, dùng `FOR UPDATE SKIP LOCKED` và lease
2 phút; timeout xử lý 60 giây; tối đa 4 lần, backoff `2^attempt * 5 + jitter(0..4)` giây.
Job của module chưa có handler giữ Pending, không tiêu retry budget. Khi nâng cấp phải dừng
binary cũ chưa có bộ lọc này trước khi dùng chung database.

Handler thực tế: `billing-meter`, `billing-draft`, `billing-final`, `notification-publish`,
`notification-delivery`; giữ `contract-expiry`. Completed execution được scheduler bỏ qua.
PendingInputs được xét lại mỗi minute; đây là thiếu dữ liệu nghiệp vụ, không phải lỗi provider.
Failed execution dừng tự schedule sau 4 lần xử lý; Dev Run Now vẫn đi qua handler/service để
operator xử lý lại sau khi sửa nguyên nhân. Số lần execution khác số lần claim của từng queue row.

### JOB-09

Chỉ Room đang Occupied và có tenancy đã kích hoạt bao phủ ngày đọc được cấu hình. Mỗi loại điện/
nước phải có đúng active meter phù hợp ngày đó. Không giao tùy tiện: chỉ chọn một Staff assignment
hiện hành, tài khoản/role hợp lệ. Thiếu hoặc mơ hồ assignment giữ task chưa phân công và báo Owner.
Staff chỉ thấy generated task được giao cho mình khi vẫn phụ trách Location. Owner có thể gán lại
bằng expectedVersion. Thay meter/hủy task trong kỳ giữ exception cần review, không sinh consumption mới.

### JOB-10

Draft gọi InvoiceService.Generate với Owner delegation lấy từ plan đã lưu. Một eligible contract
không mơ hồ có thể làm đại diện; nhiều eligible contracts yêu cầu Owner chọn rõ Room/kỳ.
Draft hiện có không bị job ghi đè; Final và approved corrections được giữ. Giá/confirmed readings,
viewer snapshots và cách làm tròn dùng BH-21. OCR chưa được xác nhận không tính tiền.

Final chỉ chạy sau ngày cấu hình và `AuthorizeAutomaticFinalization=true`. Backend kiểm tra lại
Owner active/role, plan còn áp dụng, calendar, confirmed sources, pending adjustment và correction
fingerprints dưới financial locks. Draft không correction có thể refresh từ nguồn đã xác nhận;
nguồn không đổi không làm tăng version hoặc đổi line IDs. Thiếu/conflict giữ Draft/PendingInputs.
Manual Final và scheduled Final có chung uniqueness/transaction; không sửa lại Final gốc.

## 4. Inbox, audience và quyền

BH-19 chưa có general inbox consumer trong checkout lúc bắt đầu. `OperationalTaskNotifications`
có Task FK bắt buộc nên được giữ làm nguồn, không biến thành bảng chung bằng dữ liệu giả.
Module `Notifications` mới dùng nguồn event hiện có, `NotificationPublication` dedup và common inbox.
Đánh dấu đọc tương thích hai chiều với legacy Task notifications; không bỏ route cũ.

| Nguồn                               | Người nhận                                                              | Target / key                                           |
| ----------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------ |
| InvoiceIssuedEvents                 | Owner của invoice/event + InvoiceRecipients                             | Invoice; `invoice:{invoiceId}`                         |
| PaymentConfirmedEvents + allocation | Owner xác minh/invoice + InvoiceRecipients                              | Invoice; `payment:{allocationId}`                      |
| Adjustment requested                | Owner của invoice                                                       | Adjustment; `adjustment:{requestId}:{eventName}`       |
| Adjustment decided                  | Requester; Approved thêm thông báo balance an toàn cho viewer khác      | Requester → Adjustment; viewer khác → Invoice          |
| ContractExpiryNotices               | Owner/Tenant hợp lệ từ JOB-02                                           | Contract; `contract-expiry:{noticeId}`                 |
| OperationalTaskNotifications        | Recipient Owner hoặc Staff còn assignment, generated task đúng assignee | MeterTask / OperationalTask; `task:{sourceId}`         |
| Billing PendingInputs               | Owner đã cấp quyền trong plan                                           | AutomationExecution; `billing-exception:{executionId}` |

Consumer xử lý batch tối đa 25/source/lần, enqueue theo UTC minute. Inbox UI polling 30 giây/
refresh; có thể có độ trễ batch khi backlog. Không thêm realtime subsystem khác.
Thông báo không chứa CCCD, bank reference, private reason/evidence hay thông tin payer riêng tư.
Không suy ra Paid từ QR, báo chuyển tiền hoặc notification. Allocation/financial ledger là nguồn thật.

Mỗi read/unread/target lookup theo recipient và role. Staff cần current Location assignment.
Target lookup kiểm tra lại entitlement của Invoice, requester của Adjustment, own Contract hoặc task.
Client chỉ dùng loại object đã biết để đi đến route nội bộ; API hồ sơ vẫn kiểm tra quyền lần nữa.
Owner Web giữ query/hash khi khôi phục phiên để deep link không mất invoiceId hoặc kỳ.

## 5. JOB-04 external delivery

Adapter mặc định chưa cấu hình; không có fake production push/email success.
`NotificationDelivery:Enabled=false` mặc định. Khi cấu hình adapter thật, adapter phải khai báo
`IsConfigured`, `SupportsIdempotency` đúng khả năng và trả receipt hợp lệ.

Options: MaxAttempts=4 (1–10); InitialRetrySeconds=30; MaximumRetrySeconds=3600;
RequestTimeoutSeconds=15; LeaseSeconds=90. Validate trước startup. Claim/complete dưới lock token,
gọi provider ngoài DB transaction; history attempt append-only. Inbox/read/paid ledger không rollback
khi lỗi gửi ngoài. Retry exponential bounded nếu provider hỗ trợ idempotency; không hỗ trợ thì lỗi/
lease không rõ kết quả chuyển PendingReview, không tự gửi lại. Hết lần → Failed; mất scope → Suppressed.
Unconfigured không tạo delivery attempt hoặc receipt giả. Owner thấy danh sách redacted và retry time.

## 6. API và schema

Chi tiết DTO/quyền: [BILLING_AUTOMATION.md](../api/BILLING_AUTOMATION.md),
[NOTIFICATIONS.md](../api/NOTIFICATIONS.md). Tất cả dưới `/api/v1`.

| API                                                                    | Quyền / mục đích                                                                        |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| PUT billing-automation                                                 | Owner lưu immutable plan, expected plan/calendar versions                               |
| GET billing-automation/{locationId}?period=                            | Owner lấy plan áp dụng                                                                  |
| GET billing-automation/{locationId}/history                            | Owner xem version history                                                               |
| GET billing-automation/preview?locationId=&period=                     | Ngày VN, phase dates, eligibility sơ bộ, dev/worker flags                               |
| GET billing-automation/executions, attempts, queue?locationId=&period= | Owner kết quả, 100 attempts / 30 queue rows gần nhất; không queue payload               |
| POST billing-automation/run-now                                        | Owner, Development/Testing; `{locationId,billingPeriod,phase}`; không force/bypass date |
| GET/PUT billing-automation/representative                              | Owner chọn Contract đại diện Room/kỳ trước khi có invoice                               |
| POST billing-automation/meter-tasks/{id}/assignment                    | Owner, `{staffUserId,expectedVersion}`                                                  |
| GET notifications?page=&pageSize=&category=&unread=                    | Own inbox; categories Contract/Invoice/Payment/Adjustment/Task                          |
| GET notifications/unread-count                                         | Own unread count                                                                        |
| POST notifications/{id}/read, notifications/read-all                   | Own read state, idempotent timestamp                                                    |
| GET notifications/{id}/target                                          | Reauthorize related object; unavailable trả 404                                         |
| POST notifications/process-events                                      | Owner, Development/Testing; gọi common consumer                                         |
| GET notifications/delivery-status?locationId=&state=&page=             | Owner, redacted retry/failure monitoring                                                |
| GET capture/meter-tasks?locationId=&roomId=&dueDate=&status=&page=     | Existing array API; server filters trước giới hạn 100/trang; dueDate theo ngày VN       |

Calendar tài chính giữ `/billing-schedules`; không tạo nguồn giá thứ hai. Capture DTO bổ sung
dueAt/assignment/plan/version/locationId/roomId. Các API hợp đồng, invoice, payment, adjustment nguồn giữ nguyên.

Migrations đã apply và kiểm tra trên PostgreSQL demo/test:

1. `20261102010649_BillingAutomationPlans`
2. `20261102011436_BillingMeterAutomation`
3. `20261102012102_BillingInvoiceAutomation`
4. `20261102012619_ScheduledInvoiceIssuance`
5. `20261102013328_PersistentNotificationInbox`
6. `20261102015157_NotificationDeliveryRetries`

Có FK/unique/index, immutable/append-only triggers và rollback guards phù hợp. Migration meter
dừng khi dữ liệu cũ trùng; không xóa lịch sử để ép apply. Không sửa các migration BH-40 đã có.

## 7. Màn hình

- Owner `/billing-automation`: cơ sở/kỳ, version/effective period, meter schedule, explicit Final
  authorization, preview, execution/attempt/queue, missing inputs, delivery status, chọn đại diện.
  `/pricing` tái sử dụng form lịch Draft/Final/Due và giá hiện có. `/meters?taskId=` xem task/đổi assignee.
- Owner `/notifications`: bell, category/read filters, paging, read-one/all; deep links Invoice,
  Adjustment, Contract, MeterTask, OperationalTask và AutomationExecution. OperationalTask Web đọc API thật;
  các thao tác vận hành đầy đủ hiện có vẫn trên Mobile.
- Staff workspace `meter-reading`: filter cơ sở/phòng/hạn/status, paging, deadline, mở `/meter?taskId=`
  cho camera/OCR/manual confirmation hiện có và xem confirmed result. Inbox chỉ quyền vận hành.
- Tenant workspace `notifications`: own inbox, link invoice/own adjustment/contract. Invoice của phòng
  dùng entitlement snapshot, không tính lại tài chính trên frontend. Owner Mobile target quản lý Web-only
  hiển thị hướng dẫn mở Owner Web, không mở rộng quyền Staff.

## 8. Chạy demo

Chỉ Development/Testing, PostgreSQL loopback database **bhome_contract_demo**, MinIO loopback bucket
**contract-demo**. Namespace mới `fa090000-...`, Location `BHOME AUTOMATION DEMO`. Không reset DB,
đổi tài khoản hoặc sửa namespaces BH-16/21/25/40/41. Signing/statement đều synthetic, không tiền thật.
Credentials ở `.tools/contract-demo/runtime.json`, ignored; không đưa vào source/screenshots/log.

Nếu chưa có infrastructure/accounts, chạy `scripts/Initialize-ContractDemo.ps1` trước.
Dừng các worker/binary demo cũ của chính phiên trước trên cùng database trước khi chạy setup.
Từ repo root PowerShell:

```powershell
. ./scripts/Use-LocalTools.ps1
. ./scripts/ContractDemoEnvironment.ps1
$null = Import-ContractDemoEnvironment
dotnet build tools/BHome.LocalDevelopment --artifacts-path .tools/jobs-build
dotnet .tools/jobs-build/bin/BHome.LocalDevelopment/debug/BHome.LocalDevelopment.dll seed-billing-automation-demo
dotnet build src/backend/BHome.Api --artifacts-path .tools/jobs-run
```

Mở terminal API bằng launcher mới, tạm dừng scheduler trong lúc tạo fixture retry:

```powershell
./scripts/Start-BillingAutomationDemo.ps1 -Component Api -PauseWorkerForSetup
```

Ở terminal setup (import environment lại trước mỗi CLI vì CLI xóa password khỏi process của nó):

```powershell
node scripts/Seed-BillingAutomationDemoWorkflow.cjs
$null = Import-ContractDemoEnvironment
dotnet .tools/jobs-build/bin/BHome.LocalDevelopment/debug/BHome.LocalDevelopment.dll demo-billing-retry
node scripts/Seed-BillingAutomationDemoWorkflow.cjs --verify
```

CLI retry giữ row lock Room AUTO103-RETRY trong một connection riêng, đặt command timeout 1 giây
cho scoped handler, ghi lỗi PostgreSQL thật rồi nhả lock và gọi lại **registered billing-draft**.
Không insert kết quả Failed/Completed giả, không thay clock toàn ứng dụng. Chạy lại sau khi đã có
retry invoice giữ nguyên history. Manifest khác ngày nghiệp vụ sẽ dừng, không tự reset kỳ cũ.

Sau đó Ctrl+C API setup và mở lại launcher **không** `-PauseWorkerForSetup`, cùng các clients:

```powershell
./scripts/Start-BillingAutomationDemo.ps1 -Component Api
./scripts/Start-BillingAutomationDemo.ps1 -Component OwnerWeb
./scripts/Start-BillingAutomationDemo.ps1 -Component MobileWeb
```

Mỗi lệnh server chạy trong một terminal. Mặc định API 5540/7540, Web 5517, Mobile 5581.
Launcher có tham số ApiPort/HttpsPort/WebPort/MobilePort. Phiên kiểm chứng dùng 5544/7544/5520/5584.
Nếu đổi port, đặt `BHOME_AUTOMATION_DEMO_API`, `BHOME_AUTOMATION_DEMO_WEB`,
`BHOME_AUTOMATION_DEMO_MOBILE` tương ứng khi chạy scripts Node.

```powershell
node scripts/Test-BillingAutomationDemo.cjs
./scripts/Test-BillingAutomationDemoDb.ps1
```

Browser smoke cần Playwright local và Chrome đã cài, như scripts smoke BH-40 hiện có; không là
dependency production. Mobile web kiểm tra ở 430×932, không reload document sau đăng nhập vì session
web của Mobile ở bộ nhớ. Chứng chỉ HTTPS localhost phải được tin cậy trên thiết bị khi test thủ công.
Browser harness dùng ignoreHTTPSErrors trong context test riêng, không thay cấu hình bảo mật app.

## 9. Bằng chứng demo A–F

Kỳ 11/2026, business date 02/11/2026, API/DB/MinIO thật:

| Demo           | Kết quả thực hiện                                                                                                                                                                |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A JOB-09       | AUTO101-SHARED có 2 tasks cho 3 contracts, Staff nhận thông báo, API upload ảnh synthetic và human-confirm; Mobile mở đúng confirmed task                                        |
| B Draft        | Tạo Draft thật trước khi confirm; missing confirmed electricity/water được quan sát và lưu manifest                                                                              |
| C Final        | AUTO101 đủ dữ liệu → Final **3.117.500 VND**; AUTO102 thiếu water meter/chỉ số và AUTO103 retry thiếu readings vẫn Draft; future plan chưa tới ngày không chạy                   |
| D Payment      | Statement sai reference giữ history/reject; statement synthetic khớp reference được Owner verify/allocate một lần; A/B/C Paid, outstanding=0, nhận Payment notification          |
| E Adjustment   | Approved giảm 1.000 VND và một Rejected; requester nhận outcome, viewer khác chỉ thông báo balance; Final gốc vẫn 3.117.500; excess 1.000 PendingReview, không giả refund/credit |
| F Replay/retry | API lặp/song song Meter/Draft/Final và reseed; real PostgreSQL timeout rồi handler retry; constraint/DB proof không task/invoice/inbox trùng                                     |

DB proof snapshot: **5 periodic tasks, 3 invoices, 3 viewers của shared Final, 1 verified allocation,
1 InvoiceIssuedEvent, 1 PaymentConfirmedEvent, 2 Failed execution attempts, 0 duplicate keys**.
Read/unread thực sự cùng tồn tại; delivery state chỉ Unconfigured. Worker có các lượt billing và
notification-publish Completed thật. Trong lúc kiểm chứng đã phát hiện binary BH-40 cũ còn claim queue;
đã dừng đúng tiến trình demo cũ và thêm handler-name filtering. Các queue Failed lịch sử do binary cũ
không có handler được giữ để audit, không reset thành success. Đánh giá worker hiện tại dựa thêm log
startup mới và các lượt Completed sau khi binary cũ dừng.

Artifacts ignored ở `.tools/contract-demo/`: `automation-fixture.json`, `automation-ui-proof.json`,
`automation-db-proof.json`, `automation-owner-worker.png`, `automation-owner-exceptions.png`,
`automation-owner-invoice.png`, `automation-tenant1/2/3-inbox.png`,
`automation-tenant1/2/3-invoice.png`, `automation-staff-inbox.png`, `automation-staff-confirmed.png`.
Ảnh Owner exception, Tenant inbox và Staff confirmed result đã được mở kiểm tra trực quan.

## 10. Verification đã chạy

| Kiểm tra                                          | Kết quả / log ignored                                                          |
| ------------------------------------------------- | ------------------------------------------------------------------------------ |
| API build                                         | PASS, 0 warning/error; `.tools/jobs-api-build.log`                             |
| PostgreSQL/MinIO integration toàn bộ              | PASS **396/396**; `.tools/jobs-integration-tests.log`                          |
| Worker routing/lease và foundation sau sửa worker | PASS **6/6**; `.tools/jobs-worker-foundation-tests.log`                        |
| Application unit                                  | PASS **177/177**; `.tools/jobs-application-tests.log`                          |
| Domain unit                                       | PASS **83/83**; `.tools/jobs-domain-tests.log`                                 |
| Owner Web tests                                   | PASS **94/94**; `.tools/jobs-owner-tests.log`                                  |
| Owner Web build/typecheck/lint                    | PASS; `.tools/jobs-owner-build.log`, commands npm scripts                      |
| Mobile tests                                      | PASS **243/243**; `.tools/jobs-mobile-tests.log`                               |
| Mobile typecheck/lint                             | PASS, npm scripts                                                              |
| iOS và Android Expo export                        | PASS cả hai; `.tools/jobs-mobile-export.log`                                   |
| API seed/reseed/replay                            | PASS; `.tools/jobs-demo-api.log`, jobs-demo-reseed.log, jobs-demo-verify.log   |
| Real browser smoke                                | PASS Owner + Tenant A/B/C + Staff; `.tools/jobs-demo-ui.log`, zero page errors |
| Read-only DB proof                                | PASS; `.tools/jobs-demo-db.log`                                                |
| Native camera/push, real email delivery           | NOT RUN / provider chưa cấu hình                                               |
| Formal ST/AT, performance/coverage targets        | NOT RUN; Tester chịu trách nhiệm, không suy ra tỷ lệ từ smoke                  |

Các trường hợp được kiểm tra: wrong role/current assignment, IDOR/cross-Tenant, invalid/stale
configuration, effective versions, confirmed-vs-OCR, meter replacement, unassigned tasks, manual/auto
races, pending/approved correction, duplicate events, payment replay, private adjustment details,
UTC17:00/new year/leap boundary, expired queue/business leases, unsupported handler, provider failures,
bounded retries và paid ledger không đổi khi delivery lỗi. Crash recovery integration tạo persisted
expired-lease precondition rồi chạy worker thật; không tuyên bố đã kill production worker/native device.

Các lần kiểm tra ban đầu có lỗi setup/harness đã sửa: thiếu assets restore khi dùng artifact directory
mới; snapshot CalendarKey không dùng ID do protected setter; query mất khi khôi phục Owner session;
browser locator trúng màn Mobile đã ẩn; script demo dùng sai payment reference/DTO đã được sửa qua API
và giữ lịch sử transaction bị từ chối. Không disable test hay sửa ledger để làm xanh kết quả.

Lệnh kiểm chứng chính (repo root trừ khi ghi khác):

```powershell
dotnet build src/backend/BHome.Api --artifacts-path .tools/jobs-build
dotnet test tests/backend/BHome.IntegrationTests --artifacts-path .tools/jobs-build
dotnet test tests/backend/BHome.Application.UnitTests --artifacts-path .tools/jobs-build
dotnet test tests/backend/BHome.Domain.UnitTests --artifacts-path .tools/jobs-build
npm.cmd --prefix src/owner-web run build
npm.cmd --prefix src/owner-web run lint
npm.cmd --prefix src/mobile run typecheck
npm.cmd --prefix src/mobile run lint
./scripts/Export-ContractDemoMobile.ps1
```

Owner tests thực chạy Node 22 local, `vitest run --maxWorkers 1` trong `src/owner-web`; Mobile
`vitest run --config vitest.config.ts` trong `src/mobile`. Export tạo bundle, không chứng minh native
camera/push hoặc việc upload lên store. Không có số coverage/performance giả.

## 11. Local commits và ownership

| Hash    | Commit                                                         | Description                                                         |
| ------- | -------------------------------------------------------------- | ------------------------------------------------------------------- |
| 79a519f | feat(jobs): configure billing automation schedules             | Immutable effective plans, calendar validation, explicit delegation |
| 40ca7a7 | feat(meter): automate periodic reading tasks                   | Existing scheduler/queue, unique room/type/kỳ, Staff scope          |
| b8a741b | feat(invoice): automate draft invoice generation               | Existing service, representative selection, snapshots/corrections   |
| 51ef519 | feat(invoice): automate scheduled finalization                 | Revalidation, immutable issuance, manual/auto race                  |
| 784cc5b | feat(notification): add persistent notification inbox          | Recipient isolation, read states, authorized targets                |
| fa29176 | feat(notification): publish billing and payment events         | Committed sources, audiences, event dedup                           |
| e4526a9 | feat(notification): handle delivery retries                    | Leases, bounded retry, provider ambiguity, redacted monitoring      |
| b004e6e | feat(jobs): connect owner automation dashboard                 | Settings/history, exceptions, safe Dev Run Now                      |
| 0cb6811 | feat(notification): connect web and mobile inbox               | Real API inbox/bells, Staff filters, target routes                  |
| cf6ff68 | fix(jobs): expose scoped worker retry monitoring               | Actual queue retry times, worker flag, lease recovery test          |
| f654c80 | fix(web): retain notification deep links during authentication | Preserve query/hash during session restoration                      |
| e875051 | chore(demo): add billing automation scenarios                  | Isolated fixtures, real API/DB/browser scripts, timeout/retry       |
| fc6a087 | fix(jobs): claim only registered background handlers           | Unsupported jobs remain Pending without losing attempts             |

Mỗi commit trên có 3 dòng English body thực tế; xem `git show -s --format=full <hash>`.
Commit guide này được tạo sau bảng; hash cuối cùng được báo trong kết quả bàn giao.
Shared changes: DI, scheduler contributor, worker routing, EF schema, common client contracts và
navigation cần team review cùng BH-19 owner. Không ghi đè module nguồn, xóa legacy notification API
hoặc tạo external integration giả. Migration vẫn cần review dữ liệu trùng trước khi apply ngoài demo.

## 12. Phần còn lại và bước tiếp theo

- **Implemented / Demo Ready:** JOB-09, JOB-10, common inbox, committed-event consumers, JOB-04
  durable retry foundation, Owner settings/monitoring, Web/Mobile inbox, scoped meter filters và demo scripts.
- **Awaiting Tester:** formal ST/AT, native Android/iOS, camera permission/upload failure trên thiết bị,
  timezone acceptance, scale/coverage/performance, upgrade/rollback trên bản sao DB của team.
- **Provider Blocked:** push/email adapter thật và receipt/delivery proof; giữ Unconfigured. External
  contract signing của demo vẫn Simulated theo guide BH-40, không phải bằng chứng ký pháp lý thật.
- **Business Decision Pending:** cadence/window JOB-01, refund/credit/deposit và các OQ tài chính chưa
  được duyệt. Không chặn luồng room invoice/Owner authorization đã được quyết định.
- **Not Implemented trong task này:** JOB-01 overdue reminder engine mới, JOB-03 bank-provider retry,
  provider push/email thật, workflow Holding còn thiếu. Không thay trạng thái payment từ client.

Bước tiếp theo ưu tiên **BH-16 Holding Contract**: code hiện còn
`UnconfiguredContractHoldingLedger` trong `ViettelMySignContractAdapter.cs`; cần nối giữ chỗ, verified
holding deposit, expiry JOB-05 và áp dụng deposit vào Main Contract theo yêu cầu được duyệt. Sau đó
triển khai JOB-01/JOB-03 khi có cadence/provider specification, dùng queue/inbox foundation hiện tại.
