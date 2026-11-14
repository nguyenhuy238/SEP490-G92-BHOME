# Kiểm chứng CI sau Authentication — 12/11/2026

## Phạm vi

Yêu cầu: kiểm tra và sửa lỗi trước khi push. Baseline `adad414` (merge develop sau Authentication `e680095`), nhánh `member/QHuy`, working tree sạch trước thực hiện. Nguồn kỹ thuật: `.github/workflows/ci.yml`, root package scripts, `tests/backend/ci.runsettings`, quy tắc chất lượng/change management trong `AGENTS.md` mục 9–10. Không thay business policy BF/UC/GBR, schema, API hoặc notification schedules. AuthProvider thuộc FE-02/UC-01, giữ nguyên acceptance về restore/retry/session đã duyệt.

Workflow hiện chạy cho pull request vào main/develop/release và workflow_dispatch. Không thay trigger, bỏ step, nới lint/format rule hoặc vô hiệu hóa test để làm CI xanh. Không push/merge hoặc chạy Gmail SMTP thật.

## Lỗi tái hiện và sửa

1. Root ESLint (khác lint riêng từng workspace) trả 6 errors: `react-hooks/set-state-in-effect` trong shared AuthProvider; 5 `no-undef` do script `.mjs` dùng URL chưa import.
   - `packages/client-core/src/auth.tsx`: initial restoring được khởi tạo từ props; callback hoàn tất request async cập nhật state. Retry do người dùng gọi vẫn đặt loading/reset error trước request. Không defer bằng timer, disable rule, bỏ restore hoặc lưu token ra persistent web storage.
   - `scripts/Test-AuthenticationBrowser.mjs`: import URL từ `node:url`.
2. `npm run format:check` trả lỗi 9 files: 7 tài liệu Markdown và 2 Mobile test files. Chạy Prettier với config hiện có, chỉ định dạng.
   Đã đối chiếu Markdown AST trước/sau cho cả 7 tài liệu, bỏ source positions: 7/7 không đổi nội dung hoặc cấu trúc.
3. `dotnet format ... --verify-no-changes` trả WHITESPACE errors trong 6 integration test files. Dùng formatter hiện có sửa khoảng trắng/initializer layout; không đổi assertions hoặc logic.
4. Merge develop để lại `StaffEditor` import và khai báo trùng trong StaffApiPage, thiếu import Box, đồng thời component editor mới đưa lại InitialPassword. Xóa bản editor cũ còn sót, giữ component/layout mới và validation/date/version/error handling của develop; khôi phục lời mời tự đặt mật khẩu theo quyết định Authentication. Test create/retry tiếp tục kiểm DTO allowlist và không gửi initialPassword.
5. Test host legacy đã loại Compact24DbContext nhưng giữ AuthenticationEmailDelivery, EmailVerificationService và NotificationEmailContent. Điều chỉnh composition **chỉ trong test assembly**: loại adapter Compact24-only, dùng UnconfiguredPasswordResetDelivery hiện có; các test cần mailbox tự inject boundary. PersistenceCompositionTests xác nhận cả hai service graphs, services Compact24-only và delivery adapter đúng schema. Không thêm fallback production hoặc bỏ validation DI.
6. Các test đăng nhập legacy/PostgreSQL còn assertion thông báo tiếng Anh cũ. Parse problem JSON và kiểm đúng generic title tiếng Việt đã được duyệt; giữ kiểm 401, correlation, cache và không lộ thông tin. Test reset sử dụng đồng hồ giả vượt cooldown, kiểm immediate resend không phát thêm token trước khi kiểm supersede/concurrent one-use/revocation. Fixture MainDraft cho established signing accounts đặt EmailConfirmed=true; pending onboarding có tests riêng, không nới guard backend.
7. Merge Mobile làm mất validation same-password/policy đã duyệt. Khôi phục validation trước mutation, giữ nút show/hide, clear khi background và logout/reauth mới. Các test UI mới và Authentication cùng được chạy lại.
8. Một test router vượt 15 giây khi lặp whole-page accessibility scans trên room grid. Chọn exact heading/tab text trước rồi vẫn kiểm role, accessible name, visibility và href; giữ timeout và mọi assertion về room/Location isolation.

Không đổi dependencies, lockfile, production permission/token policy, SMTP config hoặc database. Các test SMTP vẫn opt-in và không chạy với tài khoản/email thật.

## Môi trường kiểm chứng

Chạy lại từ archive Git cộng patch hiện tại trên volume Linux sạch, không mount `.env`, User Secrets, node_modules hay bin/obj của máy làm việc. Frontend Node 22 cài bằng `npm ci`; dùng VITE_API_BASE_URL tổng hợp như workflow. Backend .NET SDK 8, daemon Docker riêng, PostgreSQL 16 disposable trên loopback; MinIO/LibreOffice dựng từ Dockerfiles của repo. Thư mục tạm được chia sẻ với daemon để test PDF thấy đúng file; cgroup namespace host giữ resource limits của converter.

