# Vận hành Staging BHOME

Khôi phục schema gate ngày 22/11/2026: [migration thanh toán ban đầu](BHOME_STAGING_SCHEMA_FIX_2026-11-22.md).
Checksum khác baseline cần migration được duyệt; không cập nhật checksum để bỏ qua DDL.

Checkpoint hostname mới: [nghiệm thu migration](BHOME_STAGING_HOSTNAME_MIGRATION_2026-11-20.md).
Canonical dùng `*-staging`; `*-sepay-test` chỉ còn là compatibility được khai báo.
Hai GitHub SSH secrets Staging đã được thiết lập và repository flag CD bật; workflow
mới vẫn cần source được review/push/merge trước khi nghiệm thu Actions end-to-end.

Cập nhật 20/11/2026. Xem [biên bản CI/CD](BHOME_CICD_ACCEPTANCE_2026-11-20.md).
Staging đã chạy; **CD GitHub → VPS chưa được nghiệm thu**. Source chưa được review/push;
hai secrets Staging và flag CD đã có. [Biên bản cũ](BHOME_VPS_DEPLOYMENT_ACCEPTANCE_2026-11-20.md)
lưu lịch sử trước khi thêm Public Web; topology dưới đây thay thế topology cũ.

## Phạm vi và truy vết

MASTER TASK 20/11 và AGENTS.md → NFR bảo mật/khôi phục, GBR-01/02/13/18 → CI/CD,
image, proxy, config, backup/rollback. FE-09 / UC-37/38 / GBR-17 → Public chỉ đọc
anonymous APIs hiện có. BF-06 / UC-22/23/25 / GBR-10 / JOB-03 → giữ SePay Test.
Không đổi schema, DTO, chính sách tiền, ký hoặc activation.

| Thành phần           | Giá trị                                                                               |
| -------------------- | ------------------------------------------------------------------------------------- |
| Owner                | `https://owner-staging.103.146.23.157.sslip.io`                                       |
| Public               | `https://public-staging.103.146.23.157.sslip.io`                                      |
| API                  | `https://api-staging.103.146.23.157.sslip.io`                                         |
| Sandbox webhook      | API origin + `/api/v1/integrations/sepay/webhook`                                     |
| Project              | `bhome-sepay-stage`                                                                   |
| API / Owner / Public | `bhome-sepay-api-stage` / `bhome-sepay-owner-web-stage` / `bhome-sepay-stage-public`  |
| PostgreSQL           | `bhome-sepay-vps-stage`, chỉ publish `127.0.0.1:55432`                                |
| Database             | `bhome_compact24_dev_f723d9c0ff6acd3c4cce870df1e72989`                                |
| DB volume            | `bhome-sepay-stage_sepay-data`                                                        |
| Storage              | `bhome-sepay-stage-minio`, bucket private `bhome-staging-private`, không publish port |
| Storage volume       | `bhome-sepay-stage_stage-storage`                                                     |

## Mạng và lỗi DNS chéo môi trường

API hiện có namespace riêng, dùng `Host=postgres` trên backend Staging
`bhome-sepay-stage_default`. Cấu hình cũ namespace PostgreSQL/Host=127.0.0.1 đã thay
thế; PostgreSQL không recreate/đổi volume. Owner/Public ở mạng frontend riêng,
không ở mạng database/storage.

Caddy nối `bhome-vps_default` và `bhome-staging-edge`, không còn nối backend Staging.
`connect-staging-edge.py` gắn các ứng dụng lên edge bằng alias duy nhất:
API `bhome-stage-api`, Owner `bhome-owner-stage`, Public `bhome-public-stage`.
Hai bundle tương thích ở `bhome-staging-owner-legacy` / `bhome-staging-public-legacy`,
alias `bhome-owner-legacy` / `bhome-public-legacy`. Edge chỉ có năm ứng dụng và Caddy.

