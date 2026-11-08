# Bàn giao backend Auth, Tenant isolation và Notification MVP

Ngày: 08/11/2026. Thực hiện theo xác nhận triển khai của người dùng sau báo cáo rà soát 07/11.
Chỉ sử dụng Compact24. Không thêm dependency dự án, bảng vật lý hoặc EF migration legacy.
Không commit/push/deploy lên production.

## Kết quả

- Giữ auth/password/refresh/session hiện có, bổ sung email adapter và invitation token một lần;
  thông báo bảo mật lấy từ audit đã commit. Sửa fixture PolicyDto cũ làm project unit test không build.
- Có API phòng riêng của Tenant, tách khỏi quyền quản trị; kiểm thử cả Tenant khác phòng lẫn cùng phòng
  nhưng hợp đồng riêng, danh sách hợp đồng và signed-document entitlement.
- Inbox có detail/PATCH read, eventType/priority/source/action; thêm incident, account, announcement,
  residence; giữ các route và field cũ. Incident read-state/delivery-state được đồng bộ với API module cũ.
- Bổ sung Draft invoice và recipient-account/email readiness, Partial/FullyPaid với balance snapshot trong
  transaction allocation; Owner nhận unmatched. Không suy danh tính payer từ bank transaction code.
- Có announcements draft/preview/send/history theo server scope; chống gửi trùng, snapshot một inbox/user.
- Có push-device registration/unregistration theo chính user, không trả token; delivery riêng từng
  EMAIL/PUSH, lease/retry/backoff/max attempts/idempotency key ổn định, aggregate trạng thái inbox.
- Bổ sung JOB-01/07/08 và emergency escalation qua cấu hình Owner, dừng/recheck khi nghiệp vụ hoàn tất.
  Q5/Q6 mặc định tắt; không coi 15/30 phút hay một lịch nhắc bất kỳ là chính sách đã được phê duyệt.
- Notification-only worker chạy độc lập khi `Jobs.Enabled=false`, không bật các job chốt hóa đơn,
  đổi hợp đồng, thanh toán hoặc giải phóng phòng. Development dùng Sandbox; Production mặc định tắt/unconfigured.
- Đã khởi động và smoke HTTPS local: health live/ready 200, Swagger có route mới; không token → 401.
  DB local được kiểm metadata bằng kết nối ép read-only: vẫn 24 bảng; không bật reminder Q5/Q6 tại Location.

Chi tiết API, config, data mapping và giới hạn tương thích:
[Notification MVP trên Compact24](../api/NOTIFICATION_MVP_COMPACT24.md).

## Traceability và kiểm thử nghiệp vụ

| Yêu cầu | Căn cứ | Thực hiện / kiểm chứng |
| --- | --- | --- |
| Đổi mật khẩu, refresh an toàn | FE-02, UC-01/02, GBR-13, Report 4 Token Design | Compact24AuthTests; đổi mật khẩu revoke session; audit → PASSWORD_CHANGED |
| Không đọc dữ liệu Tenant khác | I.4.4, GBR-02, FE-07; PDF §2.2/3 | RoomAndContractReadsRejectOtherTenantsEvenInTheSameRoom; Contract scope/revocation/signed-document regression |
| Inbox theo user, privacy và dedup | FE-07 §7.4, GBR-14/18; NOT-09 | Inbox/detail/read/target; không trả AUDIT/OUTBOX; negative ID và read của Tenant khác |
| Invoice chung và mọi co-occupant | UC-20..25, PDF Q1/Q2; NOT-03/T01 | Invoice recipient snapshot; MissingInputs khi thiếu account/email; ba người nhận notices riêng |
| Partial/Paid và transaction idempotency | GBR-10/18, PDF Q3; NOT-04..07/T02..05 | Worker xử lý trễ vẫn giữ 20.000/80.000 và một Paid transition; replay không tăng allocation; payer null vẫn unknown |
| Announcements theo scope | UC-35/36, GBR-14; NOT-01/02/12 | Staff Location khác hoặc selected user ngoài scope nhận 403; concurrent send không trùng |
| Kênh gửi và retry | API-02/JOB-04, GBR-14/18; NOT-08 | Stable key, retry không nhân inbox; source/read-state không bị rollback; API chỉ trả trạng thái an toàn |
| Incident/emergency | UC-26..30, GBR-11, PDF Q4/Q5; NOT-10/11 | Location assignment, cấu hình explicit; read không acknowledge; giữ generic adapter khi v2 channel tắt |
| Nhắc tạm trú | GBR-06/JOB-08, PDF Q6; T08/09 | WEEKLY/MONTHLY dedup riêng, kết thúc không tạo thêm, channel còn chờ bị Suppressed |
| Account invitation | UC-15, PDF §2.1/Q2 | Owner-only, active-tenancy scope, một lần, xác nhận email, không lưu raw token trong notification |
| Worker không bật nghiệp vụ khác | Q7, nguyên tắc không thay đổi financial state từ notification | NotificationOnlyAutomationRunsWithoutEnablingFinancialJobs |

