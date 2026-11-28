# API bàn giao tài sản

Phạm vi: UC-17 và kiểm tra trả phòng UC-19 theo quyết định ngày 16/11/2026.
Định nghĩa DTO chuẩn nằm trong `BHome.Api/DTOs/Contracts/ContractHandoverContracts.cs`,
`ContractAssetChangeContracts.cs`, `ContractContracts.cs`; client dùng `packages/client-core/src/contracts.ts`.
Backend xác nhận trạng thái, quyền và số lượng. Client không tự quyết định thanh toán hoặc liability.

## Quyền và yêu cầu chung

Prefix hợp đồng: `/api/v1/contracts/{id}`. Owner, Staff đang phụ trách Location và Tenant của chính hợp đồng
được đọc tài liệu/biên bản theo scope. Mutation nghiệp vụ hợp đồng dùng `Idempotency-Key` là UUID khác rỗng;
retry cùng thao tác, khóa và payload trả kết quả đã ghi nhận. Không tái sử dụng khóa cho payload khác.

HTTP: 401 khi chưa xác thực; 403 sai vai trò; 404 với đối tượng ngoài phạm vi;
400 dữ liệu không hợp lệ; 409 stale version/token hoặc transition không được phép; 413 vượt giới hạn ảnh/tài liệu.
Các lỗi có `code` theo conventions hiện có. Không có URL storage công khai trong response.

| Method/path sau prefix                                                   | Vai trò ghi | Mục đích                                                                         |
| ------------------------------------------------------------------------ | ----------- | -------------------------------------------------------------------------------- |
| GET `handover` / `handover/history`                                      | —           | Snapshot/version và lịch sử; dùng baseline nguồn khi gia hạn                     |
| GET `handover/choices`                                                   | Staff       | Đủ nhóm cấu hình, physical mapping, readings, ảnh và inventory token             |
| POST `handover`                                                          | Staff       | Lưu phiên bản kiểm kê nhận phòng                                                 |
| POST `handover/owner-review`                                             | Owner       | Chấp nhận ngoại lệ hoặc yêu cầu kiểm tra lại; tạo phiên bản mới                  |
| POST `handover/tenant-confirmation`                                      | Tenant      | Xác nhận đúng phiên bản                                                          |
| POST `handover/disputes`                                                 | Tenant      | Gửi nội dung cần sửa                                                             |
| POST `handover/staff-confirmation`                                       | Staff       | Hoàn tất khi đủ xác nhận; lưu PDF và đóng task                                   |
| POST `handover/evidence`                                                 | Staff       | Upload bytes PNG/JPEG riêng tư, tối đa 5 MB/file                                 |
| GET `handover/evidence/{fileId}` / `handover/meter-evidence/{readingId}` | —           | Download có kiểm quyền, chỉ bằng chứng thuộc snapshot/phiên bản được phép        |
| GET `handover/documents`                                                 | —           | Danh sách report của hợp đồng và lineage cùng Room/Tenant                        |
| GET `handover/documents/{documentId}`                                    | —           | Byte PDF đã lưu; kiểm hash/length; không render lại                              |
| POST `handover/documents/retry`                                          | Owner/Staff | Tạo báo cáo nhận phòng còn thiếu từ snapshot Confirmed, hoặc trả file đã tồn tại |
| GET `asset-changes`                                                      | —           | Các event liên quan và acknowledgment đã scope                                   |
| GET `asset-changes/preparation`                                          | Owner/Staff | Inventory, nguồn PropertyChange/Verified WO và baseline hiệu lực                 |
| POST `asset-changes`                                                     | Staff       | Ghi event bổ sung/thay thế/thu hồi có nguồn thật                                 |
| POST `asset-changes/{eventId}/confirmation`                              | Tenant      | Nhận hoặc tranh chấp event                                                       |
| GET `asset-changes/{eventId}/evidence/{evidenceId}`                      | —           | Bằng chứng event chia sẻ; không mở quyền sang hợp đồng nguồn của Tenant khác     |
| GET `move-out/inspection-preparation`                                    | Owner/Staff | Baseline, nhóm đối chiếu, inventory token, final readings, cờ phòng chung/legacy |
| POST `move-out/legacy-baseline-exception`                                | Owner       | Ghi căn cứ cho baseline thiếu hoặc không có số lượng                             |
| POST `move-out/inspection`                                               | Staff       | Kết quả kiểm tra thực tế theo scope/lịch hiện có; không tạo PDF/chữ ký           |
| GET `move-out/inspections`                                               | —           | Các phiên bản, snapshot và phản hồi/quyết định                                   |
| POST `move-out/tenant-feedback`                                          | Tenant      | Xác nhận/tranh chấp phiên bản kiểm tra                                           |
| POST `move-out/inspection-review`                                        | Owner       | Chấp nhận hoặc reinspection; chỉ bước chấp nhận mới cập nhật Asset               |
| POST `move-out/complete`                                                 | Owner       | Hoàn tất vật lý và lưu PDF; không xác nhận đã quyết toán                         |

Các endpoint request/approval/schedule/final utilities/settlement/receivables/refund hiện có vẫn áp dụng.
Không tạo hệ thống reading, Asset inventory hoặc bồi thường độc lập.

## Snapshot nhận phòng và kiểm tra cuối kỳ

Draft nhận phòng gửi `version` (0 khi mới), `inventoryToken`, `date`, `roomCondition`, `keysAndAccess`, `notes`,
`electricityReadingId`, `waterReadingId`, `evidenceIds` (ảnh toàn cảnh), `assets`.
Mỗi asset dùng **group ID** từ choices, không phải tên hoặc một physical ID suy đoán.

