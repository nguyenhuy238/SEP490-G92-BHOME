# Authentication audit — 12/11/2026

## Phạm vi, nguồn và chính sách đã xác nhận

Nhánh bắt đầu `member/QHuy`, working tree sạch, baseline `d7885f9`. Thực hiện tuần tự 8 phase, mỗi phase có commit và bằng chứng riêng. Không sửa database Neon/live, không chạy SMTP thật, không bật business automation.

Nguồn đã đọc: SRS v1.3 trong `docs/reports/BHome_Report-3_Software Requirement Specification.docx`, master UC-01 Sign In, UC-02 Sign Out, UC-03 Personal Profile; FE-02 phần Authentication/Personal Profile; UC-08 Staff, UC-15 bước 15–16; Report 4 §1.1 Authentication Flow/Token Design. Yêu cầu người dùng trong nhiệm vụ này xác nhận access token 30 phút, refresh/session 7 ngày; profile giữ phiên, email mới phải xác nhận; đổi mật khẩu thu hồi mọi phiên; giữ prerequisite EmailConfirmed trước recovery.

Chưa có file định nghĩa ITC-AUTH-001..026/Round 1 và OQ-AUTH-01..03 trong repository. Đã yêu cầu đường dẫn. Các mã dưới đây chỉ liên kết theo nhóm mà đề bài đã nêu, không tự đặt nội dung chi tiết hoặc kết quả Round 1. `docs/testing/...Login_Test_Execution_Guide.md` là UTC001..016 và có mô tả response cũ; không dùng các PASS có sẵn làm bằng chứng mới.

## Kết quả audit Phase 1

