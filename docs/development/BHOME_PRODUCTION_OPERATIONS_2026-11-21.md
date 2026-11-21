# Vận hành Production sau commissioning 21/11/2026

Tài liệu này bổ sung [runbook release](BHOME_PRODUCTION_RELEASE_RUNBOOK.md).
Mốc preflight cũ nằm ở [biên bản preflight](BHOME_PRODUCTION_PREFLIGHT_2026-11-21.md);
không dùng trạng thái chưa deploy trong biên bản cũ làm trạng thái hiện tại.
Production đã deploy thành công main `70406ecf`, run `44878730626-4`, lúc
14:48:52 ngày 21/11/2026 (Asia/Ho_Chi_Minh). Xem
[nghiệm thu hiện tại](BHOME_PRODUCTION_CD_ACCEPTANCE_2026-11-21.md).
Đối chiếu GitHub run và `/opt/bhome-deploy/production/current.json` cho release tiếp theo.

## Phạm vi và ủy quyền

Yêu cầu Production CD → NFR bảo mật/khôi phục, GBR-01/02/13/18 → shared release
scripts, GitHub protection, backup, monitoring và smoke. Không đổi schema, DTO,
phí, payment allocation hoặc nghiệp vụ ký/kích hoạt contract trong nhiệm vụ này.

Ngày 21/11 người vận hành ghi rõ: áp dụng cấu hình và triển khai Production,
không yêu cầu review bổ sung. Đã áp dụng protection `main`: required backend/frontend
checks từ GitHub Actions, enforce admins, một review, giải quyết thảo luận,
cấm force-push/delete. Giữ review hiện có của LowG0506 trên release và bản sửa #148;
không bật dismiss-stale/last-push review bổ sung trong lần commissioning được ủy quyền.
Production environment vẫn main-only, có reviewer và `can_admins_bypass=false`.
Không tắt CI hoặc environment approval gate.

## Commissioning thực tế

