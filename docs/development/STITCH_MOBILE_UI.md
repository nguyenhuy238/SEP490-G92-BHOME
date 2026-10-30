# BHOME Mobile — triển khai giao diện Stitch

Tài liệu này mô tả phần 16 màn hình Stitch ban đầu. Phần bổ sung luồng theo SRS,
bao gồm onboarding/CCCD và các điểm vào mới, xem [MOBILE_WORKFLOW_DELIVERY.md](MOBILE_WORKFLOW_DELIVERY.md).
Các ghi chú về thao tác chưa có giao diện ở đây được thay thế bởi tài liệu bổ sung khi có mô tả mới.

Nguồn thiết kế: `stitch_bhome_mobile_ui_redesign/stitch_bhome_mobile_ui_redesign`,
16 cặp `code.html` / `screen.png` và `unified_mobile_workspace/DESIGN.md`.
Ưu tiên màu và bố cục trong HTML/screenshot khi phần mô tả DESIGN.md có giá trị khác.

## Phạm vi và truy vết

Đây là triển khai giao diện native, không thay đổi nghiệp vụ backend, schema hay phân quyền server.
Theo AGENTS.md: BF-02/UC-08..12 (Staff), BF-03/04/UC-13..19 (hợp đồng, bàn giao),
BF-05/UC-20..21 (chỉ số), BF-06/UC-22..25 (hóa đơn), BF-07/UC-26..30 (sự cố),
FE-07..09/UC-31..38 (tự phục vụ, thông báo, giám sát); GBR-01/02 về cách ly vai trò,
GBR-04 về nhà cung cấp ký điện tử, GBR-06 về tạm trú, GBR-07 về xác nhận OCR.
Nguồn quy tắc: AGENTS.md mục 3–5, 7, 13; yêu cầu UI đính kèm của người dùng;
Stitch chỉ là nguồn UI, không xác lập thêm chính sách hay tính năng ngoài phạm vi.

Tiêu chí: đủ 16 màn hình; dùng React Native Paper + TypeScript; Expo Router được giữ;
tab và deep link chặn sai vai trò; mẫu không tạo phiên/token và không gọi API;
form có kiểm tra đầu vào; thao tác chưa tích hợp phải nói rõ chưa lưu;
không để dữ liệu mẫu xuất hiện trong tài khoản đăng nhập thật; OCR cũ vẫn truy cập được.

## Danh mục 16 màn hình và file

1. Đăng nhập hệ thống → `src/mobile/src/screens/LoginScreen.tsx`, route `/`.
2. Owner Home → `OwnerScreens.tsx` / `OwnerHome`, `/workspace/owner-home`.
3. Approval Center → `OwnerScreens.tsx` / `ApprovalCenter`, `/workspace/approvals`.
4. Operational Monitoring → `OwnerScreens.tsx` / `Operations`, `/workspace/operations`.
5. Staff Home → `StaffScreens.tsx` / `StaffHome`, `/workspace/staff-home`.
6. Staff Work Orders → `StaffScreens.tsx` / `WorkOrders`, `/workspace/work-orders`.
7. Staff Meter Reading → `StaffScreens.tsx` / `MeterReading`, `/workspace/meter-reading`.
8. Tenant Home → `TenantScreens.tsx` / `TenantHome`, `/workspace/tenant-home`.
9. Tenant Invoice → `TenantScreens.tsx` / `TenantInvoice`, `/workspace/invoice`.
10. Tenant Contract → `TenantScreens.tsx` / `TenantContract`, `/workspace/contract`.
11. Move-in Checklist → `TenantScreens.tsx` / `MoveInChecklist`, `/workspace/checklist`.
12. Tenant Incident Report → `TenantScreens.tsx` / `TenantIncidents`, `/workspace/incidents`.
13. Shared Profile → `SharedScreens.tsx` / `Profile`, `/workspace/profile`.
14. Shared Notifications → `SharedScreens.tsx` / `Notifications`, `/workspace/notifications`.
15. Security Settings → `SharedScreens.tsx` / `SecuritySettings`, `/workspace/security`.
16. Notification Preferences → `SharedScreens.tsx` / `NotificationPreferences`, `/workspace/preferences`.

