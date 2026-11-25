# Vận hành và rollback CI/CD — 25/11/2026

Phạm vi: chỉ thị Final CI/CD Optimization, Regression & Acceptance, nhánh
`member/QHuy`, nền `f67bba2f838fdb67bfe0cbcfc4370c2350d74443`.
Truy vết NFR chất lượng kiểm thử, bảo mật, khả năng khôi phục trong `AGENTS.md`;
hồi quy được bảo vệ: BF-03/04, UC-17, BF-05/UC-20/21/JOB-09/10,
BF-06/UC-22, GBR-01/02/07/10/18. Không đổi nghiệp vụ, API hoặc schema.
Nguồn quyết định phạm vi là chỉ thị người dùng; không suy diễn yêu cầu mới từ
các mẫu Report 5/6/7. Tiêu chí: giữ toàn bộ kiểm tra cũ, bằng chứng đầy đủ,
không nới skip/exclusion, không triển khai thật.

## Kiến trúc và critical path

Trước: backend restore/build/test/format và chạy lại Digital Signing;
frontend chạy tuần tự các workspace, build, browser, Expo và guard;
ba image validation chạy tuần tự sau backend/frontend. Release build tuần tự
API → Owner → Public trong một job.

Sau: backend giữ một lượt chạy đủ năm assembly. Frontend tách quality và
matrix ba workspace. API và hai Web image validation chạy độc lập với tests.
Các job tổng hợp giữ tên check `backend`, `frontend`, `build-staging-images`.
`ci-quality-gate` kiểm tra kết quả trước khi gọi reusable release.
Release build ba image song song rồi mới tạo manifest thống nhất.

| Job                                    | Trách nhiệm và điều kiện hoàn tất                                                                    |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `change-detection`                     | Chỉ xuất khuyến nghị và artifact; effective scope luôn Full CI                                       |
| `backend`                              | Restore, build, format, SePay scripts, MinIO/converter, discovery, năm assembly, hai TRX guard       |
| `frontend-quality`                     | ESLint, Prettier, client-core, Compose, Python/Node deployment guards                                |
| `frontend-workspaces`                  | Owner/Public/Mobile tests và JUnit; Web build; Public browser; Mobile types/Expo export              |
| `frontend`                             | Cả quality và toàn bộ matrix phải success                                                            |
| `validate-api-image`                   | PR/dispatch/merge group: build API, không push                                                       |
| `validate-web-images`                  | PR/dispatch/merge group: matrix Owner/Public build đúng Staging arguments, không push                |
| `build-staging-images`                 | Tổng hợp backend/frontend/API/Web; chạy với `always()` trên các event validation                     |
| `ci-quality-gate`                      | Backend/frontend/scope success; image aggregate success trên validation events, skipped trên push    |
| `release`                              | Chỉ push develop/main sau CI gate; reusable workflow                                                 |
| Release `target`                       | Chọn environment/origin/suffix theo đúng branch                                                      |
| Release `build-api/owner/public`       | Checkout đúng SHA, build/push độc lập, xuất digest và provenance                                     |
| Release `images`                       | Kiểm SHA, run-attempt, environment, digest rồi tạo manifest/checksum                                 |
| Release `staging`                      | Opt-in CD variable, environment staging, checksum, khóa triển khai, wrapper VPS                      |
| Release `production-policy/production` | Opt-in CD variable, kiểm policy trước và sau approval, environment production, checksum, wrapper VPS |

Critical path mới là nhánh chậm nhất trong backend/frontend/image validations,
cộng các job tổng hợp; release thêm nhánh image chậm nhất rồi aggregation/deploy.
Không cộng thời gian các job song song thành wall-clock. Chưa có benchmark
GitHub Actions của working tree này; không kết luận đạt mục tiêu 10–15 phút.

## Mapping kiểm tra cũ sang mới

