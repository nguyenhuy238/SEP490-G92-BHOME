# Tích hợp chức năng member/QHuy với develop — 20/11/2026

## Phạm vi và tiêu chí

Theo yêu cầu người dùng: giữ 9 commit đến `67db37a6`, dùng `origin/develop`
(`28ca4806`) làm chuẩn cho chức năng và cấu hình hiện có. Không push hoặc merge
vào develop trong lượt kiểm tra này. Nhánh sao lưu giữ nguyên lịch sử trước rà soát.

Truy vết: BF-01/02/07, BF-03/04 UC-18, FE-07/08 theo
[quyết định tích hợp](../architecture/INTEGRATED_LIFECYCLE_2026-11-16.md);
UC-01, GBR-01/02/04 và NFR cấu hình theo
[thiết lập môi trường của develop](BHOME_TEAM_ENVIRONMENT_SETUP.md).
Không thay đổi chính sách, phân quyền, trạng thái nghiệp vụ hoặc schema.

Tiêu chí: giữ các chức năng hồ sơ pháp lý, vòng đời/kiểm tra thiết bị, xác nhận
chỗ ở, theo dõi thuế, yêu cầu dữ liệu cá nhân và camera; giữ CI/CD, deployment,
API loader, thông số HTTPS/port, cấu hình nhà cung cấp của develop; chạy kiểm tra
hồi quy cho các luồng dùng chung và báo rõ giới hạn môi trường.

## Điểm không tương thích và xử lý

`Start-LocalPublicLinks.ps1` cũ tạo tunnel rồi ghi callback ngrok vào `.env` và
user-secrets. `EnvironmentConfiguration.Errors` trên develop từ chối những URL
này trong Development/Staging/Production, khiến API không khởi động được sau đó.

Giữ entry point tương thích nhưng chạy portal HTTPS localhost:5176 bằng cấu hình
Vite hiện có. Script không ghi file, không sửa user-secrets, không tạo tunnel,
không đổi URL nhà cung cấp. Internet callbacks dùng Staging theo runbook hiện tại.
Script từ chối profile hoặc process Staging/Production trước khi chạy frontend.

Proxy `/open/sign-contract` được giữ cùng `/api`; host, HTTPS, strictPort và kiểm
tra môi trường build giữ hành vi develop. CORS bổ sung giữ origin localhost:5176
và origin mobile; không sửa cấu hình CORS của Staging/Production.

## Kiểm chứng

| Kiểm tra đã chạy                                                                                                                          | Kết quả                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `dotnet build src/backend/BHome.sln -c Release --no-restore`                                                                              | PASS, 0 warning/error                                                                      |
| Domain/Application/Infrastructure unit tests, Release, `--settings tests/backend/ci.runsettings`                                          | PASS: 115 + 650 + 84 = 849                                                                 |
| `npm test -- --maxWorkers=2`                                                                                                              | PASS: Owner Web 826/826, Mobile 1418/1418                                                  |
| `npm run lint` và `npm run typecheck --workspace ./src/mobile`                                                                            | PASS                                                                                       |
| `VITE_API_BASE_URL=https://api.example.com`, `npm run build`                                                                              | PASS client-core, Owner Web, Public Web; cảnh báo chunk lớn ở Owner Web                    |
| `npm run format:check` và `git diff --check`                                                                                              | PASS                                                                                       |
| Integration filter `Category=CompactPostgres\|FullyQualifiedName~PersistenceCompositionTests\|FullyQualifiedName~EnvironmentStartupTests` | 451 PASS, 1 FAIL, 2 SKIP trên PostgreSQL 18 disposable                                     |
| Integration filter `FullyQualifiedName~MobileWebCorsTests`                                                                                | PASS 7/7                                                                                   |
| `powershell -NoProfile -ExecutionPolicy Bypass -File tests/scripts/LocalCallbackLauncher.Tests.ps1`                                       | PASS: HTTPS, giữ file/secrets, chặn deployment, dọn override khi lỗi                       |
| `powershell -NoProfile -ExecutionPolicy Bypass -File tests/scripts/TeamEnvironment.Tests.ps1`                                             | PASS: profile độc lập, không ghi đè, callback/key local                                    |
| `node --test tests/scripts/WebEnvironment.test.mjs`                                                                                       | PASS: HTTP/HTTPS portal, TLS-verified API và signing redirect proxy, 4 SPA callback routes |
| `.tools/yolo-python/python.exe -m unittest discover -s tests/deployment -p 'test_*.py' -v`                                                | PASS 15/15                                                                                 |
| `node --test tests/deployment/*.test.cjs`                                                                                                 | PASS 16/16                                                                                 |

### Lỗi được đối chiếu với develop

`SharedTemplateNamesRemainReservedAfterArchiveAndNormalizeWhitespace` kỳ vọng
409 nhưng nhận 200 khi tên tiếng Việt viết hoa/thường được so sánh trên database
có `LC_CTYPE=C`. Đã checkout riêng chính xác `origin/develop` (`28ca4806`), build
và chạy cùng test trên cùng PostgreSQL: **develop cũng FAIL cùng assertion tại
dòng 195**. Probe SQL trên cluster này trả false cho so sánh `lower` hai tên
tiếng Việt chỉ khác kiểu chữ. Đây là lỗi tái hiện trên baseline trong môi trường
này; không sửa logic tên/cấu hình database của develop trong phạm vi tích hợp.

Hai test OCR thực bỏ qua vì chưa bật điều kiện model theo fixture. Docker Linux
daemon không chạy nên chưa thực thi bộ Docker/PostgreSQL 16/MinIO/LibreOffice
đầy đủ theo CI. PostgreSQL 18 ở đây được khởi tạo mới trong `.tools`, chỉ chứa dữ
liệu tổng hợp; không dùng `.env`, secrets hoặc database làm việc. Chưa kiểm thử
camera trên thiết bị Android/iOS hoặc provider thật trong lượt này.

TRX, log integration và log baseline lưu tại
`.tools/merge-compatibility-16a9d85b87404d438f84f4e8f21e9dec/` (bị Git bỏ qua).
CI/CD, Docker/VPS, `.env.staging.example`, `.env.production.example`,
`appsettings*.json` và `scripts/Start-Api.ps1` không có diff so với develop.
Không có migration mới. Chưa đủ căn cứ tuyên bố toàn bộ CI xanh; cần CI chuẩn
và review của thành viên khác trước khi merge PR.
