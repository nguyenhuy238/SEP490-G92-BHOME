# JWT Authentication: đăng nhập bằng email

## Quyết định và truy vết

Ngày 28/10/2026, chủ dự án chọn đăng nhập bằng email, access token mặc định 30 phút,
và kiểm tra database trên mỗi Bearer request. Quyết định này thay thế định danh UserName
và TTL 15 phút trong các ghi chép audit trước đó. Không triển khai đăng nhập bằng số điện thoại.

Nguồn: SRS v1.3 FE-02 / UC-01, GBR-01/02/13, §IV.2.3 Security;
Report 4 §III.1.1–1.2 Authentication / Authorization; quyết định trực tiếp của chủ dự án.
Không thay đổi chính sách email của co-occupant, provisioning hoặc Tenant activation.

| Yêu cầu                 | Thành phần                                               | Nghiệm thu                                                                  |
| ----------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------- |
| Email và mật khẩu       | LoginRequest → LoginService → IdentityCredentialVerifier | Email đúng đăng nhập được; tên đăng nhập/số điện thoại không thay thế email |
| Chuẩn hóa định danh     | Identity NormalizeEmail, NormalizedEmail query           | Không phân biệt hoa/thường; trim email; không thay đổi mật khẩu             |
| Không chọn nhầm account | Lookup tối đa hai kết quả                                | Email chuẩn hóa trùng bị từ chối 401; không cấp session                     |
| JWT 30 phút             | JwtOptions, appsettings, .env.example, local .env        | Issuer cấp 30 phút, không vượt deadline tuyệt đối của session               |
| Trạng thái hiện tại     | OnTokenValidated → IdentitySessionService.ValidateAsync  | Request tiếp theo bị từ chối sau khi account/session/quyền bị vô hiệu hóa   |
| Role đáng tin           | Identity roles và current-role comparison                | Role client gửi không cấp thêm quyền                                        |

## API và tương thích

```http
POST /api/v1/auth/login
Content-Type: application/json
```

```json
{ "email": "staff.dev@example.invalid", "password": "<mật khẩu test>" }
```

`email` bắt buộc, đúng định dạng, tối đa 256 ký tự. `password` bắt buộc, tối đa 1024 ký tự;
`device` tùy chọn, tối đa 256 ký tự, không phải tín hiệu phân quyền.
Client Owner/Mobile dùng chung form Email và gửi cùng contract. Postman có biến `email` riêng.

Đây là thay đổi request contract được duyệt: payload chỉ có `userName` sẽ trả 400.
Không fallback tra UserName hoặc số điện thoại. Response và các endpoint khác giữ contract hiện có.
Forgot/reset-password vẫn dùng `userName` và delivery hiện chưa cấu hình; đây là bước riêng.

Email không tồn tại, trùng, mật khẩu sai, account inactive/locked, role không hỗ trợ và 2FA chưa
được hỗ trợ đều dùng thông báo 401 chung. Không trả email/token trong lỗi đăng nhập.
Không yêu cầu EmailConfirmed mới để đăng nhập trong thay đổi này; không tự đặt thêm chính sách
xác minh email. Identity tiếp tục yêu cầu unique email khi tạo/cập nhật account qua UserManager.
Schema hiện tại không có unique constraint cho NormalizedEmail; dữ liệu legacy trùng bị từ chối,
không tự sửa dữ liệu. Nếu cần constraint chống race khi provisioning, phải xử lý trong lát cắt đó.

## Token và database

Giữ HS256, issuer/audience/signature/lifetime validation, clock skew 30 giây và claims
`sub`, `role`, `jti`, `sid`, `sstamp`. Không thêm email, CCCD hoặc Location claims.
Mỗi request được xác thực đọc account/session và roles hiện tại từ database; không cache quyền.
Kiểm tra active, lockout, 2FA, expiry/revocation, security stamp và tập role.
Staff assignment và resource ownership vẫn là các kiểm tra riêng khi triển khai nghiệp vụ.

Login tạo session trong transaction với user-row lock, kiểm tra lại identity/stamp/roles trước khi
cấp token và commit audit. Không thay đổi transaction/rotation/reuse policy hiện có.
Không tạo migration hoặc cập nhật database cá nhân. Chỉ đổi `Jwt__LifetimeMinutes` trong local
`.env` thành 30, không thay các credentials; restart API để nhận cấu hình mới. Biến môi trường của
process hoặc user-secrets có thể override mặc định: cấu hình thực tế cần đặt cùng TTL đã duyệt.

## Kiểm chứng thực tế

`dotnet build src/backend/BHome.sln --no-restore`: PASS, 0 warning, 0 error.
Postman: parse thành công 44 script blocks; biến email đã có và các secret template đều trống.
`git diff --check`: PASS. Không sửa các thay đổi solution/Backup/UpgradeLog có sẵn của người dùng.

| Kiểm tra                                                                                                          | Kết quả                                                                       | Giới hạn                                                                            |
| ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `dotnet test src/backend/BHome.sln --no-restore --filter 'Category!=Docker' --logger 'console;verbosity=minimal'` | 67 PASS: Domain 1, Application 30, Integration 36; 0 fail/skip trong tập chọn | Không chạy nhóm Docker                                                              |
| Native PostgreSQL 18, instance/database tổng hợp riêng trong TEMP                                                 | 31 smoke assertions PASS                                                      | TestServer + PostgreSQL thật; không phải toàn bộ Testcontainers suite PostgreSQL 16 |
| `npm.cmd test` với Node 22.23.4 portable                                                                          | 23 PASS: Owner/shared 16, Mobile 4, Public 3                                  | jsdom, chưa browser/native E2E                                                      |
| `npm.cmd run lint`                                                                                                | PASS                                                                          | Source frontend                                                                     |
| `VITE_API_BASE_URL=https://api.example.invalid; npm.cmd run build`                                                | PASS                                                                          | Owner bundle còn warning trên 500 kB                                                |
| `dotnet format ... --verify-no-changes --no-restore --include <changed C# files>`                                 | PASS                                                                          | Chỉ C# thay đổi                                                                     |

Smoke dùng real Identity password hashing, real email lookup, JWT middleware và migrations hiện có
trên PostgreSQL tạm. Kiểm tra login email hoa/thường, role client bị bỏ qua, TTL 30 phút, Bearer hợp lệ,
và chính token đó bị từ chối trên request tiếp theo sau inactive, stamp change, role removal,
logout hoặc lockout. Kiểm tra thêm email legacy trùng, username/payload cũ, mật khẩu sai và email
không tồn tại. Instance tạm đã dừng; không dùng connection string hoặc dữ liệu cá nhân.
Lần chạy harness đầu không tìm được content root; chạy từ thư mục output chứa MvcTestingAppManifest
đã khắc phục và hoàn tất smoke. Harness cục bộ ở `.tools/jwt-verification`, không nằm trong sản phẩm.

Tests bổ sung trong source: LoginServiceTests, LoginApiTests, JwtAuthenticationTests,
PostgresAuthenticationTests; sửa các login payload trong AuthenticationSecurityTests; frontend
kiểm tra nhãn Email và JSON email/password. JwtAuthenticationTests dùng issuer/middleware thật
nhưng thay session port, nên không thay thế kiểm chứng database thật.

NOT RUN: toàn bộ Docker-tagged suite (máy không có Docker), browser HTTPS/cookie E2E,
Android/iOS, coverage/performance và penetration tests. Không tuyên bố hoàn thiện Staff scope,
password recovery hoặc toàn bộ Authentication/Authorization của BHOME.
