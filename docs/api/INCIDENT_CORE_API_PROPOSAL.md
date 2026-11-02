# Phân tích và đề xuất Incident core API

Ngày rà soát: 30/10/2026. Công việc D013, BF-07 / FE-06 / UC-26–30. Chỉ Backend.

Trạng thái: **người dùng đã phê duyệt toàn bộ phương án A** bằng câu “Toàn bộ là A” ngày 30/10/2026. D1–D8 A và các giới hạn đi kèm là baseline triển khai. Hiện trạng ở mục 2 và kết quả mục 7 ghi nhận thời điểm rà soát trước triển khai; xem [API đã triển khai](INCIDENT_MAINTENANCE.md) và [bàn giao](../development/INCIDENT_CORE_API_DELIVERY.md) cho kết quả sau thay đổi. Nhánh `THuy/feature-incident-core-api`; working tree sạch trước rà soát. Quy ước `member/<name>` trong AGENTS.md cần được xử lý trước khi commit; không tự đổi nhánh.

## 1. Nguồn đã kiểm tra

Trong `docs/reports/` thực tế có bốn file:

- `BHOME_Report-1_Project_Introduction (3).docx`: mục tiêu sản phẩm và FE-06.
- `BHOME_Report-2_Project_Management_Plan (3).docx`: phạm vi Emergency, kiểm thử FE-06 và ranh giới public emergency services.
- `BHome_Report-3_Software Requirement Specification (2).docx`: BF-07 §2.7; entity IncidentReport/MaintenanceWorkOrder/Asset; DBR-09/10/13; UC-26–30 §4.1–4.5; FE-06 §6.1–6.4; GBR-01–03/11–14/18; NFR bằng chứng, bảo mật và OQ-04/05.
- `Report-4_Software Design Specification (5).docx`: kiến trúc, §6 Incident and Maintenance Management, class/sequence diagrams và thiết kế NFR.

Đã đọc văn bản và xem trực tiếp sơ đồ BF-07 trong SRS cùng hai class diagram và ba sequence diagram Incident/Emergency/Verification trong Report 4. SRS local có changelog đến 21/10/2026, mới hơn mốc 19/10 được nêu trong AGENTS.md; không suy diễn yêu cầu từ tên file hoặc các revision cũ trong changelog. Không có Report 5/6/7 hoặc tài liệu workshop trong thư mục này.

Đã đối chiếu `docs/api/API_CONVENTIONS.md`, `docs/architecture/*`, tài liệu quyết định Staff Location, Operational Tasks, model/domain/service/repository/controller/DI, EF configurations/migrations/snapshot và test liên quan. Chưa truy cập schema DB đang chạy; kết luận schema dưới đây chỉ dựa trên source EF và migrations.

## 2. Hiện trạng có bằng chứng

