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
