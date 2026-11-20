# Nghiệm thu chuyển hostname BHOME Staging

Checkpoint ngày 20/11/2026, sau migration thành công lúc khoảng 19:33 Asia/Ho_Chi_Minh
(12:33 UTC). Kiểm tra DNS/TLS, polling và manifest tiếp tục đến 19:44.
**Hostname Staging mới đã triển khai thực tế. Production không được deploy.**
Source và deployment scripts CI/CD đã cập nhật; **chưa có lượt GitHub Actions mới
thành công chạy từ source này xuống VPS**, vì source còn chờ review/push/merge.

## 1. Hostname mới và alias cũ

| Dịch vụ        | Staging canonical hiện tại                     | Alias tương thích còn giữ                         |
| -------------- | ---------------------------------------------- | ------------------------------------------------- |
| Owner Web      | https://owner-staging.103.146.23.157.sslip.io  | https://owner-sepay-test.103.146.23.157.sslip.io  |
| Public Website | https://public-staging.103.146.23.157.sslip.io | https://public-sepay-test.103.146.23.157.sslip.io |
| API            | https://api-staging.103.146.23.157.sslip.io    | https://api-sepay-test.103.146.23.157.sslip.io    |

Production giữ nguyên Owner https://owner.103.146.23.157.sslip.io,
Public https://www.103.146.23.157.sslip.io và API https://api.103.146.23.157.sslip.io.

Dùng canonical cho truy cập/build/release mới. Alias cũ không redirect webhook POST.
Hai bundle web cũ được pin riêng cho các liên kết và phiên cũ. Cookie refresh vẫn
host-only, Secure/HttpOnly/SameSite=Strict; không mở rộng domain để chia sẻ cookie.
Lần đầu vào Owner hostname mới cần đăng nhập. Phiên tổng hợp tạo trước migration
đã được kiểm chứng tiếp tục refresh trên hostname cũ sau migration.

Public Staging vẫn là empty state vì chưa có cơ sở/phòng được Owner công bố. Không
tạo demo hoặc publish nội dung để làm smoke test pass.

## 2. Thay đổi thực tế trên VPS

- Build lại API, Owner Web và Public Web Staging từ source snapshot có checksum.
  Source backend chỉ đổi validation/defaults cho migration origins; không đổi DTO,
  schema, policy thanh toán, quyền theo vai trò/Location hoặc logic hợp đồng.
- Thêm ba hostname canonical trong Caddy, kiểm DNS/TLS trước cutover; validate trước
  reload. Các hostname blocks Production giữ nguyên byte-for-byte. Caddy không restart.
- Đổi Deployment Owner/Api/Public anchors sang canonical. AllowedHosts có đúng sáu
  hostname Staging và loopback. CORS cho Owner/Public mới+cũ; AuthWeb chỉ hai Owner.
- Bổ sung `Deployment__LegacyOwnerOrigin`, `LegacyApiOrigin`, `LegacyPublicOrigin`.
  Backend chỉ chấp nhận đúng cặp cũ/mới đã duyệt trong Staging; Production, domain
  tương tự và Public origin dùng cookie auth đều bị từ chối trong tests.
- Callback email/reset/invitation/verification và signing URL mới được sinh từ
  anchors canonical. Các route cũ vẫn proxy cùng backend để liên kết đang lưu dùng được.
- Giữ nguyên JWT signing key, issuer `BHome.Staging`, audience `BHome.Staging.Clients`,
  Data Protection mount, identity keys, DB/storage credentials, email và SePay credentials.
- Thêm `owner-web-legacy` / `public-web-legacy` trong compose.staging-compat.yml.
  Chúng giữ image/index trước migration, chỉ nối frontend và explicit edge aliases.
- Giữ nguyên Docker project/container/database/volume identifiers cũ có chữ sepay;
  migration này đổi hostname, không rename data services hoặc volumes.

| Vai trò                 | Container                   | Alias edge          |
| ----------------------- | --------------------------- | ------------------- |
| API canonical và legacy | bhome-sepay-api-stage       | bhome-stage-api     |
| Owner canonical         | bhome-sepay-owner-web-stage | bhome-owner-stage   |
| Public canonical        | bhome-sepay-stage-public    | bhome-public-stage  |
| Owner compatibility     | bhome-staging-owner-legacy  | bhome-owner-legacy  |
| Public compatibility    | bhome-staging-public-legacy | bhome-public-legacy |

