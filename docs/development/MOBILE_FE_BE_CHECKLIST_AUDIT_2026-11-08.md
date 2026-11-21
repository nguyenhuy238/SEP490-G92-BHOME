# Kiểm tra kết nối FE–BE Mobile — Owner / Staff / Tenant

Ngày: 08/11/2026, Asia/Bangkok. Repository: `C:/FPT/Test/SEP490-G92-BHOME`.

## Phạm vi và cách đọc

Đối chiếu 29 mục trong checklist người dùng với **working tree hiện tại, gồm cả thay đổi chưa commit**. Đọc màn chạy thật, adapter/client, route/controller và các service liên quan. Không lấy giao diện preview, fixture hoặc tài liệu cũ làm bằng chứng đã nối API. Không sửa code ứng dụng, không gọi nghiệp vụ ghi dữ liệu lên BE.

- **ĐÃ NỐI**: có luồng UI chạy thật → lời gọi API → endpoint BE tương ứng. Chưa đồng nghĩa đã nghiệm thu trên thiết bị và database thật.
- **MỘT PHẦN**: đã nối những bước được nêu nhưng chưa bao phủ toàn bộ nội dung mục checklist.
- **LỆCH API**: FE gọi route/payload không còn phù hợp BE hiện tại.
- **CHƯA NỐI**: chưa tìm thấy luồng mobile chạy thật gọi API nghiệp vụ đó; có thể BE đã triển khai.

Các link source dưới đây tương đối với thư mục chứa báo cáo. Router chạy thật: [WorkspaceScreenView.tsx](../../src/mobile/src/features/workspace/WorkspaceScreenView.tsx). Khi `preview === false`, nhiều màn preview được thay bằng component live; không đánh giá bằng tên component preview.

## Chức năng chung — 5 mục

### G01 — ĐÃ NỐI: Đăng nhập và phân quyền Owner / Staff / Tenant

- FE: [sessions.ts](../../src/mobile/src/lib/sessions.ts), [navigation.ts](../../src/mobile/src/features/workspace/navigation.ts), [WorkspaceScreenView.tsx](../../src/mobile/src/features/workspace/WorkspaceScreenView.tsx).
- Gọi `POST /api/v1/auth/login`; role lấy từ session BE. `sessionRole`, `screenRoles`, `canOpenScreen` giới hạn màn hình.
- BE: [AuthController.cs](../../src/backend/BHome.Api/Controllers/IdentityAccess/AuthController.cs), [RolePermissions.cs](../../src/backend/BHome.Domain/IdentityAccess/RolePermissions.cs).
- Các nút chọn vai trò trong preview không phải phân quyền production. Quyền UI không thay thế kiểm tra BE.

### G02 — ĐÃ NỐI: Refresh token, đăng xuất, đổi mật khẩu

- FE: [sessions.ts](../../src/mobile/src/lib/sessions.ts), [api.ts](../../src/mobile/src/lib/api.ts), [credentialStore.ts](../../src/mobile/src/lib/credentialStore.ts), [AccountSecurityScreen.tsx](../../src/mobile/src/screens/AccountSecurityScreen.tsx).
- `POST /auth/refresh`, `/auth/logout`, `/auth/change-password` dưới `/api/v1`; request gặp 401 có cơ chế refresh/thử lại, refresh được tuần tự hóa; native dùng SecureStore.
- Đổi mật khẩu thành công dẫn đến đăng xuất; logout dọn credential trong `finally`.
- BE: [AuthController.cs](../../src/backend/BHome.Api/Controllers/IdentityAccess/AuthController.cs).

### G03 — ĐÃ NỐI, có giới hạn: Thông báo, badge chưa đọc, điều hướng

