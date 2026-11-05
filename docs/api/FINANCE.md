# Tài chính Owner trên Compact24

Nguồn: SRS FE-08, UC-31..34, GBR-01/02/15/16/18; yêu cầu triển khai 05/11/2026. Đây là các API mới cho module còn thiếu, không thay contract của routes hiện hữu. Owner có quyền toàn chuỗi theo mô hình single-Owner hiện tại. Staff/Tenant trả 403; anonymous 401. Service kiểm tra role lại bên trong. Số tiền VND được truyền dạng chuỗi số nguyên để giữ chính xác.

## Expenses UC-31

| Method | Route | Input / kết quả |
| --- | --- | --- |
| GET | `/api/v1/expenses` | Query `locationId,from,to,expenseType,category,page,pageSize`; `{items,total,page,pageSize}` |
| GET | `/api/v1/expenses/{id}` | `ExpenseView`, 404 nếu thiếu |
| POST | `/api/v1/expenses` | `ExpenseInput`, header UUID `Idempotency-Key`; trả bản ghi đã lưu |
| PUT | `/api/v1/expenses/{id}` | `{expense: ExpenseInput,expectedVersion,reason}`; trả bản đã cập nhật |

`ExpenseInput`: `{locationId,roomId?,expenseType,category,amount,occurredOn,note}`. `expenseType` là `INITIAL_INVESTMENT` hoặc `OPERATING`, category 1–60 ký tự, amount nguyên VND >0 và <10^18, ngày bắt buộc ISO, note 1–4000 ký tự. Location phải tồn tại; Room nếu có phải thuộc Location. List có page>=1, pageSize 1–100, ngày đầu không vượt ngày cuối; category lọc chính xác.

`ExpenseView` bổ sung `id,version,canEdit`. Tạo trùng cùng actor/key/payload trả cùng ID; đổi payload dùng lại key trả 409. Sau khi tạo, Location/Room/type bất biến; Owner sửa category/amount/date/note kèm reason 1–1000 ký tự và expectedVersion. Mỗi sửa lưu before/after/actor/UTC/reason bằng JSON append-only trong history. Hai sửa cùng version chỉ một thành công. Khoản chi có source do nghiệp vụ khác quản lý không được sửa qua API này. Không có DELETE. Evidence/asset/task/incident/source links đã có trong DB được giữ nguyên khi sửa.

Persistence: repository dùng truy vấn có tham số trên bảng `expenses`, projection trên Locations/Rooms Compact24, transaction, advisory lock cho create và row lock cho update. Không thêm bảng/cột, không migration phá hủy, không đăng ký legacy DbContext.

Ví dụ tổng hợp (thay UUID bằng cơ sở fixture):

```json
{"locationId":"00000000-0000-0000-0000-000000000001","roomId":null,"expenseType":"OPERATING","category":"Vệ sinh","amount":"200000","occurredOn":"2026-11-01","note":"Tham chiếu chứng từ tổng hợp"}
```

Owner Web `/expenses` và mục đầu tư trong Location dùng `ExpensesApiPage` khi `VITE_API_MODE=api`. Load/list/filter/detail/create/update gọi shared client `packages/client-core/src/finance.ts`, JWT/refresh/error từ client hiện hữu. API lỗi được hiển thị; không dùng demo fallback. Có loading/error/empty/success, khóa submit, giữ key khi retry lỗi không rõ kết quả. Khởi tạo danh sách cơ sở qua GET `/api/v1/capture/locations`. Mobile không có màn hình quản lý tài chính Owner mở rộng trong slice này.

Handoff: **INITIAL_API_UI_READY**, Vũ Xuân Trường review UI/UX; chưa phải FRONTEND_READY/E2E_PASSED. Test fixture: `Compact24ExpenseTests` tạo server/database disposable với dữ liệu tổng hợp, tự tạo Owner/Staff/Tenant/Location. Chạy bằng biến `BHOME_COMPACT24_TEST_ADMIN` trỏ loopback admin database `postgres`; không trỏ database làm việc. Browser/native E2E và upload/download chứng từ riêng chưa được triển khai trong slice này. Note chỉ là tham chiếu chứng từ, không phải ảnh chứng minh thanh toán.

