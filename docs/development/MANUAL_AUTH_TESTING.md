# Test Authentication bằng tay trên Local

Phạm vi FE-02, UC-01/02/03, GBR-01/02/13; Report 3 FE-02 và Report 4 Security Design.
Đối chiếu AuthController, IdentityPasswordService, SessionClient và Identity configuration hiện có.
Fixture tổng hợp phục vụ test auth, không đại diện Staff assignment/onboarding/Contract đã hoàn thiện.

## 1. Tạo tài khoản test một lần

Tại gốc repository:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/New-LocalTestUsers.ps1
```

Nhập mật khẩu test tự chọn ở prompt ẩn: ít nhất 12 ký tự, hoa/thường/số/ký tự đặc biệt.
Không dùng mật khẩu PostgreSQL hay mật khẩu cá nhân. Ba account dùng chung mật khẩu vừa nhập:

| UserName   | Role   |
| ---------- | ------ |
| owner.dev  | Owner  |
| staff.dev  | Staff  |
| tenant.dev | Tenant |

Script đọc .env, dùng UserManager để hash, chỉ cho Development + loopback + database bhome,
đòi hỏi migrations và roles đã có. Không lưu password vào file/CLI/log. Nếu bất kỳ tên nào đã tồn
tại, thoát mã 2 và không đổi account/password/role nào. Lỗi giữa chừng rollback cả ba account/audit.
Không có API đăng ký mới hoặc tự seed khi API startup. Công cụ được test trong DB disposable;
không tự tạo account trên native database trong phiên chuẩn bị hướng dẫn này. Bạn tự chạy và chọn
mật khẩu. Nếu account đã tồn tại, dùng mật khẩu hiện tại; script không reset password cũ.

## 2. Chạy API

Terminal thứ nhất:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Start-Api.ps1
```

Mở https://localhost:7240/health/ready phải trả Healthy (200); Swagger ở
https://localhost:7240/swagger. Nếu browser chưa tin chứng chỉ dev, chạy
`dotnet dev-certs https --trust` và làm theo OS. Không tự đổi machine trust trong bộ công cụ.

## 3. Postman: import rồi Send theo thứ tự

Import hai file:

- docs/testing/postman/BHome.Auth.Local.postman_collection.json
- docs/testing/postman/BHome.Local.postman_environment.json

Chọn Environment **BHOME Local — Manual Auth**, điền giá trị local:

| Biến        | Giá trị                                                            |
| ----------- | ------------------------------------------------------------------ |
| baseUrl     | https://localhost:7240                                             |
| userName    | owner.dev (hoặc staff.dev/tenant.dev)                              |
| password    | Mật khẩu test ở bước 1                                             |
| newPassword | Chỉ cần folder đổi mật khẩu; giá trị khác password, đáp ứng policy |

Token để trống: scripts tự lưu/cập nhật. Dùng Desktop/agent trên máy local. Không thêm header
X-BHome-Client:web; collection dùng JSON refresh transport. Chỉ dùng tài khoản tổng hợp; không chia
sẻ/export môi trường đã điền password/token. Guard chỉ cho URL HTTPS loopback. Nếu Postman báo lỗi
chứng chỉ self-signed, cấu hình tin cậy certificate Development cho Postman; lỗi TLS xảy ra trước API.

