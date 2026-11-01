# BHOME — Kế hoạch triển khai cho Nguyễn Quốc Huy

Lập ngày **01/11/2026**, theo source `member/QHuy` tại `9c68c89`. Chỉ tạo kế hoạch; mọi thay đổi code/API/schema dưới đây là **công việc tương lai**, chưa thực hiện hay được phê duyệt chỉ bằng báo cáo này.

Nguồn/hiện trạng/test đã chạy: [audit](HUY_SOURCE_CODE_AUDIT.md). Decision owners và G-00–G-09: [dependency matrix](HUY_DEPENDENCY_MATRIX.md). Test IDs và cách chạy: [test checklist](HUY_TEST_CHECKLIST.md).

## 5. OPTIMAL IMPLEMENTATION ORDER

### Điều kiện và truy vết trước code

| Slice                | Nguồn đã đối chiếu                                  | Classes/data dùng lại                                                                                           | Acceptance chính                                                                                                   |
| -------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Main/Signing/Holding | BF03A/B; UC14/15; GBR03/04/05/10/18; DBR02/03; OQ03 | `ContractService`, `Contract`, `ContractSignature`, `DepositVerification`, `IContractHoldingLedger`, MySign/PDF | Hai bên ký+verified payment+Owner mới Active; một bank effect; Holding/Main không chiếm phòng mâu thuẫn            |
| Meter→Invoice        | BF05; UC20/21; GBR07/08/09; DBR05/06/07; JOB09/10   | `Meter`, `MeterReading`, `OperationalTask`, `CaptureRepository`, `BillingPolicy`, resolver                      | Manual+human confirm; missing data giữ Draft; charge snapshots theo kỳ; Owner-authorized Final; original immutable |
| Payment/Debt/History | BF06; UC22/23/25; GBR02/10/13/18; DBR08; JOB01/03   | `IBankTransactionProvider`, `ResourceAccess`, audit/queue; cọc Contract cần nối chứ không coi là toàn ledger    | Durable unique event/transaction + allocations; exact/partial/over/unmatched; đúng payer/scope/due date            |
| Move-in baseline     | BF03/04; UC17; GBR02/05/07                          | `ContractResident`, Assets, Initial readings, private storage                                                   | Versioned record, keys/condition/asset/evidence, Staff và Tenant confirm cùng revision                             |
| Adjustment           | BF06C; UC24; GBR03/09/13; DBR07; OQ02               | Invoice mới sau approved design, existing audit/permissions                                                     | Owner approve/reject; Draft correction hoặc separate post-Final adjustment; apply một lần                          |
| Renewal/Move-out     | BF04; UC16/19; JOB02; OQ01/05                       | Existing renewal/termination/inspection/ledger ports                                                            | Ledger thật resolved và re-read, baseline+Final readings; chưa settled không close/release                         |

Không sửa nhánh tiền/quyền/occupancy đang tranh chấp khi D-01–D-06 chưa chốt. Có thể tiếp tục read-only analysis, fixture synthetic, regression của behavior đã rõ; thời gian chờ không phải permission.

### Thứ tự engineering

1. **Baseline + decisions**, cùng người phụ trách tái hiện assignment double-commit; không rewrite project governance.
2. **Main có sẵn → template/signing adapter → real DB regression.** PDF signer crypto đã có test; chỉ bổ sung renderer/template/provider evidence còn thiếu.
3. **Manual confirmed meter → Draft Invoice → Final Invoice → jobs**. Chốt invoice identity và billing calendar trước migration. Chưa cần OCR chính xác để ra hóa đơn từ manual reading đã xác nhận.
4. **Common bank allocation → manual reconciliation → debt/history → real gateway.** Dùng common boundary cho Invoice/deposit để không có hai nơi cộng cùng bank transaction.
5. **UC-17 baseline**; không dùng move-out inspection làm baseline move-in.
6. **BH-41 adjustment** trước final settlement để balances đúng.
7. **BH-40 nối financial ledger/refund**, giữ existing renewal/close guards; đồng bộ JOB02.
8. **Holding** là nhánh còn thiếu của BH16, triển khai sau khi shared room locking/payment allocation và OQ03 rõ; gate Holding→Main không được bỏ khỏi release.
9. **Real cross-package integration + client E2E + review/release**.

Thứ tự không buộc Huy chờ UI, OCR hoặc gateway để unit test. Các code paths hiện có không bị đưa lại vào backlog như feature phải viết mới. Holding có thể làm song song bởi người được nhóm phân công sau khi lock/ledger contracts freeze; kế hoạch này không tự chuyển quyền sở hữu công việc.

### Năng lực và giới hạn cam kết

- Baseline người dùng: **126h**, gồm50h quản lý và76h backend,02–30/11. Không có workbook để xác nhận ca làm từng ngày.
- Ước lượng phần còn thiếu: **18 PM +162–242 engineering +16 reserve =196–276h**. Package effort gồm test cấp package; cross-package QA riêng tránh hiểu nhầm test bằng tên file là đủ.
- Nếu giữ50 PM/76 BE: thiếu102–182h BE+buffer. Nếu nhóm duyệt18 PM/108 BE gồm buffer: vẫn thiếu70–150h so với126h tổng. Không lấy lại giờ quá khứ chưa được tracking xác minh.
- Lịch bên dưới là **đề xuất tái phân bổ18PM +96 engineering +12 reserve =126h**, giả định21 ngày thứ Hai–thứ Sáu,6h/ngày. Phải chốt D-07; không tự cắt giờ quản lý đã cam kết.
- Scope trong 126h ưu tiên Main stabilization, Invoice và Payment manual/fake external. Holding production lifecycle, UC17, BH41, settlement/refund thật và real-provider gates còn carry-over; không đổi chúng thành optional/P1 chỉ để khớp lịch.
- Không hứa hoàn tất một package chỉ vì đã hết số giờ trong một ngày. Gate không đạt thì chuyển workload phía sau và báo tác động; dùng buffer khi có defect cụ thể, không “nén” test.

## 6. DETAILED DAILY EXECUTION PLAN

