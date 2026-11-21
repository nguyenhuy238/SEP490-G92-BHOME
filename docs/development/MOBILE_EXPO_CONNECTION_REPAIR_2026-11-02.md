# Khôi phục kết nối Expo Go ngày 02 tháng 11 năm 2026

**Trạng thái:** người dùng xác nhận kết nối được sau khi cho máy tính dùng hotspot
iPhone. Đường truyền trên Wi-Fi `Phòng 2` vẫn chưa được khắc phục. Kết quả đối
chiếu cho thấy hạn chế nằm ở môi trường mạng cũ; chưa đọc cấu hình router để xác
nhận chính xác AP/client isolation hay nguyên nhân mạng khác. Xem phần xác nhận
hotspot ở cuối tài liệu để phân biệt các kết quả theo từng lần kiểm tra.

## Phạm vi

Người dùng xác nhận lỗi xuất hiện khi quét QR và Expo Go không tải được ứng dụng.
Đối chiếu `AGENTS.md`, `src/mobile/AGENTS.md`, các launcher hiện có và hướng dẫn
`EXPO_STARTUP_FIX.md`, `IPHONE_CONNECTIVITY.md`.

Truy vết: NFR môi trường phát triển/kết nối và HTTPS; FE-02/UC-01, GBR-01/02/13.
Không thay đổi nghiệp vụ, API contract, role hoặc cơ chế xác thực. Đây là khôi phục
môi trường chạy; chưa cần sửa mã ứng dụng.

## Nguyên nhân đã kiểm chứng

- Không có listener Metro tại 8081 khi bắt đầu. Vì vậy QR trỏ vào Metro cũ không
  thể tải manifest/bundle dù API vẫn hoạt động.
- IP Wi-Fi của máy hiện tại là `192.168.0.106`. `.env.local` của Mobile vẫn chứa
  IP cũ `10.33.59.31`, nhưng launcher và `resolveApiEndpoint` hiện có ưu tiên
  địa chỉ development/host của Metro. Không cần hardcode IP mới vào mã nguồn.
- API LAN `https://192.168.0.106:7240` trả live/ready 200 với CA development hợp lệ;
  Contracts vô danh trả 401. Chứng chỉ sai CA/hostname bị từ chối đúng.
- Kestrel dùng SNI: localhost có thể nhận chứng chỉ ASP.NET riêng; client LAN nhận
  chứng chỉ Mobile CA. Probe localhost bằng Mobile CA không chứng minh LAN TLS lỗi.
- Kiểm tra chi tiết firewall xác nhận các rule của API và Node 22 local đều Allow
  trên profile Public. Không thay firewall hoặc trust store. Nhận định ban đầu
  trong trao đổi rằng các rule này đang chặn đã được đính chính.

## Đã thực hiện

1. Chạy `Start-ExpoMobile.cjs --check`: Expo online, CLI xác nhận tài khoản `bhome`.
2. Khởi động supervisor hiện có `scripts/Start-OcrMobileApp.ps1 -Clear -Port 8081`
   ở background với cửa sổ ẩn, log trong `.tools/mobile-connection-repair-20261102`.
3. Supervisor tái sử dụng API đang chạy, đồng bộ cấu hình Development theo quy
   trình sẵn có, xác minh API LAN rồi mở Metro bằng Node 22.23.4.
4. Metro dùng `exp://192.168.0.106:8081`; API development dùng
   `https://192.168.0.106:7240`. Supervisor tiếp tục chạy để giữ Metro hoạt động
   và xử lý đổi Wi-Fi theo logic đã có.
5. Tạo QR mới `expo-qr.png`/`expo-qr.svg` trong thư mục log bằng thư viện `toqr`
   đã có của Expo. Không thêm dependency.
6. Yêu cầu manifest và tải bundle thật cho iOS/Android; chỉ ghi trạng thái/kích
   thước, không ghi source bundle, password hoặc token.

Không chạy migration, seed/reset dữ liệu, đổi mật khẩu hoặc dừng API/debugger
của người dùng. File `.env.local` cũ được giữ nguyên vì launcher tự chọn endpoint.

## Kiểm chứng đã thực thi

| Kiểm tra                                 | Kết quả                                                    |
| ---------------------------------------- | ---------------------------------------------------------- |
| Expo online và CLI account               | PASS, tài khoản `bhome`                                    |
| API qua LAN với CA development           | live 200, ready 200, Contracts vô danh 401; TLS authorized |
| CA không tin cậy và hostname sai         | PASS, đều bị từ chối                                       |
| Metro `/status`                          | HTTP 200, `packager-status:running`                        |
| `Test-ExpoMobile.cjs 192.168.0.106 8081` | PASS, status và manifest iOS đúng host                     |
| Manifest iOS                             | HTTP 200, host `192.168.0.106:8081`, username `bhome`      |
| Bundle iOS                               | HTTP 200, 7.974.519 bytes, JavaScript                      |
| Manifest Android                         | HTTP 200, host và username đúng                            |
| Bundle Android                           | HTTP 200, 7.952.287 bytes, JavaScript                      |
| Mobile typecheck                         | PASS                                                       |
| Mobile lint                              | PASS                                                       |

Các lượt tải bundle trên được thực hiện từ máy tính qua LAN IP. Chưa thể dùng
kết quả này để khẳng định Expo Go trên điện thoại đã mở thành công. Đã gửi QR mới
và người dùng xác nhận iPhone vẫn không truy cập được Metro. Kiểm tra tiếp cho
thấy Metro đang chạy đúng Node 22, các rule Allow tương ứng có hiệu lực, không có
rule inbound Block được trả về và chưa quan sát thấy kết nối điện thoại tới 8081.

## Thao tác trên điện thoại