Statement logging dùng `log_parameter_max_length=0` và `log_parameter_max_length_on_error=0` như CI. Chỉ synthetic fixtures, không kết nối database live. Không bật browser/OCR/SMTP opt-in ngoài điều kiện workflow. Skip phải ghi riêng, không tính là pass.

## Kết quả thực thi mới

Frontend Linux đã hoàn tất với status `lint=0 typecheck=0 tests=0 build=0 export=0 format=0`: Owner Web 427/427 (74 files), Mobile 1021/1021 (90 files). Cài sạch 905 packages bằng npm ci từ lockfile. Owner/Public production builds và Mobile web export thành công. Root ESLint, Mobile typecheck và Prettier đều thành công. Owner typecheck riêng trên Windows cũng passed.

Các regression nhỏ mới thực thi: 17 DI/Login API tests, 13 Staff/AuthRestore tests, 119 Mobile security/workspace UI tests passed. Lượt đầu của legacy AuthenticationSecurity có 45 passed/1 failed do cooldown expectation cũ; test đã sửa để kiểm cả cooldown bằng clock, không đổi policy production.

Backend Linux full lượt kiểm tra sau DI fix: Application 456 passed, Domain 106 passed; integration 948 passed/8 failed/23 skipped, formatter passed, digital signing unit 41 passed. 8 failures là 7 assertion generic title cũ và 1 MainDraft established-account fixture. Sau sửa đã chạy lại **toàn suite** trên PostgreSQL mới: **956 passed/23 skipped/0 failed**, status `tests=0 format=0 signing=0`. Không lọc hoặc loại test khỏi lượt full. Lượt đầu trước DI fix đã dừng khi tái hiện lỗi composition; không tính là PASS. Không dùng kết quả cũ trong báo cáo Authentication làm bằng chứng mới.

| Gate tương ứng workflow                          | Kết quả mới cuối cùng                         |
| ------------------------------------------------ | --------------------------------------------- |
| Restore solution + Release solution build        | Passed, 0 warnings/errors                     |
| Application unit                                 | 456 passed / 0 failed / 0 skipped             |
| Domain unit                                      | 106 passed / 0 failed / 0 skipped             |
| Full integration, có Compact24 admin + query log | 956 passed / 0 failed / 23 skipped, 979 total |
| dotnet format verify-no-changes                  | Passed trên Windows và Linux                  |
| Digital signing unit riêng                       | 41 passed / 0 failed / 0 skipped              |
| npm ci --no-fund --no-audit                      | Passed, clean Linux install                   |
| Root ESLint + Mobile typecheck                   | Passed                                        |
| Full Owner Web Vitest                            | 427 passed / 74 files                         |
| Full Mobile Vitest                               | 1021 passed / 90 files                        |
| Owner/Public production build                    | Passed; owner bundle chunk-size warning       |
| Mobile web export, EXPO_NO_DOTENV=1              | Passed                                        |
| Full repository Prettier                         | Passed, gồm báo cáo mới                       |
| Docker build MinIO + LibreOffice                 | Passed                                        |
| Docker Compose config với .env.example           | Passed                                        |
| git diff --check                                 | Passed                                        |

23 skips là điều kiện opt-in hiện có cho models/OCR, browser và Gmail smoke, không được biến thành passed hoặc vô hiệu hóa. TRX xác nhận các test generic denial, MainDraft release/activation, cả hai DI graphs, migration CLI và Compact24 independence với real hosted services/query log đã chạy và passed.

Backend full dùng đúng lệnh workflow: `dotnet test src/backend/BHome.sln -c Release --no-build --settings tests/backend/ci.runsettings --logger trx -m:1`; signing unit chạy riêng theo workflow. Frontend dùng root `npm test`, `npm run build`, `npm run lint`, Mobile typecheck, `expo export --platform web --max-workers 2 --output-dir dist` và `npm run format:check`, không filter. Root lint/format được kiểm lại sau overlays sửa merge; source code tại thời điểm test khớp working tree cuối. Log SQL lượt cuối nằm trên filesystem Linux, tắt bind parameter logging như CI và sao chép evidence sau khi kết thúc.

Evidence ignored local: `.tmp/ci-auth-backend-final-results/` (TRX/build/format/signing/status), `.tmp/ci-auth-frontend-results/final/` (install/lint/typecheck/tests/build/export/format/status), các lượt trước trong `.tmp/ci-auth-backend-results/`, `.tmp/ci-auth-backend-v2-results/` và `.tmp/ci-final-*.log`. Không commit database dump, private test payload hoặc provider credentials.

## Giới hạn

Đây là kiểm chứng tương ứng workflow trên Linux local; GitHub Actions remote chưa được chạy từ commit sửa này. Không thể cam kết một lần chạy remote tương lai không gặp lỗi mạng/runner/provider. Web chunk-size/dependency deprecation warnings (nếu có) phải phân biệt với exit code thất bại. Không thay dependency chỉ để xóa cảnh báo ngoài phạm vi.
