# Compact24 — mô hình Entity sát database

## Mục tiêu và phạm vi hiện tại

Database vẫn có 24 bảng nghiệp vụ trong schema `public`. Backend vẫn là một project `BHome.Api` và giữ các use case, DTO, quyền, tính tiền và API hiện có. Đây là giai đoạn chuyển đổi mô hình lưu trữ, chưa phải thay thế toàn bộ persistence cũ.

- `Domain/Entities/<module>/`: 24 Entity tương ứng 24 bảng, 390 thuộc tính vật lý. 22 POCO dùng `[Table]` và `[Column]`; `ApplicationUser` và `CompactRefreshRow` là hai Entity Identity hiện có, cấu hình tại `Compact24DbContext.cs` để không nhân đôi user/session hoặc thay cơ chế Identity. Kiểu PostgreSQL và nullability theo DDL. `ContractResident` có khóa ghép `contract_id`, `resident_id`.
- `Data/Compact24/Compact24DbContext.cs` + `Compact24NativeModel.cs`: một DbContext runtime có 24 mapping bảng vật lý và 85 quan hệ FK. Đã bỏ context native phụ; các repository dùng context scoped hiện có, truy vấn đọc `AsNoTracking()`, ghi qua EF trong transaction của repository. Mô hình vật lý bị loại khỏi migration scaffolding vì DDL/migration SQL đã phát hành là nguồn chính. `Compact24NativeWrites.cs` chỉ cho phép `SaveChangesAsync` với các luồng đã chuyển (scenario thêm, expense/employment thêm và sửa, notification thêm cho inbox và publication marker hợp lệ), không cho phép xóa vật lý hoặc ghi bảng chưa chuyển; nhánh ghi projection và Identity vẫn giữ guard hiện có.
- `Domain/<module>/`: giữ model nghiệp vụ đang được service sử dụng, enum, calculator, rule và đối tượng snapshot/lịch sử. Các class này không đại diện cho bảng vật lý mới. Không đổi namespace, ID, DTO, giá hay trạng thái chỉ để làm mapping đẹp hơn.
- `Data/Compact24/Compact24Records.cs`, `Compact24RecordSql.cs`, `Compact24DomainWriter.cs`: vẫn phục vụ những projection và thao tác ghi cần tương thích với dữ liệu đã lưu. Không xóa khi còn consumer, không tạo thêm projection tổng quát mới nếu cột native đủ đáp ứng.

## Bản đồ 24 bảng

| Module | Bảng | Entity |
| --- | --- | --- |
| IdentityAccess | `users` | `ApplicationUser` |
| IdentityAccess | `refresh_tokens` | `CompactRefreshRow` |
| IdentityAccess | `staff_employments` | `StaffEmployment` |
| PropertyManagement | `locations` | `Location` |
| PropertyManagement | `rooms` | `Room` |
| PropertyManagement | `assets` | `Asset` |
| TenantContracts | `residents` | `Resident` |
| TenantContracts | `contracts` | `Contract` |
| TenantContracts | `contract_signings` | `ContractSigning` |
| TenantContracts | `contract_residents` | `ContractResident` |
| IncidentMaintenance | `incident_reports` | `IncidentReport` |
| StaffOperations | `operational_tasks` | `OperationalTask` |
| Billing | `meters` | `Meter` |
| Billing | `meter_readings` | `MeterReading` |
| Billing | `billing_policies` | `BillingPolicy` |
| Billing | `invoices` | `Invoice` |
| Billing | `invoice_items` | `InvoiceItem` |
| Billing | `invoice_adjustments` | `InvoiceAdjustment` |
| PaymentsDebt | `payments` | `Payment` |
| PaymentsDebt | `payment_allocations` | `PaymentAllocation` |
| PaymentsDebt | `refund_requests` | `RefundRequest` |
| Finance | `expenses` | `Expense` |
| Finance | `financial_scenarios` | `FinancialScenario` |
| Notifications | `notifications` | `Notification` |

Namespace của 22 Entity POCO là `BHome.Domain.Entities`; hai Entity Identity giữ namespace CLR cũ. Khi một repository cần cả Entity lưu trữ và model nghiệp vụ cùng tên, dùng alias `using Native = BHome.Domain.Entities;` để tránh nhầm lẫn. Chỉ Repository/Data sử dụng trực tiếp model lưu trữ ở giai đoạn này; không trả Entity chứa dữ liệu riêng tư ra HTTP.

## Các luồng đọc/ghi đã chuyển

