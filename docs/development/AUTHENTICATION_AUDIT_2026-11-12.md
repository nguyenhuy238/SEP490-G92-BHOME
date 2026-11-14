# Authentication audit — 12/11/2026

## Phạm vi, nguồn và chính sách đã xác nhận

Nhánh bắt đầu `member/QHuy`, working tree sạch, baseline `d7885f9`. Thực hiện tuần tự 8 phase, mỗi phase có commit và bằng chứng riêng. Không sửa database Neon/live, không chạy SMTP thật, không bật business automation.

Nguồn đã đọc: SRS v1.3 trong `docs/reports/BHome_Report-3_Software Requirement Specification.docx`, master UC-01 Sign In, UC-02 Sign Out, UC-03 Personal Profile; FE-02 phần Authentication/Personal Profile; UC-08 Staff, UC-15 bước 15–16; Report 4 §1.1 Authentication Flow/Token Design. Yêu cầu người dùng trong nhiệm vụ này xác nhận access token 30 phút, refresh/session 7 ngày; profile giữ phiên, email mới phải xác nhận; đổi mật khẩu thu hồi mọi phiên; giữ prerequisite EmailConfirmed trước recovery.

Chưa có file định nghĩa ITC-AUTH-001..026/Round 1 và OQ-AUTH-01..03 trong repository. Đã yêu cầu đường dẫn. Các mã dưới đây chỉ liên kết theo nhóm mà đề bài đã nêu, không tự đặt nội dung chi tiết hoặc kết quả Round 1. `docs/testing/...Login_Test_Execution_Guide.md` là UTC001..016 và có mô tả response cũ; không dùng các PASS có sẵn làm bằng chứng mới.

## Kết quả audit Phase 1

