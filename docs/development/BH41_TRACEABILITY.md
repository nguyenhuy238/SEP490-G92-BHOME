# BH-41 — Quyết định triển khai và acceptance

Nguồn: yêu cầu BH-41 phiên 01/11/2026 (quyết định thay đổi được duyệt), SRS hiện có
`BHome_Report-3_Software Requirement Specification (2).docx` §2.6.3 BF-06C,
UC-24, §4.4, GBR-01/02/09/10/13/18, DBR-07; HUY_SOURCE_CODE_AUDIT/HUY_DEPENDENCY_MATRIX;
BH-21/BH-25 và guide hiện hành. Không có Git.txt gốc trong checkout; dùng AGENTS.md §9.
Nhánh đã kiểm tra `member/QHuy`, working tree sạch trước thay đổi, HEAD `133642a`.

| Yêu cầu            | Thành phần dự kiến                                                    | Acceptance                                                                                          |
| ------------------ | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Tenant gửi yêu cầu | AdjustmentService/Repository, request/command/event, evidence private | Entitlement trước read/write/upload; replay một request; Staff không có quyền                       |
| Owner quyết định   | Decision duy nhất/request, reason/actor/time/version                  | Approve/reject race một quyết định; lỗi rollback không tạo effect                                   |
| Draft correction   | Correction có snapshot nguồn, áp số tiền charge trên backend          | Không sửa MeterReading/Policy; refresh giữ correction, source thay đổi chặn Final; version conflict |
| Final adjustment   | Decision Approved/Final là effect riêng bất biến                      | Original Invoice/lines không đổi; effective = issued + tổng delta Final                             |
| Payment/debt/QR    | Ledger BH-25, chung payment lock + Room lock                          | Paid tăng → dư nợ mới; Paid giảm → excess PendingReview; reconcile cùng lúc nhất quán               |
| Quyền chia sẻ      | InvoiceRecipients và summary tài chính                                | A/B/C cùng balance; chỉ requester/Owner xem reason/evidence; người ngoài 404                        |
| Clients/demo       | Owner review, Tenant submit/history, isolated fixture                 | UI thật/API thật, loading/retry/conflict, dữ liệu tổng hợp, không reset                             |

Thiết kế: request và decision/history append-only; status Pending/Approved/Rejected suy từ
decision unique, version 1/2. Evidence upload trước submit, gắn invoice+uploader; chỉ link một
request, orphan cleanup kỹ thuật sau 24 giờ. Tái sử dụng MinIO/IObjectStorage và image validator
hiện có; PNG/JPEG tối đa 5 MiB/ảnh, 5 ảnh/request. Giới hạn kỹ thuật được công bố trong API/UI.
Request có thể chọn charge hoặc yêu cầu chung; để sửa Draft, Owner phải chọn charge hiện có.
Proposed amount tùy chọn, không tự thực thi; Owner nhập corrected amount và xác nhận revision.
Draft lưu snapshot giá/chỉ số nguồn và approved override cho charge; không thay nguồn nghiệp vụ.
Final hỗ trợ charge hoặc tổng hóa đơn, chỉ nhận tiền nguyên VND không âm; không giảm nghĩa vụ
xuống âm. Không tự đặt loại adjustment/ngưỡng duyệt theo OQ-02.

Balance phân biệt issued/adjustment/effective/verified payments/outstanding/excess. Outstanding
không âm, excess giữ riêng có trace; không bỏ tiền thừa. Chưa có refund/credit policy nên trạng
thái excess là PendingReview; không chuyển tiền, không xóa payment. Durable events trong DB,
notification consumer BH-19 chưa có: Pending Notification Consumer, không thêm service thứ hai.

Thứ tự commit: requests + evidence → decisions/Draft → Final/payment → Owner → Tenant →
demo → guide. Build/test output `.tools/bh41-*`; không ghi đè API đang chạy, không push/merge/deploy.

## Kết quả 01/11/2026

Đã triển khai các thành phần trong bảng. Request/decision là history append-only, decision
Approved/Final đồng thời là financial effect riêng, không tạo payment ledger khác.
MinIO lưu bằng chứng private; native dùng camera hiện có, Web có chọn ảnh/xem trước/upload.
Migrations: `20261101141539`, `20261101141930`, `20261101142421`.

| Acceptance                                                                  | Evidence thực thi                                                                |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Submit/replay/IDOR, request privacy, historical entitlement                 | AdjustmentRequestTests (HTTP + PostgreSQL/MinIO)                                 |
| Upload fail → không gắn ảnh thiếu; orphan cleanup                           | FailedEvidenceUploadLeavesOnlyRecoverableIntentAndCannotBeSubmitted              |
| Approve/reject race, correction refresh/finalize, source thay đổi           | AdjustmentDraftTests + InvoiceApiTests regression                                |
| Unpaid/Paid × tăng/giảm, allocations trước/sau, concurrent payment/decision | AdjustmentFinalTests + PaymentLedgerTests                                        |
| Staff+Tenant không mở full finance invoice người khác                       | StaffTenantRoleCombinationDoesNotExposeFullFinancialDetailsOutsideOwnEntitlement |
| Decimal precision, validation/excess                                        | AdjustmentBalanceTests và Owner snapshot precision test                          |
| Owner/Tenant UI/API/storage thật                                            | Test-AdjustmentDemo.cjs, screenshots/results local                               |

Backend non-Docker 437 PASS; PostgreSQL/MinIO regression 56/56 PASS; Owner 85 PASS;
Mobile 240 PASS + typecheck/lint/native exports. Model consistency 3/3 PASS.
Formal ST/AT, thiết bị native thực, real bank/refund/load/recovery chưa chạy.
Consumer notification BH-19 còn pending; refund/credit/settlement policies giữ PendingReview.
Chi tiết chạy, API, tài chính và giới hạn: [Workflow guide](INVOICE_ADJUSTMENT_WORKFLOW_GUIDE.md).
