# BHOME API implementation status

BF01 update **2026-11-13** (`FE/truong` working tree): atomic initial location setup,
selective source copy with explicit destination-room fee mapping, independent
versioned RoomDefaults, room provenance, configured-room creation and location
metadata are implemented on Compact24. See the
[decision](../architecture/BF01_LOCATION_SETUP_DECISION_2026-11-13.md) and
[implementation and executed tests](../development/BF01_LOCATION_SETUP_IMPLEMENTATION_2026-11-13.md).
The dated route inventory and counts below remain historical; they have not been
regenerated for this addition.

SePay update **2026-11-12**: opt-in authenticated webhook, permanent BH code registry,
provider-verified ledger allocation, JOB-03 recovery/polling and Owner event review are
implemented. See [SePay configuration and test guide](SEPAY.md). The inventory and
historical configuration-scope results below describe their original dated audit;
they do not include the two new SePay method-route pairs or current regression results.

Updated **2026-11-09** on `member/QHuy`. Runtime implementation source:
`b9cff6566df6ddf0c0d339b95c6d226bc22faf24`. The subsequent documentation commit
does not change that implementation. The delivery report records the final HEAD
without introducing a circular self-referential commit hash.

Current inventory: **392 registered controller method-route pairs**, **391 OpenAPI
operations / 327 path keys**, plus two health endpoints. The mobile Development
certificate route is registered but deliberately excluded from OpenAPI. Generic
shared-resource routes count once per method/path pattern. These figures replace
the historical 216-route snapshot and the audit's 371/314 Swagger counts.
The [runtime inventory](API_RUNTIME_ROUTES.md) records exact descriptors, authorization,
parameters, generation timestamp and probe results.

The instantiated BHome.Api test host uses the real application, controllers, DI and
Compact24 persistence with synthetic data. Test-assembly probe controllers are
excluded. Its registered Swagger provider generates the contract; Testing does not
expose Development-only Swagger HTTP middleware. All 24 physical Compact24 tables
and the structural schema verifier were checked on dedicated PostgreSQL 16. The
working database was not migrated or used for writes.

## Configuration implementation

| Gap     | Result                                                                                                                                         | Contract / evidence                                                 |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| GAP-001 | DONE: policy versions returns revisions of the requested document; Staff sees Published revisions only                                         | [Owner setup](OWNER_SETUP_COMPACT24.md)                             |
| GAP-002 | DONE: Mobile uses native Location/Room and explicit capacity; loading failures are independent                                                 | [Location/Room](LOCATION_ROOM_API.md)                               |
| GAP-003 | DONE: pricing uses exact rate strings and current Location/Room scope                                                                          | [Location/Room](LOCATION_ROOM_API.md)                               |
| GAP-004 | DONE: API-mode Owner configuration persists through native APIs, evidence, versions and refetch                                                | [Owner setup](OWNER_SETUP_COMPACT24.md)                             |
| GAP-005 | DONE: persistent shared resources, lifecycle, editions, preview/apply and database-derived usage                                               | [Shared API](SHARED_CONFIGURATION.md)                               |
| GAP-006 | DONE: configuration-only copy with explicit groups, hashes, conflicts, transactions and provenance                                             | [Copy](SHARED_CONFIGURATION.md#location-configuration-copy)         |
| GAP-007 | DONE: runtime-generated inventory, exact count/schema methodology, archived obsolete snapshots                                                 | This document and inventory                                         |
| GAP-008 | PARTIAL: new workflows and focused regressions pass; broad acceptance retains three baseline migration failures and one logging-dependent skip | [Validation](../development/CONFIGURATION_VALIDATION_2026-11-09.md) |

These statuses cover this configuration scope. They do not establish acceptance of
every BF/UC, production provider, live browser/device journey or NFR.

## Architecture and integration

Location directly owns Rooms. Native APIs reject Chain/RoomType fields.
`room-type-templates` is a compatibility route for reusable defaults; it does not
create Rooms, occupancy or contractual obligations.

Shared data belongs to the BHOME Owner management scope. Global Compact24 COMMAND
documents have NULL Location and a real creator FK. Applications/copies carry the
actual target, immutable source references, append-only history and durable keys.
No migration, extra table or dependency was added. See the [persistence decision](../architecture/SHARED_CONFIGURATION_PERSISTENCE_2026-11-09.md)
and [approved scope](../architecture/CONFIGURATION_SCOPE_DECISION_2026-11-09.md).

Owner Web API mode uses current native/shared clients; in-memory prototypes remain
behind explicit mock mode. Billing calculations, permissions and transitions stay
server-authoritative. Applied asset and policy packages are local Drafts. Physical
verification, contract signing and Owner activation remain separate. Shared changes
never rewrite signed contracts or finalized invoices.

## Known limits

- Copy rejects Room-scoped fee references; explicit Room mapping is not included.
  Selected unsupported references/groups are reported and rejected.
- Fee copy requires a current/future date and selects source policies effective on
  that date, retaining end dates and native overlap checks.
- Reject is the only strategy. There is no implicit merge, overwrite or propagation.
- A shared family can be applied once per Location; later changes use native local
  workflows. Editions and applications remain retained.
- Native setup/copy snapshots have an explicit 1000-record workspace bound; excess
  returns a visible conflict instead of silently truncating a copy.
- Three historical legacy-to-Compact24 migration tests fail at both audited baseline
  and current code. The SQL-log independence check remains skipped without sanitized
  server statement logging. Full regression acceptance is not claimed.

## Reproduction

Use Node 22.23.4 (supported >=22.13 and <23); run frontend Vitest from each app.
The runner creates and cleans a dedicated PostgreSQL instance with temporary
credentials and never reads the working DB URL.

```powershell
$env:BHOME_COMPACT24_EVIDENCE_DIRECTORY = Join-Path (Get-Location) '.tmp/config-final-runtime'
$env:BHOME_API_INVENTORY_COMMIT = git rev-parse HEAD
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/Test-Compact24Isolated.ps1 `
  -Filter 'FullyQualifiedName~Compact24' -ResultsDirectory .tmp/config-final-regression
node scripts/Generate-ApiImplementationInventory.cjs .tmp/config-final-runtime/api-route-audit.json 2026-11-09
```

The broad filter intentionally exposes the known failures/skip. Focus configuration
checks on Compact24OwnerSetupTests and Compact24SharedStoreTests. Registration and
anonymous probes establish entry guards; workflow tests separately establish writes,
scope, state, precision and rollback. Previous documents are preserved in [history](history/README.md).
