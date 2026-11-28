# Cấu hình hợp đồng thuê chính thức dùng chung theo Owner

Ngày: 26/11/2026

## Thay đổi

- Cấu hình mẫu hợp đồng chính thức được lưu tại `users.business_profile.mainContractPolicy`, theo pattern owner-wide của cấu hình giữ chỗ. Lịch sử phiên bản giữ nguyên trong `versions`; thông tin bên cho thuê vẫn được mã hóa bằng `IIdentityProtection`, với scope Owner-wide riêng.
- API mới: `GET/PUT /api/v1/contracts/main-drafts/settings`. Route cũ có Location vẫn giữ để tương thích; các thao tác mới của Portal dùng route Owner-wide.
- DTO cấu hình không còn trường tiền cọc; hệ thống từ chối phụ thuộc vào giá trị cọc do client gửi.
- Tạo hợp đồng onboarding lấy cấu hình theo `Resident.OwnerUserId`, không theo Location, và dùng cùng dữ liệu khi xem lại / tạo tài liệu / gửi ký. Khóa advisory Owner-wide đồng bộ thay đổi cấu hình với việc tạo tài liệu.
- Cấu hình Location cũ không bị ghi đè hay giải mã/chuyển hàng loạt. Khi chưa có cấu hình Owner-wide, các luồng tạo mới yêu cầu Owner hoàn tất cấu hình chung; hợp đồng đã ký vẫn giữ snapshot của chúng.
- Tiền cọc không còn do cấu hình hợp đồng quyết định. Hợp đồng thuê mới trực tiếp đặt `RequiredDeposit = MonthlyRent`; chuyển đổi hợp đồng giữ chỗ tiếp tục dùng khoản cọc giữ chỗ đã xác minh và logic phân bổ hiện có.

## Trace nghiệp vụ

- Cấu hình dùng chung: `MainDraftsController` → `MainDraftService` → `IMainDraftData` → `MainDraftData` → `users.business_profile`.
- Tiền cọc hợp đồng thuê trực tiếp: `MainDraftService.SaveAsync` lấy giá RENT của phòng và gán tiền cọc bằng đúng giá RENT.
- Chuyển từ giữ chỗ: `ContractHoldingService.ConvertHoldingAsync` và ledger hiện hữu tiếp tục giữ khoản giữ chỗ đã xác minh; phần này không đổi.
- Giao diện: Owner Portal route `/contracts/settings`, mục sidebar “Cấu hình hợp đồng” dưới “Hợp đồng”; menu “Cấu hình giữ chỗ” không đổi.

## Vận hành và kiểm chứng

Cấu hình Location cũ được giữ để bảo toàn dữ liệu, nhưng không được tự động chọn làm cấu hình dùng chung vì có thể khác giữa các cơ sở. Owner cần lưu cấu hình Owner-wide trước khi tạo hoặc tiếp tục xử lý bản nháp chưa ký. Build Backend và Owner Portal cùng test giao diện cần chạy sau thay đổi.
