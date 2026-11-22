# Demo bàn giao tài sản từ đầu đến cuối

Ngày kiểm chứng: 16/11/2026. Áp dụng Owner Web và Staff/Tenant Mobile web.
Mọi tài khoản, địa chỉ, ảnh và số liệu trong bộ demo này đều là dữ liệu tổng hợp.

## Khởi động

Yêu cầu: Docker Desktop đang chạy, .NET 8, Node 22 và các dependency trong lockfile.
Không sử dụng connection string trong `.env` để chạy kịch bản này.

```powershell
npm ci --no-fund --no-audit
dotnet restore src/backend/BHome.sln
docker build -f deploy/docker/Minio.Dockerfile -t bhome/minio-local:2025-10-15 .
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Start-AssetHandoverDemo.ps1
```

Script tạo PostgreSQL và MinIO riêng với cổng loopback ngẫu nhiên, database mới có tên
`bhome_compact24_<GUID>`, bucket `handover-demo`. Không migrate, seed hoặc sửa database đang làm việc.
Ứng dụng chạy ở các địa chỉ mặc định:

| Vai trò | Địa chỉ                 | Tài khoản tổng hợp              |
| ------- | ----------------------- | ------------------------------- |
| Owner   | <http://127.0.0.1:5281> | `owner.sample@example.invalid`  |
| Staff   | <http://localhost:5282> | `staff.sample@example.invalid`  |
| Tenant  | <http://localhost:5282> | `tenant.sample@example.invalid` |

Mật khẩu ngẫu nhiên nằm trong `.tmp/handover-demo/access.json`, được Git bỏ qua. Không đưa file này vào commit.
Mở ba cửa sổ/profile trình duyệt riêng. Mobile web chỉ giữ phiên trong bộ nhớ: dùng nút điều hướng trong app;
tải lại toàn bộ tab cần đăng nhập lại. API dùng chứng chỉ phát triển HTTPS localhost; nếu máy chưa tin cậy,
chạy `dotnet dev-certs https --trust` trên máy phát triển.

`scenario.json` trong cùng thư mục chứa hợp đồng, phòng và cơ sở của lần chạy hiện tại.
Script seed đã thực hiện chuẩn bị và kích hoạt hợp đồng bằng Application Service: hai bên ký mô phỏng Development,
cọc yêu cầu bằng 0, tác vụ nhận phòng được tạo thật. Đây **không phải chữ ký điện tử hợp pháp hoặc thanh toán ngân hàng**.
Chỉ số đầu kỳ 100/100 và ảnh PNG tổng hợp được seed làm điều kiện đầu vào; OCR không phải phần cần chứng minh của demo này.

## Thao tác trên giao diện

1. **Owner → Cơ sở → [DEMO] Bàn giao tài sản → Tài sản & trang thiết bị → Kiểm kê phòng.**
   BG-101 có chín nhóm: Ghế (4), Bàn, Giường, Tủ, Quạt, Máy lạnh, Đèn, Rèm, Kệ.
   Bảy nhóm đầu đã được Owner kiểm kê. Giữ Rèm/Kệ chưa đủ để chạy nhánh ngoại lệ; hoặc kiểm kê đủ cả chín
   bằng màn hình hiện có để chạy nhánh bình thường. Không tăng số lượng mẫu chỉ để làm khớp hiện trạng.
2. **Staff → Công việc của tôi.** Mở tác vụ bàn giao BG-101, chọn mở biên bản theo hợp đồng.
   Có thể đi từ Trang chủ → Bàn giao / Trả phòng → Bàn giao nhận phòng → Phòng BG-101 → Bàn giao.
