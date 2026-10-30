# Kiểm thử API với Postman

Import hai file:

- `BHome.Simple.postman_collection.json`
- `BHome.Local.postman_environment.json`

Chọn Environment **BHOME Local** ở góc trên bên phải Postman. `baseUrl` mặc định là
`https://localhost:7240`, không có dấu `/` cuối; sửa nếu API chạy địa chỉ khác.

| Biến                                    | Cách lấy                                                          |
| --------------------------------------- | ----------------------------------------------------------------- |
| `ownerAccessToken`                      | Request **24** đăng nhập thành công bằng Owner tự lưu accessToken |
| `staffAccessToken`                      | Request **25** đăng nhập thành công bằng Staff tự lưu accessToken |
| `staffUserId`                           | Request **25** tự lưu userId của Staff                            |
| `locationId`                            | Request **26** tạo Location thành công tự lưu id                  |
| `chainVersion`                          | Request **25a/25b** tự lưu version cấu hình tên Chain             |
| `futurePolicyId`, `futurePolicyVersion` | Request **60a/60b/60c** tự lưu để test sửa phí tương lai          |

Điền email/mật khẩu test trong Body của 24 và 25, rồi Send từng request. Tiếp theo chạy
**25a** để xem Chain chung, tùy chọn **25b** để đổi tên, rồi gửi **26** để tạo Location.
Không tạo/chọn Chain và không điền `chainId`; server tự gắn Location vào Chain duy nhất. Các request phía sau tự dùng
`{{ownerAccessToken}}`, `{{staffAccessToken}}`, `{{staffUserId}}` và `{{locationId}}`
trong Authorization/URL/Body. Có thể nhập các giá trị này trực tiếp trong Environment,
ví dụ chọn Location đã có bằng cách thay `locationId`.

Các script chỉ cập nhật biến khi response thành công và có role/token/ID đúng định dạng;
response lỗi không ghi đè các giá trị đã lưu. Script không tự gửi thêm request.
Token hết hạn thì gửi lại request đăng nhập đúng role. Các file trong repository để trống
token và ID; chỉ điền giá trị runtime trong Postman, không lưu token thật vào file để commit.

Nếu chỉ import collection và không chọn Environment, các biến cùng tên đã có sẵn ở tab
**Variables** của collection; script tự lưu vào đó. Khi chọn Environment, script lưu vào
Environment đang chọn. Dùng cùng một Environment cho cả quá trình test vì Environment
có ưu tiên cao hơn Collection Variables khi resolve `{{...}}`.

Phần **01–23** kiểm tra JWT/refresh/logout giữ token riêng để kiểm tra reuse/thu hồi;
không tự thay chúng bằng token Owner đang dùng cho nghiệp vụ. Các ID Room Type/Room/Asset/
Policy, version và ngày D0/D1/D2 vẫn điền theo hướng dẫn từng request. Áp dụng migration
và chuẩn bị tài khoản test trước khi gọi API; không Run toàn bộ collection khi còn thiếu dữ liệu.

Nguồn nghiệp vụ: FE-02 / UC-01 và BF-01 / UC-04..06, GBR-01/02/08. Đây là cấu hình tiện ích
kiểm thử, không thay đổi quyền hoặc hành vi server. API chi tiết: `docs/api/PROPERTY_MANAGEMENT.md`.

**Test giá linh hoạt:** sau request 60 và trước các bước ngừng sử dụng Location, chạy
60a → 60b → 60c → 60d → 60e. Chọn D1 sau hôm nay, D2 từ D1 trở đi. 60a tạo khoản phí giả lập
riêng, 60c sửa giá tương lai chưa dùng và giữ ID, 60d kiểm tra kết quả, 60e kiểm tra từ chối
version cũ. Áp dụng migration FlexibleFutureBillingPolicies trước khi chạy API PUT mới.

## Task vận hành — request 81–118

Nguồn: BF-02 / FE-01 / UC-10–12 / DBR-01. Contract đầy đủ: [Operational Tasks](../../api/OPERATIONAL_TASKS.md).
Collection hiện có 125 request; 87 request cũ được giữ nguyên và thêm 38 request Task.

Chuẩn bị: chạy **24, 25, 26, 28** để có Owner/Staff token, Location active và Staff assignment
hiệu lực hôm nay theo Asia/Ho_Chi_Minh. Thực hiện phần Task **trước request 79 ngừng Location**.
Nếu Location đã ngừng, dùng Location test active khác và tạo assignment tương ứng; không Run toàn
bộ collection theo thứ tự khi chưa chuẩn bị dữ liệu của các phần khác.

Luồng chính:

