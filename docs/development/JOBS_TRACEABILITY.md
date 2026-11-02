# JOB-09/JOB-10/JOB-04 — traceability

Nguồn: yêu cầu JOB-09/10 & Automated Notifications ngày 02/11/2026; SRS BF-05A/B,
UC-20/21/22/24/35/36, JOB-01/02/04/09/10, GBR-01/02/07/09/10/18; guides BH-21/25/40/41.
Branch member/QHuy, HEAD 65a8c33, working tree sạch. Git.txt gốc không thấy trong checkout.
Đã đọc module ownership: Notifications chưa có consumer BH-19, chỉ INotificationProvider
unconfigured; OperationalTaskNotifications là nguồn riêng có FK Task bắt buộc. Không thay
queue/worker hoặc JOB-02 bằng subsystem khác. Consumer/inbox mới trong Notifications sẽ nhận
các nguồn cũ, giữ route task notifications và read-state tương thích. Shared DI/schema/client
integration cần team review theo MODULES.md; phiên này đã được giao triển khai xuyên các lớp.

| Yêu cầu                       | Thành phần                                                    | Acceptance                                                                                             |
| ----------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Lịch Owner, phiên bản theo kỳ | BillingSchedule hiện có + immutable automation plans/snapshot | Sai role/timezone/order/version từ chối; kỳ trước không lấy plan tương lai                             |
| JOB-09                        | Queue/handler + OperationalTask/Capture                       | Room/type/period unique cả manual/race; assignee current hoặc unassigned; missing/replacement surfaced |
| Draft                         | InvoiceService/calculation/snapshots hiện có                  | Một Room/kỳ, không OCR proposal, không overwrite correction/Final                                      |
| Final                         | Owner delegation opt-in, InvoiceService revalidate            | Mặc định tắt; missing/conflict/Pending request không Final; manual/auto race một effect/event          |
| Inbox                         | Notifications + các nguồn event hiện có                       | Event/recipient unique, private audience, read bền vững, mở object reauthorize                         |
| JOB-04                        | Worker/queue hiện có + durable delivery state                 | Provider unconfigured không success; retry bounded/stable provider key, không rollback finance         |
| Clients/demo                  | Existing navigation/screens + isolated seed                   | Owner settings/monitor/inbox; Staff Capture tasks; Tenant entitled invoices/notices; browser real API  |

Owner phải chọn đại diện tính hóa đơn khi có nhiều eligible Contracts và chưa có Invoice;
không tự chọn người/rent precedence từ GUID. Đây là cùng input RepresentativeContractId của
manual Generate hiện có. Một contract duy nhất là trường hợp không mơ hồ. Missing selection
là exception hiển thị cho Owner, không tạo hóa đơn sai người.

Automatic finalization là ủy quyền Owner ghi trong plan cụ thể, active Owner được kiểm tra lại;
không tự bật từ lịch manual cũ. Rate/due rules tái sử dụng BH-21. OQ refund/deposit/partial payment,
JOB-01 reminder cadence chưa duyệt và provider thật không được tự phỏng đoán trong task này.