| Test Case | Requirement | Current Implementation | Actual Problem | Status | Proposed Fix |
| --- | --- | --- | --- | --- | --- |
| ITC-AUTH-004 | Đăng nhập email/phone; xử lý 0/+84 an toàn | API có email/phone, normalization bỏ separator, lấy tối đa 2 identity để chặn ambiguous | Hai UI và SessionClient/MobileSessions luôn gửi email; chưa quy về cùng alias 0/+84 | Broken | Tái sử dụng LoginIdentifier và payload hiện có; field errors; kiểm tra alias/duplicate |
| ITC-AUTH-006/007/008 | Nhóm validation/error theo Phase 2; chưa có định nghĩa case gốc | DTO attributes + client validation | Lỗi trường tiếng Anh/general alert; đổi một trường xóa lỗi không liên quan; UI không hỗ trợ phone | Broken | Lỗi tiếng Việt dưới từng field, server boundary validation, generic credential failures |
| ITC-AUTH-011/016/017/018/020 | Profile giữ phiên, xác minh contact, own scope | GET/PUT account/profile, strict DTO, version concurrency, flags email/phone reset khi đổi | Repository rotate security stamp khi đổi contact; hai UI chủ động logout. Web tái login trước update; Mobile không có reauth input | Broken | Giữ session cho profile; ràng buộc xác minh contact, tiếp tục dùng email verification và version |
| ITC-AUTH-012 | Invalid session requests, không thay bằng test F5 | JWT issuer/audience/signature/expiry + DB session/stamp/role kiểm tra mỗi request; refresh rotation/reuse | Cần test hiện tại; không tìm thấy định nghĩa Round 1 | Implemented | Giữ invalid-session test, bổ sung F5 riêng trong Phase 3 |
| ITC-AUTH-019 | Chưa có case definition | Không suy đoán mapping | Thiếu tài liệu case/OQ gốc | Not Verified | Cần file/link từ người dùng; vẫn test logout/session theo chính sách đã chốt |
| ITC-AUTH-021 | Nhóm password/verification Phase 5, chưa có định nghĩa case gốc | Identity ChangePassword, revoke all, audit | Chưa chặn newPassword==currentPassword | Partially Implemented | Chặn trước mutation; kiểm tra current/other sessions |
| ITC-AUTH-022 | Nhóm password/verification Phase 5 | Protected reset outbox, token hash/expiry/consume, generic 202 | Không thấy thiếu cơ chế chính khi đọc code; cần rerun | Implemented | Giữ cơ chế, regression đúng mục tiêu |
| ITC-AUTH-023 | Nhóm password/verification Phase 5 | EmailConfirmation riêng, cooldown, one-use/latest, trusted callbacks | Không có bằng chứng native physical device trong lượt này | Partially Implemented | Regression server/UI; ghi riêng device NOT RUN |
| ITC-AUTH-024 | Nhóm password/verification Phase 5 | Auth-only worker, retry/lease/PendingReview, safe SMTP classification | Không bật SMTP thật để chứng minh integration trong lượt này | Implemented | Fake provider failures, verify database state; SMTP thật NOT RUN |
| ITC-AUTH-025 | Nhóm password/verification Phase 5 | Inbox security events và audit dedup | Cần chứng minh không duplicate khi change/reset | Not Verified | Regression event publication và grant/session revocation |
| ITC-AUTH-026 | Nhóm password/verification Phase 5 | Web/native callback, browser fallback, full copyable URL | Chưa có case gốc và device evidence | Partially Implemented | Giữ callback validation; kiểm thử browser/native token semantics |
| AUTH-REG-WEB-RESTORE | F5 và nested route | AuthProvider + SessionClient + routeGuards | AuthProvider chỉ restore khi apiBaseUrl truthy; same-origin '' bỏ qua. Network error kết thúc restoring và redirect Login | Broken | Same-origin restore; phân biệt unavailable/invalid, retry gate không lộ protected UI |
| AUTH-REG-MOBILE-RESTORE | Native cold start, background/foreground | MobileSessions, SecureStore, ready gate, reconnect probe | Network lỗi sau khi refresh bắt đầu luôn clear credential; web Mobile cố ý memory-only, không coi là native persistence | Partially Implemented | Giữ native secure store, phân loại lỗi đã biết; test cold start/concurrency/offline |
| AUTH-STAFF-SETUP | UC-08, mật khẩu khởi tạo qua invitation | Staff create + Owner invite + accept exist | CreateStaffAsync dùng InitialPassword caller gửi; trước khi Owner mời chưa có grant chặn login nên mật khẩu này có thể dùng ngay | Broken | Unknown initial credential và pending setup trước khi gửi; không tạo service/queue mới |
| AUTH-TENANT-ACTIVATION | UC-15 commit activation → create/link + invitation | ContractService gọi PostActivationTenantProvisioning trong transaction, job key contract/resident | Tự cấp cho mọi co-occupant; cần project-owner quyết định. Khi Jobs=false auth-only worker chưa xử lý invitation job | Requirement Conflict | Chốt representative/co-occupant; dùng lại ProcessAllowedAsync chỉ cho account invitation, không bật business jobs |
| AUTH-TOKEN-LIFETIME | 30 phút / 7 ngày | JwtOptions, SessionOptions, issuer min(access expiry, absolute session expiry), rotating hashed refresh | Defaults đúng; config không được coi là bằng chứng live | Implemented | Verify options/issued token trong disposable integration |

## Route inventory từ action descriptors

`AuthenticationRouteAuditTests.ExistingAuthenticationRoutesAreDiscoveredFromControllerActionDescriptors` đọc IActionDescriptorCollectionProvider, không giả định route từ tên class. Contract hiện tại: POST auth/login, refresh, logout, logout-all, change-password, forgot-password, reset-password, request-email-verification, confirm-email, accept-invitation; GET auth/me; GET/PUT account/profile; Owner POST staff/{id}/invitation và residents/{id}/invitation.

## Phạm vi sửa và acceptance

1. Phase 2: format/required/length và 0/+84 alias đúng; ambiguity vẫn 401 chung; Web/Mobile cùng field errors, không lộ account existence.
2. Phase 3: restore same-origin/nested route; transient outage có retry, 401 invalid clear, 403 không logout; giữ rotation/replay defense và secure storage.
3. Phase 4: permitted profile giữ phiên, readonly role/status, email mới chưa confirmed, phone không giả OTP; unknown fields/cross-user bị từ chối.
4. Phase 5: same-password bị chặn, change/reset revoke all và require reauth; token expiry/reuse/cooldown/outbox và security dedup giữ nguyên.
5. Phase 6: Staff không login trước setup; Owner invite, cooldown/expiry/one-use/scope; không phát mật khẩu rõ.
6. Phase 7: Main activation transaction/idempotency, không từ Holding/Resident; chỉ provisioning scope đã được duyệt; delivery state có thể quan sát, SMTP failure không rollback contract.
7. Phase 8: restore/build/UT/IT/client lint/typecheck/tests; báo cáo mới tách lịch sử, physical device và live SMTP NOT RUN.

