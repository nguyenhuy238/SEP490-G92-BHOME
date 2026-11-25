# Đồng bộ develop và sửa deploy Staging — 26/11/2026

## Phạm vi và truy vết

Yêu cầu: cập nhật `develop` vào nhánh hiện tại và xử lý lỗi deploy trong
[CI #350](https://github.com/nguyenhuy238/SEP490-G92-BHOME/actions/runs/45659058910).
Truy vết: NFR phát hành/bảo mật/khôi phục, AGENTS.md mục 6, 8–10 và quy trình
operator trong `BHOME_STAGING_DEPLOYMENT.md`. Không thay nghiệp vụ BF/UC,
schema, chính sách OCR hay phân quyền.

## Đồng bộ Git

- Nhánh giữ nguyên `member/QHuy`; working tree sạch trước khi đồng bộ.
- `git fetch origin develop`, sau đó `git merge --ff-only origin/develop`:
  cập nhật từ `43a04f7c` đến `1854c2ebfa9d24a16fabf6908ca2748444d755d2`, 31 commit.
- Không có conflict; `HEAD...origin/develop` là `0 0`.
- Không commit, push hoặc merge vào nhánh dùng chung.

## Nguyên nhân đã xác nhận

Job `release / staging` attempt 1 đã qua build, manifest, backup/restore kiểm
chứng, image verification, Compose preflight, HTTPS/auth/CORS/webhook smoke
và `verify-running`. Sau đó guard báo
`Protected containers or application configuration changed` và rollback PASS.

Đối chiếu chỉ đọc trên VPS xác nhận protected containers và fingerprint cấu
hình sau rollback khớp `protected.json` của chính release lỗi. Hai biến môi
trường khác nhau giữa image API cũ và mới là `Ocr__Enabled` và
`Ocr__ModelDirectory`; image mới cung cấp defaults `true` và `/models`.

Source develop đã chứa bản sửa chuẩn hóa đúng hai defaults này cùng regression
tests và helper cài guard. File root-owned trên VPS vẫn là bản cũ; merge source
không tự cập nhật file vận hành. Không cần thêm một bản sửa code trùng lặp.

## Thay đổi vận hành

Đã lấy đúng `release-safety.py` và `install-staging-release-guard.py` bằng
`git archive` từ full SHA develop nêu trên, review diff với guard đang cài,
kiểm tra checksum, không có worker release hoạt động, rồi dùng helper hiện có
dưới cả hai release lock để cập nhật riêng guard Staging.

- Guard trước: `02df240c004728671697e1b5c2e501a6ab8e8be9b461ab351ccbbaa1c871be41`.
- Guard sau: `e71ef6f53b75b9fbd96008f3c86d83e5ea71fa8c8487d9c4c7e164197b17854d`.
- Installer: `d68c6b5963ccc56f7d9fad9ef3bce946eb6647f201f8f87378e61eabb2cf485c`.
- Backup private: `/opt/bhome-deploy/staging/guard-rollout-rsa6i7gv/`.
- Evidence cài đặt: `/root/bhome-guard-review.66GMWp/installation.json`.
- `GUARD_INSTALL_PASS`, `GUARD_VERIFY_PASS`; UID/GID/mode `0:0 755` được giữ.
- Protected snapshot khớp sau cài; guard Production và `current.json` không đổi
  trong thao tác cài guard. Không recreate container khi cài guard.
- Replay chỉ đọc với environment của chính candidate và Compose đã resolve:
  guard cũ tạo fingerprint khác, guard mới giữ fingerprint; image-only
  preflight PASS. Evidence private: `candidate-replay.json` cạnh `installation.json`.

Chỉ chuẩn hóa defaults canonical; OCR override khác, credential, database,
jobs, SePay và container identity/mount/start time vẫn được bảo vệ. Compose
preflight tiếp tục chỉ cho phép thay ba application images.

## Kiểm chứng trong lượt này

- Linux container: `python3 -m unittest discover -s tests/deployment -p 'test_*.py' -v`:
  **90 PASS, 0 skip**, có Docker Compose thật và fixture Linux cho installer/rollback/locks.
- `node --test tests/deployment/*.test.cjs`: **25 PASS, 0 skip**.
- `git diff --check` và Prettier cho báo cáo này: PASS. Lệnh `npx` đầu bị
  PowerShell execution policy chặn; gọi `npx.cmd` thành công, không đổi policy.
- GitHub chấp nhận chạy lại toàn bộ CI #350 bằng HTTP 201. Không chỉ retry
  failed job: artifact manifest và provenance yêu cầu đúng run attempt mới.
- [CI #350 attempt 2](https://github.com/nguyenhuy238/SEP490-G92-BHOME/actions/runs/45659058910/attempts/2):
  **SUCCESS**, trạng thái completed. Backend, frontend, quality gate, ba image,
  manifest và job `release / staging` đều SUCCESS. Các job Production được skip.

## Kết quả deployment

- VPS ghi `DEPLOY_PASS`, `PASS: unchanged staging`, exit 0; không rollback.
- `current.json`: SHA `1854c2ebfa9d24a16fabf6908ca2748444d755d2`,
  run `45659058910-2`, hoàn tất lúc **01:12:46 ngày 26/11/2026**,
  Asia/Ho_Chi_Minh.
- Manifest đã qua checksum/revision/attempt/environment/digest verification
  trong CI; SHA-256 `d55c2c2c096ed2eb32f39ef06009ceff21b2af341d10ca5820b53a983bb918b1`.
- Kiểm tra độc lập sau deploy: `current.json` khớp manifest của release;
  ba image thực tế khớp đúng digests đầu vào đã được CI xác minh:
  - API: `sha256:e4357730adb9736c28a69cb9749fbb5b65cbee7cc25d511c169ed584204f3f82`.
  - Owner: `sha256:6f45cf7a9e5fc39155d5d0d736174e8e71420775175eabdaf4bae09a36b71f63`.
  - Public: `sha256:8dda643796569aec3519716e7d8984452074446718db04e7f42d6cb4ead21ac2`.
- Snapshot protected containers/config khớp cả trước khi cài guard lẫn trước
  deployment. Checksum guard Production giữ nguyên.
- HTTPS, public API, auth isolation, CORS, webhook rejection và synthetic
  login/refresh/authorized read/logout đều PASS trong deployment smoke.
- Backup/evidence private:
  `/opt/bhome-backups/staging-cd-20261125T181201-1854c2ebfa9d-OBIU/`;
  xác minh độc lập tại `/root/bhome-guard-review.66GMWp/final-verification.json`.

Không tuyên bố toàn bộ test backend không skip: CI kiểm soát danh sách skip
đã phê duyệt và bước xác minh evidence đã PASS. Con số 0 skip ở trên chỉ áp
dụng cho hai suite deployment local đã chạy trong lượt này.

File source trong lượt này chỉ bổ sung báo cáo này; bản sửa guard và tests đã
có trong develop. Production không được triển khai trong lượt xử lý này.