`PM/BE/DP` lần lượt là quản lý, engineering (gồm test), dự phòng. Mỗi dòng tổng6h; tổng **18/96/12 =126h**. Các API/entity/service mới ghi **đề xuất**; tên method không đánh dấu là method đã tìm thấy source. Test IDs đầy đủ ở checklist. “Done” trong bảng là done của đầu ra ngày đó, không phải Fully Done toàn Work Package.

| Date           | Task ID                            | Công việc cụ thể                                                                                                                                                       | Files/Modules cần xử lý                                                                                                             | Giờ dự kiến PM/BE/DP | Output                                                                                                                    | Test                                                                        | Dependency                                                        | Done Criteria                                                                                                  |
| -------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **02/11 Thứ2** | BH01; BH16 baseline                | Chốt D01/D03/D05/D07 và người giữ migration; kiểm chứng Node22/Docker; thiết lập test matrix Main từ source; mở F01 cùng BH08                                          | `ContractService.cs`, `ContractConfiguration.cs`, `PostgresLocationAssignments.cs`, `.github/workflows/ci.yml`, API docs            | **3/3/0**            | Decision log+schema/API inventory; synthetic data spec; issue F01 với repro dự kiến                                       | Chạy baseline commands; T-C01/02 và T-A01 thiết kế                          | PO/BA/migration/QA; nếu decisions chậm chỉ làm regression an toàn | Decisions có owner và hạn; không ghi requirement mới như đã duyệt; artifact baseline tái chạy được             |
| **03/11 Thứ3** | BH16; BH07/08 phối hợp             | Chạy real ContractLifecycle tests; tái hiện create assignment→read→retry để chứng minh/correct F01 với owner; verify deposit/race/role                                 | Existing `Contracts/ContractLifecycleApiTests.cs`, `PostgresAuthenticationTests.cs`, `Ocr/CaptureWorkflowTests.cs`; assignment repo | **1/5/0**            | TRX+repro F01; PR/fix nhỏ bởi owner sau thống nhất; Contract errors gửi FE/QA                                             | T-A01, T-C01–C06, C09; không có Docker thì đánh BLOCKED và làm UT negatives | G01; không dùng cluster developer để né Docker                    | PG/MinIO tests có kết quả hoặc blocker cụ thể; correction không làm2records/audits; không gọi fake là real     |
| **04/11 Thứ4** | BH16 Main PDF                      | Map approved template từ `ContractDocument`; implement renderer và DI sau review; không sửa crypto signer                                                              | `ViettelMySignContractAdapter.cs` renderer/DI; **renderer concrete mới đề xuất**; ContractDocument/tests                            | **1/5/0**            | Renderer reviewable + PDF chứa approved fields/snapshot; nếu template chưa approved: mapping/spec/tests, chưa gắn runtime | T-C07/08; synthetic render/integrity; thiếu template vẫn503                 | D04; template approval                                            | PDF khớp snapshot; không arbitrary user PDF; thiếu template không false-success                                |
| **05/11 Thứ5** | BH16 Signing                       | Dùng actual registered adapter+PDF signer với synthetic remote; kiểm signing failed/ambiguous/recover; chạy sandbox thật khi đủ quyền                                  | Existing signing adapter, `ContractService.RequestSigningAsync/SyncSigningAsync/RecoverSigningAsync`, certificate store             | **0.5/5.5/0**        | Synthetic end-to-end signing evidence; real provider checklist riêng                                                      | T-C07/08, T-X01; two-party PDF verification                                 | D04/G02S; real secret qua local approved store                    | Hai chữ ký kiểm tra được, manual-review không gửi lại mù; đánh tách Synthetic/Real                             |
| **06/11 Thứ6** | BH16 Holding boundary; BH25 design | Freeze shared bank-reference/allocation contract; phân tích conversion/OnHold/expiry theo D02; chưa viết toàn Holding                                                  | `IContractHoldingLedger`, `DepositVerification`, `ContractRepository.InTransactionAsync`, `IBankTransactionProvider`                | **0.5/5.5/0**        | Reviewed ledger/model proposal, fake boundary test và migration request; Holding còn NOT DONE                             | T-C06, T-P01/P04 design; Holding conflict cases                             | D02; migration coordinator                                        | Không có hai độc lập ledger tự credit; fake chỉ test; hold deadline không tự hardcode                          |
| **09/11 Thứ2** | BH21 confirmed read                | Thiết kế/implement least-privilege Tenant confirmed-reading read API sau scope approval; reuse manual confirmation inputs; snapshot Initial/Periodic liên quan tenancy | `MeterCapture.cs`, `CaptureRepository`, `CaptureContracts`; **read API/service đề xuất**                                            | **1/5/0**            | Staff ảnh+manual confirm → Tenant đúng tenancy xem reading/usage; OCR disabled                                            | T-M01–M05, T-A02                                                            | D01/D05; actual account mapping                                   | Tenant khác404/403 theo policy; không mở toàn capture controller; test baseline/date precision                 |
| **10/11 Thứ3** | BH21 Invoice persistence           | Review và tạo minimal Invoice/line/calendar design+migration theo D01/D03; chốt DTO với FE; dùng existing Contract/Room/Policy/Meter references                        | **Invoice/InvoiceLine/calendar mappings/API DTO đề xuất**; DbContext/snapshot cùng migration coordinator                            | **0.5/5.5/0**        | Schema/DTO/ERD traceability; isolated migration/test fixture, không production update                                     | T-I01/T-I05; fresh+upgrade schema                                           | G00/G01; một người generate migration                             | Key invoice identity đúng approved model; FK/index/decimal đúng; upgrade không mất source data                 |
| **11/11 Thứ4** | BH21 Draft                         | Implement draft generation từ confirmed consumption + approved rent/rates/fees; snapshot line inputs; `RecordUsage` cùng transaction/Location lock                     | **Invoice service/repository đề xuất**; `ResolvePricesAsync`, `BillingPolicy.RecordUsage`                                           | **0.5/5.5/0**        | HTTP tạo/đọc Draft với charge trace; synthetic example known-total                                                        | T-I01/02/03                                                                 | D03; no OCR dependency                                            | Amount do backend; thiếu input có explicit missing list; rate snapshots traceable                              |
| **12/11 Thứ5** | BH21 Final                         | Implement finalize/due-date guard và Owner authority; ngăn edit finalized; Tenant read Draft/Final                                                                     | **Invoice finalize/read methods/controller đề xuất**, permission catalog và mapping                                                 | **0.5/5.5/0**        | Draft→Final với immutable financial lines; invalid-role/status errors                                                     | T-I02/04/05/06, T-A02                                                       | D03; Draft core                                                   | Staff/client không tự finalize; missing meter không zero estimate; due date theo approved calendar             |
| **13/11 Thứ6** | BH21 rate/idempotency regression   | Chạy property policy change vs Invoice snapshot, duplicate parallel finalize; hoàn thiện manual-meter smoke Postman                                                    | Existing Property/Meter + proposed Invoice tests; `docs/testing/postman`                                                            | **0.5/5.5/0**        | TRX+collection Contract→confirmedMeter→Draft→Final; API contract handoff                                                  | T-I03/05/06, T-M01/04                                                       | G01/G03                                                           | Một official periodic invoice theo key approved; đổi policy tương lai không sửa historical lines               |
| **16/11 Thứ2** | BH21/JOB09/10 phối hợp BH19        | Bàn giao business keys/calendar; implement hoặc tích hợp handlers được phân công cho meter/draft/final; duplicate/concurrent/missing-data                              | `IBackgroundJobHandler`, `PostgresJobQueue`; **business handlers/scheduler đề xuất**                                                | **1/5/0**            | Reviewed registered job path và replay tests; Nếu BH19 owner khác thì handoff+contract test, không sửa chồng              | T-J01/02, T-I02/05                                                          | D03/G07; handler owner thống nhất                                 | Không tuyên bố job chạy tự động khi chỉ có queue hoặc chưa có scheduler; recipients theo D06                   |
| **17/11 Thứ3** | BH25 manual allocation             | Implement persisted transaction+allocation và Owner manual verification từ evidence; reuse obligation model                                                            | **Payment/transaction/allocation service/repository/DTO đề xuất**; `IBankTransactionProvider`, Contract deposit boundary            | **0.5/5.5/0**        | Invoice Final→verified manual transaction→Paid/balance qua API; audit                                                     | T-P01/02/04                                                                 | G03; schema review, bank không bắt buộc                           | Không screenshot/clientpaid tự credit; payer khác actor verifier có mapping rõ                                 |
| **18/11 Thứ4** | BH25 partial/over/unmatched        | Bổ sung amount validation, partial/excess/manual-review outcomes theo approved policy; không tự auto-refund                                                            | Proposed payment modules và allocation constraints                                                                                  | **0.5/5.5/0**        | Financial cases có explicit persisted state và expected balance                                                           | T-P02/03/06                                                                 | D02/G04                                                           | Không âm/round sai; unmatched không credit; overpayment không mất/chia tiền tùy ý                              |
| **19/11 Thứ5** | BH25 idempotency/concurrency       | Parallel sameevent/sameref/different invoice deposit; crash/retry/rollback; cùng allocation transaction                                                                | Proposed payment repos/constraints; `DepositVerification` integration                                                               | **0.5/5.5/0**        | TRX chứng minh1effect; failure injection không partial state                                                              | T-P04/05/07                                                                 | G01; common bank reference design                                 | Không2payments/2allocations cho một reference; retry results nhất quán                                         |
| **20/11 Thứ6** | BH25 Debt                          | Implement due/paid/outstanding/overdue Vietnam date; Staff minimal Location DTO; reminder input không tự chọn cadence                                                  | **Debt queries/DTO đề xuất**; timezone helper/ResourceAccess; proposed balance service                                              | **0.5/5.5/0**        | API debt đúng theo ngày/múi giờ, least privilege                                                                          | T-P08, T-A02/03                                                             | D03; reminder policy                                              | Paid không còn debt; chưa đến hạn không overdue; không rò whole business finance cho Staff                     |
| **23/11 Thứ2** | BH25 History/shared access         | History paging theo Invoice/Room/Location; payer metadata và account entitlement theo D01; test hết tenancy                                                            | **PaymentHistory queries/API đề xuất**; `ContractResident` mapping được duyệt                                                       | **1/5/0**            | Tenant/Owner history và một người thanh toán đủ phản ánh cùng obligation cho các user được duyệt                          | T-P06/09, T-A02                                                             | D01/D05; không tự thayactive-room unique                          | Không dùng người tạo Resident làm payer; quyền lịch sử theo policy; nếu D01 chưa chốt nhánh shared vẫn BLOCKED |
| **24/11 Thứ3** | BH25 fake-feed; BH19 integration   | Feed synthetic transactions vào cùng allocation, external outage/retry; đóng manual/fake gate và liệt kê real bank còn thiếu                                           | `IBankTransactionProvider`, proposed consumer/handlers; external ports                                                              | **0.5/5.5/0**        | Fake-feed+real PG evidence, manual fallback; actual gateway checklist chưa giả pass                                       | T-P04/07, T-J03, T-X02                                                      | G04/G07; official provider contract nếu làm real                  | Fake không đăng ký production; durable ack/state; không claim bank integration Done                            |
| **25/11 Thứ4** | QA cross-slice                     | Chạy Contract→manualMeter→Invoice→manualPayment→History với isolation; lập carried-over backlog Holding/UC17/BH41/BH40                                                 | Existing/new backend IT, Postman; client fixture handoff                                                                            | **0.5/5.5/0**        | Cross-package TRX, API evidence; exact release/no-go list và updated effort                                               | T-R01/02; current/full regression khi có Docker                             | G02/03/04; QA                                                     | Full persisted chain pass hoặc defect repro rõ; không đóng toàn dự án nếu P0 còn carry-over                    |
| **26/11 Thứ5** | Integration; buffer                | 2h review API states/errors/negative cases cùng FE/QA;3.5h dự phòng lỗi có repro                                                                                       | Changed modules theo defect thực tế; shared clients sau review                                                                      | **0.5/2/3.5**        | Review findings, bounded fixes/retest evidence; hoặc buffer chưa dùng nếu không có lỗi                                    | Relevant failed tests + T-R01                                               | G08; reviewer khác                                                | Không dùng buffer để lén thêm feature; lỗi ngoài ownership bàn giao người phụ trách                            |
| **27/11 Thứ6** | Buffer/release readiness           | Dành5.5h lỗi blocking được xác định từ integration; rerun đúng affected checks; prepare migration/release handoff                                                      | Defect-specific code/tests; CI/docs                                                                                                 | **0.5/0/5.5**        | Defect resolution evidence hoặc explicit blocked list; remaining estimates                                                | T-R02; style/IT gate affected                                               | QA/owners                                                         | Không tắt tests/format để xanh; còn Critical/Major thì no-go                                                   |
| **30/11 Thứ2** | BH01 review; buffer                | 3h review/chốt tracking/gates và remaining scope;3h reserve phát sinh; đề xuất mốc/capacity bổ sung                                                                    | PR/evidence/decision log/roadmap                                                                                                    | **3/0/3**            | Signoff hoặc no-go có căn cứ; bàn giao backlog chưa hoàn tất                                                              | Re-run chỉ khi có thay đổi; acceptance evidence review                      | D07; another reviewer                                             | 126h accounted; không tuyên bố Holding/handover/settlement/Adjustment Done khi chưa qua gate                   |
| **Tổng**       |                                    |                                                                                                                                                                        |                                                                                                                                     | **18/96/12**         | **126h**                                                                                                                  |                                                                             |                                                                   |                                                                                                                |

