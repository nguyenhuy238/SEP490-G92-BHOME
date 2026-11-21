# BHOME — Source code audit cho Nguyễn Quốc Huy

Ngày đánh giá: **01/11/2026, Asia/Ho_Chi_Minh**. Phạm vi: working tree tại `member/QHuy`, HEAD `9c68c89`. Git sạch khi bắt đầu. Đây là audit và đề xuất kế hoạch, **không phải phê duyệt thay đổi nghiệp vụ**. Không sửa implementation, migration, `.env*`, dữ liệu nghiệp vụ; không commit/push/merge.

Đọc cùng [kế hoạch thực hiện](HUY_IMPLEMENTATION_PLAN.md), [dependency và integration gates](HUY_DEPENDENCY_MATRIX.md), [kết quả và checklist test](HUY_TEST_CHECKLIST.md). Các artifact kiểm tra cục bộ nằm trong `.tools/huy-audit-2026-11-01/` được Git ignore; đường dẫn này không được xem là artifact đã commit hoặc bằng chứng CI từ xa.

## 1. EXECUTIVE SUMMARY

**BHOME có backend foundation và các lát cắt Contract, Property, OCR/capture, Operational Task khá rõ; chưa có chuỗi nghiệp vụ thật Contract → Invoice → Payment → Settlement.** Không Work Package đầy đủ nào của Huy có đủ bằng chứng để gắn Fully Done trong lượt audit này.

- Restore/build backend thành công; **62 Domain UT + 170 Application UT pass**. Thêm **110 test chọn lọc trong project IntegrationTests pass**, nhưng không kiểm tra PostgreSQL/MinIO thật. Signing solution build thành công, **41 signing test pass** với dữ liệu/chứng thư tổng hợp.
- Với Node **22.23.4**, Owner Web **69 test**, Mobile **231 test** pass; root lint, web build và Mobile typecheck pass. Đó là test code/component, không phải E2E thiết bị hay browser với backend thật.
- API thực sự khởi động được. Probe HTTP: `/health/live` **200**, `/api/v1/session` vô danh **401**, Swagger **200**, công bố **84 paths / 104 operations**. `/health/ready` **503** đúng với kết nối DB tổng hợp cố ý không tồn tại; không chứng minh DB đang dùng hỏng.
- **175/285 test trong IntegrationTests chưa chạy**: Docker CLI có nhưng Docker Desktop Linux daemon không kết nối được. Một PostgreSQL local có listener 5432, nhưng audit không dùng cluster đó hoặc thông tin đăng nhập thật để chạy test/migration.
- Có Main Contract, signatures/evidence, Owner activation, xác minh cọc thủ công, renewal version và move-out guards. **Holding chưa có lifecycle**; renderer PDF mặc định ném 503; Holding adapter chưa cấu hình; Settlement adapter luôn trả `null`. Vì vậy không hoàn thành luồng ký/activate/settle thật bằng DI mặc định.
- Có manual meter entry **kèm ảnh và human confirmation**, previous reading/consumption, Initial/Periodic/Final. **Chưa có entity/service/API Invoice, Payment hoặc InvoiceAdjustment** trong backend hiện tại; không nhầm `BillingPolicy` với hóa đơn, hoặc `DepositVerification` với sổ Payment.
- Hai quality gate đang lỗi: `dotnet format ... --verify-no-changes` báo ENDOFLINE; Prettier báo 3 file sai format. Phát hiện tĩnh đáng kiểm chứng: `PostgresLocationAssignments.CreateAssignmentAsync()` commit transaction hai lần, có nguy cơ báo lỗi sau khi assignment đã được ghi.
- Cần chốt **Contract/kỳ hay Room/kỳ**, mô hình nhiều Tenant/hợp đồng và quyền payer; chính sách cọc/điều chỉnh; PDF template/provider; người phụ trách UC-17 UI/backend. Những quyết định này ảnh hưởng trực tiếp tiền, quyền và occupancy, không thể thay bằng fake provider để kết luận đúng nghiệp vụ.

Ưu tiên: baseline môi trường và quyết định mô hình → hoàn thiện Main/signing hiện có → confirmed meter + Invoice → Payment/Debt → UC-17 → Settlement/Move-out; Holding triển khai ở nhánh riêng sau khi chốt policy và khóa phòng dùng chung. Ước lượng đầy đủ **196–276 giờ gồm 18 giờ quản lý và 16 giờ dự phòng**, vượt tổng 126 giờ. Lịch tháng 11 trong kế hoạch là một đợt triển khai có giới hạn năng lực, không phải cam kết hoàn tất mọi P0.

### Nguồn đã đối chiếu và giới hạn

