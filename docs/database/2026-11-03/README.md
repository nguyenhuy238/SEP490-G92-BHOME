# Database BHOME Compact24

Backend hiện dùng persistence **Compact24 mặc định**, với đúng **24 bảng vật lý, 386 cột, 83 FK**. Đã chạy API regression và Legacy Independence trên database PostgreSQL 16 mới chỉ có schema này. Không có bảng kỹ thuật `__EFMigrationsHistory` ở target.

Luồng Development đã bổ sung tự khởi tạo Compact24 khi database thiếu/trống. Database có dữ liệu được giữ nguyên; schema 70 bảng cần lệnh chuyển sang database phát triển mới có archive rõ ràng. Connection string/`.env` và EF migrations/snapshot nguồn không bị ghi đè. Không chạy migrations cũ lên Compact24.

Local hiện tại đã dựng mới `bhome` trên PostgreSQL 18.6 và giữ nguyên database cũ tại `bhome_legacy_20261104_030657Z_4ab39fb3`. Trong pgAdmin hãy refresh Databases → bhome → Schemas → public → Tables.

## Sau khi pull code về

Chuẩn bị `.env` riêng bằng `scripts/Initialize-Local.ps1` nếu chưa có; bật PostgreSQL native hoặc Docker theo README gốc. Với native, connection trong `.env` phải khớp tài khoản PostgreSQL trên máy. Từ thư mục gốc:

```powershell
# Chỉ cần một lần nếu bhome trên máy còn schema 70 bảng cũ:
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Update-LocalDatabase.ps1 -RecreateDatabase

# Chạy hằng ngày; database thiếu/trống được tạo trước khi API/worker nhận việc:
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Start-Api.ps1
```

F5 hoặc `dotnet run --project src/backend/BHome.Api` trong Development cũng dùng `.env` làm fallback. User-secrets, process environment và CLI arguments vẫn ưu tiên hơn file. `-EnvironmentFile` của launcher chọn đúng file riêng. Có thể tắt tự khởi tạo bằng `DevelopmentDatabase__InitializeOnStartup=false`; Production/Testing luôn không tự tạo database.

`-RecreateDatabase` chỉ thay schema legacy đã nhận diện đủ 70 bảng và lịch sử EF: tạo/kiểm target Compact24 trước, giữ toàn bộ database cũ dưới tên `bhome_legacy_<UTC timestamp>_<suffix>`, rồi đổi target mới thành `bhome`. Các kết nối cũ tới database local được đóng để đổi tên; refresh Databases trong pgAdmin để thấy cả hai. Không DROP database/bảng, không import lại dữ liệu cũ và không reset một Compact24 đã đúng schema. Source cũ, users và file references vẫn còn trong archive. Công cụ từ chối schema lạ.

`scripts/Update-LocalDatabase.ps1 -Check` chỉ kiểm tra; chạy script không có switch để khởi tạo trước khi mở IDE. Tài khoản PostgreSQL cần quyền tạo database nếu thiếu và quyền tạo `btree_gist` trên database do mình sở hữu. Khi không có quyền, nhờ người quản lý PostgreSQL tạo database trống với quyền phù hợp.

Schema mới không tự tạo tài khoản hoặc hợp đồng/hóa đơn demo. Chỉ cần ba tài khoản Auth thì chạy `scripts/New-LocalTestUsers.ps1`; muốn bộ dữ liệu phát triển có cơ sở/phòng/công việc thì dùng lệnh seed bên dưới. MinIO/bucket và provider thật được cấu hình riêng. Nếu cần mang dữ liệu cũ sang thay vì môi trường trống, dùng quy trình import có đối soát bên dưới trên bản sao.

## Dữ liệu mẫu và trạng thái API sau chuyển đổi

Đã seed trực tiếp vào `bhome` local ngày 04/11/2026: **4 tài khoản, 2 cơ sở, 2 loại phòng, 6 phòng, 6 tài sản, 12 đồng hồ, 8 biểu phí mẫu, 3 người ở Pending, 1 phân công Staff và 4 công việc**. Database vẫn 24 bảng/386 cột/83 FK. Chạy lại không tạo trùng, không reset dữ liệu đã sửa.

