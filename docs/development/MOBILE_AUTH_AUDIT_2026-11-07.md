# BHOME Mobile Authentication Audit — Refresh Token, Logout & Change Password

Ngày audit: **07/11/2026**, múi giờ Asia/Bangkok (UTC+7). Source: nhánh `member/Long`, commit `1a4dc8390dde433c6a7e2ffe4e12c7a311449a66`.

## 1. Phạm vi và kết luận

Audit-only: đọc Backend ASP.NET Core, Mobile Expo Router, shared client và test; chạy test hiện có cùng một probe trong bộ nhớ dùng transport/storage giả lập. Không sửa source, không tạo API, không refactor, không chạy seed/migration hoặc ghi dữ liệu vào API/database của người dùng. File báo cáo này là artifact duy nhất được thêm.

**Cả ba chức năng đã có backend và điểm gọi thật từ Mobile. Chưa đủ bằng chứng để kết luận nghiệm thu end-to-end trên thiết bị/API/database thật.** Refresh tự động chạy khi restore hoặc nhận HTTP 401, không có timer chủ động refresh trước hạn access token. Logout thu hồi phiên hiện tại; đổi mật khẩu thu hồi mọi phiên. HTTP 204 được client xử lý đúng.

Phát hiện đáng chú ý nhất: nếu logout gặp lỗi mạng **đồng thời** xóa SecureStore thất bại, phiên trong RAM bị xóa nhưng refresh credential cũ có thể còn trên thiết bị và được restore khi mở app lại. Đã tái hiện nhánh logic này bằng storage/transport giả lập; chưa tái hiện lỗi SecureStore trên thiết bị thật.

Quy ước: ✅ Implemented / Connected; ⚠️ Partially implemented; ❌ Missing / Not connected; ❓ Not verified. Cột Tested phân biệt test đã chạy với runtime toàn hệ thống; không dùng kết quả unit/component test làm bằng chứng nghiệm thu production.

| Feature | Backend | Mobile UI | API Service | FE-BE Connected | Tested | Result |
|---|---|---|---|---|---|---|
| Refresh Token | ✅ Implemented | ✅ Tự động, không cần nút riêng | ✅ `MobileSessions.refresh` + `MobileApi.request` | ✅ Đối chiếu source/DTO | ✅ Test giả lập đã chạy; ❓ DB/device thật | ⚠️ Có kết nối; chưa nghiệm thu E2E |
| Logout | ✅ Implemented | ✅ Profile Owner/Staff/Tenant; màn capture | ✅ `MobileSessions.logout` | ✅ POST thật, Bearer, xử lý 204 | ✅ Test provider/UI và probe lỗi; ❓ DB/device thật | ⚠️ Có lỗi khi xóa credential thất bại và hạn chế thông báo lỗi |
| Change Password | ✅ Implemented | ✅ `AccountSecurityScreen` | ✅ `MobileApi.json` | ✅ Body khớp DTO, xử lý 204 | ✅ Test UI/transport đã chạy; ❓ DB/device thật | ⚠️ Thiếu validation chi tiết, gọi logout/refresh dư sau thành công |

## 2. Backend: endpoint, DTO, quyền và business logic

### 2.1. Refresh Token