- FE: [NotificationsScreen.tsx](../../src/mobile/src/screens/NotificationsScreen.tsx), [notificationInbox.ts](../../src/mobile/src/services/notificationInbox.ts), [NotificationBadge.tsx](../../src/mobile/src/components/NotificationBadge.tsx), thư mục `features/notifications`.
- `GET /notifications`, `/notifications/unread-count`, `/notifications/{id}/target`; `POST /notifications/{id}/read`, `/notifications/read-all` dưới `/api/v1`. Có phân trang, lọc, đọc tất cả, cập nhật badge.
- BE: [NotificationsController.cs](../../src/backend/BHome.Api/Controllers/Notifications/NotificationsController.cs).
- Điều hướng hiện được ánh xạ cho Invoice/Adjustment của Tenant, Contract của Owner/Tenant, MeterTask của Staff, OperationalTask của Owner/Staff. Loại đích khác trả `null`; chưa thể khẳng định mọi loại thông báo đều mở được chi tiết trên mobile. Incident inbox còn là luồng riêng.
- Đây là thông báo trong app; không đánh dấu production push notification là đã hoàn tất.

### G04 — MỘT PHẦN: Hiển thị lỗi API, mất mạng, dữ liệu rỗng

- Hạ tầng đã có: [api.ts](../../src/mobile/src/lib/api.ts), [WorkspaceQueryState.tsx](../../src/mobile/src/components/WorkspaceQueryState.tsx), [useWorkspaceQuery.ts](../../src/mobile/src/features/workspace/useWorkspaceQuery.ts), [useCachedWorkspaceQuery.ts](../../src/mobile/src/features/workspace/useCachedWorkspaceQuery.ts).
- Có timeout, lỗi mạng, phân biệt 401/403/404/409, retry/refresh và trạng thái loading/empty/error ở các màn được rà soát như notification, profile, invoice, task, schedule, incident.
- Chưa nghiệm thu toàn bộ tổ hợp lỗi trên từng màn Android/iOS; không suy ra có offline mode hoặc mọi màn đã xử lý đầy đủ. Có thể tick riêng phần hạ tầng, giữ phần kiểm thử toàn app chưa xong.

### G05 — ĐÃ NỐI: Hồ sơ cá nhân `/account/profile`

- FE: [ProfileScreen.tsx](../../src/mobile/src/screens/ProfileScreen.tsx), [ProfileEditScreen.tsx](../../src/mobile/src/screens/ProfileEditScreen.tsx), [accountProfile.ts](../../src/mobile/src/services/accountProfile.ts).
- `GET/PUT /api/v1/account/profile`, gửi rõ fullName/phone/email/version, không gửi role/isActive để tự đổi quyền. Có validation, xử lý xung đột version và thay đổi thông tin liên hệ.
- BE: `AccountProfileController` trong [OperationsControllers.cs](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs).

## Owner Mobile — 8 mục

### O01 — ĐÃ NỐI: Tổng quan cơ sở, phòng, hợp đồng

- FE: [OwnerOverviewScreen.tsx](../../src/mobile/src/screens/OwnerOverviewScreen.tsx), [ownerOverview.ts](../../src/mobile/src/services/ownerOverview.ts).
- Đọc `totalCount` từ `GET /locations`, `/rooms`, `/rooms?roomStatus=2`, `/contracts` dưới `/api/v1`; không đếm từ danh sách bị cắt trang.
- BE: [LocationsController.cs](../../src/backend/BHome.Api/Controllers/LocationsController.cs), [PropertyControllers.cs](../../src/backend/BHome.Api/Controllers/PropertyManagement/PropertyControllers.cs), [ContractsController.cs](../../src/backend/BHome.Api/Controllers/ContractsController.cs).
- Đây là các chỉ số tổng quan hiện có, không phải dashboard tài chính đầy đủ.

### O02 — LỆCH API: Thiết lập cơ sở/phòng

