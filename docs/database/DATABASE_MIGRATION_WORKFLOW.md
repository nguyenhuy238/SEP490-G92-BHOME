# EF migrations Compact24

## Baseline đã triển khai

Bootstrap Compact24 đã được duyệt; yêu cầu tiếp theo đã cho phép thiết lập EF baseline.
Đã thực thi trên direct development, không chạy migrations legacy hoặc sửa production.

| Mục                 | Kết quả                                                            |
| ------------------- | ------------------------------------------------------------------ |
| Target              | `quiet-hall-21512758` / `development` / `neondb`                   |
| Direct              | `ep-royal-water-ao5mauq0.c-2.ap-southeast-1.aws.neon.tech`         |
| Migration           | `20261108112733_InitialCompact24`                                  |
| Applied / pending   | 1 / 0; chạy lại không áp thêm migration                            |
| Physical schema     | 24 bảng public, 383 cột, 24 PK, 83 FK, 65 indexes                  |
| Tracking            | Một bảng trong `bhome_meta`, không tăng bảng nghiệp vụ public      |
| SQL được giữ nguyên | `docs/database/2026-11-03/compact-24/BHOME_24_TABLES.sql`          |
| SHA-256 bytes       | `85A9B7D01A9D5F480C73B5D78349E5E1AF941DAB1886D569F6C42048FDC3F05C` |

Trước bootstrap đã kiểm tra public không có relations/routines, checksum và lưu
pg_dump trước thay đổi. Backup `.tools/neon-integration/development-before-bootstrap.dump.dpapi`
được bảo vệ bằng Windows DPAPI CurrentUser; không commit. Chỉ tài khoản Windows tương
ứng giải mã được; chưa nghiệm thu backup di động/PITR/disaster recovery cho nhóm.
Không reset/import/drop dữ liệu business.

## Cấu trúc baseline

Runtime có `ToSqlQuery` projections và typed writer. Scaffolder chỉ tạo hai bảng
native Identity, nên dùng Up tự sinh sẽ thiếu phần lớn schema. Baseline dùng SQL
**đóng băng** `Persistence/Compact24/Migrations/InitialCompact24.sql`, kiểm checksum
khi đọc, cùng designer và `Compact24DbContextModelSnapshot` riêng. Chỉ bỏ outer
BEGIN/COMMIT để EF sở hữu transaction gồm cả history INSERT; giữ DO/function bodies.

Table-only check metadata trên projection không có bảng được bỏ khỏi model runtime
để EF 8 không scaffold lỗi `ToTable(null, ...)`. Check PostgreSQL vẫn nằm trong DDL
đã duyệt; không bỏ validation hay constraint vật lý. Snapshot/target model và DDL
được kiểm thử trên PostgreSQL disposable. Auto-scaffold không thay thế review schema
vật lý/JSON/projections/raw SQL.

`Down` của baseline từ chối rollback phá dữ liệu. Không sửa baseline đã deploy;
thêm migration tiếp theo. `Compact24Schema` vẫn kiểm columns/FK/index/trigger/function.
History riêng được cấu hình trong `Compact24DbContext.OnConfiguring`.

Database local cũ dựng bằng SQL vẫn hoạt động, không tự ghi history giả. Baseline
từ chối public tables đã tồn tại nhưng thiếu history; adopt dữ liệu hiện có cần kế
hoạch review riêng, không chỉ INSERT history để bỏ qua kiểm chứng.

## Thay đổi qua PR

1. Map BF/UC/GBR/DBR và normal/negative/concurrency acceptance cases; chọn đúng context.
2. Sửa domain/config/projections/writer cần thiết; không sửa model legacy rồi giả định
   runtime Compact24 đã đổi.
3. Dùng DB local disposable `bhome_compact24_<32 hex>` và secret
   `BHOME_COMPACT24_DIRECT`. Factory từ chối pooled/production, local bhome có dữ liệu,
   và remote host khác verified development direct.
4. Scaffold, review và bổ sung SQL cho phần schema không được model projections quản lý:

```powershell
dotnet ef migrations add <Name> --context Compact24DbContext --project src/backend/BHome.Infrastructure --startup-project src/backend/BHome.Api --output-dir Persistence/Compact24/Migrations
dotnet ef migrations script --idempotent --context Compact24DbContext --project src/backend/BHome.Infrastructure --startup-project src/backend/BHome.Api --output .tools/compact24-review.sql
dotnet build src/backend/BHome.sln -c Release
dotnet test src/backend/BHome.sln -c Release --no-build
```

