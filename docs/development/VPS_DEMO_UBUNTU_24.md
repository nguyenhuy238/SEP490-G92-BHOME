# Triển khai BHome demo trên Ubuntu 24.04

Phạm vi: VPS mới, database PostgreSQL mới, dữ liệu tổng hợp, chưa có tên miền riêng.
Hướng dẫn được đối chiếu mã nguồn ngày 18/11/2026. Chưa chạy trên VPS của bạn.
Các lệnh dưới đây dành cho **Bash trên VPS**, trừ chỗ ghi rõ Windows.

VPS có khoảng 4.3 GiB RAM và 50 GiB đĩa trống có thể dùng để bắt đầu demo ít người.
Chưa có số đo tải/OCR cho máy này. Build tuần tự để giảm RAM; không chạy Metro/Expo
development server thường trực trên VPS. Hướng dẫn giả định CPU x86_64; kiểm tra
`uname -m` trước vì repo có thư viện OCR native linux-x64.

Luồng truy cập: Internet -> Caddy HTTPS -> Owner Web / Public Web / API.
PostgreSQL và MinIO chỉ mở cổng loopback. API dùng tài khoản database/storage riêng.
Owner Web gọi API qua cùng origin để refresh cookie không phụ thuộc cookie chéo site.

## 1. Chuẩn bị VPS

Đang đăng nhập root thì chạy trực tiếp:

```bash
apt update
apt upgrade -y
apt install -y ca-certificates curl git openssl ufw dnsutils
uname -m
timedatectl set-timezone Asia/Ho_Chi_Minh
```

Cho phép **cổng SSH đang sử dụng** trước khi bật firewall. Ví dụ sau chỉ đúng nếu SSH
đang ở cổng 22; kiểm tra `ss -lntp` và cấu hình firewall của nhà cung cấp VPS trước.
Giữ phiên SSH hiện tại, mở thêm phiên thứ hai để kiểm tra kết nối.

```bash
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
ufw status
```

Trên firewall/security group của nhà cung cấp cũng cho phép SSH, TCP 80, TCP 443.
Không mở public PostgreSQL 5432, MinIO 9000/9001 hoặc API 18080.

## 2. Cài Docker Engine và Compose

Cài từ repository chính thức của Docker, không cần cài .NET/Node trên host:

```bash
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
cat > /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: noble
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
docker run --rm hello-world
docker compose version
```

Docker có thể publish cổng đi vòng qua UFW; vì thế cổng nội bộ trong cấu hình dưới
đây chỉ bind `127.0.0.1`, không dựa riêng vào UFW.

## 3. Lấy mã nguồn

```bash
install -d -m 700 /opt/bhome-config /opt/bhome-artifacts
git clone https://github.com/nguyenhuy238/SEP490-G92-BHOME.git /opt/bhome
cd /opt/bhome
git branch -a
```

Nếu repo private, dùng SSH deploy key chỉ đọc hoặc xác thực Git trên VPS. Không đặt
token vào URL clone hoặc gửi token vào hội thoại. Checkout đúng commit đã kiểm thử
muốn demo; mã chưa push từ máy cá nhân sẽ không có trong bản clone. Ghi lại:

```bash
git rev-parse HEAD
git status --short
```

## 4. Tạo địa chỉ HTTPS tạm và cấu hình riêng

Thay `IP_PUBLIC_CUA_VPS` bằng IPv4 public trên trang quản trị VPS, không dùng địa chỉ
private `10.x`, `172.16.x` hay `192.168.x`. sslip.io là dịch vụ DNS bên ngoài dùng tạm
cho demo, không phải tên miền bạn sở hữu. Khả năng cấp chứng chỉ phụ thuộc DNS, CA
và rate limit của dịch vụ.

Chạy **một lần**; chạy lại khối này sẽ đổi toàn bộ mật khẩu/khóa:

