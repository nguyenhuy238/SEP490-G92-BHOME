# BHOME — Báo cáo tích hợp và kiểm chứng 17/11/2026

## A. Initial audit

Branch bắt đầu và kết thúc là `member/QHuy`. Working tree sạch trước thay đổi.
Audit nguồn, tài liệu, schema và CI được lưu tại
[ghi chú kiến trúc](../architecture/INTEGRATED_LIFECYCLE_2026-11-16.md).
Yêu cầu trong phiên mở rộng BF-01/02/03/04/07 và FE-07/08, theo các UC tương ứng.
Đây là tài liệu bổ sung SRS/SDD/test/user guide cho thay đổi trong phiên.

| Phần           | Hiện trạng được xác minh                                                             | Quyết định triển khai                                                     |
| -------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Persistence    | PostgreSQL Compact24, JSONB workspace có version/history, Location transaction lock  | Tái sử dụng container và invariants hiện có                               |
| Owner          | `ux_users_single_owner`, Owner có phạm vi deployment                                 | Giữ một Owner theo quyết định người dùng, kiểm thử cách ly Staff/Tenant   |
| Location/Asset | Setup Wizard, cấu hình mẫu/copy, Asset nhóm và Quantity, kiểm kê/handover            | Mở rộng hồ sơ/policy/thiết bị con, giữ nguồn Quantity                     |
| Cư trú         | Trạng thái từng resident trong Contract, Tenant cập nhật kết quả, Owner review       | Bổ sung ngày thực tế, xác nhận chỗ ở độc lập và optimistic reference      |
| Vận hành       | Task, trách nhiệm Staff hiện hành, ảnh, lịch sử, recurring jobs                      | Tạo kỳ inspection và checklist snapshot trên task hiện có                 |
| BF-07          | Proactive Work Order, Owner duyệt kế hoạch, Staff thực hiện, Owner xác minh, expense | Liên kết remediation từ inspection, giữ workflow và idempotency tài chính |
| Finance        | Rate versions, invoice/payment snapshots, verified collections, OPEX                 | Thêm theo dõi thuế và snapshot tham chiếu, tái sử dụng report             |
| Client         | Owner Web React/MUI, Mobile Expo/React Native, client-core                           | Dùng API thật và navigation hiện có                                       |

Baseline Release build và lint pass. Full backend baseline gặp Docker/Testcontainers
và được dừng khi còn đang chạy. Baseline đó không chứng minh toàn bộ suite đã pass.
Node hệ thống 24 gây lỗi Mobile baseline. Các lượt kiểm tra sau dùng Node 22.23.4
đúng major của CI. PostgreSQL local là 18.6, workflow CI sử dụng PostgreSQL 16.

## B. Implementation summary

### Phase 1

- Location Settings có hồ sơ pháp lý, PDF/PNG/JPEG tối đa 5 MB, hạn nullable,
  archive, version/history và download được kiểm tra quyền. File cũ giữ theo revision.
- Category rõ nghĩa, policy Draft/Published bất biến sau publish, checklist/căn cứ/
  chu kỳ do Owner cấu hình. Copy Published thành Draft độc lập ở cơ sở đích.
- Equipment Unit gắn Asset nhóm, serial tùy chọn, thông tin kỹ thuật, trạng thái,
  retirement và replacement. Unsafe vẫn tính vào tồn tại vật lý. Giảm Quantity
  xuống dưới số unit đang tồn tại bị chặn trong cùng Location lock.
- Summary nhận biết policy đã công bố, đúng category và ngày hiệu lực. Các phiên
  bản đã được thay thế có hiệu lực bị loại khỏi tập phù hợp. Owner chọn policy cho
  schedule, không có quy tắc tự chọn một policy giữa nhiều ứng viên độc lập.
- Owner Web có form chi tiết trong Asset hiện có. Owner Mobile có danh sách,
  thiết bị, kỳ kiểm tra, hồ sơ và tải các phiên bản riêng tư.
- Các file chính nằm ở `Application/PropertyManagement/AssetLifecycle*`,
  `LocationLegalRecordService`, `SetupWorkspaceStore`, các controller cùng module,
  `client-core/assetLifecycle.ts`, Web `LocationLegalRecords`, `AssetLifecyclePanel`,
  Mobile `OwnerLocationRecordsScreen`, `PrivateFileDownload`.

