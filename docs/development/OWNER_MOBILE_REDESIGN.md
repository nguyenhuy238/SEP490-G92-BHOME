# Owner Mobile redesign — 14 November 2026

## Scope and traceability

The approved task is the supplied Complete Owner Mobile UX/UI Redesign request. Owner Web remains the management channel; mobile monitors and offers existing server-authorized quick decisions. Backend contracts, permissions and persistence are unchanged.

| Behavior                               | Requirements                                               | Implementation boundary                                     | Acceptance                                                                  |
| -------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------- |
| Four tabs, profile and secure routing  | GBR-01..03; FE-07; Report 4 client boundary                | navigation, WorkspaceShell, existing ProfileScreen          | Correct tabs per role; restricted links never mount financial admin         |
| Live overview with cached counts/debt  | BF-01, BF-06, FE-08; GBR-10                                | OwnerOverviewScreen, existing count/debt APIs               | No invented zeros on errors; pull refresh; cached tab return                |
| Unified real attention items           | BF-02, BF-03/04, BF-07; UC-13..19, UC-26..30; GBR-04,11,12 | OwnerApprovalQueue, existing signing/task/work-order detail | Empty categories hidden; state-gated actions; server result refreshes queue |
| Monitor operations and verify outcomes | BF-02, BF-07; GBR-01,11,12,18                              | Operations list and existing task/incident adapters         | Paginated scope/status filters; no Staff execution or task creation         |

Source inspection: root/mobile AGENTS.md, current SRS original in docs/reports, implemented ASP.NET controllers/DTOs, mobile services and regression suites. No policy changes to payments, official residence, signing provider or occupancy are authorized. Existing signing logic is preserved.

Existing discrepancy: the current code also supports INTERNAL_OTP_DRAWN signing, while root AGENTS.md cites the external-provider SRS baseline. This task explicitly requires preserving working signing; it neither adds an internal signing implementation nor resolves that separate policy discrepancy.

## Plan

1. Shared navigation, UI foundation and mobile channel boundary.
2. Concise live overview and cached monitoring.
3. Unified attention queue and supported decisions.
4. Operations/account and remaining route cleanup.
5. Cross-screen regression tests and local CI-equivalent verification.

Use one Conventional Commit per completed phase. Never push, merge or deploy as part of this task.

## Visual reference

Operate mode; preserve actual Staff/Tenant visual vocabulary: WorkspaceShell, WorkspaceTabBar, DashboardKit, ProfileScreen, Inter fonts and staffColors. Navy header, pale background, white rounded surfaces, blue selection and restrained semantic status colors. No new visual system or dependencies. Initial skeletons, recoverable errors, useful empty states and native pull-to-refresh are required. Preserve real content and back-navigation context.

## Verification

Results are recorded after commands execute. Native device, live provider and remote CI verification must be distinguished from jsdom tests and Expo exports.

### Phases 1–2

- Phase 1: mobile typecheck/lint passed; navigation suites passed 50 tests. Owner debug shortcut removed; financial administration deep links render Web guidance.
- Phase 2: four live compact KPIs, capped attention preview and three operational records; no refresh-button wall. Reuses session-scoped cache and pull refresh. Attention sources are shared between Overview and the forthcoming Attention list. Tasks are in the server's due-date order; the UI makes no chronological activity-feed claim.
- Phase 2 checks: mobile typecheck passed; lint on changed files passed; 40 connectivity/cache tests passed. New coverage proves seven shared attention reads, no repeated fetch on immediate remount, invalidation after verified server mutation and no Owner fetches for Staff/Tenant.
- Dependency install passed with Node 22.23.4/npm 10.9.9. An initial install used the machine's default Node 24 and warned about engine mismatch; installation was repeated successfully under the required Node 22. PowerShell blocks npm.ps1, so commands use npm.cmd.

### Phase 3

- Attention now renders real records in a single paginated queue, with emergency awareness distinct from decisions, nonempty category filters, location/room labels and meaningful date labels. Draft authoring, bank reconciliation and invoice adjustments are excluded.
- Existing maintenance adapter/forms now permit only plan-decision, verify and rework on the server-supported states. Staff execution, assignment and cancellation are excluded from Owner Mobile quick decisions. Confirmation dialog, busy lock, idempotency key and existing error/success feedback are retained.
- Passed mobile typecheck, changed-file lint and 54 tests across attention, incident integration and preserved Owner signing flows. Coverage includes real filtered API paths/totals, role isolation, pagination, empty/error recovery, decision state gates and the confirmation-to-versioned-request flow.

