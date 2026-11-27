# BHOME - Refactor để nhóm sinh viên làm chủ mã nguồn

Nhánh: `refactor/bhome-develop`. Mốc gốc: `origin/develop` tại `f3be1bfe` (PR #189). Không lấy các commit riêng của member/THuy làm mốc. Không merge hay deploy khi chưa nghiệm thu.

## Mục tiêu và giới hạn

Giữ nghiệp vụ, API, dữ liệu và các kiểm soát an toàn. Giảm code không dùng, trùng lặp và số bước cần đọc để hiểu một nghiệp vụ; không đặt chỉ tiêu xóa file tùy ý. Giữ kiến trúc API/Application/Domain/Infrastructure và các client hiện tại. Không thay đổi schema, xóa dữ liệu, làm yếu kiểm thử hay bỏ điều kiện xác minh thanh toán.

## Lộ trình

| Giai đoạn       | Đầu ra                                                       | Trạng thái                                                    |
| --------------- | ------------------------------------------------------------ | ------------------------------------------------------------- |
| P0 - Baseline   | Build, typecheck, test và mốc đối chứng                      | Build BE và typecheck Owner/Mobile đã pass; chưa chạy full CI |
| P1 - Audit      | Danh mục KEEP/DELETE/MERGE/SIMPLIFY/ARCHIVE/REVIEW có căn cứ | Bắt đầu với cấu trúc, hợp đồng và bàn giao                    |
| P2 - Dọn dẹp    | Loại bỏ phần không sử dụng, giữ chức năng                    | Lô đầu đã thực hiện                                           |
| P3 - Backend    | Từng module có điểm xử lý và quy tắc rõ ràng                 | Bắt đầu gom kiểu dữ liệu bàn giao                             |
| P4 - Frontend   | Component và API client dễ đọc                               | Đã loại bỏ component và helper không có consumer              |
| P5 - Tài liệu   | Sơ đồ, API, method, bảng và ngoại lệ theo code               | Bản đồ đọc code ban đầu bên dưới                              |
| P6 - Nghiệm thu | Regression, CI và review nhóm                                | Chưa hoàn thành                                               |

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
- Giữ `TenantEvidenceDraft.tsx` vì còn test sử dụng hàm validation. Giữ `SignatureImagePanel.tsx`, `ViettelSettingsPanel.tsx` và `MeterAssignment.tsx` trong nhóm REVIEW: chưa có consumer UI nhưng cần xác minh phạm vi nghiệp vụ trước khi bỏ.
- Giữ nguyên tài liệu lịch sử có nhắc tới các đường dẫn đã xóa; bản đồ này là chỉ dẫn hiện hành cho đợt refactor.

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
