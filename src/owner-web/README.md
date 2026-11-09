# BHOME Owner Web Portal

React + TypeScript strict + MUI/MUI X, triển khai từ 25 bộ xuất Stitch trong workspace.
Các route nghiệp vụ dùng Backend thật mặc định; demo cục bộ chỉ bật khi cấu hình rõ `VITE_API_MODE=mock`.

## Chạy ứng dụng

Từ thư mục gốc `SEP490-G92-BHOME` (Node 22 theo package engines):

```powershell
npm install
npm run dev --workspace owner-web
```

Mở URL Vite in ra, mặc định `http://localhost:5173`.
Owner Web mặc định dùng Backend thật tại `https://localhost:7240`; Backend, PostgreSQL,
HTTPS và CORS phải sẵn sàng. Chế độ demo chỉ được bật chủ động bằng
`VITE_API_MODE=mock`.

Khi chuyển từ demo sang API, dừng Vite bằng `Ctrl+C`, chạy lại `npm.cmd run dev`
và tải lại toàn trang (`Ctrl+Shift+R`). Đăng nhập bằng tài khoản Owner của Backend;
phiên đăng nhập demo không dùng được cho API. `.env.example` chỉ là file mẫu,
Vite không tự đọc nó như `.env.local`.

Nếu Backend chưa chạy, dùng cấu hình phát triển hiện có của dự án để khởi động:

```powershell
dotnet run --project src/backend/BHome.Api --launch-profile https
```

Lệnh trên chạy từ repository root; PostgreSQL, storage và cấu hình Backend phải sẵn sàng.
Lỗi kết nối/401/403 được hiển thị hoặc đưa về đăng nhập; ứng dụng không thay dữ liệu lỗi bằng demo.

Nếu cần cấu hình, sao chép `.env.example` thành `.env.local`:

```dotenv
VITE_API_MODE=api
VITE_API_BASE_URL=https://localhost:7240
VITE_SUPPORT_PHONE=
```

`VITE_API_MODE=api` dùng auth client-core và các màn đã tích hợp Backend. Những chức năng chưa có
Backend contract hiển thị trạng thái không khả dụng, không gọi endpoint suy đoán hoặc âm thầm trả mock.
Chỉ dùng `VITE_API_MODE=mock` khi cần xem dữ liệu demo cục bộ.
Auth cookie thật cần HTTPS, cùng site, đúng `AuthWeb:AllowedOrigins` và CORS.

## Các route

- 01 `/login`: login hiện có, demo/API, bảo vệ deep link.
- 02 `/dashboard`: KPI, biểu đồ, lấp đầy, việc cần xử lý, hợp đồng đến hạn.
- 03 `/notifications`: cảnh báo, đã đọc/chưa đọc, mở hồ sơ liên quan.
- 04 `/locations`: thẻ/bảng cơ sở, CRUD và mở sơ đồ phòng.
- 05 `/rooms`: ma trận tầng, bảng và chi tiết phòng.
- 06 `/room-types`: loại phòng, diện tích/giá và phòng theo loại.
- 07 `/assets`: tài sản, vị trí, tình trạng và lịch sử.
- 08 `/pricing`: giá thuê, biểu phí, ngày hiệu lực và lịch sử.
- 09 `/staff`: nhân viên, chức danh, phân công cơ sở.
- 10 `/schedules`: phân ca chưa thuộc MVP; API mode hiển thị giới hạn và liên kết Staff/Tasks. Lịch minh họa chỉ tồn tại trong mock mode.
- 11 `/tasks`: bảng/Kanban, người xử lý, tiến độ và nghiệm thu.
- 12 `/tenants`: Resident/đồng cư trú, phòng, trạng thái xác minh, tenancy, account link và invitation từ API.
- 13 `/contracts`: nháp, chờ ký/cọc, kích hoạt có điều kiện.
- 14 `/handovers`: nhận/trả phòng, checklist và xác nhận hai bên.
- 15 `/temporary-residence`: theo dõi bên ngoài và Owner xác nhận chỗ ở.
- 16 `/meters`: chỉ số điện/nước cũ/mới, kiểm tra và chốt số.
- 17 `/invoices`: nháp/phát hành, đề nghị và duyệt điều chỉnh.
- 18 `/payments`: giao dịch đã lưu trên Backend, xác minh và phân bổ với hóa đơn; tích hợp ngân hàng thật cần provider configuration.
- 19 `/debts`: công nợ theo hóa đơn, tuổi nợ, ghi chú và ngày hẹn.
- 20 `/incidents`: khẩn cấp, phân công, trùng lặp, nghiệm thu/đóng.
- 21 `/maintenance`: Work Orders, sự cố/tài sản, duyệt chi phí và nghiệm thu.
- 22 `/expenses`: khoản chi, phân loại, biểu đồ và trạng thái duyệt.
- 23 `/reports`: P&L theo cơ sở, cơ cấu thu, RevPAR và xuất CSV.
- 24 `/what-if`: giả định, dòng tiền 12 tháng, lưu/nạp kịch bản độc lập.
- 25 `/public-content`: nội dung, phòng trống, ảnh, liên hệ và xem trước công khai.

