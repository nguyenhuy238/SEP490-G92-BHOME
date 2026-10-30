# Task create/assign/update và workflow — 30/10/2026

## Scope và traceability

BF-02 / FE-01 / UC-10–12 / DBR-01 / GBR-01..03,18; SRS OperationalTask và FE-01 §1.3.2–1.3.3; Report 4 §3.12. Dùng bốn report hiện có trong docs/reports; không có Report 5/test workbook để cập nhật bằng chứng vào template đó.

Người dùng phê duyệt D1-C và D2-B; giao người triển khai chọn D3/D4. Quyết định triển khai: execution status + isOverdue; evidence ảnh private với metadata/giới hạn cấu hình; cùng model/bảng Task với meter details giữ cùng bảng để bảo toàn ID/FK. Phân công tự route theo quyết định 29/10 đã có. Chi tiết payload, quyền, lỗi và phạm vi tại [API contract](../api/OPERATIONAL_TASKS.md).

## Acceptance và thiết kế trước triển khai

| Yêu cầu | Thành phần | Bằng chứng test |
| --- | --- | --- |
| Owner create/assign/update theo Location active, Staff active/role/ngày hiệu lực | Task DTO/controller → OperationalTaskService → IOperationalTaskRepository → PostgreSQL | ServiceTests; duplicate create/update và scope API tests |
| Chỉ Staff phụ trách hiện hành thực thi; Staff cũ mất quyền, Staff mới tiếp tục | Live responsibility lookup mỗi read/write, đồng bộ snapshot/history dưới Location lock | ReplacementStaffContinues; ScopeIsRecheckedWithOldTokens |
| Staff start/progress/blocker/submit; không tự Completed | Domain ApplyAction, service Execute permission, result/evidence validation | Domain transition tests; completion service/API tests |
| Owner verify/rework/cancel, có actor/time/reason và history | Verify/manage permissions; TaskHistory + SecurityAudit | Rework/verification API, competing Owner decisions |
| Quá hạn không xóa execution state/history | isOverdue từ DueAt và trạng thái; WasOverdue trước mutation | DeadlineExtension; OverduePendingReview |
| Evidence phải private, đúng Task, nội dung ảnh hợp lệ; upload lỗi không dangling | ITaskEvidenceFiles → MinIO, metadata, independent staging intent + cleanup | Private download/IDOR; duplicate upload; failure cleanup và linked retention |
| Retry/parallel không duplicate; không ghi đè stale request | Actor/key fingerprint/response snapshot, unique key; version; transaction/advisory locks | Parallel create/update/upload, verify-vs-cancel, payload conflict |
| Thông báo không phụ thuộc external delivery | Persistent TaskNotifications cùng transaction, own-recipient API/read state | Workflow notification/read assertions |
| Bảo toàn meter/final reading/move-out | Backfill LocationId, giữ ID/FK/status cũ; Kind guard | Migration upgrade/down/guard test; CaptureWorkflowTests; ContractLifecycleApiTests |

Lock order: command actor/key → Location advisory lock. Location lock dùng cùng convention với PropertyManagement và create StaffLocationAssignment. Scope được kiểm lại sau lock. Không có request chọn Staff tùy ý hoặc cập nhật arbitrary status.

## Thay đổi source

- Domain: OperationalTask hiện có được hợp nhất; thêm Kind, Location, work fields, assignment snapshot, version, Owner verification và generic transition. Giữ numeric meter status 0–3, thêm PendingVerification=4. Thêm các record StaffOperations.
- Application: Task DTOs, service, repository/file ports, explicit-offset input converter; giữ business policy/authorization ngoài controller/repository.
- Infrastructure: EF configuration/migration/backfill; repository query/pagination/transaction; private image validator/store; durable orphan cleanup; DI; Location assignment dùng cùng advisory lock. Task history/command append-only ở DbContext.
- API: OperationalTasksController, permission View Owner/Staff, exception mapping, no-store cả lỗi authorization, Swagger mô tả idempotency header/raw-image body/status codes.
- OCR: create meter Task điền LocationId từ trusted Meter/Room, nullable MeterId được chuyển đúng về DTO cũ; CaptureScope chỉ chọn Kind MeterReading.
- Tests: thêm Domain/Application/API/PostgreSQL/MinIO/migration/Swagger tests. ContractLifecycleApiTests chỉ sửa fixture Location để gắn system Chain bắt buộc của migration có sẵn; không sửa assertion hoặc nghiệp vụ Contract.
- Docs: API contract, quyết định/traceability, permission catalog và API index. Proposal ban đầu được đánh dấu historical.

## Kiểm chứng

Mọi tài khoản/ảnh/dữ liệu test đều synthetic. Database và MinIO dưới đây do Testcontainers tạo và hủy; không dùng database phát triển/production.

