# Owner Web: khôi phục nhánh API sau merge develop

## Nguyên nhân

Ảnh người dùng có nhãn `DEMO · KHÔNG GỬI API`. Ở HEAD `15ca960`, chỉ có `.env.example`, không có `.env.local`; `services/config.ts` dùng điều kiện `VITE_API_MODE !== 'api'`, nên thiếu biến môi trường sẽ chạy demo. README lại ghi API là mặc định. `.env.example` không được Vite tự nạp.

Merge `839911f` còn thay route Sự cố/Bảo trì/Nội dung công khai bằng `UnavailableFeaturePage`, dù controller, DTO và consumer API đã triển khai vẫn tồn tại. Staff bị đổi sang consumer capture đơn giản, không có phần employment/update/invitation đã làm. Tasks bị đổi sang phiên bản thiếu recurring templates và một số filter. Lần sửa `15ca960` trước đó chỉ phục hồi import gây màn hình trắng; chưa xử lý những thay đổi kết nối này.

## Thay đổi

- API là mặc định; demo chỉ bật bằng `VITE_API_MODE=mock`. Các file/component demo vẫn được giữ cho chế độ minh họa rõ ràng.
- PortalProvider không khởi tạo repository demo trong API mode. Các thao tác generic chưa có consumer phải báo lỗi; không đọc/ghi localStorage như dữ liệu backend. `usePortalData` API hiện có vẫn đọc Locations/Rooms/Assets từ API cho shell và các trang phụ thuộc.
- Staff, Tasks, Incidents, Maintenance và PublicContent trỏ lại consumer đã triển khai: `StaffApiPage`, `TasksApiPage`, `IncidentWorkspace`, `PublicContentApiPage`. Giữ implementation/domain/API backend hiện tại; không thêm endpoint hoặc thay policy.
- Schedules chỉ có lịch mẫu trong mock mode. API mode thông báo phân ca ngoài phạm vi MVP và dẫn đến Staff/Tasks; không dựng lịch giả hoặc phát minh API phân ca.
- Giữ các API branch hiện có của Tenants, Contracts, Handover, Residence, Meter/Invoice, Payment/Debt/Adjustment, Notifications và Finance/What-if.

Traceability: đây là sửa cấu hình/route regression cho các consumer đã có của BF-02..07, UC-08..38 theo phạm vi Owner trước đó; không thay luật nghiệp vụ, quyền hoặc trạng thái. Phân ca vẫn bị loại khỏi phạm vi theo yêu cầu triển khai gốc. Không migration hoặc seed DB.

## Xác minh và vận hành

Kiểm thử tập trung cần bao gồm: thiếu cấu hình không bật mock; chỉ mock explicit mới tạo demo repository; route thật gọi transport API; lỗi backend không xuất hiện dữ liệu demo; PublicContent tải theo Location; task create gửi UTC/idempotency và Owner verification/recurring templates còn được route sử dụng. Các test mock transport, không được coi là E2E.

Kết quả thực thi:

- Bộ test tập trung: **20 PASS / 6 files**.
- `npm.cmd run test --workspace src/owner-web`: **260 PASS / 51 files**.
- `npm.cmd run lint --workspace src/owner-web`: PASS.
- Build TypeScript/Vite khi không đặt `VITE_API_MODE` (API mặc định) và khi đặt `VITE_API_MODE=mock`: cả hai PASS; vẫn có cảnh báo bundle trên 500 kB.
- `git diff --check`: PASS.

`BlockedBackendPages.test.tsx` cũ đã được thay bằng `LiveApiPages.test.tsx`: test cũ khẳng định ba màn không có API, trái với controller/consumer đã có. Test mới kiểm tra route gọi đúng API, không hiển thị demo hoặc fallback khi backend lỗi. Test Tasks được cập nhật cho consumer đầy đủ đã khôi phục, vẫn kiểm tra create/verification và bổ sung recurring templates.

Kiểm tra mạng thực tế tại thời điểm sửa: `https://localhost:7240/health/live` và `/api/v1/staff` đều không kết nối được (curl exit 7/HTTP 000). Vì vậy chưa xác nhận tải dữ liệu DB thật hoặc E2E. Không tự khởi động backend/job hay tạo/sửa dữ liệu vận hành để làm kiểm thử này.

Người chạy cần bật backend bằng cấu hình hiện có, khởi động lại Vite, tải lại toàn trang và đăng nhập Owner thật. Không dùng phiên demo để xác minh dữ liệu API. Provider ngân hàng, ký production, PUSH và chính sách tạm trú vẫn có các giới hạn trong báo cáo triển khai trước.
