# Notification inbox — UC-35/36

Cập nhật **06/11/2026**: inbox, business-event publisher và JOB-04 delivery engine đã có trong
runtime Compact24. Provider email/push thật vẫn Unconfigured. [Trạng thái bàn giao](API_IMPLEMENTATION_STATUS.md).
`UserNotifications`, `OperationalTaskNotifications` và tên event dưới đây là tên logic CLR;
runtime dùng `notifications`/JSON và technical queue trong `operational_tasks`, không các bảng EF legacy riêng.

`/api/v1/notifications` dùng permission notifications.read-own; không nhận recipientId từ client.
Scope từ actor hiện hành, audience role đã lưu và current Staff Location assignment.
Owner chỉ đọc thông báo gửi cho mình; Tenant chỉ của mình; Staff chỉ Task thuộc Location hiện có quyền.

| Method | Route                                     | Hành vi                                                                                                     |
| ------ | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| GET    | root?page=1&pageSize=20&category=&unread= | Paging/filter, max100; categories Contract/Invoice/Payment/Adjustment/Task                                  |
| GET    | unread-count                              | `{unreadCount}` theo cùng scope                                                                             |
| POST   | `{id}/read`                               | Recipient/scoped, idempotent; người khác 404                                                                |
| POST   | read-all                                  | Chỉ các thông báo hiện có quyền của actor                                                                   |
| GET    | `{id}/target`                             | Reauthorize Invoice recipient, own Adjustment/Contract, current task Location/assignee hoặc Owner execution |

Target trả objectType/objectId/locationId/billingPeriod, không URL tùy ý hoặc file key.
Client vẫn dùng endpoint nghiệp vụ có auth khi tải đối tượng. Không coi saved link là quyền.
Response không có bank reference, payer details, CCCD, private reason hoặc evidence.

UserNotification là inbox dùng chung; OperationalTaskNotification giữ liên kết Task và được
adapter giữ làm nguồn tương thích. SourceTaskNotificationId cho phép đọc trạng thái cũ;
đánh dấu inbox cập nhật cả source read-state của đúng recipient. Không nhân đôi UI inbox live.
Unique recipient/eventKey, publication markers và immutable intent; read/delivery state được cập nhật.
Mặc định external DeliveryState Unconfigured, không báo push/email thành công khi chưa có provider.

## Business consumers

Consumers trả phòng/cọc đọc committed history, batch25/source và publication marker/recipient key
bền vững. Chạy lặp hoặc đồng thời không nhân đôi inbox; lỗi publish/delivery không rollback ledger.
Thông báo chỉ ghi event/status chung, không số tiền, reason, payer, bank reference hoặc file/hash.
Completed refund cần state cuối, actual execution time và proof metadata hợp lệ; approved vẫn báo
chờ thực hiện. Target kiểm lại quyền Contract ở server, không mở rộng quyền xem quyết toán.
Deposit sources chỉ có trên Compact24; offline legacy regression không được coi là runtime fallback.
External email/push tiếp tục Unconfigured; không có cadence/reminder hoặc contact policy mới.

`notification-publish` dùng queue/worker và shared scheduler contributors. Mỗi source event được
xử lý trong transaction riêng, advisory lock theo key và publication marker; inbox unique
recipient/eventKey. Nguồn chỉ đọc sau commit; không chạy provider trong transaction tài chính.
Batch tối đa 25/source mỗi lượt, backlog tiếp tục các lượt sau, không có cursor in-memory.

Harness move-out hiện đã explicit gọi Testing-only `process-events`, đọc Tenant inbox, kiểm quyền
Staff/Tenant khác và Owner browser mở đúng Contract từ thông báo closure. Hai chế độ đạt
22 nhóm có phí/21 nhóm không phí; no duplicate publication. Worker vẫn tắt, DeliveryState giữ
Unconfigured; không suy kết quả này thành kiểm chứng lịch worker, email/push hoặc native UI.

