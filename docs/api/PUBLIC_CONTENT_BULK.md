# FE-09 — Quản lý nội dung công khai theo phòng

Các API dưới đây dành cho Owner có quyền `public-content.publish` và chỉ thao tác dữ liệu công khai thuộc cơ sở được chọn. Guest chỉ đọc nội dung đã công bố qua `/api/v1/public/*`.

## API

| Method | Route                                                              | Mục đích                                                                                   |
| ------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| GET    | `/api/v1/public-content/locations/{locationId}/rooms`              | Danh sách phòng, nội dung nháp, trạng thái, giá tham khảo và phiên bản; tối đa 2.000 phòng |
| POST   | `/api/v1/public-content/locations/{locationId}/rooms/bulk/preview` | Xem trước thay đổi và xung đột từng phòng                                                  |
| POST   | `/api/v1/public-content/locations/{locationId}/rooms/bulk/apply`   | Áp dụng preview đã xác nhận                                                                |

Payload của hai POST dùng chung:

```json
{
  "mode": "RoomDefaults",
  "sourceId": "00000000-0000-4000-8000-000000000001",
  "sourceVersion": 2,
  "targets": [{ "roomId": "00000000-0000-4000-8000-000000000002", "expectedVersion": 4 }],
  "fields": ["description", "amenities", "indicativePrice"],
  "fillEmptyOnly": true
}
```

`mode` nhận `RoomDefaults`, `Room`, `Manual`, `Publish`, `Unpublish`. Khi `mode=Manual`, truyền trực tiếp `description`, `amenities`, `indicativePrice`; khi đăng/ẩn, truyền `fields: []` và không cần nguồn. `sourceId/sourceVersion` bắt buộc đối với nguồn loại phòng hoặc phòng khác. `fields` xác định chính xác những trường có thể được thay đổi. Giá công khai là mức **tham khảo theo phòng mỗi tháng**, không thay thế biểu phí hay giá hợp đồng.

Preview trả `previewHash` cùng `rooms[]`. Mỗi phòng có `roomId`, `roomNumber`, `currentVersion`, `status`, `issue` và `changes[]` gồm tên trường, giá trị cũ/mới, `conflict` (sẽ ghi đè giá trị riêng nếu Owner đã tắt `fillEmptyOnly`). Các trạng thái preview: `Ready`, `Skipped`, `Conflict`. Phía client chỉ hiển thị nút xác nhận sau khi preview thành công.

Áp dụng yêu cầu gửi lại payload cùng `previewHash` vừa nhận. Máy chủ kiểm tra điều kiện nguồn và phiên bản, khóa các bản ghi trong giao dịch, cập nhật hàng loạt bằng một truy vấn và trả `Applied`, `Skipped` hoặc `Conflict` theo từng phòng. Nếu nguồn/điều kiện chung của preview thay đổi, trả HTTP 409 `public_bulk_preview_changed`; cần tải lại và tạo preview mới. Nếu riêng một phòng thay đổi phiên bản, phòng đó trả `Conflict`, các phòng hợp lệ khác vẫn có thể áp dụng. Gửi lại request đã áp dụng sẽ không ghi đè phòng có version mới.

Áp dụng từ loại phòng chỉ nhận phòng có `RoomProvenance.roomDefaultsId` khớp với loại phòng nguồn. Nguồn được đọc từ cấu hình `RoomDefaults` hiện có, có phiên bản và trạng thái `Recorded`; không tạo template mới. Ảnh phòng không nằm trong các trường sao chép. Chỉnh sửa nháp không tự động xuất bản; `Publish` là thao tác riêng, chỉ hợp lệ sau khi cơ sở được công bố và phòng có mô tả. Phòng đang đăng có nháp mới sẽ xuất hiện dưới dạng cần cập nhật; Owner xác nhận để phát hành snapshot mới. Snapshot đã công bố vẫn độc lập với nháp. Ẩn phòng khiến Guest không đọc được nội dung/ảnh riêng của phòng.

## Kiểm thử

Regression integration: `OwnerPublicContentPreviewTests` (phân quyền, bảo vệ trường riêng, xung đột từng phòng, gửi lại, nguồn bị sửa, publish/unpublish, snapshot Guest). Regression component: `PublicRoomsWorkspace.test.tsx`, `PublicContent.test.tsx`; Guest: `PublicContentPages.test.tsx`.
