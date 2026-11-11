# Receipt cọc Main/Holding và phần dư

Nguồn: BR-01/09/11/17/18/19; BF-03/04/06, UC-14..16/22/25, GBR-10/18. Backend là nguồn tiền; không tạo tài khoản trước Main Active, không Tenant Credit và không sửa số tiền receipt để làm vừa cọc.

## Owner API

- `GET /api/v1/contracts/{contractId}/deposit-payment`: số cọc thỏa thuận, tổng đã phân bổ, còn thiếu, tham chiếu cọc từ backend và demo marker. Tổng đã nhận bao gồm Holding đã áp dụng qua ledger, không cộng Holding lần nữa.
- `GET /api/v1/payment-transactions/{receiptId}/deposit-context?contractId=...`: fingerprint đối chiếu, source reference, số tiền phân bổ dự kiến, phần dư, Resident hợp lệ (có thể chưa có User), external attestation và blockers.
- `POST /api/v1/payment-transactions/{receiptId}/allocate-deposit`: header `Idempotency-Key`, body `contractId`, `paidByUserId` (nullable), `humanVerified: true`, `expectedReference` và đúng một trong `paidByResidentId` / `externalPayerAttestationId`. Nếu cung cấp User cùng Resident thì phải khớp. Không suy ra payer từ người đại diện.
- Alias cũ `allocate-holding-deposit` vẫn nhận input cũ có `paidByUserId`; các trường bổ sung null không đổi JSON fingerprint của yêu cầu cũ. Client mới dùng context và Resident/attestation cụ thể. Sai nguồn/quyền/state không tạo allocation; lỗi stale/replay khác input trả conflict.
- `GET /api/v1/payment-transactions?depositContractId=...` phân trang receipt đã phân bổ vào hợp đồng. API này không bao gồm tiền dư chưa phân bổ hoặc receipt thuộc hợp đồng khác.

Phân bổ = min(receipt VERIFIED, cọc còn thiếu). Partial giữ phần thiếu rõ ràng; excess giữ nguyên trên receipt và dùng API refunds hiện có. Cọc đủ/đã đóng không tạo allocation bằng 0. Chặn currency/source/reference/demo, payer sai cohort, receipt đã dùng/từ chối/đã xác nhận hoàn và Holding chưa duyệt/hết hạn/xung đột phòng. Chữ ký, activation và provisioning vẫn theo các điều kiện riêng, không kích hoạt chỉ vì đã nhận tiền.

## Payer, hoàn tiền và lịch sử

`DepositReceiptAllocationV1` trong payments.history lưu allocation ID, contract, actual Resident/User hoặc external attestation, fingerprint/amount/reference của receipt, actor/time/key. Snapshot không được thay hoặc nối thêm bản khác. Resident nhận lại phần dư phải đúng snapshot; external receipt chỉ hoàn theo attestation. Người đại diện không mặc nhiên là người trả. Không tạo Resident/User giả. Hoàn cần request, Owner approval và bằng chứng thực hiện ngoài BHOME mới Completed; reservation/idempotency/native budget giữ như luồng refund hiện tại.

Readiness, lịch sử cọc, quyết toán và Room commitment dùng allocation canonical. Khi bổ sung nguồn vào quyết toán, legacy DepositVerification giữ ID/property order cũ để không làm đổi reference của hồ sơ cũ; nguồn mới chỉ cộng một lần. Phần dư chưa hoàn chặn kết thúc tài chính, không chặn quy tắc bàn giao vật lý độc lập. Retention review cũng nhận biết nghĩa vụ hoàn dư chưa lập request. Báo cáo phân loại khoản hoàn dư, không ghi deposit thành revenue hoặc refund thành OPEX.

Owner Web có receipt picker/phân trang, chọn actual payer, xác nhận gắn với context, giữ key khi mất phản hồi, lịch sử receipt và RefundPanel. Hiển thị tham chiếu trước khi nhập sao kê; nội dung sao kê vẫn phải được Owner kiểm tra. Form ghi nhận receipt cọc có bước quay lại đối chiếu cọc, không dẫn sang phân bổ invoice. Owner Mobile không thêm quyền quyết định.

## Database và giới hạn kiểm chứng

Migration SQL-only thứ 8 `20261111080000_DepositReceiptAllocation`: giữ 24 bảng; snapshot/source/budget/refund guards và proof classification. Fresh DDL và embedded migration đồng bộ. Upgrade không viết lại allocation lịch sử đã vượt cọc; các hồ sơ đó cần đối chiếu riêng, không tự hợp thức hóa. Không downgrade xóa lịch sử.

Đã kiểm chứng bằng PostgreSQL disposable và component tests; chưa là browser/native hoặc bank-provider acceptance. Migration chưa áp dụng vào DB làm việc. Receipt chuyển thêm sau khi cọc Main đã đủ (toàn bộ receipt là dư), excess sinh từ điều chỉnh/reversal và hoàn principal deposit cho external payer là các nhánh tiếp theo; không dùng allocation 0 hoặc gán Resident giả để lách các nhánh này.
