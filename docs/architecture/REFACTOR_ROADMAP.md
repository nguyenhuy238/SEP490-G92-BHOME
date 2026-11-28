# BHOME - Refactor để nhóm sinh viên làm chủ mã nguồn

Nhánh: `refactor/bhome-develop`. Mốc gốc: `origin/develop` tại `f3be1bfe` (PR #189), đã đồng bộ các thay đổi Develop đến `76dcbbab` qua merge `93d309af`. Không lấy các commit riêng của member/THuy làm mốc. Không merge hay deploy khi chưa nghiệm thu.

## Mục tiêu và giới hạn

Giữ nghiệp vụ, API, dữ liệu và các kiểm soát an toàn. Giảm code không dùng, trùng lặp và số bước cần đọc để hiểu một nghiệp vụ; không đặt chỉ tiêu xóa file tùy ý. Giữ kiến trúc API/Application/Domain/Infrastructure và các client hiện tại. Không thay đổi schema, xóa dữ liệu, làm yếu kiểm thử hay bỏ điều kiện xác minh thanh toán.

## Lộ trình

| Giai đoạn       | Đầu ra                                                       | Trạng thái                                                                     |
| --------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| P0 - Baseline   | Build, typecheck, test và mốc đối chứng                      | Build BE và typecheck Owner/Mobile đã pass; chưa chạy full CI                  |
| P1 - Audit      | Danh mục KEEP/DELETE/MERGE/SIMPLIFY/ARCHIVE/REVIEW có căn cứ | Đã quét tham chiếu và trùng lặp theo module; chưa chứng minh toàn bộ semantics |
| P2 - Dọn dẹp    | Loại bỏ phần không sử dụng, giữ chức năng                    | Đã loại bỏ ứng viên có căn cứ, giữ phần còn test/API/legacy consumer           |
| P3 - Backend    | Từng module có điểm xử lý và quy tắc rõ ràng                 | Đã gom logic ID, evidence, eligibility và tách điểm đọc ký/trả phòng           |
| P4 - Frontend   | Component và API client dễ đọc                               | Đã bỏ màn hình cũ, scaffold, gom nhánh route và validation                     |
| P5 - Tài liệu   | Sơ đồ, API, method, bảng và ngoại lệ theo code               | Có mục lục, bản đồ Backend/Frontend và đối chiếu 38 UC                         |
| P6 - Nghiệm thu | Regression, CI và review nhóm                                | Chưa hoàn thành                                                                |

## Audit ban đầu

Git quản lý 3.300 file ở mốc gốc: Backend C# 681, Owner Web TS/TSX 450, Mobile TS/TSX 429, thư mục tests 504, docs 552. Các nhóm này không phải toàn bộ repo. 110 file C# migration nằm trong số Backend, giữ nguyên. Application/Contracts có 46 file; 14 file là phần của cùng một partial class ContractService, không phải 14 service đăng ký DI độc lập. ContractService.cs có 1.217 dòng không trống. Không gom toàn bộ partial class thành một file lớn.

| Thành phần                                     | Quyết định  | Căn cứ                                                                                                                                                               |
| ---------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| src/backend/Backup/BHome.sln và UpgradeLog.htm | DELETE      | Artifact nâng cấp Visual Studio, đường dẫn chỉ thấy trong log/ignore; solution thật là src/backend/BHome.sln                                                         |
| HoldingTenantLink.tsx                          | DELETE      | Component không có consumer trong src, packages, tests; chỉ có nhắc tới trong tài liệu lịch sử                                                                       |
| HandoverDocumentContracts.cs                   | MERGE       | Chuyển nguyên khai báo type và interface sang ContractHandoverContracts.cs; không đổi namespace, signature hoặc triển khai                                           |
| Migration, PDF lịch sử, legacy API             | KEEP/REVIEW | Có thể cần để đọc dữ liệu, tài liệu đã ký hoặc client cũ; cần audit trước khi bỏ                                                                                     |
| Logic tạo nhiệm vụ bàn giao                    | REVIEW      | Develop có hai caller EnsureMoveInTaskAsync: ContractRepository và ActivateReadyAsync; sửa thời điểm sinh nhiệm vụ là thay đổi nghiệp vụ, không tự trộn vào refactor |
| Tài liệu dated trong docs                      | REVIEW      | Phân biệt lịch sử quyết định, runbook, hướng dẫn hiện hành; không xóa theo tuổi file                                                                                 |

### Đợt dọn dẹp đầu tiên

- Mobile: xóa `HoldingTenantLink.tsx` và `HouseholdMemberEditor.tsx` (kể cả các export phụ không có consumer); không thay đổi luồng hiện tại.
- Owner Web: xóa `UnavailableFeaturePage.tsx`, `StaffWorkspace.tsx`, `LiveStaffPage.tsx` (router hiện dùng `StaffPage.tsx`) và `ownerDownloads.ts`. Không xóa endpoint hay client API.
- Giữ `TenantEvidenceDraft.tsx` vì còn test sử dụng hàm validation. Các panel ký, Viettel và phân công công tơ được chuyển từ REVIEW sang DELETE ở đợt sau khi kiểm tra toàn repo; không xóa API tương ứng.
- Giữ nguyên tài liệu lịch sử có nhắc tới các đường dẫn đã xóa; bản đồ này là chỉ dẫn hiện hành cho đợt refactor.

### Đợt tinh giản và kiểm tra sâu

- Backend: quét 451 file Application/Infrastructure (không bao gồm toàn bộ migration sinh tự động) để tìm clone, tham chiếu kiểu và đường gọi. `ContractHandoverTaskIds` dùng chung ID move-in/out giữ đúng SHA-256 và chuỗi key cũ. `SetupWorkspaceService` dùng chung so sánh tên và xác minh ảnh kiểm kê; `StaffEmploymentEligibility` dùng chung đúng năm nhánh query trùng nhau, giữ nhánh legacy có lọc role riêng. Xóa extension đăng ký Compact24 cho test không còn caller, giữ nguyên claims factory đang chạy.
- Tách phần ký hợp đồng vào `ContractSigningService.cs`, chuyển phần kết thúc hợp đồng/trả phòng vào `ContractLifecycleService.cs` hiện có. So sánh raw byte hai block trước/sau giống hệt nhau. File `ContractService.cs` từ 1.250 xuống 539 dòng vật lý; vẫn cùng partial class và DI, không thay đổi API hoặc trạng thái. Một file mới có trách nhiệm rõ ràng, không thêm lớp trung gian.
- Frontend: kiểm tra import tĩnh/động, mock, route, script, config và test ngoài `src`. Bỏ `IncidentWorkspace.tsx` cũ (1.392 dòng), `SignatureImagePanel.tsx`, `ViettelSettingsPanel.tsx`, `MeterAssignment.tsx`, scaffold Vite không được import và tài nguyên của nó. Gom nhánh route Mobile cùng component và tập trung validation phản hồi JSON của năm service Tenant, không bỏ validation DTO, phạm vi dữ liệu hay điều kiện thanh toán.
- Repository: bỏ track `.expo/README.md` và `.expo/devices.json`; file local vẫn giữ và được ignore. Giữ migrations, seed/demo có consumer, các API và lịch sử. Sửa stack lỗi thời trong README và đánh dấu thiết kế foundation cũ là lịch sử.
- Hướng dẫn nhóm: [Mục lục đọc mã nguồn](../business-flows/README.md), [Backend](../business-flows/BACKEND.md), [Frontend](../business-flows/FRONTEND.md). Đối chiếu các UC-01–38 và JOB-01–09 với Report 3 hiện lưu trong repo; đây là chỉ mục, không phải báo cáo đạt tất cả UC.

### Đợt tinh giản cuối và chuyển kiểm thử sang luồng thật

- Backend: dùng chung cách tạo fingerprint SHA-256 cho các lệnh có cùng cách serialize; giữ các chế độ serializer và loại khóa khác biệt. Gom các phép kiểm tra trùng nhau trong OCR, truy vấn nhiệm vụ bàn giao và phạm vi biểu phí; chuyển nguyên các method PDF/evidence bàn giao sang partial file tài liệu hiện có. Không tạo thêm service/DI, không đổi migration, API, transaction hay định dạng PDF.
- Owner Web: bỏ `TasksApiPage.tsx` và `LocationRoomDefaultsPicker.tsx` chỉ còn test gọi; chuyển kiểm thử sang workspace công việc và màn tạo phòng đang chạy. Tách logic thuần của wizard cơ sở và bản nháp bàn giao khỏi JSX, dùng chung hàm tải Blob và tính đơn giá kiểm kê. Giữ cả wizard live và mock vì khác trách nhiệm và hợp đồng dữ liệu.
- Mobile: bỏ `TenantEvidenceDraft.tsx`, `OwnerAttentionSummary.tsx` và wrapper `TenantProfileScreen.tsx` chỉ còn test gọi; chuyển kiểm thử sang trình xác thực ảnh sự cố, tổng quan Chủ trọ và hồ sơ đang chạy. Gom logic bản nháp bàn giao/trả phòng; giữ giới hạn, thứ tự, API và màn hình hiện hành.
- Chi tiết các module, điểm vào và lý do giữ cấu trúc xem [Backend](../business-flows/BACKEND.md) và [Frontend](../business-flows/FRONTEND.md). Không chia file theo số dòng một cách máy móc.

### Các ứng viên còn giữ có lý do

| Nhóm                                                                                                                               | Lý do không xóa hoặc hợp nhất vội                                                |
| ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `HoldingDepositAllocation`, `InitialMeterTask`, `TenantSettlementReceivables`, `SigningCertificates` và các component còn consumer | Giữ đường chạy hoặc compatibility cần thiết; không giảm coverage để đạt số file. |
| `ErrorBoundary.tsx`, `useSmsRecovery.ts` của client-core                                                                           | Có wildcard export package; chưa chứng minh không có consumer ngoài repo.        |
| Legacy persistence và các đường đọc dữ liệu đã ký                                                                                  | Có fixture/test, API hoặc dữ liệu lịch sử cần bảo toàn.                          |
| Validation khác null/role/annotation/mã lỗi; ledger, chế độ ký và thanh toán                                                       | Không đồng nhất về semantics dù code nhìn giống nhau.                            |
| Hơn 550 tài liệu lịch sử                                                                                                           | Phân loại bằng mục lục thay vì xóa bằng chứng hoặc sửa báo cáo lịch sử.          |

## Bản đồ đọc code ban đầu: hợp đồng và bàn giao

Bắt đầu từ src/backend/BHome.Api/Controllers/ContractsController.cs (prefix /api/v1/contracts). Các file Application dưới src/backend/BHome.Application/Contracts đều dùng namespace BHome.Application.Contracts.

| Hành động                 | API (tương đối với prefix)                    | Method và file Application                                                                                   |
| ------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Tạo giữ chỗ               | POST /holdings                                | CreateHoldingAsync - ContractHoldingService.cs                                                               |
| Chuyển giữ chỗ            | POST /{id}/holding-conversion                 | ConvertHoldingAsync - ContractHoldingService.cs                                                              |
| Tạo hợp đồng              | POST /                                        | CreateAsync - ContractService.cs                                                                             |
| Kiểm tra kích hoạt        | GET /{id}/activation-readiness                | ReadinessAsync - ContractService.cs                                                                          |
| Kích hoạt                 | POST /{id}/activate                           | ActivateAsync -> ActivateReadyAsync - ContractService.cs; tự động sau thanh toán cũng gọi ActivateReadyAsync |
| Xem bản kiểm tra          | GET /{id}/handover/draft                      | GetHandoverDraftAsync - ContractHandoverDraftService.cs                                                      |
| Lưu kiểm tra              | POST /{id}/handover/draft                     | SaveHandoverDraftAsync - ContractHandoverDraftService.cs                                                     |
| Nộp kiểm tra              | POST /{id}/handover/draft/submit              | SubmitHandoverDraftAsync - ContractHandoverDraftService.cs                                                   |
| Yêu cầu kiểm tra lại      | POST /{id}/handover/draft/reinspection        | RequestHandoverReinspectionAsync - ContractHandoverDraftService.cs                                           |
| Chủ trọ xác nhận sẵn sàng | POST /{id}/handover/draft/ready               | ReadyHandoverDraftAsync - ContractHandoverDraftService.cs                                                    |
| Khách thuê ký             | POST /{id}/handover/draft/tenant-sign/session | SignTenantHandoverInSessionAsync - ContractHandoverSigningService.cs                                         |

Khi theo dõi dữ liệu, mở Infrastructure/Contracts/ContractRepository.cs, ContractHandoverRepository.cs và HandoverDraftRepository.cs. Các đầu mối UI: Mobile features/contracts/HoldingContractFlow.tsx, MoveInDraftHandoverPanel.tsx; Owner Web features/handovers/pages/HandoversPage.tsx. Đây là chỉ mục điểm bắt đầu đọc, chưa phải đặc tả đầy đủ điều kiện, nhánh phụ hoặc các bảng dữ liệu.

## Thứ tự triển khai tiếp

1. Hoàn thiện audit từng module và xác định điểm vào nghiệp vụ, API đang được gọi, DI và bảng dữ liệu.
2. Dọn dẹp code đã xác minh không còn consumer, mỗi nhóm có commit và kiểm thử riêng.
3. Refactor Backend lần lượt: cơ sở/phòng/tài sản, giữ chỗ, hợp đồng, bàn giao, công tơ, hóa đơn, thanh toán, trả phòng, quyết toán, công việc/sự cố, jobs. Chỉ review bảo mật; không làm yếu quyền.
4. Refactor Owner Web, Mobile và Public Web theo cùng module; giữ API và hành vi; dùng lại client-core khi phù hợp.
5. Cập nhật bản đồ code hiện hành và sơ đồ theo Report 3; ghi rõ mâu thuẫn chưa thống nhất.
6. Kiểm thử hồi quy, CI và review nhóm. Chỉ merge/deploy sau khi có phê duyệt.

Tiêu chí cho mỗi module: đọc và giải thích được từ actor -> endpoint -> method -> điều kiện -> dữ liệu -> trạng thái; xác minh đường đi trước/sau; không thay đổi kết quả nghiệp vụ; ghi rõ kiểm thử và lý do tạo/xóa/gom file. Không đánh giá chỉ theo số lượng file giảm.