Edge chỉ có năm ứng dụng và Caddy. Caddy chỉ nối bhome-vps_default và
bhome-staging-edge; không nối backend Staging. Không có alias api/owner-web/public-web
trên edge, không có PostgreSQL/MinIO trên edge. `connect-staging-edge.py` kiểm tra và
gắn lại alias sau recreate/rollback; test bắt được regression implicit Compose aliases.
Database giữ loopback port55432; MinIO và tất cả web containers không publish port.

Thứ tự Compose Staging: compose.sepay.yml → compose.sepay-stage-api.yml →
compose.sepay-stage-web.yml → compose.sepay-stage-public.yml → compose.staging-compat.yml
→ compose.sepay-stage-release.yml. Dùng hai private env files như runbook; không in
resolved config chứa credential. Active Compose đã `config --quiet` thành công.

## 3. Images và provenance

Source archive trên VPS: `/opt/bhome-deploy/hostname-d7f29ea028e11958/source.tar.gz`.
SHA256 `d7f29ea028e11958d4d571448d76fbd52d6115de6bfeb194bc7007dae27bf5fb`.
Baseline git `a370789c6008d9a31f909ff4ef920cce43c37400` + workspace changes chưa commit;
OCI labels có source repository, revision baseline, archive checksum và uncommitted=true.
Không mạo nhận là artifact từ main hoặc từ một GitHub CI run đã pass.

| Ứng dụng       | Immutable local image ID đang chạy                                      |
| -------------- | ----------------------------------------------------------------------- |
| API Staging    | sha256:9df936cc99566f4b011dd9e7dad6b4bf755fdd804016dca8fe488100536768ea |
| Owner Staging  | sha256:0c30346313e8cd9220ff5a73167f36b1ad36c743aba94ff56968a3b5f935cbb4 |
| Public Staging | sha256:76b9e2b24f5eb3bb105a34610a4d7af3a41be248d451223f6b60a3693ff4e86e |

Compose pin local IDs, không dùng latest. Docker có thể hiển thị RepoDigests cho
các local tags; đây **không phải bằng chứng đã publish GHCR**. Registry publishing
và digests từ workflow còn cần Actions run thật. API/Owner/Public mới đều kiểm OCI
labels; hai JS bundles có API canonical mới và không có ba hostname sepay-test cũ
hoặc API/Owner Production. Compatibility bundles cũ là ngoại lệ tách riêng có chủ đích.

Manifest: `/opt/bhome-deploy/hostname-d7f29ea028e11958/migration-release-manifest.json`;
bản metadata an toàn ở `.tools/bhome-staging-hostname-20261120/migration-release-manifest.json`.

## 4. DNS, HTTPS và API

Đã kiểm cả canonical, legacy và Production: DNS IPv4 đều103.146.23.157, certificate
chain/hostname hợp lệ, TLS1.3. Ba certificate canonical hết hạn
18/02/2027 11:29:12 UTC tại thời điểm kiểm tra; vẫn cần theo dõi renewal của Caddy.

| Kiểm tra                                              | Kết quả thực tế                                          |
| ----------------------------------------------------- | -------------------------------------------------------- |
| Owner canonical /login                                | PASS HTTP200                                             |
| Public canonical /locations                           | PASS HTTP200, empty state qua API thật                   |
| API canonical /api/v1/public/locations                | PASS HTTP200, JSON array rỗng                            |
| API canonical /api/v1/auth/me chưa đăng nhập          | PASS HTTP401                                             |
| Owner canonical same-origin /api/v1/auth/me           | PASS HTTP401, proxy đúng API                             |
| Public room UUID không tồn tại                        | PASS HTTP404, không fallback API sang HTML               |
| Public /api/not-a-route                               | PASS không trả SPA200                                    |
| Public API CORS Owner mới                             | PASS exact allow-origin                                  |
| Public API CORS Owner Production                      | PASS không có allow-origin                               |
| Backend Staging nhận Production Host header trực tiếp | PASS HTTP400                                             |
| Legacy Owner/Public/API                               | PASS HTTPS, lần lượt200/200/401 trên các route tương ứng |
| API public health endpoint                            | PASS404, readiness nội bộ200                             |

