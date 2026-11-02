# BH-40 — UC-16/UC-19/JOB-02

Nguồn: yêu cầu BH-40 phiên 02/11/2026, SRS §2.3 UC-16, §2.5 UC-19, BF-04A,
JOB-02 (30 ngày), GBR-01/02/04/09/10/13/18; SDS và HUY_*; guides Contract/BH-25/BH-41.
Đã xác nhận member/QHuy, working tree sạch, HEAD 3983fc7. Git.txt gốc không có trong checkout;
theo AGENTS.md, chỉ commit local, không push/merge/deploy.

| Hành vi | Thành phần | Acceptance |
| --- | --- | --- |
| Gia hạn | ContractService hiện có, signing/preview/readiness/version chain | Chưa effective không Active; signed versions/history/cọc root giữ nguyên; duplicate/race |
| Yêu cầu/duyệt/lịch kiểm tra | ContractMoveOut, assignee hiện hành, audit | Owner duyệt không đóng; Staff thấy lịch được giao; Tenant khác 404 |
| Inspection | Snapshot handover đã xác nhận, asset checklist, confirmed readings/evidence | Baseline bất biến; Owner xác nhận; co-tenant không bị reset meter/charge |
| Settlement | IContractSettlementLedger thật + BH-41 financial projection | Shared debt là contextual/unallocated, không nợ riêng; deposit/refund policy thiếu → Pending |
| Close/release | Re-read fingerprint dưới Room lock chung payment/adjustment | A đóng B/C vẫn Active/Occupied; last eligible mới Available; stale review chặn |
| Expiry | Job-02 handler/event durable unique Contract/enddate/window | Lặp không duplicate, không auto-close; notification consumer pending |

Quyết định phạm vi an toàn: không thêm công thức khấu trừ, refund/credit hay chia nợ chung.
Ledger chỉ có thể resolved khi verified deposit = required deposit = 0, không holding chưa xác
minh, không invoice/Draft/request/dispute/excess chưa xử lý; đầy đủ kỳ liên quan và Final
readings đã được bao phủ bởi confirmed billed readings cùng ngày/giá trị. Mọi phần chưa
bao phủ giữ blocker rõ ràng, không estimate charge, không giảm dư nợ hoặc xác nhận refund.
Không có ledger deduction/refund được duyệt nên approved deductions/refund chưa xác định trả
null + blocker, không giả số 0 để Complete. Trường hợp không phát sinh deposit/refund có thể
resolved khi tất cả nguồn nghĩa vụ xác minh đủ, Owner kiểm tra inspection và review snapshot.
Không sửa Final Invoice hoặc allocations; chỉ đọc/snapshot nguồn vào settlement review.

Thứ tự: renewal → termination/schedule → inspection → settlement → closure → Owner UI →
Tenant/Staff UI → expiry handler → isolated demo → guide. Tests negative/race/privacy và
PostgreSQL/MinIO, output .tools/bh40-*; formal ST/AT/real devices/providers chưa là bằng chứng.