- Main release merge #149: `70406ecf8dceea6e84e4ddbaa3e325807af123f2`.
- CI main: [run 44878730626](https://github.com/nguyenhuy238/SEP490-G92-BHOME/actions/runs/44878730626).
- Evidence commissioning root-only:
  `/opt/bhome-backups/production-commissioning-20261121T070834-1ugcacaj/`.
- Dump PostgreSQL restore thử riêng thành công; không restore đè `bhome`.
- MinIO mirror/diff thành công. Object tổng hợp được khôi phục và đối chiếu hash
  trong bucket tạm riêng; bucket tạm đã dọn. Evidence:
  `/opt/bhome-backups/storage-restore-proof-psmdquha/`.
- Caddy Public đã thêm API path rejection, validate/reload thành công; không thay
  hostname, không restart Caddy/PostgreSQL/MinIO.
- API demo cũ được recreate một lần với baseline cấu hình đã duyệt, giữ image cũ;
  scripts và rollback image references được backup trước khi thay.
- SePay vẫn `Enabled=false`, `Mode=Live` chỉ để tránh kế thừa Sandbox default;
  không thêm credentials hoặc bật thanh toán thật. Email, push, SMS, notification
  automation, general jobs, billing automation, Staff auto-reconcile và initializer tắt.
- Các external signing/OTP/upload method switches tắt trong commissioning. Backend
  vẫn có OwnerSession và worker activation riêng trong source; không thực hiện ký thật
  hoặc thay chính sách các luồng này. Trước release, kiểm read-only không có contract
  PendingActivation; general Jobs flag không chứng minh mọi worker đều tắt.
- Key Production riêng root-only, forced command giới hạn đúng release command,
  pin host key. Private key được mã hóa tại VPS bằng GitHub public key trước khi nhập
  environment secret; không đưa root password/full-access operator key vào Actions.

## Health, log và cảnh báo

`production-operations.py` dùng standard library, không thêm dependency hạ tầng.
Script chạy root bởi systemd và dùng cùng flock với deployment để tránh cạnh tranh.
Health bỏ lượt nếu khóa bận và thử lại ở tick tiếp theo; backup chờ khóa, không bỏ
lượt hàng ngày. Đã kiểm thử cả hai tình huống và chạy backup thật sau go-live.

```sh
systemctl status bhome-health.timer bhome-health.service
systemctl list-timers bhome-health.timer bhome-backup.timer
cat /var/lib/bhome-operations/health.json
journalctl -u bhome-health.service -u bhome-backup.service --since today
journalctl -t bhome-alert --since today
docker logs --tail 100 bhome-vps-api-1
```

- Health mỗi 5 phút: container state/health, API readiness (DB/schema), HTTPS
  Owner/Public/API, disk reserve tối thiểu 4 GiB. Container starting/unhealthy,
  dependency/readiness lỗi hoặc TLS lỗi đều FAIL.
- Các container Production dùng Docker log rotation `max-size=10m`, `max-file=3`.
- Service lỗi kích hoạt `bhome-operations-alert.service`, ghi mức error vào journal.
  Đã thử OnFailure với service tạm cố ý thất bại; không làm hỏng dịch vụ thật.
- GitHub Actions giữ kết quả deploy và thông báo thất bại theo subscription tài khoản.
  Chưa có kênh gửi alert chủ động email/Slack; journal không tương đương người trực
  đã nhận cảnh báo. Không bật SMTP thật chỉ để thử alert.

## Backup và retention

```sh
systemctl start bhome-backup.service
systemctl status bhome-backup.service
cat /var/lib/bhome-operations/backup.json
```

Timer chạy **02:15 Asia/Ho_Chi_Minh** mỗi ngày. Backup gồm private config/Caddy/Compose,
container metadata, PostgreSQL custom dump, restore verification riêng và MinIO mirror/diff.
Database verification do đúng invocation tạo được drop sau khi restore thành công;
không drop database nghiệp vụ hoặc DB verification khác.

Mỗi backup có manifest, checksums và quyền root-only. Retention mặc định 7 ngày,
cấu hình `BHOME_BACKUP_RETENTION_DAYS` trong service. Chỉ xóa thư mục con trực tiếp
`production-scheduled-backup-*`, root-owned, không symlink, đúng manifest tool và
đã restoreVerified. Không xóa preflight/commissioning/release evidence hoặc backup
khác. File marker hỏng/thiếu không được coi là backup thuộc quyền retention.

Nếu disk dưới 4 GiB, script dừng và cảnh báo; không tự `docker system prune`, xóa
volume hoặc xóa image rollback. Xem `df -h /opt`, `docker system df`, log rotation
và các backup đã hết retention. Chỉ dọn artifact cụ thể sau khi xác minh không dùng.

## Bản sao ngoài VPS

Checkpoint encrypted backup đã được sao chép và xác minh tại máy người vận hành:
`.tools/production-backup-20261121-private/` (ignored, Windows ACL giới hạn tài khoản
hiện tại và SYSTEM). Không commit, gửi chat hoặc upload file recovery/private backup.

Archive dùng AES-256-CBC, PBKDF2-SHA256 200.000 iterations và HMAC-SHA256 riêng.
Phải xác minh HMAC trước khi giải mã. Lượt kiểm thử đã xác minh HMAC của bản copy,
giải mã và đọc tar thành công mà không xuất dữ liệu plaintext ra console.
`recovery.json` chứa vật liệu khôi phục riêng tư; không `cat` hoặc in giá trị.
Checkpoint mới nhất là backup sau release `production-scheduled-backup-20261121T075402-i5mldxr4`,
đã restore thử và kiểm HMAC/SHA256 sau khi copy ra ngoài VPS.
Đây là bản copy tại một thời điểm, chưa có replication định kỳ
đến một storage độc lập. Người vận hành cần giữ recovery material ngoài VPS và ngoài
cùng failure domain của archive, rồi bổ sung destination cho replication dài hạn.

## Rollback và phục hồi

Shared `deploy-release.sh` tự restore release override trước, recreate ba application
containers bằng `--no-deps --no-build --pull never`, kiểm readiness/smoke/protected
snapshot và ghi `ROLLBACK_PASS` hoặc `ROLLBACK_FAILED`. Không restore DB tự động.

Đã chạy hàm rollback không sửa từ script commissioned với ba Docker containers thật
trong stack riêng: deliberate failure, restore cấu hình trước, xác minh image IDs và
HTTP các apps; kết quả `ROLLBACK_PASS`. Evidence:
`/opt/bhome-backups/application-rollback-proof-v9n_tlr1/`.
Đây là diễn tập infrastructure rollback tách biệt, không phải fault injection trên
traffic Production hoặc chứng minh rollback schema/data.

Nếu rollback tự động lỗi: lấy evidence path từ deploy log, giữ nguyên dữ liệu,
validate Compose, khôi phục chính release override cũ rồi up ba apps và chạy smoke.
Không down volumes, seed hoặc thay baseline checksum để vượt guard. Schema artifact
khác baseline phải qua migration plan riêng; image rollback không rollback schema.

Nếu VPS mất hoàn toàn: tạo máy sạch, khôi phục private config/keys từ bản mã hóa
đã xác minh, restore dump vào DB mới, restore private storage, validate owner/ACL/TLS,
cài đúng scripts và images từ manifest, kiểm isolation/health trước khi chuyển DNS.
Restore ghi đè business database cần kế hoạch/ủy quyền riêng.

## Rotation

Tạo key CI mới riêng và forced-command entry, đối chiếu host key qua operator session,
nhập sealed environment secrets, thử release/negative command rồi mới bỏ entry cũ.
Không thay JWT/encryption/Data Protection keys cùng một application release nếu chưa
có kế hoạch ảnh hưởng phiên, dữ liệu mã hóa và rollback. Backup recovery keys cũng
cần giữ lịch sử để đọc các archive còn retention.
