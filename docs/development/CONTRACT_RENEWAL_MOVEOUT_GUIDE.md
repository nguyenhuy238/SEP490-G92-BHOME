# BH-40 — Gia hạn, chấm dứt và quyết toán trả phòng

Ngày kiểm tra: 02/11/2026. Branch `member/QHuy`. Chỉ commit local; không push, merge hoặc deploy.

## Nguồn và phạm vi

Yêu cầu BH-40; SRS UC-16, UC-19, BF-04A, JOB-02; GBR-01/02/04/09/10/13/18.
Xem [traceability](BH40_TRACEABILITY.md) và [API lifecycle](../api/CONTRACT_LIFECYCLE.md).
Quyết định Owner trong phiên làm việc có ưu tiên: nhiều người có hợp đồng riêng trong cùng
phòng; một hóa đơn chung/phòng/kỳ; mọi người trong kỳ được xem và cùng chịu trách nhiệm;
giữ quyền xem kỳ đã ở. Gia đình có thể dùng một hợp đồng với người đại diện.

Tái sử dụng Contract/signing/preview/handover, Capture confirmed readings, Room Invoice BH-21,
verified Payment allocations BH-25 và financial projection/adjustments BH-41. Không ghi lại
Final Invoice, không ghi đè handover nhận phòng và không tạo bản sao Payment ledger.

| Bước             | Backend                  | Owner Web        | Tenant Mobile        | Staff Mobile           | DB                      | Demo                  |
| ---------------- | ------------------------ | ---------------- | -------------------- | ---------------------- | ----------------------- | --------------------- |
| Renewal          | Guards, ký, activation   | Tạo/xem versions | Ký/xem versions      | Chuẩn bị trong scope   | Chain, signed history   | Pending + Active      |
| Termination/lịch | Role/location, version   | Duyệt/phân công  | Gửi/xem yêu cầu      | Lịch được giao         | MoveOut/history         | Đã chạy               |
| Inspection       | Baseline/Final evidence  | So sánh/review   | Xem biên bản         | Checklist/readings/ảnh | Immutable versions      | API + browser         |
| Settlement       | Projection/hash/guards   | Review số liệu   | Xem nghĩa vụ         | Không quyền tài chính  | Review snapshot         | Resolved + Pending    |
| Closure          | Re-read ledger/Room lock | Hoàn tất         | Lịch sử/ngày thực tế | Trạng thái nghiệp vụ   | ActualEndDate/occupancy | Shared + Last         |
| JOB-02           | Queue/scheduler/handler  | Nhắc hiện hành   | Nhắc của mình        | Không feed tài chính   | Unique notices          | Worker + handler + UI |

## Luồng và quyền

1. Owner hoặc Staff trong Location tạo phiên bản gia hạn từ Active Contract. Giữ liên kết
   `PreviousContractId`, người ở và cọc gốc; sửa điều khoản mới trên phiên bản mới. Owner và
   Tenant ký theo signing mode hiện có. Owner kích hoạt sau khi đủ chữ ký, cọc và ngày hiệu lực.
   Parent chuyển Superseded trong cùng transaction. Gia hạn tương lai vẫn PendingActivation.
2. Tenant của hợp đồng gửi yêu cầu chấm dứt trước hạn; Owner tạo yêu cầu hết hạn hoặc duyệt
   yêu cầu. Duyệt không đóng hợp đồng và không giải phóng phòng.
3. Owner đặt lịch/chọn Staff đang được phân công Location. Để trống là chưa phân công;
   Staff đặt lịch không truyền assignee sẽ nhận việc cho chính mình. Staff Mobile xem lịch
   được giao; mọi thao tác vẫn kiểm tra assignment hiện tại trên backend.
4. Owner tạo tác vụ Final điện/nước đúng Contract. Staff xác nhận chỉ số và ảnh bằng Capture,
   chọn các reading này trên biên bản trả phòng, ghi hiện trạng phòng/chìa khóa/từng tài sản và
   chọn 1–5 ảnh mới. Đối chiếu từ snapshot bàn giao đã Confirmed của Contract hoặc ancestor
   gia hạn, không lấy condition tài sản hiện tại thay cho baseline. Ảnh CCCD không dùng làm
   bằng chứng. Mỗi phiên bản inspection giữ nguyên baseline, observed và evidence.
