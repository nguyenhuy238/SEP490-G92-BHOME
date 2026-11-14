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
