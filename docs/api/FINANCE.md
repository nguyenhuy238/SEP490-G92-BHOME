# Tài chính Owner trên Compact24

Nguồn: SRS FE-08, UC-31..34, GBR-01/02/15/16/18; yêu cầu triển khai 05/11/2026. Đây là các API mới cho module còn thiếu, không thay contract của routes hiện hữu. Owner có quyền toàn chuỗi theo mô hình single-Owner hiện tại. Staff/Tenant trả 403; anonymous 401. Service kiểm tra role lại bên trong. Số tiền VND được truyền dạng chuỗi số nguyên để giữ chính xác.

## Expenses UC-31

| Method | Route                   | Input / kết quả                                                                              |
| ------ | ----------------------- | -------------------------------------------------------------------------------------------- |
| GET    | `/api/v1/expenses`      | Query `locationId,from,to,expenseType,category,page,pageSize`; `{items,total,page,pageSize}` |
| GET    | `/api/v1/expenses/{id}` | `ExpenseView`, 404 nếu thiếu                                                                 |
| POST   | `/api/v1/expenses`      | `ExpenseInput`, header UUID `Idempotency-Key`; trả bản ghi đã lưu                            |
| PUT    | `/api/v1/expenses/{id}` | `{expense: ExpenseInput,expectedVersion,reason}`; trả bản đã cập nhật                        |

`ExpenseInput`: `{locationId,roomId?,expenseType,category,amount,occurredOn,note}`. `expenseType` là `INITIAL_INVESTMENT` hoặc `OPERATING`, category 1–60 ký tự, amount nguyên VND >0 và <10^18, ngày bắt buộc ISO, note 1–4000 ký tự. Location phải tồn tại; Room nếu có phải thuộc Location. List có page>=1, pageSize 1–100, ngày đầu không vượt ngày cuối; category lọc chính xác.

`ExpenseView` bổ sung `id,version,canEdit`. Tạo trùng cùng actor/key/payload trả cùng ID; đổi payload dùng lại key trả 409. Sau khi tạo, Location/Room/type bất biến; Owner sửa category/amount/date/note kèm reason 1–1000 ký tự và expectedVersion. Mỗi sửa lưu before/after/actor/UTC/reason bằng JSON append-only trong history. Hai sửa cùng version chỉ một thành công. Khoản chi có source do nghiệp vụ khác quản lý không được sửa qua API này. Không có DELETE. Evidence/asset/task/incident/source links đã có trong DB được giữ nguyên khi sửa.

Persistence: repository dùng truy vấn có tham số trên bảng `expenses`, projection trên Locations/Rooms Compact24, transaction, advisory lock cho create và row lock cho update. Không thêm bảng/cột, không migration phá hủy, không đăng ký legacy DbContext.

### Chứng từ riêng tư (06/11/2026)

- `GET /api/v1/expenses/{id}/evidence`: Owner-only; metadata `{id,operationKey,contentType,length,sha256,status,recordedAt}`. Không trả object key hoặc URL công khai.
- `POST .../{id}/evidence`: body ảnh PNG/JPEG, `Content-Type` tương ứng và UUID `Idempotency-Key`. Kiểm nội dung giải mã, tối đa 5 MB; không hỗ trợ PDF/HTML/SVG. Giới hạn kỹ thuật 20 phần tử evidence mỗi khoản chi. Sai nội dung 400, quá dung lượng 413, key trùng khác bytes/type 409.
- `GET .../{id}/evidence/{fileId}`: Owner-only, file phải thuộc đúng khoản chi và Uploaded. Đọc private storage, kiểm length/SHA-256 trước trả bytes; sai hash 409. Filename do server tạo. Staff/Tenant 403, sai expense/file 404; no-store.

JSON `expenses.evidence` giữ durable intent `PendingUpload` trước khi gửi storage; chỉ chuyển Uploaded sau khi đọc lại kiểm integrity. Lỗi upload không báo thành công/không cho tải file Pending. Retry cùng key/bytes tiếp tục đúng object và không thêm evidence/audit lần hai; Owner Web tải lại metadata và dùng hash để tìm key Pending sau khi mở lại. Intent còn liên kết khoản chi và key storage để phục hồi sau lỗi; không có cleanup xóa chứng từ được công bố tự động. Không đổi amount hoặc phiên bản chỉnh sửa tài chính. Uploaded metadata ghi actor/time và có SecurityAudit `ExpenseEvidenceUploaded`. Metadata evidence cũ khác envelope được giữ nguyên, chưa được giải mã/hiển thị bằng API mới.

Owner Web mở khoản chi đã lưu → chọn ảnh → tải lên → đọc lại danh sách → tải private. Không tự tạo khoản chi từ ảnh. Component tests có failure/retry/double submit/Pending recovery/integrity error; PostgreSQL có replay/race/tamper/role/cross-file/legacy preservation và upload gián đoạn; browser chạy qua MinIO thật, đối chiếu bytes file người dùng tải xuống. Xem [báo cáo triển khai](../development/NGUYEN_QUOC_HUY_E2E_IMPLEMENTATION.md).

