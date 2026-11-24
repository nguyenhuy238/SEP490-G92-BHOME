# Đồng bộ develop và giữ hotfix demo Staging — 24/11/2026

Người dùng yêu cầu pull `develop` về nhánh hiện tại, bảo toàn các sửa lỗi vừa dùng để demo Staging. Phạm vi là đồng bộ source; không thay chính sách nghiệp vụ hoặc triển khai lại server. Đối chiếu `AGENTS.md`, lịch sử Git, các báo cáo demo cùng ngày và source/test thực tế. Các hotfix liên quan BF-04/UC-17, BF-05/UC-20/21, BF-06/UC-22, GBR-01/02/07/10/18.

## Kết quả Git

- Nhánh giữ nguyên `member/QHuy`.
- Fetch `origin/develop`, cập nhật fast-forward từ `0909e9030e2a630d0ef00b4ea70867ab428e5a2c` tới `47bcbc4c1d61a813364962f02f46d8bf9f43b74d` (6 commit mới, gồm PR #163 và sửa CI).
- Sau cập nhật, `HEAD...origin/develop` là `0 0`. Không tạo commit mới, push hoặc merge vào nhánh dùng chung.
- Trước cập nhật đã sao lưu 57 file thay đổi/chưa theo dõi, patch và SHA-256 trong `.tools/develop-sync-20261124/`; giữ thêm stash `pre-develop-sync staging demo fixes 2026-11-24`. Không drop stash sau khi áp dụng lại.
- 55/57 file được khôi phục nguyên từng byte. Hai file kết hợp với develop là `ContractHandoverSigningService.cs` và `Compact24MoveInSignedWorkflowTests.cs`. Không mất file; manifest đối chiếu ở `preservation-check.json`.
- Có một file test conflict khi áp dụng stash. Đã giữ seed danh tính và key test mới từ develop, tái sử dụng `withPartyIdentity:true`; phần test hotfix chỉ bổ sung chế độ hợp đồng nội bộ và các ca session/OTP. Không tạo hai bộ fixture danh tính chồng nhau.
- Không còn unmerged path hoặc conflict marker. Các sửa lỗi cá nhân tiếp tục ở working tree, chưa commit/stage, như trước khi pull.

## Các sửa lỗi demo được giữ

- Mở mẫu hợp đồng, bỏ cảnh báo theo yêu cầu trước đó, giữ kiểm tra review/hash và tài liệu đã ký bất biến.
- Nhận diện đúng tài khoản Test/SePay và chế độ thanh toán ban đầu trên Staging.
- Tenant liên kết với hợp đồng nội bộ ký bàn giao bằng đúng `TenantUserId`; giữ kiểm tra quyền và PDF hai chữ ký.
- Opt-in chạy thử lập hóa đơn trên Staging bằng `BillingAutomation:ManualActionsEnabled`, độc lập với worker.
- Hướng dẫn thanh toán hóa đơn chấp nhận `AllowSandboxReceivingAccounts`, cấp QR/BH từ đúng tài khoản Owner; không ghi nhận đã thanh toán khi đọc hướng dẫn.

Chi tiết từng sửa lỗi nằm trong các báo cáo `CONTRACT_TEMPLATE_DEMO`, `INITIAL_RECEIVING_ACCOUNT_FIX`, `HANDOVER_TENANT_403_FIX`, `BILLING_MANUAL_STAGING_DEMO` và `INVOICE_RECEIVING_ACCOUNT_FIX` cùng ngày.

## Kiểm chứng sau pull

| Kiểm tra                                                                                                                                                                   | Kết quả                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Infrastructure unit: HoldingTestScope, BillingAutomationRuntime, PaymentRuntimeMode                                                                                        | 24 PASS, 0 skip                                                                                         |
| PostgreSQL 16 disposable: ký session/OTP trên hợp đồng thường/nội bộ, Owner receiving account, Main initial payment, invoice QR/BH, isolation/receipt mode, manual billing | 15 PASS, 0 skip                                                                                         |
| Owner Web: MainDraftReleasePanel, OwnerHandoverDraftPanel, Handovers, Automation                                                                                           | 76 PASS                                                                                                 |
| Mobile: rental/main initial/handover/contract sections/meter, signing UI, staging proxy, Expo startup                                                                      | 184 PASS                                                                                                |
| API Release build `dotnet build src/backend/BHome.Api/BHome.Api.csproj -c Release --no-restore`                                                                            | PASS, 0 warning/error                                                                                   |
| Mobile và Owner Web typecheck                                                                                                                                              | PASS                                                                                                    |
| Mobile lint                                                                                                                                                                | PASS                                                                                                    |
| Owner Web lint                                                                                                                                                             | Exit 0; còn một warning có sẵn tại `DigitalSigningPage.test.tsx:103` về biến `navigate` ngoài component |
| C# whitespace verify cho hai file đã kết hợp, `git diff --check`                                                                                                           | PASS                                                                                                    |
| Hash/đầy đủ các file đã sao lưu                                                                                                                                            | 55 nguyên byte, 2 kết hợp có chủ đích, 0 thiếu                                                          |

Evidence ở `.tools/develop-sync-20261124/` (TRX và logs). Đây là bộ kiểm tra chọn lọc sau đồng bộ; không phải kết quả CI đầy đủ hoặc nghiệm thu toàn hệ thống. Không sửa warning ngoài phạm vi chỉ để làm báo cáo sạch.

## Staging và lần triển khai tiếp theo

Kiểm tra chỉ đọc xác nhận Staging vẫn dùng API `bhome/invoice-receiving-api:20261124` và Owner Web `bhome/pr163-owner:demo-static-fixed-20261124`. Lượt pull không recreate container, thay config hoặc chạy migration/seed; không tạo payment/hóa đơn/chữ ký.

Cờ demo thực tế `BillingAutomation__ManualActionsEnabled=true` đang nằm trong release override private trên VPS; file `.env.staging.example` trong Git cố ý mặc định false. Khi triển khai tiếp cần giữ cờ này nếu vẫn demo thủ công, đồng thời giữ `Jobs__Enabled=false`, `BillingAutomation__AutomaticJobsEnabled=false`, SePay Test và các khóa/DB/storage hiện hành. Pull source không đồng bộ hay ghi đè cấu hình private này.

Source sau đồng bộ đã chứa các hotfix nhưng vẫn chưa commit/push. Một release CI chỉ lấy commit develop sẽ chưa có các phần working tree; cần đưa những thay đổi đó qua quy trình review/commit được ủy quyền trước khi thay thế bản demo thủ công.
