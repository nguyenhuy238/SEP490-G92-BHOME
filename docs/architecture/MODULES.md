# Module ownership and feature placement

Use these module names consistently. Agree on a module owner per PR; these are code organization
boundaries within one application, not independently deployed services.

| Code module         | Future business area                                                 |
| ------------------- | -------------------------------------------------------------------- |
| IdentityAccess      | Identity, fixed roles, authentication, assignments and scoped access |
| PropertyManagement  | Locations, rooms, facilities and assets                              |
| StaffOperations     | Assignment and operational tasks, recurring tasks and deadlines      |
| TenantContracts     | Tenants, tenancy, holding/rental contracts, signing, residence       |
| Billing             | Meter readings, human-confirmed OCR proposals, draft/final invoices  |
| PaymentsDebt        | Bank transactions, reconciliation, debt and manual review            |
| IncidentMaintenance | Incidents, evidence, maintenance and related audit                   |
| FinanceReporting    | Financial reports and what-if calculations                           |
| Notifications       | Notification intent, templates, delivery state and retries           |
| PublicInformation   | Approved public projections of location/room/contact information     |

Create folders when code exists. No empty entity/service/controller classes are needed to reserve a module.
The core backend compiles as `src/backend/BHome.Api/BHome.Api.csproj`; logical boundaries and existing CLR namespaces remain unchanged. DigitalSigning is separate.

The PropertyManagement configuration slice is now implemented for Locations, Room Types, Rooms,
Assets and effective-dated BillingPolicies. See [its API and approved decisions](../api/PROPERTY_MANAGEMENT.md).
Application owns the business rules; `Repositories/PropertyManagement/` supplies EF queries,
transaction/Location locking and audit persistence. Legacy OCR configuration creates use the same service.

| Artifact                              | Location pattern                                                      |
| ------------------------------------- | --------------------------------------------------------------------- |
| Domain entity/value/rule              | `src/backend/BHome.Api/Domain/<Module>/`                              |
| Application service/use-case          | `src/backend/BHome.Api/Services/<Module>/`                            |
| Input/output DTO                      | `src/backend/BHome.Api/DTOs/<Module>/`                                |
| Persistence query/command interface   | `src/backend/BHome.Api/Interfaces/<Module>/` or related contract file |
| Application authorization rule        | `src/backend/BHome.Api/Services/IdentityAccess/`                      |
| Controller/HTTP contract mapping      | `src/backend/BHome.Api/Controllers/<Module>/`                         |
| EF entity configuration               | `src/backend/BHome.Api/Data/`                                         |
| EF data-access implementation         | `src/backend/BHome.Api/Repositories/<Module>/`                        |
| Provider adapter/client/options       | `src/backend/BHome.Api/Integrations/<Provider>/`                      |
| Job handler using application service | `src/backend/BHome.Api/BackgroundJobs/<Module>/` or existing service  |
| Domain unit tests                     | `tests/backend/BHome.Domain.UnitTests/<Module>/`                      |
| Application unit tests                | `tests/backend/BHome.Application.UnitTests/<Module>/`                 |
| API/PostgreSQL tests                  | `tests/backend/BHome.IntegrationTests/<Module>/`                      |
| Owner/mobile/public frontend          | `src/<client>/src/features/<feature>/`                                |
| Client tests                          | `tests/<client>/<feature>/`                                           |

## Adding a feature

1. Confirm SRS behavior, affected module, access roles/scope and finalized schema. Coordinate any
   cross-module interface or migration with its owner before editing shared files.
2. Add domain rules/entities independent of EF/HTTP. Write tests for meaningful invariants.
3. Add a focused application service with DTOs and the persistence/provider ports it actually needs.
   Pass cancellation, enforce allowed roles plus server-loaded resource scope, and bound list queries.
4. Implement its data access with the scoped EF context in Infrastructure. Add Fluent API constraints
   and a reviewed migration. Put financial transitions, deduplication, audit and job enqueue in one
   explicit transaction. Use the queue's stable business key, not a new random key per retry.
5. Add a thin versioned API controller. Map request validation and expected application outcomes to
   HTTP explicitly. Never bind EF entities or trust caller-supplied owner/tenant identifiers.
6. Add a small module DI extension when there are registrations to group. Keep `Program.cs` and
   global composition files small; do not create a shared generic service base.
7. Add application isolation tests, appropriate API/database tests and a focused client feature.
   New anonymous endpoints need an approved public DTO and explicit `AllowAnonymous`.
8. Run the documented gates and explain new configuration/migration requirements in the PR.

Cross-module workflows belong in Application orchestration. Avoid direct controller-to-controller
or infrastructure-to-business orchestration. Do not let public projections reuse sensitive internal
DTOs. Shared client-core changes should remain small and be reviewed by another client owner.
