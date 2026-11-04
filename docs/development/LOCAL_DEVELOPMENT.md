# Local development

Use .NET 8 SDK, Node 22.13+ (22.x) and npm 10+. `global.json` intentionally does not use .NET
9/10 even if those SDKs are present. Native Android development also requires Android Studio/JDK;
iOS requires macOS and Xcode. Native tools are not needed for browser development.

The initialization machine has portable validation tools in ignored `.tools/`. In PowerShell:

```powershell
. ./scripts/Use-LocalTools.ps1
dotnet --list-sdks
node --version
npm.cmd --version
```

On a clean clone, install prerequisites using your team's approved installation method. Repository
scripts do not install machine-wide software. If PowerShell blocks local script execution, use a
child process, for example `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Validate.ps1`.
This changes only the child process policy, not the machine policy. `npm.cmd` avoids PowerShell's
script policy for npm shims.

## Configuration

Run `scripts/Initialize-Local.ps1` once to generate an ignored `.env` with random local PostgreSQL,
MinIO and JWT values. It refuses to overwrite an existing file. Keep the file private. Alternatively
copy the root example and replace placeholders yourself. Compose and the Development API read
`.env`; API user-secrets, process environment and CLI arguments have higher priority. The launcher
supports `-EnvironmentFile` and does not evaluate shell expressions.
Environment names with `__` map to .NET configuration sections. Root integration categories are
reserved examples, not wired providers; setting an API key alone never enables a provider.

For manual startup, use environment variables or user-secrets:

```powershell
dotnet user-secrets set "ConnectionStrings:Database" "<local connection string>" --project src/backend/BHome.Api
dotnet user-secrets set "Jwt:SigningKey" "<random key at least 32 bytes>" --project src/backend/BHome.Api
dotnet user-secrets set "ObjectStorage:AccessKey" "<local access key>" --project src/backend/BHome.Api
dotnet user-secrets set "ObjectStorage:SecretKey" "<local secret key>" --project src/backend/BHome.Api
dotnet dev-certs https --trust
dotnet run --project src/backend/BHome.Api
```

Replace placeholders before running; avoid shared-terminal history with real credentials. No test
user is seeded. `POST /api/v1/auth/login` verifies an existing Identity email/password and returns
the token needed by the session probe. Owner/Mobile now have login/logout/change-password UI.
Account provisioning/activation remains unimplemented. Configure `AuthWeb:AllowedOrigins` separately
from CORS for the Owner origin; HTTPS/same-site cookie requirements apply (HTTP frontend + HTTPS API
is not a reliable Strict-cookie development topology). Mobile keeps access tokens in memory;
refresh tokens use Expo SecureStore (iOS Keychain / Android secure storage), bound to the API origin.

