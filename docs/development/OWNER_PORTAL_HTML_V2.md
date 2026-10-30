# Owner Portal — HTML v2 refactor

Ngày thực hiện: 30/10/2026. Phạm vi chỉ gồm `src/owner-web`; không đổi backend, database,
migration, authentication hoặc permission. File tham chiếu thực tế được cung cấp trong working tree là
`docs/bhome_sidebar_dashboard_v2.html` (khác đường dẫn `docs/ui-references/...` trong task).

## Traceability

| Hành vi                                                | Nguồn                               | Thành phần                                     | Kiểm tra                                    |
| ------------------------------------------------------ | ----------------------------------- | ---------------------------------------------- | ------------------------------------------- |
| Chain Dashboard → Location Workspace → functional tabs | BF-01, UC-04..07, prototype HTML v2 | router, AppShell, Dashboard, LocationWorkspace | router smoke + workspace navigation         |
| Location/Room Type/Room và bulk create                 | BF-01, UC-04..05                    | ConfigurationPages, Rooms, mockProperty        | Room Type + P.401..P.405 + duplicate code   |
| Asset Requirement khác Actual Asset                    | BF-01, UC-05                        | model, Assets, mockProperty                    | tạo Room Type/phòng không tăng Actual Asset |
| Kho/cấp phát không cộng vốn lần hai                    | FE-08, UC-34, GBR-13                | Assets, FinancePages, model                    | purchase/allocate/investment invariant      |
| Giá theo kỳ, giữ lịch sử                               | BF-01, UC-06, GBR-08                | FinancePages, mockProperty                     | từ chối khoảng hiệu lực chồng lấn           |
| Không đổi trạng thái phòng trái Contract               | UC-07, DBR-02                       | Rooms, mockProperty                            | phòng có hợp đồng/người ở bị từ chối        |

## Hiện trạng và thay đổi

Owner Web hiện dùng React 19, TypeScript strict, MUI, React Router, React Query và repository mock tách
khỏi component. Các module Location, Room Type, Room, Asset, Pricing và Investment đã tồn tại và được tái
sử dụng; không sao chép HTML/CSS/JavaScript prototype vào React.

Thay đổi lần này:

- Sidebar chỉ còn các nhóm nghiệp vụ cấp cao; Room, Room Type, Asset, Pricing và Investment không còn
  lặp thành menu riêng.
- Chain Dashboard hiển thị tổng cơ sở/phòng, phòng thuê/trống, tỷ lệ lấp đầy và danh sách cơ sở có link
  mở đúng workspace.
- Route workspace: `/locations/:locationId/{overview|rooms|room-types|assets|pricing|investment}`.
  Header và sáu tab dùng chung `locationId`; đổi cơ sở ở header giữ tab hiện tại và xóa search cũ.
- Route cũ vẫn được giữ để bảo toàn deep link.
- Bulk generator chấp nhận cả hậu tố `1` và số đầy đủ `401`; ví dụ tầng 4, prefix `P.`, start `401`,
  quantity `5` tạo `P.401`..`P.405`.

## API và mock boundary

Backend đã có API thật có phân quyền cho Location, Room Type, Room, Asset record và Billing Policy:
`/api/v1/locations`, `/room-types`, `/rooms`, `/assets`, `/billing-policies`. Auth API vẫn dùng client-core.

Owner Web hiện vẫn dùng `VITE_API_MODE=mock` cho toàn bộ dữ liệu nghiệp vụ. `VITE_API_MODE=api` từ chối
rõ ràng thay vì âm thầm trả mock. Lần refactor này chưa nối aggregate view model của portal vào các API
Property riêng lẻ vì các chức năng sau chưa có hợp đồng backend tương ứng:

- bulk room transaction;
- Room Type Asset Requirement;
- asset catalog, purchase/inventory, allocation/return/history;
- initial investment/OPEX/maintenance-cost aggregate;
- dashboard/workspace aggregate và các dữ liệu Contract/Incident/Invoice dùng trong Room detail.

Không được coi thao tác mock là thành công production. Bước tích hợp tiếp theo cần một API repository riêng,
DTO mapping theo OpenAPI và UI capability flags; không điền giả các field inventory/finance còn thiếu.

## Verification

Các lệnh phải được chạy lại ở lần bàn giao cuối; kết quả ghi trong câu trả lời cho người dùng, không dùng
số liệu trong tài liệu này làm bằng chứng CI lâu dài.
