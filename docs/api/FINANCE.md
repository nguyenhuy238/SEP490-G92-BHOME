# Tài chính Owner trên Compact24

## Hoàn thiện quản trị tài chính (25/11/2026)

Phần này cập nhật triển khai trong workspace, bổ sung/thay thế các mô tả trạng thái ban đầu bên dưới. Nguồn FE-08/UC-31–34, GBR-01/02/15/16/18 và yêu cầu tài chính ngày 25/11. Xem [audit và kết quả kiểm chứng](../development/OWNER_FINANCE_COMPLETION_2026-11-25.md). Các endpoint sau đều Owner-only, không cache; ghi dữ liệu yêu cầu UUID `Idempotency-Key`, kiểm phiên bản và lưu lịch sử. Số tiền dùng decimal, JSON dạng chuỗi.

| Method     | Route                                                                    | Hành vi                                                                                                                                                                                                                                                                                                  |
| ---------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET / POST | `/api/v1/expenses/{id}/payments`                                         | Đọc/ghi xác nhận thực chi; POST `{amount,paidOn,expectedVersion,note}`. Amount là phần trả thêm, không phải tổng thay thế. Amount 0 + paidOn null xác nhận chưa chi; không suy từ ngày tạo chi phí thành đã trả.                                                                                         |
| POST       | `/api/v1/expenses/{id}/payments/due-date`                                | `{dueOn,expectedVersion,note}`; hạn trả có thể bỏ bằng null, giữ lịch sử. Trạng thái hạn trả theo ngày Việt Nam.                                                                                                                                                                                         |
| GET / POST | `/api/v1/staff-costs`                                                    | GET `?period=yyyy-MM-01` đọc hợp đồng/phân công hợp lệ. POST `{employmentId,period,category,total,shares:[{locationId,amount}],note}`; tổng shares phải đúng total, chỉ cơ sở được phân công trong kỳ. Lương không được ghi hai lần cho cùng Staff/kỳ; thưởng/phụ cấp là các khoản Owner xác nhận riêng. |
| GET        | `/api/v1/depreciation` và `/{expenseId}`                                 | Lô vốn, cấu hình và kết quả khấu hao; collection có locationId/page/pageSize.                                                                                                                                                                                                                            |
| POST       | `/api/v1/depreciation/{expenseId}`                                       | `{kind,inServiceOn,usefulLifeMonths,salvageValue,effectiveFrom,retiredOn,expectedVersion,note}`; phiên bản hiệu lực, không ghi đè tháng lịch sử.                                                                                                                                                         |
| POST       | `/api/v1/depreciation/{expenseId}/disposal`                              | `{disposedOn,saleAmount,expectedVersion,note,quantity?,recognizeInOpenPeriod?}`; giữ nguyên lô gốc và lịch sử, hỗ trợ thanh lý một phần lô có số lượng. Chưa xác nhận thu tiền thì chưa phải dòng tiền vào.                                                                                              |
| POST       | `/api/v1/depreciation/{expenseId}/disposal-receipts`                     | `{amount,receivedOn,expectedVersion,note,disposalKey?}`; ghi tiền thực thu của đúng lần thanh lý, không tự coi toàn bộ giá bán là đã thu.                                                                                                                                                                |
| GET        | `/api/v1/depreciation/{expenseId}/replacement-review`                    | `?replacementCost=...` tùy chọn, tổng hợp sửa chữa/tuổi/giá trị còn lại; gợi ý để Owner cân nhắc, không tự quyết định.                                                                                                                                                                                   |
| GET        | `/api/v1/financial-reports/sources`                                      | Cùng ReportFilter + kind `revenue`, `cash`, `debt`, `period-debt`, `deposit`; page/pageSize và tổng toàn bộ nguồn, không chỉ tổng trang.                                                                                                                                                                 |
| GET        | `/api/v1/financial-reports/depreciation-sources`                         | Lô cấu thành khấu hao, tổng đã biết và số lô chưa đủ dữ liệu.                                                                                                                                                                                                                                            |
| GET        | `/api/v1/financial-reports/bank-receipt-sources`, `/bank-refund-sources` | Đối chiếu tiền ngân hàng toàn chuỗi; không nhận Location/Room filter vì receipt chưa phân bổ chưa xác định được cơ sở.                                                                                                                                                                                   |
| GET        | `/api/v1/financial-scenarios/defaults`                                   | ReportFilter theo các tháng đã kết thúc; đề xuất từ dữ liệu thực tế/nghĩa vụ tháng kế tiếp, trả null và limitation khi thiếu căn cứ.                                                                                                                                                                     |