Với chứng chỉ tự ký local, Postman còn cho phép tạm tắt **Enable SSL certificate verification**
trong tab **Settings của request** đang gửi tới localhost; bật lại sau khi thử.
Xem [hướng dẫn chứng chỉ của Postman](https://support.postman.com/hc/en-us/articles/4416016147991-I-am-having-trouble-adding-client-certificates).

Mở từng folder và bấm Send từ trên xuống, xem status và Test Results:

| Folder | Kết quả                                                                           |
| ------ | --------------------------------------------------------------------------------- |
| 01     | ready 200 → login 200 → me 200 → refresh 200 → me 200 → logout 204 → JWT cũ 401   |
| 02     | login → refresh → reuse token cũ 401 → JWT của phiên cũng 401                     |
| 03     | login A/B/C → logout A → A 401, B/C 200 → logout-all bằng B → B/C 401             |
| 04     | login A/B → change-password 204 → JWT A/B 401 → login mật khẩu mới 200            |
| 05     | thiếu input 400 → thiếu Bearer 401 → forgot-password 503 (chưa có email provider) |

Folder 04 đổi mật khẩu thật của account TEST. Sau 204, script cập nhật password trong environment
thành newPassword và xóa newPassword. Nhớ mật khẩu mới cho UI. Nếu đổi bằng UI, tự cập nhật password
trong Postman. Mỗi lần chạy lại folder 04 phải đặt newPassword mới khác password hiện tại.
Nếu dùng Runner chạy toàn collection, đặt delay **2500 ms** giữa request. Nếu 429, đợi Retry-After
(thường trong cửa sổ 60 giây), rồi login và chạy lại từ đầu folder. Sai password 5 lần gây lockout
15 phút: test lỗi này sau các luồng thành công. Luôn bắt đầu mỗi folder bằng request login đầu tiên.

Nếu tự tạo request:

1. POST https://localhost:7240/api/v1/auth/login, No Auth, Body raw JSON:

   ```json
   { "userName": "owner.dev", "password": "<mật khẩu test đã đặt>", "device": "Postman local" }
   ```

2. Nhận 200, giữ accessToken và refreshToken riêng. Không chụp/chia sẻ token.
3. GET /api/v1/auth/me, Authorization → Bearer Token → accessToken: 200.
4. POST /api/v1/auth/refresh, No Auth, JSON {"refreshToken":"<refresh hiện tại>"}: 200.
   Thay cả accessToken/refreshToken đang dùng bằng response mới.
5. POST /api/v1/auth/logout, Bearer mới, JSON {}: 204.
6. GET me với Bearer đó: 401. Đây là kiểm chứng thu hồi JWT phía server.

## 4. Giao diện đang có

Dùng Mobile trong browser để thử ngay các nút login/logout/change-password. Terminal thứ hai:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass
. ./scripts/Use-LocalTools.ps1
$env:VITE_API_BASE_URL = 'https://localhost:7240'
npm.cmd run dev --workspace @bhome/mobile
```

Mở http://localhost:5174:

1. Login owner.dev + mật khẩu đã đặt: xuất hiện Đã đăng nhập, các nút logout và form đổi password.
   Menu Owner dẫn /owner. Về Trang chủ để thao tác account.
2. Đăng xuất: form login xuất hiện lại. Login staff.dev hoặc tenant.dev: có menu /staff hoặc /tenant.
   Route role khác hiện không có quyền; đây là kiểm tra UX, không chứng minh resource authorization.
3. Login → nhập password hiện tại/mới → Đổi mật khẩu: về form login; password cũ thất bại, mới thành
   công. Cập nhật password trong Postman cho khớp.
4. Login cùng account ở cửa sổ thường và ẩn danh; logout-all ở một cửa sổ. JWT cả hai bị chặn ở
   request kế tiếp; chưa có push logout tức thì trên cửa sổ khác. Dùng Postman folder 03 kiểm chứng
   status server. Trang shell không tự gửi request nghiệp vụ để phát hiện session đã thu hồi.

DevTools → Network cho thấy login/logout/change-password và status; không chia sẻ credential trong
request/response. F5 hoặc đóng tab Mobile mất login là hành vi memory-only hiện tại. Các trang
nghiệp vụ là shell, chưa có dữ liệu Contract/Invoice và chưa tích hợp native secure persistence.

Owner Web: dùng `npm.cmd run dev --workspace @bhome/owner-web`, mở http://localhost:5173, login
owner.dev, bấm Bảng điều khiển. Login/logout/change-password có thể thao tác; refresh cookie và
khôi phục phiên qua reload cần Owner HTTPS cùng site với API hoặc reverse proxy cùng origin.
HTTP frontend + HTTPS API hiện tại chưa đủ để xác minh cookie Strict; không hạ Secure/Strict.
Test rotation/reuse bằng Postman trước. Chưa thực hiện E2E browser thực trong phiên này.

## 5. Quan sát pgAdmin và giới hạn

Refresh bhome → Schemas → public → Tables. Xem fixture roles/active bằng:

```sql
SELECT u."UserName", r."Name" AS "Role", u."IsActive"
FROM "AspNetUsers" u
JOIN "AspNetUserRoles" ur ON ur."UserId" = u."Id"
JOIN "AspNetRoles" r ON r."Id" = ur."RoleId"
WHERE u."UserName" IN ('owner.dev', 'staff.dev', 'tenant.dev');
```

AuthenticationSessions có revoked timestamp/reason. RefreshTokens chỉ có hash; token đã dùng có
ConsumedAt/ReplacedByTokenId. SecurityAudit lưu events/actor/target/session. Không nhập password
plaintext bằng SQL, không sửa audit để reset test. Email reset/MFA và Location/Contract isolation
chưa thể kiểm thử tay đầy đủ do provider/business model còn thiếu; 503 forgot-password là đúng.

Postman scripts đối chiếu tài liệu chính thức về [biến](https://learning.postman.com/docs/tests-and-scripts/write-scripts/postman-sandbox-reference/pm-variables/)
và [post-response tests](https://learning.postman.com/docs/tests-and-scripts/write-scripts/test-scripts/).
Không log credential. JSON/script syntax checks không thay thế việc import/Send trong Postman Desktop.
