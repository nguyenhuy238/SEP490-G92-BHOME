# Database development cho nhóm 5 người

Shared target: `quiet-hall-21512758` / **development** / `neondb`. Schema/API đã hoạt
động trên Neon. Production không dùng phát triển và không bị sửa.
Xem [setup](NEON_SETUP.md), [migrations](DATABASE_MIGRATION_WORKFLOW.md),
[kết quả](DATABASE_VERIFICATION.md).

## Role và secret

Đã tạo năm LOGIN riêng `bhome_dev01` … `bhome_dev05` thuộc group NOLOGIN
`bhome_development_runtime`. Cả năm đăng nhập được cùng development database.

| Quyền                                                                     | Trạng thái                       |
| ------------------------------------------------------------------------- | -------------------------------- |
| CONNECT/USAGE, DML cần cho backend trên 24 bảng public                    | Được cấp                         |
| USAGE/SELECT sequences và đọc migration history                           | Được cấp                         |
| CREATE public, CREATE DATABASE/ROLE, TEMPORARY                            | Không được cấp                   |
| Sửa history, member owner/neon_superuser, SUPERUSER/BYPASSRLS/REPLICATION | Không được cấp                   |
| Append-only audit/payment invariants                                      | Triggers/constraints vẫn áp dụng |

Metadata quyền đã kiểm trên cả năm role Neon. Test PostgreSQL disposable còn thử
CREATE TABLE/ROLE, sửa history và SET ROLE admin: bị từ chối SQLSTATE 42501.
Không chia sẻ `neondb_owner`. Frontend/mobile chỉ cần API; chỉ cấp SQL credential
khi thành viên thực sự chạy backend. DB roles không thay Identity/JWT/Location scope.

Credential cá nhân nằm trong `.tools/neon-integration/developer-credentials/`.
Năm profile `.env.neon.dev01` … `.env.neon.dev05` trên máy setup bị Git ignore,
không có direct/admin PostgreSQL hoặc Compose root password. Team Leader gán từng mã,
giao secret qua kênh được duyệt, không Git/chat. Không phân phối `.env.neon` operator.
Trường ObjectStorage của các profile hiện phục vụ test local; thay bằng credential
bucket-scoped của MinIO chung trước khi phân phối nguyên profile, không chia sẻ MinIO root.

```powershell
# Operator; idempotent, không in/reset password đã có:
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Initialize-NeonRoles.ps1
```

Command dừng nếu role có quyền bất thường hoặc thiếu credential local tương ứng;
không tự đổi mật khẩu người khác. Default privileges cho object operator tạo đã cấu
hình; thay đổi quyền tương lai vẫn cần review.

## Sau clone

Dùng `member/<tên>`, PR vào develop. Không push trực tiếp main/develop.

```powershell
git status --short
git branch --show-current
dotnet restore src/backend/BHome.sln
dotnet tool restore
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Initialize-Local.ps1
dotnet dev-certs https --trust
```

Bỏ Initialize-Local nếu `.env` tồn tại. Nhận profile riêng hoặc điền mẫu
`.env.neon.example` qua secret manager. Shared process cần cùng JWT và key ring
IdentityProtection riêng Neon development (`neon-dev-v1`); không tự sinh key khác nhau.
Giữ `.env` cho local; HTTPS/certificate cấu hình riêng mỗi máy.

```powershell
git check-ignore .env.neon.dev01
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Test-Database.ps1 -EnvironmentFile .env.neon.dev01
dotnet build src/backend/BHome.sln -c Release
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Start-Api.ps1 -EnvironmentFile .env.neon.dev01
```

Thay dev01 bằng mã được giao. Mong đợi Compact24 PASS, history 1 applied/0 pending,
live/ready 200. User Secrets Kestrel có thể ghi đè `--urls`; kiểm tra port thực tế.
Frontend chỉ đặt API URL, không PostgreSQL secret vào VITE/Expo config.

## Dataset tổng hợp

Reuse `Compact24SampleSeed` qua entry point shared riêng, giữ nguyên guard local:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Seed-NeonDevelopmentData.ps1
```

Seed dùng transaction/advisory transaction lock/marker cố định; từ chối target ngoài
development pooled, Owner thứ hai hoặc ghi đè tài khoản người khác. Chạy lại nhận
`SAMPLE_ALREADY_PRESENT`, không reset password/nhân dữ liệu.

Có Owner/Staff/2 Tenant (`*.sample@example.invalid`), 2 Locations, 6 Rooms, Assets/
Meters, giá **mẫu** cần Owner xem lại, 3 Residents pending, 4 operational tasks.
Staff được gán một Location, Location còn lại kiểm isolation. Một Location
`NEON INTEGRATION SYNTHETIC 2026-11-08` được tạo qua API, kèm ảnh PNG tổng hợp.
Password tài khoản ứng dụng lấy từ secret local, khác password PostgreSQL.
Không seed CCCD, hợp đồng active hoặc invoice/payment thành công giả.

## MinIO local và worker

Đã kiểm hai process trên cùng máy dùng MinIO `localhost:9000`: A upload qua Owner
API, Neon giữ reference, B tải qua public API sau Owner publish; SHA-256 khớp.
Người dùng đã chọn **giữ MinIO local, chốt Neon trước**. Storage liên máy chưa được
nghiệm thu và để giai đoạn sau. Khi dùng chung DB nhưng mỗi người dùng MinIO riêng,
ảnh/file do máy khác tạo có thể không tồn tại trên máy mình.

Phương án cho giai đoạn sau: một host MinIO chung dùng deployment Docker hiện có, volume/
backup bền vững, bucket private, app credential chỉ có quyền bucket cần thiết; root
giữ ở operator. Chỉ mở qua private network/TLS hoặc SSH tunnel được duyệt. Mọi backend
trỏ cùng `ObjectStorage__Endpoint/AccessKey/SecretKey/Bucket/UseSsl`; nếu localhost qua
tunnel thì phải cùng tới một server, không phải năm MinIO local khác nhau. Chưa có
host/tunnel/credential scoped liên máy để nghiệm thu. Không mở bucket public hoặc đổi
sang Neon Object Storage. Không lưu ảnh CCCD làm seed/evidence.

Laptop giữ `Jobs__Enabled=false`, `NotificationChannels__AutomationEnabled=false`,
`DevelopmentDatabase__InitializeOnStartup=false`. Đã đo 0 SYSTEM_JOB rows sau hai
process. Chỉ một worker được chỉ định bật sau duyệt policy/lịch; durable lease/
transaction/idempotency trong source vẫn bắt buộc. Không bật finalization/payment
chỉ để có demo. Không tự chạy migration/seed/reset trên laptop.

Unit/Integration Tests luôn disposable local/Testcontainers, không đặt Neon vào biến
test admin. Dùng synthetic records có nhãn; không sửa/xóa dữ liệu người khác hoặc
đưa dữ liệu Tenant thật vào shared development.

## Bằng chứng chia sẻ

Đã kiểm **hai process trên một máy**, role DB khác nhau: Owner A tạo Location, B đọc
cùng ID; token/session A được B xác nhận; restart A vẫn đọc lại được. Staff ngoài
Location nhận 404, Tenant vào quản trị 403, anonymous 401. Publish thiếu contact bị
409; thêm email `.invalid` thì thành công. Đây không phải kiểm thử hai máy. Sau khi
có network/MinIO chung, hai thành viên lặp lại kịch bản và lưu evidence không chứa secret/PII.
