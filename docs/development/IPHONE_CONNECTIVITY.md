# iPhone: kết nối HTTPS, đồng bộ phiên và dữ liệu

> Lỗi Expo Go báo thiếu tài khoản CLI hoặc manifest HTTP 500 sau khi Metro chuyển offline:
> xem [EXPO_STARTUP_FIX.md](EXPO_STARTUP_FIX.md). Dùng `npm start -- --clear` trong `src/mobile`
> để chọn Node 22 và kiểm tra kết nối/tài khoản trước khi mở Metro.

Ngày thực hiện: 30/10/2026. Nhánh `member/QHuy`. Không commit, push hoặc merge.

## Truy vết và phạm vi

Nguồn đã đọc: `AGENTS.md`, `src/mobile/AGENTS.md`, SRS
`docs/reports/BHome_Report-3_Software Requirement Specification (2).docx`
(master UC, FE-02/UC-01, UC-15/16/19, FE-08 §8.2, GBR-01/02/13/18, NFR HTTPS),
`Report-4_Software Design Specification (5).docx` (layering, TLS, mobile token storage),
`API_CONVENTIONS.md`, `CONTRACT_LIFECYCLE_UI.md`, `CONTRACT_STABILIZATION.md`,
`MOBILE_NETWORK_DEVELOPMENT.md`, `LOCAL_DEVELOPMENT.md`, các controller/service/repository,
migrations và test đang có. Không tìm thấy file quy tắc Git riêng trong checkout;
áp dụng quy tắc Git từ AGENTS.md. Không đổi policy tài chính, ký, quyền hoặc provider.

| Yêu cầu                                              | Mã và dữ liệu                                                                    | Tiêu chí chấp nhận                                                                                                                                          |
| ---------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UC-01, GBR-01/02/13, NFR TLS                         | MobileApi, MobileSessions, LoginScreen, CA/Kestrel                               | HTTPS được xác minh; token chỉ trong memory/SecureStore; chỉ công nhận phản hồi auth hợp lệ; lỗi mạng/timeout/refresh/storage không thành login giả         |
| BF-03/04, UC-15/16/19, DBR-02, GBR-18                | contract client/list và API hiện có                                              | Phân biệt success-empty/success-data/error; retry đọc lại; không tự retry mutation mơ hồ hoặc đổi trạng thái Contract/Room                                  |
| BF-01, FE-08/UC-32 (phần tổng quan vận hành), GBR-02 | OwnerOverviewScreen → GET locations/rooms/contracts → service/repository hiện có | Count lấy từ totalCount được server phân quyền, không đếm trang đầu; lỗi không hiển thị số 0; không tuyên bố đã có báo cáo tài chính đầy đủ                 |
| DBR-13, NFR integrity/recovery                       | LegacyCaptureCompatibility, ImportLegacyCapture, DatabaseUpgrade                 | Giữ ID, mật khẩu/hash, stamp, audit, dữ liệu OCR, object key và history; toàn bộ nâng cấp commit/rollback cùng nhau; không suy ra occupancy/Contract Active |

Quyết định được người dùng phê duyệt trong phiên này: **giữ dữ liệu, triển khai nâng cấp
tương thích từ schema cũ**. Chỉ áp dụng lên database development loopback `bhome`.

## Nguyên nhân và bằng chứng

1. Khi bắt đầu không có listener 7240/5240. Máy vẫn có Wi-Fi IPv4 `10.33.59.31`.
   Sau khi khởi động `Start-Api.ps1` bằng cấu hình hiện có: Kestrel nghe `0.0.0.0`,
   TLS kiểm tra thành công bằng CA local; SAN có IP hiện tại và localhost.
   `/health/live` 200, anonymous `/api/v1/contracts` 401. Chưa có bằng chứng iPhone tin cậy CA
   hoặc LAN không có client isolation. Wi-Fi là Public; có rule inbound ứng dụng BHOME.
   Không sửa firewall, CA LAN, `.env`, password, JWT hay khóa identity. Việc CA test tạm thời
   của bộ kiểm thử trình duyệt được ghi riêng ở phần kết quả bên dưới.
