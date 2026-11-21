# Operational Tasks — phân tích và API contract đề xuất

Ngày rà soát: 30/10/2026. Phạm vi: Backend. Đây là bản phân tích ban đầu; quyết định sau đó: **D1-C, D2-B**, người dùng giao lựa chọn D3/D4 cho người triển khai. D3 chọn trạng thái thực thi + `isOverdue`; D4 chọn ảnh private có metadata và giới hạn cấu hình. Contract cuối và phạm vi triển khai tại [OPERATIONAL_TASKS.md](OPERATIONAL_TASKS.md). Các phương án bên dưới được giữ làm lịch sử đề xuất, không phải contract hiện hành.

## 1. Nguồn và traceability

- `docs/reports/BHome_Report-3_Software Requirement Specification (2).docx`: BF-02; entity OperationalTask; DBR-01; §I.4.4 permission matrix; UC-10, UC-11, UC-12; FE-01 §1.3.2–1.3.3; JOB-06, JOB-07; GBR-01..03, GBR-18; yêu cầu audit và thông báo.
- `docs/reports/Report-4_Software Design Specification (5).docx`: kiến trúc phân lớp; §3.12 operational_tasks; private object storage. Schema mô tả dùng BIGINT, trong code hiện tại dùng Guid: giữ convention thực tế, không sao chép DDL từ report.
- Report 1: Proposed Solution và Scope xác định Owner giao việc, Staff thực hiện theo Location. Mã FE của Report 1 khác SRS; bản đề xuất dùng FE-01 của SRS.
- Report 2: delivery/testing gates là mục tiêu kế hoạch, không phải bằng chứng đã kiểm thử.
- `docs/development/STAFF_LOCATION_ASSIGNMENTS.md`: quyết định được ghi nhận ngày 29/10/2026 có ưu tiên hơn diễn giải cũ: Owner global; một Location tối đa một Staff mỗi ngày; Staff có thể nhiều Location; hai đầu ngày phân công đều bao gồm; công việc gắn Location và Staff kế tiếp có thể tiếp tục.
- `docs/architecture/MODULES.md`, `docs/api/API_CONVENTIONS.md`, `docs/development/BACKGROUND_JOBS.md`, `AGENTS.md`.

Thư mục reports hiện chỉ có bốn report trên; không có Report 5 và workbook test để đối chiếu. Không suy ra PostgreSQL đang chạy đã áp dụng migration chỉ từ source.

## 2. Source hiện có

| Thành phần                 | Bằng chứng                                                                                             | Kết luận                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Permission                 | Domain/IdentityAccess/Permissions.cs, RolePermissions.cs                                               | Có manage/execute/verify; Owner manage/verify, Staff execute; chưa chứng minh nghiệp vụ Task đã có                   |
| Location assignment        | Infrastructure/Locations/PostgresLocationAssignments.cs, migration LocationStaffAssignments            | Có kiểm tra Staff active/role, ngày hiệu lực và chống overlap tại PostgreSQL                                         |
| Entity tên OperationalTask | Domain/Billing/MeterCapture.cs                                                                         | Chỉ là meter task: MeterId bắt buộc, purpose, reading date/period, OCR, CompletedAt                                  |
| API meter task             | Api/Controllers/Ocr/CaptureController.cs                                                               | GET/POST /api/v1/capture/meter-tasks; evidence và confirm; không có API Task vận hành tổng quát                      |
| Meter completion           | Infrastructure/Ocr/CaptureRepository.cs                                                                | Staff xác nhận reading sẽ hoàn thành meter task; đúng UC-20, không áp luồng Owner verify của UC-11 vào đây           |
| Visibility meter task      | Infrastructure/Ocr/CaptureScope.cs                                                                     | Theo Location hiện tại, không có assignee riêng từng meter task                                                      |
| Ràng buộc meter task       | Infrastructure/Persistence/CaptureConfiguration.cs                                                     | FK Meter/Contract, unique reading period/baseline/final, check period; không phù hợp task vệ sinh/kiểm tra tổng quát |
| Phụ thuộc Contract         | Infrastructure/Contracts/ContractRepository.cs                                                         | Kiểm tra final reading join OperationalTasks; sửa entity/table hiện tại sẽ ảnh hưởng move-out                        |
| Jobs                       | Infrastructure/Jobs; Application/Jobs                                                                  | Có durable queue/worker, chưa có recurrence planner và JOB-06/07 nghiệp vụ                                           |
| Notifications              | Application/Integrations/INotificationProvider.cs; Infrastructure/Integrations/UnconfiguredAdapters.cs | Có port; adapter chưa cấu hình; chưa có persistent notification workflow cho Task                                    |
| Tests                      | RolePermissionTests, PermissionAccessTests, Ocr/CaptureWorkflowTests                                   | Có quyền nền và meter workflow; chưa có bộ test create/assign/update Task tổng quát                                  |

