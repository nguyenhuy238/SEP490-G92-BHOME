# Tạm trú Tenant — tích hợp FE ngày 08/11/2026

Phạm vi: UC-18, boundary tạm trú trong AGENTS.md và yêu cầu đính kèm “REDESIGN & INTEGRATE TENANT TEMPORARY RESIDENCE SCREEN”. Đăng ký và xác nhận chỗ ở trên VNeID thực hiện bên ngoài. BHOME theo dõi dữ liệu Tenant cung cấp và xác nhận nội bộ của Owner. Không triển khai tạm vắng hoặc nộp hồ sơ nhà nước.

## Thay đổi

- Mobile: `TenantServiceScreens` xuất màn `TenantResidenceScreen` mới. Route `residence` và bottom tabs hiện tại được giữ; Shell dùng một tiêu đề “Đăng ký tạm trú”, refresh icon/pull-to-refresh, spacing gọn và keyboard avoidance sẵn có.
- Dữ liệu từ list/detail API; định danh gồm contractId + residentId, không hiển thị UUID. Một hồ sơ không có selector/pagination; nhiều hồ sơ có selector người/phòng; chỉ phân trang khi totalCount > pageSize.
- Pending → Bắt đầu đăng ký (InProgress). InProgress → ảnh đã lưu + ngày/giờ kết quả + ghi chú → Completed. Ngày/giờ nhập theo giờ Việt Nam, gửi ISO UTC. Completed không có thao tác quay về Pending/InProgress.
- Completed có thể sửa kết quả hoặc thay ảnh theo API hiện có. Khi đang có Owner confirmation phải xác nhận cảnh báo sẽ hủy xác nhận cũ trước khi gửi.
- Một ảnh hiện tại: dùng Expo ImagePicker đã cài, camera hoặc thư viện, chọn một ảnh, kiểm tra MIME/signature và 5 MiB, preview trước upload. Body là bytes JPEG/PNG, Bearer qua transport hiện có. File picker trong app cache được xóa sau khi đọc; preview và buffer chỉ giữ trong bộ nhớ, buffer xóa khi bỏ/thay ảnh hoặc rời màn.
- Ảnh Backend đọc bằng authenticated byte response; chuyển data URI trong bộ nhớ, có xem lớn/tải lại. Không sử dụng URI local làm JSON, public object URL hoặc bộ đếm ảnh nháp.
- Trạng thái và Owner confirmation tách riêng. Lịch sử từ detail, ba mục mới nhất trước, ghi chú dài có mở rộng. Chưa có hồ sơ không hiển thị form giả.
- VNeID không có deep link đã được xác minh trong repo: dùng hướng dẫn mở ứng dụng chính thức thủ công, không tạo deep link hoặc tuyên bố đã nộp hồ sơ.
- Owner Web `/temporary-residence`: nối khu vực có sẵn với list/detail/evidence và POST owner-confirmation trong API mode, yêu cầu ghi chú; chỉ hiện nút khi Completed, có evidence và chưa Owner-confirmed. Mock mode giữ ResourcePage với nhãn dữ liệu minh họa. Không thêm màn hoặc quyền cho Staff.
- `packages/client-core/src/residence.ts` tập trung DTO, sáu API, nhãn và validation; hook list/record dùng chung giữa hai FE.

## Ghi dữ liệu và lỗi

- Chỉ hiển thị TaskView do Backend trả về; sau mutation thành công GET lại detail và đọc lại ảnh. Không tự gắn OwnerConfirmed hoặc trạng thái thành công trước response.
- Khóa double tap/ghi đồng thời. Khi thất bại giữ form/ảnh đã chọn; cần đọc lại và đối chiếu trước lần ghi tiếp. Không tự retry PUT/POST vì API này không có hợp đồng Idempotency-Key/version.
- 401/403/404 gỡ detail cũ; lỗi ảnh độc lập không khóa form. Trạng thái lạ không phát sinh thao tác.
- Backend vẫn kiểm tra liên kết Tenant–Resident, hợp đồng Active, actualResidenceFrom >= residenceFrom, evidence/resultAt khi Completed và transition không lùi. DTO không trả contract status; FE không tự suy đoán hợp đồng Active từ hồ sơ cư trú.
- Không tạo field mã hồ sơ tham chiếu; không có DTO/API để lưu field đó.

## Kiểm chứng

- Mobile: 14 kiểm thử mới về tải compound detail, single/multiple records, pagination, payload/timezone, bắt đầu, hoàn tất, raw image upload/download với Bearer, reset Owner confirmation, camera permission, giữ note và review sau 409, mất quyền, unknown status, lỗi ảnh và refresh trạng thái Owner.
- Các test Mobile liên quan `liveWorkspace-ui` và `workspace-navigation` được cập nhật/kiểm tra cùng màn mới: tổng **175 test PASS** trong ba file.
- Owner: 5 test về ảnh/ghi chú/xác nhận/read-back, Pending/InProgress không được xác nhận, Tenant không truy cập Owner area, giữ note và khóa gửi lại sau 409.
- Typecheck và lint Mobile/Owner Web PASS; production Owner Web build PASS; Expo export Android PASS (`.tools/residence-android-export`).

## Trở ngại Backend thật — không sửa trong phạm vi FE

Lần gọi bằng tài khoản test tổng hợp: GET `/api/v1/residence-tasks?page=1&pageSize=20` trả HTTP 500. Đã tái hiện nguyên truy vấn list ở chế độ chỉ đọc với Npgsql: PostgreSQL `42P08: could not determine data type of parameter $2`.

Vị trí: `CompactOperationsRepository.ResidenceParameters`, tham số `status` truyền `DBNull.Value` qua `AddWithValue` không có kiểu tường minh; SQL dùng tham số này trước tiên trong `@status IS NULL`. Sửa đề xuất là khai báo `NpgsqlParameter("status", NpgsqlDbType.Varchar)` với giá trị query.Status/DBNull. Chưa áp dụng vì attachment giới hạn sửa Backend khi chưa có yêu cầu rõ ràng. Các lần kiểm tra sau còn gặp HTTP 502 ở login; không khẳng định đã chạy thành công trọn luồng API thật.

ADB báo không có thiết bị/máy giả lập. Chưa xác minh trực tiếp bố cục, keyboard, photo picker trên Android/iOS trong lượt này. Các kiểm thử component không thay thế kiểm thử thiết bị. Không thay đổi schema/migration, không ghi dữ liệu tạm trú thật trong các thử nghiệm này.
