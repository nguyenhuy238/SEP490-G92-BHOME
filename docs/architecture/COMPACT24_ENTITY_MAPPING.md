# Compact24 — mô hình Entity sát database

## Mục tiêu và phạm vi hiện tại

Database giữ nguyên schema vật lý Compact24 đã duyệt. BHome.Api là project runtime nghiệp vụ duy nhất. Service và EF dùng chung entity chuẩn; repository chỉ khôi phục phần metadata không nằm ở cột vật lý từ snapshot có kiểu.

- `Entities/<module>/`: đúng 24 file entity cho 24 bảng vật lý. Mỗi bảng có một kiểu CLR chuẩn; bảng dùng chung giữ discriminator và các trường nullable vật lý. Identity tiếp tục dùng User và RefreshToken. ContractResident có khóa ghép contract_id, resident_id.
- `Data/Compact24/Compact24DbContext.cs` + `Compact24NativeModel.cs`: một DbContext runtime có đúng 24 mapping bảng vật lý và 85 quan hệ FK, không có `ToSqlQuery`. Repository dùng context scoped hiện có, đọc bằng EF/native SQL và ghi qua EF có guard hoặc câu lệnh SQL chuyên biệt trong transaction. Mô hình vật lý bị loại khỏi migration scaffolding vì DDL/migration SQL đã phát hành là nguồn chính. `Compact24NativeWrites.cs` giới hạn những thao tác được phép qua change tracker; các repository chuyên biệt giữ kiểm soát khóa, version, append-only history và audit. Không có generic projection writer trong runtime.
- `Enums/`, `Models/`, `Common/`, `Services/`: trạng thái nghiệp vụ, snapshot JSONB có kiểu, sự kiện, bản ghi lịch sử/audit, quyền dùng chung và công thức/quy tắc thuần. Đây không phải các entity vật lý trùng lặp. Giữ namespace hiện hữu để bảo toàn migration đã phát hành, serializer và hợp đồng API.
- `tools/BHome.LegacyPersistence/`: `BHomeDbContext` cũ, migrations schema cũ, `Compact24ArchiveContext` và projection/writer cũ chỉ dành cho công cụ import hoặc fixture kiểm thử được gọi tường minh. API không tham chiếu thư viện offline, không đăng ký archive context trong DI. Giữ nguyên migration Compact24 của hệ thống hiện tại.

## Bản đồ 24 bảng

| Module              | Bảng                  | Entity              |
| ------------------- | --------------------- | ------------------- |
| IdentityAccess      | `users`               | `User`              |
| IdentityAccess      | `refresh_tokens`      | `RefreshToken`      |
| IdentityAccess      | `staff_employments`   | `StaffEmployment`   |
| PropertyManagement  | `locations`           | `Location`          |
| PropertyManagement  | `rooms`               | `Room`              |
| PropertyManagement  | `assets`              | `Asset`             |
| TenantContracts     | `residents`           | `Resident`          |
| TenantContracts     | `contracts`           | `Contract`          |
| TenantContracts     | `contract_signings`   | `ContractSigning`   |
| TenantContracts     | `contract_residents`  | `ContractResident`  |
| IncidentMaintenance | `incident_reports`    | `IncidentReport`    |
| StaffOperations     | `operational_tasks`   | `OperationalTask`   |
| Billing             | `meters`              | `Meter`             |
| Billing             | `meter_readings`      | `MeterReading`      |
| Billing             | `billing_policies`    | `BillingPolicy`     |
| Billing             | `invoices`            | `Invoice`           |
| Billing             | `invoice_items`       | `InvoiceItem`       |
| Billing             | `invoice_adjustments` | `InvoiceAdjustment` |
| PaymentsDebt        | `payments`            | `Payment`           |
| PaymentsDebt        | `payment_allocations` | `PaymentAllocation` |
| PaymentsDebt        | `refund_requests`     | `RefundRequest`     |
| Finance             | `expenses`            | `Expense`           |
| Finance             | `financial_scenarios` | `FinancialScenario` |
| Notifications       | `notifications`       | `Notification`      |