`ExpensePaymentView.status`: `Unknown`, `Unpaid`, `PartiallyPaid`, `Paid`; `dueStatus`: `Unknown`, `NotDue`, `DueToday`, `Overdue`, `Paid`. Khoản chi legacy chưa có xác nhận không bị gán mặc định đã trả/chưa trả. Thực chi không vượt số tiền khoản chi; thao tác có row lock, optimistic version và replay cùng key không cộng thêm. Sửa khoản chi không được làm số tiền thấp hơn số đã trả.

Report giữ các field cũ để Mobile/snapshot cũ đọc được, bổ sung nullable `management` tại Total/Location, `comparison` khi `includeComparison=true` và `receiptReconciliation`. `management.actualBusinessCollections` dùng ngày `payments.received_at` cho allocation đã xác minh vào Invoice/initial rent; khác `verifiedCollections` cũ theo ngày phân bổ. Cọc, chuyển đổi cọc và bù trừ cọc không tạo doanh thu hoặc dòng tiền kinh doanh mới. Tiền ngân hàng chưa phân bổ được đối chiếu riêng toàn chuỗi; không gán tùy tiện về cơ sở.

`trend` là danh sách điểm theo tháng trong cùng snapshot: `{from,to,revenue,operatingExpenses,operatingProfit,actualBusinessCollections,operatingPaymentsConfirmed,isComplete}`. Ngày đầu/cuối cắt đúng khoảng lọc; tháng không có bản ghi nguồn trả số 0 có căn cứ. `isComplete` chỉ đúng cho tháng trọn vẹn đã kết thúc theo ngày Việt Nam. Doanh thu tái sử dụng hóa đơn/điều chỉnh và khoản phải thu quyết toán; thực thu theo ngày ngân hàng, loại cọc; thực chi chỉ gồm các xác nhận thực chi. Không suy từ số tiền chi đã xác nhận bằng 0 thành lịch sử chi đầy đủ. Tổng các điểm khớp chỉ tiêu tương ứng trong báo cáo. Năm truy vấn aggregate cố định, không truy vấn lại toàn báo cáo cho từng tháng. Giới hạn kỹ thuật 120 tháng cho chuỗi biểu đồ; khoảng dài hơn vẫn có báo cáo tổng, `trend=null` và `trendUnavailableReason=period_too_long`. Snapshot/client cũ thiếu field này được giữ là chưa có dữ liệu biểu đồ.

Lợi nhuận = doanh thu hóa đơn thuộc kỳ + điều chỉnh duyệt − OPEX phát sinh. Thực chi vận hành theo `paidOn`, kể cả trả nợ chi phí kỳ trước; chưa trả của kỳ và phần chưa xác nhận theo dõi riêng. `management.operatingCashFlow` = thực thu kinh doanh − thực chi vận hành; `netCashAfterInvestment` trừ thực chi đầu tư và cộng thực thu thanh lý. Có lịch sử chi/hoàn tiền/nguồn vốn chưa đầy đủ thì chỉ tiêu phụ thuộc trả null kèm lý do. Khấu hao không phải thực chi.

`management.cashCapital` là mô hình thực thu/thực chi; giữ `capital` cũ để không đổi ý nghĩa dữ liệu đã lưu. Vốn đầu tư được trừ dòng tiền kinh doanh lũy kế và tiền thanh lý đã thu; không trừ đầu tư thêm lần hai trong dòng tiền dùng thu hồi vốn. Thiếu nguyên giá trả `investment_basis_required`; thiếu lịch sử thực chi trả `expense_payment_history_required`; không có vốn trả `initial_investment_required`; có hoàn tiền chưa phân loại trả `refund_classification_required`. Chỉ ước tính thời gian khi kỳ gồm các tháng đã kết thúc theo ngày Việt Nam và dòng tiền bình quân đủ căn cứ; kỳ chưa kết thúc/lẻ tháng trả `full_month_baseline_required`.

