# Background processing and reliability

This is a durable processing foundation, not a completed business scheduler. `Jobs:Enabled=false`
by default. Enable it only after applying migrations and registering real handlers with scoped DI:
`services.AddScoped<IBackgroundJobHandler, YourHandler>()`. A handler's stable `Name` identifies its
contract version. Its `ExecuteAsync` must honor cancellation and finish within the one-minute
cooperative deadline; redesign/split longer work before using this worker.

No recurrence planner currently exists. A future scheduler/planner should enqueue deterministic
business keys through `IBackgroundJobQueue`, rather than implement business logic in a timer or
controller. PostgreSQL polling is intentionally used instead of introducing another scheduling product.

## Future inventory

| Concept                                | Suggested owning module         |
| -------------------------------------- | ------------------------------- |
| Overdue invoice reminder               | PaymentsDebt / Notifications    |
| Contract expiry reminder               | TenantContracts / Notifications |
| Payment reconciliation retry           | PaymentsDebt                    |
| Notification delivery retry            | Notifications                   |
| Holding contract expiry                | TenantContracts                 |
| Recurring operational task generation  | StaffOperations                 |
| Operational task deadline reminder     | StaffOperations / Notifications |
| Temporary residence reminder           | TenantContracts / Notifications |
| Periodic meter-reading task generation | Billing / StaffOperations       |
| Draft and final invoice generation     | Billing                         |

## Transaction boundary

The job queue uses the same scoped EF context as the future data-access adapter. Begin an explicit
database transaction, save the business change/audit intent, enqueue its notification or follow-up
intent, then commit. Raw enqueue executes immediately but participates in that transaction; invoking
it without one is durable on its own and is **not** atomic with another later SaveChanges.

Job JSON should contain minimal resource references/version information, never images, passwords,
JWTs, private identity data or signing credentials. Limit is 16,000 characters; use a deterministic
idempotency key no longer than 200 characters and job name no longer than 100. Stable business keys
include relevant scope/period/version, for example a resource ID and billing period once agreed.
Never generate a different retry key for the same effect. Validate/authorize submissions within the
application; there is no public arbitrary job-enqueue endpoint.

## Delivery and retries

Enqueue uniquely constrains `(Name, IdempotencyKey)` and does `ON CONFLICT DO NOTHING`. Concurrent
workers claim rows with a short transaction and `FOR UPDATE SKIP LOCKED`. A two-minute lease allows
crash recovery. A fresh fencing token prevents stale attempts from recording job completion, but
cannot fence an external business effect by itself. Jobs increment attempts on claim and reach
Failed after four attempts, including crashes/timeouts. Retry delay is exponential with jitter.

Execution is at least once. Every handler must implement its domain effect idempotently using a
unique durable business/provider reference and transaction. Invoice, payment, contract and notification
effects must not rely only on queue deduplication. External sends require provider-supported keys or
a status query/review path after ambiguous timeouts. No blind provider mutation retries are included.
Cancellation during shutdown leaves the lease for recovery rather than claiming completion.

Notification intent commits with the business change; delivery happens after commit and independently
retries. Delivery failure must not reverse invoice/payment/contract state. A failed bank integration
must allow an audited Owner manual verification use case when that feature is implemented.

## Operations

Monitor structured logs by `JobId`, `JobName`, attempt and safe error type. Never print payloads or
raw provider exception messages. There is no admin job dashboard/replay API yet. Authorized operators
can inspect state, attempt, availability and safe error code through controlled database access.

Failed rows remain durable for investigation. After fixing the cause, a reviewed operational
procedure may reset a selected failed row to Pending, clear its lease, reset attempts and set its
availability. Preserve the original idempotency key and record who replayed it and why; handlers must
still deduplicate any already-committed effect. Do not bulk delete completed/failed rows or overwrite
payloads to bypass a deduplication key. Define retention and archival windows with the business team.

PostgreSQL container tests validate migration/readiness and duplicate enqueue. Handler crash,
concurrency, lease expiry, ambiguous external effects and financial invariants need additional
integration tests when real handlers/providers are added. They are not claimed as fully tested by
the initial foundation.
