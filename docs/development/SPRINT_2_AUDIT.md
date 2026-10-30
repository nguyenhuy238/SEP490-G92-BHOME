# Repository audit and authentication slice — 28 October 2026

> Login identifier and JWT lifetime decisions in this historical audit are superseded by
> [JWT email authentication](JWT_EMAIL_AUTHENTICATION.md). Other evidence retains its original scope.

This records inspection of the actual working tree before source changes, followed by the scoped
setup fixes and existing-account login slice. Dates and Sprint scope below come from the supplied
task: Sprint 1 was 12–25 October; Sprint 2 is 26 October–8 November; Sprint 3 is 9–22 November 2026.

## Git and requirement sources

- Root: `C:\Users\Admin\Documents\KLTN_FALL2026\BHome_Project\SEP490-G92-BHOME`.
- Branch: `init/project-setup/QHuy`; initially clean and matching its remote-tracking branch.
- Other local branches: `main`, `develop`. Baseline commit: `f426b9b`.
- No branch switching, fetching, pulling, merging, rebasing, resetting, committing or pushing.
- No `AGENTS.md` found in the repository or checked parent project directories.
- Available requirements: README, architecture/module/API notes and development/deployment guidance.
  They reference Report 4 and a future finalized SRS/data model. The actual Project Plan, SRS,
  SDS/SDD and Report 4 are absent, including searches for Office/PDF requirement files.
- Consequently, latest-version selection and Plan/SRS/SDS agreement cannot be verified. The supplied
  UC list is provisional timing context, not a substitute for detailed SRS business rules.
- Correction to the first commentary audit: native PostgreSQL was TCP-reachable, but the later
  live-host/direct-driver check rejected the configured password (`28P01`). EF migration listing can
  exit zero even when connectivity fails, so its output did not prove the foundation migration was
  applied. Native database contents/migration state remain unverified. The table below reflects the
  corrected finding; successful migration/readiness verification used the isolated database.

## Initial audit, before changes

