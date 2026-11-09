# BHOME API documentation

Current configuration handoff: **2026-11-09**. Start with [implementation status](API_IMPLEMENTATION_STATUS.md),
the [runtime inventory](API_RUNTIME_ROUTES.md) and [conventions](API_CONVENTIONS.md).
There are 392 registered controller method-route pairs and 391 OpenAPI operations
across 327 path keys, plus two health endpoints. Registration is separate from
business acceptance. [Validation](../development/CONFIGURATION_VALIDATION_2026-11-09.md)
records passing checks, three reproduced baseline migration failures and one skip.

| Contract | Scope |
| --- | --- |
| [Location/Room](LOCATION_ROOM_API.md) | Direct native hierarchy and exact pricing DTOs |
| [Property management](PROPERTY_MANAGEMENT.md) | Native configuration and permission boundaries |
| [Owner setup](OWNER_SETUP_COMPACT24.md) | Asset inventory, utilities, policies and private evidence |
| [Shared configuration](SHARED_CONFIGURATION.md) | Global library, editions, application, usage and Location copy |
| [Contract lifecycle](CONTRACT_LIFECYCLE.md) | Signing, activation, handover, renewal and settlement |
| [Operational tasks](OPERATIONAL_TASKS.md) | Staff operations and Owner verification |
| [Incidents/maintenance](INCIDENT_MAINTENANCE.md) | Incidents, emergencies, work orders and evidence |
| [Invoices](INVOICES.md) | Draft/final invoice workflows |
| [Billing automation](BILLING_AUTOMATION.md) | Scheduled invoice cycle |
| [Invoice adjustments](INVOICE_ADJUSTMENTS.md) | Requests, approval and immutable final invoices |
| [Payments](PAYMENTS.md) | Bank evidence, allocations and debt |
| [Refunds](REFUNDS.md) | Refund review and execution |
| [Deposit deductions](DEPOSIT_DEDUCTIONS.md) | Approved deductions with evidence |
| [Finance](FINANCE.md) | Investment, OPEX, reports and What-if |
| [Notifications](NOTIFICATIONS.md) | Persistent inbox and delivery retries |

Individual module documents retain their dated evidence and limits. Previous API
snapshots are preserved in [history](history/README.md); obsolete RoomType examples
and route counts are not current contracts. Legacy migrations are historical/offline
artifacts and must not be used as the Compact24 deployment procedure.
