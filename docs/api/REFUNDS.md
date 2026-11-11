# Hoàn tiền thủ công — receipt thừa và cọc không khấu trừ

## 11/11/2026 — Tenant xem hoàn tiền của chính mình

`GET /api/v1/tenant/refunds?page=1&pageSize=20` chỉ dành cho Tenant. Quyền theo `refund_requests.beneficiary_resident_id → residents.user_id` hiện được liên kết với authenticated user; không theo RoomId hiện tại. Áp quyền trước count, sort và pagination; page >= 1, pageSize 1..100, chặn overflow. Chỉ đọc các workflow refund đã phân loại, không expose legacy chưa đối chiếu.

Response `PagedResult` với items `{id,amount,sourceKind,status,requestedAt,decidedAt,executedAt,isDevelopmentDemo}`. `amount` chuỗi VND; sourceKind ReceiptExcess/SecurityDeposit/HoldingDeposit; status REQUESTED/APPROVED/REJECTED/COMPLETED. Không có lý do nội bộ, actor, payer khác, bank reference, upload intent, object key hoặc endpoint tải chứng từ. Owner/Staff không dùng route Tenant này; Tenant vẫn không được dùng các mutation/evidence Owner. Không nhận userId/residentId từ client để chọn chủ hồ sơ.

Tenant Mobile: Hóa đơn & thanh toán → Lịch sử → Xem hoàn tiền của tôi. Đã duyệt hiển thị chờ thực hiện, chỉ COMPLETED có thời điểm thực chi; tải lại, trang tiếp, empty/error/retry riêng. Loader kiểm hợp đồng dữ liệu và chỉ giữ trường Tenant. Có thể xem sau physical release, không tạo financial state mới. Slice không thêm migration, không gọi bank hoặc sửa dữ liệu làm việc. Nội dung lịch sử bên dưới ghi lại các giới hạn tại thời điểm cũ; endpoint/màn hình này thay thế giới hạn thiếu Tenant refund history.

## 11/11/2026 — Giao dịch dư toàn bộ sau khi nghĩa vụ đã đủ tiền

BR-17/18/19/23, BF-06, UC-22/25, GBR-10/18. Owner dùng:

- `GET /api/v1/payment-transactions/{id}/excess-disposition` để đọc quyết định đã lưu (chưa có trả null/204).
- `GET .../excess-disposition/context?invoiceId=...`, hoặc `settlementContractId=...&receivableId=...`, hoặc `holdingContractId=...` để lấy số liệu đối chiếu. Chỉ một loại đích mỗi lần.
- `POST .../excess-disposition` với `{target,expectedReference,payerResidentId,reason,humanConfirmed:true}` và UUID `Idempotency-Key`.

Backend yêu cầu receipt VERIFIED/VND, đúng tham chiếu đích, nghĩa vụ không còn phải trả, nguồn chưa phân bổ/claim/refund/rejected, cùng chế độ dữ liệu. Người thực trả phải là Resident Verified có quan hệ hợp lệ với đích; Holding cho phép Resident chưa có User. Confirmation binds receipt fingerprint, balance và payer choices; stale context hoặc key dùng với nội dung khác bị chặn. Quyết định bất biến `ReceiptExcessDispositionV1` và `BankReferenceClaim` được ghi trong cùng transaction. Không tạo allocation 0, không ghi thêm doanh thu hoặc Tenant Credit.

Sau xác nhận, dùng các route receipt refunds request/decision/execution hiện hữu. Chỉ người thực trả trong disposition được nhận; chỉ bằng chứng thực chi hoàn tất mới giảm số còn phải hoàn. Trạng thái receipt `ExcessRefundPending` → `ExcessRefundCompleted`; partial return vẫn Pending. Không được reject/phân bổ lại receipt đã xác nhận. Invoice pending review và settlement unresolved giữ nghĩa vụ này đến khi hoàn đủ, kể cả sau physical release.

Migration SQL-only `20261111060000_ReceiptExcessDisposition` thêm native allocation guard; fresh DDL đồng bộ, vẫn 24 bảng, không thay EF model. Guard ngăn reuse receipt được claim hoặc phần tiền đã reserve/refund. Không migrate database làm việc.

