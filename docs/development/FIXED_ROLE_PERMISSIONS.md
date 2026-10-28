# Khung permission cố định theo role

## Phạm vi và nguồn

Chủ dự án yêu cầu permission cố định theo Owner/Staff/Tenant; không có bảng permission động,
không cho Owner tự cấu hình quyền Staff, không role hierarchy và không thêm role Admin/Guest.
Guest tiếp tục truy cập thông tin public qua AllowAnonymous, không phải role đăng nhập.

Nguồn: SRS v1.3 §I.4.4 Permission Matrix, GBR-01/02/03/04/07/13/17,
§IV.2.3 Security; Report 4 §III.1.2 Authorization & RBAC Implementation.
Đây là nền tảng xuyên FE-01..09, không phải bằng chứng các UC nghiệp vụ đã được triển khai.

| Yêu cầu                    | Thành phần                                       | Acceptance                                                                        |
| -------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------- |
| Quyền cố định theo role    | Domain Permissions / RolePermissions             | Mỗi permission có grant tường minh; case-sensitive, không wildcard/role kế thừa   |
| Khai báo quyền tại API     | ApiFoundation policies / Authorize               | Chưa đăng nhập 401; đúng role được qua; sai role 403                              |
| Cùng quy tắc trong service | Application PermissionAccess                     | Dùng cùng RolePermissions, không tự chép bảng role vào từng service               |
| Quyền không thay scope     | PermissionAccess → ResourceAccess                | Owner khác owner, Staff không assignment, Tenant khác tenancy bị từ chối          |
| Chống vượt quyền đa role   | Allowed roles được lấy theo permission           | Có thêm role Tenant không vượt Owner-only/Staff-only scope                        |
| Danh tính đáng tin         | HttpCurrentUser + JWT/session validation hiện có | Claims của principal chưa authenticated bị bỏ qua; role vẫn được revalidate từ DB |

Không thêm permission cho nhánh Staff temporary-residence đang tranh chấp UC-18/JOB-08,
Guest contact/booking, hoặc các quyết định policy chưa được duyệt. Danh mục ban đầu chỉ gồm các
hành động có quyền rõ trong SRS; permission chưa khai báo không được service cấp quyền.

## Danh mục hiện có

Domain giữ constants tại `Permissions.cs`; bảng grant bất biến tại `RolePermissions.cs`.
Chỉ sửa code và cập nhật test/tài liệu qua review mới thay đổi được grant.

| Permission                  | Owner | Staff | Tenant | Nguồn / giới hạn                                                                    |
| --------------------------- | ----- | ----- | ------ | ----------------------------------------------------------------------------------- |
| account.view-own            | Có    | Có    | Có     | UC-03, chính account hiện tại                                                       |
| account.update-own          | Có    | Có    | Có     | UC-03, chỉ field được phép; không đổi role/assignment                               |
| account.change-password     | Có    | Có    | Có     | Account hiện tại và xác minh mật khẩu/session                                       |
| sessions.revoke-own         | Có    | Có    | Có     | UC-02, current/all của chính user                                                   |
| staff-accounts.manage       | Có    | Không | Không  | UC-08, Staff thuộc chain của Owner                                                  |
| staff-assignments.manage    | Có    | Không | Không  | UC-08, Location thuộc chain của Owner                                               |
| locations.manage            | Có    | Không | Không  | BF-01 / UC-04, chain của Owner                                                      |
| rooms.view                  | Có    | Có    | Có     | UC-04/07, own chain / assigned Location / own Room                                  |
| rooms.manage                | Có    | Không | Không  | UC-04, chain của Owner                                                              |
| assets.update-condition     | Có    | Có    | Không  | UC-05, own chain / assigned Location                                                |
| operational-tasks.manage    | Có    | Không | Không  | UC-10/12, tạo/giao/theo dõi, theo state của use case                                |
| operational-tasks.execute   | Không | Có    | Không  | UC-11, task được giao và đúng Location                                              |
| operational-tasks.verify    | Có    | Không | Không  | UC-12, Owner xác minh theo workflow                                                 |
| contracts.prepare           | Có    | Có    | Không  | BF-03 / Permission Matrix, own chain / assigned Location                            |
| contracts.activate          | Có    | Không | Không  | GBR-03, đầy đủ signing/financial conditions                                         |
| contracts.sign              | Có    | Không | Có     | GBR-04, đúng signer và provider workflow                                            |
| meter-readings.confirm      | Không | Có    | Không  | UC-20 / GBR-07, Staff đúng assignment, meter và period                              |
| invoices.view               | Có    | Không | Không  | UC-21 / Permission Matrix, quản lý trong chain của Owner                            |
| invoices.view-operational   | Không | Có    | Không  | UC-21 / Permission Matrix, chỉ DTO vận hành cần thiết trong Location được phân công |
| invoices.view-own           | Không | Không | Có     | UC-21, Invoice thuộc tenancy của Tenant                                             |
| invoice-adjustments.request | Không | Không | Có     | UC-24, own Invoice                                                                  |
| invoice-adjustments.approve | Có    | Không | Không  | UC-24 / GBR-03, Owner quyết định theo workflow                                      |
| incidents.report            | Không | Có    | Có     | UC-26, Staff trong scope / Tenant của Room                                          |
| work-orders.approve-plan    | Có    | Không | Không  | BF-07 / GBR-12, Owner duyệt kế hoạch/chi phí                                        |
| work-orders.execute         | Không | Có    | Không  | BF-07, Work Order được giao và đúng state                                           |
| work-orders.verify          | Có    | Không | Không  | BF-07 / GBR-12, Owner xác minh kết quả                                              |
| finance.view                | Có    | Không | Không  | FE-08, chain của Owner; không cấp dữ liệu tài chính sâu cho Staff                   |
| notifications.read-own      | Có    | Có    | Có     | FE-07, chỉ thông báo của chính user                                                 |
| public-content.publish      | Có    | Không | Không  | UC-37 / GBR-17, Owner phê duyệt nội dung được công bố                               |

