# Authentication — final verification, 12/11/2026

## 1. Scope

Audit và sửa Authentication cho .NET API/Compact24 PostgreSQL, Owner Web, Mobile và luồng email hiện có. Nguồn: SRS v1.3 FE-02, UC-01/02/03/08/15, GBR-01/02/13/18; Report 4 Authentication/Authorization; nhiệm vụ 8 phase và các quyết định người dùng trong phiên này. Chi tiết trước/sau nằm trong [audit theo phase](AUTHENTICATION_AUDIT_2026-11-12.md).

[Test source, gid 1655824798](https://docs.google.com/spreadsheets/d/1rAzpBD-_e309XhPNB-Gt8wNw6Bn7cn1a/edit?gid=1655824798#gid=1655824798) được đọc bằng CSV export chỉ đọc. Không sửa sheet, Round 1, tester hoặc dữ liệu cá nhân. Kết quả dưới đây là thực thi mới trên synthetic fixtures; không chuyển kết quả SMTP cũ thành PASS mới.

Không thay quy tắc ký/thanh toán/kích hoạt hợp đồng, Staff assignment, invoice/payment, VNeID, SePay hoặc PUSH. Không migration/schema mới, không truy cập/chỉnh sửa Neon/live database, không push/merge.

## 2. Authentication policies

| Nội dung | Chính sách áp dụng |
| --- | --- |
| Login | Email hoặc phone; required/format dưới field; unknown/wrong/inactive dùng cùng generic 401 tiếng Việt |
| Phone | Canonical 0/+84; từ chối ambiguous identity, không rewrite toàn bộ dữ liệu cũ |
| Access / refresh | JWT 30 phút; refresh/session tối đa 7 ngày từ login, không gia hạn deadline; rotation, hash và reuse revocation |
| Profile | Giữ phiên; currentPassword bắt buộc khi đổi liên hệ; version và uniqueness được kiểm tra server |
| Email mới | Unconfirmed; hủy reset grant cũ; yêu cầu xác minh qua infrastructure hiện có |
| Phone mới | Unverified; không có SMS provider, không giả OTP |
| Change/reset password | Identity hash/policy hiện có; change không cho new=current; thành công revoke mọi phiên và yêu cầu đăng nhập lại |
| Recovery | EmailConfirmed prerequisite; generic 202, cooldown/token một lần/lifetime hiện có 15 phút |
| Staff | Không phát mật khẩu khởi tạo; pending setup từ lúc tạo, Owner gửi invitation qua action hiện có |
| Tenant | Quyết định của người dùng: mọi occupant có email Owner duyệt trong Main Contract đang kích hoạt; không cấp từ Holding/Resident đơn thuần |
| Linking | Reuse liên kết Tenant đã được duyệt và đúng email/role/active; không tự ghép bằng email trùng |
| Delivery | Queued/Sent là trạng thái queue/provider, không chứng minh thư đến inbox; retry/PendingReview giữ nguyên |

OQ-AUTH-01..03 trong sheet giữ nguyên lịch sử. Không đặt thêm lockout threshold hoặc provider policy; chính sách 30 phút/7 ngày, giữ phiên Profile, email prerequisite, revoke sau password và occupant provisioning được nhiệm vụ/quyết định người dùng xác nhận. Xem thêm [fixed session deadline](REFRESH_TOKEN_SESSIONS.md).

## 3. Audit findings

| Finding | Kết quả xử lý |
| --- | --- |
| UI gửi phone dưới field email; alias 0/+84 không thống nhất | Shared normalization/payload và server lookup an toàn |
| Lỗi required/format chung, credential message không nhất quán | Backend và hai client dùng cùng semantics tiếng Việt |
| Same-origin base rỗng không restore; lỗi tạm bị redirect Login | Restore/retry gate; bảo vệ dữ liệu trong lúc chưa xác định session |
| Development HTTP Web → HTTPS API làm cookie Strict khác site | Auth proxy cùng origin, giữ TLS verification bằng public localhost certificate |
| Đổi contact làm đổi stamp và UI logout | Current-password proof trong PUT; giữ stamp/session; reset verification flags |
| Thiếu Tenant first-profile gate/Staff assigned Locations trong Profile | Tái dùng profile form/query và scoped capture/locations |
| Web tự login sau change; backend cho password trùng | Interactive login sau change; chặn new=current |
| Staff dùng mật khẩu Owner nhập trước invitation | Unknown random credential + pending setup, bỏ input khởi tạo |
| AccountInvitationJob không chạy trong auth-only mode | Dùng ProcessAllowedAsync của worker hiện có, chỉ allow invitation |
| Owner chưa thấy kết quả invitation/setup | Projection Owner-only từ flags/audit/job/outbox, không token |

## 4. Changes by phase

| Phase | Thành phần/file tiêu biểu | Acceptance |
| --- | --- | --- |
| 1 | Audit, AuthenticationRouteAuditTests | Inventory route từ controller descriptors, baseline thực thi |
| 2 | LoginIdentifier, IdentityCredentialVerifier, AuthController, client-core/loginValidation, Web LoginForm/MobileLoginScreen | Field validation, phone aliases, generic failures |
| 3 | client-core/auth, routeGuards, Vite proxy, Prepare-OcrMobile, MobileSessions/SessionProvider, AuthenticationBrowserTests | F5/nested/new tab; cold start/offline/rotation |
| 4 | OperationsService/CompactOperationsRepository, Profile DTO/controller, Web AccountProfilePage, Mobile ProfileEditScreen/ProfileScreen/TenantProfileGate | Giữ hai session, proof, email verification, readonly scope |
| 5 | IdentityPasswordService, ChangePasswordDialog, AccountSecurityScreen | Negative password mutations; revoke current/other sessions |
| 6 | AccountInvitations, Staff create/repository/UI | Pending trước invite; cooldown/expiry/resend/one-use/active/scope |
| 7 | PostActivationTenantProvisioning, AccountInvitationJob, NotificationAutomationWorker, ResidentAdministrationRepository, TenantAccountStatus | Atomic Main provisioning; durable dispatch; visibility |
| 8 | Regression fixtures/tests, Test-Compact24Isolated.ps1, báo cáo này | Full client suites, relevant PostgreSQL/API/browser regression, unit/build |

Danh sách đầy đủ từng file nằm trong `git show --stat <phase hash>` ở mục 11; không có thay đổi ngoài Authentication và test harness liên quan.

## 5. API changes

Giữ nguyên routes Login/Refresh/Logout/Me/Session/Profile/Password/Verification/Invitation. Không thêm service, queue, table hay endpoint trùng.

- Login DTO: field errors tiếng Việt cho required/format/length; response 401 generic không phân biệt unknown, password sai hoặc inactive. Phone payload dùng field phone.
- `PUT /api/v1/account/profile`: thêm optional `currentPassword`, bắt buộc nếu email/phone thực sự thay đổi; wrong/missing proof trả 400; stale version/duplicate contact vẫn conflict. Không cho overpost userId/role/status/employment/assignment.
- `POST /api/v1/staff`: `initialPassword` nullable để client cũ vẫn bind, giá trị được bỏ qua; credential ngẫu nhiên không phát ra ngoài. Owner gửi invitation bằng endpoint cũ.
- `GET /api/v1/residents/{id}`: thêm nullable `account` với `isActive`, `emailConfirmed`, `invitationAcceptedAt`, `invitationDispatchState`, `jobState`, `deliveryState`. Giá trị lấy từ state/audit hiện có; không status enum mới. Chỉ Owner được đọc. List không tải account để tránh N+1.
- Password change giữ 204 thành công, 400 khi invalid; sau thành công JWT/refresh cũ không dùng được. Recovery/verification giữ generic public behavior và token isolation.

## 6. UI changes

Web/Mobile đăng nhập email hoặc phone, field errors riêng. Web khôi phục phiên trước protected routing; lỗi tạm có retry. Development dùng auth proxy cùng origin, production cần Web/API cùng site và scheme tương thích cookie Strict.

Profile lưu không logout. Đổi liên hệ yêu cầu mật khẩu hiện tại; email mới có request verification, phone chưa verified. Tenant Mobile hoàn tất name/phone trước Home bằng form hiện có; Staff thấy assigned Locations chỉ đọc. Đổi mật khẩu chuyển về đăng nhập, không tự login.

Staff Web bỏ mật khẩu khởi tạo. Tenant detail thể hiện pending/queued/processing/Sent/failure/PendingReview và acceptance evidence; có tải lại. Không tuyên bố “đã đến hộp thư” từ trạng thái queue/provider.

## 7. Security implications

Giữ Identity hashing, TLS verification, cookie Secure/HttpOnly/Strict, secure native storage, trusted callback validation, encrypted authentication outbox, hashed refresh/reset grants và per-request session/stamp/role validation. Không đưa token vào localStorage hoặc thêm SMS giả. Mật khẩu proof không được ghi history/audit hoặc response.

Pending setup tái dùng reset grant fields bằng hash ngẫu nhiên đã hết hạn: không có token dùng được, không chặn gửi invitation đầu tiên bằng cooldown. Invitation thật thay thế marker. Linked-unconfirmed Tenant phải setup và các session cũ bị thu hồi; established confirmed identity được reuse. Các workflow fixtures cho established accounts nay xác định rõ EmailConfirmed=true; pending setup có tests riêng.

Mobile network trước refresh giữ credential để retry. Với lỗi không xác định sau khi đã gửi rotating refresh, không replay token cũ: xóa credential, chỉ giữ access session còn hạn trong memory; đến hạn cần login lại. Cold start chưa có access session hợp lệ vẫn fail closed. Đây là giới hạn có chủ đích để giữ reuse defense.

SMTP lỗi không rollback committed account/Main Contract; job lease/retry và channel retry hiện có được dùng lại. Auth-only worker chỉ allow invitation handler, đã kiểm bằng một handler khác enabled nhưng không được thực thi.

## 8. Test cases and results

Thời gian: 12/11/2026, Windows, Node 22.23.4, .NET SDK 8.0.427, PostgreSQL 16 disposable Docker loopback. BHOME_GMAIL_SMOKE=0; fake email/provider boundary, ASP.NET + persistence thật. Browser acceptance: headless Edge + Vite + loopback API bridge + PostgreSQL thật, không mock fetch/routes. Native UI tests dùng DOM/component và secure-store/AppState mocks.

### Execution ledger

| Check | Kết quả mới | Evidence (ignored local artifacts) |
| --- | --- | --- |
| dotnet restore BHome.sln | Passed | .tmp/auth-completion-phase8-build.log |
| API Release build --no-restore | Passed, 0 warnings/errors | Cùng log build |
| Application unit tests | 451 passed, 0 failed/skipped | .tmp/auth-completion-phase8-unit/ + unit.log |
| Domain unit tests | 106 passed, 0 failed/skipped | .tmp/auth-completion-phase8-domain/ |
| Relevant integration + browser | 98 passed, 0 failed/skipped | .tmp/auth-completion-phase8-integration-verified/ |
| Expired reset + anonymous/public API, tracked harness Release | 2 passed, 0 failed/skipped; hai case rerun, không cộng là unique coverage | .tmp/auth-completion-phase8-expiry/ |
| Owner Web full Vitest | 360 passed / 71 files, 0 failed/skipped | .tmp/auth-completion-phase8-web-verified.log |
| Mobile full Vitest | 914 passed / 80 files, 0 failed/skipped | .tmp/auth-completion-phase8-mobile-verified.log |
| Typecheck/lint cả hai client | Passed | .tmp/auth-completion-phase8-client-checks.log |
| Owner Web production build | Passed; chunk-size warning | .tmp/auth-completion-phase8-web.log |
| git diff --check | Passed trước mỗi commit | Git command execution |
| Live Gmail SMTP / physical native device | Not Run | Không có ủy quyền SMTP smoke; không thiết bị |

Lượt regression đầu: Web 323 passed/37 failed do selector nhãn Email cũ làm demo login fixture thất bại; sửa selector và targeted router 37/37 passed. Mobile 913 passed/1 failed vì expectation cũ logout sau refresh 503; cập nhật theo policy mới và vẫn kiểm credential bị xóa, lỗi 503/correlationId và không replay. Integration 88 passed/6 failed trong contract fixture: actors chưa được đánh dấu established/confirmed, dẫn đến pending setup đúng policy khi activation; fixture được làm rõ, rerun 18/18 contract tests và lượt integration 98/98 passed. Không bỏ test hoặc hạ guard production.

### ITC-AUTH matrix

“Final” là kết quả automated API/component/browser theo phạm vi evidence, không phải lần nghiệm thu thủ công trên tài khoản thật hoặc physical device. Round 1 giữ nguyên nhãn `Fail`/`Pending` từ sheet.

| Test Case ID | Previous Result | Final Result | Verification Evidence | Notes |
| --- | --- | --- | --- | --- |
| ITC-AUTH-001 | Passed | Passed | AuthenticationBrowserTests, LoginService/Compact24LoginValidation | Owner email, browser/API thật |
| ITC-AUTH-002 | Passed | Passed | AuthenticationInvitationsQueueRoleSpecificLinks..., ScopedStaff, Contract ScopeRevocation | Staff chỉ assigned Locations |
| ITC-AUTH-003 | Passed | Passed | AnonymousSigningTests, Contract Scope, InvoiceFilters, RecipientInbox | Tenant own contract/invoice/inbox |
| ITC-AUTH-004 | Fail | Passed | DomesticAndInternationalPhoneAliases..., login-validation client tests | 0/+84, ambiguous fail closed |
| ITC-AUTH-005 | Passed | Passed | UnknownWrongPasswordAndInactiveAccounts... | Generic message |
| ITC-AUTH-006 | Fail | Passed | Cùng test generic + Web/Mobile validation | Không lộ registered identifier |
| ITC-AUTH-007 | Fail | Passed | Cùng test + LockoutInactiveTwoFactor... | Inactive cùng public failure |
| ITC-AUTH-008 | Fail | Passed | LoginReturnsSafeVietnameseFieldErrors + client login tests | Required/format/length dưới field |
| ITC-AUTH-009 | Passed | Passed | Identity hash, encrypted outbox, safe audit tests + code inspection | Không scan production logs; không sử dụng real passwords |
| ITC-AUTH-010 | Pending | Passed | AnonymousRequestsCannotReadProtected... | Protected 401, published catalog anonymous 200 |
| ITC-AUTH-011 | Passed | Passed | ProfileAuthenticationTests + client Profile tests | Own DTO, không credential |
| ITC-AUTH-012 | Fail | Passed | RotationRejectsReplay..., session lifecycle, revoked-session tests | Tách riêng F5 regression |
| ITC-AUTH-013 | Pending | Passed | LogoutOneDevice...ForgedOwnerRoleIsRejected | Forged JWT 401; role denial 403 |
| ITC-AUTH-014 | Passed | Passed | Session lifecycle + LogoutAllAndPasswordChange... | Logout current/all đúng phạm vi |
| ITC-AUTH-015 | Passed | Passed | LogoutOneDeviceLeavesTheOtherSessionActive... | A logout không revoke B |
| ITC-AUTH-016 | Passed | Passed | AccountProfilePage/profile-screens tests | Role/status readonly |
| ITC-AUTH-017 | Passed | Passed | ProfileContactChangeKeepsBothSessions..., profile UI/browser | Chính sách mới giữ phiên thay ghi chú cũ |
| ITC-AUTH-018 | Pending | Passed | Profile overposting + ScopedStaff/OwnerResidentAdministration + readonly UI | Không tự đổi role/status/assignment |
| ITC-AUTH-019 | Pending | Passed | tenant-profile-gate, profile-screens, backend Tenant phone required | Component/API; physical first-login E2E Not Run |
| ITC-AUTH-020 | Passed | Passed | ProfileRejectsWrongContactPasswordAndOverposting... + validateProfile | Không lưu required fields rỗng |
| ITC-AUTH-021 | Fail | Passed | LogoutAllAndPasswordChange..., ChangePasswordDialog/AccountSecurity | Old login fail/new login pass, current reauth |
| ITC-AUTH-022 | Fail | Passed | InvalidPasswordChangesLeaveBothSessions... | Wrong current không mutate hash/session |
| ITC-AUTH-023 | Fail | Passed | Cùng backend test + password client tests | Weak/empty/same/confirmation mismatch |
| ITC-AUTH-024 | Pending | Passed | EmailVerificationEnablesRecovery..., AuthenticationResetByEmail... | Fake delivery; live inbox Not Run |
| ITC-AUTH-025 | Pending | Passed | AuthenticationResetByEmailIsGenericDeduplicatedEncrypted... | Unknown generic 202, không outbox riêng |
| ITC-AUTH-026 | Pending | Passed | AuthenticationResetRetriesTransientSmtp... + one-use reset | API expired/reused đều 400, hash giữ nguyên khi rejected |

### New regressions

| ID | Final | Evidence |
| --- | --- | --- |
| AUTH-REG-F5 | Passed | Real browser nested reload + new tab, secure cookie rotation |
| AUTH-REG-COLD-START | Passed (automated) | Mobile sessions/SessionProvider tests; native physical Not Run |
| AUTH-REG-TOKEN-EXPIRY | Passed | Mutable clock JWT 30 min, fixed 7-day deadline |
| AUTH-REG-ROTATION-REUSE | Passed | DB token hashes, replay revokes family, parallel refresh one winner |
| AUTH-REG-CONCURRENT-401 | Passed | Web/Mobile refresh coalescing and retry bounds |
| AUTH-REG-PROFILE | Passed | Two backend sessions retained; browser save then F5; two client forms |
| AUTH-REG-EMAIL-CHANGE | Passed | New email unconfirmed, verification after historical invitation, old links rejected |
| AUTH-REG-STAFF-INVITATION | Passed | Before-invite denial, role-specific recipient, expire/resend/one-use, inactive denial |
| AUTH-REG-TENANT-ACTIVATION | Passed | Actual activation creates two approved occupant accounts, Holding/Resident no account |
| AUTH-REG-INVITATION-IDEMPOTENCY | Passed | Duplicate enqueue/activation/handler execution, single identity and dispatch |
| AUTH-REG-PASSWORD-REVOKE | Passed | Two sessions invalid after change/reset; wrong inputs retain them |
| AUTH-REG-EMAIL-RESET | Passed | Unconfirmed → verification → recovery, generic anonymous behavior |
| AUTH-REG-SMTP-FAILURE | Passed (fake provider) | Retry/suppression/PendingReview; active contract not rolled back |

### Reproduction

Use Node 22 in `.tools` for npm. Restore first. PostgreSQL tests must run sequentially when sharing build output; API build uses Release while Visual Studio may hold Debug DLLs.

```powershell
dotnet restore src/backend/BHome.sln
dotnet build src/backend/BHome.Api/BHome.Api.csproj -c Release --no-restore
dotnet test tests/backend/BHome.Application.UnitTests/BHome.Application.UnitTests.csproj -c Release --no-restore
dotnet test tests/backend/BHome.Domain.UnitTests/BHome.Domain.UnitTests.csproj -c Release --no-restore
$env:BHOME_GMAIL_SMOKE='0'
$env:BHOME_RUN_BROWSER_E2E='true'
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Test-Compact24Isolated.ps1 -Configuration Release -Filter 'FullyQualifiedName~Compact24AuthTests|FullyQualifiedName~Compact24LoginValidationTests|FullyQualifiedName~Compact24SessionLifecycleTests|FullyQualifiedName~Compact24NotificationMvpTests|FullyQualifiedName~Compact24JobTests|FullyQualifiedName~AnonymousSigningTests|FullyQualifiedName~PreAccountOnboardingTests|FullyQualifiedName~OwnerResidentAdministrationTests|FullyQualifiedName~AuthenticationBrowserTests|FullyQualifiedName~AuthenticationRouteAuditTests|FullyQualifiedName~Compact24ContractRegressionTests|FullyQualifiedName~Compact24InvoiceRegressionTests.InvoiceFilters|FullyQualifiedName~Compact24PaymentRegressionTests.RecipientInbox|FullyQualifiedName~Compact24PropertyRegressionTests.ScopedStaff'
npm.cmd run test --workspace src/owner-web -- --maxWorkers=2
npm.cmd run typecheck --workspace src/owner-web
npm.cmd run lint --workspace src/owner-web
npm.cmd run build --workspace src/owner-web
npm.cmd run test --workspace src/mobile -- --maxWorkers=2
npm.cmd run typecheck --workspace src/mobile
npm.cmd run lint --workspace src/mobile
```

Phases 1–7 dùng ignored copy của disposable harness với Release; Phase 8 thêm optional Configuration vào tracked script, giữ mặc định Debug để tương thích, và đã thực thi Release 2/2. Database/container test được tạo riêng, tự cleanup; không lấy live connection string. Browser runner tạo private ignored config/evidence, chỉ đưa boolean assertions vào báo cáo.

## 9. Remaining issues

- Chưa có SMS provider/phone ownership proof; số mới luôn unverified. Không tự thêm provider.
- Không chạy SMTP thật hoặc nghiệm thu thư trong Gmail trong nhiệm vụ này. Delivered/Sent từ fake provider không phải bằng chứng live inbox.
- Native deep link/cold start/hardware Back/iOS trust/layout cần kiểm trên thiết bị thật. Component/DOM PASS không thay thế physical E2E.
- Internal contract signing có sẵn khác yêu cầu external provider trong SRS. Authentication audit không sửa/phê duyệt lại signing design, signature/payment gates giữ nguyên; cần quyết định kiến trúc riêng nếu tiếp tục phạm vi này.
- OQ sheet không bị sửa; thresholds/provider/cadence khác chưa có quyết định mới thì giữ baseline.

## 10. Known environment limitations

Đã build/test API Release. API Visual Studio đang chạy Debug có thể vẫn nạp DLL cũ: dừng debugging, build rồi F5 để áp dụng; không khởi chạy API thứ hai. Không tự restart live API để tránh tự kích hoạt email backlog trên dữ liệu thật trong lượt kiểm thử.

Web development proxy kiểm TLS bằng public `.tools/mobile-tls/localhost.cer` xuất từ certificate localhost đã tin cậy; không bypass TLS/thay root store. Production cần HTTPS và site/cookie deployment đúng cấu hình. Browser loopback HTTP acceptance chứng minh cookie/route/session behavior trong test transport, không chứng minh TLS production.

Lần Phase 6 chạy hai build integration đồng thời bị DLL lock; rerun tuần tự passed. Initial full regression failures và các rerun được ghi ở mục 8. Legacy fixtures ngoài các filter nêu trên không được coi là đã xác minh trong lượt này. Không đo performance/coverage và không suy ra đạt toàn bộ NFR từ pass count. Web build có cảnh báo bundle chunk >500 kB, không thuộc authentication defect.

## 11. Git commit history

Nhánh `member/QHuy`, baseline `d7885f9`; không push/merge. Mỗi phase commit có description tiếng Anh ngắn gọn. Hash phase 8 là commit chứa báo cáo này (`git log -1` sau khi commit), được báo trực tiếp trong kết quả bàn giao.

| Phase | Status | Commit Hash | Commit Message | Tests thực thi trong phase |
| --- | --- | --- | --- | --- |
| 1 Audit | Completed | 40b5c84 | docs(auth): audit authentication workflows | 50 backend; 36 Web; 53 Mobile |
| 2 Validation | Completed | 79d26a5 | fix(auth): improve login validation and errors | 24 unit; 20 IT; 16 Web; 24 Mobile |
| 3 Session | Completed | e95f0d2 | fix(auth): stabilize session persistence | 13 backend/E2E; 40 Web; 23 Mobile |
| 4 Profile | Completed | 66db85c | fix(profile): preserve sessions on updates | 63 backend/E2E; 3 Web; 49 Mobile |
| 5 Password | Completed | acbd490 | fix(auth): harden password workflows | 52 backend; 36 Web; 13 Mobile |
| 6 Staff Invitation | Completed | 4e48db5 | fix(auth): complete staff invitations | 41 backend + 1 targeted rerun; 7 Web |
| 7 Tenant Provisioning | Completed | 403bce3 | fix(onboarding): align tenant provisioning | 49 backend; 26 Web |
| 8 Regression | Completed | Current report commit | test(auth): complete regression verification | 557 unit; 98 IT/E2E + 2 rerun; 360 Web; 914 Mobile |