| Thành phần              | Thực tế trong source                                                                                                                                              | Khoảng trống BF-07                                                                                                                             |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Incident / Work Order   | Chỉ có tên module `IncidentMaintenance` trong MODULES.md; không tìm thấy entity, controller, service, repository, EF mapping, migration hoặc test nghiệp vụ riêng | UC-26–30 chưa có backend chạy được                                                                                                             |
| Quyền                   | Có `incidents.report`, `work-orders.approve-plan`, `work-orders.execute`, `work-orders.verify` và role tests                                                      | Thiếu quyền xem/review/assign/acknowledge/cancel và enforcement theo đối tượng của module mới                                                  |
| Operational Task        | Có create, routing theo Staff phụ trách hiện hành, start/progress/blocker/submit/verify/rework/cancel, history, idempotency, evidence, notification               | Task chỉ có MeterReading/AdHoc; không có IncidentId/AssetId/proposal/cost approval; trạng thái kết thúc Completed, không phải Verified         |
| Location / Room / Asset | Đã có dữ liệu, scope, `AssetStatus` Active/NeedsRepair/UnderRepair/Retired, version                                                                               | Chưa có liên kết Work Order, lịch sử bảo trì, đồng bộ nhiều việc trên một Asset; Property API đang chặn ghi đè một số thay đổi khi UnderRepair |
| Staff Location          | Có phân công theo ngày, DB chống trùng khoảng ngày; quyết định đã ghi ngày 29/10: tối đa một Staff/Location/ngày, Owner toàn hệ thống                             | Không có module lịch ca để xác định Staff đang trực; không có nhiều Staff để tùy chọn trong một Location tại cùng ngày                         |
| Tenant tenancy          | Có Contract.TenantUserId, Residents và ContractResident với thời gian cư trú                                                                                      | Resident không có liên kết tài khoản co-occupant rõ ràng; không được dùng Resident.OwnerUserId làm Tenant user ID                              |
| File                    | Có IObjectStorage/MinIO private; TaskEvidenceFiles kiểm tra nội dung PNG/JPEG, decode, staging và cleanup                                                         | File adapter/metadata đang gắn TaskId; Incident cần scope riêng, giới hạn riêng và before/after/action association                             |
| Audit                   | SecurityAuditRecord append-only trong DbContext; Task history và Property history riêng                                                                           | Chưa có Incident/WorkOrder activity, approval/reassignment/cost audit                                                                          |
| Notifications           | OperationalTaskNotification tồn tại bền vững nhưng riêng Task; INotificationProvider hiện là adapter unconfigured                                                 | Chưa có incident notification, external delivery handler, routing Emergency hoặc escalation                                                    |
| Jobs                    | PostgreSQL queue có unique key, retry/lease và handler port                                                                                                       | JobSubmission chưa hỗ trợ lịch chạy tương lai; chưa có Emergency escalation handler/planner                                                    |
| Chi phí                 | Không tìm thấy OperatingExpense entity/module trong backend                                                                                                       | Chưa thể tạo liên kết chi phí thực tế theo DBR-10 hoặc báo cáo chi phí bảo trì                                                                 |

Không đánh giá phần trăm hoàn thành: nền tảng có thể tái sử dụng nhưng chưa có luồng BF-07 end-to-end.

## 3. Luồng bắt buộc từ SRS

1. **UC-26:** Tenant trong tenancy active hoặc Staff thuộc Location hiện hành gửi Normal/Emergency; description tối thiểu 10 ký tự; tối đa 5 ảnh, mỗi ảnh 5 MB. Server xác thực Location/Room/common area/Asset liên quan. Tạo Submitted và thông báo đúng người. Staff tự báo Emergency được ghi nhận acknowledged ngay.
2. **UC-27:** thông báo Owner và Staff đủ điều kiện; acknowledge, safe containment, lý do không thể xử lý và evidence có actor/time, append-only. Chi phí ứng cứu do Staff khai cần Owner xác nhận, không tự trở thành chi phí đã duyệt. Emergency vẫn phải qua Owner review.
3. **UC-28:** Owner phân loại, reject/duplicate có lý do, giao một hoặc nhiều Work Order, đổi assignee có history; hoặc xử lý trực tiếp. Direct completion cần ít nhất một ảnh, kết quả/condition và actual cost; tạo expense, history và thông báo. Nhánh không cần xử lý vận hành dùng resolution note.
4. **UC-29:** Assigned → PendingApproval; Staff đề xuất inspection/solution/time/cost; Owner duyệt hoặc reject về Assigned. Staff chỉ bắt đầu sau approval; khi start mới InProgress và Asset UnderRepair theo normal flow bước 12–13. Progress/blocker append-only. Submit cần result và ít nhất một ảnh sau xử lý → PendingVerification.
5. **UC-30:** Owner verify → Verified, lưu verifier/time/actual cost/history/expense; chi phí lệch dự toán có lý do. Rework có lý do → InProgress. Incident chỉ tự Resolved khi mọi Work Order là Verified/Cancelled và có ít nhất một Verified theo bước 9. Nếu tất cả Cancelled phải có quyết định Owner riêng.

Incident lifecycle: Submitted → InProgress → Resolved / Rejected / Duplicate / Cancelled; không tạo Draft. Acknowledged, quá hạn và approval metadata không tự trở thành status mới.

