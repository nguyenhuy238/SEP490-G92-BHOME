# Holding wizard compact UI

Thay stepper hai hàng bằng `HoldingProgress`: bước hiện tại, progress bar của React Native Paper, bước tiếp theo và danh sách quy trình chỉ mở khi người dùng yêu cầu. Áp dụng cho cả tạo nháp và xử lý bước 5–8. Không đổi API hoặc thứ tự nghiệp vụ.

Tiêu đề dùng header đăng ký với shell, mô tả một dòng. Chọn phòng giữ nguyên tìm kiếm và kiểm tra readiness, thêm icon phòng và tóm tắt phòng/cơ sở sau lựa chọn. Card trắng bo 16px. Các nút tiếp tục chọn phòng/CCCD và nhập người giữ chỗ dùng slot footer ngoài scroll, trên Bottom Navigation; shell giữ KeyboardAvoidingView hiện có. API không cung cấp giá phòng trong lựa chọn thì UI không tự dựng giá.

Files: `HoldingProgress.tsx`, `ContractDraftForm.tsx`, `HoldingContractFlow.tsx`, `HoldingNewTenant.tsx`, `WorkflowControls.tsx`, `WorkspaceShell.tsx`; tests `holding-progress`, `holding-draft`, `holding-signing-flow`, `contract-sections`.

Validation: 61/61 tests trên 5 file (bao gồm `holding-new-tenant`) đạt; lint đạt. Không xác nhận pixel/SafeArea trên điện thoại thật vì chưa thực hiện visual QA trực tiếp.