## Bằng chứng Phase 1

- Disposable PostgreSQL, Release: 50 test Compact24Auth/NotificationMvp/route audit passed, không fail/skip. `BHOME_GMAIL_SMOKE=0`. TRX `.tmp/auth-completion-phase1/` (ignored).
- Mobile: 53 test trong 3 file password-recovery/profile-screens/account-profile passed. Log `.tmp/auth-completion-phase1-mobile.log` (ignored).
- Owner Web baseline: 36 test trong 9 file được chọn passed, không fail; log `.tmp/auth-completion-phase1-web.log` (ignored).
- Chưa sửa production code trong Phase 1. Các test đang pass không phủ các defect mới nêu; không thay expectation để che lỗi. Kết quả SMTP/Gmail cũ chỉ là lịch sử, không phải lần chạy này.

## Nhật ký phase

| Phase | Status | Commit | Evidence |
| --- | --- | --- | --- |
| 1 Audit | Completed sau kiểm chứng baseline | `40b5c84` | Report này + route audit test + logs baseline |
| 2 Validation | Completed | xem commit `fix(auth): improve login validation and errors` | 24 unit / 20 IT / 16 Web / 24 Mobile |
| 3–8 | Pending | — | Thực hiện tuần tự sau commit phase trước |

## Phase 2 — Login validation và errors

Traceability: FE-02/UC-01, Report 3 Authentication Login Identifier, task Phase 2/ITC-AUTH-004..008. DTO giữ email/phone/password/device; IValidatableObject trả đủ lỗi required/format/length tiếng Việt (identifier/email/phone/password). Auth failure 401 có cùng generic title cho unknown/inactive/wrong password. Không sửa lockout/rate limit/RBAC.

LoginIdentifier và client-core chuẩn hóa số Việt Nam 10/11 chữ số bắt đầu 0 về +84; các international number khác giữ nguyên. Query hiện có so khớp canonical trên dữ liệu phone cũ, Take(2) từ chối ambiguous. Không rewrite user identities. EnsurePhoneAvailable dùng cùng canonical và advisory lock để không thêm duplicate qua profile/Staff update. Web và Mobile sử dụng payload phone khi nhập phone, không gửi phone trong field email. Hai UI hiển thị lỗi sát field và chỉ cập nhật lỗi field đang sửa.

Kiểm chứng: 20 integration tests LoginValidation/Auth/Route trên disposable PostgreSQL passed; 16 Web tests passed; 24 Mobile tests passed; typecheck/lint hai client passed. LoginService unit được mở rộng thêm +84 và canonical expectation theo yêu cầu mới; lỗi assertion cũ về domestic string và message email-only đã được cập nhật vì contract normalization/message đã thay đổi có chủ đích, không nới validation. Rerun 24 LoginService unit tests passed, không fail/skip. Các log/TRX dưới `.tmp/auth-completion-phase2*` ignored. Không SMTP thật/migration/live DB.

