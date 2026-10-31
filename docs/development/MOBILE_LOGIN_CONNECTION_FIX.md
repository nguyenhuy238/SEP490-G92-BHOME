# Lỗi kết nối API khi đăng nhập iPhone — 31/10/2026

## Phạm vi và nguồn

FE-02 / UC-01, GBR-01/02/13, NFR HTTPS/TLS và khả năng chẩn đoán kết nối.
Đã đối chiếu `AGENTS.md`, `src/mobile/AGENTS.md`, SRS
`BHome_Report-3_Software Requirement Specification (2).docx` (master UC, Authentication,
GBR, NFR), `Report-4_Software Design Specification (5).docx` (HTTPS và xác thực),
`docs/api/API_CONVENTIONS.md`, tài liệu mạng/iPhone và mã nguồn/test hiện có.
Không có quyết định nghiệp vụ mới hoặc xung đột chính sách cần giải quyết.

| Yêu cầu            | Thành phần                                        | Tiêu chí chấp nhận                                                                          |
| ------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| UC-01, NFR kết nối | Start-ExpoMobile → Start-OcrMobileApp → API/Metro | Lệnh mặc định Windows chuẩn bị TLS, mở/dùng lại API và chỉ mở Metro sau readiness 200       |
| NFR HTTPS/TLS      | Prepare-OcrMobile, Kestrel                        | SAN khớp IP hiện tại, giữ CA; CA sai hoặc hostname sai vẫn bị từ chối                       |
| GBR-01/02          | Auth API và client hiện có                        | Credential sai trả 401; endpoint riêng tư anonymous trả 401; không đổi quyền/JWT            |
| NFR integrity      | DatabaseUpgrade và migration hiện có              | Sao lưu local trước nâng cấp; transaction commit thành công và không còn pending migrations |

## Nguyên nhân kiểm chứng trên máy

1. Ban đầu không có listener ở 7240/5240. `npm start` của mobile trước sửa chỉ chạy Metro,
   nên việc tải được màn hình đăng nhập không chứng minh API BHOME đã chạy.
2. Sau khi mở API, probe xác minh CA trả `ERR_TLS_CERT_ALTNAME_INVALID`.
   LAN hiện tại là `10.33.59.31`; `.tools/mobile-tls/lan-ip.txt` vẫn ghi `192.168.0.106`.
   Chứng chỉ local chưa được chuẩn bị lại theo mạng mới. Không có HTTP response ở bước TLS lỗi.
3. Sau khi sửa TLS, `/health/ready` trả 503; log health check xác nhận
   `Database migrations pending.` Database local thiếu
   `20261030074118_UnifiedOperationalTasks` có sẵn trong repo.

Ảnh chụp chỉ chứng minh lỗi transport ở client; không đủ phân biệt mất mạng, server tắt
hay lỗi tin cậy CA trên iPhone. Các nguyên nhân trên được xác minh riêng từ máy phát triển.
Không kết luận sai mật khẩu và không quy lỗi cho `OcrController.cs` từ thông báo đăng nhập.

## Thay đổi và thao tác local

- `scripts/Start-ExpoMobile.cjs`: lệnh mặc định Windows dùng supervisor hiện có, giữ chọn
  Node 22, chuyển `--clear`/`-c`, `--port`/`-p`/`--port=...` sang tham số PowerShell.
  Từ chối cổng sai; trả đúng exit code. `--check`/`--help` giữ hành vi cũ.
- `scripts/Start-OcrMobileApp.ps1`: gọi lại launcher với `--metro-only` để tránh đệ quy;
  giữ kiểm tra HTTPS readiness, theo dõi đổi Wi-Fi và quản lý process do nó tạo.
- Các tùy chọn Expo khác dùng `--metro-only` và tự chuẩn bị API; chế độ này vẫn kiểm tra
  Expo online/tài khoản. Non-Windows giữ cách chạy Metro trước đó.
- Bổ sung regression ở `tests/mobile/ocr/expoStartup.test.ts` và
  `tests/scripts/MobileDevelopment.Tests.ps1`; cập nhật README/tài liệu khởi động.
- Đã chạy `Prepare-OcrMobile.ps1 -SkipDatabase`, cập nhật leaf certificate và Development
  User Secrets, giữ CA hiện có; khởi động lại API do phiên này tạo. Không đổi trust store/firewall.
