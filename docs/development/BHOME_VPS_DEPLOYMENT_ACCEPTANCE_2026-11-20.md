> Checkpoint mới nhất: [migration hostname Staging 20/11/2026](BHOME_STAGING_HOSTNAME_MIGRATION_2026-11-20.md). Canonical dùng owner-staging/public-staging/api-staging; secrets Staging đã thiết lập. Bằng chứng cũ bên dưới được giữ nguyên theo thời điểm kiểm tra.

> Checkpoint mới hơn: [nghiệm thu CI/CD develop/main](BHOME_CICD_ACCEPTANCE_2026-11-20.md). Public Staging/storage/edge network đã thay đổi; nội dung dưới đây giữ làm lịch sử.

# Biên bản triển khai và checkpoint VPS — 20/11/2026

Checkpoint hạ tầng **13:54:37 Asia/Ho_Chi_Minh** (`06:54:37 UTC`). Thực hiện trên VPS thật.
Đối chiếu bổ sung lúc **14:19 ngày 20/11/2026** đã xác nhận callback do SePay gửi.
Workflow CD source mới trên GitHub vẫn chưa được nghiệm thu.

Quy ước: PASS = đã chạy và có bằng chứng; PENDING = đã chuẩn bị, còn kiểm chứng;
NOT DONE = chưa thực hiện; FAILED = lỗi còn mở; BLOCKED = thiếu quyền/khả năng tiếp tục.
Không có lỗi deployment còn mở sau các lượt sửa và rollback dưới đây.

## A. Hạ tầng

| Hạng mục           | Trạng thái | Bằng chứng                                                                                                      |
| ------------------ | ---------- | --------------------------------------------------------------------------------------------------------------- |
| SSH VPS            | PASS       | Key đăng nhập qua phiên mới, alias `bhome-vps`                                                                  |
| Key operator       | PASS       | `C:\Users\Admin\.ssh\id_ed25519_bhome`; append public key, không ghi đè authorized_keys                         |
| Key CI riêng       | PASS       | `id_ed25519_bhome_staging_ci`; forced command; lệnh `whoami` bị từ chối exit126; lệnh release hợp lệ thành công |
| SSH agent          | NOT DONE   | Windows service Disabled/Stopped; key authentication đã hoạt động không cần agent; không đổi sshd               |
| Docker / Compose   | PASS       | Server 29.10.0, Compose 5.8.0                                                                                   |
| PostgreSQL         | PASS       | 16.16; hai container healthy, hai volume riêng                                                                  |
| MinIO Production   | PASS       | `75ba8af78c8f` healthy, volume `bhome-vps_minio-data`                                                           |
| Caddy              | PASS       | Validate và reload thành công, container/start time không đổi                                                   |
| Networks           | PASS       | `bhome-vps_default`, `bhome-sepay-stage_default`; API Staging dùng namespace DB Staging                         |
| Persistent volumes | PASS       | Production postgres/minio/caddy và `bhome-sepay-stage_sepay-data` giữ nguyên                                    |

Cổng public 80/443 ở Caddy; PostgreSQL Production chỉ 127.0.0.1:5432,
Staging 127.0.0.1:55432; API Production 127.0.0.1:18080; MinIO 127.0.0.1:9000/9001.
Staging Web không publish host port. Chưa triển khai MinIO Staging riêng; không nghiệm thu
upload/attachment và không cho phép dùng bucket Production cho Staging.

## B. Staging

