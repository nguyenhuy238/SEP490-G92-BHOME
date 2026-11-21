# Staff Mobile Dashboard — 04/11/2026

## Phạm vi và căn cứ

Cải thiện Dashboard Staff theo yêu cầu thiết kế, giữ hệ màu navy và bốn tab hiện hữu. Đối chiếu AGENTS.md, navigation.ts, WorkspaceRoute, CaptureController, OperationalTasksController, ContractsController và InvoicesController. Các nhóm nghiệp vụ liên quan: UC-09, UC-11, UC-13..17, UC-19..21, UC-23, UC-26..29 và thông báo. Không thay đổi chính sách, quyền backend hoặc trạng thái nghiệp vụ.

## Thay đổi

- Hiển thị bốn thao tác thường dùng trước; mở/thu gọn danh mục 14 chức năng theo sáu nhóm trong yêu cầu.
- Thêm lối tắt Phòng trọ, Tài sản, Hóa đơn Staff và Sự cố khẩn cấp. Xử lý sự cố có route riêng, không mở nhầm danh sách công việc vận hành.
- Giữ bốn tab Trang chủ / Công việc / Thông báo / Cá nhân. Các route mới chỉ cho Staff; header navy dùng chung hiển thị cơ sở từ API, badge thông báo hiện hữu và nút tài khoản.
- Tổng quan dùng tổng số công việc đến hạn trong ngày Việt Nam từ server; không đếm trang dữ liệu đầu để suy ra tổng. Chỉ số trả phòng đếm lịch Approved trong danh sách được giao. API trả tối đa 100 lịch; nếu chạm giới hạn, số được đánh dấu là cận dưới bằng ký hiệu ≥.
- “Cần xử lý” hiển thị khi có tác vụ: công việc quá hạn còn Assigned/InProgress, lịch kiểm tra trả phòng Approved và công tơ Assigned. Mỗi mục dẫn tới đúng hồ sơ hoặc tác vụ. Đây là danh sách ưu tiên rút gọn, không phải tổng toàn bộ tác vụ.
- Tải lại khi quay về Dashboard hoặc nhấn Làm mới. Dữ liệu thiếu hiện —; lỗi tải có thao tác thử lại, không coi là số 0. Không gọi API Staff trong preview hoặc từ vai trò khác, không giữ dữ liệu tài khoản trước trong lúc đổi phiên.
- Danh mục và lưới được tách thành StaffFeatureDirectory, StaffFeatureGrid và staffFeatures.ts. Bốn thao tác thường dùng lấy từ cùng một danh mục để tránh trùng định nghĩa. Nhãn phân biệt phần đã có một phần và phần chưa khả dụng.
- Công việc quá hạn được truy vấn riêng Assigned/InProgress, sắp xếp theo hạn; không bị các dòng PendingVerification ở trang đầu che khuất.
- Nút quay lại của Staff dùng lịch sử nếu có, dùng route dự phòng nếu mở trực tiếp và tôn trọng chặn rời bản nháp onboarding. Nhãn vai trò nhân viên và banner preview dùng tiếng Việt.

## Đường truy cập 19 nhóm

Đường dẫn bên dưới nằm trong `/workspace/`. Có đường truy cập không đồng nghĩa nghiệp vụ đã hoàn thành; các giới hạn được ghi rõ ở mục tiếp theo.

