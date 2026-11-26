# Bỏ bước nhập thông tin riêng khi tạo hợp đồng giữ chỗ

Nguồn: yêu cầu trực tiếp ngày 26/11/2026. Phạm vi BF-03, UC-13/14, GBR-04: bỏ bước nhập thông tin người giữ chỗ trước màn CCCD; không bỏ xác minh, ký, xác nhận tiền cọc hoặc điều kiện kích hoạt.

- `ContractDraftForm.tsx`: Chọn phòng đi thẳng sang CCCD. Quay lại từ CCCD về Chọn phòng. Xóa nhánh giao diện nhập họ tên/chọn người ở bước cũ.
- `HoldingNewTenant.tsx`: khi mở CCCD mà chưa có tên, dùng nhãn nháp `Người giữ chỗ` để tạo hồ sơ qua API hiện có. Đây không phải họ tên đã xác minh; họ tên thực lấy từ kết quả xác nhận CCCD. Giữ nguyên kiểm tra họ tên cho các luồng nhập thông tin khác.
- Component CCCD có key ổn định theo phòng để tạo Resident ID không làm đóng/remount màn đang mở. Giữ hồ sơ và tiến độ khi quay lại.
- `holdingSteps.ts`, `HoldingProgress.tsx`: hiển thị 7 bước, bỏ bước Người giữ chỗ; giữ các stage ID nội bộ hiện có cho luồng ký, QR và kích hoạt.
- Không sửa backend, API, schema hoặc dữ liệu staging.

Kiểm thử hồi quy gồm đi tới/quay lại không gặp bước cũ, mở camera/nhập CCCD khi chưa nhập tên, chỉ dùng tên đã xác minh để xác nhận, không tạo hợp đồng khi chưa xác minh, và hiển thị tiến độ đúng. Chưa thử camera trên thiết bị thật; chưa triển khai staging.

Đã chạy: `npm run test --workspace src/mobile -- holding` đạt 118/118 tests trong 14 files; Mobile typecheck, lint và `git diff --check` đều đạt. Impeccable detector không có phát hiện trên 3 component đã sửa. File kiểm thử cập nhật: `holding-draft.test.tsx`, `holding-new-tenant.test.tsx`, `holding-progress.test.tsx`.
