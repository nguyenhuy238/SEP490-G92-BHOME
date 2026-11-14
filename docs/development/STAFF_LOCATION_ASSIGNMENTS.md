# Staff Location assignments

## BF-02 Phase 2 — effective responsibility

UC-09–12 / DBR-01 / GBR-01–03: dates are inclusive in Asia/Ho_Chi_Minh. The Compact24
backend reconciles current responsibility using the same Location advisory lock for
Owner changes and the durable `staff-assignment-reconciliation` job. The scheduler
enqueues a minute-keyed job; replay compares the persisted responsibility and task
assignment before writing, so retries do not duplicate history or notices. Authorization
still checks the actual effective date immediately, regardless of job execution.

Open GENERAL and METER_READ tasks retain their IDs, status, evidence and progress;
the new responsibility and assignment ID replace the old ones, or are cleared during
a gap. Open WORK_ORDER and unperformed, assigned move-out inspections follow a new
eligible Staff member. During a gap the specialist record retains the previous assignee
for history, but that Staff has no Location access; Owner receives a persistent
`STAFF_RESPONSIBILITY_UNRESOLVED` notification and can assign the next responsible
Staff. Manual removal still conflicts while specialist work is unresolved. Completed
or cancelled tasks and performed inspections are not modified.

Owner may cancel an unstarted assignment with
`DELETE /api/v1/staff-location-assignments/assignment/{assignmentId}` and JSON
`{ "locationVersion": 2, "reason": "..." }`. The response follows the period-change
result, including the cancelled assignment and new Location version. Stale version
returns 409; started/ended cancellation is invalid. The full previous assignment and
reason remain in Location history; cancellation removes it from the effective schedule.
For a started assignment, period edits keep its original start and may change its
end to today or later. Future periods can move to today or later, with active
Location/Staff and overlap validation. Replacement/removal on the current date retain
the full previous assignment snapshot, including same-day replacement.

No schema migration or shift/transfer feature is introduced. Regression coverage:
`Compact24AssignmentTests` (Vietnam midnight, gap, all four responsibility types,
retry, completed-history preservation, cancellation/version/authorization) and
`Compact24OwnerSetupTests.ReplacingStaffMovesMeterAndWorkOrderAndFailedRemovalRollsBackResponsibility`.

## Owner Web update — 12 November 2026

UC-09 / BF-02 presentation now uses Location-first `/staff-assignments`, with a detail Drawer and separate create/replace/period/remove dialog flows. The existing staff profile links with `staffUserId`; clearing filters restores all Locations. No backend, DTO, permission or database change.

Current controller and Compact24 source supersede the historical boundary below: `by-staff`, `assignment/{assignmentId}`, replace/remove and `staff-change-preview` are implemented. Replacement/removal use today's Vietnam date and the version from Location GET. Period edits keep the assignment ID; ended records cannot be edited. `DateOnly.MaxValue` is displayed as “Không xác định thời hạn”. Preview codes GENERAL, METER_READ, WORK_ORDER and MOVE_OUT_INSPECTION are translated; unknown codes remain visible.

`useLocationAssignments.ts` reads all Location/Staff pages, caches assignments per Location with actor-scoped keys, and loads at most four assignment requests concurrently. Partial failures suppress exact KPIs and expose row retry. Successful mutations use the existing Owner action invalidation and refresh. A 409 preserves input, reloads version/assignments/preview and requires explicit review before another submission; no optimistic write or frontend Task reassignment.

Affected UI: `StaffAssignments.tsx`, `pages/StaffAssignmentsPage.tsx`, `components/AssignmentDetailDrawer.tsx`, `components/AssignmentDialog.tsx`, the Staff profile navigation link, and `StaffAssignments.test.tsx`.

Validation: TypeScript, production build, Oxlint and diff whitespace check passed. Focused Staff/Assignment suite: 35 tests passed across two files, covering date boundaries, pagination/concurrency/cancellation, filters, missing data, mutation payloads, overlap, preview restrictions, 409 review and HTTP failures. Vite retains its shared chunk >500 kB warning. Browser visual QA and live backend writes were not run.

## Traceability

- Scope: BF-01, BF-02; UC-04, UC-08, UC-10..12; DBR-01; GBR-01..03.
- Approved decision (29 October 2026): one Staff may cover multiple Locations; one Location has at
  most one Staff for any calendar date; both assignment dates are inclusive. Operational work is
  attached to the Location rather than copied to a Staff account.
- Approved decision (29 October 2026): Owner is the highest global role. Every Owner manages every
  Location, and every active account with the Staff role is available for assignment.
- Business dates use `Asia/Ho_Chi_Minh` and API values use `YYYY-MM-DD`.

## Behavior

`POST /api/v1/locations` creates a minimal global Location. This slice stores only the stable
identity and name required to enforce access; the fuller UC-04 address, publication and Room model
remains a later vertical slice.

`POST /api/v1/staff-location-assignments` accepts `locationId`, `staffUserId`, `startDate` and
`endDate` in its JSON body. Any authenticated Owner may select any existing Location and any active
account with the Staff role. A Staff account may have simultaneous assignments to several Locations. PostgreSQL rejects overlapping
inclusive date ranges for the same Location, including races between parallel requests.

Assignment creation now takes the same transaction-scoped Location advisory lock used by Property
configuration before checking current Staff eligibility and overlapping dates, then commits the
assignment. This prevents concurrent GiST exclusion checks from deadlocking (`40P01`); the database
exclusion constraint remains in force. Concurrency regression uses ten independent date windows,
requiring exactly one 201 and one 409 per pair. See [Contract stabilization](CONTRACT_STABILIZATION.md).

`GET /api/v1/staff-location-assignments?locationId=<id>` returns the Location's assignment history to
any Owner. The read API uses a query parameter because GET request bodies are not reliably supported
by HTTP clients and intermediaries. `GET /api/v1/locations/assigned-to-me` returns only Locations assigned to the current
Staff on the current Vietnam business date. The authorization adapter performs the same database
check on every scoped request; no Location grant is stored in JWT claims.

When an assignment reaches its inclusive `endDate`, the Staff loses Location access on the next
calendar day. Location work remains attached to `LocationId`, so a later Staff can continue it
without reassignment or history rewriting. Gaps with no assigned Staff are allowed and remain
visible to the Owner.

## Current boundary

The later [property API slice](../api/PROPERTY_MANAGEMENT.md) supersedes the minimal Location
create/list boundary described above. Full details, Room Types, Rooms, Assets and prices now have
their own application service; the assignment API and its inclusive dated/global Owner rules remain.

Staff provisioning is not exposed by this slice. Assignment eligibility comes from current trusted
Identity state: the account must exist, be active and have the Staff role. Legacy per-Owner columns
are retained under `Legacy*` names by migration for rollback/history, but application authorization
does not read them.

Early cancellation, editing an assignment, full Location details and operational tasks are not
implemented here. These require separate state/history and acceptance rules rather than rewriting
an already recorded assignment silently.