| Test Case                    | Requirement                                                     | Current Implementation                                                                                    | Actual Problem                                                                                                                     | Status                | Proposed Fix                                                                                                      |
| ---------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| ITC-AUTH-004                 | Đăng nhập email/phone; xử lý 0/+84 an toàn                      | API có email/phone, normalization bỏ separator, lấy tối đa 2 identity để chặn ambiguous                   | Hai UI và SessionClient/MobileSessions luôn gửi email; chưa quy về cùng alias 0/+84                                                | Broken                | Tái sử dụng LoginIdentifier và payload hiện có; field errors; kiểm tra alias/duplicate                            |
| ITC-AUTH-006/007/008         | Nhóm validation/error theo Phase 2; chưa có định nghĩa case gốc | DTO attributes + client validation                                                                        | Lỗi trường tiếng Anh/general alert; đổi một trường xóa lỗi không liên quan; UI không hỗ trợ phone                                  | Broken                | Lỗi tiếng Việt dưới từng field, server boundary validation, generic credential failures                           |
| ITC-AUTH-011/016/017/018/020 | Profile giữ phiên, xác minh contact, own scope                  | GET/PUT account/profile, strict DTO, version concurrency, flags email/phone reset khi đổi                 | Repository rotate security stamp khi đổi contact; hai UI chủ động logout. Web tái login trước update; Mobile không có reauth input | Broken                | Giữ session cho profile; ràng buộc xác minh contact, tiếp tục dùng email verification và version                  |
| ITC-AUTH-012                 | Invalid session requests, không thay bằng test F5               | JWT issuer/audience/signature/expiry + DB session/stamp/role kiểm tra mỗi request; refresh rotation/reuse | Cần test hiện tại; không tìm thấy định nghĩa Round 1                                                                               | Implemented           | Giữ invalid-session test, bổ sung F5 riêng trong Phase 3                                                          |
| ITC-AUTH-019                 | Chưa có case definition                                         | Không suy đoán mapping                                                                                    | Thiếu tài liệu case/OQ gốc                                                                                                         | Not Verified          | Cần file/link từ người dùng; vẫn test logout/session theo chính sách đã chốt                                      |
| ITC-AUTH-021                 | Nhóm password/verification Phase 5, chưa có định nghĩa case gốc | Identity ChangePassword, revoke all, audit                                                                | Chưa chặn newPassword==currentPassword                                                                                             | Partially Implemented | Chặn trước mutation; kiểm tra current/other sessions                                                              |
| ITC-AUTH-022                 | Nhóm password/verification Phase 5                              | Protected reset outbox, token hash/expiry/consume, generic 202                                            | Không thấy thiếu cơ chế chính khi đọc code; cần rerun                                                                              | Implemented           | Giữ cơ chế, regression đúng mục tiêu                                                                              |
| ITC-AUTH-023                 | Nhóm password/verification Phase 5                              | EmailConfirmation riêng, cooldown, one-use/latest, trusted callbacks                                      | Không có bằng chứng native physical device trong lượt này                                                                          | Partially Implemented | Regression server/UI; ghi riêng device NOT RUN                                                                    |
| ITC-AUTH-024                 | Nhóm password/verification Phase 5                              | Auth-only worker, retry/lease/PendingReview, safe SMTP classification                                     | Không bật SMTP thật để chứng minh integration trong lượt này                                                                       | Implemented           | Fake provider failures, verify database state; SMTP thật NOT RUN                                                  |
| ITC-AUTH-025                 | Nhóm password/verification Phase 5                              | Inbox security events và audit dedup                                                                      | Cần chứng minh không duplicate khi change/reset                                                                                    | Not Verified          | Regression event publication và grant/session revocation                                                          |
| ITC-AUTH-026                 | Nhóm password/verification Phase 5                              | Web/native callback, browser fallback, full copyable URL                                                  | Chưa có case gốc và device evidence                                                                                                | Partially Implemented | Giữ callback validation; kiểm thử browser/native token semantics                                                  |
| AUTH-REG-WEB-RESTORE         | F5 và nested route                                              | AuthProvider + SessionClient + routeGuards                                                                | AuthProvider chỉ restore khi apiBaseUrl truthy; same-origin '' bỏ qua. Network error kết thúc restoring và redirect Login          | Broken                | Same-origin restore; phân biệt unavailable/invalid, retry gate không lộ protected UI                              |
| AUTH-REG-MOBILE-RESTORE      | Native cold start, background/foreground                        | MobileSessions, SecureStore, ready gate, reconnect probe                                                  | Network lỗi sau khi refresh bắt đầu luôn clear credential; web Mobile cố ý memory-only, không coi là native persistence            | Partially Implemented | Giữ native secure store, phân loại lỗi đã biết; test cold start/concurrency/offline                               |
| AUTH-STAFF-SETUP             | UC-08, mật khẩu khởi tạo qua invitation                         | Staff create + Owner invite + accept exist                                                                | CreateStaffAsync dùng InitialPassword caller gửi; trước khi Owner mời chưa có grant chặn login nên mật khẩu này có thể dùng ngay   | Broken                | Unknown initial credential và pending setup trước khi gửi; không tạo service/queue mới                            |
| AUTH-TENANT-ACTIVATION       | UC-15 commit activation → create/link + invitation              | ContractService gọi PostActivationTenantProvisioning trong transaction, job key contract/resident         | Tự cấp cho mọi co-occupant; cần project-owner quyết định. Khi Jobs=false auth-only worker chưa xử lý invitation job                | Requirement Conflict  | Chốt representative/co-occupant; dùng lại ProcessAllowedAsync chỉ cho account invitation, không bật business jobs |
| AUTH-TOKEN-LIFETIME          | 30 phút / 7 ngày                                                | JwtOptions, SessionOptions, issuer min(access expiry, absolute session expiry), rotating hashed refresh   | Defaults đúng; config không được coi là bằng chứng live                                                                            | Implemented           | Verify options/issued token trong disposable integration                                                          |

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

| Phase                 | Status                            | Commit                    | Evidence                                              |
| --------------------- | --------------------------------- | ------------------------- | ----------------------------------------------------- |
| 1 Audit               | Completed sau kiểm chứng baseline | `40b5c84`                 | Report này + route audit test + logs baseline         |
| 2 Validation          | Completed                         | `79d26a5`                 | 24 unit / 20 IT / 16 Web / 24 Mobile                  |
| 3 Session             | Completed                         | `e95f0d2`                 | 13 backend/E2E / 40 Web / 23 Mobile                   |
| 4 Profile             | Completed                         | `66db85c`                 | 63 backend/E2E / 3 Web / 49 Mobile                    |
| 5 Password            | Completed                         | `acbd490`                 | 52 backend / 36 Web / 13 Mobile                       |
| 6 Staff invitation    | Completed                         | `4e48db5`                 | 41 backend + 1 rerun / 7 Web                          |
| 7 Tenant provisioning | Completed                         | `403bce3`                 | 49 backend / 26 Web                                   |
| 8 Regression          | Completed                         | Commit chứa báo cáo final | 557 unit / 98 IT/E2E + 2 rerun / 360 Web / 914 Mobile |

