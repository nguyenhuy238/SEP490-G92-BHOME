# Tenant — tối ưu Hóa đơn, Lịch sử thanh toán và Công nợ

Ngày 07/11/2026. Phạm vi: frontend Mobile; BF-05/UC-21 và BF-06/UC-22..25 theo AGENTS.md, đối chiếu yêu cầu người dùng và implementation hiện có. Không đổi backend, DTO, database, quyền truy cập hoặc quy tắc đối soát. Các thay đổi Staff và nghiệp vụ khác đã có trong working tree được giữ nguyên.

## Kết quả triển khai

- Một tiêu đề “Hóa đơn & thanh toán”, thanh chuyển nhanh ba mục Hóa đơn / Lịch sử / Công nợ. Giữ route `invoice` và `billing-history`; không fetch trước cả ba danh sách.
- Thẻ hóa đơn bấm toàn bộ: kỳ, phòng/cơ sở, badge, tiền và hạn thanh toán. Padding 14, radius 16, khoảng cách thẻ 12; Inter và palette dùng chung. Tiêu đề 22/30 bold, card 16/22 semibold, tiền 24/32 bold, thông tin phụ 12/18.
- Ưu tiên trạng thái thanh toán được backend trả về. Final chỉ có nghĩa đã phát hành. Chưa lấy được trạng thái thì hiện “Tổng hóa đơn”; khi có số dư hợp lệ mới hiện “Còn phải thanh toán”. Quá hạn dựa trên `overdueDays`, màu đỏ; Paid xanh lá; Unpaid xanh dương. Không tính lại số dư bằng float.
- Lịch sử bỏ dấu cộng trước số tiền, có nhãn “Đã ghi nhận”. Ngày và người trả nằm trong cùng vùng bấm. Phần mở rộng không lặp lại tiền/ngày/người trả/kỳ/phòng; nút xem hóa đơn liên quan đứng đầu, tiếp đến cơ sở và nguồn xác minh. Không hiển thị bankReference/verifiedByUserId.
- Công nợ dùng nhãn tiếng Việt dễ hiểu; nút xem hóa đơn ở đầu phần mở rộng. Giữ phân biệt tổng phải trả, tiền đã ghi nhận, số dư, điều chỉnh và tiền thừa; null vẫn là chưa có dữ liệu. Không cộng các dòng/trang thành tổng nợ cá nhân.
- Chọn tháng bằng ChoiceField hiện có và năm bằng nút trước/sau, không nhập MM/YYYY. Năm mặc định theo ngày nghiệp vụ. Lọc và sắp xếp cùng chờ “Áp dụng”. Đổi bộ lọc thực sự mới reset trang; chỉ đổi sắp xếp thì giữ trang, không gọi API.
- Giữ phân trang server, cache các trang đã ghé và danh sách phòng đã gặp; không tải toàn bộ lịch sử. Pull-to-refresh hoạt động trên các màn tài chính qua ScrollView của WorkspaceShell. Một nút refresh ở header, retry trong lỗi; bỏ nút refresh thường trực trong phần tài chính mở rộng của chi tiết hóa đơn.
- Refresh danh sách tải lại cả hóa đơn và trạng thái tiền. Refresh chi tiết tải lại invoice, remount phần payment để đọc trạng thái mới. Giữ QR/instructions chỉ khi còn nợ, kiểm tra số tiền QR khớp và polling/focus hiện có. Test xác nhận Paid loại bỏ QR kể cả người trả là khách thuê khác.

## File thay đổi trong lượt này

