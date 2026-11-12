# SePay integration implementation

## Scope and acceptance

BF-06, FE-05, UC-22/23/25, GBR-10/18, DBR-08, JOB-03 and API-01 apply. The explicit implementation request dated 12/11/2026 authorizes SePay, automatic provider verification and the BH plus eight numeric digits format. Existing partial/excess policies remain documented in docs/api/PAYMENTS.md. The SRS UC-22 automatic/manual branches and JOB-03 retry requirements were checked during the source audit.

Implementation stages have separate commits with English subjects and descriptions. Acceptance covers authenticated raw-body ingestion, wrong account/direction, atomic duplicate handling, unknown payer, exact/partial/excess, historical references, durable retry, isolated PostgreSQL migrations and client compatibility.

Provider contract sources are the official SePay webhook authentication, Test Mode webhook and API v2 transaction documentation. HMAC signs timestamp plus a dot plus the original bytes. Transaction timestamps without an offset are interpreted in Asia/Ho_Chi_Minh.

The registry will reuse operational_tasks technical records. Cross-obligation uniqueness requires database indexes and immutable registry guards because a JSONB array inside each Invoice cannot enforce uniqueness across Invoice and Contract records. No financial identity GUID changes are required.

## Ledger and migration decisions

Migration 20261112000100_SePayIntegration adds unique indexes and immutable technical-record guards while retaining 24 tables. Payment codes are permanent COMMAND records with one code per mode, kind and obligation. Global source-key uniqueness prevents reuse across modes and obligation types. Existing legacy reference functions remain available for manual reconciliation. Automatic matching accepts only registered BH codes and rejects ambiguous content.

Provider receipts use the existing payments table with AUTO verification, durable SePay inbox evidence and a null human verifier. The allocation creator column becomes nullable with a trigger permitting null only for a verified SePay source. Existing DTO GUID fields represent this absent human actor as Guid.Empty. Source labels identify SePayTest or SePayLive. Payer remains unassigned until separately verified. Contract deposit allocation preserves budget, expiry, Room conflict and Holding price-lock rules without activating a Contract.

SePay webhook numeric IDs and API v2 UUIDs can differ. Inbox identity is scoped by mode, gateway, receiving account and provider ID. Canonical receipt identity additionally uses a digest of mode, gateway, account and bank reference, so webhook and API backfill cannot credit the same bank reference twice. Conflicting amounts/timestamps/content are rejected.

Manual receipts lack provider account scope. A provider callback that encounters an existing manual bank reference stays in the durable inbox for Owner review. Manual registration that encounters an existing provider reference directs the Owner to the existing receipt. Native allocation guards also block a second effect across these pathways, including direct Contract deposit receipts. Functional reference indexes keep these checks bounded. This guard extends the unreleased SePay migration; no working or production database was migrated.

The webhook durably commits inbox plus a queued reconciliation command before processing money. A processing failure rolls money back while retaining the inbox for JOB-03. Terminal unmatched and ignored events have explicit reasons. Owner can inspect safe event summaries through GET /api/v1/integrations/sepay/events and receipt evidence through existing payment APIs.

## JOB-03 and provider HTTP verification

SePay reconciliation jobs use the existing PostgreSQL worker lease, four-attempt bounded backoff and failure records. Handler names include Test or Live. Unmatched codes are terminal manual-review decisions. Pending events whose jobs exhaust retries appear as ManualReview with sepay_technical_retry_exhausted in the Owner event API. A provider redelivery can recover the retained inbox after the underlying issue is repaired.

SePayAutomationWorker schedules only SePay work when Jobs.Enabled is false. When the general worker is enabled, it processes the same registered handlers. This allows webhook recovery without enabling unrelated billing or Contract jobs. Optional API polling requires ApiToken and uses the official sandbox or Live v2 host, disabled redirects and bounded request/body timeouts.

Polling requests one ascending page of at most 100 records per job. The durable cursor retains sinceId and candidateId while page increases. Only the final page advances sinceId and synchronizedAt. A separate PostgreSQL synchronization lock prevents concurrent checkpoint races. Each received transaction commits through the existing inbox and ledger; a failed page is safe to repeat.

The Postman CLI was unsigned-in, so owner-workspace mock discovery was unavailable. Orbit returned unrelated providers; the implementation follows official SePay documentation. The committed local contract mock and simulation exercise SePayApiClient over actual HTTP using synthetic credentials. Local HTTP tests additionally cover 401, 429, 500, malformed responses and body timeout. Provider account acceptance and public connectivity require external configuration.
