# Tenant Home & All Features — UI implementation

Ngày: 07/11/2026, Asia/Bangkok. Triển khai theo cả hai yêu cầu Tenant Home redesign và Fix Expanded Functions Layout. Đây là thay đổi UI/frontend navigation; không thay backend, DTO, database, dependency hoặc rule tài chính/hợp đồng.

## Files và thành phần

- `src/mobile/src/screens/TenantDashboard.tsx`: RoomSummary, InvoiceSummary, alert rows, sections và điện/nước; bỏ greeting/card action lớn, đổi typography/spacing, giữ trạng thái loading/error/retry và các handler theo ID backend. Nút Làm mới tổng quan vẫn được bỏ theo yêu cầu trước.
- `src/mobile/src/components/TenantFeatureDirectory.tsx`: registry chung cho cả Home và danh mục; grid đúng hai cột với khoảng cách 12px, ô Home cao 112px và danh mục 104px; icon container 40/36px, title tối đa hai dòng. Không còn dùng StaffFeatureCard hoặc các status placeholder kỹ thuật.
- `src/mobile/src/screens/TenantFeaturesScreen.tsx` (mới): màn danh mục ba nhóm, reuse registry; không fetch dữ liệu riêng hoặc tạo chức năng giả.
- `src/mobile/src/features/workspace/navigation.ts`: thêm đúng một route frontend `tenant-features`, chỉ Tenant; bottom tab đang chọn vẫn là Trang chủ. Các destination cũ không đổi.
- `src/mobile/src/app/workspace/[screen].tsx`: map màn mới qua guard/router/shell hiện có trong luồng thật.
- `src/mobile/src/components/WorkspaceShell.tsx`: header/nav gọn chỉ cho Tenant Home và All Features, navy #173654, logo nhỏ, bell 20px; không lặp thông tin phòng/header query khi RoomSummary đã hiển thị. Bottom navigation hai màn này cao tối thiểu 54px, giữ inset đáy; layout Staff/Owner và các màn Tenant khác giữ điều kiện cũ.
- `src/mobile/src/screens/TenantDashboardScreen.tsx`: giữ toàn bộ API và lựa chọn dữ liệu; bỏ request lặp ngay lần focus đầu vì query đã tải khi mount. Quay lại focus vẫn reload bằng cơ chế cũ.
- `tests/mobile/ocr/liveWorkspace-ui.test.tsx`: cập nhật điều hướng danh mục riêng và thêm test layout ổn định, đủ chức năng, không lặp billing alert, Draft/Paid/error/zero usage và số request mount.
- `src/mobile/src/__tests__/workspace-navigation.test.tsx`: role guard danh mục, back stack và bottom tabs/insets; giữ kiểm tra Staff/Owner.
- Báo cáo này. Giữ nguyên các thay đổi chưa commit từ các lượt My Room/Invoice/History/Auth trước.

## Home

Thứ tự cố định: header BHOME → phòng/hợp đồng → hóa đơn → cảnh báo có nội dung cần xử lý → bốn tiện ích → điện/nước và shortcut lịch sử → bottom tabs.

RoomSummary lấy roomNumber/locationName/status/endDate từ Active contract hiện có, có dot trạng thái, tên cơ sở một dòng và chevron đi đúng contractId. Không hiển thị lại phòng/cơ sở trong header. Empty/error không dùng thông tin mẫu.

InvoiceSummary tiếp tục ưu tiên hóa đơn còn nợ từ API debts trước hóa đơn tháng hiện tại. Số tiền ưu tiên payment.outstandingAmount; nếu payment chưa có thì dùng outstanding của debt cùng invoiceId, hoặc invoice.total với nhãn Tổng hóa đơn. Draft ghi Tổng tạm tính/Chưa phát hành; không suy Paid từ Final. Chỉ hiện Thanh toán ngay khi payment là Unpaid, invoice Final và amount backend còn dương. Paid dùng trạng thái xanh; overdue dùng overdueDays backend trong đúng một badge. Thanh toán và Chi tiết đi tới hóa đơn hiện có, không tạo transaction ở Home.

Billing notification trùng invoice đang hiển thị được ẩn khỏi alert list; thông báo điều chỉnh và cảnh báo hợp đồng vẫn giữ. Debt khác hoặc debt chưa mở được invoice vẫn có đường vào. Khi không có meaningful alert thì không có section cảnh báo rỗng; lỗi tải vẫn có Thử lại. Không fetch thêm incident counts chưa có trong data model.

Điện/nước dùng quantity của dòng Electricity/Water gắn meterReadingId trong invoice hiện có. Giá trị 0 thật được hiển thị; thiếu dòng/quantity thì Chưa có chỉ số, không tạo giá trị 0. Giữ cách chọn dòng đã có, không cộng nhiều dòng hoặc tính lại lượng/tiền. Hai card có cùng minHeight; đơn vị kWh/m³ và kỳ thực từ invoice. Shortcut Lịch sử điện nước vẫn đi tenant-meters.

