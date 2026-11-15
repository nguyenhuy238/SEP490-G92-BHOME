# BF-02 — Owner Web, Phase 1–2

## Scope and decisions

Based on BF-02 / UC-08–12 and the existing Location responsibility policy. Owner manages Staff accounts, employment periods and Location responsibility; Staff executes work in the existing Staff application. This change does not add payroll, shift scheduling or Staff-to-Staff transfer. It does not automatically disable a Staff account when an employment period ends.

## Owner workflow

1. `/staff`: create Staff and initial employment, send invitation, view/edit profile, create a separate employment period, review period history and account state. Periods are inclusive and may not overlap; close an open-ended period before creating the next one. The existing `employment` field denotes the latest recorded period, not necessarily today's effective period.
2. Staff detail shows current/future Location assignments and unfinished GENERAL, METER_READ, WORK_ORDER and move-out responsibilities. Follow links to the relevant workflow. Resolve responsibilities before deactivation; the backend remains authoritative. Version conflicts retain unsaved input and require review before retry.
3. `/staff-assignments`: current responsibility, future schedules and history; create, replace, remove, amend duration and cancel a future schedule. Current period start is immutable; future periods may not be moved into the past. Location change previews expose unfinished work and link to its workflow.
4. Effective dates use Asia/Ho_Chi_Minh. The Compact24 reconciliation job runs on the existing durable scheduler; immediate mutations use the same reconciliation. Unfinished general/meter tasks transfer or become unassigned; specialist work retains its prior recorded assignee if there is a gap, notifies Owner, and transfers when an eligible Staff becomes effective. Manual removal with unresolved specialist work remains blocked. Completed work and evidence are preserved.
5. `/operational-tasks`: compact toolbar, current responsibility vs recorded assignee filters, unassigned responsibility filter, deep links, current submission evidence separated from other evidence, Owner verify/rework/cancel and calendar-based recurring templates. Recurring generation uses the same Vietnam date for Staff and assignment ID; deduplication targets the actual partial source-key index.

## API additions (Owner only)

| Method | Endpoint / parameter                                           | Contract                                                                      |
| ------ | -------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| GET    | `/api/v1/staff/{id}/employments`                               | Employment periods with audit history                                         |
| POST   | `/api/v1/staff/{id}/employments`                               | `{accountVersion, employment, reason}`; returns updated Staff                 |
| GET    | `/api/v1/staff/{id}/responsibilities`                          | `canDeactivate`, `assignments`, `tasks`, `moveOuts`                           |
| DELETE | `/api/v1/staff-location-assignments/assignment/{assignmentId}` | `{locationVersion, reason}`; future periods only                              |
| GET    | `/api/v1/operational-tasks`                                    | `recordedStaffUserId`, `hasResponsibility`; filters applied before pagination |

No schema migration is required. Compact24 is the active persistence profile. The legacy compatibility adapter does not run the Compact24 reconciliation job.

## Verification boundary

Focused frontend tests cover Staff create/update, renewal, unresolved responsibilities, stale versions, assignment cancellation, task filters and recurring schedule configuration. Backend unit and composition tests plus Release compilation are executable without an isolated database. Compact24 integration coverage was added for the employment lifecycle, responsibility blockers, future assignment cancellation, midnight rollover, all four work types, rollback, filtering and recurring deduplication.

The isolated PostgreSQL integration tests require `BHOME_COMPACT24_TEST_ADMIN`; they were skipped in the local environment because this variable was not configured and the Docker engine was unavailable. Do not treat compilation or skipped tests as database acceptance. Existing running API processes may require restart to expose the new endpoints. No operational database was modified during verification.

Remaining full-flow acceptance: run PostgreSQL integration and real Owner/Staff application scenarios, verify notification delivery and scheduling; complete JOB-07 missed-run/reminder policy and cross-BF work overview in the later phases. A production build and mocked browser rendering are not equivalent to live API end-to-end acceptance.