Không lên lịch cuối tuần khi chưa có xác nhận. Đây là phân bổ capacity đề xuất;3.5/5.5/3 giờ reserve là thời gian giữ chỗ, chưa phải giờ bugfix đã tiêu dùng. Nếu G01 chưa sẵn ngày03/11, dùng phần độc lập trong BH16/meter fixtures, nhưng real IT vẫn là backlog phải làm lại; báo rõ tác động ngày10/11 trước khi commit migration mới.

### Phần bắt buộc ngoài năng lực tháng11

| Phần chưa thể cam kết trọn trong lịch126h                                             | Hướng xử lý                                                                                                                                                   |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Holding state/payment/expiry/conversion20–30h và phần Main nếu provider chưa sẵn      | Giữ P0 BH16; shared allocation sẵn rồi triển khai; nhóm duyệt thêm capacity hoặc giao người khác một slice hoàn chỉnh                                         |
| UC17 16–24h                                                                           | Chốt BE/UI owner ngay02/11; có thể giao đồng đội đã được duyệt; Huy cung cấp Contract/Meter/Assets API, không chờ đến cuối tháng mới phát hiện thiếu baseline |
| BH41 14–22h                                                                           | Xong Invoice/Payment mới implement request/Owner decision/effect; vẫn P0, không cho sửa trực tiếp Final để demo                                               |
| BH40 20–32h                                                                           | Renewal core giữ nguyên; thêm real ledger/refund/baseline/job integration sau các gate; phòng tiếp tục Occupied nếu chưa đủ điều kiện                         |
| Real bank/MySign/general notification/client acceptance + còn lại của estimate ranges | Theo lead time thật và resource plan; fake external hoàn thành chỉ là test-ready/integration nội bộ, không Fully Done                                         |