```bash
cd /opt/bhome
umask 077
BHOME_VPS_IP='IP_PUBLIC_CUA_VPS'
BHOME_DNS_BASE="${BHOME_VPS_IP}.sslip.io"
cat > /opt/bhome-config/stack.env <<EOF
POSTGRES_DB=bhome
POSTGRES_USER=bhome_deploy
POSTGRES_PASSWORD=$(openssl rand -hex 32)
POSTGRES_PORT=5432
DB_APP_PASSWORD=$(openssl rand -hex 32)
MINIO_ROOT_USER=bhome-storage-admin
MINIO_ROOT_PASSWORD=$(openssl rand -hex 32)
MINIO_API_PORT=9000
MINIO_CONSOLE_PORT=9001
STORAGE_APP_USER=bhome-app
STORAGE_APP_PASSWORD=$(openssl rand -hex 32)
JWT_SIGNING_KEY=$(openssl rand -hex 32)
DIGITAL_SIGNING_SECRET=$(openssl rand -hex 32)
IDENTITY_ENCRYPTION_KEY=$(openssl rand -base64 32)
IDENTITY_HMAC_KEY=$(openssl rand -base64 32)
OWNER_HOST=owner.${BHOME_DNS_BASE}
PUBLIC_HOST=www.${BHOME_DNS_BASE}
API_HOST=api.${BHOME_DNS_BASE}
EOF
chmod 600 /opt/bhome-config/stack.env
dig +short "owner.${BHOME_DNS_BASE}"
dig +short "api.${BHOME_DNS_BASE}"
```

Kết quả DNS phải trỏ về IPv4 VPS. Không commit hoặc chia sẻ `stack.env`.

## 5. Dockerfile API, công cụ tạo tài khoản và SQL migration

Dockerfile API hiện có chỉ copy `src/backend`, trong khi Infrastructure tham chiếu
`src/digital-signing`, SQL và DOCX trong `docs`. Dùng Dockerfile riêng bên ngoài repo
để giữ nguyên mã nguồn. Cài thêm LibreOffice/Poppler vì luồng bản nháp hợp đồng gọi
executable cục bộ; không mount Docker socket vào API.

Tạo `/opt/bhome-config/Api.vps.Dockerfile`:

```dockerfile
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS source
WORKDIR /source
COPY global.json Directory.Build.targets ./
COPY .config/ .config/
COPY src/backend/ src/backend/
COPY src/digital-signing/ src/digital-signing/
COPY docs/database/ docs/database/
COPY docs/mau-hop-dong-thue-nha-tro-ngan-gon.docx docs/
COPY tools/BHome.LocalDevelopment/ tools/BHome.LocalDevelopment/

FROM source AS build
RUN dotnet publish src/backend/BHome.Api/BHome.Api.csproj -c Release -o /app

FROM source AS schema
RUN dotnet tool restore
# Chỉ sinh SQL offline; đây là đích local giả hợp lệ cho design-time factory.
# Không kết nối database VPS, không nới allowlist của factory.
ENV BHOME_COMPACT24_DIRECT="Host=127.0.0.1;Database=bhome_compact24_00000000000000000000000000000000;Username=offline;Password=offline"
RUN mkdir /out && dotnet ef migrations script 0 --no-transactions \
    --context Compact24DbContext \
    --project src/backend/BHome.Api \
    --startup-project src/backend/BHome.Api \
    --configuration Release --output /out/compact24.sql

FROM scratch AS schema-output
COPY --from=schema /out/ /

FROM source AS seed-build
RUN dotnet publish tools/BHome.LocalDevelopment/BHome.LocalDevelopment.csproj -c Release -o /seed

FROM mcr.microsoft.com/dotnet/aspnet:8.0-bookworm-slim AS runtime-base
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgomp1 libreoffice-writer poppler-utils fonts-liberation fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV ASPNETCORE_HTTP_PORTS=8080
ENV HOME=/home/app
USER $APP_UID

FROM runtime-base AS seed
COPY --from=seed-build /seed/ ./
ENTRYPOINT ["dotnet", "BHome.LocalDevelopment.dll"]

FROM runtime-base AS api
COPY --from=build /app/ ./
EXPOSE 8080
ENTRYPOINT ["dotnet", "BHome.Api.dll"]
```

