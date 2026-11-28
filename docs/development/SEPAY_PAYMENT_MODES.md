# SePay Test / Live

Phạm vi đã được yêu cầu ngày 26/11/2026: Owner chuyển Test/Live ở mọi môi trường,
không thêm quyền. Đây là quyết định thay thế hạn chế mode theo môi trường trước đây.

Quyết định bổ sung trực tiếp của user cùng ngày 26/11/2026: **Test và Live chỉ khác kênh nhận tiền**;
cùng áp dụng nghiệp vụ, sổ thu, công nợ và báo cáo BHome. Quyết định này thay thế quy tắc cũ cùng ngày
về loại nghĩa vụ/receipt Test khỏi doanh thu hoặc tài chính. Mode không phải bộ lọc để loại số liệu báo cáo.
Owner cấu hình ngân hàng, API Token, HMAC Secret và kiểm tra kết nối ngay trên Web;
không cần sửa `.env` và không bị chặn chuyển Live chỉ vì server chưa cấu hình profile Live.

Truy vết: BF-03/04, UC-13..19 (cọc, hợp đồng); BF-05/06, UC-20..25,
GBR-10/18, DBR-06/07, JOB-03 (phát hành, thanh toán, đối soát);
FE-08 (báo cáo); NFR bảo mật và cách ly dữ liệu.
Nguồn: yêu cầu trực tiếp và SRS trong docs/reports. Không thay đổi quy tắc ký,
phê duyệt, phân bổ cọc, hoàn tiền hoặc công thức tài chính.

Thành phần: SePayOptions, PaymentCodeRegistry, SePayService/Repository/Jobs,
ReceivingAccountsController, TransferInstructionsService, ContractService,
Owner Web, shared client/Mobile, Compact24 migration và deployment guards.

Nghiệm thu tự động: chuyển hai chiều và quyền Owner; lưu tài khoản riêng;
QR cũ giữ mode/tài khoản; HMAC khác mode; webhook/polling trùng;
partial/overpayment, sai mã; mã khác instance; cùng nghiệp vụ/báo cáo cho Test và Live;
cấu hình kết nối trên Web, quyền Owner, secrets write-only và kiểm tra kết nối không chuyển tiền.
Kết quả thực thi được báo cáo riêng, tài liệu này không phải bằng chứng test pass.

## Giao diện Owner Web

- Trong **Thu tiền & công nợ → Tài khoản nhận tiền**, bộ chọn phân đoạn **Test Mode / Live Mode**
  hiển thị một chế độ đang chọn, không dùng công tắc bật/tắt. Khi đang lưu, bộ chọn bị khóa và có thông báo tiến trình;
  lỗi tải chế độ hoặc tài khoản có thao tác **Thử lại**, lỗi lưu được hiển thị tại chỗ.
- Biểu mẫu đọc và lưu ngân hàng, API Token và HMAC Secret riêng theo chế độ đang chọn.
  Owner xác nhận thông tin trước khi lưu, sau đó dùng **Kiểm tra kết nối** ngay trên Web.
  Secrets đã lưu không được đọc lại; để trống trường secret khi sửa để giữ giá trị hiện có.
  HMAC Secret cần ít nhất 32 ký tự; không echo secrets vào phản hồi hoặc thông báo.