Không cộng thẳng các hàng trên để suy ra exact remaining tại30/11: mỗi hàng có dependency overlap và effort đã dành một phần trong 126h; cần cập nhật giờ thực tế khi thực hiện. Chênh lệch capacity toàn scope70–150h là phép tính baseline nhất quán, không phải giờ đã ghi nhận.

## 7. WORK PACKAGE BREAKDOWN

### BH-01 — Baseline, quyết định và integration governance

- **Mục tiêu:** giữ API/schema/ownership/test gates rõ để backend làm liên tục; traceability theo SRS và quyết định approved.
- **Hiện trạng:** branch `member/QHuy`, CI và conventions có; tracker/workbook/Git.txt thiếu; style gates local lỗi; remote protections chưa verified.
- **Công việc còn lại:** D01–D08, xác nhận ownership/alias, cập nhật tracking thực tế, migration order, review và evidence; phối hợp F01/format, không tự sửa module người khác.
- **File/Class cần xử lý:** `.github/workflows/ci.yml`, `docs/api/API_CONVENTIONS.md`, `docs/development/*`, `.editorconfig/.gitattributes` nếu kiểm chứng cần thay; tracker bên ngoài sau khi có bản gốc.
- **Dependency:** PO/BA/QA/another reviewer; quyền xem branch protection nếu cần xác minh.
- **Cách không block:** governance theo daily timebox; OpenAPI+fixture/errors là artifact, không họp để thay kiểm thử.
- **Ước lượng:**18h PM toàn kỳ, cần duyệt giảm từ50h; các code fix/test tính vào slice liên quan.
- **API/Deliverables:** decisions, ownership/RACI, contract versions, migration and release checklist; không thêm management API.
- **Test Cases:** baseline commands, T-A01, T-R02, test discovery; review artifact không tính là executable test pass.
- **DoD:** có owner/inputs/evidence cho từng gate; người review khác; không secret; full quality gates thực chạy; báo rõ chưa đạt.
- **Tiếp theo:** freeze agreed DTO rồi BH16/BH21, bàn giao QA/data requirements.

### BH-16 — Main còn thiếu và Holding mới

