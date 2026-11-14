# Tích hợp develop vào member/QHuy — 14/11/2026

Nguồn merge: `311a10081321a1bf580489bab2411e78e60fd6c7`; nhánh nhận trước merge: `f342827c`.
Merge đã được bắt đầu trước khi xử lý. Giữ các thay đổi đang staged, gồm bản giải quyết lockfile và script khởi động của người dùng; chỉ đồng bộ lại phiên bản safe area trong metadata workspace.

## Phạm vi giải quyết

| Hành vi cần giữ                                                                                                                           | Nguồn yêu cầu hiện có                                                        | Thành phần                                                                 | Kiểm tra hồi quy                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Holding có cấu hình và luồng chi tiết mới; metadata Holding không mở hồ sơ Main                                                           | BF-03/04, UC-13..19; quy tắc repo; luồng có sẵn trên develop                 | ContractService, DI, ContractScreen, HoldingContractFlow                   | ContractServiceTests, contract-sections, holding-signing-flow           |
| Kích hoạt phụ thuộc thanh toán xác nhận ở backend; không ghi nhận trùng                                                                   | BF-06, GBR-10/18; quy tắc repo                                               | ContractService, initial payment ledger                                    | SePayIntegrationTests, MainDraftReleaseTests, RuntimeSchemaUpgradeTests |
| Owner Mobile giữ giao diện đã thiết kế, quyết định nhanh theo trạng thái; đối chiếu tiền và công cụ thử nghiệm không mở trên Owner Mobile | docs/development/OWNER_MOBILE_REDESIGN.md; phạm vi thiết kế trên member/QHuy | OwnerMobileKit, IncidentActions, LiveWorkspaceScreens, HoldingContractFlow | incident-integration, holding-signing-flow, holding-sandbox-flow        |
| Giữ đúng phiên bản Expo và bổ sung thư viện ngày từ develop                                                                               | package.json và lockfile của hai nhánh                                       | Mobile dependencies                                                        | npm install, lint, typecheck, build, Expo export                        |

Đây là tích hợp hành vi đã có trên hai nhánh; không thay đổi quy tắc tài chính, quyền server hay phương thức ký. Các mã BF/UC/GBR ở trên dựa trên AGENTS.md và tài liệu phát triển hiện có; không phải một lần thẩm định lại SRS gốc.

Các file xung đột đã xử lý:

- `src/backend/BHome.Application/Contracts/ContractService.cs`
- `src/backend/BHome.Infrastructure/DependencyInjection.cs`
- `src/mobile/package.json`
- `src/mobile/src/components/OwnerMobileKit.tsx`
- `src/mobile/src/features/contracts/ContractScreen.tsx`
- `src/mobile/src/features/incidents/IncidentActions.tsx`
- `src/mobile/src/screens/LiveWorkspaceScreens.tsx`
- `src/mobile/src/__tests__/contract-sections.test.tsx`
- `src/mobile/src/__tests__/incident-integration.test.tsx`
- `tests/backend/BHome.Application.UnitTests/Contracts/ContractServiceTests.cs`
- `tests/backend/BHome.IntegrationTests/Compact24/RuntimeSchemaUpgradeTests.cs`
- `tests/backend/BHome.IntegrationTests/Compact24/SePayIntegrationTests.cs`
- `tests/backend/BHome.IntegrationTests/Contracts/MainDraftReleaseTests.cs`

## Kết quả xác minh và lỗi có sẵn từ develop

Mobile: 117 file, 1.226 test qua; typecheck, lint, frontend build, Expo web export và Prettier qua. Bổ sung kiểm tra đường dẫn Holding từ danh sách Owner và đồng bộ kỳ vọng test Incident với phạm vi Owner Mobile. Chuẩn hóa định dạng ba file incoming theo Prettier.

Backend: restore/build Release qua, không warning/error; Application 497 test, Domain 110 test, Integration 1.078 test qua / 23 ca bỏ qua. Integration chạy với PostgreSQL tạm riêng. Chuẩn hóa khoảng trắng LINQ trong `tools/BHome.LocalDevelopment/Job09Seed.cs` theo kiểm tra định dạng C#.

Owner Web: 536/540 test qua. Chạy lại riêng bốn file test trên checkout nguyên bản `311a1008` cũng tái hiện đúng bốn lỗi sau (26 test khác trong bốn file qua):

- `ExpensesApiPage.test.tsx`: kỳ vọng nút “Liên kết bổ sung” chưa có trong giao diện.
- `Automation.test.tsx`: không tìm thấy nội dung thiếu chỉ số điện theo kỳ vọng test.
- `FinancialReportsApiPage.test.tsx`: kỳ vọng bộ lọc mặc định là tháng trước, thực tế đang để trống.
- `FinancialScenariosApiPage.test.tsx`: kỳ vọng nút “Dùng tháng trước làm kỳ nền” chưa có trong giao diện.

Giữ nguyên các test và hành vi Owner Web này để theo dõi lỗi trên develop. Không triển khai thêm tính năng tài chính ngoài phạm vi giải quyết merge.

Kết quả backend và log thực thi chi tiết, gồm giới hạn kiểm thử, được ghi trong `.tools/merge-develop-20261114/RESULTS.md` tại máy làm việc (thư mục ignored).