- Endpoint: `POST /api/v1/auth/refresh`.
- Controller: [AuthController.cs](../../src/backend/BHome.Api/Controllers/IdentityAccess/AuthController.cs), `AuthController.Refresh`, dòng 36–45. `[AllowAnonymous]`: không yêu cầu access token còn hạn; refresh credential là bằng chứng xác thực.
- Body Mobile: `{ "refreshToken": string }`. `RefreshRequest` ở dòng 113 cho phép null/không gửi và giới hạn 256 ký tự; null/rỗng/không hợp lệ trả 401. Không yêu cầu header `X-BHome-Client` cho native Mobile.
- `AuthTransportFilter.IsWeb` / `OnActionExecutionAsync`, [AuthTransportFilter.cs](../../src/backend/BHome.Api/IdentityAccess/AuthTransportFilter.cs):10,12: chỉ client chọn transport web mới dùng cookie. Mobile dùng JSON token, không chọn cookie transport. Header client không hợp lệ trả 400; cookie/web sai Origin trả 403.
- Service: [IdentitySessionService.cs](../../src/backend/BHome.Infrastructure/IdentityAccess/IdentitySessionService.cs):45, `RefreshAsync`. Hash token, tìm owner, mở transaction và khóa user, đọc token/session mới nhất; kiểm tra tài khoản, security stamp, role, thời hạn và trạng thái thu hồi. Token đã tiêu thụ bị dùng lại sẽ thu hồi cả session family. Token hợp lệ được đánh dấu consumed và cấp cặp token mới trong cùng transaction.
- `Issue` tại dòng 111: sinh 32 byte ngẫu nhiên, chỉ lưu SHA-256 của refresh token; refresh token và access token đều bị chặn bởi hạn tuyệt đối của phiên. `SessionOptions` mặc định 7 ngày cho refresh/phiên, cấu hình được kiểm tra trong khoảng 1–7 ngày; `JwtOptions` mặc định access token 30 phút, cấu hình cho phép 1–60 phút. Không tự gia hạn vô hạn phiên gốc.
- Response 200: `LoginResult` tại [LoginService.cs](../../src/backend/BHome.Application/IdentityAccess/LoginService.cs):5 gồm `userId`, `roles`, `accessToken`, `expiresAt`, `sessionId`, `refreshToken`, `sessionExpiresAt`. `refreshToken` nullable trong DTO vì web transport bỏ token khỏi body; native Mobile nhận chuỗi token.
- 401 dùng Problem Details với title `Session is unavailable.`; không trả token trong lỗi controller. Validation body do `[ApiController]` xử lý. Rate limit Auth ở controller có thể trả 429; exception đi qua middleware.

### 2.2. Logout

- Endpoint: `POST /api/v1/auth/logout`; Mobile gửi `{}`; controller không nhận DTO body.
- `AuthController.Logout` tại dòng 47–49 gọi helper `Revoke(false, ...)` tại dòng 99–104.
- Quyền `Permissions.Sessions.RevokeOwn`; [RolePermissions.cs](../../src/backend/BHome.Domain/IdentityAccess/RolePermissions.cs):17 cấp cho Owner, Staff, Tenant.
- Service `IdentitySessionService.RevokeAsync` tại dòng 82: transaction và khóa user; lấy phiên theo cả `sessionId` và `userId`, ghi `RevokedAt`/`RevocationReason`, audit và commit. `/logout` chỉ thu hồi phiên hiện tại; `/logout-all` là endpoint khác.
- Response **204 No Content**, không có JSON. Phiên không hợp lệ/hết hạn bị middleware từ chối 401 trước khi action chạy; thiếu quyền trả 403.
- Thu hồi có hiệu lực với cả access token cũ: [DependencyInjection.cs](../../src/backend/BHome.Infrastructure/DependencyInjection.cs):91, `OnTokenValidated`, gọi `IAuthenticationSessions.ValidateAsync` trên mỗi Bearer request. Không chỉ dựa vào JWT chưa hết hạn.

### 2.3. Change Password

- Endpoint: `POST /api/v1/auth/change-password`.
- `AuthController.ChangePassword` tại dòng 59–67, quyền `Permissions.Account.ChangePassword` cho cả ba role.
- DTO `ChangePasswordRequest` tại dòng 114–116: `currentPassword` bắt buộc, tối đa 1024 ký tự; `newPassword` bắt buộc, 12–1024 ký tự. Không có `confirmPassword` trong API, xác nhận chỉ thuộc UI.
- Service: [IdentityPasswordService.cs](../../src/backend/BHome.Infrastructure/IdentityAccess/IdentityPasswordService.cs):15, `ChangeAsync`. Khóa user trong transaction, kiểm tra eligibility và phiên hiện tại sau khi khóa, gọi `UserManager.ChangePasswordAsync` để kiểm tra mật khẩu hiện tại/chính sách mật khẩu. Thành công thu hồi **mọi phiên** và consume reset grants; audit rồi commit. Chính sách độ dài 12 được cấu hình tại `DependencyInjection.cs`:44–50; các password validator của Identity vẫn áp dụng.
- Sai mật khẩu/chính sách/phiên không còn hợp lệ ở bước service trả false → 400 Problem Details `Password change failed.`; validation DTO có thể trả 400 kèm `errors`. Access token không hợp lệ trả 401, thiếu quyền trả 403, rate limit có thể trả 429.
- Thành công trả **204 No Content** và xóa cookie nếu có. Mobile phải đăng nhập lại; backend không cấp phiên mới trong response đổi mật khẩu.

### 2.4. Current Session và persistence thực tế

