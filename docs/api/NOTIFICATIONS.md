# Notification inbox — UC-35/36

`/api/v1/notifications` dùng permission notifications.read-own; không nhận recipientId từ client.
Scope từ actor hiện hành, audience role đã lưu và current Staff Location assignment.
Owner chỉ đọc thông báo gửi cho mình; Tenant chỉ của mình; Staff chỉ Task thuộc Location hiện có quyền.

| Method | Route | Hành vi |
| --- | --- | --- |
| GET | root?page=1&pageSize=20&category=&unread= | Paging/filter, max100; categories Contract/Invoice/Payment/Adjustment/Task |
| GET | unread-count | `{unreadCount}` theo cùng scope |
| POST | `{id}/read` | Recipient/scoped, idempotent; người khác 404 |
| POST | read-all | Chỉ các thông báo hiện có quyền của actor |
| GET | `{id}/target` | Reauthorize Invoice recipient, own Adjustment/Contract, current task Location/assignee hoặc Owner execution |

Target trả objectType/objectId/locationId/billingPeriod, không URL tùy ý hoặc file key.
Client vẫn dùng endpoint nghiệp vụ có auth khi tải đối tượng. Không coi saved link là quyền.
Response không có bank reference, payer details, CCCD, private reason hoặc evidence.

UserNotifications là inbox dùng chung đầu tiên; OperationalTaskNotifications có Task FK bắt buộc
được giữ làm nguồn nghiệp vụ tương thích. SourceTaskNotificationId cho phép đọc trạng thái cũ;
đánh dấu inbox cập nhật cả source read-state của đúng recipient. Không nhân đôi UI inbox live.
Unique recipient/eventKey, publication markers và immutable intent; read/delivery state được cập nhật.
Mặc định external DeliveryState Unconfigured, không báo push/email thành công khi chưa có provider.

## Business consumers

`notification-publish` dùng queue/worker và shared scheduler contributors. Mỗi source event được
xử lý trong transaction riêng, advisory lock theo key và publication marker; inbox unique
recipient/eventKey. Nguồn chỉ đọc sau commit; không chạy provider trong transaction tài chính.
Batch tối đa 25/source mỗi lượt, backlog tiếp tục các lượt sau, không có cursor in-memory.

| Source | Recipients / safe links |
| --- | --- |
| InvoiceIssuedEvents | Owner phụ trách/phát hành + InvoiceRecipients; Invoice |
| PaymentConfirmedEvents + verified allocation | Owner phụ trách + Owner verifier + InvoiceRecipients; Invoice; không có bank/payer data |
| Adjustment requested | Owner phụ trách; Adjustment |
| Adjustment decided | Requester xem kết quả riêng; Approved mới báo viewers khác bằng link Invoice/generic balance update |
| ContractExpiryNotices JOB-02 | Recipient Owner/Tenant sẵn có; không thêm expiry job hoặc Staff authority |
| OperationalTaskNotifications | Đúng recipient active/current Staff assignment hoặc Owner; MeterTask/OperationalTask |
| Automation execution PendingInputs | Owner đã cấu hình; AutomationExecution; không phát lặp từng retry |

Role/account được kiểm tra từ DB trước publish, nguồn không đủ điều kiện được đánh dấu đã
xử lý với recipient count phù hợp. Không broadcast đến mọi Owner/Staff. Private adjustment
reason/evidence không đưa vào title/summary. Payment chưa allocation không phát payment-confirmed.
POST `process-events` chỉ Owner + Development/Testing, gọi cùng publisher; production 403.
