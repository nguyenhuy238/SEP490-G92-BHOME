# Vận hành Staging BHOME

Checkpoint hostname mới: [nghiệm thu migration](BHOME_STAGING_HOSTNAME_MIGRATION_2026-11-20.md).
Canonical dùng `*-staging`; `*-sepay-test` chỉ còn là compatibility được khai báo.
Hai GitHub SSH secrets Staging đã được thiết lập và repository flag CD bật; workflow
mới vẫn cần source được review/push/merge trước khi nghiệm thu Actions end-to-end.

Cập nhật 20/11/2026. Xem [biên bản CI/CD](BHOME_CICD_ACCEPTANCE_2026-11-20.md).
Staging đã chạy; **CD GitHub → VPS chưa được nghiệm thu**. Source chưa được review/push;
hai secrets Staging và flag CD đã có. [Biên bản cũ](BHOME_VPS_DEPLOYMENT_ACCEPTANCE_2026-11-20.md)
lưu lịch sử trước khi thêm Public Web; topology dưới đây thay thế topology cũ.

## Phạm vi và truy vết

MASTER TASK 20/11 và AGENTS.md → NFR bảo mật/khôi phục, GBR-01/02/13/18 → CI/CD,
image, proxy, config, backup/rollback. FE-09 / UC-37/38 / GBR-17 → Public chỉ đọc
anonymous APIs hiện có. BF-06 / UC-22/23/25 / GBR-10 / JOB-03 → giữ SePay Test.
Không đổi schema, DTO, chính sách tiền, ký hoặc activation.

| Thành phần           | Giá trị                                                                               |
| -------------------- | ------------------------------------------------------------------------------------- |
| Owner                | `https://owner-staging.103.146.23.157.sslip.io`                                       |
| Public               | `https://public-staging.103.146.23.157.sslip.io`                                      |
| API                  | `https://api-staging.103.146.23.157.sslip.io`                                         |
| Sandbox webhook      | API origin + `/api/v1/integrations/sepay/webhook`                                     |
| Project              | `bhome-sepay-stage`                                                                   |
| API / Owner / Public | `bhome-sepay-api-stage` / `bhome-sepay-owner-web-stage` / `bhome-sepay-stage-public`  |
| PostgreSQL           | `bhome-sepay-vps-stage`, chỉ publish `127.0.0.1:55432`                                |
| Database             | `bhome_compact24_dev_f723d9c0ff6acd3c4cce870df1e72989`                                |
| DB volume            | `bhome-sepay-stage_sepay-data`                                                        |
| Storage              | `bhome-sepay-stage-minio`, bucket private `bhome-staging-private`, không publish port |
| Storage volume       | `bhome-sepay-stage_stage-storage`                                                     |

## Mạng và lỗi DNS chéo môi trường

API hiện có namespace riêng, dùng `Host=postgres` trên backend Staging
`bhome-sepay-stage_default`. Cấu hình cũ namespace PostgreSQL/Host=127.0.0.1 đã thay
thế; PostgreSQL không recreate/đổi volume. Owner/Public ở mạng frontend riêng,
không ở mạng database/storage.

Caddy nối `bhome-vps_default` và `bhome-staging-edge`, không còn nối backend Staging.
`connect-staging-edge.py` gắn các ứng dụng lên edge bằng alias duy nhất:
API `bhome-stage-api`, Owner `bhome-owner-stage`, Public `bhome-public-stage`.
Hai bundle tương thích ở `bhome-staging-owner-legacy` / `bhome-staging-public-legacy`,
alias `bhome-owner-legacy` / `bhome-public-legacy`. Edge chỉ có năm ứng dụng và Caddy.

**Không gắn edge trực tiếp bằng Compose vào service `api`, `owner-web`, `public-web`.**
Compose tự thêm alias tên service dù khai báo aliases riêng. Caddy thấy tên trùng
trên hai mạng có thể chọn nhầm môi trường. Script kiểm và loại alias trùng, phải chạy
lại sau mỗi recreate/rollback. Không đưa PostgreSQL/MinIO lên edge.