- `GET /api/v1/auth/me` → `AuthController.Me`, dòng 55–57; quyền `Permissions.Account.ViewOwn`, cả ba role.
- Không có body; response `SessionIdentity`: `{ userId, sessionId, roles }`. Đây là định danh phiên, không phải hồ sơ full name/email/phone.
- `Me` đọc claim đã được middleware xác thực; `OnTokenValidated` gọi `IdentitySessionService.ValidateAsync`:100 và persistence. Vì vậy không phải action chỉ trả claim của JWT mà bỏ qua kiểm tra phiên.
- Runtime mặc định đăng ký `IIdentityPersistence → CompactIdentityPersistence` tại `DependencyInjection.cs`:109; không mặc định dùng legacy tables.
- [CompactIdentityPersistence.cs](../../src/backend/BHome.Infrastructure/Persistence/Compact24/CompactIdentityPersistence.cs):17 `LockUserAsync` dùng `SELECT ... FOR UPDATE`; :30 `RevokeAllAsync`; :33/35 `TokenOwnerAsync`/`TokenAsync`; :84 `ValidSessionAsync`; :91 `TouchSessionAsync`; :94 `CurrentSessionAsync`; :119 `SaveChangesAsync` lưu session/token và audit. Session/token nằm trong `refresh_tokens` phân biệt `RecordKind`.
- Kiểm tra JWT: chữ ký/issuer/audience/lifetime, thuật toán HS256 và clock skew 30 giây tại `DependencyInjection.cs`:66–103. `JwtTokenIssuer.Issue` tại [JwtTokenIssuer.cs](../../src/backend/BHome.Infrastructure/IdentityAccess/JwtTokenIssuer.cs):13 chặn access expiry theo session deadline.

## 3. Mobile: trace đầy đủ và checklist

### 3.1. Refresh Token

Luồng request đang đăng nhập:

1. Screen/hook dùng `useSession().api`, ví dụ `TenantProfileScreen → useWorkspaceQuery('/api/v1/auth/me')`, [TenantProfileScreen.tsx](../../src/mobile/src/screens/TenantProfileScreen.tsx):10 và [useWorkspaceQuery.ts](../../src/mobile/src/features/workspace/useWorkspaceQuery.ts):7.
2. `MobileApi.request`, [api.ts](../../src/mobile/src/lib/api.ts):203, gắn `Authorization: Bearer <accessToken>` tại dòng 218–219, gửi qua `mobileResponse`:42.
3. HTTP 401 và có access token ban đầu → `MobileApi.request`:264–268 dùng token đã thay đổi bởi request khác hoặc gọi callback refresh.
4. Callback được tạo bởi `MobileSessions.api`, [sessions.ts](../../src/mobile/src/lib/sessions.ts):76–86 → `MobileSessions.refresh`:159.
5. `refresh` dùng `refreshTask` chung để gộp lời gọi đồng thời, probe `/health/ready`, rồi `auth(base, 'refresh', { refreshToken: previous })` → `mobileResponse` → HTTP POST → `AuthController.Refresh` → `IdentitySessionService.RefreshAsync` → `CompactIdentityPersistence` → response `LoginResult`.
6. Mobile kiểm tra userId/token/roles trong `MobileSessions.auth`:88–119, lưu refresh token mới qua `persist`:54 trước khi publish access token, cập nhật credential/session tại :182–193.
7. `MobileApi.request` thay Bearer và gửi lại request ban đầu một lượt sau refresh. Không có vòng đệ quy refresh. Nếu lần gửi lại vẫn 401, callback `expired` gọi `clear`; workspace chuyển về Login do mất role/session.

Luồng mở app: `RootLayout` [\_layout.tsx](../../src/mobile/src/app/_layout.tsx):35 → `SessionProvider`:12,29 → `manager.restore()` → đọc credential → `refresh()` như trên. `restoreTask` gộp restore trùng; epoch chặn kết quả refresh cũ làm sống lại phiên sau clear/logout. `SessionProvider` tại [SessionProvider.tsx](../../src/mobile/src/lib/SessionProvider.tsx):33–43 reconnect khi app active và mỗi 5 giây **chỉ khi đang chờ kết nối**, không phải refresh token mỗi 5 giây.

