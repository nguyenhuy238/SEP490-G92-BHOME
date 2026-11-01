# BH-41 — Yêu cầu và phê duyệt điều chỉnh hóa đơn

Đã triển khai Tenant gửi yêu cầu/ảnh private → Owner xem, Approve/Reject → correction Draft
hoặc effect riêng sau Final → số dư chung, payment/debt/QR và lịch sử cập nhật từ PostgreSQL.
Nguồn: SRS BF-06C/UC-24/§4.4, GBR-01/02/09/10/13/18, DBR-07 và yêu cầu BH-41 đã duyệt
trong phiên 01/11/2026. Xem [traceability](BH41_TRACEABILITY.md) và [API](../api/INVOICE_ADJUSTMENTS.md).
Chỉ commit local trên `member/QHuy`, không push/merge/deploy.

## Cấu trúc và migration

Tái sử dụng Invoice/InvoiceLine/InvoiceRecipients của BH-21, Payment Ledger/BankReferenceClaims
của BH-25, fixed permissions/Identity, SecurityAudit, MinIO/IObjectStorage và image validator hiện có.
Không thêm dependencies hoặc notification service khác.

| Migration                                       | Schema và bảo vệ                                                                                                                                                                                                                         |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20261101141539_InvoiceAdjustmentRequests`      | Requests, Evidence, Commands, Events; snapshot request bất biến; private evidence gắn invoice+uploader; command PK actor+key+operation; event PK requestId+name; unique object key; indexes invoice/requester+time, request+cleanupAfter |
| `20261101141930_InvoiceAdjustmentDecisions`     | Decisions; unique requestId, unique sequence, index invoice+stage+outcome; InvoiceLine thêm calculatedAmount/correctionRequestId + FK; decision append-only, check before/corrected/delta/effective                                      |
| `20261101142421_FinalInvoiceAdjustmentBalances` | PaidAtDecision numeric(28,0) cho tổng allocations; nâng DB validation của payment và Final adjustment theo cùng effective obligation                                                                                                     |

Tổng cộng 5 bảng mới: `InvoiceAdjustmentRequests`, `InvoiceAdjustmentEvidence`,
`InvoiceAdjustmentCommands`, `InvoiceAdjustmentEvents`, `InvoiceAdjustmentDecisions`.
Request/decision/command/event chống UPDATE/DELETE/TRUNCATE; linked evidence bất biến.
InvoiceLineId trên request là snapshot, không FK tới dòng Draft có thể được refresh thay ID;
ChargeCode giữ liên kết nghiệp vụ. Status Pending/Approved/Rejected suy từ decision duy nhất;
version 1 khi Pending, 2 khi có decision. Audit timestamps của request và DecidedAt giữ lịch sử.
Down migrations chặn xóa lịch sử và chặn rollback balance khi có effect Final.

Không sửa migration BH-21/BH-25 đã áp dụng. Không tắt trigger bất biến Final. Migration mới
thay hàm kiểm tra allocation để cộng delta Approved/Final; constraint unique bank reference và
dedup cọc↔invoice vẫn hoạt động.

## Tính tiền, correction và concurrency

```text
Effective Payable = Original Issued Amount + SUM(Approved Final Adjustment Delta)
Outstanding      = MAX(Effective Payable - Verified Allocations, 0)
Potential Excess = MAX(Verified Allocations - Effective Payable, 0)
```

Correction đã duyệt ở Draft nằm trong issued amount khi phát hành, không cộng lại như effect
Final. Tiền VND dùng decimal nguyên, DTO chuỗi; UI dùng BigInt để format, kể cả snapshot cũ
lớn hơn Number.MAX_SAFE_INTEGER. Không cho nghĩa vụ âm hoặc vượt giới hạn tiền hóa đơn.
Giữ DueDate gốc; không tự gia hạn hoặc tạo phí phạt.

- **Draft:** Owner nhập corrected amount cho charge hiện có. Backend tính delta và tổng,
  lưu quyết định/snapshot nguồn, tăng Invoice revision. Giá/chỉ số gốc không bị sửa. Refresh
  áp correction mới nhất theo ChargeCode khi fingerprint nguồn khớp. Khi nguồn đổi, hiển thị
  `draft_correction_source_changed`, không áp correction cũ và không cho Final. Owner kiểm tra
  nguồn mới và xử lý yêu cầu mới phù hợp. Finalize tiếp tục revalidate như BH-21.
- **Final:** Owner sửa charge hoặc tổng nghĩa vụ qua decision/effect riêng. Invoice.Total,
  lines, giá, chỉ số và snapshot recipient gốc giữ nguyên. Request không tự thực thi proposal.
- **Paid giảm:** allocations gốc giữ nguyên, Outstanding 0 và PotentialExcess cụ thể,
  ReviewStatus PendingReview; trace được issued/delta/paid/decision. Không tự hoàn tiền hoặc
  đưa credit sang hóa đơn khác. **Paid tăng:** nghĩa vụ mới trở thành outstanding; lần trả
  bổ sung đúng số dư được xác minh vào ledger hiện có, không sửa khoản trả trước.
- **Transaction:** adjustment dùng cùng advisory lock `bhome-payment-ledger-v1` với payment,
  rồi Room row lock; DB revalidate basis/paid/Final. Quyết định, correction/effect, command,
  audit và event commit cùng transaction. Approve/Reject race chỉ một decision.
- **Revision:** gửi expectedVersion, expectedInvoiceVersion, expectedFinancialVersion.
  FinancialVersion đếm Approved/Final effects; Draft dùng Invoice revision. Payment hiện tại
  được đọc lại dưới khóa ngay trước quyết định. Conflict cần tải lại, review và xác nhận lại.
  Cùng Idempotency-Key/payload replay không thêm request/decision/effect.

## Quyền và bằng chứng

Tenant phải có InvoiceRecipients trước khi submit/upload/read shared effect; quyền kỳ cũ
giữ nguyên sau khi Contract kết thúc. Chỉ requester và Owner xem request, reason, proposal,
decision reason và ảnh. Co-Tenant xem summary approved/effective balance chung, không thấy
request cá nhân. Staff không submit/approve/read request; debt chỉ có dữ liệu operational ở
Location hiện được phân công. Tài khoản Staff+Tenant cũng không được đọc full finance của
invoice ngoài entitlement Tenant.

PNG/JPEG tối đa 5 MiB/ảnh, 5 ảnh/request; decode/header/dimensions được server kiểm tra.
Upload lưu intent trước khi gọi MinIO; lỗi không cho gắn ảnh thiếu. Orphan chưa gắn request
được cleanup kỹ thuật sau 24 giờ, theo batch có khóa; ảnh đã link không bị cleanup.
API download xác thực từng lần, không public URL/object key. Không tải ảnh giấy tờ cá nhân.
Native tái sử dụng CameraCapture/review; Mobile Web chọn ảnh, xem trước và bấm upload.
Ảnh xem trước dùng bộ nhớ tạm, object URL được thu hồi khi đổi ảnh/unmount.

## Chạy môi trường và chuẩn bị demo

Yêu cầu .NET 8, Node >=22.13 và <23, dependencies đã restore/install, Docker với PostgreSQL
và MinIO theo compose hiện có. Chạy từ root, dừng API demo đang dùng output build trước khi
rebuild. Không reset database/volumes.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Initialize-ContractDemo.ps1
dotnet build src/backend/BHome.sln --no-restore -m:1 -nr:false
```