- FE: [setup.tsx](../../src/mobile/src/app/setup.tsx).
- Dòng 50 và 62 vẫn gọi `GET /api/v1/capture/chains`. Request nằm trong `Promise.all`, nên lỗi route này làm cả lượt load đầu không cập nhật locations/staff.
- Dòng 87 gọi `/api/v1/room-types`; dòng 139–141 đọc/ghi `/api/v1/chain`. Cả ba nhóm route đã bỏ ở BE hiện tại.
- Tạo cơ sở còn phụ thuộc lựa chọn `chain`, gửi `chainId` dù `LocationInput` chỉ có Name/Address. Dù extra field có thể được bỏ qua tại một adapter, điều kiện chọn chain vẫn chặn luồng bình thường.
- Tạo phòng gửi `roomTypeId` (dòng 227); `RoomInput` không có trường này và khai báo `JsonUnmappedMemberHandling.Disallow`, nên payload hiện tại không tương thích, theo code sẽ bị từ chối 400 khi gửi đến endpoint.
- BE: [CaptureController.cs](../../src/backend/BHome.Api/Controllers/Ocr/CaptureController.cs), [CaptureContracts.cs](../../src/backend/BHome.Application/Ocr/CaptureContracts.cs), [CaptureService.cs](../../src/backend/BHome.Application/Ocr/CaptureService.cs).
- Căn cứ bổ sung: [LOCATION_ROOM_API.md](../api/LOCATION_ROOM_API.md), [Compact24PropertyShapeTests.cs](../../tests/backend/BHome.IntegrationTests/Compact24/Compact24PropertyShapeTests.cs) có test kỳ vọng 404 với `chain`, `room-types`, `capture/chains`. Test BE này chỉ được đọc trong lần audit, chưa chạy.
- API phù hợp để chỉnh lại FE: `/api/v1/locations`, `/api/v1/rooms`; Location là cấp cao nhất, Room không phụ thuộc RoomType. Chưa sửa trong đợt kiểm tra này.

### O03 — ĐÃ NỐI: Phê duyệt công việc

- Màn live `approvals` → `OperationalTasksScreen approvals`, mặc định lọc chờ xác minh; chi tiết dùng `OperationalTaskDetail`.
- FE: [OperationalTaskScreens.tsx](../../src/mobile/src/screens/OperationalTaskScreens.tsx), [operationalTasks.ts](../../src/mobile/src/services/operationalTasks.ts).
- API `/api/v1/operational-tasks`: list/detail/history/evidence và `POST /{id}/verify`, `/{id}/rework`; cũng có tạo/sửa/điều phối/hủy theo trạng thái.
- BE: [OperationalTasksController.cs](../../src/backend/BHome.Api/Controllers/StaffOperations/OperationalTasksController.cs), quyền verify chỉ Owner.
- Không phải inbox phê duyệt gộp mọi nghiệp vụ tài chính.

### O04 — ĐÃ NỐI: Duyệt sự cố, phương án bảo trì

- FE: [IncidentScreens.tsx](../../src/mobile/src/features/incidents/IncidentScreens.tsx), [IncidentActions.tsx](../../src/mobile/src/features/incidents/IncidentActions.tsx), [incidents.ts](../../src/mobile/src/services/incidents.ts).
- `/api/v1/incidents/{id}/review`, `/{id}/work-orders`; `/api/v1/work-orders/{id}/plan-decision`, `/verify`, `/rework` và các thao tác hợp lệ khác.
- BE: [IncidentReportsController.cs](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/IncidentReportsController.cs), [WorkOrdersController.cs](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/WorkOrdersController.cs).
- OperationalTask và WorkOrder bảo trì là hai loại nghiệp vụ riêng, không đánh đồng chỉ vì tên tab có chữ công việc.

### O05 — ĐÃ NỐI: Tạo hợp đồng, ký, cọc, kích hoạt

- FE: [ContractScreen.tsx](../../src/mobile/src/features/contracts/ContractScreen.tsx), [ContractDraftForm.tsx](../../src/mobile/src/features/contracts/ContractDraftForm.tsx), [ContractActionForm.tsx](../../src/mobile/src/features/contracts/ContractActionForm.tsx), [contracts.ts](../../packages/client-core/src/contracts.ts).
- `POST /api/v1/contracts`; thao tác `/signing`, `/signing/sync`, `/deposit-verifications`, `/activate`; đọc `/activation-readiness` và các dữ liệu hỗ trợ.
- BE: [ContractsController.cs](../../src/backend/BHome.Api/Controllers/ContractsController.cs).
- Luồng ký thật phụ thuộc cấu hình nhà cung cấp/chứng thư/mẫu hợp đồng. Development demo có mô phỏng ký được gắn nhãn riêng. Có lời gọi API không chứng minh MySign đã chạy thành công ở môi trường đang dùng.
- Đã ký hoặc có số cọc yêu cầu không đồng nghĩa Active; BE vẫn kiểm tra điều kiện kích hoạt.

