# Neon development — cấu hình BHOME

Cập nhật 08/11/2026, Asia/Ho_Chi_Minh. Database đã bootstrap; API readiness và kiểm
thử hai process đạt. Người dùng đã chọn **giữ MinIO local và chốt phần Neon trước**.
Storage liên máy được để lại cho giai đoạn sau, không phải điều kiện chốt phạm vi này.

## Đích và implementation thực tế

| Mục                    | Giá trị                                                           |
| ---------------------- | ----------------------------------------------------------------- |
| Project / organization | `quiet-hall-21512758` / `org-fragrant-scene-87072962`             |
| Nhánh / database       | `development` / `neondb`; production vẫn là default riêng         |
| Pooled                 | `ep-royal-water-ao5mauq0-pooler.c-2.ap-southeast-1.aws.neon.tech` |
| Direct                 | `ep-royal-water-ao5mauq0.c-2.ap-southeast-1.aws.neon.tech`        |
| Server đo thực tế      | PostgreSQL 18.6; local Compose/test PostgreSQL 16 được giữ        |
| Startup / DI           | `BHome.Api/Program.cs`, `AddInfrastructure`, `UseNpgsql`          |
| Runtime / key          | `Compact24DbContext` / `ConnectionStrings:Database`               |
| Schema đo thực tế      | **24 bảng public, 383 cột, 24 PK, 83 FK, 65 indexes**             |
| EF baseline            | `20261108112733_InitialCompact24`, 1 applied, 0 pending           |
| History                | `bhome_meta.__EFMigrationsHistory`, ngoài 24 bảng nghiệp vụ       |
| Schema nguồn cũ        | `BHomeDbContext`: catalog 35 migrations, không áp vào runtime     |
| Provider giữ nguyên    | EF Core 8.0.32, Npgsql EF 8.0.11, Npgsql 8.0.6                    |

Nhánh được xác định bằng endpoints người dùng xác nhận từ Console; SQL không chứng
minh branch ID. Không có Neon Management API token trong phiên này. Direct đã kiểm
chứng DNS/TCP/authentication/TLS, không tự suy hostname. Không sửa production.

Phạm vi là tích hợp môi trường: GBR-01/02 cho RBAC/Location/Tenant isolation, GBR-13
cho audit, GBR-18 cho idempotency và NFR cho secret/storage. Không đổi BF/UC/policy.
Con số 386 cột trong ghi chú/header cũ không khớp script đã duyệt: verifier và schema
thực tế cùng xác nhận **383**. Không thêm ba cột giả để khớp tài liệu.

## Cấu hình riêng

`.env` giữ local. `.env.neon` là profile operator trên máy setup: runtime dùng
`bhome_dev01`, direct giữ admin riêng. **Không phân phối nguyên profile operator.**
`.env.neon.dev01` … `.env.neon.dev05` là profile cá nhân ignored, không có direct/admin
PostgreSQL hoặc Compose root password. Mẫu commit được là `.env.neon.example`.

Các trường ObjectStorage hiện kế thừa cấu hình local để kiểm thử một máy. Trước khi
giao nguyên profile cho nhóm, phải thay bằng app credential scoped của MinIO chung;
không phân phối credential MinIO root đang dùng local. Có thể giao riêng file
PostgreSQL cá nhân trong thư mục developer-credentials qua kênh secret được duyệt.

Đã tạo secret dành riêng Neon development: JWT mới và encryption/HMAC key độc lập ở
version `neon-dev-v1`; không thay `.env`/User Secrets local. Các process shared cần
cùng key ring; không tự sinh key khác nhau hoặc rotate khi đã có dữ liệu mã hóa.
Secret chỉ được giao qua kênh được duyệt, không Git/chat. Profile mới cần HTTPS local
riêng, không sao chép certificate/password của operator.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Test-Database.ps1 -EnvironmentFile .env.neon.dev01
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Start-Api.ps1 -EnvironmentFile .env.neon.dev01
# Trở lại local trong terminal mới:
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Start-Api.ps1 -EnvironmentFile .env
```

API hỗ trợ User Secrets (`bhome-api-development`) và environment. Với `dotnet run`,
secrets/env/CLI cao hơn `.env` fallback; `Start-Api.ps1` nạp file được chọn vào process
environment. Không trộn profile trong một terminal. `Api__ReadDevelopmentEnvironmentFile=false`
khi đã cung cấp đủ env/secrets. Không echo connection hoặc chạy `user-secrets list` để lấy evidence.

Npgsql nhận chuỗi .NET, không raw PostgreSQL URL. Quote đúng giá trị chứa `;`.
Shared profile dùng `SSL Mode=VerifyFull;Channel Binding=Require`, pool tối đa 5 mỗi
process, minimum 0. Không bỏ certificate/hostname verification. Đây là cấu hình khởi
đầu, không phải bằng chứng đã load-test giới hạn compute.

## Migrations và worker

Runtime dùng pooled; khóa nghiệp vụ được audit là advisory **transaction** locks.
Startup local có session lock/CREATE DATABASE nên guard loopback được giữ nguyên.
`Pooling=false` không biến pooled host thành direct. Migrations chạy explicit qua
direct và factory có allowlist, history riêng; API không tự Migrate/EnsureCreated.

Laptop giữ `DevelopmentDatabase__InitializeOnStartup=false`,
`DevelopmentDatabase__AllowPreviousPropertySchema=false`, `Jobs__Enabled=false`,
`NotificationChannels__AutomationEnabled=false`. Chỉ một worker được chỉ định bật
sau duyệt policy/lịch. Durable lease/idempotency/transactions trong source vẫn bắt buộc.

## Chẩn đoán

| Lỗi                 | Xử lý                                                                     |
| ------------------- | ------------------------------------------------------------------------- |
| DNS/TCP             | Kiểm tra Console host, DNS, outbound 5432; không thay host bằng IP        |
| 28P01               | Kiểm tra role/nhánh và local secret đã rotate, không in password          |
| TLS/channel binding | Giữ VerifyFull/Require, kiểm tra CA/đồng hồ/provider                      |
| psql thiếu CA       | Cấp CA bundle tin cậy; máy audit xuất public roots từ Windows trust store |
| Timeout/cold start  | Retry có giới hạn, kiểm tra compute và pool mỗi instance                  |
| 42501               | Cấp quyền tối thiểu, không đưa owner password cho cả nhóm                 |
| Schema mismatch     | Đối chiếu migration/version, không reset/drop để ép chạy                  |
| MinIO thiếu object  | Dùng chung endpoint/bucket và kiểm tra key; không mở bucket public        |

Nguồn: [Npgsql parameters](https://www.npgsql.org/doc/connection-string-parameters),
[Neon pooling](https://neon.com/docs/connect/connection-pooling),
[EF history schema](https://learn.microsoft.com/en-us/ef/core/managing-schemas/migrations/history-table).
Xem [kết quả thực thi](DATABASE_VERIFICATION.md).
