# Refresh Token và quản lý phiên — backend và Postman

## Quyết định, nguồn và acceptance

Chủ dự án duyệt 1A / 3A / 4A ngày 28/10/2026: phiên tối đa 7 ngày từ login, refresh phản ứng
sau 401 và retry request tối đa một lần; hoàn thiện backend và Postman trước. Giữ JWT 30 phút.

Nguồn: SRS v1.3 FE-02 / UC-01/02, GBR-01/02/13, §IV.2.3 Security;
Report 4 §III.1.1 Authentication Flow (refresh 7 ngày, rotation và hash), §III.1.2 Authorization.
Không có xung đột nghiệp vụ cần chọn thêm trong phạm vi này.

| Yêu cầu                            | Thành phần                                                   | Acceptance                                                                                                                                   |
| ---------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Deadline cố định tối đa 7 ngày     | SessionOptions, DependencyInjection, IdentitySessionService  | Startup từ chối cấu hình ngoài 1–7 ngày; rotation không đổi session deadline                                                                 |
| Credential bí mật, một lần sử dụng | IdentitySessionService, IdentitySecurityStore, RefreshTokens | Chỉ hash SHA-256 được lưu; token cũ consumed; token mới khác                                                                                 |
| Reuse thu hồi đúng family          | AuthenticationSessions + audit                               | Reuse R0 làm JWT và R1 của phiên đó không dùng được; phiên khác vẫn refresh được                                                             |
| Logout/current-all                 | AuthController → session service                             | Thu hồi cả quyền dùng JWT và refresh theo đúng phạm vi session/user                                                                          |
| Concurrency/failure                | Transaction PostgreSQL và user-row lock                      | Refresh đồng thời tối đa một 200 rồi family bị thu hồi; refresh cạnh tranh logout không để lại token hợp lệ; audit failure rollback rotation |
| Phản ứng sau 401                   | Shared SessionClient/createApiClient hiện có                 | Refresh một lần, retry một lần; refresh 401 xóa local session; 503/network giữ session; 403 không refresh                                    |
| Postman đơn giản                   | BHome.JWT.Simple.postman_collection.json                     | Cùng một file, 23 request; URL/body/token tự điền; không environment, không biến                                                             |

## Thay đổi và hành vi giữ lại

Backend đã có endpoint `/api/v1/auth/refresh`, rotation, reuse, logout, hash và audit trong transaction.
Giữ nguyên các cơ chế đó sau khi kiểm tra bằng tests, không viết lại service hoặc tạo schema mới.
Siết validation của SessionOptions: refresh và absolute lifetime chỉ nhận 1–7 ngày, mặc định 7.
Cấu hình local `.env` được đặt đúng hai giá trị session bằng 7; không thay credentials.
Cấu hình ngắn hơn 7 ngày vẫn được phép; không cho kéo dài hơn mức đã duyệt.

Refresh nhận `{ "refreshToken": "<token hiện tại>" }` với JSON/mobile transport, không cần Bearer.
Thành công trả 200 và bộ access/refresh token mới, cùng sessionId/sessionExpiresAt ban đầu.
Token không hợp lệ, hết hạn, phiên đã bị thu hồi hoặc reuse trả 401 chung. Body token vượt
256 ký tự bị request validation từ chối 400. Thời hạn token không vượt session deadline.
Ranh giới expiry là exclusive: đúng thời điểm ExpiresAt đã không hợp lệ.

Trong transaction, service khóa dòng user, đọc lại refresh/session và trạng thái account/roles,
consume token cũ, tạo token mới, cập nhật liên kết replacement và audit rồi commit. Reuse thu hồi
session và ghi audit trong cùng transaction. Ràng buộc unique hash/FK và schema auth hiện có được giữ.
Không có cache hoặc khóa in-memory thay cho tính đúng đắn giữa nhiều instance.

Hai refresh cùng R0 không được coi là retry idempotent trả lại credential: tối đa một lần thành
công, lần reuse tiếp theo thu hồi phiên để bảo vệ credential. Client phải single-flight và không
tự retry refresh sau kết quả mạng không xác định. Không thêm grace period hoặc sliding lifetime.

3A đã tồn tại trong client nên giữ implementation và bổ sung regression tests. Đợt này không
triển khai giao diện mới, HTTPS Web topology hoặc native Keychain/Keystore. Không coi Mobile
memory-only hiện tại là đã hoàn thành persistent login. Giữ cookie Web và Origin checks hiện có.