Initializer có guard Development/Testing, PostgreSQL loopback/database `bhome_contract_demo`,
MinIO loopback/bucket `contract-demo`, signing Simulated. Áp migration và seed cơ sở riêng
**BHOME ADJUSTMENT DEMO** (GUID prefix `fa410000`), không thay đổi records BH-21/BH-25.
Sau đó mở ba terminal:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Start-ContractDemo.ps1 -Component Api
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Start-ContractDemo.ps1 -Component OwnerWeb
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Start-ContractDemo.ps1 -Component MobileWeb
```

API mặc định `http://localhost:5540`/`https://localhost:7540`, Owner `http://localhost:5517`,
Mobile Web `http://localhost:5581`. Trust certificate local theo hướng dẫn Contract/Mobile.

```powershell
node scripts/Seed-AdjustmentDemoWorkflow.cjs
node scripts/Test-AdjustmentDemo.cjs
```

Browser smoke dùng Edge + Playwright tại `.tools/contract-browser` hoặc dependency local;
`BHOME_TEST_BROWSER` chọn executable khác. Scripts chỉ chạy localhost, không intercept API.
Nếu đổi cổng, cấu hình clients/CORS/AuthWeb và đặt `BHOME_ADJUSTMENT_DEMO_API`,
`BHOME_ADJUSTMENT_DEMO_WEB`, `BHOME_ADJUSTMENT_DEMO_MOBILE`. Phiên kiểm chứng dùng API
5543/7543, Owner 5519, Mobile 5583 để giữ nguyên các tiến trình khác.

