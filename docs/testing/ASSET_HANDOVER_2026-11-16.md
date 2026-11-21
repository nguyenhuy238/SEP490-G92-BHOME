# Báo cáo triển khai và kiểm chứng bàn giao tài sản

## A. Phạm vi và nguồn

Yêu cầu ngày 16/11/2026, bao gồm 16 quyết định được duyệt trong yêu cầu đính kèm,
được ánh xạ BF-01/03/04/05/07, UC-06/17/19/20/26–30, GBR-01/02/04/07/18.
Xem [traceability và kế hoạch](../development/ASSET_HANDOVER_IMPLEMENTATION_2026-11-16.md).
Quyết định người dùng cho phép hoàn tất vật lý độc lập tài chính; hợp đồng Active không bị hủy vì bàn giao còn chờ.
Xác nhận trong app và PDF bàn giao không thay thế nhà cung cấp ký điện tử.

## B. Tích hợp nhánh

Baseline `member/QHuy`: `5b2323a724a8b273e0f1a77adf2f324982a33b20`, ban đầu sạch.
`origin/develop` tại `784b3b15` đã thuộc baseline. Sau fetch và đối chiếu merge-base/log/diff,
chỉ cherry-pick `96cd3c8e` và `5aa51b3d` từ `origin/FE/truong` (`5aa51b3d`), thành `0063a7d6`, `21970184`.
Không conflict, không merge toàn nhánh, không push. Tái sử dụng Asset, template, AssetMetadata,
RoomInventoryReview, history và object storage có sẵn.

## C. Backend và dữ liệu

- `ContractHandoverService` và `HandoverChecklist`: đủ nhóm cấu hình, token/version, số thực tế/giao/tình trạng,
  kiểm tra tổng, thiếu và hỏng tách riêng, evidence theo nhóm, Owner ngoại lệ và xác nhận đúng phiên bản.
- Activation Main lần đầu tạo một tác vụ theo contract, không tạo lại khi retry hoặc gia hạn. Không có Staff
  phụ trách thì tác vụ vẫn tồn tại chưa phân công. Hoàn tất theo nghiệp vụ bàn giao; nút submit task chung không bỏ qua quy trình.
- `HandoverInventoryService`: dùng inventory gateway nội bộ đã kiểm quyền hợp đồng và current Location;
  không cho Staff đi vòng qua controller kiểm kê Owner. Phòng chưa cấu hình không được tự coi là không có tài sản.
- `ContractAssetChangeService`: một event vật lý theo room + nguồn, lịch sử riêng, acknowledgment theo hợp đồng;
  loại bổ sung/thay thế/thu hồi, Asset đã tồn tại, nguồn PropertyChange hoặc Work Order Verified,
  xác minh quan hệ replacement và thao tác thu hồi. Event không tạo Asset, Work Order hoặc receivable mới.
- Baseline dùng số thực tế đã giao, chỉ cộng thay đổi Tenant đã nhận, deduplicate event, theo chuỗi renewal,
  giữ nguyên snapshot cũ. Khi group lịch sử khác nhau, dùng physical ID đã liên kết để đối chiếu.
- `ContractFinalInspectionService`: baseline + inventory hiện tại, legacy exception, phiên bản kiểm tra,
  phản hồi Tenant, Owner ngoại lệ/reinspection; chỉ Owner review đồng bộ Asset. Chặn stale token/version,
  ambiguous mapping, tài sản đang sửa/retired hoặc Work Order mở khi cập nhật hiện trạng.
- Hoàn tất vật lý giữ riêng settlement, nợ, khoản thu, cọc và refund; kiểm tra lại những hợp đồng còn ở phòng,
  chỉ kết thúc hợp đồng rời đi và yêu cầu quyết định trạng thái của Owner khi phòng trống.
- PDF iText/font Tinos, snapshot và ảnh riêng tư, reference/version/hash/length; byte được lưu một lần
  trong ContractDocumentFile/FileStore hiện có. Download kiểm quyền và integrity, không render lại theo inventory mới.
  Lỗi storage rollback thao tác hoàn tất; retry không nhân đôi tài liệu. PDF bổ sung không ghi lại chỉ số đầu kỳ như chỉ số mới.
- Runtime vẫn 24 bảng. Migration `20261115181024_AssetHandoverInventoryProjection` chỉ cập nhật EF projection/snapshot,
  Up/Down rỗng: map `Asset.PurchaseInfo` vào cột `purchase_info` đã có. Không thêm bảng kho và không chạy migration database người dùng.
  Frozen legacy context bỏ qua shadow property này để kiểm thử schema cũ đúng trạng thái.

