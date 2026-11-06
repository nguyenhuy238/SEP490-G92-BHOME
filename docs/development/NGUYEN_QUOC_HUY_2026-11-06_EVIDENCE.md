# BHOME — bằng chứng triển khai và bàn giao 06/11/2026

Phạm vi Nguyễn Quốc Huy, nhánh `member/QHuy`. Tài liệu này là gói bằng chứng để team chuyển vào
Report 2/3/4/5/7, không thay yêu cầu SRS hoặc kết quả nghiệm thu chính thức. Lịch sử slice, lệnh,
lỗi đã sửa và SHA đầy đủ: [báo cáo triển khai](NGUYEN_QUOC_HUY_E2E_IMPLEMENTATION.md).
[API status](../api/API_IMPLEMENTATION_STATUS.md), [inventory runtime](../api/API_RUNTIME_ROUTES.md).

**Bổ sung kiểm tra khi cập nhật báo cáo tiến độ, HEAD `8f5c751`:** đã chạy lại Domain 90,
Application 276, Integration 626 pass/1 OCR skip, Digital Signing 41 và Mobile 381. Owner Web full suite
mới có 154 pass/1 timeout 15 giây; riêng file router chạy lại 37/37 pass, không sửa code/timeout.
Owner build/lint và Mobile typecheck/lint đạt. Đây là lượt khác với final regression phía dưới;
không đổi kết quả lịch sử thành kết quả mới hoặc cộng dồn hai lượt. Log mới nằm tại
`.tools/progress-review-20261106/`, có TRX và manifest audit 216 routes; cluster test riêng đã dừng.
Xem [báo cáo tiến độ nhóm/cá nhân và phụ lục kiểm chứng](../reports/BHOME_PROGRESS_REPORT_NGUYEN_QUOC_HUY_2026-11-06.md).

## Report 2 — tiến độ, rủi ro và phân công

| Phạm vi | Đã triển khai | Giới hạn bàn giao |
| --- | --- | --- |
| BE-19 / BE-X07 | Calculation nguồn thật; Owner inspection review; quyết định TenantDamage có ảnh; hoàn cọc đầy đủ hoặc phần còn lại; private proof/manual verification; review/close/Room release; in-app events | Tổng task PARTIAL: native/provider acceptance chưa có; không bù nợ trực tiếp bằng cọc, thu phí vượt cọc hoặc suy nghĩa vụ thiếu dữ liệu |
| BE-14 Holding | Giữ boundary/activation/transfer guards đã có | BLOCKED OQ-03/Q-H1: validity, payment deadline, chuyển/hoàn tác Holding deposit chưa có nội dung quyết định; không chọn deadline thay Owner |
| BE-15/16/X06 | Main canonical PDF, signing adapter/guards và Development simulation được giữ; kiểm unit signing | MySign staging, ownership/trust profile/mẫu Production được duyệt chưa có bằng chứng cấu hình; simulation không phải chữ ký pháp lý; renewal provider/native E2E chưa đạt |
| BE-17/20/21/22/23/24/25 | Component/shared client, Owner browser + Staff/Tenant MobileApi và ledger regression | Android/iOS native NOT RUN; chưa có adb/device. Không có dataset độc lập >=50 ảnh để kết luận OCR>=90%; bank-provider acceptance chưa có |
| BE-31/32/33/34/X08 | Invoice/OPEX/report/capital/What-if hiện hữu; thêm phân loại deposit principal và report note | Không tự sinh payroll/Work Order. Retained damage chưa nhập operating profit/recovery; chưa liability/compensation accounting hoặc UI review chính thức |
| BE-X04/X05 | Runtime Compact24, schema/migration/rollback tests hiện hữu | Không pilot dữ liệu legacy thực/working `bhome`; chỉ disposable synthetic fixtures |

Owner Web: **Vũ Xuân Trường** review UX. Mobile: **Bùi Bảo Long** nghiệm thu thiết bị.
QA: **Nguyễn Quang Huy** chuyển evidence vào test documents và tổ chức ST/AT.
Không push/merge; không sửa database làm việc hoặc tạo business table mới.

## Report 3 — truy vết yêu cầu và quyết định triển khai

Baseline có sẵn: `docs/reports/BHome_Report-3_Software Requirement Specification (2).docx`;
SDS `Report-4_Software Design Specification (5).docx`. Bản gốc được giữ nguyên.

