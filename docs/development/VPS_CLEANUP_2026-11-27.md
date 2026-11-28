# Dọn dung lượng VPS ngày 27/11/2026

Phạm vi: vệ sinh Docker cache trên VPS `103.146.23.157` theo yêu cầu người dùng. Không thay đổi nghiệp vụ, API, schema, phân quyền, cấu hình hoặc bản ứng dụng đang chạy. Truy vết: yêu cầu vận hành trực tiếp, NFR về tính sẵn sàng và khôi phục; không có thay đổi BF/UC/GBR.

## Kết quả thực đo

| Chỉ số                     |    Trước |       Sau |
| -------------------------- | -------: | --------: |
| Mức sử dụng filesystem `/` |      88% |       65% |
| Dung lượng trống           | 6,86 GiB | 19,92 GiB |
| Số image Docker            |      132 |        72 |
| Container đang chạy        |       13 |        13 |
| Persistent volume          |        6 |         6 |

Đã giải phóng khoảng **13,06 GiB** (14.022.045.696 byte theo checkpoint). Dung lượng trống có thể dao động nhẹ do log, dữ liệu và evidence tiếp tục được ghi. Đây là số đo filesystem thực tế, không cộng kích thước danh nghĩa của các image có chung layer.

Trước khi dọn, Docker báo image khoảng 39,61 GB; sau khoảng 25,59 GB. Cache image tích lũy qua nhiều release là nguyên nhân chính, không phải dữ liệu PostgreSQL/MinIO. Hai môi trường Production/Staging cùng các container legacy vẫn đang hoạt động trên VPS.

## Quyết định giữ/xóa

[Runbook Production](BHOME_PRODUCTION_RELEASE_RUNBOOK.md) yêu cầu không xóa rollback images/volumes tùy tiện. Lần kiểm tra này đọc metadata của 1.600 tệp cấu hình, manifest và hồ sơ phát hành/backup; 127/132 image có tham chiếu runtime hoặc lịch sử. Do đó không dùng system prune, image prune hàng loạt hoặc volume prune.

Đã lập danh sách riêng 60 image GHCR BHOME cũ hơn 48 giờ, không được container nào sử dụng và không thuộc danh sách bảo vệ hiện hành. Người dùng đã **duyệt rõ việc xóa đúng 60 image trong danh sách** sau khi được giải thích rằng khôi phục bản cũ hơn có thể phải tải lại image từ registry. Quyết định chỉ áp dụng cho lượt dọn này, không thiết lập chính sách retention tự động cho tương lai.

Giữ nguyên:

- Toàn bộ image đang được container dùng, mọi image hotfix/custom `bhome/*`.
- Image được cấu hình hiện hành và current manifest tham chiếu, cùng ba release chuẩn thành công gần nhất của mỗi môi trường khi có đủ lịch sử.
- PostgreSQL/MinIO, toàn bộ sáu volume, Caddy và chứng chỉ, private config, key ring, backup, mã nguồn và hồ sơ triển khai/rollback.
- Log hệ thống và log ứng dụng hiện có; không truncate, vacuum hoặc xóa bằng chứng kiểm tra để tăng số dung lượng giải phóng.

## Cách thực hiện

- Đăng nhập SSH với kiểm tra host key có sẵn. Không ghi mật khẩu vào script, repository hoặc báo cáo.
- Khóa release chung, Staging và Production bằng các file lock hiện hữu trong lúc kiểm tra/xóa; không dừng các dịch vụ ứng dụng.
- Chụp snapshot ID/image/start time/restart count/mounts/networks và mã băm cấu hình của 13 container; chụp metadata sáu volume và mã băm private config/release metadata. Không in giá trị environment/private config vào log.
- Xác minh checksum của danh sách người dùng đã duyệt trước khi thực hiện. SHA-256: `d2906e4d2a7f070a05dee881e431f9ef3ebaea11cdd33b63a9bcdf0296a2eb1b`.
- Xóa lần lượt bằng `docker image rm --no-prune <image-id>`, không dùng force và không prune parent images. Tất cả 60 lệnh đều thành công.
- Kiểm tra cache build không dùng hơn bảy ngày bằng `docker builder prune --force --filter until=168h`: lệnh thành công, **0 B** được giải phóng thêm. Không xóa cache mới chỉ để tăng số liệu.

## Kiểm chứng trước/sau

| Kiểm tra thực chạy                                                                          | Kết quả                |
| ------------------------------------------------------------------------------------------- | ---------------------- |
| 13 container: ID, image, thời điểm khởi động, restart count, môi trường, mounts và networks | Không đổi              |
| Sáu volume: tên và metadata                                                                 | Không đổi              |
| Mã băm của 1.600 tệp metadata/config được kiểm tra                                          | Không đổi              |
| Image được bảo vệ theo danh sách sau quyết định của người dùng                              | Giữ đủ                 |
| Owner/Public Production qua HTTPS                                                           | HTTP 200               |
| Owner/Public Staging qua HTTPS                                                              | HTTP 200               |
| `/api/auth/me` không đăng nhập trên API Production/Staging                                  | HTTP 401 đúng kỳ vọng  |
| Readiness nội bộ của cả hai API                                                             | HTTP 200               |
| Container health đã được cấu hình                                                           | Giữ trạng thái healthy |

Các container không có Docker healthcheck không được báo giả là healthy; readiness của API Staging được kiểm tra trực tiếp. Không chạy lại đăng nhập tổng hợp, giao dịch, ký hợp đồng hoặc các luồng ghi nghiệp vụ. Không thực hiện migration, seed, restore database, recreate/restart container, thay certificate/configuration hoặc triển khai release.

Probe readiness ban đầu qua `docker exec ... curl` không chạy được vì image API không có curl. Đã dùng image công cụ MinIO sẵn có với `--pull=never`, chia sẻ network namespace của từng API và tự xóa container kiểm tra sau khi kết thúc; cả hai readiness đều 200 trước/sau. Một lệnh liệt kê Docker ban đầu bị mất dấu quote của format qua SSH Windows; đã kiểm lại số container bằng lệnh không dùng format phức tạp. Các lỗi công cụ này không phải lỗi ứng dụng và không được tính là kiểm tra thành công.

Không tuyên bố đã kiểm thử toàn bộ nghiệp vụ hoặc diễn tập rollback/restore trong lượt này. Việc xóa cache của image lịch sử không xóa hồ sơ/backup tương ứng; khôi phục bản lịch sử ngoài các image giữ lại có thể cần truy cập registry.

## Evidence

Evidence root-only tại `/root/bhome-maintenance/cleanup-20261127/`: `before.json`, `after.json`, `historical-image-proposal.json`, `user-approval.json`, `image-removals.json`, `cache-cleanup.json`, `http-before.json`, `http-final.json`, `result.json`.

Evidence local ignored tại `.tools/vps-cleanup-20261127/`: script kiểm tra/bảo trì, danh sách đã duyệt và các kết quả đã lọc; không tải database dump hoặc private config vào repository. Tệp mới trong Git của tác vụ này chỉ là tài liệu hiện tại; không commit/push, không sửa các tệp chưa commit có sẵn.
