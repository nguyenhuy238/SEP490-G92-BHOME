# Kiểm toán Authentication / Authorization — 28/10/2026

## Nguồn và phạm vi

Đã đọc bản gốc `docs/reports/BHome_Report-3_Software Requirement Specification (2).docx`
(FE-02 §2.1–2.3, UC-01/02/03/08, GBR-01/02/13, NFR Security/Privacy) và
`Report-4_Software Design Specification (5).docx` (§3.6–3.8, Security Design §1.1–1.2).
Giữ Identity GUID và role `Owner`/`Staff`/`Tenant` đang hoạt động; không thay bằng BIGINT hay
role viết hoa trong bảng thiết kế. Guest không phải role. Các BF nghiệp vụ dùng chung GBR-02;
không bổ sung bảng Location/Contract/Invoice chỉ để tạo kiểm thử phân quyền giả.

Git ban đầu sạch, nhánh `init/project-setup/QHuy`. Không chuyển nhánh/commit/push.
`.env` được bỏ qua bởi Git, không được track; chỉ kiểm tra tên biến, không xuất giá trị.

## Hiện trạng trước thay đổi

| Tính năng                       | Trạng thái / nguồn mã                                                       | Rủi ro có bằng chứng                                                                  | Hành động                                                                              |
| ------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Login / hashing / lockout       | Có: `LoginService`, `IdentityCredentialVerifier`, `DependencyInjection`     | MEDIUM: chưa giới hạn tần suất theo nguồn; không có trạng thái deactivated            | Giữ Identity, thêm giới hạn và trạng thái                                              |
| JWT                             | Có: `JwtTokenIssuer`, `JwtOptions`, JWT bearer options                      | HIGH: không kiểm tra security stamp, session hoặc role hiện tại sau phát hành         | Thêm sid/sstamp và kiểm tra DB mỗi request                                             |
| Refresh / rotation / reuse      | Chưa có: không entity/service/endpoint trong cây mã                         | HIGH: không có vòng đời credential theo thiết kế                                      | Lưu hash, family theo session, xoay vòng giao dịch                                     |
| Logout / logout-all / sessions  | Chưa có; `FoundationController` chỉ trả userId                              | HIGH: token đã cấp sống tới hết hạn dù đăng xuất/đổi quyền                            | Thu hồi phiên và kiểm tra trên API                                                     |
| Change/reset password           | Chưa có API/service; Identity hashing đã có                                 | MEDIUM: chưa có quy trình thu hồi sau đổi mật khẩu                                    | Dùng UserManager, token reset một lần, không giả gửi email                             |
| Account activation/deactivation | `ApplicationUser` chỉ kế thừa IdentityUser                                  | HIGH: không thể biểu diễn deactivated ngoài lockout                                   | Cờ active tương thích dữ liệu cũ; kiểm tra mọi request; provisioning thuộc UC-08/15    |
| RBAC / default deny             | Có: `ApiFoundation` fallback, policy role                                   | Giữ; role trong JWT có thể cũ                                                         | Đối chiếu role hiện tại với DB                                                         |
| Staff Location                  | `UnconfiguredStaffLocationAccess` luôn false                                | Thiếu capability, hiện không có lỗ hổng cho phép: không có Location/assignment entity | Giữ fail closed, không tạo thẩm quyền giả                                              |
| Owner/Tenant isolation          | `ResourceAccess` + unit tests; không có resource endpoint nghiệp vụ         | Chưa chứng minh isolation trên bảng nghiệp vụ chưa có                                 | Giữ kiểm tra role + scope do server truy vấn; ghi giới hạn                             |
| Audit                           | Chưa có security audit entity/service                                       | MEDIUM: thiếu chứng cứ vòng đời bảo mật                                               | Audit riêng, append-only, không token/password/CCCD                                    |
| OTP/MFA                         | `IdentityCredentialVerifier` từ chối account bật 2FA                        | Chưa có challenge/delivery; không bypass 2FA                                          | Giữ từ chối, đề xuất step-up cho Owner                                                 |
| Frontend                        | `client-core/auth.tsx` memory only; mobile là Capacitor, không React Native | LOW: không có login/refresh/logout UI; không lưu token không an toàn                  | Tích hợp web cookie và mobile memory; secure native persistence chờ adapter được duyệt |
| Public                          | Không có API Location/Room public; frontend thông tin tĩnh                  | Không chứng minh luồng publish chưa tồn tại                                           | Không mở endpoint nội bộ anonymous                                                     |