Khấu hao quản trị đường thẳng: tính từ tháng sử dụng trọn vẹn đầu tiên, ghi nhận cuối tháng; làm tròn lũy kế VND AwayFromZero để không tích sai số từng tháng. Không vượt phần nguyên giá trừ giá trị thu hồi; không khấu hao Land/NonDepreciable. Thay cấu hình áp dụng từ kỳ mở/tương lai, giữ revisions cũ; thanh lý giữ lịch sử, dừng phần đã thanh lý và giảm số lượng còn lại. Lô thiếu cấu hình/nguyên giá không được coi khấu hao bằng 0. Đối chiếu sửa chữa trả số lần, tổng tiền và tỷ lệ so với giá tham khảo Owner nhập; không đặt ngưỡng tài chính 50% hoặc quyết định tự động thay tài sản. Cảnh báo sửa nhiều lần chỉ mô tả thực tế có nhiều hơn một lần nghiệm thu.

Kịch bản mới có `calculationVersion=management-cash-v2`. Các giả định bổ sung: `monthlyServiceRevenue`, `additionalInvestment`, nullable `monthlyDepreciation`, `operatingPaymentPercent` (0–100), `costIncreasePercent` (0–1000). Doanh thu gồm thuê dự kiến + dịch vụ; chi phí gồm bốn nhóm nhân hệ số tăng; thực thu/thực chi theo tỷ lệ Owner xác nhận. Dòng tiền sau đầu tư chỉ trừ đầu tư bổ sung một lần. Analyze/save đều yêu cầu kỳ nền đã kết thúc (`completed_baseline_required`), còn replay snapshot cũ không tính lại. Thiếu vốn/lịch sử thì vốn cuối dự báo và thời gian hoàn vốn null; các dự báo doanh thu/chi phí với giả định rõ vẫn được trả. Không ghi giá, Contract, Invoice, Payment hay Expense thật.

Không đổi schema hoặc tạo migration: tái sử dụng `expenses.history`, dữ liệu setup phiên bản và bảng `financial_scenarios`. Đây không phải nghiệm thu dữ liệu legacy/production, provider ngân hàng thật hoặc kế toán/thuế.

## Quyết định khóa giá hợp đồng (13/11/2026)

Thay thế quy tắc nguồn giá thuê tùy chọn cũ (BF-01/UC-04–07, BF-03/04, BF-05/UC-20–21, JOB-10): tất cả khoản thu tiền thuê, điện, nước và dịch vụ cố định đã thỏa thuận được lưu trong `Contract.AgreedPriceSnapshot` phiên bản 1 và gắn vào tài liệu/hash hợp đồng. Hợp đồng giữ chỗ được Owner duyệt khóa các khoản thu; hợp đồng chính thức chuyển từ giữ chỗ kế thừa đúng đơn giá đã chốt. Hợp đồng chính thức trực tiếp khóa khi phát hành/khởi tạo ký. Gia hạn là phiên bản mới, không sửa hợp đồng cũ.

- Không tạo, sửa, thay thế, kết thúc biểu phí riêng của phòng hoặc cấu hình profile điện nước riêng khi phòng có hợp đồng ràng buộc; API trả 409 `room_pricing_locked_by_contract`. Biểu phí chung vẫn được cấu hình cho giao dịch mới. Chỉ giải phóng khóa khi không còn hợp đồng ràng buộc (hủy/hết hạn/kết thúc lifecycle); quá ngày thuê nhưng chưa hoàn tất trả phòng vẫn bảo toàn giá.
- Hóa đơn và quyết toán lấy giá từ snapshot hợp đồng, không từ biểu giá hiện hành. Lịch hóa đơn lưu `RepresentativeContract` kể cả client cũ gửi `RoomPolicy`; đọc cấu hình cũ không thay đổi hóa đơn đã phát hành. Số lượng thực tế từ chỉ số đã xác nhận; đơn giá điện/nước cố định. Hợp đồng cùng phòng có biểu phí khác nhau trong kỳ cần đối chiếu, không tự tính giá trộn.
- Hợp đồng cũ thiếu snapshot đã ký không tự lấy giá hiện tại để bổ sung; chặn tính/phát hành phần thiếu và yêu cầu đối chiếu điều khoản gốc. Biểu giá điện nước nâng cao theo profile/định mức chưa có snapshot hợp đồng tương thích; cần đối chiếu trước khi ký, không tự chuyển giá bậc thang sang giá phẳng. Không thay đổi hóa đơn lịch sử hoặc chạy migration dữ liệu trong đợt này.

