# Chuẩn bị phát hành Production để demo — 28/11/2026

## Phạm vi và truy vết

Yêu cầu trực tiếp ngày 28/11: tích hợp develop vào main, giữ hotfix Staging,
mở tính năng demo Production, chuẩn bị cấu hình tích hợp và xử lý chặn schema.
Quyết định này áp dụng cho deployment demo học thuật. Giữ kiểm tra Owner/Staff/Tenant,
Location/hợp đồng, dữ liệu tài chính, xác thực webhook và chống ghi nhận trùng.

| Yêu cầu                              | Truy vết                                   | Thành phần và tiêu chí chấp nhận                                                             |
| ------------------------------------ | ------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Mẫu hợp đồng/PDF, Tenant ký bàn giao | BF-03/04, UC-13..19, GBR-01/02/04          | MainDraft/renderer/signing: dùng được trên Production; người khác bị từ chối                 |
| Token kiểm kê PR #185                | BF-04, UC-17; commit `91a36958`            | Room.Version không liên quan không làm mất token; thay đổi tài sản thật vẫn làm mất hiệu lực |
| Clock cùng Test/Live và ký           | Yêu cầu trực tiếp; BF-03..06, JOB-03/09/10 | DemoClockGuard/signing validator; giữ giờ thật cho JWT/OTP/provider/lease                    |
| Manual Billing                       | BF-05, UC-20/21, GBR-07/09/18              | DI/runtime: Production opt-in; giữ Owner/Location/ngày/chỉ số/chống trùng                    |
| QR cọc/thuê/hóa đơn, SePay           | BF-06, UC-22..25, GBR-10/18                | Giữ hotfix receiving account, hai mode, kết nối Owner; không tự xác nhận đã nhận tiền        |
| Release và migration                 | NFR sẵn sàng/khôi phục                     | Backup/restore, EF migration có sẵn, schema verifier và config approval chính xác            |

Đã đọc AGENTS.md, quy ước API, runbook, hồ sơ hotfix và source/test hiện có.
SRS DOCX và Report 4 có trong docs/reports; lần này không diễn giải thêm chính sách
từ báo cáo. Căn cứ thay đổi là yêu cầu trực tiếp, bảo toàn nghiệp vụ server hiện có.

## Hiện trạng đã kiểm tra

- develop đầu phiên: `55047ec96090458335edf358acc4b1e87d1b25a9`; CI commit đó
  thành công, không phải bằng chứng CI của bản sửa mới.
- Production còn SHA main `70406ecf8dceea6e84e4ddbaa3e325807af123f2`, có hotfix
  email không giới hạn người nhận 23/11; source develop đã chứa hành vi này.
- PR #185 vẫn mở, có thêm thay đổi ngoài hotfix token. Chỉ cherry-pick
  `91a36958` thành `d24beef1` vào member/QHuy, không lấy các thay đổi khác.
- Production: 17 EF migration, 6 users, 0 contract/invoice/payment tại checkpoint;
  OCR và billing tắt, LibreOffice dùng `/usr/bin/soffice`.
- Staging dùng ba image của develop `55047ec9`, billing tự động/manual bật,
  Owner đã cấu hình Test và Live. Staging không có EF history; không tự ghi history giả.

## Source và release guard

Demo Clock không còn bị tắt bởi SePay Test/Live, general jobs hoặc signing simulation
trên hai deployment học thuật. Giữ anchors DB/storage/environment và startup data writers.
Provider tự validate cấu hình. Signing simulation ngoài Development/Testing yêu cầu
bật rõ DemoClock và khớp deployment anchors; release vẫn dùng ký thật như Staging.
ManualActionsEnabled có hiệu lực Production khi opt-in; không mở developer notification actions.

Release giữ kiểm tra DB/storage/credentials, protected containers, image digest/revision,
PDF/OCR và image-only Compose transition. Alias LibreOffice hiện hữu được chấp nhận
nhưng vẫn nằm trong fingerprint. API Production cũng phải có regression gate label.
Gate bổ sung ca clock, signing configuration và token kiểm kê.

