# Compact24 — mô hình Entity sát database

## Mục tiêu và phạm vi hiện tại

Database vẫn có 24 bảng nghiệp vụ trong schema `public`. Backend vẫn là một project `BHome.Api` và giữ các use case, DTO, quyền, tính tiền và API hiện có. Đây là giai đoạn chuyển đổi mô hình lưu trữ, chưa phải thay thế toàn bộ persistence cũ.

- `Domain/Entities/<module>/`: 24 POCO tương ứng 24 bảng, 390 thuộc tính vật lý. `[Table]` và `[Column]` thể hiện trực tiếp tên bảng/cột và kiểu PostgreSQL; nullability theo DDL. `ContractResident` có khóa ghép `contract_id`, `resident_id`.
- `Data/Compact24/Compact24TableContext.cs`: mô hình EF Core đọc bảng trực tiếp, khóa chính và 85 quan hệ FK rõ ràng. Không đăng ký context này làm persistence ghi mặc định, không sở hữu migration. `OpenAsync` dùng connection và transaction của `Compact24DbContext`; truy vấn không tracking. `SaveChanges` bị chặn. Đây là ranh giới chuyển tiếp, không phải database hoặc project thứ hai.
- `Domain/<module>/`: giữ model nghiệp vụ đang được service sử dụng, enum, calculator, rule và đối tượng snapshot/lịch sử. Các class này không đại diện cho bảng vật lý mới. Không đổi namespace, ID, DTO, giá hay trạng thái chỉ để làm mapping đẹp hơn.
- `Data/Compact24/Compact24Records.cs`, `Compact24RecordSql.cs`, `Compact24DomainWriter.cs`: vẫn phục vụ những projection và thao tác ghi cần tương thích với dữ liệu đã lưu. Không xóa khi còn consumer, không tạo thêm projection tổng quát mới nếu cột native đủ đáp ứng.

## Bản đồ 24 bảng

| Module | Bảng | Entity |
| --- | --- | --- |
| IdentityAccess | `users` | `User` |
| IdentityAccess | `refresh_tokens` | `RefreshToken` |
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

Namespace của Entity lưu trữ là `BHome.Domain.Entities`. Khi một repository cần cả Entity lưu trữ và model nghiệp vụ cùng tên, dùng alias `using Native = BHome.Domain.Entities;` để tránh nhầm lẫn. Chỉ Repository/Data sử dụng trực tiếp model lưu trữ ở giai đoạn này; không trả Entity chứa dữ liệu riêng tư ra HTTP.

## Các luồng đọc đã chuyển

| Repository | Luồng | Nguồn dữ liệu native |
| --- | --- | --- |
| `SetupWorkspaceStore` | Guard cơ sở hoạt động sau khi khóa; tra cơ sở của phòng; danh sách ID phòng; phạm vi công tơ | `locations`, `rooms`, `meters` |
| `SharedConfigurationStore` | Kiểm tra cơ sở hoạt động sau advisory lock | `locations` |
| `InvoiceRepository` | Danh sách cơ sở tính phí của Tenant; xác định cơ sở trước khóa phòng; kiểm tra tồn tại cơ sở sau khóa | `contracts`, `rooms`, `locations` |

Công thức, snapshot biểu phí, quyền theo người thuê, predicate hợp đồng Main/Renewal đã kích hoạt, advisory lock và transaction không đổi. Các thao tác ghi tiếp tục đi qua writer/repository có guard hiện tại. Nhánh offline legacy vẫn dùng projection cũ.

## JSONB và quy tắc nghiệp vụ

57 cột JSONB dùng `JsonElement` hoặc `JsonElement?` ở mô hình vật lý để không tự ý thay schema envelope, loại bỏ trường chưa nhận diện hoặc biến dữ liệu lịch sử thành dữ liệu hiện thời. Các class nghiệp vụ như `ContractHandover`, `ContractMoveOut`, `InvoiceLine`, `InvoiceMath` vẫn giữ trách nhiệm hiện tại. Khi chuyển từng nghiệp vụ tiếp theo, dùng các kiểu snapshot có cấu trúc rõ ràng, kiểm thử đọc/ghi cả payload cũ và mới, giữ unknown fields khi chỉnh sửa một phần JSON. Không dùng generic deserialize/serialize toàn bộ JSON để ghi đè lịch sử.

## Quy tắc chuyển tiếp và kiểm thử

1. Ưu tiên truy vấn các cột native; không đưa quyền, trạng thái hay công thức vào mapping.
2. Khi đổi một luồng ghi, phải chứng minh dữ liệu native + JSON tương thích, version/lock/transaction/idempotency và audit được giữ. Không dùng `ExecuteUpdate` hoặc SQL trực tiếp để đi vòng guard hiện hữu. Không bỏ projection khi chưa kiểm tra toàn bộ consumer.
3. `Compact24TableModelTests`: đối chiếu số bảng, cột, khóa, kiểu, nullability và FK với DDL, kiểm tra không sở hữu migrations, transaction/rollback và bảo toàn JSON. `NativePropertyBillingReadTests`: so sánh các truy vấn native với projection hiện hành trên PostgreSQL cô lập, kiểm tra thiếu dữ liệu/phạm vi và rollback. `Compact24MigrationBaselineTests` tiếp tục bảo vệ model snapshot và migration ID.
4. Schema, migration đã phát hành, JSON đã lưu, FE và HTTP API không đổi. Không chạy migration trên database đang sử dụng cho refactor này.

## Phần còn lại

Chuyển dần các luồng đọc và ghi của Property, Billing, Contracts, Payments/Refunds, Tasks, Notifications và Identity. Chỉ loại bỏ model projection và cơ chế writer tổng quát khi toàn bộ consumer đã chuyển, có kiểm thử PostgreSQL thật về các giao dịch và lịch sử. Việc có đủ 24 Entity vật lý không đồng nghĩa đã chuyển xong tất cả Repository hoặc chỉ còn 24 class nghiệp vụ.