Cập nhật **06/11/2026**. [Trạng thái bàn giao](API_IMPLEMENTATION_STATUS.md),
[danh mục routes](API_RUNTIME_ROUTES.md). Browser đã chạy các đường đi mô tả cuối tài liệu;
review UI và nghiệm thu native/provider vẫn còn riêng.

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

### Tham chiếu Room / Asset / Work Order (06/11/2026)

ExpenseInput bổ sung nullable `assetId,taskId`; ExpenseView bổ sung các ID và `assetName,taskTitle`. Request không dùng tham chiếu giữ nguyên định dạng fingerprint idempotency cũ (không serialize các trường mới khi null). `taskId` ở chức năng này phải là Work Order thật trong `operational_tasks`, không phải Meter/General/System task.

Owner-only `GET /api/v1/expenses/reference-choices?locationId={uuid}&roomId={uuid?}` trả `{rooms,assets,workOrders,truncated}`. Mỗi choice `{id,label,roomId,assetId}`; assets/Work Orders đúng Room hoặc khu chung khi roomId null, giới hạn 500 mỗi nhóm và báo truncated. UUID rỗng 400, Location/Room không hợp lệ 404, Staff/Tenant 403. Không tạo Work Order hoặc thay lifecycle/approval/cost của nó.

Tạo khoản chi kiểm lại trong transaction dưới Location lock: Asset phải cùng Location và Room; Work Order/Incident phải cùng phạm vi, Asset của Work Order nếu có phải khớp Asset đã chọn; Work Order chỉ gắn OPERATING. Server tự giữ incident_report_id từ Work Order. Nguồn sai scope, không tồn tại hoặc sai task type trả 404; không cho đổi các liên kết đã ghi khi correction tiền/nội dung (409). UI chọn phòng, Asset, Work Order từ API thật; chọn Work Order có Asset sẽ điền đúng Asset; không có dữ liệu nguồn thì hiển thị rỗng. Tham chiếu không tự sinh thêm chi phí, phê duyệt plan hoặc tạo bút toán từ status Work Order.

Backend hiện chưa có Work Order controller/service hoàn chỉnh. Integration fixture kiểm tham chiếu trên bản ghi nguồn tổng hợp đã có trong schema; đây không phải nghiệm thu quy trình Work Order. Browser đã kiểm Room/Asset thật từ Compact24, correction/reload giữ liên kết; dữ liệu nguồn Work Order không bị giả trong UI.

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

Handoff hiện tại: **API/UI đã nối, browser đã kiểm các đường Expense nêu dưới; UI/UX chờ Vũ Xuân Trường review**. `Compact24ExpenseTests` dùng server/database disposable và dữ liệu tổng hợp Owner/Staff/Tenant/Location. `BHOME_COMPACT24_TEST_ADMIN` chỉ trỏ loopback admin database `postgres`, không database làm việc. Private upload/reload/download và đối chiếu bytes đã được chạy qua MinIO thật cục bộ; native/provider production chưa nghiệm thu. Note không thay ảnh chứng từ hoặc xác minh ngân hàng.

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

Bổ sung 06/11 theo ủy quyền chính sách: hoàn tiền thừa receipt qua [REFUNDS.md](REFUNDS.md) có state v1 cuối cùng/evidence/Completed event và nguồn VERIFIED/payer/allocation khớp được phân loại riêng. Hoàn gốc cọc có marker `SecurityDepositRefundV1`, depositor attestation, settlement Contract/occupant/source hợp lệ, plan ID đúng nếu có khấu trừ và tổng nguồn cọc đủ đối ứng cũng được phân loại riêng. Cả hai nguồn chưa từng nằm trong verifiedCollections nên hoàn lại không phải OPEX hoặc đảo doanh thu. Metadata proof key/reference/SHA256 phải khớp; report không tải lại ảnh từng dòng, workflow execution đã kiểm bytes trước durable Completed. Mọi COMPLETED refund khác/thiếu phân loại trước cuối kỳ trên chuỗi vẫn làm net/recovery/ước tính null với `refund_classification_required`. Guard bảo thủ vẫn áp toàn chuỗi, kể cả khi chọn một Location/Room; không ghi/sửa refund khi đọc report.

