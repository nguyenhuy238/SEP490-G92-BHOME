# Kiểm chứng Neon development — 08/11/2026

## Kết quả hiện tại

**Đã hoàn tất bootstrap và kiểm chứng API với Neon development.** Shared database,
EF tracking và năm role riêng đã hoạt động. Chưa nghiệm thu nhiều máy hoặc MinIO
liên máy; không gọi kết quả này là kiểm thử hai máy hay toàn bộ hệ thống production.
Quyết định phạm vi sau kiểm chứng: người dùng chọn **giữ MinIO local; chốt phần Neon
trước**. Phần Neon được chốt theo kết quả đã ghi; storage liên máy để giai đoạn sau.

Target project `quiet-hall-21512758`, branch development theo endpoints được người
dùng xác nhận, database `neondb`. Direct:
`ep-royal-water-ao5mauq0.c-2.ap-southeast-1.aws.neon.tech`; runtime dùng pooled cùng
endpoint `-pooler`. Không sửa production; không gọi Neon Management API khi không
có token. SQL kiểm tra được database/role/schema, không tự chứng minh branch ID.

## Schema và migrations

| Kiểm tra thực tế                         | Kết quả                                                               |
| ---------------------------------------- | --------------------------------------------------------------------- |
| DNS/TCP/Npgsql/authentication            | PASS trên direct và pooled                                            |
| TLS/channel binding                      | VerifyFull/Require thành công, không bỏ CA/hostname verification      |
| Server                                   | PostgreSQL 18.6                                                       |
| Public tables / columns                  | **24 / 383**                                                          |
| Primary keys / foreign keys              | **24 / 83**                                                           |
| Indexes / unique constraints / exclusion | **65 / 10 / 1**                                                       |
| Check constraints                        | 155                                                                   |
| Schema verifier                          | PASS: columns, FK, required indexes, trigger/function definitions     |
| EF baseline                              | `20261108112733_InitialCompact24`                                     |
| History                                  | `bhome_meta.__EFMigrationsHistory`, 1 applied / 0 pending / 0 unknown |
| Legacy EF                                | 35 source migrations của BHomeDbContext giữ nguyên, không áp lên Neon |
| Replay                                   | Apply lần hai exit 0, không áp thêm migration hoặc mất dữ liệu        |
| DatabaseCheck runtime role               | PASS, exit 0; không đọc Tenant records                                |
| Local PostgreSQL                         | Được giữ, không tự adopt EF history/reset dữ liệu                     |

Tổng cộng có 24 bảng nghiệp vụ public và 1 bảng tracking kỹ thuật trong bhome_meta.
Con số 386 cột trong ghi chú/header cũ không khớp SQL đã duyệt; thực đo là 383.
Không đổi cấu trúc để ép khớp số cũ. File DDL bootstrap giữ checksum:
`85A9B7D01A9D5F480C73B5D78349E5E1AF941DAB1886D569F6C42048FDC3F05C`.

Đã kiểm tra public trống và backup bằng pg_dump trước apply; backup DPAPI CurrentUser
ở `.tools/neon-integration/development-before-bootstrap.dump.dpapi`. Không reset/drop/
truncate/import dữ liệu. EF Up dùng frozen SQL trong transaction cùng history INSERT;
baseline Down từ chối phá dữ liệu. Xem [quy trình](DATABASE_MIGRATION_WORKFLOW.md).

## Build và automated tests

| Lệnh đã thực thi                                                                                                                                                                                                                                                                                                                                                 | Kết quả                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `dotnet build src/backend/BHome.sln -c Release --no-restore --nologo -v quiet`                                                                                                                                                                                                                                                                                   | PASS, 0 warning / 0 error                                                    |
| `dotnet test tests/backend/BHome.IntegrationTests/BHome.IntegrationTests.csproj -c Release --no-build --filter 'FullyQualifiedName~SharedDevelopmentSetupTests\|FullyQualifiedName~Compact24MigrationBaselineTests\|FullyQualifiedName~DatabaseProbeTests' --logger 'trx;LogFileName=shared-setup.trx' --results-directory .tools/neon-integration/test-results` | 25 passed / 0 failed / 0 skipped                                             |
| `dotnet test src/backend/BHome.sln -c Release --no-build --logger 'trx;LogFilePrefix=neon-complete' --results-directory .tools/neon-integration/test-results`                                                                                                                                                                                                    | Domain 106; Application 353; Integration 561 passed / 217 skipped / 0 failed |