2. `/health/ready` 503: DB local có history `20261028103339_CaptureWorkflows` từ commit
   `0441cad`, khác chuỗi `LocationStaffAssignments` + `GlobalOwnerLocationScope` +
   `CaptureWorkflowsMerged`. Nâng cấp thường gặp SQLSTATE 42P07 `Locations already exists`
   và dừng; schema cũ chưa có Contract/Property hiện hành. Không đánh dấu các migration là đã chạy
   để né DDL. Request login với credential tổng hợp không hợp lệ trả 401 đúng, không phải mọi
   request đều 500. Không có log từ iPhone để khẳng định endpoint/status của từng lỗi trước đó.
3. Lỗi mobile dùng thông báo chung “Không thể lưu” / “Chưa xác nhận thành công” cho 500,
   không có route/correlation ID; transport nghiệp vụ chưa có timeout. Native fetch không
   cung cấp đủ thông tin để phân biệt riêng TLS với mất mạng, vì vậy UI chỉ hướng dẫn kiểm tra
   cả hai và cung cấp công cụ chẩn đoán TLS thật bên ngoài ứng dụng.
4. Dashboard Owner là nhánh placeholder được chủ động chặn để tránh hiện dữ liệu Stitch mẫu.
   Đã nối phần tổng quan cơ sở/phòng/hợp đồng với API có sẵn; tài chính vẫn ghi rõ chưa triển khai.
5. Refresh trước đây nuốt lỗi, khiến lỗi 503/network của auth thành lỗi hết phiên; auth chấp nhận
   bất kỳ JSON 2xx như một session; restore chậm có thể xóa phiên login mới. Đã sửa validation,
   propagation, epoch guard và lỗi SecureStore. Refresh thất bại đóng phiên an toàn, không tự
   gửi lại refresh token có thể đã được rotate. Người dùng đăng nhập lại khi mạng sẵn sàng.

Resolver LAN giữ thiết kế đã phê duyệt: development lấy host private từ manifest Expo;
release dùng `EXPO_PUBLIC_API_BASE_URL`. Không scan LAN hoặc chuyển token sang server khác.
Nhập URL tại login chỉ chọn origin cho lần login đó; session vẫn được ràng buộc origin/CA
khi restore. Base API đang sử dụng hiển thị tại tổng quan Owner.

## Thay đổi

- `src/mobile/src/lib/api.ts`: timeout 15 giây gồm đọc body, cancellation, JSON error,
  status/route/correlation ID; health check HTTPS không gửi credential. Không retry mutation
  sau timeout/network/409/503. Chỉ retry một lần sau 401 với token mới.
- `src/mobile/src/lib/sessions.ts`: kiểm tra shape phản hồi, secure-store errors, restore race,
  lỗi refresh đúng nguyên nhân. SecureStore adapter gốc vẫn giữ refresh token, access token ở memory.
- `LoginScreen.tsx`: kiểm tra kết nối riêng với đăng nhập; lỗi restore; preview chỉ development.
  `WorkspaceProvider.tsx` cũng chặn preview trong release.
- `OwnerOverviewScreen.tsx`, `services/ownerOverview.ts`, route workspace: loading/error/retry,
  tổng số cơ sở/phòng/phòng Occupied/hợp đồng; không thay error bằng zero hoặc đưa mẫu vào phiên thật.
- `packages/client-core/src/api.ts`, `contracts.ts`: diagnostic an toàn và kiểm tra paginated list;
  không hiển thị query, body, token hay server exception. Không đổi API/schema nghiệp vụ Contract.
- `scripts/Diagnose-MobileApi.cjs`: probe read-only với CA được chỉ định, SAN, HTTP và correlation.
- `scripts/Verify-ContractClients.cjs`: thêm kiểm tra Owner overview và vòng login/refresh/restore/logout
  từ client thật qua API HTTPS, với tài khoản tổng hợp trong DB cách ly.
- `tools/BHome.ContractVerification/ContractVerificationCli.cs`: bỏ callback bỏ qua chain/hostname
  và bỏ `ignoreHTTPSErrors` của browser. Suite browser yêu cầu CA test được Windows tin cậy;
  chỉ cho phép khi gọi tương tác với `--allow-temporary-test-root`. Cleanup thất bại phải trả
  lỗi và vẫn dọn API/container, không báo suite PASS hoặc âm thầm thay trust store.
- Hai migration tương thích, guard downgrade và `tools/BHome.DatabaseUpgrade`/
  `scripts/Update-LocalDatabase.ps1`: nâng cấp dữ liệu local theo phần dưới.