1. **81–87:** tạo, thử replay idempotency, xem/cập nhật, thử stale version và đồng bộ người phụ trách.
2. **88–93:** Staff xem/bắt đầu/cập nhật/blocker, Owner điều phối; submit thiếu evidence bị chặn.
3. **94:** Body → binary → chọn ảnh PNG giả lập trên máy. Nếu chọn JPEG, đổi Content-Type sang
   `image/jpeg`. Không gửi multipart, ảnh CCCD hoặc PII thật. Mặc định 5 MiB/ảnh, 10 ảnh/Task.
4. **95–98:** lấy version mới sau upload, xem metadata/tải ảnh và submit chờ Owner duyệt.
5. **99–103:** kiểm tra Staff không thể verify, Owner yêu cầu rework, Staff nộp lại và Owner xác nhận;
   xem history. Có thể dùng lại ảnh còn phù hợp hoặc upload ảnh mới rồi chạy lại 95 trước submit.
6. **104–106:** đọc thông báo, đánh dấu đã đọc và kiểm tra không hủy Task đã Completed.
7. **107–108:** Task riêng cho nhánh hủy, không ghi đè ID/version của luồng chính.
8. **109–118:** ca lỗi/quyền. **111–113 là tùy chọn**, cần Location/token bổ sung như bảng dưới.

| Biến mới                            | Cách dùng                                                                                     |
| ----------------------------------- | --------------------------------------------------------------------------------------------- |
| `taskId`, `taskVersion`             | 81 tự lưu; GET/action thành công cập nhật version. Khi stale, chạy lại 84; sau upload chạy 95 |
| `taskPreviousVersion`               | 85 lưu version cũ cho ca 86                                                                   |
| `taskTitle`                         | Nội dung Task test; có thể sửa trước khi chạy 81                                              |
| `taskDueAt`                         | Deadline có Z/offset; 81 tự đặt sau hiện tại 24 giờ nếu trống/hết hạn, chỉ là dữ liệu test    |
| `taskCreateDueAt`, `taskCreateKey`  | 81 lưu payload/key tạo ban đầu, 82 dùng nguyên trạng để replay                                |
| `taskEvidenceId`                    | 94 tự lưu khi upload thành công                                                               |
| `taskNotificationId`                | 104 tự lưu một thông báo thuộc Task hiện tại                                                  |
| `taskCancelId`, `taskCancelVersion` | Nhánh 107–108 dùng riêng                                                                      |
| `taskUnassignedLocationId`          | Ca 111: tự điền ID Location test active thật, chưa có Staff hiện hành                         |
| `otherStaffAccessToken`             | Ca 112: token Staff test khác không phụ trách Location của Task                               |
| `tenantAccessToken`                 | Ca 113: token Tenant test, nhập runtime, không lưu vào file git                               |

Các biến có trong cả Environment và Collection Variables; token bổ sung để trống và đánh dấu secret
trong Environment. Script có kiểm tra biến bắt buộc; response lỗi không ghi đè Task/evidence/version
đã lưu. Mỗi lần Send **81** tạo lượt Task mới. **82** trả snapshot gốc và không ghi đè version mới
hơn; **115** kiểm tra cùng key nhưng khác payload bị 409. Các lệnh khác dùng UUID mới mỗi Send;
để thử retry thủ công, giữ nguyên header và payload ban đầu. Task priority dùng chuỗi `Normal`/`High`,
khác cách biểu diễn enum số của Property API.

### Migration local ngày 30/10/2026

Đã áp `20261029170352_ContractActivationLifecycle` và `20261030074118_UnifiedOperationalTasks`
vào DB phát triển `bhome` tại `localhost:5432` (PostgreSQL 18.3), sau khi tạo và kiểm tra backup
custom-format trong thư mục ignored `.tmp/task-rollout/`. Số lượng User/Room/Task trước và sau giữ
nguyên; các bảng phụ và ba check constraint Task mới được xác nhận. Không lưu connection string,
mật khẩu, backup hoặc token vào các file Postman. Trên máy khác vẫn cần áp migration của máy đó.

Smoke check chỉ đọc trên API local đang chạy: `/health/live` và `/health/ready` trả 200,
Swagger trả 200 và có endpoint Task; GET Task không token trả 401. Không khởi động lại host
đang chạy và không tạo dữ liệu nghiệp vụ để kiểm tra Postman.

Kiểm tra file: JSON hợp lệ; toàn bộ script biên dịch được; script mới được kiểm tra với response
giả lập cho cả Environment và Collection Variables, cả thành công và lỗi. Đây không phải bằng
chứng đã chạy toàn bộ collection trên server thật; các request login vẫn cần mật khẩu test do bạn nhập.