Response thêm `verifiedDepositReturns` (chuỗi decimal): tổng hoàn gốc cọc **đã phân loại, không demo** theo executed_at trong kỳ ngày Việt Nam và đúng Location/Room filter. Đây là subtotal nguồn đã xác minh, không phải số dư ngân hàng hoặc tổng nghĩa vụ cọc; REQUESTED/APPROVED không được tính. Nguồn cũ chưa có trường này trong saved What-if snapshot giữ null, không tự thay thành 0. Owner Web hiển thị riêng với note: mô hình profit/net/recovery hiện tại vẫn là Invoice allocations/OPEX; phần giữ cọc bồi thường TenantDamage chưa cộng vào các chỉ số đó. Chi phí sửa chữa phải ghi qua Expenses, không tự sinh từ deduction hoặc double-count thành OPEX. Chưa có báo cáo tổng liability/realized damage compensation hoặc kế toán/thuế.

Owner Web `/reports` dùng `FinancialReportsApiPage` trong API mode: chọn khoảng/cơ sở/phòng theo tên, xem tổng, theo Location và hoàn vốn. Room choices tái sử dụng GET capture locations/rooms được phân quyền; đổi Location xóa Room cũ. KPI và biểu đồ lấy số liệu server, chỉ quy đổi tỷ lệ chiều dài thanh; nhãn tiền giữ chuỗi decimal chính xác, gồm số âm. Hiển thị unavailable reason; không fallback demo khi lỗi. Chi phí Staff/maintenance cần được ghi trong expenses để tính vào báo cáo; chưa tự sinh payroll hoặc hợp nhất module chưa có. Không có subtotal maintenance riêng trong DTO hiện tại nên không dựng chỉ tiêu này từ một trang chi phí. Không tuyên bố đã có báo cáo kế toán/thuế. Handoff `INITIAL_API_UI_READY`, Vũ Xuân Trường.

### Lấp đầy theo kỳ (06/11/2026)

Truy vết UC-07/UC-32, FE-08 và GBR-01/02/16: response bổ sung nullable `historicalOccupancy` `{status,from,to,occupiedRoomDays,rentableRoomDays,occupancyRate,limitations}`. Tái sử dụng `IRoomInsightsRepository`/`PropertyService.CalculateHistorical` từ module Property, đọc bằng cùng DbContext trong transaction RepeatableRead của báo cáo. Không gọi API riêng ở frontend rồi ghép hai snapshot. Giữ nguyên `totalRooms,occupiedRooms` hiện tại và toàn bộ công thức tiền/hoàn vốn.

Kỳ đóng gồm from..to theo ngày Việt Nam. Mỗi Room/ngày được tính tối đa một lần dù có nhiều Resident; chỉ tính ngày Location hoạt động và Room có thể cho thuê (không Unavailable), dùng audit trạng thái và khoảng residence của Contract đã kích hoạt. `occupancyRate = round(occupiedRoomDays * 100 / rentableRoomDays, 2)` theo bộ tính Property hiện hữu. Nếu mẫu số 0 thì tỷ lệ null, không phải 0%. Không dùng Room.Status hiện tại để dựng quá khứ, không tự ước tính ngày chưa có evidence.

| status                | Điều kiện và kết quả                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------- |
| Complete              | Đủ creation/status audit Location/Rooms cho kỳ; trả ngày-phòng và tỷ lệ, có thể null khi mẫu số 0 |
| InsufficientData      | Thiếu audit theo điều kiện completeness của Property; cả số ngày-phòng và tỷ lệ null              |
| LocationRequired      | Chưa chọn đúng một Location; chưa tổng hợp lịch sử toàn chuỗi                                     |
| RoomFilterUnsupported | Có Room filter; lịch sử hiện chỉ hỗ trợ phạm vi Location                                          |
| PeriodUnsupported     | Chênh lệch to/from vượt 366 ngày, cùng giới hạn kỹ thuật API occupancy-summary                    |
| FuturePeriod          | to sau ngày hiện tại Asia/Ho_Chi_Minh; không gọi dự báo là lịch sử                                |

