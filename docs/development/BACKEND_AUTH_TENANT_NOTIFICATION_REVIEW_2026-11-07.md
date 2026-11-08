# Rà soát backend: xác thực, cách ly Tenant và Notification

Ngày: 07/11/2026. Phạm vi: phân tích, chưa triển khai thay đổi nghiệp vụ.

## 1. Kết luận và mức độ bằng chứng

- Đổi mật khẩu và refresh session đã có implementation tương đối đầy đủ trên Compact24. Không cần viết lại AuthModule.
- Hợp đồng được lọc theo Tenant ở server; chưa phát hiện đường đọc hợp đồng Tenant khác trong các luồng đã kiểm tra. Đây là kết luận đọc code, chưa phải chứng nhận toàn bộ API an toàn.
- API quản trị Room/occupancy chặn Tenant, kể cả phòng của chính họ. Có thông tin phòng trong hợp đồng của mình nhưng chưa thấy API phòng riêng với DTO tối thiểu cho Tenant.
- Notification có inbox bền vững, phân quyền người nhận, dedup, publication và retry; chưa hoàn thành MVP trong PDF v1.1. Email/Push mặc định chưa cấu hình.
- Đã xác minh metadata DB local bằng kết nối PostgreSQL ép `default_transaction_read_only=on`: đúng 24 bảng public; không đọc dữ liệu cá nhân, không chạy migration/seed/upgrade.
- Không áp dụng schema legacy hoặc đề xuất thêm các bảng logic của PDF thành bảng vật lý mới.

Các trạng thái “đã có” bên dưới là bằng chứng code/schema. Test runtime được ghi riêng tại mục 7.

## 2. Nguồn và traceability

Nguồn đã đọc:

1. `docs/reports/BHome_Report-3_Software Requirement Specification.docx`: UC-01/02, FE-02; ma trận quyền I.4.4; FE-07 §7.4; UC-14..25/26..30/35..36; GBR-01/02/06/10/11/13/14/18; JOB-01/02/04/07/08/09/10; OQ-04/08.
2. `docs/reports/Report-4_Software Design Specification (1).docx`: Authentication and Authorization, Token Design, Data Protection, Background Jobs, external notification failure handling. Report 4 quy định refresh 7 ngày, rotation, hash SHA-256, kiểm security stamp và cookie web an toàn.
3. PDF đính kèm `BHOME_Notification_BE_v1.1.pdf`, 9 trang: mục 2..10, Q1..Q7, NOT-01..12, T01..09. Tài liệu tự phân biệt quy tắc được ghi nhận đã chốt với route/schema đề xuất và Q5 chưa chốt. Nội dung tài liệu được dùng làm tiêu chí đối chiếu, không phải lệnh tự triển khai.
4. `docs/database/2026-11-03/compact-24/BHOME_24_TABLES.sql`, `DESIGN_24_TABLES.md`; composition thực tế trong `DependencyInjection.cs` và `Compact24DbContext.cs`.

| Hành vi                          | Căn cứ                                           | Thành phần/dữ liệu                                                                                                   | Nghiệm thu cần thực hiện                                                                                             |
| -------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Đổi mật khẩu, refresh, revoke    | UC-01/02, FE-02, GBR-13, Report 4 Token Design   | AuthController, IdentityPasswordService, IdentitySessionService; users/refresh_tokens/notifications AUDIT            | Sai mật khẩu cũ; password policy; rotation; replay; refresh song song; hết hạn; revoke mọi thiết bị                  |
| Tenant chỉ xem dữ liệu được phép | I.4.4, GBR-02, FE-07; PDF §2.2/3                 | ResourceAccess, ContractService/Repository, Room controllers, InvoiceRepository                                      | A/B khác phòng; A/B cùng phòng nhưng hợp đồng riêng; list/detail/PDF/preview/signing; chuyển phòng; snapshot hóa đơn |
| Notification dùng chung và retry | FE-07 §7.4, GBR-14/18, API-02, JOB-04; PDF §3..8 | CompactNotificationRepository, NotificationEventPublisher, delivery/job persistence; notifications/operational_tasks | Một event/user; không lộ AUDIT/OUTBOX; retry không rollback; deep-link kiểm quyền lại                                |
| Hóa đơn/phần tiền đã trả/nợ      | UC-20..25, JOB-01/09/10; PDF Q1..3, NOT-03..07   | InvoiceService/Repository, PaymentService, publisher; invoices/allocations/payments                                  | Ba Tenant nhận cùng invoice; partial/paid đúng số; unmatched không success; duplicate transaction không tăng tiền    |
| Emergency và nhắc tạm trú        | UC-18/27, GBR-06/11, JOB-08; PDF Q4..6           | IncidentService/Repository, OperationsService, scheduler                                                             | Staff assignment đúng ngày; read khác acknowledge; ngưỡng cấu hình; weekly/monthly; dừng khi hoàn tất                |

