# Tenant Mobile — Payment History & Debt UI

Ngày: 07/11/2026, Asia/Bangkok. Triển khai trực tiếp trong React Native, theo yêu cầu Redesign BHOME Tenant Mobile — Payment History & Debt Management UI.

## Phạm vi và nguồn

BF-06 / UC-22..25, GBR-10; liên quan BF-05 / UC-20..21 về hóa đơn. Dựa trên yêu cầu người dùng, AGENTS.md, `PaymentContracts.cs`, `PaymentService.Query`, `PaymentRepository.VisibleInvoices/DebtAsync/PaymentHistoryAsync`, `DebtsController.cs` và shared client hiện có. Không thêm endpoint, DTO backend, dependency, database migration hoặc rule chia nợ.

## A. Files của lượt này

- `packages/client-core/src/payments.ts`: bổ sung ba field nullable/optional của DebtInvoice: originalIssuedAmount, approvedAdjustmentTotal, potentialExcessAmount. Optional giữ tương thích client cũ; backend hiện có các trường này.
- `src/mobile/src/screens/TenantPaymentHistoryScreen.tsx` (mới): tách màn thật khỏi PaymentPanel; hai tab underline; giao dịch/công nợ dạng hàng gọn, mở rộng chi tiết; bộ lọc, sắp xếp trang hiện tại, cache có giới hạn theo API instance, pagination và trạng thái lỗi.
- `src/mobile/src/services/tenantPaymentHistory.ts` (mới): query chỉ dùng tham số backend hỗ trợ; kiểm tra Page/field tiền/ngày/trạng thái trước render; loại metadata riêng tư khỏi dữ liệu lịch sử Tenant; nhãn nguồn xác minh; so sánh chuỗi tiền chính xác cho sắp xếp.
- `src/mobile/src/screens/TenantPaymentPanel.tsx`: bỏ implementation màn history cũ và import không dùng; giữ component payment của invoice.
- `src/mobile/src/app/workspace/[screen].tsx`: route billing-history import màn mới; giữ nhánh Tenant và guard hiện có.
- `src/mobile/src/components/WorkspaceShell.tsx`: màn ledger dùng header context đã có, icon refresh nhỏ và pull-to-refresh; giữ bốn bottom tabs/safe area/vùng cuộn chính.
- `src/mobile/src/screens/TenantInvoicesScreen.tsx`: trở lại route ledger trước đó bằng router.back; trường hợp không có back stack dùng fallback billing-history với historyTab được whitelist. Nhãn quay lại phù hợp.
- `src/mobile/src/features/tenant/paymentPresentation.ts`: helper nhãn thanh toán nhận subset ba field thực sự dùng; reuse nhãn thanh toán một phần cho Debt, không thêm cách tính nghĩa vụ.
- `src/mobile/src/__tests__/tenant-payment-history.test.ts` (mới): validation/privacy/query/sort chính xác.
- `tests/mobile/ocr/liveWorkspace-ui.test.tsx`: test disclosure, tab, filter/paging, null/zero, nguồn xác minh, privacy, API error/retry/account switch và navigation.
- `src/mobile/src/__tests__/workspace-navigation.test.tsx`: header refresh + pull-to-refresh, giữ tab và bottom inset.
- Báo cáo này. Các thay đổi My Room/Invoice Detail/Auth đã có trong working tree được giữ nguyên; không commit/push.

## B. Mapping backend → UI

History:

- `id`: key của từng allocation, không gộp hai khoản trả cho cùng invoiceId.
- `invoiceId`: truyền nguyên giá trị tới màn hóa đơn hiện có.
- `locationId`, `roomId`: định danh lọc/phạm vi; không in raw ID.
- `roomNumber`, `billingPeriod`: tiêu đề hàng.
- `amount`: số tiền ghi nhận ở hàng và phần mở rộng, định dạng trực tiếp từ chuỗi.
- `paidAt`: thời điểm trả theo múi giờ nghiệp vụ, có ở hàng và chi tiết.
- `paidBy`: giữ nguyên nhãn backend, gồm người khác cùng hóa đơn; không thay bằng người đang đăng nhập.
- `locationName`: phần mở rộng.
- `verificationSource`: phần mở rộng; OwnerBankStatement → Owner đối soát sao kê; giá trị khác → Nguồn xác minh khác, không in mã provider thô.
- `bankReference`, `verifiedByUserId`: không render cho Tenant; loader còn loại giá trị riêng tư nếu server bất ngờ trả non-null. Không tạo dữ liệu ngân hàng thay thế.

Debt:

- `invoiceId`, `roomId`, `locationId`: navigation/lọc/định danh, không hiển thị raw ID.
- `roomNumber`, `billingPeriod`: tiêu đề hàng; `locationName` trong phần mở.
- `outstandingAmount`: số tiền nổi bật từng invoice, không tổng hợp cả trang thành tổng nợ.
- `dueDate`: hàng và chi tiết; `overdueDays`: badge khi >0, luôn dùng giá trị backend.
- `paymentStatus`: nhãn tiếng Việt; Unpaid không tự được xem là quá hạn. Nếu backend trả Paid với số dư 0, giữ Paid/0. Nhãn thanh toán một phần reuse helper dựa vào trạng thái và các chuỗi tiền đã ghi nhận, không tính lại balance.
- `payableAmount`: Nghĩa vụ hiện hành; `paidAmount`: Đã ghi nhận.
- `originalIssuedAmount`: Tiền hóa đơn gốc.
- `approvedAdjustmentTotal`: Điều chỉnh đã duyệt, giữ dấu âm/dương.
- `potentialExcessAmount`: Tiền thừa cần xem xét; không gọi là khoản hoàn đã xác nhận.
- Các field tiền null/không có hiện Chưa có dữ liệu; không đổi thành 0.

