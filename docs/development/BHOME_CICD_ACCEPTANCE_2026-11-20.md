> Checkpoint mới nhất: [migration hostname Staging 20/11/2026](BHOME_STAGING_HOSTNAME_MIGRATION_2026-11-20.md). Canonical dùng owner-staging/public-staging/api-staging; secrets Staging đã thiết lập. Bằng chứng cũ bên dưới được giữ nguyên theo thời điểm kiểm tra.

# Nghiệm thu CI/CD BHOME — 20/11/2026

Kết quả của nhiệm vụ MASTER TASK: đã triển khai và kiểm tra phần Staging được ủy quyền,
chuẩn bị source/config/artifacts Production. **Chưa hoàn tất CD end-to-end**: chưa
được phép push/merge source mới, thiếu GitHub SSH secrets, chưa có run GitHub → VPS
hoặc lượt approval/deploy Production của workflow mới. Không deploy Production.

## A. Git và CI/CD

| Nội dung                 | Trạng thái                       | Bằng chứng                                                                                                                             |
| ------------------------ | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Remote develop           | PASS kiểm tra                    | `05d74df548fbcb185ab546bb887369ebc62b660c`, git ls-remote cuối phiên                                                                   |
| Remote main              | BLOCKED release hiện tại         | `6bd145e796dd7e4a43990648abd2146ab74e249f`, chỉ có README.md                                                                           |
| Workspace                | Giữ nguyên                       | branch `feature/cd-staging-production/QHuy`, HEAD `a370789c6008d9a31f909ff4ef920cce43c37400`                                           |
| Thay đổi có sẵn/worktree | PASS bảo toàn                    | Không checkout/reset/clean/commit/push/merge; giữ worktree detached và file VPS_DEMO có sẵn                                            |
| CI source                | PASS validation, PENDING Actions | ci.yml thêm push main, release sau backend/frontend; release.yml reusable build/deploy; production-plan.yml chỉ main, không deploy     |
| Image jobs               | PENDING chạy CI mới              | API/Owner/Public từ cùng triggering SHA; riêng frontend Production; OCI revision/source; build outputs digest → release manifest → SSH |
| Staging CD               | PENDING                          | develop push-only, environment staging, flag BHOME_STAGING_CD_ENABLED; chưa có secrets/run thật                                        |
| Production CD            | PENDING                          | main push-only, required-reviewer gate, environment production, riêng key; chưa enable/commission/deploy                               |
| GitHub quyền hiện có     | PASS kiểm tra                    | REST API trả repository public và quyền admin; secret-name lookup Staging rỗng, repository SSH secret names thiếu                      |
| Production protection    | PASS cấu hình, PENDING run       | required reviewer nguyenhuy238, main-only branch policy, admin bypass false; REST PUT rồi GET/validator                                |
| GHCR candidate publish   | BLOCKED                          | Registry trả permission_denied, token không có expected scopes; không có candidate registry digest                                     |