## Danh mục chức năng

Home chỉ có Phòng của tôi, Hóa đơn, Báo sự cố, Yêu cầu của tôi. Action Xem tất cả chức năng điều hướng màn riêng, không expand inline, không đổi cấu trúc hay mount lại Home chỉ để mở một danh sách.

Danh mục giữ đủ 11 destination:

- Phòng & hợp đồng: tenant-room; contract; checklist; residence.
- Hóa đơn & thanh toán: invoice; invoice với focus=payment; tenant-meters; billing-history; invoice với focus=adjustment.
- Sự cố & yêu cầu: incidents; tenant-requests.

Contract/checklist tiếp tục nhận contractId nếu Home có; nếu chưa có thì dùng lựa chọn hợp đồng tại destination. Tạm trú vẫn có giới hạn nghiệp vụ cũ tại màn chi tiết; không gắn nhãn gửi/lưu thành công giả. Lỗi API tại destination không được biến thành status màu cam trong shortcut. Không bỏ chức năng hiện có.

Route mới dùng guard Tenant và shell/back hiện có; back stack quay lại Home, trường hợp không có lịch sử dùng fallback Home. Không thêm ScrollView lồng hoặc thay parent width/padding giữa Home và All Features.

## API được giữ

- GET /api/v1/contracts?page=1&pageSize=5&status=Active.
- GET /api/v1/invoices?page=1&pageSize=20.
- GET /api/v1/debts?page=1&pageSize=1, detail /invoices/{id} của debt nếu có.
- GET /api/v1/invoices/{id}/payment khi invoice Final.
- GET /api/v1/notifications?page=1&pageSize=3&unread=true.
- GET /api/v1/contracts/expiry-reminders.
- Bell vẫn dùng NotificationBadge hiện có: /notifications/unread-count và cơ chế cập nhật cũ, chỉ render count >0 trong luồng thật.

Không thêm request cho feature catalog. Test controller Home không có debt/invoice ghi nhận đúng 5 GET ban đầu, không gọi lần hai vì focus đầu. Shell Home không còn gọi thêm list contracts để lặp lại subtitle phòng. Không thay auth, quyền backend, DTO hoặc viết dữ liệu.

## Kiểm chứng

```powershell
npm run test --workspace ./src/mobile -- ../../tests/mobile/ocr/liveWorkspace-ui.test.tsx src/__tests__/workspace-navigation.test.tsx
npm run lint --workspace ./src/mobile
npm run typecheck --workspace ./src/mobile
```

- Targeted: **2 file, 114 test qua**; tổng bộ liên quan có cả test từ các chức năng trước, không phải 114 case riêng Home.
- Cases mới/cập nhật: đủ bốn shortcut; danh mục không render inline; tile navigation đúng registry/ID/focus; đủ 11 chức năng; không placeholder kỹ thuật; không lặp overdue/notification; vẫn giữ alert điều chỉnh/hợp đồng; 0 kWh thật và thiếu nước; Draft/Paid/Unpaid/error/retry; không có nút Làm mới tổng quan; không dùng invoice cũ giả là tháng này; mount API không lặp; Tenant-only route; back; bottom tabs/inset của Tenant và hồi quy Staff/Owner.
- Lint và TypeScript: **qua**.
- Full mobile bằng Node 22.23.4: **638 test qua, 56 file qua; một suite không tải được** do `tests/mobile/ocr/meterScreen.test.tsx` mock react-native-paper thiếu MD3LightTheme. Lỗi đã có ở các lượt trước; không sửa test ngoài phạm vi và không đánh dấu cả suite PASS.
- Expo web export ứng dụng thật: **qua**, `.tools/tenant-home-web` ignored build artifact.
- Format và git diff --check được kiểm tra. Không commit/push.

## Giới hạn

- Chưa gọi API nghiệp vụ live hoặc nghiệm thu Android/iOS. DOM tests kiểm hành vi/props/styles liên quan, không chứng minh pixel trên điện thoại, font scaling lớn hay gesture back thực tế.
- Đã thử inventory UI: không có apps/browsers; native pipe và browser access host unavailable. Không có screenshot thực tế trong lượt này; không dùng ảnh/mockup/demo thay thế.
- Giữ giới hạn dữ liệu hiện có: chọn Active contract theo logic cũ; list tháng hiện tại trong trang invoices đã tải; debt ưu tiên theo trang một bản ghi; notifications chỉ trang ba unread. Không khẳng định dashboard là toàn bộ lịch sử hoặc tổng công nợ.
- Không có API so sánh tiêu thụ kỳ trước được dùng nên không dựng phần trăm/chart. Không có incident aggregate trong controller Home nên không invent số sự cố mở. Mọi nội dung chi tiết vẫn đi destination và backend kiểm quyền.