## C. API, filter, sorting và hành vi được giữ

- GET `/api/v1/payment-history?page=...&pageSize=20`.
- GET `/api/v1/debts?page=...&pageSize=20`.
- Bộ lọc chung dùng `billingPeriod=YYYY-MM-01` và `roomId`. Form nhập kỳ MM/YYYY, kiểm tra trước khi gửi. Bộ lọc đổi thì reset pagination về trang 1.
- Công nợ thêm `overdueOnly=true`. Không cung cấp filter Paid trên /debts vì controller luôn ép OutstandingOnly=true. Người dùng xem hóa đơn đã trả qua luồng hóa đơn/lịch sử hiện có.
- Không gửi dateFrom/dateTo hoặc sort không tồn tại. Backend PaymentQuery hiện không có lọc khoảng ngày trả hoặc tham số sorting.
- Lựa chọn phòng lấy từ các room đã xuất hiện trong response hợp lệ của account/API hiện tại. UI ghi rõ danh mục phòng từ dữ liệu đã tải; chọn một phòng gửi server filter trên toàn bộ dữ liệu được phép, không lọc cục bộ một trang. Đây chưa phải danh mục toàn bộ phòng lịch sử.
- Sắp xếp số tiền giảm dần/ngày trả mới trước ghi rõ “trang này”. So sánh chuỗi tiền bằng độ dài/chữ số, không chuyển float; không sửa mảng response hoặc tổng backend.
- Cache tối đa 20 Page theo URL trong màn và theo API identity. Chuyển tab không refetch trang đã tải; refresh hoặc quay lại focus xóa cache để đọc trạng thái mới. Không giữ cache/room data giữa account khác; query cũ bị abort và kết quả quá hạn không publish.
- Tab được ghi vào route params. Mở invoice mang exact invoiceId, returnTo và historyTab; native back quay lại màn cũ, fallback giữ tab được whitelist. Không tạo payment workflow mới.
- Pagination dùng Page backend, request 20 records, kiểm tra page/pageSize khớp trước render; ẩn khi totalCount <=20. Không cộng các trang, không dedupe nhầm nhiều allocation cùng invoice.
- Role guard Tenant, session/refresh/logout và authorization backend giữ nguyên. Lịch sử là các allocation trên hóa đơn phòng Tenant có quyền xem; công nợ là balance hóa đơn phòng, không phải phần chia từng người.

## D. Kiểm thử thực thi

### Qua

```powershell
npm run test --workspace ./src/mobile -- ../../tests/mobile/ocr/liveWorkspace-ui.test.tsx src/__tests__/tenant-payment-history.test.ts src/__tests__/workspace-navigation.test.tsx src/__tests__/contract-sections.test.tsx
npm run lint --workspace ./src/mobile
npm run typecheck --workspace ./src/mobile
npm run build --workspace @bhome/client-core
```

- Targeted: **4 file, 133 test qua**. Đây là tổng bộ liên quan, gồm cả hồi quy My Room/Invoice Detail/contract/navigation, không phải 133 case riêng ledger.
- Cases: empty history/debt; nhiều allocation cùng invoice; payer khác cùng phòng; unknown verification source; non-null private bank/verifier bị ẩn; null/zero/partial/overdue/non-overdue financials; điều chỉnh âm; potential excess; filter server, reset trang, page 2, sắp xếp trang hiện tại không request thêm; tab cache; exact invoice navigation và back/fallback; malformed Page/tiền/ngày, duplicate ID; 403 không lộ response, Staff không fetch; refresh network failure/retry; đổi tài khoản bỏ ngay dữ liệu cũ; header icon/pull-refresh/bottom inset.
- Lint, TypeScript mobile và shared client build: **qua**.
- Prettier và git diff --check: **qua**.
- Expo web export ứng dụng thật bằng Node 22.23.4: **qua**, artifact ignored `.tools/tenant-ledger-web`.

### Chưa qua

Bộ mobile đầy đủ chạy bằng Node 22.23.4: **632 test qua, 56 file qua; 1 suite không tải được**. `tests/mobile/ocr/meterScreen.test.tsx` mock react-native-paper thiếu MD3LightTheme. Đây là lỗi đã có ở các lượt trước, không phải assertion fail mới; không sửa test ngoài scope và không đánh dấu cả suite PASS.

### Chưa chạy / giới hạn

- Không gọi API nghiệp vụ live, không ghi database/seed/migration và không thử ngân hàng/provider thật.
- Không chạy backend integration tests trong lượt này; quyền và DTO được đối chiếu source.
- Chưa kiểm thử Android/iOS thật, màn 320/360px, font scaling, thao tác back/focus hoặc pull-to-refresh bằng tay trên thiết bị. DOM tests và web bundle không chứng minh chất lượng pixel hoặc E2E. Computer-use đã báo native pipe unavailable ở lượt trước; không có bằng chứng hình ảnh mới ở lượt này.
- Chưa có danh mục toàn bộ phòng lịch sử, aggregate tổng công nợ hoặc sorting/date-range toàn bộ dataset từ backend. UI trình bày đúng giới hạn hiện có, không dựng số tổng giả hoặc tham số API mới.