Không có bộ Report 5 UT/IT/ST/AT gốc trong danh mục `docs/reports/` được thấy ở lượt này; không lấy tài liệu tiến độ hoặc case mẫu làm bằng chứng test đã chạy.

## 3. Đổi mật khẩu và làm mới phiên

### Đã có

- `POST /api/v1/auth/change-password`: bắt buộc đăng nhập/quyền Account.ChangePassword; nhận CurrentPassword/NewPassword, lấy user/session từ JWT.
- `IdentityPasswordService.ChangeAsync`: khóa user trong transaction, kiểm tra lại session, dùng ASP.NET Identity đổi mật khẩu, ghi audit; thành công revoke mọi session và consume reset grant. Controller xóa refresh cookie và trả 204; người dùng cần đăng nhập lại.
- `POST /api/v1/auth/refresh`: nhận refresh token qua body hoặc cookie web; lưu hash thay vì raw token; mỗi lần dùng thành công consume token cũ và cấp token mới.
- Phát hiện reuse token đã consume và revoke session family. Khóa user nhằm tuần tự hóa refresh/revoke/change-password cạnh tranh.
- Phiên có hạn tuyệt đối tối đa 7 ngày; refresh không kéo dài quá hạn gốc. JWT middleware kiểm lại session, security stamp, role, active/lockout/2FA trên server.
- Logout và logout-all; cookie HttpOnly/Secure/SameSite=Strict, path `/api/v1/auth`; kiểm Origin cho transport web.
- Persistence hiện hành dùng `users` và `refresh_tokens` với SESSION/TOKEN; audit ở `notifications` loại AUDIT, không cần bảng Sessions riêng.

### Chưa đủ / liên quan Notification

- Không thấy phát PASSWORD_CHANGED hoặc ACCOUNT_ACCESS_CHANGED vào inbox/email theo PDF §2.1. Audit bảo mật không thay thế thông báo gửi người dùng.
- Forgot/reset-password đã có code token hết hạn, hash và dùng một lần, nhưng DI đăng ký `UnconfiguredPasswordResetDelivery`. Provider mặc định chưa gửi email; request reset không khả dụng khi chưa cấu hình, không được báo là đã gửi thành công.
- Không thấy invitation email một lần cho mọi co-occupant theo Q2. Đây là phần cần tích hợp thêm, tách khỏi token lưu trong Notification.
- Cần chạy lại test Compact24 thực tế trước khi nghiệm thu. Không suy kết quả từ test legacy.

## 4. Tenant không xem phòng/hợp đồng người khác

### Đã có

- `ResourceAccess.CanAccessAsync`: nhánh Tenant chỉ chấp nhận TenantUserId của tài nguyên bằng user hiện tại; scope lấy từ lookup server.
- `ContractService.Load`: dùng scope LocationId/TenantUserId từ hợp đồng; không đủ quyền trả 404. Nhiều thao tác detail, document/signing, readiness và lifecycle dùng helper này hoặc kiểm signer bổ sung.
- `ContractRepository.ListAsync`: điều kiện TenantUserId == ActorId được áp dụng trước count/pagination. Tenant không được xem hợp đồng riêng của người khác chỉ vì cùng Room.
- `InvoiceRepository.Visible`: quyền xem dựa trên InvoiceRecipient snapshot. Hóa đơn chung Room/kỳ được chia sẻ với đúng người nhận, không biến quyền xem hóa đơn thành quyền xem hợp đồng cá nhân.
- `CompactNotificationRepository.TargetAsync`: kiểm lại quyền Invoice/Adjustment/Contract/Task khi mở link.

### Giới hạn và phần nên bổ sung

