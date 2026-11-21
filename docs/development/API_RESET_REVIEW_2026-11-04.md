# Rà soát API sau reset DB — 04/11/2026

## Nguồn và quyết định

Yêu cầu trực tiếp ngày 04/11/2026 bỏ Chain và RoomType có ưu tiên cao hơn mô hình cũ trong SRS và tài liệu Single System Chain. Location là cấp cấu hình cao nhất; Room thuộc Location. Giá/phí có phạm vi Location hoặc Room, giữ ngày hiệu lực và lịch sử. Không thêm bảng.

Baseline: `b9ff8c6`; working branch `THuy/feature-incident-core-api`. Working tree ban đầu sạch. Incident implementation của người dùng ở `5f5966f`, bị revert bởi `4ea7e57`; dùng lại code/contract đã có và chuyển persistence, không khôi phục migration cũ.

| Hành vi / nguồn                                      | Thành phần                                                                                               | Kiểm chứng cần chạy                                                                                                                   |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| UC-01..03, GBR-01/02/13: JWT, refresh, RBAC          | Identity, users, refresh_tokens, audit                                                                   | invalid/expired/revoked JWT, refresh rotation/reuse/concurrency, role change                                                          |
| BF-02, UC-08..12, DBR-01: Staff Location scope/task  | Assignment, ResourceAccess, OperationalTask                                                              | assignment theo ngày Việt Nam, cross-Location, mất assignment với token cũ, task lifecycle/races                                      |
| BF-01, UC-04..07, GBR-08 + yêu cầu bỏ Chain/RoomType | PropertyService, Capture, MainDraft, Compact24                                                           | tạo Location/Room trên DB trống, không bootstrap Chain/catalog, scope/duplicate, giá Room ghi đè Location, immutable historical price |
| BF-07, UC-26..30, GBR-11/12/18                       | IncidentService/repository/files, incident_reports, operational_tasks, operating_expenses, notifications | report/scope/tenant isolation, emergency, Owner decision, Work Order approval/verification, evidence privacy, replay/race             |

SRS `(2)` và SDS `(5)` có trong `docs/reports`; mô hình Compact24 tại `docs/database/2026-11-03/compact-24`. Không dùng schema/entity như bằng chứng rằng API đã tồn tại. Kiểm thử dùng dữ liệu tổng hợp trong DB tạm, không dùng dữ liệu Tenant thật.

## Kết quả thực thi

Đang thực hiện; kết quả build/test và giới hạn sẽ được cập nhật sau khi chạy.

## Danh s?ch file thay ??i