- `src/mobile/src/components/TenantBillingTabs.tsx`: component thanh chuyển nhanh dùng chung.
- `src/mobile/src/components/InvoiceDetailUi.tsx`: typography và style thẻ compact.
- `src/mobile/src/components/WorkspaceShell.tsx`: pull-to-refresh cho Tenant finance, subtitle tránh lặp tiêu đề.
- `src/mobile/src/screens/TenantInvoicesScreen.tsx`: InvoiceSummaryCard, trạng thái tiền, header và điều hướng.
- `src/mobile/src/screens/TenantPaymentHistoryScreen.tsx`: PaymentLedger, HistoryRow, DebtRow, LedgerRowHeader, LedgerFilterForm.
- `src/mobile/src/screens/TenantPaymentPanel.tsx`: bỏ refresh trùng, đổi nhãn tổng phải thanh toán.
- `src/mobile/src/screens/TenantAdjustmentPanel.tsx`: đổi cùng nhãn tài chính, không đổi workflow.
- `src/mobile/src/services/tenantInvoices.ts`: validate batch payment summaries, số tiền/due date/status, từ chối ID ngoài batch và ID trùng.
- `src/mobile/src/__tests__/tenant-payment-history.test.ts`: thêm kiểm tra batch sai shape/ID/status/số tiền.
- `src/mobile/src/__tests__/workspace-navigation.test.tsx`: kiểm tra refresh/pull-to-refresh và shell giữ safe area/tab.
- `tests/mobile/ocr/liveWorkspace-ui.test.tsx`: cập nhật thao tác thẻ/bộ lọc, thêm case bấm ngày, nội dung không lặp, tab lazy, refresh balance, Final không suy Paid.

Đây là danh sách phạm vi lượt này; diff so với HEAD còn chứa các công việc trước đó chưa commit.

## API và điều hướng tái sử dụng

- `GET /api/v1/invoices?page=...&pageSize=20`: danh sách hóa đơn.
- `GET /api/v1/payment-invoices?pageSize=100&invoiceIds=...`: batch các hóa đơn Final trong trang hiện tại; không truy vấn mỗi card riêng.
- `GET /api/v1/invoices/{id}`, `/{id}/payment`, `/{id}/transfer-instructions`: chi tiết, số dư, QR/chuyển khoản; các endpoint adjustments hiện có giữ nguyên.
- `GET /api/v1/payment-history?page=...&pageSize=20` và `GET /api/v1/debts?page=...&pageSize=20`: chỉ gọi mục đang mở. Bộ lọc dùng `billingPeriod`, `roomId`; `overdueOnly` chỉ áp dụng Công nợ.
- Mở hóa đơn từ ledger vẫn truyền `invoiceId`, `returnTo=billing-history`, `historyTab`; back dùng lịch sử router và fallback tab hợp lệ. Không tạo route hoặc màn nghiệp vụ mới.

Đối chiếu DTO `PaymentContracts.cs`, persistence `PaymentRepository.cs`: lịch sử mặc định theo allocation mới nhất; công nợ theo hạn thanh toán. Không thêm sort parameter backend không hỗ trợ.

## Giới hạn và kiểm chứng

- Chưa có danh mục đầy đủ các phòng lịch sử trong luồng hiện tại. Bộ chọn tích lũy phòng từ các trang đã ghé và nói rõ “Chọn từ những phòng đã xuất hiện trong danh sách”; không coi đây là toàn bộ phòng được phép.
- Sắp xếp số tiền/ngày chỉ trên trang hiện tại, có nhãn rõ; không phải sắp xếp toàn bộ lịch sử. Không có tính tổng toàn bộ từ một trang.
- TypeScript: PASS với Node 22.23.4, `npm run typecheck --workspace ./src/mobile` (TypeScript của workspace Mobile).
- ESLint: PASS cho mobile source và file component test thay đổi, `--max-warnings 0`.
- Toàn bộ mobile tests bằng Node 22: **653 test PASS, 57 file PASS; 1 suite FAIL khi import**. `tests/mobile/ocr/meterScreen.test.tsx` mock react-native-paper thiếu `MD3LightTheme`; lỗi có từ trước, không phải assertion của finance. Không gọi toàn bộ suite xanh.
- Expo web export: PASS, output `.tools/tenant-finance-web`.
- `git diff --check`: PASS (Git có cảnh báo chuyển CRLF/LF của một file route có từ working tree).
- Test dùng mocked HTTP/router/session; không gọi nghiệp vụ thật, không seed/migrate hoặc ghi database. Chưa nghiệm thu hình thức hiển thị, cảm ứng, screen reader và pull gesture trên Android/iOS thật. Web build không thay thế kiểm thử thiết bị.

Tài liệu tham khảo API nền tảng đã đối chiếu: [Expo SDK 58](https://docs.expo.dev/versions/v58.0.0/), [Expo Router parameters](https://docs.expo.dev/router/reference/url-parameters/), [React Native RefreshControl](https://reactnative.dev/docs/refreshcontrol).