Evidence DNS/TLS/HTTP: network-evidence.json trong thư mục migration trên VPS và
`.tools/bhome-staging-hostname-20261120/network-evidence.json`.

## 5. Browser và SePay Test

Browser authenticated chạy trong validation container trên VPS, đọc fixture mount
read-only. Không xuất password/token/cookie ra SSH hoặc tải private storage state
về local. Private state để kiểm phiên cũ chỉ nằm trên VPS, quyền600 trong thư mục700.

| Browser case                               | Kết quả                                                      |
| ------------------------------------------ | ------------------------------------------------------------ |
| Phiên legacy được tạo trước migration      | PASS refresh200 sau migration, không đổi key/issuer/audience |
| Owner canonical desktop1440×1000           | PASS login, dashboard, reload, refresh rotation, logout204   |
| Owner canonical mobile390×844              | PASS cùng flow                                               |
| Cookie attributes/domain                   | PASS Secure/HttpOnly/Strict, host-only api-staging           |
| CSRF thiếu X-BHome-Client khi có cookie    | PASS403                                                      |
| CSRF từ Public origin                      | PASS403, Public không trở thành cookie-auth origin           |
| Token Staging gửi Production               | PASS401                                                      |
| Primary API network origins                | PASS32 desktop +43 mobile requests, chỉ api-staging          |
| Public canonical list/reload/static assets | PASS hai viewport, empty state đúng dữ liệu                  |
| CORS/TLS/mixed-content transport errors    | PASS0 ở hai viewport                                         |

Mỗi viewport có2 request ERR_ABORTED khi chủ động chuyển trang dashboard; ghi riêng
navigationAborts, không tính là lỗi TLS/CORS. Hai lượt migration đầu rollback vì
harness ban đầu coi các hủy request do navigation là lỗi truyền tải. Các assertion
chức năng login/refresh/CSRF đã chạy; sau khi tách đúng loại cancellation, lượt thứ
ba pass đầy đủ. Không bỏ hoặc nới các assertion auth/CORS/cookie/origin.

SePay giữ Enabled=true, Mode=Test, Sandbox API/credentials. Kiểm cả api-staging và
api-sepay-test: unsigned webhook401; HMAC hợp lệ với payload lỗi trả400 ở parser
**trước ReceiveAsync/persistence**, không tạo payment event giả. Probe đọc Sandbox
/transactions trả200; không tạo giao dịch tài chính. Polling tiếp tục:1807 jobs
Completed tại checkpoint, cursor SynchronizedAt=2026-11-20T12:38:02.6960186+00:00,
sau migration. Không thay cấu hình webhook ở provider; alias cũ tiếp tục phục vụ
callback đang dùng, không redirect POST.

Không gửi email hoặc thực hiện ký hợp đồng thật. Defaults/callback URL canonical
được unit test; gửi email/provider signing end-to-end NOT RUN.

## 6. Production regression

Owner/Public/API Production vẫn HTTPS và lần lượt200/200/401 trên login/locations/
auth-me. Anonymous browser desktop/mobile vẫn chỉ refresh về Owner Production,
không gọi API Staging. Production giữ lỗi/cấu hình cũ đã ghi ở checkpoint trước:
script debug localhost8400 và Public locations chưa triển khai; không sửa bằng
candidate trong nhiệm vụ này. Authenticated Production flow không chạy vì không có
tài khoản smoke được phê duyệt.

IDs, images, StartedAt và volume mounts Production giữ nguyên; API d142535fe79d,
Owner3d2aee86ca99, Public86684abb9f40, PostgreSQL6f147a013641, MinIO75ba8af78c8f,
Caddy62d7c30f656a. Không restart ứng dụng/DB/storage Production; chỉ reload Caddy
cho Staging. Production hostname blocks byte-identical. Shared Caddy certificate
volume có thêm certificate Staging; tên volume/mount không đổi. Không có lệnh ghi,
restore hoặc reset dữ liệu Production trong nhiệm vụ.

## 7. Build và test đã chạy

