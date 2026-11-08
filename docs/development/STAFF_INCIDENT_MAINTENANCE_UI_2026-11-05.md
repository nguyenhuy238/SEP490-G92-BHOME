# Staff Mobile — Sự cố & Bảo trì (05/11/2026)

## Phạm vi và truy vết

Triển khai frontend-only theo yêu cầu đính kèm: UC-26 báo cáo, UC-27 phản hồi khẩn cấp, UC-28..30 kiểm tra/sửa chữa/nghiệm thu. Không thêm backend, schema, DTO hoặc nghiệp vụ. Giữ Staff guard, xác thực, WorkspaceShell và Expo Router. Không thay đổi màn sự cố Tenant.

Đã đối chiếu controllers, client-core và API client mobile: chưa có API Incident/Emergency/repair Work Order. Operational Tasks là chức năng riêng; không ánh xạ các nhiệm vụ này thành sự cố hay sửa chữa.

## Bốn khu vực giao diện

1. Nhóm “SỰ CỐ & BẢO TRÌ”: ba card hai cột, kích thước tối thiểu đồng nhất, press feedback, mô tả riêng và icon đỏ nhẹ cho khẩn cấp. Bỏ badge “Chưa khả dụng” lặp lại trên từng card; màn đích trình bày khả năng thực tế.
2. Báo cáo: form nháp có cơ sở, phòng/khu vực chung, tài sản tùy chọn, hai mức độ xem trước, mô tả và ảnh hiện trường. Nút gửi luôn khóa và có giải thích. Không giả lập thành công, không lưu báo cáo vào local storage, không upload ảnh.
3. Xử lý: ô tìm kiếm khóa, trạng thái thiếu kết nối riêng và phần mở rộng kiểm tra hiện trạng/phương án/tiến độ-nghiệm thu. Không dựng danh sách, status filter hay detail record giả. Nút Công việc được giao là shortcut nhỏ riêng.
4. Khẩn cấp: icon và nền đỏ nhẹ, hướng dẫn an toàn, trạng thái thiếu kết nối và phần mở rộng thông tin/tiếp nhận/lịch sử. Không có cảnh báo, timestamp, timeline event hoặc xác nhận tiếp nhận giả.

Topbar, quay lại, vùng cuộn, safe area và bottom navigation dùng WorkspaceShell hiện có. Các màn mới không đi qua UnavailableWorkspaceScreen nên không còn nút Hợp đồng của cơ sở. Cả live và preview dùng màn mới; preview không tải dữ liệu xác thực và không ghi RequestHistory sự cố giả.

## Tích hợp API có thật

- `GET /api/v1/capture/locations`: dùng `Named.id`, `label`, danh sách đã được backend giới hạn theo phân công Staff có hiệu lực.
- `GET /api/v1/capture/locations/{id}/rooms`: dùng `Named.id`, `label`; chỉ tải sau khi cơ sở đã được xác nhận trong kết quả API.
- `GET /api/v1/assets?locationId=...&roomId=...&page=...&pageSize=100`: tái sử dụng request có xác thực; quyền `Property.View` hỗ trợ Staff và repository giới hạn cơ sở. Sử dụng `id`, `locationId`, `roomId`, `name`, `code`, `commonArea`; page metadata dùng `items`, `totalCount`. Không đổi AssetDto. Tài sản phòng lọc đúng room; khu vực chung chỉ dùng tài sản không có roomId. Có chuyển trang khi tổng kết quả vượt 100; không diễn giải tổng tài sản thành số sự cố.

Chọn lại cơ sở/khu vực sẽ bỏ chọn room/asset và ảnh nháp tương ứng. Loading và lỗi/thử lại cho từng nguồn dữ liệu tách khỏi trạng thái chưa hỗ trợ gửi báo cáo. Request bị hủy và kết quả cũ bị loại khi đổi query/phiên bằng useWorkspaceQuery hiện có. Endpoint capture hiện giới hạn 100 cơ sở/phòng theo thiết kế backend; không tự thêm phân trang không được hỗ trợ.

Mức độ, mô tả và ảnh chỉ là dữ liệu tương tác xem trước, không phải trường Incident DTO. Không validate hoặc POST theo một hợp đồng API tự suy đoán. Quyết định phê duyệt và nghiệm thu vẫn thuộc Owner.

## Ảnh nháp và giới hạn

Tái sử dụng CameraCapture và validator ảnh hiện có: tối đa 5 ảnh JPEG/PNG, tối đa 5 MB/ảnh. Có preview grid và xóa ảnh. Ảnh chỉ ở bộ nhớ, xóa khi blur/background/unmount; không tạo liên kết file công khai. Mã hóa preview dùng JavaScript tương thích native, không dựa vào btoa của trình duyệt.

Web dùng file input để chọn thư viện. Android/iOS tái sử dụng camera; nút thư viện ảnh khóa kèm thông báo vì ứng dụng chưa có image picker native. Không thêm dependency. Chưa hỗ trợ gửi ảnh đến Incident vì chưa có endpoint phù hợp.

## File chính

- `src/mobile/src/screens/StaffIncidentScreens.tsx`: ba màn và các section dùng chung.
- `src/mobile/src/features/workspace/useStaffIncidentScope.ts`: query phạm vi form và tài sản.
- `src/mobile/src/components/IncidentEvidencePicker.tsx`: ảnh nháp.
- `src/mobile/src/components/StaffFeatureCard.tsx`, `StaffFeatureDirectory.tsx`, `features/workspace/staffFeatures.ts`: nhóm overview.
- `src/mobile/src/app/workspace/[screen].tsx`: route live/preview.
- `src/mobile/src/screens/StaffWorkflowScreens.tsx`: bỏ form sự cố mẫu có thành công giả.
- `src/mobile/src/__tests__/staff-incidents.test.tsx`: phân quyền, API scope/đổi scope, lỗi/thử lại, unavailable, preview và ảnh nháp.

## Kiểm chứng

- Mobile: 46 test files, 472 tests đạt; trong đó 15 tests mới cho module này.
- TypeScript, ESLint, Prettier và `git diff --check` đạt.
- Expo export Android/iOS/Web thành công tại `.tools/staff-incidents-export`.
- Không kiểm chứng tương tác trực tiếp trên thiết bị: Computer Use không có native pipe/browser host trong phiên. Export bundle không thay thế kiểm thử Android/iOS thực tế.
