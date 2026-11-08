# Mobile ↔ Backend: tích hợp API ngày 04/11/2026

## Phạm vi và cách đọc

Đối chiếu source tại merge `cbb3f09` cùng các thay đổi Mobile chưa commit hiện có trong workspace. Đây là kiểm tra tĩnh code và điều hướng, không phải kết quả gọi API live, kiểm thử thiết bị hay nghiệm thu ST/AT. Không thay đổi database và không chạy các request ghi dữ liệu.

Có **12 nhóm nghiệp vụ có lời gọi API thực tế** bên dưới, với danh mục **112 cặp HTTP method + route** thuộc phạm vi màn hình/client được kiểm kê. Cả 112 cặp đã đối chiếu khớp khai báo controller BE bằng script kiểm tra tĩnh. Có endpoint hỗ trợ được khai báo trong client (như đọc confirmed reading), không suy ra toàn bộ endpoint đã được người dùng thao tác thành công trên Mobile. Con số nhóm này không phải tổng số feature SRS hay số nhóm hoàn thành nghiệm thu. Một nhóm có thể chỉ hoàn tất phạm vi hẹp, ví dụ Tenant đọc hóa đơn, chưa bao gồm Owner phát hành hóa đơn trên Mobile.

Báo cáo Mobile ngày 02/11 còn ghi billing/payment/adjustment là pending/chưa xác nhận; source workspace hiện tại đã có adapter và màn hình gọi các API này. Không dùng báo cáo cũ để kết luận chúng chưa nối.

## Mobile nối BE như thế nào?

Luồng đọc: màn hình → `useWorkspaceQuery` hoặc shared hook/client → `MobileApi.request` → HTTPS `/api/v1/...` → controller/service → Compact24 PostgreSQL.

Luồng ghi: form/action → service hoặc shared client → POST/PUT cùng JSON hoặc binary ảnh → BE kiểm tra role, Location/đối tượng, version/trạng thái → UI tải lại dữ liệu đã lưu.

- URL lấy qua `SessionProvider`/`resolveApiEndpoint`, gồm `EXPO_PUBLIC_API_BASE_URL` và URL development. Tài liệu này không xác nhận URL local đang chạy.
- `MobileSessions` gọi login/refresh/logout; `MobileApi` gắn `Authorization: Bearer ...`, thử refresh khi 401 và xóa phiên nếu vẫn thất bại.
- Native lưu refresh credential bằng Expo SecureStore; bản web chỉ giữ credential trong bộ nhớ của provider.
- Mutation quan trọng dùng `Idempotency-Key` và/hoặc version theo từng hợp đồng API. Không tự retry mutation khi mất phản hồi mạng mơ hồ.
- Có trạng thái loading/error/empty, phân trang, hủy request khi đổi màn hình/phiên. BE vẫn là nơi quyết định quyền và kết quả nghiệp vụ.
- Chế độ preview dùng fixture; phải vào chế độ đăng nhập thật để kiểm chứng tích hợp. Tên màn hình preview không chứng minh API tương ứng đã nối.

## Danh mục API theo 12 nhóm

Mọi đường dẫn dưới đây có tiền tố `/api/v1`. `{id}`, `{locationId}`, `{fileId}`… là tham số. GET có thể kèm page/pageSize/status/locationId và filter phù hợp. Không đếm lại một endpoint vì khác query hoặc vì tải blob/bytes. Danh mục tập trung vào màn hình Mobile và client chúng sử dụng; các helper dùng chung chưa có điểm gọi Mobile rõ ràng không được mặc nhiên tính là UI đã nối.

### 1. Đăng nhập, phiên và bảo mật

Đã nối login/refresh/logout, xác minh phiên và đổi mật khẩu. Không tính forgot/reset password hoặc logout-all chỉ vì BE có endpoint.

```text
POST /auth/login
POST /auth/refresh
POST /auth/logout
GET  /auth/me
POST /auth/change-password
```

Nguồn: `src/mobile/src/lib/sessions.ts`, `SessionProvider.tsx`, `credentialStore.ts`, `screens/AccountSecurityScreen.tsx`, `screens/TenantProfileScreen.tsx`.