- `RoomsController` dùng Permissions.Property.View chỉ cấp Owner/Staff. `/api/v1/occupancy` và occupancy-history cũng dùng quyền này. Vì vậy việc chặn phòng khác hiện có, nhưng thông qua chặn toàn bộ API quản trị cho Tenant.
- `ContractView` của chính Tenant có RoomId/RoomNumber/LocationName. Chưa thấy API riêng trả thông tin phòng của chính Tenant theo quan hệ cư trú hiện hành, với DTO giới hạn và không kèm hợp đồng/PII người khác.
- Nếu yêu cầu chỉ là chống truy cập chéo: giữ các chốt quyền hiện có và bổ sung regression. Nếu cần hoàn thiện màn hình phòng của Tenant: bổ sung luồng đọc riêng; không đơn giản cấp Property.View cho Tenant.
- Case đọc hợp đồng Tenant khác đã có trong `ContractServiceTests.T16_OtherTenantOrUnassignedStaffCannotReadContract` và integration contract tests, nhưng test unit hiện không biên dịch và chưa chạy các luồng DB tương ứng trong lượt này.
- Cần bổ sung/chạy ma trận HTTP trên Compact24: khác phòng, cùng phòng/hợp đồng khác, list/detail/PDF/preview/target, sửa ID trên URL, chuyển phòng và lịch sử. Không tuyên bố đã kiểm hết mọi endpoint.

## 5. Notification theo PDF

| Nhóm                           | Hiện trạng                                                                                                                         | Thiếu / khác đặc tả                                                                                                                                                                     |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inbox API                      | Có list page/pageSize, unread-count, POST read/read-all, target                                                                    | Chưa có GET detail theo id. Route PATCH/cursor trong PDF là đề xuất; không cần đổi chỉ để giống tên                                                                                     |
| Quyền và dedup                 | Recipient hiện tại; unique recipient+event_key; loại AUDIT/OUTBOX khỏi inbox; target kiểm quyền lại                                | Staff inbox hiện chỉ cho category Task và còn assignment; lịch sử có thể biến mất khi assignment kết thúc, khác mong muốn giữ lịch sử tại §3 PDF; cần chốt nội dung được giữ            |
| Mô hình event/DTO              | Category/title/summary/object/read/delivery state                                                                                  | Chưa có catalog EventType/priority/action/source và chính sách channel như PDF. Filter hiện chỉ Contract/Invoice/Payment/Adjustment/Task; chưa nhận Incident/Other/Account/Announcement |
| Account security               | Auth và AUDIT đã có                                                                                                                | Chưa thấy invitation/reset email adapter thực tế, PASSWORD_CHANGED, ACCOUNT_ACCESS_CHANGED gửi người dùng                                                                               |
| Invoice Draft                  | Có Draft invoice và recipient theo kỳ                                                                                              | Publisher hiện đọc InvoiceIssuedEvent của Final; chưa thấy thông báo INVOICE_DRAFT_CREATED                                                                                              |
| Invoice Final                  | Có issued event và phát inbox cho invoice recipients                                                                               | Chưa có Email/Push thật theo channel; cần test ba Tenant đủ tài khoản/email                                                                                                             |
| Co-occupants                   | Recipient lấy từ occupancy overlap kỳ, residents đã gắn user, cộng Tenant hợp đồng                                                 | Resident chưa gắn user bị loại khỏi tập gửi; chưa enforce mỗi co-occupant có email/tài khoản/invitation; email trong schema nullable                                                    |
| Partial/FullyPaid              | Chỉ phát sau PaymentConfirmedEvent có allocation; không phát từ giao dịch chưa phân bổ                                             | Cùng thông báo generic theo AllocationId; chưa tách partial/paid transition; summary không có paid/outstanding/mã giao dịch an toàn; chưa có dedup riêng một FullyPaid/user/invoice     |
| Payer identity                 | PaidByUserId nullable; hiển thị unknown khi null; Tenant DTO che identity người trả khác                                           | Owner có thể chọn payer thuộc invoice và HumanVerified; chưa thấy bằng chứng mapping payer riêng. Không được coi việc user có quyền invoice là bằng chứng người đó chuyển khoản         |
| Unmatched / due soon / overdue | Có dữ liệu Payment review, debt và overdue calculation                                                                             | Chưa thấy notification unmatched cho Owner; chưa thấy JOB-01 reminder theo window và hủy/recheck reminder khi paid; due soon cũng chưa thấy                                             |
| Invoice bị chặn final          | Có notification billing PendingInputs cho Owner                                                                                    | Chưa đủ event/audience Owner + Staff phụ trách theo PDF                                                                                                                                 |
| Adjustment                     | Có requested/decided và cập nhật invoice cho người liên quan                                                                       | Cần cấu hình thêm channel/event policy; không cần viết lại workflow điều chỉnh                                                                                                          |
| Contract                       | Có expiry, move-out/settlement, một số trạng thái hoàn cọc/khấu trừ                                                                | Chưa thấy bộ đầy đủ signing-required/activated/renewal; expiry hiện gửi Owner/Tenant, chưa Staff như PDF                                                                                |
| Incident/Emergency             | Có incident notification riêng, high priority, delivery job; Staff theo active Location assignment; acknowledge riêng              | IncidentNotification hiện là OUTBOX, đọc qua API incident riêng; chưa đi vào inbox chung. Chưa có escalation cấu hình Q5. Mark read không thực hiện acknowledge                         |
| Operational task               | Có nguồn task notification, mirror sang inbox, kiểm assignment                                                                     | Chưa thấy JOB-07 quét due/overdue theo window. Cần kiểm đủ assigned/rework/completion/unassigned theo catalog                                                                           |
| Residence                      | Có Tenant cập nhật trạng thái/evidence, Owner xác nhận; Staff bị chặn                                                              | Chưa thấy JOB-08 weekly/monthly, notification trigger, window dedup, recheck và dừng theo Q6                                                                                            |
| Announcements                  | Không thấy module/route tương đương                                                                                                | Thiếu draft, preview recipients, send/history và server scope ALL/LOCATION/ROOM/USER/SELECTED_USERS                                                                                     |
| Delivery/JOB-04                | Có lease, attempt, retry backoff, stable key, max attempts, PendingReview khi provider không idempotent; tách khỏi business commit | Provider mặc định Unconfigured; chỉ một luồng external cho notification, chưa delivery riêng Email/Push, địa chỉ email hay thiết bị; chưa API đăng ký/hủy push token                    |

