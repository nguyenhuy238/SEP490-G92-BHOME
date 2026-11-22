# Khôi phục deploy Staging sau thay đổi schema ngày 22/11/2026

## Phạm vi và truy vết

Yêu cầu kiểm tra/sửa CI run `44922660353` → AGENTS.md mục 6, 8–10,
NFR khôi phục và kiểm soát triển khai → migration hiện có
`20261120000100_SharedMainInitialPayment`, checksum schema và release Staging.
Migration liên quan BF-03/04/06, UC-16/22/23, GBR-10/18: thanh toán ban đầu
và phân bổ khoản thu. Phiên sửa hạ tầng này không bổ sung chính sách tài chính.

Người vận hành đã duyệt trong phiên làm việc ngày 22/11/2026: áp migration
cụ thể vào Staging, cập nhật baseline và chạy lại deploy. Không áp Production.
Quy trình đối chiếu: [database migration](../database/DATABASE_MIGRATION_WORKFLOW.md)
và [release Staging](BHOME_STAGING_DEPLOYMENT.md).

## Nguyên nhân đã xác nhận

[Run 44922660353](https://github.com/nguyenhuy238/SEP490-G92-BHOME/actions/runs/44922660353)
build/test backend, frontend và build images thành công. Job `release / staging`
dừng ở kiểm tra checksum với exit 5, trước khi thay container ứng dụng.

Trước khi sửa, Staging chạy `33b95b7b52eb1c244ae8200ce6c36b1eaeaf5297`. SQL tại commit
`d4403d8a7f638d142ed462a2e1c8e8764d11b7f9` thay đúng hàm
`bhome24_initial_payment_guard()`. Schema đang dùng khớp schema cũ; baseline không
bị hỏng. Guard đã chặn đúng release chưa áp migration.

| Artifact     | SHA-256                                                            |
| ------------ | ------------------------------------------------------------------ |
| Schema trước | `f97676af7340779d142a15fd3a358eda150eb75bc0263e1eb3c3f63ca40283dd` |
| Schema sau   | `036b8334ee08b59f640911741c99e7630b1001d99dec6de7dee70800937227c9` |

Staging được bootstrap từ SQL, không có `bhome_meta.__EFMigrationsHistory`.
Không chạy toàn bộ EF baseline trên database này hoặc chèn history giả.
Chỉ áp SQL của migration đã review; giữ nguyên guard checksum cho lần release sau.

## Gói sửa và kiểm chứng

Gói operator root-only tại VPS:
`/opt/bhome-deploy/repairs/20261122-shared-main-initial-payment/`.
`apply.sql` dùng transaction, timeout và kiểm tra đúng tên database/nội dung hàm
trước và sau. `review.json` ghi commit, hash SQL và kết quả thực thi;
`rollback-function.sql` giữ hàm trước thay đổi.

Trước khi áp dụng:

- Đối chiếu schema-only dump Staging với schema commit trước: PASS.
- Trên PostgreSQL 16 riêng với dữ liệu tổng hợp, schema cũ + migration khớp toàn bộ
  schema đích; áp lại migration không đổi schema: PASS.
- `dotnet test` với filter `SharedMainInitialPaymentMigrationTests` và
  `SePayIntegrationTests.MainInitialQrUsesOneReceiptForDepositAndRentFeesAndRejectsPartialOrDuplicateEffects`:
  PASS 2/2, không skip. Bao gồm nâng cấp, dữ liệu cũ, readiness, phân quyền,
  thanh toán thiếu/thừa, callback lặp và phân bổ tiền phòng dùng chung.
- `dotnet format src/backend/BHome.sln --verify-no-changes --no-restore --include tests/backend/BHome.IntegrationTests/Compact24/SharedMainInitialPaymentMigrationTests.cs`:
  PASS.

Thực thi giữ khóa release chung và Staging, xác minh ba image digest của run,
dừng API Staging để chặn writer trong khoảng nâng cấp, backup database private và
restore thử riêng trước DDL. Chỉ cập nhật baseline sau khi schema đích khớp;
release ứng dụng tiếp tục theo workflow hiện có, không build từ source local.

Không đưa dữ liệu/credential vào repo. Không sửa EF migration đã có, không reset
database và không tắt schema guard.

## Kết quả thực thi

- [Run 44922660353, attempt 2](https://github.com/nguyenhuy238/SEP490-G92-BHOME/actions/runs/44922660353/attempts/2):
  **SUCCESS**, job `release / staging` thành công. Backend/frontend/images giữ kết
  quả thành công của attempt trước; không tuyên bố các suite này được chạy lại.
- Staging `current.json`: commit `d4403d8a7f638d142ed462a2e1c8e8764d11b7f9`,
  run `44922660353-2`, hoàn tất lúc **18:18:21 ngày 22/11/2026**, Asia/Ho_Chi_Minh.
- Backup trước DDL:
  `/opt/bhome-backups/staging-schema-20261122T111708/`.
  Restore thử thành công; đối chiếu số dòng/checksum dữ liệu đủ 24 bảng và nội dung
  các hàm khớp nguồn. Backup dữ liệu và cấu hình tiếp tục được release workflow
  kiểm chứng trước khi đổi image.
- Lần kiểm restore đầu dừng trước DDL vì PostgreSQL deparse lại các phép cast
  trong CHECK/index và cấp OID mới cho type của extension. Đã đối chiếu bằng nội
  dung dữ liệu và tên kiểu/chữ ký hàm thay cho OID cục bộ; các lần dừng khởi động
  lại API cũ. Không nới lỏng schema verifier của ứng dụng hoặc checksum release.
- Schema sau migration khớp toàn bộ schema đích; baseline đã cập nhật đúng hash
  schema sau trong bảng trên. Không tạo/chèn EF migration history.
- Worker release ghi `DEPLOY_PASS`, exit 0; kiểm chứng image đang chạy đúng digest.
  HTTPS, Public API, CORS, auth isolation, webhook không xác thực, synthetic
  login/refresh rotation/authorized read/logout: PASS.
- Snapshot các container/cấu hình được bảo vệ: PASS. Production, PostgreSQL,
  MinIO và các container tương thích không bị recreate bởi release này.
- Evidence release:
  `/opt/bhome-backups/staging-cd-20261122T111750-d4403d8a7f63-mNKq/`.
- Đã dọn bốn database restore tạm của phiên sửa, container/volume PostgreSQL
  tổng hợp và SSH tunnel kiểm thử. Giữ backup/evidence riêng tư tại VPS.

Source bổ sung regression test và biên bản trên `member/QHuy`; chưa push/merge.
Không chạy lại toàn bộ backend/frontend suite ở máy phát triển. Kiểm tra cuối
`git diff --check` và Prettier hai tài liệu thay đổi: PASS.