Tổng 1.020 tests đã thực thi thành công. 217 skipped là điều kiện fixture/OCR sẵn có,
không tính là kiểm thử đã chạy. TRX cuối: `.tools/neon-integration/test-results/neon-complete_*.trx`.

Tests mới dùng PostgreSQL 16 disposable, không Neon: snapshot/model consistency,
baseline tạo đúng schema/tracking, replay giữ dữ liệu, từ chối schema có sẵn thiếu
history, factory từ chối production/pooled/TLS yếu, shared seed không nới guard local,
năm role chỉ DML và từ chối CREATE TABLE/ROLE/history writes/SET ROLE admin (42501).
Các regression API/domain hiện có cũng đã được chạy trong suite trên.

Đã xử lý trước apply: EF 8 scaffold ToTable(null, check constraints) không round-trip
được; bỏ metadata chỉ dành cho table trên SQL projections, giữ constraints thật trong
DDL. Scaffolder Up chỉ hai Identity tables được thay bằng frozen reviewed SQL.
psql thiếu CA bundle ban đầu được sửa bằng public roots từ Windows trust store,
không tắt TLS verification. Các lỗi compile/fixture ban đầu đã sửa và chạy lại đạt.

## Lệnh quản trị và kiểm tra thực thi

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Update-NeonDatabase.ps1 -Apply
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Initialize-NeonRoles.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Seed-NeonDevelopmentData.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Test-Database.ps1 -EnvironmentFile .env.neon -Direct
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Test-Database.ps1 -EnvironmentFile .env.neon.dev01
```

Apply và replay exit 0. Role provisioning replay giữ password/file cũ. Seed lần đầu
`SAMPLE_CREATED`; lần hai `SAMPLE_ALREADY_PRESENT`, không reset password/nhân dữ liệu.
Connection lấy từ secure local profile, không command-line URL/password. Admin secret
chỉ ở operator Direct; runtime profile chính đã chuyển sang `bhome_dev01`.

## API / hai process / file workflow

Đã chạy hai process BHome.Api Release độc lập, dùng `bhome_dev01` và `bhome_dev02`,
HTTP loopback 5381/5382 (HTTPS endpoint riêng). Kestrel MobileHttp/MobileHttps được
override riêng mỗi process; không dựa vào --urls khi User Secrets có endpoint binding.
Startup provisioning/jobs/notification automation đều tắt.

Script evidence thực thi:
`.tools/yolo-python/python.exe .tools/neon-integration/verify_shared_api.py`.
Lượt cuối **27 assertions đạt**, report không chứa token/password:
`.tools/neon-integration/shared-api-report.json`.

| Workflow thực thi                            | Kết quả                                 |
| -------------------------------------------- | --------------------------------------- |
| live/ready cả hai process                    | 200 / 200                               |
| Public Locations cả hai                      | 200, không còn lỗi thiếu bảng           |
| Owner/Staff/Tenant login                     | 200, Identity/session thật trên Neon    |
| Token/session từ A dùng tại B                | 200                                     |
| Owner A tạo Location tổng hợp                | 201 ở lượt đầu                          |
| B đọc cùng ID/name                           | 200; lặp lại/restart A vẫn thấy bản ghi |
| Anonymous protected route / invalid login    | 401 / 401                               |
| Staff tạo Location                           | 403                                     |
| Staff Location được gán / ngoài scope        | 200 / 404                               |
| Tenant truy cập Location management          | 403                                     |
| Publish thiếu contact                        | 409 đúng validation hiện có             |
| Thêm email tổng hợp `.invalid`, publish      | 200                                     |
| A upload PNG tổng hợp qua API                | 200                                     |
| B tải ảnh theo reference Neon qua public API | 200, SHA-256 bytes khớp                 |

Đây là **single-machine / two-process**, không phải multi-machine. Dataset và object
tổng hợp được giữ cho integration. Không tạo hợp đồng/invoice/payment thành công giả.
Không nhập CCCD hoặc dữ liệu Tenant thật. Instance A đã được restart để xác minh
persistence trong khi B vẫn chạy; không có migrations tự động khi API khởi động.

## Team access, secret và worker

Đã tạo `bhome_dev01` … `bhome_dev05`, group NOLOGIN `bhome_development_runtime`.
Cả năm đã kết nối thực tế qua pooled và cùng thấy 3 Locations tổng hợp. Kiểm metadata
trên Neon: CREATE public=false, TEMPORARY=false, history write=false, owner membership=false,
elevated attributes=false. Negative DDL thực thi trên isolated PostgreSQL tests, không
thử phá schema shared để kiểm quyền. Operator có direct; member profiles không có admin.

Năm `.env.neon.devNN` và credential files được tạo riêng ở máy setup, Git ignored;
chưa gửi cho người khác. Đã loại local Compose/root password khỏi shared profiles.
JWT và encryption/HMAC keys riêng development (`neon-dev-v1`) được chuẩn bị khi
identity protected rows còn 0; không thay key local/user-secrets hoặc đưa key vào docs.
Không tự rotate key ring khi đã có dữ liệu mã hóa.

Laptop giữ `Jobs__Enabled=false`, `NotificationChannels__AutomationEnabled=false`,
`DevelopmentDatabase__InitializeOnStartup=false`; actual SYSTEM_JOB rows=0 sau hai
process. Source có durable lease/idempotency/transaction locks; chưa bật/simulate
mọi financial job trên Neon. Chỉ một worker deployment được chỉ định bật sau duyệt
lịch/policy, không để năm laptop cùng tự lên lịch.

## MinIO và việc còn lại

File workflow **đã đạt** qua MinIO local `localhost:9000`, bucket private hiện có,
hai process cùng truy cập. Chưa có host/tunnel/app credential scoped cho MinIO liên
máy. Người dùng đã chọn giữ cấu hình local hiện tại. Khi mở lại phạm vi storage liên
máy, operator cần host chung với private network/TLS hoặc tunnel, bucket private,
app-scoped keys và backup rồi kiểm thử hai máy thật. Không coi năm MinIO local là
storage shared; bản ghi ảnh do máy khác tạo có thể chưa đọc được từ MinIO local.

Team Leader cần gán role/profile cho thành viên, chuyển secret qua kênh được duyệt,
và bảo vệ/backup shared key ring. Admin credential đã xuất hiện trong chat nên cần
rotate lại ở Neon và cập nhật local Direct secret; không ảnh hưởng năm role riêng.
Không có mật khẩu thật trong file commit candidate hoặc terminal output của công cụ.

Chưa nghiệm thu PITR/restore, RPO/RTO, performance/coverage/concurrent-session targets,
toàn bộ workflows OCR/signing/payment hoặc truy cập từ năm máy. Không suy các kết quả
này từ build và API smoke đạt. Không push/merge/commit trong task.

## File thay đổi và kiểm tra cuối

31 file source/documentation được thêm hoặc sửa trong toàn bộ hai lượt tích hợp:

- `.gitignore`, `.env.neon.example`, `README.md`, solution và Infrastructure/test csproj.
- `Compact24DbContext`, `Compact24DomainModel`, design-time factory và 5 baseline assets
  (migration, designer, snapshot, helper, frozen SQL).
- `BHome.DatabaseCheck` (project/entry point/probe); seed/CLI hiện có và `SharedDevelopmentRoles`.
- `Test-Database.ps1`, `Update-NeonDatabase.ps1`, `Initialize-NeonRoles.ps1`, `Seed-NeonDevelopmentData.ps1`.
- `DatabaseProbeTests`, `Compact24MigrationBaselineTests`, `SharedDevelopmentSetupTests`.
- Bốn tài liệu database của lần tích hợp này. Không sửa frontend, legacy migrations,
  OCR hoặc các DTO/business policies không liên quan.

`dotnet format src/backend/BHome.sln --verify-no-changes --no-restore`: PASS sau sửa
whitespace/EOL. Prettier check/format trên README và bốn tài liệu: PASS.
`git diff --check`: PASS. PowerShell parser cho bốn script: 0 syntax errors.
Scan 31 commit candidates không tìm thấy admin/developer password, JWT hoặc shared
encryption/HMAC key thật. `git check-ignore` xác nhận sáu Neon profiles và credential
files đều ignored. Mẫu env chỉ chứa placeholders. Hai process API test đã dừng sau
nghiệm thu, không để lại worker/laptop daemon của task.
