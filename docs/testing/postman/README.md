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