**Không gắn edge trực tiếp bằng Compose vào service `api`, `owner-web`, `public-web`.**
Compose tự thêm alias tên service dù khai báo aliases riêng. Caddy thấy tên trùng
trên hai mạng có thể chọn nhầm môi trường. Script kiểm và loại alias trùng, phải chạy
lại sau mỗi recreate/rollback. Không đưa PostgreSQL/MinIO lên edge.

Caddy Owner `/api/*`, `/open/*` → API Staging. Public `/api/v1/public/*` có proxy
riêng; `/api/*` khác trả 404 thay vì HTML. Bundle Public dùng API Staging tuyệt đối.
CORS cho Owner/Public Staging mới và cũ; AuthWeb chỉ hai Owner origins. Không thêm
Production hoặc Public origins vào AuthWeb. `Deployment__LegacyOwnerOrigin`,
`LegacyApiOrigin`, `LegacyPublicOrigin` chỉ chấp nhận đúng cặp hostname chuyển đổi
Staging đã duyệt. Links mới vẫn sinh từ anchors canonical; không sinh link hostname cũ.

## Cấu hình và Compose

Email nghiệp vụ UC-14/15/22 và JOB-04 được bật mặc định trong `appsettings.Staging.json`.
Nếu private overlay đặt `NotificationChannels__ContractAndInvoiceEmailEnabled`, giá trị phải là `true`.
Cờ này gửi hợp đồng giữ chỗ, hợp đồng thuê đã kích hoạt và hóa
đơn đã thanh toán qua SMTP hiện có. Giữ `Jobs__Enabled=false` và
`NotificationChannels__AutomationEnabled=false` nếu chỉ chạy các email này.
Hàng đợi dùng cùng một khóa cho xác nhận giữ chỗ ngay cả khi hợp đồng đã chuyển
sang hợp đồng thuê. Email đính kèm bản PDF đã ký và biên nhận cọc đã xác minh.
Khi chạy ở chế độ email nghiệp vụ, worker xử lý thư hoàn tất giữ chỗ và thông báo kích hoạt hợp đồng thuê trước lượt phát thông báo chung. Email xác nhận hợp đồng thuê kèm PDF đã ký và biên nhận thanh toán ban đầu khi có khoản thanh toán đã xác minh. Email thiết lập tài khoản được xử lý riêng với hợp đồng thuê ký nội bộ có yêu cầu thanh toán ban đầu.
Khi gửi lời mời ký hợp đồng thuê từ Mobile, hệ thống dùng email đã lưu của
người đại diện và hiển thị địa chỉ đã che một phần.

Project `bhome-sepay-stage`; ghép các file theo thứ tự:

1. `/opt/bhome/deploy/compose.sepay.yml`
2. `/opt/bhome-config/compose.sepay-stage-api.yml`
3. `/opt/bhome-config/compose.sepay-stage-web.yml`
4. `/opt/bhome-config/compose.sepay-stage-public.yml`
5. `/opt/bhome-config/compose.staging-compat.yml`
6. `/opt/bhome-config/compose.staging-runtime.yml`
7. `/opt/bhome-config/compose.sepay-stage-release.yml`

File runtime là cấu hình private, tồn tại độc lập với source/image và không bị CD
ghi đè. Lần commissioning đầu giữ đúng giá trị `BillingAutomation__ManualActionsEnabled`
của API Staging đang chạy (mặc định false nếu chưa có); các lần sau giữ nguyên file
do operator quản lý. Mẫu: `deploy/vps/compose.staging-runtime.example.yml`.
Release overlay cuối chỉ chứa image; không lưu thêm cấu hình môi trường tại đây.
Những override cũ ngoài cờ manual phải chuyển vào overlay private phù hợp; preflight
sẽ từ chối release nếu cấu hình Compose hiệu lực thay đổi ngoài ba image ứng dụng.

Dùng cả hai `--env-file`: `sepay-staging.db.env`, `stage-storage.env` trong private
config. File thứ hai root-only, chứa connection hiện có (đổi host sang PostgreSQL
Staging), credential storage mới riêng và image Public bootstrap; không đưa vào Git/log.
Mẫu: `deploy/vps/compose.staging-public.example.yml` và `compose.staging-compat.example.yml`.

