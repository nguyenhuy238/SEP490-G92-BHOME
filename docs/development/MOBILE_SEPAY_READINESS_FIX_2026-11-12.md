# Mobile startup bị chặn bởi schema readiness — 12/11/2026

## Yêu cầu và nguyên nhân

Người dùng cung cấp log `npm.cmd run mobile` và yêu cầu kiểm tra/sửa. TLS/live đã PASS,
contracts anonymous trả 401 đúng; `/health/ready` trả 503. BF-06/GBR-10/18, NFR availability,
Report 4 persistence và migration SePay có sẵn là phạm vi ảnh hưởng.

Read-only DatabaseProbe xác định runtime dùng Neon development (role DML bhome_dev01), 24 bảng,
8 applied / 1 pending / 0 unknown. Thiếu `20261112000100_SePayIntegration`, trong khi backend
mong schema `compact24-2026-11-12-sepay`. Lỗi này không phải Gmail password, CA, IP hoặc Expo.
Mobile launcher cố ý dừng khi readiness chưa đạt để tránh chạy app với schema chưa đồng bộ.

Yêu cầu sửa hiện tại được áp dụng cho migration cụ thể này trên development endpoint allowlist;
không coi đó là phê duyệt các migration tương lai hoặc production. Đã review migration SQL:
thêm indexes/functions/triggers và cho phép allocation actor null chỉ với provider đã xác minh;
không DROP/TRUNCATE bảng hoặc cập nhật/xóa business rows. Giữ runtime credential/quyền DML.

## Chuẩn bị và kiểm chứng trước apply

- Branch member/QHuy, working tree sạch khi bắt đầu.
- Đối chiếu runtime pooled profile `.env` và operator direct `.env.neon` cùng development endpoint;
  VerifyFull/ChannelBinding.Require, không in password/connection string.
- Backup PostgreSQL custom-format bằng client 18; `pg_restore --list` PASS;
  mã hóa DPAPI CurrentUser và kiểm chứng decrypt/hash, xóa plaintext dump.
- Snapshot count/digest read-only của 24 bảng để so sánh sau migration; không đưa dữ liệu thực vào tests/log công khai.
- Backup/review SQL/private logs ở `.tools/mobile-readiness-sepay-20261112-191446/` (Git ignored).
- 13 test SePay + baseline upgrade trên PostgreSQL disposable passed, không fail/skip; gồm bảo toàn
  dữ liệu tổng hợp, upgrade/replay và strict schema readiness.
- Lượt Debug test đầu bị MSB3021/MSB3027 vì Visual Studio/API giữ DLL; chạy lại Release thành công,
  không dừng debugger/API hoặc nới kiểm tra schema/TLS.

## Sửa thông báo khắc phục

`scripts/Start-OcrMobileApp.ps1` trước luôn gợi ý Update-LocalDatabase, nhưng script local
từ chối Neon. Thông báo mới hướng tới read-only Test-Database trước, phân biệt Neon operator
migration với loopback/property upgrade. Giữ nguyên readiness gate, TLS checks và quy tắc không
khởi chạy API thứ hai khi Visual Studio đang giữ process.
Thêm kiểm tra lại cổng Metro ngay trước Start-Process: certificate/API probes có thể mất thời gian,
trong lúc đó terminal khác đã mở Metro. Dừng bằng hướng dẫn rõ ràng thay vì đè lên instance đó.

## Kết quả sau sửa

- Áp đúng migration SePay còn thiếu bằng `Update-NeonDatabase.ps1 -Apply`, profile operator direct,
  cấu hình Release; exit 0. Không sửa/xóa history, không reset/reseed hoặc thay connection runtime.
- SQL review SHA-256: `04EEAE06042E2EC47D321A24813DDB79C74146D13B63DB003018ECDF3F9101A4`.
- Đối chiếu count/digest trước/sau: **24/24 bảng không thay đổi hàng dữ liệu** trong khoảng kiểm tra.
- Runtime read-only probe: Compact24 PASS, **9 applied / 0 pending / 0 unknown**;
  RuntimeEFQuery PASS với tenant_records_read=0.
- API Visual Studio hiện có: `/health/live` 200, `/health/ready` **503 → 200**,
  `/api/v1/contracts` anonymous 401. TLS authorized=true; CA sai và hostname sai vẫn bị từ chối.
- Mobile launcher PowerShell syntax validation PASS; 19 Expo startup tests PASS trên Node 22.
- Chạy lại chính `npm.cmd run mobile`: qua readiness và tới bước Metro. Trong lượt kiểm tra,
  người dùng đồng thời mở Metro từ terminal VS Code; instance kiểm tra thứ hai gặp EADDRINUSE.
  Đã đối chiếu process ancestry, giữ nguyên Metro của terminal người dùng và thêm port recheck.
  Probe riêng `/status` và iOS manifest của Metro hiện tại ở `192.168.1.242:8081` PASS.

Không khẳng định iPhone đã kết nối/chạy JS chỉ từ desktop probes. Không push/merge hoặc commit
secrets, backup, snapshot/private logs. Runtime role vẫn bhome_dev01, không dùng operator làm runtime.

## Readiness sau khi đồng bộ schema

Các lần probe tiếp theo có timeout trong khi live vẫn 200. Schema verifier cũ đọc function bodies
bằng một truy vấn remote cho mỗi function. Đã gộp thành một truy vấn catalog cho tất cả function
bắt buộc, vẫn so khớp toàn bộ body, columns/FK/triggers/indexes và không cache/bỏ qua schema mismatch.
Function trùng tên không rõ ràng bị từ chối thay vì chọn một body tùy ý.

Thêm regression trong RuntimeSchemaUpgradeTests: schema chuẩn PASS; thay body guard SePay trong
transaction → readiness FALSE; rollback → PASS. Sau thay đổi, 17 test schema/persistence/SePay
trên PostgreSQL disposable đều PASS. Release DatabaseProbe trên Neon cũng PASS, 9 applied/0 pending,
không đọc Tenant records. Không lấy thời gian startup của CLI làm số đo latency API/SLA.

API Debug vẫn được Visual Studio giữ DLL cũ; cần dừng/chạy lại debug để nạp code mới. Đã yêu cầu
người dùng restart chính phiên Visual Studio thay vì kill debugger hoặc khởi động API thứ hai.

Sau phản hồi restart, Visual Studio build thành công nhưng đang ở Design mode và chưa có API
lắng nghe. Đã dùng computer-use khởi chạy đúng startup project BHome.Api qua F5; xác nhận cửa sổ
Running và process API mới. Trên phiên mới, live/ready đều 200, anonymous contracts 401,
TLS negative checks PASS; **3/3 probe khởi động 2,5 giây mặc định PASS**. Không tăng timeout
hoặc bỏ kiểm tra body Healthy để làm test qua.

Kiểm tra cuối `npm.cmd run mobile -- --port 8082` PASS toàn luồng: dùng API Visual Studio hiện có,
qua readiness, Metro Running và iOS manifest đúng host. Đã dừng riêng phiên Metro kiểm thử 8082;
giữ API Visual Studio chạy để người dùng khởi động Mobile trong terminal của mình. Không nâng
Expo/package theo thông báo update trong log vì không liên quan lỗi này.