### Các rủi ro cần ưu tiên

1. Inbox chung bỏ sót incident dù incident đã có notification riêng: cần hợp nhất khả năng đọc và deep-link, không tạo hai inbox trùng.
2. Q2 chưa bảo đảm đủ co-occupant có tài khoản/email: dù gửi đúng invoice snapshot, người chưa được liên kết vẫn không nhận.
3. Generic payment notice không đạt NOT-06/07: cần dùng allocation và balance nghiệp vụ để phân biệt partial với paid, không suy payer từ mã bank.
4. Retry hiện không đủ để tuyên bố Email/Push hoạt động. Cần mock/sandbox adapter chạy được và test độc lập từng channel.
5. Tính overdue hoặc tạo task định kỳ không đồng nghĩa đã có JOB-01/JOB-07/JOB-08 reminder.

## 6. Giữ đúng 24 bảng khi triển khai sau xác nhận

- Tái sử dụng `notifications`: INBOX/OUTBOX/AUDIT; event_data và delivery_history có cấu trúc, unique key hiện hành. Không tạo NotificationDeliveries/OutboxMessages thành bảng mới chỉ vì PDF liệt kê chúng.
- Tái sử dụng `operational_tasks` cho queue/execution; `locations.operating_settings` cho cấu hình nghiệp vụ có version; `contract_residents` cho trạng thái tạm trú; `users` cho account/reset grant.
- Push devices, announcement metadata và delivery từng channel chưa có implementation. Cần thiết kế mapping có schema/version, quyền truy cập và index phù hợp trong 24 bảng trước khi sửa; không tự mặc định lưu token ở chỗ bất kỳ.
- Không chứa raw reset/activation token trong notification/outbox/log. Device push token là dữ liệu kỹ thuật riêng, cần hạn chế truy cập và không xuất vào log.
- Snapshot invoice recipients theo kỳ; announcement recipients tại thời điểm gửi; luôn kiểm lại quyền tài nguyên khi mở deep-link.

## 7. Kiểm chứng thực tế trong lượt phân tích