### Phase 4

- Operations uses server pagination, Location/status filtering and distinct incident/emergency/maintenance/task/contract lists. Staff names and place labels resolve through authorized existing lookups. Legacy operational section links open this same monitoring UI.
- Owner task details retain verification, rework and coordination with confirmation; assignment/edit/cancel and Staff execution are excluded. Owner incident details use cached queries, recoverable data states and human-readable Staff labels; diagnostic UUID/version disclosures are hidden for Owner.
- Account reuses the existing shared ProfileScreen, ProfileEditScreen and AccountSecurityScreen; no extra management shortcuts were added.
- Root navigation prevents Owner from entering legacy setup/capture/identity/resident/meter/debug routes. Contract creation, persisted draft editing, renewal/conversion authoring, detailed finance and deposit reconciliation are Web workflows. Contract signing, server-gated activation and operational outcome confirmation remain available. Bank/deposit service authority is unchanged.
- Mobile suite passed 104 files / 1,150 tests after updating affected UI mocks and the new confirmation flow. An additional 55 contract/signing/allocation tests passed after the final finance boundary cleanup. Typecheck and relevant lint passed. Original failures (old authoring expectations, missing mock exports and one stale list import) were fixed without suppressions or weakening business tests.

## Phase 5 — final verification

### Result and implementation limits

The four Owner tabs use live service adapters, session-scoped cache and shared Staff/Tenant surfaces. Attention distinguishes emergency awareness from decisions. Operations supports server-side Location/status filtering and pagination. Existing signing, server-gated activation, task verification/rework/coordination and maintenance plan/verification/rework remain available. Account uses the existing shared profile/edit/security/logout workflows.

Web-only mobile entry points include configuration, task authoring/assignment, full contract/draft/renewal authoring, bank/deposit reconciliation, invoice adjustments, detailed finance and announcement management. Legacy links either render useful Web guidance or use the unified operations view; Owner backend authority is unchanged. Owner cannot enter the legacy setup/capture/identity/resident/meter/debug routes.

Final stabilization adds malformed-page validation, complete compact money display, three overview count requests instead of five, location labels within records, hidden inactive Owner pages for accessibility, manual pull refresh for all maintenance/incident detail sections and regression coverage for duplicate verification submission and server failure. No backend endpoint, DTO, migration, provider or business policy changed.

The fresh finish reviewer scored the two listed findings **resolved**: Owner emergency label contrast and 48px filter/action targets. Browser assertions measure both. The documenter confirmed the actual existing Staff/Tenant system; it made no new design files or token changes. These conclusions are scoped to source and synthetic Expo web evidence, not native-device certification.

### Dependency changes

`expo install --check` initially failed because the installed SDK 58 packages were behind their compatible patch versions. `expo install --fix` updated within SDK 58, synchronized the existing sharing/status-bar config plugins and lockfile; a fresh Node 22 `npm ci` and compatibility check passed. No new application library or state/networking framework was introduced. A non-forced `npm audit fix` also applied compatible lockfile repairs.

### Executed checks

Node 22.23.4 / npm 10.9.9 on Windows, .NET 8; CI uses Ubuntu 24.04. Commands below use `npm.cmd` / `npx.cmd` because local PowerShell policy blocks the `.ps1` launchers. Logs/artifacts are ignored under `.tools/owner-redesign-20261114/`.

