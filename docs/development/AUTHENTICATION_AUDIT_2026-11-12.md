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
