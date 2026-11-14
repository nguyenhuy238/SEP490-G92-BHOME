# Location Workspace UX refinement

Date: 2026-11-13. Scope: BHome Owner Web, Location detail and its existing child workflows.

## Design and traceability

Impeccable 4.3.1 `operate`, `shape`, `critique`, `craft-floor` and `audit` references informed the refinement. The repository did not contain the local Impeccable launcher; review used the skill's guidance, source inspection, and actual desktop/mobile browser screenshots instead of the automated detector. Product and design context are recorded at `src/owner-web/PRODUCT.md` and `src/owner-web/DESIGN.md`.

This refines the existing React/MUI blue identity; it is not a new visual identity or framework. Business references: BF01 UC04–07, GBR08; BF05 UC20–21, GBR07–09; FE08 and finance UC31–35; role and Location scope GBR01–03. Follow the approved 2026-11-13 BF01 setup decisions and implementation: versioned local RoomDefaults and immutable creation provenance replace retired operational RoomType writes.

## Changes and existing API contracts

| Surface                 | Changes                                                                                                                                           | Existing data source                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Workspace               | Stable header, active tab, responsive navigation, heading hierarchy, keyboard focus, status contrast and shared section layout                    | Location and setup metadata                                                                                   |
| Overview                | Actual room-state totals, distribution, operational follow-up, separate configuration counts, verified financial data; partial failure states     | Location occupancy-summary, incidents, asset and billing lists, templates, rules, financial-reports           |
| Rooms                   | Floor/table views, server status filter, explicit page scope, capacity/occupancy, incident states, detail drawer, local defaults and bulk preview | Rooms, occupancy, incidents, room prices/history, local RoomDefaults, provenance and native create/bulk flows |
| Assets                  | Actual records, desired templates and room verification separated; metadata/history and explicit discrepancy/evidence                             | Assets, asset-templates, room asset assignment/inventory, existing verification and evidence                  |
| Pricing and utilities   | Rent/service categories separated before server paging; effective status, units, legacy scope, tariffs/meters/reconciliation, schedule            | Billing policies, billing-schedules, existing utility endpoints                                               |
| Rules                   | Draft/Published list, content, explicit publish confirmation, version history                                                                     | Operating policies and versions                                                                               |
| History                 | Searchable Location-scoped room selector, URL-backed date/event filters, actual event list and pagination                                         | Room options and room history                                                                                 |
| Settings                | Grouped forms, dirty baseline, reset/version conflict, closure preview and confirmation                                                           | Location, setup metadata and closure-check                                                                    |
| Investment and expenses | Scope-preserving server filters, exact amounts, source-managed read-only rows, aggregate capital and current-month operating costs                | Expenses, references/evidence and financial-reports                                                           |

No new backend API, schema, dependency, migration or database update was introduced by this UX work. The incident page accepts an existing Location query parameter for the scoped follow-up link. The common PageHeader accepts an optional heading level; existing default is unchanged.

## Business safeguards

- The current occupancy ratio is occupied rooms divided by all rooms, not historical occupied room-days or physical presence. Unknown/inconsistent counts do not produce invented percentages.
- Missing configuration records are not proof that a Location cannot operate. The server controls closure eligibility and room state.
- Local RoomDefaults edits do not update existing rooms, agreed contract prices, or global templates. Creation retains its selected revision and explicitly recovers stale versions.
- Actual assets, desired requirements and verified inventory are different. A desired requirement is not evidence of ownership or installation.
- Pricing changes respect effective dates and versioning; immutable contract and invoice snapshots remain untouched. Legacy RoomType-scoped policies are view-only in this Location/Room editor to avoid accidentally writing a different scope.
- Service fee units distinguish per-person and per-room monthly charging. Existing MoneyField preserves canonical values independently from formatted VND display.
- Finance reports are server-authoritative: monthly verified collections/operating costs, outstanding balance for invoices in the selected period, and initial investment cumulative to the report end. List filters do not recalculate these aggregates from a page of rows.
- Rules retain published versions and do not rewrite already signed contract content.

## Verification

- Owner Web typecheck, lint (0 warnings/errors), production build: passed. Build emits the existing Vite large-chunk warning.
- Scoped Prettier and Git whitespace checks: passed.
- Focused Vitest runs: 23/23 room/asset tests, 28/28 pricing/settings/utility/expense tests, 6/6 overview/history tests, 57 distinct tests across eight files. Latest repeat after the shared heading, empty-state and finance summary changes: 23/23 (expenses, property and overview).
- The full Owner Web run was stopped intentionally when free physical memory reached approximately 0.4 GB. Several suites had passed, including task, native setup, shared configuration, workspace interactions and staff assignment. Do not interpret this as a full regression-suite pass.
- Real local development Owner Web browser read-only QA with the existing synthetic BHOME JOB09 TEST Location, 1440 × 900 and 390 × 844: eight tabs at both sizes, 16/16 without document-level horizontal overflow and no uncaught JavaScript exceptions in that sweep.
- Actual overview snapshot: 4 rooms, 1 occupied, 1 available, 2 holding, 0 unavailable, 25% currently occupied. The report API was exercised, not mocked. No persistent mutation was performed during browser checks.
- Eight browser interaction checks passed across two runs: overview/finance, floor/table and room detail, asset tabs, per-person fee and live VND formatting without save, room history with HTTP 200, settings dirty/reset, investment aggregates, and mobile navigation. An initial history assertion ran before the response; the repeat awaited the actual HTTP response and passed.

Local, ignored evidence directories: `.tools/owner-web-e2e/location-ux/before`, `after` and `final` (relative to repository root). The initial screenshot sweep began before the edits; some mobile captures overlapped implementation. Use the desktop baseline for the clearest comparison. No test credentials are stored in scripts or this report; run scripts with environment variables.

## Known limitations

- No automated Impeccable detector run, exhaustive accessibility audit, complete full-suite pass or production deployment.
- Data names in the synthetic database may contain existing corrupt Vietnamese text; no record content was rewritten by the UI.
- Real browser mutations were deliberately avoided in the running development database. Focused mocked API tests cover mutation payloads, permissions, version conflicts, failure retention and confirmation.
- Concurrent backend migration and snapshot changes from other work were observed in the shared workspace; they were left untouched.
