# BÁO CÁO TIẾN ĐỘ FRONTEND MOBILE BHOME

**Ngày chốt thông tin:** 02/11/2026  
**Phạm vi:** Frontend ứng dụng BHOME Mobile (React Native / Expo)  
**Mục đích:** Tổng hợp phần giao diện đã triển khai, mức độ kết nối API, kiểm thử và các việc còn lại.  
**Cách đọc trạng thái:** “Có giao diện” không đồng nghĩa nghiệp vụ đã hoàn chỉnh hoặc được nghiệm thu trên môi trường thật.

## 1. Tóm tắt

Ứng dụng Mobile đã có nền tảng đăng nhập, điều hướng theo vai trò Owner/Staff/Tenant, bộ giao diện workspace theo thiết kế Stitch và các luồng bổ sung theo SRS. Một số luồng cốt lõi đã dùng API thật, nổi bật là đăng nhập, công việc vận hành, đọc chỉ số/OCR, tiếp nhận và xác nhận danh tính, dữ liệu hợp đồng và thông báo công việc cho Owner/Staff.

Nhiều màn hình nghiệp vụ khác đã có phần trình bày hoặc biểu mẫu nhưng chưa được nối với API mobile. Một số adapter/backend liên quan đã xuất hiện trong mã nguồn và báo cáo tổng thể mới hơn; tuy nhiên, điều đó chưa chứng minh màn Mobile đã gọi đúng API hoặc luồng đã được kiểm thử đầu-cuối. Các phần billing, điều chỉnh, sự cố/bảo trì, bàn giao, cư trú, lịch ca và chỉnh sửa hồ sơ cần được xác nhận theo ma trận coverage trước khi xem là hoàn tất.

**Đánh giá chung:** UI và khung điều hướng đã được xây dựng ở phạm vi rộng; tích hợp thật tập trung ở các luồng vận hành. Chưa đủ bằng chứng để tuyên bố toàn bộ FE Mobile hoàn thành hoặc sẵn sàng nghiệm thu sản phẩm.

## 2. Phạm vi và căn cứ

Báo cáo này tổng hợp từ:

- [Ma trận coverage màn hình Mobile](MOBILE_SCREEN_COVERAGE.csv) — trạng thái từng use case và API.
- [Báo cáo triển khai UI Stitch](STITCH_MOBILE_UI.md) — 16 màn hình nền và thiết kế.
- [Báo cáo bổ sung luồng Mobile theo SRS](MOBILE_WORKFLOW_DELIVERY.md) — onboarding, CCCD và các luồng nghiệp vụ bổ sung.
- [Báo cáo workspace Mobile và kết nối API](MOBILE_LIVE_WORKSPACE.md) — luồng đã nối thật và bằng chứng kiểm thử trước đó.
- Báo cáo tiến độ hệ thống ngày 02/11/2026 đang mở trong thư mục Downloads — số liệu kiểm tra gần nhất và tình trạng môi trường hiện tại.

Các nhãn được sử dụng:

- **Đã nối API:** có adapter/đường gọi API được tài liệu hiện có ghi nhận; không mặc định mọi tình huống đã được nghiệm thu.
- **Có UI, API Mobile chưa xác nhận:** đã có màn hình/luồng, nhưng ma trận Mobile đánh dấu chưa hoàn chỉnh hoặc còn API pending.
- **Ngoài phạm vi Mobile:** chức năng quản trị chính thuộc Owner Web hoặc Public Website.
- **Chưa kiểm chứng:** chưa có bằng chứng chạy trên thiết bị thật, provider thật hoặc môi trường nghiệm thu.

## 3. Nền tảng giao diện

- Ứng dụng dùng **React Native, Expo, TypeScript, Expo Router và React Native Paper**.
- Có route đăng nhập và route workspace dùng chung; route workspace hiển thị màn hình theo vai trò và chặn điều hướng không đúng quyền ở tầng giao diện. API vẫn là nơi kiểm tra quyền cuối cùng.
- Bộ UI Stitch gồm 16 màn hình nền, có thành phần dùng chung và preview theo vai trò. Các luồng mới bổ sung màn hình/điểm vào theo danh mục SRS.
- Hỗ trợ các trạng thái giao diện tải, rỗng, lỗi ở những luồng dữ liệu live được mô tả trong báo cáo workspace.
- Giao diện mẫu tách khỏi tài khoản đăng nhập thật; các thao tác mô phỏng phải được nhận diện là chưa gửi/lưu máy chủ.
- Có kiểm tra đầu vào cho các biểu mẫu được triển khai. OCR là kết quả đề xuất; Staff phải kiểm tra và xác nhận trước khi gửi.

## 4. Màn hình và luồng đã có

### 4.1 Bộ 16 màn hình Stitch

| Nhóm | Màn hình |
|---|---|
| Đăng nhập | Đăng nhập hệ thống |
| Owner | Owner Home, Approval Center, Operational Monitoring |
| Staff | Staff Home, Work Orders, Meter Reading |
| Tenant | Tenant Home, Invoice, Contract, Move-in Checklist, Incident Report |
| Dùng chung | Profile, Notifications, Security Settings, Notification Preferences |