Entity chuẩn giữ namespace CLR hiện hữu (`BHome.Domain.*`). Các trường chỉ phục vụ lưu trữ không xuất hiện trong snapshot nghiệp vụ cũ; EF mapping tường minh quy định tên cột, kiểu, nullable và khóa. Đã bỏ 17 kiểu entity trùng lặp cùng các bước sao chép toàn bộ bản ghi tương ứng. Các kiểu lưu trữ còn lại (StaffEmployment, RefundRequest, Expense, FinancialScenario, Notification và hai entity Identity) không có entity nghiệp vụ thứ hai tương đương.

## Các luồng đọc/ghi đã chuyển

| Repository                                                                                                  | Luồng                                                                                                 | Nguồn dữ liệu native                                                                                                      |
| ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `SetupWorkspaceStore`                                                                                       | Guard cơ sở hoạt động sau khi khóa; tra cơ sở của phòng; danh sách ID phòng; phạm vi công tơ          | `locations`, `rooms`, `meters`                                                                                            |
| `SharedConfigurationStore`                                                                                  | Kiểm tra cơ sở hoạt động sau advisory lock                                                            | `locations`                                                                                                               |
| `InvoiceRepository`                                                                                         | Danh sách cơ sở tính phí của Tenant; xác định cơ sở trước khóa phòng; kiểm tra tồn tại cơ sở sau khóa | `contracts`, `rooms`, `locations`                                                                                         |
| `FinancialScenarioRepository`                                                                               | Lưu kịch bản, danh sách, xem, replay theo actor/key, giữ nguyên snapshot và công thức                 | `financial_scenarios`                                                                                                     |
| `ExpenseRepository`                                                                                         | CRUD không xóa, chi phí, đầu tư hàng loạt, phân trang, phạm vi và tham chiếu; lưu history qua EF      | `expenses`, `locations`, `rooms`, `assets`, `operational_tasks`, `incident_reports`                                       |
| `CompactOperationsRepository`                                                                               | Đọc lịch sử, kiểm tra trùng kỳ, tạo và cập nhật kỳ lao động; giữ khóa account và audit                | `staff_employments`                                                                                                       |
| `CompactTenantContractAccess`                                                                               | Quyền truy cập giữa các thành viên khác nhau trong cùng hợp đồng, theo phạm vi cơ sở                  | `contracts`, `contract_residents`, `residents`, `rooms`                                                                   |
| `PostgresPropertyRepository`, `PropertyLifecycleChecks`, `PostgresRoomInsightsRepository`                   | Nghĩa vụ phòng, kiểm tra đóng cơ sở/phòng, lịch sử, tình trạng sẵn sàng và tỷ lệ sử dụng              | `locations`, `rooms`, `contracts`, `residents`, `assets`, `incident_reports`, `meters`, `notifications` và bảng liên quan |
| `SharedConfigurationOperationsStore`, `SetupWorkspaceStore`                                                 | Đọc/copy biểu phí, kiểm tra công việc mở và tài sản trùng                                             | `billing_policies`, `operational_tasks`, `assets`                                                                         |
| `ExpensePaymentRepository`, `DepreciationRepository`, `ExpenseEvidenceRepository`                           | Ghi nối lịch sử thanh toán, khấu hao, chứng từ và bảo toàn JSON trong transaction                     | `expenses`                                                                                                                |
| `InvoiceFinancialQueries`, các repository báo cáo và kịch bản tài chính                                     | Tổng hợp hóa đơn, khoản phân bổ, quyết định điều chỉnh và dòng hóa đơn theo snapshot                  | `invoices`, `invoice_items`, `invoice_adjustments`, `payment_allocations`                                                 |
| `NotificationPublications`, `NotificationInboxWrites`, các job phát thông báo                               | Kiểm tra và lưu inbox, marker chống phát trùng; giữ key, ID xác định và payload lịch sử               | `notifications`                                                                                                           |
| `ContractRepository`, `NativeContractMutation`, `NativeContractSidecars`, repository bàn giao và quyết toán | Hợp đồng, chữ ký, bàn giao/trả phòng, lịch sử, khóa và idempotency                                    | `contracts`, `contract_signings`, `contract_residents`, `residents`, `rooms`, `operational_tasks`                         |
| `PaymentRepository`, `PaymentLedgerWrites`, `MainInitialPaymentLedger`, `RefundRepository`                  | Đối soát, phân bổ, nghĩa vụ tiền cọc, thanh toán lần đầu, hoàn tiền                                   | `payments`, `payment_allocations`, `refund_requests`, `invoices`, `contracts`                                             |
| `NativeInvoicePersistence`, `NativeAdjustmentPersistence`, `NativeBillingJobPersistence`                    | Ghi hóa đơn/điều chỉnh, automation và công tơ                                                         | `invoices`, `invoice_items`, `invoice_adjustments`, `meter_readings`, `operational_tasks`                                 |
| `NativeOperationalTaskPersistence`, `NativeIncidentSession`, `NativeIncidentWrites`                         | Nhiệm vụ, sự cố, bảo trì, chứng từ và lịch sử                                                         | `operational_tasks`, `incident_reports`, `assets`, `expenses`                                                             |
| `NativeCaptureWrites`, `NativeHouseholdPersistence`, `NativeIdentityPersistence`                            | OCR, hộ gia đình, tài khoản và audit                                                                  | `meters`, `meter_readings`, `residents`, `users`, `refresh_tokens` và bảng liên quan                                      |

