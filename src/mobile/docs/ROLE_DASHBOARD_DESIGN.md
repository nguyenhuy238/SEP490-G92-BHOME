# Đồng bộ Home Owner / Tenant theo Staff

## Phạm vi và nguồn tham chiếu

Yêu cầu: đồng bộ UI, giữ nguyên dữ liệu, navigation và quyền theo role.
Nguồn thiết kế thực tế là `screens/StaffDashboard.tsx`, `StaffFeatureCard.tsx`,
`WorkspaceShell.tsx` và `theme/theme.ts`. Route `workspace/[screen].tsx` dùng
StaffDashboard cho Staff ở cả chế độ mẫu và đăng nhập thật; Owner/Tenant có
component riêng cho hai chế độ. Không thay Staff theo giao diện Owner cũ.

Liên hệ quy tắc repository: GBR-01..03 về quyền và phạm vi dữ liệu được giữ
nguyên; đây là thay đổi trình bày, không triển khai nghiệp vụ BF/UC mới.
Không thay API, validation, xác thực, schema hoặc các luồng hợp đồng/thanh toán.

## Mẫu thiết kế được tái sử dụng

- Header navy `#193653`, logo nhà trong ô trắng 40px, chuông 22px,
  chiều cao tối thiểu 72px; tài khoản truy cập qua tab tương ứng từng role.
- Nền nội dung `#F5F7FB`, góc trên 26px, padding 16px và khoảng cách section 24px.
- Summary trắng bo 22px, card bo 18px, bóng nhẹ, khoảng cách nội bộ 12–16px.
- Tiêu đề navy, section có vạch vàng, Inter theo cấu hình Paper hiện tại.
- Thao tác dùng chính StaffFeatureCard: icon 26px trong ô 48px, nền màu nhạt.
- Status bo tròn, màu nhẹ; không suy ra trạng thái thành công từ thao tác client.
- Thanh tab trắng, icon 22px, chữ 11px, nền xanh nhạt cho tab được chọn.
  Chiều cao tối thiểu 60px cho phép tăng theo cỡ chữ; bottom inset tính một lần.

## Thay đổi

- `src/components/DashboardKit.tsx`: surface/summary, section/heading, metric,
  status và lưới thao tác dùng chung; tái sử dụng StaffFeatureCard và staffColors.
- `src/components/WorkspaceShell.tsx`: Owner/Tenant dùng cùng header, nền,
  padding và thanh tab như Staff. Giữ nguyên handler header, chuông, tab,
  exit guard, reset scroll, SafeArea và xử lý bàn phím.
- `src/screens/StaffDashboard.tsx`: chỉ dùng lại các style summary/section đã
  trích xuất, giữ nội dung và thao tác Staff.
- `src/screens/OwnerOverviewScreen.tsx`: summary trắng, section và card số liệu
  thống nhất, thao tác nhanh theo Staff. Giữ việc tải lại/abort và xử lý lỗi API.
- `src/screens/OwnerScreens.tsx`: cập nhật Home mẫu; giữ bộ lọc tháng, số liệu
  mẫu, phê duyệt, cảnh báo và hiệu suất cơ sở. Các màn khác giữ nguyên.
- `src/screens/LiveWorkspaceScreens.tsx`: cập nhật TenantHomeScreen; giữ query
  hợp đồng, thông tin phòng, thời hạn, tiền thuê, trạng thái và contractId khi mở.
- `src/screens/TenantScreens.tsx`: cập nhật TenantHome mẫu; giữ hóa đơn, tiện ích,
  sự cố, điện nước, thông báo và các thao tác hiện có. Các màn khác giữ nguyên.
- `src/theme/theme.ts`: làm rõ palette Staff là tham chiếu workspace chung;
  không thay theme toàn bộ app đăng nhập/onboarding.
- Test cập nhật: `src/__tests__/workspace-navigation.test.tsx`,
  `tests/mobile/ocr/connectivity-ui.test.tsx`, `tests/mobile/ocr/liveWorkspace-ui.test.tsx`.

Các đường dẫn `src/` ở trên tính từ `src/mobile`; `tests/mobile` tính từ root repo.

## Kiểm tra đã chạy

- `npm run test --workspace ./src/mobile`: 335 test / 37 file PASS.
- Có test tab riêng từng role, tab được chọn, safe-area inset, kích thước tab,
  chuông và destination khi chạm; exit guard vẫn hoạt động.
- Test Owner loading, lỗi, retry thực sự gọi lại API và abort khi unmount.
- Test Tenant dùng endpoint scoped, mở đúng contractId, điều hướng tiện ích,
  không hiện thao tác quản trị hoặc số liệu mẫu khi tài khoản chưa có hợp đồng.
- `npm run typecheck --workspace ./src/mobile`: PASS.
- `npm run lint`: PASS.
- Prettier trên các file của thay đổi này: PASS. `npm run format:check` toàn
  repo còn cảnh báo ở file có sẵn `docs/development/BHOME_FE_MOBILE_REPORT_2026-11-02.md`,
  ngoài phạm vi lượt chỉnh sửa UI này.
- Android Expo export: PASS, đầu ra kiểm tra nằm trong thư mục `.expo` bị ignore.

Lưới dùng flex-wrap, chiều rộng linh hoạt và text không giới hạn số dòng; tab
dùng minHeight thay vì khóa height. Chưa xác minh trực quan trên điện thoại thật,
ở 320/393/430px hoặc với font scaling lớn. Công cụ browser preview của phiên
kiểm tra không khả dụng; không coi test DOM hay export là bằng chứng kiểm tra
layout native thực tế.

## Những giới hạn giữ nguyên

Home Owner thật hiện chỉ có số liệu cơ sở/phòng/hợp đồng; chưa có báo cáo doanh
thu/công nợ/chi phí trên màn hình này. Không lấy số liệu mẫu thay cho API thật.
Home Tenant thật dùng hợp đồng từ API; các số liệu hóa đơn/sự cố/điện nước chi
tiết trong Home mẫu vẫn chỉ thuộc chế độ xem mẫu, có banner phân biệt.
Không bổ sung endpoint hay giả lập dữ liệu để lấp các khoảng trống đó.

Ưu tiên lượt này là Home và shell dùng chung. Các form nghiệp vụ sâu vẫn dùng
component sẵn có; không refactor hàng loạt các màn ngoài phạm vi.
