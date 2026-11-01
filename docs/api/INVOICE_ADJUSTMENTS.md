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
