# BHOME — Báo cáo mức bao phủ API theo luồng nghiệp vụ Backend

**Ngày báo cáo:** 09/11/2026  
**Phạm vi:** Backend hiện tại trong repository SEP490-G92-BHOME.  
**Mục đích:** Với mỗi luồng nghiệp vụ, liệt kê toàn bộ API và giải thích bằng tiếng Việt từng API làm gì, đồng thời nêu mức bao phủ và giới hạn kiểm chứng.

## 1. Tổng quan và cơ sở đánh giá

Backend chính hiện đăng ký **372 cặp HTTP method–route**, gồm **12 anonymous**; không phát hiện cặp method–route trùng hoàn toàn. Con số bao gồm alias và công cụ phát triển, không phải 372 use case. Hai health endpoint nằm ngoài tổng controller routes. Thư viện ký số phục vụ Sandbox có 15 route riêng, không cộng vào API chính.

Ngày 09/11 đã chạy lại helper tạo MVC action descriptors với ApplicationName của BHome.Api: 372 descriptors, 12 anonymous, 0 duplicate. Danh mục khớp inventory source của lượt rà soát trước. Helper không chạy Program/Infrastructure, không kết nối DB, không gửi HTTP request tới từng route.

**Cách hiểu mức bao phủ:**

- **Đã có API:** Có controller/action và implementation liên quan ở source, đủ để mô tả bước nghiệp vụ tương ứng.
- **Có chuỗi API:** Các bước chính đã có entrypoint và quan hệ xử lý trong source. Không tự đồng nghĩa đã nghiệm thu E2E.
- **Cần kiểm chứng:** Cần chạy dữ liệu thực nghiệm, quyền, nhánh lỗi/cạnh tranh, client hoặc provider bên ngoài.
- Không đưa phần trăm hoàn thành vì chưa có kết quả nghiệm thu từng tiêu chí tại cùng một commit/môi trường.

Mapping BF/UC/GBR/JOB dùng AGENTS.md và tài liệu repo; đây không phải kết luận đã giải quyết mọi mâu thuẫn SRS hoặc phê duyệt mọi mở rộng. Tất cả GET theo ID và thao tác nghiệp vụ vẫn cần kiểm quyền server theo đối tượng/Location/Tenant.

## 2. Tổng hợp theo phần

