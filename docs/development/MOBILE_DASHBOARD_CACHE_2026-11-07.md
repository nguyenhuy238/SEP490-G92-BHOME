# BHOME Mobile — Dashboard loading, cache và đồng bộ dữ liệu

Ngày 07/11/2026, nhánh `member/Long`. Phạm vi: Tenant/Staff Dashboard, metadata header, notifications và lifecycle của shared query cache. Đối chiếu yêu cầu người dùng, AGENTS.md, BF-02 (task), BF-03/04 (contract/room), BF-05 (meter/invoice), BF-06 (payment/debt), GBR-01/02 và yêu cầu isolation/performance. Không thay đổi backend, API contract, quyền server, công thức tiền hoặc quy trình thanh toán. Giữ bố cục, typography và điều hướng hiện có; chỉ bổ sung trạng thái cập nhật nền/lỗi và pull-to-refresh.

## 1. Nguyên nhân đã xác minh

- `useWorkspaceQuery` trước đây giữ state trong từng hook. Khi màn hình bị unmount/remount, dữ liệu và promise đều mất; không có cache dùng chung hoặc deduplication.
- `useStaffDashboard` gọi reload toàn bộ khi focus, kể cả lần đầu. `TenantDashboardScreen` bỏ qua focus đầu nhưng reload toàn bộ khi quay lại.
- `useIncidentQuery` có một lớp reload-on-focus nữa cho incident summaries của Staff.
- `StaffLocationSubtitle` và Dashboard cùng đọc `/capture/locations` bằng hai hook độc lập.
- `TenantLocationSubtitle` luôn reload lúc focus; đường dẫn contracts dùng pageSize khác Dashboard.
- Notification badge/list có timer reload 30 giây theo mount, chưa gắn đầy đủ với navigation focus và trạng thái ứng dụng.
- Root `_layout.tsx` đã đặt SessionProvider/WorkspaceProvider bên ngoài Stack. Route có key theo user/role/screen để tách state đúng tài khoản và màn hình. Giữ những key này; cache được đưa ra khỏi vòng đời component thay vì loại bỏ guard cần thiết.
- Không tìm thấy TanStack Query, SWR, Redux hoặc Zustand đang quản lý server state. Có React Context, custom hooks, incident refresh event và một cache trang cục bộ ở payment ledger.

## 2. Giải pháp và quyết định kiến trúc

Mở rộng `useWorkspaceQuery` bằng option `cache`, dùng một `QueryCache` trong RAM thuộc mỗi MobileApi của phiên đăng nhập. API client sống trong MobileSessions/SessionProvider ở root nên cache tồn tại qua navigation và token rotation bình thường.

Đã cân nhắc thư viện query chuyên dụng; lượt này chọn mở rộng hook hiện có vì có thể giữ nguyên phần lớn consumer và hợp đồng hook, không cài dependency mới hoặc đưa thêm provider vào cây route. Caching là opt-in cho Dashboard/header/notifications. Những luồng chi tiết, xác nhận, OCR, file và mutation tiếp tục dùng cơ chế hiện có; không cache ảnh giấy tờ, binary hoặc secrets.

Cache hỗ trợ:

- Shared key theo API client (phiên/origin), user ID, tập role đã sắp xếp, URL đầy đủ gồm query/room/location và decoder identity nếu có.
- Deduplicate promise đang chạy; Strict Mode/remount/consumer thứ hai không hủy hoặc nhân đôi cùng request.
- Hiển thị success snapshot ngay khi quay lại. Chỉ initial loading khi chưa có dữ liệu; background fetching không xóa nội dung.
- Focus và foreground chỉ revalidate entry stale/invalidated. Thời gian stale không tự sinh request vào đúng thời điểm hết hạn.
- Manual refresh bỏ qua staleTime nhưng vẫn join request đang chạy. Chỉ các query đang dùng bởi màn hình được refresh.
- Invalidation theo nhóm resource; query inactive được đánh dấu stale, query có observer đang focus được tải lại.
- Version + AbortController loại kết quả cũ sau invalidation/logout/background; không để response chậm ghi đè dữ liệu mới.
- Lỗi mạng/server giữ snapshot thành công trước đó và error để retry; Tenant hiển thị rõ dữ liệu lần tải trước. 401/403/404 loại nội dung private của cached query bị lỗi. Không có vòng retry vô hạn; transport giữ một lần retry GET network ngắn đã có từ trước.
- GC sau 20 phút không còn subscriber; ưu tiên loại entry không dùng khi có nhiều key (ngưỡng 100), không loại query đang được quan sát. Dispose khi kết thúc phiên xóa snapshot, hủy request và timer.

