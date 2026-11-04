# BHOME – Báo cáo chuyển backend sang Compact24

Cập nhật 04/11/2026, nhánh `member/QHuy`, baseline `3b5dd018f87ce6dcc8396cb779609733fffd42bb`. Báo cáo này thay trạng thái triển khai bốn slice ban đầu.

## Kết quả và phạm vi nghiệm thu

**Backend đã đăng ký Compact24 làm persistence mặc định.** API, repository, Identity stores, worker và readiness chạy trên PostgreSQL mới chỉ có **24 bảng vật lý, 386 cột, 83 FK**. Không có runtime fallback về `BHomeDbContext`, không cần bảng legacy, không thêm view hoặc bảng nghiệp vụ/kỹ thuật phụ. Legacy Independence kiểm cả composition và SQL thực tế.

Việc hoàn tất ở đây áp dụng cho **chuyển persistence của chức năng đã tồn tại và kiểm chứng trong môi trường tổng hợp**. Không đồng nghĩa đã triển khai production, hoàn thành mọi UC trong SRS hoặc gọi thành công provider thật. Các giới hạn hiện có của Holding/provider/financial policy được giữ nguyên và ghi ở cuối báo cáo.

Ở mốc kiểm thử migration ban đầu, `bhome` được giữ nguyên. Theo yêu cầu tiếp theo tạo lại database phát triển trên PostgreSQL local, đã dựng `bhome` Compact24 mới và giữ toàn bộ database cũ dưới tên archive ở mục dưới. `.env`, connection string, source migrations/snapshot không bị ghi đè; không import dữ liệu thật, không commit/push/merge và không triển khai production.

## Nguồn, truy vết và quyết định thiết kế

Nguồn sử dụng: yêu cầu người dùng giữ 24 bảng và cơ chế bảo vệ hiện có; yêu cầu tiếp tục hoàn tất migration 70→24; AGENTS.md; SQL/JSON/DBML và DESIGN_24_TABLES; SRS `(2)`, SDS `(5)` trong `docs/reports`; source, migrations và tests thực tế. Không có Report 5–7 để xác nhận kết quả ST/AT. Tên client thực tế là `src/owner-web` và `src/mobile`.

| Yêu cầu/nguồn                          | Dữ liệu và thành phần ảnh hưởng                                               | Acceptance đã đưa vào kiểm thử                                                                                                       |
| -------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| UC-01..03, GBR-01/02/13                | users, refresh_tokens, AUDIT; Identity security/session/password stores       | Hash/stamp/lockout, role revoke, parallel refresh/reuse, reset một lần, scope tài khoản                                              |
| BF-01/02, UC-04..12, DBR-01, GBR-08    | Location/Room/Asset/catalog/policy/assignment; Property và Staff repositories | Cross-Location, normalized unique, version race, effective policy, task progress/evidence/Owner verify                               |
| BF-03/04, UC-13..19, GBR-04/06         | Contract/signings/occupants và JSON documents/handover/move-out/settlement    | Draft từ onboarding mã hóa, hai bên ký, activation thiếu tiền/ký bị chặn, renewal, baseline/inspection và pending settlement         |
| BF-05, UC-20/21, DBR-05..07, JOB-09/10 | Meter/capture/reading/invoice/items/recipient snapshots và automation         | OCR cần xác nhận, dedupe Room/utility/kỳ, thiếu dữ liệu giữ Draft, Final bất biến, correction có quyết định                          |
| BF-06, UC-22..25, GBR-10/18            | payments/allocations/claims/commands/history                                  | Replay/race, exact/manual review, under/over không tự nới policy, một bank reference không dùng hai lần, số thứ tự lịch sử đồng thời |
| JOB-01..07/09/10, DBR-13, GBR-18       | Queue/lease/command, OUTBOX/INBOX/AUDIT, file staging/cleanup                 | Durable retry, lease/recovery, inbox recipient scope và mất assignment, worker thực chạy độc lập                                     |

Quyết định kỹ thuật theo yêu cầu đã duyệt: giữ service/controller/DTO và domain model, thay persistence phía Infrastructure. Cột chuẩn hóa native dùng để lọc/khóa/index; dữ liệu nguồn cần giữ nhưng không có cột riêng nằm trong các JSON container đã được thiết kế. Mỗi loại record có mapping typed, discriminator và version snapshot, không dùng một JSON tùy ý cho toàn hệ thống.

Trade-off: JSON catalog/child cần khóa parent và guard reference thay FK riêng; query projection phức tạp hơn, history tăng kích thước theo thời gian. Import hiện đọc dữ liệu vào bộ nhớ có giới hạn preflight rõ ràng; chưa benchmark quy mô lớn. Không thay framework, PostgreSQL provider, MinIO hoặc electronic-signing provider.

