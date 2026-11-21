# Sửa lỗi thư mục backup Staging ngày 21/11/2026

## Phạm vi và truy vết

Yêu cầu kiểm tra/sửa CI của người vận hành → AGENTS.md mục 6, 9, 10
(NFR khôi phục, kiểm soát triển khai và kiểm thử) →
`deploy/vps/deploy-release.sh` và kiểm thử deployment.
Nguồn đối chiếu: workflow `release.yml`, runbook
[Staging](BHOME_STAGING_DEPLOYMENT.md), log GitHub/VPS.
Đây là sửa hạ tầng; không thay đổi BF/UC, API, schema hoặc chính sách nghiệp vụ.

## Nguyên nhân và thay đổi

[CI run 44865114303, attempt 1](https://github.com/nguyenhuy238/SEP490-G92-BHOME/actions/runs/44865114303/attempts/1)
dừng ở job `release / staging`: `mktemp` không tạo được thư mục release vì
thư mục cha `/opt/bhome-backups` không tồn tại. Đã xác nhận trực tiếp trên VPS.
Lỗi xảy ra trước bước backup và cập nhật các container ứng dụng.

Script tạo thư mục cha bằng `mkdir -p -m 700` trước `mktemp`, dưới `umask 077`.
Nếu đường dẫn không hợp lệ/không tạo được, `set -e` vẫn dừng triển khai.
Backup hiện có được giữ nguyên; mỗi lần release có thư mục riêng.

Đã áp dụng cùng thay đổi nhỏ vào script Staging trên VPS, giữ bản gốc tại
`/opt/bhome-deploy/repairs/20261121-backup-parent/deploy-release.before.sh`.
Không thay script Production. Source trong repository cần review/merge theo
quy trình của team để giữ bản sửa lâu dài.

## Kiểm chứng

- Trên VPS Linux, bản source sửa trong thư mục kiểm thử riêng:
  `bash -n deploy/vps/deploy-release.sh`: PASS.
- `python3 -m unittest discover -s tests/deployment -p 'test_*.py' -v`:
  PASS 18 tests, gồm 3 test mới cho thiếu thư mục cha, thư mục tồn tại và
  đường dẫn cha là file. Tests dùng dữ liệu tổng hợp trong thư mục tạm.
- Trên máy phát triển: `node --test tests/deployment/*.test.cjs`: PASS 17 tests.
- `git diff --check`: PASS.
- [CI run 44865114303, attempt 2](https://github.com/nguyenhuy238/SEP490-G92-BHOME/actions/runs/44865114303/attempts/2):
  worker Staging hoàn tất `DEPLOY_PASS`, exit 0; triển khai đúng commit
  `882469362552e8d58d5e3dd1b0b8dc4597a3f88b` và ba image digest của run.
- Backup DB restore thử vào database riêng và mirror/đối chiếu storage: PASS.
- Smoke HTTPS, Public API, auth isolation, CORS, từ chối webhook không xác thực,
  synthetic login/refresh rotation/read/logout: PASS.
- Kiểm tra image đang chạy và snapshot các container được bảo vệ: PASS;
  Production, PostgreSQL, MinIO và các container tương thích không bị recreate.
- Evidence riêng trên VPS:
  `/opt/bhome-backups/staging-cd-20261121T045040-882469362552-GNCt/`.
  Không chép backup hoặc cấu hình riêng tư vào repository.

Bản sửa source được lưu trên nhánh `member/QHuy`; chưa push/merge. Không chạy lại toàn bộ backend/frontend
test suite tại máy phát triển; phiên này kiểm chứng deployment và smoke Staging.