| Source                                        | Recipients / safe links                                                                                                                          |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| InvoiceIssuedEvents                           | Owner phụ trách/phát hành + InvoiceRecipients; Invoice                                                                                           |
| PaymentConfirmedEvents + verified allocation  | Owner phụ trách + Owner verifier + InvoiceRecipients; Invoice; không có bank/payer data                                                          |
| Adjustment requested                          | Owner phụ trách; Adjustment                                                                                                                      |
| Adjustment decided                            | Requester xem kết quả riêng; Approved mới báo viewers khác bằng link Invoice/generic balance update                                              |
| ContractExpiryNotices JOB-02                  | Recipient Owner/Tenant sẵn có; không thêm expiry job hoặc Staff authority                                                                        |
| OperationalTaskNotifications                  | Đúng recipient active/current Staff assignment hoặc Owner; MeterTask/OperationalTask                                                             |
| Automation execution PendingInputs            | Owner đã cấu hình; AutomationExecution; không phát lặp từng retry                                                                                |
| ContractMoveOutHistory đã commit              | Owner signer + Tenant có entitlement Contract; yêu cầu/review/lịch/inspection/settlement/closure, category Contract                              |
| DepositDeductionV1 và SecurityDepositRefundV1 | Owner signer + Tenant Contract; plan đã duyệt, request/APPROVED/REJECTED/Completed. Link Contract, không gửi Staff/co-occupant chỉ vì cùng phòng |

Receipt-excess refund mới chưa có event consumer riêng; không suy notification hoàn tiền đã tồn tại
từ payment-confirmed. Browser finance/refund harness tắt worker, nên kết quả browser đó không chứng minh
publication/delivery. Regression notification có fixture riêng; chưa nghiệm thu email/push thật.

Role/account được kiểm tra từ DB trước publish, nguồn không đủ điều kiện được đánh dấu đã
xử lý với recipient count phù hợp. Không broadcast đến mọi Owner/Staff. Private adjustment
reason/evidence không đưa vào title/summary. Payment chưa allocation không phát payment-confirmed.
POST `process-events` chỉ Owner + Development/Testing, gọi cùng publisher; production 403.

## JOB-04 external delivery

`notification-delivery` dùng queue/worker và contributor hiện có; một queue key notification/
external/attempt, provider key ổn định notification/external. `INotificationProvider` khai báo
IsConfigured/SupportsIdempotency, mặc định false để adapter cũ không tự nhận là đã cấu hình.
Unconfigured adapter hiện hành không tạo success hoặc attempt giả; inbox vẫn hoạt động.

Config `NotificationDelivery`: Enabled(false), MaxAttempts(4, giới hạn1–10),
InitialRetrySeconds(30), MaximumRetrySeconds(3600), RequestTimeoutSeconds(15), LeaseSeconds(90).
Validate khi start; backoff có trần, persisted Attempts/NextDeliveryAt/error/lease và append-only
attempt history. Configured provider nằm ngoài transaction tài chính và ngoài delivery claim TX.
Read state không đổi khi fail. Role/target/Staff scope được kiểm tra lại trước send.
Timeout/error với provider hỗ trợ idempotency → Pending đến giới hạn rồi Failed. Không hỗ trợ
idempotency hoặc lease hết hạn có khả năng đã gửi → PendingReview, không resend mù.
Receipt chỉ được đánh dấu Delivered khi adapter trả kết quả; không có official provider trong
repo nên production default vẫn Unconfigured. Các provider thành công/thất bại trong tests là
test doubles riêng, không được đăng ký vào runtime production hoặc coi là push/email thật.

GET `delivery-status?page=&pageSize=&state=&locationId=` chỉ Owner (`locations.manage`),
trả capability và trạng thái vận hành đã loại recipient identity, title, banking/provider refs.
Đây là màn quản trị riêng; inbox vẫn recipient-only. Failed/PendingReview cần operator review;
không có endpoint tự reset giới hạn, không đổi Paid/Invoice hoặc hoàn tiền do lỗi thông báo.

Web `/notifications` và Mobile workspace `notifications` lấy API thật, polling 30 giây,
read-all/read-one và target lookup trước khi điều hướng. Bell không suy ra trạng thái từ demo.
Client chỉ ánh xạ loại hồ sơ đã biết sang route nội bộ; không nhận URL từ notification.
Invoice/Contract/Adjustment/MeterTask deep links vẫn đi qua API quyền của hồ sơ.
Owner có màn đọc OperationalTask thật; xử lý nghiệp vụ task hiện hành vẫn trên Mobile.
Capture GET `meter-tasks` bổ sung optional query `locationId`, `roomId`, `dueDate` (ngày VN),
`status` (enum numeric), `page` (mỗi trang tối đa 100). Bộ lọc áp dụng trước giới hạn,
giữ nguyên array contract và kiểm tra Staff assignment hiện tại. Không lọc bằng PII.

> Cập nhật 08/11/2026: [Notification MVP trên Compact24](NOTIFICATION_MVP_COMPACT24.md) bổ sung
> invitation, inbox detail, announcements, devices, kênh gửi và reminder policy; giữ tương thích các route cũ bên dưới.