| Hạng mục                       | Trạng thái | Bằng chứng                                                                                                                   |
| ------------------------------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Owner Web                      | PASS       | `https://owner-sepay-test.103.146.23.157.sslip.io/login` HTTP200                                                             |
| API                            | PASS       | `https://api-sepay-test.103.146.23.157.sslip.io`; anonymous auth/me 401                                                      |
| HTTPS                          | PASS       | Edge TLS1.3; curl ssl_verify_result=0; không dùng `-k`                                                                       |
| Certificates                   | PASS       | Let's Encrypt YE1; Owner hết hạn 18/02/2027, API 17/02/2027, subjects khớp hostname                                          |
| Readiness                      | PASS       | Nội bộ Staging `/health/ready` 200; edge public cố ý 404                                                                     |
| DB target                      | PASS       | `bhome_compact24_dev_f723d9c0ff6acd3c4cce870df1e72989`, không phải Production `bhome`                                        |
| Environment                    | PASS       | Testing → Staging; Deployment anchors và AllowedHosts chính xác                                                              |
| Browser authentication         | PASS       | Login200, dashboard/profile APIs200, logout204, refresh sau logout401                                                        |
| Cookie refresh                 | PASS       | Secure/HttpOnly/Strict, rotate sau reload, nested profile route hoạt động                                                    |
| API routing/CORS               | PASS       | Browser requests chỉ vào API Staging, 0 failed requests/CORS/mixed-content errors                                            |
| Negative CORS                  | PASS       | Approved OPTIONS204 có allow-origin; untrusted OPTIONS204 không có allow-origin                                              |
| Token isolation                | PASS       | Token Staging gọi Production auth/me nhận401                                                                                 |
| SePay Test context             | PASS       | Authenticated testing-context200, mode Test                                                                                  |
| Sandbox API                    | PASS       | GET transactions bằng token hiện có trả200, JSON status success; không in transactions/token                                 |
| Unsigned webhook               | PASS       | Public endpoint trả401                                                                                                       |
| Signed/replayed webhook        | PASS       | Hai lần gửi cùng synthetic outgoing event đều200; DB chỉ có một event Ignored, transferId NULL                               |
| Callback do SePay gửi          | PASS       | Ảnh Delivery log của người vận hành: hai webhook HTTP 200 lúc 14:17:54; DB event 52128 nhận lúc 14:17:54.163 +07             |
| Đối soát mã BH32951172         | PENDING    | Khoản thu Test ở ManualReview / unknown_or_ambiguous_payment_code; mã chưa đăng ký, chưa phân bổ hóa đơn                     |
| Business data trước simulation | PASS       | Hash + counts của 20 bảng nghiệp vụ khớp restore tại checkpoint trước simulation; khoản thu Test mới được ghi riêng bên dưới |

Chạy browser test: `node scripts/Test-StagingBrowser.cjs`; evidence tại
`.tools/staging-browser/browser-evidence.json`, ảnh login `staging-login.png` cùng thư mục.
Không lưu HAR, token hoặc password. IAB không khả dụng; đã chạy Edge headless thật qua Playwright có sẵn.

