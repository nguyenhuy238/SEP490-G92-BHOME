# UC-24 — Invoice Adjustment API

Tiền VND nguyên, truyền chuỗi decimal; lỗi ProblemDetails có code. Mọi JSON POST cần GUID
Idempotency-Key, cùng actor/operation/key/payload replay, đổi payload 409. Authentication bắt buộc.

| Method / `/api/v1` | Quyền / dữ liệu |
| --- | --- |
| POST `/invoices/{invoiceId}/adjustment-requests` | Tenant trong InvoiceRecipients; `{invoiceLineId?: UUID, proposedAmount?: decimal-string, reason, evidenceIds: UUID[], expectedInvoiceVersion}` |
| PUT `/invoices/{invoiceId}/adjustment-evidence` | Tenant trong snapshot; raw PNG/JPEG tối đa 5 MiB; trả `{id,contentType,length}` |
| GET `/invoice-adjustments` | Owner: tất cả; Tenant: chỉ yêu cầu mình trong invoice có entitlement; page/pageSize/locationId/roomId/invoiceId/status |
| GET `/invoice-adjustments/{id}` | Owner hoặc requester còn entitlement lịch sử |
| GET `/invoice-adjustments/{id}/evidence/{evidenceId}` | Như detail; download qua API, không trả object key/public URL |

Request ghi snapshot server (Invoice/charge/current amount/version/stage), không tin số tiền gốc,
requester hoặc Owner ID từ client. Proposed chỉ là đề xuất. Reason 1–2000 ký tự; tối đa 5 ảnh,
phải thuộc invoice/uploader, uploaded và chưa link request khác. Upload chưa gắn được cleanup
sau 24 giờ; linked evidence và request/event/command giữ append-only. Staff bị chặn.

Co-Tenant không xem reason/evidence/request cá nhân của người khác; quyền xem số dư chung không
mở quyền xem yêu cầu riêng. Durable event `invoice.adjustment.requested.v1` có
`{requestId,invoiceId,requesterId,occurredAt}`, key requestId+name. Notification consumer pending.

Owner POST `/invoice-adjustments/{id}/approve` hoặc `/reject` dùng permission
`invoice-adjustments.approve`, body `{expectedVersion:1, expectedInvoiceVersion,
expectedFinancialVersion, correctedAmount?, chargeCode?, reason, humanConfirmed:true}`.
Decision unique/request, append-only; replay cùng command trả decision đã lưu. Lần khác quyết
định request đã xử lý trả 409. Detail có currentInvoice và decision (before/corrected/delta,
effectiveBefore/After, Owner/time/reason). Pending version 1, Approved/Rejected version 2.

Draft: Owner chọn charge có thật nếu request chung, hoặc giữ charge Tenant đã chọn. Corrected
amount là giá trị tiền charge sau sửa, không phải delta. Backend tính delta/total và tăng Invoice
revision. Không sửa đơn giá/chỉ số nguồn; InvoiceLine có calculatedAmount/correctionRequestId
để truy vết. Refresh áp override đã duyệt mới nhất theo charge; fingerprint nguồn đổi thì báo
`draft_correction_source_changed`, không áp override cũ và chặn Final. Owner xem nguồn mới rồi
xử lý yêu cầu mới để duyệt correction phù hợp. Finalize vẫn revalidate inputs/corrections.
Invoice đổi stage/revision sau khi Owner đọc thì 409; Reject không thay invoice hoặc số dư.
Event `invoice.adjustment.decided.v1` có contract giống requested, consumer đọc decision theo
requestId; không chứa reason/ảnh trong event hoặc log.

Final: approve lưu decision/effect riêng, không UPDATE Invoice/lines. Owner nhập correctedAmount
cho charge hoặc tổng hóa đơn (chargeCode null). Delta tính trên giá trị hiện hành, không cộng
proposal trực tiếp. Detail có currentChargeAmount và financials/currentFinancialVersion để Owner
xem lại trước khi xác nhận. FinancialVersion thay đổi sau khi đọc trả 409, cần tải lại và review.

`GET /invoices/{invoiceId}/adjustments?page=1&pageSize=20`: Owner/Tenant trong snapshot, trả
summary Approved (stage/charge/before/corrected/delta/time), không có requester/reason/evidence.
Correction Draft đã nằm trong issued total; chỉ delta Approved/Final cộng vào payable để tránh
đếm hai lần. Payment/debt/QR dùng cùng projection: effective = issued + approved Final deltas;
outstanding = max(effective - verified allocations,0); potentialExcess = max(allocations - effective,0).
Payment DTO bổ sung originalIssuedAmount/approvedAdjustmentTotal/potentialExcessAmount/
financialVersion/reviewStatus. PayableAmount hiện là effective payable; history vẫn giữ allocation gốc.
Excess trả reviewStatus PendingReview, không mất khoản thừa, không auto-refund/credit. Paid tăng
tạo outstanding mới, cho phép giao dịch mới đúng phần outstanding; khoản trả gốc vẫn giữ nguyên.
Staff debt DTO không nhận issued/adjustment/excess; quyền operational hiện có giữ nguyên.
Ngay cả tài khoản có cả Staff và Tenant, dữ liệu tài chính đầy đủ chỉ trả cho invoice có
entitlement Tenant; invoice xem nhờ assignment Staff vẫn dùng DTO giới hạn.
Snapshot mới lưu số tiền dạng chuỗi decimal, không đưa qua JavaScript Number. Canonicalize
proposedAmount trước fingerprint để retry số VND cùng giá trị không xung đột vì decimal scale.
Mobile Web chọn ảnh PNG/JPEG, xem trước rồi upload; native tái sử dụng camera/review hiện có.