Owner không tự kế thừa hành động Staff/Tenant: ví dụ xác nhận meter và yêu cầu adjustment là hai
nhánh role riêng. Account có nhiều role nhận hợp các grant tường minh, không nhận wildcard.
Các quyền View chung không cho mọi role cùng response DTO; service phải giữ least-privilege fields.

## Cách nối API mới

1. Chọn permission có đúng ý nghĩa. Nếu thiếu, thêm constant, grant tường minh, test và traceability.
2. Gắn policy vào controller/action. Ví dụ đang được dùng trong AuthController:

```csharp
[HttpGet("me")]
[Authorize(Policy = Permissions.Account.ViewOwn)]
```

3. Trong service, dùng `PermissionAccess.HasPermission(permission)` nếu chỉ kiểm tra quyền chức năng.
   Với resource, dùng cùng permission và scope đã nạp từ persistence:

```csharp
var canConfirm = await permissionAccess.CanAccessAsync(
    Permissions.MeterReadings.Confirm,
    new ResourceScope(ownerIdFromDatabase, locationIdFromDatabase, null),
    cancellationToken);
```

Các biến `ownerIdFromDatabase` và `locationIdFromDatabase` trong ví dụ là ID được service tra từ
resource, không phải DTO hoặc Location claim. Nếu `canConfirm` false, use case phải dừng trước
write/download/export và trả kết quả từ chối theo contract của module. Không bỏ qua bool kết quả.

4. Kiểm tra các điều kiện ngoài generic scope: Staff được giao đúng task/Work Order, Tenant là
   signer phù hợp, meter/contract/invoice đúng trạng thái và DTO không lộ field nhạy cảm.
5. Với list/search/count/export, áp dụng các predicate scope tương đương trong SQL trước pagination.
   Helper bool không tự viết hoặc lọc truy vấn. Không tải toàn bảng rồi lọc trong memory.
6. Thêm test đúng/sai role, cross-owner/Location/Tenant, ID tampering, trạng thái và failure paths.

Scope chỉ được đáp ứng thông qua role có grant cho **chính permission đó**. Không kiểm tra
HasPermission rồi gọi ResourceAccess với Roles.All vì có thể tạo đường vượt scope cho user đa role.
Không chọn DTO đặc quyền chỉ dựa trên việc user có role Owner nếu scope chỉ được cấp qua Tenant.
Muốn trả dữ liệu quản trị, cần kiểm tra permission quản trị và ownership tương ứng riêng.

Permission có thể dùng trực tiếp làm tên policy, không cần custom handler hoặc dynamic provider.
ApiFoundation đăng ký từng policy từ cùng catalog bằng RequireAuthenticatedUser + RequireRole.
Legacy role policies Owner/Staff/Tenant vẫn giữ tương thích và yêu cầu authentication rõ ràng.
Policy viết sai tên là lỗi cấu hình, không được tự cấp quyền; test kiểm tra các policy của controller
sản phẩm đã được đăng ký. Không nhận permission từ request, JWT claim, header hoặc frontend.