Đổi runtime một lần cần `/opt/bhome-deploy/production/runtime-transition.json`, file
thường do root sở hữu, mode 0600, khớp đúng `target`, main `sha`, SHA-256 toàn bộ
`beforeConfig`/`afterConfig` và `expiresAt` Unix trong tối đa 24 giờ. Không khớp vẫn
từ chối; protected containers không được đổi kể cả có approval. Không chứa secret,
không commit file này. Fingerprint phải tính từ cấu hình thực/Compose + defaults
image đã duyệt. Rollback nguyên trạng vẫn được kiểm tra như cũ. Xóa approval sau release.

## Migration đã diễn tập

Không chạy lại BHOME_24_TABLES.sql lên database có dữ liệu. Sinh script EF 8.0.32,
context Compact24, từ migration cuối Production tới source hiện tại, không idempotent,
`--no-transactions`; chạy bằng psql `--single-transaction -v ON_ERROR_STOP=1`.

1. `20261120000100_SharedMainInitialPayment`
2. `20261122000100_PublicContentSnapshots`
3. `20261122000100_SettlementSePayCodes`
4. `20261126000100_SharedInvoiceDepositOffsets`
5. `20261126000200_MainInitialPaymentNoFees`
6. `20261126000200_SePayPaymentModes`
7. `20261126000300_SePayOwnerConnections`

Script SHA-256: `5a29de50c12558e050f006cb08ab7c3b8920b5592eb98ac7e0ec3b0612ab53ef`.
Đã restore backup Production vào clone riêng, áp 17 → 24 migration; fingerprint
users/contracts/invoices/payments giữ nguyên. DatabaseCheck dùng Infrastructure mới,
read-only: 24 bảng public, Compact24 PASS, applied 24, pending 0, unknown 0, runtime query PASS.

Lượt đầu dự đoán sai số migration đích là 23 do thiếu PublicContentSnapshots trong
danh sách ban đầu. Đã chạy lại trên clone khác và xác minh bằng ứng dụng; không sửa history.
Schema guard Production đang giữ baseline
`f97676af7340779d142a15fd3a358eda150eb75bc0263e1eb3c3f63ca40283dd`.
Chỉ cập nhật baseline artifact sau khi migration thật được duyệt/áp dụng và schema
verifier đúng release PASS. Không bỏ cmp hoặc coi checksum mới là bằng chứng migration.

## Cấu hình private đã chuẩn bị, chưa áp dụng

Evidence root-only: `/root/bhome-maintenance/production-demo-20261128/`.
Dump/private config/secret chỉ nằm trên VPS, không đưa vào Git hay báo cáo.

- `compose.production-environment.next.yml`: bật clock, manual billing, dedicated
  billing, OCR `/models`, PDF tools và notification automation. Giữ initializer,
  general jobs/startup asset sync tắt; SePay và billing có worker riêng. Giữ DB,
  storage, JWT, identity encryption, SMTP, PFX/keyring Production cùng cấu hình ngoài delta.
- `production-owner-connections.private.json`: payload Test/Live từ cấu hình Owner
  Staging, đủ API token/tài khoản; HMAC mới riêng Production. Không sao chép keyring
  hoặc encrypted blob Staging sang Production. Helper root-only xử lý secret trên
  VPS, không phát giá trị ra stdout.
- Sau release dùng API Owner lưu/check từng mode và chọn Test. Instance `PRD1`;
  server fallback SePay__Enabled=false không chặn kết nối Owner Test/Live (đã có
  regression). Chỉ đánh dấu sẵn sàng khi API check thành công, không tự ghi verifiedAt.
- Cập nhật callback Owner/mode và HMAC mới trên SePay; polling dùng token có sẵn.
  Chưa kiểm tra kết nối Production, đăng ký callback hoặc thực hiện giao dịch thật.

## Kiểm chứng thực chạy

| Kiểm tra                                                         | Kết quả                                             |
| ---------------------------------------------------------------- | --------------------------------------------------- |
| API Release build                                                | PASS, 0 warning/error                               |
| Unit Infrastructure: clock/manual/payment/sandbox/signing config | 91 PASS                                             |
| Unit Application: inventory token/clock/payment mode             | 31 PASS                                             |
| Integration billing/clock/Tenant signing/SePay                   | 51 PASS; cùng lượt có 6 PDF FAIL do thiếu converter |
| PDF sau dựng đúng converter                                      | 7 PASS, 0 fail/skip                                 |
| Token kiểm kê và four-section move-in submit                     | 1 PASS                                              |
| Python deployment suite Linux/Docker                             | 103 PASS                                            |
| Backup restore, migration clone, schema verifier read-only       | PASS                                                |
| git diff --check                                                 | PASS                                                |