| Kiểm tra trước tối ưu                        | Job/step hiện tại                                                                   |
| -------------------------------------------- | ----------------------------------------------------------------------------------- |
| Backend restore/build                        | `backend`, vẫn toàn bộ `BHome.sln`                                                  |
| Application/Domain/Infrastructure Unit Tests | `backend`, `BHome.CI.slnf` và inventory năm assembly                                |
| Integration Tests, runsettings, SQL evidence | `backend`, giữ service PostgreSQL loopback và `BHOME_COMPACT24_QUERY_LOG`           |
| Digital Signing riêng                        | Nằm trong cùng `BHome.CI.slnf`; bỏ lượt thứ hai bị trùng, không bỏ suite            |
| .NET Format, SePay scripts                   | `backend`, chuyển trước test để lỗi sớm                                             |
| Frontend Unit Tests                          | `frontend-workspaces` đủ Owner/Public/Mobile; client-core hiện không có script test |
| Client Core Build                            | `frontend-quality`                                                                  |
| Mobile Typecheck                             | Matrix mobile                                                                       |
| Frontend Build                               | Matrix Owner/Public                                                                 |
| Browser Regression                           | Matrix public-web, Chromium và `test:browser`                                       |
| Expo Export                                  | Matrix mobile, giữ Node 22, offline example API và hai worker                       |
| ESLint / Prettier                            | `frontend-quality` toàn repository                                                  |
| Hai Compose validation                       | `frontend-quality`, chỉ example profiles                                            |
| Deployment guards / Bash syntax              | `frontend-quality`                                                                  |
| Staging hotfix regressions                   | `backend`, `Verify-StagingRegressions.py`                                           |
| Docker image validation                      | Hai job độc lập + aggregate cũ                                                      |
| TRX retention                                | `backend`, thiếu file là lỗi; thêm discovery và verifier                            |
| JUnit evidence                               | Bổ sung từng matrix workspace/browser, thiếu/hỏng/skip là lỗi                       |

## Cache và điều kiện dùng image dựng sẵn

NuGet chỉ cache package tải về. Key gồm OS, kiến trúc, SDK thực tế và các
project/props/targets/lockfile/solution/config. Restore/build luôn chạy.
Npm dùng cache download của setup-node theo lockfile; vẫn chạy `npm ci`.

Backend MinIO/converter dùng Buildx `load: true` và scope GHA riêng, giữ tag
fixture hiện tại. Không cần một image mới chưa có trên registry. Cache miss
vẫn build từ source. API restore được tách khỏi COPY source. Web restore nhận
các package manifest/lockfile trước APP/source, chỉ COPY source của Web cần build.
Root lockfile thay đổi vẫn cố ý invalidates restore workspace.

Cache PR validation khác scope release; release không đọc scope PR. GHA còn
giới hạn cache theo branch/ref. Cache không thay thế kiểm build/digest và không
chứa credential. Chỉ lỗi export cache được `ignore-error=true`; không dùng
`continue-on-error` để che lỗi build/push. Exporter GHA thực tế phải kiểm trên
Actions; benchmark local dùng backend `local`, không đại diện độ trễ GHA.

`Measure-DockerCache.py` dùng builder/tags riêng, cold instruction cache,
warm cache và import từ local export. Các probe comment/whitespace nằm trong
tar synthetic, không sửa source. Không prune toàn cục. Base layers/registry
mirror vẫn có thể được cache; không gọi đây là cold network pull.

Runtime-base hiện là target trong Dockerfile, chưa là dependency registry.
Muốn dùng image prebuilt phải có quyền publish, digest bất biến, provenance,
cập nhật bảo mật, fallback build và review trước. Không bỏ fallback hiện tại.
Không tái sử dụng bundle PR/Staging cho Production vì origin/environment/revision
được compile vào Web.

## Test inventory và thêm test

`ci-test-inventory.json` là tập identity tối thiểu đã review, không phải số lượng
chính xác cố định. Verifier yêu cầu đủ năm assembly, kết quả Passed hoặc đúng
32 identity skip đã chấp nhận, counters nhất quán và không trùng ID/report/shard.
Display-name hash kết hợp class/method; danh sách test ID phân biệt theory có
display name trùng nhau. Linux #339 và Windows local đã được đối chiếu bằng
identity, không chỉ bằng số lượng. Chỉ hai theory infinity đã đo được có
normalization `∞`/`Infinity`; không normalize tùy tiện các tên khác.

Thêm test Passed không cần sửa baseline để CI xanh. CI discovery từ binary
vừa build và chạy toàn bộ solution filter mỗi lần; verifier yêu cầu test method
mới và các theory row đã expand lúc discovery xuất hiện trong TRX. MemberData
được hoãn tới runtime chỉ có method ở discovery; các row cũ vẫn được bảo vệ bằng
ID baseline, còn row mới do full VSTest execution mở rộng. Không tuyên bố console
discovery tự biết số row động chưa được xUnit expand.

Khi muốn đưa các test mới đã Passed vào baseline được review:

```powershell
python scripts/Verify-BackendTrx.py <trx-directory> tests/backend/ci-test-inventory.json --discovery <discovery.json> --candidate <new-candidate.json>
```

