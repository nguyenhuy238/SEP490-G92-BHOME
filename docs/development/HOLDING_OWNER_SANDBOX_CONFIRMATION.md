# Owner xác nhận Sandbox tại chi tiết Holding

Yêu cầu mới cho phép Owner tự xác nhận chữ ký mô phỏng trước hoặc sau khi Staff mô phỏng Tenant. Đây là luồng thử nghiệm BF-03/BF-04, UC-15/16, GBR-04 theo yêu cầu cụ thể; không thay thế ký số MySign hay bằng chứng ký thật.

- Chi tiết Holding demo trên Owner Web hiển thị **Giả lập chữ ký Owner · Sandbox** ngay dưới thông tin hợp đồng.
- Owner tích **Tôi là Owner, đồng ý nội dung và xác nhận chữ ký giả lập cho hợp đồng này**, rồi bấm **Xác nhận chữ ký Owner (Sandbox)**.
- Dùng API hiện có `POST /api/v1/contracts/{id}/internal-signing/owner-confirmation`; backend kiểm tra đúng Owner, scope Sandbox, Holding đã duyệt, thời hạn và snapshot. Không mở quyền xác nhận Owner cho Staff.
- Database lưu OwnerConfirmedBy/OwnerConfirmedAt trong metadata Sandbox. Owner xác nhận trước Tenant thì chưa chuyển PendingActivation và chưa cho QR.
- Staff tiếp tục dùng nút mô phỏng Tenant trên Mobile. Đủ cả hai bên thì backend chuyển PendingActivation và trả canContinue/canShowQr. Staff bấm **Tiếp tục: tạo QR**. Xác minh cọc và OnHold giữ nguyên.
- Không tạo ContractSignature Signed hay bằng chứng Tenant pháp lý. Luồng thật ngoài Sandbox vẫn yêu cầu Tenant ký trước Owner xác nhận theo cơ chế hiện có.
- `GET /internal-signing` bổ sung `sandboxAvailable` từ kiểm tra backend, không suy đoán khả năng Sandbox từ cờ UI. Giữ tất cả giới hạn môi trường/database/location/role trước đây.
- Web không hiển thị bảng chữ ký số MySign hoặc số đếm 0/2 cho luồng INTERNAL_OTP_DRAWN; hiển thị tiến trình xác nhận phù hợp.

Các file chính: `InternalSigningPanel.tsx`, `ContractDetailPanel.tsx`, `internalSigning.ts`, `AnonymousSigningContracts.cs`, `AnonymousContractSigningService.cs`, `SePayHoldingPreviewController.cs`; cập nhật test Owner Web và test tích hợp database.

Hướng dẫn này bổ sung thứ tự Owner-trước-Tenant cho tài liệu `HOLDING_STEP6_REAL_OWNER_TENANT_EMAIL.md`; cơ chế email/OTP thật không thay đổi. Chỉ xác nhận thử khi người dùng bấm nút, không tự ký hoặc đổi dữ liệu hợp đồng đang mở thay người dùng.
