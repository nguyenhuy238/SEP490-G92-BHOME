# Owner Compact Operations Workspace — phases 0–6

## Scope and design

The approved reference screens (chain dashboard, Location list and shared template library) establish the Owner portal's compact operations style. `src/owner-web/DESIGN.md` is the durable design reference. The implementation uses the existing React/MUI components and query layer, not a new UI framework or a change to the business API. The earlier BF01 record is in `BF01_COMPACT_WORKSPACE_2026-11-13.md`.

| Phase | Implemented scope                                                                                                                                                                                                                                                                                                                   |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | Inventory, compact reference layout and interaction standards.                                                                                                                                                                                                                                                                      |
| 1     | Shared theme, AppShell, PageHeader, KPIGrid, OwnerTable, feedback states, status and navigation conventions.                                                                                                                                                                                                                        |
| 2     | Location list, live chain/location dashboards and five shared configuration resources; real room-state distribution, exact amounts and visible contextual actions.                                                                                                                                                                  |
| 3     | Template detail/editor, preview and confirmed application, independent selected copy groups, stale-preview handling and responsive forms.                                                                                                                                                                                           |
| 4     | Seven-step initial Location setup, published-library selection, draft restoration, fee methods, validation and review.                                                                                                                                                                                                              |
| 5     | Location rooms, room types, assets, prices, policies, history, settings, investment; Owner assignments/tasks, contracts/signing, meters, billing/invoices, automation, adjustments, payments/debt, reports/what-if, notifications, profile and public-content surfaces. Other existing Owner routes inherit the shared shell/theme. |
| 6     | Accessibility and responsive smoke coverage, regression tests, repository-wide CI checks and branch review.                                                                                                                                                                                                                         |

The actual initial setup order is Information → Room types → Rooms → Assets and amenities → Fees → Policies → Review. All five shared resources remain available for explicit selection; only confirmed server operations persist configuration. Signed rental amounts, immutable price snapshots, exact decimal input and effective dates are preserved. Version metadata remains available where necessary for details and optimistic concurrency, but does not clutter routine lists.

## Backend regression repairs identified by CI

- Normalize whole-VND representative signed rent in the fixed-charge fingerprint. The signed amount is stored with scale 0 and the invoice rate with scale 4; equivalent decimal values must not falsely indicate a changed policy. A genuine amount change or signed snapshot hash change is still rejected. A regression test covers these cases and duplicate-charge prevention.
- The schema upgrade test now verifies the EF migration list, pending count, and required migration IDs, including `20261113000100_PersonMonthlyServiceFees`.
- The fixed-charge integration test reads `PersonDays` using the documented JSON number-as-string contract and retains its numerical business assertions.

No new migration or production data rewrite is introduced by this work. The known malformed RENT display label is normalized at presentation only; this does not silently rewrite stored names or server search behavior.

## Verification and release

Browser smoke used an isolated API, disposable PostgreSQL database, and synthetic records. It exercised 38 Owner routes at 1366×768 and 390×844. The initial run passed 75 of 76 route/viewport checks; the duplicate page heading on the embedded room-type screen was corrected. The confirmation sweep passed all 20 selected route/viewport checks and opened the shared-template and setup-wizard dialogs at both viewport sizes. This is responsive route-level coverage, not a claim that every mutation workflow was exercised end to end.

Run the repository checks from the root, using the documented Node and .NET versions and a disposable integration database:

```text
npm run lint
npm run typecheck --workspace ./src/mobile
npm test
npm run build
npm run format:check
dotnet restore src/backend/BHome.sln
dotnet build src/backend/BHome.sln -c Release --no-restore
dotnet test src/backend/BHome.sln -c Release --no-build --settings tests/backend/ci.runsettings --logger trx -m:1
dotnet format src/backend/BHome.sln --verify-no-changes --no-restore
```

The CI workflow also exports the Expo web bundle, builds the required integration images, checks the two Compose configurations, validates the SePay sandbox scripts, and runs the digital-signing unit tests. GitHub Actions results for the exact pushed revision are the final CI authority. Local artifacts, logs, synthetic credentials and disposable test databases are excluded from the commit. The integration run requires the database and external fixtures specified in `.github/workflows/ci.yml`; use neither a development database with real records nor a production database for these checks.
