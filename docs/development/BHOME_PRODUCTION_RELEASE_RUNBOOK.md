# Phát hành Production BHOME

Checkpoint 21/11/2026: [preflight thực tế và các phê duyệt còn thiếu](BHOME_PRODUCTION_PREFLIGHT_2026-11-21.md).
Các kết quả commissioning/candidate ngày 20/11 bên dưới là lịch sử, không phải bằng chứng go-live mới.

Migration Staging mới: [biên bản hostname](BHOME_STAGING_HOSTNAME_MIGRATION_2026-11-20.md).
Staging canonical hiện là owner-staging/public-staging/api-staging; các hostname
sepay-test cũ chỉ giữ compatibility. Không thay bất kỳ hostname/image Production nào
trong migration. Secrets Staging đã có; secrets/commissioning Production vẫn riêng.

Cập nhật 20/11/2026. **Chưa deploy Production trong nhiệm vụ này.** Workflow đã chuẩn
bị; chưa có lượt GitHub approval/deployment thật cho source mới.
Xem [biên bản nghiệm thu](BHOME_CICD_ACCEPTANCE_2026-11-20.md).

## Source và ranh giới phát hành

PR được review vào main → backend/frontend CI → ba image từ chính main SHA → GHCR
manifest/digests → kiểm protection → job environment production chờ duyệt → SSH
secret Production → deploy application → smoke/rollback. Không lấy develop SHA hay
frontend Staging để phát hành Production. `production-plan.yml` chỉ lập kế hoạch từ
main có CI success, không SSH/deploy.