Caddy Owner `/api/*`, `/open/*` → API Staging. Public `/api/v1/public/*` có proxy
riêng; `/api/*` khác trả 404 thay vì HTML. Bundle Public dùng API Staging tuyệt đối.
CORS cho Owner/Public Staging mới và cũ; AuthWeb chỉ hai Owner origins. Không thêm
Production hoặc Public origins vào AuthWeb. `Deployment__LegacyOwnerOrigin`,
`LegacyApiOrigin`, `LegacyPublicOrigin` chỉ chấp nhận đúng cặp hostname chuyển đổi
Staging đã duyệt. Links mới vẫn sinh từ anchors canonical; không sinh link hostname cũ.

## Cấu hình và Compose

Project `bhome-sepay-stage`; ghép các file theo thứ tự:

1. `/opt/bhome/deploy/compose.sepay.yml`
2. `/opt/bhome-config/compose.sepay-stage-api.yml`
3. `/opt/bhome-config/compose.sepay-stage-web.yml`
4. `/opt/bhome-config/compose.sepay-stage-public.yml`
5. `/opt/bhome-config/compose.staging-compat.yml`
6. `/opt/bhome-config/compose.sepay-stage-release.yml`

Dùng cả hai `--env-file`: `sepay-staging.db.env`, `stage-storage.env` trong private
config. File thứ hai root-only, chứa connection hiện có (đổi host sang PostgreSQL
Staging), credential storage mới riêng và image Public bootstrap; không đưa vào Git/log.
Mẫu: `deploy/vps/compose.staging-public.example.yml` và `compose.staging-compat.example.yml`.
File private có thêm `BHOME_STAGE_LEGACY_OWNER_IMAGE`, `BHOME_STAGE_LEGACY_PUBLIC_IMAGE`,
`BHOME_STAGE_LEGACY_OWNER_INDEX` pin đúng images/index trước migration. Không tự cập
nhật các bundle này qua CD; chỉ bỏ sau khi chứng minh không còn phiên/link/callback phụ thuộc.

Giữ signing key JWT, Data Protection tại `sepay-staging-data-protection`, SePay Test,
email và identity keys. Issuer/audience Staging: `BHome.Staging` / `BHome.Staging.Clients`.
Migration hostname không đổi key, issuer hay audience. Phiên cũ đã được browser xác
minh tiếp tục refresh qua alias cũ. Hostname mới cần đăng nhập lần đầu vì cookie
host-only; không mở rộng cookie domain. Cookie Secure/HttpOnly/SameSite=Strict,
path `/api/v1/auth`. General jobs/billing automation/initializer vẫn false; các worker
chuyên biệt có cờ riêng. Email Staging chưa cấu hình gửi thật.

## GitHub và release

`member/<tên>` → PR develop → CI backend/frontend → reusable `release.yml` → build
API/Owner/Public đúng SHA → GHCR SHA tags + digest + manifest → environment staging
→ SSH → backup → deploy → smoke/rollback. PR/feature/workflow_dispatch không deploy.
Workflow push main chạy release Production riêng có approval. Không có workflow
khác cạnh tranh deploy. Không merge/push khi chưa được review/ủy quyền.

| GitHub Settings              | Giá trị cần thiết                                                          |
| ---------------------------- | -------------------------------------------------------------------------- |
| Repository variable          | `BHOME_STAGING_CD_ENABLED=true`, đã thiết lập; source vẫn cần review/merge |
| Environment                  | `staging`, branch policy chỉ `develop`                                     |
| Environment secrets          | `BHOME_STAGING_SSH_PRIVATE_KEY`, `BHOME_STAGING_SSH_KNOWN_HOSTS`           |
| Optional repository variable | `BHOME_STAGING_SSH_HOST`, mặc định VPS hiện tại                            |

Hai secrets đã được mã hóa và nhập vào environment Staging bằng REST API; không
đọc lại được giá trị từ GitHub. Để rotate, nhập key CI riêng qua Settings; không dùng operator key hoặc
root password. Known-hosts phải đối chiếu host key qua operator connection đã tin cậy.
Không dùng ssh-keyscan chưa xác minh. JWT/database/SePay secrets ở VPS, không cần
chuyển lên GitHub. Image job dùng `GITHUB_TOKEN` với `packages: write`; Git credential
cá nhân hiện có thiếu scope này, nên publish candidate thủ công bị từ chối.