### QR tiền cọc giữ chỗ

Theo UC-14/22 và GBR-10, màn hình Mobile chỉ lấy QR chuyển khoản từ API của
chính hợp đồng. Nếu API trả `sepay_environment_mismatch`, màn hình báo lỗi cấu
hình và không đưa ra QR xem thử. Staging dùng SePay Test cho hợp đồng Test đủ
điều kiện. Hợp đồng Live cần SePay Live được bật và tài khoản nhận tiền hợp lệ.

Để tạo hợp đồng mới dùng SePay Test với PostgreSQL Docker riêng của Staging,
đặt `HoldingTesting__Enabled=true`, `HoldingTesting__DatabaseHost` và
`HoldingTesting__DatabaseName` khớp đúng kết nối API Staging. Khai báo
`HoldingTesting__LocationIds__0`, `__1`, … cho các cơ sở có tài khoản nhận tiền
sandbox trong cấu hình SePay và trong cơ sở dữ liệu. Hợp đồng mới tại các cơ sở
đó dùng `PaymentMode=Test`. Các hợp đồng Live đã tạo giữ nguyên chế độ.
Owner có thể lưu tài khoản tổng hợp qua API tài khoản nhận tiền của cơ sở khi
BIN và số tài khoản khớp cấu hình SePay Test của chính cơ sở đó. API giữ kiểm
tra phiên bản và nhật ký xác nhận tài khoản. Production không bật luồng này.

`MainDraft__AllowStagingSigningReview=true` cho phép dùng mẫu hợp đồng thuê
kiểm thử trong luồng gửi ký UC-15 trên Staging. API chỉ cho phép ở các cơ sở
thuộc phạm vi thử nghiệm trên database Staging và với hợp đồng `PaymentMode=Test`.
PDF vẫn mang cờ `DevelopmentOnly`, phải qua bước xem và xác nhận trước khi gửi.

### Ký hợp đồng nội bộ trên Staging

Luồng UC-14/15 theo quyết định 07 trong `BHOME_NQH_BUSINESS_DECISIONS_2026-11-10.md`
cần khóa xác minh OTP riêng và chứng thư đóng dấu hệ thống. Ghép các mục
`environment` và `volumes` từ `deploy/vps/compose.contract-signing.example.yml`
vào service `api` trong `/opt/bhome-config/compose.sepay-stage-api.yml` để bản
release sau tiếp tục dùng cùng cấu hình. Kiểm tra các overlay phía sau không ghi đè.

- Trong `stage-storage.env` trên VPS, đặt `BHOME_ANON_HMAC_BASE64`
  bằng khóa Base64 giải mã được ít nhất 32 byte ngẫu nhiên. Giữ khóa ổn định qua
  các lần triển khai và dùng lại khóa Staging hiện có nếu còn lời mời đang hiệu lực.
- Đặt `BHOME_SIGNING_PUBLIC_URL` thành URL HTTPS trang `/contract-signing`
  của Owner Web Staging. Giữ allowlist email Staging và dùng địa chỉ kiểm thử đã được phép.
- Đặt `BHOME_SIGNING_SEAL_PFX_FILE` thành đường dẫn tuyệt đối đến PFX riêng
  của Staging có khóa riêng RSA của hệ thống, và đặt mật khẩu PFX qua
  `BHOME_SIGNING_SEAL_PFX_PASSWORD`. Cấp quyền đọc file cho UID chạy API
  trong container và giữ mount chỉ đọc. Giữ PFX và các giá trị bí mật trên VPS.
- Kiểm tra Compose với `config --quiet` theo đúng chuỗi overlay, sau đó tạo lại
  riêng container `api` với image release Staging hiện tại. Chạy lại
  `/opt/bhome-deploy/staging/connect-staging-edge.py` để khôi phục alias API trên
  mạng edge. Kiểm tra readiness nội
  bộ và dùng hợp đồng thử để xác nhận Owner ký được, Staff được phân quyền gửi
  được lời mời, và người nhận có thể mở link và xác minh OTP.

