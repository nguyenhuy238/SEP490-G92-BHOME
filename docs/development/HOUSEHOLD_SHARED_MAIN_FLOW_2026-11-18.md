# Đồng bộ hộ gia đình và hợp đồng cá nhân — 18/11/2026

## Căn cứ và phạm vi

Quyết định nghiệp vụ: yêu cầu người dùng trong phiên ngày 18/11/2026. Hộ gia đình dùng cùng luồng cá nhân; chỉ thêm quản lý thành viên. Người đại diện là Tenant chính, nhận lời mời ký và tài khoản. Không tự tạo tài khoản/hợp đồng riêng cho thành viên. Quyết định này thay thế giả định cũ phải có CCCD, email và tài khoản cho mọi người cùng ở.

Traceability: BF-03/BF-04, UC-13..19 (tiếp nhận, hợp đồng và cư trú); GBR-01/02 (phân quyền), GBR-04 (bảo toàn bằng chứng ký), DBR-02 (sức chứa/xung đột cư trú), phần bảo vệ dữ liệu định danh của AGENTS.md. Không thay đổi tích hợp ký, công thức tiền hoặc quy trình thanh toán hiện hành.

## Luồng dùng chung

1. Chọn cơ sở/phòng trong phạm vi Staff, lấy sức chứa và số chỗ còn lại từ Backend.
2. CCCD người đại diện như cá nhân. Với hộ gia đình: thêm/sửa/xóa thành viên; bắt buộc họ tên, ngày sinh, quan hệ; điện thoại/CCCD tùy chọn. Tổng người gồm đại diện đúng một lần. Lưu hộ trước khi sang bước 3.
3. Cùng `MainDraftScreen`: thông tin phòng, người đại diện, điện thoại, giá/cọc/thời hạn/điều khoản theo cấu hình hiện hành. Chỉ hộ gia đình có thêm danh sách thành viên đã lưu.
4. Xem hợp đồng bằng cùng pipeline tài liệu. Tên người ở được đọc từ dữ liệu đã lưu, không từ nhãn giả lập.
5. Ký hợp đồng: Owner và người đại diện theo quy trình hiện hành; trường email chỉ dành cho đại diện. Thành viên không phải người đồng ký.
6. Tạo QR, xác minh thanh toán theo Backend, cùng cơ chế cá nhân.
7. Kích hoạt: một hợp đồng và các dòng cư trú cho toàn bộ người ở; cấp tài khoản/mời thiết lập tài khoản chỉ cho đại diện. Email kích hoạt/PDF dùng cơ chế đang có.

Quay lại bước 2 giữ dữ liệu trong phiên. Sau khi lưu, gửi lại cùng yêu cầu dùng cùng idempotency key; sửa dữ liệu tạo key mới và gửi version hiện tại. Mở lại hồ sơ đại diện để chuẩn bị hợp đồng đọc lại member IDs từ Backend. Bản nháp đã tồn tại được tiếp tục, không tạo thêm hợp đồng cho thành viên.

## PostgreSQL và giao dịch

Giữ mô hình Compact24 hiện hành, không tạo bảng/migration ngoài bộ schema được duyệt:

- Mỗi thành viên là một `Resident` thật, role `CoOccupant`; `HouseholdRepresentativeId` liên kết đến đại diện.
- Các trường household được ánh xạ qua `Compact24DomainModel` và writer hiện hành vào JSONB history của `residents`. `HouseholdProfile` là envelope mã hóa cùng cơ chế bảo vệ CCCD. Không ghi họ tên, DOB, điện thoại, CCCD thô vào display label hoặc log.
- `HouseholdClientKey`, version và hash/key yêu cầu ngăn bản ghi trùng khi retry; khóa giao dịch tại cơ sở/phòng/Owner/đại diện bảo vệ cập nhật đồng thời, chỉ mục khớp CCCD và sức chứa.
- `HouseholdConfirmedAt` là xác nhận thông tin thành viên, độc lập với xác minh CCCD. Trẻ/thành viên không có CCCD vẫn giữ `VerificationStatus.Pending`; không giả mạo trạng thái đã xác minh danh tính.
- `contract_residents` tiếp tục lưu liên kết FK và thông tin cư trú thật với một hợp đồng duy nhất. Tài khoản chỉ liên kết đến đại diện.
- Lỗi validation, trùng CCCD hoặc lưu thất bại rollback toàn bộ thay đổi. Xóa khỏi hộ giữ lịch sử, không xóa bằng chứng cũ.
- Sửa hộ khi còn Main draft chưa phát hành: cập nhật roster, version và snapshot trong cùng giao dịch. Bản xem trước cũ hết hiệu lực. Sau khi phát hành/ký/kích hoạt: từ chối sửa để giữ nguyên bằng chứng; không sửa PDF đã ký.

Không chạy migration, seed hoặc sửa dữ liệu hợp đồng thật trong công việc này. Kiểm thử PostgreSQL dùng database tạm tại localhost, được fixture tự tạo/xóa; không kết nối Neon.

## API và phân quyền

- `GET /api/v1/capture/residents/{id}/household`: Owner hoặc Staff trong phạm vi cơ sở, đại diện đã xác minh.
- `PUT` cùng URL: Staff được phân công, `Idempotency-Key`, `expectedVersion`, `humanConfirmed`, danh sách thành viên. Không nhận liên kết thành viên của hộ khác.
- `GET /api/v1/contracts/{id}/household`: Owner đúng hợp đồng, Staff đúng cơ sở hoặc Tenant đồng thời là tài khoản của hợp đồng và người đại diện. Người ngoài nhận 404, Tenant không dùng được API chỉnh sửa Staff.
- Tenant: Cá nhân → Hộ gia đình của tôi; đọc thông tin đại diện và mở chi tiết từng thành viên từ API theo hợp đồng đang hoạt động. Response cũ bị hủy/bỏ qua khi đổi hợp đồng; lỗi tải có nút thử lại.

## Kiểm thử đã chạy

- Mobile: 183/183 ca trên 11 bộ liên quan onboarding, household Tenant, profile, Main draft, signing, Owner flow, rental state, Holding, thanh toán và mở lại hồ sơ. Có ca khôi phục member IDs từ DB khi chuẩn bị hợp đồng.
- TypeScript Mobile và ESLint các component/service thay đổi: đạt.
- Application Contracts unit tests: 153/153 đạt.
- Compact24 PostgreSQL integration: 14/14 ca ký, Holding/Main, hộ gia đình không CCCD, kích hoạt, tài khoản đại diện và bản nháp đã xem trước đạt. Mở rộng ca CRUD/bảo mật rồi chạy lại: 1/1 đạt; bao gồm yêu cầu đồng thời, version cũ, retry, capacity, CCCD trùng/rollback, Staff ngoài cơ sở, Tenant khác hộ, cập nhật/xóa và giữ nguyên số tài khoản.
- UI giả lập tại localhost: editor và Tenant member details ở 360px/430px không tràn ngang; kiểm tra hình ảnh bằng dữ liệu tổng hợp. Không coi đây là kiểm thử camera/native device hay gửi email thật.
- Email/OTP trong integration tests được thay bằng provider kiểm thử; không gửi thư thử tới Tenant thật.
- Hồi quy đính kèm email kích hoạt: 5/5 ca đạt, gồm PDF đã ký đúng hợp đồng, tài liệu thiếu/không tin cậy và chặn đọc hợp đồng Tenant khác.
- Đã khởi động lại API với cấu hình local hiện có; health local và Cloudflare trả 200, Metro bundle trả 200.

Hộ/cư dân cũ đã có tài khoản riêng được giữ nguyên lịch sử. Không tự xóa tài khoản, chuyển đại diện hoặc gom dữ liệu hợp đồng cũ có chữ ký.