- **Mục tiêu:** UC14/15 tạo→ký→verified funds→Owner Active đúng room state; direct Main và Holding conversion đều kiểm thử được.
- **Hiện trạng:** Main service/repository/API/UI, private evidence/snapshot/idempotency/race guard có; renderer503, Holding port503; ContractKind chỉMain/Renewal.
- **Công việc còn lại / nhỏ hóa:** Main DB regression4–6h; approved renderer+actual MySign integration8–12h; Holding lifecycle/shared allocation/expiry/conversion20–30h. Các phần mới chia thành draft/read, signing/paid-activation, expiry/conversion testable slices; không một task mơ hồ “làm Contract”.
- **File/Class cần xử lý:** existing Contract domain/service/contracts/repository/config/controller; renderer/holding implementation **đề xuất**, DI; new reviewed migration; reuse signing module.
- **Dependency:** Room/Resident/account data; D01/02/04/05; common payment allocation; G01.
- **Cách không block:** synthetic fixture/provider tests; direct Main độc lập với Holding. Missing Holding ledger vẫn từ chối thay vì credit giả; template chưa duyệt giữ503.
- **Ước lượng:**32–48h, không gồm provider chờ cấp tài khoản.
- **API/Deliverables:** giữ existing `/api/v1/contracts` và action routes; Holding draft/read/sign/verify/activate/expire API là **đề xuất** phải được review, chưa có endpoint name được duyệt; updated OpenAPI+Postman+schema/audit.
- **Test Cases:** T-C01–C09, T-P04/05, wrong actor/scope; competing holds/Main, expiry/history, same bank ref across obligations, failed storage/provider.
- **DoD:** Main và Holding real PG/storage flows pass; real signing được đánh dấu riêng; room updates atomic; audit và bank dedup toàn obligation;2actual signers; another review. Synthetic-only chưa Fully Done.
- **Tiếp theo:** meter/Invoice trên eligible Active tenancy; shared ledger dùng BH25; không tạo Contract implementation thứ hai.

### BH-21 — Manual meter → Invoice

- **Mục tiêu:** UC20/21 từ Staff confirmed usage đến Tenant xem Draft/Final Invoice với correct charges/rates/status.
- **Hiện trạng:** meter + consumption/policy resolver có; Tenant read/calendars/Invoice persistence/API/jobs thiếu.
- **Công việc còn lại / nhỏ hóa:** confirmed-reading view/account scope4–6h; Draft + lines + rate snapshot12–16h; finalize/due/immutability8–10h; JOB09/10 registration/scheduling/idempotency integration8–12h. Draft/schema dự kiến cần nhiều hơn một buổi: chia DTO/migration, calculation, HTTP persistence, missing-data test, finalize race mỗi buổi4–6h.
- **File/Class cần xử lý:** existing capture/billing policy/property; `BillingPolicy.RecordUsage` cùng shared transaction; **Invoice/InvoiceLine/calendar/service/repository/controller đề xuất**; Domain permission catalog; migration coordinator.
- **Dependency:** D01/03/05, confirmed inputs, role data và PG test; BH19 job contract.
- **Cách không block:** manual value+ảnh+HumanConfirmed; fake OCR disabled; fake scheduler clock; không cần UI.
- **Ước lượng:**32–44h, không bao gồm full OCR benchmark.
- **API/Deliverables:** Invoice draft/list/detail/finalize và Tenant confirmed-reading queries **đề xuất**; no speculative response fields trước design review; official totals server-side; missing reasons và safe error contract agreed; Postman smoke.
- **Test Cases:** T-M01–M05, T-I01–I06, T-J01/02, T-A02/03; include expired/replaced meter, rate boundary, Draft incomplete, immutable Final, parallel finalize.
- **DoD:** real API/DB flow pass, approved key không duplicate Final, rates/usage immutable+traceable, no estimate silent, onlyOwner authority, configured dates/timezone, Tenant scope; jobs evidence thật nếu package bao gồm jobs.
- **Tiếp theo:** Final obligation feeding BH25; BH41 adjustment không direct edit Final.

### BH-25 — Payment, Debt và History

- **Mục tiêu:** UC22/23/25 bank/manual verification → one allocation effect →Paid/partial/debt/history, đúng payer và viewers.
- **Hiện trạng:** provider port/unconfigured adapter; manual ContractDepositVerifications chỉ xử lý cọc Main; Invoice Payment chưa có.
- **Công việc còn lại / nhỏ hóa:** transaction/allocation/manual12–16h; partial/over/unmatched/payer8–12h; debt/history8–12h; provider authenticity/idempotency/retry8–12h. Mỗi4–6h đưa một set state transitions + persistent API + tests; không viết tất cả controllers rồi mới logic.
- **File/Class cần xử lý:** `IBankTransactionProvider`, existing audit/queue, Contract deposit port; **Payment/BankEvent/Allocation/queries/service/controller đề xuất** và reviewed schema. Tên đề xuất chưa chốt bảng; không bắt buộc mỗi khái niệm là một bảng riêng.
- **Dependency:** D01/02/03/05; Invoice identity và signed/verified deposit obligations; official provider spec khi nối thật.
- **Cách không block:** synthetic feed và Owner manual verification gọi chung application allocation service; fake external boundary, real persistence cho IT; fake không production DI.
- **Ước lượng:**36–52h; chưa tính lead time ngân hàng.
- **API/Deliverables:** reconciliation/manual review/debt/history/payer DTO endpoints **đề xuất**, security/idempotency contract; existing Contract cọc cần migration/adapter adoption được review để không double-count lịch sử.
- **Test Cases:** T-P01–P09, T-X02, T-A02/03; full/under/over/unmatched; fake/forged callback; exact replay/changed payload; concurrent payers; same event giữa Invoice/cọc; timezone; notification failure.
- **DoD:** unique trusted event/ref, allocations+balance trong transaction, no negative/duplicate effect, amounts reconciled, manual actor khác payer, scope safe, historical evidence; actual provider gate tách rõ.
- **Tiếp theo:** Adjustment balance và Move-out ledger/refund; frontend nhận server result, không quyết định paid.

### UC-17 — Move-in handover