### 2. Công việc vận hành Owner/Staff

Đã nối danh sách, chi tiết, lịch sử, ảnh, tạo/sửa, thao tác theo quyền và thông báo công việc. Đây là Operational Task; không thay thế Incident/Work Order bảo trì đầy đủ.

```text
GET  /operational-tasks
POST /operational-tasks
GET  /operational-tasks/{id}
PUT  /operational-tasks/{id}
GET  /operational-tasks/{id}/history
GET  /operational-tasks/{id}/evidence
PUT  /operational-tasks/{id}/evidence
GET  /operational-tasks/{id}/evidence/{evidenceId}
POST /operational-tasks/{id}/assign
POST /operational-tasks/{id}/start
POST /operational-tasks/{id}/progress
POST /operational-tasks/{id}/blockers
POST /operational-tasks/{id}/coordinate
POST /operational-tasks/{id}/submit
POST /operational-tasks/{id}/verify
POST /operational-tasks/{id}/rework
POST /operational-tasks/{id}/cancel
GET  /operational-tasks/notifications
POST /operational-tasks/notifications/{id}/read
```

Nguồn: `src/mobile/src/services/operationalTasks.ts`, `screens/OperationalTaskScreens.tsx`, `screens/LiveWorkspaceScreens.tsx`.

### 3. Onboarding, Resident và OCR định danh

Đã nối chọn cơ sở/phòng/người ở, tạo Resident, OCR hai mặt và xác nhận. Chưa coi là hoàn tất cấp tài khoản Tenant hay cập nhật toàn bộ thông tin liên hệ/cư trú.

```text
GET  /capture/locations
GET  /capture/locations/{id}/rooms
GET  /capture/locations/{id}/residents
POST /capture/residents
POST /ocr/identity/{residentId}/{side}
POST /capture/residents/{id}/confirm
```

`side` theo contract OCR; không lưu ảnh CCCD vào tài liệu mẫu. Nguồn: `services/captureService.ts`, `features/onboarding/IdentityWizard.tsx`, `app/resident.tsx`.

### 4. Tác vụ ghi số điện/nước, ảnh và OCR

Đã nối lấy task, upload ảnh, OCR và Staff xác nhận số. Chưa kiểm chứng camera, upload, độ chính xác OCR trên thiết bị thật trong lượt này. Helper đọc confirmed reading có trong meter client; không suy ra mọi màn hình đều sử dụng nó. Tenant hiện xem lịch sử qua snapshot hóa đơn, không gọi capture API của Staff.

```text
GET  /capture/meter-tasks
GET  /capture/meter-tasks/{id}
GET  /capture/readings/{id}
PUT  /capture/meter-tasks/{id}/evidence
POST /ocr/meter-tasks/{taskId}
POST /capture/meter-tasks/{id}/confirm
```

Nguồn: `services/meterService.ts`, `screens/MeterTasksScreen.tsx`, `app/meter.tsx`, `packages/client-core/src/meter.ts`.

### 5. Main Tenancy Draft và tài liệu DOCX/PDF

Đã nối preparation, tạo/cập nhật/mở lại nháp, tạo và tải tài liệu, xem trang PDF. Nháp không tự ký, tự tạo tài khoản, tự chuyển cọc hay kích hoạt phòng. Xuất PDF và preview phụ thuộc converter/renderer của BE.

```text
GET  /contracts/main-drafts/preparation
POST /contracts/main-drafts
GET  /contracts/main-drafts/{id}
PUT  /contracts/main-drafts/{id}
POST /contracts/main-drafts/{id}/documents
GET  /contracts/main-drafts/{id}/documents/{fileId}
GET  /contracts/main-drafts/{id}/documents/{fileId}/preview
GET  /contracts/main-drafts/{id}/documents/{fileId}/pages/{page}
```

Nguồn: `features/contracts/MainDraftScreen.tsx`, `ContractPdfPreview.tsx`, `packages/client-core/src/mainDrafts.ts`.

### 6. Hợp đồng, preview, ký và kích hoạt