Owner Web: mục Thanh toán lọc hai trạng thái hoàn toàn bộ; invoice picker có lựa chọn hóa đơn đã đủ tiền; ReconcileTransfer/SettlementBankPanel/HoldingDepositPanel dùng context thực và chọn người theo nhãn. Việc xác nhận chưa phải đã hoàn tiền. Payer bên ngoài không có Resident hợp lệ và Main Deposit overage còn cần nhánh riêng; không tạo hồ sơ giả hoặc tự chọn representative. Tenant refund history được bổ sung ở mục trên. Provider bank thực và browser/native E2E chưa được xác nhận.

Cập nhật **06/11/2026**, triển khai `12043f0`, UI recovery `17c4228`. [Trạng thái bàn giao](API_IMPLEMENTATION_STATUS.md),
[Payment](PAYMENTS.md), [Finance](FINANCE.md). Đây là API đã triển khai trên Compact24, không phải đề xuất.

## Bổ sung hoàn cọc không khấu trừ — BE-19/BE-X07

Backend mới có [plan khấu trừ TenantDamage](DEPOSIT_DEDUCTIONS.md): nguồn deposit trả
`depositDeductions`; sau Owner approval có thể hoàn phần còn lại bằng `expectedDeductionPlanId`,
`deductionsConfirmed:true`, `noDeductionsConfirmed:false`. Guard/hash/approval/execution hiện hữu
được giữ. Phần mô tả bên dưới là nhánh không plan; UI có phí được nối ở slice sau.

GET/POST `/api/v1/contracts/{id}/deposit-refunds`, Owner-only. Dùng Security Deposit root của
renewal chain, không dùng source_payment_id receipt. Không thêm bảng/cột. Chỉ khả dụng khi Contract
Active, Owner đã duyệt termination/inspection và xác nhận NoAdditionalCharges, mọi kỳ invoice
Final/paid, final readings đã billed/khớp, không dispute/bank/excess review, không holding hoặc
deposit allocation chưa phân loại. GET vẫn trả balances và `blockers` khi chưa đủ điều kiện;
mutation trả 409. Hư hỏng/khấu trừ có phí vẫn pending, không tự đặt phí bằng 0.

GET dùng RefundSource chung với `sourcePaymentId:null`, `sourceDepositContractId` là root,
`verifiedDepositAmount` chuỗi VND (không gọi cọc là excess: `excessAmount="0"`), `refundedAmount`,
`reservedAmount`, `availableAmount`, `financialReference`, `blockers`, `beneficiaries`, `requests`.
Beneficiaries là occupants Verified/liên kết tài khoản trong Contract, chưa phải bằng chứng ai
đã nộp cọc. Owner bắt buộc đối chiếu khoản nộp/người nhận; không tự chọn representative.

POST body `{refund:{beneficiaryResidentId,amount,reason,humanConfirmed:true},expectedFinancialReference,
beneficiaryVerified:true,noDeductionsConfirmed:true}` + UUID Idempotency-Key. Owner xác nhận người
nhận chính là người nộp theo bằng chứng đã kiểm và không khấu trừ; attestation/reference giữ trong
append-only history `SecurityDepositRefundV1`. Cho phép partial return trong giới hạn khả dụng.
Quyết định/execution/evidence dùng ba route `/refund-requests/{id}/...` hiện hữu, cùng
version/key/hash/private storage/recovery guards. RefundView có `sourcePaymentId:null`,
`sourceDepositContractId` khác null. Hai nguồn là loại trừ nhau, không tự chuyển khoản.

`financialReference` giữ invoice/payment/inspection/deposit inputs, tách khỏi reservation/Completed
của chính refund để không tự làm stale approval. Nghĩa vụ đổi thì approve/execute bị chặn; Reject
vẫn giải phóng reservation. `summary.reference` đầy đủ vẫn đổi khi reserve/execute, được Owner xem
xét trước settlement/complete. Chỉ khi hoàn toàn bộ cọc bằng workflow được phân loại, không còn
reservation, tổng nguồn khớp và mọi guard khác đạt, summary trả `approvedDeductions="0"`,
`refundAmount` đúng tổng, `transferVerificationStatus="VerifiedManual"`. Owner còn phải review
settlement rồi complete; ngân hàng không được gọi tự động.