File private có thêm `BHOME_STAGE_LEGACY_OWNER_IMAGE`, `BHOME_STAGE_LEGACY_PUBLIC_IMAGE`,
`BHOME_STAGE_LEGACY_OWNER_INDEX` pin đúng images/index trước migration. Không tự cập
nhật các bundle này qua CD; chỉ bỏ sau khi chứng minh không còn phiên/link/callback phụ thuộc.

Giữ signing key JWT, Data Protection tại `sepay-staging-data-protection`, SePay Test,
email và identity keys. Issuer/audience Staging: `BHome.Staging` / `BHome.Staging.Clients`.
Migration hostname không đổi key, issuer hay audience. Phiên cũ đã được browser xác
minh tiếp tục refresh qua alias cũ. Hostname mới cần đăng nhập lần đầu vì cookie
host-only; không mở rộng cookie domain. Cookie Secure/HttpOnly/SameSite=Strict,
path `/api/v1/auth`. General jobs/billing automation/initializer vẫn false; các worker
chuyên biệt có cờ riêng. Email Staging chưa cấu hình gửi thật.

## GitHub và release

`member/<tên>` → PR develop → CI backend/frontend → reusable `release.yml` → build
API/Owner/Public đúng SHA → GHCR SHA tags + digest + manifest → environment staging
→ SSH → backup → deploy → smoke/rollback. PR/feature/workflow_dispatch không deploy.

CI kiểm TRX bằng `scripts/Verify-StagingRegressions.py`: chín nhóm hồi quy bắt buộc
cho hotfix staging phải thực sự chạy, đủ các case và PASS; test thiếu/skip/failed
chặn release. Image API sau CI có nhãn `io.bhome.staging-regressions=v1`.
Staging từ chối image chưa có nhãn này trước khi thay container. Khi sửa hoặc đổi
tên bộ test, phải cập nhật guard có review; không bỏ qua guard để deploy.
Workflow push main chạy release Production riêng có approval. Không có workflow
khác cạnh tranh deploy. Không merge/push khi chưa được review/ủy quyền.

| GitHub Settings              | Giá trị cần thiết                                                          |
| ---------------------------- | -------------------------------------------------------------------------- |
| Repository variable          | `BHOME_STAGING_CD_ENABLED=true`, đã thiết lập; source vẫn cần review/merge |
| Environment                  | `staging`, branch policy chỉ `develop`                                     |
| Environment secrets          | `BHOME_STAGING_SSH_PRIVATE_KEY`, `BHOME_STAGING_SSH_KNOWN_HOSTS`           |
| Optional repository variable | `BHOME_STAGING_SSH_HOST`, mặc định VPS hiện tại                            |

Hai secrets đã được mã hóa và nhập vào environment Staging bằng REST API; không
đọc lại được giá trị từ GitHub. Để rotate, nhập key CI riêng qua Settings; không dùng operator key hoặc
root password. Known-hosts phải đối chiếu host key qua operator connection đã tin cậy.
Không dùng ssh-keyscan chưa xác minh. JWT/database/SePay secrets ở VPS, không cần
chuyển lên GitHub. Image job dùng `GITHUB_TOKEN` với `packages: write`; Git credential
cá nhân hiện có thiếu scope này, nên publish candidate thủ công bị từ chối.

Docker Web yêu cầu `VITE_API_BASE_URL`, `VITE_DEPLOYMENT_ENVIRONMENT`, `BHOME_REVISION`;
mode luôn `api`. Origins khóa theo nhánh. `Verify-WebArtifact.cjs` kiểm JS đã biên dịch
và ghi `/bhome-release.json`. Nginx no-store index/metadata, assets dùng tên hash.
Thay env Nginx không đổi origin đã nhúng. Image mới bắt buộc OCI revision/source;
không dùng ngoại lệ OCI label của PR142 cho release mới.