5. Owner xác nhận biên bản hoặc yêu cầu kiểm tra lại có lý do. Kiểm tra lại giữ lần cũ.
   Checkbox không phát sinh phí riêng chỉ được chọn sau khi đối chiếu thực tế; mặc định bỏ chọn.
6. Owner/Tenant đọc summary từ các nguồn tài chính thật. Owner đọc số liệu/blockers và lưu
   review có lý do cùng reference của snapshot đang xem. Review Pending cũng được lưu lịch sử.
   Chỉ nguồn đã resolved mới cho Settled; Staff không gọi được endpoint tài chính này.
7. Owner hoàn tất với ngày kết thúc thực tế trùng ngày inspection và không ở tương lai.
   Backend khóa Room, đọc lại ledger/reference và kiểm tra trạng thái. Chỉ Contract/người ở
   đang rời đi kết thúc. Còn Active Contract khác → Occupied; người cuối cùng mới Available
   khi Room hiện Occupied. Giữ OnHold/Unavailable. Ngày hết hạn ký ban đầu được giữ nguyên;
   `actualEndDate` phản ánh ngày kết thúc thực tế trên Web/Mobile.

Tenant khác nhận 404 khi truy cập Contract/inspection; Staff mất assignment không đọc/ghi
được Location đó. Tenant đã rời phòng vẫn xem Contract, inspection và Invoice/payment có
recipient snapshot của mình. Không suy quyền tài chính từ việc chỉ cùng Room hiện tại.

## Quyết toán và phần còn chờ chính sách

Nguồn nghĩa vụ mỗi hóa đơn từ BH-41:

```text
effective payable = original issued amount + approved adjustments
outstanding = max(0, effective payable - verified allocations)
potential excess = max(0, verified allocations - effective payable)
```

Các tổng dùng decimal và chính sách VND hiện có. UI hiển thị điều chỉnh giảm với dấu âm.
Cọc bảo đảm chỉ lấy DepositVerification của root Contract trong renewal chain, không cộng
lại ở mỗi phiên bản. Cọc giữ chỗ đã áp dụng hiển thị riêng; không tự chuyển thành khoản hoàn.
Hóa đơn chung là nguồn nghĩa vụ của phòng, không gán toàn bộ nợ thành nợ cá nhân hoặc tự
trừ vào cọc của A. Summary giữ original, adjustments, paid, outstanding và excess theo từng kỳ.

Hiện chỉ resolved được nhánh không có cọc/holding cần xử lý, đầy đủ hóa đơn Final của mọi kỳ
từ bắt đầu chain đến ngày inspection, mọi khoản đã xác minh thanh toán, không có adjustment,
excess hoặc bank review đang chờ, Owner đã xác nhận inspection và không có phí riêng chưa xử lý.
Chỉ số Final phải được bao phủ bởi reading đã tính trong hóa đơn của kỳ cuối, cùng đồng hồ,
ngày và giá trị. Chỉ số mới chưa được tính tiền giữ Pending, không tự ước lượng hoặc thu trùng.

Các trường chưa xác định trả null với blocker; không dùng số 0 để giả hoàn cọc thành công.
`contractSpecificOutstanding` chỉ xác nhận 0 ở nhánh đã resolved; nợ theo hóa đơn vẫn hiển thị
riêng. Không tự chia nợ chung, tính damage fee, khấu trừ, tạo Tenant Credit, refund hoặc bút toán
hoàn tiền. Cọc dương, holding, phí chưa được duyệt hoặc nợ chung chưa giải quyết sẽ chặn Complete.

Review lưu FinancialSnapshot bất biến và hash của các nguồn/revisions. Complete đọc lại dưới
Room lock dùng chung payment/adjustment; nguồn đổi sau review phải được xem xét lại. Các lệnh
có idempotency key, lịch sử có unique version, bank/payment uniqueness hiện có được giữ nguyên.
Không có allocation, deduction hoặc refund phát sinh từ việc đọc/lưu settlement review.

## Database và API