Tài khoản: `owner.contract.demo@example.invalid`, `staff.contract.demo@example.invalid`,
`tenant1.contract.demo@example.invalid`, `tenant2.contract.demo@example.invalid`,
`tenant3.contract.demo@example.invalid`. Mật khẩu local do initializer sinh tại
`.tools/contract-demo/runtime.json`, trường `BHOME_DEV_TEST_PASSWORD`; không commit/chia sẻ
file hoặc token. Scripts không in credentials. Không chuyển tiền thật vào tài khoản tổng hợp.

| Phòng          | Trạng thái sau seed                                                                   | Sau browser smoke                                                             |
| -------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| ADJ101-PENDING | Draft, request Pending của A, ảnh private                                             | Giữ mẫu chờ duyệt                                                             |
| ADJ102-DRAFT   | Draft, RENT 3.000.000 → 2.990.000; tổng 3.109.250                                     | Giữ mẫu correction đã duyệt                                                   |
| ADJ103-FINAL   | Original 3.119.250, effective 3.099.250; có request Rejected                          | UI duyệt thêm giảm 10.000 → effective 3.089.250, original giữ nguyên          |
| ADJ104-EXCESS  | Đã xác minh 3.119.250; giảm 10.000 → effective 3.109.250; excess 10.000 PendingReview | A/B/C cùng thấy balance, không tự refund                                      |
| ADJ105-UI      | Draft 3.119.250 để thao tác                                                           | RENT → 2.995.000; tổng 3.114.250, một request Approved và một Rejected qua UI |

Mỗi phòng có ba Tenant/hợp đồng riêng, một bill chung. Seed Contract/signing/activation,
readings/evidence, Invoice và Payment đi qua API hiện có. Payment mẫu là xác minh sao kê
tổng hợp Development, không có callback ngân hàng giả hoặc refund confirmed. Seed chạy lặp
tìm fixture/request/decision đã có, không reset hoặc ghi đè lịch sử. Thao tác demo có thể để
lại Approved/Rejected; chạy lại không đưa về Pending. Khi chuyển tháng hoặc thay đổi fixture
bằng thao tác khác, cần một môi trường demo cô lập mới để có bộ kịch bản ban đầu.

## Thao tác thủ công

1. Tenant A mở **Hóa đơn & Thanh toán**, chọn ADJ105 hoặc ADJ101. **Yêu cầu điều chỉnh**,
   chọn charge hoặc yêu cầu chung, nhập lý do/giá trị đề xuất tùy chọn, đính kèm ảnh và submit.
   Số tiền chưa đổi. Chỉ thấy lịch sử yêu cầu của mình.
2. Owner mở **Điều chỉnh hóa đơn** (hoặc link từ chi tiết Invoice). Lọc cơ sở/phòng/mã
   invoice/status, mở request, xem snapshot lúc gửi, giá trị hiện hành, ảnh và financials.
3. Owner nhập corrected amount/lý do, xác nhận đã kiểm tra và Approve qua dialog. Draft
   yêu cầu charge; Final hỗ trợ toàn nghĩa vụ. Backend tính delta và trả kết quả.
4. Tenant tải lại Invoice/kết quả; thấy Owner decision, lý do và amount mới. Co-Tenant nhìn
   summary tài chính đã duyệt; không truy cập reason/ảnh riêng bằng cách đổi ID.
5. Owner Reject một request với lý do: số tiền và payments giữ nguyên, Tenant xem lý do.
6. Xem ADJ104: so issued/effective/verified/excess. Mọi khoản thừa đang review; không có
   nút báo hoàn tiền thành công. Với Paid tăng, dùng luồng BH-25 xác minh phần dư nợ mới.
7. Gặp 409: tải lại và review revision mới, không bấm lặp một quyết định đã hoàn tất.

## Kiểm chứng developer ngày 01/11/2026

