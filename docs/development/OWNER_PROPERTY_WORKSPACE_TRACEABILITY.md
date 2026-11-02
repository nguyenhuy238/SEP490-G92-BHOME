# Owner Web — BF-01 Location Workspace traceability

Ngày cập nhật: 02/11/2026. Phạm vi: giao diện và dữ liệu mô phỏng Owner Web; không thay đổi API,
schema hoặc quy tắc phân quyền backend.

## Nguồn nghiệp vụ

- BF-01, UC-04..07, GBR-08, DBR-02: Cơ sở → Loại phòng → Phòng; cấu hình tài sản mẫu;
  giá/phí có phạm vi và thời gian hiệu lực; giữ lịch sử.
- `docs/development/PROPERTY_MANAGEMENT_GAP_REVIEW.md`: backend vẫn thiếu liên thông đầy đủ
  Contract/occupancy, Invoice snapshot, Work Order và một số API tài sản/copy cấu hình.
- Thông tư 60/2025/TT-BCT về thực hiện giá bán điện.
- Luật Giá 16/2023/QH15, Nghị định 117/2007/NĐ-CP và Thông tư 44/2021/TT-BTC về giá nước sạch;
  biểu giá cụ thể do cơ quan có thẩm quyền tại địa phương ban hành.
- Luật Phí và lệ phí (VBHN 92/VBHN-VPQH): chỉ gọi là phí/lệ phí Nhà nước khi có đúng căn cứ và
  thẩm quyền; dịch vụ vệ sinh, an ninh hoặc dịch vụ khác của cơ sở phải ghi rõ nguồn và thỏa thuận.

## Hành vi frontend mock đã triển khai

| Yêu cầu                                       | Component / state             | Kiểm chứng                                                                                                                |
| --------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Tạo Cơ sở → Loại phòng → Phòng                | `ConfigurationPages`, `Rooms` | Route/build và property flow tests                                                                                        |
| Copy cấu hình                                 | `location` command            | Chỉ copy loại phòng, định mức, chính sách không theo phòng và nội quy; test không copy Room/Asset/Contract/Tenant/Expense |
| Phòng mới chờ cấu hình                        | `createRooms` command         | `IN_SETUP / UNAVAILABLE`, kiểm tra trùng mã                                                                               |
| Danh mục, nhập kho, cấp phát đơn lẻ/đồng loại | `Assets`, `allocate` command  | Mỗi phòng có allocation riêng; tổng số lượng bị chặn theo tồn kho                                                         |
| Timeline tài sản                              | `assetEvent`                  | Nhập kho, cấp phát, thu hồi, tình trạng, sửa chữa, thay mới, khấu hao, kiểm tra                                           |
| Chính sách giá/phí có phiên bản               | `priceVersion`                | Tạo bản mới và đóng bản cũ vào ngày liền trước; không sửa đè                                                              |
| Nội quy vận hành có phiên bản                 | `operatingRuleVersion`        | Giữ bản cũ và chặn khoảng hiệu lực chồng lấn                                                                              |
| Tổng quan lấp đầy                             | `LocationOverview`            | KPI hiện tại và timeline chỉ từ mốc hợp đồng có dữ liệu                                                                   |

## Ranh giới bắt buộc trước production

- Backend là nguồn sự thật cho quyền Owner/Location, tồn kho, trạng thái phòng, hợp đồng, hóa đơn
  và mức phí được áp dụng. Frontend không được tự coi mutation mock là giao dịch thật.
- Chưa được xem timeline hợp đồng hiện tại là lịch sử occupancy đầy đủ; cần model occupancy có thời
  gian và tích hợp activation/move-out.
- Khấu hao trong giao diện là số liệu Owner nhập để theo dõi, không phải kết quả kế toán/tax tự động.
- Thay mới tài sản không tự tạo tài sản mới: phải thu hồi, nhập kho và cấp phát theo workflow.
- Khi API production được chốt, cần DTO/API, authorization, concurrency, audit và integration/E2E
  tương ứng trước khi bật các mutation này ngoài mock mode.

## Kết quả kiểm tra frontend

- `npm run typecheck`: PASS.
- `npm run lint`: PASS.
- `npm run build`: PASS.
- `npx vitest run --pool=threads --reporter=verbose`: PASS, 96/96 tests.
- `git diff --check`: PASS.
