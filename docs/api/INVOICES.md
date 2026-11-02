# BH-21 — Billing API

POST `/api/v1/invoices/{id}/finalize`: Owner, `{ "expectedVersion": n }`.
Chỉ phát hành từ Draft đã đến ngày Final, đủ readings/rates và khớp input được revalidate
trong cùng Location/Room lock. Input thay đổi yêu cầu refresh rồi review lại; không âm thầm
phát hành số tiền mới. Replay/concurrent finalization trả cùng Final; một audit effect.
DB triggers cấm sửa/xóa/truncate hóa đơn Final, lines và recipient, kiểm tổng khớp lines.
Hạn thanh toán lấy từ snapshot schedule, không tự áp số ngày sau ngày phát hành.
Các endpoint này là thao tác Owner; chưa triển khai scheduler JOB-10 hay push/email billing.

Nguồn nghiệp vụ: [quyết định và traceability](../development/BH21_TRACEABILITY.md).
Thay DBR-06 bằng unique Room + tháng theo quyết định người dùng 01/11/2026.
Owner quản trị toàn chuỗi; Tenant chỉ đọc hóa đơn có snapshot recipient của mình;
Staff không truy cập số tiền/DTO hóa đơn. Không có Payment/Paid trong API này.
BH-41 thêm [luồng correction/adjustment](INVOICE_ADJUSTMENTS.md). InvoiceLine trả thêm
calculatedAmount/correctionRequestId khi có correction đã duyệt trước Final. Refresh/Finalize
áp correction khi fingerprint nguồn khớp; nguồn đổi trả missing input để Owner review lại.
Final total vẫn là số tiền đã phát hành; effective balance đọc qua Payment API riêng.

| Method | `/api/v1` route                           | Quyền, dữ liệu                                                            |
| ------ | ----------------------------------------- | ------------------------------------------------------------------------- |
| GET    | `/billing-schedules/{locationId}`         | Owner, cấu hình hoặc 204 nếu chưa có                                      |
| PUT    | `/billing-schedules`                      | Owner, mọi lựa chọn bắt buộc, expectedVersion=0 khi mới                   |
| POST   | `/invoices/drafts`                        | Owner; roomId, billingPeriod YYYY-MM-01, representativeContractId         |
| GET    | `/invoices?page=1&pageSize=20&roomId=...` | Owner/Tenant, lọc quyền trước count/page                                  |
| GET    | `/invoices/{id}`                          | Owner/Tenant, ngoài phạm vi 404                                           |
| POST   | `/invoices/{id}/refresh`                  | Owner; expectedVersion; chỉ Draft, thay dòng từ input hiện tại            |
| GET    | `/capture/meter-tasks/{id}`               | Owner/Staff hiện được giao Location                                       |
| GET    | `/capture/readings/{id}`                  | Owner/Staff, confirmedValue/previousValue/consumption dạng decimal string |

Schedule enums: rateDate 0 đầu kỳ / 1 cuối kỳ; rentSource 0 Room policy / 1 tiền thuê
của hợp đồng đại diện được Owner chọn; partialMonth 0 cả tháng / 1 phí cố định theo số
ngày có ít nhất một tenancy hợp lệ trong phòng chia ngày của tháng; rounding 0
AwayFromZero / 1 ToEven, từng dòng về VND. Utility không nhân tỉ lệ ngày.
Draft/Final/Due mỗi mốc có Day 1–31 và MonthOffset 0–2 so với tháng hóa đơn;
tháng ngắn co ngày về cuối tháng; yêu cầu Draft <= Final <= Due.

API không tự chọn schedule cho Location chưa cấu hình. Invoice lưu snapshot schedule;
refresh giữ lựa chọn đó. Rate lấy theo ngày đã chọn, dùng precedence của PropertyService.
Giá thay đổi giữa tháng áp dụng một mốc được chọn, không tự chia nhiều đoạn.
Đại diện được Owner chọn từ hợp đồng đủ điều kiện của phòng trong kỳ. Tổng tiền là
một nghĩa vụ chung, không phải cộng MonthlyRent của mọi hợp đồng riêng.

Draft thiếu mandatory input vẫn được lưu với `missingInputs`; tổng là tổng các dòng
hiện có, chưa phải số tiền chính thức. Chỉ lấy periodic reading confirmed, có ảnh linked,
baseline khớp và không bỏ cách quá một tháng; nhiều meter/replacement cần review.
PolicyId/version/rate/date và readingId/previous/current/quantity đều được snapshot.
`RecordUsage` và insert invoice trong cùng transaction/Location advisory lock + Room row lock.

POST Draft lặp cùng Room/kỳ/đại diện trả cùng bản ghi; đổi đại diện trên cùng identity trả 409. Refresh dùng version chống ghi đè. Không tự retry mutation sau lỗi mạng mơ hồ.
Amounts/quantities trong Invoice response và `rate` của BillingPolicy response là decimal strings.
Client giữ nguyên độ chính xác, chỉ format dấu phân cách Việt Nam và bỏ zero dư khi hiển thị.
400 validation, 401 auth,
403 role, 404 scoped lookup, 409 missing configuration/stale/duplicate/state. Lỗi theo
ProblemDetails, không chứa input tài chính nhạy cảm, credential hoặc danh sách Tenant khác.

Thay đổi schema dùng migration, chỉ kiểm chứng trên database Testcontainers/Development riêng.
Rollback chặn khi đã có billing data hoặc nhiều Active contracts/phòng; không xóa dữ liệu để rollback.
