# Khôi phục dung lượng cho Staging CD — 26/11/2026

## Nguyên nhân đã xác nhận

Yêu cầu: kiểm tra và sửa lỗi job `release / staging` trong [CI #359](https://github.com/nguyenhuy238/SEP490-G92-BHOME/actions/runs/45776202889), commit `59e5c2e876b6949321850d43d0c0ca2db0698bac`, job `139773150103`.

GitHub API xác nhận backend, frontend-quality, ba frontend workspace, quality gate và ba bước build image đều thành công. Job Staging đã xác minh manifest rồi dừng sau `PASS: snapshot staging`.

Trên VPS, evidence của worker `staging-45776202889-1` có `compose.before.json` nhưng chưa có `schema.sha256` hoặc database dump. Script đang cài dừng tại kiểm tra:

```bash
test "$(df --output=avail -B1 /opt | tail -1)" -gt 4294967296
```

Dung lượng trống đo được là `3218841600` bytes, khoảng 3 GiB, dưới ngưỡng hơn 4 GiB theo runbook. `set -e` làm bước này thoát mã 1 mà không in lý do. Bản trong repository đã có thông báo dung lượng và exit 7 rõ ràng, nhưng bản cài trên VPS còn thiếu thay đổi đó. Đây là lỗi điều kiện vận hành lúc deploy; cảnh báo `actions/download-artifact@v5` dùng Node 20 không phải bước làm job này thất bại.

## Xử lý thực tế

- Đối chiếu 951 file metadata trong `/opt/bhome-deploy`, `/opt/bhome-backups`, `/opt/bhome-config`; giữ tất cả image đang được container, cấu hình, manifest, identity hoặc hồ sơ rollback tham chiếu. Không đọc nội dung private config vào log hoặc đưa vào Git.
- Dưới hai khóa release chung/Staging, quét lại danh sách bảo vệ và chỉ xóa cache local của một image registry cũ không được tham chiếu: `ghcr.io/nguyenhuy238/bhome-api:sha-05d74df548fbcb185ab546bb887369ebc62b660c`, image ID `sha256:c833ee2be10627f3bb3343562139d1f72d24254a7062860272ec10dcd0ba15b6`. Dùng `docker image rm --no-prune`, không dùng force, system prune, volume prune hoặc xóa backup.
- Dung lượng trống tăng từ `3218567168` lên `5105967104` bytes, khoảng 4,76 GiB. Kiểm tra ngưỡng trên script cài thật đã qua.
- Sao lưu script cũ rồi thay nguyên tử **chỉ** `/opt/bhome-deploy/staging/deploy-release.sh` bằng đúng bản repository đã kiểm tra cú pháp. SHA-256 cũ `42013ea4e2729d683ace1ae26a84caea1ff4be551e0be0932cf21cd2020f5338`; mới `aa5cb82c2b0555343823571bb15bad729d634cf2ce3c23d687538db0247b89ef`.
- So sánh ID/image/mount/thời điểm khởi động của toàn bộ 13 container trước/sau: không đổi. `release-safety.py unchanged staging` qua; không thực hiện ghi DB, migration, seed, thay volume, cấu hình private hoặc cập nhật ứng dụng. Script Production không bị sửa.

Evidence root-only trên VPS: `/opt/bhome-deploy/staging/disk-recovery-20261126-ci359/`, gồm bản script trước/sau, kế hoạch xóa một image, snapshot bảo vệ và `result.json`. Evidence local ignored: `.tools/staging-ci359-review/`.

## Hồi quy và kiểm chứng

File mới `tests/deployment/test_release_disk_reserve.py` chạy đoạn guard thật bằng Bash trong môi trường tổng hợp, không gọi Docker/VPS hay dữ liệu nghiệp vụ:

1. Hơn 4 GiB và output `df` có khoảng trắng: được tiếp tục.
2. Đúng 4 GiB: dừng, exit 7, thông báo rõ số hiện có/ngưỡng.
3. Mức thiếu dung lượng của sự cố #359: dừng trước bước tiếp theo.
4. Thiếu/sai định dạng output dung lượng: dừng an toàn.

Kết quả thực chạy:

- Bốn test mới trong Linux/Python 3.12/Bash: **4/4 qua**.
- Toàn bộ Python deployment suite trong container Linux: **94 test, 93 qua, 1 bỏ qua**, không lỗi. Test bị bỏ qua cần Docker Compose CLI mà container Python không có.
- Chạy riêng `test_release_config.py` trên máy có Docker Compose thật: **7/7 qua**, gồm chính test parser bị bỏ qua trong Linux; không khởi động container ứng dụng.
- Node 22, `node --test tests/deployment/*.test.cjs`: **25/25 qua**, không bỏ qua.
- Bash syntax của script cài thật và guard dung lượng trên VPS: qua. Snapshot bảo vệ trước/sau: qua.

## Phạm vi còn lại

Lượt này không push/merge, không thay workflow, không giảm ngưỡng an toàn và không tự chạy lại deployment ứng dụng. Run #359 vẫn giữ lịch sử thất bại; cần một lượt release/deployment mới để xác nhận toàn bộ các bước sau guard. Không coi việc sửa preflight là bằng chứng ứng dụng mới đã được triển khai. Khi cần dọn thêm dung lượng, phải kiểm tra lại tham chiếu runtime/rollback; không áp dụng danh sách image của lần này như chính sách dọn tự động.