For manual auth testing only, explicitly run `scripts/New-LocalTestUsers.ps1` to create synthetic
`owner.dev`, `staff.dev`, `tenant.dev` users with a password entered at a secure prompt. This does
not implement production provisioning or create business assignments/contracts. Existing accounts
are never reset or granted additional roles. See [manual Postman/UI steps](MANUAL_AUTH_TESTING.md).
Tests create synthetic accounts only in disposable PostgreSQL containers and
generate isolated signing keys in memory. See [the login contract](../api/API_CONVENTIONS.md#existing-account-login).

## Data services and Compact24 initialization

The supported development schema is **Compact24: 24 physical tables, 386 columns, 83 foreign keys**,
with no EF migration history table. Keep the old migrations/snapshot for legacy source copies;
do not run `dotnet ef database update` against Compact24.

One-time prerequisites: generate your own ignored `.env`, configure its connection for your local
PostgreSQL, and start PostgreSQL (native or Docker). Docker users can run:

```powershell
docker compose config --quiet
docker compose up -d --build
docker compose ps
```

For native PostgreSQL already on port 5432, keep it and start only MinIO if required:
`docker compose up -d --build minio`. Do not start another PostgreSQL on the same port. The role in
`ConnectionStrings__Database` needs database creation rights only if the database is missing,
and permission to create `btree_gist` in its owned database. Each developer uses private credentials.

### Normal startup after pull

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Start-Api.ps1
# Alternative: Development F5, or:
dotnet run --project src/backend/BHome.Api
```

Development startup prepares the schema before hosted workers and HTTP requests. It creates a
missing `bhome`, initializes an empty database, or verifies/reuses a ready Compact24. A session
advisory lock serializes concurrent initializations. Startup never archives, drops or resets data.
Only loopback PostgreSQL and the dedicated `bhome` development database are supported (tests use
an isolated reserved name). Production/Testing startup never performs initialization or loads `.env`.
Set `DevelopmentDatabase__InitializeOnStartup=false` to opt out explicitly.

Development loads repository `.env` as a fallback above appsettings, below user-secrets, process
environment and CLI arguments. The launcher selects exactly its `-EnvironmentFile`. Missing local
configuration still requires the one-time setup; the project does not install/start PostgreSQL for you.
No users, contracts, invoices or shared passwords are automatically seeded. Use
`scripts/New-LocalTestUsers.ps1` once and choose your own password at its hidden prompt.

### Existing legacy database: one-time replacement

Normal startup refuses an existing 70-table schema and explains the one-time command:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Update-LocalDatabase.ps1 -Check
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Update-LocalDatabase.ps1 -RecreateDatabase
```

The explicit replacement recognizes all 70 legacy tables plus migration history. It prepares and
verifies a separate Compact24 database first, disconnects sessions on the selected local `bhome`,
renames the entire old database to `bhome_legacy_<UTC timestamp>_<suffix>`, then renames the new
database to `bhome`. No old table/database is dropped. Old users/data remain in the archive;
new development starts empty. The command is idempotent for an already valid Compact24 and
rejects an unrecognized schema. If the final rename fails, it restores the original name/access;
a prepared temporary database may remain for inspection. No other database is disconnected.

In pgAdmin refresh **PostgreSQL > Databases**, then open **bhome > Schemas > public > Tables**.
The archive is visible separately. Do not import legacy migration history into the new `bhome`.
For data transfer rather than a clean development environment use the controlled offline importer
and reconciliation described in [the database guide](../database/2026-11-03/README.md).

Running `Update-LocalDatabase.ps1` without a switch initializes/verifies without replacing a legacy
database. `-Check` is read-only and reports MISSING/EMPTY/LEGACY_REQUIRES_RECREATE/READY. These
commands accept `-EnvironmentFile` for local overrides and do not change `.env` or connection strings.

## Clients

From root, `npm ci` installs all applications/shared tooling with the committed lockfile. Copy each
web client `.env.example` to its `.env.local`; the web clients use `VITE_API_BASE_URL=https://localhost:7240`.
Mobile đã kết nối backend qua HTTPS; dùng launcher tự chọn mạng, không cấu hình IP riêng:
[hướng dẫn mobile cho team](MOBILE_NETWORK_DEVELOPMENT.md).
Every Vite environment value is visible to the browser. Native device builds need a reachable HTTPS
API address and trusted certificate; a device's `localhost` refers to the device, not the developer PC.

```powershell
npm run dev --workspace @bhome/owner-web
npm.cmd run mobile:dev
npm run dev --workspace @bhome/public-web
```

Web ports are 5173/5175 with strict port selection so CORS matches. Existing dev config permits
these local origins and Capacitor defaults only. Configure exact deployed origins via environment
arrays; do not use wildcard CORS or arbitrary proxy trust. Set `VITE_API_BASE_URL` to the actual
HTTPS endpoint before production builds. The shared client library is source-consumed; Vite bundles
it per app and strict TypeScript also checks it separately.

## Expo mobile

`src/mobile/package.json` dùng Expo SDK 58/React Native và entry `expo-router/entry`, các màn hình
ở `src/mobile/src/app`. Các chỉ dẫn Capacitor và test mobile trên trình duyệt cũ không xác minh
ứng dụng native hiện tại.

From the repository root:

```powershell
npm.cmd run mobile:dev
# Reset Metro's cache if needed:
npm.cmd run mobile:dev -- -Clear
```

Alternatively, run `npx.cmd expo start` from `src/mobile`. Do not run it without a project path at
the repository root: Expo would use the root package instead of the mobile entry point and load
the root backend environment files. Stop that server with Ctrl+C before restarting correctly.

Quét QR bằng Expo Go trên điện thoại cùng mạng. Launcher chọn IP cho API/Metro, tự cập nhật TLS
và restart Metro khi mạng đổi; quét QR mới để điện thoại tải manifest hiện tại. Mỗi máy mới cần
trust CA trên điện thoại một lần. Xem `MOBILE_NETWORK_DEVELOPMENT.md` để biết điều kiện và kiểm chứng.

To verify Android bundling without a device, run from `src/mobile`:

```powershell
npx.cmd expo export --platform android --output-dir ../../.tools/mobile-export-check
npx.cmd tsc --noEmit
```

Run `npm.cmd run lint` at the repository root for the shared lint configuration. Expo caches
(`.expo/`) and the validation export under `.tools/` are ignored by Git.

## Troubleshooting and validation

- SDK not found: `dotnet --list-sdks` must include 8.x; .NET 10 alone does not satisfy `global.json`.
- Docker unavailable: start Docker Desktop's Linux engine. `docker compose config --quiet` validates
  syntax without a daemon. PostgreSQL Testcontainers tests require the daemon.
- API startup failure: provide a database connection and random JWT key. Development initialization
  requires local PostgreSQL to be reachable. Production never initializes schema; readiness reports
  503 until Compact24 is ready. Health checks never modify schema.
- Storage failure: provision the private bucket and correct credentials; no fake success fallback exists.
- Browser network failure: trust the local HTTPS certificate, check exact API URL and CORS origin.
- Background jobs: disabled by default; prepare Compact24, register handlers, and follow the operational guide
  before enabling. Do not diagnose an unimplemented provider as successful delivery.

Use the root README quality commands or `scripts/Validate.ps1`. Add `-IncludeDockerTests` only with
Docker available. CI always runs the container suite on a Linux runner.