Candidate tạo exclusive, chỉ sau khi baseline cũ PASS. CI không ghi đè inventory.
Review diff candidate trong PR cùng thay đổi tests; thay inventory bằng candidate
sau review, không cập nhật chỉ để làm mất test. Đổi tên/xóa test hợp lệ sẽ làm
baseline fail: giải thích old → new identity, lý do thay/xóa và case thay thế trong
PR; reviewer khác xác nhận phần baseline sửa có chủ ý. Công cụ không tự tạo
candidate hợp lệ khi đã mất identity cũ. Không yêu cầu cả năm người cập nhật
fingerprint tổng cho mỗi test mới. GitHub branch protection/CODEOWNERS enforcement
chưa được xác minh vì giới hạn quyền; quy trình review không phải bằng chứng
server đã cưỡng chế bảo vệ baseline.

## Sharding và đọc evidence

Backend mặc định không chia shard. Pilot `Measure-IntegrationShardPilot.py`
chỉ gồm 30 test/năm class; cần Docker local, Release binaries đã build và TRX
baseline. Mỗi group dùng PostgreSQL/port/log riêng, giữ runsettings/exclusions.
Không suy rộng 90 lượt-test Passed thành nghiệm thu 1.524 Integration Tests.

`Plan-IntegrationShards.py <integration.trx> <new-plan.json>` lập phân hoạch
hai shard theo tổng duration từng class và kiểm ID đúng một lần. Có explicit
xUnit Collection thì từ chối lập kế hoạch cho tới khi grouping được review.
Hiện 140 class, không có Collection/CollectionDefinition; IClassFixture được
tạo theo class, không phải fixture chia sẻ toàn suite. Tổng duration test không
bao gồm toàn bộ setup/cleanup/wall-clock. Trước khi áp dụng toàn bộ cần chạy
lặp hai shard với DB/port/network/file/container riêng, log SQL và cleanup,
so union ID/outcome với baseline, giữ đủ 32 NotExecuted hoặc giảm do test PASS,
và chạy cả regression gate. `Verify-BackendTrx.py --integration-shards 2` chỉ
chấp nhận đúng hai Integration TRX; không tự bật sharding.

Owner pilot dùng hai process, mỗi process `--maxWorkers=1`, giữ tổng hai worker
như suite cũ, giữ isolation. So union file/case multiset với JUnit baseline;
duplicate file, missing case hoặc fail/skip đều từ chối. Summary phân biệt
`wallSeconds`, từng `shardSeconds` và `totalShardSeconds`. Đây là pilot local;
quyết định áp dụng ghi trong báo cáo nghiệm thu, không đổi mặc định chỉ để
đánh dấu hoàn thành.

Hai lượt local cuối: 468,03 s và 451,20 s, so với baseline 575,31 s;
đủ 141 file / 1.059 test mỗi lượt, union identity khớp hoàn toàn, không skip/fail.
Trung bình giảm 20,1% wall-clock. Tổng thời gian process của hai shard là
790,76 s và 760,85 s; nếu đặt trên hai runner riêng thì tăng tổng runner time
khoảng 34,8% so với một lượt baseline (chưa tính setup). Backend vẫn nằm trên
critical path đã đo của CI #339. Quyết định: **giữ Owner sharding là pilot,
không bật mặc định**, chờ benchmark toàn pipeline trên GitHub trước khi trả
thêm chi phí job/runner. Không thay fixture isolation hay tăng worker.

TRX/JUnit là evidence kết quả, log khởi chạy không phải PASS. JUnit từng suite
phải có testcase, counters khớp và không failure/error/skipped ẩn. TRX phải có
đủ definition/result, Passed, các skip đúng whitelist. XML truncate, shard
rỗng hoặc artifact thiếu phải fail. Giữ log và exit code của từng command.

## Chạy local và xử lý CI fail

Windows có thể dùng `.tools/node-v22.23.4-win-x64/node.exe`,
`.tools/dotnet/dotnet.exe` và Python có sẵn. Không dùng Python Windows Store
alias nếu interpreter chưa cài. Chạy PowerShell fixture bằng
`powershell -NoProfile -ExecutionPolicy Bypass -File <test.ps1>`.

```text
dotnet restore src/backend/BHome.sln
dotnet build src/backend/BHome.sln -c Release --no-restore
dotnet format src/backend/BHome.sln --verify-no-changes --no-restore
python scripts/Capture-BackendDiscovery.py <new-discovery-directory>
dotnet test src/backend/BHome.CI.slnf -c Release --no-build --settings tests/backend/ci.runsettings --logger trx --results-directory <trx-directory> -m:1
python scripts/Verify-BackendTrx.py <trx-directory> tests/backend/ci-test-inventory.json --discovery <discovery-directory>/discovery.json
python scripts/Verify-StagingRegressions.py <trx-directory>
npm run lint
npm run format:check
npm run typecheck --workspace ./src/mobile
npm test
npm run build
node --test tests/deployment/*.test.cjs
python -m unittest discover -s tests/deployment -p test_*.py -v
```