## D. Giao diện

`packages/client-core`: DTO/client, thông báo lỗi, hooks và helper số lượng dùng chung.
Owner Web: nhận phòng, quyết định ngoại lệ, không-tài-sản, lịch sử thay đổi, phản hồi Tenant,
kiểm tra/hoàn tất trả phòng, lựa chọn trạng thái phòng và xem/tải PDF riêng tư.
Mobile: nhóm kiểm kê mở/thu gọn, số lượng/evidence, chọn chỉ số đã xác nhận, Owner exception,
Tenant xác nhận/tranh chấp, thay đổi tài sản, đối chiếu cuối kỳ và PDF; liên kết tác vụ Staff tới hợp đồng.
Ngày hiển thị theo dd/MM/yyyy, tiền theo VND; giữ hệ thống MUI/RN Paper, không thêm dependency sản phẩm.
Checkbox xác nhận và nội dung phản hồi gắn với ID/version biên bản; đổi phiên bản hoặc token inventory
xóa hiệu lực consent cũ. Tải lại phần trả phòng đồng thời cập nhật trạng thái hợp đồng ở màn hình cha.

Đã kiểm tra giao diện Owner 1440 px và Mobile web 430 px với Chrome; detector Impeccable trả `[]`.
Đã render và xem PDF nhận phòng 3 trang; PDF bổ sung 2 trang, trả phòng 4 trang được tải từ private storage của demo.

## E. Kết quả kiểm thử

Đây là kiểm chứng local Windows theo workflow thực tế `.github/workflows/ci.yml`, không phải kết quả GitHub Actions.