### Phase 2

- Mở rộng UC-18 hiện có ở mức từng ContractResident. Ngày cư trú thực tế và
  trackingActive phản ánh đối tượng thực sự đang cư trú.
- Owner ghi nhận xác nhận chỗ ở trước kết quả đăng ký, kèm ghi chú, reference và
  deadline nullable do Owner xác định. Review kết quả Completed hiện có được giữ.
- Tenant đăng ký chính thức bên ngoài BHOME và gửi trạng thái/bằng chứng.
  Staff bị chặn khỏi thao tác cư trú. Không tạo recurring reminder mới.
- Client mới gửi reference để chống cập nhật stale. Giữ tương thích client cũ chưa
  gửi reference. Upload chụp reference trước I/O và giữ file lịch sử.
- Sửa các lớp `OperationsContracts`, `OperationsService`,
  `CompactOperationsRepository`, residence client và các màn Owner/Tenant hiện có.

### Phase 3

- Schedule gắn policy/version, ngày bắt đầu, chu kỳ và hạn hoàn thành. Scheduler
  dùng ID bền vững theo schedule/ngày, Location transaction lock và PK/source key.
  Job và trigger Owner dùng chung logic. Thiếu unit hoặc category không phù hợp
  được đưa về NeedsConfiguration. Asset/unit Retired được loại khỏi kỳ mới.
- Kỳ giữ snapshot checklist, policy, quantity và unit/version. Staff đang phụ trách
  lưu batch, ảnh task và tiến độ. Thiếu kết quả giữ Incomplete và chặn submit.
- Failed đánh dấu Unsafe ngay khi ghi nhận. Owner Verify/Rework/Cancel có ghi chú.
  Cancel đồng bộ task. Action task chung kiểm tra trạng thái inspection để chặn
  bỏ qua checklist hoặc Owner review.
- Kỳ Verified/Failed tạo proactive Work Order với liên kết và khóa retry bền vững.
  Kế hoạch, thực hiện, evidence, verification và expense đi qua BF-07 hiện có.
  Reinspection được Owner xác minh sau xử lý mới khôi phục unit. Sửa metadata trực
  tiếp từ Unsafe sang InService bị chặn.
- Các file chính là `EquipmentInspectionContracts/Service/Scheduler`,
  `EquipmentInspectionJob`, `EquipmentInspectionsController`, các transaction
  adapter Task/Incident, client `equipmentInspections.ts`, Web/Mobile inspection panel.

### Phase 4

- Finance có chủ thể kinh doanh liên kết nhiều Location, hiệu lực và version.
  Kỳ nghĩa vụ giữ snapshot profile/version, Location và verified collections tham
  chiếu. Subject/kỳ/snapshot được giữ qua cập nhật. Paid amount dương cần ngày
  thực hiện và phiên bản chứng từ thuộc phạm vi snapshot.
- Web hỗ trợ tạo/cập nhật, phân trang, lịch sử và tải chứng từ đã ghim phiên bản.
  Mobile hỗ trợ xem danh sách/snapshot qua API thật.
- Tenant/Staff tạo yêu cầu dữ liệu từ tài khoản. Owner xem queue và phản hồi có
  resolution/basis bắt buộc, version và lịch sử. Request ID giữ qua retry. Không có
  thao tác tự xóa User, Contract, Invoice hay Payment.
- Owner dashboard nhận số liệu attention từ bản ghi nguồn. Rate, invoice/payment
  snapshots và các phép tính tài chính hiện có được tái sử dụng.
- Các file chính là `TaxTrackingService/Controller`,
  `PersonalDataRequestService/Repository/Controller`, `LifecycleAttention*`, client
  `taxPrivacy.ts`, Web `TaxTrackingPage`, `PersonalDataRequestsPanel`, Mobile
  `OwnerTaxRecordsScreen`, `PersonalDataRequestsScreen`.

Không thêm Entity/table EF hoặc migration DDL. Các loại tài liệu mới dùng logical
record trong workspace Compact24. Privacy requests nằm trong JSONB của User.
Các endpoint, trạng thái, quyền và retry được ghi tại
[API tích hợp](../api/INTEGRATED_LIFECYCLE.md).

## C. Database safety

