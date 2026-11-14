# SePay integration implementation

## Scope and acceptance

BF-06, FE-05, UC-22/23/25, GBR-10/18, DBR-08, JOB-03 and API-01 apply. The explicit implementation request dated 12/11/2026 authorizes SePay, automatic provider verification and the BH plus eight numeric digits format. Existing partial/excess policies remain documented in docs/api/PAYMENTS.md. The SRS UC-22 automatic/manual branches and JOB-03 retry requirements were checked during the source audit.

Implementation stages have separate commits with English subjects and descriptions. Acceptance covers authenticated raw-body ingestion, wrong account/direction, atomic duplicate handling, unknown payer, exact/partial/excess, historical references, durable retry, isolated PostgreSQL migrations and client compatibility.

Provider contract sources are the official SePay webhook authentication, Test Mode webhook and API v2 transaction documentation. HMAC signs timestamp plus a dot plus the original bytes. Transaction timestamps without an offset are interpreted in Asia/Ho_Chi_Minh.

The registry reuses operational_tasks technical records. Cross-obligation uniqueness requires database indexes and immutable registry guards because a JSONB array inside each Invoice cannot enforce uniqueness across Invoice and Contract records. No financial identity GUID changes are required.

## Ledger and migration decisions

Migration 20261112000100_SePayIntegration adds unique indexes and immutable technical-record guards while retaining 24 tables. Payment codes are permanent COMMAND records with one code per mode, kind and obligation. Global source-key uniqueness prevents reuse across modes and obligation types. Existing legacy reference functions remain available for manual reconciliation. Automatic matching accepts only registered BH codes and rejects ambiguous content.

Provider receipts use the existing payments table with AUTO verification, durable SePay inbox evidence and a null human verifier. The allocation creator column becomes nullable with a trigger permitting null only for a verified SePay source. Existing DTO GUID fields represent this absent human actor as Guid.Empty. Source labels identify SePayTest or SePayLive. Payer remains unassigned until separately verified. Contract deposit allocation preserves budget, expiry, Room conflict and Holding price-lock rules without activating a Contract.

SePay webhook numeric IDs and API v2 UUIDs can differ. Inbox identity is scoped by mode, gateway, receiving account and provider ID. Canonical receipt identity additionally uses a digest of mode, gateway, account and bank reference, so webhook and API backfill cannot credit the same bank reference twice. Conflicting amounts/timestamps/content are rejected.

Manual receipts lack provider account scope. A provider callback that encounters an existing manual bank reference stays in the durable inbox for Owner review. Manual registration that encounters an existing provider reference directs the Owner to the existing receipt. Native allocation guards also block a second effect across these pathways, including direct Contract deposit receipts. Functional reference indexes keep these checks bounded. This guard extends the unreleased SePay migration; no working or production database was migrated.

The webhook durably commits inbox plus a queued reconciliation command before processing money. A processing failure rolls money back while retaining the inbox for JOB-03. Terminal unmatched and ignored events have explicit reasons. Owner can inspect safe event summaries through GET /api/v1/integrations/sepay/events and receipt evidence through existing payment APIs.

## JOB-03 and provider HTTP verification

SePay reconciliation jobs use the existing PostgreSQL worker lease, four-attempt bounded backoff and failure records. Handler names include Test or Live. Unmatched codes are terminal manual-review decisions. Pending events whose jobs exhaust retries appear as ManualReview with sepay_technical_retry_exhausted in the Owner event API. A provider redelivery can recover the retained inbox after the underlying issue is repaired.

SePayAutomationWorker schedules only SePay work when Jobs.Enabled is false. When the general worker is enabled, it processes the same registered handlers. This allows webhook recovery without enabling unrelated billing or Contract jobs. Optional API polling requires ApiToken and uses the official sandbox or Live v2 host, disabled redirects and bounded request/body timeouts.

Polling requests one ascending page of at most 100 records per job. The durable cursor retains sinceId and candidateId while page increases. Only the final page advances sinceId and synchronizedAt. A separate PostgreSQL synchronization lock prevents concurrent checkpoint races. Each received transaction commits through the existing inbox and ledger; a failed page is safe to repeat.

The Postman CLI was unsigned-in, so owner-workspace mock discovery was unavailable. Orbit returned unrelated providers; the implementation follows official SePay documentation. The committed local contract mock and simulation exercise SePayApiClient over actual HTTP using synthetic credentials. Local HTTP tests additionally cover 401, 429, 500, malformed responses and body timeout. Provider account acceptance and public connectivity require external configuration.

## Tệp và trách nhiệm đã thay đổi