Không dùng `--idempotent` cho SQL thực thi này: tài liệu migration của repo ghi
nhận EF có thể indent dollar-quoted function bodies làm schema verifier từ chối.
Script trên dành cho **database mới trống**, từ migration 0 đến version của commit.
Database đã có dữ liệu cần kế hoạch nâng đúng FROM/TO và backup riêng.

## 6. Compose bổ sung

Compose gốc đã có PostgreSQL/MinIO và persistent volumes. Tạo
`/opt/bhome-config/compose.vps.yml` như sau. Các đường dẫn tuyệt đối đều nằm ngoài
Git; `context: .` được tính từ Compose gốc trong `/opt/bhome`.

```yaml
x-logging: &logging
  driver: json-file
  options:
    max-size: '10m'
    max-file: '3'

services:
  postgres:
    environment:
      BHOME_APP_PASSWORD: ${DB_APP_PASSWORD:?required}
    logging: *logging
  minio:
    logging: *logging
  api:
    build:
      context: .
      dockerfile: /opt/bhome-config/Api.vps.Dockerfile
      target: api
    image: bhome/api:demo
    environment:
      ASPNETCORE_ENVIRONMENT: Production
      DOTNET_ENVIRONMENT: Production
      AllowedHosts: ${API_HOST};${OWNER_HOST};localhost;127.0.0.1
      ConnectionStrings__Database: Host=postgres;Port=5432;Database=bhome;Username=bhome_app;Password=${DB_APP_PASSWORD}
      Jwt__SigningKey: ${JWT_SIGNING_KEY}
      DigitalSigning__SecretKey: ${DIGITAL_SIGNING_SECRET}
      IdentityProtection__ActiveEncryptionVersion: demo-v1
      IdentityProtection__ActiveHmacVersion: demo-v1
      IdentityProtection__EncryptionKeys__demo-v1: ${IDENTITY_ENCRYPTION_KEY}
      IdentityProtection__HmacKeys__demo-v1: ${IDENTITY_HMAC_KEY}
      Cors__AllowedOrigins__0: https://${OWNER_HOST}
      Cors__AllowedOrigins__1: https://${PUBLIC_HOST}
      AuthWeb__AllowedOrigins__0: https://${OWNER_HOST}
      ObjectStorage__Endpoint: minio:9000
      ObjectStorage__AccessKey: ${STORAGE_APP_USER}
      ObjectStorage__SecretKey: ${STORAGE_APP_PASSWORD}
      ObjectStorage__Bucket: bhome-private
      ObjectStorage__UseSsl: 'false'
      Api__UseHttpsRedirection: 'false'
      DevelopmentDatabase__InitializeOnStartup: 'false'
      Jobs__Enabled: 'false'
      BillingAutomation__AutomaticJobsEnabled: 'false'
      Ocr__Enabled: 'false'
      Sms__Enabled: 'false'
      SmsRecovery__Enabled: 'false'
      Email__Enabled: 'false'
      NotificationChannels__Enabled: 'false'
      SePay__Enabled: 'false'
      ContractWorkflow__SimulatedSigningEnabled: 'false'
      MainDraft__LibreOfficePath: /usr/bin/soffice
      MainDraft__PdfToPpmPath: /usr/bin/pdftoppm
    ports:
      - '127.0.0.1:18080:8080'
    volumes:
      - /opt/bhome-config/data-protection:/home/app/.aspnet/DataProtection-Keys
    depends_on:
      postgres:
        condition: service_healthy
      minio:
        condition: service_healthy
    restart: unless-stopped
    logging: *logging
  owner-web:
    build:
      context: .
      dockerfile: deploy/docker/Web.Dockerfile
      args:
        APP: owner-web
        VITE_API_BASE_URL: https://${OWNER_HOST}
    image: bhome/owner-web:demo
    restart: unless-stopped
    logging: *logging
  public-web:
    build:
      context: .
      dockerfile: deploy/docker/Web.Dockerfile
      args:
        APP: public-web
        VITE_API_BASE_URL: https://${API_HOST}
    image: bhome/public-web:demo
    restart: unless-stopped
    logging: *logging
  caddy:
    image: caddy:2-alpine
    environment:
      OWNER_HOST: ${OWNER_HOST}
      PUBLIC_HOST: ${PUBLIC_HOST}
      API_HOST: ${API_HOST}
    ports:
      - '80:80'
      - '443:443'
    volumes:
      - /opt/bhome-config/Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
      - caddy-config:/config
    depends_on:
      - api
      - owner-web
      - public-web
    restart: unless-stopped
    logging: *logging

volumes:
  caddy-data:
  caddy-config:
```

