# BHOME Mobile — Bottom tab navigation

Ngày: 08/11/2026. Phạm vi: điều hướng và UX mobile theo yêu cầu refactor của người dùng (§2–10 trong task đính kèm); giữ nguyên nghiệp vụ, API và quyền backend. Các quyền mobile hiện có trong `navigation.ts` tiếp tục áp dụng cho Owner/Staff/Tenant (ranh giới vai trò GBR-01..03 theo AGENTS.md). Không bổ sung quy tắc nghiệp vụ hay thay đổi schema.

## Kiến trúc

- Root Stack: đăng nhập, `(tabs)`, `/workspace/[screen]` cho chi tiết và các route toàn cục hiện có.
- `(tabs)`: Expo Router JavaScript Tabs của SDK 58, import từ `expo-router/js-tabs`; `animation: 'none'`, `lazy: true`, `backBehavior: 'firstRoute'`.
- Custom tab bar dùng lại icon, nhãn, thứ tự, màu và safe area của WorkspaceShell. Tab được chọn lấy từ navigator state. Chọn lại tab đang mở không phát sinh navigation hoặc cuộn về đầu. Thanh tab có chiều cao tối thiểu ổn định khi đổi mục.
- Screen registry chuyển sang `features/workspace/WorkspaceScreenView.tsx`; mỗi route tab chỉ gọi registry này. Không sao chép màn nghiệp vụ. Tabs đã mở giữ mounted state; các tab chưa mở không bị ép preload.
- Chi tiết dùng root Stack phía trên Tabs: Back trả về đúng tab đang mở và instance đã có. Không cần tạo thêm Stack riêng cho từng tab trong phạm vi hiện tại.

## Quy tắc điều hướng

`go(screen)` tiếp tục hỗ trợ các caller cũ. Nếu screen là tab của vai trò hiện tại và không có tham số nội dung, lời gọi chọn tab. Từ trong Tabs dùng `router.navigate`; từ màn chi tiết dùng `router.dismissTo` để quay về instance Tabs đang có. Custom bar gọi `navigateToTab(route.key)` của navigator sau event `tabPress` và exit guard.

Lời gọi có tham số như `go('invoice', { invoiceId })` hoặc `focus` vẫn `router.push('/workspace/[screen]')`. Mở hóa đơn từ danh sách cũng đi qua Stack và Back về danh sách cũ. Các link `/workspace/[screen]` cũ được giữ: mục chính không có tham số chuyển tới route tab, còn link chi tiết giữ tham số và Stack.

Các route không thuộc bộ tab của vai trò bị loại khỏi Tabs bằng `Tabs.Protected`, đồng thời screen registry giữ kiểm quyền trước khi mount màn nghiệp vụ. WorkspaceProvider được tạo lại theo user/roles; root navigator được phân biệt theo principal/role và protected workspace bị loại khi logout. Exit guard/callback đang chờ không truyền sang tài khoản khác. Thao tác reset scroll trong màn chi tiết chỉ tác động shell đang focus.

## File triển khai

- `src/mobile/src/app/_layout.tsx`, `app/index.tsx`, `app/workspace/[screen].tsx`.
- `app/(tabs)/_layout.tsx` và 10 route: `owner-home`, `approvals`, `operations`, `staff-home`, `work-orders`, `notifications`, `tenant-home`, `invoice`, `tenant-requests`, `profile`.
- `components/WorkspaceShell.tsx`, `components/WorkspaceTabBar.tsx`.
- `features/workspace/{navigation.ts,WorkspaceProvider.tsx,WorkspaceScreenView.tsx,WorkspaceTabsContext.ts}`.
- `screens/TenantInvoicesScreen.tsx`.
- `src/__tests__/workspace-navigation.test.tsx`, `src/__tests__/workspace-router-state.test.ts`, `tests/mobile/ocr/liveWorkspace-ui.test.tsx`.

## Kiểm chứng

Kiểm thử component kiểm tab theo vai trò, cấu hình lazy/animation, chọn lại tab, navigator selection, giữ node thanh tab, exit guard, legacy link, tab-vs-detail, đổi tài khoản và scroll của tab ẩn. Kiểm thử reducer dùng chính TabRouter/StackRouter của Expo Router đã cài để kiểm giữ route keys/params, số route, Android Back về Home và Back từ chi tiết giữ tab state. Đây là kiểm thử headless, không thay thế thiết bị thật.

Chạy Vitest bằng Node 22 trong `.tools/node-v22.23.4-win-x64` theo yêu cầu runtime của repository. Node 24 mặc định của shell làm các test `expoStartup` đi vào nhánh chọn lại runtime; không coi thất bại do môi trường này là lỗi điều hướng.

Kết quả đã thực thi:

- Toàn bộ mobile Vitest với Node 22: **62 file / 729 test PASS**.
- Sau chỉnh sửa cuối cho custom bar và fixture type, chạy lại hai file navigation: **46 test PASS**.
- `npm run typecheck --workspace ./src/mobile`: **PASS**.
- `npm run lint --workspace ./src/mobile`: **PASS**, không warning.
- `git diff --check`: **PASS**.

Lệnh Vitest từ `src/mobile`: `../../.tools/node-v22.23.4-win-x64/node.exe ../../node_modules/vitest/vitest.mjs run --config vitest.config.ts`.

Expo export đã tạo bundle Android/iOS/web ngoài repository. Chưa xác minh thao tác Android hardware Back, iOS gesture/animation, scroll thực và phiên đăng nhập thật trên thiết bị. Công cụ trình duyệt báo host không khả dụng nên chưa nghiệm thu UI tương tác. Không gọi API nghiệp vụ thật hoặc ghi database trong task này.