Các trạng thái unavailable không làm mất chỉ tiêu tài chính hợp lệ của cùng báo cáo. UI hiển thị kỳ dd/MM/yyyy, số liệu server hoặc lý do tiếng Việt, giữ tách biệt với occupancy hiện tại. Field optional cho client và saved What-if baseline cũ; thiếu field hiển thị chưa có dữ liệu, không tính bù. Snapshot What-if mới giữ lịch sử đã đọc, nhưng thuật toán giả định `management-constant-v1` không đổi và không dùng lịch sử này để sửa ledger thật.

## What-if UC-34

Owner-only: POST `/api/v1/financial-scenarios/analyze` không ghi DB; POST `/api/v1/financial-scenarios` lưu với UUID `Idempotency-Key`; GET collection `?page=1&pageSize=25` và GET `/{id}` xem snapshot đã lưu. Không có UPDATE/DELETE hay mutation vào sổ thực tế. List/get lọc created_by_user_id. Key trùng cùng input trả cùng snapshot, dù dữ liệu thật đã thay đổi; khác input trả 409. Advisory transaction lock bảo vệ save đồng thời. Lưu duy nhất bảng `financial_scenarios`, không thêm schema.

Input `{name,baseline:{from,to,locationId?},forecastMonths,assumptions}`. Baseline gồm tháng trọn vẹn, chỉ Chain/Location; cần ít nhất một Room. forecastMonths 1–32767 theo smallint của schema. Assumptions bắt buộc: `monthlyRent,occupancyPercent,collectionPercent,monthlyUtilityServiceCost,monthlyStaffCost,monthlyMaintenanceCost,monthlyOtherCost`. Tỷ lệ từ 0–100; tiền nguyên VND không âm và <10^18. Chi phí là tổng mỗi tháng cho toàn phạm vi, không tự nhân theo phòng. Client không tính kết quả tài chính.

Mô hình `management-constant-v1`: monthlyRevenue = round(Rooms * occupancyPercent /100 * monthlyRent); monthlyCollections = round(revenue * collectionPercent /100); monthlyOPEX = tổng bốn nhóm chi phí; profit = revenue - OPEX; netCash = collections - OPEX; forecastCash = netCash * forecastMonths; remainingCapitalAtEnd = max(0, baselineRemainingCapital - forecastCash). Làm tròn VND AwayFromZero chỉ trong dự báo, không sửa billing policy thật. Không lãi, tăng giá, khấu hao hoặc tự giả định thu đủ tiền: Owner nhập collectionPercent rõ ràng. EstimatedRemainingMonths dùng baselineRemainingCapital/netCash dương; thiếu vốn/phân loại refund/dòng tiền không dương trả null. monthlyProfitDifference so với bình quân lợi nhuận tháng của baseline. Giữ dấu âm khi dự báo lỗ.

View chứa `id,input,baseline,result,calculationVersion`. Snapshot và result đã lưu được đọc nguyên trạng, không tính lại khi xem. Owner Web `/what-if` trong API mode cho nhập/phân tích/lưu/list/xem/so sánh hai snapshot và so với baseline. Loading/error/success, submit lock và stable retry key; chỉnh giả định phải phân tích lại. Analyze/save/reload đã có browser E2E tổng hợp; review cuối của Vũ Xuân Trường và nghiệm thu mọi nhánh UI còn lại chưa hoàn tất.

## Chạy browser E2E với Compact24 riêng

`dotnet run --project tools/BHome.ContractVerification -- --finance` từ repository root, với `BHOME_COMPACT24_TEST_ADMIN` trỏ loopback admin database `postgres`. Harness dùng Compact24Fixture tạo/xóa database mới, khởi tạo tài khoản và Room tổng hợp, chạy API thật (Testing) + Vite API mode + Edge headless bằng Playwright đã có trong `.tools/contract-browser`. Không route mock, không seed kết quả tài chính, không đọc `.env` của database làm việc, không lưu credentials vào repo.