Đã nối danh sách/chi tiết, preparation, tài liệu, trạng thái ký, kiểm tra cọc và điều kiện kích hoạt; thao tác tùy role và trạng thái hợp đồng. MySign thật và trust/provider configuration chưa thể coi nghiệm thu; Simulated chỉ dùng Development. Holding ledger còn blocker.

```text
GET  /contracts
POST /contracts
GET  /contracts/configuration
GET  /contracts/preparation
GET  /contracts/preparation/accounts
GET  /contracts/{id}
GET  /contracts/{id}/history
GET  /contracts/{id}/versions
GET  /contracts/{id}/previews
POST /contracts/{id}/previews
GET  /contracts/{id}/previews/{fileId}
GET  /contracts/{id}/document
GET  /contracts/{id}/activation-readiness
GET  /contracts/{id}/deposit-verifications
POST /contracts/{id}/deposit-verifications
POST /contracts/{id}/signing
POST /contracts/{id}/signing/sync
POST /contracts/{id}/signing/recover
POST /contracts/{id}/activate
GET  /digital-signing/certificates
```

Nguồn: `features/contracts/ContractScreen.tsx`, `ContractDraftForm.tsx`, `ContractWorkflowPanel.tsx`, `ContractActionForm.tsx`, `packages/client-core/src/contracts.ts`, `useContractDetail.ts`, `useContractPreparation.ts`.

### 7. Bàn giao nhận phòng

Đã nối biên bản, lịch sử, lựa chọn tài sản/chỉ số, ảnh, Tenant xác nhận/tranh chấp và Staff xác nhận cùng version. Cần replay trên BE/storage và thiết bị thật để nghiệm thu.

```text
GET  /contracts/{id}/handover
GET  /contracts/{id}/handover/history
GET  /contracts/{id}/handover/choices
POST /contracts/{id}/handover
POST /contracts/{id}/handover/tenant-confirmation
POST /contracts/{id}/handover/disputes
POST /contracts/{id}/handover/staff-confirmation
POST /contracts/{id}/handover/evidence
GET  /contracts/{id}/handover/evidence/{fileId}
GET  /contracts/{id}/handover/meter-evidence/{readingId}
```

Nguồn: `features/contracts/ContractHandoverPanel.tsx`, `ContractEvidence.tsx`, `packages/client-core/src/useContractHandover.ts`.

### 8. Gia hạn, hết hạn và trả phòng

Đã có gọi API nhắc hết hạn, gia hạn, yêu cầu trả phòng, kiểm tra hiện trạng và quyết toán. Chưa hoàn tất toàn bộ khấu trừ/hoàn cọc/credit, shared liability; BE có thể giữ Pending/blocker. Không hiểu việc đã nối nút gọi API là đã giải quyết mọi chính sách tài chính.

```text
GET  /contracts/expiry-reminders
GET  /contracts/move-out-assignments
POST /contracts/{id}/renewals
POST /contracts/{id}/renewal-cancellation
POST /contracts/{id}/termination-requests
POST /contracts/{id}/expiry-move-out
GET  /contracts/{id}/move-out
GET  /contracts/{id}/move-out/history
POST /contracts/{id}/move-out/approve
POST /contracts/{id}/move-out/schedule
GET  /contracts/{id}/move-out/inspection-preparation
GET  /contracts/{id}/move-out/inspections
POST /contracts/{id}/move-out/inspection
POST /contracts/{id}/move-out/inspection-review
POST /contracts/{id}/move-out/evidence
GET  /contracts/{id}/move-out/evidence/{evidenceId}
GET  /contracts/{id}/move-out/settlement-summary
GET  /contracts/{id}/move-out/settlement-history
POST /contracts/{id}/move-out/settlement
POST /contracts/{id}/move-out/complete
```

Nguồn: `features/contracts/ContractExpiryPanel.tsx`, `ContractLifecyclePanel.tsx`, `ContractActionForm.tsx`, `ContractScreen.tsx`, `features/workspace/useStaffDashboard.ts`, `packages/client-core/src/useContractLifecycle.ts`.

### 9. Hóa đơn Tenant