Completed cũ/khác workflow hoặc thiếu marker/reference/evidence không bỏ blocker dù tiền bằng
đúng cọc. Finance hiện giữ unclassified-refund guard cho deposit; không coi hoàn cọc là OPEX.
Owner Web đã nối từ ContractLifecyclePanel vào RefundPanel theo nguồn SecurityDeposit, dùng shared
client thật. Hiển thị số cọc từ server, người nhận không tự chọn, bắt buộc ba xác nhận về nguồn/người
nộp/không khấu trừ; snapshot hoặc số dư đổi phải xác nhận lại. Available null hiện Chờ đối chiếu,
không đổi thành 0. Blockers chặn create/approve/execution; Reject vẫn mở để giải phóng reservation.
Owner review settlement và NoAdditionalCharges gắn reference/inspection version đang hiển thị.
Sau Contract lifecycle decision hoặc bấm tải lại quyết toán, Owner Web invalidate đúng cache nguồn
cọc của Contract, kể cả trong staleTime 10 giây của PortalProvider; không giữ eligibility cũ hoặc
invalidate nguồn receipt/Contract khác. Regression focused sau sửa cache **21/21 đạt**, build/lint đạt.
Tenant xem authorized summary,
không có quyền duyệt/execution/tải private proof. Native/provider acceptance chưa chạy.

Slice mới: Unit **13/13**, PostgreSQL **18/18** (12 workflow/refund/source/closure + 6 API audit),
0 skip. Có duplicate/parallel approval, stale source, reject reservation, gián đoạn sau Put/recovery,
đổi bytes bị chặn, Completed replay, unknown full refund không release, Tenant/Staff denial và
Contract closure. Data/storage là fixtures tổng hợp; chưa phải browser/MinIO/native acceptance
cho nguồn cọc mới.

Owner UI slice: focused Refund/Payments/Lifecycle **20/20 đạt**, Owner build/lint đạt, Mobile
typecheck shared DTO/client đạt. Chưa chạy full browser nguồn cọc tại thời điểm commit UI;
handoff Vũ Xuân Trường, native/provider acceptance vẫn chưa chạy.

Mobile Tenant nay hiển thị calculation cọc đã dùng/đã hoàn/giữ chỗ/khả dụng và trạng thái manual
verification từ authorized settlement summary. Không gọi Owner deposit-refund routes hoặc tải proof.
Staff không fetch/hiển thị summary tài chính; confirmation inspection riêng gắn input/reading/version,
không dùng consent quyết toán Owner. Component **5/5**, Mobile typecheck/lint đạt. ADB không có
trên PATH/standard SDK path đã kiểm: native device E2E **NOT RUN**, handoff Bùi Bảo Long.

E2E tiếp theo: `BHome.ContractVerification --finance --main-draft` đạt **19/19 nhóm**, real Owner
Web/API/Compact24/MinIO. Từ Main Draft → shared bill/partial/Adjustment/excess refund → Tenant
termination → Owner duyệt → assigned Staff Final readings/inspection → Owner xác nhận không phí
→ deposit request/approve/manual execution/private download → settlement review → Contract
Terminated/Room Available. Kiểm bytes chứng từ, invoice/allocations bất biến và đúng hai refund có
nguồn khác nhau trong DB; Staff ngoài assignment/cross-Tenant bị chặn. Signing/bank vẫn synthetic,
Mobile là transport/API, notification worker tắt; không suy thành native/provider/notification acceptance.

Hồi quy sau khấu trừ/Finance/inbox: cùng harness đạt **21/21 nhóm** không phí và thêm
`--damage-settlement` đạt **22/22 nhóm**, Owner duyệt thiệt hại100.000/hoàn2.900.000 từ cọc3.000.000.
Report giữ Invoice/OPEX/capital totals, loại demo return; Owner browser inbox mở Contract qua target
reauthorization và Tenant thấy đúng event một lần. Có explicit Testing-only event pump, worker vẫn
tắt; chỉ chứng minh in-app publication, external delivery vẫn Unconfigured. Không có payout thật.

## Receipt-excess refund hiện hữu