3. Chọn **Lập biên bản bàn giao**. Nhập hiện trạng phòng, chìa khóa. Mở từng nhóm bằng **Kiểm tra …**;
   nhập số thực tế, bàn giao, tốt, hao mòn, hỏng và xác nhận đã kiểm tra. Tổng ba tình trạng phải bằng thực tế.
   Số thiếu được tính theo cấu hình, không gộp với hỏng. Với Rèm/Kệ chưa có: thực tế/bàn giao/tình trạng đều 0,
   ghi lý do và chọn ảnh riêng của nhóm. Chụp ảnh toàn cảnh riêng; chọn chỉ số điện/nước BG-101 đúng ngày nhận phòng.
4. Lưu biên bản. Hợp đồng vẫn Active; tác vụ chưa hoàn tất. Không có việc tự tạo tài sản còn thiếu.
5. **Owner → Bàn giao phòng**: chọn cơ sở, phòng, hợp đồng hoặc mở theo liên kết trong hợp đồng.
   Nhập **Lý do quyết định ngoại lệ bàn giao** và **Phương án bổ sung / sửa chữa / kiểm tra lại**.
   Chấp nhận hiện trạng hoặc yêu cầu Staff kiểm tra lại. Quyết định tạo phiên bản mới và xóa xác nhận Tenant cũ.
6. **Tenant → Phòng của tôi → Xem chi tiết hợp đồng → Bàn giao**. Tải lại bàn giao, xem hiện trạng và ảnh,
   chọn đã kiểm tra đúng phiên bản rồi **Xác nhận nhận phòng**. Có thể gửi nội dung cần sửa với lý do.
7. **Staff → Bàn giao → Tải lại bàn giao**, xác nhận đúng phiên bản và **Staff xác nhận hoàn tất bàn giao**.
   Tác vụ chuyển Completed. Owner/Staff/Tenant có thể mở hoặc lưu PDF nhận phòng từ phần tài liệu.
8. **Owner → tài sản thực tế BG-101**: cập nhật số lượng Ghế từ 4 lên 5 với lý do bổ sung thực tế.
   Đây là thao tác quản lý Asset hiện có, không phải sửa biên bản nhận phòng. Với thay thế, sử dụng quy trình
   BF-07 và Work Order Verified, cùng quan hệ AssetReplacement thật; không nhập một UUID giả.
9. **Staff → Bàn giao → Lập bàn giao thay đổi tài sản**: chọn nguồn thay đổi vừa ghi nhận,
   loại Bổ sung, nhóm Ghế, tài sản hiện có, thêm 1, tình trạng, ngày, lý do và ảnh. Gửi Tenant xác nhận.
   Tenant xác nhận tại cùng tab Bàn giao. Biên bản ban đầu vẫn ghi 4, baseline đối chiếu hiện tại ghi 5.
   Thay thế/thu hồi có lựa chọn tài sản cũ và số thu hồi; máy chủ kiểm tra nguồn thực tế.
10. **Tenant → Gia hạn & trả phòng → Yêu cầu chấm dứt trước hạn**. Chọn ngày demo hiện tại và lý do;
    xác nhận thao tác. **Owner → Hợp đồng** duyệt yêu cầu: nhiệm vụ trả phòng mở ngay cho Staff tại cơ sở,
    không cần lịch hoặc người phụ trách riêng. Để test luồng Owner chủ động, có thể dùng hợp đồng Active
    khác và nhấn **Lập yêu cầu trả phòng**, chọn ngày trước, đúng hoặc sau hạn; nhiệm vụ cũng mở ngay.
11. **Owner/Staff → điện nước**: tạo tác vụ chốt đúng hợp đồng, chụp ảnh và xác nhận chỉ số cuối kỳ.
    Demo tự động dùng 101/101 qua capture API, không tự xác nhận OCR hoặc reset công tơ.
12. **Staff → Gia hạn & trả phòng**: tải lại trạng thái và biên bản/quyết toán; chụp ảnh cuối kỳ.
    Mở từng nhóm, đối chiếu baseline đã cộng thay đổi được Tenant nhận. Ví dụ Ghế baseline 5, thực tế 4,
    bàn giao 4, tốt 4, hao mòn/hỏng 0: thiếu 1. Nhập đề xuất xử lý nếu có, xác nhận và lưu biên bản đối chiếu.
