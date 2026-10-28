# Test JWT và Refresh Token bằng Postman

Phạm vi FE-02 / UC-01/02, GBR-01/02, Security NFR. Chỉ dùng tài khoản tổng hợp.

## 1. Chuẩn bị

Backend phải đang chạy; https://localhost:7240/health/ready trả Healthy.
Nếu chưa có tài khoản test, chạy tại gốc repository:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/New-LocalTestUsers.ps1
```

Nhập mật khẩu test tự chọn. Account đã tồn tại không bị đổi mật khẩu hoặc role.

| Email                      | Role   |
| -------------------------- | ------ |
| owner.dev@example.invalid  | Owner  |
| staff.dev@example.invalid  | Staff  |
| tenant.dev@example.invalid | Tenant |

## 2. Import một file

Postman → Import → Files → chọn:

`docs/testing/postman/BHome.JWT.Simple.postman_collection.json`

Không cần environment, collection variable hoặc script tự lưu token.
URL được ghi trực tiếp là https://localhost:7240; nếu đổi cổng, sửa URL của từng request.
Chỉ điền mật khẩu và token trong Postman local; không lưu các giá trị đó ngược vào file trong Git.

## 3. Gửi từng request

| Request             | Tự điền                                                 | Kỳ vọng                            |
| ------------------- | ------------------------------------------------------- | ---------------------------------- |
| 01 Login            | Body: email và password đã đặt                          | 200; copy accessToken từ response  |
| 02 Me               | Authorization → Bearer Token: dán accessToken           | 200; identity và role đúng account |
| 03 Không token      | Giữ No Auth                                             | 401                                |
| 04 Email sai        | Giữ email sai định dạng                                 | 400                                |
| 05 Sai password     | Email account test có thật, password khác mật khẩu thật | 401                                |
| 06 Logout           | Dán token của request 01; Body giữ {}                   | 204                                |
| 07 Token sau logout | Dán chính token vừa dùng ở request 06                   | 401                                |

Bấm **Send từng request**, không Run toàn bộ trước khi tự điền token. Mỗi request có một assertion
HTTP status trong Scripts → Post-response; xem kết quả ở Test Results.
Muốn thử Staff/Tenant, đổi email/password ở request 01 rồi dán token mới vào các request liên quan.
Không gửi request sai password lặp nhiều lần: năm lần sai có thể khóa account 15 phút.

Nếu Postman báo chứng chỉ local chưa được tin cậy, cấu hình trust hoặc tạm tắt SSL certificate
verification trong Settings của request localhost. Không thay cấu hình bảo mật server.

## 4. Refresh Token: request 08–23 trong cùng collection

Vẫn dùng **một file**, không environment/biến và không tự lưu token. Mỗi request có hướng dẫn
trong Description. Bấm Send theo thứ tự và tự dán các token:

| Request | Thao tác                                                                           | Kỳ vọng                         |
| ------- | ---------------------------------------------------------------------------------- | ------------------------------- |
| 08      | Login mới, giữ accessToken A0 và refreshToken R0                                   | 200                             |
| 09      | Body refreshToken = R0; giữ riêng token cũ R0 và token mới A1/R1                   | 200; sessionExpiresAt không đổi |
| 10      | Bearer = A1                                                                        | 200                             |
| 11      | Refresh lại đúng R0 cũ đã dùng                                                     | 401; cả session bị thu hồi      |
| 12–13   | Thử A1 và R1 sau reuse                                                             | 401                             |
| 14–15   | Refresh token không tồn tại hoặc Body {}                                           | 401                             |
| 16–18   | Login mới → logout bằng access token mới → refresh bằng token của phiên vừa logout | 200 → 204 → 401                 |
| 19–20   | Login hai lần cùng account, giữ token của session A và B riêng                     | 200                             |
| 21      | Logout-all bằng access token B                                                     | 204                             |
| 22–23   | Refresh bằng token A rồi B                                                         | 401                             |

Refresh dùng **No Auth**, không dán access token vào Body refresh. Mỗi lần refresh thành công
phải thay cả accessToken và refreshToken. Không dùng lại R0 ngoài request cố ý thử reuse.
Logout-all ảnh hưởng mọi phiên của account TEST, bao gồm phiên UI/Postman khác của account đó.
Phiên tối đa 7 ngày từ login; refresh không làm bắt đầu lại thời hạn 7 ngày. Không chờ 7 ngày
trong Postman; ranh giới expiry được kiểm tra bằng clock kiểm thử trong backend.

### Phạm vi chưa thay thế backend tests

Collection đơn giản kiểm tra login/validation/Bearer/refresh/reuse/logout; không thay thế backend tests về
token sai issuer/audience/expiry/algorithm, concurrency, database state changes hay Staff Location scope.
Các collection/environment và bảng đối chiếu Postman cũ đã được thay bằng file đơn giản này.