### 4.2 Các luồng bổ sung theo SRS

Đã có UI/điểm vào cho onboarding và CCCD, chuẩn bị hợp đồng, bàn giao vào/ra, cư trú, ký và yêu cầu hợp đồng, lịch sử hóa đơn/thanh toán, điều chỉnh hóa đơn, công nợ, lịch ca, danh sách phòng, chi tiết công việc và báo sự cố.

Các màn hình này giúp thể hiện quy trình dự kiến và thu thập dữ liệu đầu vào ở giao diện. Theo tài liệu triển khai, nhiều luồng vẫn dùng fixture trong preview hoặc chưa có API adapter mobile; không được hiểu là dữ liệu nghiệp vụ đã được lưu hoặc giao dịch đã thực hiện.

## 5. Mức độ tích hợp theo nghiệp vụ

| Nghiệp vụ | Trạng thái Mobile theo tài liệu | Phần đã có | Phần còn thiếu / lưu ý |
|---|---|---|---|
| Đăng nhập, phiên | Đã kết nối | Đăng nhập qua session API HTTPS; điều hướng về trang chủ theo vai trò | Cần xác nhận URL/CA trên đúng thiết bị và môi trường demo |
| Trang chủ Owner | Kết nối một phần | Hiển thị số liệu/phạm vi và điểm vào tác nghiệp từ dữ liệu server theo báo cáo workspace | Báo cáo tài chính và một số adapter dữ liệu còn thiếu |
| Trang chủ Staff | Đã kết nối một phần | Cơ sở được phân công, số lượng công việc server và điểm vào tác nghiệp | Lịch ca riêng chưa có API |
| Công việc vận hành | Đã nối API | Danh sách, tiến độ, vướng mắc, bằng chứng, gửi duyệt; Owner xử lý xác minh/rework theo phạm vi API được mô tả | Kiểm thử PostgreSQL integration trong lượt 02/11 bị chặn bởi Docker; cần replay trên môi trường tích hợp |
| Đọc chỉ số/OCR | Đã nối luồng hiện hữu | Danh sách tác vụ theo phạm vi và liên kết vào capture/OCR/xác nhận | Chưa có bằng chứng mới về camera/OCR trên điện thoại thật trong lượt audit 02/11 |
| Onboarding/CCCD | Đã nối một phần | Tạo hồ sơ, OCR và xác nhận danh tính theo API hiện có | API cho điện thoại, email, ngày cư trú và quan hệ hộ gia đình còn thiếu; dữ liệu tương ứng chỉ là nháp |
| Hợp đồng/ký | Có adapter hiện hữu | Đọc hợp đồng và một số luồng lifecycle/signing được tài liệu coverage ghi nhận | Ký với nhà cung cấp thật chưa được xác minh; không tuyên bố ký điện tử thật đã nghiệm thu |
| Thông báo | Kết nối một phần | Inbox công việc phân trang và trạng thái đã đọc cho Owner/Staff | Tenant và gửi push/email bên ngoài chưa được xác nhận |
| Hóa đơn/thanh toán | UI có; trạng thái Mobile cần xác nhận | Có màn hóa đơn/lịch sử; báo cáo tổng thể 02/11 ghi nhận backend billing/payment đã được bổ sung | Coverage Mobile vẫn ghi API pending/incomplete; cần xác minh adapter FE Mobile trên HEAD hiện tại |
| Điều chỉnh hóa đơn/công nợ | UI có; API Mobile chưa xác nhận | Có form yêu cầu/tra cứu trong các luồng bổ sung | Chưa xác nhận tích hợp và kiểm thử Mobile đầu-cuối |
| Sự cố/bảo trì | UI có; API Mobile pending theo coverage | Có form báo sự cố, màn chi tiết/tiến độ và điểm vào Owner | Không áp dụng API công việc vận hành cho Work Order bảo trì nếu chưa có API đúng nghiệp vụ |
| Bàn giao vào/ra, cư trú | UI có; API pending theo coverage | Checklist, ảnh/bằng chứng và trạng thái dự kiến | Chưa có adapter backend theo coverage; cư trú chính thức thực hiện ngoài BHOME qua VNeID |
| Hồ sơ, cài đặt thông báo | Chưa hoàn chỉnh | Hiển thị thông tin phiên; tùy chọn thông báo dạng preview | API sửa hồ sơ và lưu cấu hình thông báo còn thiếu; đổi mật khẩu đã nối API nhưng yêu cầu đăng nhập lại |
| Quản trị Location/Room/Asset, biểu phí, báo cáo sâu | Ngoài phạm vi Mobile chính | Có thể có overview/điểm vào phù hợp vai trò | Quản trị chính thuộc Owner Web; không tính phần Web là Mobile đã xong |

## 6. Kiểm thử và bằng chứng

### 6.1 Kết quả được ghi trong báo cáo tổng thể ngày 02/11

