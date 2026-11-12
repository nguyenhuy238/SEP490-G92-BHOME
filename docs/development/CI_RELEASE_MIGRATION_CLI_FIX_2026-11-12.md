# Khắc phục CI Release: Compact24 migration CLI

## Phạm vi và đối chiếu

- Yêu cầu: sửa lỗi CI trong [run 43082906771, backend](https://github.com/nguyenhuy238/SEP490-G92-BHOME/actions/runs/43082906771/job/130739803902).
- Nguồn: log job do người dùng cung cấp; `.github/workflows/ci.yml`; `src/backend/BHome.sln`; integration project và `Compact24MigrationTests`; `AGENTS.md` mục 9–10 về build, regression và bằng chứng kiểm thử.
- Đây là sửa cấu hình build và test harness; không thay đổi BF/UC/GBR/DBR/JOB, API, quyền, schema hoặc quy tắc migration.
- Acceptance: build solution Release tạo CLI Release; CLI thực hiện inspect/copy trên database disposable và từ chối tên database làm việc trước khi kết nối; giữ nguyên các assertion đối chiếu dữ liệu. Chạy lại các bước backend/frontend của CI.

## Nguyên nhân và thay đổi

`BHome.Compact24Migration` được integration project tham chiếu với `ReferenceOutputAssembly="false"` nhưng chưa được khai báo trong solution. Build solution Release thực tế tạo CLI trong `bin/Debug/net8.0`. Test chọn `bin/Release/net8.0` theo cấu hình testhost, nên tiến trình `dotnet` không chạy được CLI; việc đọc JSON sau đó ném `FileNotFoundException` và che nguyên nhân thiếu executable. Máy local có artifact Release từ lượt build project riêng có thể không phát hiện lỗi này.

- `src/backend/BHome.sln`: thêm migration CLI vào nhóm Tools, khai báo cả Debug/Release.
- `tests/backend/BHome.IntegrationTests/Compact24/Compact24MigrationTests.cs`: kiểm tra DLL trước khi chạy, kiểm tra báo cáo sau khi tiến trình kết thúc, dùng JSON riêng cho từng invocation và dọn trong `finally`. Không xuất connection string hoặc stdout/stderr vào thông báo lỗi.
- `.github/workflows/ci.yml`: dùng `actions/setup-dotnet@v5`, vẫn cài .NET 8; [action chính thức dùng Node.js 24](https://raw.githubusercontent.com/actions/setup-dotnet/v5/action.yml), xử lý cảnh báo Node.js 20 của v4.
- `BHOME_NQH_FULL_IMPLEMENTATION_AUDIT_2026-11-10.md`: file audit có sẵn, chưa được Git theo dõi, không đạt Prettier nếu được thêm vào commit. Chỉ định dạng Markdown; kiểm tra AST trước/sau xác nhận nội dung và cấu trúc không đổi khi bỏ vị trí source. File audit untracked còn lại được giữ nguyên.

## Bằng chứng kiểm tra

Đã tái hiện đúng test lỗi trên Linux trước sửa: `OfflineCliInspectsAndCopiesAndRejectsLiveDatabaseNameBeforeConnecting` FAIL với `FileNotFoundException` khi đọc báo cáo JSON. Build log xác nhận CLI chỉ có Debug trong khi testhost là Release.

Sau sửa, build Release trên Linux tạo đúng CLI Release, 0 warning/error. Test lỗi chạy riêng PASS, bao gồm inspect, copy/reconcile và từ chối tên database làm việc. Lượt full cuối hoàn tất với `tests=0 format=0 signing=0`:

| Kiểm tra backend trên Linux                                                                                                                                                  | Kết quả                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `dotnet restore src/backend/BHome.sln`                                                                                                                                       | PASS                                                                                                       |
| `dotnet build src/backend/BHome.sln -c Release --no-restore`                                                                                                                 | PASS, CLI có trong `bin/Release/net8.0`                                                                    |
| `dotnet test src/backend/BHome.sln -c Release --no-build --settings tests/backend/ci.runsettings --logger trx -m:1`                                                          | Application 427 PASS; Domain 106 PASS; integration 870 PASS / 20 SKIP / 0 FAIL, tổng 890 integration tests |
| `dotnet format src/backend/BHome.sln --verify-no-changes --no-restore`                                                                                                       | PASS trên Linux và Windows                                                                                 |
| `dotnet test src/digital-signing/tests/BHome.DigitalSigning.UnitTests/BHome.DigitalSigning.UnitTests.csproj -c Release --settings tests/backend/ci.runsettings --logger trx` | 41 PASS / 0 SKIP / 0 FAIL                                                                                  |
| `git diff --check`                                                                                                                                                           | PASS                                                                                                       |

TRX của lượt full xác nhận test CLI, Compact24 independence với real hosted services/SQL logging, kiểm tra quyền của 5 runtime roles và chuyển PDF LibreOffice thực tế đều PASS. Các assertion hiện có được giữ nguyên; không dùng filter hoặc bỏ qua test trong lượt full.

Frontend trên Linux/Node 22: `npm ci`, `npm run lint`, Mobile typecheck, `npm test` (Owner Web 338 PASS, Mobile 885 PASS), production build, Mobile web export và `npm run format:check` đều PASS. Sau khi định dạng file audit có sẵn, `npm run format:check` trên toàn workspace local cũng PASS. Docker Compose validation với `.env.example` và build hai image MinIO/LibreOffice PASS. Production build có cảnh báo bundle lớn hơn 500 kB; không phải lỗi build hoặc bằng chứng performance.

Môi trường backend dùng Linux .NET SDK 8 và Docker riêng, PostgreSQL disposable trên loopback, MinIO/LibreOffice integration images; bật statement logging với bind parameter logging bị tắt như CI. Lượt dựng môi trường đầu dùng Docker host bên ngoài gây lỗi bind mount PDF và host guard. Lượt Docker lồng nhau với cgroup namespace riêng cũng không chạy được container LibreOffice có resource limits; xác nhận bằng lệnh `soffice --version`, không liên quan đến mã BHOME. Đã dừng các lượt này và chạy lại toàn suite bằng Docker lồng nhau với cgroup namespace host và thư mục tạm chia sẻ. Giữ nguyên resource limits và các kiểm tra bảo vệ của ứng dụng.

Log/TRX lưu cục bộ trong `.tmp/ci-20261112-backend-results`, `.tmp/ci-20261112-frontend-results` và `.tmp/ci-20261112-backend-environment-results`, bị Git bỏ qua; không đưa dữ liệu database hoặc credential vào commit. Chưa push hoặc chạy lại GitHub Actions trên remote. 20 test OCR/browser opt-in vẫn theo điều kiện sẵn có, giống run được báo lỗi; không bỏ test để làm CI xanh. Không áp dụng migration hoặc thay cấu hình database làm việc.