| Khu vực        | Tệp chính và trách nhiệm                                                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API            | SePayController.Webhook xác thực raw body và ACK; Events chỉ Owner; DevelopmentEnvironmentFile và Start-Api.ps1 nhận nhóm biến SePay                                      |
| Application    | SePayOptions, SePayWebhookSecurity, SePayService.ReceiveAsync/ReconcileAsync, SePayContracts và SePayPolling định nghĩa cấu hình, xác thực và luồng provider              |
| Ledger hiện có | PaymentService, PaymentContracts, DepositReceiptAllocation, TransferInstructionsService và ContractHoldingService giữ manual reference, BH code, isolation và quy tắc cọc |
| Infrastructure | PaymentCodeRegistry, SePayRepository, SePayApiClient, SePayJobs, SePayAutomationWorker và PaymentRepository lưu registry/inbox/receipt, HTTP và JOB-03                    |
| Composition    | DependencyInjection đăng ký typed options, HTTP client, repository, service và handler; PostgresJobWorker giữ entry point cũ và thêm bộ lọc riêng cho SePay               |
| Database       | 20261112000100_SePayIntegration, SePayIntegration.sql, Compact24DbContextModelSnapshot, Compact24Records, Compact24DomainWriter, Compact24Schema và BHOME_24_TABLES.sql   |
| Client         | client-core/payments.ts thêm client event list; PaymentManagementPage và SePayEventsPanel hiển thị review và mở receipt; Mobile giữ API hiện có                           |
| Kiểm thử       | SePaySecurityTests, SePayApiClientTests, SePayIntegrationTests, SePayEventsPanel.test; cập nhật migration/composition và Payments.test cho hành vi mới                    |
| Tài liệu       | .env.example, docs/api/SEPAY.md, PAYMENTS.md, API_IMPLEMENTATION_STATUS.md, PAYMENT_WORKFLOW_GUIDE.md và contract simulation trong postman/                               |

## Lệnh kiểm chứng ngày 12/11/2026

Môi trường chạy là Windows, .NET SDK 8.0.427, Node 22.23.4 và PostgreSQL 16 trong container dùng dữ liệu tổng hợp. BHOME_COMPACT24_TEST_ADMIN trỏ PostgreSQL dùng riêng cho fixture; BHOME_COMPACT24_QUERY_LOG trỏ statement log đã tắt bind parameters. Không dùng connection string làm việc hoặc production. Test tạo/xóa database riêng theo convention hiện có.

```powershell
dotnet restore src/backend/BHome.sln
dotnet build src/backend/BHome.sln -c Release --no-restore
docker build -f deploy/docker/Minio.Dockerfile -t bhome/minio-local:2025-10-15 .
docker build -f deploy/docker/ContractConverter.Dockerfile -t bhome/contract-converter:local .
dotnet test src/backend/BHome.sln -c Release --no-build `
  --settings tests/backend/ci.runsettings --logger trx -m:1
dotnet format src/backend/BHome.sln --verify-no-changes --no-restore
dotnet test src/digital-signing/tests/BHome.DigitalSigning.UnitTests/BHome.DigitalSigning.UnitTests.csproj `
  -c Release --settings tests/backend/ci.runsettings --logger trx

npm.cmd ci --no-fund --no-audit
npm.cmd run lint
npm.cmd run typecheck --workspace ./src/mobile
npm.cmd test
npm.cmd run build
# Từ thư mục src/mobile, EXPO_NO_DOTENV=1 và API URL tổng hợp:
npx.cmd --no-install expo export --platform web --max-workers 2 --output-dir dist
# Trở lại repository root:
npm.cmd run format:check
docker compose --env-file .env.example config --quiet
```

Hai lỗi hồi quy đã được sửa trong quá trình kiểm tra: test receipt còn kỳ vọng tiêu đề hoàn tiền cũ; test phục hồi billing dùng reflection yêu cầu chữ ký ProcessOneAsync(CancellationToken) ban đầu. Entry point này đã được giữ lại, bộ lọc SePay chuyển sang ProcessAllowedAsync. Các test liên quan chạy lại đạt 23/23, không skip. Hai test điều hướng timeout khi chạy đồng thời với bộ OCR; lần chạy frontend riêng sau đó đạt toàn bộ 340 test Owner Web và 885 test Mobile, không sửa timeout hoặc bỏ test.

## Kết quả cuối cùng