Scripts root-owned ở `/opt/bhome-deploy/staging/`:

- `run-staging-release.sh` → `run-release.sh`: worker tmux sống độc lập SSH; run ID
  chỉ thuộc một bộ SHA/digest; reconnect không chạy lại release.
- `deploy-release.sh`: flock, từ chối SHA khác HEAD develop/run ID cũ; backup private
  config/DB/storage, restore DB mới, so checksum schema đã duyệt, pull đúng digest,
  kiểm metadata/bundle và chỉ update API/Owner/Public.
- `release-safety.py`: kiểm DB/key/storage/environment, protected containers,
  OCI/digest và image thật đang chạy.
  Giữ hotfix chuẩn hóa hai đường dẫn PDF canonical từ Release image; đường dẫn
  executable tùy ý vẫn bị từ chối. Staging API image phải có nhãn regression v1.
  Hai OCR defaults canonical (`Ocr__Enabled=true`, `Ocr__ModelDirectory=/models`)
  được chuẩn hóa; override khác vẫn nằm trong fingerprint và Compose guard vẫn
  kiểm tra mọi thay đổi cấu hình tường minh.
- `release-config.py`: tạo runtime overlay Staging một lần từ capability đang chạy;
  so cấu hình Compose đầy đủ trước/sau, chỉ cho đổi image API/Owner/Public. Không
  in giá trị cấu hình hoặc secret khi có khác biệt. Cần cài helper này cùng
  `deploy-release.sh`; script trên VPS không tự lấy phiên bản mới từ Git.
- `connect-staging-edge.py`: alias duy nhất sau up/rollback.
- `smoke-release.sh`, `smoke-auth.py`: HTTPS/public API/CORS/auth/webhook và synthetic
  login/refresh/logout. `backup-storage.py`: mirror private bucket trên cùng VPS.

Lệnh từ CI hoặc reconnect, lấy đúng năm giá trị từ manifest:

```sh
ssh bhome-vps '/opt/bhome-deploy/staging/run-staging-release.sh <40SHA> <run-id>-<attempt> <api-sha256-digest> <owner-sha256-digest> <public-sha256-digest>'
```

Forced command chỉ chấp nhận dạng trên. GitHub/VPS đều khóa deployment;
`cancel-in-progress: false`. Kiểm `/opt/bhome-deploy/runs/staging-<run-id>-<attempt>/`
và tmux `bhome-deploy`, rồi reconnect cùng lệnh. Watcher khoảng 25 phút; timeout
không có nghĩa worker đã dừng. Không tạo run ID mới chỉ vì SSH disconnect.

### Cập nhật release guard do operator phê duyệt (CI #346)

Push hoặc merge source không cập nhật script root-owned trên VPS. CI key không
được cấp quyền cài guard. Dùng quy trình sau chỉ sau khi operator đã duyệt
commit, kết quả kiểm thử và hai checksum; không dùng key CI để truyền file.

1. Tại máy review, dùng full SHA của commit rollout đã duyệt, không dùng branch
   động. Ví dụ PowerShell (điền SHA từ biên bản review):

   ```powershell
   $reviewed = '<full-reviewed-rollout-commit>'
   git show --stat $reviewed
   git merge-base --is-ancestor 3efcfe64 $reviewed
   if ($LASTEXITCODE -ne 0) { throw 'OCR fix is not an ancestor' }
   $zip = ".tools/guard-rollout-$reviewed.zip"
   git archive --format=zip --output=$zip $reviewed deploy/vps/install-staging-release-guard.py deploy/vps/release-safety.py
   if ($LASTEXITCODE -ne 0) { throw 'Archive failed' }
   Expand-Archive -LiteralPath $zip -DestinationPath ".tools/guard-rollout-$reviewed"
   Get-FileHash -Algorithm SHA256 $zip
   Get-FileHash -Algorithm SHA256 ".tools/guard-rollout-$reviewed/deploy/vps/*.py"
   ```

   Review đúng hai file, kiểm tra test evidence, xác nhận hash archive và từng
   file qua kênh tin cậy. Hash tự nó không chứng minh phê duyệt.
   Guard cũ quan sát sau rollback #346:
   `02df240c004728671697e1b5c2e501a6ab8e8be9b461ab351ccbbaa1c871be41`.
   Guard OCR tại commit `3efcfe64`:
   `e71ef6f53b75b9fbd96008f3c86d83e5ea71fa8c8487d9c4c7e164197b17854d`.

