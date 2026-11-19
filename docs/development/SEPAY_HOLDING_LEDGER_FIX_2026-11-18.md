# SePay 409 khi nhận cọc Holding đã ký

Phạm vi BF-03/04/06, UC-14/15/22..25, GBR-04/10; nguồn là yêu cầu bỏ bước phê duyệt Holding đã được chấp thuận trong phiên và lỗi webhook thực tế ngày 18/11/2026.

Log API cho thấy `SePayController.Webhook` đi tới `ValidateAllocationAsync`, lỗi PostgreSQL 23514 được chuyển thành HTTP 409. Application đã cho nhận cọc khi Owner có bằng chứng ký, nhưng Compact24 ledger vẫn đòi `ApprovedAt` khác null.

- `Compact24EventsAndLedger`: nạp Signatures và dùng cùng `HoldingOwnerHasSigned` với luồng nhận tiền. Giữ tương thích hợp đồng phê duyệt cũ, kiểm tra hạn giữ chỗ, số tiền, nghĩa vụ, tham chiếu ngân hàng và chống phân bổ trùng. Không ghi giả `ApprovedAt`, không bỏ kiểm tra tài chính.
- `ContractWorkflowContracts` và client-core: `DepositVerificationView.VerifiedByUserId` cho phép null vì cọc được SePay tự động xác minh không có người thao tác. Sửa lỗi đọc lịch sử cọc sau thanh toán; không gán Owner hay GUID giả làm người xác minh.
- Integration regression dùng database tạm trên PostgreSQL loopback: không có approval/chữ ký thì không phân bổ; có bằng chứng ký Owner và không approval thì nhận được; gửi lại cùng event chỉ có một allocation; hồ sơ approval cũ vẫn hoạt động; endpoint lịch sử cọc đọc được verifier null.

Không thêm endpoint, migration hay sửa tay trạng thái thanh toán. Chạy lại qua worker/webhook hiện có. Database làm việc local đã ghi một allocation 2.300.000đ cho P.103 và hợp đồng Active; webhook/polling cùng một bank reference không cộng tiền hai lần.

Xác minh: `dotnet test ...BHome.IntegrationTests.csproj --filter FullyQualifiedName~SePayIntegrationTests` chạy thực tế PostgreSQL tạm: 21 PASS, không skip. Mobile và Owner Web `npm run typecheck` PASS; API build thành công và `/health/ready` trả Healthy. Không tạo giao dịch ngân hàng hoặc sửa tiền bằng SQL để kiểm thử.

Kiểm tra đường public: phát lại payload của chính event Pending đã lưu, qua Cloudflare với HMAC hiện có, nhận HTTP 200. Event cũ chuyển Duplicate (`bank_transaction_already_received`), event polling Completed; database vẫn chỉ có một allocation 2.300.000đ. Không cần chuyển khoản lại. Lịch sử lần gọi 409 trên dashboard SePay được giữ nguyên; lần provider retry tiếp theo dùng cùng endpoint sẽ được xử lý theo cơ chế idempotency hiện có.
