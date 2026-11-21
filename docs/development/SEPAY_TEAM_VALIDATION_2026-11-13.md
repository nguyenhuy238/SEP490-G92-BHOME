# Kiểm chứng chuẩn hoá SePay cho team — 13/11/2026

## Phạm vi

Nhánh `member/QHuy`, bắt đầu từ `a58471a`, working tree ban đầu sạch. Yêu cầu là chuẩn hoá
khởi chạy/configuration/fixture và kiểm tra trước PR, không push hoặc merge. Truy vết BF-06,
UC-22/23/25, GBR-10/18, JOB-03. Không thay đổi business API, permission, allocation, invoice
state, signing policy hoặc schema. Production auth không thay đổi.

## Thay đổi có thể dùng lại

- `.env.sepay.example`, initializer tạo profile với credential ngẫu nhiên, Docker Compose
  PostgreSQL riêng, cổng cố định và named volume; không ghi đè `.env`/Neon/profile có sẵn.
- `Start-SePaySandbox.ps1`: chỉ Test + loopback + database GUID, chờ PostgreSQL qua TCP
  để không nhầm server tạm trong giai đoạn init; có thể đồng bộ port container cũ được chỉ định.
  Chạy đúng source công cụ schema/seed hiện hành, không gọi executable cache cũ.
- `SePaySandboxSeed`: dữ liệu tổng hợp có guard database/environment, marker demo, receiving
  binding, hai Tenant entitlement và BH registry; chạy lại giữ nguyên password, code và tiền.
  Bộ seed chỉ chuẩn bị preconditions test, không phải workflow activate/sign/settle thực.
- Connection checker trả exit lỗi nếu binding thiếu/sai. Webhook probe kiểm tra cả HTTP 401
  và mã `sepay_authentication_failed`; không ký hoặc tạo một payment để probe kết nối.
- Workflow CI thêm PowerShell configuration checks không mạng và Compose template validation;
  PostgreSQL health check dùng TCP. Trigger PR/workflow_dispatch và quyền contents:read giữ nguyên.
- Sửa test fixture `ApiFactory` để signing key ngẫu nhiên ổn định trong cùng một factory khi
  compose host con, vẫn khác giữa các factory. Hai lỗi 401 tái hiện ở MainDraft PDF và migration
  handover xuất phát từ fixture tự đổi key, không phải lỗi authorization cần bypass.
- Cập nhật đúng nhãn cảnh báo QR thử nghiệm trong regression Mobile; các assert amount, copy,
  server-confirmed Paid và ẩn QR được giữ. Định dạng lại riêng biên bản SePay cũ mà full Prettier
  chỉ ra, không sửa nội dung nghiệp vụ.

## Môi trường kiểm tra và cách tách bằng chứng

Windows, .NET SDK 8, Node 22.23.4, npm và Docker Linux engine. Một worktree detached sạch được
tạo từ HEAD và nhận đúng các tệp source/template sửa; không copy `.env`, token, user credentials,
`.tmp` hoặc node_modules từ máy tác giả. `npm ci --no-fund --no-audit` cài mới 900 packages.
Backend CI dùng PostgreSQL 16 disposable riêng với SQL log đã tắt bind parameter logging,
không dùng connection string làm việc hoặc database SePay đã Paid của người dùng.

Các lệnh theo `.github/workflows/ci.yml`: restore/build Release, build MinIO/LibreOffice image,
full solution tests với `ci.runsettings`, dotnet format, signing unit tests; npm lint/typecheck,
Owner/Mobile test suites, toàn bộ frontend build, Expo export với API URL tổng hợp và
EXPO_NO_DOTENV=1, full format:check và hai Compose config checks. Không nới timeout, bỏ test,
suppress exit code hoặc đưa SePay token thật vào CI.

## Kết quả đã thực thi

| Kiểm tra                                                   | Kết quả                                                                                                                         |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Focused SePay API/integration/seed                         | 29 passed, 0 failed, 0 skipped trên DB disposable                                                                               |
| Ba regression backend 401/worker sau sửa fixture           | 3 passed, 0 failed, 0 skipped                                                                                                   |
| Script parsing/configuration/no-overwrite/Test-only guards | PASS trên Windows PowerShell 5 và PowerShell 7.4 trong container Ubuntu 22.04                                                   |
| Fresh profile → Compose → schema → seed → real API         | PASS; Owner login, Location, Invoice, Test context và QR PNG/BH được kiểm tra                                                   |
| Seed replay                                                | created=False, cùng BH code; integration test giữ password hash và verified allocation 2.500.000 VND                            |
| Container restart và stale-port correction                 | PASS; giữ cổng cố định, chỉ sửa Port trong profile, không đổi secrets                                                           |
| Public connectivity probe                                  | Health 200, unsigned webhook 401 + sepay_authentication_failed; không chứng minh SePay signed delivery                          |
| Clean npm ci, lint, Mobile typecheck                       | PASS                                                                                                                            |
| Full Owner Web suite                                       | 435 passed, 0 failed                                                                                                            |
| Full Mobile suite sau cập nhật nhãn warning                | 1025 passed, 0 failed                                                                                                           |
| Frontend build và Expo web export                          | PASS; còn cảnh báo Vite chunk >500 kB và Node NO_COLOR/FORCE_COLOR                                                              |
| Full Prettier + Compose configs                            | PASS sau sửa format biên bản SePay cũ                                                                                           |
| Full backend lần xác nhận cuối                             | Application UT 463, Domain UT 106, Integration 978 passed; 0 failed; 23 integration opt-in skipped; integration 10 phút 37 giây |
| Backend dotnet format verify và CI script checks           | PASS trên source cuối                                                                                                           |
| Digital signing unit suite                                 | 41 passed, 0 failed, 0 skipped                                                                                                  |