| Area                          | Expected                                | Actual State                                                                  | Status  | Evidence                                                               | Required Action                                               |
| ----------------------------- | --------------------------------------- | ----------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------- | ------------------------------------------------------------- |
| Git                           | Preserve work/branch                    | Clean on setup branch                                                         | READY   | Actual branch/status/log                                               | Keep branch and history                                       |
| Backend projects              | Four layers, valid references           | Four source projects and three test projects; correct dependency direction    | READY   | Solution, all project files, architecture tests                        | Reuse layers                                                  |
| Restore/build                 | Working .NET 8                          | Restore/build pass, zero warnings/errors with local SDK 8.0.426               | READY   | Actual commands                                                        | Use local tools or installed .NET 8                           |
| Configuration/DI              | Bound options and registrations         | Database/JWT startup validation, Identity, adapters and API composition wired | READY   | `DependencyInjection.cs`, `Program.cs`, `ApiFoundation.cs`             | Extend existing registrations                                 |
| Middleware/validation/logging | Safe API responses                      | Correlation, structured logs, sanitized ProblemDetails, DataAnnotations       | READY   | Middleware/controller/test source and passing tests                    | Follow existing conventions                                   |
| Authentication                | Usable credential-verified sign-in      | Identity persistence, password/lockout settings and JWT exist; no login       | PARTIAL | Identity/JWT source; session probe only                                | Add existing-account login                                    |
| Authorization                 | Roles and resource ownership            | Role policies and scope helper exist; Staff assignment always denies          | PARTIAL | `ResourceAccess`, assignment adapter, nine tests                       | Confirm assignment schema before enabling                     |
| PostgreSQL                    | Reachable configured database           | Native service on localhost:5432; configured password rejected                | BROKEN  | TCP/process probe; direct-driver SQLSTATE 28P01                        | Preserve native service; use isolated development database    |
| EF/migrations                 | Model/schema aligned                    | Foundation migration exists; no model drift; native applied state unverified  | PARTIAL | Context, configurations, migration/snapshot; direct connection failure | Apply existing migration to verified local development target |
| Readiness                     | Reject unmigrated database              | Connectivity-only check can report healthy with pending migrations            | PARTIAL | `DatabaseHealthCheck.cs`                                               | Check pending migrations                                      |
| MinIO                         | Private bucket and real I/O             | Adapter implemented; port 9000 initially unavailable                          | BLOCKED | Inspected adapter; TCP probe                                           | Start runtime and verify bucket/I/O                           |
| Compose                       | Valid development environment           | Both env configurations parse; Docker Linux engine stopped                    | BLOCKED | Compose config succeeds; Docker API fails                              | Start engine, preserve volumes                                |
| OCR/provider integrations     | Real external functionality             | Contracts exist; adapters explicitly throw unavailable                        | PARTIAL | `IOcrService`, integration interfaces/adapters                         | Select engines/providers before implementing                  |
| Background jobs               | Durable execution foundation            | Queue, unique enqueue, lease/retry worker implemented; disabled, no handlers  | PARTIAL | Queue/worker/EF code                                                   | Add handlers with confirmed workflows                         |
| Frontends                     | Buildable usable workflows              | Three React/TS scaffolds; routes/API/memory auth; no login/business screens   | PARTIAL | Opened source; lint, 13 tests, builds pass                             | Add UI with supported workflows                               |
| Tests                         | Unit/API/real persistence coverage      | 21 backend tests pass; two container tests fail without Docker                | PARTIAL | Actual test runs                                                       | Restore Docker and run full suite                             |
| Requirement documents         | Authoritative detailed rules/schema     | Plan/SRS/SDS absent                                                           | MISSING | File searches and tracked documents                                    | Obtain authoritative versions                                 |
| Business modules              | Sprint 1 baseline and Sprint 2 progress | No implemented business workflows                                             | MISSING | Opened source, not filename inference                                  | Select one supported dependency                               |

## What the source actually implements

**IMPLEMENTED:** four backend projects, Identity tables, three seeded roles, JWT issuer/validator,
authenticated session probe, role policies, application resource-scope decisions, EF/Npgsql context,
foundation migration, private-object storage adapter, durable job queue/worker, error/validation
foundation, health endpoints, shared client API/auth/localization and route guards, test projects/CI.
The MinIO adapter performs real SDK calls; its presence alone did not prove runtime connectivity.

**PARTIALLY IMPLEMENTED:** authentication had no credential workflow; Staff access has no authoritative
assignment lookup; clients have no login UI; jobs have no business handlers. OCR, bank, notification
and electronic-contract contracts have explicit unavailable adapters, not working provider behavior.

**DOCUMENTED ONLY:** future module placement and architecture guidance for property, staff operations,
tenancy/contracts, billing, payments/debt, maintenance, finance, notifications and public projections.
No documented business table was assumed to exist.

**NOT IMPLEMENTED:** staff accounts/employment/location assignment workflows, locations, room types,
rooms, tenant/co-occupant onboarding and activation, holding/tenancy contracts, shifts/tasks,
handover/residence, meter readings, invoices, reconciliation/debt/adjustments/history and finance.
Frontend dashboard and Owner/Staff/Tenant pages are shells with placeholder text, not workflows.

### Persistence and infrastructure details

`BHomeDbContext` derives from Identity's EF context. The only additional persisted entity is
`BackgroundJobRecord`, configured through `BackgroundJobConfiguration` and discovered with
`ApplyConfigurationsFromAssembly`. Identity owns its standard user/role/claim/login/token relationships.
The single `20261022164301_InitialFoundation` migration creates those tables, the job table and three
roles. There are no property, assignment, contract, meter, invoice or payment entities/relationships.
There is no automatic startup migration or `EnsureCreated`.