Nguồn gốc vẫn là reports trong `docs/reports/` và PDF đã đính kèm; không lấy báo cáo tiến độ làm test evidence.
Report 5 UT/IT/ST/AT gốc chưa có trong thư mục reports ở lượt phân tích; dùng test thực tế trong repo.

## Kiểm chứng đã chạy

- `dotnet build src/backend/BHome.Api/BHome.Api.csproj --no-restore --verbosity quiet`: thành công, 0 warning/error.
- `dotnet test tests/backend/BHome.Application.UnitTests/BHome.Application.UnitTests.csproj --no-restore --logger 'console;verbosity=minimal'`:
  **315 passed, 0 failed, 0 skipped**.
- `dotnet test tests/backend/BHome.Domain.UnitTests/BHome.Domain.UnitTests.csproj --no-restore --logger 'console;verbosity=minimal'`:
  **106 passed, 0 failed, 0 skipped**.
- Bộ tích hợp cuối theo filter bên dưới: **92 passed, 0 failed, 0 skipped** (2 phút 1 giây).
- Case tạo Staff + role + invitation bổ sung sau cùng: **1 passed, 0 failed, 0 skipped**.
  Tổng **93 case tích hợp khác nhau** đã qua; không cộng trùng các lượt rerun.
- `git diff --check`: qua, không lỗi whitespace.
- HTTPS `https://localhost:7240/health/live`, `/health/ready`, `/swagger/v1/swagger.json`: 200;
  `/api/v1/tenant/rooms`, `/api/v1/notifications/channel-status` không token: 401.
  Kiểm TLS bằng trust store mặc định, không tắt xác minh chứng chỉ.
- PostgreSQL local: metadata public có đúng 24 bảng, 0 Location đã bật emergency/residence reminders.

Filter tích hợp dùng trong lần kiểm cuối:

```text
FullyQualifiedName~Compact24NotificationMvpTests|
FullyQualifiedName~Compact24AuthTests|
FullyQualifiedName~Compact24InboxTests|
FullyQualifiedName~Compact24PaymentRegressionTests|
FullyQualifiedName~Compact24InvoiceRegressionTests|
FullyQualifiedName~Compact24TaskRegressionTests|
FullyQualifiedName~Compact24ContractRegressionTests.Scope|
FullyQualifiedName~Compact24ContractRegressionTests.SignedDocumentIntegrity|
FullyQualifiedName~IncidentApiTests
```

Chạy bằng `dotnet test tests/backend/BHome.IntegrationTests/BHome.IntegrationTests.csproj --no-restore --filter <filter>`
với `BHOME_COMPACT24_TEST_ADMIN` là kết nối admin loopback tới database `postgres`.
Lượt thực thi nạp credential local vào environment của process trong bộ nhớ, không in/ghi credential vào repo.
Fixture tạo/xóa DB riêng `bhome_compact24_<uuid>` chứa đúng schema 24 bảng và dữ liệu tổng hợp.
Không dùng database `bhome` làm nơi seed/test tài chính, không chạy DB 70 bảng.

Lần bổ sung incident regression ban đầu có hai failure do API adapter cũ chưa giữ hành vi khi kênh v2 tắt.
Đã sửa nhánh tương thích và đồng bộ trạng thái; lần rerun 35 test liên quan qua toàn bộ.
Không sửa assertion của hai incident test để che lỗi.

## Giới hạn vận hành

- Chưa gửi SMTP/email/push thật; Sandbox không có nghĩa thiết bị đã nhận. Có SMTP adapter cấu hình
  sẵn giao diện, nhưng cần credential/deployment do dự án cung cấp. Push production cần adapter được duyệt;
  không tự chọn hoặc khai báo Firebase/Expo đã tích hợp.
