# Sửa guard cấu hình khi deploy PDF tools lên Staging — 23/11/2026

## Bằng chứng và phạm vi

[Run 45201616519](https://github.com/nguyenhuy238/SEP490-G92-BHOME/actions/runs/45201616519),
commit `81b93408564d2f1b82b1a30c65e0cbfba392951c`: backend, frontend và images
PASS. Job `release / staging` lỗi sau khi HTTPS, public API, auth, CORS,
webhook rejection và kiểm chứng image đang chạy đều PASS.

Guard báo `Protected containers or application configuration changed` và
rollback thành công. Kiểm tra chỉ đọc trên VPS xác nhận các container được
bảo vệ không thay đổi; cấu hình sau rollback khớp snapshot trước release.
Hai biến duy nhất khác biệt giữa API cũ và candidate là default từ image:

- `MainDraft__LibreOfficePath=/usr/bin/libreoffice`
- `MainDraft__PdfToPpmPath=/usr/bin/pdftoppm`

Hai default này được khai báo trong `deploy/docker/Api.Release.Dockerfile`.
Compose không override chúng. Fingerprint cũ tính cả default của image nên
nhầm việc nâng cấp công cụ PDF thành thay đổi cấu hình operator.

Truy vết: NFR bảo mật/khôi phục và AGENTS.md mục 6, 8–10; pipeline theo
`BHOME_STAGING_DEPLOYMENT.md`. PDF tools hỗ trợ BF-03, UC-14/15 hiện có.
Không đổi chính sách ký, thanh toán, phân quyền, schema hoặc migration.

## Bản sửa

`release-safety.py` chỉ chuẩn hóa trạng thái thiếu hoặc đúng hai đường dẫn
canonical nêu trên trước khi tính fingerprint. Đường dẫn khác, kể cả chuỗi
rỗng, bị từ chối với tên cấu hình, không in giá trị. Các cấu hình khác,
credential, database, jobs, SePay mode, container identity/image/start time
và mounts vẫn được kiểm tra như trước.

`test_release_safety.py` thêm regression cho fingerprint image cũ/mới trên
Staging/Production, đường dẫn không được phép, credential và tùy chọn khác
thay đổi, cùng snapshot/unchanged khi container được bảo vệ bị sửa.

Guard vận hành là file root-owned trên VPS, không tự cập nhật từ checkout
workflow. Bản sửa cần được cài vào `/opt/bhome-deploy/staging/release-safety.py`
sau khi xác minh hash bản cũ và lưu backup, dưới khóa release chung. Không
cài file vào thư mục Production.

## Kiểm chứng

- Regression trước sửa: FAIL, tái hiện fingerprint đổi khi thêm PDF defaults.
- Linux `python3 -m unittest discover -s tests/deployment -p 'test_*.py' -v`:
  **38 PASS**.
- `node --test tests/deployment/*.test.cjs`: **20 PASS**.
- Bash syntax các file `deploy/vps/*.sh`, Prettier tài liệu và
  `git diff --check`: PASS.
- Kiểm tra candidate trên VPS bằng guard mới trong bộ nhớ, không đổi
  container/config: fingerprint candidate khớp snapshot, protected containers
  giữ nguyên. Không đưa credential/config private vào repo hoặc log.

## Cập nhật guard Staging

Đã cài bản kiểm thử dưới khóa release chung, xác minh SHA-256 bản cũ trước
khi thay file và giữ quyền root-owned. Backup/review private ở VPS:
`/opt/bhome-deploy/repairs/20261123-staging-pdf-defaults/`.

- Trước: `4b3b5bd852c3554e21a3a9920c8dbc00915d129f7c6bdbddf2ee9551d2aac21f`.
- Sau: `56006aea9731e252a34ddc72cbc497101a94de13ba513dddfaf980c4e10f8733`.
- Kiểm tra lại bản đã cài: candidate fingerprint khớp snapshot cũ; container
  được bảo vệ và cấu hình sau rollback giữ nguyên.

Đã yêu cầu GitHub chạy lại riêng job Staging của run trên, sử dụng đúng
commit/image digest đã build. Backend/frontend/images không cần chạy lại.

## Kết quả deployment

- [Run 45201616519, attempt 2](https://github.com/nguyenhuy238/SEP490-G92-BHOME/actions/runs/45201616519/attempts/2):
  **SUCCESS**; job `release / staging` và bước deploy đều SUCCESS.
- Worker ghi `DEPLOY_PASS`, `PASS: unchanged staging`, exit 0. HTTPS, public
  API, auth isolation, CORS, webhook rejection và synthetic
  login/refresh/authorized read/logout đều PASS.
- `current.json` tại VPS: commit `81b93408564d2f1b82b1a30c65e0cbfba392951c`,
  run `45201616519-2`, hoàn tất lúc **22:56:58 ngày 23/11/2026**,
  Asia/Ho_Chi_Minh.
- Kiểm tra độc lập sau deploy xác nhận ba container Staging đang chạy đúng
  image digest trong manifest; snapshot protected containers/config khớp
  trước release. Không cập nhật guard hoặc triển khai Production.
- Evidence private:
  `/opt/bhome-backups/staging-cd-20261123T155626-81b93408564d-e795/`.
- Backend/frontend/images kế thừa kết quả thành công đã có, không tuyên bố
  chạy lại những suite/job này trong lượt sửa guard.

Ba file nguồn/tài liệu của bản sửa nằm trên `member/Long`, chưa commit/push.