Thiếu cho UC-10–12: entity đúng nghiệp vụ, DTO/controller/service/repository, title/requirements/priority/deadline/evidence requirement, routing và history, progress/blocker/result, Pending Verification, Owner verify/rework/cancel, private evidence, concurrency/idempotency, notification intent và test riêng.

## 3. Quyết định cần chọn

### D1 — “stub” nghĩa là gì?

- **A. Contract + stub đúng nghĩa:** DTO, route, authorization, validation, OpenAPI và contract tests. Thao tác chưa triển khai trả 501 rõ ràng; không giả thành công và không lưu DB. Chưa hoàn thiện UC-10.
- **B. Core API thực, đề xuất cho công việc hôm nay:** Owner create, tự route/assign theo Location, update thông tin, list/detail/history và đồng bộ người phụ trách. Có DB/migration, history, concurrency/idempotency và tests. Staff execution/verification, file evidence, recurring/reminder jobs và notification workflow chưa hoàn chỉnh, ghi rõ là bước tiếp theo; không tuyên bố hoàn thiện UC-10–12.
- **C. Hoàn thiện UC-10–12:** thêm Staff start/progress/blocker/submit, Owner verify/rework/cancel, evidence và persistent notification theo sự kiện. JOB-06/07 và push/email provider thật vẫn là phạm vi riêng nếu chưa được chọn và chưa chốt chính sách.

### D2 — Model và tương thích OCR

- **A, đề xuất:** tạo model StaffOperations riêng với tên phân biệt rõ, ví dụ OperationalWorkTask / bảng OperationalWorkTasks. Giữ nguyên Billing.OperationalTask và bảng OperationalTasks cho meter workflow. Ghi rõ alias sang entity OperationalTask của SRS; đây là tách hai workflow nghiệp vụ khác nhau, không tạo hai API cho cùng một task. Chưa tự sinh generic task từ meter task.
- **B:** hợp nhất model hiện tại thành generic task + chi tiết meter; phải migration/backfill, phân biệt completion policy và hồi quy OCR/Contract. Phạm vi lớn hơn.

### D3 — Quá hạn, nếu chọn phạm vi C

- **A, đề xuất:** giữ trạng thái thực thi và trả thêm isOverdue (tính từ dueAt/UTC); lọc quá hạn riêng. Không làm mất trạng thái Pending Verification. Đây là cách biểu diễn khác bảng status SRS, cần xác nhận và ghi design decision.
- **B:** lưu Overdue như trạng thái SRS, đồng thời lưu trạng thái thực thi trước đó và lịch sử quá hạn để có thể submit/rework chính xác. Cần chốt Pending Verification có bị đánh dấu quá hạn hay không.

### D4 — Evidence, nếu chọn phạm vi C

- **A:** kết quả và ghi chú là evidence; chưa upload ảnh, không cho bật yêu cầu ảnh.
- **B, đề xuất:** ảnh private, xác thực nội dung PNG/JPEG, authorize upload/download, cleanup upload lỗi, kiểm tra ảnh thuộc đúng task khi submit. Giới hạn số lượng/kích thước cần được chọn riêng; 5 ảnh × 5 MB trong SRS dành cho incident, không tự áp thành chính sách Task.

