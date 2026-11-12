# SePay integration implementation

## Scope and acceptance

BF-06, FE-05, UC-22/23/25, GBR-10/18, DBR-08, JOB-03 and API-01 apply. The explicit implementation request dated 12/11/2026 authorizes SePay, automatic provider verification and the BH plus eight numeric digits format. Existing partial/excess policies remain documented in docs/api/PAYMENTS.md. The SRS UC-22 automatic/manual branches and JOB-03 retry requirements were checked during the source audit.

Implementation stages have separate commits with English subjects and descriptions. Acceptance covers authenticated raw-body ingestion, wrong account/direction, atomic duplicate handling, unknown payer, exact/partial/excess, historical references, durable retry, isolated PostgreSQL migrations and client compatibility.

Provider contract sources are the official SePay webhook authentication, Test Mode webhook and API v2 transaction documentation. HMAC signs timestamp plus a dot plus the original bytes. Transaction timestamps without an offset are interpreted in Asia/Ho_Chi_Minh.

The registry will reuse operational_tasks technical records. Cross-obligation uniqueness requires database indexes and immutable registry guards because a JSONB array inside each Invoice cannot enforce uniqueness across Invoice and Contract records. No financial identity GUID changes are required.