Không tự trừ tiền Tenant, tạo Invoice charge hoặc khấu trừ cọc từ maintenance cost: OQ-05 và OQ-01 chưa chốt. Không dùng AI phân loại hoặc tự phê duyệt chi phí.

## 4. Các quyết định cần chọn

### D1 Phạm vi bàn giao

- **A — Đề xuất:** backend UC-26–30 gồm Normal/Emergency, review, proposal/approval/start, progress/evidence, verify/rework, direct handling, nhiều Work Order, maintenance history và expense tối thiểu. In-app durable ngay; external delivery chỉ pending khi provider chưa cấu hình. Escalation và co-occupant theo D3/D6. Không gọi đây là hoàn tất toàn bộ NFR hoặc push production.
- **B:** chia thành hai đợt; đợt 1 Normal → Work Order đầy đủ approval → verify, evidence/history/expense; đợt 2 Emergency và direct handling. API đợt 1 phải từ chối capability chưa hỗ trợ, không nhận Emergency rồi bỏ qua routing. Chỉ được báo hoàn tất slice đợt 1, chưa hoàn tất UC-26–30.

### D2 Cách tổ chức Work Order

- **A — Đề xuất:** module IncidentMaintenance, aggregate MaintenanceWorkOrder riêng, không thêm các trạng thái cost approval vào enum meter/task. Tái sử dụng DI, ResourceAccess, object storage, queue, error/idempotency/locking conventions. Không sao chép nguyên Task service hoặc tạo thêm generic framework.
- **B:** mở rộng OperationalTask và schema/state machine dùng chung; phạm vi lớn hơn, cần hồi quy Task/OCR/Contract và sửa các guard Kind/constraint hiện hành.

### D3 Emergency và OQ-04

UC-27 A1 quy định nhắc sau 15 phút, quá hạn 30 phút; OQ-04 vẫn Open. Report 4 cũng có job 15 phút. Không tự coi những giá trị này đã được phê duyệt.

- **A — Đề xuất:** thông báo/ack/action ngay; chưa chạy nhắc và chưa gắn nhãn SLA overdue cho đến khi chốt OQ-04. Hiển thị rõ escalation chưa hỗ trợ, không claim UC-27 đầy đủ.
- **B:** phê duyệt rõ 15/30 phút từ lúc Submitted cho Emergency; lưu cấu hình, lịch persistent, dedup từng mốc; recheck acknowledged/closed trước gửi. Đây là quyết định đóng phần Emergency của OQ-04, Normal response SLA vẫn chưa xác định.

Ở cả hai lựa chọn, giữ quyết định Staff hiện có: notify tất cả Owner active và Staff active được phân công hôm nay ở Location. Chưa có ca trực nên không claim route theo ca. Nếu không có Staff, report vẫn được lưu, Owner được thông báo và nhận biết thiếu người; không tạo Work Order giả.

### D4 OperatingExpense và chi phí

SRS UC-30 bước 6 ghi expense theo Work Order; Report 4 §6.2.3 minh họa cộng tổng expense khi đóng Incident. Đề xuất tuân thủ SRS, không ghi cả chi tiết lẫn tổng thành hai khoản chi.

- **A — Đề xuất:** expense tối thiểu category Maintenance: một nguồn chi duy nhất cho mỗi Work Order được verify hoặc lần Owner direct completion; Location bắt buộc, liên kết Incident/Room/Asset khi có, số tiền decimal VND, người xác nhận/thời điểm/ngày chi Việt Nam và lý do lệch dự toán. Có unique source để chống ghi đôi. Incident total chỉ tổng hợp các khoản đã xác nhận; emergency receipt được Owner xác nhận và liên kết một lần, tránh cộng lại trong Work Order actual cost. Chốt thêm quy tắc khoản 0 đồng trong hợp đồng API trước coding: lưu actualCost=0, không tạo dòng expense 0; khoản chưa biết không được thay bằng 0.
- **B:** chưa tạo ledger expense; lưu cost proposal/actual và công khai đây là thiếu DBR-10/UC-30. Không claim hoàn tất chức năng tài chính hoặc Owner direct handling theo đầy đủ SRS.

