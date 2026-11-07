# Dashboard Tenant — chỉnh giao diện ngày 03/11/2026

## Điều chỉnh mới nhất theo phản hồi

Đã bỏ toàn bộ tiêu đề/card “SỰ CỐ & HỖ TRỢ”, dòng trạng thái và “Xem yêu cầu hỗ trợ”;
chỉ giữ một hàng “Liên hệ Ban quản lý”. Bỏ khối “THÔNG BÁO” khỏi dashboard và bỏ GET
notifications dành riêng cho dashboard. Màn thông báo/biểu tượng chuông hiện hữu vẫn giữ nguyên.
Kiểm tra lượt chỉnh này: 26 test UI liên quan, typecheck và lint đạt.

## Phạm vi

Chỉ trình bày dashboard Tenant theo ảnh tham khảo và thiết kế Staff hiện có.
Không sửa backend/database, nghiệp vụ thanh toán/hợp đồng hoặc phân quyền.
Không thêm thư viện, API hay cơ chế thanh toán mới.

## Thay đổi giao diện

- Dùng nguyên trạng `DashboardCard`, `DashboardSection`, `DashboardActions`,
  `dashboardStyles` và `StaffFeatureCard`: màu nền, thẻ bo góc, icon 26px trong nền 48px,
  khoảng cách 12px, tiêu đề nhấn cam và lưới hai cột giống Staff.
- Lời chào gọn, thông tin phòng/cơ sở từ hợp đồng, nút tài khoản nằm trong hàng nội dung;
  không có thẻ cá nhân lớn, CCCD, badge lặp hoặc nút cài đặt nổi che nội dung.
- Shell đổi nhãn `BHOME Tenant` riêng tại `tenant-home`. Header/safe area/scroll/tab style
  vẫn dùng shell hiện có. Giữ bốn tab Tenant: Trang chủ, Hóa đơn, Báo sự cố, Tài khoản.
- Hóa đơn tháng này: kỳ, tổng hóa đơn hoặc số còn phải trả từ backend, trạng thái backend,
  nút Xem hóa đơn. Không hiển thị bảng phí chi tiết ở trang chủ.
- TIỆN ÍCH CƯ DÂN: Báo sự cố / Thanh toán VietQR / Gia hạn hợp đồng / Tạm trú VNeID,
  cùng mô tả ngắn theo yêu cầu. Dùng route sẵn có; VietQR chỉ mở hóa đơn, không phát sinh thanh toán.
- HỢP ĐỒNG & THANH TOÁN: ba hàng icon/tiêu đề/chevron cho lịch sử, yêu cầu điều chỉnh,
  trạng thái ký. Hợp đồng đang có được thu gọn thành hàng, giữ nguyên tham số contractId và
  đường vào danh sách đầy đủ. Gia hạn/Trả phòng vẫn truy cập qua contract-request.
- ĐIỆN NƯỚC: hai card cạnh nhau, đúng kWh/m³; chỉ dùng quantity trên dòng hóa đơn có
  meterReadingId. Không tự tính/suy đoán chỉ số, không gọi capture API của Staff từ Tenant.
- SỰ CỐ & HỖ TRỢ: card gọn và đường vào hỗ trợ hiện có. Không tạo sự cố mẫu, kỹ thuật viên,
  tiến độ hoặc kênh liên lạc khẩn cấp mới.
- THÔNG BÁO: tối đa ba tiêu đề từ inbox hiện hữu; không đưa nội dung dài lên trang chủ.
- Preview dùng cùng presenter, không đưa hóa đơn 10/2024, tiền mẫu, tên người thuê,
  sự cố hoặc số tiêu thụ fixture vào dashboard.

## Dữ liệu và route tái sử dụng

Các GET đã tồn tại, được dùng để trình bày dữ liệu Tenant:

- `/api/v1/contracts?page=1&pageSize=5`
- `/api/v1/invoices?page=1&pageSize=20`
- `/api/v1/invoices/{id}/payment` — chỉ với hóa đơn Final đang hiển thị.
- `/api/v1/notifications?page=1&pageSize=20`

