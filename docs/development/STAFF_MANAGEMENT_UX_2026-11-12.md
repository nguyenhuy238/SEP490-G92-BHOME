# Staff Management UI — 12/11/2026

## Phạm vi và truy vết

Yêu cầu redesign đính kèm của Owner, BF-02 / UC-08, GBR-01/02: trang `/staff` quản lý tài khoản và hợp đồng lao động. Chỉ thay presentation và validation form; không thay quyền, trạng thái nghiệp vụ, DTO, backend hay cơ sở dữ liệu. Không sửa màn phân công/công việc.

Đã đối chiếu `API_IMPLEMENTATION_STATUS.md`, `OperationsControllers`, `OperationsContracts`, `CompactOperationsRepository.StaffAsync`, `useOwnerWorkspace` và `staffContracts.ts`.

| Yêu cầu | Thành phần | Kiểm chứng |
| --- | --- | --- |
| Danh sách dễ đọc, trạng thái độc lập | StaffApiPage, StaffPresentation | Thiếu tên/điện thoại/hợp đồng; Active account + Ended employment |
| Drawer giữ ngữ cảnh danh sách | StaffDetailDrawer | Mở/đóng và giữ search |
| API và phiên bản giữ nguyên | StaffEditor, useOwnerAction hiện có | Payload create/update, accountVersion, reason, lỗi trách nhiệm và stale version |
| Phân trang đúng | StaffApiPage | Tổng từ server, page reset khi tìm kiếm |
| Invitation | ConfirmDialog + useOwnerAction hiện có | Lỗi và retry thành công |
| Form | StaffEditor | Input giữ sau lỗi, lỗi theo trường, ngày kết thúc không trước bắt đầu |

## API giữ nguyên

- GET `/api/v1/staff`: search tên/email (backend không tìm điện thoại), isActive, page/pageSize.
- GET `/api/v1/staff/{id}`; POST `/api/v1/staff`; PUT `/api/v1/staff/{id}`.
- POST `/api/v1/staff/{id}/invitation` khi người dùng xác nhận.
- Giữ hook xác thực, thông báo lỗi, khóa double-submit và invalidate sau mutation.

Hai KPI dùng `totalCount` của truy vấn toàn bộ và truy vấn `isActive=true`, pageSize=1. Không dùng một trang dữ liệu tính tổng hợp đồng sắp hết hạn. Lỗi/tải KPI hiển thị `—`/`…`, không mặc định 0. Cảnh báo hết hạn 30 ngày chỉ hiển thị trên từng hợp đồng có status Active, không tự đổi trạng thái.

## UX và giới hạn

- Header 24px, body 14px, bo góc theo px; toolbar search debounce 350ms, xóa tìm kiếm; phân trang chỉ khi hơn 20 kết quả.
- Bảng desktop, thẻ trên viewport dưới 600px; Drawer 500px desktop/toàn chiều rộng mobile; form hai cột desktop/một cột mobile.
- Ngày dd/MM/yyyy; lương vi-VN/VND; hợp đồng và tài khoản độc lập.
- Route `/staff-assignments` có thật nhưng chưa nhận staffUserId qua URL. Link mở màn phân công để Owner chọn nhân viên; không thêm chức năng màn 2 trong task này.
- Không thêm API. KPI tổng hợp hợp đồng cần endpoint tổng hợp hoặc bộ lọc server phù hợp nếu muốn triển khai sau này.
- Chưa kiểm chứng trực quan trên trình duyệt hoặc ghi dữ liệu API live. Kiểm thử dùng dữ liệu tổng hợp qua mock transport, không giả dữ liệu trong API mode.

## Kết quả kiểm tra

- Vitest `StaffApiPage.test.tsx StaffAssignments.test.tsx`: 2 file, 10 test đạt.
- TypeScript: đạt; production build (bao gồm `tsc -b`): đạt sau khi sửa biến không dùng trong test.
- Oxlint và `git diff --check`: đạt. Vite vẫn cảnh báo chunk chung lớn hơn 500 kB.
- Không chạy toàn bộ suite, live backend E2E hoặc visual browser QA.
