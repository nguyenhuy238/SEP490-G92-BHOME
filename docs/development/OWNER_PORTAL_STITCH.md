# Owner Portal — màn 02–25

## Nguồn và phạm vi

Yêu cầu mới: giữ login, triển khai các màn còn lại từ Stitch, chạy độc lập với mock CRUD,
persistence và router dùng chung. Đã đọc AGENTS.md, API_CONVENTIONS.md, MODULES.md,
cấu trúc Owner/Public Web và auth dùng chung. Đã trích heading, field, table/nội dung từ
25 code.html, xem 24 ảnh còn lại qua contact sheet cục bộ; ảnh login được đọc ở bước trước.
`scripts/inspect-owner-stitch.cjs` kiểm kê bản xuất vào `.tmp`.
Các báo cáo DOCX không được kiểm chứng độc lập trong thay đổi frontend demo này.

Mapping theo guardrails hiện có trong AGENTS.md:

- BF-01 / UC-04–07 / GBR-08: cơ sở, loại phòng, phòng, tài sản và biểu phí.
- BF-02 / UC-08–12: nhân viên, phân công, lịch ca và tác vụ.
- BF-03/04 / UC-13–19 / GBR-04/06: khách thuê, hợp đồng, bàn giao, cư trú bên ngoài.
- BF-05 / UC-20–21 / GBR-07–09: chỉ số xác nhận và hóa đơn bất biến.
- BF-06 / UC-22–25 / GBR-10/18: đối soát, công nợ, điều chỉnh, tránh ghi nhận trùng.
- BF-07 / UC-26–30 / GBR-11/12: khẩn cấp, Work Orders, duyệt và nghiệm thu.
- FE-07–09 / UC-31–38 / GBR-15–17: thông báo, báo cáo, What-if độc lập và thông tin công khai.

Đây là ánh xạ phạm vi demo, không tuyên bố đáp ứng toàn bộ SRS hay kiểm soát server.

## Thay đổi

- Thêm AppShell (Owner trước đó chỉ có Vite starter/login), sidebar phân nhóm, header/search/
  breadcrumb/location selector dùng chung. Tiếp tục sử dụng theme hiện có của Owner.
- Thêm 24 route riêng; giữ login, bổ sung demo auth và protected deep links.
- Giữ các bố cục đặc trưng: dashboard, cards cơ sở/loại phòng, ma trận tầng, lịch tuần/tháng,
  bảng/Kanban, bàn giao, report/What-if, public-content preview.
- ResourcePage nhận cấu hình feature riêng từ featureDefinitions.ts. Cột/nhãn/ảnh dựa trên bản xuất;
  form, DataGrid, detail panel, filter và trạng thái dùng chung.
- PortalRecord/DemoDatabase là view model demo, không phải DTO backend đã xác nhận.
  Mock repository là điểm thay thế khi có OpenAPI nghiệp vụ. Không suy đoán endpoint.
- Không thay đổi giao diện LoginForm/LoginPage; hook và route guard thêm nhánh demo/chuyển route.
- Không sửa Public Web, backend hoặc mã nguồn packages/client-core; không có migration.

## Khác biệt có chủ đích

- Không sao chép hành vi nộp VNeID, chữ ký pháp lý, ngân hàng thật hoặc dự báo AI của ảnh mẫu.
- Tạm trú chỉ cập nhật thông tin bên ngoài và xác nhận chỗ ở của Owner (GBR-06).
- Không tự tính phạt, khóa khách, trừ cọc, chuyển hoàn theo công thức chưa được phê duyệt.
- Seed chuẩn hóa tên/địa chỉ/phòng khác nhau giữa các ảnh thành một bộ dữ liệu liên kết.
  KPI tính từ seed nên có thể khác các con số rời rạc trong Stitch.
- Biểu đồ lịch sử chưa có đủ giao dịch được gắn nhãn mô phỏng. Không suy ra dữ liệu thị trường.
- Xuất CSV thực tế; public-content chỉ xuất bản vào bản xem trước cục bộ.

## Acceptance được kiểm thử

- 24 route mới render nội dung riêng, có navigation, không gọi backend trong mock mode.
- Deep link quay về màn được yêu cầu sau đăng nhập demo.
- CRUD lưu qua repository mới; xóa master có tham chiếu bị chặn.
- Form validate; tìm kiếm không khớp có empty state; reset khôi phục danh sách.
- Sai cơ sở/phòng, tiền âm, giảm chỉ số, lịch nhân viên chồng lấn bị từ chối.
- Không sửa tiền/chi tiết hóa đơn phát hành; điều chỉnh cần đề nghị/phê duyệt, giữ số tiền gốc.
- Đối soát lặp không ghi có hai lần, cập nhật đúng số dư/công nợ liên quan.
- Hợp đồng cần chữ ký hai bên và cọc trước kích hoạt; không chồng hợp đồng hiệu lực cùng phòng.
- Lưu What-if không sửa records; lợi nhuận không dương không báo hoàn vốn hữu hạn.
- Storage hỏng/đầy báo lỗi thay vì báo lưu thành công.

Chưa chạy browser E2E, pixel comparison, thiết bị thật hoặc live API/provider integration.
Cần QA giao diện từng màn và OpenAPI nghiệp vụ trước nghiệm thu tích hợp production.

Kết quả chạy tại repository:

- `npm.cmd run test --workspace owner-web`: PASS, 46/46 test trong 4 file.
- `npm.cmd run typecheck --workspace owner-web`: PASS (strict mode).
- `npm.cmd run lint --workspace owner-web`: PASS, không còn cảnh báo lint.
- `npm.cmd run build --workspace owner-web`: PASS, có cảnh báo chunk chính lớn hơn 500 kB.
- `git diff --check`: PASS. Dev server trả HTTP 200 cho `/dashboard`.
- Công cụ browser trả danh sách rỗng; không tuyên bố đã có screenshot render của ứng dụng.
- Môi trường hiện có Node 24.22.1, khác engine Node 22 của repo; cần chạy lại CI theo engine hỗ trợ.

## File chính

- Mới: src/owner-web/src/app/_, components/_, page của 24 feature, hooks/_,
  services/_, types/portal.ts, utils/*, test route/repository/UI và script kiểm kê.
- Sửa: src/owner-web/src/App.tsx, hook auth, theme, .env.example, index.html,
  cấu hình strict/test, package files và README. Danh sách route/tương tác nằm trong README Owner.
- OWNER_LOGIN_STITCH.md là bàn giao lịch sử của bước login, đã được bổ sung liên kết tài liệu mới.