- ✅ Có service refresh; tự gọi khi restore và 401, cập nhật access/refresh token, retry request.
- ✅ Native dùng `SecureStore.getItemAsync/setItemAsync/deleteItemAsync`, `WHEN_UNLOCKED_THIS_DEVICE_ONLY`: [credentialStore.ts](../../src/mobile/src/lib/credentialStore.ts):7–28. Chỉ persist `{ base, refreshToken, serverId }`; access token không persist. Web preview/runtime dùng bộ nhớ, không localStorage/AsyncStorage.
- ✅ Invalid/revoked/expired refresh trả lỗi thì `refresh` gọi clear; memory mất session/API, xóa credential được **thử thực hiện**, UI route guard chuyển Login. Lỗi xóa credential là ngoại lệ ở finding F1.
- ✅ Không refresh đệ quy; một refresh promise cho nhiều request. Các GET có thể retry thêm một lần cho lỗi mạng theo `MobileApi.request`:228–258; POST không retry lỗi mạng không rõ kết quả.
- ✅ Nếu readiness probe thất bại trước khi gửi refresh, giữ credential để reconnect; nếu đã gửi refresh rồi gặp lỗi mơ hồ, clear thay vì gửi lại rotating token cũ. Không coi lỗi mạng trước probe là refresh token hết hạn.
- ⚠️ Client `Session` tại `api.ts`:3 chỉ khai báo bốn trường cốt lõi; chưa dùng `expiresAt/sessionExpiresAt/sessionId`. Không có proactive refresh trước expiry; đây là giới hạn thiết kế, không tự coi là lỗi của cơ chế 401.
- ❓ Chưa chạy trực tiếp Mobile → API → Compact24; không kết luận runtime E2E PASS.

### 3.2. Logout

Luồng chính:

1. Owner/Staff: `Profile` trong [SharedScreens.tsx](../../src/mobile/src/screens/SharedScreens.tsx):23, nút :173 và handler xác nhận :195–213. Tenant: `TenantProfileScreen`, nút :47 và handler :60–78. UI hỏi xác nhận trước logout.
2. `useSession().logout` → `SessionProvider` callback :51 → `MobileSessions.logout` tại `sessions.ts`:225–231.
3. `api.json('/api/v1/auth/logout', {})` → `MobileApi.json`:275 → `request`:203 → `mobileResponse`:42 → HTTP POST với Bearer → `AuthController.Logout` → `Revoke(false)` → `IdentitySessionService.RevokeAsync` → persistence transaction → 204.
4. `MobileApi.request`:222 trả `undefined` trước khi gọi `response.json()` cho 204.
5. `logout` có `finally { await this.clear(); }`: memory xóa `session`, `api`, refresh credential và trạng thái reconnect; queue lệnh xóa storage. UI `router.replace('/')`; [index.tsx](../../src/mobile/src/app/index.tsx):16 render Login khi không còn session.

- ✅ Có nút thật cho cả ba role và API thu hồi phiên thật, không chỉ đổi route.
- ✅ Xóa access/refresh khỏi memory, thử xóa persisted credential ngay cả khi request logout thất bại. Epoch ngăn refresh đang chạy revive phiên trong cùng manager.
- ✅ Luồng workspace thông thường không render dữ liệu khi mất role: `WorkspaceRoute` [\[screen\].tsx](../../src/mobile/src/app/workspace/%5Bscreen%5D.tsx):134–138; fragment key theo user/role/screen ở :245. `useWorkspaceQuery` gắn dữ liệu với API instance/path và abort request cũ.
- ⚠️ Không thể đảm bảo server đã revoke khi offline; local clear không thay thế server revocation. Lỗi server và lỗi xóa storage đang bị UI diễn giải chưa đủ chính xác, xem F1/F2.
- ⚠️ `/capture` có handler riêng và state cục bộ, chưa bảo đảm mọi dữ liệu người dùng được reset ở nhánh lỗi, xem F3.
- ⚠️ `Profile` có busy cho nút mở dialog nhưng confirmation handler không có lock đồng bộ; Tenant profile có `useRef` lock. Double-tap logout Owner/Staff chưa được bảo vệ chặt như đổi mật khẩu.
- ⚠️ Preview development có thể mở màn mẫu khi không đăng nhập. `WorkspaceProvider` cho phép preview qua `__DEV__`; đây không phải quyền truy cập backend. Preview state không được central clear trên logout, nên không khẳng định xóa toàn bộ state toàn ứng dụng.

### 3.3. Change Password

