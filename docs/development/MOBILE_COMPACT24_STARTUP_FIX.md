# Sửa khởi động API và Mobile — 06/11/2026

## Nguyên nhân

Database `bhome` local vẫn có Compact24 cũ (386 cột). API hiện tại yêu cầu schema
`compact24-2026-11-04-location-room` (383 cột), nên startup dừng tại
`property_upgrade_requires_explicit_command` trước khi Kestrel mở cổng. Vì vậy
Mobile nhận `ECONNREFUSED`, không phải lỗi trust CA hoặc frontend JavaScript.
`Update-LocalDatabase.ps1 -Check` đã xác nhận `PROPERTY_UPGRADE_REQUIRED`.

Có thêm hai vấn đề trong tooling: hướng dẫn Mobile đề xuất chạy lệnh mặc định thay
vì `-UpgradePropertySchema`; launcher chỉ kiểm tra cổng nên có thể tạo API thứ hai
khi Visual Studio đang pause trước khi bind. Đường `Prepare-OcrMobile` không dùng
`-SkipDatabase` vẫn gọi migration EF legacy, không tương thích Compact24 hiện tại.

Phạm vi: sửa local-development tooling theo schema đã có; không tạo business rule,
endpoint, migration hoặc model OCR mới. Giữ các ràng buộc GBR-01/02 và schema hiện hữu;
không thay đổi permissions, xác nhận Staff, invoice hoặc chính sách tài chính.

## Sửa code

- `scripts/Start-OcrMobileApp.ps1`: nhận diện API của checkout chưa mở cổng, chờ và
  chỉ tới Output của Visual Studio; không mở thêm hoặc dừng API đó. Hướng dẫn lỗi
  phân biệt connection refusal, property upgrade và archive legacy.
- `scripts/Prepare-OcrMobile.ps1`: chuẩn bị database qua công cụ Compact24 hiện có,
  không áp EF legacy vào database đang dùng. Giữ `-SkipDatabase` cho launcher Mobile.
- `scripts/Update-LocalDatabase.ps1`: thông báo đúng thao tác property upgrade;
  không nâng cấp hoặc xóa catalog tự động.
- `tests/scripts/MobileDevelopment.Tests.ps1`: kiểm tra debugger chưa bind,
  hướng dẫn property upgrade, forwarding mode và từ chối mode xung đột; sửa assertion
  cũ không còn khớp thông báo chọn một database operation.
- Cập nhật `LOCAL_DEVELOPMENT.md` và `MOBILE_NETWORK_DEVELOPMENT.md`.

## Xử lý database local đã được chấp thuận

Đã xác minh target là PostgreSQL native `localhost:5432/bhome`, không phải container
PostgreSQL ở cổng5433. Kiểm tra target ban đầu từ chối thao tác khi chưa đối chiếu
đúng cổng; chưa có thay đổi database trong lượt đó.

Backup custom-format đầy đủ và kiểm tra `pg_restore --list` trước khi ghi:
`.tools/startup-repair-20261106-191133.dump` (157.100 bytes), SHA256
`B4F83FD16C72FA6F9D8DCFFC5B7045D34A4723E055405FEA2ADF41BACBC60278`.
Backup chỉ nằm local, được Git ignore, không đưa vào commit.

Kiểm tra thấy catalog RoomType còn dữ liệu ở2 Location và liên kết ở6 Room.
Người dùng đã chấp thuận rõ ràng: **“Cho phép bỏ RoomType cũ sau backup”**.
Sau đó mới bỏ riêng các giá trị/link đã nghỉ dùng và chạy script có sẵn
`docs/database/2026-11-03/compact-24/UPGRADE_LOCATION_ROOM.sql` trong cùng transaction,
có lock/guard và rollback nếu lỗi. Không vô hiệu hóa trigger hoặc thay SQL guard.
Transaction COMMIT; các NOTICE về object chưa tồn tại là từ `DROP ... IF EXISTS`,
không phải upgrade failure.

Đối chiếu trước/sau: số bản ghi cả24 bảng giữ nguyên, gồm4 users,2 locations,
6 rooms,12 meters,8 billing policies,6 assets,3 residents và4 operational tasks.
Chỉ RoomType cũ được bỏ theo chấp thuận; không reset database hay tài khoản.
`-Check` và chạy lại `-UpgradePropertySchema` đều báo READY,24 bảng/383 cột/83 FK.

## Kiểm tra đã thực thi

| Check | Kết quả |
| --- | --- |
| `MobileDevelopment.Tests.ps1` | PASS88 assertions |
| Mobile Vitest: `expoStartup`, `mobileApiProbe`, `expoConnectivity` | PASS39 tests /3 files |
| `dotnet build src/backend/BHome.sln -c Release --no-restore` | PASS,0 warnings/errors |
| `Prepare-OcrMobile.ps1` không `-SkipDatabase` | PASS, Compact24 READY; không gọi EF legacy |
| `Update-LocalDatabase.ps1 -Check` | READY sau nâng cấp |
| `Update-LocalDatabase.ps1 -UpgradePropertySchema` chạy lại | READY, idempotent |
| `npm.cmd run mobile` thật | API và Metro khởi động, Expo online, QR được in |
| LAN HTTPS `/health/live`, `/health/ready` | HTTP200, TLS authorized=true |
| Anonymous `/api/v1/contracts` | HTTP401 |
| CA không tin cậy / sai hostname | Từ chối đúng `UNABLE_TO_VERIFY_LEAF_SIGNATURE` / `ERR_TLS_CERT_ALTNAME_INVALID` |
| `Test-ExpoMobile.cjs` | Exit0: Metro status và manifest iOS đúng LAN host |
| Tải launchAsset iOS từ manifest | HTTP200,8.019.667 bytes; Metro compile1.645 modules trong4.314 ms |
| Camera/iPhone thao tác thực | NOT RUN; kiểm tra từ máy tính không chứng minh phone connectivity |

Log/checks local: `.tools/startup-repair-{database-check,repeat-upgrade,prepare,script-tests,mobile-tests,api-probe,bundle-probe,backend-build}.log`.
Row counts: `.tools/startup-repair-{before,after}-counts.txt`; upgrade transaction:
`.tools/startup-repair-upgrade.log`. Models, credentials, backup và bundle không commit.

Đã dừng phiên API/Metro do lượt kiểm tra này tạo bằng Ctrl+C; các cổng7240/5240/8081
được giải phóng. Người dùng có thể F5 API trong Visual Studio rồi chạy
`npm.cmd run mobile` để dùng lại API đó, hoặc chỉ chạy `npm.cmd run mobile` để launcher
tự mở API. Nếu debugger còn dừng ở exception cũ, stop và F5 lại sau nâng cấp.
