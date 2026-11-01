# BH-25 Payment API

GET/PUT `/api/v1/receiving-bank-accounts/{locationId}` / `/api/v1/receiving-bank-accounts`:
Owner tạo phiên bản cấu hình với expectedVersion, humanVerified, bankIdentifier BIN 6 số,
accountNumber 6–19 số, accountHolder ASCII hoa, enabled, isDevelopmentDemo.
Mỗi version bất biến; bản mới nhất disabled ngừng cấp instructions. Demo chỉ cho Development/Testing.
GET `/api/v1/invoices/{id}/transfer-instructions`: Owner hoặc Tenant có InvoiceRecipients.
Số dư = server ledger. Draft/Settled/missing configuration không trả QR hoặc tài khoản giả.
QR dựng local với QRCoder 1.8.1 (MIT, PNG không cần System.Drawing), không gọi dịch vụ ngoài.
VietQR chuyển tài khoản dùng EMV TLV/CRC, đối chiếu [tài liệu và vector công khai của VietQR Kit](https://www.vietqr.io/generate).
Giới hạn QR: số tiền nguyên tối đa 13 chữ số, memo ASCII 25 ký tự; ngoài giới hạn trả
InstructionsOnly với hướng dẫn chính xác, không cắt số tiền hoặc reference. QR không chứng minh trả tiền.

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

`GET /invoices/{id}/payment` dành cho Owner/Tenant có entitlement, Staff 403, ngoài snapshot 404.
Tenant thấy cùng Paid/Unpaid và các payment amount/date, với payer “Bạn”/“Khách thuê khác trong hóa đơn”/
“Chưa xác định người trả”; không trả bank reference, statement reference hay payer account/name của người khác.
Owner có thêm payer user ID; `GET /invoices/{id}/payment/eligible-payers` chỉ Owner, nhãn Resident tối thiểu.
PaidBy được Owner chọn khi xác minh bằng chứng, không lấy người đang xem hoặc VerifiedBy.

GET `/debts`: Owner/Tenant/Staff; chỉ outstanding Final invoices, một record/phòng/kỳ.
GET `/payment-invoices`: Owner/Tenant; cả Paid/Unpaid, dùng paymentStatus filter.
GET `/payment-history`: Owner/Tenant; allocations đã xác minh; Tenant không nhận bankReference/verifiedByUserId.
Các list lọc locationId/roomId/billingPeriod, page/pageSize trước pagination; overdueOnly áp
dueDate < Today ở Asia/Ho_Chi_Minh và outstanding > 0. Không phát sinh phí phạt hoặc tự nhắc nợ.
Staff chỉ thấy Location hiện được phân công: Room/kỳ/hạn/outstanding/overdue; total/paid null,
không có bank/payer/history. Không dùng assignment trong JWT để bỏ qua kiểm tra hiện tại.

`/payment-invoices` hỗ trợ repeated `invoiceIds=...` tối đa 100 ID để đọc trạng thái theo
trang Invoice trên Mobile trong một query, vẫn áp entitlement trước filter/count/pagination.
Mobile dùng expo-clipboard bản SDK 58 để sao chép thông tin theo thao tác người dùng,
không có nút Tenant tự xác minh hay sửa balance. QR bị ẩn ngay khi trạng thái server Paid.