- Đã sao lưu database loopback `bhome` bằng `pg_dump --format=custom` vào
  `.tools/mobile-repair-20261031-before-upgrade.dump` (ignored, chỉ lưu local).
  Chạy `scripts/Update-LocalDatabase.ps1`: 1 migration áp dụng atomically, không còn pending.
  Đối chiếu trước/sau: 3 users, 3 roles, 0 tasks, 0 contracts; không xuất bản ghi cá nhân.
  Không tạo migration mới, reset DB, seed tài khoản hoặc thay mật khẩu.

## Kiểm chứng

Các lệnh npm được chạy bằng Node 22.23.4 thông qua `Use-LocalTools.ps1`.

| Lệnh/kiểm tra                                                                                               | Kết quả                                                                                       |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `npm.cmd run test --workspace src/mobile`                                                                   | PASS 153/153, 12 files                                                                        |
| `npm.cmd run typecheck --workspace src/mobile`                                                              | PASS                                                                                          |
| `npm.cmd run lint --workspace src/mobile`                                                                   | PASS                                                                                          |
| `npm.cmd exec -- eslint scripts/Start-ExpoMobile.cjs tests/mobile/ocr/expoStartup.test.ts --max-warnings 0` | PASS                                                                                          |
| `powershell -NoProfile -ExecutionPolicy Bypass -File tests/scripts/MobileDevelopment.Tests.ps1`             | PASS 26 assertions                                                                            |
| `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Update-LocalDatabase.ps1`                      | PASS, 1 migration, transaction committed                                                      |
| `node scripts/Diagnose-MobileApi.cjs https://10.33.59.31:7240 .tools/mobile-tls/root-ca.cer`                | PASS: live/ready 200, Contracts anonymous 401, TLS authorized; CA sai/hostname sai bị từ chối |
| `npm.cmd run mobile -- --clear`                                                                             | Luồng mặc định mở API và Metro; iOS manifest 200, đúng host LAN và có Expo Go identity        |
| POST login qua HTTPS, tài khoản tổng hợp không tồn tại                                                      | 401 đúng; không dùng credential của tài khoản thật                                            |

`dotnet test tests/backend/BHome.IntegrationTests/BHome.IntegrationTests.csproj --artifacts-path .tools/mobile-login-tests --filter FullyQualifiedName~LoginApiTests --verbosity minimal`:
PASS 11/11; build các project phụ thuộc và API thành công. Prettier cho launcher/test và
`git diff --check`: PASS.

Lượt regression đầu có một assertion đường dẫn dùng `/` trên Windows; đã sửa cho cả hai kiểu
separator rồi chạy lại toàn bộ mobile suite PASS. Lệnh Vitest trực tiếp từ root dùng sai root
config không tìm thấy test; kết quả hợp lệ là lệnh workspace ở bảng trên.
Lượt backend login test đầu bị API đang chạy khóa DLL (MSB3026/MSB3021);
lượt tiếp theo dùng thư mục artifacts riêng để tránh ghi vào binary đang phục vụ.

## Sử dụng trên iPhone và giới hạn

Mở lại Expo Go bằng manifest mới `exp://10.33.59.31:8081` khi ở cùng LAN.
Kiểm tra Safari `https://10.33.59.31:7240/health/ready`: phải Healthy và không cảnh báo TLS.
Nếu chưa tin cậy CA của máy, làm theo [checklist iPhone](IPHONE_CONNECTIVITY.md#chạy-trên-windows-và-iphone).
Lần sau chạy `npm.cmd run mobile` ở root hoặc `npm.cmd start` trong `src/mobile` và giữ terminal mở.
`npm.cmd run mobile:dev` vẫn hoạt động; đổi Wi-Fi thì quét QR mới.

Chưa thao tác trên iPhone vật lý: CA trust, quyền Local Network và router client isolation
vẫn cần xác minh trên thiết bị. Chưa xác minh đăng nhập thành công bằng tài khoản thật.
Không chạy toàn bộ backend/Docker integration suite; Docker Desktop hiện chưa chạy.
Không thay nghiệp vụ, quyền server, OCR controller hoặc cơ chế TLS validation.