### O06 — MỘT PHẦN / cần tách nghĩa: Nghiệm thu bàn giao/trả phòng

- Đã nối đọc biên bản bàn giao, duyệt kiểm tra trả phòng, yêu cầu kiểm tra lại, xem xét quyết toán và hoàn tất theo điều kiện.
- FE: [ContractHandoverPanel.tsx](../../src/mobile/src/features/contracts/ContractHandoverPanel.tsx), [ContractLifecyclePanel.tsx](../../src/mobile/src/features/contracts/ContractLifecyclePanel.tsx), `contractActions` trong [contracts.ts](../../packages/client-core/src/contracts.ts).
- BE: [ContractsController.cs](../../src/backend/BHome.Api/Controllers/ContractsController.cs): `/move-out/inspection-review`, `/move-out/settlement`, `/move-out/complete` và GET `/handover`.
- **Bàn giao vào ở hiện là Staff lập/xác nhận + Tenant xác nhận hoặc phản đối**, không có thao tác Owner xác nhận bàn giao vào ở tương đương. Không nên tạo checklist yêu cầu Owner bấm thay Staff/Tenant.
- Phần trả phòng đã có kết nối; luồng đầy đủ có thể còn bị chặn bởi khấu trừ/hoàn cọc chưa có UI mobile (O07).

### O07 — CHƯA NỐI thao tác mobile: Khấu trừ và hoàn cọc

- BE đã có [DepositDeductionsController.cs](../../src/backend/BHome.Api/Controllers/DepositDeductionsController.cs), [RefundsController.cs](../../src/backend/BHome.Api/Controllers/RefundsController.cs): `POST /contracts/{id}/deposit-deductions`, `GET/POST /contracts/{id}/deposit-refunds`, `/refund-requests/{id}/decision`, `/execution`, bằng chứng hoàn tiền.
- Shared client đã có `approveDepositDeductions` trong [contracts.ts](../../packages/client-core/src/contracts.ts) và [refunds.ts](../../packages/client-core/src/refunds.ts).
- Chưa tìm thấy mobile gọi các thao tác trên. `ContractLifecyclePanel` chỉ hiển thị số BE trả như depositAllocated/depositRefunded/depositReserved, blockers và quyết định xem xét quyết toán.
- **Có số liệu hoàn/khấu trừ trên màn hình không đồng nghĩa có thao tác duyệt hoặc thực hiện hoàn cọc từ mobile.**

### O08 — CHƯA NỐI: Owner xác nhận kết quả tạm trú

- BE có `POST /api/v1/residence-tasks/{contractId}/{residentId}/owner-confirmation` trong [OperationsControllers.cs](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs), kiểm tra role Owner trong [OperationsService.cs](../../src/backend/BHome.Application/Operations/OperationsService.cs).
- Chưa tìm thấy mobile gọi `/residence-tasks`. Route workspace `residence` chỉ dành Tenant trong [navigation.ts](../../src/mobile/src/features/workspace/navigation.ts).
- Cần thêm đường vào/list/detail và thao tác Owner dùng API đang có nếu đưa nghiệp vụ này lên mobile.

## Staff Mobile — 7 mục

### S01 — ĐÃ NỐI: Danh sách/chi tiết công việc được giao