## Thay đổi hiện tại và giới hạn

AuthController gắn permission cho me/change-password/logout/logout-all; FoundationController dùng
account.view-own cho session probe. Login/refresh/forgot/reset và health vẫn giữ public boundary
hiện có. Không đổi response DTO hay cách lấy current user/session; không thêm endpoint sản phẩm.

HttpCurrentUser chỉ đọc ID/role khi principal authenticated. ResourceAccess từ chối Guid.Empty trong
scope trước khi kiểm tra grant. PermissionAccess dùng lại ResourceAccess và bảng role theo permission.

DI thêm PermissionAccess; không thay Identity roles, token claims, schema hoặc credentials.
Staff assignment adapter thật vẫn chưa có và hiện luôn từ chối. Khung không tự cấp Staff quyền
đọc Location vì đã có attribute. Chain/Room/tenancy/business APIs còn phải triển khai ở từng module.
Account.update-own và các permission nghiệp vụ mới chỉ là catalog, không tạo chức năng cập nhật mới.

Chỉ test host có các route `/test-probes/permission-*` để kiểm tra middleware; chúng không nằm trong
API sản phẩm, Swagger thật hoặc collection Postman. Giữ nguyên một collection Postman đơn giản
hiện tại; không thêm request tới endpoint giả chỉ để có kết quả role 200/403.

## Kiểm chứng

Domain tests đối chiếu grant với ma trận SRS, bảo đảm constants/catalog khớp và unknown permission
không có grant. Application tests kiểm tra quyền chức năng cùng scope: cross-owner/Location/Tenant,
multi-role bypass, cancellation và ID rỗng. Các assignment-positive tests dùng mock port, không
được hiểu là đã có Staff assignment persistence.

Policy tests đối chiếu mọi permission policy với catalog và kiểm tra principal unauthenticated
không được dùng claims. Native PostgreSQL API tests đăng nhập từng role bằng Identity thật,
gọi endpoint test-host kiểm tra 200/403/401, xác nhận Forbidden audit, chống claim permission giả
và gỡ role làm token trước đó bị từ chối ngay trên request tiếp theo.

Build/test dùng output riêng `.tools/permission-build`, PostgreSQL 18 tạm và fixture guard hiện có.
Không dùng database/account thật hoặc thay API đang chạy. CI vẫn dùng PostgreSQL 16 Testcontainers
mặc định. Lệnh kiểm thử:

```powershell
# BHOME_AUTH_TEST_POSTGRES_ADMIN chỉ trỏ cluster tạm có role bhome_test_runner và port khác 5432.
dotnet test src/backend/BHome.sln --artifacts-path .tools/permission-build `
  --filter 'Category!=Docker|FullyQualifiedName~AuthenticationSecurityTests|FullyQualifiedName~PostgresAuthenticationTests|FullyQualifiedName~PermissionApiTests' `
  --logger 'console;verbosity=minimal'
```

Kết quả cuối: **209 PASS** (Domain 37, Application 53, Integration 119), 0 fail/skip trong tập chọn.
Bao gồm authentication/refresh regressions và 15 permission API cases với Identity/PostgreSQL thật.
Các fixtures Docker khác (PostgresFoundationTests, LocalTestAccountsTests) không chạy ở lượt này;
không coi đây là kết quả toàn bộ suite trên PostgreSQL 16.

Collection Postman đơn giản hiện tại: **23 request / 23 HTTP-status assertion PASS** qua Newman,
điền dữ liệu tổng hợp trong bản sao verification, chạy API HTTPS/PostgreSQL riêng. Không thay file
collection, không tạo environment mới và không thêm route test-host vào collection.

`dotnet format ... --verify-no-changes --no-restore --include <changed C#>`: PASS.
Prettier các Markdown thay đổi và `git diff --check`: PASS.
Không chạy lại frontend/browser/native E2E vì không sửa client; coverage/load/penetration NOT RUN.

Các file chính: Domain `Permissions.cs`, `RolePermissions.cs`; Application `PermissionAccess.cs`,
`ResourceAccess.cs`; API `ApiFoundation.cs`, `HttpCurrentUser.cs`, `AuthController.cs`,
`FoundationController.cs`; Infrastructure DI; bốn file test permission và TestProbeController.
Không có migration, cấu hình mới hoặc thay đổi `.env`. API cần restart/rebuild trước khi nạp code mới.
Không staging, commit, push hoặc đổi branch trong lượt này.
