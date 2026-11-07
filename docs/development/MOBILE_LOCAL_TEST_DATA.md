# Dữ liệu test Mobile local

Bộ fixture tổng hợp được tạo theo yêu cầu ngày 04/11/2026, phục vụ kiểm tra tích hợp UC-01/02 (phiên/quyền), UC-10..12 (công việc), UC-20/21 (ghi số/hóa đơn), UC-22..25 (truy vấn thanh toán/công nợ và yêu cầu điều chỉnh), hợp đồng và inbox. Đây là dữ liệu UI test, không phải bằng chứng nghiệp vụ ký/kích hoạt/phát hành/thu tiền thật.

## Chạy và đăng nhập

Tại root repository:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Initialize-MobileTestData.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Start-Api.ps1
```

Chỉ chạy dòng Start-Api nếu BE chưa chạy. Mở terminal khác cho FE:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Start-OcrMobileApp.ps1 -Clear
```

Launcher chọn IP LAN hiện hành và truyền `EXPO_PUBLIC_DEV_API_BASE_URL` vào Expo. Khi kiểm tra, IP là `192.168.1.15`, BE HTTPS `7240`, Metro mặc định `8081`. Không hardcode IP này nếu đổi Wi-Fi. Mobile Web chạy local chọn `https://localhost:7240`; Expo Go giữ LAN URL. Máy và điện thoại cần cùng mạng; thiết bị cần trust CA theo [IPHONE_CONNECTIVITY.md](IPHONE_CONNECTIVITY.md).

Đăng nhập bằng email:

- Owner: `owner.mobile.test@example.invalid`.
- Staff: `staff.mobile.test@example.invalid`.
- Tenant: `tenant.mobile.test@example.invalid`.

Mật khẩu chung được sinh ngẫu nhiên và lưu trong file **local riêng tư** `.tools/mobile-test/accounts.json`, trường `password`. File bị Git ignore và có ACL cho tài khoản Windows hiện tại. Không đưa nội dung file vào commit/báo cáo/log. Các tài khoản `.dev` cũ không bị đổi mật khẩu hoặc quyền.

## Dữ liệu đã tạo

- 1 cơ sở `BHOME MOBILE TEST`, 1 loại phòng, 1 phân công Staff hiệu lực.
- Phòng `M101` đang có Tenant và `M102` trống để bắt đầu onboarding.
- 1 Resident tổng hợp liên kết Tenant; trạng thái định danh Pending, không giả bằng chứng CCCD đã xác minh.
- 1 Main Contract Active gắn cờ `IsDevelopmentDemo`, không tiền cọc; fixture chỉ để test màn hình đọc và các ràng buộc, không phải hợp đồng có hiệu lực pháp lý hay minh chứng ký/activation thành công.
- 2 meter và 2 task Initial đang Assigned để test ghi số đầu vào bằng Staff; chưa có ảnh/baseline thật.
- 3 Operational Task: một việc Assigned tới hạn, một việc Assigned quá hạn, một việc PendingVerification cho Owner xác minh. Không bắt buộc ảnh để có thể thử luồng tiến độ/submit/verify.
- 3 hóa đơn tổng hợp của M101, mỗi hóa đơn 3.450.000 VND gồm phòng/điện/nước: 1 Final chưa trả chưa đến hạn, 1 Final chưa trả quá hạn, 1 Draft. Các kỳ khác nhau; Tenant có entitlement trên cả ba.
- 3 biểu phí tổng hợp và 3 inbox notification, mỗi vai trò một thông báo.

Hóa đơn và hợp đồng được seed trực tiếp bằng context dành cho fixture, giữ DB constraints. Snapshot số điện/nước là số tổng hợp, không tham chiếu meter reading đã xác nhận. Không dùng fixture này để nghiệm thu tính hóa đơn từ meter/scheduler hoặc ký/kích hoạt qua service.

Không seed bank account hoặc chuyển tiền thật. Chưa có receiving account ở cơ sở này nên QR/hướng dẫn chuyển khoản có thể báo chưa cấu hình; màn dư nợ và trạng thái Unpaid vẫn hoạt động. Lịch sử thanh toán và danh sách yêu cầu điều chỉnh ban đầu trống. Không seed ảnh CCCD, chữ ký, biên bản bàn giao hoặc bằng chứng giả mạo provider.

## Kiểm tra đã thực hiện

```powershell
. ./scripts/Use-LocalTools.ps1
node scripts/Test-MobileTestData.cjs
# Có thể dùng URL LAN hiện hành được ghi trong .tools/mobile-tls/lan-ip.txt:
node scripts/Test-MobileTestData.cjs https://192.168.1.15:7240
```

- Build seed: đạt, 0 warning/error.
- Seed chạy lại: `MOBILE_TEST_ALREADY_READY`, không reset dữ liệu đã thao tác.
- HTTPS smoke: 27 checks đạt trên localhost và 27 checks trên LAN; CA và hostname được xác thực, không tắt TLS verification. Login/Me cho ba role; task/meter/location Owner và Staff; contract/inbox; invoice/detail/payment/debts/adjustment list Tenant; Tenant bị 403 khi đọc operational task; refresh và CORS `http://localhost:8081`.
- Đã bundle source thật `src/mobile/src/lib/sessions.ts` cùng `MobileApi` vào thư mục ignored và chạy với global fetch/CA local: Owner, Staff đăng nhập đọc được 3 công việc; Tenant đọc được 3 hóa đơn qua HTTPS LAN. Phiên smoke đều logout. Đây là client transport live, chưa phải UI/device E2E.
- Mobile typecheck đạt; Mobile lint đạt; smoke script lint đạt.
- Mobile tests: 41 file / 396 tests đạt trong lượt này.
- Chưa mở Metro/Expo UI, chưa kiểm chứng camera, ảnh upload, PDF, QR, MySign thật, push/email hoặc thiết bị vật lý trong lượt này.

Các smoke expectation là baseline sau seed; nếu bạn đã tạo thêm việc/hóa đơn hay sửa dữ liệu fixture, cần đọc kết quả theo trạng thái mới, không reset để làm smoke xanh.

## Giới hạn an toàn và tính lặp lại

Seed chỉ chấp nhận môi trường Development, PostgreSQL loopback và database `bhome` Compact24 đã READY. Không tự recreate/archive database hoặc sửa `.env`. Fixture có UUID prefix riêng `b4040000`, transaction và advisory lock; tên/ID tài khoản xung đột bị từ chối. Nếu fixture đã tồn tại, xác nhận tài khoản và không ghi đè dữ liệu hoặc reset password. Ngày/giờ fixture lấy theo đồng hồ BE ở múi giờ nghiệp vụ; chạy lại không tự gia hạn assignment hay làm mới hạn task.

Source: `scripts/Initialize-MobileTestData.ps1`, `scripts/Test-MobileTestData.cjs`, `tools/BHome.LocalDevelopment/MobileTestSeed.cs`, `LocalDevelopmentCli.cs` và các domain/controller hiện hữu. Không thay đổi API contract hoặc code FE cho bộ seed này.