Máy khác sau khi pull cần chuẩn bị Compact24 rồi chạy seed rõ ràng; dữ liệu trên máy hiện tại không đi theo Git:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Update-LocalDatabase.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Seed-LocalDevelopmentData.ps1
```

Seed yêu cầu mật khẩu bằng prompt ẩn cho account mới. Email đăng nhập: `owner.sample@example.invalid`, `staff.sample@example.invalid`, `tenant.sample@example.invalid`, `tenant.other.sample@example.invalid`. Staff chỉ được phân công cơ sở mẫu đầu; cơ sở thứ hai dùng kiểm tra giới hạn truy cập.

Chọn bộ sample hoặc bộ `New-LocalTestUsers`, không chạy cả hai bộ. Sample seed từ chối nếu đã có Owner khác để không tạo thêm Owner/container Chain ngoài mô hình hiện tại; không tiếp quản account cũ. Dữ liệu đã có được giữ nguyên khi bị từ chối.

**Trên máy hiện tại**, seed đã chạy bằng mật khẩu ngẫu nhiên không in/không lưu. Chọn mật khẩu riêng trước khi đăng nhập:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Seed-LocalDevelopmentData.ps1 -SetSamplePasswords
```

Switch này chỉ đặt lại mật khẩu bốn tài khoản mẫu và thu hồi phiên cũ; dữ liệu nghiệp vụ giữ nguyên. Không seed chữ ký, thanh toán thành công hoặc chỉ số đã xác nhận. Các màn hợp đồng/hóa đơn/thanh toán cần hoàn thành workflow; có thể còn rỗng sau seed.

[Danh mục toàn bộ API và trạng thái kết nối Owner Web/Mobile](../../api/API_IMPLEMENTATION_STATUS.md) liệt kê 189 route controller đang mount, 2 health endpoint và module có source chưa được mount. Có API backend không đồng nghĩa mọi màn frontend đã nối. Xem kết quả và giới hạn kiểm thử trong [báo cáo triển khai](compact-24/IMPLEMENTATION_REPORT.md).

## File bàn giao

| File                                                                                                       | Mục đích                                                                            |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| [IMPLEMENTATION_REPORT.md](compact-24/IMPLEMENTATION_REPORT.md)                                            | Phạm vi đã chuyển, DI/runtime, traceability, kết quả kiểm thử, giới hạn và rollback |
| [DESIGN_24_TABLES.md](compact-24/DESIGN_24_TABLES.md)                                                      | Mục đích từng bảng/JSON, quyết định cần bàn bạc, mapping đủ 70 bảng nguồn           |
| [BHOME_24_TABLES.sql](compact-24/BHOME_24_TABLES.sql)                                                      | DDL tạo target mới, có constraint/index/trigger bảo vệ dữ liệu                      |
| [BHOME_24_TABLES.dbml](compact-24/BHOME_24_TABLES.dbml)                                                    | Sơ đồ 24 bảng; SQL là nguồn chính cho trigger/partial index                         |
| [BHOME_Database_Design.json](compact-24/BHOME_Database_Design.json)                                        | Sơ đồ định dạng gốc 32.6.9, đồng bộ cột/FK với SQL                                  |
| [MIGRATION_RECONCILIATION.json](compact-24/MIGRATION_RECONCILIATION.json)                                  | Đối soát 70→24 thực chạy trên các fixture tổng hợp, không chứa PII                  |
| [Verify-Compact24.ps1](compact-24/Verify-Compact24.ps1), [SCHEMA_CHECKS.sql](compact-24/SCHEMA_CHECKS.sql) | Dựng database thử riêng, kiểm cấu trúc/sơ đồ và 28 assertions, rồi dọn database thử |

Không thêm bảng ảnh/history/job/Work Order riêng. Catalog và assignment trong Location; documents/handover/move-out/settlement trong Contract; command/job trong operational_tasks; audit/outbox/inbox phân loại trong notifications. Giữ các service, controller, DTO, provider và cơ chế kiểm quyền hiện có.

## Chuyển dữ liệu offline trên bản sao được phép