- Dữ liệu local được đọc từ cấu hình riêng tư, không ghi connection string vào báo cáo.
- Backup trước kiểm tra ghi UI nằm tại
  `.tools/legal-integration/bhome-before-feature-check.dump`, được Git ignore.
  Chưa thực hiện restore backup này.
- Không chạy migration hoặc backfill cho feature. Probe sau triển khai pass với
  24 bảng public, 17 migration đã áp dụng, 0 pending và schema readiness hợp lệ.
- Các test PostgreSQL tạo fixture database riêng. Test tài chính/privacy xác nhận
  Contract, Invoice, Payment và User vẫn tồn tại sau phản hồi yêu cầu xóa.
- UI verification thêm dữ liệu tổng hợp vào database phát triển local và object
  storage local. Có cập nhật hồ sơ tài khoản Tenant demo tổng hợp để đi qua profile
  gate trước kiểm tra Mobile. Không thực hiện cleanup bằng xóa dữ liệu nghiệp vụ.
- MinIO native được build từ tag trùng Dockerfile của repo để kiểm tra private upload.
  Binary/data/log local nằm trong `.tools`, không đưa vào commit. Jobs và các kênh
  gửi tự động bị vô hiệu hóa ở process API kiểm tra.

## D. Test results

Các lượt có thể trùng test. Không cộng các dòng thành coverage hoặc tổng số test duy nhất.
Log/TRX local ở `.tools/legal-integration`. Số liệu full backend dưới đây thuộc lượt
trước sửa fixture composition, các lượt kiểm tra lại được ghi riêng.

| Test suite                           | Command                                                                                                                                                                                               | Passed | Failed | Skipped | Status                               |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------ | ------- | ------------------------------------ |
| Application Unit                     | `dotnet test src/backend/BHome.sln -c Release --no-build --settings tests/backend/ci.runsettings --logger trx -m:1 --blame-hang-timeout 3m`                                                           | 573    | 0      | 0       | Passed                               |
| Domain Unit                          | Cùng lượt full solution                                                                                                                                                                               | 114    | 0      | 0       | Passed                               |
| Infrastructure Unit                  | Cùng lượt full solution                                                                                                                                                                               | 34     | 0      | 0       | Passed                               |
| DigitalSigning Unit                  | Cùng lượt full solution                                                                                                                                                                               | 41     | 0      | 0       | Passed                               |
| Integration full                     | Cùng lượt full solution                                                                                                                                                                               | 898    | 329    | 28      | Failed, phân tích bên dưới           |
| Plan Integration                     | Cùng lượt full solution                                                                                                                                                                               | 0      | 0      | 142     | Skipped theo điều kiện fixture       |
| Owner Setup/Lifecycle API regression | `dotnet test tests/backend/BHome.IntegrationTests/BHome.IntegrationTests.csproj -c Release --settings tests/backend/ci.runsettings --filter FullyQualifiedName~Compact24OwnerSetupTests --logger trx` | 80     | 0      | 0       | Passed, cập nhật lượt cuối ở G       |
| Tax/Privacy API                      | Filter `FullyQualifiedName~TaxTrackingSupports\|FullyQualifiedName~PersonalDataRequestsAre`                                                                                                           | 2      | 0      | 0       | Passed, nằm trong Owner Setup        |
| Inspection API workflow              | Filter `FullyQualifiedName~EquipmentInspectionBatchesAreScoped`                                                                                                                                       | 1      | 0      | 0       | Passed, nằm trong Owner Setup        |
| Composition/OCR regression sau sửa   | Filter `FullyQualifiedName~PersistenceCompositionTests\|FullyQualifiedName~OcrApiTests\|FullyQualifiedName~ExperimentalMeterRuntimeTests`                                                             | 42     | 0      | 8       | Passed                               |
| Owner Web toàn bộ                    | `npm test` với Node 22                                                                                                                                                                                | 747    | 0      | 0       | Passed, cập nhật lượt sau npm ci ở G |
| Mobile toàn bộ                       | `npm test` với Node 22                                                                                                                                                                                | 1342   | 0      | 0       | Passed, cập nhật lượt sau npm ci ở G |
| Owner Web browser automation         | Playwright, API/PostgreSQL/MinIO local thật                                                                                                                                                           | —      | 0      | —       | Passed trong phạm vi dưới đây        |
| Mobile web browser automation        | Playwright, Tenant request và Owner private download                                                                                                                                                  | —      | 0      | —       | Passed trong phạm vi dưới đây        |
| Native Android/iOS manual            | Chưa có lượt thực hiện trên thiết bị                                                                                                                                                                  | —      | —      | —       | Not tested                           |

