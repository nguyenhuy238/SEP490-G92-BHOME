# Owner Web Staff management traceability

Date: 2026-11-10  
Scope: Phase 0–3 of the Owner Web Staff implementation plan.

## Approved scope

- `/staff`: Staff account/profile, employment contract fields, agreed salary,
  active state, invitation, and Location assignment.
- `/tasks`: create, update, route, coordinate, monitor, evidence, verify,
  rework, cancel, and recurring-task template management.
- Recurring jobs and overdue reminders remain backend operations; the Owner Web
  only configures and observes their results.
- Monthly payroll/actual income is intentionally out of scope.
- Shift scheduling, shift swaps, and Staff-to-Staff handover are out of scope.

## Requirement mapping

| Requested behavior                  | Traceability             | Current implementation                                                 | Acceptance evidence                                                                              |
| ----------------------------------- | ------------------------ | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Owner manages Staff account/profile | BF-02, UC-08, GBR-01..03 | `StaffAdministrationController`, `OperationsService`, `StaffApiPage`   | Owner create/list/detail/update; non-Owner denied                                                |
| Staff employment/agreed salary      | BF-02, UC-08             | `EmploymentWrite`, `StaffEditor`                                       | Decimal non-negative rate; employment status/date validation                                     |
| Owner invitation                    | UC-08, GBR-01            | `AccountInvitationsController`, `AccountInvitations`                   | One-time invitation and acceptance tests                                                         |
| Assign Staff to Location            | BF-02, UC-09, DBR-01     | `StaffLocationAssignmentsController`, `StaffAssignments`               | Explicit create mode; period edit uses assignment PUT; date overlap and inactive Staff rejection |
| Safe replacement/removal            | BF-02, GBR-18            | `staff-change-preview`, versioned PUT/DELETE                           | Open responsibility warning; stale version returns 409 and UI refreshes                          |
| Owner task management               | UC-10..12, JOB-07        | `OperationalTasksController`, `OperationalTaskService`, `TasksApiPage` | Create/update/assign/coordinate/cancel/verify/rework                                             |
| Staff task filtering and display    | BF-02, UC-10             | `TaskQuery.StaffUserId`, Owner Web Staff directory                     | Filter sent to server; display uses Staff name with UUID fallback                                |
| Evidence access                     | UC-11..12, NFR security  | `OperationalTasksController`, private evidence storage                 | Owner download only for authorized task                                                          |
| Recurring task templates            | JOB-06, JOB-07, GBR-18   | `OperationalTaskTemplatesController`, `RecurringOperationsJob`         | Daily/weekly/monthly schedule validation and idempotent generation                               |

## Recurring task schedule contract

- New templates use `scheduleType`: `Daily`, `Weekly`, or `Monthly`.
- Weekly templates require ISO `dayOfWeek` from 1 (Monday) through 7 (Sunday).
- Monthly templates require `dayOfMonth` from 1 through 31. A month without the
  selected day is skipped; the configured day is not silently changed.
- `nextRunAt` is stored as an instant and interpreted using
  `Asia/Ho_Chi_Minh` when the following occurrence is calculated.
- Existing templates without schedule selectors remain compatible through
  `IntervalDays` and continue using their original `intervalDays` cadence.
- Generated-task `source_key` remains based on template and scheduled instant,
  so repeated or parallel JOB-06 execution does not create duplicate tasks.

## Negative and concurrency cases

- Staff/Tenant cannot manage Staff accounts or Location assignments.
- Staff task reads/actions are restricted to the current assigned Location.
- Inactive Staff and inactive Locations cannot receive new responsibility.
- Overlapping Location assignments are rejected.
- Location version and task version conflicts return 409.
- Repeated command keys do not duplicate task mutations.
- Evidence is private and must pass backend authorization and content checks.

## Known verification limitation

The repository integration tests use Testcontainers PostgreSQL. They cannot run
until Docker Engine is available on the test machine. Frontend tests, unit tests,
typecheck, lint, and API build are separate checks and do not replace the
database/concurrency integration gate.