Mỗi dòng gửi `condition`, `observedQuantity`, `handedOverQuantity`, `goodQuantity`, `wornQuantity`,
`damagedQuantity`, `missingQuantity`, `checked`, `notes`, `evidenceIds` riêng của nhóm.
Số lượng là integer 0–10.000; tốt + hao mòn + hỏng = thực tế; bàn giao ≤ thực tế.
Số thiếu được đối chiếu với số cấu hình/baseline. Nhóm có nhiều physical Asset gửi thêm
`physicalObservations: [{id, quantity, condition, handedOverQuantity?}]` đúng mapping và tổng.

Nhóm thiếu/hỏng/sai lệch cần evidence riêng: **không dùng lại ID ảnh toàn cảnh**.
Một ảnh riêng có thể liên kết nhiều nhóm; PDF chú thích đầy đủ các nhóm đó.
Tối đa 10 ảnh toàn cảnh và 5 ảnh mỗi nhóm; upload nhận phòng có giới hạn tổng file hiện có, mỗi file ≤5 MB.
Server kiểm MIME/content/hash và scope file. Chỉ chọn readings đã được Staff xác nhận đúng ngày kiểm kê.

Owner review: `{version, accepted, reason, handlingPlan}`. Tenant/Staff quyết định nhận phòng:
`{version, note}`. Owner thay đổi quyết định tạo version mới, reset xác nhận Tenant; không giả định Tenant đã đồng ý.
Hợp đồng vẫn Active khi Draft/Disputed/chưa hoàn tất. Renewal kế thừa baseline không tạo lại Move-in.

Ngoại lệ phòng không có tài sản là thao tác Owner tại:
`POST /api/v1/locations/{locationId}/room-inventory-review/{roomId}/no-assets`,
body `{stateToken, reason}` từ handover preparation. Token là opaque, không tự tính phía client.

## Event tài sản trong kỳ thuê

Body tạo event: `{sourceId, kind, date, reason, inventoryToken, lines}`;
kind là `Supplement`, `Replacement`, `Withdrawal`.
Mỗi line: `{groupId, removedAssetId?, addedAssetId?, addedQuantity, withdrawnQuantity, condition, evidenceIds}`.
Nguồn phải thuộc Asset/Room; Replacement cần Verified Work Order và quan hệ AssetReplacement hiện có;
Withdrawal cần thao tác quản lý Asset đã giảm/thu hồi số thực tế. Không tạo Asset hoặc khoản thu từ endpoint này.

Event vật lý là nội dung bất biến phiên bản 1. `AssetChangeView.version` là revision lưu trữ có thể tăng khi có phản hồi;
body xác nhận là `{version: 1, confirmed, reason}` theo phiên bản nội dung vật lý.
Retry acknowledgment không cộng số lượng lần nữa; chỉ event Tenant đã nhận mới vào baseline đối chiếu.
Tổng đã nhận hiệu lực được giữ riêng; không suy đoán lại số tốt/hao mòn/hỏng sau một thay đổi chỉ có mô tả tình trạng.

`acknowledgementContractId` chỉ party hợp đồng gốc của event; khi Tenant gia hạn cùng Room,
Tenant có thể phản hồi qua hợp đồng hiện hành của chính mình. `actingContractId` lưu hợp đồng thực hiện phản hồi.
Lineage khác Room/Tenant hoặc cycle bị từ chối. Tài liệu, bằng chứng và acknowledgment cũ vẫn đọc được theo lineage hợp lệ.

Response GET, mutation và retry cho Tenant chỉ gồm party/acknowledgment của họ.
`evidenceContractId` nội bộ được che bằng UUID rỗng; client tải ảnh qua endpoint event, không truy cập hợp đồng nguồn.
Owner/Staff được xem thông tin vận hành trong quyền hiện có; không có dữ liệu công nợ riêng của Tenant khác trong event.

## Move-out — kết quả kiểm tra, không tạo PDF mới

Inspection gửi các trường checklist/reading/evidence hiện có và `inventoryToken`; `proposedCompensation` chỉ là mô tả đề xuất.
Tenant feedback cũ `{version, confirmed, reason}` là tùy chọn, không phải
chữ ký và không chặn Owner duyệt. Owner review:
`{version, confirmed, reason, noAdditionalCharges}`; các trường
`tenantException`, `tenantExceptionReason` của client cũ được bỏ qua.
Reinspection tạo snapshot/version mới, giữ phiên bản cũ. Legacy exception không tạo dữ liệu lịch sử giả.

Complete: `{actualEndDate, roomDisposition}`, với `Available` hoặc `Unavailable` do Owner chọn.
Máy chủ kiểm tra lại hợp đồng Active khác trong transaction; phòng còn Tenant tiếp tục Occupied.
Các nghĩa vụ tài chính, cọc, payment/refund tiếp tục theo dõi và không bị tự xóa hoặc coi là đã thanh toán.

Chỉ tạo PDF mới cho `MoveInReport` và `AssetChangeReport`. **Không tạo
`MoveOutReport` mới**: kết quả kiểm tra được lưu vào `ContractFinalInspection`
với ảnh riêng tư, hash, người duyệt/thời điểm/lý do/phiên bản.
Các PDF MoveOutReport lịch sử nếu có vẫn lưu/đọc đúng quyền để bảo toàn audit.
Metadata có ID, kind, Contract ID, template/version, timestamp, hash/length; byte trong private object storage.
Generation/storage failure và retry PDF chỉ áp dụng MoveIn/AssetChange.
Download kiểm scope và integrity. Báo cáo đã lưu không đổi khi sửa cấu hình, Asset, ngày hoặc tài chính sau này.
MoveOut không có người ký hay chữ ký; MoveIn/AssetChange tuân theo cơ chế riêng.
