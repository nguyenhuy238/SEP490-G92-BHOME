# BHOME Tenant Mobile — Invoice Detail: Compact Financial UI

Ngày: 07/11/2026, Asia/Bangkok. Báo cáo cập nhật theo yêu cầu “Completely Rebuild BHOME Tenant Invoice Detail UI”. Nội dung này thay mô tả bố cục của lượt thiết kế trước trong cùng working tree.

## Phạm vi và nguồn

Presentation cho Tenant trong BF-05 / UC-20..21 (hóa đơn, điện nước), BF-06 / UC-22..25 (thanh toán, công nợ, điều chỉnh), GBR-07..10 và nguyên tắc backend quyết định nghĩa vụ/trạng thái. Nguồn: AGENTS.md, yêu cầu người dùng, InvoiceContracts.cs, PaymentContracts.cs, TransferInstructionsService.cs và shared client invoices/payments/adjustments hiện có. Không thêm rule nghiệp vụ, endpoint, DTO, dependency, migration hay cấu hình provider.

## Cấu trúc đã thay

Màn chi tiết dùng **một surface trắng**, radius 14, padding trong 16; các phần phân cách bằng đường mảnh. Header quay lại/tải lại dùng shell hiện có. Summary gộp phòng + tháng, cơ sở, badge phát hành và hạn. Không dùng card lồng nhau cho khoản thu hoặc lịch sử điều chỉnh.

Payment dùng số tiền còn phải thanh toán làm điểm nhìn chính; badge Paid/Unpaid riêng với Draft/Final. Đã ghi nhận và nghĩa vụ hiện hành nằm trong các dòng label/value nhỏ. QR là action chữ nhỏ cạnh trạng thái; tài chính/lịch sử tiếp tục có thể mở rộng. Refresh payment phụ nằm trong phần tài chính mở rộng; refresh chính của màn tải lại toàn bộ chi tiết.

Mỗi charge là một hàng touch target tối thiểu 64px, icon 18px, tên 14px, amount 15px semibold cùng mép phải, một dòng phụ 12px và chevron nhỏ. Mặc định mọi hàng đóng. Chạm mở/đóng riêng từng hàng; thao tác này không gọi API. Tên dài được rút gọn ở hàng đóng và đọc đầy đủ trong chi tiết/accessibility label. Phần mở dùng label/value 12–13px, không card phụ.

Tổng hóa đơn chỉ xuất hiện một lần cuối breakdown, ngăn bằng đường mảnh, lấy invoice.total. Không gộp với outstandingAmount.

Adjustment dùng tab chữ gạch chân, touch target tối thiểu 44px; số đếm lấy totalCount thật. Hai danh sách được tải một lần để có count chính xác; đổi tab không refetch. Không dùng số 0 giả lúc chưa tải; lỗi count dùng dấu —. Empty state một câu, một action nhỏ “+ Gửi yêu cầu điều chỉnh”; không refresh riêng và không pagination rỗng. Pagination thật vẫn hoạt động khi có hơn 20 record. Form, chi tiết, trạng thái, quyết định và evidence vẫn truy cập được.

Giữ vùng cuộn dọc, bottom tabs và safe area của ứng dụng. Không tạo ảnh hoặc demo/mockup thay thế.

## Files của lần rebuild

- `src/mobile/src/components/InvoiceDetailUi.tsx`: typography, surface/section, charge rows, underline tabs, detail label/value; bỏ style card cũ.
- `src/mobile/src/screens/TenantInvoiceCharges.tsx`: summary mới, InvoiceChargeRow, InvoiceChargeDetails, tổng duy nhất; bỏ danh sách text stack luôn mở.
- `src/mobile/src/screens/TenantInvoicesScreen.tsx`: ghép các phần trên một surface; bỏ wrapper InvoiceDetail không còn consumer.
- `src/mobile/src/screens/TenantPaymentPanel.tsx`: bố cục payment thống nhất, QR action gọn, dời refresh phụ vào phần mở rộng; giữ polling/focus, hướng dẫn, sao chép và lịch sử.
- `src/mobile/src/screens/TenantAdjustmentPanel.tsx`: tab chữ + actual counts, action nhỏ, bỏ card/refresh lớn; giữ workflow và phân trang.
- `src/mobile/src/services/tenantInvoices.ts`: chấp nhận quantity null theo hướng phòng vệ để UI có fallback rõ ràng; backend DTO hiện vẫn khai báo quantity non-null. Không sửa contract hoặc tính ra quantity thay thế.
- `tests/mobile/ocr/liveWorkspace-ui.test.tsx`: cập nhật thao tác disclosure và các nhãn; bổ sung kiểm tra giá trị usage độc lập chỉ số/link, null usage, toggle độc lập, không fetch theo hàng, counts/tab/pagination thật.
- Báo cáo này.

Các thay đổi My Room/auth/shared shell từ lượt trước được giữ nguyên; không revert hoặc commit chung tự động.

## API và dữ liệu được giữ

