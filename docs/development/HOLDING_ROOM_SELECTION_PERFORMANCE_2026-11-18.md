# Tối ưu chọn phòng Holding — 18/11/2026

Yêu cầu: ô chọn phòng ở bước đầu tạo Holding phản hồi chậm. Phạm vi BF-03/04, UC-14/15; giữ eligibility/permission/snapshot phía BE theo GBR-01..04 và DBR-02.

## Nguyên nhân và thay đổi

- `useHoldingPreparation` trước đây chờ configuration + locations, tải danh sách phòng, rồi kiểm tra readiness từng phòng theo nhóm 4. Một danh sách 100 phòng cần 100 request readiness và 25 lượt chờ nhóm trước khi mở chọn.
- Nay configuration, locations và trang phòng đầu tải song song. Danh sách hiển thị phòng Available đúng Location được phép; readiness chi tiết chỉ gọi cho phòng đã chọn. Phòng Available chưa được coi là đủ điều kiện cho đến khi BE kiểm tra xong.
- Giữ kiểm tra readiness đầy đủ, blocker/unverified condition, phòng/location và trạng thái Available trước khi cho tiếp tục. Backend tạo Holding tiếp tục tự kiểm tra giá, phòng, quyền, conflict và snapshot; không nới điều kiện.
- Khi thiếu giá thuê, hiển thị lỗi của phòng đã chọn và cho chọn phòng khác. Foreground/focus vẫn kiểm tra lại phòng đã chọn; không tải và kiểm tra toàn bộ catalog khi quay về từ camera.
- `ContractDraftForm` chỉ khóa picker khi catalog đang tải hoặc đã tạo Resident. Trong lúc kiểm tra một phòng, người dùng vẫn có thể đổi lựa chọn; request cũ bị hủy và kết quả cũ không được áp dụng.
- `ChoiceField` chỉ dựng Dialog và các RadioButton khi mở; khi đóng không render/filter các dòng lựa chọn. Giữ search, chọn một mục và đóng hộp, giao diện và các thuộc tính hiện có.

## Kiểm chứng

- Test 100 phòng: catalog hiển thị mà không gọi readiness/preparation từng phòng; trước là 100 request readiness, sau là 0 trước lựa chọn. Đây là đo số request, không phải benchmark thời gian trên thiết bị.
- Test chọn phòng thiếu giá vẫn có blocker, focus/foreground kiểm tra lại phòng, catalog vẫn usable khi readiness đang chờ. Cập nhật test cũ để kỳ vọng một lần kiểm tra cho phòng được chọn thay vì hai lần (catalog + selection).
- Mobile Holding suite: 101 PASS, 0 FAIL.
- Không đổi API/schema/cache tài khoản, không lưu PII hoặc xác định đủ điều kiện chỉ ở FE.

Files: `useHoldingPreparation.ts`, `ContractDraftForm.tsx`, `components/WorkflowControls.tsx`, `holding-preparation-refresh.test.tsx`, `holding-draft.test.tsx`.