- Test: `connectivity.test.ts`, `connectivity-ui.test.tsx`, Contract transport fixture,
  `LegacyCaptureUpgradeTests.cs` và bản lịch sử migration chỉ dùng làm fixture.
  Vitest dùng cùng React với DOM renderer cho component test; đây không phải test native iOS.

## Nâng cấp legacy có bảo toàn dữ liệu

`LegacyCaptureCompatibility` chạy trước các migration bị xung đột, chỉ nhận history cũ chính xác.
Nó giữ chín bảng cũ trong schema `legacy_capture_20261028`; không xóa dữ liệu/constraint/FK cũ.
Auth, roles, sessions và SecurityAudit ở nguyên chỗ. `CaptureWorkflowsMerged` nhận lại đúng
hai cột TargetId/TargetType đã có của audit, kiểm tra type và không UPDATE audit.

`ImportLegacyCapture` chạy ngay sau khi bảng mới được tạo, trước Property/Contract/SingleSystemChain.
Nó nhập các cột chung cùng GUID, timestamps, JSON identity opaque, meter/task/evidence/reading,
giữ tham chiếu object storage và legacy ownership. Archive giữ cả các cột lịch sử không còn dùng.
Room chưa có occupancy ở schema cũ nhận default Unavailable của Property, không suy ra đang thuê.
Không tạo chứng thư, chữ ký, Contract Active hoặc giao dịch ngân hàng.

Database có nhiều Chain hoặc Staff assignment cũ sẽ dừng: cần quyết định consolidation hoặc
mapping creator/date được duyệt. Không tự lấy Owner làm người tạo assignment. History trộn,
archive tồn tại bất thường hoặc audit column sai cũng dừng. Archive là dữ liệu riêng tư trong DB,
không có endpoint/public URL; không tự xóa trước khi có chính sách recovery/retention được duyệt.

Runner chỉ nhận loopback database `bhome`, kiểm tra unknown history, lấy advisory lock và bao
toàn bộ migration trong một transaction. Nếu lỗi bất kỳ bước nào, cả archive/import/history
đều rollback. Chạy khi API đã dừng. Không dùng script reset/drop hoặc sửa history bằng tay.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Update-LocalDatabase.ps1
```

Không dùng downgrade tự động cho DB legacy đã nâng cấp: guard từ migration mới nhất chặn
trước khi các bảng nghiệp vụ bị tháo. Khôi phục cần kế hoạch được duyệt và đối chiếu dữ liệu
phát sinh sau nâng cấp. Với database mới, chuỗi migration/rollback hiện có vẫn hoạt động.

## Chạy trên Windows và iPhone

1. Sau nâng cấp local, chạy từ root:

   ```powershell
   npm.cmd run mobile:dev
   ```

   Launcher hiện có chuẩn bị LAN/TLS và mở Metro sau `/health/ready` 200. Nếu PowerShell chặn
   script, lệnh npm đã dùng child process với ExecutionPolicy Bypass. Không đổi policy toàn máy.
   Nếu dùng API Visual Studio đang mở, chỉ giữ một process trên 7240; không chạy thêm API.

2. Cùng Wi-Fi/LAN. Cấp quyền Local Network cho Expo Go/BHOME tại Settings trên iPhone.
   Mạng trường/công ty có thể chặn thiết bị ngang hàng; desktop self-probe không xác minh việc này.
3. Theo URL launcher in ra, tải **CA public** từ `/development/mobile-ca.cer` trên port 5240,
   so fingerprint với máy Windows. Chỉ endpoint tải CA dùng HTTP trong development;
   login/dữ liệu luôn dùng HTTPS. Không chuyển PFX/private key hoặc `.env` sang điện thoại.
4. Cài profile CA trong Settings → General → VPN & Device Management. Sau đó bật trust tại
   Settings → General → About → Certificate Trust Settings → BHOME Local Mobile CA.
   [Apple yêu cầu bật trust SSL/TLS riêng khi cài CA thủ công](https://support.apple.com/en-us/102390).
5. Mở Safari `https://<IP launcher>:7240/health/ready`: phải 200/Healthy, không cảnh báo TLS.
   Nếu không tới được, kiểm tra router isolation và firewall theo profile đang dùng. Chỉ thêm rule
   inbound scoped ứng dụng/port/LAN cần thiết theo môi trường; không tắt firewall toàn hệ thống.
6. Quét QR Expo mới. Login → Cấu hình kết nối API → Kiểm tra kết nối HTTPS phải báo sẵn sàng.
   Đây chưa phải xác thực tài khoản. Đăng nhập bằng Owner đã có, không gửi password/token vào chat.
