# Bàn giao tài sản toàn cơ sở khi Staff nhận phân công

## Nghiệp vụ

Khi một phân công Staff có hiệu lực, Backend tạo một OperationalTask chuyên biệt
theo AssignmentId, chống tạo trùng khi đồng bộ. Staff theo dõi checklist theo
phòng và tài sản khu vực chung, sử dụng tính năng tiến độ, báo vướng mắc và sự
cố hiện có của Công việc của tôi.

Phòng đang có Tenant được xác nhận theo hồ sơ nếu có hợp đồng hiệu lực, tài khoản
Tenant hợp lệ và biên bản bàn giao phòng đã xác nhận đủ. Những mục này có liên
kết đến hợp đồng/biên bản nguồn. Đây không phải kết quả Staff kiểm tra thực tế.
Phòng trống, phòng thiếu hồ sơ và tài sản khu vực chung cần kiểm kê trực tiếp.

Task: Assigned → InProgress → PendingVerification → Completed. Owner có thể
yêu cầu kiểm kê lại một số mục; chỉ những mục được chọn bị đặt lại và task
trở về InProgress. Kết quả không thể chuyển Completed bằng verify thông thường;
chỉ sau khi Owner và Staff xác nhận đúng cùng một biên bản, theo đúng thứ tự.

## API

| Method | Đường dẫn sau /api/v1/operational-tasks/{id} | Tác dụng |
|---|---|---|
| GET | /location-asset-inventory | Checklist + tiến độ |
| PUT | /location-asset-inventory/items/{itemId} | Staff xác nhận và liên kết sự cố |
| POST | /start, /progress, /blockers, /submit | Workflow công việc chuẩn |
| GET | /location-asset-handover | Biên bản đã đối soát |
| POST | /location-asset-handover/rework | Owner trả mục {taskVersion,itemIds,note} |
| POST | /location-asset-handover/approve | Owner duyệt {taskVersion,exceptionDecision?} |
| POST | /location-asset-handover/sign | Owner rồi Staff ký {revision,snapshotSha256,confirmed:true} |
| GET | /location-asset-handover/document | Tải PDF đã kiểm tra mã băm |

Backend giữ checklist trong JSON state của task trong Compact24, không thêm
bảng dữ liệu song song. PDF và snapshot được lưu private object storage, kèm
SHA-256. Sự kiện phê duyệt, chữ ký và các revision nằm trong lịch sử append-only
của Location; tài liệu cũ không bị ghi đè.

## Giới hạn

Chữ ký hiện tại là **xác nhận điện tử qua phiên đăng nhập**: lưu tài khoản,
thời gian, hash của snapshot và phiên bản tài liệu; **không phải** chữ ký số
có chứng thư số/PAdES. Nếu cần chữ ký số có giá trị tương ứng, cần tích hợp
phương thức xác thực/chứng thư số thật, không quảng cáo phương thức nội bộ
như chữ ký số được chứng thực.

Tài sản thuộc trách nhiệm Tenant theo hợp đồng và biên bản phòng không tự động
chuyển thành tài sản Staff phải bảo quản trực tiếp.

Integration Compact24 được thiết kế chạy trên database PostgreSQL dùng một lần,
chỉ khi có biến BHOME_COMPACT24_TEST_ADMIN chỉ về loopback database postgres;
không chạy fixture tạo/xóa lên database bhome hiện có.