| Kiểm tra đã thực thi                             | Kết quả                                                               |
| ------------------------------------------------ | --------------------------------------------------------------------- |
| Restore và build solution Release                | PASS, 0 warning, 0 error khi build                                    |
| Application Unit Tests                           | 439 passed, 0 failed, 0 skipped                                       |
| Domain Unit Tests                                | 106 passed, 0 failed, 0 skipped                                       |
| Integration toàn solution                        | 889 passed, 0 failed, 20 skipped, 10 phút 51 giây                     |
| Riêng SePay trong các bộ trên                    | 12 security unit + 19 PostgreSQL/HTTP integration passed, 0 skipped   |
| Migration/runtime/independence regressions       | PASS trong lần chạy toàn bộ                                           |
| Digital signing Unit Tests                       | 41 passed, 0 failed, 0 skipped                                        |
| Owner Web / Mobile                               | 340 / 885 passed, 0 failed                                            |
| npm ci, ESLint, Mobile typecheck, frontend build | PASS                                                                  |
| Expo web export với Node 22                      | PASS                                                                  |
| dotnet format verify, Prettier check             | PASS                                                                  |
| Build image MinIO và Contract Converter          | PASS                                                                  |
| docker compose với .env.example                  | PASS                                                                  |
| SePayApiClient qua Postman local simulation      | PASS, quan sát được GET /v2/transactions và response được adapter đọc |

Không cộng các lượt chạy focused vào số test toàn bộ để tránh đếm trùng. 20 skipped gồm 19 test OCR cần opt-in/model và 1 browser acceptance hoàn tiền cần opt-in; đây không phải test SePay bị bỏ qua. Không đo coverage, hiệu năng, tải hoặc acceptance ngân hàng thực trong tác vụ này. Log/TRX nằm trong .tools/sepay-validation và TestResults được Git ignore; không commit output giao dịch hoặc raw payload.

Các giai đoạn đã commit riêng với subject/body tiếng Anh: 796ba3b (cấu hình/HMAC), 9797889 (registry/ledger), efca05c (JOB-03/polling), 0fa85dd (chống trùng manual/provider), c65777a (tương thích worker), e947848 (Owner UI và hướng dẫn). Commit tài liệu kiểm chứng được tạo sau các giai đoạn trên.

Workflow .github/workflows/ci.yml hiện kích hoạt qua pull_request tới nhánh được cấu hình hoặc workflow_dispatch. Kiểm chứng local không thay thế kết quả runner Ubuntu/GitHub. Chưa push, mở PR hoặc chạy remote CI trong tác vụ này. Dashboard, secret/token, public HTTPS và một giao dịch Test Mode từ tài khoản SePay thật còn cần cấu hình và acceptance theo docs/api/SEPAY.md.

## BHOME SEPAY IMPLEMENTATION HANDOFF

```text
Branch: member/QHuy. Implementation committed in separate stages. No push.
Webhook: POST /api/v1/integrations/sepay/webhook
Local profile: https://localhost:7240/api/v1/integrations/sepay/webhook
Public hosting: UNKNOWN / NOT CONFIGURED in this task.
Authentication: {timestamp}.{raw_body} HMAC-SHA256; X-SePay-Timestamp; X-SePay-Signature.
Success: HTTP 200 {"success":true} after durable ingestion and reconciliation classification.
Code: BH plus 8 numeric digits, permanent database registry.
Test API: https://userapi-sandbox.sepay.vn/v2
Config: SePay__Enabled, SePay__Mode, SePay__ApiBaseUrl, SePay__WebhookSecret,
SePay__WebhookPath, SePay__PaymentCodePrefix, SePay__RequestTimeoutSeconds,
SePay__SignatureToleranceSeconds, SePay__PollIntervalSeconds;
SePay__ApiToken optional for polling;
SePay__ReceivingAccounts__0__LocationId, SePay__ReceivingAccounts__0__BankIdentifier,
SePay__ReceivingAccounts__0__Gateway, SePay__ReceivingAccounts__0__AccountNumber
(repeat with indexes 1, 2, ...).
Database: migration 20261112000100_SePayIntegration tested on isolated PostgreSQL only.
Status: HMAC, canonical ledger, registry, partial/excess, retry, polling and Owner review implemented.
Tests: Backend 1434 passed / 20 opt-in skipped / 0 failed; signing 41 passed;
Owner Web 340 passed; Mobile 885 passed; local CI preflight checks passed.
Next: configure private Test Mode credentials/account, apply migration on chosen test DB,
start API, configure public HTTPS and Dashboard, simulate one actual SePay Test Mode payment,
verify Tenant status and replay idempotency. See docs/api/SEPAY.md.
Remote GitHub CI and actual SePay delivery: NOT RUN.
```