5. Test DB trống và nâng từ version trước, bảo toàn dữ liệu/constraints; không tạo
   phantom tables từ aliases, không dùng Neon làm disposable test DB.
6. Commit code/migration/snapshot/test/docs trên `member/<tên>`, PR vào develop,
   người khác review; Team Leader quản lý main.
7. Migration chưa deploy có thể regenerate sau đồng bộ develop. Migration đã deploy
   giữ nguyên và sửa bằng migration kế tiếp; không xóa history để giải conflict.

## Operator áp shared migration

Profile operator có direct secret; profile developer không có quyền DDL. Factory
yêu cầu allowlisted direct host, `neondb`, VerifyFull/Require và
`BHOME_DATABASE_BRANCH=development`; script đặt selector này. Đối chiếu Console,
pending SQL/commit, impact và backup trước mỗi thay đổi mới. Duyệt bootstrap hiện tại
không phải duyệt mọi migration tương lai.

```powershell
# Mặc định chỉ list:
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Update-NeonDatabase.ps1
# Chỉ operator khi thay đổi cụ thể đã được duyệt:
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Update-NeonDatabase.ps1 -Apply
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Test-Database.ps1 -EnvironmentFile .env.neon -Direct
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Test-Database.ps1 -EnvironmentFile .env.neon
```

## Chẩn đoán lỗi schema sau khi đổi phiên bản ứng dụng

Nếu nhiều màn hình cùng lỗi trong khi đăng nhập/danh sách đơn giản vẫn chạy, kiểm tra `/health/ready` và `scripts/Test-Database.ps1` trước. Probe chỉ đọc metadata, in rõ migration pending; không tự migrate hoặc đổi dữ liệu. Trường hợp 12/11/2026: runtime dùng 8 migration nhưng Neon development mới có baseline đầu tiên, thiếu `residents.contact_email`, cột settlement allocation và external refund. Owner phải dùng profile runtime DML; operator direct riêng mới thực hiện DDL.

Script Update-NeonDatabase mặc định dùng Release để không ghi đè DLL Debug đang được Visual Studio chạy. Có thể chọn `-Configuration Debug` khi đã dừng app; hành vi mặc định vẫn chỉ list. Trước Apply: kiểm tra target, review SQL, backup riêng tư, test nâng từ baseline có dữ liệu tổng hợp và đối chiếu dữ liệu. Không dùng credential operator làm connection runtime.

Schema verifier so khớp cả nội dung function. Bản EF CLI local có thể thêm indentation vào dollar-quoted function body khi xuất script `--idempotent`, làm verifier từ chối dù chỉ khác định dạng. Dùng EF database update cho Apply; script idempotent dùng để review. Nếu cần chạy SQL trong một transaction, sinh script đúng `FROM`/`TO` với `--no-transactions` và **không** `--idempotent`, xác minh đúng applied history trước rồi chạy trong transaction. Không nới lỏng verifier hoặc xóa history để bỏ qua mismatch.

Backup/snapshot/connection secrets chỉ ở cấu hình local bị Git bỏ qua. Khi đối chiếu dữ liệu trên database đang chạy, notifications/refresh_tokens có thể đổi do worker/session; ghi nhận riêng các thay đổi đồng thời, không rollback tự động hoạt động tài chính hoặc phiên người dùng.

API/laptop không tự áp migration. Sau apply kiểm history/pending, schema verifier,
ready, API và authorization âm; ghi actor/time/commit/hash/result rồi báo nhóm đồng
bộ code. Không push/merge tự động.

## Recovery

Xác nhận restore window theo plan Neon thực tế, không giả định SLA. Backup qua direct
với credential từ PG*/PGPASSFILE/secret manager, giữ dump private được mã hóa; backup
MinIO/key ring cùng dữ liệu có references/identity. Không đưa password vào history/log.
Nếu DDL lỗi, xác định rollback trước retry. Nếu đã commit, dừng writer/worker và ưu
tiên forward fix có review. Restore thử vào database/branch riêng được duyệt; không
restore đè shared, chạy Down/drop/truncate như mặc định. RPO/RTO chưa được đo.