1. Profile Owner/Staff `go('security')` tại `SharedScreens.tsx`:132; Tenant tại `TenantProfileScreen.tsx`:38.
2. `WorkspaceRoute` case `security` tại :219–220 render `AccountSecurityScreen` trong luồng thật `preview=false`; route permission `navigation.ts`:44 cho cả ba role.
3. [AccountSecurityScreen.tsx](../../src/mobile/src/screens/AccountSecurityScreen.tsx):11 có ba input `current/password/confirm` (UI :65–97), đều `secureTextEntry`; AppState listener :19 xóa các ô khi app không active.
4. Handler `changePassword`:29 kiểm tra trường trống/xác nhận khớp, dùng `lock.current` và busy chặn submit trùng.
5. `api.json('/api/v1/auth/change-password', { currentPassword: current, newPassword: password })` tại :39 → `MobileApi.json/request/mobileResponse` → HTTP POST Bearer → `AuthController.ChangePassword` → `IdentityPasswordService.ChangeAsync` → `UserManager.ChangePasswordAsync` + thu hồi mọi phiên → 204.
6. Client `request`:222 xử lý 204 thành `undefined`; handler xóa ba input rồi gọi `logout` (:48). Cuối cùng `router.replace('/')` và toast yêu cầu đăng nhập lại (:52–53). Lỗi API đi qua `errorMessage` và hiển thị alert, không logout nếu API trả 400.

- ✅ UI/handler/service/endpoint có kết nối thật; body camelCase khớp DTO, không gửi confirmation thừa.
- ✅ 204 không parse JSON; local session được clear thông qua logout; redirect và yêu cầu reauthentication.
- ✅ Chặn submit trùng bằng ref lock, không chỉ state busy. Test có double-click.
- ⚠️ Chỉ validation trống/matching; chưa chặn độ dài <12/>1024 ở UI, chưa giải thích password policy. Backend vẫn enforce; không phải bypass bảo mật.
- ⚠️ `mobileResponse`:66–78 chỉ giữ `code/correlationId`, bỏ Problem Details `errors/title/detail`; `errorMessage`:178 trả thông báo 400 chung. Người dùng không biết sai mật khẩu hiện tại hay mật khẩu mới chưa đạt policy; không cần hiển thị raw exception để khắc phục.
- ⚠️ Gọi logout sau khi backend đã thu hồi mọi phiên dẫn tới request dư và có thể một lần refresh chắc chắn bị từ chối; xem F4. Vẫn có local clear và handler bắt lỗi logout, không kết luận đổi mật khẩu thất bại chỉ vì bước logout trả 401.

## 4. Findings và đề xuất theo ưu tiên

### F1 — P1: Logout có thể restore lại credential khi offline và SecureStore delete thất bại

**Nguồn:** `sessions.ts`:54–74,121–146,225–230; `credentialStore.ts`:27. `clear` xóa memory trước khi `persist(null)` hoàn tất. Storage lỗi làm promise reject nhưng không có trạng thái/tombstone chặn lần restore sau. Nếu request logout cũng không đến được server, refresh token cũ vẫn có thể hợp lệ. Handler Owner/Staff còn nói “Đã xóa phiên trên thiết bị” mà không phân biệt storage delete thất bại.

**Probe đã chạy:** transpile hai file `api.ts`/`sessions.ts` hiện có vào VM trong bộ nhớ, dùng toàn bộ giá trị synthetic, không tạo file test và không gọi mạng. Login giả lập → mạng offline → `store.remove()` reject → logout reject → restart manager với cùng storage, mạng được khôi phục. Kết quả: `clearedInMemory=true`, `persistedCredentialRemains=true`, `restoredOnRestart=true`. Đây là bằng chứng hành vi logic với fault injection, không chứng minh một thiết bị thật đang gặp lỗi SecureStore.

**Đề xuất:** phân biệt kết quả thu hồi server/xóa memory/xóa storage, thông báo đúng trạng thái, có cơ chế recovery/reauthentication để không tự restore credential chưa xóa khi logout chưa hoàn tất. Thiết kế cơ chế chặn restore phải được kiểm thử qua restart và cả lỗi kho lưu trữ; một flag chỉ trong RAM không giải quyết restart. Bổ sung test riêng cho offline + storage failure và logout server thành công + storage failure. Chưa sửa trong audit.

### F2 — P2: Thông báo logout chưa thu hồi server bị mất khi redirect