Quyết định triển khai theo ủy quyền người dùng OQ-01/02/05: chỉ hoàn phần chưa phân bổ của receipt VERIFIED đã có allocation và người trả xác định. Không tự phân bổ tiền thừa sang nghĩa vụ khác, tự chuyển tiền, tạo credit hoặc khấu trừ cọc. Source vẫn giữ nguyên Payment/Allocation/Final Invoice. Dùng refund_requests hiện hữu; không thêm bảng/cột. Deposit refund và khoản dư phát sinh từ Adjustment sau khi đã trả đủ nằm ngoài slice này.

Owner-only API/service, Staff/Tenant 403, anonymous 401; mô hình Owner toàn chuỗi hiện hữu. Beneficiary phải là Resident đã xác minh/liên kết với actual payer của allocation tại đúng Room, không lấy người đại diện mặc định. Chưa xác định payer thì chặn lập yêu cầu. Requested/Approved/Completed giữ chỗ; Rejected trả khả dụng. Các mutation dùng chung ledger advisory lock với allocation, revalidate nguồn/số dư trong transaction, version và UUID Idempotency-Key; replay giữ kết quả, payload thay đổi 409. Demo mutation chỉ Development/Testing, không dùng receipt demo trong Production. Giới hạn kỹ thuật 100 requests/receipt; chưa hỗ trợ đổi người nhận nếu Resident đã chuyển Room. Không có delete/direct-edit hoặc tự hoàn theo deadline.

| Method | Route                                     | Contract                                                                                                                                    |
| ------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | /api/v1/payment-transactions/{id}/refunds | Nguồn: excessAmount/refundedAmount/reservedAmount/availableAmount (chuỗi VND), beneficiary choices tối thiểu và requests                    |
| POST   | /api/v1/payment-transactions/{id}/refunds | {beneficiaryResidentId,amount,reason,humanConfirmed:true}, UUID key → RefundView                                                            |
| POST   | /api/v1/refund-requests/{id}/decision     | {expectedVersion,approve,reason,humanConfirmed:true}, UUID key → RefundView                                                                 |
| POST   | /api/v1/refund-requests/{id}/execution    | multipart: expectedVersion, executedAt UTC, externalReference, reason, humanConfirmed=true, evidence PNG/JPEG <=5 MB; UUID key → RefundView |
| GET    | /api/v1/refund-requests/{id}/evidence     | Private image sau Completed, kiểm length/hash trước trả bytes                                                                               |

RefundView: id/sourcePaymentId/beneficiaryResidentId/beneficiaryLabel/amount/reason/status/version/requestedAt/decisionReason/decidedAt/executedAt/externalReference/isDevelopmentDemo/history và executionIntent metadata nếu upload gián đoạn. Không trả object key/bank login/CCCD. History giữ actor/action/time/reason/version. Số tiền nguyên >0, <=phần nguồn còn khả dụng, <10^18. Reason 1–2000, externalReference 1–200 ký tự ASCII chữ/số `-_:./`, chuẩn hóa uppercase để chống trùng toàn chuỗi trong luồng này. Owner đưa mã ngân hàng vào tham chiếu nếu cần phân biệt nguồn. Không ghi số tài khoản nhận vào JSON; Owner tự kiểm bên nhận trên sao kê.

## Contract tích hợp và trạng thái

JSON dùng camelCase; cả GET và các POST thành công trả **200** (không 201/202).
Các POST bắt buộc Bearer Owner và `Idempotency-Key` UUID khác rỗng. Header không phải request ID
hoặc bank reference. GET không cần key. API đặt no-store; file private trả ảnh/filename do server tạo.

| Field / trạng thái | Giá trị thực tế                                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| RefundSource       | `sourcePaymentId`, bốn số tiền dạng chuỗi, `isDevelopmentDemo`, `beneficiaries:[{id,label}]`, `requests:RefundView[]`                |
| `excessAmount`     | receipt VERIFIED trừ allocation vào Invoice; chưa trừ refund                                                                         |
| `refundedAmount`   | Tổng requests `COMPLETED` của nguồn                                                                                                  |
| `reservedAmount`   | Tổng requests `REQUESTED` hoặc `APPROVED`, chưa gồm Completed                                                                        |
| `availableAmount`  | max(0, excessAmount − refundedAmount − reservedAmount), do server tính dưới ledger lock                                              |
| `status`           | Chuỗi uppercase: `REQUESTED`, `APPROVED`, `REJECTED`, `COMPLETED`                                                                    |
| `version`          | 1 khi tạo, tăng theo decision/Completed; tạo upload intent có thể giữ nguyên version                                                 |
| `history`          | Event `{action,actor,at,reason,version,key,fingerprint}`; timestamp UTC. Key/fingerprint phục vụ trace/replay, không phải credential |
| `executionIntent`  | Null nếu chưa có intent hoặc đã Completed; khi pending: `{key,contentType,length,sha256,executedAt,externalReference,reason}`        |
| Metadata nullable  | `decisionReason`, `decidedAt`, `executedAt`, `externalReference`; null không có nghĩa đã thành công                                  |