13. **Tenant → Gia hạn & trả phòng → Tải lại biên bản & quyết toán**: xác nhận hiện trạng hoặc gửi tranh chấp.
    Đồng ý hiện trạng không đồng nghĩa đồng ý bồi thường. Nếu chưa phản hồi/không đồng ý, Owner phải chọn
    ngoại lệ và ghi căn cứ; không giả mạo xác nhận của Tenant.
14. **Owner → Hợp đồng → Kiểm tra & quyết toán trả phòng**: xem ảnh, phản hồi, lý do; xác nhận biên bản
    hoặc yêu cầu kiểm tra lại. Chỉ xác nhận Owner mới đồng bộ hiện trạng Asset. Template vẫn giữ số lượng cấu hình.
    Các khoản bồi thường sử dụng phần khoản thu/quyết toán hiện có, có quyết định Owner; đề xuất Staff không tạo nợ.
15. Owner chọn **Có thể cho thuê lại** hoặc **Chưa cho thuê · cần bảo trì / kiểm tra**, rồi
    **Hoàn tất bàn giao trả phòng và lưu PDF**. Người cuối cùng rời phòng nhận trạng thái đã chọn;
    phòng còn hợp đồng Active khác tiếp tục Occupied. Kiểm tra PDF trả phòng, lịch sử, Asset và công nợ/cọc riêng.

## Chạy smoke E2E tự động

Chạy ngay sau một lần Start mới, bằng Chrome đã cài. Script dùng ba phiên trình duyệt độc lập và dữ liệu tổng hợp.

```powershell
node scripts/Verify-AssetHandoverE2E.cjs
```

Các quyết định kiểm kê, Owner ngoại lệ, Tenant xác nhận, Staff hoàn tất, bổ sung và trả phòng đi qua UI thật.
Để chạy headless không cần camera, script tải PNG tổng hợp qua API upload hiện có; thao tác Asset của Owner và
capture chỉ số cuối kỳ dùng API thật. Không gọi trực tiếp service/DB để bỏ qua quyết định bàn giao.
Script không chứng minh camera thiết bị thật, OCR thật, giao dịch ngân hàng hay ký điện tử ngoài hệ thống.
Không chạy lại từ đầu trên kịch bản đã Terminated; tạo phiên demo mới.

Ảnh và PDF kiểm chứng ở `.tmp/handover-demo/`: `owner-handover.png`, `staff-handover.png`,
`tenant-handover.png`, `move-in.pdf`, `AssetChangeReport.pdf`, `MoveOutReport.pdf`.
PDF được tải từ tài liệu đã lưu, không render lại trên trình duyệt.

## Dừng và chạy lại

```powershell
$demoAccess = Get-Content .tmp/handover-demo/access.json -Raw | ConvertFrom-Json
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Stop-AssetHandoverDemo.ps1 -SessionFile $demoAccess.sessionFile
```

Lệnh dừng chỉ nhận session JSON đúng thư mục workspace, kiểm tra command line của tiến trình và tên container của phiên.
Dữ liệu được giữ lại; không xóa container, volume hoặc thư mục. Start lại tạo database/container mới.
Cổng 5280/5281/5282 đang có tiến trình khác sẽ khiến Start từ chối; có thể truyền `-ApiPort`, `-OwnerPort`, `-MobilePort` khác.

Hợp đồng cũ không có baseline/số lượng: Owner phải duyệt ngoại lệ thiếu baseline trước khi Staff kiểm tra.
Không có dữ liệu lịch sử sẽ hiển thị “Chưa rõ”; không tự suy ra thiệt hại. Phòng không có cấu hình và Asset
cần Owner xác nhận không có tài sản trong Kiểm kê phòng trước khi bàn giao.