Compose defines PostgreSQL 16 and a source-built pinned MinIO image, loopback ports, persistent named
volumes, credentials from ignored `.env`, and service health checks. Example/local config validation
used `--quiet`; secrets were never printed. The existing native PostgreSQL service already owns 5432,
so starting the Compose PostgreSQL service on that same port would conflict. It was left untouched.

Clients use npm workspaces, strict TypeScript, Vite, shared API URL validation, memory-only sessions
and role routing. Owner uses Ant Design; Mobile has Capacitor configuration but no native projects;
Public is an information-only shell. Production builds require an explicit HTTPS API URL. Existing
Owner bundle size warning is nonblocking. No frontend source change was needed for this backend slice.

## Setup changes and final runtime state

1. Readiness now requires database connectivity and no pending application EF migrations. It does
   not apply migrations. Added an unavailable-database API test and extended the isolated PostgreSQL
   test to assert 503 before migration and 200 after applying the existing migration.
2. Started the installed Docker Desktop engine. The existing MinIO container resumed healthy;
   no container/volume recreation or deletion was needed.
3. The configured local storage bucket was missing. Provisioned it with default private access,
   uploaded/downloaded a small synthetic object through the real `IObjectStorage` adapter, checked
   byte equality and anonymous HTTP 403, then deleted only that probe object. Credentials stayed in
   process configuration. The throwaway verification helper lives under ignored `.tools/`.
4. Native PostgreSQL rejects `.env` credentials. Created ignored `.env.compose`, preserving `.env`,
   with a matching connection/Compose port 5433 using the existing local Compose credentials. Started
   project `bhome-local-db` with its own PostgreSQL container/volume and applied only the existing
   foundation migration. Direct-driver verification: one applied migration, zero pending. Container
   tests use disposable separate databases; no accounts/fixtures were added to either developer database.
5. Added `Start-Api.ps1 -EnvironmentFile` for explicit selection of the alternate local configuration.
   The default remains `.env`; the launcher was verified against the isolated migrated database.
6. Added the verified existing-account login slice described below. No dependency/package changes.
7. The live Kestrel body-limit probe exposed a global-handler bug: a 413 request rejection was mapped
   to 500. Preserve safe HTTP request-error statuses and sanitized titles; added a regression case and
   verified an oversized real login request now returns 413.

## Sprint comparison and feature selection

The supplied Sprint 1 expectations are carry-over: functional authentication was partial; all other
listed business baselines are absent. Do not implement every carry-over at once. Location/room and
staff assignment are the next persistence dependencies, but their schemas are not confirmed.

| Priority | UC                              | Feature                          | Dependency Ready? | DB Ready?          | Implementation Ready? | Reason                                                                             |
| -------- | ------------------------------- | -------------------------------- | ----------------- | ------------------ | --------------------- | ---------------------------------------------------------------------------------- |
| 1        | Sprint 1 auth; ID unavailable   | Existing-account login           | Yes               | Existing Identity  | IMPLEMENT NOW         | Repository explicitly requires verified credentials, lockout, stored roles and JWT |
| 2        | Sprint 1; IDs unavailable       | Locations/rooms/staff assignment | No                | No confirmed model | BLOCKED BY DB         | Prerequisite for scoped operations                                                 |
| 3        | UC-09                           | Staff shifts                     | No                | No                 | BLOCKED BY DEPENDENCY | Employment and assignment absent                                                   |
| 4        | UC-10–12                        | Operational tasks                | No                | No                 | BLOCKED BY DEPENDENCY | Property/assignment/task rules absent                                              |
| 5        | UC-20                           | Meter capture/confirmation       | No                | No                 | BLOCKED BY DB         | No Room/Meter/Task/Reading model; OCR unavailable                                  |
| 6        | UC-17–18                        | Handover/residence               | No                | No                 | BLOCKED BY DEPENDENCY | Tenant/contract baseline absent                                                    |
| 7        | UC-16, UC-19                    | Contract addendum/lifecycle      | No                | No                 | BLOCKED BY DEPENDENCY | Contracts and transition rules absent                                              |
| 8        | UC-21                           | Invoices                         | No                | No                 | BLOCKED BY DEPENDENCY | Readings and billing rules absent                                                  |
| 9        | UC-22–25                        | Payment/debt/adjustment/history  | No                | No                 | BLOCKED BY DEPENDENCY | Invoice model/provider contract absent                                             |
| 10       | UC-31                           | Investment/expense baseline      | Unverified        | No                 | BLOCKED BY DB         | Current SRS and Sprint mapping missing                                             |
| 11       | UC-26–30; advanced/public scope | Later Sprint work                | No                | No                 | DEFER TO LATER SPRINT | Supplied Sprint priorities                                                         |