API HTTP chỉ có trong mạng Docker/loopback; Caddy là cổng HTTPS bắt buộc từ Internet.
Vì vậy cấu hình này tắt redirect trong API và dùng redirect HTTPS tại Caddy.
Repo hiện chưa có trusted forwarded-header middleware: giới hạn theo IP ở API sẽ
thấy proxy thay vì IP thực của từng người. Chưa bật callback SMS/bank hoặc đánh giá
rate limit theo IP như production; khi triển khai chính thức phải xử lý trusted
proxy có giới hạn, không tin X-Forwarded-* từ mọi nguồn.

Tạo `/opt/bhome-config/Caddyfile`:

```caddyfile
{$OWNER_HOST} {
    encode gzip
    handle /api/* {
        reverse_proxy api:8080
    }
    handle /open/* {
        reverse_proxy api:8080
    }
    handle {
        reverse_proxy owner-web:8080
    }
}

{$PUBLIC_HOST} {
    encode gzip
    reverse_proxy public-web:8080
}

{$API_HOST} {
    @health path /health/*
    respond @health 404
    reverse_proxy api:8080
}
```

Tạo shell helper; chạy lại phần `dc()` khi mở phiên SSH mới:

```bash
cd /opt/bhome
dc() {
  docker compose --project-name bhome-vps \
    --env-file /opt/bhome-config/stack.env \
    -f /opt/bhome/docker-compose.yml \
    -f /opt/bhome-config/compose.vps.yml "$@"
}
install -d -o 1654 -g 1654 -m 700 /opt/bhome-config/data-protection
dc config --quiet
```

UID 1654 là app user của .NET 8 image đang dùng; nếu đổi image, đối chiếu UID trước
khi đổi chủ thư mục. Chỉ chạy `config --quiet`; `config` đầy đủ có thể in secrets.

## 7. Build tuần tự và khởi động data services

```bash
cd /opt/bhome
dc build minio
dc up -d postgres minio
dc ps
dc build api
dc build owner-web
dc build public-web
docker build -f /opt/bhome-config/Api.vps.Dockerfile --target schema-output \
  --output type=local,dest=/opt/bhome-artifacts .
docker build -f /opt/bhome-config/Api.vps.Dockerfile --target seed \
  -t bhome/seed:demo .
```

MinIO build từ source theo repo nên lần đầu lâu và tốn RAM/đĩa. Nếu build hết RAM,
build image trên máy khác cùng kiến trúc rồi chuyển `docker save`/`docker load`;
không tăng số build đồng thời. Repo đánh dấu MinIO này dùng cho development/demo;
không coi cấu hình này là quyết định storage production đã được duyệt.

## 8. Áp schema Compact24 lên database mới

Đọc `/opt/bhome-artifacts/compact24.sql`, đối chiếu đúng commit. Không áp lên Neon,
database local laptop hoặc database có dữ liệu. Lệnh sau dừng khi SQL lỗi và dùng
một transaction cho lần bootstrap; nếu lỗi thì kiểm nguyên nhân trước khi thử lại.

```bash
dc exec -T postgres psql -U bhome_deploy -d bhome -Atc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';"
```

Với database mới, kết quả phải là `0`. Sau đó:

```bash
dc exec -T postgres psql -U bhome_deploy -d bhome \
  -v ON_ERROR_STOP=1 --single-transaction < /opt/bhome-artifacts/compact24.sql
dc exec -T postgres psql -U bhome_deploy -d bhome -c \
  'SELECT * FROM bhome_meta."__EFMigrationsHistory" ORDER BY "MigrationId";'
```