Không tìm thấy bằng chứng cho finding CRITICAL trong phạm vi mã hiện có.

## Quyết định tương thích và tiêu chí chấp nhận

- Giữ `userName` và role contract đang dùng. SRS mô tả email/phone; chuyển định danh và provisioning
  cần luồng UC-08/15, không tự diễn giải số điện thoại hoặc tạo đăng ký công khai.
- Giữ lifetime JWT **15 phút đang được cấu hình** (`appsettings.json`, `JwtOptions`), dù Report 4
  ghi mặc định 30 phút có thể cấu hình. Không coi đây là thay đổi nghiệp vụ mới; cho phép 1–60 phút.
- Login hợp lệ tạo session UTC có hạn tuyệt đối; không có Location/PII trong JWT. Sai/khóa/inactive/2FA
  chưa hỗ trợ cùng lỗi 401; input sai 400, giới hạn 429; cancellation không cấp credential.
- Refresh có >=256 bit entropy, DB chỉ hash; phiên thiết bị độc lập; khóa hàng user trong PostgreSQL
  tuần tự hóa tạo/xoay/thu hồi/đổi mật khẩu. Một token chỉ được dùng thành công một lần.
  Dùng lại token đã tiêu thụ thu hồi family. Client gom refresh cùng phiên vào một promise;
  server cố ý fail closed khi gặp reuse, kể cả client khác không tuân thủ.
- JWT phải có session/stamp và roles khớp hiện tại. Logout, hết hạn tuyệt đối, deactivation,
  đổi password/stamp hoặc role làm request tiếp theo bị từ chối; không cache quyền.
- Đổi/reset password và thu hồi tất cả phiên cùng giao dịch. Reset có TTL cấu hình, chỉ token mới
  nhất dùng một lần; endpoint forgot không trả token. Chưa có delivery thật: báo unavailable đồng nhất.
- Web refresh cookie HttpOnly/Secure/Strict, path auth; kiểm tra Origin và custom header chống CSRF.
  Mobile bearer refresh không cookie, chỉ memory cho tới khi có native secure-storage adapter.
- Audit lưu actor/session/event/time/result, không lưu định danh đăng nhập nhập vào hoặc credential.
  Không tự quyết thời gian xóa audit/PII khi retention policy chưa được phê duyệt.

## Baseline

`dotnet restore src/backend/BHome.sln`: PASS. `dotnet build src/backend/BHome.sln --no-restore`:
PASS, 0 warning/error. `dotnet test ... --no-build --filter 'Category!=Docker'`: 45 PASS.
Docker ban đầu chưa chạy; khởi động Docker Desktop ẩn để dùng PostgreSQL container dùng một lần.
Lệnh frontend đầu tiên không chạy do PowerShell execution policy/PATH; dùng Node trong `.tools`
và `npm.cmd`, không thay policy máy. Kết quả Docker/frontend và sau triển khai được ghi bổ sung bên dưới.

## Thiết kế thay đổi

`AuthController` → `LoginService` / application ports → Identity services → `BHomeDbContext`.
Giữ `GET /api/v1/session` và JSON login cũ, thêm trường session/refresh. Web lựa chọn cookie bằng
header tường minh; không cho cookie thành access-token authentication scheme. Migration bổ sung
user active, sessions, refresh hashes, reset grants và security audit; không xóa dữ liệu cũ.
JWT trước triển khai không có session sẽ bị từ chối: cần đăng nhập lại, công bố khi deploy.
Migration chỉ áp dụng lên database test dùng một lần trong phiên làm việc này.

## Kết quả triển khai và trạng thái cuối

Cập nhật cấu hình sau audit: người dùng chọn PostgreSQL native local qua pgAdmin 4. Đã xác minh
`localhost:5432`, `bhome`, `postgres`, PostgreSQL 18.6; đồng bộ connection trong các file ignored
`.env`/`.env.local`, giữ JWT/storage và `.env.compose`. Đã backup local database vào ignored `.tools`
rồi áp dụng migration auth: 2 migration, 13 bảng, các cột/trigger đầy đủ, 0 application users.
Live HTTPS readiness/liveness 200, protected anonymous 401 và login validation 400; host test đã dừng.
Các nhận xét bên dưới về việc chưa migrate local mô tả thời điểm audit trước lựa chọn này.
Automated suite 101 tests vẫn là kết quả trên PostgreSQL 16; không suy ra toàn bộ suite đã chạy trên 18.6.