Docker Web yêu cầu `VITE_API_BASE_URL`, `VITE_DEPLOYMENT_ENVIRONMENT`, `BHOME_REVISION`;
mode luôn `api`. Origins khóa theo nhánh. `Verify-WebArtifact.cjs` kiểm JS đã biên dịch
và ghi `/bhome-release.json`. Nginx no-store index/metadata, assets dùng tên hash.
Thay env Nginx không đổi origin đã nhúng. Image mới bắt buộc OCI revision/source;
không dùng ngoại lệ OCI label của PR142 cho release mới.

Scripts root-owned ở `/opt/bhome-deploy/staging/`:

- `run-staging-release.sh` → `run-release.sh`: worker tmux sống độc lập SSH; run ID
  chỉ thuộc một bộ SHA/digest; reconnect không chạy lại release.
- `deploy-release.sh`: flock, từ chối SHA khác HEAD develop/run ID cũ; backup private
  config/DB/storage, restore DB mới, so checksum schema đã duyệt, pull đúng digest,
  kiểm metadata/bundle và chỉ update API/Owner/Public.
- `release-safety.py`: kiểm DB/key/storage/environment, protected containers,
  OCI/digest và image thật đang chạy.
- `connect-staging-edge.py`: alias duy nhất sau up/rollback.
- `smoke-release.sh`, `smoke-auth.py`: HTTPS/public API/CORS/auth/webhook và synthetic
  login/refresh/logout. `backup-storage.py`: mirror private bucket trên cùng VPS.

Lệnh từ CI hoặc reconnect, lấy đúng năm giá trị từ manifest:

```sh
ssh bhome-vps '/opt/bhome-deploy/staging/run-staging-release.sh <40SHA> <run-id>-<attempt> <api-sha256-digest> <owner-sha256-digest> <public-sha256-digest>'
```

Forced command chỉ chấp nhận dạng trên. GitHub/VPS đều khóa deployment;
`cancel-in-progress: false`. Kiểm `/opt/bhome-deploy/runs/staging-<run-id>-<attempt>/`
và tmux `bhome-deploy`, rồi reconnect cùng lệnh. Watcher khoảng 25 phút; timeout
không có nghĩa worker đã dừng. Không tạo run ID mới chỉ vì SSH disconnect.

Backup/evidence: `/opt/bhome-backups/staging-cd-<UTC>-<SHA12>-*/`. Không xóa image cũ
trước nghiệm thu. DB restore kiểm chứng vào DB mới; không restore đè. Storage mirror
có so nguồn/backup nhưng không phải snapshot nguyên tử xuyên DB/storage khi có ghi
đồng thời. Release schema/data phải có kế hoạch consistency/migration riêng.

## Kiểm tra và rollback

```sh
bash /opt/bhome-deploy/staging/smoke-release.sh staging
python3 /opt/bhome-deploy/staging/connect-staging-edge.py
python3 /opt/bhome-deploy/staging/release-safety.py check staging
```

Smoke anonymous trên Windows có Edge:

```powershell
node scripts/Test-PublicBrowser.cjs
node scripts/Test-ProductionBoundary.cjs
```

`Test-StagingBrowser.cjs` có đăng nhập phải chạy **trên VPS** với fixture file private
được mount read-only và browser phù hợp. Không dùng harness cũ để xuất password qua SSH.
`Test-StagingHostnameBrowser.cjs` đã chạy trong container validation trên VPS, giữ
state riêng tại máy chủ để chứng minh phiên tạo trước migration vẫn còn hợp lệ.
Test Public/Production anonymous có thể chạy local, không cần credential.

Public API chưa có nội dung công bố: live kiểm empty/404. Positive UI tests dùng
responses tổng hợp và ghi riêng; không phải bằng chứng live đã có phòng/ảnh được
Owner công bố. Không tự publish demo.

Smoke lỗi → khôi phục release override cũ → `up -d --no-deps --no-build --pull never
api owner-web public-web` → gắn edge → readiness/smoke/protected snapshot. Không
restore đè DB, down/prune/remove volume/seed/migration. Khôi phục Caddy chỉ khi có
thay routing đã backup. Diễn tập 20/11 đã gây Public HTTP503 rồi rollback thành công,
API/Owner/database/storage/Production không recreate trong bài đó. **Rollback cả ba
image qua workflow mới còn PENDING**.