1. Tài khoản cá nhân: đăng nhập tại `/`, tab Cá nhân (`profile`), đăng xuất và bảo mật (`security`). Chỉnh sửa hồ sơ chưa có API.
2. Dashboard: tab Trang chủ (`staff-home`).
3. Cơ sở và phòng: Phòng trọ (`rooms`) hoặc chạm cơ sở ở header; chưa có lịch sử phòng đầy đủ.
4. Tài sản: `staff-assets` hiển thị trạng thái chưa khả dụng; kiểm kê theo hợp đồng hiện có trong bàn giao/trả phòng.
5. Ca làm việc: Lịch làm việc (`shifts`), trạng thái chưa khả dụng ở phiên thật.
6. Công việc: tab Công việc (`work-orders`) và `task-detail`, API thật.
7. Tiếp nhận: `onboarding`, dùng hồ sơ người ở, CCCD OCR và xác nhận hiện hữu.
8. Hợp đồng đặt cọc: nhóm Hợp đồng (`signing`); chưa có thao tác tạo Holding Contract thật cho Staff.
9. Hợp đồng thuê: Hợp đồng (`signing`), nút tạo nháp hoặc `prepare-contract`, dùng màn MainDraft hiện hữu.
10. Gia hạn: chọn hợp đồng đủ điều kiện trong `signing`, thao tác Chuẩn bị gia hạn; Owner vẫn quyết định kích hoạt.
11. Bàn giao nhận phòng: chọn Bàn giao / Trả phòng → Bàn giao nhận phòng (`move-in`).
12. Trả phòng: chọn Bàn giao / Trả phòng → Kiểm tra trả phòng (`move-out`) hoặc lịch được giao trong Cần xử lý.
13. Điện nước: `meter-reading`; mở tác vụ thật tại `/meter`.
14. Hóa đơn: `staff-invoices`, trạng thái chưa khả dụng; không dùng route hóa đơn Tenant.
15. Công nợ: `debt-follow-up`, trạng thái chưa khả dụng ở phiên thật.
16. Báo cáo sự cố: `report-incident`, chỉ có form preview; phiên thật hiển thị chưa khả dụng.
17. Sự cố khẩn cấp: `staff-emergencies`, trạng thái chưa khả dụng; không giả lập đã tiếp nhận.
18. Bảo trì/sửa chữa: `staff-maintenance`, trạng thái chưa khả dụng; không chuyển nhầm sang UC-11.
19. Thông báo: tab Thông báo (`notifications`) có inbox thật; Gửi thông báo (`send-notification`) ghi rõ chưa triển khai.

## Tệp triển khai

- `src/mobile/src/screens/StaffDashboard.tsx`: tổng quan, KPI, danh sách ưu tiên và lựa chọn bàn giao/trả phòng.
- Component mới `src/mobile/src/components/StaffFeatureDirectory.tsx`: danh mục thu gọn và lưới hai cột dùng lại.
- `src/mobile/src/features/workspace/staffFeatures.ts`: cấu hình duy nhất cho 14 lối tắt.
- `src/mobile/src/features/workspace/useStaffDashboard.ts`: lấy dữ liệu tổng quan, truy vấn ưu tiên và làm mới theo phiên.
- `StaffFeatureCard.tsx`, `WorkspaceShell.tsx`, `navigation.ts`, `app/workspace/[screen].tsx`, `LiveWorkspaceScreens.tsx`: thẻ compact, header, quay lại, phân quyền route và thông báo chưa khả dụng.
- Các test Dashboard, dữ liệu Dashboard và điều hướng kiểm tra preview, phiên thật, quyền, định tuyến và bản nháp.

## Giới hạn đã xác nhận từ mã nguồn

- Chưa có nguồn tên Staff trong session hiện tại; lời chào thật dùng nội dung chung. Không lấy tên mẫu hoặc đọc tên người khác từ danh sách nhân viên.
- Ca làm, sự cố, bảo trì và lịch bàn giao nhận phòng chưa có nguồn tổng hợp cho Dashboard; không tự tạo số hoặc trạng thái “Đang trực”.
- Tài sản, hóa đơn Staff, sự cố khẩn cấp và bảo trì có trang giải thích trạng thái chưa khả dụng. Ca làm, công nợ, báo cáo sự cố và gửi thông báo vẫn chưa có tích hợp thật; danh mục ghi rõ trạng thái. InvoicesController hiện chỉ cho Owner/Tenant; Dashboard không gọi endpoint này bằng Staff.
- Luồng hợp đồng thuê, gia hạn, bàn giao và trả phòng dùng lại màn thật hiện hữu. Tạo Holding Contract cho Staff chưa hoàn thiện trong luồng thật. Màn phòng chưa có lịch sử phòng đầy đủ.
- Không thêm tính năng Owner-only, xử lý đăng ký cư trú cho Staff, endpoint, thư viện hoặc migration.

## Kiểm chứng

- Mobile typecheck, Mobile lint và npm run format:check: PASS.
- Mobile tests với Node 22 trong .tools: 41 file, 379 tests PASS. Cập nhật test cũ theo danh mục mới; bổ sung test số 0/dữ liệu thiếu, route bảo trì, chọn bàn giao/trả phòng, quyền các route mới, ngày Việt Nam, đổi tài khoản, công việc quá hạn và quay lại có bảo vệ bản nháp.
- Expo export web: PASS, output trong .tools/staff-dashboard-web (ignored).
- Kiểm tra trực quan và native/device: chưa thực hiện được; Computer Use báo browser host và native pipe không kết nối được.
- Không tuyên bố các nghiệp vụ đang thiếu backend đã hoàn tất chỉ vì có lối tắt.
