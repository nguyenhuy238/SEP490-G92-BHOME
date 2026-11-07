# Phase 2 — Holding Contract, Deposit and Price Protection

Ngày cập nhật: 06/11/2026.

Trạng thái: **IMPLEMENTED IN WORKTREE — NOT ACCEPTED / POSTGRESQL VERIFICATION BLOCKED**.

Phase 2 reuse và mở rộng workflow Contract, Payment, Property, signing, audit/history và expiry hiện có. Không tạo controller/service/repository song song cho cùng nghiệp vụ. Traceability chính: BF-03A/B, UC-14/15, DBR-02/03/08, JOB-05; authorization theo GBR-01..04 và location assignment hiện hành.

## Phạm vi đã triển khai

- Holding Draft không giữ phòng; Owner/Staff được gán Location có thể tạo draft cho tenant/resident đã xác minh.
- Chỉ Owner được approve, activate hoặc cancel Holding; Staff không được ký hoặc quyết định thay Owner/Tenant.
- Activation yêu cầu approval, đủ chữ ký Owner/Tenant, Holding Deposit đã verified/allocated đúng số tiền, price snapshot đã khóa, chưa hết hạn và không có room conflict.
- Room chỉ chuyển `Available -> OnHold` khi Holding activation thành công; cancel/expiry chỉ release `OnHold -> Available` khi không còn binding contract khác.
- Giá được resolve theo BillingPolicy hiện hành và khóa một lần khi đủ trigger chữ ký hoặc verified deposit; lưu policy id/version/rate trong snapshot để không bị thay đổi bởi policy về sau.
- Bank transfer có thể được allocate vào Holding Deposit. Partial payment được ghi nhận nhưng không cho activate; excess/mismatch giữ `PendingReview`; reference và allocation được kiểm tra idempotent.
- Conversion tạo Main Contract draft idempotently từ Active Holding và giữ nguyên protected rent/date/terms. Holding chỉ chuyển `Converted` atomically khi Main activation thành công; draft Main không release hoặc consume reservation.
- Deposit Holding được chuyển nguồn sang Main bằng canonical `PaymentAllocation`; một nguồn Holding không thể cấp vốn cho hai Main Contract.
- JOB-05 expiry giữ payment/signing/audit evidence, ghi lifecycle actor/time/reason và release Room theo cùng transaction/lock order.
- Room History hiển thị Holding activation/expiry/cancel/conversion. Holding không bị tính là physical occupancy; Occupancy Summary vẫn phân biệt `OnHold` với `Occupied`.

## API

- `POST /api/v1/contracts/holdings`
- `POST /api/v1/contracts/{id}/holding-approval`
- `GET /api/v1/contracts/{id}/holding-deposit`
- `POST /api/v1/contracts/{id}/holding-activation`
- `POST /api/v1/contracts/{id}/holding-cancellation`
- `POST /api/v1/contracts/{id}/holding-conversion`
- `POST /api/v1/payment-transactions/{id}/allocate-holding-deposit`

Các endpoint signing, deposit evidence, contract detail/history và Room readiness/history/occupancy có sẵn được reuse.

## Persistence và database

Không có migration, bảng mới hoặc thay đổi embedded Compact24 SQL. Implementation map vào các cột Compact24 đã tồn tại: contract kind/holding expiry/reserved capacity, PaymentAllocation source/target deposit và audit/history. Legacy EF model ignore các runtime-only Phase 2 fields để giữ migration snapshot ổn định; Compact24 runtime model cấu hình lại các field đó.

## Verification thực tế

Các kết quả đã thực thi trước blocker cuối:

- `PropertyRulesTests`: 27/27 PASS.
- `RoomInsightsServiceTests`: 9/9 PASS.
- `ContractServiceTests`: 34/34 PASS, gồm draft không reserve, immutable price lock, activation/cancel Room version và conversion draft không đánh dấu Converted.
- Migration snapshot consistency: 1/1 PASS.
- Solution build tại thời điểm kiểm tra: PASS.

PostgreSQL/API verification chưa đạt:

- `PropertyContractDockerTests`: 11 case được discover nhưng 0 assertion thực thi; fixture bị chặn vì image `postgres:16-alpine` không có và hai lần pull kết thúc bằng CDN `EOF`.
- Phase 2 end-to-end Holding API fixture còn phụ thuộc private image `bhome/minio-local`; Docker trả `pull access denied`, nên 0 business assertion được thực thi.
- Không test bị đổi thành skip, không assertion bị bypass và không truy cập shared developer database.

Vì Phase 1A critical PostgreSQL gate vẫn blocked, tài liệu này không tuyên bố Phase 2 accepted hoặc production-ready. Cần chạy lại PostgreSQL 16 Testcontainers và full backend regression sau khi các image test dependency khả dụng.

## Rủi ro còn lại

- Chưa có bằng chứng runtime PostgreSQL cho transaction/lock/concurrency của Holding activation, deposit allocation, conversion và expiry.
- Private MinIO test image chưa có quyền pull; cần cung cấp image/registry access đã được dự án phê duyệt, không tự reconfigure Docker.
- Settlement blocker của Main Contract vẫn là phạm vi chưa triển khai; Holding blocker cũ đã được gỡ khỏi workflow configuration vì Holding workflow hiện đã có code.
- Không có policy tự động refund/excess/deposit deduction mới; các nhánh này tiếp tục giữ trạng thái review theo OQ-01/02/05.
