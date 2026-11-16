# Đơn đề nghị hoàn tiền do Tenant gửi — 15/11/2026

## Phạm vi và truy vết

Thay đổi do người dùng yêu cầu: Tenant chủ động gửi yêu cầu hoàn tiền; có thể tham chiếu
Payment, Contract, cả hai hoặc không tham chiếu. Owner xem hàng chờ, đồng ý hoặc từ chối
(từ chối phải nêu lý do); sau khi **đã thực sự chuyển khoản**, Owner ghi nhận mã giao dịch,
thời điểm và ảnh chứng từ để Tenant xem. Áp dụng BF-06/UC-25/GBR-10/GBR-18,
authorization GBR-01/02, chưa giả định chính sách OQ-01/02/05.

Loại hồ sơ mới `TenantRefundPetitionV1` **không phải** `ExcessReceiptRefundV1`,
`SecurityDepositRefundV1` hoặc `HoldingDepositRefundV1`. Hai trường nguồn tài chính
`refund_requests.source_payment_id`, `source_deposit_contract_id` **luôn NULL** cho
loại mới; các ID Payment/Contract liên kết chỉ là **tham chiếu ngữ cảnh** trong history
được xác minh theo tenant đăng nhập. Nhờ đó đơn chưa phê duyệt/đã phê duyệt không giữ
chỗ tiền, không ghi allocation, không tự giảm công nợ/cọc hoặc tạo xác nhận ngân hàng.
Owner phải đối soát các khoản nguồn tài chính bằng workflow hiện hữu khi cần.

## API thực tế

| Actor  | Method | Route                                                     | Mục đích                                                  |
| ------ | ------ | --------------------------------------------------------- | --------------------------------------------------------- |
| Tenant | GET    | `/api/v1/tenant/refund-requests?page=1&pageSize=20`       | Danh sách của mình                                        |
| Tenant | GET    | `/api/v1/tenant/refund-requests/sources`                  | Các Payment đã xác minh do mình trả và Contract liên quan |
| Tenant | POST   | `/api/v1/tenant/refund-requests`                          | Tạo yêu cầu                                               |
| Tenant | GET    | `/api/v1/tenant/refund-requests/{id}/evidence`            | Xem chứng từ private sau Completed                        |
| Owner  | GET    | `/api/v1/owner/tenant-refund-requests?page=1&pageSize=20` | Hàng chờ xử lý                                            |
| Owner  | POST   | `/api/v1/owner/tenant-refund-requests/{id}/decision`      | Đồng ý / từ chối                                          |
| Owner  | POST   | `/api/v1/owner/tenant-refund-requests/{id}/execution`     | Xác nhận đã chuyển khoản + chứng từ                       |
| Owner  | GET    | `/api/v1/owner/tenant-refund-requests/{id}/evidence`      | Xem chứng từ private                                      |

Danh sách trả `PagedResult` với `items,page,pageSize,totalCount`; `page >= 1`,
`pageSize` từ 1 đến 100. `TenantRefundPetitionView` chứa
`id,amount,reason,status,sourcePaymentId,sourceContractId,createdAt,decidedAt,
decisionReason,executedAt,externalReference,hasEvidence,version`.
Số VND truyền dưới dạng **chuỗi nguyên dương**; `tenantLabel` và
`executionIntent` chỉ xuất hiện trên Owner API.

Tenant POST ví dụ:

```json
{
  "amount": "125000",
  "reason": "Đề nghị hoàn khoản thanh toán dư",
  "sourcePaymentId": null,
  "sourceContractId": null
}
```

API POST bắt buộc header `Idempotency-Key` là UUID duy nhất, JWT theo role.
Nguồn tham chiếu (nếu có) phải nằm trong danh sách Tenant-owned của endpoint `sources`;
Tenant không thể tạo yêu cầu cho source của người khác, cũng không thể đọc chứng từ
của người khác. Không nhận `tenantId` từ client.

Owner POST decision:

```json
{
  "expectedVersion": 1,
  "approve": false,
  "reason": "Không có khoản hoàn hợp lệ",
  "humanConfirmed": true
}
```

Owner POST execution: `multipart/form-data` với `expectedVersion`, `executedAt`
(UTC, không thuộc tương lai, không trước thời điểm duyệt), `externalReference`,
`reason`, `humanConfirmed=true`, `evidence` ảnh JPEG/PNG tối đa 5 MiB.
Mã giao dịch phải duy nhất trong các nguồn refund và intent chưa hoàn thành;
private storage được xác minh hash SHA-256 và độ dài trước khi `COMPLETED`.
Nếu ảnh đang ở trạng thái upload pending, Owner phải retry đúng key/metadata và
cùng ảnh theo `executionIntent` để an toàn idempotency.

Trạng thái: `REQUESTED -> APPROVED -> COMPLETED`, hoặc `REQUESTED -> REJECTED`.
Không thể tự ghi `COMPLETED` trước khi Owner upload chứng từ đã chuyển khoản;
Tenant không có quyền quyết định, thực hiện chuyển khoản hoặc sửa yêu cầu sau gửi.
`APPROVED` chỉ là Owner đồng ý, **chưa** chứng minh đã chuyển tiền.

## Schema và vận hành

Compact24 giữ nguyên **24 bảng**. Migration SQL-only
`20261115000400_TenantRefundPetitions` nới CHECK nguồn cho các row
`TenantRefundPetitionV1` đã phân loại, không nới điều kiện với refund nguồn tiền thật.
Fresh schema DDL và baseline đã đồng bộ. Repo không tự động chạy schema migration
khi API Development khởi động trên database hiện hữu.

**Không chạy migration trên Neon/Development đang có dữ liệu khi chưa backup và
đánh giá vận hành.** Backend và FE cần được triển khai cùng migration; nếu schema
cũ còn CHECK XOR, POST không nguồn sẽ thất bại ở DB. Phần kiểm thử unit không chứng minh
PostgreSQL migration/proof storage/native device đã chạy thành công.

## Acceptance / giới hạn

- Tenant có/không có nguồn tham chiếu hợp lệ gửi đơn; request retry cùng key không
  tạo bản ghi khác; chọn nguồn thuộc Tenant khác bị 404.
- Owner duyệt/từ chối kèm lý do; version cũ bị 409; không có chứng từ thì không
  được Completed; Tenant chỉ xem proof của chính mình.
- Ảnh không hợp lệ, trùng bank reference, lỗi lưu file, replay key trùng payload
  khác phải trả lỗi tường minh.
- Không có tự động gửi tiền, không đánh dấu verified bank transaction dựa trên
  screenshot, không tự thay đổi tồn cọc/công nợ. Chủ dự án cần quyết định bổ sung
  luồng liên kết với ledger thật nếu muốn loại petition này tự làm căn cứ kết toán.
