# Bàn giao tài sản theo hợp đồng

## Nguồn và phạm vi

Baseline: `member/QHuy`, `5b2323a724a8b273e0f1a77adf2f324982a33b20`, workspace sạch.
Đã fetch origin ngày 16/11/2026. `origin/develop` (`784b3b15`) đã là ancestor của baseline.
Đã so sánh merge-base/log/diff của `origin/FE/truong` (`5aa51b3d`): chỉ hai commit chưa tích hợp,
`96cd3c8e` (Asset, cấu hình, RoomInventoryReview và kiểm thử) và `5aa51b3d` (sửa CI của cùng thay đổi).
Cherry-pick chọn lọc thành `0063a7d6`, `21970184`, không có conflict; không merge toàn nhánh hoặc push.

Traceability: yêu cầu người dùng ngày 16/11/2026, 16 quyết định nghiệp vụ được duyệt và các yêu cầu bổ sung
→ BF-01/03/04/05/07, UC-06/17/19/20/26–30, GBR-01/02/04/07/18.
Đã đọc SRS, SDS trong `docs/reports`, README, AGENTS, API_CONVENTIONS và các hướng dẫn bàn giao/renewal/move-out.
Quyết định được ghi trong yêu cầu này cho phép bàn giao vật lý trước khi hoàn tất tài chính; giữ nguyên
quyết định BR-19/23/25 trong MOVE_OUT_RELEASE_ALIGNMENT. Xác nhận bàn giao trong app không phải chữ ký số.
Không tìm thấy bản quy tắc Git riêng theo tên trong danh mục AGENTS; áp dụng quy tắc nhánh/commit từ AGENTS và yêu cầu này.

## Kế hoạch và tiêu chí chấp nhận

1. Dùng lại RoomInventoryReview và AssetMetadata của Trường; cung cấp DTO chuẩn bị nội bộ có đủ nhóm cấu hình,
   mapping ổn định và token. Không suy luận mapping bằng tên; không tạo kho Asset khác.
2. Bàn giao vào phòng: số lượng theo tình trạng, evidence theo nhóm, ngoại lệ Owner theo phiên bản,
   xác nhận đúng phiên bản của Tenant, task idempotent khi activation và snapshot bất biến.
3. PDF: dùng font/renderer iText, ContractDocumentFile và private storage hiện có; lưu byte/hash/version,
   kiểm tra quyền và integrity khi tải, retry không nhân bản.
4. Bổ sung/thay thế/thu hồi: một sự kiện vật lý theo phòng, xác nhận riêng từng hợp đồng, baseline lịch sử;
   thay thế tham chiếu BF-07; không tự phát sinh bồi thường hoặc Asset mới.
5. Move-out: baseline renewal + thay đổi đã xác nhận, legacy exception, phản hồi Tenant, Owner review,
   cập nhật Asset có concurrency guard, shared-room occupancy và quyết định trạng thái phòng của Owner.
6. Nối client-core, Owner Web, Staff/Tenant Mobile, kiểm thử tương tác và chạy các lệnh CI thực tế.

Kiểm thử cần bắt được: thiếu 2/9 nhóm; số lượng âm/tổng sai; thiếu evidence; scope sai; token/phiên bản cũ;
Tenant chưa xác nhận; lặp activation/confirmation/PDF; snapshot lịch sử thay đổi; shared-room/renewal/legacy;
Staff tạo receivable hoặc sửa inventory; lỗi storage, PDF và cập nhật đồng thời.

## Kiến trúc dữ liệu

Giữ nguyên 24 bảng. Mở rộng các snapshot JSONB và tài liệu Setup có version/history hiện có.
Mutation hợp đồng dùng transaction của ContractRepository: khóa ledger → Location → Room, đọc lại sau khóa.
Thao tác Asset trong cùng transaction và dùng version của dữ liệu chuẩn bị; không sửa DesiredAssets/template.
Không chạy migration hoặc seed trên database người dùng.

## Bằng chứng ban đầu

`dotnet restore src/backend/BHome.sln`: exit 0.
`dotnet build src/backend/BHome.sln -c Release --no-restore`: exit 0, 0 warning/error sau tích hợp.
Kết quả kiểm chứng cuối cùng được ghi trong báo cáo testing của thay đổi này.