Không dùng migrations của `BHomeDbContext` legacy; runtime dùng `Compact24DbContext`.
Không chạy development reset/archive scripts trên database đã có dữ liệu.

Tạo tài khoản runtime **một lần** sau khi schema hoàn tất:

```bash
dc exec -T postgres psql -U bhome_deploy -d bhome -v ON_ERROR_STOP=1 <<'SQL'
\getenv app_password BHOME_APP_PASSWORD
CREATE ROLE bhome_app LOGIN PASSWORD :'app_password';
GRANT CONNECT ON DATABASE bhome TO bhome_app;
GRANT USAGE ON SCHEMA public, bhome_meta TO bhome_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO bhome_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bhome_app;
GRANT SELECT ON ALL TABLES IN SCHEMA bhome_meta TO bhome_app;
ALTER DEFAULT PRIVILEGES FOR ROLE bhome_deploy IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO bhome_app;
ALTER DEFAULT PRIVILEGES FOR ROLE bhome_deploy IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO bhome_app;
SQL
```

Sau migration tương lai, kiểm lại quyền cho mọi object/schema mới.

## 9. Tạo bucket private và storage account

Cài MinIO Client chính thức cho x86_64. Chỉ dùng secrets trong biến của shell hiện
tại; không bật `set -x` và không chia sẻ log có secrets.

```bash
curl -fL https://dl.min.io/client/mc/release/linux-amd64/mc -o /usr/local/bin/mc
chmod 755 /usr/local/bin/mc
set -a
. /opt/bhome-config/stack.env
set +a
mc --config-dir /opt/bhome-config/mc alias set bhome-local \
  http://127.0.0.1:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"
mc --config-dir /opt/bhome-config/mc mb --ignore-existing bhome-local/bhome-private
mc --config-dir /opt/bhome-config/mc anonymous set none bhome-local/bhome-private
cat > /opt/bhome-config/bucket-policy.json <<'JSON'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:ListBucket", "s3:GetBucketLocation", "s3:ListBucketMultipartUploads"],
      "Resource": ["arn:aws:s3:::bhome-private"]
    },
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:AbortMultipartUpload", "s3:ListMultipartUploadParts"],
      "Resource": ["arn:aws:s3:::bhome-private/*"]
    }
  ]
}
JSON
mc --config-dir /opt/bhome-config/mc admin user add bhome-local \
  "$STORAGE_APP_USER" "$STORAGE_APP_PASSWORD"
mc --config-dir /opt/bhome-config/mc admin policy create bhome-local \
  bhome-private-policy /opt/bhome-config/bucket-policy.json
mc --config-dir /opt/bhome-config/mc admin policy attach bhome-local \
  bhome-private-policy --user "$STORAGE_APP_USER"
chmod -R go-rwx /opt/bhome-config/mc
```

API không tự tạo bucket. Không bật public-read; download private phải đi qua API
có phân quyền. Chưa có ảnh CCCD thật nào cần đưa lên VPS demo.

## 10. Tạo ba tài khoản demo mới

Dùng đúng công cụ `BHome.LocalDevelopment`, chỉ chạy một lần trong container CLI
với loopback và database `bhome`. **Đây không phải API Development công khai.**
Nhập mật khẩu tự chọn tối thiểu 12 ký tự, có chữ hoa/thường, số và ký tự đặc biệt:

```bash
set -a
. /opt/bhome-config/stack.env
set +a
read -rsp 'Mat khau cho bo tai khoan demo: ' BHOME_DEV_TEST_PASSWORD
printf '\n'
export BHOME_DEV_TEST_PASSWORD
export ConnectionStrings__Database="Host=127.0.0.1;Port=5432;Database=bhome;Username=bhome_app;Password=${DB_APP_PASSWORD}"
export Jwt__SigningKey="$JWT_SIGNING_KEY"
docker run --rm --network host \
  -e DOTNET_ENVIRONMENT=Development \
  -e ConnectionStrings__Database -e Jwt__SigningKey -e BHOME_DEV_TEST_PASSWORD \
  bhome/seed:demo
unset BHOME_DEV_TEST_PASSWORD ConnectionStrings__Database Jwt__SigningKey
```