Chọn kỳ tháng hiện tại theo Asia/Ho_Chi_Minh từ danh sách hóa đơn backend sắp kỳ giảm dần.
Hóa đơn cũ không được gắn nhãn tháng hiện tại. Chưa tải được thanh toán thì không tự suy ra
Paid hoặc coi tổng hóa đơn là dư nợ; giữ nhãn Tổng hóa đơn và hướng xem trạng thái chi tiết.
Không có thao tác ghi/mark-read trên dashboard.

Các route giữ lại: invoice, incidents, contract, contract-request, residence,
billing-history, adjustment, signing, notifications và profile.

## File thay đổi

- `src/mobile/src/screens/TenantDashboard.tsx` (mới): presenter Tenant dùng chung live/preview.
- `src/mobile/src/screens/TenantDashboardScreen.tsx` (mới): ghép dữ liệu GET hiện hữu cho presenter.
- `src/mobile/src/screens/LiveWorkspaceScreens.tsx`: xuất lại TenantHomeScreen từ module mới;
  không thay nội dung Staff/Owner.
- `src/mobile/src/screens/TenantScreens.tsx`: preview TenantHome dùng presenter mới;
  không thay các màn hóa đơn/hợp đồng/sự cố chi tiết.
- `src/mobile/src/components/WorkspaceShell.tsx`: nhãn Tenant riêng tại tenant-home;
  không đổi nhánh Staff hoặc danh sách tab.
- `tests/mobile/ocr/liveWorkspace-ui.test.tsx`: cập nhật kiểm tra dashboard Tenant và bổ sung
  dữ liệu thật từ mock API, không khởi tạo thanh toán, hóa đơn cũ và route của các tiện ích.

`StaffDashboard.tsx`, `StaffFeatureCard.tsx`, `DashboardKit.tsx` và `navigation.ts` không được
chỉnh trong lượt này; hash sau kiểm tra khớp giá trị ghi nhận lúc bắt đầu. Những thay đổi chưa
commit có sẵn của người dùng được giữ nguyên.

## Kiểm chứng

- Mobile suite bằng Node 22.23.4: **39 files / 362 tests PASS**.
- Mobile TypeScript: **PASS**.
- Mobile ESLint: **PASS**.
- Kiểm tra diff whitespace: **PASS**.
- Expo Web export: **PASS**, output local `.tools/tenant-dashboard-web-check`.
- Test hồi quy gồm dashboard Staff và shell/tab theo vai trò.
- Test Tenant kiểm tra route, không truy cập capture/operational-tasks của Staff,
  không hiển thị tiền/kỳ mẫu; dùng Paid/outstandingAmount từ backend; đúng lượng điện/nước
  có tham chiếu reading; thông báo chỉ hiện tiêu đề; không gửi yêu cầu ghi/thanh toán.

## Giới hạn

- Không triển khai nghiệp vụ mới để lấy trạng thái sự cố: hiện dashboard chưa có nguồn dữ liệu
  sự cố phù hợp trong luồng đang dùng nên hiển thị chưa có dữ liệu và dẫn tới màn hiện hữu.
- Điện/nước phản ánh dòng hóa đơn tháng đang hiển thị, không phải dashboard realtime của công tơ;
  không có dòng được xác nhận thì hiển thị “Chưa có dữ liệu”.
- Chỉ đọc 20 hóa đơn gần nhất và 5 hợp đồng đầu theo API hiện hữu; danh sách chi tiết vẫn là
  nơi xem đầy đủ. Thông báo lấy từ inbox Tenant, không tự gọi đó là bảng tin toàn tòa nhà.
- Session không cung cấp displayName nên dùng “Xin chào bạn!”, không tự gán tên trong ảnh mẫu.
- Chưa kiểm tra trực quan/camera trên thiết bị thật hoặc emulator trong lượt này. Các test UI
  dùng DOM/mock; không coi đó là nghiệm thu bố cục trên Android/iOS.
