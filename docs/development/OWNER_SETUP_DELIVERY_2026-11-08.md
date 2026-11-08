# Bàn giao triển khai Owner setup P0–P2

Ngày 08/11/2026. Baseline `f899907`, branch `THuy/Fix-API-to-Mock`. Thay đổi trong worktree, chưa commit/push/merge, chưa đưa lên production. [API và cách dùng](../api/OWNER_SETUP_COMPACT24.md).

## Phạm vi và quyết định đã duyệt

Người dùng yêu cầu triển khai toàn bộ P0–P2 trong [phân tích](OWNER_SETUP_HANDOVER_GAP_ANALYSIS_2026-11-08.md), sau đó xác nhận:

- Giữ Location → Room, bỏ Chain/RoomType và chỉ dùng Compact24.
- Template tài sản theo Location, gán Room; desired inventory không thay physical inventory.
- Holding giữ cả phòng khi có cam kết; nhiều Draft chưa cam kết vẫn được phép. Chỉ đủ chữ ký và đủ cọc đã xác minh mới hình thành điều kiện Holding và khóa giá, không khóa vì nộp một phần hay chỉ ký. Owner activation vẫn là lệnh đổi Holding sang Active/Room OnHold.
- Tiền cọc hủy/hết hạn và chênh lệch utility chờ Owner xử lý; không tự hoàn hoặc tự thu thêm.
- Nội quy thay nghĩa vụ hợp đồng cũ phải qua phụ lục đã ký; publish không tự áp dụng hồi tố.

Luồng handover được dùng để rà nghiệp vụ. Checklist/lệnh trong tài liệu đính kèm không được coi là chỉ thị trực tiếp để đổi hệ thống. SRS/report được đối chiếu với các quyết định trên, không khôi phục schema/report cũ.

## Traceability và kết quả

| Yêu cầu/nguồn | Thành phần thay đổi | Acceptance được kiểm tra |
|---|---|---|
| P0; handover §6; BF-03, UC-14/15, GBR-04/18, DBR-02, JOB-05 | ContractHoldingService, ContractService/Repository, Compact24Records, PaymentService, ContractExpiryProcessor | Cọc manual+bank cùng canonical sum; không double count; ký+partial chưa khóa; đủ tiền+chữ ký mới khóa approved giá; cạnh tranh cả phòng bị chặn trước dispatch; expiry giữ tiền/evidence và sync không hồi sinh trạng thái |
| P1; handover §5/10; BF-01/02/07, UC-04/07/08..12/15..17, GBR-01/02/12 | PropertyService, PropertyLifecycleChecks, CompactLocationAssignments, CompactOperationsRepository | Scope trái Location bị từ chối; emergency chặn vận hành; chuyển task/meter/WO/inspection có lịch sử; gỡ Staff còn việc đặc biệt rollback; Resident đã kết thúc không chặn đóng Location và không bị xóa |
| P2 tài sản; handover §7; UC-05/17, GBR-12 | AssetInventoryService, SetupWorkspaceStore, AssetTemplateSyncJob/AutomationWorker | Publish bất biến; clone/pin; sync theo từng Room; phòng không đủ điều kiện bị bỏ qua; trở lại Available được sync; evidence/version/replay/ExistingAsset liên kết không tạo trùng; physical giữ lịch sử |
| P2 utility; handover §8.3; BF-01/05, UC-06/20/21, GBR-07..09, DBR-06/07, JOB-09/10 | UtilityWorkspaceService/PeriodBreakdowns, InvoiceService, InvoiceLine Compact24 snapshot | Tính bậc/quota/rounding decimal; source bill idempotent; thiếu source inputs không được waive; Owner review variance có lý do; profile replacement giữ nguồn; thay giá giữa tháng cần segment evidence và tổng lượng khớp; thiếu quota chặn Finalize; invoice authoritative snapshot giữ qua Tenant read |
| P2 nội quy; handover §9; BF-03/04, UC-15/19, GBR-04/13/18 | OperatingPolicyService, Contract Addendum flow, PDF renderer, notifications | Publish V2 giữ binding V1; cross-Tenant 404; hồ sơ cũ NotRecorded; chưa ký không activate; ký giả lập đủ rồi Owner áp dụng phụ lục không đổi parent terms/occupancy; Applied không hủy; draft phụ lục hủy idempotent và có thể tạo đề xuất mới |