- **Mục tiêu:** tạo/truy xuất baseline move-in phục vụ maintenance/move-out, không dùng live asset state thay biên bản.
- **Hiện trạng:** Initial readings/Assets/storage có; không có record/API/checklist/dual confirmation. Owner handover UI mock; owner BE/UI chưa xác nhận.
- **Công việc còn lại / nhỏ hóa:** draft/checklist+keys/assets/readings+evidence8–12h; revisions/dispute/Staff+Tenant confirmations/read8–12h. Chia4–6h/slice: draft/read, asset snapshot, confirmation revision, privacy/concurrency.
- **File/Class cần xử lý:** Contract/ContractResident/Asset/MeterReading, storage helper; **Handover entity/service/repository/controller/DTO đề xuất**, reviewed migration; `HandoversPage.tsx` UI do người được phân công xử lý.
- **Dependency:** D05, Active Contract + correct Tenant account; approved checklist; initial readings date/context. Existing initial tasks không có ContractId, nên cần thiết kế liên kết validated rather than assume FK.
- **Cách không block:** API/HTTP tests trước UI; synthetic assets và evidence; storage fake cho UT/MinIO thật cho IT.
- **Ước lượng:**16–24h, cần phân công riêng nếu126h giữ nguyên.
- **API/Deliverables:** create/read/update-draft/confirm actions **đề xuất**; private evidence endpoint; immutable confirmed baseline và confirmation actors/timestamps.
- **Test Cases:** T-H01–H04; tenant dispute, changed revision resets/requires appropriate reconfirmation theo policy; foreign Contract/Asset/reading/evidence rejected; complete twice one baseline.
- **DoD:** Staff assigned+Tenant correct entitlement confirm same final revision; finalized baseline không overwrite; future asset changes không đổi history; PG/S3 tests pass.
- **Tiếp theo:** BH40 inspection so sánh baseline và real final meter/balance, không tính deduction trước approved policy.

### BH-40 — Renewal, Termination và Move-out

- **Mục tiêu:** UC16/19 hai luồng renewal và settled termination chạy qua actual backend; no premature room release.
- **Hiện trạng:** `RenewAsync`, `ActivateAsync`, request/approve/schedule/inspect/settle/complete và history có; real ledger null, JOB02/handover thiếu. Không tái viết renewal.
- **Công việc còn lại / nhỏ hóa:** JOB02/expiry4–6h; real financial settlement/refund10–16h; baseline/final-read/closure integration6–10h; review missing reject/cancel branch với approved UC, không tự thêm rule. Adapters và close tests chia4–6h/buổi.
- **File/Class cần xử lý:** ContractService/repository, `IContractSettlementLedger`, pending implementation/DI, new finance queries, handover DTO; **expiry handler đề xuất**.
- **Dependency:** G04/G05/G06A, D02/D03; bank-confirmed collection/refund; room release policy nếu D01 cho nhiều tenancy.
- **Cách không block:** test pending/missing/failure ledger guards; fake can return resolved trong test để verify orchestration nhưng không claim settlement thật; daily expiry fixed clock.
- **Ước lượng:**20–32h chưa gồm hoàn toàn mới UC17/BH41 hoặc lead time refund.
- **API/Deliverables:** existing renewal/move-out actions; real ledger adapter; append-only financial references; rejection/cancellation endpoint chỉ là **đề xuất nếu approved branch yêu cầu**.
- **Test Cases:** T-L01–L05, T-P07/08, T-H04; parent history intact; new version unsigned không effective; debt/refund pending không close; stale ledger state409; final-day/date guards.
- **DoD:**1renewal active đúng date, old terms intact; inspection baseline+Final readings valid; all mandatory charges/deposit/transfers resolved and re-read; Room release exactly once theo approved tenancy model; Owner decision/audit.
- **Tiếp theo:** full regression across renewal billing periods and tenant access-history; release gate G09.

### BH-41 — InvoiceAdjustment

- **Mục tiêu:** UC24 Tenant request→Owner approve/reject→financial effect/history, originalFinal immutable.
- **Hiện trạng:** chưa có backend, chỉ mock UI; depend on Invoice/Payment core.
- **Công việc còn lại / nhỏ hóa:** request/reason/scope/history6–8h; approval/rejection/Draft-vsFinal/apply-once8–14h. Chia request/read, decision, financial apply/concurrency, regression mỗi4–6h.
- **File/Class cần xử lý:** proposed Invoice/balance modules, audit; **InvoiceAdjustment entity/service/controller/approval records đề xuất**, permissions/migration reviewed.
- **Dependency:** D06/OQ02, G03/G04; approved handling approved decrease below already-paid amount.
- **Cách không block:** agreed Owner-only review states/validation tests; fake balance boundary cho UT; không chọn threshold/categories chưa duyệt.
- **Ước lượng:**14–22h.
- **API/Deliverables:** request/list/detail/approve/reject **đề xuất**, reason/decision/effect history; preserve invoice source data.
- **Test Cases:** T-AD01–AD04; duplicate request key, parallel approve/reject, foreign Tenant/Staff, stale revision/status, rejection no monetary change, approved Final delta one effect.
- **DoD:**2financial branches đúng SRS, explicit approved delta, no direct Final edits, one application under race/retry, audit+safe notification, balance reconciled with Payment.
- **Tiếp theo:** settled ledger adapter và tenant UI refresh balance/server-owned statuses.

### Cross-package regression và release

- **Mục tiêu:** chứng minh actual end-to-end state/data/security, không chỉ từng unit pass.
- **Hiện trạng:**232backend UT +110container-free projectIT +41signing +300client tests pass;175IT chưa chạy; style gates fail.
- **Công việc còn lại:** real PG/MinIO migration+workflow+concurrency; Contract→Meter→Invoice→Payment→Adjustment→Handover→Move-out; correct role/object access và external failure; CI/review artifacts.
- **File/Class:** existing/new integration tests, Postman collection, client integration tests, CI/evidence docs.
- **Dependency:** required G00–G08, test runner độc lập; another reviewer.
- **Cách không block:** QA chuẩn bị synthetic fixture/test scripts theo DTO sớm; từng slice chạy độc lập; reserve rõ ràng.
- **Ước lượng:**12–20h cross-package, cộng16h dự phòng trong estimate đầy đủ. Lịch126h chỉ dành12h reserve và một phần engineering cho regression, chưa đủ để gọi toàn scope Done.
- **Deliverables/Test Cases:** T-R01/R02, full TRX+actual UI screenshots không PII; failed/blocked list; no fabricated coverage/load metrics.
- **DoD:** required UT/IT/ST/AT executed; no Critical/Major unresolved; approved money/policy/model; CI and another review; migration/backup/release signoff. Commit/PR/push chỉ thực hiện trong task khác được cho phép.
- **Tiếp theo:** release theo process nhóm, không auto-merge/deploy trong audit.

### Trạng thái giao việc không được đánh đồng