## Báo cáo UC-32 và hoàn vốn UC-33

GET `/api/v1/financial-reports?from=2026-11-01&to=2026-11-30&locationId=<optional>&roomId=<optional>`. Owner-only, from/to bắt buộc, Room phải thuộc Location nếu cả hai được chọn. Trả `filter,snapshotAt,total,locations,capital,hasUnclassifiedRefunds`. Amount và tỷ lệ/ước tính dùng chuỗi decimal chính xác. Một transaction RepeatableRead bao toàn bộ truy vấn; group/sum ở PostgreSQL, không N+1 theo Location.

Các chỉ tiêu có định nghĩa riêng:

- `issued`: tổng hóa đơn Final có billingPeriod trong khoảng; không tính Draft.
- `approvedAdjustments`: delta Owner đã duyệt sau Final cho những hóa đơn đó. Correction trước Final đã nằm trong issued, không cộng lần nữa.
- `outstandingNow`: tổng max(0, issued + approved delta - verified allocation) trên từng hóa đơn trong kỳ, theo ledger hiện tại lúc snapshot. Đây không phải báo cáo công nợ lịch sử tại cuối kỳ.
- `verifiedCollections`: tổng allocation vào Invoice Final, payment VERIFIED, theo thời điểm `allocated_at` tại Asia/Ho_Chi_Minh trong khoảng ngày đóng-mở. Không cộng giao dịch chưa phân bổ, cọc hoặc payment `isDevelopmentDemo`. Reversal âm nếu có được giữ dấu. Đây là thời điểm xác nhận/phân bổ, không phải báo cáo số dư ngân hàng theo ngày chuyển.
- `operatingExpenses`: expenses loại OPERATING theo occurred_on trong kỳ. `operatingProfit` = issued + approvedAdjustments - operatingExpenses. Investment không phải OPEX; maintenance đã ghi vào OPERATING không được cộng hai lần.
- `totalRooms,occupiedRooms`: trạng thái hiện tại, không suy ra occupancy lịch sử từ trạng thái Room hiện tại.
- `initialInvestment`: tổng INITIAL_INVESTMENT lũy kế tới ngày cuối; `netOperatingCashFlow` = verifiedCollections - operatingExpenses nếu không có completed refund cần phân loại.

Hoàn vốn là mô hình quản trị phiên bản đầu, không phải chính sách thu/hoàn tiền: netRecovery = tổng allocation Invoice VERIFIED lũy kế - OPEX lũy kế; remainingCapital = max(0, investment - netRecovery); recoveryPercent = netRecovery/investment*100 (không ép về 0–100 vì có thể lỗ hoặc đã vượt vốn). EstimatedRemainingMonths = remainingCapital / bình quân dòng tiền tháng của kỳ được chọn. Chỉ ước tính khi kỳ gồm tháng trọn vẹn và bình quân dương; vốn đã thu hồi trả 0. Không có đầu tư, không có dòng tiền dương hoặc kỳ lẻ trả null kèm lý do. Không tự giả định hệ số tăng giá, lãi, khấu hao hoặc nghĩa vụ thuế.

Bảng refund chưa có phân loại khoản hoàn vào cashflow quản trị được duyệt. Nếu tồn tại bất kỳ COMPLETED refund trước cuối kỳ trên chuỗi, cashflow/recovery net và ước tính trả null với `refund_classification_required`, thay vì bỏ qua hoặc tự phân bổ số tiền đó. Guard này bảo thủ ngay cả báo cáo từng Location; cần quyết định allocation/refund cụ thể trước khi thu hẹp guard. Không tạo/sửa refund trong reporting.

Owner Web `/reports` dùng `FinancialReportsApiPage` trong API mode: chọn khoảng/cơ sở, xem tổng, theo Location và hoàn vốn. Hiển thị unavailable reason; không fallback demo khi lỗi. Room filter hỗ trợ ở API, chưa có selector trên UI. Chi phí Staff/maintenance cần được ghi trong expenses để tính vào báo cáo; chưa tự sinh payroll hoặc hợp nhất module chưa có. Không tuyên bố đã có báo cáo kế toán/thuế hoặc biểu đồ lịch sử occupancy. Handoff `INITIAL_API_UI_READY`, Vũ Xuân Trường.
