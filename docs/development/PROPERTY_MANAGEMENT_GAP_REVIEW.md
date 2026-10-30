# Đối chiếu phần còn thiếu của cấu hình tài sản và giá phí

Ngày 30/10/2026. Phạm vi: một Chain, Location, Room Type, Room, Asset và giá/phí tối thiểu;
chỉ BE/Postman theo yêu cầu, không đánh giá hoặc triển khai FE.

Nguồn nghiệp vụ: Report 3 `BHome_Report-3_Software Requirement Specification (2).docx`, BF-01,
UC-04..07, GBR-02/08/12/13, DBR-02/13; Report 4 §3.1..3.5/3.20 và các quyết định của chủ dự án
ngày 29–30/10. Nguồn kỹ thuật đã đọc: PropertyService/PropertyContracts, PropertyControllers,
LocationsController, PropertyConfiguration/PropertyRecords, Resident và CaptureRepository.

## Đã có trong phạm vi tối thiểu

- Một Chain duy nhất, Owner xem/đổi tên, Location tự gắn Chain.
- Tạo/danh sách phân trang/chi tiết/cập nhật/ngừng Location, Room Type, Room, Asset.
- Owner quản lý; Staff đọc theo assignment hiện hành; Tenant/Guest không browse DTO quản trị.
- FK cùng Location, kiểm tra dữ liệu, mã trùng chuẩn hóa, version và bảo vệ cập nhật đồng thời.
- Giá/phí theo Location/Room Type/Room, ưu tiên từng khoản, ngày hiệu lực, báo thiếu cấu hình.
- Tạo/thay/kết thúc giá; PUT giá tương lai chưa dùng; cấm chồng kỳ; giữ audit append-only.
- Postman và environment có các request cùng biến phục vụ kiểm thử.

Không đồng nghĩa đã hoàn tất toàn bộ UC-04..07 hoặc luồng cho thuê/thanh toán/bảo trì.

## Khoảng trống liên thông cần làm trước khi vận hành đầy đủ

| Mục                                 | Hiện trạng trong code                                                                                                | Cần bổ sung                                                                                                                                       | Nguồn                             |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Trạng thái Room theo nghĩa vụ thật  | Chỉ cấu hình Available/Unavailable, dự phòng OnHold/Occupied; bảo vệ dựa vào trạng thái và sự tồn tại Resident       | Contract/holding/occupancy có thời gian/vòng đời, chống trùng nghĩa vụ, activation/move-out tự chuyển trạng thái và kiểm tra nghĩa vụ trước ngừng | UC-04 A2; UC-07; DBR-02           |
| Phân biệt đang ở/đã rời và sức chứa | Resident hiện chưa có vòng đời cư trú; capture tạo Resident không kiểm tra tổng người ở so với capacity              | Tích hợp onboarding/occupancy để kiểm tra số người đang ở và giải phóng đúng phụ thuộc sau move-out, không xóa hồ sơ lịch sử                      | UC-04 capacity; GBR-05; UC-13..19 |
| Giá thực sự được dùng cho Invoice   | RecordUsage/FirstUsedAt tồn tại nhưng chưa có caller billing, Invoice/InvoiceLine hoặc FK/snapshot tham chiếu policy | Lấy giá theo ngày/cơ sở hợp đồng, ghi snapshot và đánh dấu dùng trong cùng transaction/khóa; regression race giữa xuất hóa đơn và sửa giá         | UC-06 A4; GBR-08/09; UC-21        |
| Asset và bảo trì                    | Lưu Asset/condition/status; chặn ghi đè UnderRepair, có audit cấu hình                                               | Work Order/inspection/handover, lịch sử sửa chữa/thay thế và chi phí; Owner xác minh để đưa Asset từ UnderRepair về trạng thái đúng               | UC-05 A3/A4; UC-17; GBR-12        |

Các mục trên là luồng tương lai đã được hoãn trong đợt API cấu hình, không phải lỗi chứng minh
CRUD đang hỏng. Riêng không được sử dụng FirstUsedAt như bằng chứng đã tích hợp Invoice thực.

## Phần có thể bổ sung ngay trong các API cấu hình

1. **API xem lịch sử thay đổi:** PropertyChanges đã lưu actor/UTC/reason/before/after và DB cấm
   sửa/xóa, nhưng chưa có GET cho Owner xem lịch sử theo Location/Room Type/Room/Asset/policy.
   Cần quyền, scope, DTO và phân trang phù hợp. Đây là phần làm lịch sử truy cập được, không
   phải xây lại hoặc thay thế audit đang có (UC-04..06, GBR-13/DBR-13).
2. **Hủy policy tương lai chưa dùng:** hiện có end nhưng effectiveTo không được trước
   effectiveFrom; không có thao tác hủy toàn bộ một policy chưa bắt đầu mà vẫn giữ dấu vết.
   Đây là đề xuất tiện ích, chưa có quyết định về cơ chế/trạng thái hủy. Không tự thêm status,
   xóa cứng hoặc đặt rate=0 như cách thay thế hủy.
3. **Vòng đời Asset UnderRepair:** hiện có thể khai báo trạng thái này, còn API cấu hình sẽ
   chặn đổi condition/status khi đang UnderRepair. Work Order chưa có nên chưa có đường hoàn
   thành bảo trì trong hệ thống. Cần hoàn thiện workflow hoặc chốt phạm vi thao tác tạm trước
   khi dùng trạng thái này cho vận hành thật; không tự bỏ guard để hoàn thành demo.

Ưu tiên cho bản cấu hình dễ kiểm thử: API lịch sử, rồi quyết định hủy giá tương lai. Ưu tiên
để vận hành nghiệp vụ: Contract/occupancy và Invoice, sau đó Maintenance/Work Order.

## Những mục đã được chủ dự án cho hoãn

- Copy cấu hình Location (UC-04 A5).
- Ảnh/đính kèm, bộ tài sản mặc định theo Room Type (UC-05); chuyển tài sản chưa nằm trong slice.
- Lịch sử occupancy đầy đủ UC-07; public status và xuất bản thông tin đã duyệt.
- Phí theo người/bậc thang, phân bổ theo ngày và các công thức ngoài fixed/metered tối thiểu.

Không coi các mục hoãn hoặc lựa chọn một Chain/không xóa cứng là lỗi của phạm vi đã duyệt.
Các công thức tiền, phân bổ kỳ và chính sách mới vẫn phải được chốt trước khi bổ sung.

## Triển khai và mức kiểm chứng

Đã sao lưu rồi áp dụng FlexibleFutureBillingPolicies vào bhome local: 8 applied/0 pending,
1 Chain; restart BE và health ready/live 200, Swagger có PUT policy/firstUsedAt. Không đổi FE.
Kiểm tra live lần này không dùng credential để gọi business mutation, không tạo dữ liệu giả
trong database người dùng. Các lượt automated test trước đó: 211 không Docker và 108 native
PostgreSQL PASS; không diễn giải chúng thành coverage hoặc tuân thủ toàn bộ BF-01.

Chưa kiểm chứng: toàn bộ Docker/PostgreSQL 16/MinIO, E2E nghiệp vụ xuyên Contract/Invoice/Work
Order, hiệu năng ở quy mô mục tiêu. Báo cáo này là đối chiếu phần chức năng vừa triển khai,
không phải audit toàn repository hoặc kết luận không còn lỗi bảo mật.
