# Đề xuất khoản thu khi trả phòng

Owner xử lý tại `/handovers?tab=move-out` ngay sau khi Staff gửi xong kết quả kiểm kê. **Không có bước Owner xác minh kết quả Staff** trong luồng đề xuất phí. Tenant xem và phản hồi trong chi tiết hợp đồng trên Mobile. Luồng này **không tạo biên bản, PDF hay chữ ký**.

## Danh sách Owner

`GET /api/v1/contracts/move-out-inbox?page=1&pageSize=20&locationId=&status=&room=` — chỉ Owner; lọc và phân trang ở Backend. Mỗi dòng có `contractId`, `roomNumber`, `locationName`, `status`, `proposedDate`, `inspectedAt`, `ownerConfirmedInspection`.

## Đề xuất và phản hồi

`GET /api/v1/contracts/{id}/move-out/receivables/proposal` — Owner hoặc Tenant thuộc hợp đồng. Kết quả trả về `reference`, `inspectionId`, `inspectionVersion`, `items`, `verifiedDeposit`, `availableDeposit`, `existingOutstanding`, `latestProposal`, `status`. Với Tenant, thông tin nội bộ/khóa thao tác được ẩn và đề xuất chỉ hiển thị cho người nhận hợp lệ.

Kết quả còn có `baselineContractId` (hợp đồng có bàn giao đầu vào đã xác nhận, hoặc `null`) và `items[].baselineEvidenceIds` (ảnh lúc nhận của đúng hạng mục). `items[].evidenceIds` vẫn là ảnh kiểm kê lúc trả. Owner xem trực tiếp ảnh bàn giao bằng API riêng tư `GET /api/v1/contracts/{baselineContractId}/handover/evidence/{fileId}`, ảnh trả phòng bằng `GET /api/v1/contracts/{id}/move-out/evidence/{fileId}`; không sử dụng URL công khai. Trường hợp không có ảnh thật trả mảng rỗng, không tự tạo ảnh.

`items[].evidenceIds` của nhóm tài sản bao gồm cả ảnh riêng của các tài sản vật lý thuộc nhóm đó, nếu Staff đã chụp. Ảnh này được xác thực theo người tải, hợp đồng, ID tài sản và hash trong kết quả kiểm tra cuối; Owner có thể dùng đúng ảnh liên quan làm căn cứ duyệt phí thực tế ở bước riêng.

Trên Owner Web, tab **Bàn giao** còn hiển thị ảnh đang lưu trong `GET /api/v1/contracts/{id}/handover/draft`, qua `GET /api/v1/contracts/{id}/handover/draft/evidence/{fileId}`. Tab **Trả phòng** ưu tiên đọc **cùng nguồn bản nháp bàn giao** để ảnh đã hiển thị ở tab Bàn giao không bị biến mất khi snapshot lịch sử chưa mang ID ảnh theo từng mục. Nếu bản nháp không có ảnh, giao diện dùng `baselineEvidenceIds` từ snapshot đã xác nhận làm dự phòng. Tất cả thao tác đều qua quyền truy cập file riêng tư.

`POST /api/v1/contracts/{id}/move-out/receivables/proposal` — Owner gửi đề xuất từ kết quả kiểm kê Staff đã hoàn thành, không cần thao tác xác nhận kiểm kê riêng. Bắt buộc `Idempotency-Key: <UUID>`.

```json
{
  "expectedReference": "<reference từ GET>",
  "inspectionId": "<inspectionId từ GET>",
  "inspectionVersion": 1,
  "items": [
    {
      "kind": "RoomCheck",
      "roomCheckCode": "cleanliness",
      "amount": "250000",
      "reason": "Chi phí vệ sinh cần thu"
    }
  ],
  "note": "Ghi chú tùy chọn"
}
```

Mỗi hạng mục đã kiểm kê (7 mục hiện trạng phòng, tài sản, chìa khóa) có nút **Nhập phí** mở modal nhập VND và lý do. Chủ nhà cũng có thể thêm **Mô tả bổ sung (nếu có)** ở cuối; nội dung gửi Tenant trong trường `note`. `kind` hợp lệ: `Asset` + `assetId`, `RoomCheck` + `roomCheckCode`, `Access` + `accessType=RoomKey`. **Không nhập tiền điện/nước trong đề xuất này**. Chỉ chọn hạng mục thực sự đã được Staff kiểm kê; khi không có số liệu đầu vào, Backend trả baseline chưa xác định chứ không suy đoán bằng 0. Backend kiểm tra quyền, phiên bản, nguồn tiền, trùng đối tượng, source reference và idempotency.

`POST /api/v1/contracts/{id}/move-out/receivables/proposal/tenant-feedback` — Tenant được nhận đề xuất phản hồi, cũng cần `Idempotency-Key: <UUID>`.

```json
{
  "proposalId": "<latestProposal.id>",
  "expectedReference": "<reference từ GET>",
  "confirmed": false,
  "reason": "Đề nghị đối chiếu lại khoản vệ sinh"
}
```

`confirmed=true` nghĩa là Tenant đồng ý, `confirmed=false` bắt buộc có lý do; trạng thái `PendingTenant`, `Accepted`, `Disputed` hoặc `Outdated`. Nếu tranh chấp, Owner có thể điều chỉnh và gửi một đề xuất mới. Mỗi đề xuất và phản hồi được ghi lịch sử JSONB/audit và có thông báo trong ứng dụng.

Khi Owner gửi bản sửa sau phản hồi tranh chấp, bản mới nhất được lấy theo **thứ tự ghi vào lịch sử** (không dựa vào thứ tự UUID khi hai lần gửi cùng thời điểm). Tenant phản hồi bản cũ sẽ bị từ chối; lịch sử đề xuất/ý kiến cũ được giữ nguyên.

## Số tiền

- `verifiedDeposit`: tiền cọc đã được xác minh thu.
- `availableDeposit`: số cọc còn khả dụng, có thể nhỏ hơn tiền cọc đã thu.
- `totalCharges`: các khoản mới trong đề xuất, **không gồm điện/nước**.
- `existingOutstanding`: các khoản phải thu cuối kỳ đã được ghi nhận mà vẫn còn dư nợ.
- `signedBalance = availableDeposit - totalCharges - existingOutstanding`: dương là cọc dự kiến còn hoàn; âm là dự kiến Tenant phải nộp thêm. Nợ hóa đơn riêng được xử lý tại quy trình hóa đơn/công nợ.

**Quan trọng:** Đây chỉ là đề xuất cần Tenant chấp thuận. Việc đồng ý **không tự sinh khoản phải thu, không cấn trừ cọc, không hoàn tiền, không quyết toán hay tự đóng hợp đồng**. Phát sinh nghĩa vụ thực tế và giải ngân vẫn qua các API quyết toán hiện hữu với kiểm tra sổ cái, quyền và phiên bản riêng.