Utility/nội quy nâng cao là mở rộng được người dùng duyệt trong gói này, không diễn giải rằng SRS đã có sẵn toàn bộ endpoint chi tiết.

## Lưu trữ, API và vận hành

- Không thêm bảng, migration hoặc dependency. Truy vấn metadata read-only trên DB local xác nhận `public` có **24 BASE TABLE** sau triển khai. Không chạy migration legacy hoặc seed dữ liệu demo vào DB này.
- Record nghiệp vụ vẫn native; tài liệu setup versioned/evidence registry dùng operational_tasks SYSTEM_JOB JSON + history. Giữ audit actor/time/reason/version, Location advisory transaction lock, stable key và conflict checks. Danh sách tài liệu mỗi kind/Location giới hạn 1.000, vượt trả `setup_workspace_page_limit`; cần pagination/index khi mở rộng quy mô, không âm thầm trả thiếu dữ liệu.
- Thêm ContractKind.Addendum=3, ContractStatus.Applied=9 trên kiểu/mapping đã có khả năng lưu ADDENDUM/parent trong DDL Compact24; không thay giá trị enum cũ.
- Invoice line bổ sung `utilityCalculationSnapshot`; không đưa tài chính tổng hoặc tenant khác vào snapshot. Các khoản đã final vẫn không sửa trực tiếp.
- API local đã khởi động lại trên HTTPS 7240/HTTP 5240. `DevelopmentDatabase:InitializeOnStartup=false`, `Jobs:Enabled=false`, notification sandbox. Chỉ bật riêng OwnerSetup asset sync; không bật tự động job tài chính. Production cần cấu hình worker/provider/storage riêng.
- Health `/health/live` và `/health/ready`: **200**. Swagger đăng ký **371 method/route pairs** toàn API (baseline phân tích 321); kiểm tra trực tiếp các route asset-template, profile replacement, operating-policy, closure-check đều có. Anonymous gọi asset-template trả **401**. Đây là smoke check, không phải nghiệm thu mọi route.

## Kiểm thử thực tế

Chạy trên source đã sửa, dữ liệu synthetic và PostgreSQL database ngẫu nhiên dành riêng cho test. Các con số dưới đây không cộng các lần chạy lặp thành độ phủ.

| Lệnh/nhóm | Kết quả |
|---|---|
| `dotnet build src/backend/BHome.Api/BHome.Api.csproj --no-restore` | PASS, 0 warning, 0 error |
| `dotnet test tests/backend/BHome.Application.UnitTests/BHome.Application.UnitTests.csproj --no-restore` | **333 passed**, 0 failed/skipped |
| `dotnet test tests/backend/BHome.Domain.UnitTests/BHome.Domain.UnitTests.csproj --no-restore` | **106 passed**, 0 failed/skipped |
| Compact24OwnerSetupTests + Assignment + PropertyShape/PropertyRegression + Contract/Invoice/Payment/Task regression + NotificationMvp | **111 passed**, 0 failed/skipped; 2m02s |
| Compact24OwnerSetupTests chạy lại sau mở rộng assertion variance review/cancellation | **13 passed**, 0 failed/skipped; 10s; là tập con của 111, không cộng thêm |
| `git diff --check` | PASS |

Integration dùng launcher local truyền admin connection qua environment, không ghi secret vào report. Filter cụ thể của lượt 111:

```text
FullyQualifiedName~Compact24OwnerSetupTests|FullyQualifiedName~Compact24AssignmentTests|FullyQualifiedName~Compact24PropertyShapeTests|FullyQualifiedName~Compact24PropertyRegressionTests|FullyQualifiedName~Compact24ContractRegressionTests|FullyQualifiedName~Compact24InvoiceRegressionTests|FullyQualifiedName~Compact24PaymentRegressionTests|FullyQualifiedName~Compact24TaskRegressionTests|FullyQualifiedName~Compact24NotificationMvpTests
```