Email đăng nhập tương ứng:

| Vai trò | Email                      |
| ------- | -------------------------- |
| Owner   | owner.dev@example.invalid  |
| Staff   | staff.dev@example.invalid  |
| Tenant  | tenant.dev@example.invalid |

Cả ba dùng mật khẩu vừa nhập. Không lấy mật khẩu cố định từ DEMO_ACCOUNTS.txt trên
máy khác. Tool dùng ASP.NET Core Identity để hash; không tự INSERT password/hash.
Nếu một tên đã tồn tại, tool không thay tài khoản/mật khẩu và trả exit code 2.

Database mới chỉ có tài khoản, chưa có Location/Room/Contract/Invoice. Owner tạo
dữ liệu cần demo qua workflow thực; Staff/Tenant phải được gắn đúng cơ sở/hồ sơ
trước khi có dữ liệu nghiệp vụ để xem. Không bật seed tài chính khác một cách ngầm.

## 11. Mở hệ thống và kiểm tra

```bash
dc up -d api owner-web public-web
dc exec -T api id
curl -f http://127.0.0.1:18080/health/live
curl -f http://127.0.0.1:18080/health/ready
dc up -d caddy
dc ps
dc logs --tail=80 caddy
```

`live`/`ready` phải HTTP 200. `ready` kiểm database/schema, không chứng minh bucket,
OCR, provider hoặc mọi workflow đều đúng. Nếu API không chạy, xem `dc logs --tail=100 api`.
Caddy tự xin HTTPS khi DNS/cổng 80/443 hợp lệ; không dùng `curl -k` làm bằng chứng TLS.

```bash
set -a
. /opt/bhome-config/stack.env
set +a
curl -I "https://${OWNER_HOST}"
curl -I "https://${PUBLIC_HOST}"
curl -i "https://${OWNER_HOST}/api/v1/auth/me"
```

Hai web phải tải được; API `auth/me` khi chưa đăng nhập phải trả 401. Mở Owner Web
trong trình duyệt, đăng nhập `owner.dev@example.invalid`, reload, logout/login lại.
Kiểm refresh cookie `Secure`/`HttpOnly`, không có CORS hoặc mixed-content errors.
Staff/Tenant truy cập dữ liệu ngoài phạm vi phải bị từ chối; thử upload/download ảnh
tổng hợp qua workflow đã có để kiểm object storage thực.

Swagger bị tắt trong Production theo Program.cs; `/swagger` không mở là dự kiến.
Không đổi API sang Development chỉ để bật Swagger hoặc vượt kiểm tra ký hợp đồng.

## 12. Mobile và tích hợp riêng

Mobile không phải container web thứ ba. Trên **máy phát triển**, cấu hình file riêng
`src/mobile/.env.local` với API HTTPS đã có, rồi reload/rebuild app:

```dotenv
EXPO_PUBLIC_API_BASE_URL=https://api.IP_PUBLIC_CUA_VPS.sslip.io
```

Có thể dùng Expo trên máy phát triển để demo hoặc build APK theo quy trình mobile
hiện có. Không đưa JWT, DB password hay private provider key vào `EXPO_PUBLIC_*`.

Các tính năng sau đang **tắt có chủ đích trong profile ban đầu** và chưa được xác
nhận chạy chỉ vì deploy web thành công:

- OCR: cần tải/mount model đúng checksum, bật cấu hình và kiểm native runtime/RAM.
- Jobs: cần cấu hình/test từng nhóm trước khi bật `Jobs__Enabled`; không tự bật
  finalization hoặc reminder khi thiếu policy.
- Email/SMS: cần credentials riêng, URL invitation/reset HTTPS hợp lệ và trusted
  origins; SMS thật cần Brandname/template đã duyệt. Jobs xử lý delivery phải chạy.
- SePay: cần receiving Location/account, đúng mode, callback HTTPS và xác thực
  provider; frontend không tự xác nhận thành công.