329 lỗi full Integration được phân loại từ TRX thành 297 lỗi Docker/fixture Docker,
28 lỗi service graph ở fixture schema cũ, 1 kỳ vọng danh sách job và 3 lỗi chuyển
đổi PDF. Đã sửa fixture schema cũ và kỳ vọng job, lượt composition/OCR sau đó pass.
Ba lỗi PDF trả `contract_pdf_conversion_failed` cần môi trường converter khả dụng.
Chưa có lượt baseline hoàn chỉnh chứng minh cả ba case PDF trước thay đổi.
Full Integration chưa có lượt xanh sau sửa và CI tổng thể còn bị chặn.

Browser test đi qua login và các form hiện có. Đã thực hiện Owner tạo chủ thể nhiều
cơ sở, tạo kỳ theo dõi thuế, upload hồ sơ PDF vào MinIO, mở các trang và kiểm tra
tràn ngang ở 390px. Tenant gửi yêu cầu qua Mobile web, Owner phản hồi qua Owner Web.
Đã tải PDF lịch sử trên Web, xác nhận signature `%PDF-` và truy cập ẩn danh trả 401.
Owner Mobile web cũng chọn Location và tải PDF riêng tư thành công từ bundle mới.
Đây là browser automation. Chưa có manual acceptance do người dùng thực hiện.

## E. Business flow verification

| Business Flow | Scenario                                                               | Backend                                                     | Web                                     | Mobile                                       | Result                            | Evidence                                  |
| ------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------- | -------------------------------------------- | --------------------------------- | ----------------------------------------- |
| BF-01         | Hồ sơ có/không hạn, thay file, stale, tải trái quyền                   | Passed API                                                  | Passed browser upload/layout            | Passed Mobile web download, native chưa chạy | Partially verified                | Legal API tests, location screenshots     |
| BF-01         | Policy publish/copy/version, units Quantity/Unsafe/Retired/replacement | Passed API                                                  | Component/build, chưa browser toàn flow | Read API, chưa native toàn flow              | Partially verified                | Lifecycle API tests                       |
| BF-02/07      | 4 unit, 1 failed, lưu dở, rework, repair, expense retry, reinspection  | Passed API                                                  | Component/build, chưa browser toàn flow | Batch UI/client tests, chưa native toàn flow | Partially verified                | EquipmentInspection test, rule unit tests |
| BF-02         | Cancel kỳ kiểm tra, chặn Staff, giữ lịch sử                            | Passed API                                                  | UI action có API                        | UI action có API                             | Partially verified                | EquipmentInspection test                  |
| BF-03/04      | Ngày cư trú thực tế và Owner xác nhận chỗ ở trước kết quả              | Passed API                                                  | Residence component tests               | Client tests/build                           | Partially verified                | Residence tests, source mapping UC-18     |
| BF-05/06      | Invoice/payment và rate/snapshot hiện có                               | Có regression trong full suite, một phần bị Docker/PDF chặn | Có test Web hiện có                     | Có test Mobile hiện có                       | Partially verified                | Full TRX, frontend suite                  |
| FE-08         | Chủ thể nhiều Location, snapshot thuế và chứng từ đã nộp               | Passed API                                                  | Passed browser create                   | Read API/build                               | Partially verified                | Tax API test, tax screenshots             |
| FE-07         | Tenant request, Owner có basis/version/history, giữ tài chính          | Passed API                                                  | Passed browser review                   | Passed Mobile web submit                     | Passed trong phạm vi browser/API  | Privacy tests, screenshots/log            |
| GBR-01/02/13  | Staff ngoài Location/Tenant khác/Owner-only file và finance            | Passed các negative API case mới                            | Route/client checks                     | Role/client tests                            | Passed trong phạm vi test đã chạy | Owner Setup/Tax/Privacy/Residence tests   |
| UC-18         | Nộp/duyệt thực tế trên VNeID                                           | Ngoài BHOME                                                 | Ngoài BHOME                             | Ngoài BHOME                                  | Not tested                        | Không có tích hợp government API          |