Main xác minh 21/11 là `52f7a186a9ef3d598b729d72481102e75322783d`, **chỉ có README.md**.
[PR release #149](https://github.com/nguyenhuy238/SEP490-G92-BHOME/pull/149) chuẩn bị
source từ develop; phụ thuộc bản sửa backup #148, CI và review từ người khác.
Chỉ merge qua PR sau khi các yêu cầu review/protection được đáp ứng; không push trực tiếp main.

| Thành phần   | Giá trị                                                              |
| ------------ | -------------------------------------------------------------------- |
| Owner        | `https://owner.103.146.23.157.sslip.io`                              |
| Public       | `https://www.103.146.23.157.sslip.io`                                |
| API          | `https://api.103.146.23.157.sslip.io`                                |
| Project      | `bhome-vps`                                                          |
| Applications | `bhome-vps-api-1`, `bhome-vps-owner-web-1`, `bhome-vps-public-web-1` |
| PostgreSQL   | `bhome-vps-postgres-1`, database `bhome`                             |
| Storage      | `bhome-vps-minio-1`, bucket private `bhome-private`                  |

Owner build origin là Owner Production, vì Caddy /api/* proxy API Production;
Public build origin là API Production. `VITE_DEPLOYMENT_ENVIRONMENT=Production`,
`VITE_API_MODE=api`, `BHOME_REVISION=<MAIN_SHA>`. Frontend nhận origin tuyệt đối;
không mặc định relative API base hợp lệ. Thay env Nginx không đổi Vite bundle.

Images trong ghcr.io/nguyenhuy238: `bhome-api:sha-<MAIN_SHA>`,
`bhome-owner-web-production:sha-<MAIN_SHA>`, `bhome-public-web-production:sha-<MAIN_SHA>`.
Pin tag@sha256:digest, ghi OCI revision/source và đối chiếu image thực tế với manifest.
/bhome-release.json chỉ chứa metadata public, không chứa secret.

## GitHub Environment

Environment production **đã cấu hình và GET đọc lại xác minh**: required reviewer
`nguyenhuy238`, chỉ branch main, `can_admins_bypass=false`. Reviewer có thể duyệt run
do chính họ kích hoạt; code PR vẫn cần người khác review theo quy tắc team.

`Verify-ProductionGate.cjs` từ chối environment thiếu reviewer, còn admin bypass hoặc
branch/tag policy khác main. Kiểm trước khi xếp job và kiểm lại sau duyệt. GitHub
phải duyệt job trước khi cấp environment secrets. REST configuration/unit test
không thay bằng chứng workflow thật dừng chờ duyệt rồi mới SSH.
[GitHub environment protection](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments).

| Settings                      | Cần thiết                                                            |
| ----------------------------- | -------------------------------------------------------------------- |
| Repository variable           | `BHOME_PRODUCTION_CD_ENABLED=true`, chỉ bật sau commissioning/review |
| Production environment secret | `BHOME_PRODUCTION_SSH_PRIVATE_KEY`                                   |
| Production environment secret | `BHOME_PRODUCTION_SSH_KNOWN_HOSTS`                                   |
| Optional repository variable  | `BHOME_PRODUCTION_SSH_HOST`                                          |

SSH key Production phải riêng, forced command `production-ci-ssh-entry.sh`; không dùng
key Staging/operator. Không nhập root password vào GitHub. Hiện secrets chưa thiết
lập, CD tắt, chưa cài Production CI key và chưa tạo ENABLED_AFTER_REVIEW trên VPS.

## Commissioning lần đầu — cần phê duyệt riêng

1. Review main SHA, CI, ba registry digests, origins/bundle, schema compatibility,
   backup và rollback. Workspace candidate chưa commit không đủ điều kiện main release.
2. Chụp lại container/image IDs, StartedAt, env fingerprint, volumes/networks, disk,
   dependency health. Backup DB/config/storage và restore DB kiểm chứng mới. Baseline
   trong biên bản là lịch sử, phải kiểm lại trước mỗi release.
3. Chuẩn bị root-only `/opt/bhome-config/compose.production-environment.yml` từ
   `deploy/vps/compose.production-environment.example.yml`. Nó thêm Deployment anchors
   cho backend mới; không thay credentials. API hiện còn thiếu anchors trong env.
4. Chuẩn bị `/opt/bhome-config/compose.production-release.yml` bằng image IDs hiện
   đang chạy của API/Owner/Public để có rollback ban đầu; không dùng image Staging.
5. Kiểm schema read-only với đúng candidate. Ngày 20/11 cả hai DB có 24 bảng/390 cột/
   85 FK; column/type/null/default signature khớp sau khi sort theo tên cột. Counts
   không thay candidate-specific verifier hoặc constraint/index compatibility.
   Không nới guard DB tool Development để chạy Production.
6. Sau schema review, ghi checksum SQL chuẩn vào
   `/opt/bhome-deploy/production/schema-baseline.sha256`. Source SQL đổi sẽ dừng CD;
   thay baseline cần review migration riêng, không tự cập nhật để ép release qua.
7. Image Production cũ thiếu Deployment anchors. Ghi chính image ID đã kiểm tra vào
   `/opt/bhome-deploy/production/legacy-image-id` để cho phép chỉ image cũ đó ở
   preflight commissioning. Candidate mới vẫn bắt buộc đầy đủ anchors/origins.
8. Cài scripts root-owned từ source đã review, đối chiếu hash. Source đã được chuẩn
   bị ở `/opt/bhome-deploy/production/`, nhưng chưa bật. Chỉ sau duyệt commissioning
   mới tạo `ENABLED_AFTER_REVIEW`, cài key riêng/forced command, nhập hai secrets và
   bật repository variable CD.
9. Xác minh workflow main thật dừng ở environment approval, chưa SSH trước duyệt.
   Chủ dự án approve đúng SHA/digests trong cửa sổ release. Chưa có lượt này nên
   chưa được đánh dấu Production CD hoàn tất.

## Deploy và rollback

Project bhome-vps; --env-file `/opt/bhome-config/stack.env`; ghép root
`/opt/bhome/docker-compose.yml`, `compose.vps.yml`, `compose.integrations.yml`,
`compose.production-environment.yml`, `compose.production-release.yml` cuối cùng.
Validate `config --quiet`; không in resolved config chứa secrets.

`run-production-release.sh` → worker tmux run-release.sh, flock riêng. Chỉ nhận main
HEAD hiện tại, run ID tăng và đúng ba digest do image job truyền. Update đúng ba app:
`up -d --no-deps --no-build --pull never api owner-web public-web`. Không restart
PostgreSQL/MinIO/Caddy để đổi app. Một VPS có thể gián đoạn ngắn khi recreate;
chưa có bằng chứng zero downtime.

Backup gồm config archive riêng root, custom dump/list/restore DB mới, storage
mirror/diff trên VPS. Mirror không phải snapshot nguyên tử xuyên DB/storage khi có
ghi đồng thời; release schema/data cần kế hoạch consistency/migration riêng.

Kiểm readiness nội bộ, HTTPS, auth/public APIs, CORS từ chối Staging, unsigned webhook,
image ref/ID/OCI/metadata, protected containers và env fingerprint. Authenticated
login/refresh/logout Production cần tài khoản smoke tổng hợp được cho phép; chưa có
nên chưa chạy. Kiểm email/signing callback đúng anchors, không gửi/ký thử cho người
thật. Giữ SePay disabled/trạng thái thực tế, không bật Live hay đổi payment credentials.

Smoke lỗi → restore release override trước → recreate app --no-deps → health/smoke →
ghi ROLLBACK_PASS/ROLLBACK_FAILED. Không restore đè DB, delete volume/image cũ,
down/prune/EnsureCreated/auto migration/seed. Schema khác baseline phải dừng trước
thay image. DB kiểm chứng được giữ lại.

## Candidate đã chuẩn bị

VPS `/opt/bhome-deploy/candidates/90f4e3acfcefe933/`: Owner/Public Production Docker
build và artifact isolation checks đã pass. Source archive SHA256:
`90f4e3acfcefe9331a4feb029c91fe620e6cff23476bcf1a67f0eb9632a73bbc`.
Baseline `a370789c6008d9a31f909ff4ef920cce43c37400`, có workspace changes chưa commit.
OCI label ghi thêm archive hash/uncommitted=true; **không mạo nhận artifact từ main**.
GHCR publish bị từ chối vì credential thiếu scope; mới có local image IDs, chưa có
registry digests. Phải build lại từ main SHA hợp lệ sau review/merge.

Production hiện anonymous refresh gọi đúng Production trên desktop/mobile. Bản live
còn script debug localhost8400 và Public locations chưa thực hiện. Candidate đã bỏ
debug overlay và có Public pages; chỉ thay Production sau approval. Không nới CORS
để che lỗi; Staging edge đã được tách alias nhằm tránh Docker DNS phân giải chéo.