| Nguồn                                                                     | Bằng chứng và cách sử dụng                                                                                                                                                |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md` tại root; `src/owner-web/AGENTS.md`; `src/mobile/AGENTS.md`   | Đã đọc; áp dụng phân quyền, Git, privacy, workflow kiểm chứng                                                                                                             |
| `docs/reports/BHome_Report-3_Software Requirement Specification (2).docx` | Đọc XML DOCX trực tiếp; bên trong ghi **v1.3**. Đối chiếu BF-03/04/05/06, UC-14–25, entity model, GBR-01–10/13/18, DBR-02–08, JOB-02/05/09/10, OQ-01–08                   |
| `docs/reports/Report-4_Software Design Specification (5).docx`            | Đối chiếu kiến trúc, database, security, storage, signing. Không lấy số 39 bảng/99 FK làm schema đang chạy                                                                |
| `docs/reports/BHOME_Report-2_Project_Management_Plan (3).docx`            | Bên trong ghi v1.2; xác nhận Quoc Huy Team Leader/PO proxy, Quang Huy Scrum Master/Testing Lead; developer tự làm UT. Dùng quality targets làm mục tiêu, không coi đã đạt |
| `docs/reports/BHOME_Report-1_Project_Introduction (3).docx`               | Có file; nguồn nền sản phẩm, không dùng để xác nhận implementation                                                                                                        |
| `docs/api/*`, `docs/development/*`, `.github/workflows/ci.yml`            | Đối chiếu conventions và bàn giao với source hiện hành; số pass lịch sử không được dùng thay kết quả lần này                                                              |
| `BHOME_Project_Tracking_QA_Reallocated_2026-10-31.xlsm`                   | **Không tìm thấy trong workspace**; không xác nhận trạng thái Jira, ownership BH hoặc giờ thực tế                                                                         |
| `BHOME_Ke_hoach_ca_nhan_Nguyen_Quoc_Huy_02-30_11_2026.xlsx`               | **Không tìm thấy**; baseline 126/50/76 giờ lấy từ yêu cầu người dùng, chưa đối chiếu workbook                                                                             |
| Report 5.0 và 5.1–5.5                                                     | **Không tìm thấy**; không kiểm tra được testcase workbook hoặc evidence nghiệm thu                                                                                        |
| `Quy-tắc-làm-việc-Git.txt`                                                | **Không tìm thấy**; dùng quy định branch/review được ghi trong `AGENTS.md`, không tuyên bố đã đọc bản gốc                                                                 |

Các file DOCX có hậu tố khác mục lục hướng dẫn; phiên bản trong nội dung và điều khoản được dùng để đối chiếu. Chưa có bằng chứng phê duyệt mới cho các OQ; báo cáo bàn giao code không tự đóng OQ.

## 2. ACTUAL SYSTEM STATUS

### Kiến trúc và inventory thực tế

| Thành phần           | Kết quả kiểm tra                                                                                                                                                                                                                                                                  |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend              | `.NET 8`, ASP.NET Core Identity/JWT, EF Core 8/Npgsql; `src/backend/BHome.sln`                                                                                                                                                                                                    |
| Layering             | API → Application → Domain; Infrastructure implements persistence/provider. Có `PropertyService`, `ContractService`, `OperationalTaskService`, `CaptureService`; khá nhiều validation/transaction capture hiện nằm trong `CaptureRepository`, cần giữ tương thích khi nối billing |
| Project references   | Api tham chiếu Application/Infrastructure; Infrastructure tham chiếu Application/Domain và DigitalSigning Infrastructure/MySign; Application tham chiếu Domain. Test architecture hiện pass                                                                                       |
| Signing riêng        | `src/digital-signing/BHome.DigitalSigning.sln`: Domain/Application/Infrastructure/MySign/Api/Sandbox/UnitTests. Backend thực tế đã dùng PDF signer; ghi chú cũ “backend không tham chiếu iText” đã lỗi thời so với `.csproj` hiện tại                                             |
| Owner Web/Public Web | React 19, TypeScript, Vite; npm workspaces. Manifest Owner/Public khai báo TS 7, Vite 8; không tự hạ version theo tài liệu cũ                                                                                                                                                     |
| Mobile               | Expo **58**, React Native **0.88.1**, Expo Router; không phải Capacitor như một số tài liệu deploy cũ còn mô tả                                                                                                                                                                   |
| Shared client        | `packages/client-core/src`: api/session/auth/contracts, role guard, signing hooks                                                                                                                                                                                                 |
| DB/schema source     | `BHomeDbContext`, Capture/Contract/Property/Task configurations, snapshot **40 ToTable mappings**, **12 migrations**. Đây là schema source, **không phải số bảng DB local đã truy vấn**                                                                                           |
| DI                   | `BHome.Infrastructure/DependencyInjection.cs`, `BHome.Api/Configuration/ApiFoundation.cs`; đăng ký concrete repositories, auth, MinIO, OCR, cleanup services, queue/worker; các adapter chưa hoàn tất được nêu riêng bên dưới                                                     |
| Test                 | xUnit; IntegrationTests dùng WebApplicationFactory, PostgreSQL/MinIO Testcontainers; Vitest cho Owner/Mobile. Các file trong `tests/owner-web`, `tests/public-web`, một số `tests/mobile` ngoài `ocr` **không nằm trong include của lệnh npm test hiện tại**                      |
| CI/CD                | Một workflow CI PR vào main/develop/release: build/test/format .NET; lint/test/build/format npm; Compose config. Không thấy release deployment workflow/CODEOWNERS trong inventory `.github`. Branch protection/reviewer settings và lần CI remote gần nhất chưa xác minh         |

### Ma trận module

`DONE – Verified` chỉ dùng cho phạm vi kiểm chứng hẹp được ghi rõ. `PARTIAL` nghĩa là thiếu mắt xích nghiệp vụ; `IMPLEMENTED – Unverified` là có code nhưng chưa chạy dependency thật; `BLOCKED` ghi dependency cụ thể; `BROKEN` chỉ gắn kiểm tra đã thất bại. Không dùng số test làm phần trăm tiến độ.

| Module                    | Planned                       | Implemented                                                                                                                             | Verified                                                           | Missing                                                                                                 | Status                                            | Evidence                                                                                                       |
| ------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Build foundation          | Restore/build API             | Có layering, DI, ProblemDetails, correlation, health/Swagger                                                                            | Build 0 warning/error; HTTP startup/Swagger                        | Readiness với DB thật                                                                                   | DONE – Verified trong phạm vi build/khởi động     | `Program.cs`, `ApiFoundation.cs`, API probe                                                                    |
| Authentication            | Login/refresh/revoke/password | Identity, JWT, hashed refresh tokens, sessions, revocation, web cookie transport                                                        | UT và một số HTTP negative cases                                   | Real DB auth trong lượt này; password-reset delivery                                                    | PARTIAL                                           | `IdentitySessionService`, `IdentityPasswordService`, `UnconfiguredPasswordResetDelivery`; `API_CONVENTIONS.md` |
| RBAC/Location             | Server role + scope           | `ResourceAccess`, `PermissionAccess`, fixed catalog; DB role/session checks                                                             | UT scope/permissions pass                                          | PostgreSQL negative matrix và actual Staff reassignment                                                 | IMPLEMENTED – Unverified với DB                   | `ResourceAccess.cs`, `PostgresLocationAssignments.cs`, `ContractRepository.ListAsync`                          |
| Location/Room/Asset/rates | BF-01                         | CRUD/list/paging/concurrency; RoomType/Asset; effective-dated policies; room > type > location resolver                                 | Domain/Application tests pass                                      | DB/HTTP integration của các API nghiệp vụ; UI real integration                                          | IMPLEMENTED – Unverified                          | `PropertyService`, `PostgresPropertyRepository`, `PropertyConfiguration.cs`                                    |
| Onboarding                | UC-13                         | Residents, riêng representative/co-occupant; human confirm; AES-GCM/HMAC; Staff scoped minimal DTO                                      | Parser/protection test pass                                        | Tenant-account provisioning/link cho occupant; quy trình onboarding đầy đủ                              | PARTIAL                                           | `Resident.cs`, `CaptureRepository.CreateResidentAsync/ConfirmIdentityAsync`                                    |
| Main Contract             | UC-15                         | Draft, multi-resident, signing saga, deposit verification, readiness, activation                                                        | Contract UT pass; PDF composition synthetic pass                   | Approved renderer/template; MySign sandbox thật; Holding conversion thật; HTTP+DB test lần này          | PARTIAL / runtime signing BLOCKED                 | `ContractService`, `ViettelMySignContractAdapter`, DI                                                          |
| Holding Contract          | UC-14/JOB-05                  | Có reference/application port trên Main                                                                                                 | UT từ chối ledger thiếu, fake allocation                           | Holding kind/entity/lifecycle/API, OnHold, expiry/payment allocation thật                               | NOT STARTED cho lifecycle; chỉ có boundary        | `ContractKind { Main, Renewal }`, `IContractHoldingLedger`, `UnconfiguredContractHoldingLedger`                |
| Renewal/termination       | UC-16/19                      | Renewal version; termination/expiry request; approval/schedule/final inspection/settlement history/complete guards                      | UT guards, synthetic signing pass                                  | JOB-02, handover baseline, financial ledger/refund; reject/cancel termination không thấy API            | PARTIAL                                           | `RenewAsync`, `RequestTerminationAsync`, `InspectAsync`, `SettleAsync`, `CompleteAsync`                        |
| Move-in handover          | UC-17                         | Có Assets và Initial meter reading làm input; Owner page generic demo                                                                   | Không có backend workflow để chạy                                  | Handover record/API/checklist/keys/snapshot asset/dual confirmation                                     | NOT STARTED backend; PARTIAL UI mock              | `HandoversPage.tsx` → `ResourcePage`; backend Domain/API/snapshot không có handover                            |
| Meter capture             | UC-20                         | Active meter; Initial/Periodic/Final; manual value; ảnh riêng tư; OCR suggestion; human confirmation; previous/consumption; locks/index | Parser/OCR negative tests pass                                     | Tenant read API; replacement workflow; JOB-09; full DB test lần này                                     | PARTIAL ở mức yêu cầu hoàn chỉnh                  | `MeterCapture.cs`, `CaptureRepository.ConfirmMeterAsync`, `CaptureConfiguration`                               |
| OCR                       | GBR-07                        | ONNX + OpenCV nội bộ, profile/precision/fallback; CCCD transient                                                                        | Local pipeline/protection test pass, không phải benchmark ảnh thật | Accuracy/performance trên tập ảnh đánh giá thật, model/runtime deployment                               | IMPLEMENTED – Unverified với model/ảnh thật       | `LocalOcrService`, `OnnxOcrEngine`, `OcrRecognitionTests`                                                      |
| Invoice                   | UC-21/JOB-10                  | BillingPolicy/confirmed consumption là input; UI demo                                                                                   | Không có invoice workflow để test                                  | Invoice/lines, snapshot giá, Draft/Finalize/due date, Tenant read, dedup/immutability, billing calendar | NOT STARTED backend                               | API inventory không có `/invoices`; snapshot không có Invoice                                                  |
| Payment/Debt/History      | UC-22/23/25                   | `IBankTransactionProvider`; ContractDepositVerifications; UI demo                                                                       | Deposit duplicate logic có UT; không phải Invoice Payment test     | Bank event/allocation/payment ledger/manual invoice reconciliation/payer/history/debt                   | NOT STARTED backend cho BH-25                     | `UnconfiguredBankProvider`, `DepositVerification`, không có Payment/Debt controller/entity                     |
| InvoiceAdjustment         | UC-24                         | UI mock xử lý trong demo repository                                                                                                     | Không có backend test                                              | Request/approval/effect/audit/immutable original/idempotency                                            | NOT STARTED backend                               | Không có entity/controller/service trong API/model hiện tại                                                    |
| Operational Task          | BF-02 một phần                | AdHoc workflow, append-only history, evidence, Owner verify/rework, scoped in-app notification                                          | Domain/Service tests; OpenAPI contract test pass                   | Schedules/recurring/deadline jobs; DB test lần này                                                      | PARTIAL                                           | `OperationalTaskService`, `TaskRecords.cs`, `PostgresOperationalTaskRepository`                                |
| Background Jobs           | JOB-01–10                     | Durable queue, unique name/key, leases, retry/manual-failure; default disabled                                                          | Foundation code; không chạy worker với DB                          | Không thấy business handler implementation/DI hoặc scheduler JOB-01–10                                  | PARTIAL foundation; NOT STARTED business jobs     | `PostgresJobWorker` gọi `IBackgroundJobHandler`; tìm source chỉ có interface/worker                            |
| Notification              | JOB-04/billing events         | Notification table/API riêng operational tasks, recipient dedup                                                                         | Contract shape/UT; không phải billing delivery                     | General tenant invoice notification/outbox/retry; external delivery                                     | PARTIAL                                           | `OperationalTaskNotification`; `UnconfiguredNotificationProvider`                                              |
| MinIO/private files       | Storage/evidence              | Real adapter; private application downloads; durable upload cleanup intents                                                             | PDF/protection tests; DB/S3 lifecycle chưa chạy                    | Test storage thật và deployment bucket/key/access policy                                                | IMPLEMENTED – Unverified với S3                   | `MinioObjectStorage`, `ContractFiles`, `MeterEvidenceCleanup`, `TaskEvidenceFiles`                             |
| Incident/Work Order       | BF-07                         | Không tìm thấy implementation hiện hành trong Domain/Application/API này                                                                | NOT RUN                                                            | Incident/Emergency/Work Order/cost                                                                      | NOT STARTED tại HEAD này                          | `git log --all` có lịch sử nhánh incident; không xem code nhánh khác là đã tích hợp                            |
| Owner finance/What-if     | FE-08                         | Demo screens/model                                                                                                                      | Component/demo tests không chứng minh finance                      | Verified source amounts, OPEX/investment/report/projection backend                                      | PARTIAL UI; NOT STARTED backend                   | `features/property/FinancePages.tsx`, `PortalProvider.tsx`                                                     |
| Public Website            | UC-37/38 read-only            | Home/router/layout                                                                                                                      | Build pass                                                         | Public approved content API/list/detail/vacancy; nút `/locations` hiện không có route tương ứng         | PARTIAL                                           | `public-web/src/main.tsx` dùng `app/App`; `AppRouter.tsx` chỉ `/` và fallback                                  |
| Owner/Mobile business UI  | Client integration            | Contract clients thật; mobile capture/tasks/owner counts thật; preview/demo được tách                                                   | Owner69/Mobile231 tests pass, build/typecheck pass                 | Invoice/payment/debt/handover APIs và end-to-end                                                        | PARTIAL                                           | `useContractsApi.ts`, `ownerOverview.ts`, `WorkspaceProvider`, `PortalProvider`                                |
| CI quality gates          | Build/test/style              | Workflow tồn tại                                                                                                                        | Lint/build/selected tests pass                                     | Backend ENDOFLINE; 3 Prettier failures; complete IT                                                     | BROKEN cho style gates; BLOCKED cho full IT local | `.github/workflows/ci.yml`, audit logs                                                                         |

### B1–B6: chi tiết phần Huy, từ API xuống persistence

**BH-16 / Main:** `CreateAsync()` kiểm tra Room Available, active signers có role, Resident cùng Room đã verified, representative nằm trong danh sách; `ContractResidents` lưu từng occupant. Draft không tự reserve phòng. `Readiness()` kiểm tra thời hạn thực tế, 2 signatures cùng snapshot, reference/evidence, verified deposit, room/conflict và xác minh lại residents/signers. `ActivateAsync()` chỉ Owner, tải lại file để so hash, cập nhật Contract Active + Room Occupied trong transaction khóa Room. Có operation fingerprint và audit. `ConflictsAsync()` chỉ xét Active Main/Renewal; chưa có Holding để bảo vệ xung đột Holding/Main. Hai Draft cạnh tranh có thể tồn tại; một Active/Room bị unique index chặn. Không tự coi nhiều Draft là duplicate financial effect.

**Signing:** luồng thật dùng `IContractSigningProvider` → `ViettelMySignContractAdapter` → MySign + PDF signer; không chỉ dựa vào `IElectronicContractProvider` placeholder cũ. Signed PDF được nối incremental, lưu private object/hash, request mơ hồ sang ManualReview thay vì tự gửi lại. Nhưng `UnconfiguredContractRenderer.RenderAsync()` luôn `contract_template_not_configured` 503 và DI vẫn đăng ký nó. Có PDF signer thật đã pass test synthetic; **không cần viết lại crypto signer**. Cần template được duyệt và test MySign thật, không dùng chữ ký vẽ/OTP thay thế.

**Cọc:** `VerifyDepositAsync()` cho Owner ghi bank reference/amount/reason, unique reference chống cộng lại trong bảng cọc. Đây là manual attestation của Owner, không có pipeline bank event đối chiếu độc lập. Chưa có ràng buộc dedup xuyên ledger Invoice/Payment vì các ledger đó chưa tồn tại. Không cho client gửi `paid=true` để activate.

**BH-21:** `ConfirmMeterAsync()` khóa Meter/Task, recheck scope, yêu cầu `HumanConfirmed`, ảnh thuộc Staff/task còn hợp lệ, previous baseline, ngày/precision, nondecreasing, object còn tồn tại. Replay cùng value/evidence trả record cũ; thay payload bị 409. Consumption = confirmed − previous; initial consumption null. OCR có thể không chạy: giá trị manual vẫn xác nhận được với ảnh. Initial/Periodic task hiện **không được nhận ContractId**; chỉ Final gắn ContractId. Billing/handover phải giải quyết cách liên kết baseline/tenancy bằng scope và thời gian, không giả định FK đã có. Tenant bị loại khỏi capture controller hiện hành, nên cần endpoint/DTO riêng cho confirmed readings được phép xem. Chưa có Invoice service/repository để tiếp tục chuỗi.

**BH-25:** `BankTransaction` hiện chỉ có `ProviderReference`, `AmountVnd`, `OccurredAt`; chưa có remittance/matching metadata/payer resolution cho invoice. Cần thỏa thuận provider contract khi chọn ngân hàng; không bịa payload/signature scheme. Fake port có thể giúp test allocation độc lập, nhưng chưa có domain allocation để fake port gọi vào. Không đưa UI mock Payment hoặc bảng ContractDepositVerifications vào bằng chứng Invoice đã Paid.

**UC-17:** `ContractInspectionEvidence` và `InspectAsync()` là **move-out**, không phải move-in handover. Không có record lưu keys/checklist/asset snapshots và Staff/Tenant confirmations của bàn giao vào ở. Có thể reuse storage/Asset/MeterReading/ContractResident; vẫn cần persistence/API cho nghiệp vụ còn thiếu sau review schema.

**BH-40:** renewal là Contract version mới, parent giữ terms và được Superseded khi bản mới Active trong kỳ hiệu lực. Move-out: Tenant request hoặc Owner expiry → Owner approve → schedule → Staff inspection với confirmed Final readings và ảnh → Owner review settlement → complete. `SettleAsync()` chỉ Settled nếu ledger chứng minh obligations/deposit/transfers resolved, và `CompleteAsync()` re-read ledger reference; mặc định ledger null nên **phòng không được giải phóng**. Guard này là đúng hướng, không phải bug cần bypass. Chưa đối chiếu asset damage với baseline UC-17; chưa có policy/ledger final charges/refund; chưa có JOB-02 hoặc API reject/cancel request đã thấy.

**BH-41:** chưa có backend. Phải tách Draft correction và post-final adjustment, Owner approve/reject, history và balance recalculation; giữ nguyên original finalized invoice. Approval categories/threshold còn OQ-02, không tự thêm ngưỡng.

### Khác biệt schema và yêu cầu hóa đơn chung Room

| Khả năng                                             | Schema/logic hiện tại                                                                       | Kết luận                                                                                                                               |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Nhiều occupant trong một Room                        | `Residents`, `ContractResidents`                                                            | Có biểu diễn occupant, nhưng không phải mỗi người đều có tài khoản/signature                                                           |
| Nhiều Tenant có hợp đồng riêng cùng Room đang Active | `UX_Contract_ActiveRoom` unique `RoomId` khi Status=3; `CreateAsync` yêu cầu Room Available | **Không hỗ trợ** mô hình cùng thời điểm; đây là quyết định model/occupancy, không chỉ thêm Invoice API                                 |
| Nhiều Tenant cùng xem một Invoice                    | Chưa có Invoice; Contract access chỉ `TenantUserId == actor`                                | Chưa hỗ trợ; `ContractResident` không có TenantUserId; `Resident.OwnerUserId` là người tạo record, không được dùng thay Tenant account |
| Ghi nhận người thực trả                              | `DepositVerification.VerifiedByUserId` là Owner xác minh                                    | Không phải payer; chưa có Payment/PaidBy/beneficiary mapping                                                                           |
| Cùng thấy Paid sau một người trả đủ                  | Chưa có shared balance/allocation transaction                                               | Chưa hỗ trợ; cần một obligation có identity duy nhất và scope đúng theo ngày thuê                                                      |

**D-01 cần quyết định:** giữ baseline SRS Invoice/Contract/kỳ + một tenancy nhiều occupant, hay phê duyệt mô hình Room/kỳ + nhiều tenancy đồng thời. Phương án đầu tái sử dụng nhiều hơn, nhưng vẫn cần liên kết user/occupant và Invoice/Payment persistence. Phương án sau phải sửa approved requirements, room eligibility/unique-active constraint, rent allocation, tenant liability, ngày vào/ra và entitlement lịch sử trước khi migration. Không xóa unique index để cho demo chạy. Xem D-01–D-06 trong dependency matrix.

### Lỗi, rủi ro và kiểm chứng còn thiếu

| ID   | Mức độ                                     | Bằng chứng                                                                                                                           | Ảnh hưởng / hành động kế tiếp                                                                                                                                                  |
| ---- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F-01 | P1 nghi vấn tĩnh, chưa tái hiện PostgreSQL | `PostgresLocationAssignments.cs:51` và `:58` đều `CommitAsync()` trong đường tạo thành công                                          | Có nguy cơ exception sau durable commit, client retry tưởng chưa tạo. Đinh Thiên Huy tái hiện create→read→retry trên DB test, thống nhất chỉ commit một lần; không sửa ở audit |
| F-02 | P0 blocker của product flow                | Renderer/holding/settlement adapters mặc định chưa hoàn tất                                                                          | Main ký lần đầu, Holding conversion và move-out settled không thể thành công qua DI hiện tại                                                                                   |
| F-03 | P0 decision/data model                     | SRS DBR-06 + active-room index đối nghịch hướng nhiều hợp đồng/hóa đơn Room                                                          | Chốt D-01 trước Invoice/Payment schema và DTO                                                                                                                                  |
| F-04 | P1 missing feature                         | Không có Invoice/Payment/Adjustment backend                                                                                          | Không thể gọi chuỗi tài chính thật; trạng thái mock UI không phải kết quả ngân hàng                                                                                            |
| F-05 | P2 verified style failure                  | Backend format exit2 ENDOFLINE, gồm `tests/backend/BHome.IntegrationTests/Fixtures/LegacyCaptureWorkflowsFixture.cs`; Prettier exit1 | CI style gates không xanh theo lệnh local hiện tại; không chứng minh remote Linux CI chắc chắn lỗi CRLF. Rà `.editorconfig`/`.gitattributes` trước thay đổi hàng loạt          |
| F-06 | P2 môi trường, đã phân biệt                | Node global24; Node22 local; Mobile startup tests12 fail ở24 nhưng231 pass ở22                                                       | Dùng runtime theo engines; không “sửa test cho pass” trên runtime ngoài phạm vi                                                                                                |
| F-07 | P1 verification gap                        | Docker Linux daemon unavailable;175 IT chưa chạy                                                                                     | Không có bằng chứng live migrations/transactions/locks/private MinIO hoạt động tại HEAD này                                                                                    |
| F-08 | P1 requirement gap                         | UC-17 record/dual confirmation thiếu; initial task không gắn Contract                                                                | Không có baseline đáng tin cho charge damage/move-out; thêm slice trước complete UC-19                                                                                         |
| F-09 | P1 policy gap                              | Billing calendar, rent Contract vs resolved rent, rounding/prorating/chuyển tenancy chưa thấy approved implementation                | Chỉ định decision owner; không tự chọn một rate hoặc chia phí                                                                                                                  |
| F-10 | P2 test discovery                          | Owner include `src/**/*.test.tsx`; Mobile include `tests/mobile/ocr/**`; public không có test script                                 | Một số root tests không được CI npm test discover; cân nhắc gom lại sau review tính còn phù hợp                                                                                |

Chưa chứng minh có Critical exploit đang chạy hoặc thất thoát tiền. Các blocker P0 nói về điều kiện phải hoàn thành trước nghiệm thu, không phải số defect đã được penetration-test xác nhận.

## 3. NGUYỄN QUỐC HUY – TASK GAP ANALYSIS

Ước lượng engineering effort cho phần còn thiếu, gồm UT/IT trong package, không lấy giờ tracking. Khoảng dưới–trên phản ánh độ lớn được quan sát; chưa gồm thời gian chờ provider/quyết định. Phần “cần code” có điều kiện được duyệt. Không làm lại các guard Main, parser/OCR hoặc crypto signer đã có.

| Task ID          | Requirement                                     | Hiện trạng                            | Đã có                                                          | Còn thiếu                                                                                          | Ước lượng giờ còn lại | Priority            |
| ---------------- | ----------------------------------------------- | ------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------- | ------------------- |
| BH-01            | Governance/API/migration/quality gates          | PARTIAL                               | Branch cá nhân; CI; conventions; tài liệu                      | Decision log, baseline artifacts, ownership/gates, fix gate phối hợp, release evidence             | 18 quản lý            | P0 hỗ trợ           |
| BH-16            | UC-14/15; GBR-03/04/05/10/18; DBR-02/03         | PARTIAL                               | Main lifecycle, deposit guards, fake holding port, UI Contract | Main regression4–6; template/MySign8–12; Holding state/payment/expiry/conversion20–30              | **32–48**             | P0                  |
| BH-21            | UC-20/21; GBR-07/08/09; DBR-05/06/07; JOB-09/10 | PARTIAL meter; Invoice NOT STARTED    | Manual confirmed readings, policies/resolver                   | Tenant confirmed-read4–6; Draft12–16; Finalize8–10; jobs/integration8–12                           | **32–44**             | P0                  |
| BH-25            | UC-22/23/25; GBR-02/10/18; DBR-08; JOB-01/03    | NOT STARTED ngoài cọc Contract        | Provider interface; manual deposit                             | Txn/allocation/manual12–16; edge balances/payer8–12; debt/history8–12; callback/retry/security8–12 | **36–52**             | P0                  |
| UC-17            | Move-in baseline                                | NOT STARTED backend                   | Asset, initial readings, private storage                       | Draft/checklist/asset/key/evidence8–12; dual confirmations/read/links8–12                          | **16–24**             | P0 trước settlement |
| BH-40            | UC-16/19; JOB-02; OQ-01/05                      | PARTIAL, settlement BLOCKED           | Renewal, termination, inspection/close guards                  | Expiry4–6; ledger/refund10–16; handover/final readings/history integration6–10                     | **20–32**             | P0                  |
| BH-41            | UC-24; GBR-03/09/13; DBR-07; OQ-02              | NOT STARTED backend                   | Demo page                                                      | Request6–8; approval/reject/concurrent apply/final immutability8–14                                | **14–22**             | P0                  |
| Cross-package QA | Full core workflows, security/concurrency       | PARTIAL                               | Existing tests/fakes                                           | Real services, cross-package E2E, evidence and negative regression beyond package tests            | **12–20**             | P0 release          |
| Buffer           | Integration/bugfix                              | Chưa tiêu dùng như kế hoạch tương lai | —                                                              | Dự phòng riêng, không tính là feature delivered                                                    | **16**                | Bảo vệ mốc          |
| **Tổng**         | Không gồm toàn bộ feature thành viên khác       | —                                     | —                                                              | 18 PM +162–242 engineering +16 buffer                                                              | **196–276**           | —                   |

Baseline cố định50 PM/76 BE thiếu **102–182 giờ BE** so với178–258 giờ BE+buffer cần thiết. Nếu nhóm đồng ý giảm quản lý còn18h thì126h vẫn thiếu **70–150h**. Các con số không phải deadline provider cam kết, không gồm đổi model Room-bill sâu nếu D-01 chọn nhánh khác baseline.

## 4. DEPENDENCY & BLOCKER ANALYSIS

| Công việc Huy      | Dependency                  | Tình trạng thực tế                                          | Giải pháp không chờ                                                                       | Integration Gate                                      | Rủi ro                                           |
| ------------------ | --------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------ |
| Main Contract      | Room/Tenant verified        | Có Room/Resident APIs, account linking thiếu; F-01 nghi vấn | Existing Contract UT, synthetic users/room fixture; không cần UI                          | G-02: API+PG+MinIO, role/room/concurrency             | Không gọi fake test là real IT                   |
| Invoice            | Manual readings + policies  | Hai input có implementation; chưa có invoice                | Tái dùng confirmed readings và resolver; manual trước OCR                                 | G-03: Draft→Final, rate snapshot, missing meter guard | D-01, rent precedence và lịch billing chưa chốt  |
| Payment            | Invoice obligation + bank   | Invoice thiếu, bank adapter503                              | Synthetic transaction feed, Owner manual verification vào cùng allocation service đề xuất | G-04: real persistence, duplicate/parallel/retry      | Provider chưa chọn; payer/identity mapping       |
| UC-17/Move-out     | Handover + financial ledger | Handover thiếu, ledger null                                 | Thiết kế reuse inputs, viết guards/fakes cho missing baseline; không complete giả         | G-05/G-06                                             | Policy OQ; UI owner chưa xác nhận                |
| Notifications/jobs | BH-19                       | Task notifications có; business job handlers chưa có        | Fake delivery boundary, persistent business event contract sau review                     | G-07                                                  | Không bỏ notification persistence để tránh block |
| Frontend/QA        | BH-14/17/18/23/34           | Contract/capture UI và test framework có                    | OpenAPI + synthetic fixtures + negative examples ngay khi contract được duyệt             | G-08                                                  | Mapping BH/author chưa xác nhận bằng tracker     |

Chi tiết người phụ trách, dữ liệu cần cung cấp, quyền quyết định và file dễ conflict: [HUY_DEPENDENCY_MATRIX.md](HUY_DEPENDENCY_MATRIX.md). Không có yêu cầu chờ frontend để test backend. Chỉ nhánh policy tranh chấp và external end-to-end thật bắt buộc chờ.

## 5. OPTIMAL IMPLEMENTATION ORDER

1. BH-01: tái lập runtime/test baseline, quyết định D-01–D-06, migration ownership; tái hiện F-01 với người phụ trách.
2. BH-16 Main: giữ implementation đã có, hoàn thiện template/signing và chạy DB+storage regression. Trả DTO/smoke data cho UI ngay.
3. BH-21: Tenant confirmed-read + manual input → Draft với snapshot rates → Finalize có Owner authority và missing-data guard → JOB-09/10.
4. BH-25: manual reconciliation + fake bank transactions qua allocation service chung → partial/over/unmatched → Debt/History → real gateway/authenticity.
5. UC-17: baseline move-in đầy đủ trước khi nối charge damage/settlement UC-19.
6. BH-41: original Invoice bất biến, request/Owner decision/adjustment; tích hợp balance với Payment trước Settlement.
7. BH-40: expiry/renewal regression, real financial ledger/refund, baseline comparison, complete guards. Không viết lại renewal skeleton.
8. Holding là nhánh riêng sau shared bank allocation/room locking và OQ-03 được chốt; thêm activation/expiry/conversion, rồi regression Holding→Main. Không được tuyên bố BH-16 Done khi nhánh này còn thiếu.
9. Cross-package real integration/negative/concurrency, client wiring, acceptance evidence, review và release gates.

Payment được nối sớm hơn hoàn tất mọi Contract subtype để tránh viết hai ledger cộng cọc/Invoice không dedup. UC-17 và Adjustment được đưa trước Settlement vì settlement phụ thuộc baseline và balance hợp lệ. Chi tiết thiết kế từng slice trong kế hoạch; thứ tự là ưu tiên engineering, không phải thay đổi requirement.

## 6. DETAILED DAILY EXECUTION PLAN

Lịch **02–30/11/2026** có21 ngày làm việc thứ Hai–thứ Sáu, giả định6h/ngày để khớp126h; chưa có workbook xác nhận lịch rảnh. Phương án đề xuất **18h PM +96h engineering +12h reserve**, cần nhóm đồng ý tái phân bổ từ50/76. Nếu giữ baseline, phải giảm engineering trong lịch còn76h và đẩy phần tương ứng sang kỳ sau, không tự đổi capacity.

| Ngày/giai đoạn | Sản phẩm mục tiêu                                                                            | Gate                                                         |
| -------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 02–06/11       | Decisions/API baseline, Main regression, renderer/signing reviewable; Holding boundary/tests | G-01/G-02; không giả định MySign được cấp đúng ngày          |
| 09–16/11       | Confirmed-read, Draft/Final Invoice, rate snapshots và job contract/handler ban đầu          | G-03; thiếu input giữ Draft                                  |
| 17–24/11       | Manual/fake-feed allocation, duplicate/partial/over/unmatched, debt/history                  | G-04 ở mức fake external + DB thật; real bank còn gate riêng |
| 25–30/11       | Cross-slice evidence, xử lý lỗi trong12h buffer, release/no-go list                          | G-08; không ép đóng gate thiếu thật                          |
| Sau30/11       | Holding lifecycle còn lại, UC-17, BH-41, financial settlement/UC-19, real external gates     | Không bỏ P0; cần thêm70–150h hoặc tái phân công được duyệt   |

Bảng **từng ngày9 cột**, phân bổ giờ khớp126, fallback nếu decision/provider chưa có và tiêu chí Done: [HUY_IMPLEMENTATION_PLAN.md §6](HUY_IMPLEMENTATION_PLAN.md#6-detailed-daily-execution-plan).

## 7. WORK PACKAGE BREAKDOWN

Xem [HUY_IMPLEMENTATION_PLAN.md §7](HUY_IMPLEMENTATION_PLAN.md#7-work-package-breakdown): mỗi package có mục tiêu, hiện trạng, phần còn lại, file/class, dependency, cách không chờ, effort, API/deliverable, test, DoD và bước tích hợp tiếp theo. Mọi tên entity/endpoint mới đều được đánh dấu **đề xuất**, chưa phải API contract hiện hữu.

## 8. TEST EXECUTION PLAN

Kết quả thực thi, exact commands và test matrix Given/When/Then: [HUY_TEST_CHECKLIST.md](HUY_TEST_CHECKLIST.md). Đã chạy683 test tổng cộng trong các phạm vi nêu trên; số này **không** hàm ý683 real integration/E2E hoặc coverage. 175 test project IntegrationTests chưa chạy; Public Web không có test script. Không đo coverage, latency/throughput, OCR accuracy, bank matching rate hoặc backup/restore.

## 9. IMMEDIATE ACTION PLAN – 3 NGÀY ĐẦU

- **02/11:** dùng Node22, mở F-01 và source model; chốt D-01, baseline schema/API và người sở hữu migration; cấp QA fixture/gate. Chưa có quyết định thì chỉ chuẩn bị contract-neutral test data và logic đã thống nhất.
- **03/11:** chạy Contract API tests trên PG16/MinIO test cô lập, tái hiện assignment commit issue cùng Đinh Thiên Huy; xác nhận missing signing/deposit/role/concurrency guards. Bàn giao client contract/error samples, không đổi response tùy tiện.
- **04/11:** triển khai renderer từ template được duyệt hoặc hoàn thiện template mapping/tests chờ duyệt; test source integrity và provider failure, giữ snapshot/signature workflow đang có. Không đánh dấu real signing Done nếu chưa có provider evidence.

File cần mở, thứ tự, lệnh và điều kiện chuyển ngày tại [kế hoạch §9](HUY_IMPLEMENTATION_PLAN.md#9-immediate-action-plan--3-ngày-đầu).

## 10. FINAL ROADMAP & RISKS

**Ready for Implementation:** confirmed-meter Tenant read, test fixtures, Main template adapter sau approval, Invoice core sau D-01/billing decisions. **In Development:** nhãn quản trị đề xuất cho các slice đang có source, không suy ra người đang code ở Jira. **Ready for Testing:** Contract/meter/property/task code có UT; các nhánh DB/storage cần hạ tầng. **Ready for Integration:** chỉ đạt sau real DB+storage tests và API contract ký nhận; hiện chưa xác nhận toàn package. **Done:** chỉ build/lint/test phạm vi hẹp đã ghi. **Blocked:** final money/model policy, approved PDF/provider và real settlement; không block toàn bộ development vì OCR/UI.

Không thể cam kết hoàn thành tất cả phần Huy trước30/11 với126h. Theo minimum196h, nếu tiếp tục6h/ngày thứ Hai–thứ Sáu từ02/11 và giả định decision/provider sẵn, khoảng33 ngày làm việc tương đương **16/12/2026**; maximum276h tương đương46 ngày làm việc, **04/01/2027** nếu chưa loại ngày nghỉ/lễ. Đây chỉ là phép quy đổi năng lực, không phải mốc release được duyệt hoặc thời gian chờ bên ngoài. Cần nhóm chọn thêm capacity/tái phân công/mốc mới; không tự loại UC-17/Holding/Adjustment/Settlement khỏi P0.

Rủi ro chính: đổi Room/Contract billing model giữa chừng; migration/snapshot nhiều người sửa; onboarding thiếu account link; SRS OQ chưa đóng; provider/template chậm; fake tests bị hiểu thành Done; client demo bị hiểu là API thật; style gate/IT không có evidence. Mỗi rủi ro có owner, mitigation và gate ở hai báo cáo kế hoạch/dependency.

### Phụ lục API thực tế

Inventory dưới đây được xuất từ Swagger của process API đã khởi động trong lượt audit, không phải endpoint được suy đoán từ tài liệu. Controller attributes là nguồn quyền chi tiết; diagnostics có guard Development/runtime. Swagger công bố route không đồng nghĩa nghiệp vụ phía sau đã thành công. Health routes không nằm trong104 Swagger operations; endpoint certificate phục vụ mobile development bị loại khỏi OpenAPI.

| Method | Route                                                 |
| ------ | ----------------------------------------------------- |
| GET    | /api/v1/assets                                        |
| POST   | /api/v1/assets                                        |
| GET    | /api/v1/assets/{id}                                   |
| PUT    | /api/v1/assets/{id}                                   |
| POST   | /api/v1/auth/login                                    |
| POST   | /api/v1/auth/refresh                                  |
| POST   | /api/v1/auth/logout                                   |
| POST   | /api/v1/auth/logout-all                               |
| GET    | /api/v1/auth/me                                       |
| POST   | /api/v1/auth/change-password                          |
| POST   | /api/v1/auth/forgot-password                          |
| POST   | /api/v1/auth/reset-password                           |
| GET    | /api/v1/billing-policies                              |
| POST   | /api/v1/billing-policies                              |
| GET    | /api/v1/billing-policies/{id}                         |
| PUT    | /api/v1/billing-policies/{id}                         |
| POST   | /api/v1/billing-policies/{id}/replacement             |
| POST   | /api/v1/billing-policies/{id}/end                     |
| GET    | /api/v1/capture/chains                                |
| GET    | /api/v1/capture/locations                             |
| POST   | /api/v1/capture/locations                             |
| GET    | /api/v1/capture/locations/{id}/rooms                  |
| GET    | /api/v1/capture/staff                                 |
| POST   | /api/v1/capture/staff                                 |
| POST   | /api/v1/capture/rooms                                 |
| POST   | /api/v1/capture/assignments                           |
| GET    | /api/v1/capture/locations/{id}/residents              |
| POST   | /api/v1/capture/residents                             |
| POST   | /api/v1/capture/residents/{id}/confirm                |
| GET    | /api/v1/capture/locations/{id}/meters                 |
| POST   | /api/v1/capture/meters                                |
| GET    | /api/v1/capture/meter-tasks                           |
| POST   | /api/v1/capture/meter-tasks                           |
| PUT    | /api/v1/capture/meter-tasks/{id}/evidence             |
| POST   | /api/v1/capture/meter-tasks/{id}/confirm              |
| GET    | /api/v1/capture/readings/{id}/evidence                |
| GET    | /api/v1/chain                                         |
| PUT    | /api/v1/chain                                         |
| GET    | /api/v1/contracts                                     |
| POST   | /api/v1/contracts                                     |
| GET    | /api/v1/contracts/{id}                                |
| GET    | /api/v1/contracts/{id}/activation-readiness           |
| POST   | /api/v1/contracts/{id}/activate                       |
| POST   | /api/v1/contracts/{id}/deposit-verifications          |
| POST   | /api/v1/contracts/{id}/signing                        |
| POST   | /api/v1/contracts/{id}/signing/sync                   |
| POST   | /api/v1/contracts/{id}/signing/recover                |
| GET    | /api/v1/contracts/{id}/document                       |
| POST   | /api/v1/contracts/{id}/renewals                       |
| POST   | /api/v1/contracts/{id}/renewal-cancellation           |
| POST   | /api/v1/contracts/{id}/termination-requests           |
| POST   | /api/v1/contracts/{id}/expiry-move-out                |
| GET    | /api/v1/contracts/{id}/move-out                       |
| POST   | /api/v1/contracts/{id}/move-out/approve               |
| POST   | /api/v1/contracts/{id}/move-out/schedule              |
| POST   | /api/v1/contracts/{id}/move-out/inspection            |
| POST   | /api/v1/contracts/{id}/move-out/evidence              |
| GET    | /api/v1/contracts/{id}/move-out/evidence/{evidenceId} |
| POST   | /api/v1/contracts/{id}/move-out/settlement            |
| GET    | /api/v1/contracts/{id}/move-out/settlement-history    |
| POST   | /api/v1/contracts/{id}/move-out/complete              |
| GET    | /api/v1/digital-signing/certificates                  |
| POST   | /api/v1/digital-signing/certificates                  |
| POST   | /api/v1/digital-signing/certificates/{id}/lock        |
| GET    | /api/v1/session                                       |
| POST   | /api/v1/locations                                     |
| GET    | /api/v1/locations                                     |
| GET    | /api/v1/locations/{id}                                |
| PUT    | /api/v1/locations/{id}                                |
| GET    | /api/v1/locations/assigned-to-me                      |
| POST   | /api/v1/ocr/identity/{residentId}/{side}              |
| POST   | /api/v1/ocr/meter-tasks/{taskId}                      |
| GET    | /api/v1/ocr/diagnostics                               |
| POST   | /api/v1/ocr/diagnostics/{profile}                     |
| POST   | /api/v1/operational-tasks                             |
| GET    | /api/v1/operational-tasks                             |
| GET    | /api/v1/operational-tasks/{id}                        |
| PUT    | /api/v1/operational-tasks/{id}                        |
| POST   | /api/v1/operational-tasks/{id}/assign                 |
| POST   | /api/v1/operational-tasks/{id}/start                  |
| POST   | /api/v1/operational-tasks/{id}/progress               |
| POST   | /api/v1/operational-tasks/{id}/blockers               |
| POST   | /api/v1/operational-tasks/{id}/coordinate             |
| POST   | /api/v1/operational-tasks/{id}/submit                 |
| POST   | /api/v1/operational-tasks/{id}/verify                 |
| POST   | /api/v1/operational-tasks/{id}/rework                 |
| POST   | /api/v1/operational-tasks/{id}/cancel                 |
| GET    | /api/v1/operational-tasks/{id}/history                |
| GET    | /api/v1/operational-tasks/{id}/evidence               |
| PUT    | /api/v1/operational-tasks/{id}/evidence               |
| GET    | /api/v1/operational-tasks/{id}/evidence/{evidenceId}  |
| GET    | /api/v1/operational-tasks/notifications               |
| POST   | /api/v1/operational-tasks/notifications/{id}/read     |
| GET    | /api/v1/rooms                                         |
| POST   | /api/v1/rooms                                         |
| GET    | /api/v1/rooms/{id}                                    |
| PUT    | /api/v1/rooms/{id}                                    |
| GET    | /api/v1/rooms/{id}/prices                             |
| GET    | /api/v1/room-types                                    |
| POST   | /api/v1/room-types                                    |
| GET    | /api/v1/room-types/{id}                               |
| PUT    | /api/v1/room-types/{id}                               |
| POST   | /api/v1/staff-location-assignments                    |
| GET    | /api/v1/staff-location-assignments                    |