Commands: `.tmp/Test-ReadinessIsolated.ps1 -Filter 'FullyQualifiedName~Compact24LoginValidationTests|FullyQualifiedName~Compact24AuthTests|FullyQualifiedName~AuthenticationRouteAuditTests'`; `dotnet test ...BHome.Application.UnitTests.csproj -c Release --filter FullyQualifiedName~LoginServiceTests`; npm workspace owner-web/mobile targeted test, typecheck, lint. Expo 58 đã đối chiếu [versioned reference](https://docs.expo.dev/versions/v58.0.0/) và [documentation index](https://docs.expo.dev/llms.txt).

## Đối chiếu nguồn Google Sheet nhận sau Phase 2

Đã đọc thành công CSV read-only của [sheet gốc, gid 1655824798](https://docs.google.com/spreadsheets/d/1rAzpBD-_e309XhPNB-Gt8wNw6Bn7cn1a/edit?gid=1655824798#gid=1655824798). Không sửa sheet hoặc Round 1. Bảng này thay thế các mapping theo nhóm tạm thời của Phase 1 ở trên; nội dung audit kỹ thuật giữ làm lịch sử. Source cache ignored, không copy tester, credentials hoặc dữ liệu cá nhân vào Git.

| ID | Nội dung đúng theo nguồn | Round 1 nguyên văn | Phase xử lý / ghi chú |
| --- | --- | --- | --- |
| ITC-AUTH-001 | Owner đăng nhập email | Passed | 2/3/8, browser + API |
| ITC-AUTH-002 | Staff đăng nhập email, đúng Location | Passed | 2/6/8 |
| ITC-AUTH-003 | Tenant đăng nhập email, chỉ dữ liệu của mình | Passed | 2/7/8 |
| ITC-AUTH-004 | Đăng nhập phone | Fail | 2 |
| ITC-AUTH-005 | Sai mật khẩu, MSG17 chung | Passed | 2 |
| ITC-AUTH-006 | Identifier chưa đăng ký, cùng MSG17 | Fail | 2 |
| ITC-AUTH-007 | Tài khoản inactive, cùng MSG17 | Fail | 2 |
| ITC-AUTH-008 | Field rỗng, MSG02 dưới field | Fail | 2 |
| ITC-AUTH-009 | Không lưu/log mật khẩu rõ | Passed | 5/6/8 |
| ITC-AUTH-010 | Protected cần login; public approved vẫn anonymous | Pending | 8 |
| ITC-AUTH-011 | Xem account của chính mình, không secrets | Passed | 4; ghi chú F5/profile logout được tách thành regression |
| ITC-AUTH-012 | Request không có valid session bị từ chối | Fail | 3/8; ghi chú F5 không thay thế mục tiêu case này |
| ITC-AUTH-013 | Token sửa/giả role bị từ chối | Pending | 3/8 |
| ITC-AUTH-014 | Logout current session | Passed | 3/8 |
| ITC-AUTH-015 | Logout A không ảnh hưởng B | Passed | 3/8 |
| ITC-AUTH-016 | Profile hiển thị name/phone/email/role/status readonly | Passed | 4 |
| ITC-AUTH-017 | Lưu Full Name và Phone | Passed | 4; ghi chú logout sau contact change bị supersede bởi chính sách mới giữ phiên |
| ITC-AUTH-018 | Không tự sửa role/employment/Location assignment | Pending | 4/6; kiểm tra cả assigned Locations trong UI |
| ITC-AUTH-019 | Tenant lần đầu phải hoàn tất Full Name/Phone trước Home | Pending | 4/7; tái dùng GET/PUT profile, không cần endpoint mới |
| ITC-AUTH-020 | Profile field required rỗng không lưu | Passed | 4 |
| ITC-AUTH-021 | Đổi mật khẩu đúng, login cũ bị từ chối/login mới được | Fail | 5 |
| ITC-AUTH-022 | Current password sai không thay mật khẩu | Fail | 5 |
| ITC-AUTH-023 | Input đổi password không hợp lệ không mutate | Fail | 5 |
| ITC-AUTH-024 | Forgot/reset qua email đăng ký | Pending | 5; giữ prerequisite EmailConfirmed đã được người dùng xác nhận |
| ITC-AUTH-025 | Forgot unknown email generic, không phát thư | Pending | 5 |
| ITC-AUTH-026 | Reset token hết hạn/reuse bị từ chối | Pending | 5 |

OQ-AUTH-01 hỏi lockout/rate limit: giữ cấu hình hiện tại, không invent ngưỡng. OQ-AUTH-02 hỏi lifetime/rotation/reuse/logout-all: chính sách 30 phút/7 ngày và fixed deadline được nhiệm vụ mới cùng quyết định cũ trong REFRESH_TOKEN_SESSIONS.md xác nhận. OQ-AUTH-03 hỏi password/reset/verification/identifier: giữ Identity policy và token lifetime hiện tại, áp dụng quyết định mới revoke all sau change, email prerequisite và canonical phone của Phase 2. OQ trong sheet vẫn là lịch sử chưa sửa; không tuyên bố đã sửa SRS/BA baseline.

Quyết định project-owner trong lượt này: cho phép tự cấp Tenant cho **mọi occupant có email đã được Owner duyệt trong Main Contract đang kích hoạt**. Phase 7 kiểm tra chính phạm vi này, transaction/signing/payment/Owner activation không thay đổi. Không tự cấp từ Holding/Resident đơn thuần.

## Phase 3 — Session persistence

FE-02/UC-01..02, ITC-AUTH-012..015 và các regression F5/cold-start riêng. Sửa AuthProvider để same-origin base rỗng vẫn refresh, lỗi network/5xx có trạng thái khôi phục unavailable và nút retry; protected route không render dữ liệu hoặc chuyển sang Login khi chưa xác định được session. Các form unit test dùng `restoreOnMount=false` để tách background restoration; test provider/route/browser dùng restoration thực, không bỏ test F5.

Owner Web Development dùng proxy cùng origin cho auth để cookie Strict không phụ thuộc HTTP frontend → HTTPS API khác scheme. Proxy tới API tiếp tục kiểm tra TLS, chỉ dùng public certificate localhost đã được máy tin cậy. `Prepare-OcrMobile.ps1` xuất thêm localhost.cer public; không sửa trust store hoặc xuất thêm private key. App production giữ API HTTPS cấu hình như trước; deployment phải phục vụ Web/API cùng site với cùng scheme để cookie Strict hoạt động. Không đổi cookie sang None hoặc lưu token trong localStorage. Public certificate đã xuất local vào `.tools/mobile-tls/localhost.cer` (ignored).

Mobile giữ SecureStore, ready gate, server binding và probe anonymous trước refresh. Offline trước khi gửi credential giữ refresh token, hiển thị chờ/retry. 403/429 đã biết không revoke current session. Với network/5xx sau khi rotation có thể đã xảy ra, không replay refresh token: xóa credential không xác định, chỉ giữ access session còn hạn và yêu cầu login khi hết hạn. Cold start không có access session được xác thực thì vẫn fail closed. Không thêm grace period, sliding deadline hoặc bảng token.

Kiểm chứng vừa chạy:

- 13 backend tests passed, không fail/skip: Compact24SessionLifecycle/Auth + **AuthenticationBrowserTests**. Bao gồm access token hết hạn 30 phút → refresh trong session 7 ngày fixed deadline; DB chỉ token hash; replay revoke family; logout A giữ B; JWT giả Owner bị 401, Tenant gọi Staff bị 403.
- Real headless Edge + Vite + loopback bridge tới ASP.NET host thực + disposable PostgreSQL: cookie Secure/HttpOnly/Strict, F5 nested `/account/profile` giữ trang, cookie rotate, tab mới restore. Không mock route/fetch ở E2E; loopback HTTP là transport test, không chứng minh TLS deployment/physical device. Evidence `.tools/auth-browser-*/passed.json` ignored.
- 40 Web tests, 23 Mobile tests passed; typecheck/lint cả hai client passed. Mobile native secure-store/AppState được mock trong component tests; thiết bị thật NOT RUN.
- Commands: `.tmp/Test-ReadinessIsolated.ps1 -Filter 'FullyQualifiedName~Compact24SessionLifecycleTests|FullyQualifiedName~Compact24AuthTests|FullyQualifiedName~AuthenticationBrowserTests'` với BHOME_RUN_BROWSER_E2E=true và BHOME_GMAIL_SMOKE=0; workspace Web auth/routeGuards + Mobile sessions/sessionProvider tests, typecheck, lint. Logs/TRX `.tmp/auth-completion-phase3*` ignored.
- Local .env/User Secrets đã đối chiếu session refresh/absolute = 7 ngày; Jwt default = 30 phút được test bằng issued token. Không query/mutate Neon, không live SMTP.
