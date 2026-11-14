# Mobile readiness khi database đi trước nhánh code — 14/11/2026

Yêu cầu: sửa `npm.cmd run mobile` dừng ở `/health/ready` HTTP 503, kiểm tra phần code mới và commit. Nhánh bắt đầu: `member/QHuy`, commit `0ed52701`, working tree sạch.

Truy vết: NFR availability/data integrity; BF-03/04/06, UC-14..16/22..23, GBR-01/02/10/18. Quyết định trong phiên này: người dùng chọn **tích hợp backend MainInitialPayment từ nhánh Long và chạy test liên quan**. Nguồn triển khai: `origin/member/Long` tại `2e5020e1`, migration và bản sửa `8c2502fa`; không lấy toàn bộ thay đổi nhánh hoặc thay quy trình ký/phân quyền Owner.

Probe read-only xác nhận database development dùng chung đã có 11 migration, gồm `20261114000100_MainInitialPayment`; checkout ban đầu chỉ biết 10. Schema có thêm `payment_allocations.target_initial_contract_id` và hai guard thanh toán đã thay đổi. TLS/live hoạt động, API bảo vệ trả 401 đúng; strict schema verifier trả false nên readiness là 503. Không phải lỗi CA hay Expo, không có migration thiếu cần chạy lại.

Tích hợp migration, schema reference, DTO/controller, ledger, QR/payment-code registration, webhook reconciliation, EF mapping và activation guard từ nhánh Long. Chỉ thêm dependency cần thiết cho MainInitialPayment; giữ các bản sửa identity/document/Owner/Mobile của nhánh hiện tại. Không hạ/reset database, không sửa migration history hoặc dữ liệu dùng chung.

API tái sử dụng từ nhánh Long:

- `GET /api/v1/contracts/{id}/initial-payment`: trạng thái thanh toán ban đầu theo hợp đồng, sau kiểm tra quyền hiện hữu.
- `POST /api/v1/contracts/{id}/initial-payment/transfer-instructions`: hướng dẫn/QR cho khoản còn phải trả, yêu cầu ký hoàn tất và snapshot hợp lệ.
- Webhook SePay đã xác thực phân bổ một receipt đúng tổng thành cọc và tiền thuê/phí; thiếu/thừa tiền giữ manual review. Callback lặp không tạo hiệu ứng tài chính trùng. Activation vẫn do backend kiểm tra và Owner thực hiện.

`Test-Database.ps1` build probe trong output riêng để không ghi đè DLL Debug đang chạy. Probe in ID migration chưa có trong checkout và hướng dẫn đồng bộ code khi schema đi trước. Mobile launcher gợi ý probe read-only đúng environment file, phân biệt Neon và local, giữ strict TLS/readiness.

Acceptance: schema chuẩn và nâng baseline bảo toàn dữ liệu; schema tương lai chưa hỗ trợ phải bị từ chối và nêu rõ ID; function guard bị sửa phải bị từ chối; QR chỉ sau ký/đúng quyền; exact/partial/excess/duplicate callback; deposit đủ nhưng tiền thuê/phí chưa đủ phải chặn activation. Kiểm tra bằng PostgreSQL disposable và fixture tổng hợp. Database development chỉ kiểm tra metadata, không dùng để thử giao dịch.

## Kết quả thực thi

Đối chiếu `.github/workflows/ci.yml`, chỉ chạy build và nhóm kiểm tra liên quan tới code mới, không chạy lại toàn bộ frontend/DigitalSigning đã được kiểm tra ở commit trước. Đây là kiểm tra local trên Windows, không phải GitHub Actions.

| Kiểm tra                                                                                                 | Kết quả                                                                                               |
| -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Build `src/backend/BHome.sln`, Release, output riêng `.tools/mobile-readiness-build`                     | PASS, 0 warning/error                                                                                 |
| Application unit: `Contracts.ContractServiceTests`, `PaymentsDebt.SePaySecurityTests`, CI runsettings    | PASS 72, 0 fail/skip                                                                                  |
| Integration: schema/migration/SePay/MainDraft/document/identity/lifecycle/API foundation, CI runsettings | PASS 101, 0 fail/skip                                                                                 |
| Mobile `expoStartup.test.ts`, `mobileApiProbe.test.ts`, Node 22                                          | PASS 31                                                                                               |
| `dotnet format ... --verify-no-changes --no-restore --include` các file C# đổi/thêm                      | PASS                                                                                                  |
| Prettier tài liệu mới; PowerShell parser hai script sửa; `git diff --check`                              | PASS                                                                                                  |
| `scripts/Test-Database.ps1` trên development, read-only                                                  | PASS: 11 applied / 0 pending / 0 unknown, RuntimeEFQuery PASS, tenant_records_read=0                  |
| API sau restart đúng phiên Visual Studio bằng computer-use                                               | live 200, ready **503 → 200**, anonymous contracts 401; CA/hostname sai vẫn bị từ chối                |
| `npm.cmd run mobile -- --port 8082`                                                                      | PASS tới Metro Running và status/iOS manifest OK; đã dừng riêng Metro kiểm thử, giữ API Visual Studio |

Integration dùng PostgreSQL 16 disposable với credential ngẫu nhiên, MinIO/LibreOffice test containers hiện có và dữ liệu tổng hợp. Ca mới kiểm tra thiếu service/thiếu tiền phải chặn activation, thanh toán đủ vẫn chờ Owner activation, không cấp quyền đọc/issue QR cho Tenant khác, thiếu/thừa tiền không phân bổ, cùng callback không ghi tiền hai lần. Nâng baseline kiểm tra bảo toàn bản ghi; schema tương lai và function guard bị sửa vẫn bị từ chối.

Lượt integration đầu: 99 PASS / 2 FAIL. Một phép so sánh trước/sau migration còn tính cột nullable mới, và một ca ký cũ thử activation trước khi trả tiền thuê ban đầu. Đã cập nhật fixture/so sánh tương ứng và chạy lại cả nhóm 101 thành công; giữ nguyên các kiểm tra identity, phân quyền và bảo toàn dữ liệu. Build lần đầu dùng `--no-restore` với output riêng mới nên NETSDK1004; build có restore sau đó PASS. Filter Mobile lần đầu sai đường dẫn nên không tìm thấy test; chạy lại đúng `../../tests/mobile/...` PASS 31. Không tính các lượt đó là PASS.

Log/TRX local ở `.tools/mobile-readiness-20261114/`, được Git bỏ qua. Postman CLI 1.80.0 chưa có workspace/account; không thay thiết lập Postman. Nhóm test này gửi webhook tổng hợp qua HTTP vào application, không gọi ngân hàng thật. Chưa xác minh thiết bị iPhone thật, không thay giao diện Mobile/Owner hoặc xác nhận toàn bộ tính năng Main mới đã có UI. Không áp migration hay ghi dữ liệu nghiệp vụ lên development dùng chung trong phiên sửa này.