7. Kiểm tra Owner summary và Hợp đồng & Vòng đời; bấm Tải lại thực sự gọi lại API.
   Nếu không có hợp đồng, chỉ hiển thị empty sau response thành công. Tắt mạng rồi tải lại:
   phải hiện lỗi, không hiện empty/success. Bật mạng và retry phải phục hồi.
8. Khởi động lại app, thử access token hết hạn, logout; role/session phải đồng bộ ở mọi route.
   Sau refresh lỗi hoặc đổi server/CA, đăng nhập lại. Không ghi token ra Mobile log.
9. Khi lỗi, ghi lại method/route, HTTP status và mã truy vết từ UI. Đối chiếu mã đó trong Backend log;
   không gửi toàn bộ `.env`, log body, CCCD, mật khẩu hoặc refresh token.

Chẩn đoán từ Windows bằng CA explicit:

```powershell
node scripts/Diagnose-MobileApi.cjs https://<IP-launcher>:7240 .tools/mobile-tls/root-ca.cer
```

Kỳ vọng live/ready 200, protected Contracts anonymous 401, `TLS authorized=true`, SAN đúng IP.
Script chỉ kiểm tra từ máy Windows, không chứng minh iPhone đi qua Wi-Fi được.

Nguồn API đã đối chiếu: [Expo SDK 58 SecureStore](https://docs.expo.dev/versions/v58.0.0/sdk/securestore/),
[Constants](https://docs.expo.dev/versions/v58.0.0/sdk/constants/),
[Kestrel endpoints](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/servers/kestrel/endpoints?view=aspnetcore-8.0).

## Kết quả kiểm chứng

Log/TRX chỉ ở `.tools/iphone-*` ignored. Các số sau là kết quả thực chạy trong phiên này,
không kế thừa số PASS từ yêu cầu ban đầu.

| Lệnh / phạm vi                                                                                                                       | Kết quả                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dotnet build src/backend/BHome.sln --no-restore -m:1`                                                                               | PASS, 0 warning/error                                                                                                                                                         |
| `dotnet test src/backend/BHome.sln --no-build --no-restore --logger trx --results-directory .tools/iphone-tests/backend-final-2`     | PASS 484/484: Domain 56, Application 161, Integration 267; fail 0, skip 0                                                                                                     |
| ContractLifecycleApiTests (trích từ TRX đầy đủ)                                                                                      | PASS 17/17                                                                                                                                                                    |
| LegacyCaptureUpgradeTests (trong suite đầy đủ)                                                                                       | PASS 4/4, gồm full legacy fixture với identity opaque/meter/evidence/readings, retry, multi-Chain/assignment refusal, downstream rollback và downgrade guard                  |
| `dotnet test src/digital-signing/BHome.DigitalSigning.sln --no-restore --logger trx --results-directory .tools/iphone-tests/signing` | PASS 41/41; provider tổng hợp trong suite, không MySign thật                                                                                                                  |
| `npm.cmd run test --workspace src/owner-web`                                                                                         | PASS 56/56; `typecheck` PASS                                                                                                                                                  |
| `npm.cmd run test --workspace src/mobile`                                                                                            | PASS 129/129; gồm lỗi mạng/TLS, timeout, 401/403/404/409/500/503, empty/error/data, refresh concurrency, secure storage, cross-origin credential isolation và Dashboard retry |
| `npm.cmd run typecheck --workspace src/mobile`, `npm.cmd run lint --workspace src/mobile`                                            | PASS                                                                                                                                                                          |
| `expo export --platform ios --output-dir ../../.tools/iphone-ios-export` từ src/mobile                                               | PASS; bundle Hermes 3,6 MB và assets; không phải native/device build                                                                                                          |
| `powershell -NoProfile -ExecutionPolicy Bypass -File tests/scripts/MobileDevelopment.Tests.ps1`                                      | PASS 26 assertions; OS/network boundaries tổng hợp                                                                                                                            |
| ESLint các file shared/test/script đã sửa, Prettier, `git diff --check`                                                              | PASS ở lượt kiểm tra cuối                                                                                                                                                     |
| `dotnet build tools/BHome.DatabaseUpgrade` và build ContractVerification                                                             | PASS, 0 warning/error                                                                                                                                                         |
| `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/Update-LocalDatabase.ps1`                                               | PASS: 9 pending migrations áp dụng atomically lên loopback bhome; không reset DB; chạy lại không còn pending                                                                  |
| Kiểm tra bảo toàn local trước/sau trên 15 bảng                                                                                       | PASS: count và row digest giữ nguyên cho users/roles/sessions/audit và toàn bộ dữ liệu legacy trong archive; không xuất user rows                                             |
| `node scripts/Diagnose-MobileApi.cjs https://10.33.59.31:7240 .tools/mobile-tls/root-ca.cer`                                         | live/ready 200, anonymous Contracts 401; CA/SAN hợp lệ, TLS authorized=true; xem log chẩn đoán cuối cho negative TLS                                                          |
| Client → API HTTPS thật + DB cách ly (`ContractVerification`) trước sửa trust fixture                                                | 18 nhóm PASS; Node xác minh CA; browser fixture cũ chưa xác minh trust TLS                                                                                                    |
| Lượt client/browser HTTPS nghiêm ngặt, `.tools/iphone-live-strict.log`                                                               | 18 nhóm nghiệp vụ PASS, 0 full Contract flow hoàn tất; **runner FAIL ở cleanup CA**. Không có TLS bypass trong lượt này. Không ghi toàn suite PASS                            |

Các lỗi trung gian được giữ và đã xử lý: Python không có (đọc DOCX bằng PowerShell ZIP/XML);
PowerShell nested quoting sai (đổi cách gọi); regression đầu dùng sai kỳ vọng sync/async và
hai React instance (sửa contract helper/alias renderer); lint effect cập nhật state đồng bộ
(chuyển loading reset vào nút retry); build runner bị API do phiên này mở khóa DLL
(chỉ dừng API đó rồi build lại); nâng cấp legacy thường lỗi 42P07 (đã có compatibility path
và transaction thay thế, không sửa history để né lỗi).

**Việc dọn Windows còn cần xác nhận:** lượt browser nghiêm ngặt đã thêm CA test public
`BHOME disposable verification CA`, thumbprint
`5F6B06C76D36AA70E7804006AE2A8FD728F1EB5A` (hết hạn 18:11 ngày 30/10/2026).
Windows hủy thao tác gỡ CA; phương án xóa đúng registry key bị bộ kiểm duyệt tự động
chặn “blocked by policy”. Không thử đường xóa khác sau khi bị chặn. Người dùng cần
`certmgr.msc` → Trusted Root Certification Authorities → Certificates → xóa **đúng CA test này**
và chấp nhận Windows confirmation; giữ nguyên BHOME Local Mobile CA. Không có CA private key
được đưa vào trusted-root store. API/container test đã được reaper dọn; chỉ hai container
development có sẵn còn chạy. Runner cuối đã thêm opt-in trước thao tác trust và xử lý cleanup
failure không cản dọn tài nguyên khác. Không tự chạy lại trust enrollment.

Để chạy đầy đủ browser suite trên Windows sau này trong terminal tương tác:

```powershell
dotnet run --project tools/BHome.ContractVerification -- --allow-temporary-test-root
```

Chấp nhận cả hộp thoại thêm **và gỡ** CA test của lần chạy đó; runner không dùng
`ignoreHTTPSErrors`, `NODE_TLS_REJECT_UNAUTHORIZED=0` hoặc accept-all certificate callback.
Lượt cuối chưa chạy lại thao tác trust này để tránh tạo thêm CA khi bước dọn đang chờ xác nhận.

Chẩn đoán TLS âm trên API LAN thật cũng đã chạy: CA không tin cậy bị từ chối với
`UNABLE_TO_VERIFY_LEAF_SIGNATURE`; tên TLS sai bị từ chối với `ERR_TLS_CERT_ALTNAME_INVALID`.
Các probe này chỉ bắt tay TLS, không gửi credential hoặc ghi dữ liệu, không sửa trust store.

**NOT VERIFIED ON PHYSICAL DEVICE**: chưa thao tác trực tiếp trên iPhone; chưa xác minh
CA trust, quyền Local Network, client isolation, Safe Area/bàn phím trên các kích thước iPhone,
release cài trên thiết bị hoặc thay Wi-Fi vật lý. Bundle iOS và DOM component tests không thay thế
các bước này. MySign thật và quyết toán/holding ledger vẫn có các giới hạn đã nêu ở
`CONTRACT_STABILIZATION.md`; không tuyên bố hoàn tất vòng đời end-to-end qua provider thật.
