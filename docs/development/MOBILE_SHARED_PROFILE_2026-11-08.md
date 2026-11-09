# BHOME Mobile — Hồ sơ cá nhân dùng chung

Ngày: 08/11/2026. Phạm vi: frontend mobile cho Owner, Staff và Tenant; yêu cầu trực tiếp của người dùng “Redesign and Integrate Shared Profile Screens”. Trace: **UC-03 / BE-03**, quyền `account.view-own` và `account.update-own` cho cả ba role theo `RolePermissions.cs:14–15`. Đối chiếu `OperationsContracts.cs`, `OperationsService.cs`, `CompactOperationsRepository.cs`, `LoginIdentifier.cs` và mục BE-03 của tài liệu backend delivery. Không sửa backend, schema, API hoặc quy tắc phân quyền.

## Luồng triển khai

- Tất cả vai trò render `ProfileScreen`; `Profile` và `TenantProfileScreen` chỉ còn là entry point tương thích. Không dùng tên mẫu hoặc `/auth/me` để hiển thị hồ sơ.
- GET `/api/v1/account/profile` qua `MobileApi.request`, kiểm shape response, dùng cache riêng theo API/user/roles. Skeleton nhỏ lúc tải đầu; lỗi có “Thử lại”; thiếu phone/email hiển thị “Chưa cập nhật”. Pull-to-refresh dùng WorkspaceShell.
- Identity card hiển thị initials từ tên thật, tên, vai trò chính từ `roles`, trạng thái hoạt động từ `isActive`. Không suy thành xác minh danh tính. Personal card có đúng ba trường; settings có bảo mật và thông báo đang hoạt động. Logout giữ xác nhận và cơ chế dọn credential hiện có.
- “Chỉnh sửa” gọi `go('profile-edit')`: route Stack dùng chung, quyền cả ba role, giữ Profile active. Không đổi cơ chế Tabs hoặc animation. Header có một tiêu đề; footer Lưu/Hủy nằm ngoài ScrollView và bên trong KeyboardAvoidingView hiện có.
- PUT cùng endpoint, chỉ gửi `fullName`, `phone`, `email`, `version`. Áp dụng allowlist khi serialize. Response PUT được publish ngay cho profile cache và version mới; abort/retire GET đang chạy để phản hồi cũ không ghi đè dữ liệu đã lưu. Không lưu hồ sơ vào persistent storage.

## Validation, conflict và phiên

- Name: trim, 2–150 ký tự. Email: trim, bắt buộc, tối đa 256; không tự thêm điều kiện TLD mà backend không yêu cầu.
- Phone: optional, tối đa 30 ký tự đầu vào; bỏ space, `-`, `.`, `(`, `)`; cho phép 8–15 chữ số ASCII và dấu `+` đầu chuỗi. Gửi null nếu bỏ trống.
- Form giữ version của bản hồ sơ người dùng đang chỉnh sửa. Background refresh không tự đổi baseline của bản nháp.
- `409 stale_profile_version`: giữ bản nháp, chặn Save; nút “Tải hồ sơ mới” thông báo sẽ thay nội dung đang nhập và chỉ cho lưu lại sau khi GET thành công. Không âm thầm merge/ghi đè phiên bản khác.
- `email_already_used` / `phone_already_used`: thông báo tiếng Việt, giữ input. Lỗi mạng/server không tự retry PUT hoặc tuyên bố đã lưu.
- Lock ngăn gửi trùng. Abort request khi rời màn/đổi API hoặc tài khoản. GET/PUT vẫn đi qua interceptor/refresh/expiration hiện có.
- Khi response xác nhận email hoặc phone thay đổi, gọi logout hiện có, trở về đăng nhập và báo đã lưu, cần đăng nhập lại. Nếu chỉ đổi tên, cập nhật cache và Back về profile. Không hứa phiên còn hiệu lực sau khi đổi liên hệ.
- Preview không có session chỉ nhắc đăng nhập; không sinh hồ sơ mẫu.

## File thay đổi trong task này

Tất cả đường dẫn sau tương đối root repository:

- `src/mobile/src/services/accountProfile.ts` — DTO, loader/PUT, normalization, validation, lỗi.
- `src/mobile/src/features/profile/useProfile.ts` — query/update theo phiên, lock và abort.
- `src/mobile/src/features/profile/ProfileComponents.tsx` — card, row, skeleton và retry.
- `src/mobile/src/screens/ProfileScreen.tsx`, `ProfileEditScreen.tsx` — UI chung.
- `src/mobile/src/screens/SharedScreens.tsx`, `TenantProfileScreen.tsx` — thay entry point hồ sơ cũ; các chức năng khác giữ nguyên.
- `src/mobile/src/features/workspace/navigation.ts`, `WorkspaceScreenView.tsx` — route/guard màn chỉnh sửa.
- `src/mobile/src/components/WorkspaceShell.tsx`, `WorkspaceHeaderContext.ts` — pull refresh, Back và footer tránh bàn phím.
- `src/mobile/src/lib/queryCache.ts`, `queryPolicies.ts` và `features/workspace/useCachedWorkspaceQuery.ts` — profile policy, publish response đã xác nhận và refresh chờ được kết quả.
- `src/mobile/src/__tests__/account-profile.test.ts`, `profile-screens.test.tsx`, `query-cache.test.ts`, `workspace-navigation.test.tsx`; `tests/mobile/ocr/liveWorkspace-ui.test.tsx`.
- Tài liệu này.

## Kết quả kiểm chứng

- Toàn bộ Vitest mobile bằng Node 22 của repository: **64 file / 779 test PASS**.
- `npm.cmd run typecheck --workspace ./src/mobile`: **PASS**.
- `npm.cmd run lint --workspace ./src/mobile`: **PASS**, không warning.
- `git diff --check`: **PASS**.
- Expo export bằng Node 22 cho **Android / iOS / web: PASS**; output ngoài repository tại `C:/FPT/Test/profile-qa-export`.
- Kiểm thử cover cả ba role; nullable fields, metadata không hiển thị, initials/status; GET thất bại/retry/401; account switch; exact PUT/version; cập nhật cache và GET về muộn; validation; duplicate contact; stale refresh; không rebase draft; duplicate submit; abort khi unmount; đổi liên hệ/logout; Cancel và đường vào settings; Stack/active tab/footer cho ba role.

Các test dùng synthetic data, mocked transport/session và DOM/headless components. Chưa dùng tài khoản người dùng hoặc gọi PUT trên database thật. Chưa nghiệm thu Android hardware Back, iOS gesture, bàn phím, layout/scroll hoặc đổi security stamp trên thiết bị thật. Expo export xác minh khả năng tạo bundle, không chứng minh runtime UI/E2E.
