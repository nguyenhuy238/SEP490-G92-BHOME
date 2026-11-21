# Expo Push cho Notification JOB-04

## Phạm vi

Adapter `ExpoPushSender` gửi **push thật** tới Expo Push Service bằng HTTPS,
nhận ticket từ `POST https://exp.host/--/api/v2/push/send`. `NotificationChannelWorker`
hiện có vẫn kiểm tra quyền nhận, trạng thái người dùng, mục tiêu thông báo và danh sách
thiết bị đã đăng ký trước khi gửi. Inbox và OUTBOX bền vững, unique event key, lease,
retry, `PendingReview` vẫn do worker xử lý. Không có schema/migration mới.

Phạm vi hiện tại: backend gửi và ghi nhận **Expo đã tiếp nhận** ticket có `status=ok`
và `id` hợp lệ. Ticket **không chứng minh** điện thoại đã hiển thị thông báo.
Expo khuyến nghị kiểm tra push receipt sau khoảng 15 phút để biết FCM/APNs nhận
thành công hoặc báo lỗi, ví dụ `DeviceNotRegistered`. Hệ thống chưa có job bền vững
tra receipt, vô hiệu hóa tự động push token sau receipt lỗi hoặc xác nhận đến máy.
Không diễn giải trạng thái `Sent`/receipt `expo-ticket:...` thành delivered-to-device.

Nguồn: https://docs.expo.dev/push-notifications/sending-notifications/

## Cấu hình backend

Mặc định `ExpoPush.Enabled=false` tại `src/backend/BHome.Api/appsettings.json`.
Thiếu cấu hình không được giả lập gửi thành công. Khi bật, startup kiểm tra
access token không trống và timeout trong khoảng 1–45 giây.

`NotificationChannels.AutomationEnabled=true` có sẵn trong appsettings để worker
thông báo nội bộ chạy đúng lịch, độc lập với `BillingAutomation.AutomaticJobsEnabled=false`.
`NotificationChannels.Enabled=false` mặc định nên worker không gửi EMAIL/PUSH/SMS ra
ngoài; nếu muốn bật delivery thật, sau khi review backlog phải đặt
`NotificationChannels.Enabled=true` riêng. Chỉ bật `AutomationEnabled=true`
trong môi trường có database và worker được vận hành chủ động.

```dotenv
NotificationChannels__Enabled=true
NotificationChannels__AutomationEnabled=true
NotificationChannels__Mode=Unconfigured
NotificationChannels__MaxAttempts=4
NotificationChannels__RetrySeconds=60
NotificationChannels__TimeoutSeconds=15
ExpoPush__Enabled=true
ExpoPush__TimeoutSeconds=15
```

Đặt `ExpoPush__AccessToken` qua secret store/runtime environment của **Backend**.
Không commit access token vào appsettings, .env, tài liệu, migration hoặc test.
Trong Development có thể dùng .NET User Secrets:

```powershell
dotnet user-secrets set 'ExpoPush:AccessToken' '<expo-access-token>' --project src/backend/BHome.Api
dotnet user-secrets set 'ExpoPush:Enabled' 'true' --project src/backend/BHome.Api
```

Đây là ví dụ thiết lập; không chạy lệnh trong CI hoặc khi chưa có secret do người
vận hành cấp. Trên Expo Dashboard, bật **Enhanced Push Security** và cấp access token
với quyền phù hợp. Adapter gửi header Bearer qua TLS; không ghi token hoặc phản hồi
provider dạng thô vào log. URL gửi cố định tại `exp.host`, không đọc từ input của user.

Để chạy JOB-04 độc lập với các job tài chính: giữ `Jobs.Enabled=false`, bật
`NotificationChannels.AutomationEnabled=true` để worker notification riêng
publish và xử lý thông báo. Nếu `Jobs.Enabled=true`, scheduler nền hiện hữu quản lý
notification. **Chỉ bật tự động gửi sau khi duyệt backlog**: outbox tồn đọng có
thể gửi đi ngay khi kênh trở nên configured.

EMAIL độc lập với PUSH: sử dụng `Email.Enabled=true`, STARTTLS và SMTP credential
theo [Gmail SMTP](GMAIL_SMTP.md). Chế độ `Sandbox` dành riêng Development/Testing
và có receipt `sandbox:...`; không dùng Sandbox để chứng minh gửi email/push.

## Thiết bị Mobile