## Tương tác và cấu trúc

- AppShell/sidebar desktop-mobile, header, breadcrumbs và bộ chọn cơ sở dùng chung.
- Tìm kiếm, lọc trạng thái/danh mục/ngày, reset bộ lọc; empty/loading/error states.
- MUI X Data Grid có sorting/filtering/pagination; CSV có chống formula injection.
- React Hook Form + Zod, CRUD, drawer chi tiết, xác nhận xóa/chuyển trạng thái, toast.
- Async mock repository lưu tại localStorage key `bhome-owner-demo-v1`; **Khôi phục demo** đặt lại seed.
- 3 cơ sở, 56 phòng, 51 đại diện và các hợp đồng/hóa đơn/giao dịch/công nợ liên kết bằng ID.
- Kỳ minh họa cố định 10/2024; không coi đây là số liệu kinh doanh hiện tại.
- Tiền là số nguyên VND an toàn; hóa đơn phát hành bất biến; đối soát lặp không ghi có hai lần.
- What-if không sửa records tài chính. Dữ liệu demo không chứa token thật hay mật khẩu.

`src/app` chứa router/provider/config thiết kế; `src/components` chứa UI dùng chung;
`src/features/*/pages` là từng route độc lập; `src/services` tách seed/repository/workflow;
`src/types` là view model demo; `src/hooks` và `src/utils` chứa query/định dạng/tính toán.
`src/public-web`, backend và mã nguồn client-core không bị thay đổi.

## Kiểm tra

```powershell
npm run typecheck --workspace owner-web
npm run lint --workspace owner-web
npm run test --workspace owner-web
npm run build --workspace owner-web
```

Test bao gồm 24 route mới, deep link/login, form/tìm kiếm, CRUD/persistence, tham chiếu,
chỉ số, hóa đơn bất biến/điều chỉnh, đối soát lặp, hợp đồng, xung đột lịch,
What-if độc lập và lỗi storage. Các test auth cũ tiếp tục dùng synthetic API responses.

## Giới hạn

- Frontend demo cục bộ không thay thế quyền, audit và tính toàn vẹn server production.
- Không thực hiện OCR, ký pháp lý, chuyển khoản, gửi email/Zalo/SMS, nộp tạm trú hoặc xuất bản website thật.
- Bàn giao chỉ ghi biên bản; không tự khấu trừ cọc/chuyển hoàn/giải phóng phòng khi chính sách chưa duyệt.
- Xuất CSV thực tế; không giả gắn đuôi Excel/PDF. Ảnh Stitch/Inter có thể cần mạng.
- Lịch sử biểu đồ và vốn/chi phí What-if là giả định minh họa, không có dự báo AI/thị trường.
- Chưa có browser automation khả dụng để so sánh pixel hoặc kiểm tra responsive thực tế.
  Smoke test dùng jsdom; cần QA trình duyệt và đối chiếu từng màn trước nghiệm thu thiết kế.
- Vite có cảnh báo chunk chính lớn; các route đã lazy-load.

Traceability và file thay đổi: `docs/development/OWNER_PORTAL_STITCH.md` ở root repository.