Cache trang cục bộ của PaymentLedger không được nhân bản vào shared cache trong lượt này; nó vẫn có lifecycle/focus refresh riêng đã có. Không coi mọi GET của ứng dụng đều đã được cache.

## 3. Chính sách resource

- Rooms/location metadata: stale 10 phút.
- Contracts, expiry reminders, move-out assignments: stale 10 phút.
- Invoice list/detail dùng cho summary Dashboard: stale 1 phút.
- Debts summary: stale 1 phút.
- Payment summary: stale 30 giây.
- Notifications và unread count: stale 30 giây.
- Staff operational task summaries: stale 30 giây.
- Meter task/utility information: stale 5 phút.
- Incident summaries: stale 30 giây.
- Các nhóm trên đều GC sau 20 phút không có subscriber. Đây là policy client, không phải business rule hay cam kết realtime.

Giữ các query task Assigned/InProgress riêng, totalCount từ server và khoảng ngày nghiệp vụ Việt Nam. Tenant Dashboard và header dùng chung contracts pageSize 20 (trước Dashboard dùng 5, header dùng 20); không tải hết các trang. Khi đã chọn hóa đơn nợ, Dashboard chỉ gọi detail hiện có để có lines/usage, không gọi thêm invoice list không được dùng.

## 4. Invalidation và cập nhật từ backend

`MobileApi.request` chỉ phát invalidation sau HTTP mutation thành công. Mutation bị từ chối không sửa cache thành trạng thái thành công.

- Operational task accept/complete/update: tasks và notifications.
- Incident/work order create/update: incidents, tasks, notifications.
- Confirm meter readings: meters, tasks, invoices, notifications. Upload evidence/OCR/preview không tự invalidation như một xác nhận nghiệp vụ.
- Handover: contracts, rooms, meters, tasks, notifications.
- Contract create/sign/change thông thường: contracts, rooms, notifications. Activation/renewal/deposit/move-out có thêm các nhóm tài chính liên quan.
- Invoice adjustments/payment transactions: invoices, payments, debts, notifications.
- Room/resident/location/staff assignment updates: metadata/contract/tasks/meters liên quan.
- Notification read/read-all: notifications.

Khi một GET payment đã quan sát trước đó đổi trạng thái/số tiền từ backend, shared cache đánh dấu invoice/payment/debt summaries liên quan stale. Ví dụ detail polling thấy invoice chung chuyển Unpaid sang Paid do khách thuê khác trả; Dashboard sẽ đọc lại dữ liệu server. Không set Paid từ việc mở QR, sao chép hay bấm nút.

Unread count tăng sẽ revalidate notification lists đang dùng. Notification IDs mới trong page đã quan sát được phân nhóm bằng category/relatedObjectType hiện có để invalidation finance/contract/task/meter/incident tương ứng. Không coi một notification là bằng chứng thay thế response trạng thái thanh toán.

Notification polling vẫn 30 giây nhưng chỉ khi màn hình focus; cache kiểm tra freshness và foreground trước khi chạy request. AppState background/inactive dừng request cache đang chạy; foreground chỉ kiểm tra các query đang focus. Payment detail giữ polling xác minh hiện có nhưng bỏ lượt polling khi app background/inactive. Timer reconnect 5 giây trong SessionProvider được giữ: nó chỉ thử reconnect khi đang chờ kết nối, không phải poll toàn bộ Dashboard.

## 5. Số request đo được

Đo bằng transport giả lập và assertions trong `dashboard-cache.test.tsx`, không phải capture traffic production hoặc query database thật:

- Control dùng legacy uncached hook: hai consumer cùng URL qua hai lần mount → **4 HTTP calls**. Cùng kịch bản bật shared cache → **1 HTTP call** tổng cộng. Đây là benchmark kiểm soát cho cache/dedup, không phải số đo toàn Dashboard trước thay đổi.
- Tenant Home, fixture không có nợ và có một Final invoice tháng hiện tại: **6 calls lần đầu**, quay lại ngay **0 calls bổ sung**. Contract/debt/notification/expiry/invoice/payment đều dùng response giả lập.
- Staff Home kèm consumer tương đương header cơ sở: **8 calls lần đầu**, quay lại ngay **0 calls bổ sung**. `/capture/locations` chỉ gọi **1 lần**, không phải một lần cho header và một lần cho body.
- Tenant Home quay lại sau 31 giây: **2 calls bổ sung** cho payment và notifications; contract/invoice/debt còn fresh không bị refresh toàn bộ. Snapshot hiện ngay trong lúc chờ response.
- Fixture có hóa đơn nợ: không có request invoice list thừa; dùng invoice detail hiện có.
- Test task mutation: HTTP 409 không phát tải lại; mutation thành công tải lại task query, không kéo contract query không liên quan.
- Có test GC, foreground ngắn/dài, error/retry, role/account switch, logout, token rotation, invalidation trong lúc request cũ đang chạy và notification/payment observation.