Công thức, snapshot biểu phí, quyền theo người thuê, predicate hợp đồng Main/Renewal đã kích hoạt, advisory lock và transaction phải được giữ nguyên. Chi phí và kịch bản dùng DTO hiện có; `ExpenseDtos.cs`, `FinancialScenarioDtos.cs` và các interface Repository tách khỏi Service, giữ namespace và hợp đồng API. Chỉ công cụ/fixture offline còn dùng projection cũ.

## JSONB và quy tắc nghiệp vụ

57 cột JSONB giữ nguyên schema; POCO dùng `JsonElement` hoặc `JsonElement?`, riêng các cột JSON Identity giữ cấu hình string/shadow hiện có. `InvoiceItem` là entity chuẩn của bảng `invoice_items`; `ContractHandover`, `ContractMoveOut` và các model snapshot vẫn là kiểu nghiệp vụ riêng, còn `InvoiceMath` nằm trong Services. Dùng snapshot có kiểu, giữ lịch sử/audit và dữ liệu cần thiết của nghiệp vụ; không ghi đè lịch sử bằng generic deserialize/serialize toàn bộ JSON. Bảng `operational_tasks` chứa nhiều loại công việc nên giữ trạng thái vật lý dạng chuỗi và chỉ diễn giải enum theo loại công việc tương ứng. Tương thích tuyệt đối với dữ liệu test cũ không phải điều kiện nghiệm thu của refactor.

## Quy tắc chuyển tiếp và kiểm thử

1. Ưu tiên truy vấn các cột native; không đưa quyền, trạng thái hay công thức vào mapping.
2. Khi đổi một luồng ghi, phải chứng minh dữ liệu native + JSON, version/lock/transaction/idempotency và audit được giữ. Không dùng `ExecuteUpdate` hoặc SQL trực tiếp để đi vòng guard hiện hữu. Không đưa lại projection vào runtime.
3. `Compact24TableModelTests`: đối chiếu số bảng, cột, khóa, kiểu, nullability và FK với DDL, kiểm tra không sở hữu migrations, transaction/rollback và bảo toàn JSON. `NativePropertyBillingReadTests`: so sánh các truy vấn native với projection hiện hành trên PostgreSQL cô lập, kiểm tra thiếu dữ liệu/phạm vi và rollback. `Compact24MigrationBaselineTests` tiếp tục bảo vệ model snapshot và migration ID.
4. Schema, migration đã phát hành, FE và HTTP API không đổi. Snapshot runtime phải có 24 entity và không có `ToSqlQuery`; cập nhật snapshot không tạo DDL mới. Không chạy migration trên database đang sử dụng cho refactor này.

## Điều kiện nghiệm thu

Kiểm tra model runtime, build Debug/Release, regression PostgreSQL đầy đủ và CI. `Compact24IndependenceTests` kiểm tra API, repository và hosted services bằng interceptor và log SQL PostgreSQL thật. Việc có đủ 24 Entity vật lý không tự chứng minh mọi luồng nghiệp vụ đã pass, cũng không có nghĩa chỉ còn 24 class nghiệp vụ.
