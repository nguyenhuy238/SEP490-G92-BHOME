# Triển khai PR #185 lên Staging để demo — 27/11/2026

## Phạm vi và nguồn

Theo yêu cầu trực tiếp của người dùng, triển khai thủ công commit
`91a36958e4d9476028c5f84ff0d59b3e797b91f6` của PR #185 mà không chờ CI.
Không merge/push, thay workflow hoặc đánh dấu CI thành công.

Truy vết: BF-03/BF-04, UC-17 (bàn giao phòng), GBR-01/02 (phân quyền),
NFR bảo mật/khôi phục. Đây là triển khai bản sửa có sẵn: token kiểm kê cho
move-in không bị vô hiệu chỉ vì phiên bản Room đổi; thay đổi tài sản thực
vẫn phải làm mất hiệu lực kiểm kê. Không bổ sung chính sách nghiệp vụ.

Nguồn dựng tách khỏi working tree, lấy đúng commit PR. Giữ ba file của hotfix
mẫu hợp đồng đang chạy trên Staging: `MainDraftService.cs`,
`MainDraftRenderer.cs`, `ContractSigningDocumentSource.cs`. Đã đối chiếu hash
hai assembly đang chạy với manifest của hotfix trước khi chuẩn bị bản mới.
Các test tương ứng của hotfix mẫu hợp đồng lấy từ `81cf0806` để dự án test
biên dịch đúng với nguồn đã giữ lại.

## Kết quả triển khai

- URL: https://owner-staging.103.146.23.157.sslip.io/login
- Image mới: `bhome/pr185-handover:demo-20261127-91a36958`.
- Image ID: `sha256:6ba2a05e7dd4b3fbcf1d0d8691b90dd443e3a3eecb5b35e15b5901c3d9c4aa0a`.
- Image trước: `bhome/staging-contract-template:20261127-ab10fd612d8e`.
- Chỉ thay hai assembly Application/Infrastructure trong image kế thừa bản
  đang chạy và recreate API Staging. Kiểm hash assembly trong image trước deploy.
- Giữ nguyên environment, mounts và Compose hiệu lực ngoài image API.
  Owner/Public Staging, Production, PostgreSQL, MinIO, Caddy và bundle cũ
  giữ nguyên container ID/image/mounts/thời điểm khởi động theo snapshot.
- Không migration/seed hoặc sửa dữ liệu nghiệp vụ để vượt kiểm tra bàn giao.
  Kiểm tra đăng nhập có tạo và thu hồi phiên kiểm thử tổng hợp.

Đã giữ hai khóa release chung/Staging trong lúc triển khai, lưu database dump
(đọc danh mục bằng `pg_restore --list`), private config và release overlay cũ.
Script có nhánh rollback về image trước nếu kiểm chứng thất bại. Lượt này
triển khai thành công, không kích hoạt hoặc diễn tập rollback/restore database.

## Kiểm chứng thực chạy

| Kiểm tra                                                                          | Kết quả              |
| --------------------------------------------------------------------------------- | -------------------- |
| Unit: Handover, MoveInInventory, RoomInventoryReviewServiceTests                  | 68 PASS, 0 fail/skip |
| Tích hợp: 5 phương thức bàn giao đã chọn, gồm các case theory ký Owner/Tenant     | 7 PASS, 0 fail/skip  |
| `dotnet publish` API Release trên Linux/.NET 8                                    | PASS                 |
| Readiness nội bộ sau recreate                                                     | PASS                 |
| HTTPS, public API, anonymous auth rejection, CORS cách ly và webhook không chữ ký | PASS trước/sau       |
| Synthetic login, refresh rotation, authorized read, logout                        | PASS trước/sau       |
| Inbox và đọc 10 draft bàn giao qua HTTPS                                          | HTTP 200 trước/sau   |
| Hash assembly trong image, environment/mounts và container được bảo vệ            | PASS                 |

Các lượt chuẩn bị đầu gặp lỗi truyền dấu `|` qua shell, thiếu hai project
tools trong archive, rồi test mẫu hợp đồng cũ không tương thích constructor
của hotfix được giữ lại. Đã sửa môi trường dựng riêng, bổ sung đúng nguồn/test
và chạy lại; kết quả cuối ở bảng trên. Không sửa source nghiệp vụ để làm test qua.
PostgreSQL dùng riêng cho test đã được xóa cùng dữ liệu tổng hợp sau kiểm chứng.

## Giới hạn và evidence