Không có số đo trực tiếp trước thay đổi trên Android/iOS hoặc database; không quy đổi các số test trên thành phần trăm giảm tải production.

## 6. Isolation và authentication

- Mỗi lần login mới có API client/cache mới. Không dùng global private response map hoặc persistent storage.
- Logout/clear/phiên hết hạn dispose cache trước khi bỏ session. Response đến muộn không phục hồi snapshot đã xóa.
- Refresh token với cùng user/roles giữ API client/cache để không phá freshness. Refresh phát hiện user/roles đổi sẽ retire client cũ và tạo client mới.
- Hook scope còn phân tách user/roles; API origin và phiên được phân tách bằng ownership của client. Room/location/query filters nằm trong URL key.
- Authentication headers, token refresh, secure credential storage và backend authorization giữ nguyên. Không thêm production log chứa payload hoặc định danh nhạy cảm.

## 7. File sửa trong lượt này

Cache và API/session:

- `src/mobile/src/lib/queryCache.ts` (mới).
- `src/mobile/src/lib/queryPolicies.ts` (mới).
- `src/mobile/src/features/workspace/useCachedWorkspaceQuery.ts` (mới).
- `src/mobile/src/features/workspace/useWorkspaceQuery.ts`.
- `src/mobile/src/lib/api.ts`.
- `src/mobile/src/lib/sessions.ts`.
- `src/mobile/src/lib/SessionProvider.tsx`.

Dashboard/header/notifications:

- `src/mobile/src/features/workspace/useStaffDashboard.ts`.
- `src/mobile/src/screens/TenantDashboardScreen.tsx`.
- `src/mobile/src/screens/TenantDashboard.tsx`.
- `src/mobile/src/screens/StaffDashboard.tsx` (chỉ giữ tên cơ sở cached khi refresh lỗi; không redesign).
- `src/mobile/src/components/WorkspaceShell.tsx` (shared metadata và Home pull-to-refresh).
- `src/mobile/src/components/NotificationBadge.tsx`.
- `src/mobile/src/screens/NotificationsScreen.tsx`.
- `src/mobile/src/screens/TenantPaymentPanel.tsx` (bỏ polling khi background).

Tests:

- `src/mobile/src/__tests__/query-cache.test.ts` (mới).
- `src/mobile/src/__tests__/dashboard-cache.test.tsx` (mới).
- `src/mobile/src/__tests__/staff-dashboard-data.test.tsx` (mock dùng cache thực).
- `src/mobile/src/__tests__/workspace-navigation.test.tsx`.
- `tests/mobile/ocr/liveWorkspace-ui.test.tsx` (contracts URL thống nhất pageSize).
- `tests/mobile/ocr/sessions.test.ts`.

Working tree còn chứa các task trước chưa commit; không diễn giải toàn bộ diff với HEAD là thay đổi của lượt cache này.

## 8. Kiểm chứng và giới hạn

Node **22.23.4**, dùng runtime trong `.tools`:

- `npm run typecheck --workspace ./src/mobile`: **PASS**.
- `npm run lint --workspace ./src/mobile`: **PASS**, max-warnings 0.
- Targeted 7 file liên quan Dashboard/cache/session/navigation/live UI: **164 test PASS**.
- `npm run test --workspace ./src/mobile`: **678 test PASS, 59 file PASS; 1 suite lỗi import**. `tests/mobile/ocr/meterScreen.test.tsx` mock react-native-paper thiếu `MD3LightTheme`, tồn tại trước lượt này. Không tuyên bố toàn bộ suite xanh.
- Expo web export: **PASS**, `.tools/dashboard-cache-web`.
- `git diff --check`: **PASS**; có cảnh báo CRLF/LF cho file route đã thay đổi từ task trước.

Chưa manual/E2E trên Android/iOS hoặc API/database thật. Không chạy seed/migration hoặc mutation nghiệp vụ thật để đo hiệu năng.

Chưa thấy realtime/push subscription được cấu hình trong mobile. Thiết bị khác cập nhật không đồng nghĩa client biết ngay tức thì. Các nguồn đồng bộ hiện tại là notification polling/observation, payment reads, mutation thành công trên thiết bị, focus/foreground khi stale và manual refresh. Khi người dùng ở liên tục trên Home, staleTime không tự poll toàn bộ các summary; có thể kéo xuống để lấy dữ liệu mới ngay. Nếu backend có một mutation route mới ảnh hưởng Dashboard, cần bổ sung mapping và regression test.

Tài liệu nền tảng đã đối chiếu: [Expo SDK 58](https://docs.expo.dev/versions/v58.0.0/), [React Native AppState](https://reactnative.dev/docs/appstate).