DDL có phiên bản `compact24-2026-11-04`; production/import dùng khởi tạo offline explicit. Theo yêu cầu setup mới, Development tự tạo database thiếu/trống từ cùng DDL, có guard loopback/tên database và session lock. Runtime không gọi `EnsureCreated/Migrate`, không auto-detect schema để chọn legacy; archive legacy chỉ qua CLI explicit. Không tạo `__EFMigrationsHistory` hoặc chèn lịch sử 70 bảng giả. Readiness đối chiếu 24/386/83, các hàm guard, trigger đang bật và index bắt buộc. SQL artifact có SHA-256 trong báo cáo đối soát; thay đổi DDL về sau phải có version/review/kiểm chứng tương ứng.

Các guard nguồn được khôi phục trên schema gọn gồm normalized Room/Asset unique, room-type catalog/scope, policy effective-date/first-used immutability, account revoke, handover same-version confirmation/confirmed baseline và reading references. Chỉ bổ sung constraint/index/function/trigger, không thêm bảng/cột/FK. `btree_gist` phục vụ exclusion khoảng ngày. Không áp dụng policy tài chính hoặc thẩm quyền mới.

## Trạng thái theo module

| Module                  | Persistence Compact24 đã chuyển                                                                                                       | Phạm vi còn giới hạn từ trước                                                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| IdentityAccess          | users/roles, session+token union, reset state, audit; native user/role stores và claims principal                                     | External role/user claims, external logins và Identity tokens ngoài runtime hiện tại chưa được hỗ trợ; importer chặn nếu có dữ liệu                |
| PropertyManagement      | Chain trong Owner business_profile; Location/catalog/assignment/settings; Room/Asset/Policy native, audit                             | Không tạo thêm Chain/RoomType/Assignment tables; bootstrap chỉ explicit, không seed tài khoản thật                                                 |
| StaffOperations         | Task/evidence/history; COMMAND/SYSTEM_JOB/upload intents; current assignment server-side                                              | Recurrence/shift/payroll chưa có nghiệp vụ đầy đủ không được coi đã hoàn thành                                                                     |
| TenantContracts         | Resident envelope, Main Draft, documents/cert directory/signing evidence, occupants, handover/renewal/move-out/settlement             | Holding adapter production vẫn chưa cấu hình như baseline; test boundary được ghi rõ, không giả activation thành công                              |
| MeterReading            | Meter/capture/OCR proposal/confirmation/evidence/cleanup; Room+utility+kỳ dedupe                                                      | Không gọi OCR service ngoài hoặc dùng ảnh CCCD thật trong test                                                                                     |
| Billing                 | Room+kỳ Invoice, items, immutable recipient snapshots, adjustments/evidence/decisions, calendar/plan/execution/attempt/representative | Không tự mở final/ad-hoc billing policy hoặc đổi mô hình sang một Invoice mỗi occupant                                                             |
| PaymentsDebt            | Verified bank receipt, allocations, shared bank claims, reconciliation/history, deposits, command dedupe, debt/settlement reads       | Giữ exact/manual-review hiện tại; không thêm auto partial/excess/refund/deduction policy. Refund request trong schema không tự trở thành API đã có |
| Notifications           | Durable event/outbox/publication, inbox/read mirror, retry/lease/attempt history, AUDIT                                               | Email/push provider thật chưa nghiệm thu; trạng thái Unconfigured/PendingReview được giữ                                                           |
| Jobs/Files/Health       | Native queue/worker/schedulers; independent cleanup contexts, private object metadata; readiness mới                                  | MinIO thật và phục hồi backup/object storage thật chưa chạy                                                                                        |
| Incident/Finance/Public | Không phát triển thêm tính năng ngoài persistence đã tồn tại                                                                          | Entity/schema hoặc giao diện mẫu không được xem là backend UC hoàn chỉnh; không thêm Guest capture, payroll hay What-if engine                     |

## Thành phần và cách lưu dữ liệu