| Check đã chạy                                                                                | Kết quả                                                                                           |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Backend build                                                                                | PASS, 0 warnings/errors                                                                           |
| Non-Docker backend                                                                           | PASS 437: Application 173, Domain 83, Integration 181                                             |
| PostgreSQL/MinIO regression PaymentLedger + InvoiceApi + CaptureWorkflow + ContractLifecycle | PASS 56/56 sau hardening                                                                          |
| MigrationConsistencyTests                                                                    | PASS 3/3, không model drift                                                                       |
| Owner Web                                                                                    | PASS 85 tests, build/typecheck/lint                                                               |
| Mobile                                                                                       | PASS 240 tests, typecheck/lint; iOS và Android export                                             |
| Seed và rerun                                                                                | PASS, history/effects không trùng                                                                 |
| Browser/API/DB/storage thật                                                                  | PASS: submit/ảnh private, Draft approve, Final approve, reject, shared excess, original immutable |
| Formal ST/AT, thiết bị/camera native thật, ngân hàng/refund thật, load/recovery              | NOT RUN                                                                                           |

Logs `.tools/bh41-*.log`, fixture `.tools/contract-demo/adjustment-fixture.json`, kết quả
`adjustment-browser-results.json` và các ảnh `adjustment-*.png` được giữ local/bị gitignore.
Browser smoke hỗ trợ chạy lại trên kết quả đã lưu. API/integration tests xác minh replay/race,
IDOR, historical access, Staff+Tenant scope, upload lỗi/orphan cleanup, source change,
Final immutability và payment trước/sau adjustment. Không tuyên bố coverage/ST/AT sign-off.

Lệnh backend dùng `--artifacts-path .tools/bh41-checks` để không ghi đè DLL API đang chạy;
chọn output khác nếu API đang dùng chính thư mục đó. Ví dụ:

```powershell
dotnet test src/backend/BHome.sln --artifacts-path .tools/bh41-checks --filter 'Category!=Docker'
dotnet test tests/backend/BHome.IntegrationTests --artifacts-path .tools/bh41-checks --filter 'FullyQualifiedName~PaymentLedgerTests|FullyQualifiedName~InvoiceApiTests'
npm.cmd --prefix src/owner-web test
npm.cmd --prefix src/owner-web run build
npm.cmd --prefix src/owner-web run lint
npm.cmd --prefix src/mobile test
npm.cmd --prefix src/mobile run typecheck
npm.cmd --prefix src/mobile run lint
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Export-ContractDemoMobile.ps1
```

Đảm bảo Node 22 thực sự chạy test worker. Lượt đầu chạy qua npm dùng global Node 24 làm
12 tests Expo startup thất bại; đã chạy lại trực tiếp bằng Node 22, 240/240 PASS. Không sửa
startup module ngoài phạm vi. Đã đối chiếu [Expo Crypto SDK 58](https://docs.expo.dev/versions/v58.0.0/sdk/crypto/)
cho randomUUID, tái sử dụng dependency hiện có.

## Bàn giao và phần còn chờ

- **Implemented / Demo Ready:** request/decision/correction/effect, financial projection,
  Owner Web, Tenant Mobile, private evidence, audit/events và fixture cô lập.
- **Awaiting Tester:** formal ST/AT; thiết bị iOS/Android thật, accessibility/responsive,
  điều chỉnh nhiều vòng, stress/race/recovery và private-file lifecycle ở môi trường triển khai.
- **Notification Pending:** `invoice.adjustment.requested.v1` và `invoice.adjustment.decided.v1`
  được lưu cùng transaction, key requestId+name, payload `{requestId,invoiceId,requesterId,occurredAt}`.
  Consumer BH-19 cần inbox/delivery key event+recipient+channel, lấy Owner/requester từ server,
  không đưa reason/ảnh vào notification. Chưa gửi in-app/push/email; delivery failure không
  rollback financial effect. Không sửa worker/shared notification module.
- **Business Decision Pending:** OQ-02 categories/thresholds chưa có baseline đầy đủ; mọi
  request hiện qua Owner theo quyết định BH-41. Refund/credit/settlement/OQ-01/05 còn chờ;
  chỉ giữ excess PendingReview có số tiền và trace, không tự tạo refund hoặc credit.
- **Blocked External Integration:** bank/signing production boundaries của BH-25/Contract
  vẫn cần specification/credentials/verification riêng; không chặn adjustment thủ công.

Tiếp theo: BH-40 — Renewal, Early Termination & Move-out Financial Settlement, dùng effective
obligation và excess của BH-41 cùng verified payments BH-25; giữ các guard quyết toán trước
khi kết thúc hợp đồng hoặc giải phóng phòng, chờ quyết định deduction/refund còn thiếu.