## Test và môi trường

`AuthenticationSecurityTests` được mở rộng để kiểm tra token mới cũng bị thu hồi sau reuse,
token thắng cuộc đua refresh không còn dùng được sau reuse/logout, invalid refresh không consume
phiên hợp lệ, refresh gần mốc 7 ngày không kéo dài deadline và refresh đúng deadline bị từ chối.
Ca access JWT hết hạn được ký bằng key tổng hợp của test host, nhận 401, sau đó refresh và gọi API
bằng access token mới nhận 200. Không cần chờ hết hạn thật hoặc đổi đồng hồ máy.

`SessionPolicyTests` kiểm tra mặc định 7 ngày và từ chối 0/8 ngày. Frontend regression bổ sung
retry sau 401 đúng một lần, không retry refresh bị từ chối, bảo toàn phiên khi 503 và không refresh 403.

Fixture PostgreSQL mặc định vẫn dùng Testcontainers PostgreSQL 16 cho CI. Để chạy khi không có
Docker, hỗ trợ biến test-only `BHOME_AUTH_TEST_POSTGRES_ADMIN`: chỉ nhận host 127.0.0.1, port khác
5432, database admin postgres và role bhome_test_runner. Mỗi fixture tự tạo database tên ngẫu nhiên
`bhome_auth_test_<guid>`, migrate và drop đúng database đó sau khi dispose host.
Không đọc `.env`, không dùng hoặc thay đổi database `bhome` cá nhân.

Lượt kiểm chứng hiện tại dùng cluster PostgreSQL 18 riêng trong TEMP và output build riêng
`.tools/refresh-build` để không khóa DLL hoặc dừng backend người dùng đang chạy.

```powershell
# Với cluster test-only đã chuẩn bị và BHOME_AUTH_TEST_POSTGRES_ADMIN đã đặt trong process test:
dotnet test src/backend/BHome.sln --artifacts-path .tools/refresh-build `
  --filter 'Category!=Docker|FullyQualifiedName~AuthenticationSecurityTests|FullyQualifiedName~PostgresAuthenticationTests' `
  --logger 'console;verbosity=minimal'
```

Kết quả: **131 PASS** (Domain 1, Application 30, Integration 100), 0 fail/skip trong tập được chọn.
Bao gồm authentication PostgreSQL tests thật: rotation/reuse/hash/deadline/logout, parallel refresh,
refresh cạnh tranh logout/role removal, audit rollback, account security và JWT validation.
Không chạy các Docker-tagged fixtures khác (PostgresFoundationTests, LocalTestAccountsTests).
Đây không phải kết quả toàn bộ suite trên PostgreSQL 16.

`npm.cmd test` trên Node 22 portable: **27 PASS** (Owner/shared 20, Mobile 4, Public 3).
`dotnet build src/backend/BHome.sln --artifacts-path .tools/refresh-build --no-restore`: PASS,
0 warning/error. `dotnet format ... --verify-no-changes --no-restore --include <changed C#>`: PASS.
`npm.cmd run lint` và `VITE_API_BASE_URL=https://api.example.invalid; npm.cmd run build`: PASS;
Owner bundle vẫn có warning trên 500 kB. `git diff --check` và kiểm tra JSON/scripts: PASS.
Collection đơn giản được kiểm tra bằng Newman với dữ liệu tổng hợp tự điền trong bản sao chỉ dùng
cho verification: **23 request / 23 HTTP-status assertion PASS** trên API HTTPS và PostgreSQL tạm.
File giao vẫn không có environment, biến hoặc script tự lưu token. Chưa thao tác Postman Desktop.
Browser/native E2E, load/coverage và Web topology vẫn NOT RUN trong đợt backend này.
Không có migration mới hoặc cập nhật schema người dùng; không commit/push và không đổi branch.

## Dùng trên local

Collection hiện có được bổ sung request 08–23; import lại cùng file và xem
[hướng dẫn điền token](MANUAL_AUTH_TESTING.md). Giữ token gốc và token sau rotation riêng khi thử reuse.
Không thêm file environment hoặc collection thứ hai.

API đang chạy dùng binary trước thay đổi cho tới khi restart. Dừng bằng Ctrl+C ở terminal đang
chạy rồi khởi động lại `scripts/Start-Api.ps1` để build/nạp validation mới; không chạy hai instance
trên cùng output/cổng. Các session 7 ngày hiện tại vẫn dùng schema cũ tương thích.
