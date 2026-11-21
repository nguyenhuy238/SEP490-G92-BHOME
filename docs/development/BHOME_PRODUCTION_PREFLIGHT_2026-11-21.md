# Production preflight BHOME — 21/11/2026

Trạng thái: **PARTIALLY COMPLETED**. Chưa triển khai Production mới.
Các phần cần review/phê duyệt ở cuối tài liệu; đây chưa phải biên bản nghiệm thu go-live.

## Phạm vi, nguồn và Git

Yêu cầu triển khai Production ngày 21/11 → AGENTS.md mục 6–10, NFR bảo mật/khôi phục,
GBR-01/02/13/18 → workflow release dùng chung, SSH, backup, schema và smoke.
Không đổi nghiệp vụ, API, migration, chính sách tiền hoặc cấu hình thanh toán thật.

Đã đọc workflows CI/release/production-plan, scripts VPS, Dockerfiles, Caddy example,
runbooks Staging/Production, team environment và biên bản CI/CD 20/11. Không tìm thấy
file quy tắc Git gốc riêng trong checkout; áp dụng quy tắc nhánh/review trong AGENTS.md.

- Source làm việc: `member/QHuy`, cập nhật fast-forward từ `origin/develop`.
- [PR #147](https://github.com/nguyenhuy238/SEP490-G92-BHOME/pull/147) đã tích hợp
  source vào `develop`, SHA `28b24f0f82fe0cbfefdf0a58fae527178f185c62`.
- Phát hiện lỗi backup bucket rỗng; commit sửa
  `2cf668751316c3978aa9513d85baa0362dc43da3`,
  [PR #148 vào develop](https://github.com/nguyenhuy238/SEP490-G92-BHOME/pull/148).
- [PR release #149 develop → main](https://github.com/nguyenhuy238/SEP490-G92-BHOME/pull/149)
  đang draft, phụ thuộc #148, review và CI.
- Main hiện `52f7a186a9ef3d598b729d72481102e75322783d`, chỉ README; là merge base
  của develop. Diff tại preflight: 840 commits, 2.930 files. Chưa merge hoặc tạo release tag.
- GitHub API xác nhận main/develop chưa protected, không có ruleset. Chưa thay cấu hình này.
  Đã chuẩn bị JSON bảo vệ main: backend/frontend checks thuộc GitHub Actions app 15368,
  1 review, duyệt push cuối bởi người khác, enforce admins, giải quyết thảo luận,
  cấm force-push/delete. File riêng tại
  `.tools/production-preflight-20261121/PROPOSED_MAIN_PROTECTION_NOT_APPLIED.json`.
  Payload đối chiếu [GitHub branch protection API](https://docs.github.com/en/rest/branches/branch-protection#update-branch-protection).

Người vận hành đã chọn **giữ đề xuất protection để review**, chưa cho phép áp dụng.
PR #148 cũng bổ sung sửa smoke webhook theo trạng thái SePay, thông báo lỗi Public
API fallback và timestamp UTC `deployedAt` trong manifest sau khi deploy thành công.
Các scripts sửa mới chỉ chạy trong thư mục kiểm thử; chưa cài vào Production.

## Tái sử dụng hạ tầng và các thiếu sót

| Thành phần                                              | Kết quả kiểm tra                                                                                     |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| CI backend/frontend, Expo và deployment tests           | Có; giữ nguyên quality gates và bộ lọc CI hiện có                                                    |
| Shared release, tmux worker, flock, stale SHA/run guard | Có; dùng chung Staging/Production                                                                    |
| GHCR SHA tags, OCI revision, digest manifest            | Có trong workflow; Production main artifacts chưa có                                                 |
| Web build theo môi trường, metadata/bundle guard        | Có; không dùng bundle Staging cho Production                                                         |
| Production environment                                  | Cấu hình main-only, reviewer `nguyenhuy238`, `can_admins_bypass=false`: PASS GET + validator thực tế |
| Approval job thật                                       | NOT VERIFIED; chưa có main release dừng chờ duyệt                                                    |
| Production secrets, deploy key, CD flag                 | Chưa có; không cài/bật trong preflight                                                               |
| Root-owned Production scripts                           | Có bản chuẩn bị; chưa commissioned, chưa `ENABLED_AFTER_REVIEW`                                      |
| Backup directory                                        | Đã sửa lỗi thiếu parent trong phiên trước; PR #147 chứa bản sửa                                      |
| Backup bucket rỗng                                      | Lỗi thực tế đã sửa trong #148; bản sửa chưa cài đè script Production                                 |
| Logging                                                 | Các API đang dùng Docker json-file rotation `10m × 3`                                                |
| Scheduled backup/monitoring/alerts BHOME                | Chưa thấy timer hoặc root cron BHOME; NOT CONFIGURED                                                 |
| Off-VPS encrypted backup                                | NOT CONFIGURED; chưa có destination/key được duyệt                                                   |
| Full application rollback drill                         | NOT VERIFIED; cần cửa sổ kiểm thử Staging được duyệt                                                 |

## VPS và dữ liệu được bảo vệ

Ubuntu kernel 6.8, Docker 29.10.0, Compose v5.8.0; RAM 6,3 GiB, swap 4 GiB.
Disk `/opt` còn khoảng 6,5 GiB tại checkpoint, cần kiểm lại trước pull/deploy.
UFW chỉ mở 22/80/443. PostgreSQL và MinIO chỉ publish loopback, không public Internet.

Production vẫn chạy ba image demo cũ; IDs:

| Application | Image ID                                                                  |
| ----------- | ------------------------------------------------------------------------- |
| API         | `sha256:96317a4e36379963c20e6cad0bc9b811c3a31bbddb6e10408a0703bfc974a0c0` |
| Owner       | `sha256:d8e21f88e493fd741567d1e295e638325c90acd2045cc50c073c4de8fac3a9c6` |
| Public      | `sha256:d47c2cfec0bff3a106737dd658d87b125e5ad6ebae0a7299bd4fb28debe9394a` |

Không coi inherited image labels là provenance của source BHOME.
Chụp IDs/images/StartedAt/volumes trước và kiểm lại sau preflight: Production và
PostgreSQL/MinIO hai môi trường không bị recreate/restart. Database/storage đều healthy.

Kiểm trực tiếp xác nhận JWT signing key/issuer/audience và MinIO access key/secret/bucket
tách biệt hai môi trường; chỉ xuất kết quả so sánh, không xuất giá trị bí mật.
API Staging có alias riêng trên edge; database/storage không nằm trên edge.
Production giữ mạng `bhome-vps_default` và routes hiện tại.

Production hiện `SePay__Enabled=false`, jobs/billing/initializer false,
`ContractWorkflow__SimulatedSigningEnabled=false`. Email thật hiện **đang bật**
(`Email__Enabled=true`, `Email__TestEnabled=false`); chưa thay đổi hoặc gửi thử.
Backend mới có các worker chuyên biệt ngoài `Jobs__Enabled`: phải review cấu hình
và side effects trước commissioning, không suy ra tất cả worker đều tắt từ một flag.

Smoke Production hiện tại **FAIL** vì Public `/api/not-a-route` trả HTML HTTP 200.
Live Caddy Public block chỉ có `reverse_proxy public-web:8080`. Đã chuẩn bị
`/opt/bhome-deploy/proposals/20261121/Caddyfile.NOT_APPLIED`: thêm `handle /api/*`
trả 404, giữ nguyên hostname/upstream và các block khác. `caddy validate` trong
container riêng, network none: PASS. Chưa reload hoặc sửa Caddy đang chạy.
SHA256 bản gốc `e5d3457b07c2a273ebcad743d848f7bbaf92b7844d2dca70c001483b8a106f65`;
đề xuất `0ff0ff6095e3a19d87116eb87408f73e817b0b74ff4a1b89a2076988e0cc252a`.

Smoke cũ còn luôn đòi webhook 401, trong khi `SePayWebhookSecurity` trả
503/code `sepay_disabled` khi provider tắt. Bản sửa lấy flag từ container tin cậy,
yêu cầu đúng HTTP status **và** error code: enabled → 401/authentication_failed,
disabled → 503/disabled. Proxy HTML 503, sai code, HTTP 200 và flag không hợp lệ
đều bị từ chối. Đoạn webhook sửa đã kiểm thực tế: Production 503/disabled PASS,
Staging 401/authentication_failed PASS. Full smoke Staging bằng script sửa PASS;
full smoke Production vẫn bị chặn bởi Caddy fallback nêu trên.

Docker build cục bộ cho Owner/Public với cấu hình Production từ SHA `2cf66875…`
đã PASS artifact guard và metadata. Owner API origin là Owner Production qua proxy;
Public API origin là API Production. Images gắn `bhome.preflight-only=true`, không push:

- `bhome/preflight-owner-production:2cf66875`:
  `sha256:bbfe0aee35dfc29a93fcbe6114b80ba885cd75d2dcc2e6ca85f9cc4b0a65563d`.
- `bhome/preflight-public-production:2cf66875`:
  `sha256:ad6981bfb85f4b2c1d1934abd997e11f6439843b5ad88faac5857bca149e4f43`.

Đây là local preflight image IDs, không phải GHCR digests hay release từ main.

## Backup và schema

Evidence private trên VPS:

- `/opt/bhome-backups/production-preflight-20261121T050657-rgglts_j/`:
  dump PostgreSQL, restore log, private config/Caddy/Compose archive, container snapshot,
  catalog comparison và checksums. Quyền tạo mặc định `umask 077`.
- Database dump restore thành công vào database riêng
  `bhome_prod_preflight_20261121_050657`; đối chiếu số dòng 24 bảng với nguồn tại thời
  điểm kiểm tra đều khớp. Không restore đè business database.
- `/opt/bhome-backups/production-storage-preflight-eutgsox6/`:
  mirror + diff Production private bucket PASS bằng script sửa ở thư mục kiểm thử.
  Bucket hiện có 0 objects; chưa thể chứng minh khôi phục một object nghiệp vụ có dữ liệu.
  Lượt backup đầu thất bại vì thư mục đích chưa tồn tại; log được giữ nguyên.
- Không copy dump/config/credentials/objects ra khỏi VPS. Các JSON summary không chứa
  dữ liệu người dùng được lưu riêng tại `.tools/production-preflight-20261121/`.

SQL source SHA256:
`f97676af7340779d142a15fd3a358eda150eb75bc0263e1eb3c3f63ca40283dd`,
khớp baseline Staging và file Production **proposed** hiện có. Chưa thay baseline.

Tạo database trống tách biệt từ DDL candidate, đối chiếu catalog với Production:
24 bảng, 390 cột, 73 indexes, 74 triggers, 220 functions đều khớp; 278 constraints.
Tên CHECK PostgreSQL tự sinh khác theo thứ tự tạo. Hai khác biệt definition/state:

1. `ck_billing_policy_calculation_method` đang NOT VALID, đúng migration
   `PersonMonthlyServiceFees.sql`; kiểm read-only thấy 0 dòng vi phạm hiện tại.
2. `ck_refund_source_or_tenant_petition` có thêm điều kiện resident, đúng migration
   `TenantRefundPetitions.sql`; fresh DDL cũng thực thi điều kiện đó qua CHECK
   `ck_refund_beneficiary` giống nhau ở hai schema.

Không áp dụng migration hoặc validate/drop/recreate constraints. Đây là đối chiếu
candidate develop; phải xác nhận lại source và image từ main trước go-live.

## Kiểm thử đã thực thi

| Test                                 | Status                         | Evidence/phạm vi                                                                                                        |
| ------------------------------------ | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Backend/frontend CI develop mới      | PASS hai jobs                  | Run 44868982084; build/publish/deploy Staging còn đang chạy                                                             |
| CI bản sửa #148                      | PENDING cho head cuối          | Xem checks của PR; các run trước khi bổ sung smoke/report không chứng minh head mới                                     |
| CI PR release #149                   | RUNNING                        | Run 44869833857                                                                                                         |
| Staging CD trước đó                  | PASS                           | Run 44865114303 attempt 2, SHA 882469362552e8d58d5e3dd1b0b8dc4597a3f88b                                                 |
| Deployment Python tests              | PASS 28                        | Linux VPS, gồm regression backup và webhook shell/policy; bash syntax PASS                                              |
| Deployment Node tests                | PASS 17                        | Máy phát triển                                                                                                          |
| Postman live Staging                 | PASS 3 assertions / 2 requests | Saved request subset, public list + anonymous auth rejection, không report lên cloud                                    |
| Staging authenticated read smoke     | PASS 27 checks                 | Owner/Staff/Tenant tổng hợp; read API chính, auth/logout, SePay Test, role rejection, cross-environment token rejection |
| Tenant isolation                     | PASS phạm vi contract fixture  | Tenant1 đọc contract được; Tenant2 nhận 404. Hai Tenant là recipients hợp lệ của cùng invoice                           |
| Production auth                      | NOT RUN                        | Người vận hành xác nhận chưa có tài khoản smoke được duyệt                                                              |
| Production browser hiện tại          | PARTIAL                        | Desktop/mobile refresh đúng origin, 0 service workers; vẫn có lỗi debug localhost và Public chưa có locations route     |
| PostgreSQL backup/restore            | PASS                           | Restore riêng, 24 table counts khớp                                                                                     |
| MinIO backup                         | PASS bucket rỗng               | Mirror/diff bằng bản sửa #148; chưa có object để kiểm restore nội dung                                                  |
| Production approval/deploy/smoke mới | NOT RUN                        | Chưa có main release, commissioning và phê duyệt                                                                        |
| Full rollback Staging/Production     | NOT VERIFIED                   | Chưa fault-inject ba application containers trong phiên này                                                             |

Lượt smoke đầu giả định Tenant2 không được đọc invoice fixture và ghi nhận 1 FAIL.
Đối chiếu `SePaySandboxSeed.cs` cho thấy invoice chỉ định cả hai Tenant làm recipients.
Đã sửa tiền điều kiện kiểm thử theo fixture và bổ sung kiểm tra contract khác quyền;
không sửa ứng dụng/assertions nghiệp vụ để che một lỗi truy cập.
Chưa kiểm cross-Location Staff với hai Locations thực hoặc cross-invoice Tenant không
cùng recipients do fixture không có các tiền điều kiện đó. CI không thay thế kiểm thử live.

## Các bước cần review/phê duyệt và điều kiện tiếp tục

1. Một người khác review #148, CI PASS; tích hợp develop qua PR. Kiểm Staging CD của
   SHA develop sau merge và giữ manifest/digests của chính SHA đó.
2. Chủ dự án review JSON main protection đang được giữ lại theo lựa chọn của họ.
   Chỉ áp dụng sau phê duyệt, sau đó GET kiểm lại;
   không bypass review hoặc required checks để merge release #149.
3. Team Leader review/merge #149 theo quy tắc team. CI main build ba images Production,
   ghi SHA/digests thực tế; lúc này mới có candidate Production hợp lệ.
4. Lập gói commissioning riêng: scripts từ main đã review, key Production forced command,
   environment secrets, các file proposed, rollback refs cũ, schema và backup xác minh.
   Duyệt các thay đổi runtime/email/worker, monitoring/backup schedule/retention và
   phương án tài khoản smoke trước khi áp dụng. Không tạo Owner thứ hai trái unique constraint.
5. Sau commissioning mới bật CD và chứng minh job chờ environment approval. Trình
   main SHA + ba digests + backup/compatibility + cửa sổ gián đoạn để duyệt go-live.
   Deploy chỉ recreate API/Owner/Public; dự kiến có gián đoạn ngắn, chưa cam kết zero downtime.
6. Smoke lỗi: khôi phục release override trước, `up --no-deps --no-build --pull never`
   ba app, kiểm health/routing/smoke và ghi ROLLBACK_PASS/FAILED; không restore đè DB.
   Cần kiểm drill có kiểm soát trước khi đánh dấu rollback đã nghiệm thu.

Hiện chưa có main SHA ứng dụng, ba Production registry digests/manifest, release tag,
go-live approval hoặc Production deploy mới. Không đánh dấu COMPLETED từ các kiểm tra này.