Ảnh nằm tại `.impeccable/review`. Finish review độc lập đã trả `ship` cho ba màn Web
tax/location/privacy ở desktop và màn hẹp, sau sửa vùng cuộn bảng và nút bị co.
Documenter xác nhận giữ PRODUCT/DESIGN/theme hiện hữu. Một advisory radius 8px tại
TaskDetailDrawer thuộc mã sẵn có. Review này có phạm vi giới hạn, không chứng nhận
native Mobile hoặc mọi trạng thái của các feature khác.

## F. Git commits

| Phase             | Commit hash                 | Commit subject                                                   | Short description                                               |
| ----------------- | --------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------- |
| Audit             | `73c5aaf6`                  | docs: audit workflows and plan integrated lifecycle changes      | Audit/traceability và kế hoạch                                  |
| Phase 1           | `f0762a29`                  | feat: integrate legal documents and asset lifecycle foundations  | Location records, policies, child equipment và clients          |
| Phase 2           | `adfc4c9d`                  | feat: extend resident-level accommodation confirmation           | UC-18 confirmation, concurrency và history                      |
| Phase 3           | `9ba1b1fc`                  | feat: integrate equipment inspections with tasks and maintenance | Scheduler, checklist, task, BF-07 remediation                   |
| Phase 4           | `bad45cb9`                  | feat: integrate finance tax records and personal data requests   | Finance tracking, privacy và attention                          |
| Final integration | Xem commit chứa báo cáo này | fix: complete lifecycle integration and regression checks        | Responsive/file/pagination/safety/composition fixes và evidence |

## G. CI readiness

Đã đọc `.github/workflows/ci.yml`, đối chiếu lệnh thật và chạy local. Lượt sau
`npm ci` pass 109 file/747 test Web và 128 file/1.342 test Mobile. Sau sửa typed
binary request tại `usePropertySetupApi`, lượt hồi quy Location pass 20 test trong
2 file, browser download pass và build chạy lại pass. Một lỗi format ở tài liệu
local database có trước thay đổi đã được sửa chỉ bằng Prettier. Không có push
hoặc GitHub Actions run mới trong phiên này.

| Check                                                   | Kết quả đã thực hiện                                 |
| ------------------------------------------------------- | ---------------------------------------------------- |
| dotnet restore                                          | Passed                                               |
| Release solution build                                  | Passed, 0 warning/0 error                            |
| dotnet format verify                                    | Passed sau sửa cuối                                  |
| npm ci Node 22                                          | Passed, 903 packages                                 |
| lint/typecheck/test/build/format                        | Passed lint, Mobile typecheck, test, build và format |
| Mobile Expo export web max-workers 2                    | Passed sau bổ sung private download                  |
| Test-SePaySandboxScripts.ps1                            | Passed                                               |
| Hai docker compose config trong CI                      | Passed                                               |
| Docker MinIO/LibreOffice image build và test cần Docker | Blocked vì daemon không khả dụng                     |
| GitHub Actions                                          | Not run                                              |

Chưa đủ điều kiện kết luận mọi CI gate xanh. Cần môi trường có Docker/converter,
PostgreSQL 16 như CI và một lượt full suite thành công trước duyệt merge.

Owner Setup/Lifecycle regression cuối pass 80 test. Sau bổ sung kiểm tra policy
tương lai và nguồn thay thế, lượt policy/inspection riêng pass thêm 2 test.
Không có thay đổi lockfile hoặc dependency. Git diff whitespace check pass.
Cache Mobile được invalidated sau thao tác inspection thành công để danh sách
task/bảo trì đọc lại trạng thái backend. Lượt regression cache/privacy sau sửa pass.
Các thay đổi đã commit trên `member/QHuy`, kiểm tra working tree sau commit ở cuối phiên.

## H. Remaining issues

- Chưa chạy native Android/iOS và chưa có manual acceptance của Owner/Staff/Tenant.
  E2E inspection và residence hiện được chứng minh chủ yếu bằng API/component test.
- Full backend suite còn dependency Docker/PDF. Không suy diễn kết quả native
  PostgreSQL 18 thành kết quả của runner PostgreSQL 16.
- Deadline cư trú, chu kỳ bảo dưỡng/kiểm định và retention cụ thể cần căn cứ được
  Owner phê duyệt cho từng trường hợp. Hệ thống cho lưu căn cứ/cấu hình, không có
  ngưỡng thuế, công thức thuế hoặc chu kỳ pháp lý tự tạo.
