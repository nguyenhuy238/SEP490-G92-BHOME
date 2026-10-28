# Initialization validation

Validation was performed in the working tree on `init/project-setup/QHuy`. No branch switch,
merge, commit or push was performed. The repository initially contained only the original README,
whose project name and description have been preserved.

## Environment

- Machine-wide discovery: .NET SDK 10.0.401; no .NET 8 SDK or ASP.NET Core 8 runtime initially.
- Node/npm were not available on PATH.
- Repository-local, ignored tools were downloaded for validation: .NET SDK 8.0.426 with its
  ASP.NET Core 8 runtime, Node 22.23.4 and npm 10.9.9. No machine-wide software was installed.
- `global.json` selects .NET 8 only. Use `scripts/Use-LocalTools.ps1` on this workstation or
  install .NET 8 through the team's approved process on another workstation.
- Docker CLI 29.7.2 and Compose v5.5.1 are installed; the Docker Linux daemon is not running.
- The local HTTPS development certificate is not yet trusted in the browser.

## Results

| Command/check                                                          | Result  | Evidence/limits                                                                                                                  |
| ---------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `git branch --show-current`, `git status`                              | PASS    | Original branch retained; only working-tree changes.                                                                             |
| `dotnet --info`, `dotnet --list-sdks`                                  | PASS    | Initial discovery and local .NET 8 tooling verified.                                                                             |
| `dotnet restore src/backend/BHome.sln`                                 | PASS    | All seven projects restore.                                                                                                      |
| `dotnet build src/backend/BHome.sln`                                   | PASS    | net8.0, zero warnings/errors.                                                                                                    |
| `dotnet build src/backend/BHome.sln -c Release --no-restore`           | PASS    | Release build verified.                                                                                                          |
| `dotnet test src/backend/BHome.sln --filter "Category!=Docker"`        | PASS    | 21: Domain 1, Application 9, API/architecture 11. No real provider/database required.                                            |
| `dotnet test src/backend/BHome.sln`                                    | FAIL    | 21 pass; two PostgreSQL tests fail because Docker is not running. This is not a successful full integration run.                 |
| `dotnet format src/backend/BHome.sln --verify-no-changes --no-restore` | PASS    | C# formatting validated.                                                                                                         |
| `dotnet tool restore`                                                  | PASS    | Local EF tool 8.0.32.                                                                                                            |
| `dotnet ef migrations add InitialFoundation ...`                       | PASS    | Identity/roles/jobs migration and snapshot generated.                                                                            |
| `dotnet ef migrations has-pending-model-changes ...`                   | PASS    | No model drift.                                                                                                                  |
| `dotnet ef migrations script --idempotent ...`                         | PASS    | PostgreSQL deployment SQL generated into ignored local output.                                                                   |
| `dotnet ef database update ...`                                        | NOT RUN | Requires a running PostgreSQL instance; migration execution awaits Docker.                                                       |
| `npm install`, then clean root `npm ci`                                | PASS    | All client workspaces install from the lockfile.                                                                                 |
| `npm run lint`                                                         | PASS    | Repository JS/TS, shared code and tests checked.                                                                                 |
| `npm test`                                                             | PASS    | Owner 6, Mobile 4, Public 3: 13 tests.                                                                                           |
| `npm run build`                                                        | PASS    | Strict TypeScript and Vite builds for all clients, shared-core type check. Owner bundle has a nonblocking >500 kB chunk warning. |
| `npm run format:check`                                                 | PASS    | Prettier check.                                                                                                                  |
| `npm audit --audit-level=high`                                         | PASS    | Zero reported vulnerabilities after updating tooling and pinning Capacitor 8.4.3.                                                |
| `dotnet list ... package --vulnerable --include-transitive`            | PASS    | No reported vulnerable packages after updating Testcontainers to 4.16.0.                                                         |
| `docker compose --env-file .env.example config --quiet`                | PASS    | Example configuration parses.                                                                                                    |
| `docker compose config --quiet`                                        | PASS    | Generated ignored local `.env` parses; values were not printed.                                                                  |
| `docker info`                                                          | FAIL    | Docker Desktop Linux engine endpoint is unavailable.                                                                             |
| Container builds, Compose startup, private bucket I/O                  | NOT RUN | Daemon unavailable; no existing data/containers were changed.                                                                    |
| Native Android/iOS build, Maestro                                      | NOT RUN | Native projects and business flows intentionally not generated.                                                                  |
| GitHub Actions execution                                               | NOT RUN | Workflow created locally; no commit/push was made.                                                                               |
| API startup through `scripts/Start-Api.ps1`                            | PASS    | Real local Kestrel host started and was stopped after probes.                                                                    |
| HTTPS liveness, anonymous protected probe, Swagger JSON                | PASS    | 200 / 401 / 200 respectively; OpenAPI 3.0.1 document. Probes bypassed certificate trust only for local validation.               |
| Readiness with unavailable local database                              | PASS    | Correctly returns 503; does not pretend readiness.                                                                               |
| `git diff --check`, generated/private-file ignore checks               | PASS    | Local credentials/tools/build output excluded; no secrets staged or committed.                                                   |
| Source scan for unrelated template technologies/names                  | PASS    | No unrelated template artifacts in project sources.                                                                              |