| Kiểm tra                                                               | Kết quả đã thực thi                                                                                                                                     |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dotnet restore src/backend/BHome.sln`                                 | Exit 0                                                                                                                                                  |
| `dotnet build src/backend/BHome.sln -c Release --no-restore`           | Exit 0, 0 warning/error                                                                                                                                 |
| Docker build MinIO và ContractConverter theo CI                        | Cả hai exit 0                                                                                                                                           |
| Application unit, phiên bản cuối                                       | 551 pass                                                                                                                                                |
| Targeted integration bàn giao + hồi quy liên quan, phiên bản cuối      | 77 pass, không skip/fail (`evidence-targeted.log`)                                                                                                      |
| Full solution trước bổ sung privacy/evidence cuối                      | Application 549, Domain 114, Integration 1219, Infrastructure 34, Digital signing 41 pass; Integration 27 skip; PlanIntegration 142 skip                |
| Full solution phiên bản cuối                                           | Application 551, Domain 114, Integration 1220, Infrastructure 34, Digital signing 41 pass; Integration 1 fail/27 skip; PlanIntegration 142 skip; exit 1 |
| `dotnet format src/backend/BHome.sln --verify-no-changes --no-restore` | Exit 0                                                                                                                                                  |
| `scripts/Test-SePaySandboxScripts.ps1`                                 | Exit 0; parse, profile cô lập, random ports, không overwrite, Test-only guard                                                                           |
| Digital signing unit command riêng theo CI                             | 41 pass, exit 0                                                                                                                                         |
| `npm ci --no-fund --no-audit` với Node 22                              | Exit 0; không đổi lockfile/dependency                                                                                                                   |
| `npm run lint`                                                         | Exit 0                                                                                                                                                  |
| `npm run typecheck --workspace ./src/mobile`                           | Exit 0                                                                                                                                                  |
| `npm test`, phiên bản UI cuối                                          | Owner 692 pass, Mobile 1267 pass                                                                                                                        |
| `docker compose --env-file .env.example config --quiet`                | Exit 0                                                                                                                                                  |
| Compose SePay theo CI                                                  | Exit 0                                                                                                                                                  |
| Demo Chrome ba phiên Owner/Staff/Tenant từ database mới                | Cả ba giai đoạn PASS (`fresh-final-e2e.log`)                                                                                                            |
| PDF tải qua API private                                                | Nhận phòng 3 trang, bổ sung 2 trang, trả phòng 4 trang; render tất cả trang và kiểm tra hiển thị                                                        |

Lượt full solution `handover-ci-tests.log` đã hoàn tất Application 551 và Domain 114 nhưng testhost integration
ngừng tiến triển kéo dài; chủ động dừng đúng cây tiến trình do phiên triển khai tạo, không tính lượt này là pass.
Stack cho thấy runner đang đợi async completion; thử lấy heap dump trên Windows thất bại, chưa kết luận nguyên nhân.
Suite OCR cục bộ liên quan đã chạy riêng: 14 pass. Chạy lại toàn solution với cùng runsettings và
`--blame-hang-timeout 3m --results-directory .tmp/handover/ci-bounded-results` để không chờ vô hạn.
Log lần chạy này: `.tmp/handover/ci-bounded-tests.log`.

Trong lượt có timeout, `OwnerThenTenantSignWithEmailedOtpAndTheSealedPdfKeepsBothSignatures(holding: false)`
trả 503 khi chuẩn bị ký. Cùng lúc quan sát được đồng hồ Windows/Docker nhảy lùi khoảng một giờ;
`docker inspect` cho thấy không có restart mới, nên không kết luận từ chuỗi uptime bất thường.
Chạy riêng lại cả hai trường hợp Holding/Main bằng binary không đổi: **2 pass**, log `otp-recheck.log`.
Chưa xác định chắc nguyên nhân 503; không sửa/bỏ qua quy tắc ký hoặc gộp kết quả retry thành một lượt CI xanh.

Frontend: `npm run build`, Expo export web (`EXPO_NO_DOTENV=1`, API example.invalid) và
`npm run format:check` đều exit 0. Start/Stop demo thực tế thành công; hai script PowerShell parse hợp lệ,
Stop từ chối đường dẫn ngoài session. Lệnh kiểm tra guard dùng `-ExecutionPolicy Bypass` theo hướng dẫn
vì máy mặc định không cho chạy `.ps1` trực tiếp.

27 integration skip là các kiểm chứng opt-in browser/provider/ONNX cần cấu hình và fixture riêng;
142 PlanIntegration skip là suite black-box có guard và các skip được khai báo sẵn.
Không tính các bài skip là pass. Các suite QA bị loại bởi filter có sẵn của `ci.runsettings` cũng không được coi là đã thực thi.

Các lần chạy phát hiện lỗi trước khi sửa được giữ trong `.tmp/handover/`:

- Fixture Compact24 cũ thiếu token/no-assets attestation, Tenant exception và Owner room disposition.
  Sửa đầu vào fixture để thực hiện đúng quyết định mới, không tắt permission hoặc kiểm tra tài chính.
- Migration baseline test cần thêm migration projection mới vào danh sách; runtime model không còn pending changes.
- Work Order Verified của fixture replacement cần approved plan và completion activity hợp lệ theo DB constraints.
- Docker restart đổi cổng PostgreSQL tạm thời: một lần targeted test lỗi kết nối; các lần sau đọc cổng bằng `docker port`.
- Test UI mobile thiếu matcher `toBeDisabled`; dùng thuộc tính disabled của button thật.
- Kiểm thử cũ PrivateEvidenceViewer được cập nhật theo hành vi click-to-load và PNG hợp lệ.
- Demo liên tục phát hiện Owner reload chỉ cập nhật inspection nhưng chưa cập nhật MoveOut của màn hình cha;
  đã sửa refresh callback và thêm regression test. Seeder chuẩn bị đầy đủ profile tổng hợp; smoke test assert
  profile đã hoàn chỉnh, không tự sửa profile để bỏ qua điều kiện đầu vào trong lúc demo.

### Ánh xạ 62 tình huống yêu cầu

Ký hiệu: `I` = Compact24AssetHandoverTests; `U` = HandoverChecklistTests/HandoverBaselineTests;
`C` = ContractLifecycleApiTests/PropertyContractConsistencyTests; `P` = các suite settlement, BF-07 và payment hiện có;
`D` = HandoverPdfRendererTests; `B` = Verify-AssetHandoverE2E.cjs. Một test có thể chứa nhiều assertion/nhánh.
Ánh xạ này không đồng nghĩa 62 bài E2E độc lập hoặc đã chạy trên thiết bị native.

| #     | Tình huống                                                                    | Bằng chứng liên quan                                                                                                                            |
| ----- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 1–2   | Activation tạo đúng một task, retry không lặp                                 | C ActivationCreatesOneMoveInTask, hai nhánh có/không Staff                                                                                      |
| 3–7   | 9/9, 7/9, Owner ngoại lệ, chặn hoàn tất, đánh dấu kiểm kê lại                 | I ExactInventory; IncompleteInventory; B                                                                                                        |
| 8–9   | Owner xác nhận không tài sản, chưa cấu hình không tự coi là rỗng              | I EmptyInventory                                                                                                                                |
| 10–12 | Ba tốt/một hỏng, tổng sai, thiếu ảnh nhóm                                     | U ThreeGoodAndOneDamaged; InvalidQuantities; ProblemRequiresItsOwnEvidence                                                                      |
| 13–17 | Scope nhóm/evidence, Tenant đúng phiên bản/correction/stale, Staff chờ Tenant | U IncompleteAndForeignGroups; C Handover; I IncompleteInventory                                                                                 |
| 18–20 | Active khi chờ, snapshot không ghi đè, lưu/tải PDF có quyền                   | I EmptyInventory; IncompleteInventory; ExactInventory; B                                                                                        |
| 21–22 | Bổ sung một ghế, giữ nguyên snapshot cũ                                       | I Supplement; B                                                                                                                                 |
| 23–25 | Replacement qua Verified WO, bỏ identity cũ, withdrawal hợp lệ                | I AuthorizedReplacementOrWithdrawal; U Replacement/Withdrawal                                                                                   |
| 26–27 | Retry không nhân số lượng; một event theo phòng/physical identity             | I Supplement; SharedAsset (acknowledgment riêng từng Tenant); U AdditionUsesActuallyHandedQuantity; SharedEventUsesPhysicalIdentity             |
| 28–33 | Đủ/thiếu/hỏng/hao mòn và đề xuất không tự tạo khoản thu                       | I OwnerConfirmedMoveOut (5 bộ dữ liệu), assertion receivables rỗng; P                                                                           |
| 34    | Owner duyệt bồi thường theo quy trình hiện có                                 | P SettlementReceivableTests, DepositDeductionTests, IncidentMaintenance/CompensationTests                                                       |
| 35–36 | Tenant tranh chấp hoặc chưa trả lời, Owner ngoại lệ                           | I OwnerConfirmedMoveOut; LegacyBaseline; B                                                                                                      |
| 37    | Reinspection, giữ phiên bản cũ                                                | I LegacyBaseline: giữ hai phiên bản, từ chối phản hồi phiên bản cũ; test UI Owner/Tenant xóa consent khi đổi phiên bản                          |
| 38–39 | Chỉ Owner đổi Asset, không đổi template                                       | I OwnerConfirmedMoveOut                                                                                                                         |
| 40–41 | UnderRepair/open WO, toàn nhóm thiếu                                          | I LegacyBaseline (hai nhánh kiểm soát maintenance); OwnerConfirmedMoveOut(observed=0)                                                           |
| 42–45 | Shared room, người cuối rời, transaction room, Owner chọn bảo trì             | I SharedAsset: hai Tenant rời đồng thời, chỉ giải phóng sau người cuối; OwnerConfirmedMoveOut; C PropertyMutationRaces/RemainingContract; B     |
| 46    | Chuỗi renewal giữ baseline                                                    | I Supplement: hai cấp renewal, nhận thay đổi trước/sau gia hạn, đọc PDF/evidence theo lineage; C Renewal                                        |
| 47–48 | Không baseline; snapshot cũ thiếu số lượng                                    | I LegacyBaseline (hai nhánh); U LegacyCondition/UnknownHistoricalQuantity                                                                       |
| 49–50 | Vật lý khi nợ còn; không tự lặp bồi thường BF-07                              | I OwnerConfirmedMoveOut; P PhysicalRelease/SettlementReceivable/IncidentMaintenance.Compensation                                                |
| 51–55 | Cross-Location/Tenant, dữ liệu riêng phòng chung, evidence/PDF                | I SharedAsset: GET/mutation/replay không lộ xác nhận Tenant khác, PDF và công nợ cross-Tenant bị từ chối; IncompleteInventory; C Handover/Scope |
| 56–58 | Cùng version, Owner sửa Asset khi kiểm tra, retry                             | I ExactInventory; LegacyBaseline; Supplement; C activation/replay                                                                               |
| 59–60 | PDF bất biến sau Asset đổi, nhiều trang và tiếng Việt                         | I IncompleteInventory; D; B và render PDF thực tế                                                                                               |
| 61–62 | Storage failure retry; compatibility snapshot/history                         | I ExactInventory; LegacyBaseline; U; các suite hồi quy legacy + Compact24                                                                       |

## F. Commit và file thay đổi

Commit tích hợp: `0063a7d6`, `21970184`; nhận phòng/PDF: `a40e155c`; asset-change/trả phòng: `12d61ba0`;
UI ba vai trò: `9b887a24`; privacy phòng chung và evidence riêng: `beaac0d9`.
Các commit consent theo phiên bản và demo/testing tiếp theo được ghi trong `git log member/QHuy`.
Không push hoặc merge sang nhánh dùng chung trong tác vụ này.

Commit `8952b116 feat(handover-demo): add an isolated three-role walkthrough` bổ sung seeder tổng hợp,
Start/Stop có guard, smoke browser, hướng dẫn demo và API docs.

| Commit     | Subject                                                              | Phạm vi                                                            |
| ---------- | -------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `0063a7d6` | fix(LocationSetup): Configure asset for Location                     | Cherry-pick inventory/configuration của Trường                     |
| `21970184` | fix(LocationSetup): Fix CI/CD                                        | Cherry-pick sửa kiểm tra CI của phần tích hợp                      |
| `a40e155c` | feat(handover): add inventory-aware move-in and stored PDF reports   | Checklist nhận phòng, xác nhận và PDF lưu bền                      |
| `12d61ba0` | feat(handover): complete asset changes and Owner-reviewed move-out   | Thay đổi tài sản, baseline, trả phòng, EF projection và kiểm thử   |
| `9b887a24` | feat(handover-ui): finish Owner Staff and Tenant handover flows      | Client/API hooks và giao diện ba vai trò                           |
| `beaac0d9` | fix(handover): scope shared confirmations and separate room evidence | Privacy mutation/replay phòng chung, phân loại evidence và PDF     |
| `d080ce17` | fix(handover-ui): bind consent to the current inspection version     | Consent theo phiên bản, refresh trạng thái cha và regression tests |

Nhóm file chính: `src/backend/BHome.Application/Contracts/Contract*Handover*`, `ContractAssetChange*`,
`ContractFinalInspectionService`, `PropertyManagement/HandoverInventoryService`, repositories/projection/migration tương ứng;
`packages/client-core/src/*Handover*`, `handoverForm`, `useContractAssetChanges`, `contracts`, `propertySetup`;
hai client `features/contracts/*` và kiểm kê Owner, task Staff; các test backend/frontend và script demo.
Danh sách đầy đủ: [ASSET_HANDOVER_CHANGED_FILES.md](ASSET_HANDOVER_CHANGED_FILES.md).
Hợp đồng API: [ASSET_HANDOVER.md](../api/ASSET_HANDOVER.md).

## G. Demo

Xem [hướng dẫn khởi động và 15 bước demo](../development/ASSET_HANDOVER_DEMO.md).
Kịch bản UI tự động đã đi qua nhận phòng 7/9 → Owner exception → Tenant → Staff → PDF,
bổ sung Ghế → acknowledgment → baseline 5, rồi trả phòng thực tế 4 → Tenant dispute → Owner exception →
Room Unavailable → PDF. Ảnh tổng hợp/capture cuối kỳ và thay đổi Asset ban đầu dùng API thật làm precondition.
Một phiên mới được để lại với hợp đồng Active, chưa bàn giao, để demo thủ công; không tái dùng contract Terminated
của lượt kiểm chứng tự động. Artifact lượt đã kiểm chứng nằm trong `.tmp/handover-demo/verified-20261116/`.

## H. Giới hạn chứng cứ

- Chưa chạy app trên thiết bị iOS/Android thật hoặc camera native trong lượt này; Mobile web và Expo export là phạm vi kiểm chứng client.
- Không thực hiện giao dịch ngân hàng thật, gửi mail/SMS thật hoặc ký hợp đồng qua nhà cung cấp thật. Các test opt-in tương ứng không được coi là pass.
- Demo có thể còn nghĩa vụ tài chính chờ Owner xử lý; Terminated/Completed vật lý không xác nhận thanh toán thành công.
- Renewal + nhiều acknowledgment và reinspection cuối kỳ cần thêm kịch bản browser riêng để có chứng cứ UI độc lập.
- Chưa đo coverage, tải 100 người dùng, p95, hiệu năng OCR hoặc thống kê 62 scenario độc lập; không suy ra các mục tiêu NFR đã đạt.
- Các tài liệu/PDF của demo chứa dữ liệu tổng hợp và ở thư mục ignored; không đưa credential hoặc dữ liệu Tenant thật vào commit.
- Tích hợp nhánh là selective cherry-pick tại các revision đã ghi; thay đổi mới hơn của Trường cần đối chiếu lại khi tích hợp tiếp.
- Lock/version và các race tài sản/phòng đã có test; chưa có chứng cứ không deadlock dưới tải kéo dài hoặc khi nhiều node cùng chạy.
- PDF có kiểm tra hash/length và quyền tải, nhưng không phải chứng thư ký số hay bảo đảm object-lock/WORM của nhà cung cấp storage.
- BF-07 vẫn chịu trách nhiệm tạo/duyệt Work Order, replacement và bồi thường; maintainer BF-07 cần giữ liên kết nguồn và trạng thái Verified khi thay đổi DTO/lifecycle.
