# Theo dõi tạm trú từng thành viên — 26/11/2026

Nguồn: quyết định trực tiếp ngày 26/11/2026, BF-04 / UC-18 / GBR-06 / JOB-08. Tenant đăng ký chính thức qua VNeID/cơ quan có thẩm quyền; BHOME chỉ lưu kết quả và minh chứng. Không có tích hợp nộp hồ sơ chính phủ.

## Quyền và vòng đời

- `GET /api/v1/residence-tasks`: Owner xem danh sách; Tenant xem hồ sơ của mình và, nếu là đại diện hợp đồng, các thành viên cùng hợp đồng. Danh sách chỉ đưa vào hợp đồng Active, thành viên đã có ngày bắt đầu cư trú thực tế và chưa chuyển đi. Dữ liệu dựa trên `contract_residents`; không tạo trùng nhiệm vụ khi tải/chạy lại.
- `GET/PUT /api/v1/residence-tasks/{contractId}/{residentId}`: Tenant tự cập nhật hoặc đại diện cập nhật trong cùng hợp đồng. `PUT` giữ các trường hiện tại và bổ sung `registrationExpiresOn` tùy chọn (ISO date). Ngày hết hạn không trước ngày cư trú. Bỏ qua/null không xóa hạn hiện có; Owner có thể xóa hạn qua cấu hình bên dưới.
- `POST .../owner-confirmation`: chỉ Owner xác nhận kết quả đã Completed và có minh chứng. Tải minh chứng/cập nhật kết quả tiếp theo hủy xác nhận cũ. Trạng thái và xác nhận được giữ riêng từng thành viên.
- `GET /api/v1/residence-tasks/tracking`: Staff chỉ xem dữ liệu vận hành ở Locations đang được phân công và trong thời gian làm việc hợp lệ. Chỉ lấy hợp đồng MAIN/RENEWAL đang Active, thành viên đã có `actual_residence_from` và chưa chuyển đi. Hỗ trợ `page/pageSize`, `locationId`, `search` (tên/phòng) và `filter=All|Pending|AwaitingReview|Completed|Overdue`; response gồm `stats` trên toàn bộ phạm vi được phân công, không phụ thuộc bộ lọc. Projection chỉ có tên hiển thị, phòng, vai trò cư trú, ngày bắt đầu cư trú thực tế, trạng thái cập nhật, mốc hạn/kết quả và thời điểm Owner xác nhận. Không trả số định danh, điện thoại, tài khoản, ghi chú, lịch sử, URL/minh chứng hoặc ảnh. `Completed` chưa được Owner xác nhận được xếp `AwaitingReview`; quá hạn dùng `registrationDeadline` do Owner ghi nhận và ngày Việt Nam. Staff không được dùng API hồ sơ chi tiết/download/upload/xác nhận.

Response hồ sơ bổ sung: `registrationExpiresOn`, `registrationRequired` (mặc định true cho đến khi Owner ghi nhận khác), `householdCompleted`. Hộ gia đình chỉ hoàn thành khi mọi thành viên đang cư trú, thuộc diện đăng ký đều Completed và được Owner xác nhận. Họ tên lấy từ hồ sơ đã xác nhận, gồm hồ sơ rút gọn của trẻ em không có định danh.

## Minh chứng chung

`PUT .../{contractId}/{residentId}/evidence?residentIds={id1}&residentIds={id2}` dùng raw `image/png` hoặc `image/jpeg`, tối đa 5 MB. Không có query thì giữ cách tải riêng hiện có.

- Người đại diện chọn rõ những thành viên có tên trong minh chứng; danh sách phải gồm người đang mở, không trùng, không rỗng, tối đa 100 người.
- Backend kiểm tra mọi thành viên cùng hợp đồng và quyền đại diện, tải object một lần rồi liên kết tất cả trong một transaction với khóa hàng theo thứ tự và reference kiểm tra cạnh tranh.
- Nếu một hồ sơ đã thay đổi/không hợp lệ, rollback tất cả và xóa object vừa tải. Một ảnh không tự hoàn thành/xác nhận trạng thái của những người được chọn.
- Download luôn kiểm tra quyền từng hồ sơ. Không trả object key hoặc URL public.

## Diện đăng ký, ngày hết hạn và cảnh báo

`PUT .../{contractId}/{residentId}/tracking-settings` chỉ Owner, body:

```json
{
  "registrationRequired": true,
  "registrationExpiresOn": "2027-11-26",
  "expectedReference": "reference từ GET hiện tại",
  "reason": "Đối chiếu hồ sơ thực tế"
}
```

`registrationExpiresOn: null` xóa ngày đã ghi nhận. Thiếu reference/lý do: 400; reference cũ: 409. Lịch sử append-only; không thêm cột hoặc migration.

Cảnh báo hết hạn bắt đầu từ **15 ngày trước ngày hết hạn**, theo ngày Việt Nam. Có thông báo riêng khi đã hết hạn và khi quá hạn đăng ký do Owner nhập. Publisher lưu khóa `contract/member/stage/date` để không phát trùng; nhận thông báo là Owner, người liên quan có tài khoản và đại diện. Không đưa PII/minh chứng vào nội dung thông báo hoặc gửi cho Staff.

Không suy đoán hạn pháp lý hay tự miễn đăng ký dựa theo tuổi/CCCD. Owner ghi nhận diện đăng ký từ hồ sơ thực tế và nhập lý do. Worker/publisher cần được bật/chạy trong môi trường triển khai; tác vụ này không thay cấu hình jobs của Staging.
