# Kiểm tra và hoàn thiện tài chính Owner — 25/11/2026

## Phạm vi và nguồn

Yêu cầu ngày 25/11/2026: hoàn thiện phần triển khai đang dở theo tài liệu người dùng “BHOME – HOÀN THIỆN MODULE TÀI CHÍNH, DOANH THU, CHI PHÍ VÀ PHÂN TÍCH HIỆU QUẢ KINH DOANH CHO OWNER”. Đối chiếu bản SRS thực có tại `docs/reports/BHome_Report-3_Software Requirement Specification.docx`, FE-08/UC-31–34, GBR-01/02/15/16/18; các nguồn phụ BF-05/06/07, UC-20–30. Giữ ba tab tại `/reports`, dùng chung API với tài chính từng cơ sở; không thêm module hay menu.

Baseline: branch `member/QHuy`, HEAD `b6d4d84bcb74f0d49333b2416741b89d345b0938`. Workspace ban đầu đã có nhiều file modified/untracked thuộc module này. Phần đó là triển khai có sẵn của người dùng, không phải toàn bộ được tạo trong lượt hoàn thiện này. Không đổi branch, commit, push, tạo PR hay triển khai staging/production.

SRS còn OQ-06 về đầu vào lương. Yêu cầu bổ sung của người dùng xác định dùng hợp đồng nhân viên, Owner xác nhận số tiền và phân bổ bằng tổng khoản chi; không suy ra payroll, chia đều hoặc công thức lương theo ngày. Yêu cầu khấu hao là quản trị nội bộ, không phải chuẩn kế toán/thuế.

## Đối chiếu trước khi sửa

| Chức năng                   | Frontend / backend / dữ liệu hiện có                                                                                                       | Đánh giá và phần cần kiểm tra                                                                                                                    | Files chính / nghiệm thu                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Thu tiền, doanh thu, nợ     | Reports, FinanceHome, LocationFinanceWorkspace; FinancialReportService/Repository; invoices, adjustments, payment allocations, settlements | Đã có phần lớn. Phải phân biệt kỳ hóa đơn, ngày ngân hàng, ngày phân bổ; cọc và hoàn tiền riêng, không đếm trùng                                 | FinancialReportCashReceipts/BankReceipts/Sources; acceptance 100/96/30/28/15 triệu; đối chiếu tổng và nguồn |
| Thực chi                    | ExpenseFinanceActions, ExpensePaymentService/Repository; lịch sử JSONB trên expenses                                                       | Đã có. Kiểm tra thanh toán một phần, idempotency, version và xác nhận đúng thông tin đang hiển thị                                               | ExpenseFinanceActions tests, Compact24FinanceManagementTests                                                |
| Chi phí nhân viên           | StaffCostDialog/Service/Repository; hợp đồng và phân công Staff; expenses theo nguồn staff-cost                                            | Đã có. Kiểm tra phạm vi cơ sở, số tiền phân bổ, không sinh trùng kỳ/loại và giữ truy vết hợp đồng                                                | StaffCostAcceptance, StaffCostDialog tests                                                                  |
| Chi phí định kỳ             | RecurringExpenseService/Job; quy tắc phiên bản trong operational_tasks và expenses có source_key                                           | Đã có. Kiểm tra chạy lại/đồng thời, lịch tháng ngắn và giữ giá lịch sử                                                                           | RecurringExpenseScheduleTests, RecurringExpenseIdempotencyTests và Compact24                                |
| Chi phí BF-07               | Work Order nghiệm thu liên kết expense qua task/incident/asset                                                                             | Đã có. Kiểm tra chỉ nghiệm thu tạo chi phí, công việc 0 đồng, retry/rework và xác nhận thực chi riêng                                            | IncidentApiTests, FinanceManagementAcceptance                                                               |
| Biến động và hiệu quả cơ sở | FinanceComparisonMath, LocationPerformanceTable, ManagementFinanceSummary                                                                  | Đã có. Kiểm tra kỳ tương đương, mẫu số bằng 0, tỷ lệ tổng theo trọng số, nguồn biến động                                                         | ManagementFinanceTests, FinancialReportsApiPage tests                                                       |
| Vốn và khấu hao             | DepreciationService/Repository, AssetReplacementPanel; lô đầu tư, revisions/disposals/receipts trong history                               | Đã có. Kiểm tra dữ liệu thiếu, tháng sử dụng trọn vẹn, giới hạn khấu hao, bán một phần và bảo toàn lịch sử                                       | ManagementFinanceTests và FinanceManagementAcceptance                                                       |
| Thu hồi vốn                 | Chỉ số cũ giữ nguyên nghĩa; Management.CashCapital theo thực thu/thực chi                                                                  | Cần sửa: kỳ lịch chưa kết thúc vẫn có thể được xem là đủ tháng; thiếu nguyên giá tài sản có thể cho tỷ lệ dựa trên vốn thiếu                     | FinancialReportService, FinanceManagementMath; thêm regression thời gian/dữ liệu thiếu                      |
| What-if                     | FinancialScenariosApiPage; FinancialScenarioService/Repository, financial_scenarios lưu snapshot                                           | Cần sửa: analyze chưa chặn kỳ nền chưa kết thúc như defaults; vốn cuối dự báo không được hiển thị như đã biết khi thiếu nguồn lịch sử            | FinancialScenarioTests, service tests và API acceptance; không đổi dữ liệu vận hành                         |
| UX và tương thích           | Dùng client-core; Owner screens và Mobile đang gọi API hiện hữu                                                                            | Kiểm tra loading/error/retry, bộ lọc đang sửa so với snapshot đã tải, VND dạng decimal string, mobile typecheck/regression và browser responsive | Vitest/build/lint, Verify-FinanceClients qua API + PostgreSQL disposable                                    |