Integration cần PostgreSQL disposable theo `Test-Compact24Isolated.ps1`/CI;
không lấy connection string từ Staging/Production. Deployment Python suite
đầy đủ cần Linux/POSIX, Bash và Docker Compose parser; Windows không có `fcntl`.
Không sửa/xóa test để tránh giới hạn hệ điều hành. Vite development dùng origin
local; email launcher tests dùng cấu hình synthetic và không gửi thư.

Khi được phép push, Full CI chạy trên push develop/main, PR, dispatch và merge
group. Shadow detector không skip job. Unknown diff/event/history fallback Full.
Dispatch chạy toàn bộ checks nhưng không gọi branch release.

Nếu CI fail: đọc job đầu lỗi, log và artifact đúng attempt; sửa nguyên nhân,
không nới assertion. Thiếu test phải kiểm discovery, filter, assembly và baseline.
Re-run failed jobs có thể tái dùng output của build thành công ở attempt trước;
manifest cố ý từ chối provenance khác attempt. Khi lỗi này xảy ra, chọn Re-run
all jobs để có một bộ image/provenance thống nhất. Không xóa kiểm tra attempt.
Cache miss không được làm mất test/build; cache exporter lỗi không che lỗi
thực thi. Cancelled/failed/missing/unexpected skipped mandatory job chặn gate.

## Release safety và quyền cần có

Giữ origin/API URL/environment/revision hiện tại. Manifest ràng buộc đúng branch
push, full SHA, run-attempt, môi trường, repository suffix và ba digest SHA256.
Download phải khớp checksum từ aggregation và đúng inputs; artifact bị thay
hoặc hỏng không qua gate. Build commit khác môi trường/attempt không được ghép.

Giữ concurrency môi trường, stale branch check trước deploy, shared VPS locks,
health/webhook checks và rollback có sẵn. Không thay `.env`/private overlay bằng
example: đặc biệt manual billing, Jobs, automatic billing, SePay, DB và storage.
`release-config.py` chỉ cho đổi image, guard từ chối mọi delta cấu hình khác.
Các hotfix source được bảo vệ bằng chín nhóm Staging regression và OCI label.
Tham chiếu `DEVELOP_SYNC_STAGING_HOTFIXES_2026-11-24.md`,
`STAGING_RELEASE_PRESERVATION_2026-11-24.md`,
`BILLING_MANUAL_STAGING_DEMO_2026-11-24.md` và runbook Production hiện có.

CI cần contents read, Actions cache/artifact; release build cần packages write;
production policy cần actions/deployments read. SSH secrets chỉ cấp trong
deployment job/environment đã cấu hình; pinned known_hosts vẫn bắt buộc.
Branch Protection API 403 trước đó chưa được xác minh lại và không được bypass.
Giữ check names không chứng minh rule/filter GitHub hiện hành đã tương thích.

## Rollback riêng CI/CD

Không dùng `git reset --hard`, checkout toàn tree hoặc rollback nghiệp vụ.
Trước hết giữ patch/backup của **đúng các file CI/CD** đang review. So với nền
`f67bba2f...` và dùng GitHub Desktop/review diff để hoàn nguyên từng hunk tương
ứng, giữ nguyên các sửa khác của thành viên. Không chạy lệnh rollback tự động
trong workspace đang có thay đổi chưa commit.

1. Owner/backend sharding mặc định chưa bật: dừng dùng pilot là đủ.
2. Cache: bỏ riêng cache steps/arguments; restore/build/tests vẫn giữ nguyên.
   MinIO/converter có thể trở lại `docker build` với đúng Dockerfile/tag cũ.
3. Docker dependency layers: gộp restore/publish hoặc COPY lại như nền, chỉ sửa
   hai Dockerfile; build lại image local và chạy runtime smoke trước review.
4. Frontend job split/image parallel: chuyển các command về thứ tự cũ, giữ
   toàn bộ mapping và ba required check names. Chạy contract tests/actionlint.
5. Release parallel/manifest: chỉ hoàn nguyên các hunk job/needs liên quan trong
   workflow, giữ nguyên URLs, digest pinning, hotfix label, private-config guards,
   environment approval/concurrency và các deploy scripts đã có ở nền.
6. Verifier/inventory/discovery: nếu cần rút một tính năng thì phải giữ đủ test
   execution và Staging regression gate; giải thích mất mức bảo vệ nào trong PR.

Rollback image đã triển khai thuộc runbook môi trường: dùng release manifest
cũ và private overlays hiện hành, không thay schema/data, không dùng image
Staging cho Production. Tác vụ nghiệm thu này không thực hiện deployment hay
rollback trên VPS.