Lúc vừa deploy, một trong 10 draft vẫn có `inventory_changed`. Lượt xử lý tiếp
theo theo yêu cầu người dùng đã xác định và sửa riêng dữ liệu P.203 như mô tả
bên dưới. Không ký hoặc hoàn tất bàn giao thay người dùng. Test riêng xác nhận
token vẫn từ chối khi tài sản/cấu hình thực thay đổi.

Không chờ hoặc xác nhận kết quả CI đầy đủ. Không sửa `staging/current.json`
của luồng CD chuẩn; manifest riêng ghi rõ operator demo deployment và nguồn
ghép. Lần CD chuẩn tiếp theo cần chứa cả PR #185 và hotfix mẫu hợp đồng nếu
muốn giữ nguyên các hành vi này.

Evidence local ignored: `.tools/pr185-staging/` gồm source archives,
manifest/checksum, TRX, build logs, package và deploy script.
Evidence private trên VPS: `/opt/bhome-backups/staging-pr185-demo-20261127T073644Z/`
gồm backup, manifest, snapshot, smoke và probe trước/sau, `result.json`.
Package/worker log: `/opt/bhome-deploy/staging/hotfixes/pr185-demo-20261127/`.
Không tải database dump/private config về repository.

File tracked thêm trong lượt này: tài liệu này. Source ứng dụng trong working
tree không bị chỉnh sửa; chỉ bản dựng riêng và runtime Staging được cập nhật.

## Đồng bộ phiếu kiểm kê cũ P.203 theo yêu cầu demo

Hợp đồng `17694ab0-e4ab-4edb-bc0f-f04f996aa936` có phiếu kiểm kê Completed,
biên bản PendingOwnerReview phiên bản 14, chưa có chữ ký Owner/Tenant; chỉ bị
chặn bởi `inventory_changed`.

Đã khôi phục **chính xác** SourceToken ban đầu từ Room version 3, DesiredAssets
version 1, cùng published template, nhưng chưa có physical assets/mappings.
Sau đó Owner xác nhận kho phòng, tạo 4 physical assets/mappings và đưa
DesiredAssets lên version 2. Commit #185 xử lý phiên bản Room; nó không tự
chuyển đổi snapshot đã có từ trước bước bổ sung liên kết tài sản này.

Đã chạy công cụ bảo trì giới hạn đúng hợp đồng/phiếu trên, xác nhận đủ 4 item
ID, tên và số lượng kỳ vọng không đổi, mỗi item khớp một physical asset Active
version 1 có đúng số lượng, không có liên kết trùng; kết quả quan sát và bằng
chứng đã được lưu hợp lệ. Công cụ từ chối bản đã ký hoặc không còn đúng phiên
bản/trạng thái đã kiểm tra. Dry-run PASS và 6 ca âm tính (thiếu item, đổi số
lượng kỳ vọng, đổi tên, asset version tăng, asset retired, đổi số lượng vật lý)
đều bị từ chối.

Sau backup mới, trong transaction Serializable có khóa Location/Contract/task,
đã thay SourceToken cũ bằng MoveInStateToken hiện tại và tăng concurrency version
của phiếu; cập nhật timestamp kỹ thuật theo writer hiện hữu. Giữ nguyên toàn bộ
observations, evidence, Completed status/time, biên bản và chữ ký. So sánh JSON
inspection trước/sau xác nhận chỉ trường SourceToken thay đổi. Thêm một AUDIT
append-only với operator root qua SSH, lý do, token/version trước/sau; không
ghi nhận giả thao tác duyệt hoặc chữ ký của Owner/Staff/Tenant.

Kiểm chứng HTTPS sau sửa: riêng P.203 trả HTTP 200, `missing=[]`, kiểm kê
Completed đủ 4 item; PDF HTTP 200 và có header `%PDF-`. Đọc lại 10 draft thấy
0 `inventory_changed`. Container API không restart/recreate; protected snapshot
và cấu hình môi trường vẫn PASS.

Evidence private: `/opt/bhome-backups/staging-pr185-inventory-reconcile-20261127T074927Z/`
gồm database dump trước sửa, inspection trước/sau, repair log và result.
Mã công cụ, build log, dry-run và probe nằm trong `.tools/pr185-staging/` ignored.
Đây là sửa dữ liệu legacy có kiểm chứng cho P.203; không thêm endpoint tự bỏ
qua token hoặc cơ chế tự chấp nhận thay đổi tài sản cho các phiếu khác.
