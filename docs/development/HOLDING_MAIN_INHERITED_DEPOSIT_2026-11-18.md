# Tiền cọc Main lấy từ Holding đã chọn

Phạm vi BF-03/04/06, UC-14/15, GBR-01..04/10. Nguồn: quyết định người dùng ngày 18/11/2026 yêu cầu không nhập cọc và bắt buộc lấy từ tiền giữ chỗ trong database. Quyết định này thay hành vi nhập cọc được triển khai trước đó trong cùng ngày.

- `HoldingMainStart.tsx`: bỏ ô nhập, state cọc tự nhập và phụ thuộc Owner settings. Hiển thị số tiền chỉ đọc từ `ContractView.requiredDeposit` của Holding đã chọn, cùng tên/CCCD được backend trả về. Request conversion chỉ gửi `requireInitialPayment`, không gửi số tiền từ FE.
- `ConvertHoldingAsync`: đọc `holding.RequiredDeposit` từ repository trong transaction; dùng nó làm `main.RequiredDeposit` và giới hạn áp dụng cọc. Client cũ gửi số tiền khác cũng không được ghi đè. Normalize payload trước kiểm tra idempotency để request bỏ trường cọc và request client cũ tương đương nhau khi cùng lựa chọn. Giữ điều kiện Active, OnHold, thời hạn, khóa giá, quyền Owner/Staff, nguồn cọc và chống tạo Main/phân bổ trùng.
- `HoldingConversionInput.RequiredSecurityDeposit` nullable, mặc định null để tương thích JSON client cũ; giá trị client không còn là nguồn tiền cọc. Biểu mẫu conversion dùng chung trên Web/Mobile cũng bỏ trường nhập để không tạo kỳ vọng sai. Cấu hình Main tạo trực tiếp không từ Holding giữ nguyên.
- Số tiền cọc áp dụng vẫn là tiền đã xác minh do ledger trả về. Không tự đánh dấu thanh toán từ số tiền trên màn hình; tiền thuê/phí đầu kỳ tiếp tục theo nghĩa vụ đã cấu hình. Không sửa số tiền của hợp đồng đã tạo từ trước, không backfill dữ liệu hoặc migration.

Files: `HoldingMainStart.tsx`, `packages/client-core/src/contracts.ts`, `ContractContracts.cs`, `ContractHoldingService.cs`; kiểm thử tương ứng `holding-main-start.test.tsx`, `ContractServiceTests.cs`, `AnonymousSigningTests.cs`, `ContractLifecycleApiTests.cs`.

Xác minh đã chạy: 145 backend Contracts unit PASS; 8 Mobile picker PASS; 2 Compact24 integration với PostgreSQL tạm PASS (Holding sang Main, áp dụng cọc một lần, activation/provisioning và thanh toán thuê/phí đầu kỳ). Đã cập nhật hai assertion cũ trong integration để khớp quyết định đã triển khai trước đó: retry lời mời là idempotent, email hồ sơ được ghi sau ký thành công. Mobile lint/typecheck và Owner Web typecheck PASS; Metro bundle HTTP 200, API cập nhật health Healthy. Chưa chạy lại bộ legacy ContractLifecycleApiTests đầy đủ. Không chuyển đổi hợp đồng thật để kiểm thử.

Kiểm tra biểu mẫu dùng chung Owner Web: `Contracts.test.tsx` 18 PASS.