## Phase 2 — Login validation và errors

Traceability: FE-02/UC-01, Report 3 Authentication Login Identifier, task Phase 2/ITC-AUTH-004..008. DTO giữ email/phone/password/device; IValidatableObject trả đủ lỗi required/format/length tiếng Việt (identifier/email/phone/password). Auth failure 401 có cùng generic title cho unknown/inactive/wrong password. Không sửa lockout/rate limit/RBAC.

LoginIdentifier và client-core chuẩn hóa số Việt Nam 10/11 chữ số bắt đầu 0 về +84; các international number khác giữ nguyên. Query hiện có so khớp canonical trên dữ liệu phone cũ, Take(2) từ chối ambiguous. Không rewrite user identities. EnsurePhoneAvailable dùng cùng canonical và advisory lock để không thêm duplicate qua profile/Staff update. Web và Mobile sử dụng payload phone khi nhập phone, không gửi phone trong field email. Hai UI hiển thị lỗi sát field và chỉ cập nhật lỗi field đang sửa.

Kiểm chứng: 20 integration tests LoginValidation/Auth/Route trên disposable PostgreSQL passed; 16 Web tests passed; 24 Mobile tests passed; typecheck/lint hai client passed. LoginService unit được mở rộng thêm +84 và canonical expectation theo yêu cầu mới; lỗi assertion cũ về domestic string và message email-only đã được cập nhật vì contract normalization/message đã thay đổi có chủ đích, không nới validation. Rerun 24 LoginService unit tests passed, không fail/skip. Các log/TRX dưới `.tmp/auth-completion-phase2*` ignored. Không SMTP thật/migration/live DB.