### D5 — Hành vi routing

Áp dụng quyết định 29/10 sẵn có: request không cho chọn Staff tùy ý. Server lấy Staff hiện đang phụ trách Location, xác thực active account/role; lưu snapshot người nhận và assignment history. Staff kế tiếp nhận quyền tiếp tục theo Location; lịch sử actor cũ không đổi. Cần phản ánh thay đổi trách nhiệm trước thao tác ghi tiếp theo, kể cả không có job đang chạy. Thời gian không có Staff: Owner vẫn nhìn thấy task; chặn thực thi/giao mới và trả lỗi rõ ràng. Không coi đây là Staff-to-Staff transfer.

Nếu muốn khóa task vào người nhận cũ và Owner phải reassign thủ công thì cần quyết định mới thay thế quy tắc continuity ngày 29/10; không mặc định thay đổi.

## 4. API contract dự thảo cho lựa chọn D1-B

Base path đề xuất: `/api/v1/operational-tasks`. Đây là route mới cần được chốt, chưa tồn tại.

| Method / route    | Quyền                             | Ý nghĩa                                                                                                                 |
| ----------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| POST /            | Owner/manage                      | Tạo ad-hoc task và route tới Staff phụ trách Location trong cùng transaction; 201 + Location header                     |
| GET /             | Owner hoặc Staff có quyền phù hợp | Phân trang, lọc Location/status/priority/due date; Staff chỉ thấy công việc thuộc trách nhiệm hiện tại                  |
| GET /{id}         | Như trên + scope server           | Chi tiết task và assignment hiện tại                                                                                    |
| PUT /{id}         | Owner/manage                      | Cập nhật các trường cho phép, có version và change reason; không nhận status/actor từ client                            |
| POST /{id}/assign | Owner/manage                      | Đồng bộ trách nhiệm với assignment hiện hành; không nhận staffUserId tùy ý; cùng assignment thì không tạo history trùng |
| GET /{id}/history | Scope tương ứng                   | Lịch sử phân trang, append-only; actor/time/change reason                                                               |

`POST /` dự thảo:

```json
{
  "locationId": "<guid>",
  "title": "Kiểm tra khu vực chung",
  "requirements": "Kiểm tra và ghi nhận kết quả vệ sinh",
  "priority": "Normal",
  "dueAt": "2026-10-31T10:00:00+07:00"
}
```

- Task type giai đoạn B chỉ AdHoc; không nhận Recurring rồi bỏ qua recurrence.
- Priority đề xuất Normal/High theo SRS FE-01; không lấy URGENT từ Report 4 làm emergency policy cho Task. Chưa thêm priority cấu hình động.
- Giới hạn chuỗi, phân trang và request body là validation kỹ thuật sẽ ghi trong contract triển khai; không tự thêm hạn chót/reminder policy.
- Create/command dùng `Idempotency-Key` dạng Guid theo mẫu command hiện có ở Contract; cùng actor/key/payload trả lại cùng kết quả, key khác payload trả 409. Chi tiết phạm vi key sẽ được đóng băng trong contract cuối.
- Update/assign nhận version hiện tại; stale version trả 409. dueAt phải có offset, chuẩn hóa UTC; business date phân công tính Asia/Ho_Chi_Minh. Không coi deadline mới trong tương lai là lý do tự xóa lịch sử quá hạn.
- Response đề xuất: id, locationId, title, requirements, taskType, priority, dueAt, status, currentResponsibleStaffUserId, responsibilityAvailable, version, createdAt, updatedAt. Không trả email, identity hoặc credential của Staff.
- Các lỗi: 400 input; 401 chưa đăng nhập; 403 sai quyền chức năng; 404 không thấy/không thuộc scope; 409 no_responsible_staff, stale_version, invalid_transition, idempotency_conflict. Không trả thành công khi chưa lưu bền vững.
- Tên permission View cần bổ sung riêng cho Owner/Staff hoặc ghi rõ policy đọc được ghép từ manage/execute; không dùng execute để ngầm cho phép mọi thao tác ghi.

