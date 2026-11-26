# Nối màn CCCD dùng chung cho Người ở 1, 2, 3

Nguồn: yêu cầu trực tiếp ngày 26/11/2026, được làm rõ: dùng nguyên màn Kiểm tra thông tin của Người ở 1, chỉ nối luồng cho Người ở 2/3, không tùy biến giao diện. Phạm vi BF-03/04, UC-13, GBR-13.

## Thay đổi cuối cùng

- `OnboardingScreen.tsx`: các nút quét và nhập thủ công của mọi người ở gọi cùng `openIdentity` và cùng `IdentityWizard` hiện có. Xóa nhánh mở biểu mẫu `HouseholdMemberEditor` dưới danh sách.
- Giữ nguyên file `IdentityWizard.tsx`, `IdentityFlowFrame.tsx`, `IdentityPersonCard.tsx`, các trường nhập, nút, kiểm tra dữ liệu và cách xác nhận của màn Người ở 1. Không thêm giao diện thành viên riêng, style hoặc field mới.
- Mỗi người dùng Resident ID riêng và đúng loại Representative/CoOccupant qua API hiện có. Chỉ trạng thái xác nhận do backend trả về mới cho phép bước tiếp theo; dữ liệu OCR và bản sửa không lẫn giữa các người.
- Danh sách Resident ID đã xác minh được truyền trực tiếp sang màn chuẩn bị hợp đồng. Không lưu lại những hồ sơ đầy đủ qua API hồ sơ thành viên rút gọn. Đã kiểm tra `ContractResidentEligibility.Ready` và `MainDraftService`: backend hiện có chấp nhận CoOccupant đã Verified, chưa liên kết hộ khác.
- Bỏ các phần tùy biến và mở rộng API của lượt sửa trước. Không thay backend, DTO, dịch vụ transport, schema hay migration. Không triển khai lên VPS trong tác vụ này.

Việc nối dùng nguyên màn Người ở 1 cũng dùng nguyên các trường bắt buộc và validation của màn đó. API hồ sơ rút gọn không CCCD vẫn giữ nguyên trên backend; tác vụ này không mở rộng màn dùng chung để chứa form rút gọn.

## Kiểm chứng

- `onboarding-ui.test.tsx`: 48/48 tests đạt, gồm đối chiếu danh sách trường giống nhau cho Người ở 1/2/3; quét hai mặt cho Người ở 2/3; không render form riêng; dữ liệu tách biệt; API xác nhận lỗi thì vẫn chặn tiếp tục; tạo hợp đồng với đúng các Resident ID đã xác minh.
- Mobile typecheck, lint và `git diff --check`: PASS. Đối chiếu Git xác nhận màn dùng chung, thẻ người ở, backend và transport không có thay đổi so với `develop` đã lấy về.
- Lần chạy toàn Mobile: 1.791/1.792 tests đạt; ca `refreshes stale assignments when a notification points to a newly assigned location` trong file ngoài phạm vi `staff-location-context.test.tsx` thất bại vì không nhận callback trong thời gian chờ. Chạy lại file đó cùng `onboarding-ui.test.tsx`: 58/58 tests đạt. Không sửa file ngoài phạm vi và không coi lần chạy toàn bộ ban đầu là PASS.
- Chưa kiểm tra camera/quyền truy cập trên điện thoại Android/iOS thật hoặc HTTPS Staging.

Các file thay đổi: `src/mobile/src/screens/OnboardingScreen.tsx`, `src/mobile/src/__tests__/onboarding-ui.test.tsx` và tài liệu này.