| Kiểm tra                                                                                     | Kết quả                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Git đầu lượt                                                                                 | Clean; branch `THuy/Fix-API-to-Mock`                                                                                                                                         |
| Metadata PostgreSQL local, transaction read-only                                             | 24 bảng public. Có notifications với INBOX/OUTBOX/AUDIT schema, delivery_history; users có email/reset fields. Không có room_types/room_type_id trong nhóm cột được truy vấn |
| Build qua lệnh test integration `--no-restore`                                               | Build API/Infrastructure/IntegrationTests thành công                                                                                                                         |
| Integration filter Compact24AuthTests, Compact24InboxTests và 7 payment/inbox/delivery cases | Tổng 18: 0 passed, 0 failed, 18 skipped vì thiếu `BHOME_COMPACT24_TEST_ADMIN`. Không chạy assertion nghiệp vụ DB                                                             |
| Application UnitTests, filter IdentityAccess                                                 | Không chạy test: project lỗi biên dịch CS1503 tại `Contracts/ContractServiceTests.cs`, dòng 56–57,126–127; lời gọi constructor PolicyDto theo chữ ký cũ                      |
| Domain UnitTests, filter IdentityAccess                                                      | 45 passed, 0 failed, 0 skipped                                                                                                                                               |
| Docker inventory                                                                             | Docker Desktop Linux Engine trả HTTP 500; không khởi động container/không chạy bộ Docker tests                                                                               |

Lệnh test:

```powershell
dotnet test tests/backend/BHome.Domain.UnitTests/BHome.Domain.UnitTests.csproj --no-restore --filter 'FullyQualifiedName~IdentityAccess' --logger 'console;verbosity=minimal'
dotnet test tests/backend/BHome.Application.UnitTests/BHome.Application.UnitTests.csproj --no-restore --filter 'FullyQualifiedName~IdentityAccess' --logger 'console;verbosity=minimal'
dotnet test tests/backend/BHome.IntegrationTests/BHome.IntegrationTests.csproj --no-restore --filter 'FullyQualifiedName~Compact24AuthTests|FullyQualifiedName~Compact24InboxTests|FullyQualifiedName~Compact24PaymentRegressionTests.RecipientInbox|FullyQualifiedName~Compact24PaymentRegressionTests.RevalidateTarget|FullyQualifiedName~Compact24PaymentRegressionTests.NotificationEvents|FullyQualifiedName~Compact24PaymentRegressionTests.NoUnallocatedNotice|FullyQualifiedName~Compact24PaymentRegressionTests.Delivery' --logger 'console;verbosity=minimal'
```

Không sửa source/migration/config nghiệp vụ, không commit/push. Chỉ thêm báo cáo này; các lệnh build tạo output thông thường. Cài công cụ đọc PDF/PostgreSQL vào Python môi trường máy để phân tích, không thêm dependency dự án.

## 8. Phạm vi đề nghị phê duyệt

1. Khôi phục khả năng build test; thiết lập DB test disposable đúng Compact24. Kiểm chứng auth hiện có và ma trận Tenant, bổ sung các case thiếu.
2. Bổ sung luồng đọc phòng của chính Tenant nếu nằm trong yêu cầu màn hình; giữ hợp đồng riêng và quyền quản trị Room như hiện tại.
3. Chuẩn hóa notification event/channel policy trên persistence 24 bảng; hoàn thiện Draft/Final/Partial/Paid/Unmatched và recipient Q2, hợp nhất incident vào inbox.
4. Hoàn thiện account security/invitation/reset delivery, mock/sandbox Email/Push, push-device lifecycle và retry từng channel.
5. Announcements theo scope; JOB-01/07/08; cấu hình và test emergency escalation.

Các quyết định cần ghi nhận trước nhánh phụ thuộc:

- Q5: ngưỡng emergency escalation/overdue, hoặc giữ tắt đến khi duyệt. 15/30 phút trong PDF chỉ là đề xuất.
- Q6: weekly hay monthly mặc định, thời điểm gửi theo Asia/Ho_Chi_Minh, hoặc bắt Owner cấu hình rồi mới bật.
- Q2: xử lý occupant hiện chưa có email/tài khoản, không tự tạo email hoặc giả nhận thay người đại diện.
- Lịch sử Staff notification sau hết assignment: giữ nội dung an toàn hay ẩn; deep-link luôn từ chối tài nguyên ngoài scope hiện tại.
- Tái sử dụng provider sandbox/mock ở MVP; production Email/Push cần cấu hình dịch vụ được lựa chọn, không tự chọn provider hay hardcode secret.

Việc xác nhận báo cáo/phạm vi là bước tiếp theo do người dùng yêu cầu. Chưa bắt đầu triển khai chức năng.
