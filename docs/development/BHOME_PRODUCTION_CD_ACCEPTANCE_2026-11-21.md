# Nghiệm thu CD Production BHOME — 21/11/2026

**Kết luận tổng thể: PARTIALLY COMPLETED.** Pipeline Production đã chạy thật và
triển khai thành công. Phần chưa hoàn tất là nghiệm thu nghiệp vụ với dữ liệu dương
của từng Tenant/Location, alert tới người trực và replication backup định kỳ ngoài
VPS; không coi smoke trên danh sách rỗng là bằng chứng cho các trường hợp này.

Production đang chạy main `70406ecf8dceea6e84e4ddbaa3e325807af123f2`, deploy
**14:48:52 ngày 21/11/2026 (Asia/Ho_Chi_Minh)**. [Actions 44878730626](https://github.com/nguyenhuy238/SEP490-G92-BHOME/actions/runs/44878730626)
completed/success; production deployment cuối là attempt 4. API, Owner và Public đều
Docker healthy. Không có blocker cho release đã triển khai.

Yêu cầu → MASTER PROMPT Production CD, NFR bảo mật/khôi phục, GBR-01/02/13/18 → shared
release scripts, GitHub protection, Docker/Compose, backup, monitoring → CI, gate thật,
release/provenance, restore, rollback, API và browser smoke. Không sửa nghiệp vụ,
schema, DTO, công thức tiền hoặc API contract. Mobile không phát hành trong lượt này.

## A. Git và release

| Mục                     | Kết quả                                                                                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Branch làm việc         | `member/QHuy`; không push trực tiếp main/develop                                                                                                                                            |
| Sửa lỗi staging ban đầu | `830c4327`: tạo thư mục backup root trước `mktemp`, private permissions; regression test; tích hợp qua #147                                                                                 |
| Safeguards release      | [PR #148](https://github.com/nguyenhuy238/SEP490-G92-BHOME/pull/148), LowG0506 approve, merge vào develop                                                                                   |
| Develop/Staging         | `473d77e48c52a3b4a9e0c7cfe37e2642685e90ab`; [CI/CD 44875753554](https://github.com/nguyenhuy238/SEP490-G92-BHOME/actions/runs/44875753554) success                                          |
| Release PR              | [#149 develop → main](https://github.com/nguyenhuy238/SEP490-G92-BHOME/pull/149), đã merge; LowG0506 có review trước đó, #148 được review riêng                                             |
| Main SHA                | `70406ecf8dceea6e84e4ddbaa3e325807af123f2`                                                                                                                                                  |
| Candidate CI            | [44872692233](https://github.com/nguyenhuy238/SEP490-G92-BHOME/actions/runs/44872692233), [44875757397](https://github.com/nguyenhuy238/SEP490-G92-BHOME/actions/runs/44875757397): success |
| Main CI và Production   | [44878730626](https://github.com/nguyenhuy238/SEP490-G92-BHOME/actions/runs/44878730626): backend/frontend/images/production-policy/production success                                      |
| Ops bổ sung             | `875b0376`, `3c09d33b` trên member/QHuy; đã cài root-only và kiểm thử trên VPS, chưa nằm trong application main SHA trên                                                                    |
| Release tag             | Không tạo tag riêng; pin bằng commit SHA và image digests                                                                                                                                   |

Chủ dự án đã yêu cầu áp dụng cấu hình và triển khai, không yêu cầu review bổ sung.
Main protection đã áp dụng: backend/frontend Actions checks, strict, enforce admins,
1 approval, giải quyết thảo luận, cấm force-push/delete. Giữ review hiện có;
không bật dismiss-stale/last-push review bổ sung. Environment Production vẫn main-only,
required reviewer, `can_admins_bypass=false`; không bỏ CI hoặc approval gate.

## B. Docker / GHCR

Cả ba dùng tag `sha-70406ecf8dceea6e84e4ddbaa3e325807af123f2`.

| Image trong `ghcr.io/nguyenhuy238/` | Immutable digest                                                          |
| ----------------------------------- | ------------------------------------------------------------------------- |
| `bhome-api`                         | `sha256:1da211956d4a4600e53c1481f18c9db0f4b9b40e96cc4e3e38aaca24817ec1b0` |
| `bhome-owner-web-production`        | `sha256:5087de3ad7028f88a77b82cd14960e3a93274073cb45cfd2ca584d60ddd5615b` |
| `bhome-public-web-production`       | `sha256:6568165c603ce380f96df35a37ce2c0e72ae82b60a873f18f6108785d22e27f5` |

Manifest GHCR artifact `release-70406ecf8dceea6e84e4ddbaa3e325807af123f2-2`,
ID `14697487956`, từ image job attempt 2. Attempts 3/4 chỉ rerun Production job,
dùng lại chính output immutable này. Không chọn artifact theo ID lớn nhất vì ID
không đơn điệu theo attempt. OCI revision/source, image refs, compiled origins và
release metadata đã đối chiếu. Runtime manifest:
`/opt/bhome-deploy/production/current.json`, run `44878730626-4`.

## C. VPS Production

- Owner: https://owner.103.146.23.157.sslip.io
- Public: https://www.103.146.23.157.sslip.io
- API: https://api.103.146.23.157.sslip.io

Đã commissioning shared scripts từ main, schema checksum, rollback image refs,
Deployment anchors/origins, key riêng với forced command và pinned host key,
Production environment secrets, CD flag và marker sau ủy quyền. Root password và
operator key không được nhập vào Actions. Shell command và release Staging bằng
key Production bị từ chối thực tế (exit 126).

Deploy cập nhật ba application containers của project `bhome-vps`. API readiness
và web HTTP healthchecks đều native Docker healthy. Caddy thêm rejection Public
`/api/*`, validate/reload; không restart Caddy/PostgreSQL/MinIO. Staging cùng các data
containers giữ ID/StartedAt theo protected snapshot. Không xóa volume, auto seed,
auto migration hoặc restore đè database nghiệp vụ.

Schema guard xác nhận catalog hiện hữu và candidate; SQL baseline
`f97676af7340779d142a15fd3a358eda150eb75bc0263e1eb3c3f63ca40283dd`.
Catalog kiểm tra có 24 bảng, 390 cột, 278 constraints, 73 indexes, 74 triggers và
220 functions. Các khác biệt fresh DDL so với migration được phân tích trong schema
evidence; không sửa schema để vượt guard. Check billing NOT VALID có 0 dòng vi phạm.

Fingerprint 10 bảng locations/rooms/residents/contracts/billing_policies/invoices/
invoice_items/payments/payment_allocations/refund_requests khớp database baseline
restore riêng trước go-live. Không xuất dữ liệu dòng ra báo cáo. Ba tài khoản tổng
hợp `example.invalid` có password hash tạm cho smoke; hash/security stamp ban đầu
được khôi phục và đối chiếu sau thử nghiệm. Không dùng tài khoản người thật.

Email, push/SMS, notification automation, SePay, general jobs, billing automation,
Staff auto-reconcile và initializer tắt. Các external signing/OTP/upload switches
tắt; không thanh toán, gửi email hoặc ký thật. Source vẫn có OwnerSession và worker
activation riêng; không suy ra mọi cơ chế ký/worker đã bị vô hiệu hóa. Preflight
không có PendingActivation và fingerprints nghiệp vụ giữ nguyên sau deploy.

## D. Tests đã thực thi

| Test                  | Status              | Evidence / giới hạn                                                                                                                                                               |
| --------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend CI            | PASS                | Main Actions: restore/build/isolated tests/format theo workflow; không chạy black-box suite nhắm DB thật                                                                          |
| Frontend CI           | PASS                | Main Actions: các lint/typecheck/test/build/export theo workflow                                                                                                                  |
| Staging CD            | PASS                | Run 44875753554; live API/browser và isolation; staging không recreate trong Production release                                                                                   |
| Production Approval   | PASS                | Job thật pending approval trước SSH; retry đều qua gate; chủ dự án ủy quyền áp dụng/triển khai                                                                                    |
| Production Deploy     | PASS                | Run 44878730626 attempt 4; `DEPLOY_PASS`, SHA/digests đúng                                                                                                                        |
| Production Smoke      | PASS                | Shared release smoke, readiness, HTTPS/TLS, provenance, CORS/isolation; ba apps healthy                                                                                           |
| Authentication        | PASS                | 32/32 authenticated checks Owner/Staff/Tenant: login/refresh/me/logout, token sau logout bị từ chối, roles và cross-environment                                                   |
| API                   | PASS, giới hạn      | Owner đọc locations/rooms/staff/tasks/contracts/invoices/payments/incidents; Staff/Tenant routes cho phép và routes cấm 403; chưa chứng minh dữ liệu dương/cross-object isolation |
| Owner browser         | PASS                | Desktop 1440/mobile 390: login/dashboard/reload/logout, đúng Production origin, TLS 1.3; không có server/transport errors ghi nhận                                                |
| Public browser        | PASS, giới hạn      | Desktop/mobile: live empty/404/read-only và đúng API origin; published photo/room/error fixtures là synthetic interception, không tính là live records                            |
| Database Safety       | PASS                | Custom dump restore DB mới, schema guard, protected containers và 10 fingerprints khớp; không restore đè `bhome`                                                                  |
| Storage Safety        | PASS                | MinIO mirror/diff; upload-delete-restore synthetic object ở bucket tạm riêng, hash khớp, đã dọn bucket                                                                            |
| Rollback              | PASS, phạm vi riêng | Hàm rollback nguyên bản trên ba Docker app containers trong stack tách biệt, deliberate failure → `ROLLBACK_PASS`; không fault-inject traffic Production/schema                   |
| Deployment unit tests | PASS                | 34 Python tests trên Linux/root (không skip), 20 Node tests; gồm lock contention, backup paths/retention, origins, gate và webhook guard                                          |
| Operations            | PASS                | systemd units validate, health/backup thật PASS, restore riêng PASS, OnFailure journal thử thật; log rotation 10m × 3                                                             |
| Backup ngoài VPS      | PASS checkpoint     | Bản sau release mã hóa, SHA256/HMAC xác minh sau copy; decrypt/tar verification PASS trên VPS; chưa replication định kỳ                                                           |

Các lỗi đã xử lý: staging thiếu parent backup directory; pull image làm disk reserve
xuống dưới 4 GiB nên attempt 2 dừng an toàn trước thay image; dọn riêng build cache
không dùng trên 12 giờ, giữ cache 2 GB, giải phóng 17,41 GB; bổ sung web Docker
healthchecks qua attempt 4; sửa cookie assertion không phân biệt hoa thường trong
smoke harness; sửa backup chờ flock thay vì bỏ lượt khi health/release đang chạy.
Không dùng system prune, không xóa volume hoặc runtime/rollback images.

Evidence root-only chính:

- `/opt/bhome-backups/production-commissioning-20261121T070834-1ugcacaj/`:
  `final-release-verification.json`, `authenticated-production-smoke.json`,
  `browser-production/`, `business-data-baseline.json`, schema/provenance/preflight.
- `/opt/bhome-backups/production-cd-20261121T074831-70406ecf8dce-b8nj/`: release cuối.
- `/opt/bhome-backups/application-rollback-proof-v9n_tlr1/`: rollback riêng.
- `/opt/bhome-backups/storage-restore-proof-psmdquha/`: storage restore riêng.
- `/opt/bhome-backups/production-scheduled-backup-20261121T075402-i5mldxr4/`:
  backup sau deploy, restore/storage PASS.
- `/var/lib/bhome-operations/health.json`, `backup.json`; installed ops source/hash
  tại `/opt/bhome-deploy/production/operations-source.json`.
- Local evidence ignored: `.tools/production-preflight-20261121/`; encrypted backup
  `.tools/production-backup-20261121-private/`, Windows ACL private. Không commit backup/recovery.

## E. Còn tồn tại / NOT VERIFIED

1. Tài khoản Tenant smoke chưa có contract/invoice. Chưa xác minh live positive own
   records, deep cross-Tenant/cross-Location và đầy đủ CRUD nghiệp vụ Production.
   Không tạo dữ liệu kinh doanh để làm đẹp nghiệm thu. CI isolated không thay thế
   bằng chứng live này; cũng chưa chạy Mobile regression trên thiết bị.
2. Chưa có alert chủ động email/Slack tới người trực; hiện systemd OnFailure ghi
   journal và Actions thể hiện failure. Chưa chứng minh người trực nhận cảnh báo.
3. Daily backup 02:15 Asia/Ho_Chi_Minh, retention 7 ngày và restore verification đã
   cài; chưa quan sát qua đủ một chu kỳ ngày. Bản ngoài VPS đã có nhưng chưa có đích
   replication định kỳ độc lập. Recovery material và archive đang cùng máy người
   vận hành; cần quản lý recovery riêng failure domain khi vận hành dài hạn.
4. Rollback đã chạy thật trong stack riêng; chưa fault injection trên traffic thật,
   chưa diễn tập mất toàn VPS, chưa chứng minh RPO/RTO hoặc zero downtime. Backup
   DB/storage không phải snapshot nguyên tử khi có ghi đồng thời.
5. Contract activation worker/OwnerSession hiện hữu không thuộc thay đổi CD. Phải
   xử lý theo SRS/quyết định thiết kế riêng trước nghiệm thu nghiệp vụ ký/kích hoạt.
   Không có bằng chứng thanh toán/provider signing thực; lượt này chủ động không bật.
6. Các bổ sung ops/docs sau application main SHA được commit/push member/QHuy;
   cần tích hợp qua PR để main/develop cũng chứa source vận hành đã cài. Runtime
   app vẫn đúng SHA được release, không gắn nhãn ops commit thành app release.

Không có secret trong tập thay đổi commit được rà soát; dữ liệu cấu hình/dump/
recovery giữ private, không đưa vào Git. Đây không phải tuyên bố audit bảo mật toàn bộ
lịch sử repository. Không còn lỗi chặn deployment đã ghi nhận sau attempt 4.

## F. Kết luận và vận hành tiếp

**PARTIALLY COMPLETED** cho toàn bộ MASTER PROMPT vì các mục NOT VERIFIED ở trên.
Luồng Production CD thực tế main → CI → GHCR → gate/approval → SSH → VPS → smoke
đã thành công. Không gọi trạng thái này là BLOCKED; các giới hạn nghiệm thu không
làm mất hiệu lực bằng chứng release đang chạy.

Xem [runbook phát hành](BHOME_PRODUCTION_RELEASE_RUNBOOK.md),
[ops/backup/rollback](BHOME_PRODUCTION_OPERATIONS_2026-11-21.md) và
[links truy cập](BHOME_ACCESS_LINKS_NOTE.md). Không cần phê duyệt thêm cho release
đã được ủy quyền và đã triển khai. Các lần release sau tiếp tục qua CI/protection/
environment approval theo cấu hình đang áp dụng.
