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
copy the root example and replace placeholders yourself. Compose reads `.env`, while the API does
not; `scripts/Start-Api.ps1` loads recognized backend names without evaluating shell expressions.
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
is not a reliable Strict-cookie development topology). Mobile keeps credentials only in memory.

For manual auth testing only, explicitly run `scripts/New-LocalTestUsers.ps1` to create synthetic
`owner.dev`, `staff.dev`, `tenant.dev` users with a password entered at a secure prompt. This does
not implement production provisioning or create business assignments/contracts. Existing accounts
are never reset or granted additional roles. See [manual Postman/UI steps](MANUAL_AUTH_TESTING.md).
Tests create synthetic accounts only in disposable PostgreSQL containers and
generate isolated signing keys in memory. See [the login contract](../api/API_CONVENTIONS.md#existing-account-login).

## Data services and migrations

```powershell
docker compose config --quiet
docker compose up -d --build
docker compose ps
dotnet tool restore
# EF tooling deliberately uses an explicit environment connection, independent of API startup.
$env:ConnectionStrings__Database = '<your local PostgreSQL connection string>'
dotnet ef database update --project src/backend/BHome.Infrastructure --startup-project src/backend/BHome.Api
```

If a native PostgreSQL service already owns port 5432, keep using its configured database and start
only storage with `docker compose up -d --build minio`. Alternatively choose a free `POSTGRES_PORT`
and deliberately update the backend connection string to match. Do not replace/reset an existing
database or volume to resolve a port conflict.

### Native PostgreSQL on this workstation

The native PostgreSQL 18 service on `localhost:5432` has a development database named `bhome`,
owned by `postgres`. Its schema is managed by the repository's EF migrations. The ignored
`.env` (default launcher) and `.env.local` both contain the verified native connection and retain
existing local JWT/storage settings; credentials are not stored in tracked configuration.
The supplied local credential was already present in `.env.local` and was reused without printing it.
These files are workstation-specific. `POSTGRES_*` variables remain Docker Compose configuration;
the API uses `ConnectionStrings__Database`. `.env.compose` remains a separate opt-in Docker database.

On 28 October 2026, the native server reported PostgreSQL **18.6**. The user selected this existing
native installation for Development; the Report 4 baseline remains PostgreSQL 16 and the disposable
automated test suite ran on 16. Native 18.6 migration/readiness smoke checks passed; the entire suite
was not rerun against 18.6. No framework/provider/server version was changed.

Before applying auth migration, a custom-format native database backup was created at ignored
`.tools/auth-audit/bhome-before-auth-migration.dump`. Only initial migration existed; user/job counts
were zero. After `dotnet ef database update --no-build --project src/backend/BHome.Infrastructure
--startup-project src/backend/BHome.Api`, both migrations are applied, all 13 public tables exist,
`AspNetUsers.IsActive` and account/role/audit triggers exist. No application accounts were seeded.

Start the API from the repository root with:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Start-Api.ps1
# Optional explicit selection of the same native database:
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Start-Api.ps1 -EnvironmentFile .env.local
```

The launcher selects the repository's portable .NET 8 SDK when present. The global .NET 10 SDK
alone does not meet `global.json`. Plain `dotnet run` does not load `.env.local`.

For later migration updates, load the same connection explicitly in PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass
. ./scripts/Use-LocalTools.ps1
$connectionLine = Get-Content .env.local | Where-Object { $_ -like 'ConnectionStrings__Database=*' }
$env:ConnectionStrings__Database = $connectionLine.Substring('ConnectionStrings__Database='.Length)
dotnet ef database update --project src/backend/BHome.Infrastructure --startup-project src/backend/BHome.Api
```

In pgAdmin, refresh **PostgreSQL 18 > Databases**, then open
**bhome > Schemas > public > Tables**. Identity roles are seeded by the foundation migration;
application users are not seeded. Storage operations still require MinIO separately.

Verified the real default launcher using Development HTTPS on port 7240: live/ready 200,
anonymous session 401, invalid login input 400. The temporary host was stopped afterwards.
The HTTPS probe bypassed certificate verification only for its loopback curl process; machine trust
was not changed. Cookie/browser HTTPS end-to-end and real account login remain separate checks.

### Previous isolated database on the audit workstation

At the time of the audit, the native service accepted TCP connections on 5432 but rejected the
password configured in the original `.env` (PostgreSQL SQLSTATE `28P01`). Its applied-migration
state was unverified. The audit
left that service, its credentials/data and `.env` untouched. A separate Compose project
`bhome-local-db` now owns a PostgreSQL container on 5433 and its own persistent named volume.
The existing foundation migration was applied there; no users were seeded.

Ignored `.env.compose` is a local copy of `.env` with `POSTGRES_PORT=5433` and a matching backend
connection using the existing Compose database/user/password settings. It contains secrets: never
print or commit it. On another workstation, create this optional file only if absent and configure
matching database/port values deliberately; the file is not distributed in Git.

```powershell
docker compose -p bhome-local-db --env-file .env.compose up -d postgres
# Existing MinIO remains in the original project, with the same storage credentials.
docker compose up -d minio
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Start-Api.ps1 -EnvironmentFile .env.compose
```

The launcher accepts an explicit environment-file path and defaults to `.env`. It does not rewrite
either file. Use the same environment file when exporting `ConnectionStrings__Database` for EF tools;
do not paste the value into shared output. To stop only this additional database while retaining its
volume: `docker compose -p bhome-local-db --env-file .env.compose stop postgres`.

`postgres:16-alpine` persists in a named volume. MinIO builds official pinned community source because
its current distribution is source-only. Its first build downloads Go modules and can be slow.
Use the console at `http://localhost:9001` with your local `.env` credentials to create private bucket
`bhome-private`. The initial helper reuses local root storage credentials for convenience; deployed
APIs require a scoped non-root service account. Changing a configured bucket name requires separately
provisioning that bucket. Never upload real CCCD images as test fixtures.

To add a migration after a coordinated model change:

```powershell
dotnet ef migrations add <DescriptiveName> --project src/backend/BHome.Infrastructure --startup-project src/backend/BHome.Api --output-dir Persistence/Migrations
dotnet ef migrations script --idempotent --project src/backend/BHome.Infrastructure --startup-project src/backend/BHome.Api
```

Review constraints/data changes and apply intentionally. Do not use `EnsureCreated`. Stop the local
services with `docker compose stop`; named volumes persist. No setup script removes volumes or data.

## Clients

From root, `npm ci` installs all applications/shared tooling with the committed lockfile. Copy each
web client `.env.example` to its `.env.local`; the web clients use `VITE_API_BASE_URL=https://localhost:7240`.
The current Expo mobile demo has no backend connection and needs no environment file.
Every Vite environment value is visible to the browser. Native device builds need a reachable HTTPS
API address and trusted certificate; a device's `localhost` refers to the device, not the developer PC.

```powershell
npm run dev --workspace @bhome/owner-web
npm.cmd run mobile
npm run dev --workspace @bhome/public-web
```

Web ports are 5173/5175 with strict port selection so CORS matches. Existing dev config permits
these local origins and Capacitor defaults only. Configure exact deployed origins via environment
arrays; do not use wildcard CORS or arbitrary proxy trust. Set `VITE_API_BASE_URL` to the actual
HTTPS endpoint before production builds. The shared client library is source-consumed; Vite bundles
it per app and strict TypeScript also checks it separately.

## Expo mobile

The current `src/mobile/package.json` uses Expo SDK 58 and React Native. Its entry point is
`src/mobile/index.ts`, which registers `src/mobile/App.tsx`. Older Capacitor instructions and
browser-based mobile tests refer to the previous client and do not validate this Expo demo.

From the repository root:

```powershell
npm.cmd run mobile
# Reset Metro's cache if needed:
npm.cmd run mobile -- --clear
```

Alternatively, run `npx.cmd expo start` from `src/mobile`. Do not run it without a project path at
the repository root: Expo would use the root package instead of the mobile entry point and load
the root backend environment files. Stop that server with Ctrl+C before restarting correctly.

Scan the terminal QR code with a compatible Expo Go version on a device on the same network.
Metro normally uses port 8081; use the address printed in the terminal. This demo currently shows
sample data only. Native device UI and backend authentication require separate verification.

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
- API startup failure: provide a database connection and random JWT key. It does not need PostgreSQL
  to start with jobs disabled; `/health/ready` reports 503 until the database is reachable and all
  application EF migrations are applied. The readiness check never applies migrations itself.
- Storage failure: provision the private bucket and correct credentials; no fake success fallback exists.
- Browser network failure: trust the local HTTPS certificate, check exact API URL and CORS origin.
- Background jobs: disabled by default; migrate, register handlers, and follow the operational guide
  before enabling. Do not diagnose an unimplemented provider as successful delivery.

Use the root README quality commands or `scripts/Validate.ps1`. Add `-IncludeDockerTests` only with
Docker available. CI always runs the container suite on a Linux runner.