- **310 bài test Mobile** được báo cáo là đạt trong tổng số 889 automated tests của hệ thống.
- **75 assertions** cho script kiểm tra môi trường Mobile.
- Báo cáo tổng thể ghi nhận build frontend, lint và Mobile typecheck đạt.

Đây là số liệu trích từ báo cáo tổng thể ngày 02/11, không phải lệnh được chạy lại khi tạo tài liệu này. 310 bài test Mobile không đồng nghĩa 310 luồng UI đã được nghiệm thu hoặc mọi API đã được kiểm tra đầu-cuối.

### 6.2 Bằng chứng Mobile trước đó

Báo cáo workspace ngày 01/11 ghi nhận 231 test Mobile, TypeScript/ESLint, export Expo Web/Android/iOS và browser smoke ở viewport mobile 390px đạt trong lượt triển khai khi đó. Đây là bằng chứng lịch sử của lượt trước, không thay thế kiểm tra lại trên HEAD và môi trường hiện tại.

### 6.3 Chưa kiểm chứng trong lượt audit ngày 02/11

- Chưa chạy ứng dụng native iOS/Android và camera trên điện thoại thật.
- Chưa kiểm tra camera permission, lỗi upload, mở PDF trên thiết bị và push notification.
- Chưa chạy Metro hoặc thực hiện luồng Mobile live trong audit.
- PostgreSQL/MinIO integration và browser smoke của môi trường demo chưa chạy lại do Docker Desktop Linux engine không hoạt động.
- Chưa có formal System Test/Acceptance Test, báo cáo coverage, kiểm tra hiệu năng hoặc nghiệm thu provider thật.

## 7. Khả năng demo hiện tại

**Chưa nên coi môi trường local hiện tại là sẵn sàng demo nghiệp vụ Mobile.** Báo cáo tổng thể ngày 02/11 ghi nhận database `bhome` không có Location, Room, Resident, Contract, MeterReading, OperationalTask, Invoice, Payment hay Notification để trình diễn luồng có dữ liệu.

Ngoài ra, `src/mobile/.env.local` tại thời điểm kiểm tra trỏ tới `https://10.33.59.31:7240`, trong khi địa chỉ Wi-Fi máy được báo cáo là `192.168.0.106`. Cần kiểm tra URL thực do launcher chọn, xác minh CA/TLS trên thiết bị và dùng database demo có fixture tổng hợp trước khi demo.

Các kết quả smoke UI với API stub hoặc fixture chỉ chứng minh hành vi giao diện trong điều kiện kiểm thử tương ứng; không chứng minh đã ghi dữ liệu thật vào database hay đã tích hợp provider.

## 8. Việc cần ưu tiên

1. **Chốt ma trận trạng thái Mobile trên HEAD hiện tại:** đối chiếu từng route với adapter thực tế, nhất là billing/payment/adjustment, contract lifecycle, incident/work order và notifications; cập nhật `MOBILE_SCREEN_COVERAGE.csv`.
2. **Đồng bộ bảng tracking QA:** trạng thái trong workbook ngày 31/10 còn “unverified” và nhiều test “To Do”; ghi nhận bằng chứng mới, người review và trạng thái test, không tự chuyển Done chỉ dựa trên số test tổng.
3. **Chuẩn bị demo Mobile riêng:** khởi động đúng API/CA, xác nhận URL mạng, tạo Location/Room và dữ liệu tổng hợp theo fixture có kiểm soát; không dùng dữ liệu cá nhân thật.
4. **Chạy smoke trên thiết bị Android/iOS:** đăng nhập theo từng vai trò, điều hướng, safe area/keyboard, camera permission, OCR, upload/evidence, lỗi mạng và đăng xuất.
5. **Hoàn thiện tích hợp còn thiếu:** billing, điều chỉnh, sự cố/bảo trì, bàn giao, cư trú, lịch ca, hồ sơ và cài đặt thông báo khi API/hợp đồng nghiệp vụ đã được xác nhận.
6. **Bổ sung kiểm thử tích hợp và nghiệm thu:** chạy lại suite sau khi môi trường Docker khả dụng; kiểm tra role/Location scope, loading/error/empty state, không gửi trùng và phản hồi backend.

## 9. Kết luận

Frontend Mobile đã có nền tảng UI theo vai trò và nhiều luồng nghiệp vụ quan trọng. Phần có bằng chứng tích hợp tốt nhất là đăng nhập, công việc vận hành, đọc chỉ số/OCR, một phần onboarding/CCCD, hợp đồng hiện hữu và thông báo công việc Owner/Staff. Các màn hình billing, điều chỉnh, sự cố/bảo trì, bàn giao, cư trú và một số trang cài đặt chưa thể đánh dấu hoàn tất FE Mobile chỉ từ việc đã có UI hoặc backend API.

Trạng thái phù hợp để báo cáo hiện nay là **“đã triển khai UI diện rộng, tích hợp API một phần; cần xác minh đồng bộ tracking và kiểm thử thiết bị/môi trường trước nghiệm thu.”**