| Trạng thái        | Tiêu chí                                                                                                                                                                                 |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Code complete     | Các branch behavior thuộc scope được implement, không placeholder trên required path                                                                                                     |
| Test-ready        | Có repeatable synthetic data, commands, expected outcomes và dependency runner                                                                                                           |
| Integration-ready | DTO/API frozen, unit checks pass, real module-level PG/storage tests pass, external limitations ghi rõ                                                                                   |
| Fully Done        | Requirements approved; normal/alternative/error/security/concurrency verified; required real integration+UI/acceptance pass; docs/evidence; reviewed PR/CI; no Critical/Major unresolved |

Một mock provider pass không đáp ứng “real integration”; một controller tồn tại không đáp ứng “code complete”; package chưa hoàn thành Holding hoặc Settlement không được “Done” bằng đổi tên scope.

## 8. TEST EXECUTION PLAN

Test matrix, Preconditions/Steps/Expected/Evidence và commands: [HUY_TEST_CHECKLIST.md](HUY_TEST_CHECKLIST.md). Developer viết UT cho slice mình; Nguyễn Quang Huy phối hợp integration/system/evidence theo Report2, không nhận thay toàn bộ UT của Huy. Mỗi PR cần test có thể bắt implementation sai, nhất là money/idempotency/isolation.

## 9. IMMEDIATE ACTION PLAN – 3 NGÀY ĐẦU

### 02/11/2026 — Chốt nền quyết định và môi trường,6h

1. **PM3h có timebox:** đối chiếu audit với BA/PO/nhóm; xác nhận D01 invoice identity, D03 calendar/authority/rent, D05 owner UC17/user mapping, D07 capacity; ghi owner+deadline cho OQ còn thiếu. Yêu cầu tracker/workbook bản thật để đối chiếu, không nhập giả trạng thái đã hoàn tất.
2. **BE3h:** mở `Contract.cs`, `ContractConfiguration.cs`, `ContractService.CreateAsync/Readiness/ActivateAsync`, `CaptureRepository.ConfirmMeterAsync`, `PostgresLocationAssignments.cs:51/58`; map acceptance/negative tests. Không sửa schema để hỗ trợ nhiều Active contracts khi D01 chưa duyệt.
3. Dùng Node22 local; chạy build/UT/lint/typecheck. Xác minh Docker daemon; chuẩn bị PG16/MinIO test runner với QA, không chạy `docker compose up` trỏ dữ liệu hiện có hoặc reset DB để né lỗi.
4. **Cuối ngày:** decision log hoặc explicit unresolved variants; baseline evidence; minimal API+fixture handoff và reproduction steps F01 cho Đinh Thiên Huy; giao QA G01 runner, Trường BA chốt model, UI owner nhận existing104-operation inventory.
5. **Gate chuyển ngày:** nguồn baseline/owner rõ; test runner dùng DB synthetic. Nếu Docker còn thiếu,03/11 chỉ thực hiện independent UT/tests và giữ real IT Blocked, không đánh “pass có điều kiện”.

Lệnh an toàn trên source hiện tại, không đụng DB:

```powershell
$env:PATH = (Join-Path $PWD '.tools/node-v22.23.4-win-x64') + ';' + $env:PATH
node --version
dotnet restore src/backend/BHome.sln
dotnet build src/backend/BHome.sln --no-restore
dotnet test tests/backend/BHome.Domain.UnitTests/BHome.Domain.UnitTests.csproj --no-build
dotnet test tests/backend/BHome.Application.UnitTests/BHome.Application.UnitTests.csproj --no-build
npm.cmd run lint
npm.cmd run typecheck --workspace mobile
```

### 03/11/2026 — Chứng minh Main với dữ liệu thật trong môi trường test,6h

1. QA/migration owner cung cấp isolated test runner; kiểm tra postgres:16-alpine và source-built MinIO test image. `CaptureFixture` luôn tạo test containers; không đặt connection vào `.env` DB người dùng.
2. Mở `tests/backend/BHome.IntegrationTests/Contracts/ContractLifecycleApiTests.cs`, `ContractRepository.InTransactionAsync`, `ValidFinalReadingAsync`, `ApiFactory.cs` và `CaptureFixture`. Chạy tests hiện có trước khi sửa bất cứ test nào.
3. Cùng owner F01 thêm/tái hiện accepted assignment create→durable record→retry. Nếu lỗi500 sau commit được xác minh, fix đúng owner scope sau thống nhất; regression1record/replay/conflict. Audit hiện tại chưa sửa nó.
4. Kiểm401/403/404, Staff hết assignment, wrong Tenant, missing signature/underpaid, tampered file, competing activation, duplicate bank reference. Existing fakes của signing/ledger phải được nêu trong TRX note.
5. **Cuối ngày:** Contract API real PG/MinIO evidence + known external blockers; bàn giao FE example requests/errors/idempotency headers. **Gate04/11:** Main transaction/isolation không có unresolved critical issue; nếu thiếu hạ tầng tiếp tục pure template tests nhưng không coi G02 đã đóng.

```powershell
docker ps --format '{{.Names}} {{.Image}} {{.Status}}'
# Chỉ khi Docker runner sẵn; build ảnh test, không gắn volume DB người dùng.
docker build -f deploy/docker/Minio.Dockerfile -t bhome/minio-local:2025-10-15 .
dotnet test tests/backend/BHome.IntegrationTests/BHome.IntegrationTests.csproj --no-build --filter 'FullyQualifiedName~Contracts.ContractLifecycleApiTests|FullyQualifiedName~LocationAssignmentApiTests' --logger trx
```

### 04/11/2026 — Bỏ blocker renderer đúng template được duyệt,6h

1. **PM1h:** chốt template version và signer identity/certificate mapping với PO/BA. Không có approval thì tạo mapping/spec và test của fields đã thống nhất, giữ renderer unavailable ở runtime.
2. **BE5h:** mở `ContractDocument` trong `ContractContracts.cs`, `ViettelMySignContractAdapter.PrepareAsync`, `UnconfiguredContractRenderer`, `DependencyInjection.cs`, `ContractPdfSigningCompositionTests.cs`. Thay registration chỉ khi approved renderer hoàn chỉnh; không sửa `IPdfSigner` để giải bài template.
3. Test deterministic content/snapshot correspondence, bounded/valid PDF, no arbitrary client terms after seal, tamper/integrity, missing template/provider failure remainsPending/503. Dùng synthetic CA để kiểm PDF, không real identity document.
4. **Cuối ngày:** renderer reviewable + tests và proposed OpenAPI/docs nếu DTO thay đổi; handoff required sandbox config qua secret store cho người quản lý provider. Không đưa credential vào report.
5. **Gate05/11:** approved rendered content match snapshot; no change to signed terms; synthetic two-party pipeline pass. Real MySign chỉ verified sau actual provider gate, không suy từ synthetic test.