Transition: `REQUESTED → APPROVED → COMPLETED`, hoặc `REQUESTED → REJECTED`.
Không có reject sau Approved, cancel/delete, sửa trực tiếp hay đổi beneficiary. Approval/rejection
dùng `approve:true/false`; execution chỉ Approved và phải khớp `expectedVersion` hiện tại.
Không tự lấy representative làm người nhận. Owner có thể vừa lập vừa duyệt theo mô hình một Owner hiện có;
API chưa có cơ chế hai người duyệt độc lập.

Ví dụ body tạo yêu cầu (UUID tổng hợp; phải thay bằng actual payer do GET source trả về):

```json
{
  "beneficiaryResidentId": "00000000-0000-0000-0000-000000000001",
  "amount": "10000",
  "reason": "Hoàn phần receipt chưa phân bổ sau đối chiếu",
  "humanConfirmed": true
}
```

Execution gửi các field bảng route bằng `FormData`, `executedAt` ISO UTC, ảnh hợp lệ tối đa
**5 MiB (5 × 1024 × 1024 bytes)**; để browser tạo multipart boundary. Request HTTP có thêm allowance
32 KiB cho metadata. Server giải mã/kiểm ảnh; extension hoặc MIME client không đủ làm bằng chứng hợp lệ.

Execution chỉ sau Approved: Owner xác nhận giao dịch hoàn thực sự đã xảy ra, executedAt không trước approval hoặc sau thời điểm server. Screenshot chỉ là evidence hỗ trợ, không tự chứng minh settlement. Durable upload intent giữ hash/key/metadata trước external storage; Interrupted vẫn Approved, không báo Completed. Retry đúng key/bytes/metadata phục hồi; thay nội dung 409. Chỉ Complete sau storage readback/hash đúng và recheck trạng thái/nguồn trong transaction. Completed immutable, replay không double-refund; không ghi thêm PaymentAllocation âm hoặc sửa tiền hóa đơn. Chứng từ/metadata demo giữ nhãn nguồn, không biến thành ngân hàng thật.

Giới hạn báo cáo: refund tiền thừa không được tính vào doanh thu invoice ngay từ đầu. Hoàn lại tiền đó không phải OPEX và không đảo allocation doanh thu hợp lệ; report chỉ bỏ guard unclassified cho bản ghi excess-refund v1 có nguồn/marker/evidence hoàn chỉnh do workflow này tạo. Refund cũ/khác nguồn chưa phân loại vẫn làm net cash/recovery unavailable. Không dùng hoàn tiền thừa để giả quyết toán cọc hay đóng Move-out.

History snapshot chỉ append, giữ nguyên JSON cũ và DB append-only trigger; đọc snapshot cuối thuộc marker v1. Không ghi đè phần tử cũ để cập nhật trạng thái. Intent cùng key phục hồi sau restart/reopen; UI lấy lại key/time/ref/reason/hash từ server, khóa thông tin đang chờ và buộc đúng ảnh. Rejected có thể giải phóng reservation khi nguồn thay đổi; approve/execute luôn kiểm lại.

UI phải reset metadata và human consent khi intent xuất hiện/thay key dù version không đổi.
Sau timeout không báo Completed; GET lại source/request, dùng đúng key/metadata/bytes của intent để
phục hồi. Sau Completed, GET evidence kiểm length/hash trước trả bytes; không dùng object URL công khai.
`TransferView.reason` là lịch sử đối soát, không phải số dư refund hiện tại; UI đọc RefundSource.

## Lỗi cần xử lý

ProblemDetails có `status`, safe `code`, `correlationId`; validation/binding có thể trả lỗi framework
không có business code. Không hiển thị arbitrary detail hoặc tự phân loại lỗi thành thành công.