| Nhóm file                                                                                                                | Thay đổi cụ thể                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Persistence/BHomePersistenceContext.cs`                                                                                 | Abstraction chung giữ DbSets/query API mà repository đang sử dụng; native lock, queue và independent-context contract                                |
| `Persistence/Compact24/Compact24DbContext.cs`, `Compact24DomainModel.cs`, `Compact24Records.cs`, `Compact24RecordSql.cs` | EF projections từ bảng native/JSON; không còn table mapping runtime tới tên legacy; reuse cấu hình domain có sẵn                                     |
| `Compact24DomainWriter.cs`, `Compact24WriteOrder.cs`                                                                     | Native parameterized DML, parent-first dependencies, atomic SaveChanges, version CAS, accept/restore EF tracking state, typed JSON history/tombstone |
| `Compact24EventsAndLedger.cs`, `Compact24PropertyGuards.cs`                                                              | Immutable events, claim/allocation/deposit guards, location/ledger/sequence advisory locks và JSON scope validation                                  |
| `CompactUserStore.cs`, `CompactRoleStore.cs`, `CompactIdentityPersistence.cs`                                            | Native Identity state, ba role đã có, refresh rotation/revocation/reset, audit; không sửa password hashing/JWT contract                              |
| `CompactLocationAssignments.cs`, `CompactJobPersistence.cs`, `CompactNotificationRepository.cs`                          | Assignment có ngày hiệu lực, queue durable lease/retry, recipient inbox/target revalidation                                                          |
| `DependencyInjection.cs`, `DatabaseHealthCheck.cs`, repository/worker/file cleanup liên quan                             | Production DI dùng native Compact24; repository giữ logic nghiệp vụ nhưng nhận abstraction; thay raw row-lock/insert và readiness cũ                 |
| `Compact24Schema.cs`                                                                                                     | DDL embedded, version/SHA và readiness; initializer offline chỉ chấp nhận target loopback được đặt tên riêng và trống                                |
| `Compact24DataMigration.cs`, `Compact24FixtureMigration.cs`, `Compact24MigrationMap.cs`                                  | Preflight 70 bảng, source read-only snapshot, full import transaction, read-back từng scalar/PK/JSON và rollback nếu sai                             |
| `tools/BHome.Compact24Migration/`                                                                                        | CLI initialize/inspect/copy-all/report; không sửa runtime connection hoặc tạo/xóa database                                                           |
| `tools/BHome.LocalDevelopment/`                                                                                          | Seed explicit nhận abstraction, chuẩn bị role trước Create; schema mismatch báo lỗi, không auto Migrate legacy                                       |
| `tests/.../Fixtures/LegacyPersistenceRegistration.cs`                                                                    | Composition legacy chỉ để regression/source fixture offline; không phải production selector                                                          |
| `tests/.../Compact24/` và các fixture/test liên quan                                                                     | Reuse API scenarios cũ trên native schema; thêm migration, concurrency, composition và independence coverage                                         |

JSON lưu `schemaVersion: 1`, `recordType`, `recordKey`, `state` và tombstone cho intent kỹ thuật khi cần. Native scalar là nguồn chính cho cột đã chuẩn hóa; snapshot giữ scalar thiếu, UUID nguồn và lịch sử. DateOnly/UTC timestamp/decimal/encryption envelopes không được chuyển thành text tùy tiện hoặc mã hóa lại khi import.

Catalog: `locations.room_types/staff_assignments/operating_settings`; Chain/role catalog/cert metadata: `users.business_profile/signing_credentials`. Contract children: `contracts.documents/handover/move_out/settlement/history`. Invoice recipients: native UUID array bất biến sau Final. Source per-task notification giữ OUTBOX/read state; INBOX theo recipient vẫn là UserNotification riêng có discriminator. Upload chưa gắn business record vẫn có durable SYSTEM_JOB state để cleanup, không bị mất do thiếu parent JSON.

## Chuyển dữ liệu và đối soát 70→24

Mapping đủ 70 bảng nằm ở DESIGN mục 10 và `Compact24MigrationMap`. Mười ba cặp source/target độc lập đã đối soát cả 70 bảng mỗi lần; 66 bảng có dữ liệu ít nhất một fixture, bốn bảng external Identity extension có 0 dòng ở các lượt copy thành công và có test riêng kiểm tra từ chối khi có dữ liệu. [MIGRATION_RECONCILIATION.json](MIGRATION_RECONCILIATION.json) chứa kết quả thực chạy, schema hash, count và match theo từng bảng/từng fixture. Đây là **dữ liệu tổng hợp**, không phải số liệu của `bhome` hoặc một lần import production. Các fixture độc lập không được cộng thành doanh thu/số dư thật.

Quy trình công cụ:

1. Chỉ nhận loopback source `bhome_compact24_source_<guidN>` và target `bhome_compact24_<guidN>`; không mặc định lấy connection API. Từ chối `bhome` trước khi kết nối. Operator tự tạo database/bản sao nguồn được phép.
2. `--initialize-target` chỉ dựng DDL lên target trống, không seed account/business data. `--inspect` đọc đủ 70 bảng và kiểm migration/giới hạn; không ghi target.
3. `--copy-all` giữ source transaction `REPEATABLE READ, READ ONLY`; tất cả auth và business target cùng một transaction. Target phải đúng schema và trống; không hỗ trợ import chồng/replay trên target đã có dữ liệu.
4. Giữ UUID, password/stamps, envelope/HMAC/key version, document hashes/object keys/provider evidence, invoices/items/recipient snapshots, bank receipts/claims/allocations, audit và timestamp gốc. Source Final invoice được dựng Draft + original items/recipients rồi Final trong cùng transaction để không tắt trigger bất biến.
5. Đọc ngược record qua native projections, so mọi mapped scalar/key; canonicalize thứ tự key của JSON object, giữ array order. Identity copier đối chiếu riêng mọi field/grant/session/token/reset/audit. Sai một record: rollback toàn target, giữ source nguyên trạng.
6. Report chỉ xuất aggregate/mã lỗi an toàn. Không xuất UUID người dùng, token/hash/password/envelope/nội dung hợp đồng. SHA trong report là hash công khai của DDL, không phải hash dữ liệu cá nhân. Nếu commit xong nhưng ghi report lỗi, CLI báo `COMMITTED_REPORT_WRITE_FAILED`, không giả đã rollback.

Mặc định chặn >10.000 dòng/bảng, có override số nguyên dương bằng `BHOME_COMPACT24_MAX_ROWS_PER_TABLE`; không âm thầm `Take` hay truncate dữ liệu. Source multi-Owner/multi-Chain, email mơ hồ, role/hash/stamp thiếu, unsupported Identity extensions có dữ liệu, legacy owner reference, migration lạ/pending, FK/guard/đối soát sai đều bị chặn. Chứng thư lịch sử thiếu directory vẫn giữ provider evidence với cờ `unresolvedDirectoryReference`, không tạo chứng thư hợp lệ giả.

Công cụ giữ object keys/metadata, **không sao chép bytes MinIO**. Operator phải chuẩn bị object storage/key configuration phù hợp bản sao. Không thể kết luận file tải được ở môi trường triển khai chỉ từ row count khớp.

Hướng dẫn CLI/env và chạy lại tests ở [README](../README.md). Không ghi credential vào tài liệu hoặc command-line arguments.

## Legacy Independence Test

`Compact24IndependenceTests` dựng database mới chỉ từ Compact24 DDL và khởi động API với **production DI**. Không cấp legacy connection, không đăng ký `BHomeDbContext/DbContextOptions<BHomeDbContext>`. Kiểm native user/role store, context abstraction, repository/worker/cleanup registrations; giữ hosted services và bật polling jobs.

Test chạy health/readiness, API payment/invoice workflow có kiểm quyền, scheduling/notification và xác nhận ít nhất một job hoàn tất. DbCommand interceptor từ chối query legacy; PostgreSQL statement log của cluster thử kiểm cả direct Npgsql và context mở độc lập, theo đúng tên target database. Query bảng đã bỏ làm test FAIL. Target vẫn đúng 24 bảng sau workflow. Memory private storage và synthetic provider boundary chỉ được dùng trong fixture, không thêm production fake hoặc bypass quyền.

## Kết quả đã thực thi

**PASS 555 backend tests: Application 177, Domain 83, Integration 295; 0 FAIL, 0 SKIP.** Trong Integration có 113 ca Compact24 và 1 Legacy Independence trên PostgreSQL 16.15 cô lập. Log: `.tools/compact24-refactor/full-backend-complete.log`; inventory 113 ca xác nhận bằng `--list-tests --filter Category=CompactPostgres`.

Lệnh đã thực thi: `dotnet test src/backend/BHome.sln --filter "Category!=Docker" -m:1 -v minimal`, với đủ biến admin/query-log/evidence cho fixture. Build các project trong lượt này không có compiler warning/error. Sau lượt đầy đủ, chạy lại hai ca import job lease/pending upload và CLI với fixture cuối: PASS 2 (`import-lease-cli-final.log`). Whitespace của các file mới đã kiểm bằng `dotnet format whitespace`; `git diff --check` đạt.

| Kiểm tra                                                                                 | Kết quả thực tế                                                                                                                      | Bằng chứng local                                                                                                                      |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Legacy PostgreSQL regression sáu nhóm Auth/security/assignment/permission/property/Chain | PASS 108 trên PostgreSQL 16.15                                                                                                       | `.tools/compact24-refactor/legacy-final-pg16.log`                                                                                     |
| Digital-signing solution                                                                 | PASS 41                                                                                                                              | `.tools/compact24-refactor/signing-final.log`                                                                                         |
| Mobile                                                                                   | PASS 310, Node 22                                                                                                                    | `.tools/compact24-refactor/mobile-final.log`                                                                                          |
| Owner Web                                                                                | PASS 104 khi chạy một worker; lượt hai workers trước đó 103 PASS/1 timeout lazy `/schedules`, không sửa frontend/không nới assertion | `.tools/compact24-refactor/owner-serial-final.log`, `owner-final-pass.log`                                                            |
| PostgreSQL schema/diagram/assertions                                                     | PASS 24/386/83 và 28 assertions; DDL từ chối target có bảng                                                                          | `.tools/compact24-refactor/schema-pg16.log`                                                                                           |
| CLI initialize                                                                           | PASS, tạo 24 bảng trong target trống riêng, đọc count thực rồi dọn target                                                            | `.tools/compact24-refactor/cli-initialize.json`                                                                                       |
| CLI inspect/copy-all/reject bhome                                                        | PASS integration subprocess, đối soát report 70 bảng                                                                                 | Test `OfflineCliInspectsAndCopiesAndRejectsLiveDatabaseNameBeforeConnecting`                                                          |
| Concurrent history sequence                                                              | Tái hiện FAIL với số trùng; sau khóa theo loại record PASS 16 writes song song, không thêm bảng                                      | `sequence-concurrency-before.log`, `sequence-concurrency-after.log` trong cùng thư mục log                                            |
| PostgreSQL 18.6                                                                          | PASS schema 28 assertions và bộ Compact24 92 test ở mốc trước lần mở rộng cuối                                                       | `domain-tests.log` (mốc native PG18); `compact-pg16-tests.log` là lượt kiểm PG16 riêng; không gọi đây là toàn bộ suite cuối trên PG18 |

Lượt baseline trước sửa: 441 backend tests. Các số legacy/Compact reuse có ca trùng logic; không cộng các lượt chạy thành tổng coverage hoặc pass-rate ST/AT. Không có coverage/performance/100 concurrent sessions/production SLA được đo.

## Giới hạn, vận hành và rollback

- **BLOCKED nếu nguồn có dữ liệu chưa biểu diễn được:** các trường hợp preflight/import nêu trên cần quyết định mapping/cleanup nguồn trên bản sao, không tự bỏ dữ liệu. Đây là chặn có chủ đích của công cụ, không phải fallback runtime.
- **Giữ pending như baseline:** Holding integration, real signing/provider trust/template config và các policy partial/excess/refund/shared liability chưa được chốt. Test synthetic CA có chạy actual PDF signer/adapter nhưng không chứng minh Viettel/bank production đã tích hợp thành công.
- **NOT RUN:** Docker/MinIO thật (daemon không sẵn), provider ngân hàng/MySign/email/push thật, cutover/backup restore dữ liệu thật, browser/device E2E/ST/AT, benchmark/coverage và dữ liệu lớn. Không có real CCCD/tenant data trong fixtures.
- PostgreSQL 16.15 được chạy bằng binaries EDB chính thức trong `.tools` với cluster loopback riêng và dữ liệu tổng hợp; không cài lại hoặc thay đổi PostgreSQL live. Statement parameter logging đã tắt trong cluster thử. Cluster được dừng sau verification; logs/artifact giữ cục bộ, không thêm vào Git.
- Import lỗi trước commit: transaction target rollback; source read-only. Sau commit không xóa/sửa ledger để “undo”; giữ nguyên source copy và loại bỏ target thử theo quy trình operator được phép rồi import vào target trống khác.
- Cutover thật chưa thực hiện. Kế hoạch phục hồi cần backup schema/data 70 bảng, object manifests và key/provider configuration; dừng ghi và triển khai app+DB tương ứng. Nếu đã có ghi mới trên Compact24, không đổi connection về source cũ mà bỏ mất các giao dịch mới; cần kế hoạch reconcile/restore riêng.

## Cập nhật môi trường phát triển theo yêu cầu 04/11/2026

- Đã tạo `bhome` mới trên PostgreSQL native 18.6 của máy: **24 bảng/386 cột/83 FK**, không EF history, chưa seed users/business data. Connection vẫn là database `bhome` hiện có trong `.env`.
- Toàn bộ database nguồn 71 bảng (70 nghiệp vụ + lịch sử EF) nằm tại **`bhome_legacy_20261104_030657Z_4ab39fb3`**. Đã đối chiếu OID gốc trước/sau để xác nhận đây chính là database cũ, không phải chỉ backup schema. Không DROP bảng/database. Bằng chứng aggregate local: `.tools/compact24-dev-setup/local-database.json`.
- `Compact24DevelopmentDatabase` tạo khi thiếu/trống, kiểm và reuse khi READY, từ chối schema lạ. Session advisory lock serialize các startup đồng thời. Không tự seed account, tạo phí/chính sách hoặc bật provider.
- `Program.cs` chuẩn bị schema trước host/worker khi Development và `DevelopmentDatabase:InitializeOnStartup=true`. Production/Testing không bootstrap. `.env` fallback chỉ đọc trong Development, dưới user-secrets/env/CLI; test factories tắt fallback/bootstrap mặc định để các ca HTTP Development không chạm cấu hình local. Ca kiểm startup explicit bật bootstrap trên database tổng hợp riêng.
- `Update-LocalDatabase.ps1 -RecreateDatabase` / CLI `--archive-legacy` chuẩn bị và verify candidate mới trước, đóng đúng các kết nối target local rồi đổi tên. Có recovery tên/access nếu swap chưa hoàn tất. Không dùng để reset một Compact24 đã READY. `-Check` không ghi schema/data; lệnh không switch chỉ khởi tạo/kiểm.
- `Start-Api.ps1` và chạy trực tiếp `dotnet run --no-build --no-launch-profile` trong Development đều đã smoke HTTPS `/health/ready=200` trên `bhome` mới. Lượt direct đã bỏ process connection/JWT variables để kiểm fallback local. Hosts kiểm tra đã dừng; PostgreSQL native vẫn chạy. TLS verification chỉ bỏ qua trong curl loopback dùng kiểm tra, không đổi trust máy.
- Traceability: yêu cầu môi trường dev của người dùng → AGENTS §6/9 về initialization, không seed secrets/chính sách → API startup/config, schema helper, CLI/scripts/docs → create/concurrent/restart/archive/refusal/readiness tests. Không sửa business service/controller/DTO.

**Kiểm chứng lượt cập nhật setup: PASS 565 backend tests (Application 177, Domain 83, Integration 305; 0 FAIL/0 SKIP)** trên PostgreSQL 16.15 cô lập, gồm Legacy Independence và 10 ca mới về bootstrap/config/safety. Ca concurrent startup, archive dữ liệu thật trong fixture có session đang mở, không overwrite schema lạ, Production/remote refusal và API startup đều đạt. Lượt kiểm tập trung OCR + startup đạt 38/38; script tests đạt 80 assertions. `Update-LocalDatabase.ps1 -Check` trên native bhome báo READY. Logs: `.tools/compact24-dev-setup/backend-tests.log`, `startup-regression.log`, `script-tests.log`, `local-check.log`, `api-smoke.json`, `direct-api-smoke.json`. Build CLI đạt 0 warning/error.

Lượt regression đầu phát hiện 17 HTTP tests dùng Development giả chưa tắt bootstrap; đã cấu hình fixture opt-out rõ ràng và giữ nguyên guard/initializer ở runtime. Không nới assertion nghiệp vụ để làm test đạt. Kiểm thử trên Docker, provider/MinIO thật và browser/device E2E không được bổ sung trong lượt setup này.

Team sau khi pull: chuẩn bị `.env` riêng và PostgreSQL một lần; máy có schema legacy chạy `scripts/Update-LocalDatabase.ps1 -RecreateDatabase` một lần, rồi `scripts/Start-Api.ps1` hằng ngày. Tạo tài khoản tổng hợp bằng `scripts/New-LocalTestUsers.ps1` với mật khẩu tự nhập; MinIO/bucket/provider cấu hình riêng. Hướng dẫn đầy đủ ở README gốc và [database guide](../README.md).

## Danh sách file thay đổi

Danh sách working tree trong phạm vi tác vụ và các phiên tiếp tục (131 file; gồm artifact thiết kế untracked từ trước được giữ/cập nhật). Không gồm credential, database backup hay build/logs trong `.tools`:

```text
.env.example
README.md
docs/database/2026-11-03/README.md
docs/database/2026-11-03/compact-24/BHOME_24_TABLES.dbml
docs/database/2026-11-03/compact-24/BHOME_24_TABLES.sql
docs/database/2026-11-03/compact-24/BHOME_Database_Design.json
docs/database/2026-11-03/compact-24/DESIGN_24_TABLES.md
docs/database/2026-11-03/compact-24/IMPLEMENTATION_REPORT.md
docs/database/2026-11-03/compact-24/MIGRATION_RECONCILIATION.json
docs/database/2026-11-03/compact-24/SCHEMA_CHECKS.sql
docs/database/2026-11-03/compact-24/Verify-Compact24.ps1
docs/development/LOCAL_DEVELOPMENT.md
scripts/Start-Api.ps1
scripts/Update-LocalDatabase.ps1
src/backend/BHome.Api/Configuration/DatabaseHealthCheck.cs
src/backend/BHome.Api/Configuration/DevelopmentEnvironmentFile.cs
src/backend/BHome.Api/Program.cs
src/backend/BHome.Api/appsettings.Development.json
src/backend/BHome.Infrastructure/BHome.Infrastructure.csproj
src/backend/BHome.Infrastructure/Billing/AdjustmentEvidenceFiles.cs
src/backend/BHome.Infrastructure/Billing/AdjustmentRepository.cs
src/backend/BHome.Infrastructure/Billing/InvoiceFinancialQueries.cs
src/backend/BHome.Infrastructure/Billing/InvoiceRepository.cs
src/backend/BHome.Infrastructure/Contracts/ContractExpiryProcessor.cs
src/backend/BHome.Infrastructure/Contracts/ContractFiles.cs
src/backend/BHome.Infrastructure/Contracts/ContractHandoverRepository.cs
src/backend/BHome.Infrastructure/Contracts/ContractRepository.cs
src/backend/BHome.Infrastructure/Contracts/ContractSettlementLedger.cs
src/backend/BHome.Infrastructure/Contracts/ContractSigningCertificateStore.cs
src/backend/BHome.Infrastructure/Contracts/ContractWorkflowRepository.cs
src/backend/BHome.Infrastructure/Contracts/MainDraftData.cs
src/backend/BHome.Infrastructure/Contracts/ViettelMySignContractAdapter.cs
src/backend/BHome.Infrastructure/DependencyInjection.cs
src/backend/BHome.Infrastructure/IdentityAccess/IIdentityPersistence.cs
src/backend/BHome.Infrastructure/IdentityAccess/IdentityPasswordService.cs
src/backend/BHome.Infrastructure/IdentityAccess/IdentitySecurityAudit.cs
src/backend/BHome.Infrastructure/IdentityAccess/IdentitySecurityStore.cs
src/backend/BHome.Infrastructure/IdentityAccess/IdentitySessionService.cs
src/backend/BHome.Infrastructure/IdentityAccess/LegacyIdentityPersistence.cs
src/backend/BHome.Infrastructure/Jobs/IJobPersistence.cs
src/backend/BHome.Infrastructure/Jobs/LegacyJobPersistence.cs
src/backend/BHome.Infrastructure/Jobs/PostgresJobWorker.cs
src/backend/BHome.Infrastructure/Modules/Billing/BillingAutomationEngine.cs
src/backend/BHome.Infrastructure/Modules/Billing/BillingAutomationScheduling.cs
src/backend/BHome.Infrastructure/Modules/Billing/Persistence/BillingAutomationSchedules.cs
src/backend/BHome.Infrastructure/Modules/Notifications/NotificationDeliveryStore.cs
src/backend/BHome.Infrastructure/Modules/Notifications/NotificationEventPublisher.cs
src/backend/BHome.Infrastructure/Modules/Notifications/NotificationRepository.cs
src/backend/BHome.Infrastructure/Modules/PropertyManagement/Persistence/PostgresPropertyRepository.cs
src/backend/BHome.Infrastructure/Modules/StaffOperations/Persistence/PostgresOperationalTaskRepository.cs
src/backend/BHome.Infrastructure/Modules/StaffOperations/TaskEvidenceFiles.cs
src/backend/BHome.Infrastructure/Ocr/CaptureRepository.cs
src/backend/BHome.Infrastructure/Ocr/CaptureScope.cs
src/backend/BHome.Infrastructure/Ocr/CaptureWorkflowResources.cs
src/backend/BHome.Infrastructure/Ocr/MeterEvidenceCleanup.cs
src/backend/BHome.Infrastructure/PaymentsDebt/PaymentRepository.cs
src/backend/BHome.Infrastructure/Persistence/BHomeDbContext.cs
src/backend/BHome.Infrastructure/Persistence/BHomeDbContextFactory.cs
src/backend/BHome.Infrastructure/Persistence/BHomePersistenceContext.cs
src/backend/BHome.Infrastructure/Persistence/Compact24/Compact24DataMigration.cs
src/backend/BHome.Infrastructure/Persistence/Compact24/Compact24DbContext.cs
src/backend/BHome.Infrastructure/Persistence/Compact24/Compact24DevelopmentDatabase.cs
src/backend/BHome.Infrastructure/Persistence/Compact24/Compact24DomainModel.cs
src/backend/BHome.Infrastructure/Persistence/Compact24/Compact24DomainWriter.cs
src/backend/BHome.Infrastructure/Persistence/Compact24/Compact24EventsAndLedger.cs
src/backend/BHome.Infrastructure/Persistence/Compact24/Compact24FixtureMigration.cs
src/backend/BHome.Infrastructure/Persistence/Compact24/Compact24MigrationMap.cs
src/backend/BHome.Infrastructure/Persistence/Compact24/Compact24PropertyGuards.cs
src/backend/BHome.Infrastructure/Persistence/Compact24/Compact24RecordSql.cs
src/backend/BHome.Infrastructure/Persistence/Compact24/Compact24Records.cs
src/backend/BHome.Infrastructure/Persistence/Compact24/Compact24Schema.cs
src/backend/BHome.Infrastructure/Persistence/Compact24/Compact24SliceRegistration.cs
src/backend/BHome.Infrastructure/Persistence/Compact24/Compact24WriteOrder.cs
src/backend/BHome.Infrastructure/Persistence/Compact24/CompactIdentityPersistence.cs
src/backend/BHome.Infrastructure/Persistence/Compact24/CompactJobPersistence.cs
src/backend/BHome.Infrastructure/Persistence/Compact24/CompactLocationAssignments.cs
src/backend/BHome.Infrastructure/Persistence/Compact24/CompactNotificationRepository.cs
src/backend/BHome.Infrastructure/Persistence/Compact24/CompactRoleStore.cs
src/backend/BHome.Infrastructure/Persistence/Compact24/CompactUserStore.cs
tests/backend/BHome.IntegrationTests/ApiFactory.cs
tests/backend/BHome.IntegrationTests/BHome.IntegrationTests.csproj
tests/backend/BHome.IntegrationTests/Billing/AdjustmentDraftTests.cs
tests/backend/BHome.IntegrationTests/Billing/InvoiceApiTests.cs
tests/backend/BHome.IntegrationTests/Compact24/Compact24AssignmentTests.cs
tests/backend/BHome.IntegrationTests/Compact24/Compact24AuthTests.cs
tests/backend/BHome.IntegrationTests/Compact24/Compact24DevelopmentDatabaseTests.cs
tests/backend/BHome.IntegrationTests/Compact24/Compact24Evidence.cs
tests/backend/BHome.IntegrationTests/Compact24/Compact24InboxTests.cs
tests/backend/BHome.IntegrationTests/Compact24/Compact24IndependenceTests.cs
tests/backend/BHome.IntegrationTests/Compact24/Compact24JobTests.cs
tests/backend/BHome.IntegrationTests/Compact24/Compact24MigrationTests.cs
tests/backend/BHome.IntegrationTests/Compact24/Compact24PersistenceTests.cs
tests/backend/BHome.IntegrationTests/Compact24/Compact24WorkflowRegressionTests.cs
tests/backend/BHome.IntegrationTests/Compact24/WorkflowTestUsers.cs
tests/backend/BHome.IntegrationTests/Contracts/ContractLifecycleApiTests.cs
tests/backend/BHome.IntegrationTests/Contracts/MainDraftApiTests.cs
tests/backend/BHome.IntegrationTests/Fixtures/LegacyPersistenceRegistration.cs
tests/backend/BHome.IntegrationTests/LocalTestAccountsTests.cs
tests/backend/BHome.IntegrationTests/Ocr/CaptureWorkflowTests.cs
tests/backend/BHome.IntegrationTests/PaymentsDebt/AdjustmentFinalTests.cs
tests/backend/BHome.IntegrationTests/PaymentsDebt/AdjustmentRequestTests.cs
tests/backend/BHome.IntegrationTests/PaymentsDebt/BillingAutomationConfigurationTests.cs
tests/backend/BHome.IntegrationTests/PaymentsDebt/BillingDraftAutomationTests.cs
tests/backend/BHome.IntegrationTests/PaymentsDebt/BillingFinalAutomationTests.cs
tests/backend/BHome.IntegrationTests/PaymentsDebt/BillingMeterAutomationTests.cs
tests/backend/BHome.IntegrationTests/PaymentsDebt/BillingWorkerRecoveryTests.cs
tests/backend/BHome.IntegrationTests/PaymentsDebt/ContractClosureTests.cs
tests/backend/BHome.IntegrationTests/PaymentsDebt/ContractExpiryTests.cs
tests/backend/BHome.IntegrationTests/PaymentsDebt/ContractSettlementTests.cs
tests/backend/BHome.IntegrationTests/PaymentsDebt/DebtTests.cs
tests/backend/BHome.IntegrationTests/PaymentsDebt/NotificationDeliveryTests.cs
tests/backend/BHome.IntegrationTests/PaymentsDebt/NotificationEventTests.cs
tests/backend/BHome.IntegrationTests/PaymentsDebt/NotificationInboxTests.cs
tests/backend/BHome.IntegrationTests/PaymentsDebt/PaymentApiTests.cs
tests/backend/BHome.IntegrationTests/PaymentsDebt/PaymentLedgerTests.cs
tests/backend/BHome.IntegrationTests/PostgresAuthenticationTests.cs
tests/backend/BHome.IntegrationTests/PropertyManagement/PropertyApiTests.cs
tests/backend/BHome.IntegrationTests/StaffOperations/OperationalTaskApiTests.cs
tests/scripts/MobileDevelopment.Tests.ps1
tools/BHome.Compact24Migration/BHome.Compact24Migration.csproj
tools/BHome.Compact24Migration/Program.cs
tools/BHome.DatabaseUpgrade/Program.cs
tools/BHome.LocalDevelopment/AdjustmentDemoSeed.cs
tools/BHome.LocalDevelopment/BillingAutomationDemoSeed.cs
tools/BHome.LocalDevelopment/ContractDemoSeed.cs
tools/BHome.LocalDevelopment/ContractLifecycleDemoSeed.cs
tools/BHome.LocalDevelopment/InvoiceDemoSeed.cs
tools/BHome.LocalDevelopment/LocalSchemaSeed.cs
tools/BHome.LocalDevelopment/LocalTestAccounts.cs
tools/BHome.LocalDevelopment/MainDraftSettingsSeed.cs
tools/BHome.LocalDevelopment/PaymentDemoSeed.cs
```