**Nguồn:** `SharedScreens.tsx`:205–209; `TenantProfileScreen.tsx`:69–73. Catch ghi error vào state màn Profile rồi luôn `router.replace('/')`; session clear cũng khiến guard rời Profile. Login không nhận trạng thái lỗi logout này.

**Tác động:** local logout vẫn diễn ra, nhưng người dùng có thể không thấy cảnh báo server revocation chưa xác nhận. Chưa tái hiện navigation/toast trên thiết bị thật.

**Đề xuất:** thông báo qua toast sống ngoài màn, hoặc truyền kết quả logout đến Login; không khẳng định persisted credential đã xóa khi xóa thất bại. Bổ sung test offline logout qua UI thật.

### F3 — P2: Màn `/capture` chưa bảo đảm reset state theo phiên khi logout lỗi

**Nguồn:** [capture.tsx](../../src/mobile/src/app/capture.tsx):17–30,40–54,61–93,182–193. `locations/residents/tasks/location` chỉ được reset sau `await logout()` thành công. Nếu logout reject, component vẫn sống, render form Login nhưng state cũ còn. `load` không có cancellation/epoch guard trước `setLocations/setTasks`, nên response cũ có thể ghi state sau logout. Trái với workspace chính, component này không có key theo user. File cache được `clearAbandonedCaptures` dọn lúc SessionProvider mount, không phải một bước của logout.

**Tác động:** chưa đủ cơ sở xác nhận tất cả user-specific state/cache được xóa sau logout; có nguy cơ dữ liệu cũ xuất hiện khi đăng nhập người dùng khác trên route còn mount. Đây là phân tích source, chưa tái hiện cross-account runtime; không kết luận đã có truy cập API trái quyền.

**Đề xuất:** reset/cancel theo identity thay đổi hoặc unmount màn theo phiên, dọn các file tạm thuộc người dùng nếu cần; test user A logout khi lỗi mạng/đang load rồi user B login. Audit này không đề xuất xóa thư viện ảnh người dùng.

### F4 — P2: Đổi mật khẩu thành công vẫn dùng authenticated logout/refresh

**Nguồn:** `AccountSecurityScreen.tsx`:46–51 → `MobileSessions.logout`:225 → `MobileApi.request`:264–268. Sau 204, backend đã revoke mọi session. Logout bằng access token cũ bị 401, client có thể probe readiness rồi thử refresh cùng session đã revoke, nhận 401 và clear. Đây là trace source, không phải capture HTTP từ app thật.

**Tác động:** thêm request, độ trễ/đợi timeout nếu mất mạng đúng lúc; local clear vẫn chạy và lỗi logout được handler bắt. Không phải refresh loop vô hạn.

**Đề xuất:** sau server-confirmed 204, gọi thao tác local clear chuyên biệt và xử lý storage failure rõ ràng; không refresh/revoke thêm phiên đã bị thu hồi. Bổ sung test dùng MobileSessions thật thay vì chỉ mock logout ở test màn đổi mật khẩu.

### F5 — P2: Validation mật khẩu và thông báo 400 chưa đủ hướng dẫn

**Nguồn:** `AccountSecurityScreen.tsx`:31–34; `AuthController.cs`:114–116; `api.ts`:66–78,178.

**Đề xuất:** đồng bộ giới hạn 12–1024 với backend, hướng dẫn policy thực tế, map lỗi validation an toàn theo trường. Không tự thay đổi chính sách backend và không hiển thị dữ liệu nhạy cảm trong diagnostic.

### F6 — P3: Logout Owner/Staff thiếu ref lock ở nút xác nhận

**Nguồn:** `SharedScreens.tsx`:194–213 so với Tenant profile :17,61 và change password :18,30,35.

**Đề xuất:** bảo vệ synchronous re-entry và disable nút xác nhận khi request chạy. Chưa tái hiện duplicate logout trên thiết bị; hậu quả phụ thuộc timing và cơ chế refresh gộp hiện có.

## 5. Security và compatibility