Lượt đầu đạt bốn nhóm: tạo/reload/sửa Expense có reason; báo cáo và null payback; analyze/save/reload What-if; lưu/reload cấu hình Owner hợp đồng với dữ liệu tổng hợp được mã hóa. Harness mở rộng `--finance --main-draft` gần nhất đạt **16 nhóm**, thêm release/handover/private evidence/historical occupancy/shared billing/refund như mô tả dưới. Chỉ các đường đi đó đã được kiểm chứng; UI vẫn cần Vũ Xuân Trường review. Không suy rộng sang MySign thật, handover native hoặc mọi contract E2E.

TLS test dùng certificate localhost sinh tạm, API readiness pin certificate đó; browser context dùng ignoreHTTPSErrors chỉ cho traffic tổng hợp trong test. Không sửa OS trust store hoặc production TLS settings; test này không chứng minh browser certificate-trust deployment. API/process/database/PFX được dọn sau run. Không chạy song song build ghi lại DLL API đang được browser harness dùng; build trước, rồi `--no-build` nếu cần chạy song song các bộ test chỉ đọc artifact.

### Chuỗi hợp đồng → ba Tenant dùng chung hóa đơn

`--finance --main-draft` mở rộng bằng Verify-SharedBillingClients: một representative và hai co-occupants xác minh riêng, Owner liên kết hai tài khoản co-occupant; chỉ representative ký hợp đồng. Không tạo ba hợp đồng để chứng minh hóa đơn chung. Room/Asset và biểu giá tổng hợp đã có trước là fixture ban đầu; biểu giá có hiệu lực ngày trước vì API thật cấm tạo biểu giá lùi ngày. Test kiểm lại guard 400 này. Không seed Active Contract, reading, Invoice, allocation, Adjustment hoặc Refund trực tiếp. Staff/Tenant dùng MobileApi và shared client thật; Owner dùng bản build Web thật; đây chưa phải native device E2E.

Test cấu hình riêng lịch draft/final ngày 1, due ngày 28, PeriodEnd rate, RepresentativeContract rent, FullMonth, AwayFromZero; đây là cấu hình kiểm thử lịch sử; quy tắc hiện hành bắt buộc sử dụng giá đã chốt trong hợp đồng. Sau bàn giao Initial 100, periodic human-confirm 120 cho cả hai utility, hóa đơn có thuê 3.000.000 + điện 70.000 + nước 360.000 = 3.430.000 VND, không nhân tiền thuê theo số người. Thiếu readings giữ Draft; Tenant không finalize. Ba tài khoản được thấy cùng Invoice/confirmed values và QR từ backend; Tenant ngoài phạm vi 404, Staff không xem chi tiết tiền.

Owner browser đối chiếu giao dịch tổng hợp 1.000.000 và phân bổ cho người trả thật → ba tài khoản còn nợ 2.430.000. Co-occupant gửi yêu cầu khoản điện 70.000→50.000 kèm ảnh private; Owner browser xác nhận và phê duyệt → Adjustment riêng -20.000, nghĩa vụ 3.410.000/còn nợ 2.410.000; giữ nguyên Final Invoice JSON/lines/total/version. Request/evidence chỉ requester/Owner thấy, các Tenant còn lại được thấy effect lên số dư mà không nhận request cá nhân.

Owner nhận giao dịch tổng hợp 2.420.000 của co-occupant khác → phân bổ tối đa 2.410.000, giữ 10.000 chưa phân bổ chờ xử lý. Cả ba thấy Paid, lịch sử hai allocations, QR Settled; payer của mình hiện Bạn, payer khác bị ẩn userId. Ba allocate retry đồng thời không thêm allocation/reconciliation; tiền thừa không tự hoàn hoặc credit. Sau đó Owner browser lập/duyệt/ghi nhận hoàn 10.000 tổng hợp kèm chứng từ MinIO; ba pendingReview chỉ tắt sau Completed, report totals giữ nguyên, private download sau reload đúng bytes. Kiểm DB: một Final Invoice/ba recipients/ba lines, hai allocations tổng 3.410.000/hai payer và đúng một refund Completed có evidence do Owner chủ động ghi nhận; schema không đổi. Toàn bộ bank account/receipts/refund giữ nhãn demo; không chuyển tiền thật hoặc gọi bank provider. Worker notifications tắt trong browser harness; không tuyên bố delivery E2E từ run này.