Các file màn hình 2–16 ở `src/mobile/src/screens/`.
Route dùng chung tại `src/mobile/src/app/workspace/[screen].tsx`.
Token màu/font tại `src/mobile/src/theme/theme.ts`.
Component dùng chung: `WorkspaceKit.tsx`, `WorkspaceShell.tsx`.
Navigation/preview context: `src/mobile/src/features/workspace/`.
Kiểu dịch vụ và dữ liệu mẫu: `src/mobile/src/services/workspaceData.ts`.
Font Inter đóng gói cùng app, giấy phép OFL trong `assets/fonts/OFL.txt`.
Ảnh tham chiếu được tải từ URL gốc trong HTML vào `assets/stitch/`; `sources.json` ghi ánh xạ.
Logo trong HTML đăng nhập bị hỏng khi xuất; dùng biểu tượng tòa nhà native và chữ BHOME.

## Chạy và duyệt

Tại thư mục repo:

```powershell
npm install
npm run mobile -- --port 8083
```

Mở app, chọn **Xem giao diện mẫu → Chủ cơ sở / Nhân viên / Khách thuê**.
Thanh thông tin mẫu ở đầu màn hình đưa về đăng nhập. Vai trò mẫu không phải quyền truy cập thật.
Trên Tenant Home, mở **Gia hạn hợp đồng**, sau đó chuyển tab **Biên bản kiểm kê**.
Trong Tài khoản có màn Bảo mật và Cài đặt thông báo. Biểu tượng chuông mở Trung tâm thông báo.

Đăng nhập thật dùng `MobileSessions` và HTTPS như trước. Dữ liệu nghiệp vụ mới chưa có
API adapter nên hiển thị trạng thái chưa kết nối. Owner/Staff mở **Tác nghiệp OCR**
để tiếp tục dùng trang cũ đã chuyển nguyên trạng từ `index.tsx` sang `capture.tsx`.
Các route `setup`, `resident`, `identity`, `meter`, `ocr-test` và `CameraCapture` được giữ.

## Tương tác và giới hạn

- Có điều hướng theo vai trò, tìm kiếm/lọc công việc, lọc phê duyệt theo cơ sở/loại,
  lọc kiểm kê theo khu vực, đánh dấu thông báo đã đọc trong bộ nhớ của bản mẫu.
- Form đăng nhập gọi API thật; form sự cố, mật khẩu và chỉ số mẫu có validation.
- Tùy chọn thông báo thay đổi trong bộ nhớ và reset được; không tuyên bố đã đồng bộ.
- Phê duyệt/từ chối, PDF, liên hệ, đính kèm, ngân hàng, QR thanh toán, thiết bị, 2FA,
  sinh trắc học và các chức năng mới khác chỉ mở hộp thoại nêu chưa tích hợp.
- Không dựng mã VietQR có thể chuyển tiền từ thông tin mẫu; tổng hóa đơn mẫu là
  4.800.000 + 380.000 + 140.000 + 100.000 = 5.420.000 đ.
- Không thực thi IoT/khóa từ xa, gửi tạm trú VNeID hay ký nội bộ. Các lời hứa như
  “an toàn tuyệt đối”, “tự gạch nợ trong 30 giây”, “hóa đơn VAT”, “bảo trì miễn phí”
  trong Stitch không được chuyển thành chính sách sản phẩm.
- Không triển khai giao ca/đổi ca Staff; nút tương ứng được dùng để mở danh sách công việc.
- Ngày và số liệu lịch sử trong preview theo thiết kế 2023–2024, không phải dữ liệu hiện tại.
- Giao diện mẫu không thay thế kiểm tra quyền tại server. API OCR vẫn quyết định phạm vi thật.

## Kiểm tra

```powershell
npm run typecheck --workspace ./src/mobile
npm run lint --workspace ./src/mobile
npm run test --workspace ./src/mobile
```

Test `tests/mobile/ocr/workspace.test.ts` kiểm tra deep link sai vai trò, vai trò không hợp lệ,
cách ly thông báo và tính nhất quán tổng hóa đơn. Chưa có thay đổi dữ liệu thật hoặc migration.
Kết quả kiểm tra thiết bị và export bundle được ghi trong báo cáo bàn giao của tác vụ.
