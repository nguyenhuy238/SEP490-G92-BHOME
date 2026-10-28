# Test JWT Authentication bằng Postman

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

## 4. Giới hạn

Collection đơn giản kiểm tra login/validation/Bearer/logout; không thay thế backend tests về
token sai issuer/audience/expiry/algorithm, concurrency, database state changes hay Staff Location scope.
Các collection/environment và bảng đối chiếu Postman cũ đã được thay bằng file đơn giản này.