| Tính năng                | Trước → sau                                                                                                       | Trạng thái                                                |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| JWT                      | Chữ ký/expiry → sid/stamp, kiểm tra account/session/current roles mỗi request                                     | COMPLETED AND TESTED                                      |
| Refresh                  | Chưa có → random 256 bit, SHA-256, rotation giao dịch, reuse thu hồi family                                       | COMPLETED AND TESTED                                      |
| Sessions                 | Chưa có → nhiều thiết bị, absolute expiry, last activity, logout/all, revocation khi đổi credentials/account/role | COMPLETED AND TESTED                                      |
| Password                 | Identity hash/lockout → thêm change và core reset latest/single-use/TTL                                           | Change COMPLETED AND TESTED; delivery BLOCKED             |
| RBAC                     | Fallback/role policies → giữ và đối chiếu role hiện tại                                                           | COMPLETED AND TESTED cho API hiện có                      |
| Staff Location           | Always deny → vẫn fail closed, chưa có Location/assignment model                                                  | PARTIALLY COMPLETED / BLOCKED                             |
| Owner/Tenant isolation   | Scope helper → giữ, thêm cancellation; chưa có bảng tài nguyên nghiệp vụ                                          | PARTIALLY COMPLETED, chưa có E2E nghiệp vụ                |
| Audit                    | Chưa có → append-only EF/SQL, events/actor/target/session/time/result                                             | COMPLETED AND TESTED cho thao tác hiện có                 |
| Frontend                 | Shell → login/logout/all/change, refresh coalescing và Bearer retry                                               | IMPLEMENTED BUT NOT FULLY TESTED trên browser/native thật |
| MFA / native persistence | Chưa có → không bypass 2FA, mobile memory only                                                                    | BLOCKED / REQUIRES MANUAL ACTION                          |

Account deactivation, đổi security stamp/2FA và thay đổi role thu hồi sessions trong DB transaction.
Reactivation/thêm lại role không hồi sinh token. Các thao tác Identity/SQL trực tiếp ghi targetUserId
và actor userId=null: chưa có workflow quản trị để biết actor/reason nên không gán người thực hiện giả.
UC-08 cần bổ sung actor/reason khi triển khai workflow. Session ID đồng thời là token family ID.

### Database, tương thích và triển khai

Migration **20261028051723_AuthenticationSessions** thêm:

- AspNetUsers.IsActive mặc định true cho dữ liệu cũ; đã test tạo mới false không bị default ghi đè.
- AuthenticationSessions: FK user restrict, index (UserId,RevokedAt), device label không tin cậy,
  security stamp, UTC created/activity/absolute expiry, revoked timestamp/reason.
- RefreshTokens: unique hash, FK session và replacement restrict, created/expiry/consumed timestamp.
  Revocation nằm ở family/session; không sao chép cờ lên từng token.
- PasswordResetGrants: một grant mới nhất/user, unique hash, expiry/consumed, FK restrict.
- SecurityAudit: actor/target/session/event/result/time, index actor/time; không token, password,
  username/email do người dùng nhập, IP thô hay CCCD. EF guard + trigger chặn UPDATE/DELETE/TRUNCATE.
- Triggers cho account/role; role trigger khóa user trước khi cập nhật sessions để thống nhất thứ tự
  khóa với refresh/password/logout. DB superuser có thể tắt trigger; đây không phải bảo vệ trước DBA.

Đã test upgrade từ initial migration có user tổng hợp, giữ nguyên hash, default active đúng; downgrade
trên database test chỉ gỡ phần bổ sung và giữ user cũ. Không có plaintext refresh token cũ cần chuyển.
Metadata PostgreSQL local được đọc bằng SELECT: 9 bảng gồm Identity, BackgroundJobs và migration history.
Không chạy migration mới lên database local của người dùng/production/môi trường chưa rõ.
JWT trước triển khai không có sid/stamp cần đăng nhập lại. Downgrade xóa dữ liệu auth mới nên rollback
thực tế cần backup/archival được duyệt. Original Report 3/4 và .env giữ nguyên.