- FE: [OperationalTaskScreens.tsx](../../src/mobile/src/screens/OperationalTaskScreens.tsx), [operationalTasks.ts](../../src/mobile/src/services/operationalTasks.ts).
- `GET /api/v1/operational-tasks`, `/{id}`, `/{id}/history`, `/{id}/evidence`; màn live `work-orders` và `task-detail` trỏ tới các component này.
- BE: [OperationalTasksController.cs](../../src/backend/BHome.Api/Controllers/StaffOperations/OperationalTasksController.cs); dữ liệu theo scope server.

### S02 — ĐÃ NỐI: Nhận/bắt đầu việc, tiến độ, gửi hoàn thành

- Cùng FE/BE với S01. Staff đúng người phụ trách có `start`; khi InProgress có `progress`, `blockers`, `submit`. Có tải ảnh bằng chứng, gửi version và Idempotency-Key.
- `submit` đưa kết quả sang chờ Owner xác minh; Staff không tự nghiệm thu cuối cùng. Trong API hiện tại thao tác bắt đầu là `/start`, không có bước nhận việc riêng tên `/accept`.

### S03 — ĐÃ NỐI: Phòng, cư dân và OCR CCCD

- FE: `RoomOverview` trong [StaffWorkflowScreens.tsx](../../src/mobile/src/screens/StaffWorkflowScreens.tsx), [captureService.ts](../../src/mobile/src/services/captureService.ts), [OnboardingScreen.tsx](../../src/mobile/src/screens/OnboardingScreen.tsx), [IdentityWizard.tsx](../../src/mobile/src/features/onboarding/IdentityWizard.tsx).
- `GET /capture/locations`, `/capture/locations/{id}/rooms`, `/residents`; `POST /capture/residents`, `/ocr/identity/{residentId}/{front|back}`, `/capture/residents/{id}/confirm` dưới `/api/v1`.
- BE: [CaptureController.cs](../../src/backend/BHome.Api/Controllers/Ocr/CaptureController.cs), [OcrController.cs](../../src/backend/BHome.Api/Controllers/Ocr/OcrController.cs). OCR trả đề xuất; Staff sửa/đối chiếu rồi xác nhận.
- Danh sách không cần tải số CCCD. Lookup room trong `CaptureRepository.RoomsAsync` hiện giới hạn 100 phần tử, chưa nên hiểu là danh sách không giới hạn quy mô.

### S04 — ĐÃ NỐI: Chụp điện và nước riêng

- FE: [LiveWorkspaceScreens.tsx](../../src/mobile/src/screens/LiveWorkspaceScreens.tsx), [roomMeterTasks.ts](../../src/mobile/src/features/workspace/roomMeterTasks.ts), [meter.tsx](../../src/mobile/src/app/meter.tsx).
- List/detail theo `taskId`, mỗi task có meter/utility type riêng; có thể nhóm hai task trong một phòng nhưng không xác nhận chung hai loại.
- BE: `/api/v1/capture/meter-tasks`, `/{id}` trong [CaptureController.cs](../../src/backend/BHome.Api/Controllers/Ocr/CaptureController.cs).

### S05 — ĐÃ NỐI: OCR và xác nhận chỉ số điện nước

- FE: [meter.tsx](../../src/mobile/src/app/meter.tsx), [meterService.ts](../../src/mobile/src/services/meterService.ts).
- `POST /api/v1/ocr/meter-tasks/{id}`, `PUT /api/v1/capture/meter-tasks/{id}/evidence`, `POST /api/v1/capture/meter-tasks/{id}/confirm` với humanConfirmed/confirmedValue/evidenceId.
- BE: [OcrController.cs](../../src/backend/BHome.Api/Controllers/Ocr/OcrController.cs), [CaptureController.cs](../../src/backend/BHome.Api/Controllers/Ocr/CaptureController.cs), [CaptureService.cs](../../src/backend/BHome.Application/Ocr/CaptureService.cs).
- Có sửa số đề xuất và đọc lại kết quả máy chủ; không tự lấy OCR làm chỉ số cuối.

### S06 — ĐÃ NỐI: Tiếp nhận/xử lý sự cố và Work Order