API đăng ký đã có: `POST /api/v1/notifications/devices` với
`{ "pushToken": "ExpoPushToken[...]", "platform": "Android" }` hoặc `iOS`.
Lệnh phải được thực hiện qua phiên đăng nhập của chính user sau khi app xin phép
nhận thông báo. Token Expo lấy bằng
`expo-notifications.getExpoPushTokenAsync({ projectId })` trên app build có
FCM v1/APNs credentials hợp lệ. User có thể gỡ thiết bị qua endpoint DELETE hiện có.
Không đưa token vào telemetry, URL công khai hoặc log. **Mobile đã có thao tác đăng
ký push chủ động** trong màn Thông báo (`Bật thông báo đẩy`): chỉ xin quyền khi user
bấm, dùng `expo-notifications` để lấy Expo Push Token qua `Constants.easConfig.projectId`
(hoặc `extra.eas.projectId`) và gửi qua Mobile API đã xác thực. Không có EAS projectId,
trên web hoặc Expo Go, app hiển thị trạng thái chưa hỗ trợ và không gọi đăng ký.
Chỉ thử nghiệm thực tế trên development/production build với FCM v1/APNs được cấu
hình đúng; chưa có xác nhận end-to-end trên thiết bị/provider thật.

Mobile lưu **ID đăng ký thiết bị** (không lưu push token) trong Expo SecureStore kèm
user và API base URL. Nút `Tắt thông báo đẩy trên thiết bị này` gửi DELETE bằng phiên
đăng nhập của đúng user rồi xóa ID khi server xác nhận. Đăng xuất cũng thử DELETE
trước khi xóa phiên. Khi mạng lỗi, vẫn đăng xuất nhưng cảnh báo thiết bị có thể còn
nhận tin; giữ ID để có thể hủy lại khi đăng nhập đúng tài khoản, và không cho tài
khoản khác ghi đè đăng ký cũ trên máy dùng chung. Không tuyên bố đã tắt khi chưa có
xác nhận từ server.

Adapter backend chỉ chấp nhận `ExpoPushToken[...]`/`ExponentPushToken[...]`, không
nhận FCM/APNs native device token. Nếu không có thiết bị, outbox giữ kết quả lỗi
`destination_unavailable` theo worker; không giả lập đã gửi.

## Kết quả, retry, rủi ro

| Tình huống                                                          | Worker xử lý                                                            |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Expo 200, ticket `status=ok` có ID hợp lệ                           | `Sent`, reference `expo-ticket:<id>` (Expo accepted, chưa kiểm receipt) |
| Ticket `DeviceNotRegistered`, sai credential, payload quá lớn       | `PermanentlyFailed`, safe error code, không retry                       |
| HTTP 400/401/403/422                                                | `PermanentlyFailed`, không dùng nội dung lỗi thô                        |
| HTTP 429                                                            | `Pending` và bounded backoff theo worker (Expo từ chối vì rate limit)   |
| HTTP 5xx, timeout, mất kết nối, phản hồi 200 không có ticket hợp lệ | `PendingReview` do kết quả có thể đã được Expo nhận; không tự gửi lại   |
| Lease `Processing` hết hạn khi Expo provider không có idempotency   | `PendingReview` để Owner kiểm tra thủ công                              |
| Thiếu cấu hình Expo Push                                            | Kênh không configured, worker không gửi và không báo thành công giả     |

Khi một user có nhiều thiết bị, worker fanout từng thiết bị bằng khóa ổn định để
truy vết. Expo **không bảo đảm idempotency POST**; nếu xảy ra lỗi sau khi một thiết bị
đã nhận, hệ thống không tự retry phần chưa rõ. Tránh kích hoạt gửi lại thủ công khi
chưa kiểm tra trạng thái/thời gian đã gửi để hạn chế gửi trùng.

Để kiểm thử adapter mà không gửi mạng thật:

```powershell
dotnet test tests/backend/BHome.Infrastructure.UnitTests/BHome.Infrastructure.UnitTests.csproj --filter FullyQualifiedName~ExpoPushSenderTests --no-restore
```

Kiểm thử thực tế cần một app build trên thiết bị, user đã cấp permission, push token
đã đăng ký, credentials Expo/FCM/APNs đã được cấu hình và worker đã được bật có kiểm
soát. Không coi HTTP 200 hoặc ticket là bằng chứng hiển thị thông báo trên thiết bị.