Commands: `.tmp/Test-ReadinessIsolated.ps1 -Filter 'FullyQualifiedName~Compact24LoginValidationTests|FullyQualifiedName~Compact24AuthTests|FullyQualifiedName~AuthenticationRouteAuditTests'`; `dotnet test ...BHome.Application.UnitTests.csproj -c Release --filter FullyQualifiedName~LoginServiceTests`; npm workspace owner-web/mobile targeted test, typecheck, lint. Expo 58 đã đối chiếu [versioned reference](https://docs.expo.dev/versions/v58.0.0/) và [documentation index](https://docs.expo.dev/llms.txt).

## Đối chiếu nguồn Google Sheet nhận sau Phase 2

Đã đọc thành công CSV read-only của [sheet gốc, gid 1655824798](https://docs.google.com/spreadsheets/d/1rAzpBD-_e309XhPNB-Gt8wNw6Bn7cn1a/edit?gid=1655824798#gid=1655824798). Không sửa sheet hoặc Round 1. Bảng này thay thế các mapping theo nhóm tạm thời của Phase 1 ở trên; nội dung audit kỹ thuật giữ làm lịch sử. Source cache ignored, không copy tester, credentials hoặc dữ liệu cá nhân vào Git.

| ID           | Nội dung đúng theo nguồn                                | Round 1 nguyên văn | Phase xử lý / ghi chú                                                          |
| ------------ | ------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------ |
| ITC-AUTH-001 | Owner đăng nhập email                                   | Passed             | 2/3/8, browser + API                                                           |
| ITC-AUTH-002 | Staff đăng nhập email, đúng Location                    | Passed             | 2/6/8                                                                          |
| ITC-AUTH-003 | Tenant đăng nhập email, chỉ dữ liệu của mình            | Passed             | 2/7/8                                                                          |
| ITC-AUTH-004 | Đăng nhập phone                                         | Fail               | 2                                                                              |
| ITC-AUTH-005 | Sai mật khẩu, MSG17 chung                               | Passed             | 2                                                                              |
| ITC-AUTH-006 | Identifier chưa đăng ký, cùng MSG17                     | Fail               | 2                                                                              |
| ITC-AUTH-007 | Tài khoản inactive, cùng MSG17                          | Fail               | 2                                                                              |
| ITC-AUTH-008 | Field rỗng, MSG02 dưới field                            | Fail               | 2                                                                              |
| ITC-AUTH-009 | Không lưu/log mật khẩu rõ                               | Passed             | 5/6/8                                                                          |
| ITC-AUTH-010 | Protected cần login; public approved vẫn anonymous      | Pending            | 8                                                                              |
| ITC-AUTH-011 | Xem account của chính mình, không secrets               | Passed             | 4; ghi chú F5/profile logout được tách thành regression                        |
| ITC-AUTH-012 | Request không có valid session bị từ chối               | Fail               | 3/8; ghi chú F5 không thay thế mục tiêu case này                               |
| ITC-AUTH-013 | Token sửa/giả role bị từ chối                           | Pending            | 3/8                                                                            |
| ITC-AUTH-014 | Logout current session                                  | Passed             | 3/8                                                                            |
| ITC-AUTH-015 | Logout A không ảnh hưởng B                              | Passed             | 3/8                                                                            |
| ITC-AUTH-016 | Profile hiển thị name/phone/email/role/status readonly  | Passed             | 4                                                                              |
| ITC-AUTH-017 | Lưu Full Name và Phone                                  | Passed             | 4; ghi chú logout sau contact change bị supersede bởi chính sách mới giữ phiên |
| ITC-AUTH-018 | Không tự sửa role/employment/Location assignment        | Pending            | 4/6; kiểm tra cả assigned Locations trong UI                                   |
| ITC-AUTH-019 | Tenant lần đầu phải hoàn tất Full Name/Phone trước Home | Pending            | 4/7; tái dùng GET/PUT profile, không cần endpoint mới                          |
| ITC-AUTH-020 | Profile field required rỗng không lưu                   | Passed             | 4                                                                              |
| ITC-AUTH-021 | Đổi mật khẩu đúng, login cũ bị từ chối/login mới được   | Fail               | 5                                                                              |
| ITC-AUTH-022 | Current password sai không thay mật khẩu                | Fail               | 5                                                                              |
| ITC-AUTH-023 | Input đổi password không hợp lệ không mutate            | Fail               | 5                                                                              |
| ITC-AUTH-024 | Forgot/reset qua email đăng ký                          | Pending            | 5; giữ prerequisite EmailConfirmed đã được người dùng xác nhận                 |
| ITC-AUTH-025 | Forgot unknown email generic, không phát thư            | Pending            | 5                                                                              |
| ITC-AUTH-026 | Reset token hết hạn/reuse bị từ chối                    | Pending            | 5                                                                              |

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

## Phase 4 — Profile giữ phiên và xác minh liên hệ

Traceability UC-03/FE-02, ITC-AUTH-011/016..020; chính sách giữ phiên của nhiệm vụ mới thay thế ghi chú Round 1 về logout khi đổi liên hệ. GET/PUT account/profile được tái dùng; PUT thêm trường tùy chọn currentPassword, bắt buộc khi email/phone thực sự thay đổi. Identity kiểm tra mật khẩu và giữ failed-attempt/lockout state; không đổi security stamp khi lưu profile. Optimistic version, canonical phone uniqueness và từ chối unknown fields vẫn được giữ. Vai trò/status/employment/assignment không thể overpost.

Email mới trở về unconfirmed, hủy reset grant cũ; Web/Mobile yêu cầu liên kết qua endpoint verification đã có, giữ phiên khi delivery chưa sẵn sàng. Sửa predicate để invitation job lịch sử đã tiêu thụ không chặn xác minh email mới. Phone mới luôn unverified; chưa có SMS provider, không giả OTP. Tenant phải có Full Name/Phone trước Home bằng gate và form profile hiện có; server từ chối lưu Tenant thiếu phone. Staff Mobile hiển thị assigned Locations chỉ đọc từ API capture/locations đã scope.

Kiểm chứng mới: 62 backend integration tests passed (Compact24NotificationMvp/Auth/LoginValidation/SessionLifecycle), 3 Web profile tests passed, 49 Mobile profile/gate tests passed; typecheck/lint cả hai client passed. Test giả lập Staff dùng Response mới cho từng GET và kiểm tra Location chỉ đọc; validation có thêm lỗi mật khẩu xác nhận liên hệ. Hai lần assertion UI được sửa theo hành vi mới, không bỏ kiểm tra. Logs/TRX `.tmp/auth-completion-phase4*` ignored. Browser acceptance mở rộng lưu profile rồi reload trên API thực; lần đầu locator exact không khớp dấu required của MUI, đã sửa locator và chạy lại. Không SMTP thật, không migration/live DB.

Commands: disposable wrapper filter Compact24NotificationMvpTests|Compact24AuthTests|Compact24LoginValidationTests|Compact24SessionLifecycleTests; browser filter AuthenticationBrowserTests với BHOME_RUN_BROWSER_E2E=true/BHOME_GMAIL_SMOKE=0; npm workspace owner-web profile test và mobile profile-screens/account-profile/tenant-profile-gate, typecheck/lint.
Browser rerun: 1/1 passed, lưu Full Name giữ nguyên refresh cookie; F5 nested và new tab restore passed trên API/PostgreSQL thực. Tổng Phase 4: 63 backend/E2E, 3 Web và 49 Mobile passed, 0 failed/skip trong các lần xác minh cuối.

## Phase 5 — Password, recovery và verification

UC-01/03, ITC-AUTH-021..026: phát hiện Web tự login bằng mật khẩu mới sau change và backend cho phép new=current. Đã chặn same-password ở server và hai client; Web xóa session rồi chuyển Login, Mobile giữ logout flow hiện có và thêm policy validation trước request. Password hash, reset grant, token lifetime 15 phút, email prerequisite, protected outbox, SMTP retry và security dedup tiếp tục dùng implementation hiện có. Không thay cookie/security/refresh policy và không tạo endpoint.

Thực thi mới: 52 backend Compact24Auth/NotificationMvp passed trên disposable PostgreSQL, bao gồm wrong current/weak/empty/same không đổi hash hoặc hai session, success revoke cả hai; reset concurrent/generic/encrypted/one-use/revoke, verification unconfirmed/expired/reused/email-changed, SMTP retry/suppression, security event dedup. 36 Web auth tests (8 files), 13 Mobile security/recovery tests (2 files) passed. Typecheck/lint hai client passed, git diff --check passed. Logs/TRX `.tmp/auth-completion-phase5*` ignored. Live SMTP và physical native links NOT RUN.

Commands: disposable wrapper filter Compact24NotificationMvpTests|Compact24AuthTests với BHOME_GMAIL_SMOKE=0; npm workspace owner-web auth tests, mobile account-security/password-recovery, typecheck và lint. Đã sửa test Web auto-login theo chính sách mới explicit yêu cầu reauthentication; không hạ yêu cầu security hoặc xóa negative test.

## Phase 6 — Staff invitation

UC-08/FE-02: Staff creation trước đây dùng mật khẩu do Owner cung cấp và chỉ chặn login sau khi gửi invitation. Đã tạo credential ngẫu nhiên không phát ra ngoài, đánh dấu pending setup bằng grant hash ngẫu nhiên đã hết hạn trên fields hiện có. Không có token dùng được/cooldown trước lời mời; verification và login không thể bỏ qua setup. InitialPassword giữ nullable để tương thích client cũ nhưng không được dùng. UI bỏ field khởi tạo mật khẩu, giải thích Owner gửi lời mời sau tạo và thông báo queued chưa chứng minh giao thư. Giữ API, role assignment, outbox và invitation service.

Thực thi mới: 41 Compact24NotificationMvp integration tests passed, 1 test tạo Staff với InitialPassword=null rerun passed, 7 Web Staff/accept-invitation tests passed; Web typecheck/lint passed. Bao gồm before-invite login denied, không thể xác minh email để vượt setup, recipient duy nhất, cooldown, expire/resend/superseded/one-use, password setup, Staff không có assignment trả Locations rỗng, không quản lý Staff, inactive mất quyền. Các permission tests hiện có vẫn giữ. Mobile không đổi ở phase này; acceptance component đã chạy Phase 5, chưa chạy lại native thật.

Commands: disposable wrapper filter Compact24NotificationMvpTests và OwnerCreatesStaffWithExplicitRoleAndSendsOneTimeInvitation; Web Staff/AcceptInvitationPage Vitest + typecheck/lint. Một lần chạy bổ sung đồng thời bị lock test DLL (MSB3021/3027); đã chờ suite kết thúc và chạy tuần tự lại 1/1 passed. Logs/TRX `.tmp/auth-completion-phase6*` ignored. Không live SMTP/migration/live DB.

## Phase 7 — Tenant provisioning và invitation dispatch

UC-15, quyết định project-owner: mọi occupant có email Owner duyệt trong Main Contract đang kích hoạt. Giữ điều kiện signature/payment/Owner và transaction ContractService; không cấp User từ Holding/Resident. PostActivationTenantProvisioning kiểm tra Owner/Room/membership, dùng identity liên kết đã được duyệt; không tự link chỉ vì trùng email. New và linked-unconfirmed accounts chờ setup trước asynchronous dispatch; linked-unconfirmed session cũ được revoke. Tái dùng pending grant của Phase 6, không bảng/migration mới.

Defect đã sửa: Jobs.Enabled=false khiến AccountInvitationJob không chạy dù auth-only email worker chạy. NotificationAutomationWorker nay gọi ProcessAllowedAsync của PostgresJobWorker với đúng AccountInvitationJob; giữ lease/retry/idempotency và không chạy business handlers. Job recheck Active Main, Owner và membership trước gửi. Manual invitation từ chối inactive/non-Tenant identity.

Owner detail GET residents/{id} thêm projection account (isActive, emailConfirmed, invitationAcceptedAt, invitationDispatchState, jobState, deliveryState). Dữ liệu lấy từ flags/audit/job/outbox hiện có; không enum/status mới hoặc token/payload nhạy cảm. List giữ account=null để không N+1. Service vẫn Owner-only. Web đọc các trạng thái này, phân biệt chờ/queued/sending/Sent/PendingReview/failure/accepted; setup completed chỉ khi có audit acceptance, không suy ra từ queued. Có tải lại bằng query hiện có.

Thực thi cuối Phase 7: 49 backend tests passed (Compact24NotificationMvp, AnonymousSigning, PreAccountOnboarding, OwnerResidentAdministration), 26 Web Tenant/Contract tests passed; Web typecheck/lint và diff check passed. Bao gồm actual Main activation tạo 2 occupant accounts, resident/holding không tạo login, repeated activation không duplicate, explicit existing link reuse, no email-only auto-link, async worker dispatch, enabled synthetic business handler vẫn Pending/0 executions, safe account status, invitation acceptance, SMTP failure giữ Active contract và grant. Lượt đầu test worker thiếu contact_email trong fixture nên bị Owner-review refusal/timeout; đã bổ sung synthetic Owner-approved contact, targeted 4 tests passed, sau đó chạy cả 49 tests passed. Không nới production guard để làm test pass.

Commands: disposable wrapper filter Compact24NotificationMvpTests|AnonymousSigningTests|PreAccountOnboardingTests|OwnerResidentAdministrationTests, BHOME_GMAIL_SMOKE=0; Web tenants + Contracts.test.tsx, typecheck/lint. Logs `.tmp/auth-completion-phase7*` ignored. Mobile không đổi ở phase này; physical native và SMTP thật NOT RUN. Existing internal contract signing là behavior của baseline, không được thay đổi/phê duyệt mới bởi audit auth này; đối chiếu ngoại lệ external-provider SRS vẫn là vấn đề kiến trúc riêng.

## Phase 8 — Regression và bàn giao

Báo cáo đầy đủ: [AUTHENTICATION_FINAL_VERIFICATION.md](AUTHENTICATION_FINAL_VERIFICATION.md), 11 sections, Round 1 nguyên trạng và evidence mới cho ITC-AUTH-001..026/regressions riêng. Restore solution, API Release build 0 warnings/errors; 451 Application + 106 Domain unit; 98 integration/E2E; 360 Web/71 files; 914 Mobile/80 files passed. Typecheck/lint hai client và production Web build passed (bundle chunk-size warning). Thêm 2 targeted rerun passed, dùng tracked Test-Compact24Isolated.ps1 -Configuration Release, kiểm API reset token expired không đổi hash và protected/public anonymous boundary. Không cộng duplicate rerun như unique coverage.

Initial full-run failures không bị che: Web 37 selector/demo fixture fail, Mobile 1 expectation cũ fail, integration 6 established-account fixture fail. Sửa selector email-or-phone; Mobile kiểm access còn hạn trong memory nhưng vẫn xóa refresh credential unknown; established contract actors có EmailConfirmed=true và pending accounts được test riêng. Targeted 37 router/18 contract tests rồi full suites chạy lại passed. Không xóa failing tests hoặc hạ security/permissions. Browser real API evidence: same-origin cookie, Secure/HttpOnly/Strict, nested F5, new tab restore, profile save không logout đều true.

Live SMTP, physical native và live database NOT RUN/không thay đổi. API VS Debug chưa tự restart; bản build kiểm chứng là Release. Không push/merge/migration. Lịch sử file và short English descriptions nằm trong từng phase commit; final report nêu rõ source priority/approved policy và hạn chế deployment/native/SMS.
