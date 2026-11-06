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

Bổ sung 06/11 theo ủy quyền chính sách: hoàn tiền thừa receipt qua [REFUNDS.md](REFUNDS.md) có marker v1/evidence/Completed event và nguồn VERIFIED/payer/allocation khớp được phân loại riêng. Tiền thừa chưa từng nằm trong verifiedCollections nên hoàn lại không phải OPEX hoặc đảo doanh thu; reporting giữ các tổng tiền hợp lệ. Mọi COMPLETED refund khác/thiếu phân loại trước cuối kỳ trên chuỗi vẫn làm net/recovery/ước tính null với `refund_classification_required`. Guard bảo thủ vẫn áp toàn chuỗi; reporting không tạo/sửa refund, không tự coi refund cọc hoặc legacy là chi phí vận hành.

Owner Web `/reports` dùng `FinancialReportsApiPage` trong API mode: chọn khoảng/cơ sở, xem tổng, theo Location và hoàn vốn. Hiển thị unavailable reason; không fallback demo khi lỗi. Room filter hỗ trợ ở API, chưa có selector trên UI. Chi phí Staff/maintenance cần được ghi trong expenses để tính vào báo cáo; chưa tự sinh payroll hoặc hợp nhất module chưa có. Không tuyên bố đã có báo cáo kế toán/thuế. Handoff `INITIAL_API_UI_READY`, Vũ Xuân Trường.

### Lấp đầy theo kỳ (06/11/2026)

Truy vết UC-07/UC-32, FE-08 và GBR-01/02/16: response bổ sung nullable `historicalOccupancy` `{status,from,to,occupiedRoomDays,rentableRoomDays,occupancyRate,limitations}`. Tái sử dụng `IRoomInsightsRepository`/`PropertyService.CalculateHistorical` từ module Property, đọc bằng cùng DbContext trong transaction RepeatableRead của báo cáo. Không gọi API riêng ở frontend rồi ghép hai snapshot. Giữ nguyên `totalRooms,occupiedRooms` hiện tại và toàn bộ công thức tiền/hoàn vốn.

Kỳ đóng gồm from..to theo ngày Việt Nam. Mỗi Room/ngày được tính tối đa một lần dù có nhiều Resident; chỉ tính ngày Location hoạt động và Room có thể cho thuê (không Unavailable), dùng audit trạng thái và khoảng residence của Contract đã kích hoạt. `occupancyRate = round(occupiedRoomDays * 100 / rentableRoomDays, 2)` theo bộ tính Property hiện hữu. Nếu mẫu số 0 thì tỷ lệ null, không phải 0%. Không dùng Room.Status hiện tại để dựng quá khứ, không tự ước tính ngày chưa có evidence.

| status | Điều kiện và kết quả |
| --- | --- |
| Complete | Đủ creation/status audit Location/Rooms cho kỳ; trả ngày-phòng và tỷ lệ, có thể null khi mẫu số 0 |
| InsufficientData | Thiếu audit theo điều kiện completeness của Property; cả số ngày-phòng và tỷ lệ null |
| LocationRequired | Chưa chọn đúng một Location; chưa tổng hợp lịch sử toàn chuỗi |
| RoomFilterUnsupported | Có Room filter; lịch sử hiện chỉ hỗ trợ phạm vi Location |
| PeriodUnsupported | Chênh lệch to/from vượt 366 ngày, cùng giới hạn kỹ thuật API occupancy-summary |
| FuturePeriod | to sau ngày hiện tại Asia/Ho_Chi_Minh; không gọi dự báo là lịch sử |

Các trạng thái unavailable không làm mất chỉ tiêu tài chính hợp lệ của cùng báo cáo. UI hiển thị kỳ dd/MM/yyyy, số liệu server hoặc lý do tiếng Việt, giữ tách biệt với occupancy hiện tại. Field optional cho client và saved What-if baseline cũ; thiếu field hiển thị chưa có dữ liệu, không tính bù. Snapshot What-if mới giữ lịch sử đã đọc, nhưng thuật toán giả định `management-constant-v1` không đổi và không dùng lịch sử này để sửa ledger thật.

## What-if UC-34

Owner-only: POST `/api/v1/financial-scenarios/analyze` không ghi DB; POST `/api/v1/financial-scenarios` lưu với UUID `Idempotency-Key`; GET collection `?page=1&pageSize=25` và GET `/{id}` xem snapshot đã lưu. Không có UPDATE/DELETE hay mutation vào sổ thực tế. List/get lọc created_by_user_id. Key trùng cùng input trả cùng snapshot, dù dữ liệu thật đã thay đổi; khác input trả 409. Advisory transaction lock bảo vệ save đồng thời. Lưu duy nhất bảng `financial_scenarios`, không thêm schema.

Input `{name,baseline:{from,to,locationId?},forecastMonths,assumptions}`. Baseline gồm tháng trọn vẹn, chỉ Chain/Location; cần ít nhất một Room. forecastMonths 1–32767 theo smallint của schema. Assumptions bắt buộc: `monthlyRent,occupancyPercent,collectionPercent,monthlyUtilityServiceCost,monthlyStaffCost,monthlyMaintenanceCost,monthlyOtherCost`. Tỷ lệ từ 0–100; tiền nguyên VND không âm và <10^18. Chi phí là tổng mỗi tháng cho toàn phạm vi, không tự nhân theo phòng. Client không tính kết quả tài chính.