| Migration                                    | Thay đổi                                                                          |
| -------------------------------------------- | --------------------------------------------------------------------------------- |
| `20261102000816_MoveOutAssignments`          | Assignee, concurrency version, ContractMoveOutHistory append-only                 |
| `20261102000942_FinalInspectionSnapshots`    | ContractFinalInspections, immutable snapshots, một Owner decision/phiên bản       |
| `20261102001234_ContractSettlementSnapshots` | FinancialSnapshot bất biến, NoAdditionalCharges                                   |
| `20261102002406_ContractExpiryNotices`       | Nhắc hết hạn bền vững, unique Contract/enddate/stage/recipient, index quét expiry |

Migration Down từ chối xóa các lịch sử liên quan đã phát sinh. Không sửa migration cũ đã áp dụng.

Các đường dẫn dưới `/api/v1/contracts`; contracts/location/tenant được kiểm tra server:

| API                                        | Quyền / nội dung                                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------------------- |
| GET `{id}/versions`                        | Owner, own Tenant, assigned Staff; Staff không nhận rent/terms trong chain projection |
| GET `move-out-assignments`                 | Staff, tối đa 100 lịch của mình tại Location hiện phụ trách                           |
| GET `{id}/move-out/history`                | Owner, own Tenant, assigned Staff; tối đa 100 events                                  |
| GET `{id}/move-out/inspection-preparation` | Owner/assigned Staff; confirmed baseline và Final readings hôm nay                    |
| GET `{id}/move-out/inspections`            | Owner/own Tenant/assigned Staff; tối đa 100 phiên bản                                 |
| POST `{id}/move-out/inspection-review`     | Owner; version, confirmed, reason, noAdditionalCharges                                |
| GET `{id}/move-out/settlement-summary`     | Owner/own Tenant; Staff 403                                                           |
| GET `expiry-reminders`                     | Owner/own Tenant; tối đa 100 nhắc hiện hành; Staff 403                                |

Schedule bổ sung `staffUserId?`, `expectedVersion?`. Inspection bổ sung assets, roomCondition,
keysAndAccess, expectedVersion. Settlement bổ sung expectedReference, bắt buộc khi resolved.
Contract response bổ sung actualEndDate từ dữ liệu kết thúc hiện có. Giữ các endpoint
request/approve/evidence/complete, signing và settlement-history; không có endpoint bỏ qua guard.
Client lấy Staff và assignment từ các API hiện có, không hardcode userId/quyền.

## JOB-02

`contract-expiry` đăng ký trong worker PostgreSQL hiện có. Khi `Jobs:Enabled=true`, scheduler
enqueue lúc khởi động và mỗi ngày theo Asia/Ho_Chi_Minh; key là business date. Worker dùng lease,
bounded retry và trạng thái Failed hiện có. Handler quét Active Contracts theo batch, re-read
dưới Room lock; một notice/Contract/enddate/stage/recipient. Upcoming30 cho 0–30 ngày trước hạn,
Expired khi ngày hiện tại vượt EndDate. Không auto-close, không tự chuyển Room Available.

Owner Web và Tenant Mobile đọc persistent notices. Notices cũ được giữ nhưng feed bỏ Contract
đã Superseded/Terminated hoặc đổi EndDate và chỉ hiện stage hiện hành. External push/email
delivery consumer chưa triển khai; không coi notice persisted là đã gửi qua provider.

## Demo và thao tác

Chỉ `bhome_contract_demo` PostgreSQL loopback:56432 và MinIO loopback:59000 bucket contract-demo,
Development/Testing + simulated signing. Namespace `fa400000…`, Location `BHOME LIFECYCLE DEMO`.
Không reset DB/phòng/hợp đồng cũ. Tài khoản tổng hợp:
`owner.contract.demo@example.invalid`, `staff.contract.demo@example.invalid`,
`tenant1.contract.demo@example.invalid` đến `tenant3.contract.demo@example.invalid`.
Mật khẩu sinh local trong `.tools/contract-demo/runtime.json`; không copy vào tài liệu/commit/log.