- Ký số: cần Viettel/provider thật và mẫu hợp đồng được duyệt. Source hiện có
  renderer từ chối sample template trong Production (`contract_template_not_approved`).
  Triển khai hạ tầng không bỏ giới hạn đó, cũng không cho phép thay signing bằng
  OTP/chữ ký vẽ nếu chưa có quyết định phạm vi được duyệt.
- Identity encryption: profile truyền hai khóa khác nhau cho cơ chế `IdentityProtection`
  đã có trong source; giữ chúng ổn định và backup riêng. Chỉ dùng thông tin tổng hợp,
  cấu hình demo này không thay cho quyết định key management production.

Muốn nghiệm thu trọn luồng hợp đồng/thanh toán/OCR cần kiểm riêng các mục này;
không tuyên bố toàn bộ hệ thống đã sẵn sàng chỉ từ HTTP 200.

## 13. Lưu dữ liệu và cập nhật

Named volumes giữ DB/MinIO khi recreate container. Không chạy `docker compose down -v`
hoặc prune volumes vì sẽ xóa dữ liệu demo. Cần backup PostgreSQL, MinIO và khóa riêng;
backup cùng VPS chưa bảo vệ khi mất VPS.

Backup DB trước một lần nâng version:

```bash
install -d -m 700 /opt/bhome-backups
BHOME_BACKUP_TAG=$(date -u +%Y%m%dT%H%M%SZ)
dc exec -T postgres pg_dump -U bhome_deploy -d bhome -Fc \
  > "/opt/bhome-backups/bhome-${BHOME_BACKUP_TAG}.dump"
chmod 600 "/opt/bhome-backups/bhome-${BHOME_BACKUP_TAG}.dump"
```

Chỉ coi backup hợp lệ sau khi lệnh thành công và restore thử ở database riêng.
Để snapshot file storage nhất quán, dừng API/jobs ghi, sao lưu MinIO bằng công cụ
được kiểm chứng và lưu key ring cùng secrets qua kênh mã hóa; sau đó khởi động lại.
Không gửi backup chứa PII/khóa vào chat hoặc Git.

Khi cập nhật: ghi commit cũ, backup, checkout commit đã kiểm thử, review migration
FROM/TO, áp migration đúng quy trình, build tuần tự và `dc up -d` từng app. Không
chạy lại script schema từ 0 hoặc khối sinh secrets. Nếu đổi hostname phải cập nhật
Caddy/CORS/AuthWeb và **build lại** web vì Vite nhúng URL tại build time.

Xem RAM/đĩa/log:

```bash
docker stats --no-stream
free -h
df -h
docker system df
dc logs --tail=100 api
```

Không mount Docker socket, private key CA local hoặc `.tools` của laptop vào API.
Khi dùng dữ liệu thật cần rà soát production riêng, pin image digest, trusted proxy,
backup/restore, monitoring và các provider trước khi mở sử dụng chính thức.

## Nguồn và trạng thái kiểm chứng

- [Docker Engine trên Ubuntu](https://docs.docker.com/engine/install/ubuntu/)
- [Docker published ports và firewall](https://docs.docker.com/engine/network/packet-filtering-firewalls/)
- [sslip.io / nip.io và TLS](https://nip.io/)
- [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https)
- [EF Core migration deployment](https://learn.microsoft.com/en-us/ef/core/managing-schemas/migrations/applying)
- Repo: `deploy/docker/README.md`, `docs/database/DATABASE_MIGRATION_WORKFLOW.md`,
  `Program.cs`, `Compact24DbContextFactory`, `LocalTestAccounts`, `AuthTransportFilter`.

Hướng dẫn không thay business rules/API/schema và không sửa Dockerfile hiện có.
Đã parse YAML mẫu bằng js-yaml và kiểm tra `bash -n` thành công cho 17 khối Bash.
Đây chỉ là kiểm tra cú pháp; chưa xác nhận Docker Compose merge hoặc image runtime.
Docker daemon máy làm việc đang dừng và chưa có SSH VPS. Build images, migration trên PostgreSQL,
TLS, seed, đăng nhập và workflow trên VPS: **NOT RUN**, cần thực thi các bước trên.