- FE: [StaffIncidentScreens.tsx](../../src/mobile/src/screens/StaffIncidentScreens.tsx), [IncidentScreens.tsx](../../src/mobile/src/features/incidents/IncidentScreens.tsx), [IncidentActions.tsx](../../src/mobile/src/features/incidents/IncidentActions.tsx), [incidents.ts](../../src/mobile/src/services/incidents.ts).
- Danh sách/chi tiết sự cố và bảo trì; khẩn cấp có `acknowledge`/`emergency-actions`; WorkOrder có `proposal`, `start`, `progress`, `blocker`, `submit` theo người được giao và trạng thái. Có upload bằng chứng.
- BE: [IncidentReportsController.cs](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/IncidentReportsController.cs), [WorkOrdersController.cs](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/WorkOrdersController.cs).
- Staff gửi kết quả, Owner duyệt phương án/chi phí và nghiệm thu; không phải Staff tự quyết định hoàn thành cuối.

### S07 — CHƯA NỐI dữ liệu ca: Lịch làm việc

- FE: [StaffScheduleScreen.tsx](../../src/mobile/src/screens/StaffScheduleScreen.tsx).
- Chỉ gọi `GET /api/v1/capture/locations` để biết cơ sở được giao; luôn hiện khối “Chưa có dữ liệu lịch làm việc”. Chưa có lời gọi lấy lịch ca trên màn này.
- Có đường dẫn sang công việc được giao. Không đánh dấu đã triển khai lịch ca thật chỉ vì có trang lịch và bộ chọn cơ sở.

## Tenant Mobile — 9 mục

### T01 — ĐÃ NỐI: Phòng của tôi, hợp đồng hiện hành

- FE: [TenantRoomScreen.tsx](../../src/mobile/src/screens/TenantRoomScreen.tsx), [useTenantTenancy.ts](../../src/mobile/src/features/tenant/useTenantTenancy.ts), [tenantRoom.ts](../../src/mobile/src/services/tenantRoom.ts).
- `GET /api/v1/contracts?status=Active`, `/{id}`, `/{id}/handover`; chọn tenancy và hiển thị thông tin hợp đồng/người ở/bàn giao.
- BE: [ContractsController.cs](../../src/backend/BHome.Api/Controllers/ContractsController.cs).

### T02 — ĐÃ NỐI: Xem/ký hợp đồng, xác nhận bàn giao

- FE: [ContractScreen.tsx](../../src/mobile/src/features/contracts/ContractScreen.tsx), [ContractActionForm.tsx](../../src/mobile/src/features/contracts/ContractActionForm.tsx), [ContractHandoverPanel.tsx](../../src/mobile/src/features/contracts/ContractHandoverPanel.tsx).
- API xem chi tiết/PDF, `/signing`, `/signing/sync`, `/handover`, `/handover/tenant-confirmation`, `/handover/disputes` dưới hợp đồng.
- BE: [ContractsController.cs](../../src/backend/BHome.Api/Controllers/ContractsController.cs). Ký thật vẫn phụ thuộc cấu hình nhà cung cấp như O05; Tenant không sửa chỉ số gốc của Staff.

### T03 — ĐÃ NỐI: Hóa đơn và chi tiết điện nước

- FE: [TenantInvoicesScreen.tsx](../../src/mobile/src/screens/TenantInvoicesScreen.tsx), [TenantInvoiceCharges.tsx](../../src/mobile/src/screens/TenantInvoiceCharges.tsx), [tenantInvoices.ts](../../src/mobile/src/services/tenantInvoices.ts).
- `GET /api/v1/invoices`, `/{id}`; các line hóa đơn gồm chỉ số/usage/đơn giá theo dữ liệu BE.
- BE: [InvoicesController.cs](../../src/backend/BHome.Api/Controllers/Billing/InvoicesController.cs).

### T04 — ĐÃ NỐI: QR và đọc trạng thái thanh toán