Setup từ terminal ở repository, từng server chạy một terminal:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Initialize-ContractDemo.ps1
dotnet build src/backend/BHome.Api
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Start-ContractDemo.ps1 -Component Api
# Các terminal khác: cùng script với -Component OwnerWeb hoặc MobileWeb.
node scripts/Seed-ContractLifecycleDemoWorkflow.cjs
```

Mặc định API5540/HTTPS7540, Owner5517, Mobile5581. Lượt xác minh này dùng API5543/7543,
Owner5519, Mobile5583; scripts nhận `BHOME_LIFECYCLE_DEMO_API`, `BHOME_LIFECYCLE_DEMO_WEB`,
`BHOME_LIFECYCLE_DEMO_MOBILE` cho các URL loopback đó. Dùng Node22 của repo; nếu bản global
khác, chạy qua Use-LocalTools như các script PowerShell hiện có.

Seed chuẩn bị lịch sử LC102 bằng **ContractService thật với clock lịch sử chỉ trong CLI đã
guard**, hai chữ ký mô phỏng/PDF lưu MinIO và activation guards bình thường. API đang chạy
luôn dùng clock thật. Renewal LC102 được ký/kích hoạt qua HTTP với ngày hiện tại, không sửa
Status trực tiếp. Đây là precondition Development; không chứng minh chữ ký pháp lý quá khứ.

Sau HTTP seed, có thể refresh demo notices bằng CLI hiện có, không rebuild API đang chạy:

```powershell
. ./scripts/ContractDemoEnvironment.ps1
$null = Import-ContractDemoEnvironment
dotnet run --project tools/BHome.LocalDevelopment --no-build -- seed-contract-demo
```

CLI gọi chính registered expiry handler trong DB đã guard. Chạy browser:

```powershell
node scripts/Test-ContractLifecycleDemo.cjs
```

Browser script dùng Playwright đã có trong `.tools/contract-browser/node_modules` hoặc local
dependency và Chrome đã cài. Đây là tooling developer, không thêm dependency production.
Xem thêm [chuẩn bị browser hiện có](CONTRACT_STABILIZATION.md).

| Phòng               | Kết quả thực chạy ngày 02/11/2026                                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------------------- |
| LC101-RENEW-PENDING | Hai chữ ký mô phỏng; PendingActivation vì bắt đầu ngày kế tiếp; bản cũ Active                              |
| LC102-RENEW-ACTIVE  | Renewal Active qua API; parent Superseded, giữ terms/PDF/version chain                                     |
| LC103-SHARED        | A Completed/Terminated; B/C Active; Room Occupied; Invoice/payment cũ còn quyền xem                        |
| LC104-PENDING       | Inspection confirmed; nợ chung + cọc 3 triệu → PendingSettlement; Room Occupied; không có Complete         |
| LC105-LAST          | Các nguồn resolved, cọc 0; Complete qua API; Room Available                                                |
| LC106-UI            | Staff lập inspection qua Mobile Web; Owner review/settle/complete qua Web; Tenant đọc lịch sử sau kết thúc |

Owner mở Hợp đồng, chọn Location hoặc UUID; xem phiên bản, phân công và bảng so sánh;
nhập căn cứ review, đọc blockers rồi xác nhận. Staff mở Trả phòng & kiểm tra, chọn lịch được
giao; chốt meter trong Capture rồi lập checklist. Tenant mở Hợp đồng/Gia hạn–Trả phòng để
gửi yêu cầu hoặc xem kết quả. Web smoke dùng ảnh tổng hợp đã upload qua API làm precondition;
không chứng minh camera native. Browser replay chỉ xem lại nhánh đã Complete, không tạo lại.

Seed chạy lại cùng business date không trùng dữ liệu; manifest giữ IDs. Ngày khác dừng trước
khi tự reset fixture. Sau chạy UI và replay: 12 contracts, 4 invoices, 4 final inspections,
4 settlement reviews trong Location BH40, số lượng không đổi. Không xóa lịch sử để demo lại;
tester cần fixture mới trong môi trường dùng một lần nếu muốn lặp mọi thao tác ghi.

## Bằng chứng developer

Các log/artifacts giữ ignored dưới `.tools`, không commit generated bundles hoặc credentials.

| Check đã chạy                                                                           | Kết quả                                                                                                |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Backend API + LocalDevelopment build                                                    | PASS, không warning/error ở build cuối                                                                 |
| Application UnitTests                                                                   | PASS 173                                                                                               |
| Domain UnitTests                                                                        | PASS 83                                                                                                |
| IntegrationTests PostgreSQL/MinIO, gồm Contract/Payment/Adjustment/security/concurrency | PASS 369/369, không skip                                                                               |
| Closure sau bổ sung actualEndDate                                                       | PASS 3, gồm shared/last/concurrent complete và stale adjustment                                        |
| Owner Web build/typecheck/lint                                                          | PASS                                                                                                   |
| Owner Web tests                                                                         | PASS 87; targeted Contract tests 16, gồm signed adjustment/stale review/role reads                     |
| Mobile typecheck/lint/tests                                                             | PASS 240 tests                                                                                         |
| Expo iOS/Android export                                                                 | PASS; không phải build/sign/install native hoặc kiểm tra thiết bị thật                                 |
| HTTP seed + replay / scoped DB counts                                                   | PASS                                                                                                   |
| Chrome browser real API                                                                 | PASS Staff inspection, Owner review/settlement/closure, Tenant history, pending guard; không pageerror |

Lượt integration đầu 368/369: kiểm thử nền cũ còn yêu cầu UX_Contract_ActiveRoom unique,
mâu thuẫn quyết định phòng chung và migration BH-21. Sửa kỳ vọng thành IX_Contract_ActiveRoom
không unique; chạy lại riêng PASS rồi toàn bộ PASS369. Owner router tests có MUI warning bộ lọc
loc-1/loc-2 đã tồn tại; không có test fail. Không báo cáo coverage/performance/ST/AT chưa đo.

Log chính: `bh40-integration-final.log`, `bh40-application-tests.log`, `bh40-domain-tests.log`,
`bh40-owner-all-tests.log`, `bh40-owner-contract-final.log`, `bh40-mobile-tests.log`,
`bh40-mobile-export-final.log`, `bh40-mobile-final-tests.log`, `bh40-closure-final.log`,
`bh40-api-final-build.log`, `bh40-owner-final-build.log`, `bh40-demo-counts.log`. Browser result và ảnh `lifecycle-*.png` trong
`.tools/contract-demo/`; chỉ dữ liệu tổng hợp, không real identity/funds.

Các nhóm file thay đổi: Application/Contracts (DTO, lifecycle/inspection/expiry services),
Domain/TenantContracts (history/inspection/notices), Infrastructure/Contracts + Persistence
(ledger, repository, jobs, EF configurations/migrations); ContractsController/DI;
`packages/client-core` và các panels/pages contracts của hai client; IntegrationTests
Contracts/MoveInHandover/PaymentsDebt/PostgresFoundation; Owner Contract UI tests;
`tools/BHome.LocalDevelopment`, hai scripts lifecycle demo và tài liệu API/development.
Danh sách chính xác theo commit: `git diff --name-only 3983fc7..HEAD`.

## Trạng thái còn lại và nghiệm thu

- Implemented: renewal/version history, termination approval/schedule, immutable inspection,
  ledger summary/review, revalidation/closure, shared occupancy, expiry notices và client flows.
- Demo Ready: sáu phòng trên; simulated signing và manual verified synthetic payments.
- Pending Business Decision: phân bổ nợ chung khi rời phòng, khấu trừ/hoàn cọc/holding,
  phí damage và final usage chưa được billed. Không có công thức mới được tự phê duyệt.
- External Provider Blocked: bank callback/reconciliation thật, refund bank transfer và MySign
  thật chưa có bằng chứng xác minh từ lượt này.
- Not Implemented: deduction/refund/credit posting ledger cho nhánh policy còn thiếu;
  external notification delivery consumer; automatic billed final-usage settlement charge.
- Awaiting Tester: formal ST/AT, thiết bị iOS/Android/camera native, provider sandbox,
  failure/retry dài hạn, quy mô/performance, UX và policy acceptance cho các nhánh bị chặn.

Bước tiếp theo theo dependency: JOB-09/10 + Notification để xử lý tác vụ/kỳ hóa đơn và delivery
tự động; BH-16 Holding Contract cần quyết định allocation/settlement trước nhánh cọc giữ chỗ.