Không xây finance dashboard, thanh toán vendor hoặc quy tắc quy trách nhiệm Tenant trong slice này. Chi phí chỉ là ghi nhận vận hành, không khẳng định đã thanh toán ngân hàng.

### D5 Approval và thời điểm InProgress

SRS UC-29 bước 12–13 đổi trạng thái khi Staff start; sơ đồ BF-07 đặt đổi trạng thái ngay sau Owner approve. Không thêm Approved status vì không có trong lifecycle.

- **A — Đề xuất:** theo detailed UC: khi approve lưu proposal version, ApprovedBy/ApprovedAt nhưng giữ PendingApproval cho đến Staff start; DTO có planApproved/canStart để phân biệt đang chờ duyệt và đã duyệt chờ bắt đầu. Sửa proposal phải duyệt lại. Start kiểm tra đúng approval version.
- **B:** Owner approve chuyển InProgress ngay theo sơ đồ; không cần start transition riêng. Đây là quyết định chọn cách đọc sơ đồ thay cho bước 12–13, cần ghi rõ vào tài liệu.

### D6 Tenant và co-occupant

- **A — Đề xuất cho D013:** chỉ tài khoản Contract.TenantUserId có Active Contract trong kỳ cư trú được submit cho Room và common area của Location đó; lưu ContractId lúc submit. Tenant chỉ đọc report/evidence của chính mình, không xem proposal/vendor/chi phí nội bộ. Tạm hoãn co-occupant chưa có tài khoản được liên kết; ghi rõ giới hạn.
- **B:** bổ sung mapping Resident ↔ Identity user và quyền theo ContractResident/ResidenceFrom/ResidenceTo cho từng co-occupant trong slice này; cần migration và hồi quy onboarding/contract.

Cần chốt cùng D6: đề xuất reporter vẫn đọc lịch sử report của chính mình sau kết thúc tenancy, nhưng không được submit hoặc thêm evidence cho tenancy cũ. Chỉ xóa quyền truy cập khi account bị khóa theo chính sách auth; không cho Tenant mới đọc report riêng Tenant cũ. Thời hạn lưu lịch sử không tự đặt trong slice này.

### D7 Bàn giao Staff và trạng thái Asset

- **A — Đề xuất:** Work Order giữ assignee cụ thể; Staff hết phân công mất quyền ngay, Staff mới được xem công việc trong Location nhưng chỉ thực thi sau Owner reassign; giữ history và proposal/approval gốc. Asset chỉ về Active khi không còn việc bảo trì mở khác trên cùng Asset; không ghi đè Retired. Khi cancel phải Owner xác nhận condition/trạng thái phù hợp; không tự hồi Active. Kiểm tra dưới lock và transaction.
- **B:** tự chuyển quyền thực thi sang Staff phụ trách mới như generic Task; cần chốt việc approval cũ có tiếp tục áp dụng cho người mới và bổ sung assignment-change audit. Asset vẫn cần quy tắc nhiều Work Order như trên; nếu không duyệt quy tắc này, tạm chặn việc mở nhiều Work Order trên cùng Asset, thay vì tự chọn trạng thái.

### D8 Phân loại và bằng chứng

- **A — Đề xuất:** Owner nhập type/category dạng text có giới hạn, chưa tạo taxonomy quản trị riêng; reporter không chọn classification. Incident report tối đa 5 ảnh/ảnh 5 MB. Đề xuất dùng cùng giới hạn cho từng emergency-action/proposal/completion evidence set riêng, không giới hạn toàn bộ lịch sử Incident ở 5 ảnh. Chỉ PNG/JPEG private, kiểm tra nội dung thực, decode và chống vượt tài nguyên; không nhận URL/object key tùy ý. Giá trị MB chính xác phải được ghi trong API (đề xuất 5.000.000 bytes theo nghĩa MB, không dùng mặc định 5 MiB của Task).
- **B:** người dùng cung cấp danh mục phân loại và giới hạn ảnh cụ thể cho từng loại Work Order/action trước khi implement.

