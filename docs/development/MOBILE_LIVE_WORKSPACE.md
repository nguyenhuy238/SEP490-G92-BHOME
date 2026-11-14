# Đồng nhất Mobile workspace và đăng nhập web

## Đối chiếu trước triển khai

Nguồn: `docs/reports/BHome_Report-3_Software Requirement Specification (2).docx`
(bản trích xuất cục bộ đã đối chiếu), SRS §I.4.4, GBR-01..03, GBR-07,
UC-10..12, UC-13..20; quy ước API và controller hiện có là hợp đồng tích hợp.

| Yêu cầu                                        | Thành phần / API đã có                                     | Kiểm tra chấp nhận                                                                                            |
| ---------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Đăng nhập từ localhost:8081                    | Development CORS, SessionProvider, apiEndpoint             | Preflight cho origin chính xác; từ chối origin khác; giữ HTTPS và cấu hình native/release                     |
| Trang chủ đúng vai trò, đồng nhất thiết kế mẫu | WorkspaceKit, WorkspaceRoute, API cơ sở/công việc/hợp đồng | Chỉ dữ liệu server; trạng thái tải/rỗng/lỗi; không gọi API Owner từ Tenant                                    |
| Owner quản lý, Staff thực hiện công việc       | UC-10..12 / BF-02; operational-tasks                       | Version, Idempotency-Key, ghi tiến độ/vướng mắc, ảnh kết quả, submit → Owner verify/rework; không tự hoàn tất |
| Staff đọc đồng hồ                              | UC-20 / BF-05 / GBR-07; capture/meter-tasks và meter       | Chỉ tác vụ server trả về; mở luồng OCR/xác nhận hiện có                                                       |
| Thông báo cá nhân về công việc                 | operational-tasks/notifications                            | Owner/Staff, phân trang và đánh dấu đã đọc sau phản hồi server                                                |
| Tenant dùng hợp đồng thật                      | BF-03/04; contracts                                        | Trang chủ và chi tiết chỉ dùng danh sách hợp đồng trong phạm vi server                                        |

Không thay đổi schema, quy tắc thanh toán/ký/kích hoạt hay quyền backend.
Work Order bảo trì BF-07 khác công việc vận hành BF-02: không áp dụng các action
operational-tasks cho Work Order bảo trì hoặc tác vụ đồng hồ.

## Khoảng trống backend

Chưa tìm thấy controller cho hóa đơn/thanh toán/điều chỉnh, sự cố/Work Order bảo trì,
lịch ca, cư trú, checklist bàn giao vào ở, sửa hồ sơ và tùy chọn thông báo.
API đổi mật khẩu đã có và được nối vào màn Bảo mật; thành công sẽ xóa phiên cục bộ
và yêu cầu đăng nhập lại.
Các màn này phải có trạng thái chưa khả dụng theo đúng chức năng, không thay bằng
fixture và không báo thành công giả. Thông báo công việc chỉ có Owner/Staff;
không gọi endpoint đó bằng Tenant. Các xung đột UC-18/JOB-08 và chính sách tài chính
còn mở không thuộc thay đổi này. Các trạng thái `Connected` trong
`MOBILE_SCREEN_COVERAGE.csv` nghĩa là đã nối API; không phải bằng chứng mọi trường hợp
nghiệp vụ/provider đã chạy end-to-end.

## Sửa kết nối web và giữ kết nối điện thoại

- Development CORS cho phép chính xác `http://localhost:8081` và
  `http://127.0.0.1:8081`; không thêm wildcard hay quyền truy cập dữ liệu.
- Web Development chạy trên loopback dùng `https://localhost:7240`; Expo Go tiếp tục
  dùng LAN URL của launcher. API công khai và release không bị viết lại.
- CA Mobile chưa được Windows tin cậy trên máy kiểm tra. Máy có sẵn chứng chỉ
  ASP.NET Development localhost được tin cậy: `Prepare-OcrMobile.ps1` chỉ dùng chứng chỉ
  hợp lệ, có private key, đúng OID Development và chain được Windows xác nhận.
  PFX xuất vào `.tools/mobile-tls/` đã được Git bỏ qua; mật khẩu chỉ vào cấu hình local.