Ví dụ tổng hợp (thay UUID bằng cơ sở fixture):

```json
{
  "locationId": "00000000-0000-0000-0000-000000000001",
  "roomId": null,
  "expenseType": "OPERATING",
  "category": "Vệ sinh",
  "amount": "200000",
  "occurredOn": "2026-11-01",
  "note": "Tham chiếu chứng từ tổng hợp"
}
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

## What-if UC-34

Owner-only: POST `/api/v1/financial-scenarios/analyze` không ghi DB; POST `/api/v1/financial-scenarios` lưu với UUID `Idempotency-Key`; GET collection `?page=1&pageSize=25` và GET `/{id}` xem snapshot đã lưu. Không có UPDATE/DELETE hay mutation vào sổ thực tế. List/get lọc created_by_user_id. Key trùng cùng input trả cùng snapshot, dù dữ liệu thật đã thay đổi; khác input trả 409. Advisory transaction lock bảo vệ save đồng thời. Lưu duy nhất bảng `financial_scenarios`, không thêm schema.

Input `{name,baseline:{from,to,locationId?},forecastMonths,assumptions}`. Baseline gồm tháng trọn vẹn, chỉ Chain/Location; cần ít nhất một Room. forecastMonths 1–32767 theo smallint của schema. Assumptions bắt buộc: `monthlyRent,occupancyPercent,collectionPercent,monthlyUtilityServiceCost,monthlyStaffCost,monthlyMaintenanceCost,monthlyOtherCost`. Tỷ lệ từ 0–100; tiền nguyên VND không âm và <10^18. Chi phí là tổng mỗi tháng cho toàn phạm vi, không tự nhân theo phòng. Client không tính kết quả tài chính.

Mô hình `management-constant-v1`: monthlyRevenue = round(Rooms * occupancyPercent /100 * monthlyRent); monthlyCollections = round(revenue * collectionPercent /100); monthlyOPEX = tổng bốn nhóm chi phí; profit = revenue - OPEX; netCash = collections - OPEX; forecastCash = netCash * forecastMonths; remainingCapitalAtEnd = max(0, baselineRemainingCapital - forecastCash). Làm tròn VND AwayFromZero chỉ trong dự báo, không sửa billing policy thật. Không lãi, tăng giá, khấu hao hoặc tự giả định thu đủ tiền: Owner nhập collectionPercent rõ ràng. EstimatedRemainingMonths dùng baselineRemainingCapital/netCash dương; thiếu vốn/phân loại refund/dòng tiền không dương trả null. monthlyProfitDifference so với bình quân lợi nhuận tháng của baseline. Giữ dấu âm khi dự báo lỗ.

View chứa `id,input,baseline,result,calculationVersion`. Snapshot và result đã lưu được đọc nguyên trạng, không tính lại khi xem. Owner Web `/what-if` trong API mode cho nhập/phân tích/lưu/list/xem/so sánh hai snapshot và so với baseline. Loading/error/success, submit lock và stable retry key; chỉnh giả định phải phân tích lại. Handoff `INITIAL_API_UI_READY`, Vũ Xuân Trường; chưa có browser E2E/review cuối.

## Chạy browser E2E với Compact24 riêng

`dotnet run --project tools/BHome.ContractVerification -- --finance` từ repository root, với `BHOME_COMPACT24_TEST_ADMIN` trỏ loopback admin database `postgres`. Harness dùng Compact24Fixture tạo/xóa database mới, khởi tạo tài khoản và Room tổng hợp, chạy API thật (Testing) + Vite API mode + Edge headless bằng Playwright đã có trong `.tools/contract-browser`. Không route mock, không seed kết quả tài chính, không đọc `.env` của database làm việc, không lưu credentials vào repo.

Đã đạt bốn nhóm browser acceptance: tạo/reload/sửa Expense có reason; báo cáo từ khoản chi vừa lưu và null payback; analyze/save/reload snapshot What-if; lưu/reload cấu hình Owner hợp đồng với thông tin tổng hợp được mã hóa. Trạng thái **E2E_PASSED cho các đường đi này**, UI vẫn cần Vũ Xuân Trường review. Không suy rộng sang ký MySign, handover native hoặc toàn bộ contract E2E.

TLS test dùng certificate localhost sinh tạm, API readiness pin certificate đó; browser context dùng ignoreHTTPSErrors chỉ cho traffic tổng hợp trong test. Không sửa OS trust store hoặc production TLS settings; test này không chứng minh browser certificate-trust deployment. API/process/database/PFX được dọn sau run. Không chạy song song build ghi lại DLL API đang được browser harness dùng; build trước, rồi `--no-build` nếu cần chạy song song các bộ test chỉ đọc artifact.