Đã nối danh sách, chi tiết, dòng thu/phí và phân trang. Lịch sử điện nước Tenant hiện lấy từ snapshot dòng hóa đơn, chưa phải lịch sử meter độc lập đầy đủ. Không tính API Owner tạo/finalize hóa đơn là đã có màn Mobile chỉ vì shared client/BE hỗ trợ.

```text
GET  /invoices
GET  /invoices/{id}
```

Nguồn: `screens/TenantInvoicesScreen.tsx`, `TenantMeterHistoryScreen.tsx`, `TenantDashboardScreen.tsx`.

### 10. Thanh toán, QR, lịch sử và công nợ Tenant

Đã nối đọc trạng thái server, hướng dẫn/QR, danh sách dư nợ và lịch sử xác minh. Màn thanh toán tải lại khi focus và mỗi 30 giây khi đang focus. Đây là truy vấn trạng thái; Mobile không tự xác nhận Paid hoặc tự lấy giao dịch ngân hàng. API Owner đối soát không được tính vào màn Tenant.

```text
GET  /payment-invoices
GET  /invoices/{id}/payment
GET  /invoices/{id}/transfer-instructions
GET  /payment-history
GET  /debts
```

Nguồn: `screens/TenantPaymentPanel.tsx`, `TenantInvoicesScreen.tsx`, `TenantDashboardScreen.tsx`.

### 11. Yêu cầu điều chỉnh hóa đơn Tenant

Đã nối xem yêu cầu, upload ảnh, gửi yêu cầu, đọc evidence và các adjustment hiệu lực. Approve/reject là quyền Owner ở BE; chưa tính màn Owner Mobile duyệt điều chỉnh vào phạm vi đã nối này.

```text
GET  /invoice-adjustments
GET  /invoice-adjustments/{id}
POST /invoices/{invoiceId}/adjustment-requests
PUT  /invoices/{invoiceId}/adjustment-evidence
GET  /invoice-adjustments/{id}/evidence/{evidenceId}
GET  /invoices/{invoiceId}/adjustments
```

Nguồn: `screens/TenantAdjustmentPanel.tsx`, `packages/client-core/src/adjustments.ts`.

### 12. Thông báo trong ứng dụng

Đã nối inbox, phân trang/lọc, số chưa đọc, đọc một/tất cả và lấy target có kiểm tra quyền. Có dùng cho Tenant, không chỉ Owner/Staff. Push/email thật và lưu notification preferences chưa được tính là hoàn tất.

```text
GET  /notifications
GET  /notifications/unread-count
POST /notifications/{id}/read
POST /notifications/read-all
GET  /notifications/{id}/target
```

Nguồn: `screens/NotificationsScreen.tsx`, `components/NotificationBadge.tsx`, `packages/client-core/src/notifications.ts`.

## API hỗ trợ overview/setup, không phải nhóm nghiệp vụ hoàn chỉnh bổ sung

- Owner overview dùng `GET /locations`, `GET /rooms`, `GET /contracts` để đếm; không phải báo cáo tài chính thật.
- Capture setup có GET chains/staff/meters và POST locations/rooms/staff/assignments/meters qua `app/setup.tsx`; đây không chứng minh toàn bộ UI quản trị/ca làm đã hoàn tất.
- API OCR diagnostics và health phục vụ kiểm tra môi trường, không tính là nghiệp vụ hoàn thành.

## Những phần vẫn chưa nối đầy đủ

- Incident/Emergency/Maintenance: form nháp/không khả dụng; không có workflow gửi và theo dõi đầy đủ. Không dùng Operational Task để báo đã xong BF-07.
- Tạm trú: chưa có workflow lưu/gửi đầy đủ; đăng ký chính thức ngoài BHOME qua VNeID.
- Lịch ca Staff, quản trị tài sản/bảo trì đầy đủ, Staff invoice workflow: chưa có tích hợp đầy đủ tại các route tương ứng.
- Chỉnh sửa hồ sơ liên hệ và lưu notification preferences: thiếu API/adapter đúng nghiệp vụ.
- Báo cáo tài chính, OPEX/investment và What-if thật: chưa đủ nguồn/API Mobile.
- Ký provider thật, bank auto-reconciliation, push/email, Holding ledger, hoàn/khấu trừ cọc còn giới hạn BE hoặc tích hợp ngoài.