Synthetic event ID `7b7dbdc4-819c-47ae-87f6-fce095f1d936`: query trên operational_tasks
trả count1, status Ignored, reason outgoing_transaction, transferId NULL. Không chuyển tiền thật.
Đây là receiver test theo [SePay HMAC contract](https://developer.sepay.vn/vi/sepay-webhooks/xac-thuc),
không phải bằng chứng SePay đã giao callback. [Sandbox API](https://developer.sepay.vn/vi/sepay-api/v2/gioi-thieu)
dùng token/data scope riêng với Live.

### Bổ sung: provider callback lúc 14:17:54

Người vận hành cung cấp ảnh SePay Test mode: giao dịch mô phỏng **2.500.000 VND**,
nội dung chứa `BH32951172`, hai cấu hình webhook cùng trả **200 OK** lúc **14:17:54**,
thời gian phản hồi 892 ms và 352 ms. Không lưu ảnh này vào repository.
Read-only query trên VPS lúc 14:19 đối chiếu được:

- Webhook transaction ID `52128`, event `01d369d8-c7bb-428b-80d1-a7f461b4ef6d`,
  nhận `2026-11-20T07:17:54.163416Z` (14:17:54.163 +07), mode Test, amount 2.500.000 VND.
- Event trên ở `ManualReview`, reason `unknown_or_ambiguous_payment_code`;
  registry có **0** entry cho `BH32951172`.
- Polling sau đó nhận cùng giao dịch bằng UUID `80425c53-e4b2-11f1-8895-0afffe87053b`,
  event `0cd0ab4c-a156-4c03-89ba-e731ae3dfd6e`, status `Duplicate`,
  reason `bank_transaction_already_received`.
- Cả hai event tham chiếu cùng payment `830ffb60-91ec-4dcf-b876-8c97d0c9b9e9`;
  payments có **1 row**, provider `SEPAY:TEST`, tổng 2.500.000 VND;
  payment_allocations có **0 row**, tổng phân bổ **0 VND** cho payment đó.
- Hai lần webhook chỉ có **1 event** mang transaction ID `52128`.

Kết quả: **provider → HTTPS → HMAC receiver → durable receipt và chống trùng PASS**.
Không đánh dấu hóa đơn đã thanh toán: khoản thu chờ Owner đối soát vì mã chưa đăng ký.
Không tự gán khoản thu vào hóa đơn khác hoặc sửa registry/dữ liệu để biến ca này thành paid.
Nếu kiểm thử tự động gạch nợ, dùng QR/mã của nghĩa vụ đang hợp lệ do BHOME phát hành và kiểm
outstanding trước khi gửi giao dịch mô phỏng mới. Ảnh hiện có hai webhook cấu hình hoạt động;
chưa tự xóa hay thay cấu hình nào trên SePay.

Readiness Staging và Production vẫn 200; protected container/volume snapshot không đổi.
Evidence SQL được lưu tại `/opt/bhome-backups/session-staging-20261120/provider-callback-20261120-141754.jsonl`.

Các row thay đổi mong đợi gồm sessions/refresh tokens, AUDIT auth, một synthetic event và SYSTEM_JOB
SePay Test. Snapshot lúc 13:49: notifications1→7 (thêm6 AUDIT), refresh_tokens0→10,
operational_tasks1520→1536 (thêm1 SePayEventV1 và15 SYSTEM_JOB). Browser probes sau đó tiếp tục
tạo auth/audit. Không đồng nhất “không mất dữ liệu” với “không có row mới”.

**Background jobs:** đã kiểm Jobs false và billing automation false. Source vẫn có worker riêng:
SePayAutomationWorker polling/reconcile Test và scan activation; AssetTemplate có cờ riêng;
authentication notification worker có đường chạy riêng. DB audit chỉ thấy sepay-poll-test và
sepay-reconcile-test Completed trong khoảng kiểm tra, không thấy job loại khác phát sinh.
Không khẳng định mọi background services đã tắt và không sửa policy activation trong task hạ tầng.

Log API container hiện tại: 101 warning EF mapping/index khi startup, 2 warning API error từ probes,
không có Error/Critical. Không đổi model/migrations chỉ để làm sạch warning.

## C. CI/CD và rollback

GitHub API xác minh [CI run44672231019](https://github.com/nguyenhuy238/SEP490-G92-BHOME/actions/runs/44672231019)
completed/success, push develop, SHA `05d74df548fbcb185ab546bb887369ebc62b660c`.
Run này có trước các thay đổi chưa commit trong phiên này.

| Hạng mục                        | Trạng thái | Bằng chứng                                                                                |
| ------------------------------- | ---------- | ----------------------------------------------------------------------------------------- |
| CI/build/publish SHA đang chạy  | PASS       | Run trên và pull hai images từ GHCR                                                       |
| Server CD                       | PASS       | tmux run202611201400-1 exit0, DEPLOY_PASS; backup/restore, digest pin, health/smoke       |
| Reconnect/idempotency           | PASS       | Cùng SHA/run ID đọc kết quả cũ, không redeploy                                            |
| Rollback                        | PASS       | Cố ý smoke fail exit42; ROLLBACK_PASS, override cũ + health/smoke thành công              |
| Restricted SSH CI               | PASS       | Lệnh tùy ý exit126, đúng release command thành công                                       |
| Workflow source mới             | PENDING    | Parse/syntax/guard tests pass; chưa commit/push/run Actions                               |
| GitHub CD activation            | PENDING    | Hai SSH secrets chưa có ở environment staging hoặc repository; repository variables trống |
| Manual Production plan workflow | PENDING    | Đã tạo, chưa chạy GitHub; không có deploy step                                            |

Hai images pin SHA tag `sha-05d74df548fbcb185ab546bb887369ebc62b660c` và digest:

| Thành phần        | Digest                                                                    | Container ID                                                       |
| ----------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| API Staging       | `sha256:c833ee2be10627f3bb3343562139d1f72d24254a7062860272ec10dcd0ba15b6` | `990d2dbec369dc849b4123319a2e30241102f4bff816b4f93b1954328f7d6999` |
| Owner Web Staging | `sha256:6dab7c99c68a3b562bcf956b4ce89c53404d0b97bbc44153a640cd15aeeed5bb` | `727cd7fb2d427d5ea5f2a6e7ac8b4a87f76dc1ae41e14881a13bcba461748f15` |

Registry repositories: ghcr.io/nguyenhuy238/bhome-api và bhome-owner-web.
PR142 images chưa có OCI revision BHOME; chỉ đúng SHA này có ngoại lệ label.
Các images mới phải có revision trùng SHA; workflow đã bổ sung labels.

Evidence VPS:

- Release thành công: `/opt/bhome-backups/staging-cd-20261120T064534-05d74df548fb/`.
- Rollback: `/opt/bhome-backups/staging-cd-20261120T064647-05d74df548fb/`.
- Watcher: `/opt/bhome-deploy/runs/202611201400-1/`, có status/output.log/commit.
- Rollback fixture: `/opt/bhome-deploy/rollback-probe-20261120/`; lần đầu smoke fail,
  lần rollback gọi smoke thật; không thêm bypass flag vào code CD vận hành.
- Index overlay SHA256 `3cc550ac14be4a80f9081917c2da55b9bf5359412968300ca545848e066753ac`.

Image Web gốc có script localhost8400; overlay chỉ bỏ marked debug block, image và bundle giữ nguyên.
Mỗi release sinh index riêng từ image và rollback đường dẫn index cùng image.

## D. Production

Container IDs, image IDs, StartedAt giữ nguyên so với snapshot trước triển khai:

| Container              | ID rút gọn   | Kết quả                    |
| ---------------------- | ------------ | -------------------------- |
| bhome-vps-api-1        | d142535fe79d | PASS, readiness200         |
| bhome-vps-postgres-1   | 6f147a013641 | PASS, healthy              |
| bhome-vps-minio-1      | 75ba8af78c8f | PASS, healthy              |
| bhome-vps-owner-web-1  | 3d2aee86ca99 | PASS                       |
| bhome-vps-public-web-1 | 86684abb9f40 | PASS                       |
| bhome-vps-caddy-1      | 62d7c30f656a | PASS, reload không restart |

API image trước = sau:
`sha256:96317a4e36379963c20e6cad0bc9b811c3a31bbddb6e10408a0703bfc974a0c0`.
StartedAt vẫn `2026-11-19T06:38:45.196910846Z`. Production Caddy blocks trước phần Staging
byte-identical với backup. Không sửa database/payment credentials hoặc restart/deploy Production.
Production deploy **NOT DONE theo giới hạn ủy quyền**; [runbook riêng](BHOME_PRODUCTION_RELEASE_RUNBOOK.md) đã chuẩn bị.

## E. Database / backup

Giữ nguyên backup và database kiểm chứng cũ. Backup mới `/opt/bhome-backups/session-staging-20261120/`:

- staging.dump/staging.list: custom dump + pg_restore list thành công.
- Restore mới bhome_verify_20261120_session: exit0, counts24 bảng khớp nguồn.
- config-before.tar.gz, Caddyfile.before, baseline.json, cd-protected.json.
- *.business-hashes: hash20 bảng nghiệp vụ khớp nguồn/restore.

CD restore vào bhome_cd_verify_20261120064535 và DB kiểm chứng của rollback; giữ lại cả hai.
Không restore đè database đang dùng; không xóa volume hoặc backup.

Schema catalog **24 tables, 390 columns, 85 foreign keys**. Compact24Schema.VerifyAsync đối chiếu
profile SQL nhúng và guards. Image dbtools cũ in cố định383/83 trong Program.cs dù verifier thật READY;
đây là thông báo lỗi thời, không phải scope verifier khác. Source CLI đã sửa để đọc public catalog
sau READY; build mới chạy read-only trên cùng DB qua DLL diagnostic mount vào image dbtools cũ trả:

```text
Compact24: READY; schema compact24-2026-11-12-sepay.
Verified public catalog: 24 tables, 390 columns, 85 foreign keys.
```

Không đổi baseline/schema, không EnsureCreated/Migrate/history giả. PostgreSQL Staging vẫn ID
`278a2056e587d7773344ee8beb4f25687740ae28003bbb0be18daf8eb6ed7a33`, volume bhome-sepay-stage_sepay-data.

## Kiểm thử source đã thực thi

| Kiểm tra                                              | Kết quả                                              |
| ----------------------------------------------------- | ---------------------------------------------------- |
| dotnet build tools/BHome.DatabaseUpgrade -c Release   | PASS, 0 warnings/errors                              |
| Application.UnitTests filter FullyQualifiedName~SePay | PASS19/19                                            |
| unittest discover tests/deployment                    | PASS7/7                                              |
| Bash syntax deployment scripts                        | PASS local Git Bash và VPS                           |
| Parse CI YAML                                         | PASS PyYAML; không thay runtime Actions              |
| Owner build với process VITE_API_BASE_URL Staging     | PASS, warning chunk >500kB hiện hữu                  |
| Owner lint                                            | PASS, warning có sẵn DigitalSigningPage.test.tsx:103 |
| Edge, server smoke, rollback failure injection        | PASS như evidence trên                               |

Lượt Web build đầu thiếu API origin bị guard từ chối; chạy lại đúng process variable đã pass,
không đổi env private. Dot-source tools lần đầu bị execution policy từ chối; .NET build vẫn pass,
các lượt sau dùng PowerShell process ExecutionPolicy Bypass theo guide. Browser harness đã sửa
lọc cookie đúng auth path và chờ request hoàn tất trước reload. Lỗi localhost script là lỗi thật,
đã xử lý overlay/source. Sandbox GET đầu với Python default headers nhận403; probe có User-Agent/
Accept JSON nhận200; worker polling có Completed jobs. Không đổi token hoặc suy diễn token sai.

Full suites/coverage/load/Mobile E2E và CI source mới: **NOT RUN** trong phiên này.

Kiểm tra cuối: git diff --check, Prettier cho files mới/sửa và Node syntax đều PASS;
cả hai workflow YAML parse được. Hash của năm script cài trên VPS khớp source local.
Scan các file của task không tìm thấy mật khẩu SSH được cung cấp hoặc private-key content;
đây không thay thế một secret scanner đầy đủ.

Sự cố xử lý thông tin: lượt đọc attachment đầu tiên đã hiển thị lại phần credential trong
output công cụ. Các lượt sau chỉ dùng credential trong bộ nhớ để bootstrap SSH; không chép
mật khẩu vào repository, command arguments hoặc deployment logs. Không tự thay root password.

## File thay đổi / checkpoint tiếp tục

Workspace ban đầu branch feature/cd-staging-production/QHuy, HEAD a370789c; giữ nguyên branch.
VPS source develop SHA05d74, working tree clean. Fetch origin/develop và áp ba file PR142
vào local working tree trước khi mở rộng CD; không merge/commit/push. Giữ nguyên file untracked
VPS_DEMO_UBUNTU_24.md có sẵn. Diff local vì vậy gồm phần release đã có trên remote.

File code/config: .github/workflows/ci.yml, production-plan.yml;
deploy/docker/Api.Release.Dockerfile, README.md;
deploy/vps/deploy-staging.sh, run-staging-release.sh, smoke-staging.sh, staging-safety.py, ci-ssh-entry.sh;
scripts/Test-StagingBrowser.cjs; tests/deployment/test_staging_safety.py;
tools/BHome.DatabaseUpgrade/Program.cs; src/owner-web/index.html.
Docs: biên bản này, runbook Staging/Production, team environment guide và validation checkpoint.
Không đổi env private hoặc app dependencies. SSH tooling chỉ ở ignored .tools/bhome-vps-session.

Tiếp tục:

1. Review diff và cho phép commit/push theo nhánh team; hiện chưa được ủy quyền.
2. Điền BHOME_STAGING_SSH_PRIVATE_KEY, BHOME_STAGING_SSH_KNOWN_HOSTS và repository variable
   BHOME_STAGING_CD_ENABLED=true theo [runbook Staging](BHOME_STAGING_DEPLOYMENT.md), sau đó kiểm
   source mới qua push → CI → GHCR → VPS. Không dùng key operator làm secret CI.
3. Provider callback đã PASS theo bổ sung lúc 14:17:54. Nếu nghiệm thu tự động phân bổ hóa đơn,
   dùng mã/QR do BHOME phát hành cho nghĩa vụ hợp lệ; khoản thu BH32951172 hiện chờ đối soát.
4. Nếu cần attachment/email E2E: cấu hình storage/email Staging riêng; không dùng Production.
   Nếu cần tắt tuyệt đối mọi worker: review các worker/cờ riêng đã nêu.
5. Production chỉ tiếp tục sau xác nhận riêng và checklist đã review.

Mở lại Codex: đọc checkpoint/runbooks, git status, ssh bhome-vps, kiểm tmux/run status,
images/readiness/volumes trước. Không chạy lại bootstrap, seed, restore hoặc release đã hoàn tất.