Kiểm tra bổ sung: resolve Compose candidate và environment safety PASS, approval
chưa activate. Restore backup vào clone khác rồi chạy DatabaseCheck dựng từ main
cũ: Compact24 PASS, 17 applied, pending/unknown 0. Đã xóa ba database review sau
kiểm tra, giữ backup/evidence/config đã chuẩn bị; không để database thử tồn đọng.

Docker local ban đầu tắt: 7 test PDF fail tại fixture. Sau bật Docker nhưng chưa có
converter, 6 PDF fail. Dựng converter từ Dockerfile có sẵn rồi chạy lại 7 PDF PASS.
Lượt deployment test đầu thiếu file đóng gói và phát hiện `$sha` chưa khai báo trong
fixture rollback; đã sửa optional argument, chạy lại toàn bộ 103 test PASS.
TRX/log local ở `.tools/production-demo-20261128/`, evidence private trên VPS.
Đây là kiểm tra chọn lọc, không thay CI/review/E2E toàn hệ thống.

## Hoàn tất sau review

1. Review member/QHuy → develop, CI/Staging; review develop → main. GitHub hiện
   bắt buộc approval của người khác, backend/frontend, branch up-to-date và enforce admins.
   Không tắt protection hoặc tự tạo review thay người khác.
2. Chờ images đúng main SHA/digests, kiểm OCI và web origins, giữ environment approval.
   Cập nhật scripts root-owned Production từ main đã duyệt: release-safety,
   release-config, deploy-release và phụ thuộc; merge Git không tự cập nhật scripts này.
3. Trong cửa sổ bảo trì chặn ghi: backup DB/config/storage/keyring sát thời điểm
   triển khai, kiểm restore và đúng FROM 17 trước khi áp script. Nếu state đổi phải
   lập lại FROM/TO, không dùng backup rehearsal cũ để thay backup cuối.
4. Áp migration, schema verifier; backup baseline cũ rồi cập nhật checksum artifact
   main sau PASS. Tính runtime approval đúng SHA, install private overlay và release ba app.
5. Đã kiểm backup phục hồi vào clone tương thích main cũ bằng verifier main cũ;
   vẫn phải kiểm rollback ứng dụng cùng schema/config mới. Không mặc định image cũ tương thích
   database đã nâng; khi lỗi dừng writer, kiểm checkpoint và không tự restore đè DB
   nếu đã có ghi mới. Chưa diễn tập rollback migration/data Production.
6. Lưu/check Owner Test/Live, chọn Test, cập nhật callback; smoke auth/isolation,
   template/PDF/ký Tenant/inventory, QR cọc/thuê/hóa đơn, OCR, manual billing và clock.
   Dùng dữ liệu tổng hợp, không ký hoặc ghi nhận tiền thay người dùng chỉ để có kết quả pass.
7. Đối chiếu current.json/digests/readiness/origins/config delta, Staging không đổi;
   xóa runtime approval/plaintext transfer files sau khi kết nối đã lưu mã hóa.
   Trả clock về ngày thực khi kết thúc demo.

Tại checkpoint chuẩn bị ban đầu chưa merge main, migrate/recreate Production hoặc
áp cấu hình. Hai báo cáo vận hành chưa commit có sẵn được giữ nguyên, không đưa
vào commit release.

## Cập nhật sau khi PR #194 đã merge

Người dùng đã merge #194 trước #193; main hiện là
`28d007634dee14f4964a46d34f5091cce48586d8`, chưa chứa các sửa lỗi demo trong #193.
CI #400 của #193 dừng tại `dotnet format`: object initializer trong
`ContractWorkflowDemoDeploymentTests.cs` cần mỗi property một dòng. Các bước test
và discovery chưa chạy, nên thiếu TRX và các gate phụ thuộc thất bại; không phải
bằng chứng business test fail. Đã sửa định dạng, giữ nguyên toàn bộ assertion/gate.
Kiểm tra whitespace của project với file này đã PASS.

Probe VPS sau merge xác nhận Production vẫn chạy main cũ `70406ecf` cùng hotfix
email; chưa áp migration/config hoặc release mới. Sau khi #193 được tích hợp vào
develop cần PR bổ sung develop → main; #194 đã merge không tự nhận các commit sau đó.