## Có tài liệu API mẫu không?

Có. Các tài liệu hiện hữu cần đọc cùng source vì một số ghi chú lịch sử đã cũ, ví dụ `INVOICES.md` còn nói chưa có JOB-10 trong khi automation đã được bổ sung.

- `docs/testing/postman/BHome.NguyenQuocHuy.Implemented.postman_collection.json`: collection toàn BE, guide ghi 245 request/15 nhóm; không phải 245 API Mobile đã hoàn thành.
- `docs/testing/postman/BHome.NguyenQuocHuy.Implemented.Local.postman_environment.json`: biến môi trường; credential/token trong file chia sẻ để trống.
- `docs/testing/postman/NGUYEN_QUOC_HUY_POSTMAN_GUIDE.md`: import, account theo role, ID và cách chạy.
- `docs/api/API_CONVENTIONS.md`: quy ước chung.
- `docs/api/OPERATIONAL_TASKS.md`, `PROPERTY_MANAGEMENT.md`.
- `docs/api/INVOICES.md`, `PAYMENTS.md`, `INVOICE_ADJUSTMENTS.md`.
- `docs/api/CONTRACT_LIFECYCLE.md`, `NOTIFICATIONS.md`, `BILLING_AUTOMATION.md`.
- Swagger UI được bật trong Development tại `/swagger`; với HTTPS mặc định của guide là `https://localhost:7240/swagger`. Chưa xác nhận host này đang chạy.

## Ví dụ request từ contract đang dùng

Login (không dùng credential thật trong tài liệu):

```http
POST {{baseUrl}}/api/v1/auth/login
Content-Type: application/json

{"email":"{{tenantEmail}}","password":"{{tenantPassword}}","device":"mobile"}
```

Đọc hóa đơn:

```http
GET {{baseUrl}}/api/v1/invoices?page=1&pageSize=20
Authorization: Bearer {{accessToken}}
```

Staff xác nhận meter sau khi đã upload ảnh và nhận `evidenceId`:

```http
POST {{baseUrl}}/api/v1/capture/meter-tasks/{{taskId}}/confirm
Authorization: Bearer {{staffAccessToken}}
Content-Type: application/json

{"humanConfirmed":true,"confirmedValue":"1525","evidenceId":"{{evidenceId}}"}
```

Số tiền/số đo dùng decimal string theo DTO; response và lỗi tham khảo Postman, controller cùng shared TypeScript types. `baseUrl` ở ví dụ này không có dấu `/` cuối; collection có quy tắc ghép URL riêng theo guide.

## Kiểm chứng và kết luận

### Bổ sung sau khi tạo dữ liệu test local

Theo yêu cầu tiếp theo, đã tạo fixture và kiểm chứng kết nối live bằng ba role; xem [MOBILE_LOCAL_TEST_DATA.md](MOBILE_LOCAL_TEST_DATA.md) để lấy tài khoản, cách chạy FE và phạm vi kiểm thử. Các ghi chú "chưa chạy" bên dưới mô tả thời điểm kiểm kê ban đầu, không thay thế kết quả bổ sung này. Đã có 27 HTTPS smoke checks đạt trên mỗi địa chỉ localhost/LAN, cùng thử source thật MobileSessions/MobileApi cho ba role. Chưa có UI/device E2E và không suy rộng thành 112 endpoint đều đã thử live.

Đã đọc routing Mobile, transport/session, service/shared client, các controller liên quan và tài liệu mẫu. Chưa chạy build/lint/typecheck, test, API live, PostgreSQL/MinIO hay thiết bị trong lượt kiểm kê này; không có thay đổi code ứng dụng cần xác nhận build. Danh mục endpoint được đối chiếu với khai báo route BE, không chứng minh request thành công khi runtime.

Kết luận báo cáo được: **12 nhóm có tích hợp API trong source, nhiều nhóm có phạm vi một phần; chưa có số nhóm hoàn tất nghiệm thu có thể chốt từ kiểm tra tĩnh này.**