- Kestrel SNI chọn chứng chỉ này cho `localhost`, còn wildcard/no-SNI giữ PFX Mobile.
  Không cài CA vào Root store, không thay trust store và không bỏ xác minh TLS.
  Cấu hình theo [tài liệu Kestrel SNI](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/servers/kestrel/endpoints?view=aspnetcore-8.0#sni-in-configuration).
- Máy khác chưa có chứng chỉ localhost được tin cậy sẽ nhận cảnh báo. Người phát triển
  có thể chủ động chạy `dotnet dev-certs https --trust`, rồi chạy lại launcher.
  Script không tự cấp quyền tin cậy.

Áp dụng bằng `npm.cmd run mobile:dev -- -Clear` ở gốc repository. Nếu đang chạy API
trong Visual Studio, dừng và chạy lại sau khi chuẩn bị cấu hình; không chạy hai API
cùng cổng. Trong Cấu hình kết nối API của trình duyệt, địa chỉ localhost là
`https://localhost:7240`. Sau tải lại trang web cần đăng nhập lại theo cơ chế phiên
trong bộ nhớ hiện có.

## Kiểm tra

Kết quả thực thi ngày 01/11/2026:

| Kiểm tra                                                                                          | Kết quả thực tế                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Mobile Vitest                                                                                     | PASS: 19 file / 231 test                                                                                                                                                                                     |
| Mobile TypeScript và ESLint                                                                       | PASS                                                                                                                                                                                                         |
| API foundation + Mobile Web CORS + operational task API contract                                  | PASS: 28 test                                                                                                                                                                                                |
| Application / StaffOperations                                                                     | PASS: 9 test                                                                                                                                                                                                 |
| Domain / StaffOperations                                                                          | PASS: 5 test                                                                                                                                                                                                 |
| PowerShell network/launcher                                                                       | PASS: 60 assertion                                                                                                                                                                                           |
| Expo export Web / Android / iOS                                                                   | PASS; artifact ở `.tools/mobile-live-platforms/`                                                                                                                                                             |
| Edge với API thật tại origin localhost:8081                                                       | PASS: health 200; tài khoản kiểm thử không tồn tại nhận 401 từ login; TLS xác minh bình thường; không còn lỗi CORS/network                                                                                   |
| LAN API HTTPS với CA Mobile được chỉ định                                                         | PASS: readiness, chain và hostname hợp lệ                                                                                                                                                                    |
| Edge giao diện sau đăng nhập                                                                      | PASS với API stub theo contract: Owner duyệt; Staff start/submit với ảnh đã chọn; Tenant chỉ gọi contracts; desktop 1365px và mobile 390px; không có page error hoặc token trong localStorage/sessionStorage |
| `git diff --check`                                                                                | PASS                                                                                                                                                                                                         |
| PostgreSQL integration / OperationalTaskApiTests                                                  | FAIL tại khởi tạo fixture: 5 test không chạy vào scenario vì DockerUnavailableException; không báo các test này đạt                                                                                          |
| Camera/OCR trên điện thoại thật; đăng nhập bằng tài khoản hợp lệ của người dùng; provider ký thật | NOT RUN trong tác vụ này                                                                                                                                                                                     |

Lệnh chính đã thực thi từ gốc repository (Node 22 local):

```powershell
& ./.tools/node-v22.23.4-win-x64/node.exe ./src/mobile/node_modules/typescript/bin/tsc --noEmit -p src/mobile/tsconfig.json
& ./.tools/node-v22.23.4-win-x64/node.exe ./node_modules/eslint/bin/eslint.js src/mobile/src tests/mobile/ocr/liveWorkspace-ui.test.tsx tests/mobile/ocr/operationalTasks.test.ts tests/mobile/ocr/apiEndpoint.test.ts tests/mobile/ocr/sessionProvider.test.tsx tests/mobile/ocr/connectivity-ui.test.tsx tests/mobile/ocr/workflows.test.ts --max-warnings 0
dotnet test tests/backend/BHome.IntegrationTests/BHome.IntegrationTests.csproj --no-build --filter 'FullyQualifiedName~MobileWebCorsTests|FullyQualifiedName~ApiFoundationTests|FullyQualifiedName~OperationalTaskContractTests' --verbosity quiet
dotnet test tests/backend/BHome.Application.UnitTests/BHome.Application.UnitTests.csproj --filter 'FullyQualifiedName~StaffOperations' --no-restore --verbosity quiet
dotnet test tests/backend/BHome.Domain.UnitTests/BHome.Domain.UnitTests.csproj --filter 'FullyQualifiedName~StaffOperations' --no-restore --verbosity quiet
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests/scripts/MobileDevelopment.Tests.ps1
git diff --check
```

Từ `src/mobile`:

```powershell
& ../../.tools/node-v22.23.4-win-x64/node.exe ../../node_modules/vitest/vitest.mjs run --config vitest.config.ts
& ../../.tools/node-v22.23.4-win-x64/node.exe ../../node_modules/expo/bin/cli export --platform all --output-dir ../../.tools/mobile-live-platforms
```

Browser smoke sử dụng Playwright đã có trong `.tools/contract-browser`, Edge headless
và máy chủ static tạm tại 8081, đóng sau mỗi lần chạy; không thêm dependency vào repo.
Script cục bộ: `.tools/mobile-live-browser.cjs`; ảnh chỉ chứa fixture tổng hợp:
`.tools/mobile-live-owner.png`, `mobile-live-staff.png`, `mobile-live-tenant.png`.
Đây không phải bằng chứng ghi dữ liệu thật vào PostgreSQL.

Lệnh tích hợp PostgreSQL bị chặn bởi môi trường:

```powershell
dotnet test tests/backend/BHome.IntegrationTests/BHome.IntegrationTests.csproj --no-build --filter 'FullyQualifiedName~OperationalTaskApiTests' --logger 'trx;LogFileName=mobile-live-tasks.trx' --results-directory .tools/mobile-live-results --verbosity quiet
```

Kết quả lỗi nằm trong `.tools/mobile-live-results/mobile-live-tasks.trx`:
không kết nối được `npipe://./pipe/docker_engine`. Cần bật Docker rồi chạy lại.
Một lần build ban đầu gặp MSB3026 do API đang chạy khóa DLL; đã dừng đúng API do tác vụ
khởi tạo rồi build/test lại thành công. Các lệnh PowerShell mặc định bị ExecutionPolicy
chặn đã được thay bằng executable Node 22 và script `-ExecutionPolicy Bypass` hiện có.
Lệnh mở Metro trực tiếp bị bộ duyệt tự động từ chối (`blocked by policy`); đã dùng
máy chủ static tạm cho kiểm tra trình duyệt, không tuyên bố đã kiểm tra Metro dev trực tiếp.

## Tệp thay đổi

- Kết nối: `scripts/MobileNetwork.ps1`, `scripts/Prepare-OcrMobile.ps1`,
  `src/backend/BHome.Api/appsettings.Development.json`,
  `src/mobile/src/lib/apiEndpoint.ts`, `SessionProvider.tsx`, `api.ts`.
- Điều hướng và thành phần dùng chung: `src/mobile/src/app/workspace/[screen].tsx`,
  `src/mobile/src/features/workspace/navigation.ts`, `useWorkspaceQuery.ts`,
  `src/mobile/src/components/WorkspaceShell.tsx`, `WorkflowControls.tsx`,
  `WorkspaceQueryState.tsx`.
- Giao diện và dịch vụ: `src/mobile/src/screens/LoginScreen.tsx`,
  `OwnerOverviewScreen.tsx`, `LiveWorkspaceScreens.tsx`, `OperationalTaskScreens.tsx`,
  `AccountSecurityScreen.tsx`, `src/mobile/src/services/operationalTasks.ts`.
- Kiểm tra: `tests/backend/BHome.IntegrationTests/MobileWebCorsTests.cs`,
  `tests/scripts/MobileDevelopment.Tests.ps1`,
  `tests/mobile/ocr/apiEndpoint.test.ts`, `sessionProvider.test.tsx`,
  `connectivity-ui.test.tsx`, `workflows.test.ts`, `operationalTasks.test.ts`,
  `liveWorkspace-ui.test.tsx`.
- Tài liệu: tệp này, `docs/development/MOBILE_SCREEN_COVERAGE.csv`,
  `docs/development/MOBILE_WORKFLOW_DELIVERY.md`.

Không có migration mới. Không sửa migration `20261029170352_ContractActivationLifecycle.cs`.
Không commit, push hoặc merge.

## Cập nhật Owner Mobile ngày 12/11/2026

Phạm vi yêu cầu được đối chiếu với BF-02, BF-03/BF-04, BF-06, BF-07;
UC-08..19, UC-22..30; GBR-01..04, GBR-10..12 và GBR-18. Backend và các
DTO hiện hữu tiếp tục là nguồn sự thật; đợt này không thêm endpoint, migration
hoặc quy tắc tài chính.

- Action Center hiển thị hồ sơ ưu tiên và mở thẳng công việc chờ nghiệm thu,
  phương án/chờ nghiệm thu Work Order, hợp đồng chờ ký hoặc kích hoạt.
- Owner Mobile được thực hiện các quyết định Incident/Work Order mà backend đã
  cấp quyền: review, giao/xử lý trực tiếp, duyệt phương án, nghiệm thu, yêu cầu
  làm lại và quyết định chi phí khẩn cấp. Mọi mutation vẫn gửi version và qua
  kiểm tra quyền của API.
- Main Tenancy Contract cho phép Owner ký, đồng bộ/khôi phục trạng thái ký và
  kích hoạt khi readiness từ backend cho phép. Soạn hợp đồng và toàn bộ quyết
  định Holding Contract vẫn ở Owner Web.
- Điều chỉnh hóa đơn, đối soát/phân bổ thanh toán, hoàn tiền và soạn thông báo
  vẫn là màn theo dõi trên Mobile; quyết định tiền và phát hành nội dung vẫn ở
  Owner Web.
- Bỏ lối vào `/setup`, giao diện Owner mẫu cũ và tùy chọn thông báo giả khỏi
  hành trình Owner. Danh sách/chi tiết hợp đồng và Action Center tự đồng bộ khi
  quay lại màn hình; nút tải lại thường trực được bỏ, chỉ giữ retry khi có lỗi
  hoặc thao tác đồng bộ nghiệp vụ cụ thể.

Kiểm tra thực thi cho thay đổi này: Mobile Vitest 76 file / 885 test PASS;
TypeScript, ESLint và `git diff --check` PASS. Chưa chạy E2E trên thiết bị Android
thật trong đợt này.
