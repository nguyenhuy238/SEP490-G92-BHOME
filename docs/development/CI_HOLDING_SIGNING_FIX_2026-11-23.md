# Sửa CI ký Holding Contract — 23/11/2026

## Bằng chứng và truy vết

[CI run #289](https://github.com/nguyenhuy238/SEP490-G92-BHOME/actions/runs/45170880774)
trên commit `3a994364` lỗi ở bước `dotnet test src/backend/BHome.CI.slnf`.
Artifact `backend-trx-attempt-1` ghi nhận 6 lỗi integration, cùng mã
`owner_contract_settings_required`: ba kịch bản ký Holding bằng OTP, Owner
session và upload PDF, chạy qua cả theory gốc và regression Compact24.
Các bộ unit test của run này không có lỗi.

Phạm vi BF-03, UC-14/15, GBR-04; nguồn đối chiếu:
`docs/api/HOLDING_OWNER_WEB.md`, `ContractSigningDocumentSource.ReadHoldingAsync`
và `MainDraftData`. PDF Holding hiện lấy hồ sơ bên cho thuê có hiệu lực tại
cơ sở, đúng Owner ký và định danh đại diện đã xác nhận. Đây là sửa fixture
theo đầu vào hiện có, không thay đổi chính sách ký hoặc quy tắc thanh toán.

## Bản sửa và tiêu chí chấp nhận

- `ContractOtpSigningApiTests.cs`: chuẩn bị đủ giá thuê, hồ sơ Owner có hiệu
  lực và định danh Tenant giả lập được mã hóa bằng `IIdentityProtection`.
- `ContractUploadProofSigningApiTests.cs`: dùng chung phần chuẩn bị trên.
- Cả hai host ký cấu hình image LibreOffice đã được workflow CI build sẵn,
  để tạo PDF từ mẫu DOCX Holding thực tế.
- Cả 6 ca lỗi phải qua; giữ các kiểm tra quyền Staff/Tenant, OTP sai và dùng
  lại, idempotency, thanh toán trước kích hoạt và tính toàn vẹn chữ ký PDF.
- Chạy lại build, bộ test CI, format và các gate frontend/deployment tương ứng.

Không sửa production code, workflow, bộ lọc test, schema hoặc migration để
bỏ qua điều kiện tạo PDF.

## Kiểm chứng

- `dotnet build src/backend/BHome.sln -c Release --no-restore`: PASS trên
  Windows và Linux, 0 warning / 0 error.
- `dotnet test src/backend/BHome.CI.slnf -c Release --no-build --settings
tests/backend/ci.runsettings --logger trx ... -m:1`: PASS trên Linux cho
  nhánh hiện tại: Application 686, Domain 115, Integration 1.407,
  Infrastructure 149, Digital Signing 41 PASS; tổng 2.398 PASS / 0 FAIL /
  32 SKIP theo điều kiện hiện có của suite.
- Chín ca hồi quy ký: 9 PASS / 0 FAIL / 0 SKIP trên cả Windows và Linux.
  Bộ lọc gồm `RealHoldingOtpSigning`, `RealHoldingOwnerSessionSigning`,
  `RealHoldingUploadSigning` và ba theory tương ứng trong
  `ContractLifecycleApiTests` (mỗi theory có Holding và Main).
- `npm ci --no-fund --no-audit`, `npm run lint`, Mobile typecheck và
  `npm run build`: PASS trong Linux với Node 22 và biến API như CI.
- `npm test`: 928 test Owner Web, 1.619 test Mobile và 6 test Public Web PASS.
- Expo export web với biến môi trường và hai worker như CI: PASS.
- `npm run format:check`: PASS; tài liệu bản sửa cũng qua Prettier.
- Hai lệnh `docker compose ... config --quiet` trong workflow: PASS.
- Linux deployment Python: 34 PASS; deployment Node: 20 PASS; cú pháp Bash
  `deploy/vps/*.sh`: PASS; `Test-SePaySandboxScripts.ps1`: PASS.
- Build ba image staging theo Dockerfile của workflow: API (`--target api`),
  Owner Web và Public Web PASS. Web dùng API origin Staging, môi trường
  `Staging` và revision hiện tại như job `build-staging-images`.
- `dotnet format src/backend/BHome.sln --verify-no-changes --no-restore`:
  PASS trên Windows và Linux.
- Lệnh Digital Signing riêng trong workflow: 41 PASS / 0 FAIL / 0 SKIP.

## Bối cảnh PR và nhánh develop

GitHub Actions của PR chạy bản ghép với `develop`. Nhánh hiện tại
`3a994364d0b48ba560f30acce3eb1f3db47165a3` chưa có các thay đổi email/public
content trong `develop` tại `74fce845`. Vì vậy số test của nhánh hiện tại
thấp hơn artifact PR: đây là khác biệt nguồn, không phải bộ lọc mới.

Đã tạo cây ghép tạm bằng `git merge-tree --write-tree HEAD origin/develop`
(không conflict), xuất sang thư mục Linux riêng và áp dụng hai file test đã
sửa. Việc kiểm tra bổ sung tập trung vào cả 9 ca ký, các lớp email/public
content khác biệt và toàn bộ Infrastructure unit test. Nhánh làm việc không
được merge hay thay đổi lịch sử.

Kết quả bổ sung: build PASS, 0 warning / 0 error; Integration chọn theo các
lớp trên 211 PASS / 0 FAIL / 4 SKIP; Infrastructure 155 PASS / 0 FAIL /
0 SKIP. Cả 6 test từng lỗi trong artifact PR đều PASS trên cây ghép này.
`dotnet format ... --verify-no-changes --no-restore` trên cây ghép: PASS.
Kết quả full suite 2.398 PASS phía trên thuộc nhánh hiện tại; bản ghép được
kiểm tra bằng các lớp bổ sung đã nêu.

Lượt Linux đầu gặp lỗi mạng Docker Desktop khi kết nối PostgreSQL và lượt
SePay đầu dùng mount chỉ đọc không được tính là PASS; đã chạy lại trong môi
trường phù hợp. Kết quả local không thay thế lần chạy GitHub Actions trên
commit mới sau push. Không commit, push, merge hoặc triển khai trong tác vụ này.