Công cụ: `tools/BHome.Compact24Migration`. Không tự tạo/xóa database, không chọn connection của API, không đổi runtime config. Chỉ chấp nhận PostgreSQL loopback và hai database riêng đúng mẫu:

- Source: `bhome_compact24_source_<32 ký tự hex>` — bản sao đầy đủ schema/data 70 bảng, đúng chuỗi migrations nguồn.
- Target: `bhome_compact24_<32 ký tự hex>` — mới, trống, khác source.

Cấp connection qua biến môi trường process **`BHOME_COMPACT24_SOURCE`** và **`BHOME_COMPACT24_TARGET`** từ cấu hình bí mật local, không ghi vào Git hoặc CLI arguments. Source được đọc trong transaction `REPEATABLE READ, READ ONLY`; target import trong một transaction và đối soát trước commit.

```powershell
# Từ thư mục gốc, sau khi cấp hai biến môi trường trên.
dotnet run --project tools/BHome.Compact24Migration -- `
  --initialize-target '<thu-muc-bao-cao>/initialize.json'
dotnet run --project tools/BHome.Compact24Migration -- `
  --inspect '<thu-muc-bao-cao>/preflight.json'
dotnet run --project tools/BHome.Compact24Migration -- `
  --copy-all '<thu-muc-bao-cao>/reconciliation.json'
```

Tạo sẵn thư mục báo cáo và database trống trước lệnh đầu. DDL yêu cầu extension `btree_gist`. `--inspect` không ghi target; `--copy-all` từ chối target đã có dữ liệu, không chạy import chồng. Lệnh `--copy-identity-fixture` chỉ dành kiểm tra Auth riêng, không thay `--copy-all`.

Mặc định preflight chặn bảng nguồn vượt 10.000 dòng để tránh nhập ngoài giới hạn bộ nhớ đã dự kiến. Có thể cấp `BHOME_COMPACT24_MAX_ROWS_PER_TABLE` là số nguyên dương phù hợp bản sao; công cụ đọc toàn bộ dữ liệu đã qua preflight, không cắt bớt dòng. Chưa benchmark dữ liệu lớn.

Preflight/import chặn dữ liệu chưa biểu diễn được: external Identity claims/login/token có dữ liệu, multi-Owner/multi-Chain, user thiếu role/hash/stamp, email normalized trùng, migration lạ/chưa áp dụng, FK/guard không hợp lệ hoặc đối soát sai. Không bỏ qua bản ghi để báo thành công.

Chỉ sau đối soát và nghiệm thu môi trường đích mới triển khai backend cùng connection Compact24 tương ứng. Thao tác cutover live, restore backup và xác minh object storage/provider thật chưa được thực hiện trong tác vụ này. Giữ nguyên khóa mã hóa/HMAC, provider config và private object keys của bản sao khi cần đọc dữ liệu đã nhập.

## Chạy lại kiểm chứng

Schema/diagram, dùng PostgreSQL loopback được phép tạo/xóa fixture qua `ConnectionStrings__Database` hoặc `.env` local hiện có:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File `
  docs/database/2026-11-03/compact-24/Verify-Compact24.ps1 `
  -PsqlPath '<duong-dan>/psql.exe'
```

Backend, cấp `BHOME_COMPACT24_TEST_ADMIN` là admin PostgreSQL loopback với `Database=postgres` cho fixture. Bộ Independence còn cần `BHOME_COMPACT24_QUERY_LOG` trỏ đến PostgreSQL statement log của **cluster thử tổng hợp riêng**, có database name trong prefix và tắt log parameter values; xem fixture Independence. Không bật statement logging trên database thật để chạy test.

Trong cluster thử riêng, cấu hình PostgreSQL phục vụ Independence:

```conf
log_statement = 'all'
log_line_prefix = '%m [%p] db=%d '
log_parameter_max_length = 0
log_parameter_max_length_on_error = 0
```

```powershell
dotnet test src/backend/BHome.sln --filter 'Category!=Docker' -m:1 -v minimal
```

Khi thiếu env, các test PostgreSQL có thể SKIP; không coi đó là đã kiểm. Lượt nghiệm thu ghi trong báo cáo đã cấp đủ env và không skip. Báo cáo cũng phân biệt test provider/storage thay thế với tích hợp thực tế.