## Kế hoạch kiểm chứng

1. Giữ code có sẵn; sửa các sai lệch cụ thể tại lớp chịu trách nhiệm. Owner-only kiểm tra cả controller/service; không thay quyền Staff/Tenant.
2. Unit test công thức và lỗi thiếu dữ liệu; integration test qua HTTP và PostgreSQL cô lập, gồm retry/concurrency và dữ liệu tổng hợp.
3. Build/lint/typecheck/test Owner Web, kiểm tra client Mobile; browser dùng production HTTP pipeline với database và tài khoản tổng hợp riêng.
4. Ghi kết quả thực chạy và các giới hạn dưới đây. Không dùng kết quả báo cáo cũ làm bằng chứng cho lượt này.

## Kết quả thực thi

### Kiểm tra sau merge develop, HEAD `0de10e04`

CI #335 thất bại ở integration test và Owner Web test. Regression kiểm kê tài sản phải giữ tỷ lệ chi phí sửa chữa 50% nhưng không yêu cầu cảnh báo theo ngưỡng chưa được phê duyệt. Test khoản chi truy vấn textbox theo accessible name (bao gồm nhãn bắt buộc của MUI), vẫn kiểm tra khóa chỉnh sửa, đóng dialog và gửi lặp khi đang xác nhận thực chi.

Kiểm tra lại trên workspace ngày 25/11/2026:

- Owner Web: 69/69 test expenses, reports, finance và 6/6 test What-if.
- Backend Application: 73/73 unit test Finance, gồm cả kiểm tra tỷ lệ sửa chữa 75% không tự sinh cảnh báo thay tài sản.
- Compact24: 7/7 integration test trên PostgreSQL 18 loopback riêng, gồm kiểm kê tài sản, ledger, phân bổ chi phí nhân viên, tính dòng tiền, so sánh và snapshot What-if; không skip. Dừng instance test sau khi chạy.
- `dotnet build src/backend/BHome.sln -c Release --no-restore` thành công, 0 warning và 0 error.
- `npm run lint`, Mobile typecheck, `npm run format:check` và `dotnet format src/backend/BHome.sln --verify-no-changes --no-restore` thành công.
- `npm run build` thành công với Node 22.23.4 và `VITE_API_BASE_URL=https://api.example.com` như workflow CI; lần chạy thiếu biến môi trường bị từ chối đúng theo cấu hình.
- Log local có sẵn của lượt kiểm tra sau CI #335 ghi nhận Owner Web 1059/1059, Mobile 1751/1751, Public Web 11/11; đây là bằng chứng lượt chạy trước, không phải lần chạy lại toàn bộ ở mục này.

Lượt kiểm chứng độc lập khi tiếp tục công việc: chạy lại `ExpensesApiPage.test.tsx` (12/12), Application UnitTests với bộ lọc `FullyQualifiedName~Finance` (73/73), và 7 integration test Compact24 kể trên (7/7, không skip). TRX của lượt này nằm tại `.artifacts/finance-ci335-recheck-fe1f5d7731ba443cb7fb4dbdda60b629/finance-ci335-recheck.trx`. PostgreSQL test đã được dừng sau khi hoàn tất.

Chưa xác nhận toàn bộ CI trên Ubuntu: Docker Desktop không chạy trong môi trường kiểm tra hiện tại, nên chưa chạy lại toàn bộ backend suite sử dụng Testcontainers và các bước Docker image. Không thay workflow, không bỏ test, không chạy trên database nghiệp vụ. Chờ CI của commit tiếp theo để xác nhận trạng thái xanh.