No complete Sprint 2 persistence slice is safe today. Adding empty DTO/service/repository modules
without detailed behavior would not advance a verified workflow. UC-20 persistence is explicitly
**BLOCKED BY DATABASE DESIGN**; no invoice functionality was folded into it.

## Implemented feature: existing-account login

### Requirement

This is a Sprint 1 authentication dependency, not a claim of completing an absent numbered SRS UC.
The behavior is supported by the existing architecture's Identity/JWT rules and the supplied setup
priority. It uses current Identity `UserName`; final SRS login identifiers/activation rules remain open.

- Actor: existing account holder with a supported persisted Owner, Staff or Tenant role.
- Preconditions: migrated reachable Identity database and configured JWT key/issuer/audience.
- Flow: validate bounded required input; verify password using Identity with failed-attempt lockout;
  retrieve stored roles; validate/deduplicate roles; issue JWT; return session DTO with expiry.
- Alternatives: malformed input gives 400; unknown/wrong/locked accounts, missing/unsupported roles
  or unsupported second-factor requirements give the same generic 401. Unavailable infrastructure
  remains a sanitized server error. Cancellation prevents subsequent token issuance.
- Postcondition: caller can authenticate the existing session probe with Bearer authorization.
- Authorization: clients cannot select roles. Login grants no Location/tenancy access by itself;
  existing server-side resource checks remain mandatory. Staff assignment still fails closed.

### Files changed and purpose

| File                                                                                                                     | Purpose                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `src/backend/BHome.Api/Controllers/IdentityAccess/AuthController.cs`                                                     | HTTP login/input DTO, anonymous entry, validation, generic denial, no-store response                     |
| `src/backend/BHome.Application/IdentityAccess/LoginService.cs`                                                           | Input/verified-identity checks, stored-role validation, token orchestration/session DTO                  |
| `src/backend/BHome.Application/IdentityAccess/ICredentialVerifier.cs`                                                    | Application-owned credential verification port and verified-identity DTO                                 |
| `src/backend/BHome.Infrastructure/IdentityAccess/IdentityCredentialVerifier.cs`                                          | Existing Identity/EF verification, lockout, role lookup, second-factor denial                            |
| `src/backend/BHome.Infrastructure/DependencyInjection.cs`                                                                | Register verifier and application login service                                                          |
| `src/backend/BHome.Api/Configuration/DatabaseHealthCheck.cs`                                                             | Reject pending migrations during readiness                                                               |
| `src/backend/BHome.Api/Middleware/ApiExceptionHandler.cs`                                                                | Preserve safe request-error statuses, including 413, without exposing exception details                  |
| `scripts/Start-Api.ps1`                                                                                                  | Allow explicit environment-file selection without rewriting local configuration                          |
| `tests/backend/BHome.Application.UnitTests/IdentityAccess/LoginServiceTests.cs`                                          | 16 new service cases: normal/invalid/denied/cancellation behavior                                        |
| `tests/backend/BHome.IntegrationTests/LoginApiTests.cs`                                                                  | Six API validation/generic-error/cache/correlation cases                                                 |
| `tests/backend/BHome.IntegrationTests/PostgresAuthenticationTests.cs`                                                    | Ten real PostgreSQL cases: three roles, stored-role enforcement, failures, lockout, second-factor denial |
| `tests/backend/BHome.IntegrationTests/ApiFoundationTests.cs`                                                             | Add unavailable-database readiness case                                                                  |
| `tests/backend/BHome.IntegrationTests/PostgresFoundationTests.cs`                                                        | Assert readiness before/after applying migration; retain durable enqueue check                           |
| `tests/backend/BHome.IntegrationTests/TestProbeController.cs`                                                            | Test-only oversized-request exception probe, verified by the existing sanitized-error theory             |
| `README.md`, `docs/api/API_CONVENTIONS.md`, `docs/architecture/ARCHITECTURE.md`, `docs/development/LOCAL_DEVELOPMENT.md` | Current API/setup behavior and limits                                                                    |
| `docs/development/VALIDATION.md`, this report                                                                            | Follow-up verification, initial audit, selection and blockers                                            |