- `docs/api/API_CONVENTIONS.md`
- `docs/api/PROPERTY_MANAGEMENT.md`
- `docs/database/2026-11-03/README.md`
- `docs/database/2026-11-03/compact-24/BHOME_24_TABLES.dbml`
- `docs/database/2026-11-03/compact-24/BHOME_24_TABLES.sql`
- `docs/database/2026-11-03/compact-24/BHOME_Database_Design.json`
- `docs/database/2026-11-03/compact-24/DESIGN_24_TABLES.md`
- `docs/database/2026-11-03/compact-24/IMPLEMENTATION_REPORT.md`
- `docs/development/SINGLE_SYSTEM_CHAIN.md`
- `scripts/Update-LocalDatabase.ps1`
- `src/backend/BHome.Api/Configuration/ApiFoundation.cs`
- `src/backend/BHome.Api/Controllers/Ocr/CaptureController.cs`
- `src/backend/BHome.Api/Controllers/PropertyManagement/ChainController.cs`
- `src/backend/BHome.Api/Controllers/PropertyManagement/PropertyControllers.cs`
- `src/backend/BHome.Api/Middleware/ApiExceptionHandler.cs`
- `src/backend/BHome.Api/Program.cs`
- `src/backend/BHome.Application/Billing/InvoiceService.cs`
- `src/backend/BHome.Application/Contracts/MainDraftService.cs`
- `src/backend/BHome.Application/Ocr/CaptureContracts.cs`
- `src/backend/BHome.Application/Ocr/CaptureService.cs`
- `src/backend/BHome.Application/PropertyManagement/PropertyContracts.cs`
- `src/backend/BHome.Application/PropertyManagement/PropertyService.cs`
- `src/backend/BHome.Domain/IdentityAccess/Permissions.cs`
- `src/backend/BHome.Domain/IdentityAccess/RolePermissions.cs`
- `src/backend/BHome.Infrastructure/BHome.Infrastructure.csproj`
- `src/backend/BHome.Infrastructure/Contracts/ContractRepository.cs`
- `src/backend/BHome.Infrastructure/Contracts/ContractWorkflowRepository.cs`
- `src/backend/BHome.Infrastructure/DependencyInjection.cs`
- `src/backend/BHome.Infrastructure/Jobs/PostgresJobWorker.cs`
- `src/backend/BHome.Infrastructure/Modules/PropertyManagement/Persistence/PostgresPropertyRepository.cs`
- `src/backend/BHome.Infrastructure/Ocr/CaptureRepository.cs`
- `src/backend/BHome.Infrastructure/Persistence/Compact24/Compact24DevelopmentDatabase.cs`
- `src/backend/BHome.Infrastructure/Persistence/Compact24/Compact24DomainModel.cs`
- `src/backend/BHome.Infrastructure/Persistence/Compact24/Compact24DomainWriter.cs`
- `src/backend/BHome.Infrastructure/Persistence/Compact24/Compact24EventsAndLedger.cs`
- `src/backend/BHome.Infrastructure/Persistence/Compact24/Compact24MigrationMap.cs`
- `src/backend/BHome.Infrastructure/Persistence/Compact24/Compact24PropertyGuards.cs`
- `src/backend/BHome.Infrastructure/Persistence/Compact24/Compact24Records.cs`
- `src/backend/BHome.Infrastructure/Persistence/Compact24/Compact24Schema.cs`
- `tests/backend/BHome.Application.UnitTests/PropertyManagement/PropertyServiceTests.cs`
- `tests/backend/BHome.Domain.UnitTests/IdentityAccess/RolePermissionTests.cs`
- `tests/backend/BHome.IntegrationTests/Billing/InvoiceApiTests.cs`
- `tests/backend/BHome.IntegrationTests/Compact24/Compact24DevelopmentDatabaseTests.cs`
- `tests/backend/BHome.IntegrationTests/Compact24/Compact24MigrationTests.cs`
- `tests/backend/BHome.IntegrationTests/Compact24/Compact24WorkflowRegressionTests.cs`
- `tests/backend/BHome.IntegrationTests/Compact24/WorkflowTestUsers.cs`
- `tests/backend/BHome.IntegrationTests/Contracts/ContractLifecycleApiTests.cs`
- `tests/backend/BHome.IntegrationTests/Contracts/MainDraftApiTests.cs`
- `tests/backend/BHome.IntegrationTests/Ocr/CaptureWorkflowTests.cs`
- `tests/backend/BHome.IntegrationTests/PaymentsDebt/PaymentLedgerTests.cs`
- `tests/backend/BHome.IntegrationTests/PropertyManagement/PropertyApiTests.cs`
- `tests/backend/BHome.IntegrationTests/PropertyManagement/SingleChainTests.cs`
- `tests/backend/BHome.IntegrationTests/StaffOperations/OperationalTaskApiTests.cs`
- `tools/BHome.Compact24Migration/Program.cs`
- `tools/BHome.DatabaseUpgrade/Program.cs`
- `tools/BHome.LocalDevelopment/AdjustmentDemoSeed.cs`
- `tools/BHome.LocalDevelopment/BillingAutomationDemoSeed.cs`
- `tools/BHome.LocalDevelopment/ContractDemoSeed.cs`
- `tools/BHome.LocalDevelopment/ContractLifecycleDemoSeed.cs`
- `tools/BHome.LocalDevelopment/InvoiceDemoSeed.cs`
- `tools/BHome.LocalDevelopment/LocalSchemaSeed.cs`
- `tools/BHome.LocalDevelopment/LocalTestAccounts.cs`
- `tools/BHome.LocalDevelopment/MainDraftSettingsSeed.cs`
- `tools/BHome.LocalDevelopment/PaymentDemoSeed.cs`
- `docs/api/INCIDENT_CORE_API_PROPOSAL.md`
- `docs/api/INCIDENT_MAINTENANCE.md`
- `docs/api/LOCATION_ROOM_API.md`
- `docs/database/2026-11-03/compact-24/UPGRADE_LOCATION_ROOM.sql`
- `docs/development/API_RESET_REVIEW_2026-11-04.md`
- `docs/development/INCIDENT_CORE_API_DELIVERY.md`
- Incident được gộp trong `docs/testing/postman/BHome.Simple.postman_collection.json`, request 119–181 cùng cấp, không chia folder; dùng `BHome.Local.postman_environment.json`. Các file NguyenQuocHuy giữ nguyên bản gốc theo yêu cầu sau cùng.
- `src/backend/BHome.Api/Configuration/IncidentApiOperationFilter.cs`
- `src/backend/BHome.Api/Controllers/IncidentMaintenance/IncidentReportsController.cs`
- `src/backend/BHome.Api/Controllers/IncidentMaintenance/WorkOrdersController.cs`
- `src/backend/BHome.Application/IncidentMaintenance/IncidentContracts.cs`
- `src/backend/BHome.Application/IncidentMaintenance/IncidentService.cs`
- `src/backend/BHome.Domain/IncidentMaintenance/IncidentRecords.cs`
- `src/backend/BHome.Infrastructure/Modules/IncidentMaintenance/IncidentFiles.cs`
- `src/backend/BHome.Infrastructure/Modules/IncidentMaintenance/IncidentNotificationDelivery.cs`
- `src/backend/BHome.Infrastructure/Modules/IncidentMaintenance/Persistence/IncidentConfiguration.cs`
- `src/backend/BHome.Infrastructure/Modules/IncidentMaintenance/Persistence/IncidentRepository.cs`
- `src/backend/BHome.Infrastructure/Persistence/Compact24/Compact24PropertyUpgrade.cs`
- `tests/backend/BHome.Application.UnitTests/IncidentMaintenance/IncidentServiceTests.cs`
- `tests/backend/BHome.Domain.UnitTests/IncidentMaintenance/WorkOrderRulesTests.cs`
- `tests/backend/BHome.IntegrationTests/Compact24/Compact24PropertyShapeTests.cs`
- `tests/backend/BHome.IntegrationTests/IncidentMaintenance/IncidentApiTests.cs`
- `tests/backend/BHome.IntegrationTests/IncidentMaintenance/IncidentFixture.cs`
- `docs/testing/postman/README.md`
