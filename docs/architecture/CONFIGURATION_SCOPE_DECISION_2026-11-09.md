# Configuration scope decision — 2026-11-09

Status: authorized by the Team Leader's implementation request dated 2026-11-09.
Baseline: `member/QHuy`, `919c208720c3f0e2b96642094762a41810ced195`.

## Approved scope

Complete audit GAP-001 through GAP-008, including the previously proposed Shared
Configuration Library and deferred configuration-only Location Copy. This decision
supersedes the deferral for those capabilities; it does not restore Chain or the
legacy RoomType operational aggregate. `Location -> Room` and Compact24 remain the
runtime architecture. Historical reports and their changelogs remain unchanged.

Shared room templates contain reusable defaults, not live room types. Reference
rent/prices are not authoritative billing data. Shared asset catalog entries are
definitions, not physical assets. Applying shared configuration creates independent
Location records/snapshots only after explicit Owner confirmation. Future source
edits cannot rewrite target configuration, physical assets, signed contracts,
finalized invoices or payment obligations. Preview is read-only; apply/copy use
Reject conflict handling, durable idempotency and an atomic transaction.

## Traceability and implementation sequence

| Phase | GAP | Requirement | Components | Acceptance evidence |
|---|---|---|---|---|
| 1 | 001 | UC-15/19, GBR-02/04/13 | Policy controller/service, setup history store | Policy-specific persisted revisions; Staff published-only; scope; snapshots |
| 2 | 002 | BF-01/UC-04, approved 04/11 model | Mobile Setup/client | Current Location/Room payloads; no obsolete calls; error/role handling |
| 3 | 003 | UC-06, GBR-08/09, DBR-07 | Pricing/client DTOs | Exact serialized requests; decimal precision; 400/409; no invoice rewrite |
| 4 | 004 | UC-04/05/06/17 and approved 08/11 setup | Owner Web local setup | Real calls, server-confirmed success, evidence/version/scope handling |
| 5–7 | 005 | This decision; BF-01, GBR-02/08/13/18 | Shared services/persistence/API | Typed resources; immutable published snapshots; isolated preview; transactional apply/usage |
| 8 | 006 | UC-04 copy flow/A5 reopened here | Location Copy service/API | Config-only independent records; no operational data; conflicts/replay/rollback |
| 9 | 004/005/006 | This decision | Shared library and copy UI | Real persisted CRUD/preview/apply/usage/copy, reload/errors |
| 10 | 008 | Quality gates; GBR-02/08/09/13/18 | Backend/client regression tests | Executed results separate from skipped/unavailable tests |
| 11 | 007 | API contract/change control | API documentation/inventory | Runtime-generated routes; source SHA/date/limitations |

Each coherent phase is verified and committed separately with selective staging.
No push, merge, release or working-database migration is authorized by this record.

## Policy revision semantics

`GET /operating-policies/{id}/versions` means persisted revisions of that document
ID, ordered by ascending document version. It does not mean all policies of a
Location or a synthetic policy family. Owner can read all revisions; assigned Staff
can read only Published revisions of a currently visible Published policy. Tenant
access remains through its own Contract's agreed policy snapshot.

## Persistence review boundary

Before Shared Configuration implementation, inspect nullable global SYSTEM_JOB /
COMMAND containers, JSON history guards, source-key uniqueness and transaction
composition. Global records must have explicit ownership and no fabricated
LocationId. Document the chosen representation and its integrity/query tradeoffs
before adding storage. Any necessary schema change must be non-destructive,
versioned and isolated from legacy migrations. Never migrate the working database
as part of tests.
