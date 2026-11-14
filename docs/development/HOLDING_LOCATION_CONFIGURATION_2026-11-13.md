# Cấu hình giữ chỗ theo cơ sở

## Quyết định được yêu cầu

User xác nhận ngày 13/11/2026: "tháng" là số tháng giữ chỗ theo cơ sở; tiền giữ chỗ mặc định bằng một tháng tiền thuê phòng, Owner được điều chỉnh. Thay đổi này bổ sung cấu hình thực tế cho BF-01/BF-03, UC-04..07/13..16, GBR-01/02/08 và phần thời hạn Holding của OQ-03 trong phạm vi cấu hình do Owner chọn. Không tự suy ra chính sách hoàn/hủy cọc hoặc quyền ký mới.

## UI và dữ liệu

- Owner Web: menu Thư viện cấu hình → Cấu hình giữ chỗ, route `/configuration/holding-contracts`.
- Bắt buộc chọn cơ sở trước khi nhập. Mỗi cơ sở có số tháng giữ chỗ, hệ số tiền giữ chỗ theo giá thuê và điều khoản riêng.
- Hệ số tiền cọc trên form mới mặc định 1 theo yêu cầu; số tháng giữ chỗ và điều khoản không có giá trị mặc định. Không tự ghi cấu hình vào Neon.
- Công thức: giá thuê hiệu lực của phòng × hệ số đã lưu. Số tiền nguyên VND dùng cách bỏ phần lẻ như luồng Holding hiện hành. Không dùng `securityDeposit` của Main Contract.
- Bắt đầu là ngày nghiệp vụ hiện tại theo Asia/Ho_Chi_Minh; hết hạn bằng ngày bắt đầu cộng số tháng lịch. `expiresAt` là 00:00 giờ Việt Nam của ngày hết hạn, đổi sang UTC. Số tháng giới hạn kỹ thuật 1–120; hệ số lớn hơn 0, tối đa 120, tối đa hai số thập phân.
- Xem thử mức cọc theo phòng dùng cấu hình đã lưu, không hiển thị giá từ dữ liệu chưa lưu như thể đã áp dụng.
- Mobile đọc thời hạn, tiền, điều khoản và phiên bản từ API Holding riêng sau khi chọn phòng và xác minh người giữ chỗ. Thiếu cấu hình/giá thuê thì chặn và thông báo, không tự dựng ngày hoặc tiền.

## API mới

- `GET /api/v1/contracts/holding-settings/{locationId}`: Owner đọc cấu hình cơ sở.
- `PUT /api/v1/contracts/holding-settings/{locationId}`: Owner lưu `holdingMonths`, `depositRentMonths`, `terms`, `expectedVersion`.
- `GET /api/v1/contracts/holdings/preparation?roomId=...`: Owner/Staff đọc báo giá/thời hạn; Staff phải đang được phân công cơ sở của phòng.
- `POST /api/v1/contracts/holdings`: giữ endpoint tạo hiện có, thêm `settingsVersion` tùy chọn. Mobile gửi phiên bản và các giá trị được chuẩn bị. Khi có phiên bản, server kiểm tra lại thời hạn, tiền, điều khoản và phiên bản trước khi tạo; cấu hình/giá thay đổi trả conflict để tải lại. Luồng nhập Holding thủ công cũ không gửi phiên bản được giữ tương thích.

## Lưu trữ và an toàn

Cấu hình lưu ở `locations.operating_settings.holdingContractSettings` của Compact24, không thêm bảng/cột hoặc chạy migration. Cập nhật khóa hàng Location trong transaction, kiểm tra phiên bản, merge đúng khóa JSON, tăng version và ghi lịch sử/audit. Không thay cấu hình hợp đồng chính thức, biểu phí hoặc giá đã chốt của hợp đồng đã tạo. Không seed hoặc chỉnh phân công/dữ liệu nghiệp vụ Neon để demo.

## Kiểm tra

- Backend API build: đạt, không lỗi/cảnh báo build.
- ContractService unit tests: 51/51 đạt, gồm tính tháng/tiền/múi giờ và thiếu cấu hình.
- Docker Compact24: 2/2 đạt (cấu hình hai cơ sở, quyền Staff, xung đột phiên bản, báo giá cũ, hợp đồng đã tạo không bị viết lại; danh sách hỗn hợp Holding/Main và scope).
- Mobile: 86/86 đạt trên 7 file kiểm tra danh sách/chi tiết/tạo Holding/ký/summary và Main flow.
- Owner Web: 9/9 đạt (form giữ chỗ và API proxy config); kiểm tra đổi cơ sở không giữ dữ liệu cũ và chỉ gửi PUT đúng cơ sở đã chọn.
- Typecheck Mobile/Owner Web và lint đạt. Không kiểm tra bố cục pixel trên thiết bị thật trong lần này.
- Smoke API đang dùng Neon qua Cloudflare: readiness 200; Staff đọc cấu hình Owner bị 403; chuẩn bị Holding tại cơ sở chưa cấu hình trả 409 `holding_settings_required`. Không lưu cấu hình mẫu lên Neon.

## File thay đổi cho cấu hình mới

- `src/owner-web/src/features/contracts/pages/HoldingSettingsPage.tsx` và test: form theo Location, hệ số cọc, thời hạn tháng, xem giá theo phòng.
- `src/owner-web/src/components/layout/AppShell.tsx`, `src/owner-web/src/app/router.tsx`, `routePaths.ts`: menu và route.
- `packages/client-core/src/holdingSettings.ts`, `contracts.ts`: DTO/client chuẩn bị giữ chỗ và thông báo lỗi.
- `src/mobile/src/features/contracts/ContractDraftForm.tsx`, `ContractScreen.tsx`: bỏ nguồn cấu hình Main, nhận giá/ngày từ Holding API; test cập nhật ở `holding-draft.test.tsx`.
- Backend Application: `HoldingSettingsContracts.cs`, `ContractHoldingSettingsService.cs`, `ContractHoldingService.cs`, `ContractService.cs`, `ContractContracts.cs`.
- Backend Infrastructure/API: `HoldingSettingsData.cs`, `DependencyInjection.cs`, `ContractsController.cs`.
- Tests backend: `ContractServiceTests.cs`, `ContractStaffListTests.cs`, `PropertyContractDockerTests.cs`.