| Phần nghiệp vụ | Số API trong danh mục | Nhận định |
| --- | ---: | --- |
| [01. Auth, tài khoản và hồ sơ](#flow-01) | 14 | Đã có API; phạm vi và giới hạn nêu tại từng luồng |
| [02. Cơ sở, phòng và occupancy](#flow-02) | 17 | Đã có API; phạm vi và giới hạn nêu tại từng luồng |
| [03. Staff và trách nhiệm Location](#flow-03) | 8 | Đã có API; phạm vi và giới hạn nêu tại từng luồng |
| [04. Task vận hành và việc định kỳ](#flow-04) | 23 | Đã có API; phạm vi và giới hạn nêu tại từng luồng |
| [05. Tài sản và kiểm kê theo mẫu](#flow-05) | 23 | Đã có API; phạm vi và giới hạn nêu tại từng luồng |
| [06. Giá, phí và điện nước nâng cao](#flow-06) | 27 | Đã có API; phạm vi và giới hạn nêu tại từng luồng |
| [07. Nội quy và phụ lục nội quy](#flow-07) | 9 | Đã có API; phạm vi và giới hạn nêu tại từng luồng |
| [08. Capture người ở, công tơ và OCR](#flow-08) | 21 | Đã có API; phạm vi và giới hạn nêu tại từng luồng |
| [09. Soạn hợp đồng Main Draft](#flow-09) | 12 | Đã có API; phạm vi và giới hạn nêu tại từng luồng |
| [10. Hợp đồng, Holding, ký, bàn giao và move-out](#flow-10) | 58 | Đã có API; phạm vi và giới hạn nêu tại từng luồng |
| [11. Cấu hình và tài nguyên ký số](#flow-11) | 13 | Đã có API; phạm vi và giới hạn nêu tại từng luồng |
| [12. Tạm trú và phòng riêng của Tenant](#flow-12) | 8 | Đã có API; phạm vi và giới hạn nêu tại từng luồng |
| [13. Hóa đơn, lịch billing và adjustment](#flow-13) | 26 | Đã có API; phạm vi và giới hạn nêu tại từng luồng |
| [14. Thanh toán, công nợ, hoàn tiền và khấu trừ](#flow-14) | 23 | Đã có API; phạm vi và giới hạn nêu tại từng luồng |
| [15. Chi phí, báo cáo tài chính và What-if](#flow-15) | 13 | Đã có API; phạm vi và giới hạn nêu tại từng luồng |
| [16. Inbox, announcement, delivery và reminder](#flow-16) | 19 | Đã có API; phạm vi và giới hạn nêu tại từng luồng |
| [17. Incident, Emergency và Work Order](#flow-17) | 36 | Đã có API; phạm vi và giới hạn nêu tại từng luồng |
| [18. Nội dung công khai và xuất bản](#flow-18) | 18 | Đã có API; phạm vi và giới hạn nêu tại từng luồng |
| [19. Chẩn đoán và hỗ trợ phát triển](#flow-19) | 4 | Công cụ hỗ trợ; không tính tính năng nghiệp vụ |

## 3. Chi tiết API theo luồng

Các bảng chia theo chặng nghiệp vụ, không phải thứ tự phải gọi mọi endpoint. GET history/list/file phục vụ tra cứu; cancel/reject/rework là nhánh thay thế. Không bắt buộc đi qua Holding trước Main, hoặc dùng automation thay thao tác thủ công.

Quyền trong bảng là metadata controller/action, nhiều attribute kết hợp. Service/repository còn kiểm scope và trạng thái. `/api/v1` đã ghi đầy đủ; `{id:guid}` là route constraint. DTO, query/body và error contract cần xem controller/Swagger hiện hành; báo cáo không tự định nghĩa trường mới.

<a id="flow-01"></a>

### 3.1. Auth, tài khoản và hồ sơ

**Nguồn nghiệp vụ:** FE-02; UC-01/02; GBR-01/02/13.  
**Số API:** 14.

**Luồng chính:** Mời tài khoản → accept invitation → login → refresh → xem/sửa hồ sơ → đổi/reset mật khẩu → logout/logout-all.

**Mức bao phủ và giới hạn:** Có API vòng đời phiên và lời mời. /session là probe cũ, gần như được /auth/me thay thế. Email delivery thật và lưu phiên trên thiết bị cần kiểm riêng.

**Nhánh thay thế/lỗi cần nghiệm thu:** Đăng nhập sai; token hết hạn/revoke; reuse refresh; invitation dùng lại; đổi mật khẩu và phiên cũ.

**Chặng: Mời và kích hoạt tài khoản**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `POST /api/v1/auth/accept-invitation` | Chấp nhận lời mời bằng token để thiết lập tài khoản theo quy trình invitation. | [Accept](../../src/backend/BHome.Api/Controllers/IdentityAccess/AccountInvitationsController.cs#L16) | Anonymous |
| `POST /api/v1/residents/{id:guid}/invitation` | Tạo lời mời cấp/liên kết tài khoản Tenant cho người ở được chỉ định. | [Invite](../../src/backend/BHome.Api/Controllers/IdentityAccess/AccountInvitationsController.cs#L12) | Owner |
| `POST /api/v1/staff/{id:guid}/invitation` | Tạo lời mời sử dụng tài khoản cho Staff được chỉ định. | [InviteStaff](../../src/backend/BHome.Api/Controllers/IdentityAccess/AccountInvitationsController.cs#L14) | Owner |

**Chặng: Đăng nhập và duy trì phiên**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `POST /api/v1/auth/login` | Xác thực email hoặc số điện thoại và mật khẩu; cấp phiên đăng nhập và token khi hợp lệ. | [Login](../../src/backend/BHome.Api/Controllers/IdentityAccess/AuthController.cs#L18) | Anonymous |
| `GET /api/v1/auth/me` | Trả UserId, SessionId và các role của phiên đang đăng nhập. | [Me](../../src/backend/BHome.Api/Controllers/IdentityAccess/AuthController.cs#L55) | account.view-own |
| `POST /api/v1/auth/refresh` | Kiểm tra refresh token để cấp lại token/phiên theo cơ chế refresh hiện có. | [Refresh](../../src/backend/BHome.Api/Controllers/IdentityAccess/AuthController.cs#L36) | Anonymous |
| `GET /api/v1/session` | Trả UserId của người đang đăng nhập; đây là endpoint kiểm tra phiên nền móng cũ. | [Get](../../src/backend/BHome.Api/Controllers/FoundationController.cs#L13) | account.view-own |

**Chặng: Kết thúc phiên**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `POST /api/v1/auth/logout` | Thu hồi phiên đăng nhập hiện tại. | [Logout](../../src/backend/BHome.Api/Controllers/IdentityAccess/AuthController.cs#L47) | sessions.revoke-own |
| `POST /api/v1/auth/logout-all` | Thu hồi các phiên đăng nhập của tài khoản hiện tại. | [LogoutAll](../../src/backend/BHome.Api/Controllers/IdentityAccess/AuthController.cs#L51) | sessions.revoke-own |

**Chặng: Quản lý mật khẩu**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `POST /api/v1/auth/change-password` | Đổi mật khẩu sau khi kiểm tra mật khẩu hiện tại; xử lý thu hồi phiên theo chính sách server. | [ChangePassword](../../src/backend/BHome.Api/Controllers/IdentityAccess/AuthController.cs#L59) | account.change-password |
| `POST /api/v1/auth/forgot-password` | Tiếp nhận yêu cầu quên mật khẩu và bắt đầu quy trình reset qua kênh được cấu hình. | [ForgotPassword](../../src/backend/BHome.Api/Controllers/IdentityAccess/AuthController.cs#L69) | Anonymous |
| `POST /api/v1/auth/reset-password` | Đặt mật khẩu mới bằng thông tin/token reset hợp lệ. | [ResetPassword](../../src/backend/BHome.Api/Controllers/IdentityAccess/AuthController.cs#L77) | Anonymous |

**Chặng: Hồ sơ cá nhân**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `GET /api/v1/account/profile` | Lấy thông tin chi tiết hồ sơ cá nhân của tài khoản đang đăng nhập trong phạm vi được phép. | [Get](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs#L11) | Authenticated |
| `PUT /api/v1/account/profile` | Cập nhật hồ sơ cá nhân của tài khoản đang đăng nhập khi thỏa quyền, trạng thái và điều kiện dữ liệu hiện hành. | [Update](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs#L12) | Authenticated |

<a id="flow-02"></a>

### 3.2. Cơ sở, phòng và occupancy

**Nguồn nghiệp vụ:** BF-01; UC-04..07; DBR-02.  
**Số API:** 17.

**Luồng chính:** Tạo Location → Room → cấu hình giá → readiness → quản lý trạng thái → occupancy/history → closure-check.

**Mức bao phủ và giới hạn:** Có CRUD, readiness, history, occupancy-summary, closure-check và staff-change-preview. Lịch sử thay đổi phòng khác lịch sử người ở và thống kê công suất; không coi chúng là API trùng.

**Nhánh thay thế/lỗi cần nghiệm thu:** Staff ngoài Location; Room không đủ readiness; tạo Occupied thủ công; closure còn hợp đồng/nghĩa vụ.

**Chặng: Kiểm tra trước thay đổi**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `GET /api/v1/locations/{id:guid}/closure-check` | Kiểm tra các điều kiện/vướng mắc trước khi ngừng hoạt động cơ sở; không tự đóng cơ sở. | [ClosureCheck](../../src/backend/BHome.Api/Controllers/LocationsController.cs#L41) | property.manage |
| `GET /api/v1/locations/{id:guid}/staff-change-preview` | Xem trước trách nhiệm/công việc bị ảnh hưởng khi thay đổi Staff tại cơ sở. | [StaffChangePreview](../../src/backend/BHome.Api/Controllers/LocationsController.cs#L43) | property.manage |
| `GET /api/v1/rooms/{id:guid}/readiness` | Kiểm tra điều kiện sẵn sàng của phòng, trả các điều kiện chặn/cần xác minh; không tự đổi trạng thái. | [Readiness](../../src/backend/BHome.Api/Controllers/PropertyManagement/PropertyControllers.cs#L16) | property.view |

**Chặng: Giá phòng theo ngày**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `GET /api/v1/rooms/{id:guid}/prices` | Tra cứu giá/phí áp dụng cho phòng theo ngày và thứ tự ưu tiên chính sách hiện có. | [Prices](../../src/backend/BHome.Api/Controllers/PropertyManagement/PropertyControllers.cs#L14) | property.view |

**Chặng: Theo dõi trạng thái và sử dụng phòng**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `GET /api/v1/locations/{id:guid}/occupancy-summary` | Tổng hợp tình trạng sử dụng phòng của cơ sở theo phạm vi và tham số API. | [OccupancySummary](../../src/backend/BHome.Api/Controllers/LocationsController.cs#L34) | property.view |
| `GET /api/v1/rooms/{id:guid}/history` | Lấy lịch sử thay đổi/quản lý của phòng, khác lịch sử người ở. | [History](../../src/backend/BHome.Api/Controllers/PropertyManagement/PropertyControllers.cs#L20) | property.view |
| `GET /api/v1/occupancy` | Tra cứu tình trạng phòng/người ở theo bộ lọc và quyền truy cập. | [List](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs#L58) | Authenticated |
| `GET /api/v1/rooms/{id:guid}/occupancy-history` | Lấy lịch sử sử dụng/ở của phòng theo dữ liệu hợp đồng. | [History](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs#L65) | Authenticated |

**Chặng: Danh mục cơ sở/phòng và scope**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `GET /api/v1/locations` | Lấy danh sách cơ sở trong phạm vi được phép; áp dụng bộ lọc/phân trang của API. | [List](../../src/backend/BHome.Api/Controllers/LocationsController.cs#L26) | property.view |
| `POST /api/v1/locations` | Tạo mới cơ sở từ dữ liệu gửi lên và kiểm tra điều kiện nghiệp vụ. | [Create](../../src/backend/BHome.Api/Controllers/LocationsController.cs#L17) | locations.manage |
| `GET /api/v1/locations/{id:guid}` | Lấy thông tin chi tiết cơ sở trong phạm vi được phép. | [Get](../../src/backend/BHome.Api/Controllers/LocationsController.cs#L31) | property.view |
| `PUT /api/v1/locations/{id:guid}` | Cập nhật cơ sở khi thỏa quyền, trạng thái và điều kiện dữ liệu hiện hành. | [Update](../../src/backend/BHome.Api/Controllers/LocationsController.cs#L38) | property.manage |
| `GET /api/v1/locations/assigned-to-me` | Lấy các cơ sở hiện được phân công cho Staff đang đăng nhập. | [ListAssigned](../../src/backend/BHome.Api/Controllers/LocationsController.cs#L46) | locations.view-assigned |
| `GET /api/v1/rooms` | Lấy danh sách phòng trong phạm vi được phép; áp dụng bộ lọc/phân trang của API. | [List](../../src/backend/BHome.Api/Controllers/PropertyManagement/PropertyControllers.cs#L12) | property.view |
| `POST /api/v1/rooms` | Tạo mới phòng từ dữ liệu gửi lên và kiểm tra điều kiện nghiệp vụ. | [Create](../../src/backend/BHome.Api/Controllers/PropertyManagement/PropertyControllers.cs#L23) | property.view + property.manage |
| `GET /api/v1/rooms/{id:guid}` | Lấy thông tin chi tiết phòng trong phạm vi được phép. | [Get](../../src/backend/BHome.Api/Controllers/PropertyManagement/PropertyControllers.cs#L13) | property.view |
| `PUT /api/v1/rooms/{id:guid}` | Cập nhật phòng khi thỏa quyền, trạng thái và điều kiện dữ liệu hiện hành. | [Update](../../src/backend/BHome.Api/Controllers/PropertyManagement/PropertyControllers.cs#L28) | property.view + property.manage |

<a id="flow-03"></a>

### 3.3. Staff và trách nhiệm Location

**Nguồn nghiệp vụ:** BF-02; UC-08/09; DBR-01.  
**Số API:** 8.

**Luồng chính:** Tạo Staff → invitation → phân công Location theo ngày → preview thay Staff → thay/gỡ trách nhiệm.

**Mức bao phủ và giới hạn:** Có quản lý Staff và assignment. Cần kiểm xuyên GENERAL task, meter task, Work Order và inspection khi thay Staff; có API reassignment chưa chứng minh mọi loại việc được chuyển đồng bộ.

**Nhánh thay thế/lỗi cần nghiệm thu:** Gán Staff không hợp lệ; ngày chồng lấn; thay Staff còn nhiều loại việc; hủy quyền sau thay assignment.

**Chặng: Gán, thay và gỡ trách nhiệm**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `GET /api/v1/staff-location-assignments` | Liệt kê các phân công Staff–Location theo phạm vi API. | [ListAssignments](../../src/backend/BHome.Api/Controllers/LocationsController.cs#L94) | staff-assignments.manage |
| `POST /api/v1/staff-location-assignments` | Gán Staff chịu trách nhiệm tại Location trong khoảng ngày hiệu lực hợp lệ. | [Assign](../../src/backend/BHome.Api/Controllers/LocationsController.cs#L63) | staff-assignments.manage |
| `DELETE /api/v1/staff-location-assignments/{locationId:guid}` | Gỡ phân công Staff tại Location khi thỏa điều kiện nghiệp vụ. | [Remove](../../src/backend/BHome.Api/Controllers/LocationsController.cs#L114) | staff-assignments.manage |
| `PUT /api/v1/staff-location-assignments/{locationId:guid}` | Thay Staff chịu trách nhiệm tại Location, kiểm version và xử lý trách nhiệm theo implementation hiện có. | [Replace](../../src/backend/BHome.Api/Controllers/LocationsController.cs#L108) | staff-assignments.manage |

**Chặng: Quản lý Staff**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `GET /api/v1/staff` | Lấy danh sách nhân viên và thông tin làm việc trong phạm vi được phép; áp dụng bộ lọc/phân trang của API. | [List](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs#L19) | Authenticated |
| `POST /api/v1/staff` | Tạo mới nhân viên và thông tin làm việc từ dữ liệu gửi lên và kiểm tra điều kiện nghiệp vụ. | [Create](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs#L21) | Authenticated |
| `GET /api/v1/staff/{id:guid}` | Lấy thông tin chi tiết nhân viên và thông tin làm việc trong phạm vi được phép. | [Get](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs#L20) | Authenticated |
| `PUT /api/v1/staff/{id:guid}` | Cập nhật nhân viên và thông tin làm việc khi thỏa quyền, trạng thái và điều kiện dữ liệu hiện hành. | [Update](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs#L27) | Authenticated |

<a id="flow-04"></a>

### 3.4. Task vận hành và việc định kỳ

**Nguồn nghiệp vụ:** BF-02; UC-10..12; JOB-06/07.  
**Số API:** 23.

**Luồng chính:** Owner tạo/gán → Staff start/progress/blockers/evidence → submit → Owner verify/rework. Template → job sinh việc định kỳ.

**Mức bao phủ và giới hạn:** Có vòng đời chính, coordinate/cancel/history/evidence và thông báo riêng. Template API không chứng minh worker đã chạy đúng lịch/chống trùng. GENERAL task khác Work Order.

**Nhánh thay thế/lỗi cần nghiệm thu:** Staff tự verify; submit thiếu evidence; rework; retry job không sinh việc trùng; task mất assignee.

**Chặng: Thiết lập việc định kỳ**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `GET /api/v1/operational-task-templates` | Lấy danh sách mẫu công việc định kỳ trong phạm vi được phép; áp dụng bộ lọc/phân trang của API. | [List](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs#L120) | Authenticated |
| `POST /api/v1/operational-task-templates` | Tạo mới mẫu công việc định kỳ từ dữ liệu gửi lên và kiểm tra điều kiện nghiệp vụ. | [Create](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs#L121) | Authenticated |
| `DELETE /api/v1/operational-task-templates/{id:guid}` | Gỡ mẫu công việc định kỳ theo Location và version, ngừng dùng mẫu để sinh việc mới. | [Delete](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs#L128) | Authenticated |
| `PUT /api/v1/operational-task-templates/{id:guid}` | Cập nhật mẫu công việc định kỳ khi thỏa quyền, trạng thái và điều kiện dữ liệu hiện hành. | [Update](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs#L127) | Authenticated |

**Chặng: Phân công/điều phối**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `POST /api/v1/operational-tasks/{id:guid}/assign` | Phân công người thực hiện công việc theo trách nhiệm Location hợp lệ. | [Assign](../../src/backend/BHome.Api/Controllers/StaffOperations/OperationalTasksController.cs#L25) | operational-tasks.view + operational-tasks.manage |
| `POST /api/v1/operational-tasks/{id:guid}/coordinate` | Owner điều phối công việc theo dữ liệu và lựa chọn được API hỗ trợ. | [Coordinate](../../src/backend/BHome.Api/Controllers/StaffOperations/OperationalTasksController.cs#L33) | operational-tasks.view + operational-tasks.manage |

**Chặng: Thực hiện và cập nhật vướng mắc**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `POST /api/v1/operational-tasks/{id:guid}/blockers` | Ghi nhận vướng mắc đang cản trở công việc. | [Blockers](../../src/backend/BHome.Api/Controllers/StaffOperations/OperationalTasksController.cs#L31) | operational-tasks.view + operational-tasks.execute |
| `POST /api/v1/operational-tasks/{id:guid}/progress` | Ghi thêm tiến độ thực hiện công việc. | [Progress](../../src/backend/BHome.Api/Controllers/StaffOperations/OperationalTasksController.cs#L29) | operational-tasks.view + operational-tasks.execute |
| `POST /api/v1/operational-tasks/{id:guid}/start` | Ghi nhận Staff bắt đầu thực hiện công việc. | [Start](../../src/backend/BHome.Api/Controllers/StaffOperations/OperationalTasksController.cs#L27) | operational-tasks.view + operational-tasks.execute |

**Chặng: Nộp kết quả và nghiệm thu/làm lại**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `POST /api/v1/operational-tasks/{id:guid}/rework` | Owner yêu cầu làm lại công việc và giữ lịch sử xử lý. | [Rework](../../src/backend/BHome.Api/Controllers/StaffOperations/OperationalTasksController.cs#L39) | operational-tasks.view + operational-tasks.verify |
| `POST /api/v1/operational-tasks/{id:guid}/submit` | Nộp kết quả công việc để Owner nghiệm thu; không tự xác minh hoàn tất. | [Submit](../../src/backend/BHome.Api/Controllers/StaffOperations/OperationalTasksController.cs#L35) | operational-tasks.view + operational-tasks.execute |
| `POST /api/v1/operational-tasks/{id:guid}/verify` | Owner xác minh/nghiệm thu kết quả công việc. | [Verify](../../src/backend/BHome.Api/Controllers/StaffOperations/OperationalTasksController.cs#L37) | operational-tasks.view + operational-tasks.verify |

**Chặng: Hủy việc**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `POST /api/v1/operational-tasks/{id:guid}/cancel` | Hủy công việc khi trạng thái và quyền cho phép. | [Cancel](../../src/backend/BHome.Api/Controllers/StaffOperations/OperationalTasksController.cs#L41) | operational-tasks.view + operational-tasks.manage |

**Chặng: Bằng chứng/lịch sử/thông báo**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `GET /api/v1/operational-tasks/{id:guid}/evidence` | Liệt kê bằng chứng đã gắn với công việc. | [Evidence](../../src/backend/BHome.Api/Controllers/StaffOperations/OperationalTasksController.cs#L45) | operational-tasks.view |
| `PUT /api/v1/operational-tasks/{id:guid}/evidence` | Tải ảnh bằng chứng công việc lên vùng lưu trữ riêng sau kiểm quyền/dữ liệu. | [Upload](../../src/backend/BHome.Api/Controllers/StaffOperations/OperationalTasksController.cs#L47) | operational-tasks.view + operational-tasks.execute |
| `GET /api/v1/operational-tasks/{id:guid}/evidence/{evidenceId:guid}` | Tải một ảnh bằng chứng công việc khi người gọi còn quyền truy cập. | [Download](../../src/backend/BHome.Api/Controllers/StaffOperations/OperationalTasksController.cs#L49) | operational-tasks.view |
| `GET /api/v1/operational-tasks/{id:guid}/history` | Đọc lịch sử thao tác và chuyển trạng thái công việc. | [History](../../src/backend/BHome.Api/Controllers/StaffOperations/OperationalTasksController.cs#L43) | operational-tasks.view |
| `GET /api/v1/operational-tasks/notifications` | Lấy danh sách thông báo riêng của module công việc. | [Notifications](../../src/backend/BHome.Api/Controllers/StaffOperations/OperationalTasksController.cs#L61) | operational-tasks.view + notifications.read-own |
| `POST /api/v1/operational-tasks/notifications/{id:guid}/read` | Đánh dấu một thông báo công việc của người hiện tại là đã đọc. | [Read](../../src/backend/BHome.Api/Controllers/StaffOperations/OperationalTasksController.cs#L63) | operational-tasks.view + notifications.read-own |

**Chặng: Tạo và quản lý công việc**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `GET /api/v1/operational-tasks` | Lấy danh sách công việc vận hành trong phạm vi được phép; áp dụng bộ lọc/phân trang của API. | [List](../../src/backend/BHome.Api/Controllers/StaffOperations/OperationalTasksController.cs#L19) | operational-tasks.view |
| `POST /api/v1/operational-tasks` | Tạo mới công việc vận hành từ dữ liệu gửi lên và kiểm tra điều kiện nghiệp vụ. | [Create](../../src/backend/BHome.Api/Controllers/StaffOperations/OperationalTasksController.cs#L15) | operational-tasks.view + operational-tasks.manage |
| `GET /api/v1/operational-tasks/{id:guid}` | Lấy thông tin chi tiết công việc vận hành trong phạm vi được phép. | [Get](../../src/backend/BHome.Api/Controllers/StaffOperations/OperationalTasksController.cs#L21) | operational-tasks.view |
| `PUT /api/v1/operational-tasks/{id:guid}` | Cập nhật công việc vận hành khi thỏa quyền, trạng thái và điều kiện dữ liệu hiện hành. | [Update](../../src/backend/BHome.Api/Controllers/StaffOperations/OperationalTasksController.cs#L23) | operational-tasks.view + operational-tasks.manage |

<a id="flow-05"></a>

### 3.5. Tài sản và kiểm kê theo mẫu

**Nguồn nghiệp vụ:** BF-01; UC-05; quyết định mở rộng setup.  
**Số API:** 23.

**Luồng chính:** Draft template → publish → gán phòng → sync desired inventory → kiểm kê/verify → condition/metadata → replace/history.

**Mức bao phủ và giới hạn:** Có mẫu, sync run, kiểm kê và xác minh. desired-assets và asset-inventory là hai URL cùng action/cùng InventoryAsync. Setup evidence là bằng chứng chung theo Location, khác evidence chuyên biệt.

**Nhánh thay thế/lỗi cần nghiệm thu:** Template Draft/Published; sync lại không nhân bản; kiểm kê lệch template; thay tài sản đã có lịch sử.

**Chặng: Mẫu và đồng bộ tài sản mong muốn**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `GET /api/v1/asset-template-sync-runs/{id:guid}` | Đọc kết quả của một lượt đồng bộ mẫu tài sản. | [SyncRun](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L28) | Owner,Staff + Owner |
| `GET /api/v1/asset-templates` | Liệt kê các mẫu tài sản của cơ sở. | [Templates](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L12) | Owner,Staff + Owner |
| `POST /api/v1/asset-templates` | Tạo mẫu tài sản ở trạng thái Draft. | [Create](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L16) | Owner,Staff + Owner |
| `GET /api/v1/asset-templates/{id:guid}` | Đọc chi tiết một mẫu tài sản. | [Template](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L14) | Owner,Staff + Owner |
| `PUT /api/v1/asset-templates/{id:guid}/draft` | Cập nhật nội dung mẫu tài sản còn ở trạng thái Draft. | [Update](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L18) | Owner,Staff + Owner |
| `POST /api/v1/asset-templates/{id:guid}/drafts` | Tạo bản Draft mới từ mẫu tài sản đã có để chỉnh sửa mà giữ bản gốc. | [Clone](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L20) | Owner,Staff + Owner |
| `POST /api/v1/asset-templates/{id:guid}/publish` | Công bố mẫu theo version và thực hiện quy trình đồng bộ danh mục mong muốn. | [Publish](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L24) | Owner,Staff + Owner |
| `POST /api/v1/asset-templates/{id:guid}/sync` | Chạy đồng bộ tài sản mong muốn từ mẫu tới các phòng áp dụng. | [Sync](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L26) | Owner,Staff + Owner |
| `PUT /api/v1/rooms/{id:guid}/asset-template` | Gán mẫu tài sản cho phòng để xác định danh mục tài sản mong muốn. | [Assign](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L22) | Owner,Staff + Owner |

**Chặng: Kiểm kê thực tế**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `GET /api/v1/rooms/{id:guid}/asset-inventory` | Đọc danh mục tài sản mong muốn và tình hình kiểm kê thực tế của phòng; hai URL inventory là alias cùng action. | [Inventory](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L33) | Owner,Staff |
| `POST /api/v1/rooms/{id:guid}/assets/verify` | Ghi nhận xác minh/kiểm kê tài sản phòng so với danh mục mong muốn. | [Verify](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L35) | Owner,Staff |
| `GET /api/v1/rooms/{id:guid}/desired-assets` | Đọc danh mục tài sản mong muốn và tình hình kiểm kê thực tế của phòng; hai URL inventory là alias cùng action. | [Inventory](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L32) | Owner,Staff |

**Chặng: Bằng chứng setup**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `POST /api/v1/locations/{locationId:guid}/setup-evidence` | Tải ảnh bằng chứng setup theo cơ sở; trả tham chiếu để dùng trong nghiệp vụ setup. | [Upload](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L105) | Owner,Staff |
| `GET /api/v1/locations/{locationId:guid}/setup-evidence/{id:guid}` | Tải bằng chứng setup khi người gọi có quyền với cơ sở và file. | [Download](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L107) | Owner,Staff |

**Chặng: Thay thế và lịch sử tài sản**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `GET /api/v1/assets/{id:guid}/history` | Lấy lịch sử của tài sản. | [History](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L30) | Owner,Staff |
| `POST /api/v1/assets/{id:guid}/replace` | Ghi nhận thay thế tài sản và duy trì liên hệ/lịch sử theo nghiệp vụ hiện có. | [Replace](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L41) | Owner,Staff + Owner |

**Chặng: Metadata/condition và danh mục tài sản**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `GET /api/v1/assets` | Lấy danh sách tài sản trong phạm vi được phép; áp dụng bộ lọc/phân trang của API. | [List](../../src/backend/BHome.Api/Controllers/PropertyManagement/PropertyControllers.cs#L36) | property.view |
| `POST /api/v1/assets` | Tạo mới tài sản từ dữ liệu gửi lên và kiểm tra điều kiện nghiệp vụ. | [Create](../../src/backend/BHome.Api/Controllers/PropertyManagement/PropertyControllers.cs#L38) | property.view + property.manage |
| `GET /api/v1/assets/{id:guid}` | Lấy thông tin chi tiết tài sản trong phạm vi được phép. | [Get](../../src/backend/BHome.Api/Controllers/PropertyManagement/PropertyControllers.cs#L37) | property.view |
| `PUT /api/v1/assets/{id:guid}` | Cập nhật tài sản khi thỏa quyền, trạng thái và điều kiện dữ liệu hiện hành. | [Update](../../src/backend/BHome.Api/Controllers/PropertyManagement/PropertyControllers.cs#L43) | property.view + property.manage |
| `PATCH /api/v1/assets/{id:guid}/condition` | Cập nhật tình trạng tài sản theo quyền và các ràng buộc liên quan. | [UpdateCondition](../../src/backend/BHome.Api/Controllers/PropertyManagement/PropertyControllers.cs#L45) | property.view + assets.update-condition |
| `GET /api/v1/assets/{id:guid}/metadata` | Đọc metadata bổ sung của tài sản. | [GetMetadata](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L39) | Owner,Staff + Owner |
| `PUT /api/v1/assets/{id:guid}/metadata` | Lưu thông tin metadata bổ sung của tài sản. | [Metadata](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L37) | Owner,Staff + Owner |

<a id="flow-06"></a>

### 3.6. Giá, phí và điện nước nâng cao

**Nguồn nghiệp vụ:** BF-01/05; UC-06/20/21; GBR-08.  
**Số API:** 27.

**Luồng chính:** Billing policy theo hiệu lực; tariff → source meter/link → quota/profile → source reading/bill → reconciliation preview/save/review → tính hóa đơn.

**Mức bao phủ và giới hạn:** BillingPolicies khác UtilityTariffs. UtilityWorkspaceService được đăng ký IUtilityBilling và InvoiceService dùng kết quả; đã có liên kết tính phí. Cần kiểm thay giá giữa kỳ, variance, thiếu dữ liệu và finalize gate; không tự coi mọi phạm vi mở rộng đã được nghiệm thu.

**Nhánh thay thế/lỗi cần nghiệm thu:** Giá đổi giữa kỳ; quota chưa xác minh; source reading thiếu; variance chưa duyệt; Final bị chặn khi thiếu dữ liệu.

**Chặng: Giá thuê và phí theo hiệu lực**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `GET /api/v1/billing-policies` | Lấy danh sách chính sách giá thuê/phí theo hiệu lực trong phạm vi được phép; áp dụng bộ lọc/phân trang của API. | [List](../../src/backend/BHome.Api/Controllers/PropertyManagement/PropertyControllers.cs#L53) | property.view |
| `POST /api/v1/billing-policies` | Tạo mới chính sách giá thuê/phí theo hiệu lực từ dữ liệu gửi lên và kiểm tra điều kiện nghiệp vụ. | [Create](../../src/backend/BHome.Api/Controllers/PropertyManagement/PropertyControllers.cs#L55) | property.view + property.manage |
| `GET /api/v1/billing-policies/{id:guid}` | Lấy thông tin chi tiết chính sách giá thuê/phí theo hiệu lực trong phạm vi được phép. | [Get](../../src/backend/BHome.Api/Controllers/PropertyManagement/PropertyControllers.cs#L54) | property.view |
| `PUT /api/v1/billing-policies/{id:guid}` | Chỉnh chính sách giá/phí tương lai khi thỏa điều kiện hiệu lực/version. | [Update](../../src/backend/BHome.Api/Controllers/PropertyManagement/PropertyControllers.cs#L65) | property.view + property.manage |
| `POST /api/v1/billing-policies/{id:guid}/end` | Kết thúc hiệu lực chính sách giá/phí theo điều kiện được phép. | [End](../../src/backend/BHome.Api/Controllers/PropertyManagement/PropertyControllers.cs#L67) | property.view + property.manage |
| `POST /api/v1/billing-policies/{id:guid}/replacement` | Tạo chính sách thay thế theo ngày hiệu lực, giữ khả năng truy vết chính sách cũ. | [Replace](../../src/backend/BHome.Api/Controllers/PropertyManagement/PropertyControllers.cs#L60) | property.view + property.manage |

**Chặng: Đơn giá utility theo bậc/hiệu lực**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `GET /api/v1/utility-tariffs` | Liệt kê các biểu giá điện/nước của cơ sở. | [Tariffs](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L49) | Owner |
| `POST /api/v1/utility-tariffs` | Tạo biểu giá điện/nước từ dữ liệu được Owner cung cấp. | [CreateTariff](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L51) | Owner |
| `GET /api/v1/utility-tariffs/{id:guid}` | Đọc chi tiết biểu giá điện/nước, các bậc và thông tin hiệu lực. | [Tariff](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L50) | Owner |
| `POST /api/v1/utility-tariffs/{id:guid}/replacement` | Tạo biểu giá thay thế, liên kết với biểu giá cũ theo thời điểm hiệu lực. | [ReplaceTariff](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L52) | Owner |

**Chặng: Công tơ nguồn và liên kết**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `POST /api/v1/utility-meter-links` | Ghi liên kết công tơ phòng/nhánh với công tơ nguồn theo hiệu lực. | [Link](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L56) | Owner |
| `GET /api/v1/utility-source-meters` | Liệt kê công tơ nguồn của cơ sở. | [Meters](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L54) | Owner |
| `POST /api/v1/utility-source-meters` | Ghi cấu hình công tơ nguồn phục vụ theo dõi điện/nước đầu vào. | [Meter](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L55) | Owner |

**Chặng: Định mức và profile tính tiền**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `GET /api/v1/utility-profiles` | Liệt kê profile tính tiền điện/nước của cơ sở. | [Profiles](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L61) | Owner |
| `POST /api/v1/utility-profiles` | Ghi profile áp dụng biểu giá và yêu cầu quota/đối soát cho phòng. | [Profile](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L59) | Owner |
| `POST /api/v1/utility-profiles/{id:guid}/replacement` | Tạo profile tính utility thay thế theo hiệu lực, liên kết với profile cũ. | [ReplaceProfile](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L60) | Owner |
| `GET /api/v1/utility-quotas` | Liệt kê định mức điện/nước của cơ sở. | [Quotas](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L58) | Owner |
| `POST /api/v1/utility-quotas` | Ghi định mức miễn phí/quota của phòng và kỳ theo dữ liệu xác minh được cung cấp. | [Quota](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L57) | Owner |

**Chặng: Chỉ số, hóa đơn nguồn và tách kỳ**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `POST /api/v1/utility-period-breakdowns` | Ghi dữ liệu phân chia kỳ tiêu thụ phục vụ tính tiền khi kỳ có nhiều giai đoạn áp dụng. | [Breakdown](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L71) | Owner |
| `GET /api/v1/utility-source-bills` | Liệt kê hóa đơn điện/nước nguồn của cơ sở. | [Bills](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L65) | Owner |
| `POST /api/v1/utility-source-bills` | Ghi hóa đơn điện/nước nguồn với khóa chống lặp để dùng đối soát. | [Bill](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L62) | Owner |
| `GET /api/v1/utility-source-bills/{id:guid}` | Đọc chi tiết hóa đơn điện/nước nguồn đã ghi. | [Bill](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L64) | Owner |
| `POST /api/v1/utility-source-readings` | Ghi chỉ số công tơ nguồn đã được người có quyền xác nhận; không dùng OCR tự động làm chỉ số chính thức. | [Confirm](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L79) | Owner,Staff |

**Chặng: Đối soát và Owner duyệt sai lệch**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `POST /api/v1/utility-reconciliations` | Tính và lưu kết quả đối soát utility để phục vụ kiểm tra/tính hóa đơn. | [Reconcile](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L67) | Owner |
| `GET /api/v1/utility-reconciliations/{id:guid}` | Đọc kết quả đối soát utility đã lưu. | [Reconciliation](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L68) | Owner |
| `POST /api/v1/utility-reconciliations/{id:guid}/review` | Owner quyết định chấp nhận/không chấp nhận sai lệch đối soát, kèm lý do và kiểm version. | [Review](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L69) | Owner |
| `POST /api/v1/utility-reconciliations/preview` | Tính xem trước đối soát hóa đơn/chỉ số nguồn với tiêu thụ liên quan; chưa lưu kết quả đối soát. | [Preview](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L66) | Owner |

<a id="flow-07"></a>

### 3.7. Nội quy và phụ lục nội quy

**Nguồn nghiệp vụ:** BF-03/04; GBR-04; quyết định scope nội quy.  
**Số API:** 9.

**Luồng chính:** Tạo/sửa Draft → publish → snapshot vào hợp đồng → xem agreed policy → tạo phụ lục → ký/kích hoạt hoặc hủy.

**Mức bao phủ và giới hạn:** Có workflow và snapshot Terms. GET operating-policies/{id}/versions hiện lấy LocationId rồi trả ReadPoliciesAsync(LocationId), chưa lọc lineage của riêng policy. Cần làm rõ ngữ nghĩa trước đổi contract.

**Nhánh thay thế/lỗi cần nghiệm thu:** Staff đọc Draft; nội quy publish không sửa trực tiếp; snapshot cũ giữ nguyên; phụ lục chưa ký chưa có hiệu lực; versions trả đúng phạm vi.

**Chặng: Snapshot/phụ lục theo hợp đồng**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `GET /api/v1/contracts/{id:guid}/agreed-operating-policy` | Đọc nội quy/snapshot đã được gắn hoặc chấp thuận cho hợp đồng và trạng thái liên quan. | [Agreed](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L93) | Authenticated |
| `POST /api/v1/contracts/{id:guid}/operating-policy-amendment-cancellation` | Hủy phụ lục nội quy theo điều kiện của contract workflow. | [Cancel](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L96) | Authenticated + Owner |
| `POST /api/v1/contracts/{id:guid}/operating-policy-amendments` | Tạo phụ lục thay đổi nội quy cho hợp đồng đủ điều kiện; còn phải đi qua ký/kích hoạt phù hợp. | [Amend](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L94) | Authenticated + Owner |

**Chặng: Tra cứu phiên bản**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `GET /api/v1/operating-policies/{id:guid}/versions` | Trả danh sách nội quy tại Location của policy được chọn; implementation hiện chưa lọc lineage riêng của policy. | [Versions](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L88) | Authenticated + Owner,Staff |

**Chặng: Soạn và công bố nội quy**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `GET /api/v1/operating-policies` | Lấy danh sách nội quy trong phạm vi được phép; áp dụng bộ lọc/phân trang của API. | [List](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L86) | Authenticated + Owner,Staff |
| `POST /api/v1/operating-policies` | Tạo mới nội quy từ dữ liệu gửi lên và kiểm tra điều kiện nghiệp vụ. | [Create](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L90) | Authenticated + Owner |
| `GET /api/v1/operating-policies/{id:guid}` | Lấy thông tin chi tiết nội quy trong phạm vi được phép. | [Get](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L87) | Authenticated + Owner,Staff |
| `PUT /api/v1/operating-policies/{id:guid}/draft` | Cập nhật nội quy khi thỏa quyền, trạng thái và điều kiện dữ liệu hiện hành. | [Update](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L91) | Authenticated + Owner |
| `POST /api/v1/operating-policies/{id:guid}/publish` | Công bố bản nội quy Draft theo version để dùng cho hợp đồng và thông báo liên quan. | [Publish](../../src/backend/BHome.Api/Controllers/PropertyManagement/SetupWorkspaceControllers.cs#L92) | Authenticated + Owner |

<a id="flow-08"></a>

### 3.8. Capture người ở, công tơ và OCR

**Nguồn nghiệp vụ:** BF-03/05; UC-13..15/20; GBR-07.  
**Số API:** 21.

**Luồng chính:** Lookup Location/Room → resident → OCR transient → Staff confirm identity; meter/task → ảnh/OCR proposal → Staff confirm reading → đọc evidence.

**Mức bao phủ và giới hạn:** OCR và human confirmation tách biệt. Capture lookup dùng DTO NamedResource và đang có nhiều client gọi. Capture create Location/Room dùng chung PropertyService; tạo Staff có đường riêng. Capture reading controller chỉ cho Owner/Staff; cần kiểm Tenant đã xem được chỉ số trước Draft qua DTO/màn khác hay chưa.

**Nhánh thay thế/lỗi cần nghiệm thu:** OCR sai/không nhận dạng → nhập tay; chưa HumanConfirmed; chỉ số giảm; sai meter/task/Location; ảnh CCCD không lưu lâu dài.

**Chặng: Nhận dạng và xác nhận người ở**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `GET /api/v1/capture/locations/{id:guid}/residents` | Lấy danh sách người ở của cơ sở theo phạm vi được phép. | [Residents](../../src/backend/BHome.Api/Controllers/Ocr/CaptureController.cs#L19) | Owner,Staff |
| `POST /api/v1/capture/residents` | Tạo bản ghi người ở tại phòng để tiếp tục xác minh/onboarding. | [Resident](../../src/backend/BHome.Api/Controllers/Ocr/CaptureController.cs#L20) | Owner,Staff |
| `POST /api/v1/capture/residents/{id:guid}/confirm` | Lưu dữ liệu định danh đã được Staff xác nhận/correct; yêu cầu human confirmation. | [Identity](../../src/backend/BHome.Api/Controllers/Ocr/CaptureController.cs#L21) | Owner,Staff + Staff |
| `POST /api/v1/ocr/identity/{residentId:guid}/{side}` | Nhận ảnh mặt trước/sau giấy tờ để OCR thành đề xuất; không thay thế bước xác nhận của con người. | [Identity](../../src/backend/BHome.Api/Controllers/Ocr/OcrController.cs#L14) | Owner,Staff |

**Chặng: OCR gợi ý chỉ số**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `POST /api/v1/ocr/meter-tasks/{taskId:guid}` | Nhận ảnh công tơ theo task để OCR thành đề xuất chỉ số; chưa ghi chỉ số chính thức. | [Meter](../../src/backend/BHome.Api/Controllers/Ocr/OcrController.cs#L26) | Staff |

**Chặng: Công tơ, công việc, ảnh và xác nhận chỉ số**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `GET /api/v1/capture/locations/{id:guid}/meters` | Lấy danh sách rút gọn công tơ tại cơ sở. | [Meters](../../src/backend/BHome.Api/Controllers/Ocr/CaptureController.cs#L22) | Owner,Staff |
| `GET /api/v1/capture/meter-tasks` | Tra cứu danh sách tác vụ ghi điện/nước theo bộ lọc. | [Tasks](../../src/backend/BHome.Api/Controllers/Ocr/CaptureController.cs#L24) | Owner,Staff |
| `POST /api/v1/capture/meter-tasks` | Tạo tác vụ ghi chỉ số công tơ bằng thao tác Owner. | [Task](../../src/backend/BHome.Api/Controllers/Ocr/CaptureController.cs#L27) | Owner,Staff + Owner |
| `GET /api/v1/capture/meter-tasks/{id:guid}` | Đọc chi tiết tác vụ ghi chỉ số trong phạm vi được phép. | [TaskDetail](../../src/backend/BHome.Api/Controllers/Ocr/CaptureController.cs#L25) | Owner,Staff |
| `POST /api/v1/capture/meter-tasks/{id:guid}/confirm` | Lưu chỉ số chính thức sau khi Staff xác nhận/correct, kiểm điều kiện tác vụ và số đọc. | [ConfirmMeter](../../src/backend/BHome.Api/Controllers/Ocr/CaptureController.cs#L30) | Owner,Staff + Staff |
| `PUT /api/v1/capture/meter-tasks/{id:guid}/evidence` | Tải ảnh bằng chứng cho tác vụ ghi chỉ số trước khi xác nhận. | [Evidence](../../src/backend/BHome.Api/Controllers/Ocr/CaptureController.cs#L28) | Owner,Staff + Staff |
| `POST /api/v1/capture/meters` | Tạo cấu hình công tơ cho phòng. | [Meter](../../src/backend/BHome.Api/Controllers/Ocr/CaptureController.cs#L23) | Owner,Staff + Owner |
| `GET /api/v1/capture/readings/{id:guid}` | Đọc bản ghi chỉ số điện/nước đã xác nhận. | [Reading](../../src/backend/BHome.Api/Controllers/Ocr/CaptureController.cs#L26) | Owner,Staff |
| `GET /api/v1/capture/readings/{id:guid}/evidence` | Tải ảnh bằng chứng gắn với chỉ số đã xác nhận khi có quyền. | [EvidenceFile](../../src/backend/BHome.Api/Controllers/Ocr/CaptureController.cs#L31) | Owner,Staff |

**Chặng: Lookup và hỗ trợ setup**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `POST /api/v1/capture/assignments` | Gán Staff cho cơ sở qua wrapper capture dùng chung nghiệp vụ Location assignment. | [Assignment](../../src/backend/BHome.Api/Controllers/Ocr/CaptureController.cs#L18) | Owner,Staff + Owner |
| `GET /api/v1/capture/locations` | Lấy danh sách rút gọn cơ sở mà người gọi được truy cập để chọn trên màn hình nhập liệu. | [Locations](../../src/backend/BHome.Api/Controllers/Ocr/CaptureController.cs#L12) | Owner,Staff |
| `POST /api/v1/capture/locations` | Tạo cơ sở qua wrapper capture sử dụng PropertyService. | [Location](../../src/backend/BHome.Api/Controllers/Ocr/CaptureController.cs#L16) | Owner,Staff + Owner |
| `GET /api/v1/capture/locations/{id:guid}/rooms` | Lấy danh sách rút gọn phòng tại cơ sở trong phạm vi người gọi. | [Rooms](../../src/backend/BHome.Api/Controllers/Ocr/CaptureController.cs#L13) | Owner,Staff |
| `POST /api/v1/capture/rooms` | Tạo phòng qua wrapper capture sử dụng PropertyService. | [Room](../../src/backend/BHome.Api/Controllers/Ocr/CaptureController.cs#L17) | Owner,Staff + Owner |
| `GET /api/v1/capture/staff` | Lấy danh sách rút gọn Staff đang hoạt động để chọn người phụ trách. | [Staff](../../src/backend/BHome.Api/Controllers/Ocr/CaptureController.cs#L14) | Owner,Staff |
| `POST /api/v1/capture/staff` | Tạo tài khoản Staff qua capture; khác đường quản trị có employment metadata. | [Staff](../../src/backend/BHome.Api/Controllers/Ocr/CaptureController.cs#L15) | Owner,Staff + Owner |

<a id="flow-09"></a>

### 3.9. Soạn hợp đồng Main Draft

**Nguồn nghiệp vụ:** BF-03; UC-15/16; GBR-04.  
**Số API:** 12.

**Luồng chính:** Preparation/settings → tạo/sửa draft → sinh tài liệu → PDF/pages → signing-review → Owner release → ký/kích hoạt.

**Mức bao phủ và giới hạn:** Có chuỗi soạn và release, kiểm người ở/settings/tài liệu. POST contracts vẫn là đường tạo khác DTO/quy trình; cần chọn flow chuẩn và kiểm invariant tương đương, chưa kết luận duplicate hoàn toàn.

**Nhánh thay thế/lỗi cần nghiệm thu:** Người ở chưa verified; tài liệu lỗi thời; settings/version đổi; release thiếu review hoặc Tenant không hợp lệ.

**Chặng: Chuẩn bị điều kiện và mẫu**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `GET /api/v1/contracts/main-drafts/preparation` | Kiểm tra phòng, người đại diện, người ở và ngày hiệu lực để trả dữ liệu/điều kiện soạn hợp đồng. | [Prepare](../../src/backend/BHome.Api/Controllers/MainDraftsController.cs#L14) | Owner,Staff |
| `GET /api/v1/contracts/main-drafts/settings/{locationId:guid}` | Đọc cấu hình soạn hợp đồng của Owner theo cơ sở. | [Settings](../../src/backend/BHome.Api/Controllers/MainDraftsController.cs#L16) | Owner,Staff + Owner |
| `PUT /api/v1/contracts/main-drafts/settings/{locationId:guid}` | Owner lưu cấu hình soạn hợp đồng của cơ sở theo hiệu lực/version. | [Settings](../../src/backend/BHome.Api/Controllers/MainDraftsController.cs#L18) | Owner,Staff + Owner |

**Chặng: Review và phát hành sang ký**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `POST /api/v1/contracts/main-drafts/{id:guid}/release` | Owner xác nhận phát hành bản nháp sang quy trình ký sau khi kiểm dữ liệu/tài liệu; chưa kích hoạt hợp đồng. | [Release](../../src/backend/BHome.Api/Controllers/MainDraftsController.cs#L30) | Owner,Staff + Owner |
| `POST /api/v1/contracts/main-drafts/{id:guid}/signing-review` | Tạo tài liệu review dùng để kiểm tra nội dung trước phát hành sang ký. | [SigningReview](../../src/backend/BHome.Api/Controllers/MainDraftsController.cs#L28) | Owner,Staff |

**Chặng: Sinh/xem/tải tài liệu nháp**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `POST /api/v1/contracts/main-drafts/{id:guid}/documents` | Sinh tài liệu nháp DOCX/PDF theo template và dữ liệu hiện tại của bản nháp. | [Generate](../../src/backend/BHome.Api/Controllers/MainDraftsController.cs#L26) | Owner,Staff |
| `GET /api/v1/contracts/main-drafts/{id:guid}/documents/{fileId:guid}` | Tải file tài liệu nháp cụ thể sau khi kiểm quyền. | [Download](../../src/backend/BHome.Api/Controllers/MainDraftsController.cs#L32) | Owner,Staff |
| `GET /api/v1/contracts/main-drafts/{id:guid}/documents/{fileId:guid}/pages/{page:int}` | Trả ảnh một trang của tài liệu nháp để xem trên client. | [Page](../../src/backend/BHome.Api/Controllers/MainDraftsController.cs#L41) | Owner,Staff |
| `GET /api/v1/contracts/main-drafts/{id:guid}/documents/{fileId:guid}/preview` | Đọc thông tin xem trước của tài liệu nháp PDF. | [Preview](../../src/backend/BHome.Api/Controllers/MainDraftsController.cs#L39) | Owner,Staff |

**Chặng: Tạo/sửa/xem Main Draft**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `POST /api/v1/contracts/main-drafts` | Tạo mới bản nháp hợp đồng thuê từ dữ liệu gửi lên và kiểm tra điều kiện nghiệp vụ. | [Create](../../src/backend/BHome.Api/Controllers/MainDraftsController.cs#L20) | Owner,Staff |
| `GET /api/v1/contracts/main-drafts/{id:guid}` | Lấy thông tin chi tiết bản nháp hợp đồng thuê trong phạm vi được phép. | [Get](../../src/backend/BHome.Api/Controllers/MainDraftsController.cs#L22) | Owner,Staff |
| `PUT /api/v1/contracts/main-drafts/{id:guid}` | Cập nhật bản nháp hợp đồng thuê khi thỏa quyền, trạng thái và điều kiện dữ liệu hiện hành. | [Update](../../src/backend/BHome.Api/Controllers/MainDraftsController.cs#L24) | Owner,Staff |

<a id="flow-10"></a>

### 3.10. Hợp đồng, Holding, ký, bàn giao và move-out

**Nguồn nghiệp vụ:** BF-03/04; UC-14..19; GBR-04; DBR-02/03; JOB-02/05.  
**Số API:** 58.

**Luồng chính:** Holding → approve → ký + tiền xác minh → activate → convert Main. Main → ký/sync/recover → deposit/readiness → Owner activate → handover hai bên. Renewal hoặc termination/expiry → approve/schedule → inspection/review → settlement → complete.

**Mức bao phủ và giới hạn:** Có action cho các chặng chính, history/versions, private file và dispute bàn giao. Sự tồn tại route không chứng minh provider thật. Move-out complete không thay settlement/refund; previews/source/signed document khác giai đoạn.

**Nhánh thay thế/lỗi cần nghiệm thu:** Thiếu chữ ký hoặc tiền; ký lỗi/retry; giữ phòng cạnh tranh; bàn giao tranh chấp; gia hạn chồng kỳ; move-out còn nợ/hoàn cọc chưa xong.

**Các nhánh hợp đồng được tách để báo cáo:**

1. Holding: tạo → Owner approval → chữ ký + cọc được BE xác minh → holding-activation → holding-conversion hoặc cancellation/expiry.
2. Main: draft/release hoặc create → signing → sync/recover khi cần → deposit-verifications → activation-readiness → Owner activate. Chữ ký và tiền là điều kiện, không nhất thiết thực hiện theo một thứ tự cố định.
3. Move-in: handover/choices → Staff lập biên bản + initial readings/evidence → xác nhận Staff/Tenant; có dispute/history. Đây là chặng sau kích hoạt, không thay điều kiện kích hoạt.
4. Renewal: tạo renewals → dùng signing/activation theo lifecycle; có renewal-cancellation và versions/history.
5. Move-out: termination-requests hoặc expiry-move-out → Owner approve/schedule → inspection/evidence → inspection-review → settlement-summary/settlement → deduction/refund nếu áp dụng → complete khi thỏa điều kiện. API deduction/refund được liệt kê tại phần thanh toán.

**Chặng: Giữ chỗ Holding và chuyển Main**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `POST /api/v1/contracts/{id:guid}/holding-activation` | Owner kích hoạt Holding khi đủ điều kiện ký/cọc do BE kiểm tra. | [ActivateHolding](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L68) | Owner,Staff,Tenant + Owner |
| `POST /api/v1/contracts/{id:guid}/holding-approval` | Owner duyệt điều kiện hợp đồng giữ chỗ. | [ApproveHolding](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L64) | Owner,Staff,Tenant + Owner |
| `POST /api/v1/contracts/{id:guid}/holding-cancellation` | Owner hủy Holding hợp lệ, giữ lịch sử và dữ liệu tài chính liên quan. | [CancelHolding](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L70) | Owner,Staff,Tenant + Owner |
| `POST /api/v1/contracts/{id:guid}/holding-conversion` | Chuyển Holding đủ điều kiện thành hợp đồng Main, kiểm nguồn cọc và chống chuyển lặp. | [ConvertHolding](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L72) | Owner,Staff,Tenant + Owner,Staff |
| `GET /api/v1/contracts/{id:guid}/holding-deposit` | Đọc tình trạng nghĩa vụ và phân bổ tiền cọc giữ chỗ. | [HoldingDeposit](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L66) | Owner,Staff,Tenant |
| `POST /api/v1/contracts/holdings` | Tạo bản nháp hợp đồng giữ chỗ cho phòng và người ở hợp lệ. | [CreateHolding](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L61) | Owner,Staff,Tenant + Owner,Staff |

**Chặng: Chuẩn bị người ở/tài khoản**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `GET /api/v1/contracts/{id:guid}/move-out/inspection-preparation` | Đọc dữ liệu chuẩn bị kiểm tra cuối kỳ, gồm dữ liệu bàn giao/tài sản/chỉ số liên quan. | [InspectionPreparation](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L40) | Owner,Staff,Tenant + Owner,Staff |
| `GET /api/v1/contracts/preparation` | Đọc dữ liệu chuẩn bị tạo hợp đồng. | [Preparation](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L25) | Owner,Staff,Tenant + Owner,Staff |
| `GET /api/v1/contracts/preparation/accounts` | Tra cứu các tài khoản Tenant phục vụ chọn/liên kết khi chuẩn bị hợp đồng. | [TenantAccounts](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L27) | Owner,Staff,Tenant + Owner |
| `POST /api/v1/contracts/preparation/residents/{residentId:guid}/account` | Thiết lập/liên kết tài khoản Tenant cho người ở trong bước chuẩn bị hợp đồng. | [LinkTenant](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L29) | Owner,Staff,Tenant + Owner |

**Chặng: Bàn giao đầu kỳ**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `GET /api/v1/contracts/{id:guid}/handover` | Đọc biên bản bàn giao đầu kỳ và trạng thái xác nhận. | [Handover](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L100) | Owner,Staff,Tenant |
| `POST /api/v1/contracts/{id:guid}/handover` | Lập/cập nhật biên bản bàn giao với tình trạng phòng, tài sản và dữ liệu liên quan. | [SaveHandover](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L106) | Owner,Staff,Tenant + Staff |
| `GET /api/v1/contracts/{id:guid}/handover/choices` | Đọc các tài sản/công tơ/lựa chọn cần cho lập biên bản bàn giao. | [HandoverChoices](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L104) | Owner,Staff,Tenant + Staff |
| `POST /api/v1/contracts/{id:guid}/handover/disputes` | Ghi nhận tranh chấp/không đồng ý nội dung biên bản bàn giao. | [DisputeHandover](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L110) | Owner,Staff,Tenant + Tenant |
| `POST /api/v1/contracts/{id:guid}/handover/evidence` | Tải file bằng chứng của biên bản bàn giao. | [UploadHandover](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L114) | Owner,Staff,Tenant + Staff |
| `GET /api/v1/contracts/{id:guid}/handover/evidence/{fileId:guid}` | Tải một file bằng chứng bàn giao khi có quyền. | [HandoverFile](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L116) | Owner,Staff,Tenant |
| `GET /api/v1/contracts/{id:guid}/handover/history` | Đọc lịch sử lập và xác nhận/tranh chấp biên bản bàn giao. | [HandoverHistory](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L102) | Owner,Staff,Tenant |
| `GET /api/v1/contracts/{id:guid}/handover/meter-evidence/{readingId:guid}` | Tải ảnh chứng minh chỉ số công tơ liên quan biên bản bàn giao. | [HandoverMeterFile](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L119) | Owner,Staff,Tenant |
| `POST /api/v1/contracts/{id:guid}/handover/staff-confirmation` | Staff xác nhận nội dung bàn giao trong phạm vi được giao. | [StaffHandover](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L112) | Owner,Staff,Tenant + Staff |
| `POST /api/v1/contracts/{id:guid}/handover/tenant-confirmation` | Tenant xác nhận nội dung bàn giao theo version/trạng thái hiện hành. | [TenantHandover](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L108) | Owner,Staff,Tenant + Tenant |

**Chặng: Gia hạn**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `POST /api/v1/contracts/{id:guid}/renewal-cancellation` | Hủy bản gia hạn khi lifecycle cho phép. | [CancelRenewal](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L122) | Owner,Staff,Tenant + Owner |
| `POST /api/v1/contracts/{id:guid}/renewals` | Tạo hợp đồng/phụ lục gia hạn dựa trên hợp đồng hiện tại và điều kiện hợp lệ. | [Renewal](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L97) | Owner,Staff,Tenant + Owner,Staff |

**Chặng: Yêu cầu kết thúc và kiểm tra cuối kỳ**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `POST /api/v1/contracts/{id:guid}/expiry-move-out` | Khởi tạo nhánh move-out do hợp đồng hết hạn. | [Expiry](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L126) | Owner,Staff,Tenant + Owner |
| `GET /api/v1/contracts/{id:guid}/move-out` | Đọc hồ sơ và trạng thái xử lý trả phòng. | [MoveOut](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L128) | Owner,Staff,Tenant |
| `POST /api/v1/contracts/{id:guid}/move-out/approve` | Owner duyệt yêu cầu trả phòng theo điều kiện workflow. | [Approve](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L130) | Owner,Staff,Tenant + Owner |
| `POST /api/v1/contracts/{id:guid}/move-out/complete` | Owner hoàn tất trả phòng và giải phóng phòng khi các điều kiện bắt buộc được backend xác nhận. | [Complete](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L145) | Owner,Staff,Tenant + Owner |
| `POST /api/v1/contracts/{id:guid}/move-out/evidence` | Tải bằng chứng phục vụ kiểm tra/xử lý trả phòng. | [UploadEvidence](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L136) | Owner,Staff,Tenant + Staff |
| `GET /api/v1/contracts/{id:guid}/move-out/evidence/{evidenceId:guid}` | Tải một file bằng chứng move-out theo quyền. | [Evidence](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L138) | Owner,Staff,Tenant |
| `GET /api/v1/contracts/{id:guid}/move-out/history` | Đọc lịch sử các bước xử lý trả phòng. | [MoveHistory](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L38) | Owner,Staff,Tenant |
| `POST /api/v1/contracts/{id:guid}/move-out/inspection` | Ghi nhận kết quả kiểm tra trả phòng, tình trạng tài sản và chỉ số cuối kỳ. | [Inspect](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L134) | Owner,Staff,Tenant + Staff |
| `POST /api/v1/contracts/{id:guid}/move-out/inspection-review` | Owner xem xét/quyết định đối với bản kiểm tra trả phòng. | [InspectionReview](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L44) | Owner,Staff,Tenant + Owner |
| `GET /api/v1/contracts/{id:guid}/move-out/inspections` | Liệt kê các bản kiểm tra trả phòng đã ghi nhận. | [Inspections](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L42) | Owner,Staff,Tenant |
| `POST /api/v1/contracts/{id:guid}/move-out/schedule` | Owner sắp lịch/phân công kiểm tra trả phòng. | [Schedule](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L132) | Owner,Staff,Tenant + Owner,Staff |
| `POST /api/v1/contracts/{id:guid}/move-out/settlement` | Ghi nhận bước quyết toán theo dữ liệu và điều kiện hợp lệ; không tự thực hiện chuyển tiền ngân hàng. | [Settle](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L141) | Owner,Staff,Tenant + Owner |
| `GET /api/v1/contracts/{id:guid}/move-out/settlement-history` | Đọc lịch sử các lần quyết toán của hồ sơ trả phòng. | [SettlementHistory](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L143) | Owner,Staff,Tenant + Owner,Tenant |
| `GET /api/v1/contracts/{id:guid}/move-out/settlement-summary` | Tổng hợp nghĩa vụ và trạng thái tài chính liên quan để xem xét quyết toán trả phòng. | [SettlementSummary](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L46) | Owner,Staff,Tenant + Owner,Tenant |
| `POST /api/v1/contracts/{id:guid}/termination-requests` | Gửi yêu cầu chấm dứt thuê theo điều kiện và quyền của hợp đồng. | [Termination](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L124) | Owner,Staff,Tenant + Tenant |
| `GET /api/v1/contracts/move-out-assignments` | Lấy các công việc kiểm tra move-out được giao cho Staff hiện tại theo dữ liệu workflow. | [Assignments](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L36) | Owner,Staff,Tenant + Staff |

**Chặng: Xác minh cọc và kích hoạt Main**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `POST /api/v1/contracts/{id:guid}/activate` | Owner kích hoạt hợp đồng khi các điều kiện backend được thỏa mãn. | [Activate](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L78) | Owner,Staff,Tenant + Owner |
| `GET /api/v1/contracts/{id:guid}/activation-readiness` | Kiểm tra các điều kiện ký, tiền và dữ liệu trước kích hoạt; không tự kích hoạt hợp đồng. | [Readiness](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L76) | Owner,Staff,Tenant + Owner,Tenant |
| `GET /api/v1/contracts/{id:guid}/deposit-verifications` | Lấy lịch sử/bằng chứng xác minh cọc của hợp đồng. | [Deposits](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L48) | Owner,Staff,Tenant + Owner,Tenant |
| `POST /api/v1/contracts/{id:guid}/deposit-verifications` | Owner ghi nhận xác minh khoản cọc theo dữ liệu và quy tắc backend. | [Deposit](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L80) | Owner,Staff,Tenant + Owner |

**Chặng: Ký, đồng bộ và phục hồi ký**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `POST /api/v1/contracts/{id:guid}/signing` | Tạo yêu cầu ký hợp đồng cho signer hiện tại qua provider/mode được cấu hình. | [Sign](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L82) | Owner,Staff,Tenant + Owner,Tenant |
| `GET /api/v1/contracts/{id:guid}/signing/layout` | Trả bố cục tài liệu và vị trí ký để người ký xem trước. | [SigningLayout](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L85) | Owner,Staff,Tenant + Owner,Tenant |
| `GET /api/v1/contracts/{id:guid}/signing/pages/{page:int}` | Trả ảnh một trang tài liệu đang chuẩn bị ký. | [SigningPage](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L87) | Owner,Staff,Tenant + Owner,Tenant |
| `POST /api/v1/contracts/{id:guid}/signing/recover` | Thực hiện nhánh phục hồi yêu cầu ký theo trạng thái và lựa chọn hợp lệ. | [Recover](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L92) | Owner,Staff,Tenant + Owner,Tenant |
| `POST /api/v1/contracts/{id:guid}/signing/sync` | Đồng bộ kết quả/trạng thái ký từ cơ chế ký đang dùng. | [Sync](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L90) | Owner,Staff,Tenant + Owner,Tenant |

**Chặng: Tài liệu trước/sau ký**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `GET /api/v1/contracts/{id:guid}/document` | Tải tài liệu hợp đồng theo quyền và điều kiện hiện tại. | [Document](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L94) | Owner,Staff,Tenant + Owner,Tenant |
| `GET /api/v1/contracts/{id:guid}/previews` | Liệt kê các tài liệu xem trước đã sinh cho hợp đồng. | [Previews](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L50) | Owner,Staff,Tenant + Owner,Tenant |
| `POST /api/v1/contracts/{id:guid}/previews` | Sinh tài liệu PDF xem trước hợp đồng; không phải xác nhận đã ký. | [GeneratePreview](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L52) | Owner,Staff,Tenant + Owner,Tenant |
| `GET /api/v1/contracts/{id:guid}/previews/{fileId:guid}` | Tải một bản PDF xem trước cụ thể. | [PreviewFile](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L54) | Owner,Staff,Tenant + Owner,Tenant |

**Chặng: Hạn hợp đồng và cấu hình**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `GET /api/v1/contracts/configuration` | Đọc cấu hình/khả năng workflow hợp đồng được backend công bố. | [Configuration](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L21) | Owner,Staff,Tenant |
| `GET /api/v1/contracts/expiry-reminders` | Tra cứu danh sách/nhắc việc hợp đồng sắp hết hạn theo tham số và quyền. | [ExpiryReminders](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L23) | Owner,Staff,Tenant + Owner,Tenant |

**Chặng: Tạo, tra cứu và lịch sử hợp đồng**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `GET /api/v1/contracts` | Lấy danh sách hợp đồng trong phạm vi được phép; áp dụng bộ lọc/phân trang của API. | [List](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L16) | Owner,Staff,Tenant |
| `POST /api/v1/contracts` | Tạo mới hợp đồng từ dữ liệu gửi lên và kiểm tra điều kiện nghiệp vụ. | [Create](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L58) | Owner,Staff,Tenant + Owner,Staff |
| `GET /api/v1/contracts/{id:guid}` | Lấy thông tin chi tiết hợp đồng trong phạm vi được phép. | [Get](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L74) | Owner,Staff,Tenant |
| `GET /api/v1/contracts/{id:guid}/history` | Lấy lịch sử thao tác hợp đồng. | [History](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L32) | Owner,Staff,Tenant |
| `GET /api/v1/contracts/{id:guid}/versions` | Lấy các phiên bản/hợp đồng liên quan trong chuỗi hợp đồng. | [Versions](../../src/backend/BHome.Api/Controllers/ContractsController.cs#L34) | Owner,Staff,Tenant |

<a id="flow-11"></a>

### 3.11. Cấu hình và tài nguyên ký số

**Nguồn nghiệp vụ:** GBR-04; Electronic Contract Provider.  
**Số API:** 13.

**Luồng chính:** Owner cấu hình/test MySign → signer quản lý certificate → ảnh hiển thị chữ ký → contract signing.

**Mức bao phủ và giới hạn:** Ảnh chỉ là appearance, không thay chữ ký provider. API chính có wrapper; thư viện Sandbox có controller khác nhưng không được nạp vào API chính trong lượt kiểm descriptor.

**Nhánh thay thế/lỗi cần nghiệm thu:** Staff không phải signer; chứng thư khóa/hết hạn; provider lỗi; không dùng ảnh chữ ký làm chứng cứ thay ký số.

**Chặng: Cấu hình kết nối provider**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `DELETE /api/v1/digital-signing/settings/viettel` | Xóa cấu hình MySign lưu qua giao diện để quay về cấu hình máy chủ. | [Reset](../../src/backend/BHome.Api/Controllers/ContractSigningAccountsController.cs#L63) | Owner |
| `GET /api/v1/digital-signing/settings/viettel` | Đọc cấu hình MySign ở dạng hiển thị an toàn, không trả nguyên secret. | [View](../../src/backend/BHome.Api/Controllers/ContractSigningAccountsController.cs#L49) | Owner |
| `PUT /api/v1/digital-signing/settings/viettel` | Lưu cấu hình kết nối MySign theo quyền Owner và cơ chế bảo vệ secret của server. | [Save](../../src/backend/BHome.Api/Controllers/ContractSigningAccountsController.cs#L51) | Owner |
| `POST /api/v1/digital-signing/settings/viettel/test` | Thử kết nối/xác thực với MySign; không ký hợp đồng hay tự gửi yêu cầu ký. | [Test](../../src/backend/BHome.Api/Controllers/ContractSigningAccountsController.cs#L66) | Owner |

**Chặng: Quản lý chứng thư signer**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `GET /api/v1/digital-signing/certificates` | Liệt kê chứng thư ký số của người đang đăng nhập. | [Mine](../../src/backend/BHome.Api/Controllers/ContractSigningCertificatesController.cs#L15) | Owner,Tenant |
| `POST /api/v1/digital-signing/certificates` | Khai báo chứng thư/thông tin signer để dùng với provider ký số. | [Declare](../../src/backend/BHome.Api/Controllers/ContractSigningCertificatesController.cs#L16) | Owner,Tenant |
| `DELETE /api/v1/digital-signing/certificates/{id:guid}` | Gỡ khai báo chứng thư của người hiện tại khi được phép. | [Remove](../../src/backend/BHome.Api/Controllers/ContractSigningCertificatesController.cs#L20) | Owner,Tenant |
| `POST /api/v1/digital-signing/certificates/{id:guid}/lock` | Đổi trạng thái khóa/mở khóa chứng thư theo yêu cầu hợp lệ. | [Lock](../../src/backend/BHome.Api/Controllers/ContractSigningCertificatesController.cs#L22) | Owner,Tenant |

**Chặng: Ảnh hiển thị chữ ký**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `DELETE /api/v1/digital-signing/signature-image` | Xóa ảnh chữ ký hiển thị của người hiện tại. | [Remove](../../src/backend/BHome.Api/Controllers/ContractSigningAccountsController.cs#L38) | Owner,Tenant |
| `GET /api/v1/digital-signing/signature-image` | Đọc metadata ảnh chữ ký hiển thị của người đang đăng nhập. | [Mine](../../src/backend/BHome.Api/Controllers/ContractSigningAccountsController.cs#L20) | Owner,Tenant |
| `PUT /api/v1/digital-signing/signature-image` | Lưu ảnh PNG chữ ký hiển thị do signer tải lên. | [Save](../../src/backend/BHome.Api/Controllers/ContractSigningAccountsController.cs#L26) | Owner,Tenant |
| `GET /api/v1/digital-signing/signature-image/content` | Tải nội dung PNG ảnh chữ ký của người hiện tại. | [Content](../../src/backend/BHome.Api/Controllers/ContractSigningAccountsController.cs#L22) | Owner,Tenant |
| `POST /api/v1/digital-signing/signature-image/generate` | Tạo ảnh chữ ký hiển thị từ tên nhập và lưu vào hồ sơ signer; không tạo chữ ký số pháp lý. | [Generate](../../src/backend/BHome.Api/Controllers/ContractSigningAccountsController.cs#L34) | Owner,Tenant |

<a id="flow-12"></a>

### 3.12. Tạm trú và phòng riêng của Tenant

**Nguồn nghiệp vụ:** UC-18; GBR-06; FE-07; GBR-01/02.  
**Số API:** 8.

**Luồng chính:** Tenant xem phòng riêng; đăng ký tạm trú bên ngoài → cập nhật trạng thái/evidence → Owner confirmation → xem kết quả.

**Mức bao phủ và giới hạn:** Đã có residence workflow API riêng; tài liệu cũ ghi chỉ có metadata không còn đúng. OperationsService chặn Staff và ép Tenant scope. Không có API nộp VNeID.

**Nhánh thay thế/lỗi cần nghiệm thu:** Tenant khác phòng/hợp đồng; Staff đọc/duyệt residence; evidence sai quyền; Owner confirmation đúng người ở.

**Chặng: Tenant xem phòng riêng**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `GET /api/v1/tenant/rooms` | Lấy danh sách phòng thuộc quyền xem riêng của Tenant hiện tại. | [Rooms](../../src/backend/BHome.Api/Controllers/Notifications/NotificationWorkspaceController.cs#L30) | Authenticated |
| `GET /api/v1/tenant/rooms/{id:guid}` | Đọc phòng cụ thể thuộc quyền xem riêng của Tenant hiện tại. | [Room](../../src/backend/BHome.Api/Controllers/Notifications/NotificationWorkspaceController.cs#L32) | Authenticated |

**Chặng: Cập nhật trạng thái, bằng chứng và Owner xác nhận tạm trú**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `GET /api/v1/residence-tasks` | Lấy danh sách trạng thái tạm trú theo hợp đồng và người ở trong phạm vi được phép; áp dụng bộ lọc/phân trang của API. | [List](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs#L34) | Authenticated |
| `GET /api/v1/residence-tasks/{contractId:guid}/{residentId:guid}` | Lấy thông tin chi tiết trạng thái tạm trú theo hợp đồng và người ở trong phạm vi được phép. | [Get](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs#L35) | Authenticated |
| `PUT /api/v1/residence-tasks/{contractId:guid}/{residentId:guid}` | Cập nhật trạng thái/kết quả đăng ký tạm trú bên ngoài cho đúng người ở và hợp đồng. | [Update](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs#L36) | Authenticated |
| `GET /api/v1/residence-tasks/{contractId:guid}/{residentId:guid}/evidence` | Tải bằng chứng cư trú sau khi kiểm quyền với người ở và hợp đồng. | [Download](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs#L40) | Authenticated |
| `PUT /api/v1/residence-tasks/{contractId:guid}/{residentId:guid}/evidence` | Tải ảnh bằng chứng kết quả cư trú trong phạm vi hợp đồng/người ở được phép. | [Upload](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs#L38) | Authenticated |
| `POST /api/v1/residence-tasks/{contractId:guid}/{residentId:guid}/owner-confirmation` | Owner xác nhận thông tin/kết quả cư trú theo workflow; không nộp đăng ký lên VNeID. | [Confirm](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs#L37) | Authenticated |

<a id="flow-13"></a>

### 3.13. Hóa đơn, lịch billing và adjustment

**Nguồn nghiệp vụ:** BF-05/06; UC-20/21/24; JOB-09/10; DBR-06/07.  
**Số API:** 26.

**Luồng chính:** Lịch → automation theo kỳ → meter task → confirmed usage → Draft/refresh → Owner finalize hoặc automation được ủy quyền → Tenant yêu cầu adjustment → Owner approve/reject.

**Mức bao phủ và giới hạn:** Có thao tác trực tiếp và preview/queue/attempts/executions của job. BillingSchedules là lịch/quy tắc tính; BillingAutomation là kế hoạch điều phối có snapshot/version lịch. Adjustment sau Final giữ record riêng; thiếu PUT Invoice không phải thiếu API.

**Nhánh thay thế/lỗi cần nghiệm thu:** Thiếu chỉ số giữ Draft; duplicate kỳ; Final bất biến; Owner-only finalization; job lặp; adjustment sau thanh toán.

**Chặng: Điều chỉnh trước/sau Final**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `GET /api/v1/invoice-adjustments` | Lấy danh sách yêu cầu điều chỉnh hóa đơn trong phạm vi được phép; áp dụng bộ lọc/phân trang của API. | [List](../../src/backend/BHome.Api/Controllers/Billing/InvoiceAdjustmentsController.cs#L15) | Owner,Tenant |
| `GET /api/v1/invoice-adjustments/{id:guid}` | Lấy thông tin chi tiết yêu cầu điều chỉnh hóa đơn trong phạm vi được phép. | [Get](../../src/backend/BHome.Api/Controllers/Billing/InvoiceAdjustmentsController.cs#L16) | Owner,Tenant |
| `POST /api/v1/invoice-adjustments/{id:guid}/approve` | Owner duyệt yêu cầu: cập nhật Draft hoặc ghi adjustment riêng nếu hóa đơn đã Final theo quy tắc hiện có. | [Approve](../../src/backend/BHome.Api/Controllers/Billing/InvoiceAdjustmentsController.cs#L20) | Owner,Tenant + invoice-adjustments.approve |
| `GET /api/v1/invoice-adjustments/{id:guid}/evidence/{evidenceId:guid}` | Tải bằng chứng của yêu cầu điều chỉnh sau kiểm quyền. | [Evidence](../../src/backend/BHome.Api/Controllers/Billing/InvoiceAdjustmentsController.cs#L28) | Owner,Tenant |
| `POST /api/v1/invoice-adjustments/{id:guid}/reject` | Owner từ chối yêu cầu điều chỉnh, giữ lý do/lịch sử. | [Reject](../../src/backend/BHome.Api/Controllers/Billing/InvoiceAdjustmentsController.cs#L22) | Owner,Tenant + invoice-adjustments.approve |
| `PUT /api/v1/invoices/{invoiceId:guid}/adjustment-evidence` | Tải ảnh bằng chứng để sử dụng cho yêu cầu điều chỉnh hóa đơn. | [Upload](../../src/backend/BHome.Api/Controllers/Billing/InvoiceAdjustmentsController.cs#L26) | Owner,Tenant + invoice-adjustments.request |
| `POST /api/v1/invoices/{invoiceId:guid}/adjustment-requests` | Tenant gửi yêu cầu điều chỉnh hóa đơn kèm dữ liệu/lý do theo contract API. | [Submit](../../src/backend/BHome.Api/Controllers/Billing/InvoiceAdjustmentsController.cs#L24) | Owner,Tenant + invoice-adjustments.request |
| `GET /api/v1/invoices/{invoiceId:guid}/adjustments` | Đọc các điều chỉnh gắn với hóa đơn và ảnh hưởng tương ứng. | [Effects](../../src/backend/BHome.Api/Controllers/Billing/InvoiceAdjustmentsController.cs#L17) | Owner,Tenant |

**Chặng: Lịch tính phí**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `PUT /api/v1/billing-schedules` | Lưu lịch/quy tắc tính hóa đơn của cơ sở với kiểm version và thứ tự ngày hợp lệ. | [Save](../../src/backend/BHome.Api/Controllers/Billing/InvoicesController.cs#L28) | Owner |
| `GET /api/v1/billing-schedules/{locationId:guid}` | Đọc lịch tạo Draft/chốt/hạn thanh toán và quy tắc tính hóa đơn của cơ sở. | [Get](../../src/backend/BHome.Api/Controllers/Billing/InvoicesController.cs#L27) | Owner |

**Chặng: Điều phối tự động, theo dõi và xử lý job**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `PUT /api/v1/billing-automation` | Lưu kế hoạch tự động ghi số/tạo Draft/chốt theo kỳ, kèm quyền cho phép tự động Final nếu có. | [Save](../../src/backend/BHome.Api/Controllers/Billing/BillingAutomationController.cs#L16) | locations.manage |
| `GET /api/v1/billing-automation/{locationId:guid}` | Đọc kế hoạch automation áp dụng cho cơ sở và kỳ được chọn. | [Get](../../src/backend/BHome.Api/Controllers/Billing/BillingAutomationController.cs#L12) | locations.manage |
| `GET /api/v1/billing-automation/{locationId:guid}/history` | Đọc lịch sử các kế hoạch billing automation của cơ sở. | [History](../../src/backend/BHome.Api/Controllers/Billing/BillingAutomationController.cs#L14) | locations.manage |
| `GET /api/v1/billing-automation/attempts` | Liệt kê các lần thử xử lý automation để theo dõi lỗi/retry. | [Attempts](../../src/backend/BHome.Api/Controllers/Billing/BillingAutomationController.cs#L24) | locations.manage |
| `GET /api/v1/billing-automation/executions` | Liệt kê các lượt thực thi automation theo cơ sở/kỳ. | [Executions](../../src/backend/BHome.Api/Controllers/Billing/BillingAutomationController.cs#L18) | locations.manage |
| `POST /api/v1/billing-automation/meter-tasks/{taskId:guid}/assignment` | Gán lại người phụ trách tác vụ ghi công tơ theo điều kiện hợp lệ. | [Assign](../../src/backend/BHome.Api/Controllers/Billing/BillingAutomationController.cs#L28) | locations.manage |
| `GET /api/v1/billing-automation/preview` | Xem trước khả năng chạy, điều kiện chặn và dữ liệu automation của kỳ. | [Preview](../../src/backend/BHome.Api/Controllers/Billing/BillingAutomationController.cs#L22) | locations.manage |
| `GET /api/v1/billing-automation/queue` | Đọc trạng thái hàng đợi công việc billing theo cơ sở/kỳ. | [Queue](../../src/backend/BHome.Api/Controllers/Billing/BillingAutomationController.cs#L26) | locations.manage |
| `GET /api/v1/billing-automation/representative` | Đọc lựa chọn người đại diện cho phòng trong kỳ billing. | [Representative](../../src/backend/BHome.Api/Controllers/Billing/BillingAutomationController.cs#L30) | locations.manage |
| `PUT /api/v1/billing-automation/representative` | Lưu lựa chọn người đại diện cho phòng/kỳ theo quy tắc backend. | [Select](../../src/backend/BHome.Api/Controllers/Billing/BillingAutomationController.cs#L32) | locations.manage |
| `POST /api/v1/billing-automation/run-now` | Yêu cầu thực thi automation ngay khi môi trường/cấu hình/quyền cho phép. | [Run](../../src/backend/BHome.Api/Controllers/Billing/BillingAutomationController.cs#L20) | locations.manage |

**Chặng: Tạo/cập nhật Draft và chốt Invoice**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `GET /api/v1/invoices` | Lấy danh sách hóa đơn trong phạm vi được phép; áp dụng bộ lọc/phân trang của API. | [List](../../src/backend/BHome.Api/Controllers/Billing/InvoicesController.cs#L15) | Owner,Tenant |
| `GET /api/v1/invoices/{id:guid}` | Lấy thông tin chi tiết hóa đơn trong phạm vi được phép. | [Get](../../src/backend/BHome.Api/Controllers/Billing/InvoicesController.cs#L16) | Owner,Tenant |
| `POST /api/v1/invoices/{id:guid}/finalize` | Owner chốt hóa đơn sau khi kiểm dữ liệu bắt buộc và version; hóa đơn Final không được sửa trực tiếp. | [FinalizeInvoice](../../src/backend/BHome.Api/Controllers/Billing/InvoicesController.cs#L19) | Owner,Tenant + Owner |
| `POST /api/v1/invoices/{id:guid}/refresh` | Tính/cập nhật lại hóa đơn Draft theo dữ liệu hiện hành và expected version. | [Refresh](../../src/backend/BHome.Api/Controllers/Billing/InvoicesController.cs#L18) | Owner,Tenant + Owner |
| `POST /api/v1/invoices/drafts` | Tạo hóa đơn Draft từ hợp đồng, kỳ, dữ liệu xác nhận và chính sách áp dụng. | [Draft](../../src/backend/BHome.Api/Controllers/Billing/InvoicesController.cs#L17) | Owner,Tenant + Owner |

<a id="flow-14"></a>

### 3.14. Thanh toán, công nợ, hoàn tiền và khấu trừ

**Nguồn nghiệp vụ:** BF-06; UC-22..25; GBR-10/18; OQ-01/02/05.  
**Số API:** 23.

**Luồng chính:** Receiving account/transfer instructions → Owner ghi khoản tiền xác minh → allocate Invoice/Holding → payment/debt/history → refund request → decision → execution/evidence; deduction/deposit refund nối move-out.

**Mức bao phủ và giới hạn:** Có phân bổ và hoàn thủ công. Chưa thấy bank webhook/callback tự động trong host. /debts ép OutstandingOnly=true và cho Staff; /payment-invoices không ép và chỉ Owner/Tenant: không phải alias tương đương.

**Nhánh thay thế/lỗi cần nghiệm thu:** Thiếu/thừa tiền; giao dịch chưa xác minh; allocation lặp; hoàn vượt nguồn; Staff thấy tài chính nhạy cảm; ảnh không chứng minh settlement.

**Chặng: Tài khoản nhận tiền**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `PUT /api/v1/receiving-bank-accounts` | Owner lưu cấu hình tài khoản nhận tiền phục vụ hướng dẫn chuyển khoản. | [Save](../../src/backend/BHome.Api/Controllers/PaymentsDebt/ReceivingAccountsController.cs#L14) | Owner |
| `GET /api/v1/receiving-bank-accounts/{locationId:guid}` | Đọc cấu hình tài khoản ngân hàng nhận tiền của cơ sở theo quyền API. | [Get](../../src/backend/BHome.Api/Controllers/PaymentsDebt/ReceivingAccountsController.cs#L13) | Owner |

**Chặng: Hướng dẫn chuyển tiền**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `GET /api/v1/invoices/{id:guid}/transfer-instructions` | Sinh/đọc hướng dẫn chuyển khoản và dữ liệu QR cho hóa đơn từ thông tin backend; không xác nhận đã thanh toán. | [Get](../../src/backend/BHome.Api/Controllers/PaymentsDebt/ReceivingAccountsController.cs#L20) | Owner,Tenant |

**Chặng: Khấu trừ cọc**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `POST /api/v1/contracts/{id:guid}/deposit-deductions` | Owner quyết định khoản khấu trừ cọc theo lý do/bằng chứng và điều kiện quyết toán được backend hỗ trợ. | [Approve](../../src/backend/BHome.Api/Controllers/DepositDeductionsController.cs#L12) | Owner |

**Chặng: Yêu cầu/duyệt/thực hiện hoàn tiền**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `GET /api/v1/contracts/{id:guid}/deposit-refunds` | Đọc nguồn cọc và thông tin hoàn cọc liên quan hợp đồng. | [DepositSource](../../src/backend/BHome.Api/Controllers/RefundsController.cs#L17) | Owner |
| `POST /api/v1/contracts/{id:guid}/deposit-refunds` | Tạo yêu cầu hoàn cọc từ nguồn hợp đồng theo điều kiện quyết toán. | [CreateDeposit](../../src/backend/BHome.Api/Controllers/RefundsController.cs#L19) | Owner |
| `GET /api/v1/payment-transactions/{id:guid}/refunds` | Đọc nguồn tiền thừa và các yêu cầu hoàn gắn với giao dịch, gồm khả năng hoàn theo backend. | [Source](../../src/backend/BHome.Api/Controllers/RefundsController.cs#L13) | Owner |
| `POST /api/v1/payment-transactions/{id:guid}/refunds` | Tạo yêu cầu hoàn từ nguồn tiền giao dịch đủ điều kiện. | [Create](../../src/backend/BHome.Api/Controllers/RefundsController.cs#L15) | Owner |
| `POST /api/v1/refund-requests/{id:guid}/decision` | Owner quyết định yêu cầu hoàn tiền theo trạng thái và dữ liệu hợp lệ. | [Decision](../../src/backend/BHome.Api/Controllers/RefundsController.cs#L21) | Owner |
| `GET /api/v1/refund-requests/{id:guid}/evidence` | Tải bằng chứng của yêu cầu hoàn tiền khi có quyền. | [Evidence](../../src/backend/BHome.Api/Controllers/RefundsController.cs#L31) | Owner |
| `POST /api/v1/refund-requests/{id:guid}/execution` | Ghi nhận việc thực hiện/xác minh hoàn tiền với bằng chứng; không tự giải ngân qua ngân hàng. | [Execute](../../src/backend/BHome.Api/Controllers/RefundsController.cs#L23) | Owner |

**Chặng: Ghi nhận và phân bổ giao dịch**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `GET /api/v1/payment-transactions` | Lấy danh sách giao dịch chuyển khoản trong phạm vi được phép; áp dụng bộ lọc/phân trang của API. | [List](../../src/backend/BHome.Api/Controllers/PaymentsDebt/PaymentTransactionsController.cs#L15) | Owner |
| `POST /api/v1/payment-transactions` | Owner ghi nhận khoản tiền chuyển khoản để xác minh/đối soát theo quy trình thủ công hiện có. | [Register](../../src/backend/BHome.Api/Controllers/PaymentsDebt/PaymentTransactionsController.cs#L17) | Owner |
| `GET /api/v1/payment-transactions/{id:guid}` | Lấy thông tin chi tiết giao dịch chuyển khoản trong phạm vi được phép. | [Get](../../src/backend/BHome.Api/Controllers/PaymentsDebt/PaymentTransactionsController.cs#L16) | Owner |
| `POST /api/v1/payment-transactions/{id:guid}/allocate` | Phân bổ tiền giao dịch vào nghĩa vụ hóa đơn, kiểm nguồn tiền, dư nợ và tính chống lặp. | [Allocate](../../src/backend/BHome.Api/Controllers/PaymentsDebt/PaymentTransactionsController.cs#L18) | Owner |
| `POST /api/v1/payment-transactions/{id:guid}/allocate-holding-deposit` | Phân bổ tiền giao dịch cho nghĩa vụ cọc Holding hợp lệ. | [AllocateDeposit](../../src/backend/BHome.Api/Controllers/PaymentsDebt/PaymentTransactionsController.cs#L19) | Owner |
| `GET /api/v1/payment-transactions/{id:guid}/reconciliation-history` | Đọc lịch sử đối soát/phân bổ của giao dịch. | [History](../../src/backend/BHome.Api/Controllers/PaymentsDebt/PaymentTransactionsController.cs#L21) | Owner |
| `POST /api/v1/payment-transactions/{id:guid}/reject` | Từ chối giao dịch/nhánh đối soát theo trạng thái và lý do được phép. | [Reject](../../src/backend/BHome.Api/Controllers/PaymentsDebt/PaymentTransactionsController.cs#L20) | Owner |

**Chặng: Theo dõi nợ và lịch sử thanh toán**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `GET /api/v1/debts` | Liệt kê các hóa đơn còn dư nợ; API bắt buộc OutstandingOnly và áp dụng phạm vi role/Location/Tenant. | [List](../../src/backend/BHome.Api/Controllers/PaymentsDebt/DebtsController.cs#L13) | Owner,Staff,Tenant |
| `GET /api/v1/payment-invoices` | Liệt kê hóa đơn theo góc nhìn thanh toán với bộ lọc; không ép chỉ lấy hóa đơn còn nợ. | [List](../../src/backend/BHome.Api/Controllers/PaymentsDebt/DebtsController.cs#L21) | Owner,Tenant |
| `GET /api/v1/payment-history` | Tra cứu lịch sử thanh toán/phân bổ trong phạm vi người gọi được phép. | [List](../../src/backend/BHome.Api/Controllers/PaymentsDebt/DebtsController.cs#L27) | Owner,Tenant |

**Chặng: Thông tin thanh toán Invoice/người trả hợp lệ**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `GET /api/v1/invoices/{id:guid}/payment` | Đọc tình trạng thanh toán, nghĩa vụ và số dư liên quan hóa đơn. | [Get](../../src/backend/BHome.Api/Controllers/PaymentsDebt/PaymentTransactionsController.cs#L28) | Owner,Tenant |
| `GET /api/v1/invoices/{id:guid}/payment/eligible-payers` | Liệt kê các đối tượng trả tiền hợp lệ mà người gọi được phép xem cho hóa đơn. | [Payers](../../src/backend/BHome.Api/Controllers/PaymentsDebt/PaymentTransactionsController.cs#L29) | Owner,Tenant + Owner |

<a id="flow-15"></a>

### 3.15. Chi phí, báo cáo tài chính và What-if

**Nguồn nghiệp vụ:** FE-08; UC-31..34; GBR-15/16.  
**Số API:** 13.

**Luồng chính:** OPEX + reference/evidence → report → analyze What-if → lưu scenario → xem lại.

**Mức bao phủ và giới hạn:** Có chi phí, báo cáo và mô phỏng. Analyze khác lưu scenario. Cần đối soát phạm vi số liệu thật; không suy thành kế toán pháp định, payroll hay toàn bộ nghĩa vụ cọc.

**Nhánh thay thế/lỗi cần nghiệm thu:** What-if không đổi dữ liệu thật; report cùng kỳ/scope; expense evidence sai quyền; hoàn cọc không bị cộng nhầm OPEX.

**Chặng: Ghi nhận chi phí và evidence**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `GET /api/v1/expenses` | Lấy danh sách chi phí vận hành trong phạm vi được phép; áp dụng bộ lọc/phân trang của API. | [List](../../src/backend/BHome.Api/Controllers/ExpensesController.cs#L12) | Owner |
| `POST /api/v1/expenses` | Tạo mới chi phí vận hành từ dữ liệu gửi lên và kiểm tra điều kiện nghiệp vụ. | [Create](../../src/backend/BHome.Api/Controllers/ExpensesController.cs#L16) | Owner |
| `GET /api/v1/expenses/{id:guid}` | Lấy thông tin chi tiết chi phí vận hành trong phạm vi được phép. | [Get](../../src/backend/BHome.Api/Controllers/ExpensesController.cs#L15) | Owner |
| `PUT /api/v1/expenses/{id:guid}` | Cập nhật chi phí vận hành khi thỏa quyền, trạng thái và điều kiện dữ liệu hiện hành. | [Update](../../src/backend/BHome.Api/Controllers/ExpensesController.cs#L19) | Owner |
| `GET /api/v1/expenses/{id:guid}/evidence` | Liệt kê bằng chứng của khoản chi phí. | [Evidence](../../src/backend/BHome.Api/Controllers/ExpensesController.cs#L20) | Owner |
| `POST /api/v1/expenses/{id:guid}/evidence` | Tải file bằng chứng cho khoản chi phí. | [Upload](../../src/backend/BHome.Api/Controllers/ExpensesController.cs#L22) | Owner |
| `GET /api/v1/expenses/{id:guid}/evidence/{fileId:guid}` | Tải một file bằng chứng chi phí sau kiểm quyền. | [Download](../../src/backend/BHome.Api/Controllers/ExpensesController.cs#L25) | Owner |
| `GET /api/v1/expenses/reference-choices` | Lấy các đối tượng tham chiếu hợp lệ để gắn chi phí như Location/Room/Asset/Work Order theo API. | [References](../../src/backend/BHome.Api/Controllers/ExpensesController.cs#L13) | Owner |

**Chặng: Tổng hợp báo cáo**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `GET /api/v1/financial-reports` | Tổng hợp chỉ số tài chính theo kỳ/phạm vi/bộ lọc từ dữ liệu backend; không tự coi là báo cáo kế toán pháp định. | [Get](../../src/backend/BHome.Api/Controllers/FinancialReportsController.cs#L12) | Owner |

**Chặng: Mô phỏng và lưu kịch bản**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `GET /api/v1/financial-scenarios` | Lấy danh sách kịch bản tài chính giả định trong phạm vi được phép; áp dụng bộ lọc/phân trang của API. | [List](../../src/backend/BHome.Api/Controllers/FinancialScenariosController.cs#L16) | Owner |
| `POST /api/v1/financial-scenarios` | Lưu kịch bản giả định để tra cứu lại, tách khỏi dữ liệu kinh doanh thực tế. | [Save](../../src/backend/BHome.Api/Controllers/FinancialScenariosController.cs#L13) | Owner |
| `GET /api/v1/financial-scenarios/{id:guid}` | Lấy thông tin chi tiết kịch bản tài chính giả định trong phạm vi được phép. | [Get](../../src/backend/BHome.Api/Controllers/FinancialScenariosController.cs#L17) | Owner |
| `POST /api/v1/financial-scenarios/analyze` | Tính thử kết quả What-if từ các giả định; không sửa giá, hợp đồng hay giao dịch thực tế. | [Analyze](../../src/backend/BHome.Api/Controllers/FinancialScenariosController.cs#L12) | Owner |

<a id="flow-16"></a>

### 3.16. Inbox, announcement, delivery và reminder

**Nguồn nghiệp vụ:** FE-07; UC-35/36; JOB-01/04/07/08; GBR-18.  
**Số API:** 19.

**Luồng chính:** Business event → persisted inbox → target/read; Owner preview audience → create/send; device → delivery/retry → monitoring; Location reminder policy.

**Mức bao phủ và giới hạn:** PATCH/POST read cùng action, trùng trực tiếp. Inbox Task/Incident riêng còn DTO/quyền/client, chỉ hợp nhất sau kiểm parity. process-events là thao tác vận hành. Có device/retry chưa chứng minh provider push/email thật.

**Nhánh thay thế/lỗi cần nghiệm thu:** Recipient ngoài scope; send/retry lặp; đọc notification người khác; target không còn quyền; inbox tồn tại khi provider lỗi.

**Chặng: Soạn và gửi thông báo chủ động**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `POST /api/v1/announcements` | Tạo thông báo chủ động/announcement ở bước soạn trước khi gửi. | [Create](../../src/backend/BHome.Api/Controllers/Notifications/NotificationWorkspaceController.cs#L12) | Authenticated |
| `POST /api/v1/announcements/{id:guid}/send` | Gửi announcement tới người nhận hợp lệ theo cơ chế lưu inbox/chống trùng. | [Send](../../src/backend/BHome.Api/Controllers/Notifications/NotificationWorkspaceController.cs#L14) | Authenticated |
| `POST /api/v1/announcements/preview-recipients` | Xem trước nhóm người nhận theo tiêu chí và phạm vi server kiểm tra. | [Preview](../../src/backend/BHome.Api/Controllers/Notifications/NotificationWorkspaceController.cs#L10) | Authenticated |
| `GET /api/v1/announcements/sent` | Liệt kê lịch sử các announcement đã gửi trong phạm vi được phép. | [Sent](../../src/backend/BHome.Api/Controllers/Notifications/NotificationWorkspaceController.cs#L16) | Authenticated |

**Chặng: Cấu hình nhắc theo Location**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `GET /api/v1/locations/{id:guid}/notification-policy` | Đọc chính sách nhắc/kênh thông báo của cơ sở. | [Policy](../../src/backend/BHome.Api/Controllers/Notifications/NotificationWorkspaceController.cs#L26) | Authenticated |
| `PUT /api/v1/locations/{id:guid}/notification-policy` | Owner lưu chính sách nhắc/kênh thông báo của cơ sở; không tự phê duyệt cadence ngoài dữ liệu được cấu hình. | [Policy](../../src/backend/BHome.Api/Controllers/Notifications/NotificationWorkspaceController.cs#L28) | Authenticated |

**Chặng: Thiết bị và khả năng gửi theo kênh**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `GET /api/v1/notifications/channel-status` | Đọc khả năng/trạng thái sẵn sàng của các kênh thông báo. | [ChannelOverview](../../src/backend/BHome.Api/Controllers/Notifications/NotificationWorkspaceController.cs#L24) | Authenticated |
| `POST /api/v1/notifications/devices` | Đăng ký thiết bị nhận push cho chính tài khoản đang đăng nhập. | [Register](../../src/backend/BHome.Api/Controllers/Notifications/NotificationWorkspaceController.cs#L18) | Authenticated |
| `DELETE /api/v1/notifications/devices/{id:guid}` | Gỡ thiết bị push của chính tài khoản đang đăng nhập. | [Remove](../../src/backend/BHome.Api/Controllers/Notifications/NotificationWorkspaceController.cs#L20) | Authenticated |

**Chặng: Xuất bản event và giám sát delivery**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `GET /api/v1/notifications/delivery-status` | Owner tra cứu tổng quan/trạng thái delivery theo bộ lọc để giám sát gửi và retry. | [List](../../src/backend/BHome.Api/Controllers/Notifications/NotificationDeliveryController.cs#L9) | locations.manage |
| `POST /api/v1/notifications/process-events` | Chủ động xử lý/xuất bản các event thành thông báo theo quyền và cơ chế chống trùng hiện có. | [Publish](../../src/backend/BHome.Api/Controllers/Notifications/NotificationAutomationController.cs#L8) | locations.manage |
| `GET /api/v1/notifications/{id:guid}/deliveries` | Đọc trạng thái gửi theo kênh của một thông báo được phép xem. | [Deliveries](../../src/backend/BHome.Api/Controllers/Notifications/NotificationWorkspaceController.cs#L22) | Authenticated |

**Chặng: Inbox, trạng thái đọc và điều hướng**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `GET /api/v1/notifications` | Lấy danh sách thông báo của người đang đăng nhập trong phạm vi được phép; áp dụng bộ lọc/phân trang của API. | [List](../../src/backend/BHome.Api/Controllers/Notifications/NotificationsController.cs#L11) | notifications.read-own |
| `GET /api/v1/notifications/{id:guid}` | Lấy thông tin chi tiết thông báo của người đang đăng nhập trong phạm vi được phép. | [Get](../../src/backend/BHome.Api/Controllers/Notifications/NotificationsController.cs#L13) | notifications.read-own |
| `PATCH /api/v1/notifications/{id:guid}/read` | Đánh dấu một thông báo của người hiện tại đã đọc; PATCH và POST là hai alias cùng action. | [Read](../../src/backend/BHome.Api/Controllers/Notifications/NotificationsController.cs#L14) | notifications.read-own |
| `POST /api/v1/notifications/{id:guid}/read` | Đánh dấu một thông báo của người hiện tại đã đọc; PATCH và POST là hai alias cùng action. | [Read](../../src/backend/BHome.Api/Controllers/Notifications/NotificationsController.cs#L15) | notifications.read-own |
| `GET /api/v1/notifications/{id:guid}/target` | Kiểm tra lại quyền với đối tượng đích và trả dữ liệu điều hướng từ thông báo. | [Target](../../src/backend/BHome.Api/Controllers/Notifications/NotificationsController.cs#L17) | notifications.read-own |
| `POST /api/v1/notifications/read-all` | Đánh dấu toàn bộ thông báo phù hợp của người hiện tại đã đọc. | [ReadAll](../../src/backend/BHome.Api/Controllers/Notifications/NotificationsController.cs#L16) | notifications.read-own |
| `GET /api/v1/notifications/unread-count` | Đếm số thông báo chưa đọc của người hiện tại. | [Unread](../../src/backend/BHome.Api/Controllers/Notifications/NotificationsController.cs#L12) | notifications.read-own |

<a id="flow-17"></a>

### 3.17. Incident, Emergency và Work Order

**Nguồn nghiệp vụ:** BF-07; UC-26..30; GBR-11/12.  
**Số API:** 36.

**Luồng chính:** Submit/evidence → review/reject/duplicate → assign Work Order → proposal → Owner plan-decision → start/progress/blocker → submit → verify/rework → resolve. Emergency acknowledge/actions/cost-decision; Owner direct-completion là nhánh khác.

**Mức bao phủ và giới hạn:** Có action vòng đời, history/reassign/expense/maintenance-history. Resolve và direct-completion có payload/service khác. Emergency không thay formal review/approval. Chưa chứng minh mọi transition và permission đã pass.

**Nhánh thay thế/lỗi cần nghiệm thu:** Sai Location; Staff duyệt chi phí; start chưa duyệt; rework; resolve khi Work Order chưa verified; evidence quá giới hạn.

**Các nhánh sự cố:** Normal đi qua review và phân công Work Order; Emergency có acknowledge/emergency-actions để ghi đáp ứng ban đầu rồi vẫn qua review chính thức. Work Order đi qua proposal → plan-decision → start/progress → submit → verify, có blocker/rework/reassign/cancel. Owner có direct-completion khi đáp ứng điều kiện riêng; reject/duplicate không phải sửa chữa thành công.

**Chặng: Thông báo sự cố**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `GET /api/v1/incidents/notifications` | Đọc danh sách thông báo riêng của module sự cố. | [Notifications](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/IncidentReportsController.cs#L104) | incidents.view |
| `POST /api/v1/incidents/notifications/{id:guid}/read` | Đánh dấu thông báo sự cố của người hiện tại đã đọc. | [Read](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/IncidentReportsController.cs#L106) | incidents.view |

**Chặng: Đáp ứng Emergency**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `POST /api/v1/incidents/{id:guid}/acknowledge` | Ghi nhận người có quyền đã tiếp nhận ứng phó sự cố Emergency. | [Acknowledge](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/IncidentReportsController.cs#L77) | incidents.view + incidents.respond |
| `GET /api/v1/incidents/{id:guid}/emergency-actions` | Đọc các hành động xử lý Emergency đã ghi nhận. | [EmergencyActions](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/IncidentReportsController.cs#L81) | incidents.view + work-orders.view |
| `POST /api/v1/incidents/{id:guid}/emergency-actions` | Ghi thêm hành động xử lý ban đầu/kiềm chế khẩn cấp vào lịch sử sự cố. | [EmergencyAction](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/IncidentReportsController.cs#L79) | incidents.view |
| `POST /api/v1/incidents/{id:guid}/emergency-actions/{entryId:guid}/cost-decision` | Owner quyết định khoản chi của một hành động Emergency theo dữ liệu được phép. | [EmergencyCost](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/IncidentReportsController.cs#L83) | incidents.view + incidents.manage |

**Chặng: Ảnh và chi phí sự cố**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `GET /api/v1/incidents/{id:guid}/evidence` | Liệt kê ảnh bằng chứng sự cố được phép xem theo role và loại ảnh. | [Evidence](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/IncidentReportsController.cs#L87) | incidents.view |
| `PUT /api/v1/incidents/{id:guid}/evidence` | Tải thêm ảnh bằng chứng sự cố, có thể gắn Work Order/loại bằng chứng phù hợp. | [Upload](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/IncidentReportsController.cs#L89) | incidents.view |
| `GET /api/v1/incidents/{id:guid}/evidence/{imageId:guid}` | Tải một ảnh bằng chứng sự cố sau kiểm quyền. | [Download](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/IncidentReportsController.cs#L92) | incidents.view |
| `GET /api/v1/incidents/{id:guid}/expenses` | Đọc các chi phí liên quan sự cố theo quyền tài chính. | [Expenses](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/IncidentReportsController.cs#L85) | incidents.view + incidents.manage |

**Chặng: Thực hiện và nghiệm thu Work Order**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `GET /api/v1/work-orders/{id:guid}` | Lấy thông tin chi tiết phiếu sửa chữa/bảo trì trong phạm vi được phép. | [Get](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/WorkOrdersController.cs#L16) | work-orders.view |
| `POST /api/v1/work-orders/{id:guid}/blocker` | Ghi vướng mắc làm gián đoạn thực hiện Work Order. | [Blocker](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/WorkOrdersController.cs#L30) | work-orders.view + work-orders.execute |
| `POST /api/v1/work-orders/{id:guid}/cancel` | Owner hủy Work Order khi trạng thái cho phép. | [Cancel](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/WorkOrdersController.cs#L38) | work-orders.view + incidents.manage |
| `POST /api/v1/work-orders/{id:guid}/plan-decision` | Owner duyệt/từ chối phương án và chi phí đề xuất. | [Plan](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/WorkOrdersController.cs#L24) | work-orders.view + work-orders.approve-plan |
| `POST /api/v1/work-orders/{id:guid}/progress` | Ghi tiến độ thực hiện sửa chữa/bảo trì. | [Progress](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/WorkOrdersController.cs#L28) | work-orders.view + work-orders.execute |
| `POST /api/v1/work-orders/{id:guid}/proposal` | Staff gửi kết quả khảo sát, phương án, thời gian và chi phí dự kiến để Owner duyệt. | [Propose](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/WorkOrdersController.cs#L22) | work-orders.view + work-orders.execute |
| `POST /api/v1/work-orders/{id:guid}/reassign` | Owner giao lại Work Order cho Staff hợp lệ tại Location. | [Reassign](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/WorkOrdersController.cs#L20) | work-orders.view + incidents.manage |
| `POST /api/v1/work-orders/{id:guid}/rework` | Owner yêu cầu làm lại Work Order chưa đạt yêu cầu. | [Rework](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/WorkOrdersController.cs#L36) | work-orders.view + work-orders.verify |
| `POST /api/v1/work-orders/{id:guid}/start` | Staff bắt đầu sửa chữa khi phương án và trạng thái cho phép. | [Start](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/WorkOrdersController.cs#L26) | work-orders.view + work-orders.execute |
| `POST /api/v1/work-orders/{id:guid}/submit` | Nộp kết quả sửa chữa để Owner xác minh. | [Submit](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/WorkOrdersController.cs#L32) | work-orders.view + work-orders.execute |
| `POST /api/v1/work-orders/{id:guid}/verify` | Owner nghiệm thu kết quả, ghi nhận thông tin bảo trì/chi phí theo workflow. | [Verify](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/WorkOrdersController.cs#L34) | work-orders.view + work-orders.verify |
| `GET /api/v1/work-orders/maintenance-history` | Tra cứu lịch sử sửa chữa/bảo trì theo bộ lọc và quyền. | [Maintenance](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/WorkOrdersController.cs#L18) | work-orders.view |

**Chặng: Giao Work Order**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `POST /api/v1/incidents/{id:guid}/work-orders` | Tạo/giao Work Order xử lý cho sự cố và Staff đủ điều kiện. | [Assign](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/IncidentReportsController.cs#L71) | incidents.view + incidents.manage |

**Chặng: Tiếp nhận, phân loại và xử lý sự cố**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `GET /api/v1/incidents` | Lấy danh sách báo cáo sự cố trong phạm vi được phép; áp dụng bộ lọc/phân trang của API. | [List](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/IncidentReportsController.cs#L51) | incidents.view |
| `POST /api/v1/incidents` | Tạo báo cáo sự cố Normal/Emergency với nội dung và ảnh theo phạm vi người báo. | [Submit](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/IncidentReportsController.cs#L29) | incidents.view + incidents.report |
| `GET /api/v1/incidents/{id:guid}` | Lấy thông tin chi tiết báo cáo sự cố trong phạm vi được phép. | [Get](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/IncidentReportsController.cs#L57) | incidents.view |
| `POST /api/v1/incidents/{id:guid}/cancel` | Hủy báo cáo sự cố khi quyền và trạng thái cho phép. | [Cancel](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/IncidentReportsController.cs#L67) | incidents.view |
| `POST /api/v1/incidents/{id:guid}/direct-completion` | Owner ghi nhận hoàn tất trực tiếp theo nhánh riêng, gồm dữ liệu/bằng chứng được yêu cầu. | [Direct](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/IncidentReportsController.cs#L75) | incidents.view + incidents.manage |
| `POST /api/v1/incidents/{id:guid}/duplicate` | Đánh dấu sự cố trùng với báo cáo khác theo điều kiện API. | [Duplicate](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/IncidentReportsController.cs#L65) | incidents.view + incidents.manage |
| `GET /api/v1/incidents/{id:guid}/history` | Đọc lịch sử hoạt động và quyết định xử lý sự cố. | [History](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/IncidentReportsController.cs#L59) | incidents.view |
| `POST /api/v1/incidents/{id:guid}/reject` | Owner từ chối báo cáo sự cố với lý do phù hợp. | [Reject](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/IncidentReportsController.cs#L63) | incidents.view + incidents.manage |
| `POST /api/v1/incidents/{id:guid}/resolve` | Đóng sự cố khi các điều kiện giải quyết được thỏa mãn; không thay bước verify Work Order. | [Resolve](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/IncidentReportsController.cs#L69) | incidents.view + incidents.manage |
| `POST /api/v1/incidents/{id:guid}/review` | Owner xem xét/phân loại sự cố để tiếp tục xử lý. | [Review](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/IncidentReportsController.cs#L61) | incidents.view + incidents.manage |
| `GET /api/v1/incidents/reporting-assets` | Lấy các tài sản hợp lệ mà người gọi được phép chọn khi báo sự cố. | [ReportingAssets](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/IncidentReportsController.cs#L55) | incidents.view + incidents.report |
| `GET /api/v1/incidents/reporting-rooms` | Lấy các phòng hợp lệ mà người gọi được phép chọn khi báo sự cố. | [ReportingRooms](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/IncidentReportsController.cs#L53) | incidents.view + incidents.report |
| `GET /api/v1/work-orders` | Lấy danh sách phiếu sửa chữa/bảo trì trong phạm vi được phép; áp dụng bộ lọc/phân trang của API. | [List](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/WorkOrdersController.cs#L14) | work-orders.view |

<a id="flow-18"></a>

### 3.18. Nội dung công khai và xuất bản

**Nguồn nghiệp vụ:** UC-37; GBR-17.  
**Số API:** 18.

**Luồng chính:** Owner sửa nội dung/ảnh → publish/unpublish Location/Room → Guest đọc danh sách/chi tiết/ảnh đã công bố.

**Mức bao phủ và giới hạn:** Có 12 admin và 6 anonymous GET routes. Không thấy Guest POST enquiry/reservation/payment. Admin publish và Guest read khác ranh giới quyền, cần giữ.

**Nhánh thay thế/lỗi cần nghiệm thu:** Guest đọc Draft/unpublished; ảnh của nội dung bị gỡ; dữ liệu nhạy cảm; không có Guest booking/payment/contact submission.

**Chặng: Owner chuẩn bị và công bố nội dung**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `GET /api/v1/public-content/locations/{id:guid}` | Đọc nội dung giới thiệu cơ sở trong giao diện quản trị. | [Location](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs#L72) | Authenticated |
| `PUT /api/v1/public-content/locations/{id:guid}` | Cập nhật nội dung giới thiệu cơ sở trước/sau công bố theo quyền Owner. | [UpdateLocation](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs#L73) | Authenticated |
| `PUT /api/v1/public-content/locations/{id:guid}/photos` | Tải ảnh dùng cho nội dung công khai của cơ sở. | [LocationPhoto](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs#L76) | Authenticated |
| `DELETE /api/v1/public-content/locations/{id:guid}/photos/{index:int}` | Xóa ảnh cơ sở tại vị trí được chỉ định khỏi nội dung công khai. | [RemoveLocationPhoto](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs#L78) | Authenticated |
| `POST /api/v1/public-content/locations/{id:guid}/publish` | Công bố cơ sở cho Guest khi đủ điều kiện. | [PublishLocation](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs#L74) | Authenticated |
| `POST /api/v1/public-content/locations/{id:guid}/unpublish` | Gỡ công bố cơ sở khỏi phạm vi nội dung Guest được đọc. | [UnpublishLocation](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs#L75) | Authenticated |
| `GET /api/v1/public-content/rooms/{id:guid}` | Đọc nội dung giới thiệu phòng trong giao diện quản trị. | [Room](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs#L82) | Authenticated |
| `PUT /api/v1/public-content/rooms/{id:guid}` | Cập nhật nội dung giới thiệu phòng theo quyền Owner. | [UpdateRoom](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs#L83) | Authenticated |
| `PUT /api/v1/public-content/rooms/{id:guid}/photos` | Tải ảnh dùng cho nội dung công khai của phòng. | [RoomPhoto](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs#L86) | Authenticated |
| `DELETE /api/v1/public-content/rooms/{id:guid}/photos/{index:int}` | Xóa ảnh phòng tại vị trí được chỉ định khỏi nội dung công khai. | [RemoveRoomPhoto](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs#L88) | Authenticated |
| `POST /api/v1/public-content/rooms/{id:guid}/publish` | Công bố phòng cho Guest khi đủ điều kiện. | [PublishRoom](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs#L84) | Authenticated |
| `POST /api/v1/public-content/rooms/{id:guid}/unpublish` | Gỡ công bố phòng khỏi phạm vi nội dung Guest được đọc. | [UnpublishRoom](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs#L85) | Authenticated |

**Chặng: Guest đọc nội dung đã công bố**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `GET /api/v1/public/locations` | Guest đọc danh sách cơ sở đã được công bố. | [Locations](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs#L97) | Anonymous |
| `GET /api/v1/public/locations/{id:guid}` | Guest đọc chi tiết một cơ sở đã công bố. | [Location](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs#L98) | Anonymous |
| `GET /api/v1/public/locations/{id:guid}/photos/{index:int}` | Trả ảnh công khai của cơ sở sau kiểm tra trạng thái công bố. | [LocationPhoto](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs#L101) | Anonymous |
| `GET /api/v1/public/locations/{id:guid}/rooms` | Guest đọc danh sách phòng đã công bố tại cơ sở được phép công khai. | [Rooms](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs#L99) | Anonymous |
| `GET /api/v1/public/rooms/{id:guid}` | Guest đọc chi tiết phòng được phép công khai. | [Room](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs#L100) | Anonymous |
| `GET /api/v1/public/rooms/{id:guid}/photos/{index:int}` | Trả ảnh công khai của phòng sau kiểm tra trạng thái công bố. | [RoomPhoto](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs#L102) | Anonymous |

<a id="flow-19"></a>

### 3.19. Chẩn đoán và hỗ trợ phát triển

**Nguồn nghiệp vụ:** NFR; công cụ phát triển.  
**Số API:** 4.

**Luồng chính:** OCR diagnostics/profile/experimental; tải CA cho thiết bị local.

**Mức bao phủ và giới hạn:** 3 OCR diagnostic routes có gate Development + MobileDevelopment.Enabled; mobile CA có gate riêng. Hai health endpoint nằm ngoài 372 controller routes. Không tính các route này thành tính năng nghiệp vụ.

**Nhánh thay thế/lỗi cần nghiệm thu:** Production tắt diagnostics/CA; experimental không ghi proposal/reading; kiểm config và quyền.

**Chặng: Chẩn đoán OCR**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `GET /api/v1/ocr/diagnostics` | Kiểm tra OCR diagnostics có được bật trong môi trường phát triển hay không. | [Availability](../../src/backend/BHome.Api/Controllers/Ocr/OcrDiagnosticsController.cs#L20) | Owner,Staff |
| `POST /api/v1/ocr/diagnostics/{profile}` | Chạy thử OCR theo profile được chọn và trả kết quả/thời gian; không lưu chỉ số nghiệp vụ. | [Extract](../../src/backend/BHome.Api/Controllers/Ocr/OcrDiagnosticsController.cs#L44) | Owner,Staff |
| `POST /api/v1/ocr/diagnostics/auto` | Chạy thử nhận dạng tự động/experimental có kiểm cấu hình; không lưu proposal hoặc reading chính thức. | [Automatic](../../src/backend/BHome.Api/Controllers/Ocr/OcrDiagnosticsController.cs#L23) | Owner,Staff |

**Chặng: CA cho thiết bị local**

| API | API làm gì? | Source | Quyền khai báo |
| --- | --- | --- | --- |
| `GET /development/mobile-ca.cer` | Tải chứng chỉ CA phục vụ thiết bị mobile local khi môi trường/cấu hình cho phép. | [Certificate](../../src/backend/BHome.Api/Controllers/MobileDevelopmentController.cs#L10) | Anonymous |

## 4. Các chuỗi demo đề xuất để chứng minh mức bao phủ

| Kịch bản | Chuỗi API trọng tâm | Kết quả cần quan sát |
| --- | --- | --- |
| Setup và phân quyền | locations → rooms → billing-policies → staff/invitation → staff-location-assignments → readiness | Phòng có cấu hình đúng; Staff chỉ thấy Location được gán |
| Tiếp nhận và bắt đầu thuê | capture/residents → OCR → identity confirm → main-drafts → release → contract signing/deposit → activate → handover | Không kích hoạt khi thiếu ký/tiền; có biên bản và chỉ số đầu kỳ |
| Billing và thu tiền | meter task → OCR/evidence → confirm → invoices/drafts → finalize → payment-transactions → allocate → debts/history | Chỉ số có người xác nhận; Final bất biến; tiền và dư nợ không nhân đôi khi retry |
| Sự cố và bảo trì | incidents → work-orders → proposal → plan-decision → start → submit → verify → resolve | Staff không tự duyệt; lịch sử và evidence được giữ |
| Kết thúc thuê | termination/expiry → approve/schedule → inspection/review → settlement → deduction/refund → complete | Không giải phóng phòng khi nghĩa vụ bắt buộc còn chưa hoàn tất |
| Tenant và thông tin công khai | residence status/evidence → Owner confirmation; public-content → publish → public GET | Tenant chỉ thấy dữ liệu riêng; Guest chỉ thấy thông tin đã công bố |

Đây là kế hoạch demo/nghiệm thu, không phải tuyên bố các demo đã chạy trong ngày báo cáo. Chỉ dùng dữ liệu tổng hợp.

## 5. API chồng lấn và ảnh hưởng đến báo cáo

| Nhóm | Nhận định |
| --- | --- |
| GET /session và GET /auth/me | /session là probe cũ, ứng viên deprecate sau kiểm consumer |
| desired-assets và asset-inventory | Hai URL cùng action Inventory, không tính hai tính năng độc lập |
| PATCH/POST notifications/{id}/read | Hai method cùng action, alias tương thích |
| POST capture/locations, rooms, assignments | Chồng API quản trị; đang có client sử dụng nên chưa xóa ngay |
| POST capture/staff và POST staff | Hai đường tạo khác metadata, nên hợp nhất use case và kiểm invariant |
| Task/Incident inbox và inbox chung | Chồng lấn kiến trúc; khác DTO/quyền/consumer, cần parity trước hợp nhất |
| operating-policies/{id}/versions | Hiện trả danh sách nội quy theo Location, cần làm rõ ngữ nghĩa lịch sử riêng policy |
| billing-schedules/automation; debts/payment-invoices | Khác trách nhiệm hoặc filter/quyền, không kết luận thừa |

Không xóa hoặc sửa endpoint trong lượt lập báo cáo.

## 6. Kiểm chứng, giới hạn và việc tiếp theo

**Thực hiện ngày 09/11/2026:**

- Chạy lại helper MVC descriptor: **372 routes, 12 anonymous, 0 duplicate**.
- Đối chiếu descriptor với source inventory trước đó: **372/372 khớp**.
- Kiểm tra tài liệu: mỗi method–route xuất hiện đúng một lần trong danh mục chi tiết; đủ 19 phần; link source tồn tại.
- Không chạy lại unit/integration/E2E trong lượt tạo báo cáo này. Lượt audit trước đã chạy 42 focused unit tests đạt, nhưng không dùng kết quả đó thay full regression hiện tại.

**Các điểm chưa đủ bằng chứng để báo cáo hoàn tất:** bank webhook/đối soát provider tự động; MySign thật và nghiệm thu tài liệu ký; email/push provider thật; toàn bộ luồng native/browser; đầy đủ nhánh quyền, race, retry và rollback. Riêng Tenant xem confirmed readings trước Draft và điều phối mọi loại việc khi thay Staff cần kiểm xuyên DTO/service/client.

**Ưu tiên tiếp theo:** chốt acceptance cho từng chuỗi tại mục 4; chạy normal/alternative/error trên cùng commit và môi trường; đính kèm TRX/log/Postman; cập nhật trạng thái theo kết quả thực tế. Giữ sự phân biệt giữa API đã triển khai, tích hợp provider và nghiệm thu nghiệp vụ.

## 7. Tài liệu đối chiếu

- [Audit API và các điểm chồng lấn](../development/BE_API_AUDIT_2026-11-08.md).
- [Inventory 372 API dạng CSV](../api/BE_API_INVENTORY_2026-11-08.csv).
- [Quy ước API](../api/API_CONVENTIONS.md).
- [Quy tắc dự án](../../AGENTS.md).

Các link action trong từng bảng dẫn trực tiếp tới controller để tra DTO và service call. Tài liệu là snapshot ngày báo cáo; cần kiểm lại khi code/API thay đổi.