Nếu chọn C: thêm POST /{id}/start, /progress, /blockers, /submit, /verify, /rework, /cancel; PUT /{id}/evidence và GET /{id}/evidence/{evidenceId}. Đây là action contract riêng, không cho client PATCH status tùy ý.

## 5. Thiết kế và acceptance

Flow: Controller -> StaffOperations service -> repository port -> EF adapter/DbContext. Domain giữ transition/invariant; Application kiểm quyền và điều phối. DTO không bind EF entity.

Schema mới dự kiến: task + append-only task history + command deduplication; evidence/notification chỉ thêm khi chọn phạm vi liên quan. Không sửa migration cũ. Task/history/dedup phải commit cùng transaction; lock/version kiểm lại assignment ngay trong thao tác ghi. Khóa đồng bộ assignment phải tương thích đường tạo assignment hiện có để tránh tạo race giữa hai module.

Acceptance cho B:

1. Owner tạo ở Location active có Staff active được giao đúng người; không nhận actor/status/assignee giả từ request.
2. Location thiếu trách nhiệm hoặc Staff inactive/không còn role: từ chối giao, không để lại task/history nửa chừng.
3. Staff chỉ đọc task trong Location hiệu lực; Tenant/anonymous/sai Location bị chặn. Hết phân công mất quyền ngay cả với token cũ; Staff kế tiếp tiếp tục theo quyết định 29/10.
4. Owner update đúng version giữ history; stale write, request trùng/đồng thời và assignment đổi không gây ghi đè/duplicate.
5. Owner không sửa status qua DTO; phạm vi B chưa mở đường hoàn thành khi chưa có verify workflow.
6. Lỗi DB rollback task/history/dedup; timestamp UTC, ngày assignment VN; thông báo ngoài phạm vi được công bố rõ.
7. Regression meter OCR/final reading/Contract và migration snapshot không đổi hành vi.

Acceptance bổ sung cho C: Staff không được Completed trực tiếp; submit phải đủ result/evidence; chỉ Owner verify; rework/cancel có reason/history; pending/overdue xử lý đúng lựa chọn D3; private upload/download chống IDOR; notification tồn tại bền vững dù delivery ngoài lỗi. Không tự thêm cost approval, government registration hay Work Order transition vào generic task.

## 6. Kiểm chứng trong lượt phân tích

- Ban đầu working tree sạch, nhánh `THuy/feature-task-core-API`. Chưa sửa code, migration hoặc cấu hình; chỉ bổ sung tài liệu đề xuất này.
- Lệnh: `dotnet test src/backend/BHome.sln --no-restore --filter 'Category!=Docker' --verbosity minimal -m:1 -nr:false`.
- Application Unit Tests: PASS 161/161. Domain Unit Tests: PASS 56/56.
- Toàn lệnh: FAIL vì NETSDK1004, thiếu `src/digital-signing/BHome.DigitalSigning.MySign/obj/project.assets.json`. Integration chưa chạy được trong lệnh này.
- NOT RUN: Docker/PostgreSQL/MinIO integration, kiểm tra schema DB đang chạy, full solution build thành công, migration apply, provider thật, performance/UAT. Không có test nghiệp vụ generic Task để kết luận tính năng đã hoàn thiện.
- Nhánh hiện tại không theo `member/<name>` trong AGENTS.md; trước commit cần dùng nhánh được phê duyệt hoặc nhánh cá nhân đúng quy ước. Không commit/push/merge trong lượt phân tích.

JOB-06/07, notification cadence và chính sách reassign sau khi bắt đầu không được suy ra từ OQ tài chính hoặc từ demo UI. Nếu mở rộng phạm vi tới các nhánh này phải chốt contract/acceptance tương ứng trước triển khai.
