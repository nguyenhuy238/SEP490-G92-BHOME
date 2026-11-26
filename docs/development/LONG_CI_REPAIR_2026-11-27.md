# Sửa CI member/Long — 27/11/2026

## Phạm vi và truy vết

- Yêu cầu: chuyển từ `member/QHuy` sang `member/Long`, cập nhật remote và tích hợp `develop`, sửa lỗi CI để chuẩn bị merge.
- Đã fetch `origin`; `member/Long` fast-forward từ `57599cc9` đến `afdf61ab`. `origin/develop` tại `1add5584` đã là ancestor của nhánh, nên `git merge origin/develop` báo `Already up to date`.
- Ba tài liệu chưa commit trên QHuy được giữ trong stash có tên `preserve QHuy local docs before member/Long CI repair 2026-11-27`; không đưa vào bản sửa Long.
- CI gốc: [run 45863694381](https://github.com/nguyenhuy238/SEP490-G92-BHOME/actions/runs/45863694381), head `d875aae6`. Lượt này lỗi lint, backend format và các test Mobile/Owner Web. Kiểm chứng local dùng source mới nhất sau khi tích hợp develop.
- BF-03/04, UC-13..17, GBR-01/02/04/13: giữ cấu hình hợp đồng theo Owner, đối chiếu [quyết định Owner-wide](OWNER_WIDE_MAIN_CONTRACT_SETTINGS_2026-11-26.md), [điều chỉnh hợp đồng](OWNER_CONTRACT_HOUSEHOLD_FIXES_2026-11-26.md), các API/service và test hiện có.
- BF-06, UC-22, GBR-10/18; NFR dữ liệu/phát hành: giữ quy tắc thu đầu kỳ v2 đã có trong `MainInitialPaymentNoFees.sql`, không thêm công thức hay trạng thái. Đối chiếu `MainInitialPayments`, `MainInitialPaymentLedger`, `Compact24Schema`, các migration SePay và [quy trình migration](../database/DATABASE_MIGRATION_WORKFLOW.md).

Tiêu chí: tạo tài liệu đúng cấu hình Owner; giữ kiểm tra quyền/hash/file riêng tư; test không phụ thuộc thứ tự cấu hình; schema bootstrap và EF migration cùng guard hiện hành; readiness vẫn phát hiện guard bị sửa sai; không bỏ qua gate/test của CI.

## Nguyên nhân và thay đổi

1. `20261126000200_MainInitialPaymentNoFees.cs` có BOM trái `.editorconfig`. Chỉ sửa encoding, không đổi migration ID hoặc nội dung SQL migration.
2. `ContractDetailSections.tsx` export hook chung với component gây cảnh báo Fast Refresh, trong khi CI yêu cầu 0 cảnh báo. Chuyển nguyên hook sang `useContractFunds.ts` và cập nhật import. Format các file hợp đồng chưa đạt Prettier trên nhánh.
3. Test Owner Web vẫn tìm nội dung ngay ở tổng quan dù giao diện đã chuyển sang tab; mock chi tiết chưa gọi `onClose`; câu chữ cấu hình đã đổi; selector `alert` trùng thông báo info/error. Test nay thao tác tab/menu và callback thực, vẫn xác minh không sửa giá đã chốt, không tự kích hoạt/giải phóng phòng, giữ deep link và xử lý 503.
4. Mock Mobile thiếu theme mà `ContractSigningStep` sử dụng. Bổ sung mock theme; kiểm tra danh sách Staff mở đúng hợp đồng Holding/Main qua card/search hiện có, giữ các test bàn giao ở `contract-sections.test.tsx`.
5. Ba consumer của `IMainDraftData.SettingsAsync(ownerId, ...)` vẫn truyền Location ID: PDF giữ chỗ, PDF hợp đồng chính và PDF bàn giao. Sửa sang `Contract.OwnerSignerId`; giữ kiểm tra OwnerSignerId khớp, ngày hiệu lực, quyền truy cập và tài liệu đã ký.
6. Compact24 dùng một Owner synthetic cho cả fixture; cấu hình Owner-wide từ ca trước làm ca sau lưu `ExpectedVersion=0` bị 409. `MainDraftApiTests.Setup` khởi tạo lại riêng cấu hình synthetic của fixture, bao gồm ca thiếu cấu hình. Không xóa cấu hình ứng dụng hoặc môi trường thật.
7. Readiness ghép guard `SettlementSePayCodes` cũ nhưng chưa ghép các thay thế mới của `SePayPaymentModes`/`SePayOwnerConnections`. Nay đối chiếu theo thứ tự migration thực sự đã áp dụng, vẫn so toàn bộ nội dung function.
8. SQL bootstrap hiện hành vẫn chứa guard thu đầu kỳ v1, từ chối allocation v2 ở luồng ký/thanh toán thật. Đồng bộ duy nhất `bhome24_initial_payment_guard` với resource migration `MainInitialPaymentNoFees.sql` sẵn có. Không đổi migration lịch sử hay business rows. Thêm regression bootstrap không có EF history, áp lại resource không đổi guard, và phát hiện guard bị làm yếu.
9. Danh sách migration trong test baseline thiếu migration `MainInitialPaymentNoFees` đã tồn tại; bổ sung đúng ID thực tế, giữ kiểm tra model snapshot và toàn bộ migration khác.
10. Fixture import schema nguồn cũ không có `users.business_profile`; adapter runtime mới gây 503 ở các ca chuẩn bị hợp đồng trước khi copy. Thêm `Fixtures/LegacyMainDraftData.cs` và đăng ký riêng trong `LegacyPersistenceRegistration`: lưu cấu hình mã hóa vào `Location.ContractSettings` của schema nguồn đã đóng băng, vẫn kiểm tra actor/version/ngày hiệu lực và dùng chính xử lý identity/document hiện có. Không bổ sung fallback production hoặc sửa migration schema nguồn. Nhóm 21 test main draft/import/CLI chạy trên layout build chuẩn đã PASS.
11. Fixture bàn giao/ký Holding có cùng lỗi dùng lại cấu hình Owner. Dùng chung `MainDraftTestSettings.ResetOwnerPolicyAsync` trong ba nơi chuẩn bị dữ liệu synthetic; không sửa optimistic concurrency của ứng dụng.
12. Hai biến thể test SePay còn kỳ vọng 50.000đ Internet trong khoản thu đầu kỳ mới. Giữ tên test được CI inventory theo dõi, cập nhật kỳ vọng v2 chỉ thu cọc + thuê và kiểm tra phí/meter không bị đưa vào QR mới. Đồng thời kiểm tra lệnh v1 đã phát mã giữ mã/số tiền, phân bổ đúng khoản phí lịch sử, replay không nhân đôi; báo giá v1 chưa phát mã được giải quyết theo nghĩa vụ chung và giữ bản ghi cũ. Phát hiện thêm response mới ẩn phí của lệnh v1 dù số dư ledger vẫn chứa phí: `MainInitialPayments` nay trả lại chi tiết phí/đơn giá cho v1, không đổi số dư hay allocation. Cập nhật `CONTRACT_LIFECYCLE.md` mô tả tương thích này. Bốn ca SePay/ký Holding bị ảnh hưởng đã PASS sau sửa.

## Kiểm chứng

Kết quả cuối được cập nhật sau khi các lệnh hoàn tất. Log/TRX/JUnit local nằm trong `.tools/long-ci-*`; dữ liệu kiểm thử synthetic, PostgreSQL disposable trên loopback và Testcontainers.

- Node dùng bản 22.23.4 có sẵn tại `.tools/node-v22.23.4-win-x64`; chạy `npm ci --no-fund --no-audit` trước bộ kiểm tra cuối.
- Lần build đầu dùng `--no-restore` thiếu assets; đã restore solution và build lại. Lần build web đầu thiếu `VITE_API_BASE_URL`; chạy lại với URL synthetic như CI.
- Lint/Prettier local phải loại `.artifacts/` là output cá nhân đã gitignore, không có trong clean checkout CI. Không chỉnh cấu hình gate để che lỗi source.
- Các lượt tái hiện lỗi trước bản sửa không được coi là PASS; test opt-in bị skip không được coi là đã thực hiện.
- Lượt build tách `--artifacts-path` làm test CLI cũ suy ra sai thư mục cấu hình; lượt kiểm chứng cuối dùng output `bin/Release/net8.0` chuẩn, không đổi assertion hoặc đường dẫn của test để bỏ qua CLI.
- Integration cuối chia 3 nhóm theo nguyên lớp test, đủ 1.588 ca đã discovery; giữ nguyên filter của CI và mọi assertion. Lượt chạy đồng thời dùng runsettings local giảm `MaxParallelThreads` từ 2 xuống 1 để giới hạn RAM; nhóm 2 được chạy lại riêng với đúng `tests/backend/ci.runsettings` (2 threads) sau khi hoàn thiện điều kiện logging bên dưới. Không commit thay đổi workflow/runsettings CI. Kết quả được đối chiếu bằng `Verify-BackendTrx.py --integration-shards 3 --discovery ...` và `Verify-StagingRegressions.py` sau khi đủ TRX.
- Bộ xác minh đầu tiên từ chối ca `Compact24IndependenceTests` bị skip vì local thiếu `BHOME_COMPACT24_QUERY_LOG`. CI đã có cấu hình này. Đã bật PostgreSQL statement logging, tắt cả hai tùy chọn log bind parameters, ghi prefix chứa database, và cung cấp đường dẫn log thực như CI. Ca kiểm tra chạy riêng PASS; chạy lại toàn bộ nhóm 2 để có TRX hợp lệ, không sửa danh sách skip cho phép hoặc ghép kết quả giả. TRX bị từ chối được giữ ở `.tools/long-ci-inventory-rejected/`.

| Kiểm tra                                                                                                   | Kết quả                                                                           |
| ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `npm ci --no-fund --no-audit` bằng Node 22.23.4                                                            | PASS                                                                              |
| `dotnet build src/backend/BHome.sln -c Release --no-restore`                                               | PASS, 0 warning/error                                                             |
| `dotnet format src/backend/BHome.sln --verify-no-changes --no-restore`; kiểm tra thêm hai file fixture mới | PASS                                                                              |
| `npm run lint -- --ignore-pattern .artifacts/**`; ESLint trên toàn bộ file Git cùng file source mới        | PASS; 1.064 file, 0 error/warning                                                 |
| Prettier toàn repo, dùng `.prettierignore` và `.gitignore` cho output cá nhân                              | PASS                                                                              |
| Owner Web tests, JUnit                                                                                     | PASS: 143 files, 1.073 tests, 0 failed/skipped                                    |
| Mobile tests `--maxWorkers=2`, JUnit                                                                       | PASS: 167 files, 1.800 tests, 0 failed/skipped                                    |
| Public Web unit/browser, JUnit                                                                             | PASS: 11 + 16 tests, 0 failed/skipped                                             |
| `Verify-FrontendEvidence.py` trên cả 4 JUnit reports                                                       | PASS                                                                              |
| Build client-core, Owner Web, Public Web với API origin synthetic như CI                                   | PASS; web có cảnh báo bundle lớn, không gây fail                                  |
| Mobile typecheck; Expo web export `--max-workers 2`                                                        | PASS                                                                              |
| Docker build `Api.Release.Dockerfile --target api` và `Web.Dockerfile` cho Owner/Public                    | PASS cả 3; API restore phải thử lại download NuGet bị ngắt, không thay Dockerfile |
| Bash syntax các script VPS; Python deployment/email preflight trong Linux có Docker Compose CLI            | PASS: 102 + 7 tests                                                               |
| `node --test tests/deployment/*.test.cjs`                                                                  | PASS: 26 tests                                                                    |
| `Test-SePaySandboxScripts.ps1`; hai Compose config như CI                                                  | PASS                                                                              |
| Main draft legacy/import/CLI sau sửa fixture, output build chuẩn                                           | PASS: 21 tests, 0 failed/skipped                                                  |
| Application / Domain / Infrastructure / DigitalSigning unit tests sau build cuối                           | PASS: 771 / 115 / 252 / 41; tổng 1.179, 0 failed/skipped                          |
| Backend integration đủ inventory hiện tại, 3 TRX không trùng lớp/ca                                        | PASS: 1.556 đạt, 32 skip trong danh sách cho phép, 0 lỗi; tổng backend 2.735 đạt  |
| `Verify-BackendTrx.py ... --integration-shards 3 --discovery ...`                                          | PASS: đủ 5 assemblies, giữ toàn bộ identity baseline và discovery hiện tại        |
| `Verify-StagingRegressions.py .tools/long-ci-final-evidence`                                               | PASS: đủ 21 nhóm regression bắt buộc đã chạy đạt                                  |

Các lượt test migration/ký trung gian xác nhận 59/61 ca PASS, nhưng còn lỗi adapter schema nguồn và layout CLI ở build tách; không dùng TRX đó làm bằng chứng CI cuối.

Kết quả integration cuối theo nhóm: 301 đạt/5 skip; 614 đạt/15 skip; 641 đạt/12 skip. Ca independence đã chạy đạt với log PostgreSQL thực; không có skip mới ngoài baseline. Các ca skip còn lại là các test opt-in đã được repository cho phép, không phải bằng chứng đã kiểm tra model/email/browser ngoài môi trường này. Frontend có tổng 2.900 test đạt; backend có tổng 2.735 test đạt và 32 skip. Không đo coverage hoặc hiệu năng trong lượt sửa này.

## File thay đổi

- Backend: `ContractHandoverDraftService.cs`, `ContractSigningDocumentSource.cs`, `PaymentsDebt/MainInitialPayments.cs`, `Persistence/Compact24/Compact24Schema.cs`, encoding của `Migrations/20261126000200_MainInitialPaymentNoFees.cs`.
- Schema bootstrap: `docs/database/2026-11-03/compact-24/BHOME_24_TABLES.sql` (một function như mục 8).
- Backend test: `Compact24MigrationBaselineTests.cs`, `SharedMainInitialPaymentMigrationTests.cs`, `SePayIntegrationTests.cs`, `Compact24AssetHandoverTests.cs`, `Contracts/ContractOtpSigningApiTests.cs`, `Contracts/MainDraftApiTests.cs`, `Fixtures/LegacyMainDraftData.cs`, `Fixtures/LegacyPersistenceRegistration.cs`, `Fixtures/MainDraftTestSettings.cs`.
- Owner Web: `features/contracts/ContractDetailPanel.tsx`, `ContractDetailSections.tsx`, `useContractFunds.ts`; test `Contracts.test.tsx`, `ContractsNavigation.test.tsx`, `MainDraftSettingsPanel.test.tsx`.
- Mobile test: `holding-signing-flow.test.tsx`, `staff-contract-list.test.tsx`.
- Chỉ format theo Prettier: Mobile `contract-signing-step.test.tsx`, `ContractSigningStep.tsx`, `MainInitialPaymentCard.tsx`; Owner Web `app/router.tsx`, `components/layout/AppShell.tsx`, `features/contracts/pages/ContractsPage.tsx`.
- Tài liệu: `docs/api/CONTRACT_LIFECYCLE.md` và file này.

## Phát hành và Git

Không merge vào `develop`, không áp migration lên Staging/Production. SQL artifact thay đổi checksum; vận hành phải review và áp migration hiện có theo quy trình trước khi phát hành lên database đã bootstrap. Không đánh dấu schema mới là đã được duyệt cho môi trường triển khai.

Đã fetch lại trước khi chốt: `origin/member/Long` vẫn là `afdf61ab`, `origin/develop` vẫn là `1add5584` và đã nằm trong nhánh. Chưa push hoặc mở PR trong tác vụ này; kết quả GitHub Actions của commit sửa CI chưa được thực hiện. Người dùng cần cho phép push theo AGENTS.md §9.8 trước khi chạy CI trên remote; kết quả local không được gọi là GitHub CI đã xanh.