```powershell
dotnet build src/backend/BHome.sln
dotnet test tests/backend/BHome.Application.UnitTests/BHome.Application.UnitTests.csproj --no-build --filter 'FullyQualifiedName~Contracts'
dotnet test tests/backend/BHome.IntegrationTests/BHome.IntegrationTests.csproj --no-build --filter 'FullyQualifiedName~ContractPdfSigningCompositionTests'
dotnet test src/digital-signing/tests/BHome.DigitalSigning.UnitTests/BHome.DigitalSigning.UnitTests.csproj --no-build
```

Nếu có renderer tests mới, bổ sung explicit filter theo class thực đã tạo ở lúc triển khai; không claim lệnh hiện tại đã bao phủ tên class tương lai.

## 10. FINAL ROADMAP & RISKS

### Roadmap có gate

| Mốc                                            | Trạng thái mục tiêu                                                               | Bằng chứng bắt buộc                                                                        | Giới hạn                                                                                                 |
| ---------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| 02–04/11                                       | Ready for Implementation theo branch requirements đã duyệt                        | D01/03/05/07, runner, ownership, approved template mapping                                 | Không bypass các OQ tiền/quyền                                                                           |
| 03–06/11                                       | Main Ready for Testing/Integration từng nhánh                                     | RealPG/MinIO TRX; synthetic vs real signing tách biệt                                      | BH16 chưaDone nếu Holding/provider còn thiếu                                                             |
| 09–16/11                                       | Invoice Ready for Testing rồi module integration                                  | Manual meter→Draft→Final, policy snapshots, duplicates/roles; job evidence nếu thuộc slice | D01/calendar chậm thì dời mốc, không chọn tự động                                                        |
| 17–24/11                                       | Payment manual/fake-feed integration-ready                                        | PG allocations/debt/history/retry/payer; approved shared model                             | Real bank external gate và notification không tự hoàn tất                                                |
| 25–30/11                                       | Reviewable increment; release/no-go theo actual gates                             | Full executed result list, style gates/PR review, carried-over P0 backlog                  | Đây không phải toàn bộ Huy scope Done                                                                    |
| Sau30/11, thêm70–150h hoặc capacity được duyệt | Holding, UC17, Adjustment, Settlement và external/system gates →Done từng package | G02H/G05/G06A/G06/G04B/G07/G08/G09                                                         | Earliest capacity-only16/12; upper04/01/2027 nếu6h/workday và chưa trừ nghỉ/lễ; lead time có thể kéo dài |

Mốc hoàn tất toàn dự án không xác định chỉ từ repo của Huy: còn module của thành viên khác, external accounts và acceptance. Không lấy milestone Huy làm ngày toàn BHOME production-ready.

### Risk register và phản ứng

| Risk                                                 | Owner đề xuất         | Trigger                                                 | Xử lý                                                                                                                                      |
| ---------------------------------------------------- | --------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Invoice identity/occupancy thay đổi                  | Huy PO proxy+BA       | D01 chưa ký hoặc đổi nhiều-tenancy sau schema freeze    | Stop affected design; review SRS/model, update estimates/DTO/migration; independent tests tiếp tục                                         |
| F01 assignment commit ảnh hưởng tenant/capture tests | BH08 owner+QA         | Tạo assignment trả500 nhưng record có                   | Tái hiện DB test, thống nhất fix nhỏ và replay semantics; không blanket retry write                                                        |
| Shared migration conflict                            | Migration coordinator | Hai branches đổi snapshot/Room.Status/OperationalTask   | Rebase on agreed base, generate merged migration tại một đầu mối, fresh+upgrade tests; không reset DB                                      |
| Real provider/template chưa sẵn                      | Provider owner+Huy    | D04/provider gate chưa đạt                              | Synthetic boundary đủ cho tests; label blockedReal; manual verified bank path vẫn cần approved evidence; không internal signing substitute |
| Thiếu account entitlement co-occupant                | BH13 owner+BA         | Muốn mọi Tenant xem cùngInvoice nhưng chưa user mapping | Approved mapping+access windows; tests formerTenant/foreignTenant; không map bằng Resident creator                                         |
| Overscope126h                                        | Huy TL+nhóm           | Estimates vẫn196–276h                                   | D07 thêm70–150h/tái phân công/mốc; giữP0, postpone nâng cao OCR tuning/UI polish thay vì core invariants                                   |
| Fake/mock bị báoDone                                 | Developer+QA+reviewer | Evidence chỉ UT/component/synthetic provider            | Gate evidence labels rõ; real DB/storage/provider acceptance riêng                                                                         |
| General notifications/jobs chưa có owner/schedule    | BH19 owner            | Queue có nhưng không handler/cron/recipient approved    | Freeze event keys/calendar/recipients; register actual handlers+retry; persistent channel trước external delivery                          |
| Style/IT gate thiếu bằng chứng                       | Huy/QA                | Local formatfail hoặcDocker down                        | Fix with file owner, don't disable gates; independent CI runner; giữNOT RUN nếu chưa chạy                                                  |
| Không có report5/tracker originals                   | Huy+QA                | Acceptance/reporting không thể đối chiếu                | Xin bản gốc qua kênh nhóm phù hợp, preserve versions, map actual TRX; không dùng template pass counts                                      |

Tính năng nâng cao có thể đề nghị hoãn: thêm vòng tinh chỉnh OCR/benchmark mở rộng, polish demo screens, dashboard What-if nâng cao ngoài phần core đang giao. Không tự giảm yêu cầu manual confirmation, server authorization, immutable Final, real bank verification, Holding payment gates, dual handover confirmation hoặc settlement correctness.