### Đối chiếu inventory của các ca thay chính sách demo

Rà soát tiếp phát hiện inventory giữ danh tính của các ca còn yêu cầu chặn những
cờ demo vừa được cho phép. Giữ tên phương thức ManualStagingOptIn để bảo toàn
10 ca hiện hữu; chỉ thay ca Production opt-in và các ca clock trái quyết định 28/11.

| Ca cũ                                                                                 | Ca thay thế đã chạy PASS                                                                          |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 4 ca Staging từ chối SePay Live, SePay disabled, general jobs hoặc signing simulation | 4 ca cho phép đúng environment/key/value tương ứng, giữ các ca từ chối sai DB/storage/initializer |
| 4 ca Production từ chối SePay Test/enabled, general jobs hoặc signing simulation      | 4 ca cho phép đúng environment/key/value tương ứng                                                |
| Production manual billing opt-in vẫn trả false                                        | Cùng phương thức cũ, opt-in trả true; thêm ca worker bật độc lập                                  |

Inventory Infrastructure: giữ 243 danh tính cũ, thay 9 danh tính đã lỗi thời, thêm
21 ca đã thực chạy PASS (8 tùy chọn, 4 tổ hợp clock/provider/signing/jobs, 7 cấu hình
ký mô phỏng, 2 manual billing). Baseline từ 252 lên 264; bộ test thực tế có 267 ca.
Bốn assembly khác giữ nguyên inventory. Verifier và skip allowlist giữ nguyên.

Lệnh `dotnet test` Infrastructure với đúng `tests/backend/ci.runsettings`:
267 PASS, 0 fail/skip. Verifier `require_inventory` nguyên bản chấp nhận đủ 264
danh tính baseline trước 267 kết quả PASS thực tế. Audit từng tên/ID cũ và mới ở
`.tools/production-demo-20261128/ci193-inventory-reconciliation.json`.

Một lượt thử không truyền ci.runsettings đã đi vào suite QA ngoài merge gate và
báo lỗi kỳ vọng AccountProvisioning; đã dừng rồi chạy lại với settings hiện có của
CI. Không thay nghiệp vụ AccountProvisioning hoặc sửa bộ lọc CI để xử lý lượt thử này.

Lượt GitHub `46118967476` sau sửa format đã xuất đủ TRX. Một ca tích hợp còn so
sánh token bản nháp với token task trong Owner quick-create; giả định này không
còn đúng sau hotfix #185 tách token inventory chung và token move-in ổn định trước
thay đổi Room.Version. Cập nhật assertion để kiểm cả token bản nháp bằng StateToken
và token task bằng MoveInStateToken canonical từ inventory thật; giữ nguyên kiểm
tra tài sản, số lượng, Tenant, meter, idempotency và quyền. Thêm ca này vào regression
gate bắt buộc. Không sửa service, dữ liệu ứng dụng hoặc bỏ assertion để cho test qua.

### Production retry sau #194

Job Production `140908287906`, run `46118527560` attempt 2, dừng ở download artifact:
workflow tìm `release-28d007634dee14f4964a46d34f5091cce48586d8-2`, trong khi manifest
được tạo bởi job images ở attempt 1. Chưa chạy SSH hoặc deploy trong lượt lỗi này.

Production download và verify nay cùng dùng `needs.images.outputs.manifest-attempt`.
Verifier nhận `RELEASE_MANIFEST_ATTEMPT` do workflow truyền từ output producer;
giữ checksum, SHA, run ID, environment, repository và cả ba digest chính xác. Từ chối
producer attempt rỗng/sai định dạng/tương lai, manifest khác attempt, digest/ref/run
khác và hai cờ producer xung đột. Kiểm tra build provenance vẫn yêu cầu ba images
được tạo từ cùng commit/attempt/environment; không ghép các build khác nhau.
Cờ Staging cũ vẫn chỉ dùng cho Staging.

Đã chạy lại đủ 105 Python deployment tests trên Linux/Docker: PASS, gồm regression
Production retry và đối chiếu trực tiếp tên artifact/cờ verify trong workflow.
Prettier workflow và git diff --check PASS. Rerun workflow cũ của #194 không nhận
source fix này; cần release main mới sau khi tích hợp #193 và hoàn tất migration/config.