| Repository | Luồng | Nguồn dữ liệu native |
| --- | --- | --- |
| `SetupWorkspaceStore` | Guard cơ sở hoạt động sau khi khóa; tra cơ sở của phòng; danh sách ID phòng; phạm vi công tơ | `locations`, `rooms`, `meters` |
| `SharedConfigurationStore` | Kiểm tra cơ sở hoạt động sau advisory lock | `locations` |
| `InvoiceRepository` | Danh sách cơ sở tính phí của Tenant; xác định cơ sở trước khóa phòng; kiểm tra tồn tại cơ sở sau khóa | `contracts`, `rooms`, `locations` |
| `FinancialScenarioRepository` | Lưu kịch bản, danh sách, xem, replay theo actor/key, giữ nguyên snapshot và công thức | `financial_scenarios` |
| `ExpenseRepository` | CRUD không xóa, chi phí, đầu tư hàng loạt, phân trang, phạm vi và tham chiếu; lưu history qua EF | `expenses`, `locations`, `rooms`, `assets`, `operational_tasks`, `incident_reports` |
| `CompactOperationsRepository` | Đọc lịch sử, kiểm tra trùng kỳ, tạo và cập nhật kỳ lao động; giữ khóa account và audit | `staff_employments` |
| `CompactTenantContractAccess` | Quyền truy cập giữa các thành viên khác nhau trong cùng hợp đồng, theo phạm vi cơ sở | `contracts`, `contract_residents`, `residents`, `rooms` |
| `PostgresPropertyRepository`, `PropertyLifecycleChecks`, `PostgresRoomInsightsRepository` | Nghĩa vụ phòng, kiểm tra đóng cơ sở/phòng, lịch sử, tình trạng sẵn sàng và tỷ lệ sử dụng | `locations`, `rooms`, `contracts`, `residents`, `assets`, `incident_reports`, `meters`, `notifications` và bảng liên quan |
| `SharedConfigurationOperationsStore`, `SetupWorkspaceStore` | Đọc/copy biểu phí, kiểm tra công việc mở và tài sản trùng | `billing_policies`, `operational_tasks`, `assets` |
| `ExpensePaymentRepository`, `DepreciationRepository`, `ExpenseEvidenceRepository` | Ghi nối lịch sử thanh toán, khấu hao, chứng từ và bảo toàn JSON trong transaction | `expenses` |
| `InvoiceFinancialQueries`, các repository báo cáo và kịch bản tài chính | Tổng hợp hóa đơn, khoản phân bổ, quyết định điều chỉnh và dòng hóa đơn theo snapshot | `invoices`, `invoice_items`, `invoice_adjustments`, `payment_allocations` |
| `NotificationPublications`, `NotificationInboxWrites`, các job phát thông báo | Kiểm tra và lưu inbox, marker chống phát trùng; giữ key, ID xác định và payload lịch sử | `notifications` |

Công thức, snapshot biểu phí, quyền theo người thuê, predicate hợp đồng Main/Renewal đã kích hoạt, advisory lock và transaction không đổi. Các luồng ghi chưa chuyển tiếp tục đi qua writer/repository có guard hiện tại. Chi phí và kịch bản dùng DTO hiện có; `ExpenseDtos.cs`, `FinancialScenarioDtos.cs` và các interface Repository tách khỏi Service, giữ namespace và hợp đồng API. Nhánh offline legacy vẫn dùng projection cũ.

## JSONB và quy tắc nghiệp vụ

57 cột JSONB giữ nguyên định dạng; POCO dùng `JsonElement` hoặc `JsonElement?`, riêng các cột JSON Identity giữ cấu hình string/shadow hiện có để không tự ý thay schema envelope, loại bỏ trường chưa nhận diện hoặc biến dữ liệu lịch sử thành dữ liệu hiện thời. Các class nghiệp vụ như `ContractHandover`, `ContractMoveOut`, `InvoiceLine`, `InvoiceMath` vẫn giữ trách nhiệm hiện tại. Khi chuyển từng nghiệp vụ tiếp theo, dùng các kiểu snapshot có cấu trúc rõ ràng, kiểm thử đọc/ghi cả payload cũ và mới, giữ unknown fields khi chỉnh sửa một phần JSON. Không dùng generic deserialize/serialize toàn bộ JSON để ghi đè lịch sử.

## Quy tắc chuyển tiếp và kiểm thử

1. Ưu tiên truy vấn các cột native; không đưa quyền, trạng thái hay công thức vào mapping.
2. Khi đổi một luồng ghi, phải chứng minh dữ liệu native + JSON tương thích, version/lock/transaction/idempotency và audit được giữ. Không dùng `ExecuteUpdate` hoặc SQL trực tiếp để đi vòng guard hiện hữu. Không bỏ projection khi chưa kiểm tra toàn bộ consumer.
3. `Compact24TableModelTests`: đối chiếu số bảng, cột, khóa, kiểu, nullability và FK với DDL, kiểm tra không sở hữu migrations, transaction/rollback và bảo toàn JSON. `NativePropertyBillingReadTests`: so sánh các truy vấn native với projection hiện hành trên PostgreSQL cô lập, kiểm tra thiếu dữ liệu/phạm vi và rollback. `Compact24MigrationBaselineTests` tiếp tục bảo vệ model snapshot và migration ID.
4. Schema, migration đã phát hành, JSON đã lưu, FE và HTTP API không đổi. Không chạy migration trên database đang sử dụng cho refactor này.

## Phần còn lại

Chuyển các luồng ghi Property/Asset, Billing, Contracts (bao gồm bàn giao/trả phòng), Payments/Refunds, Tasks, Incident, OCR, gửi thông báo và các luồng Identity còn dùng projection. Một số truy vấn phạm vi thanh toán/quyết toán, lịch sử bảo trì và audit vẫn dựa vào kiểu cũ; các tổng hợp JSON/SQL đặc thù không đồng nghĩa với phụ thuộc projection. Chỉ loại bỏ model projection và cơ chế writer tổng quát khi toàn bộ consumer đã chuyển, có kiểm thử PostgreSQL thật về các giao dịch và lịch sử. Việc có đủ 24 Entity vật lý không đồng nghĩa đã chuyển xong tất cả Repository hoặc chỉ còn 24 class nghiệp vụ.
