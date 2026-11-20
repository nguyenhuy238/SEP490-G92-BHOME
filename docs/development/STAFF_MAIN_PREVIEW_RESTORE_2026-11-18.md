# PDF xem trước cho Staff trước ký Main

Phạm vi BF-03/04, UC-14/15, GBR-01..04. Nguồn: người dùng báo màn xem hợp đồng Main phòng P.102 chỉ còn nội dung chữ. `RentalContractFlow` vẫn render `ContractWorkflowPanel` ở bước xem hợp đồng, nhưng panel dùng điều kiện Owner/Tenant cho cả tài liệu lẫn dữ liệu cọc. Ba API previews cũng chỉ cho Owner/Tenant nên Staff không thấy phần xem PDF.

- `ContractWorkflowPanel.tsx` tách quyền xem PDF khỏi quyền xem dữ liệu cọc: Staff được xem Main Draft/PendingSigning, có mục **Xem trước hợp đồng**, tạo bản xem trước và mở/lưu PDF bằng `ContractEvidence` hiện có. Khóa nút khi đang tải/tạo, giữ thông báo lỗi và chống bấm trùng.
- `ContractsController.cs`: ba route previews hiện có cho phép principal Staff; không thêm endpoint. `ContractWorkflowService.cs` kiểm tra lại phân công Location qua `Load`/`Mutate`, chỉ cho Staff chuẩn bị Main Draft/PendingSigning. Các loại hợp đồng khác và trạng thái Active không được mở thêm quyền. Owner/Tenant hợp lệ giữ luồng hiện có, kể cả tài khoản đa vai trò.
- Staff chỉ được liệt kê/mở PDF đúng snapshot hiện tại; file thuộc đúng contract, đúng loại Preview và vẫn kiểm tra length/SHA-256 trước trả bytes. Không mở quyền xem chứng từ cọc, ký thay hoặc kích hoạt. Không chỉnh nội dung/hàm băm của PDF đã ký.

Xác minh: backend Contracts unit 152 PASS (scope phân công, loại/trạng thái, snapshot cũ, không trả bytes khi bị chặn); 2 PostgreSQL integration Holding→Main PASS, bổ sung tạo/liệt kê/tải PDF bằng Staff và vẫn 403 với deposit-verifications; Mobile 20 PASS; typecheck/lint PASS; API build 0 lỗi/0 warning. Các assertion step counter cũ 8 bước trong rental-flow test đã được sửa theo luồng 7 bước đang triển khai; không đổi stepper của sản phẩm.

Files sửa: `ContractWorkflowPanel.tsx`, `ContractsController.cs`, `ContractWorkflowService.cs`; test ở `holding-disposition.test.tsx`, `rental-contract-flow.test.tsx`, `ContractServiceTests.cs`, `AnonymousSigningTests.cs`. Không thêm migration/dependency, không gửi email hoặc tạo tệp hợp đồng thật để kiểm thử.
