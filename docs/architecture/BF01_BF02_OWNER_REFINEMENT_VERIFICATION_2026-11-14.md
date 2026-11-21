# BF01/BF02 Owner Web refinement — implementation and verification

Scope: Owner Web, shared client contracts, backend and persistence. No Mobile source or existing operational database changes. See [decision and traceability](BF01_BF02_OWNER_REFINEMENT_2026-11-14.md).

## Implemented

- P0–P2: shared room-type asset requirements with units; copy linked requirements without copying operational data; independent destination snapshots; remove duplicate rent editor and separate source asset package/location rent choices; prevent duplicate fee selections; review labels and validation.
- P3: common-area physical asset placement and selection, room/common-area filters, unit metadata, separate desired/verified/observed counts, versioned evidence-backed count observations. No automatic physical asset creation/deletion from inventory differences. Common areas are persisted through actual asset positions, not a new independent master-data table.
- P4–P5: protected service-fee successor, precise effective-date and overlap checks, signed contract snapshot protection, electricity/water entry points, invoice schedule in finance automation.
- P6–P7: optional operational task target with server-side location/asset scope checks; existing Staff-to-Location responsibility retained. Canonical contact phone validation on supported Owner writes, preserve login compatibility and historical data.
- P8: nullable task target migration and Compact24 projection snapshot, additive unit/observation data, tests.

## Executed verification

| Check                                                  | Result                                                                               |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Backend Application unit tests, Release                | 521 passed                                                                           |
| Backend Domain unit tests, Release                     | 110 passed                                                                           |
| Targeted property/pricing tests                        | 26 passed (included in Application total)                                            |
| Backend migration/model and selected integration tests | 1 passed, 3 skipped: PostgreSQL test environment unavailable                         |
| Owner Web full regression before last corrections      | 559 passed, 3 failed, 92 files                                                       |
| Native setup regression after corrections              | 8 passed                                                                             |
| Copy wizard and property API page regression           | Copy 1 passed; property 16 passed, new common-area test initially failed on selector |
| New common-area test after selector correction         | 1 passed; other 16 excluded by filter                                                |
| Owner Web lint/typecheck                               | Passed, zero lint warnings/errors on final check                                     |
| Owner Web production build                             | Passed before final test-only/hook extraction cleanup; chunk-size warning            |

All failing cases from the earlier FE full run were corrected and rerun successfully; no single final all-suite run was executed after the last corrections. No real PostgreSQL integration pass or live browser/API acceptance is claimed. The Compact24 test connection setting is absent and Docker is unavailable. New migrations are present in source but have not been applied to existing user data. No commit or push performed by this implementation session.

## Remaining acceptance

Run full FE and backend CI on the final branch, execute PostgreSQL integration tests in an isolated database and apply the appropriate reviewed migration to the deployment database. Verify the Owner Web flows against a real API. Physical asset filtering is currently by room/common area; room-type grouping is provided through desired configuration rather than a dedicated physical inventory room-type filter.

## Follow-up — 2026-11-15: inline template creation and wizard refinement

The seven-step Owner wizard retains its original structure. The billing preview no longer exposes a simulation-date input; it uses the configured rent effective date and remains an estimate, not an invoice. Location-level fees with the same normalized charge code and overlapping validity periods are marked as selected, including fees copied from another Location. Room overrides and non-overlapping periods remain supported. Copied room types and asset requirements are recognized by source identity or normalized name.

The room-type, asset, fee and policy steps now reuse the shared template editor to create and publish templates directly. Creating a template and adding it to the Location remain distinct actions. Templates are persisted independently of the Location draft; cancelling the wizard does not undo a published shared template. The existing API and database schema are unchanged. The selected template cache is updated with the server response. Save/publish failures retain the saved draft and allow recovery without creating a replacement. A pre-existing Owner Web compile error in Work Order evidence rendering was also corrected by using the existing authenticated private evidence viewer.

### Design and operational risks

| Area                 | Current protection or benefit                                                                                            | Remaining limitation / recommended action                                                                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UX                   | Create missing shared templates without leaving the current setup; explicit add/apply; versioned reusable data           | Make shared-library persistence clear when abandoning a Location draft.                                                                                                                                    |
| Frontend performance | React Query cache update after successful writes; no new dependency                                                      | Four library resources are fetched in parallel and all pages are accumulated. For a large catalog, load only the active resource, search and paginate on the server, and virtualize large lists.           |
| Frontend draft       | Per-user sessionStorage draft; no server writes until explicit actions                                                   | Not a multi-device or collaborative draft; browser storage is accessible to same-origin scripts. Keep personal data minimal and maintain XSS/CSP protections.                                              |
| Concurrent writes    | Client submission lock; backend expectedVersion checks, duplicate name checks and transaction locks                      | The global shared-configuration advisory lock serializes writes, including Location setup operations. Measure lock wait, contention and connection-pool saturation before increasing concurrency.          |
| Request recovery     | Save and publish are separate API calls; persisted draft can be resumed; source-version checks prevent silent overwrite  | A lost initial create response still depends on server name conflict detection and refreshed draft discovery. Consider a durable create idempotency key or atomic create-and-publish command if warranted. |
| Authorization        | Existing Owner-only backend authorization, server validation and parameterized SQL; private evidence stays authenticated | The current BHOME shared scope assumes the existing single-Owner/chain model. Multi-tenant SaaS would require explicit organization-scoped authorization and storage queries.                              |
| Billing              | Simulation only; effective-period and scope checks; historical contract and invoice protection                           | Future-starting fees may not appear at the chosen rent effective date. Keep explicit effective-date wording and leave actual billing calculation to the backend.                                           |

These are architecture observations, not a production load-test or penetration-test result. Test concurrent setup and template publication on an isolated staging environment before making throughput or security guarantees.

### Follow-up verification on the current working tree

- Backend restore, Release build (zero errors and warnings) and dotnet format verification passed. Application 521, Domain 114, Infrastructure 34 and Digital Signing 41 unit tests passed.
- Owner Web typecheck, Mobile typecheck, repository ESLint, Prettier and both web production builds passed. The full frontend workspace test command passed: Owner Web 656 tests across 100 files and Mobile 1236 tests across 119 files. Targeted regression results (included in Owner Web total): Native Setup 8, Copy Wizard 1, Billing Preview 4, Shared Configuration 22, Incidents 10 and Private Evidence Viewer 14 passed. The inline creation regression covers all four resources and recovery from a publish failure. Mobile Web Expo export also passed.
- Both Docker Compose configuration validations passed. The Docker engine itself is unavailable, so image builds and Docker-backed PostgreSQL/MinIO integration verification remain blocked. The full backend test command returned nonzero: Integration Tests reported 442 passed, 286 failed because Docker/Testcontainers were unavailable, and 432 skipped; Plan Integration Tests reported 1 passed, 11 failed and 130 skipped while targeting the local API, including account authentication and message-expectation mismatches. These failures are not a new wizard regression; they are not waived or treated as passes.
- The self-contained SePay Sandbox script test passed under local Windows PowerShell; PowerShell 7 is unavailable locally, so the workflow's exact shell remains unverified. No new dependencies, database migrations or Mobile source edits were introduced by this follow-up. GitHub Actions must still execute on the resulting PR with its isolated PostgreSQL service and Docker. No commit or push was performed.