| Nguồn | Hành vi được kiểm | Mã/bằng chứng |
| --- | --- | --- |
| UC-19; SRS flow trả phòng p1833–1840; GBR-01/02/18 | Owner xem invoice/readings/inspection/source hiện hành; nghĩa vụ chưa giải quyết không close | ContractSettlementLedger/SettlementCalculator; ContractSettlement/Closure tests; Verify-MoveOutClients |
| UC-19; OQ-01/05 theo ủy quyền trong phiên | Owner quyết định thiệt hại dựa inspection/proof; giới hạn available; version/key/revision; không auto phí/phạt | DepositDeductionService, repository/evidence; DepositDeductionTests; DEPOSIT_DEDUCTIONS.md |
| BF-06/UC-22..25; GBR-10/18 | Principal/excess sources riêng; manual external return; Completed sau proof/readback; concurrency/recovery | RefundService/Repository; DepositRefund/Recovery/Compact24Refund tests |
| DBR-06/07; GBR-10 | Không sửa Final Invoice/allocations khi trả cọc hoặc quyết định thiệt hại | DepositDeduction/Refund PG và browser assertions |
| FE-08/UC-31..34; GBR-15/16 | Report phân biệt Invoice collections/OPEX/cọc; What-if giữ snapshot, không mutate ledger | FinancialReport/Scenario tests; FinancialReportRefunds; Owner Reports UI |
| UC-35/36; JOB-04; GBR-01/02/18 | Persistent recipient inbox, no private payload, dedupe, target reauthorization, delivery không rollback finance | SettlementNotificationPublisher; MoveOutNotification/NotificationDelivery/Inbox tests |

Người dùng đã ủy quyền: “nếu chưa có hãy triển khai theo hướng của bạn và báo cáo cho tôi” đối
với OQ-01/02/05. Quyết định ở đây là lựa chọn triển khai được báo cáo, không ghi thành SRS đã sửa:

- Thiệt hại do Owner nhập/duyệt, lý do `TenantDamage`, có linked inspection proof, tổng không vượt
  cọc; không tự định mức bồi thường. Owner xác nhận chưa tính trên Invoice; không có semantic
  matching để tự nhận biết hai mô tả con người nhập là cùng một phí.
- Cọc được giữ nguồn riêng; không suy representative là người nộp. Owner đối chiếu depositor và
  statement trước request/approval/execution. Không tự payout, lãi hoặc deadline hoàn tiền.
- Tiền thừa receipt chưa phân bổ vẫn gắn nguồn, hoàn qua flow riêng. Raw legacy `COMPLETED` không
  đủ bỏ pending review hoặc authorization closure dù tổng tiền bằng đúng nghĩa vụ.
- Không có phép bù debt bằng cọc/thu vượt cọc ở API deduction này. Nghĩa vụ hóa đơn phải đi qua
  payment/adjustment hiện hữu; thiếu dữ liệu giữ pending, không tự chia shared room debt cho Tenant.
- Hoàn gốc được phân loại riêng với Invoice/OPEX. Khoản giữ cọc bồi thường chưa cộng vào profit/
  net/recovery hiện hành; đây là mô hình quản trị nội bộ, không kết luận nghĩa vụ kế toán/thuế.

OQ-03 vẫn ghi Open tại SRS p3784–3788. Ủy quyền OQ-01/02/05 không cung cấp validity/payment deadline
Holding. Không tái hỏi phê duyệt tài chính đã được ủy quyền, cũng không tự mở rộng sang OQ-03.

## Report 4 — thiết kế thực tế

Runtime giữ ASP.NET Core/EF Core/PostgreSQL và Compact24: **24 bảng nghiệp vụ**, không thêm migration
hoặc cột. Các DTO/domain types mới không phải bảng vật lý mới.

- `contracts.history`: append-only `DepositDeductionV1` có actor/version/reason, inspection/source,
  items, evidence SHA256/length và idempotency metadata. Revision thay bản hiện hành, giữ bản cũ.
- `refund_requests`: source payment hoặc source deposit contract loại trừ nhau; state/history
  `ExcessReceiptRefundV1`/`SecurityDepositRefundV1`, reservation, quyết định và upload intent bền vững.
- Lock order payment ledger → Location → Room; optimistic version/reference và operation UUID.
  Không sửa plan sau reservation/return. Unknown/inconsistent sources không được thay thành zero.
- Obligation reference giữ inputs tài chính/inspection; financial reference gắn plan nhưng không
  tự stale vì reservation/completion của chính khoản hoàn. Closure còn kiểm actual private proof.
- Upload intent được ghi trước Put; readback/hash khớp mới durable Completed. Cùng metadata/key/
  bytes phục hồi sau timeout; không tạo bank success từ UI. Storage là private, download có auth.
- `notifications` lưu inbox/publication marker hiện hữu. Async publisher đọc committed histories;
  unique keys và transaction chống trùng; thông báo generic dẫn Contract chỉ cho Owner/Tenant có
  entitlement. Không gửi Staff/đồng cư trú thông tin tài chính; provider mặc định Unconfigured.
- `verifiedDepositReturns` là subtotal nguồn đã phân loại trong kỳ Việt Nam/phạm vi, loại demo.
  Report đọc metadata đã được workflow xác minh, không tải lại mọi file khi render report. Nguồn
  unknown giữ unavailable guard; không chuyển principal thành OPEX/doanh thu.

Hợp đồng API chi tiết: [deductions](../api/DEPOSIT_DEDUCTIONS.md), [refunds](../api/REFUNDS.md),
[finance](../api/FINANCE.md), [notifications](../api/NOTIFICATIONS.md).

## Report 5 — kết quả chạy và tái hiện

Kết quả final regression trên mã mới, 06/11/2026:

| Gate | Đã chạy | Log local `.tools/` |
| --- | --- | --- |
| Domain | 90/90 pass | huy-continue-domain-full.log |
| Application | 276/276 pass | huy-continue-application-full.log |
| Integration | 626 pass, 1 optional real-OCR skip, 0 fail / 627 total | huy-continue-integration-rerun.log |
| Digital Signing unit | 41/41 pass | huy-continue-signing-full.log |
| Owner Web | 155/155 pass; build/lint pass | huy-continue-owner-{full,build,lint}.log |
| Mobile | 381/381 pass; typecheck/lint pass | huy-continue-mobile-{full,typecheck,lint}.log |
| Browser có thiệt hại | 22/22 nhóm pass, exit0 | huy-final-damage-browser.log |
| Browser không khấu trừ | 21/21 nhóm pass, exit0 | huy-final-undisputed-browser.log |
| Harness build | 0 warning/error | huy-final-harness-build-rerun.log |
| Runtime audit, nằm trong integration | 6 pass; 216 routes, 211 protected401, 106 Owner GET, 0 HTTP5xx | continue-final-evidence/api-route-audit.json |

Full integration lần đầu có 603 pass/23 lỗi fixture constructor/1 skip. Đã sửa public parameterless
constructor cho xUnit, 24 affected/recovery tests pass rồi chạy lại toàn suite như bảng. Một lượt
build harness chạy khi testhost giữ DLL bị Windows chặn copy; build lại tuần tự đạt, không nới
timeout/assertion hoặc thay business behavior. Node syntax và git diff --check đạt;
**611 liên kết file nội bộ/18 Markdown files** hợp lệ; inventory tái sinh từ audit cuối có235 static
callsites và3 wrapper động cần đối chiếu. Cluster PostgreSQL test riêng55440 đã dừng sau khi kiểm
không còn database fixture; không dừng PostgreSQL làm việc của dự án.

Log local/ignored `.tools` không chứa credentials thật và không phải artifact được commit. QA cần
lưu run evidence vào pipeline/test repository khi nghiệm thu chính thức; chưa chạy remote CI.

Commands chính (từ repository root, Node22 và disposable PostgreSQL đã cấu hình):

```powershell
dotnet test tests/backend/BHome.Domain.UnitTests --no-restore
dotnet test tests/backend/BHome.Application.UnitTests --no-restore
dotnet test tests/backend/BHome.IntegrationTests --no-restore
dotnet test src/digital-signing/tests/BHome.DigitalSigning.UnitTests --no-restore
npm.cmd run test --workspace src/owner-web -- --maxWorkers=1
npm.cmd run build --workspace src/owner-web
npm.cmd run lint --workspace src/owner-web
npm.cmd run test --workspace src/mobile -- --maxWorkers=1
npm.cmd run typecheck --workspace src/mobile
npm.cmd run lint --workspace src/mobile
dotnet build tools/BHome.ContractVerification --no-restore
dotnet run --project tools/BHome.ContractVerification --no-build -- --finance --main-draft
dotnet run --project tools/BHome.ContractVerification --no-build -- --finance --main-draft --damage-settlement
```

Không build lại assemblies khi testhost/harness đang dùng DLL trên Windows; chạy các bước .NET
tuần tự. PostgreSQL test là cluster riêng loopback, fixtures tạo/xóa database riêng; không dùng
production credentials hoặc working `bhome`. Harness tự dọn MinIO/API/browser/temp files.

Browser dùng actual Owner build/API/Compact24/MinIO. Staff/Tenant dùng shipped MobileApi/shared
transport. Bank statements/signing là synthetic; không chuyển tiền thật. Worker tắt; explicit
Testing-only event pump nếu được dùng chỉ chứng minh inbox, không chứng minh scheduling/delivery.

Native test cần chạy: Staff đúng Location chụp Final reading và inspection → sửa input kiểm consent
reset → Owner Web review/plan/refund với proof → Tenant đọc status/breakdown/inbox → Owner review
settlement/complete → Room Available. Negative: Staff ngoài Location, Tenant khác, stale summary,
pending refund, storage failure, duplicated callback/key; không dùng dữ liệu định danh thật.

Không báo coverage, p95/NFR, OCR>=90%, ST/AT pass rate hoặc native/provider acceptance nếu chưa đo.
Một optional real-model OCR integration skip phải ghi **SKIP**, không quy đổi thành pass.

## Report 7 — nội dung chuyển vào final project document

Demo có thể trình bày hai nhánh manual settlement: trả đủ cọc hoặc Owner duyệt thiệt hại có ảnh
rồi hoàn phần còn lại, kiểm history/Invoice immutable/private download và Room release. Thuyết
minh tách rõ simulation, xác minh thủ công và provider thật. Report Finance không trộn cọc/OPEX.

Report 2/3/4 bản DOCX có trong `docs/reports`; chưa thấy Report 5/7 template được cung cấp ở đó.
Gói Markdown này là đầu vào chuyển báo cáo, không phải đã sửa/xác nhận bản báo cáo chính thức.
Giữ task PARTIAL/BLOCKED theo bảng tiến độ; frontend owners và QA thực hiện review/acceptance còn lại.
