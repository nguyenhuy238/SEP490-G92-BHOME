# BH-25 Payment API

Theo BF-06/UC-22/23/25 và [quyết định BH-25](../development/BH25_TRACEABILITY.md).
Invoice Final không bị sửa; trạng thái thanh toán được suy từ allocation ledger.
Amounts là decimal strings VND nguyên. Lỗi theo ProblemDetails có code/correlationId.

| Method | `/api/v1` route | Quyền / body |
| --- | --- | --- |
| POST | `/payment-transactions` | Owner; bank/provider identity, bankReference, amount/currency/occurredAt, transferDescription, statementReference, verificationReason, proposedInvoiceId nullable, humanVerified=true |
| GET | `/payment-transactions` | Owner; page/pageSize, locationId/roomId/billingPeriod |
| GET | `/payment-transactions/{id}` | Owner; metadata sao kê và kết quả đối soát |
| POST | `/payment-transactions/{id}/allocate` | Owner; invoiceId, paidByUserId nullable, humanVerified=true |
| POST | `/payment-transactions/{id}/reject` | Owner; reason; không xóa giao dịch, không undo tiền đã allocate |
| GET | `/payment-transactions/{id}/reconciliation-history` | Owner; page/pageSize; append-only theo sequence |
| GET | `/invoices/{id}/payment` | Read model số tiền, balance/status và payer theo quyền |

Mọi POST cần header GUID `Idempotency-Key`: cùng key/payload replay, đổi payload 409.
Bank reference chuẩn hóa trim/uppercase; unique provider + reference chống nhập trùng giao dịch.
Claim normalized reference xuyên cọc/Invoice chống credit hai nghĩa vụ ngay cả khi chạy đồng thời.
Giao dịch đúng full outstanding + đúng transfer reference mới được phân bổ. Thiếu/thừa, sai memo,
đã Paid hoặc reference đã được credit giữ PendingReview, không tạo PaymentAllocation.
Một bank transfer chỉ có một allocation. Paid không cấm xem lịch sử.

Provider production hiện Unconfigured. `OwnerBankStatement` chỉ là Owner xác minh bằng sao kê,
không phải xác minh callback ngân hàng hay receipt Tenant. Không có endpoint fake bank success.
Event `payment.confirmed.v1` lưu trong PaymentConfirmedEvents cùng allocation, key allocationId,
payload contract `{allocationId, invoiceId, occurredAt}`; recipient lấy từ InvoiceRecipients và Owner.
Notification module chưa consume/deliver; PendingIntegration, không sửa worker dùng chung.