- Lịch sử kiểm tra/bảo trì được giữ trong inspection/task/Work Order. Chưa có
  projection riêng tổng hợp đủ mọi ngày kiểm tra/bảo dưỡng/kiểm định kế tiếp cho
  từng unit. Các màn hiện có dẫn tới bản ghi nguồn.
- Client cư trú cũ vẫn được nhận khi thiếu reference để giữ tương thích. Chỉ các
  client mới gửi token mới có đầy đủ stale-write protection ở đường cập nhật đó.
- Theo dõi privacy lưu quyết định và căn cứ. Hành động pháp lý/retention thực tế
  do Owner xử lý theo quyền và chính sách được duyệt.
- Backup đã tạo, restore chưa diễn tập. Chưa đo coverage, p95, tải đồng thời hoặc
  OCR accuracy cho phần thay đổi này.

Các giới hạn trên giữ trạng thái công việc ở mức đã triển khai và kiểm chứng theo
phạm vi nêu trong bảng, chưa đạt kết luận hoàn tất 100% Definition of Done.

## Phụ lục — File thay đổi

- `docs/api/INTEGRATED_LIFECYCLE.md`
- `docs/architecture/INTEGRATED_LIFECYCLE_2026-11-16.md`
- `docs/development/INTEGRATED_LIFECYCLE_VERIFICATION_2026-11-17.md`
- `docs/development/LOCAL_DATABASE_2026-11-16.md`
- `packages/client-core/src/assetLifecycle.ts`
- `packages/client-core/src/equipmentInspections.ts`
- `packages/client-core/src/residence.ts`
- `packages/client-core/src/sharedConfiguration.ts`
- `packages/client-core/src/taxPrivacy.ts`
- `src/backend/BHome.Api/Controllers/Operations/LifecycleAttentionController.cs`
- `src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs`
- `src/backend/BHome.Api/Controllers/Operations/PersonalDataRequestsController.cs`
- `src/backend/BHome.Api/Controllers/PropertyManagement/AssetLifecycleController.cs`
- `src/backend/BHome.Api/Controllers/PropertyManagement/EquipmentInspectionsController.cs`
- `src/backend/BHome.Api/Controllers/PropertyManagement/LocationLegalRecordsController.cs`
- `src/backend/BHome.Api/Controllers/TaxTrackingController.cs`
- `src/backend/BHome.Application/Finance/TaxTrackingService.cs`
- `src/backend/BHome.Application/Operations/LifecycleAttentionService.cs`
- `src/backend/BHome.Application/Operations/OperationsContracts.cs`
- `src/backend/BHome.Application/Operations/OperationsService.cs`
- `src/backend/BHome.Application/Operations/PersonalDataRequestService.cs`
- `src/backend/BHome.Application/PropertyManagement/AssetLifecycleContracts.cs`
- `src/backend/BHome.Application/PropertyManagement/AssetLifecycleService.cs`
- `src/backend/BHome.Application/PropertyManagement/EquipmentInspectionContracts.cs`
- `src/backend/BHome.Application/PropertyManagement/EquipmentInspectionScheduler.cs`
- `src/backend/BHome.Application/PropertyManagement/EquipmentInspectionService.cs`
- `src/backend/BHome.Application/PropertyManagement/LocationConfigurationCopyService.cs`
- `src/backend/BHome.Application/PropertyManagement/LocationLegalRecordService.cs`
- `src/backend/BHome.Application/PropertyManagement/SetupWorkspaceContracts.cs`
- `src/backend/BHome.Application/StaffOperations/OperationalTaskService.cs`
- `src/backend/BHome.Domain/Billing/MeterCapture.cs`
- `src/backend/BHome.Infrastructure/DependencyInjection.cs`
- `src/backend/BHome.Infrastructure/Modules/IncidentMaintenance/Persistence/IncidentRepository.cs`
- `src/backend/BHome.Infrastructure/Modules/Operations/CompactOperationsRepository.cs`
- `src/backend/BHome.Infrastructure/Modules/Operations/LifecycleAttentionRepository.cs`
- `src/backend/BHome.Infrastructure/Modules/Operations/PersonalDataRequestRepository.cs`
- `src/backend/BHome.Infrastructure/Modules/PropertyManagement/EquipmentInspectionJob.cs`
- `src/backend/BHome.Infrastructure/Modules/PropertyManagement/Persistence/SetupWorkspaceStore.cs`
- `src/backend/BHome.Infrastructure/Modules/StaffOperations/Persistence/PostgresOperationalTaskRepository.cs`
- `src/mobile/src/__tests__/equipmentInspections.test.ts`
- `src/mobile/src/__tests__/owner-operations.test.tsx`
- `src/mobile/src/__tests__/query-cache.test.ts`
- `src/mobile/src/__tests__/taxPrivacy.test.ts`
- `src/mobile/src/components/PrivateFileDownload.tsx`
- `src/mobile/src/features/workspace/EquipmentInspectionPanel.tsx`
- `src/mobile/src/features/workspace/navigation.ts`
- `src/mobile/src/features/workspace/WorkspaceScreenView.tsx`
- `src/mobile/src/lib/queryPolicies.ts`
- `src/mobile/src/screens/OperationalTaskScreens.tsx`
- `src/mobile/src/screens/OwnerLocationRecordsScreen.tsx`
- `src/mobile/src/screens/OwnerOperationsScreen.tsx`
- `src/mobile/src/screens/OwnerResidenceScreen.tsx`
- `src/mobile/src/screens/OwnerTaxRecordsScreen.tsx`
- `src/mobile/src/screens/PersonalDataRequestsScreen.tsx`
- `src/mobile/src/screens/ProfileScreen.tsx`
- `src/mobile/src/screens/StaffTaskDetailScreen.tsx`
- `src/mobile/src/screens/TenantResidenceScreen.tsx`
- `src/owner-web/src/app/router.tsx`
- `src/owner-web/src/features/auth/components/PersonalDataRequestsPanel.test.tsx`
- `src/owner-web/src/features/auth/components/PersonalDataRequestsPanel.tsx`
- `src/owner-web/src/features/auth/pages/AccountProfilePage.tsx`
- `src/owner-web/src/features/configuration/ApiConfigurationCopy.tsx`
- `src/owner-web/src/features/configuration/pages/SharedTemplateEditor.tsx`
- `src/owner-web/src/features/dashboard/LifecycleAttention.tsx`
- `src/owner-web/src/features/dashboard/pages/LiveDashboardPage.tsx`
- `src/owner-web/src/features/finance/FinanceHomePage.test.tsx`
- `src/owner-web/src/features/finance/FinanceHomePage.tsx`
- `src/owner-web/src/features/finance/TaxTrackingPage.tsx`
- `src/owner-web/src/features/locations/components/LocationLegalRecords.test.tsx`
- `src/owner-web/src/features/locations/components/LocationLegalRecords.tsx`
- `src/owner-web/src/features/locations/pages/LocationWorkspaceInteractions.test.tsx`
- `src/owner-web/src/features/locations/pages/LocationWorkspaceSettings.tsx`
- `src/owner-web/src/features/property/AssetLifecyclePanel.tsx`
- `src/owner-web/src/features/property/AssetOperationsPanel.tsx`
- `src/owner-web/src/features/property/EquipmentInspectionsPanel.test.tsx`
- `src/owner-web/src/features/property/EquipmentInspectionsPanel.tsx`
- `src/owner-web/src/features/property/PropertyApiPages.tsx`
- `src/owner-web/src/features/property/usePropertySetupApi.ts`
- `src/owner-web/src/features/tasks/components/TaskDetailDrawer.tsx`
- `src/owner-web/src/features/temporary-residence/pages/TemporaryResidencePage.tsx`
- `tests/backend/BHome.Application.UnitTests/PropertyManagement/EquipmentInspectionRulesTests.cs`
- `tests/backend/BHome.IntegrationTests/Compact24/Compact24AssetLifecycleTests.cs`
- `tests/backend/BHome.IntegrationTests/Compact24/Compact24EquipmentInspectionTests.cs`
- `tests/backend/BHome.IntegrationTests/Compact24/Compact24ResidenceQueryTests.cs`
- `tests/backend/BHome.IntegrationTests/Compact24/Compact24TaxPrivacyTests.cs`
- `tests/backend/BHome.IntegrationTests/Fixtures/LegacyPersistenceRegistration.cs`
- `tests/backend/BHome.IntegrationTests/PersistenceCompositionTests.cs`
