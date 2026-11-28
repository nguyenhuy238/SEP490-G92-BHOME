# Phát hành Production BHOME

Cập nhật sau go-live ngày 21/11/2026. Production đang chạy main
`70406ecf8dceea6e84e4ddbaa3e325807af123f2`, triển khai lúc 14:48:52
(Asia/Ho_Chi_Minh) bằng [Actions 44878730626, attempt 4](https://github.com/nguyenhuy238/SEP490-G92-BHOME/actions/runs/44878730626).
Ba application containers healthy. Xem [biên bản nghiệm thu hiện tại](BHOME_PRODUCTION_CD_ACCEPTANCE_2026-11-21.md)
và [backup/monitoring/khôi phục](BHOME_PRODUCTION_OPERATIONS_2026-11-21.md).

Các biên bản [20/11](BHOME_CICD_ACCEPTANCE_2026-11-20.md) và
[preflight 21/11](BHOME_PRODUCTION_PREFLIGHT_2026-11-21.md) là lịch sử trước go-live;
các câu “chưa deploy”, “chưa có secrets” trong đó không còn là trạng thái hiện tại.

## Môi trường và source

| Thành phần      | Production                                                           |
| --------------- | -------------------------------------------------------------------- |
| Owner           | https://owner.103.146.23.157.sslip.io                                |
| Public          | https://www.103.146.23.157.sslip.io                                  |
| API             | https://api.103.146.23.157.sslip.io                                  |
| Compose project | `bhome-vps`                                                          |
| Applications    | `bhome-vps-api-1`, `bhome-vps-owner-web-1`, `bhome-vps-public-web-1` |
| Database        | `bhome-vps-postgres-1`, database `bhome`                             |
| Storage         | `bhome-vps-minio-1`, private bucket `bhome-private`                  |

Source cá nhân → PR vào develop → CI và Staging → PR develop vào main → CI main →
GHCR → production-policy → environment approval → SSH giới hạn → shared release
scripts → backup/preflight → deploy → smoke hoặc rollback. Không push trực tiếp
main/develop. `production-plan.yml` chỉ lập kế hoạch, không SSH/deploy.

Main chứa đầy đủ application source và workflows sau merge #149. Staging giữ
`473d77e4`; không dùng image/bundle Staging cho Production. Owner compile API origin
là Owner Production (Caddy proxy `/api/*`), Public compile origin là API Production.
`VITE_DEPLOYMENT_ENVIRONMENT=Production`, `VITE_API_MODE=api`, revision bằng main SHA.
Thay env Nginx không thay được origin đã compile vào Vite bundle.

## Gate và credentials đã vận hành

Main protection bắt buộc backend/frontend GitHub Actions checks và cập nhật branch,
1 approval, enforce admins, giải quyết thảo luận; cấm force-push/delete. Commissioning
được chủ dự án duyệt ngày 21/11 không yêu cầu review bổ sung; giữ approval đã có,
`dismiss_stale_reviews=false`, `require_last_push_approval=false`.

Environment `production`: chỉ main, required reviewer `nguyenhuy238`,
`can_admins_bypass=false`. `Verify-ProductionGate.cjs` kiểm trước và sau approval.
Đã quan sát job thật chờ environment approval trước SSH; các lần retry đều qua gate.
Lượt này chủ dự án ủy quyền áp dụng/triển khai; không tắt gate để chạy release.

| Cấu hình                                              | Trạng thái              |
| ----------------------------------------------------- | ----------------------- |
| Repository variable `BHOME_PRODUCTION_CD_ENABLED`     | `true`                  |
| Repository variable `BHOME_PRODUCTION_SSH_HOST`       | VPS Production          |
| Environment secret `BHOME_PRODUCTION_SSH_PRIVATE_KEY` | Đã thiết lập key riêng  |
| Environment secret `BHOME_PRODUCTION_SSH_KNOWN_HOSTS` | Đã pin trusted host key |

Key riêng dùng forced command `/opt/bhome-deploy/production/production-ci-ssh-entry.sh`;
lệnh shell và lệnh release Staging bị từ chối. Root password/operator key không được
đưa vào Actions. Marker `/opt/bhome-deploy/production/ENABLED_AFTER_REVIEW` đã tạo
sau commissioning. Không in resolved Compose, env secrets hoặc private backup.

## Release kế tiếp

1. Tích hợp qua PR đúng quy tắc nhóm; kiểm CI candidate, Staging và main. Xác nhận
   không có thay đổi schema hoặc provider cần kế hoạch riêng.
2. Đối chiếu ba images GHCR `bhome-api`, `bhome-owner-web-production`,
   `bhome-public-web-production`, tag `sha-<MAIN_SHA>` và immutable digests từ image job
   của chính run. Kiểm OCI revision/source, bundle origins và release metadata.
3. Xem Production job chờ duyệt: SHA, digests, backup/schema và dự kiến gián đoạn.
   Người có quyền approve environment cho đúng release. Không dùng artifact của run khác.
4. Theo dõi `release / production`: SSH → worker tmux → flock → backup/restore,
   schema guard, disk reserve → pull → `up -d --no-deps --no-build --pull never`
   đúng ba apps → readiness/HTTPS/isolation/provenance smoke.
5. Đối chiếu `/opt/bhome-deploy/production/current.json`, `/bhome-release.json`,
   container image refs/health và evidence path từ job. Chạy authenticated/browser
   smoke bằng tài khoản tổng hợp được phép; giữ giới hạn kiểm chứng trong báo cáo.

`run-production-release.sh` gọi shared `run-release.sh` / `deploy-release.sh`.
Compose ghép `/opt/bhome/docker-compose.yml`, private `compose.vps.yml`,
`compose.integrations.yml`, `compose.production-environment.yml` và
`compose.production-release.yml`; env file `/opt/bhome-config/stack.env`.
Validate `config --quiet`. Template healthchecks nằm trong
`deploy/vps/compose.production-environment.example.yml`; private overlay giữ credentials
và các integration switches được duyệt. Không chép nguyên template đè cấu hình riêng.

Release chỉ recreate ứng dụng; giữ PostgreSQL/MinIO/Caddy và Staging. Một VPS có thể
có gián đoạn ngắn khi recreate; chưa chứng minh zero downtime. Nếu disk dưới 4 GiB,
dừng để xử lý nguyên nhân. Không system-prune hoặc xóa rollback images/volumes.

Schema SQL baseline hiện là
`f97676af7340779d142a15fd3a358eda150eb75bc0263e1eb3c3f63ca40283dd`.
Thay SQL phải dừng và có migration plan riêng; không cập nhật baseline để ép guard qua.
Không auto migration, EnsureCreated hoặc seed Production trong release.

SePay, email/push/SMS, notification automation, general jobs/billing automation và
initializer đang tắt. Không bật giao dịch/email/ký thật để chạy smoke. Source vẫn có
OwnerSession signing và activation worker riêng; không suy ra mọi worker đều tắt
chỉ từ `Jobs__Enabled=false`.

## Sự cố và rollback

Smoke sau thay image lỗi → script khôi phục release override trước → recreate ba
apps bằng image cũ → readiness/smoke/protected snapshot → `ROLLBACK_PASS` hoặc
`ROLLBACK_FAILED`. Không tự restore đè DB. Đã diễn tập hàm rollback nguyên bản trên
ba containers thật trong stack riêng; chưa tiêm lỗi vào traffic Production.

Nếu rollback lỗi, giữ evidence và dữ liệu, validate Compose, khôi phục chính override
đã backup rồi chạy shared smoke. Không down volumes, seed, xóa images hoặc đổi schema
baseline. Hướng dẫn logs, backup 02:15 hàng ngày, retention, khôi phục VPS và rotation
nằm trong [tài liệu vận hành](BHOME_PRODUCTION_OPERATIONS_2026-11-21.md).

Alert hiện ghi journal qua systemd OnFailure; chưa có thông báo chủ động tới người trực.
Backup ngoài VPS hiện là checkpoint có mã hóa, chưa có replication định kỳ đến storage
độc lập. Các giới hạn này được ghi trong biên bản nghiệm thu.

## Cấu hình ký nội bộ trên Production

Sau khi image có hỗ trợ email nghiệp vụ, cấu hình
`NotificationChannels__ContractAndInvoiceEmailEnabled=true` trong môi trường API
Production để gửi PDF sau kích hoạt và sau thanh toán. Chạy kiểm tra SMTP,
hàng đợi và tài khoản nhận đã xác minh theo quy trình phát hành. Cờ này hoạt động
khi `Jobs__Enabled=false` và không yêu cầu bật thông báo tự động diện rộng.

Theo quyết định chủ dự án ngày 27/11/2026, ký hợp đồng thuê UC-15 dùng mẫu DOCX
nhúng trong image, không yêu cầu phê duyệt mẫu hoặc cấu hình
`MainDraft__ApprovedProductionTemplateSha256`. Giá trị khóa cũ không chặn xem PDF
hay gửi ký hợp đồng Live. Backend tiếp tục kiểm tra phiên bản/snapshot và hash
nội dung tài liệu mà người dùng đã xem. Chi tiết:
[MAIN_CONTRACT_TEMPLATE_2026-11-27.md](MAIN_CONTRACT_TEMPLATE_2026-11-27.md).

Ghép `environment` và `volumes` của service `api` trong
`deploy/vps/compose.contract-signing.example.yml` vào
`/opt/bhome-config/compose.production-environment.yml`. Đặt các giá trị sau trong
`/opt/bhome-config/stack.env` trên VPS.

- `BHOME_ANON_HMAC_BASE64` là khóa OTP riêng của Production, Base64 giải mã ra
  ít nhất 32 byte. Giữ khóa Production hiện có nếu đã cấp lời mời còn hiệu lực.
- `BHOME_SIGNING_PUBLIC_URL` là URL HTTPS trang `/contract-signing` trên Owner Web Production.
- `BHOME_SIGNING_SEAL_PFX_FILE` là đường dẫn tuyệt đối đến chứng thư PFX riêng
  của BHOME trên Production, có khóa riêng RSA. Cấp quyền đọc cho UID chạy API.
  `BHOME_SIGNING_SEAL_PFX_PASSWORD` là mật khẩu mở PFX. Mount chỉ đọc và giữ
  bản sao lưu chứng thư theo quy trình quản lý bí mật của Production.

Kiểm tra `docker compose config --quiet` với chuỗi overlay Production. Áp dụng
qua quy trình release ở trên, kiểm tra readiness nội bộ và dùng hợp đồng thử
để xác minh Owner ký PDF, Staff có quyền gửi lời mời và người nhận xác minh OTP.