- **Token storage:** native refresh credential đi qua Expo SecureStore; access token chỉ ở memory. Web credential memory-only. Kiểm thử storage adapter mock qua, chưa xác minh Keychain/Keystore thật, backup/restore thiết bị hoặc quyền truy cập vật lý.
- **Token trong log:** không thấy lệnh log raw token/password trong mobile `api/sessions/credentialStore` và backend IdentityAccess đã rà. `IdentitySecurityStore.Audit`:25 chỉ lưu metadata sự kiện/user/session; `CompactIdentityPersistence.SaveChangesAsync`:142 serialize metadata, không raw token. Không kiểm tra được log reverse proxy/provider/deployment nên không khẳng định toàn hệ thống không có leak.
- **HTTP:** API base bắt buộc origin HTTPS không có credentials/path/query/hash tại `api.ts`:114; request dùng `credentials: 'omit'`, `cache: 'no-store'`, timeout 15 giây. `Program.cs`:37–44 đặt `Cache-Control: no-store` và `Pragma: no-cache` cho auth. Không dùng cookie web để truyền refresh token native.
- **DTO:** subset Session Mobile tương thích JSON native nhưng không khai báo expiry/session metadata; nullable refresh token của web không phải mismatch với transport native hiện tại. `auth` cố ý từ chối response không có refresh token/roles hợp lệ.
- **Authorization:** header Bearer được attach cho request nghiệp vụ; refresh được gửi anonymous bằng credential riêng. Cả role và persisted session được backend kiểm tra; FE role guard không thay backend.
- **Expiry/revocation:** JWT lifetime và persisted session đều được kiểm tra; backend xoay refresh và chống replay bằng transaction/user lock. Mất session/refresh thất bại dẫn tới Login trong workspace thông thường; preview development cần được phân biệt với phiên thật.
- **204:** `MobileApi.request`:222 return trước decode JSON, dùng chung cho logout và đổi mật khẩu. Shared `createApiClient` cũng hỗ trợ 204 nhưng **không phải transport xác thực chính của Mobile này**; `MobileSessions` mới là nguồn trace.
- **Retry:** một vòng refresh sau 401, không đệ quy. Không retry POST khi lỗi mạng không rõ kết quả. Không có bằng chứng redirect loop từ source/test đã chạy; chưa kiểm chứng tất cả navigation timing trên thiết bị.

## 6. Test coverage và bằng chứng thực thi trong lượt audit

### 6.1. Mobile — đã chạy, 6 file / 91 test thành công

```powershell
npm run test --workspace ./src/mobile -- ../../tests/mobile/ocr/sessions.test.ts ../../tests/mobile/ocr/sessionProvider.test.tsx ../../tests/mobile/ocr/credentialStore.test.ts ../../tests/mobile/ocr/api.test.ts ../../tests/mobile/ocr/liveWorkspace-ui.test.tsx src/__tests__/workspace-navigation.test.tsx
```

Exit code 0; Vitest: **6 passed**, **91 passed**, thời gian test 5.03 giây. 91 là tổng test trong các file chọn, có cả test UI nghiệp vụ khác; không phải 91 test chỉ riêng auth.

- `tests/mobile/ocr/sessions.test.ts`:22 login contract; :60 reject HTTP; :70 coalesced restore/persist credential; :86 lỗi refresh mơ hồ và binding server; :110 refresh không revive sau clear; :134/:147 binding server identity; :165 giữ credential khi probe fail; :194 clear trong lúc probe. Tên test cuối có “logout” nhưng thực tế gọi `manager.clear()`, không kiểm tra server logout.
- `tests/mobile/ocr/api.test.ts`:22 Bearer/no cookies; :43 401 → refresh → retry một lần và không retry POST lỗi mạng/conflict.
- `tests/mobile/ocr/sessionProvider.test.tsx`:101 reconnect offline; :132 foreground/background/timer cleanup; :160 web login/logout qua manager thật với fetch giả, kiểm tra POST endpoint ở :210.
- `tests/mobile/ocr/credentialStore.test.ts`:29 web memory-only, native adapter đọc/ghi/xóa với device-only option; SecureStore là mock.
- `tests/mobile/ocr/liveWorkspace-ui.test.tsx`:1121 confirmation/400 không logout; :1141 xử lý 204, background clear và double submit; :1334 Tenant logout confirm/redirect. `logout` trong các test màn này là mock, không chứng minh revoke backend hoặc extra refresh sau đổi mật khẩu.
- `src/mobile/src/__tests__/workspace-navigation.test.tsx`: guard route/role, không phải nghiệm thu nút Back/restore trên Android/iOS thật.

### 6.2. Backend — đã chạy, 13 thành công / 10 bỏ qua