Log local (trong `%TEMP%`): `bhome-owner-setup-final.log`, `bhome-owner-setup-extra.log`, `bhome-owner-setup-unit-final.log`, `bhome-owner-setup-domain-final.log`, `bhome-owner-setup-build-final.log`.

Một lượt lọc rộng `FullyQualifiedName~Compact24` trước khi hoàn tất sửa cuối trả **168 passed / 40 failed / 1 skipped**. Không coi toàn bộ backend xanh. Các lỗi có nhóm test còn kỳ vọng Chain, legacy migration/import và môi trường converter DOCX→PDF. Đã chạy đối chứng commit gốc `f899907` trong detached temporary worktree cho 3 trường hợp và **cả 3 cũng fail**: Expense idempotency fingerprint (query Chain không tồn tại), API audit (đòi GET /chain), Migration rollback (legacy UserNotification.Channels thiếu). Chỉ 3 trường hợp này được chứng minh pre-existing bằng đối chứng, không gán toàn bộ 40 lỗi là lỗi cũ. HoldingTransfer trong lượt rộng đã được sửa và pass trong nhóm regression cuối. Một lượt intermediate có 2 timeout khi DROP DATABASE cleanup chạy cùng baseline; chạy lại tuần tự 111 đã pass.

Chưa chạy: toàn bộ suite sau sửa cuối; E2E frontend; provider ký thật/bank thật/notification thật; load/performance/coverage; backup-recovery. Simulated signing chỉ dùng trong fixture, không chứng minh chữ ký production. Không tuyên bố đạt mục tiêu coverage/p95/NFR từ số lượng test.

## File phục vụ review

- [API controllers](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs), [Location controller](../../src/backend/BHome.Api/Controllers/LocationsController.cs).
- [Setup DTO/ports/math](../../src/backend/BHome.Application/PropertyManagement/SetupWorkspaceContracts.cs), [Asset workflow](../../src/backend/BHome.Application/PropertyManagement/AssetInventoryService.cs), [Utility workflow](../../src/backend/BHome.Application/PropertyManagement/UtilityWorkspaceService.cs), [Period segments](../../src/backend/BHome.Application/PropertyManagement/UtilityPeriodBreakdowns.cs), [Policy workflow](../../src/backend/BHome.Application/PropertyManagement/OperatingPolicyService.cs), [Evidence](../../src/backend/BHome.Application/PropertyManagement/SetupEvidenceService.cs).
- [Compact24 store](../../src/backend/BHome.Infrastructure/Modules/PropertyManagement/Persistence/SetupWorkspaceStore.cs), [Lifecycle checks](../../src/backend/BHome.Infrastructure/Modules/PropertyManagement/Persistence/PropertyLifecycleChecks.cs), [Asset sync job](../../src/backend/BHome.Infrastructure/Modules/PropertyManagement/AssetTemplateSyncJob.cs), [Staff assignment](../../src/backend/BHome.Infrastructure/Persistence/Compact24/CompactLocationAssignments.cs).
- [Holding service](../../src/backend/BHome.Application/Contracts/ContractHoldingService.cs), [Contract service](../../src/backend/BHome.Application/Contracts/ContractService.cs), [Invoice integration](../../src/backend/BHome.Application/Billing/InvoiceService.cs). Mapping, repositories, expiry, payment gate, PDF, notification, DI và development config đi kèm nằm trong git diff cùng gói.
- [Owner setup integration tests](../../tests/backend/BHome.IntegrationTests/Compact24/Compact24OwnerSetupTests.cs), [Utility invoice regression](../../tests/backend/BHome.IntegrationTests/Billing/UtilityTariffInvoiceTests.cs), [Tariff math tests](../../tests/backend/BHome.Application.UnitTests/PropertyManagement/UtilityTariffMathTests.cs); bổ sung regression Holding trong ContractServiceTests/ContractLifecycleApiTests và Compact24WorkflowRegressionTests.

Copy Location, asset transfer, khấu hao, phân ca và khôi phục Chain/RoomType vẫn ngoài scope như báo cáo phân tích. Không thêm auto refund/forfeit/tenant variance allocation hoặc thay electronic signing provider.