- Điện thoại và máy tính cùng Wi-Fi/LAN; mở QR mới hoặc
  `exp://192.168.0.106:8081` trong Expo Go. Không dùng QR lưu từ mạng trước.
- Nếu là iPhone, tài khoản Expo Go phải khớp CLI `bhome`; tài khoản Expo khác với
  tài khoản Owner/Staff/Tenant của BHOME.
- Nếu vẫn không tải, mở `http://192.168.0.106:8081/status` trong trình duyệt điện
  thoại. Phải hiện `packager-status:running`. Nếu không tới được, kiểm tra Local
  Network permission của Expo Go và việc router có chặn thiết bị ngang hàng.
- Khi ứng dụng đã mở, kiểm tra API riêng bằng
  `https://192.168.0.106:7240/health/ready`. Với iPhone, CA cài thủ công cần được
  bật trust SSL/TLS theo hướng dẫn trong `IPHONE_CONNECTIVITY.md`.

Trong lần chạy thông thường từ repo root, dùng `npm.cmd run mobile -- --clear`.
Lệnh mở supervisor để giữ API/Metro; không chạy thêm launcher nếu 8081 đang có
Metro của phiên này. Giữ terminal chạy khi demo; đóng Metro làm QR không tải được.

## Artifact local

`.tools/mobile-connection-repair-20261102/` được Git ignore, chứa:

- `supervisor.pid`, `supervisor.stdout.log`, `supervisor.stderr.log`.
- `live-proof.json`, `typecheck.log`, `lint.log`.
- `expo-qr.png`, `expo-qr.svg` và script kiểm tra/tạo QR dùng cho lần sửa này.

Không tự khởi động sau khi reboot Windows. Địa chỉ trong tài liệu là snapshot của
mạng hiện tại; nếu đổi Wi-Fi hãy dùng URL/QR mới do launcher in ra.

## Chẩn đoán bổ sung sau khi thử trên iPhone

Người dùng cung cấp ảnh: iPhone kết nối Wi-Fi `Phòng 2`, IPv4 `192.168.0.105`,
mask `255.255.255.0`, gateway `192.168.0.1`; Expo Go báo `The request timed out`.
Safari trên iPhone không mở được Metro `/status`.

Máy tính cũng kết nối SSID `Phòng 2`, IPv4 `192.168.0.106/24`, cùng gateway.
Kiểm tra mới:

- Router trả lời ping dưới 1 ms, neighbor `192.168.0.1` là `Reachable`.
- Ping iPhone không thành công, có `Destination host unreachable` từ máy tính;
  neighbor `192.168.0.105` là `Unreachable`.
- Metro vẫn nghe 8081; chương trình Node 22 khớp rule inbound Allow/Public,
  rule có PrimaryStatus `OK`. Không có yêu cầu IPsec theo filter đã kiểm tra.

Các kết quả cho thấy đường truyền ngang hàng chưa hoạt động; không chỉ dựa vào
ping ICMP bị mất để kết luận. Có khả năng AP/client isolation hoặc hạn chế thiết
bị/mạng, nhưng chưa đọc cấu hình router để xác nhận nguyên nhân cuối.

Đề xuất thử máy tính kết nối hotspot iPhone để cô lập lỗi mạng. Người dùng không
cần gửi mật khẩu hotspot. Chưa thay firewall, bật tunnel công khai hoặc sửa router.
Nếu người dùng quản trị router, chỉ kiểm tra thiết lập isolation sau khi xác nhận
phạm vi; không tự tắt cơ chế cô lập của mạng dùng chung.

## Xác nhận khi chuyển sang hotspot iPhone

Người dùng trả lời: “kết nối máy tính vào hotspot iPhone thì kết nối được”.
Máy tính nhận IP `172.20.10.4/28`; launcher đã cập nhật chứng chỉ cho IP mới,
giữ nguyên Mobile CA đã có. API qua `https://172.20.10.4:7240` được kiểm tra lại:

- live/ready HTTP 200 với TLS authorized; chứng chỉ có SAN IP `172.20.10.4`.
- Contracts vô danh HTTP 401; CA không tin cậy và hostname sai tiếp tục bị từ chối.
- Việc tải được từ điện thoại là xác nhận của người dùng; chưa suy ra toàn bộ
  đăng nhập hoặc nghiệp vụ trên thiết bị đã được nghiệm thu.

Trong lượt kiểm tra sau đổi mạng, Metro không phản hồi probe rồi tiến trình không
còn lắng nghe. Không ghi lượt đó là PASS. Đã mở lại launcher hiện có trên mạng
hotspot, log riêng `hotspot.stdout.log` và `hotspot.stderr.log` trong thư mục
artifact của lần sửa. Không thay đổi logic ứng dụng để vượt qua hạn chế LAN.

Kiểm tra cuối xác nhận máy tính đã quay lại SSID `Phòng 2`, IP `192.168.0.106`.
Launcher chọn đúng IP mạng này và probe Metro tại `192.168.0.106:8081` PASS.
Các probe còn dùng IP hotspot `172.20.10.4` bị timeout sau khi địa chỉ đó không
còn được gán; không dùng chúng để kết luận Metro hoặc API hỏng. Kết quả API
hotspot 200 nêu trên thuộc thời điểm máy tính còn nối hotspot.

Để tiếp tục demo, giữ hotspot hoạt động và Metro chạy. Nếu khởi động lại thủ công,
dùng `npm.cmd run mobile -- --clear` từ repo root và giữ terminal đó mở; lấy QR mới
từ terminal. Nếu quay về Wi-Fi `Phòng 2`, cần quản trị viên mạng kiểm tra hạn chế
giao tiếp giữa thiết bị; chưa tự thay cấu hình router.