Tổng full backend + signing không trùng: **1588 passed, 0 failed, 23 skipped**. Frontend:
**435 Owner Web + 1025 Mobile passed**, 0 failed. Các gate local theo workflow đã hoàn tất.
23 skipped thuộc các test opt-in OCR model, Gmail/browser; không có test SePay/seed bị skip.
Restore/build Release đạt, không warning/error ở lần build cuối. Hai Docker image integration
(MinIO và LibreOffice) được build thành công. Không có SePay token thật trong các test CI.

Không cộng focused/repeated test runs vào tổng full suite. Lượt chạy đồng thời đầu tiên ghi nhận
timeout ở một test route Owner; chạy riêng, cùng assertion/timeout không đổi, đạt toàn bộ 435.
Full Mobile phát hiện một expectation câu warning cũ; cập nhật theo yêu cầu UI đã được duyệt,
sau đó đạt toàn bộ 1025.

Lượt backend đầu đạt Application UT 463 và Domain UT 106; integration 974 pass / 4 fail / 23 skip.
Hai 401 dẫn đến sửa signing key của fixture. Worker deadline đạt khi chạy focused, không sửa
timeout. SQL independence check ban đầu thiếu dữ liệu do cách thu log local chậm; lần xác nhận
dùng capture stream trực tiếp, tương đương `docker logs --follow > file` của CI. Một lượt dựng
PostgreSQL mới bắt được race Unix-socket readiness trong giai đoạn init; đã chuyển sang TCP.
Các lỗi của harness local không được ghi thành bằng chứng green CI.

Sau sửa fixture và capture log, chạy lại **toàn bộ** solution test đạt 978 integration test,
bao gồm SQL independence và worker deadline, không chỉ chạy lại riêng các test từng lỗi.
Full `dotnet format --verify-no-changes --no-restore` và signing suite sau đó cũng đạt.
PowerShell checks chạy thêm trên image Microsoft PowerShell 7.4/Ubuntu 22.04; đây là kiểm tra
cross-platform của script, không phải tuyên bố đã chạy GitHub Actions.

Kiểm tra known local credentials trên toàn bộ tracked source và staged diff không thấy token,
webhook secret, JWT key, database password hoặc mật khẩu fixture private bị commit. Tên access-key
local công khai do `Initialize-Local.ps1` tự sinh là định danh mẫu, không được coi là mật khẩu private.

Log/TRX và checkout kiểm tra thuộc `.tools/sepay-team-validation` và worktree tạm, được Git ignore.
Không commit raw payload, mật khẩu fixture, token, log SQL hoặc kết quả tài chính private.

## Giới hạn và bước PR

Chưa push, merge hoặc chạy GitHub-hosted Ubuntu workflow trong tác vụ này. Kết quả local không
thay kết quả CI thực của PR. Workflow hiện chạy khi PR tới main/develop/release hoặc dispatch;
push nhánh member đơn lẻ không tự chạy CI. Mở PR tới develop và chờ review + CI thực trước merge.

Không đo coverage, p95, load hoặc OCR accuracy. Các test opt-in cần OCR models, browser hoặc
Gmail credentials không được coi là đã chạy nếu runner ghi skip. Signed delivery từ Dashboard
SePay và mobile native acceptance vẫn là bước riêng; polling đã settlement không chứng minh
webhook đã tới. Xem [Team Setup](SEPAY_TEAM_SETUP.md) cho cách tạo profile riêng và checklist.

## Commit của lượt chuẩn hoá

| Commit                   | Nội dung                                                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `2af8aad`                | feat(sepay): add reproducible team sandbox setup — template, private profile, Docker launcher, replay-safe fixtures và probes                     |
| `dab360e`                | fix(ci): stabilize composed auth fixtures and sandbox readiness — sửa fixture JWT, TCP readiness, warning expectation, CI gates và format runbook |
| Commit chứa biên bản này | docs(sepay): publish team setup and verified CI handoff — hướng dẫn clone mới và bằng chứng đã thực thi                                           |

Không push/merge. Hash commit tài liệu cuối lấy bằng `git log -1 --oneline`; không tự ghi hash
chưa tồn tại vào chính commit. Backend/ngrok và database Sandbox hiện có của người dùng không bị
reset. Container/profile smoke mới và worktree/log kiểm chứng là artifact local bị Git ignore.