Owner tạo post-incident record được nhắc ở UC-26 A6 nhưng actor/permission hiện chỉ Staff/Tenant. Đề xuất chưa thêm Owner vào incidents.report trong D013; tách capability post-incident Owner để chốt sau, Owner vẫn review/direct-handle report có sẵn. Nếu cần ngay, phải phê duyệt rõ quyền và audit nguồn Owner.

## 5. Thiết kế kỹ thuật dự kiến sau khi chốt

Đây là phương án thiết kế, chưa phải endpoint/schema đã tồn tại hoặc được phê duyệt.

`IncidentReportsController / WorkOrdersController → IncidentService / EmergencyResponseService / WorkOrderService → repository ports → EF/Npgsql + private storage + durable notifications/jobs`.

Giữ GUID, BHomeDbContext và kiến trúc bốn project hiện tại; không sao chép long IDs, generic BaseRepository hoặc URL lấy file từ diagram vào source.

Các nhóm API dự kiến dưới `/api/v1`:

| Nhóm                  | Hành vi                                                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| incidents             | submit, list/detail/history theo quyền; cancel trước/sau Owner decision                                                        |
| incident review       | Owner classify/reject/duplicate, assign thêm Work Order, direct complete, resolve-no-work                                      |
| emergency             | eligible Staff acknowledge, append action/blocker/evidence; Owner record direct action trong phạm vi được duyệt                |
| work-orders           | list/detail/history, reassignment, inspect/propose, approve/reject plan, start, progress/blocker, submit, verify/rework/cancel |
| evidence              | upload/download private, kiểm tra quyền và evidence thuộc đúng report/entry/submission                                         |
| notifications/history | own-recipient list/read, role-specific timeline và maintenance history theo scope                                              |

DTO khác nhau theo role: Owner đọc cost/approval; Staff đọc kế hoạch/cost cần cho việc được giao, không tổng tài chính; Tenant chỉ diễn biến xử lý phù hợp và bằng chứng được phép, không các report của người khác/chi phí nội bộ. List/search/count/paging áp scope trước; GET private file cũng phải recheck.

Data cần thêm theo lựa chọn: IncidentReport, MaintenanceWorkOrder, proposal/decision/submission version history, IncidentActivity/WorkOrderProgress, typed evidence metadata + independent upload intent, MaintenanceHistory, Maintenance expense, durable notification/delivery và command idempotency records. Tách bảng chỉ theo nhu cầu invariant/query, không bắt chước số bảng Report 4. Không tự tạo bảng Shift hoặc general-purpose finance framework.

State + approval + cost/expense + maintenance history + audit + notification/outbox intents commit cùng transaction. Dùng version concurrency và durable unique actor/operation/key + normalized fingerprint; retry cùng key/input trả kết quả cũ, khác input → 409. Authorization phải được kiểm tra trước replay và dưới lock; không cho replay vượt scope đã bị thu hồi.

Thiết kế lock phải tương thích cả Location advisory lock của Property/Assignment lẫn Room row lock của Contract: Incident tenancy check lấy Location lock rồi Room row lock khi cần và đọc lại tenancy sau lock; rà soát mọi call path để không tạo thứ tự ngược. Verify/cancel/add Work Order cạnh tranh phải đồng bộ theo cùng report/Asset để không đóng report sớm hoặc ghi cost đôi. Dùng FK/check/unique constraint theo invariant, delete Restrict và append-only history; migration không sửa bảng cũ không cần thiết.

File flow dùng staging intent bền vững trước upload và cleanup orphan; không báo submit thành công khi mandatory evidence thiếu hoặc không tồn tại. Khi storage lỗi không để business row trỏ file thiếu. Không dùng file cleanup để xóa bằng chứng lịch sử đã liên kết. Push lỗi không rollback workflow; adapter unconfigured giữ Pending/Failed rõ ràng, không fake Sent.

## 6. Acceptance tests cần thêm

