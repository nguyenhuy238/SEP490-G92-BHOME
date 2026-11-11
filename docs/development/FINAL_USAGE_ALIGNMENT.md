# Tiền thuê và chỉ số chốt trong sổ phải thu

Nguồn: BR-13/14/15/19/20/21/22/23 được người dùng duyệt trong yêu cầu triển khai; BF-04/05/06, UC-19/20/21/22/25, GBR-07/08/09/10/18. Đây là phần đang triển khai, không phải bằng chứng đã hoàn thành.

| Hành vi                                                                             | Thành phần / dữ liệu                                                                            | Chấp nhận và ca âm                                                                                                  |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Chốt điện/nước từ mốc đã tính tiền, không bỏ usage vì có chỉ số xác nhận trung gian | MeterReading, InvoiceLine Final, Handover Confirmed, SettlementReceivableV1                     | Bỏ qua mốc chưa bill; thiếu baseline/đổi đồng hồ không có phân bổ thì Pending; ảnh/hash và biên bản Owner hợp lệ    |
| Không dùng lại bậc thấp hoặc định mức miễn phí của cùng kỳ                          | IUtilityBilling, snapshot tariff/quota/segment, phép tính phần tăng thêm                        | F(total)-F(previous); giữ policy đã duyệt trước; policy hoặc phân đoạn quá khứ đổi thì yêu cầu đối chiếu/điều chỉnh |
| Không tính trùng với hóa đơn/khoản phải thu đã duyệt                                | Nguồn consumption có MeterId, baseline/final IDs/values, period và khóa giao dịch Location/Room | Invoice trước/settlement trước, replay, concurrent approve/finalize, zero remaining usage                           |
| Tiền thuê tháng lẻ theo chính sách được Owner xác nhận áp dụng                      | BillingSchedule snapshot, hợp đồng đã ký, source rent, số ngày thực tế                          | Không tự chọn FullMonth/OccupiedCalendarDays; thiếu policy giữ Pending; không tự gán tiền phòng chung cho cá nhân   |
| Không có hóa đơn quyết toán riêng                                                   | Sổ phải thu và phân bổ tiền đã triển khai                                                       | Chỉ thêm source charge; bản Final cũ bất biến; thiếu phí/biên bản vẫn là chờ đối chiếu                              |

Giữ policy và mức giá hiệu lực, không tự đặt công thức tiền thuê mới. Chênh lệch tiền utility dựa trên giá tính theo policy trước/sau, không trừ số tiền sau discount/điều chỉnh để vô tình thu lại khoản đã được Owner giảm. Phân đoạn biểu giá cần dữ liệu Owner đã xác nhận; không ước lượng tiêu thụ theo ngày.

## Kết quả slice điện/nước chốt — 11/11/2026

BR-14/15/19: Owner Web xem preview baseline đã tính tiền, chỉ số chốt, lượng đã thu, lượng bổ sung và số tiền; duyệt đúng reference/idempotency key. Khoản phải thu bất biến lưu trong contracts.history, dùng phân bổ ngân hàng/cấn trừ hiện có; Tenant Mobile xem và thanh toán theo quyền lịch sử của khoảng tiêu thụ. Không tạo Final Settlement Invoice, không thêm bảng/migration. Utility snapshot giữ biểu giá/định mức tích lũy; tính F(total)-F(previous) để không cấp lại bậc thấp hay thu lại khoản giảm giá. Hóa đơn Draft phải refresh/review nếu phí được duyệt trước; dòng utility đã phủ mang nguồn rõ và không giả chỉ số vật lý. Hai hợp đồng cùng phòng có thể xác nhận Final cùng ngày với chỉ số không giảm.

Files: SettlementFinalUtilities/Repository, SettlementChargeEvidence, MeterBillingCoverage, UtilityIncrementCalculation, InvoiceService/Repository, CaptureRepository, shared client, FinalUtilitiesPanel, TenantSettlementReceivables/TenantInvoiceCharges. Thiếu quota, baseline, phân bổ đồng hồ thay thế, policy lịch sử hoặc bằng chứng thì Amount=null/Pending; không ước lượng để tạo phí chính thức.

Đã chạy: Application unit 394 PASS; PostgreSQL disposable FinalUtilityRegressionTests (5 ca), Compact24InvoiceRegressionTests và SettlementReceivableRegressionTests: tổng 16 PASS. Owner/Mobile typecheck và changed-file ESLint PASS. Storage là test substitute; không phải MinIO live, bank sandbox hoặc UI E2E. Tiền thuê/phí khác theo BR-13 và xác nhận đầy đủ danh sách phí tiếp tục ở slice sau.

## 11/11/2026 — Tiền thuê/phí cố định tháng cuối theo chính sách

BR-13/15/19: nguồn FinalFixed bất biến trong contracts.history giữ kỳ, mã phí, giá, policy/version hoặc hash hợp đồng đại diện, lựa chọn FullMonth/OccupiedCalendarDays/làm tròn, số ngày phòng có người và giá lũy kế. Owner Web phải xác nhận chính sách áp dụng đúng điều khoản đã ký; backend tính tiền, không đọc tự động free text để đoán thỏa thuận. Khoản mới chỉ là chênh lệch giá chính sách chưa ghi nhận; hóa đơn định kỳ sau đó loại phần đã ghi nhận, Final cũ không đổi. Khoản giảm đã duyệt không bị thu lại. Tenant Mobile hiển thị căn cứ và số dư backend; không tự chia nợ phòng cho cá nhân.

Thiếu lịch, bản hợp đồng hoặc dữ liệu khoảng ở giữ Amount=null. Khi người khác còn tiếp tục thuê, tiền thuê vẫn đối chiếu qua hóa đơn chung của phòng, không bịa phần tiền riêng cho người đi. Tất cả khoản phải thu có thể thu tiền/cấn trừ qua ledger đã có. Không thêm bảng hoặc migration; database làm việc không thay đổi.

Files: FixedChargeCalculation, FixedChargeCoverageRepository, SettlementFinalFixedCharges/Repository, InvoiceService, SettlementReceivablesRepository/Controller, shared client, FinalFixedChargesPanel, TenantSettlementReceivables và thông tin nguồn trên dòng hóa đơn.

Đã chạy: Release solution build PASS; Application unit 398 PASS; PostgreSQL disposable final-fixed/final-utility/invoice regression 16 PASS (bao gồm thiếu policy, còn người tiếp tục thuê, từ chối Staff/Tenant, xác nhận điều khoản, concurrent replay, thứ tự invoice/charge); Owner UI 20 PASS; Mobile 4 PASS; Owner/Mobile typecheck và changed-file ESLint PASS. Inspection metadata trong test fixed-charge là fixture synthetic; không coi đó là UI E2E hay kiểm thử live storage. Tiếp tục xác nhận đầy đủ danh sách phí, hoàn cọc sau offset, Holding và các phase còn lại.