API giữ POST login và GET /api/v1/session. Thêm refresh/logout/logout-all/me/change-password/
forgot-password/reset-password trong cùng AuthController. Các trường login cũ giữ nguyên; thêm
sessionId, refreshToken, sessionExpiresAt. Không có đăng ký công khai hoặc admin endpoint không scope.
Chi tiết JSON, policies, HTTP codes và cookie transport tại
[API conventions](../api/API_CONVENTIONS.md#sessions-refresh-and-credentials).

| Biến trong .env.example                    | Mặc định / hành động                                              |
| ------------------------------------------ | ----------------------------------------------------------------- |
| Jwt__LifetimeMinutes                       | 15, giữ cấu hình repo; 1–60                                       |
| Sessions__RefreshTokenDays                 | 7; 1–30                                                           |
| Sessions__AbsoluteLifetimeDays             | 7; 1–30; refresh không kéo dài                                    |
| Sessions__PasswordResetMinutes             | 15; 1–60                                                          |
| AuthRateLimit__PermitLimit / WindowSeconds | 30 / 60, validation startup                                       |
| AuthWeb__AllowedOrigins__0                 | Exact Owner Web origin, riêng với CORS; không thêm Public Website |

JWT key vẫn lấy qua secret manager/environment >=32 byte. Nạp cấu hình bằng cơ chế launcher/user-secrets
hiện có; dotnet run không tự đọc .env. Web auth POST dùng X-BHome-Client:web và credentials:include;
refreshToken=null trong JSON. Cookie __Secure-bhome-refresh là HttpOnly/Secure/Strict/host-only,
path /api/v1/auth; custom header và exact Origin là CSRF boundary. Cần cả CORS và AuthWeb origins.
General CORS origins không tự được phép dùng auth cookie. Cookie không xác thực protected API;
protected API chỉ dùng Bearer. Web cần HTTPS và cùng site; HTTP frontend + HTTPS API local mặc định
không phải topology đảm bảo Strict-cookie. Dùng frontend HTTPS hoặc reverse proxy cùng origin;
không tự hạ Secure/Strict. Mobile dùng JSON refresh/credentials:omit và memory only.

Áp dụng migration chỉ sau khi xác nhận database đích và backup; ConnectionStrings__Database phải được
nạp an toàn cho đúng môi trường, không chép credential vào báo cáo:

```powershell
dotnet tool restore
dotnet ef database update --project src/backend/BHome.Infrastructure --startup-project src/backend/BHome.Api
```

Không tự migrate/seed users. Forgot-password hiện trả 503 đồng nhất trước account lookup vì delivery
chưa có. Bật thật cần triển khai IPasswordResetDelivery, xác minh địa chỉ nhận, thiết kế retry/outage
không lộ account, bảo vệ/chia sẻ Data Protection key ring giữa replica/restart và test provider thật.
Capturing adapter trong tests chỉ giữ token tổng hợp trong memory; không phải tích hợp email.
Không tự đặt retention 180 ngày; archival audit/identity cần policy dự án. MFA/step-up Owner còn mở;
account bật 2FA vẫn bị từ chối tới khi có challenge flow được hỗ trợ.

### Kiểm tra đã chạy

| Lệnh / kiểm tra                                                                                                                                                     | Kết quả cuối                        | Giới hạn                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------- |
| dotnet restore src/backend/BHome.sln                                                                                                                                | PASS                                | 7 projects                                                                  |
| dotnet build src/backend/BHome.sln --no-incremental --no-restore                                                                                                    | PASS, 0 warning/error               | Rebuild cưỡng bức tránh timestamp cache khi host clock đổi                  |
| dotnet test src/backend/BHome.sln --no-build --logger 'console;verbosity=minimal'                                                                                   | **101 PASS, 0 FAIL, 0 SKIP**        | Domain 1, Application 26, Integration 74; PostgreSQL 16 containers thật     |
| dotnet format src/backend/BHome.sln --verify-no-changes --no-restore --include (changed .cs)                                                                        | PASS                                | Chỉ file C# trong thay đổi                                                  |
| dotnet ef migrations has-pending-model-changes --no-build --project src/backend/BHome.Infrastructure --startup-project src/backend/BHome.Api                        | PASS, no drift                      | Design-time dummy connection, không update DB                               |
| dotnet ef migrations script --no-build --project src/backend/BHome.Infrastructure --startup-project src/backend/BHome.Api --output .tools/auth-audit/migrations.sql | PASS                                | Sinh script, không chạy lên DB người dùng                                   |
| dotnet list src/backend/BHome.sln package --vulnerable --include-transitive                                                                                         | Không advisory được nguồn NuGet báo | Không thay thế kiểm toán mã                                                 |
| npm.cmd run lint                                                                                                                                                    | PASS                                | Node 22 trong .tools; không thay execution policy máy                       |
| npm.cmd test                                                                                                                                                        | **23 PASS, 0 FAIL, 0 SKIP**         | Owner/shared 16, Mobile 4, Public 3; jsdom                                  |
| VITE_API_BASE_URL=https://localhost:7240; npm.cmd run build                                                                                                         | PASS                                | Strict TypeScript + 3 Vite builds, warning Owner bundle >500 kB còn tồn tại |
| npm.cmd audit --omit=dev                                                                                                                                            | Nguồn npm báo 0 vulnerabilities     | Production dependencies theo lockfile                                       |
| Prettier changed TS/TSX/JSON/Markdown; git diff --check                                                                                                             | PASS                                | Không format file ngoài phạm vi                                             |

Regression: login/claims/role tampering, wrong signature/issuer/audience/algorithm/expiry, subject/
session giả/thiếu sid, hash/rotation/reuse, parallel refresh, refresh cạnh tranh logout/role removal,
session/token expiry, inactive/locked/role/stamp/2FA, reactivation không phục hồi token, current/all
devices, change password sai/yếu/đúng, reset TTL/wrong owner/malformed/latest/single-use đồng thời,
confirmed-email/unknown/generic unavailable, cancellation, rollback khi audit insert lỗi, append-only
SQL, cookie/Origin/header, source rate limit bỏ qua forwarded header không tin cậy, migration preserve.
Frontend test cookie transport/no browser credential storage, single-flight refresh, one retry,
stale response sau clear, outage, expired-access logout, Web Locks branch và Vietnamese login/logout.
Public boundary tests cũ vẫn PASS. Không dùng số liệu template làm kết quả.

Lỗi trung gian được sửa: test expiry phát hiện chênh dưới một microsecond do precision PostgreSQL;
chuẩn hóa created time trước trả session. Migration scaffold lại trước rollout sau rebuild cưỡng bức
vì đồng hồ host làm incremental build bỏ qua source mới. Chỉ migration cuối kể trên được giữ và test.

### Rủi ro và phần chưa xác minh

- BLOCKED: Staff Location persistence, Owner/Tenant resource E2E cần Location/Chain/Contract/tenancy
  model chưa có. Không cấp quyền từ claim hoặc mock assignment để giả hoàn thiện.
- BLOCKED: email reset, OTP/MFA, provisioning/tenant activation và native Keychain/Keystore adapter.
- NOT RUN: browser HTTPS/cookie E2E thật, Android/iOS, load/p95/coverage, provider email/downtime,
  penetration test. Không tuyên bố production-ready hay tuân thủ toàn bộ BF.
- UserName thay vì tự diễn giải email/phone; role casing/15 phút giữ compatibility theo task.
  UC-08 actor/reason và retention policy còn thiếu. Native hiện là Capacitor, không phải React Native.
- Rate limit là per-process: nhiều replica cần limit chung ở ingress. Không cache quyền. Mỗi request
  bảo vệ đọc account/session/roles hiện tại; stateful service vẫn phải kiểm tra domain invariants riêng.
- Client serialize refresh trong phiên; Web Locks hỗ trợ đa tab trên browser có API này. Browser thiếu
  Web Locks chưa được chứng minh đa tab; server fail closed khi reuse, có thể cần login lại.
- Generic response không chứng minh constant-time. Delivery thật cần chống enumeration cả khi outage.
  Chưa tự động xóa audit/PII theo một retention policy không được phê duyệt.

## File thay đổi

Bổ sung khi rà cấu hình: `scripts/Start-Api.ps1` đã được sửa để nạp `Sessions`, `AuthRateLimit`
và `AuthWeb` từ file môi trường. Đã chạy launcher thật trong process PowerShell riêng với dữ liệu
tổng hợp và thay lệnh dotnet bằng hàm kiểm tra: tất cả biến auth mới/cũ được nạp, biến ngoài danh sách
không được nạp, kết quả PASS. Không khởi động API hoặc kết nối database trong kiểm tra này.

| File                                                                                                        | Thay đổi                                                                          |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `.env.example`                                                                                              | Mẫu TTL/rate limit/Owner cookie origin không secret                               |
| `docs/api/API_CONVENTIONS.md`                                                                               | Traceability, API/architecture/setup, audit và verification evidence              |
| `docs/architecture/ARCHITECTURE.md`                                                                         | Traceability, API/architecture/setup, audit và verification evidence              |
| `docs/development/AUTH_SECURITY_AUDIT.md`                                                                   | Traceability, API/architecture/setup, audit và verification evidence              |
| `docs/development/LOCAL_DEVELOPMENT.md`                                                                     | Traceability, API/architecture/setup, audit và verification evidence              |
| `docs/development/VALIDATION.md`                                                                            | Traceability, API/architecture/setup, audit và verification evidence              |
| `packages/client-core/src/api.ts`                                                                           | Một lần refresh/retry Bearer request                                              |
| `packages/client-core/src/auth.tsx`                                                                         | Auth context nối session client, web restore                                      |
| `packages/client-core/src/LoginPanel.tsx`                                                                   | Vietnamese login/logout/all/change-password UI                                    |
| `packages/client-core/src/sessionClient.ts`                                                                 | Memory credentials, cookie transport, coalesced refresh/retry/logout và Web Locks |
| `README.md`                                                                                                 | Traceability, API/architecture/setup, audit và verification evidence              |
| `src/backend/BHome.Api/appsettings.json`                                                                    | Non-secret validated defaults                                                     |
| `src/backend/BHome.Api/Configuration/ApiFoundation.cs`                                                      | Rate limiter, transport filter và explicit-origin credential CORS                 |
| `src/backend/BHome.Api/Controllers/IdentityAccess/AuthController.cs`                                        | Auth endpoints/DTOs và cookie versus mobile response mapping                      |
| `src/backend/BHome.Api/IdentityAccess/AuthRateLimitOptions.cs`                                              | Config source rate limit                                                          |
| `src/backend/BHome.Api/IdentityAccess/AuthTransportFilter.cs`                                               | Exact Origin/custom-header checks và secure cookie attributes                     |
| `src/backend/BHome.Api/Program.cs`                                                                          | Auth no-store/rate middleware và forbidden audit                                  |
| `src/backend/BHome.Application/IdentityAccess/IAccessTokenIssuer.cs`                                        | Issuer contract mang session/stamp/absolute expiry                                |
| `src/backend/BHome.Application/IdentityAccess/IAuthenticationSessions.cs`                                   | Application ports sessions/audit/password/reset delivery và DTO                   |
| `src/backend/BHome.Application/IdentityAccess/ICredentialVerifier.cs`                                       | Verified identity mang security stamp                                             |
| `src/backend/BHome.Application/IdentityAccess/LoginService.cs`                                              | Verify/validate roles, durable session creation và failed-login audit             |
| `src/backend/BHome.Application/IdentityAccess/ResourceAccess.cs`                                            | Giữ scope policy và cancellation                                                  |
| `src/backend/BHome.Infrastructure/DependencyInjection.cs`                                                   | DI, options validation, Identity token providers và JWT DB validation             |
| `src/backend/BHome.Infrastructure/IdentityAccess/AuthenticationRecords.cs`                                  | EF entities/configurations cho session, refresh hash, reset grant, audit          |
| `src/backend/BHome.Infrastructure/IdentityAccess/IdentityCredentialVerifier.cs`                             | Reject inactive và trả stamp đã xác minh                                          |
| `src/backend/BHome.Infrastructure/IdentityAccess/IdentityPasswordService.cs`                                | Real Identity change/reset, latest single-use grant, delivery unavailable         |
| `src/backend/BHome.Infrastructure/IdentityAccess/IdentitySecurityAudit.cs`                                  | Persist login failure và forbidden events                                         |
| `src/backend/BHome.Infrastructure/IdentityAccess/IdentitySecurityStore.cs`                                  | User-row locking, eligibility/roles, hash và revocation/audit helpers             |
| `src/backend/BHome.Infrastructure/IdentityAccess/IdentitySessionService.cs`                                 | Atomic rotation/reuse/logout, absolute expiry và live session validation          |
| `src/backend/BHome.Infrastructure/IdentityAccess/JwtTokenIssuer.cs`                                         | sid/sstamp claims, injectable UTC clock và session expiry cap                     |
| `src/backend/BHome.Infrastructure/IdentityAccess/SessionOptions.cs`                                         | Configurable lifetimes                                                            |
| `src/backend/BHome.Infrastructure/Persistence/ApplicationUser.cs`                                           | Account active flag                                                               |
| `src/backend/BHome.Infrastructure/Persistence/BHomeDbContext.cs`                                            | Auth DbSets/default active và append-only audit guard                             |
| `src/backend/BHome.Infrastructure/Persistence/Migrations/20261028051723_AuthenticationSessions.cs`          | Schema, triggers, EF generated metadata cho sessions/reset/audit                  |
| `src/backend/BHome.Infrastructure/Persistence/Migrations/20261028051723_AuthenticationSessions.Designer.cs` | Schema, triggers, EF generated metadata cho sessions/reset/audit                  |
| `src/backend/BHome.Infrastructure/Persistence/Migrations/BHomeDbContextModelSnapshot.cs`                    | Schema, triggers, EF generated metadata cho sessions/reset/audit                  |
| `src/mobile/src/api/useApi.ts`                                                                              | Dynamic token getter và shared refresh                                            |
| `src/mobile/src/app/App.tsx`                                                                                | Chọn API URL và web/mobile auth transport                                         |
| `src/mobile/src/routes/MobileRoutes.tsx`                                                                    | Đưa account UI vào client hiện có                                                 |
| `src/owner-web/src/api/useApi.ts`                                                                           | Dynamic token getter và shared refresh                                            |
| `src/owner-web/src/app/App.tsx`                                                                             | Chọn API URL và web/mobile auth transport                                         |
| `src/owner-web/src/features/home/HomePage.tsx`                                                              | Đưa account UI vào client hiện có                                                 |
| `tests/backend/BHome.Application.UnitTests/IdentityAccess/LoginServiceTests.cs`                             | Regression application login qua session port và cancellation                     |
| `tests/backend/BHome.Application.UnitTests/IdentityAccess/ResourceAccessTests.cs`                           | Regression scope/cancellation                                                     |
| `tests/backend/BHome.IntegrationTests/ApiFactory.cs`                                                        | Cấu hình host test với signing key tổng hợp và auth limit riêng test              |
| `tests/backend/BHome.IntegrationTests/ApiFoundationTests.cs`                                                | JWT cũ thiếu durable session bị từ chối                                           |
| `tests/backend/BHome.IntegrationTests/AuthenticationSecurityTests.cs`                                       | Regression PostgreSQL: JWT/session/password/concurrency/rollback/cookie/audit     |
| `tests/backend/BHome.IntegrationTests/LoginApiTests.cs`                                                     | Validation/error/cache/correlation và source rate limit                           |
| `tests/backend/BHome.IntegrationTests/PostgresAuthenticationTests.cs`                                       | Test real Identity login/roles/lockout/inactive                                   |
| `tests/backend/BHome.IntegrationTests/PostgresFoundationTests.cs`                                           | Test upgrade/downgrade bảo toàn Identity user và readiness/jobs                   |
| `tests/owner-web/LoginPanel.test.tsx`                                                                       | Regression shared session client, transport và UI                                 |
| `tests/owner-web/SessionClient.test.ts`                                                                     | Regression shared session client, transport và UI                                 |

Nguồn kỹ thuật đối chiếu: [Microsoft ASP.NET Core rate limiting](https://learn.microsoft.com/en-us/aspnet/core/performance/rate-limit?view=aspnetcore-8.0).
Kết quả chạy mã/test repo là chứng cứ triển khai; tài liệu tham khảo không thay thế test.
