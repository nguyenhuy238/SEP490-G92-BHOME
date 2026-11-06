# Quyết định khấu trừ cọc — UC-19, BE-19/BE-X07

Cập nhật 06/11/2026. Triển khai theo ủy quyền người dùng cho OQ-01/05 khi chưa có quyết định chi tiết
trong repository; không thay approved SRS hoặc đặt công thức phí. SRS UC-19 p1833–1840: Staff ghi
inspection/evidence, Owner xác nhận tình trạng, quyết định Security Deposit deduction và chỉ đóng
sau khi nghĩa vụ/hoàn tiền được giải quyết.

## Contract backend

Owner-only `POST /api/v1/contracts/{id}/deposit-deductions`, UUID `Idempotency-Key`, JSON <=32 KiB,
no-store; thành công 200. Staff/Tenant 403, anonymous 401. Cùng key/payload replay cùng plan;
đổi payload/target 409. Các quyết định khác key cùng expectedVersion chỉ một thắng.

```json
{
  "expectedVersion": 0,
  "expectedReference": "<summary.reference vừa đọc>",
  "reason": "Owner đã đối chiếu thiệt hại và khoản chưa tính trên hóa đơn",
  "humanConfirmed": true,
  "items": [{
    "assetId": null,
    "reasonCode": "TenantDamage",
    "amount": "100000",
    "description": "Thiệt hại tại phòng theo biên bản",
    "evidenceIds": ["00000000-0000-0000-0000-000000000001"]
  }]
}
```

UUID ví dụ phải thay bằng ảnh đã linked đúng inspection. `assetId:null` là thiệt hại Room; có ID
thì phải thuộc asset snapshot của inspection. Chỉ hỗ trợ `TenantDamage` do Owner nhập/duyệt,
không tự suy mức phí, khấu hao, phạt trễ hoặc lãi. Mỗi Room/Asset tối đa một item trong phiên bản;
tối đa 20 items, mỗi item có 1–5 ảnh unique, tổng unique evidence tối đa 5. Tiền nguyên VND dương
<10^18; tổng không vượt cọc thực còn lại. Description và reason 1–2000 ký tự.

Điều kiện: Active, move-out Inspected/PendingSettlement, inspection đã Owner Confirmed nhưng chưa
xác nhận NoAdditionalCharges; đủ invoice/readings/nguồn tiền; không bank/adjustment/shared debt,
holding hoặc deposit allocation chưa xử lý. Chưa có Requested/Approved/Completed deposit refund.
Owner được ghi quyết định `items:[]` với reason/human confirmation để chủ động không thu thiệt hại;
không tự biến missing policy/input thành 0. Thiệt hại vượt cọc, bù nợ hóa đơn trực tiếp bằng cọc và
phần phải thu thêm chưa hỗ trợ ở API này, giữ pending; hóa đơn vẫn phải xử lý qua luồng hiện hữu.

Plan trả `id,contractId,depositContractId,inspectionId,inspectionVersion,version,approvedByUserId,
approvedAt,reason,obligationReference,total,items,evidence:[{id,length,sha256}],operationKey,
fingerprint,isDevelopmentDemo`. Tiền là chuỗi decimal, version là số nguyên. Không có object key
hoặc public URL. Snapshot ảnh được kiểm decode/loại/kích thước và chốt SHA-256 tại quyết định;
refund/closure kiểm lại proof, nội dung bị thay không cho financial transition.

## Lịch sử và phép tính

Plan giữ append-only dưới marker `DepositDeductionV1` trong `contracts.history`; không thêm bảng/
cột. Dùng cùng lock payment ledger → Location → Room; ghi audit actor/time và snapshot. Sửa quyết
định bằng POST phiên bản tiếp theo, expectedVersion/current reference mới; giữ tất cả bản cũ,
chỉ bản cuối tính vào số dư, không cộng lặp. Đã reserve/hoàn tiền thì không sửa plan để tránh làm
stale một giao dịch đang chờ; cần xử lý reservation theo workflow, không ghi đè history.

Summary bổ sung `depositDeductions`, `obligationReference`; calculation có `approvedDepositDeductions`.
Available = verified deposit − physical deposit allocations − approved deduction − completed refund
− reserved refund. Final charges/deductions ở đây là cùng một nghĩa vụ thiệt hại, không cộng lại hai
lần. Không sửa Invoice/lines hoặc tạo allocation ngân hàng giả. Chi phí sửa chữa thực tế/OPEX vẫn
phải ghi qua Expenses/Work Order, không tự tạo từ mức khấu trừ. Owner phải đối chiếu khoản đã tính
trên invoice trước quyết định; API này không có cơ chế so khớp ngữ nghĩa mọi tên phí do con người nhập.

`obligationReference` giữ invoice/inspection/deposit source; `financialReference` kết hợp bản plan
cụ thể để ràng buộc refund. Nguồn thay đổi thì plan cần reapproval, không tự giữ quyết định cũ như
đã chốt. Các nhánh nhập dữ liệu legacy ngoài fixture chưa được pilot; không tuyên bố hỗ trợ mọi
lịch sử quyết toán không nhất quán của nguồn ngoài.

## Hoàn phần còn lại

[Refund API](REFUNDS.md) nguồn deposit trả plan và available đã trừ khoản duyệt. POST deposit-refunds
thêm `expectedDeductionPlanId` đúng plan, `deductionsConfirmed:true`, `noDeductionsConfirmed:false`,
vẫn bắt buộc xác minh người nộp/nhận. Giữ body cũ cho nhánh không plan/không khấu trừ để tương thích
idempotency đã phát hành. Không dùng cờ “không khấu trừ” cho một plan có phí.

Nếu approved deduction + verified refund = cọc, không reservation và mọi guard đạt, Owner mới
review settlement/complete. Nếu toàn bộ cọc được giữ theo plan thì refundAmount=0 và
transferVerificationStatus=NotRequired; không tạo giao dịch hoàn bằng 0 hoặc giả bank success.
Đây là quản lý nội bộ, không kết luận về nghĩa vụ kế toán/thuế hoặc tính pháp lý của mức bồi thường.

Backend focused: **25 unit + 19 integration/audit đạt**, 0 skip. Có race/replay/stale/version,
scope, unknown evidence, vượt cọc, revision append-only, proof tamper, partial remainder return và
full retention/closure; không đổi issued invoice.

Owner Web đã có editor ngay trong Contract lifecycle: chọn Room/Asset và ảnh inspection, nhập mức
thiệt hại/căn cứ, xác nhận chưa tính trên invoice rồi duyệt. Thay input hoặc summary reference phải
xác nhận lại; retry ambiguous failure giữ cùng key/payload, không báo duyệt trước response. Khi có
reservation/nguồn chưa đủ điều kiện, editor chỉ đọc. RefundPanel hiển thị plan hiện tại và buộc
review đúng plan trước khi yêu cầu phần còn lại. Focused Owner UI **26/26 đạt**, build/lint và
Mobile typecheck đạt. Browser có khấu trừ, native và Finance classification chưa nghiệm thu trong
slice UI này. Handoff Owner Web Vũ Xuân Trường; Mobile Bùi Bảo Long.