CI thành công lịch sử trên develop:
[run 44672231019](https://github.com/nguyenhuy238/SEP490-G92-BHOME/actions/runs/44672231019),
SHA05d74. **Không dùng run này để tuyên bố workflow/source mới đã pass.**
Các thay đổi phải được review và chuyển lên nhánh `member/<tên>` theo AGENTS trước
commit/push/PR; phiên này giữ nguyên branch đang có để bảo toàn workspace.

## B. Staging đã triển khai

| Thành phần          | Trạng thái                                | Giá trị/bằng chứng                                                                                                                      |
| ------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Owner HTTPS         | PASS                                      | https://owner-sepay-test.103.146.23.157.sslip.io                                                                                        |
| Public HTTPS        | PASS                                      | https://public-sepay-test.103.146.23.157.sslip.io                                                                                       |
| API HTTPS           | PASS                                      | https://api-sepay-test.103.146.23.157.sslip.io                                                                                          |
| API / Owner         | PASS                                      | bhome-sepay-api-stage / bhome-sepay-owner-web-stage, giữ images registry SHA05d74                                                       |
| Public              | PASS                                      | bhome-sepay-stage-public, Nginx8080, không publish port                                                                                 |
| PostgreSQL          | PASS giữ nguyên                           | bhome-sepay-vps-stage; DB bhome_compact24_dev_f723d9c0ff6acd3c4cce870df1e72989; volume bhome-sepay-stage_sepay-data                     |
| Storage riêng       | PASS                                      | bhome-sepay-stage-minio, bucket bhome-staging-private private, volume bhome-sepay-stage_stage-storage; không publish port               |
| JWT/data protection | PASS isolation                            | Signing key/Data Protection giữ nguyên, khác Production; issuer/audience Staging đổi thành BHome.Staging/BHome.Staging.Clients          |
| SePay               | PASS cấu hình/auth boundary               | Enabled=true, Mode=Test; testing-context200; unsigned webhook401; giữ credentials. Provider callback mới chưa phát sinh trong phiên này |
| Email/signing URLs  | PASS config, PENDING delivery/signing E2E | Anchors Staging riêng; không bật SMTP, không gửi email/ký cho người thật                                                                |

Public source trước nhiệm vụ chỉ có trang Welcome, link /locations bị chuyển về home.
Đã thêm danh sách/chi tiết cơ sở, danh sách/chi tiết phòng, ảnh public, tiện ích,
giá tham khảo/tình trạng backend trả về, loading/empty/error/404. Chỉ dùng các endpoint
GET `/api/v1/public/*` hiện có; không thêm API, booking/payment/contact form hoặc
thu thập Guest data. Sửa HTML lang/title; dùng MUI và dependencies hiện có.
tsconfig bỏ erasableSyntaxOnly để dùng API client chung có parameter properties.

**Dữ liệu thật của Staging hiện chưa có nội dung được công bố.** Live test kiểm
empty/404 và GET thật; positive UI test cơ sở/phòng/ảnh/giá dùng responses tổng hợp,
ghi riêng SYNTHETIC_UI_CONTRACT. Không tự publish nội dung demo. Chưa chứng minh
ảnh/phòng đã công bố từ database live, vì chưa có bản công bố được Owner duyệt.

## C. Production và phân tách môi trường

URLs: Owner https://owner.103.146.23.157.sslip.io,
Public https://www.103.146.23.157.sslip.io,
API https://api.103.146.23.157.sslip.io.

Audit bundle Production đang chạy thấy Owner origin Production, không thấy hostname
api-sepay-test. Vì vậy không khẳng định ảnh lỗi lịch sử do bundle hiện tại hardcode
Staging. Phát hiện Caddy nhìn thấy alias Compose trùng giữa hai mạng (đặc biệt
owner-web); khi thêm edge Staging đã tái hiện Production API bị phân giải sang API
Staging và Host filter trả400. Kiểm tra này phát hiện trước nghiệm thu; đã sửa bằng
alias edge duy nhất, không sửa Production hostname blocks.

Topology cuối: Caddy chỉ nối bhome-vps_default + bhome-staging-edge. API Staging ở
backend riêng; Owner/Public ở frontend riêng; chỉ explicit alias bhome-stage-api,
bhome-owner-stage, bhome-public-stage lên edge. Không dùng implicit api/owner-web/
public-web alias trên edge. PostgreSQL/MinIO Staging không nằm trên edge. Tests mới
bắt regression này; connect script chạy sau recreate và rollback.

Anonymous browser desktop1440/mobile390 hiện cho thấy Production refresh chỉ gọi
`https://owner.103.146.23.157.sslip.io/api/v1/auth/refresh`; reload vẫn đúng, không có
service worker. Stage token gửi Production bị401. Authenticated Production
login/refresh/logout **PENDING**, chưa có tài khoản smoke được duyệt.

Các tồn tại live Production: script debug `http://localhost:8400/live.js` thất bại;
Public Welcome có link cơ sở chưa hoạt động. Candidate đã bỏ debug script và có
Public pages; chưa thay live Production. Không nới CORS/CSRF/cookie/TLS để che lỗi.

Container IDs/image IDs/StartedAt Production giữ nguyên trước/sau; Caddy chỉ reload,
Production hostname blocks byte-identical. Không restart/deploy API/Owner/Public/
PostgreSQL/MinIO Production, không đổi credentials hoặc bật SePay Live.

| Production image | Image ID hiện tại                                                       |
| ---------------- | ----------------------------------------------------------------------- |
| API              | sha256:96317a4e36379963c20e6cad0bc9b811c3a31bbddb6e10408a0703bfc974a0c0 |
| Owner            | sha256:d8e21f88e493fd741567d1e295e638325c90acd2045cc50c073c4de8fac3a9c6 |
| Public           | sha256:d47c2cfec0bff3a106737dd658d87b125e5ad6ebae0a7299bd4fb28debe9394a |

Đây là local image IDs; image demo cũ không có registry digest/provenance BHOME
đáng tin cậy. Không gọi inherited nginx OCI revision là commit BHOME.

## D. Artifacts và kiểm thử

Docker Web.Dockerfile build thực tế trên VPS cho ba candidates, source archive
`/opt/bhome-deploy/candidates/90f4e3acfcefe933/source.tar.gz`, SHA256
`90f4e3acfcefe9331a4feb029c91fe620e6cff23476bcf1a67f0eb9632a73bbc`.
Source gồm baseline a370789c + workspace changes chưa commit. OCI bổ sung archive
hash/uncommitted=true, metadata revision ghi baseline; **không phải release main**.

| Candidate         | Local immutable image ID                                                | Trạng thái            |
| ----------------- | ----------------------------------------------------------------------- | --------------------- |
| Public Staging    | sha256:79f6791d6295afa3d819654a73f4af093f12c69961e67375fdbd4adf5a5fcabe | Đã chạy, pin local ID |
| Owner Production  | sha256:ec73499f0434370c619f8405e200e223893cd6f9c3a57c31e5925eced81a0b35 | Build, chưa deploy    |
| Public Production | sha256:2575e7d1d956275e5a96a8d5e268d282911d1d9f167bc6257da3374aa75991ba | Build, chưa deploy    |

GHCR candidate push đã thất bại do scope; RepoDigests chưa có. Registry digest pin
cho các release mới được thực hiện trong workflow, còn cần run thật. API/Owner live
Staging giữ registry digests lần lượt c833ee2be10627f3bb3343562139d1f72d24254a7062860272ec10dcd0ba15b6
và 6dab7c99c68a3b562bcf956b4ce89c53404d0b97bbc44153a640cd15aeeed5bb, SHA05d74.

| Kiểm tra đã thực thi                                         | Kết quả                                                                                                                |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| dotnet build BHome.sln Release no-restore                    | PASS, 0 warnings/errors                                                                                                |
| Domain.UnitTests                                             | PASS114                                                                                                                |
| Application.UnitTests                                        | PASS640                                                                                                                |
| Infrastructure.UnitTests theo tests/backend/ci.runsettings   | PASS69                                                                                                                 |
| EnvironmentConfiguration filter riêng                        | PASS27, đã nằm trong69; không cộng trùng                                                                               |
| Infrastructure toàn bộ không filter                          | FAILED155, PASS69:155 QA-SrsUnit cần Testcontainers, Docker local đang tắt                                             |
| npm test Owner/Mobile                                        | PASS810 +1358 =2168;112 +128 files                                                                                     |
| Node deployment tests                                        | PASS13                                                                                                                 |
| Python deployment tests                                      | PASS15, gồm8 guards hiện hành +7 legacy bootstrap                                                                      |
| Bash syntax, YAML parse, actionlint1.7.12                    | PASS                                                                                                                   |
| Docker build ba Web candidates                               | PASS, logs tại candidate folder                                                                                        |
| npm run build + hai bundle Staging artifact checks           | PASS; warning chunk Owner >500kB hiện hữu                                                                              |
| npm run lint / Mobile typecheck                              | PASS                                                                                                                   |
| npm run format:check toàn workspace                          | FAILED: file untracked VPS_DEMO_UBUNTU_24.md có sẵn chưa format; giữ nguyên, không đưa vào patch task                  |
| Docker build thiếu API origin / sai Production origin        | PASS rejection; build bị từ chối thật, không chỉ unit mock                                                             |
| Owner browser Staging desktop/mobile                         | PASS login/refresh rotation/logout/profile, secure cookie, no transport/CORS errors, Production rejects token401       |
| Public browser desktop/mobile                                | PASS live empty/404/HTTPS/GET-only; positive fixture content/photo/price/error/reload/responsive, không form           |
| Production browser desktop/mobile                            | PASS anonymous API origin; FAILED localhost debug request; Public locations chưa hoạt động; authenticated flow PENDING |
| Private storage put/get, private policy, mirror/diff         | PASS, trên VPS Staging riêng                                                                                           |
| Staging Public rollback rehearsal                            | PASS:503 → smoke fail → restore → smoke pass; không recreate API/Owner/data services                                   |
| Full integration/Expo export/load/coverage/security campaign | NOT RUN trong phiên này; full CI mới PENDING                                                                           |

Full npm test có cảnh báo jsdom canvas chưa implement trong các test ký hiện hữu,
nhưng test result thành công. Lượt Infrastructure thăm dò dùng sai phạm vi CI đã
thất bại vì Docker tắt; chạy lại bộ lọc CI hiện có đạt69. Không đổi filter để che lỗi.
Các lệnh formatter lần đầu có lỗi parser nginx.conf; đã loại file không hỗ trợ khỏi
lệnh formatter. Đây không phải kết quả test ứng dụng thất bại.

## E. Database, backup và rollback

Hai DB kiểm read-only cùng24 bảng/390 cột/85 FK. Column/type/null/default signature
sort theo table_name,column_name khớp:
`96a7740a86ed9539c238c3c6dd1ffc8e6e8d76c1093ebbf6803bf2c887332854`.
Signature theo ordinal khác do thứ tự cột vật lý, không phải khác tập cột. Counts/
signature này chưa thay candidate-specific constraint/index verifier Production.
Không chạy migration, EnsureCreated, seed, restore đè hoặc xóa dữ liệu/volume.

Evidence VPS:

- Public install thành công: `/opt/bhome-backups/public-staging-20261120T093010-vfA9/`;
  custom dump/list, restore DB mới bhome_public_verify_<UTC> (tên chính xác trong install.log), config/Caddy backup.
- Các lượt trước tự rollback do mc là directory và JWT issuer/audience default
  dùng chung; sau khi sửa binary path và tách issuer/audience mới nghiệm thu.
- `/opt/bhome-backups/staging-edge-*/`: diff topology; lượt đầu timeout/502 trong
  chuyển mạng được ghi lại. Final smoke/browser sau readiness đã pass.
- Public rollback: `/opt/bhome-backups/public-rollback-*/rehearsal.log` có
  EXPECTED_SMOKE_FAILURE và PUBLIC_ROLLBACK_PASS; API/Owner IDs/StartedAt trước/sau khớp.
- Storage backup: `/opt/bhome-backups/storage-verification-20261120T094927-S85r/`;
  mirror và source diff pass. Synthetic probe object được giữ lại trong deployment-probes.
- Release tools backup: `/opt/bhome-backups/release-tools-*/`; scripts root-owned
  `/opt/bhome-deploy/staging/` và `/opt/bhome-deploy/production/`.
- Candidate build logs, missing-origin/cross-environment rejection logs và failed
  registry push log ở candidate folder; private registry login tạm đã được xóa.

Production config overrides đã chuẩn bị và compose config --quiet thành công,
nhưng chưa apply: compose.production-environment.yml và compose.production-release.yml
pin image IDs hiện tại. Schema baseline/legacy image ID chỉ là files .proposed;
không có ENABLED_AFTER_REVIEW, không cài Production CI key. CD fail closed trước
khi vận hành duyệt commissioning. Không có backup/restore Production mới được thực hiện.

CI release code có flock, worker tmux, stale-branch/run guard, immutable image
validation, backup DB/config/storage, application-only up và trap rollback.
**Chưa chạy live cả ba image qua script mới**, vì cần artifacts/secrets/approval
GitHub. Diễn tập Public không được dùng để tuyên bố full-release rollback đã pass.
Backup storage mirror không là snapshot xuyên DB/storage nguyên tử khi có ghi đồng thời.

## F. Việc cần chủ dự án thực hiện

1. Review diff và cho phép commit/push lên member/QHuy, PR develop; không cần cho phép
   deploy Production để review source. Giữ nguyên các thay đổi/worktree hiện có.
2. Nhập hai secrets environment staging: BHOME_STAGING_SSH_PRIVATE_KEY (key CI riêng,
   không operator key) và BHOME_STAGING_SSH_KNOWN_HOSTS đã xác minh. Sau review bật
   repository variable BHOME_STAGING_CD_ENABLED=true.
3. Chạy merge/push develop thật qua CI/GHCR/VPS, nghiệm thu ba digests/manifest,
   deployment và rollback workflow. Nếu GHCR packages private, cấp credential
   chỉ-read-packages trên VPS; không lưu token trong Git. Candidate publish thủ công
   chỉ cần nếu muốn publish artifacts chưa phải release; hiện credential thiếu scope.
4. Review/merge mã ứng dụng và workflow sang main; main hiện chỉ README. Sau đó
   build Production từ main mới. Không promote frontend Staging.
5. Duyệt commissioning theo Production runbook, key/secrets Production riêng,
   tài khoản smoke tổng hợp và schema compatibility. Bật Production CD sau review;
   kiểm lượt gate thật. Mỗi release vẫn cần nguyenhuy238 approve environment job.
6. Nếu muốn live Public có dữ liệu: Owner duyệt/publish nội dung phù hợp và ảnh qua
   API/UI quản trị; không dùng fixture browser làm nội dung thực tế.

Quyền VPS đủ cho phần được ủy quyền. Không lưu root password vào source/log; dùng
operator SSH key đã có. Không đổi Production credentials, không giao dịch tiền thật.

## Tệp thay đổi và bàn giao

- Workflows: ci.yml, release.yml, production-plan.yml.
- Build/proxy: deploy/docker/Web.Dockerfile, nginx.conf, README.md;
  deploy/vps/Caddyfile.example, compose.staging-public.example.yml,
  compose.production-environment.example.yml; Api.Release.Dockerfile là phần có sẵn
  chưa commit được giữ lại từ phiên trước.
- Release scripts: deploy-release.sh, run-release.sh, release-safety.py,
  connect-staging-edge.py, backup-storage.py, smoke-auth.py, smoke-release.sh,
  wrappers Staging/Production và forced SSH entries. staging-safety.py giữ cho lịch sử
  bootstrap; code mới dùng release-safety.py.
- Frontend: packages/client-core/viteEnvironment.ts; Owner environment tests/examples;
  Public service/pages/router/layout/home/index/tsconfig và environment examples.
  Owner index.html cleanup và DatabaseUpgrade/Program.cs là thay đổi có sẵn đã giữ lại.
- Tests: tests/deployment/_.py/_.cjs; scripts/Verify-WebArtifact.cjs,
  Verify-ProductionGate.cjs, Test-StagingBrowser.cjs, Test-PublicBrowser.cjs,
  Test-ProductionBoundary.cjs.
- Docs: biên bản này, runbooks Staging/Production, team guide, environment validation;
  biên bản VPS cũ được giữ nguyên lịch sử và thêm link checkpoint mới.

Evidence local ở .tools/bhome-vps-session, .tools/staging-browser,
.tools/public-browser; không commit ảnh/log/credential private. Source gốc SRS nằm
trong docs/reports; phiên này triển khai theo MASTER TASK/AGENTS và public DTO hiện
có, không giải quyết lại các policy conflict SRS về tiền/ký/residence.

Kiểm tra bàn giao cuối: 55 file thuộc task format PASS và git diff --check PASS;
full-workspace format vẫn FAILED do VPS_DEMO có sẵn được giữ ngoài patch. Staging
CI key thực tế từ chối whoami bằng exit126; metadata protection Production có thể
đọc công khai HTTP200, không cần đưa PAT admin vào workflow gate. Gate thực tế vẫn
chưa có run approval. Patch đầy đủ (gồm file mới) ở .tools/bhome-vps-session/review.patch,
danh sách tệp chính xác ở changed-files.json cùng thư mục; không có commit/push/PR mới.