| Command/check                                                                                                       | Executed result                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm ci --no-fund --no-audit` after final lockfile update                                                           | PASS, 897 packages installed                                                                                                                                                                      |
| `npm run lint`                                                                                                      | PASS, zero warnings/errors; final source checked                                                                                                                                                  |
| `npm run typecheck --workspace ./src/mobile`                                                                        | PASS                                                                                                                                                                                              |
| `npm test`                                                                                                          | PASS: Owner Web 86 files / 521 tests; Mobile 105 files / 1,159 tests at that stage                                                                                                                |
| Final `npm run test --workspace ./src/mobile -- --reporter=dot`                                                     | PASS: 105 files / 1,161 tests, including the last refresh/empty-scope regressions                                                                                                                 |
| `npm run build`                                                                                                     | PASS for the configured workspaces                                                                                                                                                                |
| `npx --no-install expo export --platform web --max-workers 2 --output-dir dist`                                     | PASS on final stable source, with dotenv disabled and example.invalid API                                                                                                                         |
| `npx --no-install expo export --platform all --max-workers 2 ...`                                                   | PASS: Web plus Android/iOS Hermes bundles; not APK/AAB/IPA builds                                                                                                                                 |
| `npx --no-install expo config --type public` and `expo install --check`                                             | PASS; dependencies up to date                                                                                                                                                                     |
| `node tests/mobile/owner-mobile.browser.cjs` with `BHOME_MOBILE_WEB_DIST` pointing to the final export              | PASS: 360/390/768px, four tabs, shared reads, full debt amount, >=48px targets, >=4.5 text contrast, versioned task verify/plan decision, queue refresh, zero page errors or unexpected endpoints |
| Two Docker Compose config checks from `.github/workflows/ci.yml`                                                    | PASS                                                                                                                                                                                              |
| `dotnet restore src/backend/BHome.sln`                                                                              | PASS                                                                                                                                                                                              |
| `dotnet build src/backend/BHome.sln -c Release --no-restore`                                                        | PASS, zero warnings/errors                                                                                                                                                                        |
| Docker builds for CI MinIO and ContractConverter images                                                             | PASS                                                                                                                                                                                              |
| `dotnet test src/backend/BHome.sln -c Release --no-build --settings tests/backend/ci.runsettings --logger trx -m:1` | PASS: Application 494, Domain 110, Integration 1,056; 23 integration cases SKIPPED                                                                                                                |
| `dotnet format src/backend/BHome.sln --verify-no-changes --no-restore`                                              | PASS                                                                                                                                                                                              |
| `scripts/Test-SePaySandboxScripts.ps1`                                                                              | PASS                                                                                                                                                                                              |
| DigitalSigning unit suite with CI runsettings                                                                       | PASS: 41 tests                                                                                                                                                                                    |
| `npm run format:check`                                                                                              | PASS; final documented source tree                                                                                                                                                                |

The disposable integration PostgreSQL used synthetic credentials, sanitized statement logging and was removed by the verification script. No production data or identity images were used. The existing prepush evidence and SQL file open in the IDE were not changed.

One intermediate web export failed because formatting rewrote a source file while Metro read it. The source was stabilized, then both the exact CI web export and all-platform export were rerun successfully. Browser harness selector failures were corrected to distinguish active screens and Paper confirmation content; final assertions were retained and expanded. No lint/type/test suppression was added.

### Remaining verification and security findings

- Optional `npm audit` is **not clean**: 9 moderate findings remain after compatible repairs, associated with minimatch and dependent Expo/TypeScript ESLint tooling. The current automatic force repair proposes breaking downgrades, including Expo SDK 52. No force downgrade or unverified transitive major override was applied. See [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) and the saved audit logs. Audit is not a configured CI gate; its finding is still unresolved.
- The 23 skipped integration cases require optional OCR models, browser/provider or real-mail environment conditions. They are not reported as passes.
- Android/iOS device execution, font scaling, gestures, camera/storage behavior and live bank/signing-provider flows are **NOT RUN** in this task. No adb/emulator was available. Exports and synthetic web tests do not replace these checks.
- Remote GitHub Actions is **NOT RUN**: no connected GitHub workflow/CLI was available, and no push was authorized. Local CI-equivalent results do not establish remote CI success.
- No push, merge or deployment was performed. The original internal-signing/SRS discrepancy remains outside this UI change.

### Changed areas

Navigation: root/mobile layout, navigation map, WorkspaceScreenView and WorkspaceShell. Presentation: DashboardKit, WorkspaceKit and OwnerMobileKit (optional Owner overrides preserve Staff/Tenant defaults). Owner: Overview/Operations, unified attention source/hook/queue, place/Staff labels and query policy. Existing contract/task/incident UI: mobile channel guards, cached detail data, confirmed quick actions and refresh. Compatibility: mobile package/app config and root lockfile. Tests: Owner navigation, dashboard cache, queue, operations, malformed pages, contracts, incident/task integration, connectivity and the synthetic browser runner. The final delivery report includes the complete Git changed-file list and five phase commits.