### Database

No entities, tables, foreign keys, migrations or snapshots changed. Login uses existing Identity
persistence and updates existing failed-attempt/lockout fields through Identity. There is no generic
repository wrapper or second identity implementation. No permanent test accounts were provisioned.

### API

- Added `POST /api/v1/auth/login` with required `userName`/`password`.
- HTTP 200: `userId`, authoritative `roles`, `accessToken`, `expiresAt`; no-store/no-cache headers.
- HTTP 400: validation ProblemDetails. HTTP 401: generic `Sign-in failed.` ProblemDetails.
- HTTP 413: Kestrel body-size rejection, preserved by the global handler with a sanitized title.
- Existing `GET /api/v1/session` retained. `/health/ready` now checks pending migrations.
- Detailed limits and deferred behavior are in [API conventions](../api/API_CONVENTIONS.md#existing-account-login).

### Tests and verification

- Backend build: zero warnings/errors. Complete backend suite: **57 passed, zero failed/skipped**
  (Domain 1, Application 25, API/architecture/PostgreSQL 31).
- The new fixture initially failed because required unique emails were absent, then because account
  mutations used detached instances across scopes. Corrected fixture setup; the complete suite passed.
- Frontend audit: lint, all **13 tests**, strict TypeScript and all builds passed. No frontend changed.
- Docker engine available; real PostgreSQL migration/readiness and login tests ran successfully.
- MinIO authenticated upload/download/delete and anonymous-read denial passed against local storage.
- Live launcher/Kestrel on the isolated migrated database: liveness/readiness 200, protected session
  401, invalid login 400, unknown-account login 401, oversized login 413. Temporary API hosts stopped.
- Formatting, final build/configuration and model-drift verification are recorded in the dated
  follow-up in [VALIDATION.md](VALIDATION.md).

### Remaining work

Obtain the latest Project Plan, SRS and SDS/SDD. Confirm account provisioning/tenant activation and
the Location/Room/Staff assignment model before persisting those workflows. Login UI, refresh/revocation,
recovery and second-factor challenges are not implemented; no real provider/OCR engine is configured.
JWT role changes retain the pre-existing expiry/revocation limitation. Generic login errors are not
a constant-time account-discovery guarantee. Local storage credentials are not production credentials.
Native PostgreSQL password alignment is unresolved; use the explicit isolated-database configuration.
The local HTTPS development certificate still needs user trust; smoke probes used loopback HTTP with
redirection disabled only in the temporary process. No machine-wide certificate policy was changed.

### Next recommended feature

Confirm and implement the minimal Location/Room and Staff Location assignment dependency, following
the actual SRS. Then implement assigned operational tasks; reassess UC-20 only when Room, Meter,
task assignment, previous confirmed reading and OCR/evidence requirements are supported. Do not add
the full meter/invoice/payment schema to bypass these blockers.