- FE: [TenantPaymentPanel.tsx](../../src/mobile/src/screens/TenantPaymentPanel.tsx), [paymentPresentation.ts](../../src/mobile/src/features/tenant/paymentPresentation.ts).
- `GET /api/v1/invoices/{id}/payment`, `/{id}/transfer-instructions`; render QR khi response có qrImageDataUri, sao chép thông tin, refresh theo focus và polling khoảng 30 giây.
- BE: [PaymentTransactionsController.cs](../../src/backend/BHome.Api/Controllers/PaymentsDebt/PaymentTransactionsController.cs), `TransferInstructionsController` trong [ReceivingAccountsController.cs](../../src/backend/BHome.Api/Controllers/PaymentsDebt/ReceivingAccountsController.cs).
- **Đây là đọc trạng thái BE, không phải Tenant bấm xác nhận “đã thanh toán”.** BE chỉ trả Paid theo số tiền đã ghi nhận; chuyển khoản/quét QR không tự thành Paid. Chưa kiểm chứng luồng ngân hàng/đối soát thật trong audit này.
- QR còn phụ thuộc tài khoản nhận hợp lệ và dữ liệu BE; không hứa hóa đơn nào cũng có QR.

### T05 — ĐÃ NỐI: Lịch sử thanh toán, công nợ

- FE: [TenantPaymentHistoryScreen.tsx](../../src/mobile/src/screens/TenantPaymentHistoryScreen.tsx), [tenantPaymentHistory.ts](../../src/mobile/src/services/tenantPaymentHistory.ts).
- `GET /api/v1/payment-history`, `/api/v1/debts`, có lọc/phân trang và mở hóa đơn liên quan.
- BE: [DebtsController.cs](../../src/backend/BHome.Api/Controllers/PaymentsDebt/DebtsController.cs).

### T06 — ĐÃ NỐI: Gửi yêu cầu điều chỉnh hóa đơn

- FE: [TenantAdjustmentPanel.tsx](../../src/mobile/src/screens/TenantAdjustmentPanel.tsx), [adjustments.ts](../../packages/client-core/src/adjustments.ts).
- `POST /api/v1/invoices/{id}/adjustment-requests`, `PUT /api/v1/invoices/{id}/adjustment-evidence`; đọc danh sách/chi tiết tại `/invoice-adjustments`, hiệu lực đã duyệt tại `/invoices/{id}/adjustments`.
- Có khoản phí, lý do, đề xuất số tiền, ảnh, invoice version, Idempotency-Key và trạng thái chờ Owner.
- BE: [InvoiceAdjustmentsController.cs](../../src/backend/BHome.Api/Controllers/Billing/InvoiceAdjustmentsController.cs). Đề xuất không tự sửa số phải trả; thao tác duyệt không thuộc Tenant.

### T07 — ĐÃ NỐI: Báo sự cố, theo dõi xử lý, hình ảnh

- FE: [TenantServiceScreens.tsx](../../src/mobile/src/screens/TenantServiceScreens.tsx), [IncidentReportForm.tsx](../../src/mobile/src/features/incidents/IncidentReportForm.tsx), [TenantIncidentReportForm.tsx](../../src/mobile/src/features/incidents/TenantIncidentReportForm.tsx), [IncidentScreens.tsx](../../src/mobile/src/features/incidents/IncidentScreens.tsx).
- `POST /api/v1/incidents` dạng multipart, list/detail, history và ảnh private tại `/incidents/{id}/evidence/{imageId}` theo scope.
- BE: [IncidentReportsController.cs](../../src/backend/BHome.Api/Controllers/IncidentMaintenance/IncidentReportsController.cs).
- “Yêu cầu của tôi” hiện là danh sách sự cố; không suy ra đã gộp hợp đồng, điều chỉnh và tạm trú vào một feed.

### T08 — CHƯA NỐI: Tạm trú `/residence-tasks`

