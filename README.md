# SEP490-G92-BHOME

BHOME - Smart Boarding House Chain Management and Operations Platform

Initial development foundation following the BHOME Report 4 architecture. Business use cases,
provider implementations, login workflows, and the finalized business schema are future work.

## Architecture

Three React/TypeScript clients communicate over HTTPS/REST/JSON with one ASP.NET Core **8** API.
The backend follows Controller → Application Service → Data Access → Data, with PostgreSQL,
MinIO/S3 storage, internal OCR, background jobs, and replaceable external provider boundaries.

```text
src/backend/
  BHome.sln
  BHome.Api/             HTTP, authorization, composition, health, OpenAPI
  BHome.Application/     Use cases and application-owned contracts
  BHome.Domain/          Framework-independent domain definitions
  BHome.Infrastructure/  EF/Identity/JWT, storage, jobs, integration adapters
src/owner-web/           React + Vite + Ant Design
src/mobile/              React + Vite + Capacitor (one role-aware app)
src/public-web/          React + Vite, approved public information only
packages/client-core/    Small shared client API/auth/localization foundation
tests/                  Backend and client tests
docs/                   Architecture, development and API guidance
deploy/docker/          Development service and application Dockerfiles
scripts/                Local configuration and validation helpers
.github/workflows/      Pull-request CI, no deployment
```

## Prerequisites

- .NET **8 SDK** (8.0.400 feature band or newer 8.0; `global.json` excludes major upgrades).
- Node.js **22.13+ within 22.x**, npm 10+.
- Docker Desktop with the Linux engine running for data services and container tests.
- A trusted HTTPS development certificate: `dotnet dev-certs https --trust`.

Docker is optional for compilation, client tests, and API foundation tests. Runtime readiness,
migrations against a real database, and PostgreSQL integration tests need PostgreSQL.
On the initialization workstation, ignored `.tools/` contains portable .NET 8 and Node 22;
dot-source `scripts/Use-LocalTools.ps1` to use them in the current PowerShell session.
They are not distributed in Git and no machine-wide installation is performed by repository scripts.

## Local setup

Run commands from the repository root unless a command specifies another directory.

```powershell
dotnet --list-sdks
node --version
npm --version
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Initialize-Local.ps1
docker compose config --quiet
docker compose up -d --build
dotnet restore src/backend/BHome.sln
dotnet tool restore
npm ci
```

The initialization helper creates an ignored `.env` with random local credentials. Alternatively,
copy `.env.example` to `.env` and replace every credential placeholder yourself. Example files
contain no real credentials. `.env` is not automatically read by `dotnet run`.

PostgreSQL binds `localhost:5432`; MinIO API and console bind `localhost:9000` and `localhost:9001`.
Ports can be changed in `.env`. The first MinIO source build can take several minutes.
Create a **private** `bhome-private` bucket using the local console; its root login is in your `.env`.
The storage adapter does not silently create buckets or make them public.

Apply the foundation migration with the connection string from your local environment:

```powershell
# Set ConnectionStrings__Database to the matching value in your ignored .env.
# For example: $env:ConnectionStrings__Database = '<your local connection string>'
dotnet ef database update --project src/backend/BHome.Infrastructure --startup-project src/backend/BHome.Api
```

The migration creates Identity persistence, the three fixed roles, and the durable background-job
table. It creates no users or sample business data. No automatic production migration runs at startup.

Start the API (helper loads backend variables from `.env` into this child process):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Start-Api.ps1
```

API: `https://localhost:7240`, development Swagger: `https://localhost:7240/swagger`,
liveness: `/health/live`, database connectivity: `/health/ready`.
Alternatively configure `.NET user-secrets` and use `dotnet run --project src/backend/BHome.Api`;
see [local development](docs/development/LOCAL_DEVELOPMENT.md).

Create the client environment examples, then start each client in a separate terminal:

```powershell
Copy-Item src/owner-web/.env.example src/owner-web/.env.local
Copy-Item src/mobile/.env.example src/mobile/.env.local
Copy-Item src/public-web/.env.example src/public-web/.env.local
npm run dev --workspace @bhome/owner-web
npm run dev --workspace @bhome/mobile
npm run dev --workspace @bhome/public-web
```

Owner Web uses port **5173**, Mobile browser development **5174**, Public Website **5175**.
Every `VITE_*` value is public browser configuration. Production builds require an explicit HTTPS
`VITE_API_BASE_URL`. No login or demo token is fabricated; protected pages await the identity feature.

## Tests and quality checks

```powershell
dotnet build src/backend/BHome.sln
dotnet test src/backend/BHome.sln --filter "Category!=Docker"
# With Docker running: all tests, including isolated PostgreSQL containers
dotnet test src/backend/BHome.sln
dotnet format src/backend/BHome.sln --verify-no-changes
npm run lint
npm test
npm run build
npm run format:check
docker compose --env-file .env.example config --quiet
```

`npm ci` installs all workspaces using the root lockfile; do not install separately inside each app.
Use `npm run format` and `dotnet format src/backend/BHome.sln` to apply formatting.
On Windows, `scripts/Validate.ps1` runs these gates; `-IncludeDockerTests` includes container tests.
See [validation results](docs/development/VALIDATION.md) for the actual initialization run and limitations.

## Team documentation

- [Architecture and decisions](docs/architecture/ARCHITECTURE.md)
- [Module ownership and feature placement](docs/architecture/MODULES.md)
- [API conventions](docs/api/API_CONVENTIONS.md)
- [Local development and mobile setup](docs/development/LOCAL_DEVELOPMENT.md)
- [Reliability and job operations](docs/development/BACKGROUND_JOBS.md)
- [Deployment boundaries](deploy/docker/README.md)
- [Contribution workflow](CONTRIBUTING.md)