2. Operator phối hợp giữ cửa sổ bảo trì, không bắt đầu release mới (kể cả
   Production vì dùng chung lock), kiểm tra không có GitHub release đang chạy
   hoặc chờ, và không có worker chưa kết thúc. Các lệnh chỉ kiểm tra trên VPS
   qua phiên root operator đã được duyệt:

   ```sh
   git -C /opt/bhome ls-remote origin refs/heads/develop
   tmux list-windows -t bhome-deploy || true
   pgrep -af '[/]opt/bhome-deploy/.*(run-release|deploy-release)\.sh' || true
   lslocks -o COMMAND,PID,MODE,PATH
   sha256sum /opt/bhome-deploy/staging/release-safety.py
   stat -c '%u:%g %a %n' /opt/bhome-deploy/staging/release-safety.py
   grep -nF 'release-safety.py' /opt/bhome-deploy/staging/deploy-release.sh
   ```

   Đối chiếu worker thực tế với bản đã duyệt: root staging cố định, gọi
   release-safety.py khi snapshot, verify-running và unchanged; không có
   đường dẫn guard khác. Nếu worker đang hoạt động/chờ, hash khác hash cũ
   đã duyệt, quyền không an toàn hoặc SHA không còn phù hợp, dừng để review.
   Kiểm tra lock ở đây chỉ là quan sát; helper lấy lock độc quyền thực tế.

3. Operator tạo thư mục private trên VPS bằng
   `mktemp -d /root/bhome-guard-review.XXXXXX`. Qua SSH/SCP operator đã xác
   thực host key, chuyển đúng hai file từ archive đã duyệt vào thư mục đó
   (không dùng CI key). Ví dụ từ máy review, nếu alias operator root đã được
   cấu hình, thay đường dẫn và alias bằng giá trị được phê duyệt:

   ```powershell
   scp ".tools/guard-rollout-$reviewed/deploy/vps/install-staging-release-guard.py" ".tools/guard-rollout-$reviewed/deploy/vps/release-safety.py" "bhome-vps:/root/bhome-guard-review.<actual-suffix>/"
   ```

4. Trong thư mục private trên VPS, với quyền root, đối chiếu hash installer
   đã nhận qua kênh review và hash guard cố định trước khi chạy file nào:

   ```sh
   set -eu
   umask 077
   test "$(stat -c '%u:%a' .)" = '0:700'
   test ! -L install-staging-release-guard.py
   test ! -L release-safety.py
   OLD=02df240c004728671697e1b5c2e501a6ab8e8be9b461ab351ccbbaa1c871be41
   NEW=e71ef6f53b75b9fbd96008f3c86d83e5ea71fa8c8487d9c4c7e164197b17854d
   INSTALLER='<approved-installer-sha256>'
   printf '%s  %s\n' "$INSTALLER" install-staging-release-guard.py "$NEW" release-safety.py | sha256sum -c -
   printf '%s  %s\n' "$OLD" /opt/bhome-deploy/staging/release-safety.py | sha256sum -c -
   BEFORE_META=$(stat -c '%u:%g %a' /opt/bhome-deploy/staging/release-safety.py)
   python3 -I install-staging-release-guard.py install release-safety.py "$OLD" "$NEW"
   ```

   Helper chỉ chạy với root, khóa shared rồi staging theo thứ tự của release,
   từ chối lock bận, symlink, quyền không an toàn và hash sai. Backup private
   `guard-rollout-*` nằm trong thư mục staging, gồm bytes cũ/mới, hash và
   snapshot candidate đã fsync trước khi đổi file. Giữ UID/GID/mode của guard.
   Chỉ tiếp tục sau `GUARD_INSTALL_PASS`. Gán BACKUP bằng chính đường dẫn
   "Guard backup:" do helper in ra, không tự chọn thư mục mới nhất:

   ```sh
   BACKUP='/opt/bhome-deploy/staging/guard-rollout-<actual-suffix>'
   python3 -I install-staging-release-guard.py verify "$NEW" --snapshot "$BACKUP/protected.json"
   printf '%s  %s\n' "$NEW" /opt/bhome-deploy/staging/release-safety.py | sha256sum -c -
   cmp -s release-safety.py /opt/bhome-deploy/staging/release-safety.py
   test "$(stat -c '%u:%g %a' /opt/bhome-deploy/staging/release-safety.py)" = "$BEFORE_META"
   stat -c '%u:%g %a %n' /opt/bhome-deploy/staging/release-safety.py
   ```

   Phải có `GUARD_VERIFY_PASS`, hash NEW và UID/GID/mode như trước; verify
   gọi check và unchanged từ chính guard cài đặt dưới cả hai lock. Không
   chạy trực tiếp candidate ngoài helper. Không fetch/execute từ branch.

