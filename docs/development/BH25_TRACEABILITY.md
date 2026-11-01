# BH-25 phạm vi và hợp đồng triển khai

Nguồn: yêu cầu BH-25 trong phiên 01/11/2026; SRS BF-06, UC-22/23/25,
GBR-01/02/10/13/18, DBR-08; Report 4 giao dịch/audit/privacy; các báo cáo HUY_*,
BH21_TRACEABILITY và BILLING_WORKFLOW_GUIDE. Báo cáo audit cũ không mô tả hiện trạng BH-21 mới.
Không có Git.txt gốc trong checkout; dùng AGENTS.md mục 9 và chỉ commit local `member/QHuy`.

| Hành vi | Thành phần | Acceptance |
| --- | --- | --- |
| Một nghĩa vụ chung trên Final Invoice | PaymentService/Repository, ledger riêng | Tenant A trả đủ → A/B/C cùng Paid; không sửa Invoice/lines |
| Owner đối soát bằng sao kê | Transfer, Allocation, Reconciliation, Commands | Phân biệt PaidBy/VerifiedBy; xác nhận/reject có lý do; Tenant không tự xác minh |
| Không double-credit invoice/cọc | Registry tham chiếu ngân hàng, unique allocation, Room/transfer locks | Replay, hai payer, cọc↔invoice cùng reference; một financial effect |
| Lệch số tiền hoặc chưa match | Review history, không tạo allocation | Thiếu/thừa/sai memo/đã Paid giữ giao dịch, không tự hoàn hoặc đổi invoice |
| Quyền lịch sử | InvoiceRecipients của BH-21 | Ngoài Tenant snapshot 404; người rời phòng vẫn đọc; Tenant không thấy reference sao kê, bank credentials hoặc tên người khác |
| QR và tài khoản nhận | Owner receiving configuration, local QR generator | Lấy số dư server; không gọi endpoint QR ngoài; QR không xác nhận trả tiền |
| Công nợ | Query server, ngày Asia/Ho_Chi_Minh | Unpaid trước hạn không Overdue; Paid không nằm danh sách nợ; không nhân nợ theo số contracts |

## Ranh giới chính sách

- Chỉ auto-allocate qua xác nhận Owner khi giao dịch đã đối chiếu sao kê, khớp đúng số dư
  và reference hóa đơn. Chưa có quyết định partial/excess: giữ PendingReview với lý do;
  không hardcode chia tiền, Tenant Credit, hoàn tiền hoặc phạt. Không bỏ giao dịch đến sau Paid.
- Payer được Owner xác minh riêng; null nếu chưa xác định. Tenant thấy “Bạn”, “Khách thuê khác
  trong hóa đơn” hoặc “Chưa xác định”; chỉ Owner thấy linked payer ID. Không suy từ Resident.OwnerUserId.
- Tham chiếu cọc hiện có không chứa provider/account identity. Dùng registry normalized reference
  toàn hệ thống để tránh credit xuyên cọc/hóa đơn; reference có collision giữ review thay vì đoán.
  Migration chặn nếu dữ liệu cọc cũ trùng sau chuẩn hóa, không tự hợp nhất hoặc xóa.
- Bank provider vẫn Unconfigured nếu không có official adapter/credentials. Không thêm webhook giả.
- Ghi event payment-confirmed bền vững cùng allocation; hợp đồng bàn giao notification tách riêng,
  delivery PendingIntegration. Không sửa worker/JOB-19 thuộc module khác hoặc rollback tiền vì delivery.
- Demo chỉ dùng tài khoản nhận tổng hợp, được đánh dấu Development, không dùng để chuyển tiền thật.

## Thứ tự thực hiện

Ledger + tests/migration → manual reconcile → receiving/QR → shared read model → debt/history
→ Owner UI → Tenant UI → isolated demo → guide. Mỗi slice build/test/diff-check rồi commit riêng.
Output build/test riêng trong `.tools/bh25-*` để không ghi đè DLL API demo đang chạy.