- FE live `residence` dùng `TenantResidenceScreen` trong [TenantServiceScreens.tsx](../../src/mobile/src/screens/TenantServiceScreens.tsx). Nó chỉ tải tenancy qua hợp đồng; reference/result là `useState`, evidence dùng `TenantEvidenceDraft`, chưa gửi/lưu nghiệp vụ tạm trú.
- UI ghi “Máy chủ chưa cung cấp…” nhưng **BE hiện đã có API**, vì vậy mô tả đó không còn phản ánh đúng tình trạng BE; khoảng trống nằm ở kết nối mobile.
- BE: [OperationsControllers.cs](../../src/backend/BHome.Api/Controllers/Operations/OperationsControllers.cs), [OperationsService.cs](../../src/backend/BHome.Application/Operations/OperationsService.cs): GET `/residence-tasks`, GET/PUT `/{contractId}/{residentId}`, PUT/GET `/evidence`; Owner có `/owner-confirmation`.
- Tenant cập nhật kết quả/bằng chứng trong BHOME; thủ tục chính thức vẫn thực hiện bên ngoài qua VNeID. Không cần và không có căn cứ thêm nộp trực tiếp lên chính phủ.

### T09 — ĐÃ NỐI: Hiển thị/cập nhật hồ sơ cá nhân

- Dùng chung G05, không phải một adapter độc lập: [ProfileScreen.tsx](../../src/mobile/src/screens/ProfileScreen.tsx), [ProfileEditScreen.tsx](../../src/mobile/src/screens/ProfileEditScreen.tsx), [accountProfile.ts](../../src/mobile/src/services/accountProfile.ts).
- `GET/PUT /api/v1/account/profile`; BE lấy người dùng hiện tại. Không nên kết luận chưa nối chỉ vì còn file TenantProfile cũ/preview trong repository.

## Ưu tiên công việc tiếp theo

1. Sửa setup Owner theo API Location/Room hiện tại; bỏ dependency `/chain`, `/capture/chains`, `/room-types` và payload `roomTypeId`.
2. Nối `/residence-tasks` cho Tenant cập nhật/bằng chứng và Owner xác nhận. Sửa thông báo “máy chủ chưa cung cấp” cho đúng trạng thái thực tế.
3. Bổ sung UI thao tác khấu trừ/hoàn cọc Owner nếu cần làm trọn luồng trả phòng trên mobile; tái sử dụng shared clients/BE đang có.
4. Quyết định phạm vi lịch Staff: giữ màn chưa có dữ liệu hay triển khai luồng lịch có nguồn BE; chưa tick hoàn thành lịch ca.
5. Nghiệm thu các phần đã nối bằng tài khoản ba role trên môi trường thật, đặc biệt scope Location, ký thật, đối soát tiền, quyền truy cập ảnh, stale version và mất mạng giữa lúc gửi.

## Kiểm chứng đã chạy trong lần audit

- `npm run typecheck --workspace ./src/mobile` — **PASS**, exit 0.
- `npm run lint --workspace ./src/mobile` — **PASS**, exit 0.
- `npm run test --workspace ./src/mobile -- --reporter=dot` — **FAIL toàn bộ suite**: 65 file đạt, 1 file lỗi; 795 test đạt, 12 test lỗi, tổng 807 test.
- 12 lỗi đều ở `tests/mobile/ocr/expoStartup.test.ts`: test kỳ vọng nhánh gọi PowerShell supervisor/Expo trực tiếp hoặc reject tham số, nhưng nhánh thực tế được gọi là re-exec bằng Node 22 ở `.tools`. Đây là kết quả kiểm thử launcher, không phải bằng chứng 12 nghiệp vụ FE–BE thất bại. Chưa sửa launcher/test vì nằm ngoài yêu cầu kiểm tra nối chức năng.
- Các test FE/mock pass không chứng minh route BE còn tồn tại: `setup-api.test.tsx` vẫn mock `/capture/chains`, trong khi controller hiện tại không có route đó. Vì vậy setup vẫn bị đánh dấu **LỆCH API** dù test UI tương ứng đạt.
- Không chạy test BE/database, không đăng nhập role thật trên thiết bị, không thực hiện ký/đối soát/hoàn tiền thật. Không kết luận tất cả nghiệp vụ đã chạy end-to-end.

File ứng dụng được sửa trong audit: **không có**. Chỉ thêm báo cáo này.
