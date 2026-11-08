# BHOME Mobile — Shared notification inbox

Ngày: 08/11/2026. Phạm vi: yêu cầu “Complete Notification UI Redesign & Shared Implementation”, frontend Owner/Staff/Tenant. Đối chiếu `NotificationsController`, `NotificationContracts`, `CompactNotificationRepository`, shared `notificationClient`, `IncidentInbox` và navigation hiện có. Giữ quyền `Permissions.Notifications.ReadOwn` và kiểm quyền target trên backend; không thêm endpoint, category hoặc quy tắc nghiệp vụ. Không sửa backend, migration hay cấu hình push.

## Giao diện và nguồn dữ liệu

- Một `NotificationsScreen` dùng chung cho ba role, gồm tiêu đề Thông báo, Đọc tất cả khi có số chưa đọc từ server, chip Tất cả/Chưa đọc và Menu nhóm compact.
- Các nhóm đúng contract: Contract/Hợp đồng, Invoice/Hóa đơn, Payment/Thanh toán, Adjustment/Điều chỉnh, Task/Công việc.
- FlatList sở hữu vùng cuộn; WorkspaceShell giữ navy header, safe area và tabs nhưng không lồng thêm ScrollView. Thẻ memo dùng ID làm key, icon nhỏ, timestamp, title, summary tối đa hai dòng; unread có nền xanh nhẹ/chấm nhỏ. Không hiển thị ID hoặc delivery state.
- Skeleton lúc tải đầu; empty/no-results riêng; lỗi có Thử lại nhỏ. Pull-to-refresh giữ filter và giữ dữ liệu đang có khi refresh lỗi. Tải thêm bằng footer compact, dùng page/pageSize/totalCount backend, dedup ID, dừng khi hết trang/rỗng/không có ID mới. Đổi filter bắt đầu lại trang một.
- Không dùng UI thông báo mẫu cũ; entry point `SharedScreens.Notifications` cũng chuyển sang màn chung.

## Năm API và đồng bộ

- GET `/api/v1/notifications`: lấy và kiểm shape từng trang, không tự lọc theo role trên client.
- GET `/api/v1/notifications/unread-count`: dùng cùng cache key/decoder với NotificationBadge. Inbox không tạo timer. Badge dùng polling 30 giây có reference counting theo API, tối đa một timer cho các subscriber cùng API, cleanup khi hết subscriber.
- POST `/api/v1/notifications/{id}/read`: gọi trước target khi mở item chưa đọc. Chỉ ghi nhận UI read sau response thành công; không tự tạo timestamp readAt khi response là 204. Sau xác nhận, refresh list/count và reset pagination để tránh offset cũ của filter unread.
- POST `/api/v1/notifications/read-all`: khóa gửi trùng, chỉ cập nhật UI sau xác nhận, giữ filter và lấy lại count từ server.
- GET `/api/v1/notifications/{id}/target`: dùng target được backend cấp quyền, validate ID và map sang route mobile hiện có. Adjustment Tenant lấy invoiceId qua API adjustment hiện có. Không lấy ID điều hướng từ nội dung notification.

Lỗi đọc và lỗi mở target độc lập: đọc thất bại không tự làm item thành đã đọc; target hợp lệ vẫn có thể mở sau cảnh báo. Target bị xóa/thu hồi quyền có thông báo nhẹ; read đã xác nhận được giữ. Thông báo không có liên kết vẫn đọc được, không sinh lỗi điều hướng. Đích chỉ có trên Owner Web được báo rõ, không điều hướng vào màn giả/khác quyền. Request bị abort khi rời màn; phản hồi pagination cũ không được ghi đè nội dung vừa refresh.

## Xử lý phần sự cố/bảo trì

Nguồn cũ là **`/api/v1/incidents/notifications`**, khác `/api/v1/notifications`, có DTO và nghiệp vụ riêng. Không gộp, không tạo category Incident cho inbox chung.

Giữ `IncidentInbox` nguyên chức năng ở route `incident-inbox` cho ba role, với link “Thông báo sự cố và bảo trì” tại `IncidentListScreen`. Tenant đi qua Yêu cầu; Owner/Staff qua màn Sự cố hiện có. Route giữ kiểm quyền, active tab tương ứng và Back; inbox chung không gọi endpoint sự cố nữa.

## File thay đổi

Đường dẫn tương đối root repository:

- `src/mobile/src/screens/NotificationsScreen.tsx`, `screens/SharedScreens.tsx`.
- `src/mobile/src/features/notifications/{NotificationRow.tsx,useNotificationInbox.ts,useNotificationActions.ts}`.
- `src/mobile/src/services/{notificationInbox.ts,notificationRefresh.ts}`.
- `src/mobile/src/components/{NotificationBadge.tsx,WorkspaceShell.tsx}`.
- `src/mobile/src/features/workspace/{useCachedWorkspaceQuery.ts,navigation.ts,WorkspaceScreenView.tsx}`.
- `src/mobile/src/features/incidents/IncidentScreens.tsx` — thêm đường vào inbox riêng.
- `src/mobile/src/__tests__/{notification-inbox.test.tsx,notification-inbox-state.test.ts,workspace-navigation.test.tsx,incident-integration.test.tsx}`.
- `tests/mobile/ocr/liveWorkspace-ui.test.tsx` và tài liệu này.

## Kiểm chứng

- Vitest toàn bộ mobile bằng Node 22 trong `.tools`: **66 file / 807 test PASS**.
- TypeScript: `npm.cmd run typecheck --workspace ./src/mobile` — **PASS**.
- ESLint: `npm.cmd run lint --workspace ./src/mobile` — **PASS**, không warning.
- `git diff --check` — **PASS**.
- Expo export Android/iOS/web — **PASS**; output ngoài repository `C:/FPT/Test/notifications-qa-export`.

Test cover ba role, card/target routing, exact API/query, count/badge dedup, timer cleanup, mark/read-all xác nhận và thất bại, target403/404/invalid ID/khác role, không có liên kết, filter/pagination reset, dedup và dừng tải, response muộn, refresh lỗi vẫn giữ dữ liệu, account switch, expired session, abort target lúc unmount, không lồng ScrollView và đường vào incident inbox cho ba role.

Các test dùng DOM/headless, mocked transport và synthetic data. Chưa nghiệm thu UI trên Android/iOS thật, hiệu ứng/native scroll, kết nối database thật hoặc sự kiện nghiệp vụ thật. Không chạy thao tác đọc/đánh dấu trên thông báo của người dùng bằng tool trong task này. Không triển khai push, email hoặc tùy chọn nhận thông báo.