Mô hình `management-constant-v1`: monthlyRevenue = round(Rooms * occupancyPercent /100 * monthlyRent); monthlyCollections = round(revenue * collectionPercent /100); monthlyOPEX = tổng bốn nhóm chi phí; profit = revenue - OPEX; netCash = collections - OPEX; forecastCash = netCash * forecastMonths; remainingCapitalAtEnd = max(0, baselineRemainingCapital - forecastCash). Làm tròn VND AwayFromZero chỉ trong dự báo, không sửa billing policy thật. Không lãi, tăng giá, khấu hao hoặc tự giả định thu đủ tiền: Owner nhập collectionPercent rõ ràng. EstimatedRemainingMonths dùng baselineRemainingCapital/netCash dương; thiếu vốn/phân loại refund/dòng tiền không dương trả null. monthlyProfitDifference so với bình quân lợi nhuận tháng của baseline. Giữ dấu âm khi dự báo lỗ.

View chứa `id,input,baseline,result,calculationVersion`. Snapshot và result đã lưu được đọc nguyên trạng, không tính lại khi xem. Owner Web `/what-if` trong API mode cho nhập/phân tích/lưu/list/xem/so sánh hai snapshot và so với baseline. Loading/error/success, submit lock và stable retry key; chỉnh giả định phải phân tích lại. Handoff `INITIAL_API_UI_READY`, Vũ Xuân Trường; chưa có browser E2E/review cuối.

## Chạy browser E2E với Compact24 riêng

`dotnet run --project tools/BHome.ContractVerification -- --finance` từ repository root, với `BHOME_COMPACT24_TEST_ADMIN` trỏ loopback admin database `postgres`. Harness dùng Compact24Fixture tạo/xóa database mới, khởi tạo tài khoản và Room tổng hợp, chạy API thật (Testing) + Vite API mode + Edge headless bằng Playwright đã có trong `.tools/contract-browser`. Không route mock, không seed kết quả tài chính, không đọc `.env` của database làm việc, không lưu credentials vào repo.

Đã đạt bốn nhóm browser acceptance: tạo/reload/sửa Expense có reason; báo cáo từ khoản chi vừa lưu và null payback; analyze/save/reload snapshot What-if; lưu/reload cấu hình Owner hợp đồng với thông tin tổng hợp được mã hóa. Trạng thái **E2E_PASSED cho các đường đi này**, UI vẫn cần Vũ Xuân Trường review. Không suy rộng sang ký MySign, handover native hoặc toàn bộ contract E2E.

TLS test dùng certificate localhost sinh tạm, API readiness pin certificate đó; browser context dùng ignoreHTTPSErrors chỉ cho traffic tổng hợp trong test. Không sửa OS trust store hoặc production TLS settings; test này không chứng minh browser certificate-trust deployment. API/process/database/PFX được dọn sau run. Không chạy song song build ghi lại DLL API đang được browser harness dùng; build trước, rồi `--no-build` nếu cần chạy song song các bộ test chỉ đọc artifact.

### Chuỗi hợp đồng → ba Tenant dùng chung hóa đơn

`--finance --main-draft` mở rộng bằng Verify-SharedBillingClients: một representative và hai co-occupants xác minh riêng, Owner liên kết hai tài khoản co-occupant; chỉ representative ký hợp đồng. Không tạo ba hợp đồng để chứng minh hóa đơn chung. Room/Asset và biểu giá tổng hợp đã có trước là fixture ban đầu; biểu giá có hiệu lực ngày trước vì API thật cấm tạo biểu giá lùi ngày. Test kiểm lại guard 400 này. Không seed Active Contract, reading, Invoice, allocation, Adjustment hoặc Refund trực tiếp. Staff/Tenant dùng MobileApi và shared client thật; Owner dùng bản build Web thật; đây chưa phải native device E2E.

Test cấu hình riêng lịch draft/final ngày 1, due ngày 28, PeriodEnd rate, RepresentativeContract rent, FullMonth, AwayFromZero; không đổi default policy dự án. Sau bàn giao Initial 100, periodic human-confirm 120 cho cả hai utility, hóa đơn có thuê 3.000.000 + điện 70.000 + nước 360.000 = 3.430.000 VND, không nhân tiền thuê theo số người. Thiếu readings giữ Draft; Tenant không finalize. Ba tài khoản được thấy cùng Invoice/confirmed values và QR từ backend; Tenant ngoài phạm vi 404, Staff không xem chi tiết tiền.

Owner browser đối chiếu giao dịch tổng hợp 1.000.000 và phân bổ cho người trả thật → ba tài khoản còn nợ 2.430.000. Co-occupant gửi yêu cầu khoản điện 70.000→50.000 kèm ảnh private; Owner browser xác nhận và phê duyệt → Adjustment riêng -20.000, nghĩa vụ 3.410.000/còn nợ 2.410.000; giữ nguyên Final Invoice JSON/lines/total/version. Request/evidence chỉ requester/Owner thấy, các Tenant còn lại được thấy effect lên số dư mà không nhận request cá nhân.

Owner nhận giao dịch tổng hợp 2.420.000 của co-occupant khác → phân bổ tối đa 2.410.000, giữ 10.000 chưa phân bổ chờ xử lý. Cả ba thấy Paid, lịch sử hai allocations, QR Settled; payer của mình hiện Bạn, payer khác bị ẩn userId. Ba allocate retry đồng thời không thêm allocation/reconciliation; tiền thừa không tự hoàn hoặc credit. Sau đó Owner browser lập/duyệt/ghi nhận hoàn 10.000 tổng hợp kèm chứng từ MinIO; ba pendingReview chỉ tắt sau Completed, report totals giữ nguyên, private download sau reload đúng bytes. Kiểm DB: một Final Invoice/ba recipients/ba lines, hai allocations tổng 3.410.000/hai payer và đúng một refund Completed có evidence do Owner chủ động ghi nhận; schema không đổi. Toàn bộ bank account/receipts/refund giữ nhãn demo; không chuyển tiền thật hoặc gọi bank provider. Worker notifications tắt trong browser harness; không tuyên bố delivery E2E từ run này.