- GET /api/v1/invoices và GET /api/v1/invoices/{id}: danh sách và detail; giữ phân quyền backend. Không gọi Owner/Staff API.
- GET /api/v1/payment-invoices: nhãn payment của danh sách, không gọi khi đang ở detail.
- GET /api/v1/invoices/{id}/payment: paymentStatus, outstandingAmount, paidAmount, payableAmount, dueDate, overdueDays, reviewStatus, pendingReview, originalIssuedAmount, approvedAdjustmentTotal, potentialExcessAmount và verified history. Final không có nghĩa đã thanh toán. Draft không gọi payment/QR.
- GET /api/v1/invoices/{id}/transfer-instructions: vẫn lazy khi mở QR. Giữ tài khoản, nội dung, amount, cảnh báo demo và guard số tiền khớp với payment; paid/mismatch không hiển thị QR cũ.
- GET /api/v1/invoice-adjustments?invoiceId=..., GET /api/v1/invoice-adjustments/{id}, GET /api/v1/invoices/{id}/adjustments: giữ detail, history, counts và phân trang từ backend.
- Các lệnh submit/upload/download trong adjustmentClient giữ nguyên idempotency key, expectedInvoiceVersion, evidence và authorization; không tự duyệt.

Mapping charge:

- category chọn icon; name và amount giữ nguyên backend. Không đổi tên phí hoặc tự thay amount.
- Rent: occupiedDays/periodDays ở dòng phụ; mở ra có tên đầy đủ, rate, ngày tính tiền, amount.
- Electricity/Water: mở ra có previousReading, confirmedReading, **quantity từ backend**, rate và amount; đơn vị kWh/m³. Null reading là Chưa có; quantity null là Chưa có dữ liệu tiêu thụ.
- Quantity hợp lệ vẫn hiển thị khi meterReadingId null hoặc thiếu confirmedReading. Không lấy hiệu chỉ số để thay quantity, không dùng sự tồn tại của giá trị số để kết luận trạng thái xác nhận.
- ServiceFee: name/amount ở hàng đóng; rate/quantity ở phần mở.
- calculatedAmount, rateDate, policyVersion và sự hiện diện của correctionRequestId được giữ trong phần mở; không in raw ID kỹ thuật.
- finalizedAt trong disclosure Thông tin phát hành. MissingInputs và scheduledFinalDate vẫn xuất hiện phù hợp cho Draft.

Tiền tiếp tục là chuỗi số backend cho tới lúc format. Không có float financial calculations, không tự tính lượng tiêu thụ, thành tiền, nghĩa vụ hoặc thanh toán thành công.

## Sai lệch tên phí và số tiền

Tên chứa “miễn phí”, “không thu tiền” hoặc “free” trong khi amount dương được giữ nguyên và có ghi chú yêu cầu kiểm tra trong phần mở. Test sử dụng dữ liệu tổng hợp để kiểm tra hành vi này. Chưa capture response live nên không khẳng định có record production cụ thể bị sai; không sửa dữ liệu/tên/tiền backend để làm UI khớp.

## Kiểm chứng thực thi lần này

```powershell
npm run test --workspace ./src/mobile -- ../../tests/mobile/ocr/liveWorkspace-ui.test.tsx src/__tests__/contract-sections.test.tsx src/__tests__/workspace-navigation.test.tsx
npm run lint --workspace ./src/mobile
npm run typecheck --workspace ./src/mobile
```

- Targeted: 3 file, **104 test qua**. Đây là tổng ba file có cả test My Room/contract/navigation, không phải 104 case riêng invoice. Component và HTTP được mock, không phải live API.
- Các case liên quan: Draft/Final; Paid/Unpaid/partial; QR số tiền khớp/lệch và chuyển Paid; upload/idempotency; approved/request detail; null/invalid response; lỗi mạng/retry; tiền lớn; mọi charge đóng mặc định; mở/đóng độc lập; quantity 7.75 dù hiệu chỉ số là 800 và meterReadingId null; null quantity fallback; không tăng số call khi mở charge; actual counts 21/0, đổi tab không refetch và page 2 thực.
- Lint và TypeScript: qua.
- Expo web export ứng dụng thật, Node 22.23.4: qua, `.tools/tenant-invoice-web` (ignored build artifact).
- Bộ mobile đầy đủ chạy bằng Node 22.23.4: **603 test qua, 55 file qua; 1 suite không tải được**. Lỗi đã có từ lượt trước: `tests/mobile/ocr/meterScreen.test.tsx` mock react-native-paper thiếu MD3LightTheme; không gọi cả suite PASS và không sửa test ngoài scope.
- Prettier và git diff --check được kiểm tra; file adjustment được format lại sau cảnh báo style.

## Giới hạn

Computer-use đã thử mở inventory ứng dụng thật nhưng trả lỗi “Computer Use native pipe is unavailable … The system cannot find the file specified. (os error 2)”. Vì vậy chưa có kiểm chứng pixel ở Android/iOS, màn 320/360px, font scaling hoặc thiết bị quét QR. Source có flex/minWidth, tên một dòng ở trạng thái đóng, QR co theo chiều rộng và giữ safe area; DOM tests không thay thế kiểm thử trực quan trên thiết bị.

Không gọi API nghiệp vụ live, tạo yêu cầu thật, sửa database, seed/migration hoặc thử provider ngân hàng. Chưa commit/push. Các lỗi build/test backend đã nêu trong audit cũ không được kiểm tra lại vì lượt này chỉ thay presentation mobile.