| Lệnh/nhóm kiểm tra trong phiên migration này                          | Kết quả                                         |
| --------------------------------------------------------------------- | ----------------------------------------------- |
| Docker API Release target api, dotnet publish                         | PASS                                            |
| Docker Owner/Public Staging, TypeScript + Vite + artifact check       | PASS2 images                                    |
| dotnet test Infrastructure.UnitTests filter EnvironmentConfiguration  | PASS33                                          |
| dotnet test Infrastructure.UnitTests với tests/backend/ci.runsettings | PASS75, có33 tests trên; không cộng trùng       |
| dotnet format Infrastructure include EnvironmentConfiguration verify  | PASS                                            |
| Owner environment/config vitest                                       | PASS29                                          |
| node --test tests/deployment/*.test.cjs                               | PASS16                                          |
| unittest discover tests/deployment                                    | PASS15                                          |
| npm run lint                                                          | PASS                                            |
| Bash syntax deploy/vps/*.sh                                           | PASS                                            |
| actionlint1.7.12 / workflow YAML                                      | PASS                                            |
| Active Staging Compose config --quiet                                 | PASS                                            |
| Browser migration before/after trên VPS                               | PASS pre-migration + legacy + desktop/mobile    |
| Production anonymous boundary browser local                           | PASS origin regression, existing gaps ghi riêng |
| Snapshot credentials/Production/data-container identity               | PASS                                            |
| Đồng bộ11 Staging release scripts và checksum                         | PASS                                            |
| Prettier các file thuộc task, git diff --check và scan credential     | PASS, 62 files trong review patch               |

Đây là các checks trực tiếp liên quan thay đổi. Không chạy lại full QA Docker suites,
Mobile/Expo, load/coverage hoặc toàn bộ integration suite trong phiên này. Kết quả
823 backend/2168 frontend của checkpoint trước là lịch sử, không được cộng làm
bằng chứng test mới. Full-workspace formatting từng vướng VPS_DEMO có sẵn; không
sửa file đó hoặc thêm vào patch task.

## 8. GitHub Actions và CD thực tế

Đã dùng quyền admin hiện có để tạo hai environment secrets Staging:
BHOME_STAGING_SSH_PRIVATE_KEY và BHOME_STAGING_SSH_KNOWN_HOSTS. Key là dedicated CI
identity có sẵn trên máy local, không phải operator key hoặc root password; kiểm
forced-command thực tế bằng whoami nhận exit126. Known-hosts lấy từ trust record
đã dùng để kết nối VPS, không dùng ssh-keyscan chưa xác minh. Secret được mã hóa
LibSodium với public key environment theo
[GitHub REST contract](https://docs.github.com/en/rest/actions/secrets#create-or-update-an-environment-secret);
chỉ GET lại tên secret, không đọc/ghi giá trị vào repo/log.

Repository variable BHOME_STAGING_CD_ENABLED=true; environment staging chỉ branch
develop. Cấu hình xác minh lại bằng GET lúc12:34:37 UTC. Không thêm key vào VPS hay
thay sshd/firewall trong phiên này. Không thay settings/secrets/flag Production.

Source release.yml build API/Owner/Public Staging bằng api-staging; Production vẫn
main + environment approval. CI trước CD, digest outputs → manifest → SSH, locks,
stale-commit/run guard, auth/health smoke và rollback giữ nguyên. Source scripts mới
đã đồng bộ vào /opt/bhome-deploy/staging và hash khớp; legacy services không bị CD
recreate khi update ba ứng dụng chính.

Remote develop vẫn05d74df548fbcb185ab546bb887369ebc62b660c; main vẫn
6bd145e796dd7e4a43990648abd2146ab74e249f, chỉ README.md. Workspace giữ
feature/cd-staging-production/QHuy và các thay đổi/worktree có sẵn. Không commit,
push, merge hoặc bypass protection. Cần review source và đưa lên nhánh member thích
hợp trước PR. GitHub Actions run cho source mới: **PENDING**.

GHCR image job có packages:write bằng GITHUB_TOKEN, nhưng chưa có run publish mới.
Credential Git cá nhân trước đó thiếu write:packages; không tự mint token/quyền mới
để publish candidate thủ công. Images migration được build và pin local; không báo
đã publish registry. Production CD commissioning/SSH secrets vẫn PENDING và ngoài
phạm vi deploy lần này. Không bật SePay Live hoặc deploy Production để kiểm pipeline.

## 9. Backup, rollback và an toàn thông tin

Baseline audit: `/opt/bhome-backups/staging-hostname-audit-20261120T121347-1JXp/`.
Lượt thành công: `/opt/bhome-backups/staging-hostname-migration-20261120T123259-pItS/`.
Lượt trước giữ lại tại122728-RSCJ và123032-t71V, có rollback logs.
Mỗi lượt có custom DB dump/list, restore vào DB kiểm chứng **mới**, storage mirror/diff,
private configs, Caddy trước/sau, protected container snapshot và safe evidence.
Không restore đè live DB, không down/prune/remove volume/EnsureCreated/migration/seed.

Hai lượt rollback đã thực sự khôi phục API/Owner/Public images và cấu hình trước đó,
gắn lại explicit edge aliases, reload Caddy và kiểm HTTPS cũ. Không rollback database;
auth/jobs data vẫn được giữ. Backups/images cũ và hai legacy services không bị xóa.

Nếu cần rollback sau bàn giao: tạm tắt flag CD để không deploy canonical trong lúc
khôi phục; chọn đúng backup trước migration, khôi phục các Compose/env/Caddy files,
validate rồi application-only up --no-deps --no-build
--pull never, gắn explicit aliases, reload Caddy và smoke old URLs. Không restore
đè DB. Giữ helper năm explicit aliases nếu hai legacy containers còn trên edge;
không dùng helper cũ chỉ nhận ba containers trong topology năm ứng dụng. Scripts
snapshot chỉ khôi phục cùng topology phù hợp. Thực hiện có kiểm tra state hiện tại;
không chạy lại worker migration đã PASS.

Runbook và evidence root: `/opt/bhome-deploy/hostname-d7f29ea028e11958/`.
Browser private state giữ riêng trên VPS; chỉ safe JSON statuses và ảnh Public empty
state được tải về .tools/bhome-staging-hostname-20261120. Không xuất secret VPS.

Sự cố xử lý đầu vào: lượt đọc attachment đầu đã hiển thị trường credential trong
output công cụ. Đã nhận lỗi và dừng đọc thô; không ghi password vào source/.env/
scripts/Git/báo cáo hoặc deploy logs, không thay root password. Các lượt sau lọc
metadata và đọc credential cần thiết chỉ trong bộ nhớ/VPS đúng phạm vi.

## 10. Files và phần còn chờ

Thay đổi của migration, trên nền dirty tree từ nhiệm vụ trước:

- Backend: EnvironmentConfiguration.cs — bridge origins Staging có giới hạn, defaults
  email trusted legacy Owner nhưng links mới canonical; EnvironmentConfigurationTests.cs
  — positive compatibility, Production/lookalike rejection, Public CSRF origin rejection.
- Frontend/build: packages/client-core/viteEnvironment.ts; Owner/Public .env.staging.example;
  Verify-WebArtifact.cjs; Owner environment tests; deployment artifact tests. Bundle mới
  chỉ nhận canonical, Production từ chối cả hostname Staging mới và legacy.
- VPS/CI: release.yml, Caddyfile.example, compose.staging-public.example.yml,
  compose.staging-compat.example.yml, connect-staging-edge.py, release-safety.py,
  deploy-release.sh, smoke-release.sh, smoke-auth.py và test_release_safety/test_staging_edge.
- Browser: Test-StagingBrowser.cjs chuyển sang fixture file trên VPS, không export qua
  SSH; Test-StagingHostnameBrowser.cjs mới; Test-PublicBrowser.cjs dùng canonical.
- Docs: access note, team setup, Staging/Production runbooks, Docker README, URL
  inventory. Historical acceptance reports chỉ thêm ghi chú/link migration, không
  thay hostname hoặc bằng chứng lịch sử bên trong.

Các phần còn chờ: review/push/merge source và run GitHub CI/CD thật; GHCR publish/
digest từ run đó; main nhận source ứng dụng trước Production release; Production
commissioning/approval riêng. Không gọi CI/CD hoàn tất khi các mục đó chưa được kiểm.
Owner tự quyết định công bố dữ liệu Public. Không cần quyền VPS bổ sung cho phần
migration đã làm; không có yêu cầu deploy candidate Production trong báo cáo này.

Bản diff để review: `.tools/bhome-staging-hostname-20261120/review.patch` (đồng bộ
thêm tại `.tools/bhome-vps-session/review.patch`). Patch gồm các thay đổi CI/CD từ
nhiệm vụ trước và migration này; không gồm file VPS_DEMO có sẵn ngoài phạm vi.