| Lệnh/check | Kết quả |
| --- | --- |
| `dotnet restore src/backend/BHome.sln --verbosity minimal -m:1 -nr:false` | PASS sau khi chạy có quyền network; không đổi package version |
| `dotnet build src/backend/BHome.sln --no-restore --verbosity minimal -m:1 -nr:false` | PASS, 0 warnings/errors tại lần build; các lượt test tiếp theo cũng build source mới |
| `dotnet test src/backend/BHome.sln --no-restore --filter 'Category!=Docker' --verbosity minimal -m:1 -nr:false` | PASS: Application 170/170, Domain 62/62, Integration non-Docker 114/114 |
| `dotnet test tests/backend/BHome.IntegrationTests --no-restore --filter 'FullyQualifiedName~CaptureWorkflowTests\|FullyQualifiedName~ContractLifecycleApiTests\|FullyQualifiedName~LocationAssignmentApiTests\|FullyQualifiedName~StaffOperations' --verbosity minimal -m:1 -nr:false` | PASS 34/34; bao gồm một OpenAPI test cũng thuộc tập non-Docker, không cộng trùng thành tổng unique tests |
| Migration metadata/snapshot | Nằm trong MigrationConsistencyTests của tập non-Docker |
| Migration thật | PASS: inspect schema tạm, upgrade dữ liệu meter/evidence/reading cũ, downgrade khi chỉ meter, upgrade lại, từ chối downgrade mất AdHoc |
| `git diff --check` | PASS; chỉ có thông báo Git chuẩn hóa CRLF thành LF của snapshot EF |

TRX lưu dưới thư mục ignored `TestResults/task-verification/`. Lệnh thực tế có thêm `--logger`/`--results-directory` để lưu evidence.

Các lần lỗi đã xử lý và không được coi là PASS:

- Restore trong sandbox không truy cập được NuGet/Microsoft.Extensions.Http; restore có network thành công.
- EF scaffold trong sandbox bị từ chối ghi file tooling obj có sẵn; chạy lại scaffold thành công. Chỉ tạo source migration, không apply database thật.
- Lượt Task integration đầu: 5 fail do dữ liệu test Location thiếu ChainId bắt buộc; sửa fixture mới dùng system Chain, chạy lại 5/5 PASS.
- Hồi quy đầu: 12 PASS, 15 Contract fail ngay setup vì fixture cũ cũng thiếu ChainId; cập nhật fixture theo schema có sẵn; 15 ca Contract sau đó PASS.
- Contract Swagger ban đầu thiếu 201 và body raw-image; tests phát hiện, đã bổ sung metadata và kiểm lại ở lượt cuối 34/34 PASS.

## Vận hành và giới hạn

- Migration mới cần được review/áp ở môi trường đích. Dừng ghi từ binary Backend cũ trong lúc nâng schema và chuyển sang binary mới vì cột LocationId mới là bắt buộc; backup/rollback theo quy trình dự án. Không claim rolling deployment tương thích với binary cũ.
- Cấu hình private MinIO/S3 hiện có phải hoạt động để upload/submit evidence. Giới hạn mới có default, không cần thêm secret/config nếu giữ mặc định.
- JOB-06/07/09, recurrence planner/configuration và push/email delivery/retry chưa thuộc slice này. In-app notification hoạt động; không claim đã gửi external notification.
- Không thay đổi chính sách tạm trú, tài chính, Work Order hoặc nhà cung cấp ký hợp đồng.
- NOT RUN: toàn bộ Docker test suite ngoài các regression liên quan, performance/coverage/UAT, provider external thật, migration database phát triển/production, frontend/mobile E2E.
- Không đổi branch, commit, push hoặc merge. Nhánh làm việc vẫn `THuy/feature-task-core-API`; quy ước `member/<name>` cần được xử lý trước khi commit theo quy trình nhóm.

## Bổ sung theo yêu cầu: migrate DB local và Postman

Sau bàn giao source, người dùng yêu cầu áp migration DB và cập nhật hai file Postman. Đã kiểm tra
connection từ `.env` mà không in credentials: đúng DB `bhome`, `localhost:5432`, PostgreSQL 18.3.
DB thiếu cả ContractActivationLifecycle (Contracts chưa tồn tại) và UnifiedOperationalTasks;
đã áp hai migration bằng EF theo thứ tự, sau backup custom-format và kiểm tra archive bằng pg_restore.
Backup giữ tại ignored `.tmp/task-rollout/bhome-before-unified-task-20261030T081243Z.dump`.

- Build trước migrate: PASS. EF update: PASS; history có cả hai migration, các bảng phụ và ba
  check constraint Task mới được kiểm tra; counts User/Room/Task giữ nguyên.
- Lượt EF đầu trong sandbox dừng trước khi truy cập DB vì không được ghi file tooling obj;
  chạy lại với quyền thích hợp thành công. Không chỉnh tay bảng/schema hoặc migration history.
- API đang chạy: live/ready 200, Swagger 200 có contract Task, anonymous Task 401. Không dừng
  hoặc thay thế host do người dùng đang chạy; không tạo record test trong DB local.
- Collection: giữ nguyên 87 request có sẵn, thêm 38 request 81–118, 14 biến trong cả collection
  và environment; binary evidence, version, replay, notification và nhánh negative/permission.
- Validation: JSON PASS, 163 script biên dịch PASS; 152 lượt giả lập success/error trên hai scope,
  234 assertions PASS; response lỗi không ghi đè output ID/version. File token vẫn trống.
- NOT RUN: toàn bộ collection qua HTTP với tài khoản/mật khẩu người dùng. Hướng dẫn chi tiết tại
  [Postman README](../testing/postman/README.md). Giới hạn migration local NOT RUN trong phần
  bàn giao ban đầu ở trên đã được thay thế bằng kết quả local này; production vẫn chưa áp migration.