- Danh mục ngân hàng là snapshot công khai 76 ngân hàng từ [VietQR banks API](https://api.vietqr.io/v2/banks)
  ngày 26/11/2026, lưu tại `packages/client-core/src/banks.json`. Đây là danh mục chọn ngân hàng,
  không phải bằng chứng ngân hàng đã được liên kết SePay. Nếu không có ngân hàng trong danh mục,
  Owner nhập BIN 6 số và mã ngân hàng trên SePay bằng tay.
- Chuyển chế độ chỉ áp dụng cho nghĩa vụ mới; QR đã phát hành giữ nguyên chế độ và tài khoản nhận.
  Test dùng kênh SePay thử nghiệm, Live dùng kênh ngân hàng thật; cả hai đi qua cùng nghiệp vụ và báo cáo BHome.
- Có thể chuyển Live trước khi cấu hình kết nối; chuyển mode không đồng nghĩa kết nối đã sẵn sàng.
  Owner tiếp tục cấu hình và kiểm tra tài khoản của mode đó trước khi nhận tiền qua SePay.
- Đây là phần mở rộng của không gian làm việc Operate hiện có: dùng các điều khiển Material UI,
  màu trạng thái, kiểu chữ và bố cục biểu mẫu chung của Owner Portal. Không thay đổi
  `src/owner-web/PRODUCT.md`, `src/owner-web/DESIGN.md` hoặc các token thiết kế.

Các khoản thu cuối hợp đồng mới được chốt cũng ghi nhận mode Owner đang chọn tại thời điểm phát hành,
độc lập mode của hợp đồng cũ. Bản ghi cũ và lần phát lại cùng idempotency key giữ nguyên mode đã phát hành.

Khi chuyển từ cấu hình server sang cấu hình Owner, giữ cả binding Location cũ và binding Owner mới
để QR đã phát hành tiếp tục được đối soát tự động.

Khi Owner thay HMAC, callback dùng key server cũ không được ghi nhận tiền cho tài khoản đó nữa,
kể cả qua URL webhook cũ hoặc giao dịch thiếu mã. Sau khi thay key, cập nhật webhook trên SePay
sang URL Owner/mode hiển thị trong cấu hình và HMAC vừa lưu.

## Hợp đồng API và dữ liệu

- `GET /api/v1/receiving-bank-accounts/owner/mode`: `{ mode, testAvailable, liveAvailable }`.
- `PUT` cùng URL: `{ mode: "Test" | "Live", expectedMode }`. Owner hiện tại được phép;
  stale mode trả `409 payment_mode_changed`. Không dùng profile server chưa bật làm điều kiện chặn chuyển mode.
- `GET /api/v1/receiving-bank-accounts/owner/Test` và `/owner/Live`: tài khoản mới nhất của từng mode.
  `PUT /owner` giữ DTO cũ; `isDevelopmentDemo` xác định mode của tài khoản và version được kiểm tra riêng.
- `GET /owner` giữ tương thích: trả tài khoản của mode đã chọn; trước khi chọn lần đầu vẫn đọc lịch sử cũ.
- `GET` / `PUT /api/v1/receiving-bank-accounts/owner/sepay/{mode}`: xem trạng thái hoặc lưu kết nối
  và tài khoản nhận của Owner đang đăng nhập; `{mode}` là `Test` hoặc `Live`.
  `POST /api/v1/receiving-bank-accounts/owner/sepay/{mode}/check` kiểm tra kết nối đã lưu.
  GET chỉ trả metadata như `hasApiToken`, `hasWebhookSecret`, `status`, phiên bản, callback và tài khoản;
  không trả lại giá trị API Token/HMAC Secret.
- Callback kết nối Owner là `POST /api/v1/integrations/sepay/{mode}/owners/{ownerId}/webhook`.
  Hai callback server `POST /api/v1/integrations/sepay/Test/webhook` và `/Live/webhook` vẫn tương thích.
  Callback `/api/v1/integrations/sepay/webhook` cũ giữ mode mặc định server;
  bộ chọn mode của Owner không đổi cách xác thực callback này.
- Không endpoint nào trả API token hay HMAC secret. `InvoicePaymentView.paymentMode` là trường bổ sung,
  nullable với dữ liệu lịch sử. Mobile và Owner Web vẫn đọc các trường cũ.

Mode được lưu trong `users.business_profile.sepayPaymentMode`; lịch sử tài khoản vẫn append-only.
Kết nối riêng của Owner được lưu trong `users.business_profile.sepayConnections` theo mode.
API Token/HMAC Secret là dữ liệu write-only, được mã hóa bằng ASP.NET Data Protection với purpose
`BHome.SePay.OwnerConnection.v1` + Owner + mode; không lưu plaintext hoặc đưa secrets vào response/log.
`verifiedAt` do server ghi sau khi kiểm tra thành công; client không được tự xác nhận trạng thái kết nối.
Tái sử dụng keyring server hiện có. Mất keyring có thể dẫn đến `KeyUnavailable`;
khôi phục đúng keyring hoặc nhập lại cả hai secret trên Web, không coi kết nối đó là sẵn sàng.
Mã mới gồm `BH` + instance 4 ký tự + `T/L` + 16 ký tự hex ngẫu nhiên (23 ký tự).
DB giữ mã, mode, nghĩa vụ, location và snapshot tài khoản bất biến. Mã cũ `BH` + 8 số vẫn hợp lệ.
Polling, checkpoint, job, HMAC, receiving binding, receipt và idempotency tách theo mode,
độc lập với lựa chọn hiện tại của Owner. Giao dịch có mã của instance khác không tạo receipt.
Trong dual mode, mã thiếu/sai/không phân giải được chỉ lưu sự kiện cần xem xét, không tạo thu tiền.
Partial invoice/overpayment/cọc/activation vẫn đi qua các ledger và quy tắc đã có.

Mã cũ `BH` + 8 số chưa có namespace: người vận hành phải đối chiếu các DB dùng chung ngân hàng,
gán mỗi mã vào `SePay__Test__LegacyPaymentCodes__N` hoặc `SePay__Live__LegacyPaymentCodes__N`
trên **đúng một deployment**, giữ nguyên mode gốc. Không sao chép danh sách giữa Staging/Production.
Trước khi gán, nâng cấp cả hai deployment đang dùng chung ngân hàng; không để deployment flat cũ
tiếp tục tự nhận mã lịch sử. Mã chưa được gán trả `legacy_payment_code_route_required`, không sinh
receipt/phân bổ; sự kiện có thể được đối soát lại sau khi cấu hình đúng. Nếu cùng mã thực sự trùng
giữa hai DB, chỉ một DB được nhận tự động; DB còn lại xử lý bằng quy trình xác minh thủ công hiện có.
Không đổi mã QR đã phát hành để tránh nghĩa vụ cũ bị định tuyến sang nơi khác.

Hóa đơn Final chốt mode khi phát hành. Cọc và khoản thu đầu hợp đồng giữ mode hợp đồng đã chốt;
khoản quyết toán/hoàn tiền giữ truy vết nguồn và snapshot, không bị đổi kênh chỉ vì Owner đổi mode.
Mode ghi nhận kênh và snapshot để định tuyến, đối soát, không tạo một hệ nghiệp vụ hoặc báo cáo riêng.
Giao dịch đã được backend xác minh của cả hai mode áp dụng cùng quy tắc phân bổ, công nợ và báo cáo;
không loại số liệu chỉ vì mode là Test. Mode thanh toán vẫn tách khỏi chế độ ký mô phỏng.
Owner vẫn có thể phân bổ thủ công và bù trừ cọc qua các mode theo quyền và quy tắc nghiệp vụ hiện có;
không thêm rào cản tài chính chỉ dựa vào Test/Live. Webhook/polling tự động vẫn cách ly đúng
Owner, mode, ngân hàng và mã nghĩa vụ khi xác thực, định tuyến và chống ghi nhận trùng.

Migration `20261126000200_SePayPaymentModes` không xóa dữ liệu. Với mã lịch sử vốn không lưu
snapshot, chỉ backfill khi lịch sử cùng mode xác định duy nhất một ngân hàng/số tài khoản.
Lịch sử đổi ngân hàng hoặc nhiều mode cho cùng nghĩa vụ không được tự đoán: QR dừng với
`payment_snapshot_unavailable` hoặc `legacy_payment_mode_ambiguous`; Owner đối chiếu và dùng
quy trình xác minh/phân bổ thủ công hiện có. Không sửa/xóa mã hoặc receipt cũ để vượt kiểm tra.

Migration `20261126000300_SePayOwnerConnections` (`SePayOwnerConnections.sql`) chạy sau `002`.
Bản này thay technical guard để giữ `ownerId` của sự kiện SePay bất biến cùng danh tính/bằng chứng sự kiện;
cập nhật helper báo cáo để phân biệt mô phỏng ký thực sự với kênh thanh toán Test/Live.
Bản này cũng `DROP` trigger/function deposit-mode guard đã được thêm ở `002`, hỗ trợ DB đã áp dụng
`002` trước quyết định bổ sung của user; không xóa ledger, chứng cứ hoặc reset dữ liệu.

## Cấu hình VPS một lần trước khi merge/rollout

1. Giữ mount/volume keyring ASP.NET Data Protection hiện có riêng tư, bền vững qua redeploy/restart, dùng keyring server
   hiện có và sao lưu theo quy trình vận hành. DB và keyring phải được khôi phục tương thích để giải mã
   kết nối Owner. Không đưa keyring hoặc secrets vào Git, image hay biến build Vite/Expo.
2. Chọn `SePay__InstanceCode` riêng, cố định cho từng DB/deployment chia sẻ tài khoản ngân hàng,
   ví dụ Staging `STG1`, Production `PRD1`. Không đổi khi redeploy, không sao chép DB chứa nghĩa vụ
   đang thu tiền sang deployment khác. `SePay__Mode` chỉ là mặc định ban đầu và route webhook cũ.
   Nếu còn dùng route cũ, giữ đúng mode trước nâng cấp. Hai deployment dùng chung ngân hàng ở cùng
   mode phải cùng được nâng cấp sang dual profile; guard từ chối ghép với deployment flat chưa có namespace.
3. Owner mở **Thu tiền & công nợ → Tài khoản nhận tiền**, chọn từng mode, nhập ngân hàng và số tài khoản
   đã liên kết trên dashboard SePay tương ứng, API Token và HMAC Secret; xác nhận, lưu và kiểm tra kết nối.
   Token và secret Test/Live phải riêng; giữ binding và credentials cũ khi còn nghĩa vụ phải thu.
   Chuyển mode không cần sửa cấu hình server, restart hoặc redeploy.
4. Cấu hình `.env` cũ và [compose.sepay-modes.example.yml](../../deploy/vps/compose.sepay-modes.example.yml)
   chỉ là fallback tương thích cho cấu hình server, không phải điều kiện để Owner cấu hình Test/Live trên Web.
   Nếu tiếp tục dùng fallback, tạo file ngoài Git từ [.env.sepay-modes.example](../../.env.sepay-modes.example),
   giới hạn quyền đọc (`chmod 600`), giữ secrets riêng cho mỗi mode/deployment và kiểm tra overlay riêng tư.
   Rollout image/migration là công việc vận hành một lần; không chạy seed/reset DB.
5. Owner dùng callback riêng theo Owner/mode hiển thị trên Web để cấu hình webhook trên dashboard SePay
   tương ứng của **từng** host API; dùng HMAC secret đã lưu, HMAC-SHA256, JSON,
   giao dịch tiền vào, bật retry. TLS và proxy phải chuyển nguyên body cùng các header
   `X-SePay-Timestamp`, `X-SePay-Signature`. Live chọn tài khoản ngân hàng thật đã liên kết.
   BHOME ký theo `{timestamp}.{raw_body}` và từ chối chữ ký lệch mode/hết hạn.
   [Tài liệu HMAC SePay](https://developer.sepay.vn/vi/sepay-webhooks/xac-thuc).
6. Trong cấu trúc mã thanh toán SePay, bật tiền tố `BH`, loại **Số và chữ**,
   độ dài hậu tố tối thiểu **8**, tối đa **21** để nhận cả mã cũ và mới.
   Đặt mẫu này trước mẫu BH cũ có hậu tố chỉ 8 số, tránh bóc tách thiếu mã.
   [Tài liệu cấu trúc mã SePay](https://developer.sepay.vn/vi/sepay-webhooks/cau-hinh-ma-thanh-toan).
7. Sau rollout do người có thẩm quyền thực hiện, kiểm tra luồng cấu hình Web cho cả hai mode.
   **Kiểm tra kết nối** gọi GET SePay v2 `bank-accounts` với `active=1` ở kênh tương ứng, đối chiếu
   chính xác `bank_bin` và `account_number`, kiểm tra tài khoản đang active, không chuyển tiền.
   Chỉ server ghi `verifiedAt` khi kiểm tra thành công. Cấu hình lưu thành công chưa phải bằng chứng đã nhận tiền;
   kiểm tra kết nối cũng không thay thế xác thực webhook hoặc xác minh một giao dịch cụ thể.
   Kết nối/tài khoản chưa hợp lệ không được coi là sẵn sàng phát QR nhận tiền qua SePay.
   Không dùng ký mô phỏng làm bằng chứng ký Live; không bật demo clock cho nghiệp vụ tiền thật.

Migration phải chạy trước khi khởi động image mới, sau backup và kiểm tra đúng DB. Với DB hiện có
đang ở baseline `20261126000100_SharedInvoiceDepositOffsets`, dùng quy trình EF migration đã được
phê duyệt của dự án, áp dụng lần lượt `20261126000200_SePayPaymentModes` rồi
`20261126000300_SePayOwnerConnections`. Nếu DB đã áp dụng `002`, chỉ nâng cấp tiếp `003`.
Nếu VPS đang quản lý schema bằng SQL Compact24 thay vì EF history, người vận hành áp dụng
hai bản SQL theo cùng thứ tự dưới đây (đổi placeholder, không chạy seed). Mỗi lệnh dừng khi có lỗi
và chạy trong một transaction; chỉ chạy lệnh thứ hai sau khi lệnh thứ nhất thành công.
**Nếu `002` đã được áp dụng thì bỏ qua lệnh đầu, chỉ chạy `SePayOwnerConnections.sql`.**

```bash
docker exec -i <postgres-container> psql -U <db-user> -d <db-name> \
  -v ON_ERROR_STOP=1 --single-transaction \
  < src/backend/BHome.Infrastructure/Persistence/Compact24/Migrations/SePayPaymentModes.sql
```

```bash
docker exec -i <postgres-container> psql -U <db-user> -d <db-name> \
  -v ON_ERROR_STOP=1 --single-transaction \
  < src/backend/BHome.Infrastructure/Persistence/Compact24/Migrations/SePayOwnerConnections.sql
```

Không chạy lại toàn bộ file baseline để nâng cấp DB. Kiểm tra lịch sử mã và tài khoản có snapshot
duy nhất; trường hợp mơ hồ giữ nguyên và đưa vào xem xét thủ công. Danh sách routing mã cũ cũng là
cấu hình server một lần khi nâng cấp, không phải điều kiện cấp quyền cho Owner chuyển Test/Live.

Truy vấn chỉ đọc dưới đây liệt kê mã cũ cần đối chiếu giữa các DB trước khi gán routing:

```sql
SELECT task_data->'state'->>'mode' AS payment_mode,
       task_data->'state'->>'code' AS payment_code,
       task_data->'state'->>'kind' AS obligation_kind,
       task_data->'state'->>'obligationId' AS obligation_id
FROM operational_tasks
WHERE task_data->>'recordType' = 'PaymentCodeV1'
  AND task_data->'state'->>'code' ~ '^BH[0-9]{8}$'
ORDER BY payment_mode, payment_code;
```

Kiểm tra kết nối **chỉ đọc** (operator tự chạy với file cấu hình riêng):

```powershell
./scripts/Test-SePayConnection.ps1 -EnvironmentFile <private-file> -Mode Test
./scripts/Test-SePayConnection.ps1 -EnvironmentFile <private-file> -Mode Live
./scripts/Test-SePayWebhook.ps1 -PublicBaseUrl https://<api-host>/ -Mode Test
./scripts/Test-SePayWebhook.ps1 -PublicBaseUrl https://<api-host>/ -Mode Live
```

Connection check chỉ GET tài khoản/giao dịch, không chuyển tiền. Webhook check chỉ gửi payload
không ký và yêu cầu bị từ chối. SePay Test end-to-end có thể dùng giao dịch mô phỏng trên dashboard;
chấp nhận Live bằng giao dịch thật là bước riêng do Owner thực hiện và xác nhận, không tự động chạy trong CI.
Giữ token cả hai mode và polling hoạt động khi còn nghĩa vụ cũ, kể cả khi mode mới đã được chọn.

## Kết quả kiểm tra local — 26/11/2026

- Backend Release build: 0 warning, 0 error; `dotnet format --verify-no-changes` pass.
  Bốn assembly unit test: 1.179 pass. Integration: 1.554 pass, 32 test opt-in có sẵn chưa chạy,
  0 fail; không thêm skip hoặc nới validation. Chạy đủ discovery trong hai shard rời nhau trên
  PostgreSQL 16 dùng riêng cho kiểm thử; tổng mức song song là 2, giữ nguyên cấu hình CI trong repo.
- `Verify-BackendTrx.py` pass với discovery hiện tại và inventory đã cập nhật từ các báo cáo thực thi;
  giữ tất cả identity cũ ngoài 13 trường hợp thay thế được đối chiếu theo quyết định Test/Live mới.
  `Verify-StagingRegressions.py`: 21 nhóm regression bắt buộc pass.
- Node 22: Owner Web 1.074 pass; Mobile 1.792 pass; Public Web 11 unit + 16 browser pass.
  Các bộ frontend không fail/skip. Lint, Prettier, shared client build, Owner/Public build,
  Mobile typecheck và Expo web export pass.
- Deployment: 100 Python + 7 email preflight + 25 Node test pass; PowerShell SePay scripts,
  Compose config và cú pháp bash pass. Build image API, Owner Web và Public Web pass, không push image.
- Kiểm tra giao diện desktop và mobile 390px không có lỗi trang hoặc tràn ngang.
  Kiểm thử dùng dữ liệu tổng hợp; provider boundary dùng HTTP phục vụ riêng cho test, ứng dụng và PostgreSQL chạy thật.
  Chưa xác nhận giao dịch ngân hàng Live thật; không tự chuyển tiền. GitHub Actions từ xa chưa chạy vì chưa push.

Báo cáo TRX/discovery local: `%TEMP%/bhome-owner-sepay-completed-trx` và
`%TEMP%/bhome-owner-sepay-completed-discovery`; báo cáo frontend/deployment:
`%TEMP%/bhome-mode-ci-artifacts/owner-config-*`. Các artifact này không được commit.