- Chưa thay UI Web/Mobile. API/config/DTO đã có tài liệu để client tích hợp. Action không cấp quyền business object.
- Q5/Q6 chỉ có cơ chế cấu hình/test; Owner cần quyết định ngưỡng/lịch trước khi bật.
- Invitation chỉ cấp cho Staff hoặc occupant thuộc tenancy active đủ scope; email đã thuộc account khác
  không tự liên kết. Email gửi lỗi trả PendingRetry; gửi lại sẽ thay grant cũ. Không lưu raw token để retry.
- Staff history chưa được mở rộng quyền sau khi assignment kết thúc; dữ liệu vẫn được lưu và deep-link từ chối.
- Production smoke, provider delivery thực tế, load/performance/coverage và end-to-end trên client: **NOT RUN**.
  Không quy đổi các test chức năng thành số liệu coverage hoặc SLA.

## File thay đổi

Báo cáo rà soát 07/11 có sẵn từ lượt trước được giữ nguyên, không tính là sửa implementation trong lượt này.
Danh sách file thay đổi/tạo trong lượt triển khai:

```text
.env.example
docs/api/NOTIFICATIONS.md
docs/api/NOTIFICATION_MVP_COMPACT24.md
docs/development/NOTIFICATION_MVP_DELIVERY_2026-11-08.md
scripts/Start-Api.ps1
src/backend/BHome.Api/Configuration/DevelopmentEnvironmentFile.cs
src/backend/BHome.Api/Controllers/IdentityAccess/AccountInvitationsController.cs
src/backend/BHome.Api/Controllers/Notifications/NotificationWorkspaceController.cs
src/backend/BHome.Api/Controllers/Notifications/NotificationsController.cs
src/backend/BHome.Api/appsettings.Development.json
src/backend/BHome.Application/Billing/InvoiceContracts.cs
src/backend/BHome.Application/Billing/InvoiceService.cs
src/backend/BHome.Application/IdentityAccess/IAccountInvitations.cs
src/backend/BHome.Application/Notifications/NotificationChannels.cs
src/backend/BHome.Application/Notifications/NotificationContracts.cs
src/backend/BHome.Application/Notifications/NotificationWorkspace.cs
src/backend/BHome.Application/PaymentsDebt/PaymentService.cs
src/backend/BHome.Domain/Notifications/UserNotification.cs
src/backend/BHome.Domain/PaymentsDebt/PaymentRecords.cs
src/backend/BHome.Infrastructure/Billing/InvoiceRepository.cs
src/backend/BHome.Infrastructure/DependencyInjection.cs
src/backend/BHome.Infrastructure/IdentityAccess/AccountInvitations.cs
src/backend/BHome.Infrastructure/Modules/IncidentMaintenance/IncidentNotificationDelivery.cs
src/backend/BHome.Infrastructure/Modules/Notifications/CompactNotificationEvents.cs
src/backend/BHome.Infrastructure/Modules/Notifications/CompactNotificationReminders.cs
src/backend/BHome.Infrastructure/Modules/Notifications/CompactNotificationWorkspace.cs
src/backend/BHome.Infrastructure/Modules/Notifications/CompactNotificationWriter.cs
src/backend/BHome.Infrastructure/Modules/Notifications/NotificationAutomationWorker.cs
src/backend/BHome.Infrastructure/Modules/Notifications/NotificationChannelProvider.cs
src/backend/BHome.Infrastructure/Modules/Notifications/NotificationChannelWorker.cs
src/backend/BHome.Infrastructure/Modules/Notifications/NotificationDeliveryStore.cs
src/backend/BHome.Infrastructure/Modules/Notifications/NotificationEventPublisher.cs
src/backend/BHome.Infrastructure/Modules/Notifications/NotificationRepository.cs
src/backend/BHome.Infrastructure/Modules/Notifications/SettlementNotificationPublisher.cs
src/backend/BHome.Infrastructure/Modules/Operations/CompactOperationsRepository.cs
src/backend/BHome.Infrastructure/Persistence/Compact24/Compact24EventsAndLedger.cs
src/backend/BHome.Infrastructure/Persistence/Compact24/CompactNotificationRepository.cs
tests/backend/BHome.Application.UnitTests/Contracts/ContractServiceTests.cs
tests/backend/BHome.IntegrationTests/Compact24/Compact24NotificationMvpTests.cs
tests/backend/BHome.IntegrationTests/Compact24/Compact24WorkflowRegressionTests.cs
tests/backend/BHome.IntegrationTests/PaymentsDebt/NotificationEventTests.cs
tests/backend/BHome.IntegrationTests/PaymentsDebt/PaymentNotificationSnapshotTests.cs
```