5. Nếu lỗi sau thay file, helper cố khôi phục bytes cũ và kiểm lại hash/check.
   `GUARD_ROLLBACK_PASS` chỉ xác nhận khôi phục guard, không chứng minh
   runtime hoặc DB đã rollback. Nếu helper báo
   `Guard rollback failed; operator intervention required`, dừng và điều tra.
   Với SIGKILL/mất điện, không tự rollback:
   giữ cửa sổ bảo trì, kiểm worker/lock và hash, không xóa backup. Nếu hash
   NEW, thực hiện verify với đúng snapshot ở bước 4. Nếu hash OLD, verify
   OLD bằng `python3 -I install-staging-release-guard.py verify "$OLD"`
   rồi review evidence và trạng thái runtime trước khi bắt đầu một
   lần install mới; snapshot candidate không nhất thiết tương thích thuật
   toán fingerprint của guard cũ. Nếu hash khác, snapshot thiếu/không khớp
   hoặc rollback thất bại, dừng release để operator điều tra. Worker hiện
   tại không tự chặn release sau khi process installer bị kill.

   Nếu cần chủ động rollback guard đã cài, sau phê duyệt và khi không có
   release hoạt động, dùng đúng backup đã xác nhận (lệnh tạo backup mới):

   ```sh
   printf '%s  %s\n' "$OLD" "$BACKUP/release-safety.before.py" | sha256sum -c -
   python3 -I install-staging-release-guard.py install "$BACKUP/release-safety.before.py" "$NEW" "$OLD"
   ```

   Sau khi có `GUARD_INSTALL_PASS`, lấy đúng đường dẫn backup mới do helper
   in ra và tiếp tục:

   ```sh
   RESTORE_BACKUP='/opt/bhome-deploy/staging/guard-rollout-<actual-restore-suffix>'
   python3 -I install-staging-release-guard.py verify "$OLD" --snapshot "$RESTORE_BACKUP/protected.json"
   printf '%s  %s\n' "$OLD" /opt/bhome-deploy/staging/release-safety.py | sha256sum -c -
   cmp -s "$BACKUP/release-safety.before.py" /opt/bhome-deploy/staging/release-safety.py
   stat -c '%u:%g %a %n' /opt/bhome-deploy/staging/release-safety.py
   ```

   Nếu guard cũ không còn tương thích runtime, dừng và yêu cầu review,
   không bỏ qua check. Không restore DB hay thay image từ helper.