| Traceability               | Các ca phải bắt được lỗi                                                                                                                                                                                                                        |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UC-26 / GBR-01–02 / DBR-09 | Tenant đúng/sai Active Contract, Staff đúng/sai Location/ngày, tài khoản không hợp lệ, Room/Asset khác scope, description <10, severity sai, common area hợp lệ, retry create không duplicate                                                   |
| UC-26 A4–A7                | Reporter cancel trước decision; không được cancel sau decision; Owner cancel reason; Staff Emergency auto-ack; tranh chấp cancel-vs-review                                                                                                      |
| UC-27 / GBR-11/14/18       | Emergency routing, không có Staff, acknowledge song song, append-only action, action cost chưa Owner confirm, delivery lỗi vẫn có in-app, escalation theo D3 và job lặp/restart không spam                                                      |
| UC-28                      | Owner-only classify/assign/direct; không assign Staff không đủ điều kiện; reject/duplicate reason; chống self/cycle/cross-scope duplicate; một report nhiều Work Order; reassign history; direct completion thiếu ảnh/cost chưa biết bị chặn    |
| UC-29                      | Không start trước approval; không dùng approval proposal cũ; reject quay Assigned; progress append-only; không submit thiếu result/after evidence; evidence sai Work Order bị chặn; Staff cũ mất quyền                                          |
| UC-30 / GBR-12 / DBR-10/13 | Owner-only verify/rework, reason/cost variance, unique expense/history, không close khi còn việc mở, Verified+Cancelled đóng đúng, all-Cancelled cần quyết định riêng, multi-Asset/multi-report không Active sớm                                |
| Failure / security         | Duplicate command, stale version, verify-vs-cancel/add-WO, transaction rollback, upload/storage failure cleanup, auth download/IDOR/list/count, role DTO không lộ chi phí/PII, sensitive logs và migration metadata/real PostgreSQL constraints |

Build/UT/IT bằng synthetic data; integration dùng DB disposable. Không seed report hoặc chi phí thử vào DB phát triển/production. Kiểm tra migration schema thực tế trước rollout. Update API docs/Postman theo contract được duyệt. Frontend/mobile không nằm trong scope.

## 7. Kiểm tra đã thực hiện trong lượt rà soát

Lệnh:

```powershell
dotnet test src/backend/BHome.sln --filter "FullyQualifiedName~RolePermissionTests|FullyQualifiedName~ResourceAccessTests|FullyQualifiedName~PermissionAccessTests|FullyQualifiedName~OperationalTaskRulesTests|FullyQualifiedName~OperationalTaskServiceTests|FullyQualifiedName~MigrationConsistencyTests" --verbosity minimal --nologo
```

Kết quả: PASS 86/86, gồm Domain 45, Application 38, Integration metadata 3; 0 fail, 0 skip. Lệnh có build các project liên quan và thành công. Không phải 86 test Incident; hiện chưa có module để kiểm thử BF-07.

NOT RUN: Docker/PostgreSQL integration cho Incident, provider push thật, performance/coverage/UAT, frontend E2E; chưa kiểm tra hoặc migrate DB đang chạy. Không áp schema, commit, push hoặc merge.

## 8. Quyết định đã xác nhận

Gói đề xuất: **D1-A, D2-A, D3-A, D4-A, D5-A, D6-A, D7-A, D8-A**, kèm các giới hạn được ghi trong từng quyết định. Riêng D3-B có thể chọn nếu chủ dự án phê duyệt rõ mốc Emergency 15/30 phút. Quyết định chi phí/approval/quyền cần được chốt trước khi implement nhánh liên quan theo AGENTS.md §3 và §12.

Người dùng đã chọn **toàn bộ A**. OQ-04 vẫn mở: không triển khai mốc 15/30 phút. Scope D013 chưa có co-occupant account mapping, Owner tự tạo post-incident report, lịch ca, provider push thật, automatic Tenant damage charge hoặc settlement/deposit rules. Đã chốt rõ: actualCost bắt buộc có giá trị, 0 đồng được lưu nhưng không tạo expense 0; khoản chưa biết không được thay bằng 0. Ảnh tối đa 5.000.000 bytes. Staff thay thế phải được Owner reassign trước thực thi. Reporter Tenant tiếp tục xem lịch sử riêng sau hết tenancy nhưng không thêm evidence vào tenancy cũ.
