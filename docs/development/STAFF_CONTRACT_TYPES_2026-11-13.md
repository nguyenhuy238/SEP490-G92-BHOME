# Mobile Staff: danh sách và chi tiết Holding/Main

Phạm vi: BF-03/BF-04, UC-13..19; GBR-01/02 (phạm vi Staff), GBR-04 (bằng chứng/phương thức ký), DBR-02. Đối chiếu controller/service/repository/DTO hiện có và `LOCATION_ROOM_API.md`; thay đổi này chỉ sửa trình bày, định tuyến và bổ sung dữ liệu đọc, không đổi quy tắc ký/kích hoạt/phân quyền.

## Kết quả điều tra

`GET /api/v1/contracts?page=1&pageSize=20` trả tất cả loại trong phạm vi tài khoản, phân biệt bằng `kind` (`Holding`, `Main`, `Renewal`, `Addendum`). API nhận `page`, `pageSize`, `locationId`, `status`; không có tham số loại hợp đồng. Mobile tải đủ các trang rồi tìm kiếm/lọc/phân trang hiển thị; không gửi tham số loại giả.

Kiểm tra chỉ đọc trên Neon qua tài khoản Staff hiện tại ngày 13/11/2026: 6 bản ghi được API trả về, cả 6 là `Main`; không có `Holding` trong kết quả tài khoản này. Không có bằng chứng frontend lọc mất một Holding đang được API trả về trong phiên đó. Không thêm dữ liệu mẫu hoặc mở rộng assignment trên Neon để thay đổi kết quả.

Những lỗi tìm thấy: card áp dụng ngày/giá thuê cho mọi loại; summary thiếu hạn và tiền giữ chỗ; điều hướng/nhận diện nháp dựa vào `onboardingDraft` mà chưa kiểm tra `kind`; một số luồng Holding vẫn có thể gọi dữ liệu move-out của Main. Đã sửa để chỉ `Main` có metadata mới mở Main onboarding, và Holding giữ luồng riêng.

## Hành vi sau sửa

- Bỏ nút `+ Tạo mới` ở tiêu đề Staff; giữ nút tạo Holding, lịch kiểm tra, tìm kiếm, sắp xếp và điều hướng dưới cùng.
- Loại và trạng thái là hai điều kiện độc lập, có thể chọn đồng thời (ví dụ Giữ chỗ + Bản nháp). Chạm lại một lựa chọn để bỏ; Tất cả xóa cả hai. Số lượng mỗi chip áp dụng điều kiện còn lại và tìm kiếm, tính trên toàn bộ dữ liệu đã tải.
- Nhóm Chính thức bao gồm các giá trị backend `Main`, `Renewal`, `Addendum`; các card gia hạn/phụ lục vẫn ghi rõ nhãn phụ. Trạng thái đóng bao gồm cả `Expired`, `Converted`, `Applied` thực tế của backend.
- Card Holding hiển thị `requiredDeposit` và `holdingExpiresAt`; không lấy `monthlyRent`/ngày thuê làm tiền/hạn giữ chỗ. Thiếu dữ liệu thì hiển thị chưa có thông tin, không suy diễn.
- `ContractSummary` bổ sung hai trường đọc trên từ entity hiện có; số tiền vẫn được serialize thành chuỗi decimal. Không migration database, endpoint mới hoặc thay đổi nghiệp vụ.
- Xóa nút quay lại trùng phía trên tab chi tiết. Topbar quay lại danh sách đã giữ bộ lọc/trang, hợp đồng trước nếu đang xem liên kết, hoặc route trước nếu mở từ màn hình khác. Pull-to-refresh dùng callback đang được đăng ký cho danh sách/chi tiết.
- Holding không có tab bàn giao/trả phòng, không đọc API move-out. `INTERNAL_OTP_DRAWN` dùng luồng Holding OTP/chữ ký sẵn có; giao diện Main không khẳng định mặc định nhà cung cấp là MySign.

## API sử dụng

- `GET /api/v1/contracts`: danh sách tất cả loại trong scope hiện có.
- `GET /api/v1/contracts/{id}`: chi tiết theo `kind`, `signingMode`, `onboardingDraft`.
- `GET /api/v1/contracts/{id}/activation-readiness`: điều kiện từ backend khi vai trò được phép.
- `GET /api/v1/contracts/move-out-assignments`: lịch kiểm tra Staff giữ nguyên.
- Các API chuẩn bị/tạo Holding, ký, thanh toán và bàn giao hiện có giữ nguyên; không bổ sung API giả.

## Xác minh

Mobile: các kiểm tra danh sách/chi tiết/Holding/Main liên quan đều đạt; lần chạy cuối 86/86 trên 7 file (bao gồm luồng cấu hình giữ chỗ mới). Backend ContractService: 51/51 unit tests đạt. Docker Compact24: kiểm tra danh sách hỗn hợp và phân quyền cơ sở đạt; kiểm tra cấu hình hai cơ sở cũng đạt (2/2). Typecheck và lint đạt. Các fixture hỗn hợp chỉ chạy trong test/Docker, không ghi vào Neon. Chưa xác minh bố cục pixel trực tiếp trên điện thoại thật.

Đã hoàn tất cả bảy yêu cầu về logic/UI trong phạm vi source và kiểm thử: bỏ tạo mới dư thừa; bỏ nút quay lại trùng trên tab; giữ đầy đủ loại API trả về; đếm/lọc trên toàn bộ các trang; định tuyến theo loại; giữ UI và Topbar/refresh; tạo Holding giữ nguyên và được nối thêm cấu hình riêng theo cơ sở. Việc thấy Holding trên Neon vẫn phụ thuộc bản ghi thực tế trong phạm vi Staff, không tự tạo dữ liệu để thay đổi số lượng.