```powershell
dotnet test tests/backend/BHome.IntegrationTests/BHome.IntegrationTests.csproj --no-restore --filter 'FullyQualifiedName~SessionPolicyTests|FullyQualifiedName~JwtAuthenticationTests|FullyQualifiedName~Compact24AuthTests' -v minimal
```

Exit code 0; **Passed 13, Failed 0, Skipped 10, Total 23**; thời gian thực thi test khoảng 3 giây, không gồm build. Build project test thành công trong lệnh này.

- `SessionPolicyTests`:16/:29 kiểm tra giới hạn cấu hình/lifetime mặc định.
- `JwtAuthenticationTests`:23 issuer/expiry cap; :40 middleware revalidate session mỗi request; :64 từ chối JWT sai. Session port được thay bằng test double, **không chứng minh persistence revoke/rotate thật**.
- `Compact24AuthTests`:35/:78/:96/:110 và các case khác đều **SKIP**, vì chưa cấu hình `BHOME_COMPACT24_TEST_ADMIN`; điều kiện ở :18–24. Chúng chứa kiểm tra rotation/replay/concurrent refresh, logout-all/password-change HTTP contract, invalid session/role, nhưng không tính là đã xác minh runtime lượt này.
- `AuthenticationSecurityTests` có source test đầy đủ: `LogoutCurrentAndAllDevicesApplyCorrectScope`:247; `RefreshConcurrentWithLogoutCannotLeaveValidFamily`:375; `ChangePasswordVerifiesCurrentPasswordPolicyAndRevokesEverySession`:402 và các case refresh expiry/reuse khác. **Không chạy bộ Docker này**: `docker info --format '{{.ServerVersion}}'` exit 1 vì không kết nối được Docker Desktop Linux engine. Không dùng test cũ làm bằng chứng.

### 6.3. Probe bổ sung và giới hạn

Probe F1 dùng TypeScript transpile + VM trong bộ nhớ, storage/fetch synthetic, không thay source/test file, không gửi credential thật hoặc gọi API. Kết quả console chỉ gồm các boolean đã ghi tại F1.

Không chạy app trên Android/iOS, không kiểm thử manual với backend đang deploy, không capture response live, không kiểm thử database lifecycle auth thật. Các test tự động trên đạt **ở phạm vi được mô tả**, không cấp nhãn PASS toàn bộ FE–BE. Không chạy lại full suite/lint/typecheck vì không thay source; kết quả ở các lượt trước không được dùng làm bằng chứng audit này.

Khoảng trống ưu tiên: native SecureStore fail/restart; refresh 401/expiry với persistence thật; nhiều request 401 đồng thời dùng manager thật; logout đang refresh; offline logout và UI warning; logout user A/login user B khi response cũ đang về; password change + session manager thật; mất response sau password đã đổi; Back/deep-link sau logout trên thiết bị.

## 7. Trả lời trực tiếp

1. **Refresh Token có tồn tại và tự hoạt động trên Mobile không?** Có theo source và test giả lập: restore và HTTP 401 tự gọi refresh, cập nhật token, gộp refresh trùng, retry request. Chưa xác minh end-to-end trên thiết bị/database thật; không có proactive timer trước expiry.
2. **Logout có gọi backend thật không?** Có: `MobileSessions.logout → api.json → POST /api/v1/auth/logout`, backend thu hồi session hiện tại và trả 204. Khi offline chỉ có local clear được thử thực hiện; server revocation chưa xác nhận.
3. **Change Password có gọi backend và xử lý 204 đúng không?** Có: body `{ currentPassword, newPassword }` khớp DTO, client không parse JSON cho 204, rồi clear qua logout và yêu cầu login lại. Test UI 204 đã chạy; revoke mọi phiên với DB thật chưa chạy.
4. **Cả ba đã kết nối FE ↔ BE hoàn toàn chưa?** Đã có đủ dây nối source/service/endpoint; **chưa thể kết luận hoàn thiện/nghiệm thu toàn bộ** vì F1–F6 và thiếu runtime DB/device evidence.
5. **Cần bổ sung/sửa gì?** Ưu tiên xử lý storage-delete failure và ngăn auto-restore ngoài ý muốn; giữ thông báo logout qua navigation; reset/cancel state theo phiên ở `/capture`; local clear trực tiếp sau password change 204; đồng bộ validation/error mapping; chặn logout trùng. Sau đó chạy lại bộ auth integration trên database dùng riêng và manual trên Android/iOS. Audit này không triển khai các sửa đổi đó.
