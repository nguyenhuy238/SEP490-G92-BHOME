# Staff Mobile — Lịch làm việc (05/11/2026)

## Phạm vi và đối chiếu

Yêu cầu frontend-only, UC-09: Staff chỉ xem lịch được phân công. Không bổ sung nghiệp vụ tạo/sửa/đổi ca. Không sửa backend, database, DTO hay API.

Kiểm tra controller backend, client dùng chung và mobile chưa tìm thấy API lịch ca trực. `/api/v1/billing-schedules` là lịch lập hóa đơn của Owner; lịch kiểm tra trả phòng thuộc hợp đồng. Hai loại này không được dùng làm lịch ca trực.

Màn cũ trong chế độ xem mẫu dùng `workflowFixtures.shifts`; chế độ đăng nhập thật dẫn tới màn chưa khả dụng. Đã thay cả hai đường bằng `StaffScheduleScreen` và xóa dữ liệu ca trực mẫu không còn sử dụng.

## UI và dữ liệu thật

- Giữ WorkspaceShell: topbar BHOME, nút quay lại, vùng cuộn, safe area và bottom navigation hiện có.
- Tiêu đề “Lịch làm việc”, card cơ sở gọn, trạng thái “Chưa có dữ liệu lịch làm việc” và mô tả “Lịch ca trực hiện chưa có dữ liệu để hiển thị.”
- Tái sử dụng `useWorkspaceQuery`, API client/phiên đăng nhập và `GET /api/v1/capture/locations`. `Named.id` làm giá trị chọn; `Named.label` làm tên cơ sở. Không sử dụng `parentId` hay suy diễn thêm trường ca trực.
- Backend `CaptureScope.VisibleLocations` giới hạn cơ sở đang hoạt động và phân công Staff có hiệu lực. Chỉ gọi API này khi đăng nhập Staff thật. Preview không gọi API và không hiển thị lịch giả.
- Một cơ sở: tên tĩnh; nhiều cơ sở: ChoiceField gồm “Tất cả cơ sở” và các cơ sở trả về. Đây là lựa chọn phạm vi hiển thị, chưa thể lọc ca do không có dữ liệu ca. Cơ sở bị thu hồi không còn được giữ làm lựa chọn đang hiển thị sau tải lại.
- Hiển thị loading, lỗi tải cơ sở, thử lại và nút refresh 48px theo IconButton hiện có. Tự tải lại khi màn nhận focus.
- “Công việc được giao” là shortcut riêng sang `work-orders`, không hiển thị nhiệm vụ như ca trực.
- Bỏ lịch ngày/tuần, giờ bắt đầu/kết thúc, trạng thái và card ca: chưa có trường/API phù hợp. Không có thao tác thay đổi dữ liệu.

## File frontend

- `src/mobile/src/screens/StaffScheduleScreen.tsx`: UI và tái sử dụng query cơ sở.
- `src/mobile/src/app/workspace/[screen].tsx`: route live/preview; giữ guard Staff.
- `src/mobile/src/screens/StaffWorkflowScreens.tsx`: bỏ màn lịch mẫu cũ.
- `src/mobile/src/services/workflowFixtures.ts`: bỏ fixture ca trực.
- `src/mobile/src/__tests__/staff-schedule.test.tsx`: 8 kiểm thử về dữ liệu thật, không có ca giả, chọn cơ sở, thu hồi cơ sở, tải/lỗi/thử lại, preview và phân quyền.

## Kiểm chứng

- Mobile: 45 test files, 457 tests đạt.
- TypeScript, ESLint, Prettier và `git diff --check` đạt.
- Expo export Android/iOS/Web thành công tại `.tools/staff-schedule-export`.
- Chưa kiểm chứng tương tác trực tiếp trên Android/iOS; export bundle không thay thế thử nghiệm thiết bị. Layout dùng vùng cuộn/safe area hiện có, tên cơ sở và nội dung cho phép xuống dòng.