6. Phê duyệt release riêng sau khi nghiệm thu guard; bỏ cửa sổ bảo trì chỉ
   khi an toàn. Nếu SHA vẫn là HEAD develop và chỉ bước deploy Staging lỗi,
   có thể re-run riêng job Staging. Workflow tải đúng artifact
   `release-<SHA>-<producer_attempt>` theo output của job `images` đã thành công,
   kiểm tra checksum, run ID, producer attempt, môi trường và cả ba digest.
   Nếu build hoặc job `images` lỗi, dùng **Re-run all jobs** để cả ba image
   có provenance cùng attempt; không ghép image từ nhiều attempt. Production
   vẫn yêu cầu manifest đúng attempt hiện hành. Giữ nguyên quality gates.
   Deployment run ID-attempt mới phải lớn hơn
   current.json theo thứ tự cặp số (run ID, attempt). Nếu develop đã tiến,
   dùng CI/release của HEAD mới nhất đã duyệt, không retry SHA cũ.
   Không tự gọi worker bằng run ID giả.
   Kiểm tra log GitHub có DEPLOY_PASS, PASS: unchanged staging và job
   SUCCESS. Đối chiếu SHA, run ID và ba immutable images trong
   `/opt/bhome-deploy/staging/current.json` với manifest trong thư mục
   evidence được log release in ra. Kiểm tra running digest qua guard:

   ```sh
   cat /opt/bhome-deploy/staging/current.json
   # Dùng ba image reference đầy đủ (repository:sha-SHA@sha256:DIGEST)
   # từ manifest đã duyệt, không lấy từ container hiện chạy làm baseline.
   python3 /opt/bhome-deploy/staging/release-safety.py verify-running staging "$API_IMAGE" "$OWNER_IMAGE" "$PUBLIC_IMAGE"
   ```

   Kiểm tra evidence log/manifest của đúng run; chỉ báo CD xanh khi tất cả
   điều kiện trên thành công. Không chạy Production.

Quy trình này không tự thay đổi VPS từ GitHub. Việc cài guard và chạy release
thật là hai thao tác vận hành cần phê duyệt; kiểm thử local không thay thế
bằng chứng deploy thành công.

Backup/evidence: `/opt/bhome-backups/staging-cd-<UTC>-<SHA12>-*/`. Không xóa image cũ
trước nghiệm thu. DB restore kiểm chứng vào DB mới; không restore đè. Storage mirror
có so nguồn/backup nhưng không phải snapshot nguyên tử xuyên DB/storage khi có ghi
đồng thời. Release schema/data phải có kế hoạch consistency/migration riêng.

## Kiểm tra và rollback

```sh
bash /opt/bhome-deploy/staging/smoke-release.sh staging
python3 /opt/bhome-deploy/staging/connect-staging-edge.py
python3 /opt/bhome-deploy/staging/release-safety.py check staging
```

Smoke anonymous trên Windows có Edge:

```powershell
node scripts/Test-PublicBrowser.cjs
node scripts/Test-ProductionBoundary.cjs
```

`Test-StagingBrowser.cjs` có đăng nhập phải chạy **trên VPS** với fixture file private
được mount read-only và browser phù hợp. Không dùng harness cũ để xuất password qua SSH.
`Test-StagingHostnameBrowser.cjs` đã chạy trong container validation trên VPS, giữ
state riêng tại máy chủ để chứng minh phiên tạo trước migration vẫn còn hợp lệ.
Test Public/Production anonymous có thể chạy local, không cần credential.

Public API chưa có nội dung công bố: live kiểm empty/404. Positive UI tests dùng
responses tổng hợp và ghi riêng; không phải bằng chứng live đã có phòng/ảnh được
Owner công bố. Không tự publish demo.

Smoke lỗi → khôi phục release override cũ → `up -d --no-deps --no-build --pull never
api owner-web public-web` → gắn edge → readiness/smoke/protected snapshot. Không
restore đè DB, down/prune/remove volume/seed/migration. Khôi phục Caddy chỉ khi có
thay routing đã backup. Diễn tập 20/11 đã gây Public HTTP503 rồi rollback thành công,
API/Owner/database/storage/Production không recreate trong bài đó. **Rollback cả ba
image qua workflow mới còn PENDING**.