| HTTP / code                                                                                                                                                          | Hành động tích hợp                                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400 `idempotency_key_required`, `invalid_refund_request`, `invalid_refund_reason`, `invalid_refund_decision`, `invalid_refund_execution`, `refund_evidence_required` | Sửa input/key/human confirmation, không retry mù                                                                                                      |
| 401 / 403                                                                                                                                                            | Đăng nhập/refresh theo transport; Staff/Tenant không được dùng workflow Owner                                                                         |
| 404 `bank_transfer_not_found`, `refund_not_found`, `refund_evidence_not_found`                                                                                       | Nguồn/record/file không khả dụng; evidence chỉ sau Completed                                                                                          |
| 409 `refund_amount_unavailable`, `refund_changed`, `refund_source_changed`                                                                                           | Tải lại nguồn/version, review trước khi tạo lệnh mới                                                                                                  |
| 409 `refund_verified_payer_required`, `refund_source_requires_manual_review`                                                                                         | Owner xác minh nguồn/người trả; không thay người nhận bằng representative để lách guard                                                               |
| 409 `refund_idempotency_conflict`, `refund_execution_intent_conflict`, `refund_reference_used`                                                                       | Giữ key/bytes của intent đúng; kiểm thao tác/tham chiếu trước khi gửi tiếp                                                                            |
| 409 `development_payment_unavailable`                                                                                                                                | Không mutation receipt demo trong Production                                                                                                          |
| 413 `refund_evidence_too_large` hoặc HTTP body limit                                                                                                                 | Chọn ảnh đúng giới hạn; body limit có thể không trả business code                                                                                     |
| 409 `refund_evidence_integrity_failed` / lỗi storage 5xx                                                                                                             | Không coi upload/download thành công; giữ intent, kiểm tra storage và retry có kiểm soát; storage chưa cấu hình trả 503, lỗi ngoài mapping có thể 500 |

## Kiểm chứng và việc chưa có

Guard invoice `pendingReview` chỉ tắt khi receipt VERIFIED, tổng các allocation + completed returns
đối ứng đúng và mọi return có state `ExcessReceiptRefundV1` cuối cùng, payer/beneficiary khớp,
upload key/reference/hash và Completed event hợp lệ. Một legacy row chỉ mang status `COMPLETED`
hoặc metadata sai không đủ; số tiền khớp vẫn giữ pending và chặn settlement. Lượt guard bổ sung:
**11 PostgreSQL tests đạt**, 0 skip; history test cũng tuân thủ append-only trigger.

Lượt triển khai trước đã chạy: Finance unit 11/11 (gồm service role/Production demo rejection),
PostgreSQL refund/payment/finance 32/32, Owner focused UI sau fix **13/13**, harness real
Web/API/Compact24/MinIO **16/16 nhóm**. Có reservation race, reject/stale, unknown payer,
private/tampered/oversize image, duplicate reference, loss after Put/recovery, two partial refunds,
parallel replay và retained unclassified legacy guard. Lượt tài liệu này chỉ chạy lại API audit,
không chạy lại các suite trên; xem [trạng thái](API_IMPLEMENTATION_STATUS.md).

Browser dùng dữ liệu/chứng từ tổng hợp, không gọi bank hoặc chứng minh tiền thật đã chuyển.
Chưa có bank payout integration, Tenant refund self-service/history riêng hoặc notification receipt refund,
credit hoặc refund dư phát sinh từ Adjustment sau Paid. Nhánh TenantDamage có evidence đã có
backend và Owner Web; xem [quyết định khấu trừ](DEPOSIT_DEDUCTIONS.md) để phân biệt kết quả unit/PG/UI
với browser hai nhánh đã chạy và native/provider acceptance còn thiếu. Finance principal-return
classification đã qua unit/PG/Owner report/browser; retained compensation không nhập model Invoice/OPEX.
Hoàn cọc có consumer in-app theo committed history và Contract entitlement; xem
[Notifications](NOTIFICATIONS.md). Không suy event/inbox thành push/email hoặc tiền đã được bank-provider xác nhận.
Các nguồn cũ không phân loại tiếp tục manual review; không migration/đổi schema trong slice này.