Earlier validation failures were corrected: test-project import paths, strict TS extension imports,
test-host database configuration timing and record validation metadata. Vulnerable development
dependencies were replaced and their audits rerun. The Docker limitation remains visible above.

## Remaining work before infrastructure validation

Start Docker Desktop's Linux engine, run the complete backend test suite, build/start local services,
apply migrations and create the private storage bucket. Trust the development HTTPS certificate.
Real providers/OCR, native projects, session/login/refresh flows, recurrence planning and business
schema/use cases remain intentionally outside this initialization.

## Follow-up audit and authentication slice — 28 October 2026

The initialization results above are historical. The follow-up inspected the clean committed
foundation on `init/project-setup/QHuy` and made the scoped changes documented in
[SPRINT_2_AUDIT.md](SPRINT_2_AUDIT.md). No commit/push or branch change was performed.

| Command/check                 | Result | Evidence/limits                                                                                                                                               |
| ----------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend restore/build         | PASS   | All seven projects; local SDK 8.0.426; zero warnings/errors                                                                                                   |
| Complete backend tests        | PASS   | 57 passed, zero failures/skips: Domain 1, Application 25, API/architecture/PostgreSQL 31                                                                      |
| C# formatting                 | PASS   | `dotnet format ... --verify-no-changes --no-restore` after correcting test whitespace                                                                         |
| EF model drift                | PASS   | No model changes since existing foundation migration; no new migration generated                                                                              |
| Frontend lint/tests/build     | PASS   | 13 tests; all strict TypeScript/Vite builds; existing Owner size warning                                                                                      |
| Docker/Compose                | PASS   | Engine started; default/example/alternate env configurations parse                                                                                            |
| Original native PostgreSQL    | FAIL   | TCP reachable on 5432; configured password rejected with SQLSTATE 28P01; original data/configuration untouched                                                |
| Isolated developer PostgreSQL | PASS   | New `bhome-local-db` project on 5433 with separate volume; uses existing local Compose credentials via ignored `.env.compose`                                 |
| EF database update            | PASS   | Existing foundation migration applied only to the new isolated developer database; direct-driver check: one applied, zero pending                             |
| PostgreSQL tests              | PASS   | Disposable Testcontainers databases; real migrations, readiness before/after migration, durable enqueue, Identity password/role/lockout behavior              |
| MinIO                         | PASS   | Existing container resumed healthy; provisioned missing local private bucket; real adapter upload/download equality, anonymous read 403, probe object deleted |
| API launcher                  | PASS   | `Start-Api.ps1 -EnvironmentFile .env.compose`; default `.env` behavior retained                                                                               |
| Live Kestrel probes           | PASS   | Liveness/readiness 200; protected session 401; invalid login 400; unknown login 401; oversized login 413                                                      |
| Secrets/data/Git              | PASS   | `.env` preserved; `.env.compose`, tools/probe outputs ignored; no developer accounts seeded; no history/remote operations                                     |

The original Docker tests first failed while the engine was stopped. New authentication fixtures
initially failed because required unique emails were missing and account mutations crossed EF scopes;
both fixture issues were corrected. Live Kestrel revealed that the global handler changed body-limit
rejections from 413 to 500; fixed the mapping, added a sanitized-error regression case, and repeated
the affected checks successfully. Initial EF migration-list output was incorrectly interpreted as
proof of native database readiness; the direct-driver/live-host check corrected that finding.

Smoke probes used loopback HTTP with HTTPS redirection disabled only in the temporary process.
Both temporary API hosts were stopped. The HTTPS development certificate remains untrusted; no
machine-wide trust change was made. Docker, existing MinIO and the new development database remain
running. No real OCR/provider, client login UI, provisioning/activation, refresh or business-schema
work is claimed complete. Latest Plan/SRS/SDS are absent; subsequent persistence remains blocked.
