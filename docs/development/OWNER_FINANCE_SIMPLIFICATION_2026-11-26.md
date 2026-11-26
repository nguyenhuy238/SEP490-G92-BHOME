# Đơn giản hóa tài chính Owner — 26/11/2026

## Yêu cầu và đối chiếu trước thay đổi

Owner cần biết doanh thu, tiền thực thu, tiền chi, lợi nhuận, biến động chi phí và hiệu quả vốn theo cơ sở/toàn chuỗi. Ưu tiên dễ dùng; giữ phạm vi quản trị nội bộ. Nguồn bổ sung: yêu cầu và ảnh giao diện người dùng ngày 26/11/2026.

Đã đọc SRS thực có tại `docs/reports/BHome_Report-3_Software Requirement Specification.docx`: FE-08, UC-31 quản lý vốn/chi phí, UC-32 báo cáo, UC-33 hoàn vốn, UC-34 What-if; GBR-15 tách giả định khỏi dữ liệu thực, GBR-16 chỉ tiêu quản trị. Đối chiếu `docs/api/FINANCE.md` và triển khai hiện có. BF-05/06 cung cấp hóa đơn/thanh toán; BF-07 cung cấp chi phí sửa chữa. Không thay đổi các nghiệp vụ nguồn này.

| Hành vi                                  | Thành phần/dữ liệu                         | Nghiệm thu                                                                                                             |
| ---------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Đọc ngay doanh thu − chi phí = lợi nhuận | FinancialReportsApiPage, FinanceTotals     | Dùng đúng ba số backend, kể cả số âm; không tính lại tại frontend                                                      |
| Hiểu tiền vào/ra và cọc                  | Tóm tắt dòng tiền, FinanceManagementTotals | Thực thu, thực chi vận hành, thực chi đầu tư, dòng tiền và nợ tách riêng; cọc không cộng doanh thu; null không thành 0 |
| Xem khấu hao và lợi nhuận sau khấu hao   | Báo cáo + ManagementFinanceSummary         | Hai giá trị backend hiển thị rõ; chi tiết quản trị mở theo nhu cầu                                                     |
| Tìm khoản chi đang tăng                  | FinanceComparison, ExpenseSourceDetails    | Thay đổi lấy từ backend; giữ đối chiếu nguồn cả hai kỳ, không tự suy đoán nguyên nhân                                  |
| Cấu hình khoản chi lặp lại               | ExpensesApiPage → LocationFinanceWorkspace | Chọn cơ sở → mở đúng tab định kỳ; giữ quyền Owner và quy tắc idempotency hiện có                                       |
| Phân biệt ghi chi phí với trả tiền       | Form khoản chi, ExpenseFinanceActions      | Hướng dẫn xác nhận thực chi riêng; không tự xác nhận thanh toán                                                        |
| Dễ nhập giả định                         | FinancialScenariosApiPage                  | Nhóm tiền vào/chi phí/đầu tư rõ; giữ dữ liệu nền, kiểm tra bắt buộc và thao tác Phân tích → Lưu                        |

## Kế hoạch

1. Sắp xếp lại báo cáo: kết quả kinh doanh trước; tiền thực thu/chi và khấu hao ngay sau; chỉ tiêu quản trị chi tiết mở khi cần.
2. Bổ sung lối vào chi phí định kỳ và lời dẫn ngắn ở form chi; tổ chức lại các nhóm giả định What-if.
3. Kiểm thử số liệu đúng/âm/thiếu, trạng thái mở chi tiết, phạm vi cơ sở và deep link; chạy test, typecheck, lint/build phù hợp và kiểm tra hiển thị desktop/mobile bằng dữ liệu tổng hợp.

## Phạm vi còn lại

Backend đã có chi phí định kỳ, chi phí nhân viên, liên kết Work Order, thực chi, khấu hao, hoàn vốn, biến động theo danh mục và What-if có dữ liệu nền. Lượt này cải thiện khả năng sử dụng các chức năng đó, không thay công thức tài chính hoặc chính sách. Dự báo tự động từ nhiều tháng lịch sử ngoài What-if chưa được bổ sung; cần mô hình và tiêu chí đánh giá rõ, không coi giả định là dự báo chắc chắn. Các nguồn thu chi vẫn phụ thuộc dữ liệu thật đã ghi nhận/xác minh. Không triển khai lên staging/production trong lượt này.

## Kết quả kiểm tra

### Lượt thu gọn tiếp theo theo phản hồi người dùng

Phản hồi cùng ngày: chỉ hiện thông tin chính, nhập số liệu dễ hơn trên cả Báo cáo, Chi phí & đầu tư, Kịch bản. Giữ ánh xạ FE-08/UC-31–34, GBR-15/16 và các DTO/server policy nêu trên.

- Báo cáo: ba số doanh thu/chi phí/lợi nhuận, ba thông tin thực thu/đã chi/còn phải thu và một câu biến động. Gom các mục chuyên sâu vào “Xem chi tiết báo cáo”. Chọn tháng hoặc cơ sở tự tải; đổi cơ sở xóa phòng cũ khỏi truy vấn. Khoảng ngày/phòng tùy chọn giữ thao tác áp dụng và cảnh báo dữ liệu chưa cập nhật.
- Chi phí: danh sách là nội dung chính; lương/định kỳ/vốn thu gọn chung. Form chọn danh mục có gợi ý và cho tự nhập; bỏ nhiều nút gợi ý, bỏ tiêu đề/lời dẫn thừa, thu hẹp dialog và xếp hai cột trên desktop. Các trường bắt buộc, khóa nguồn, khóa khi đang lưu và xác nhận thực chi giữ nguyên.
- Kịch bản: chỉ mở ba giả định thường sửa; chín giả định còn lại thu gọn. Giá trị không mất khi đóng. Kiểm tra đầu vào của toàn bộ giả định trước analyze/save: thiếu/sai định dạng thì mở phần còn lại và yêu cầu bổ sung, không gọi API. Không tự lấy chi phí chưa biết thành 0. Riêng đầu tư bổ sung mặc định là giả định “không đầu tư thêm”, có lời giải thích tại trường mở rộng; giá trị này không thay đổi vốn thật. Cảnh báo thiếu căn cứ từ backend vẫn luôn hiện; chi tiết nguồn được thu gọn.
- **81/81 test** trên 6 file qua với Node 22.23.4; bổ sung kiểm tra màn hình ban đầu ít thông tin, tải tháng/cơ sở ngay, phần thu gọn giữ dữ liệu backend khi phân tích, và từ chối phân tích khi thiếu số liệu. Typecheck và build qua; ESLint các file thay đổi (`--max-warnings 0`), Prettier và `git diff --check` qua. Vite giữ cảnh báo chunk >500 kB.
- Browser Edge headless với API tổng hợp trên bản build: 1440×1000 và 390×844, báo cáo gọn, mở các cấp chi tiết, danh sách/form chi phí, chọn danh mục, định dạng tiền, tới chi phí định kỳ, lấy dữ liệu nền rồi phân tích với các khoản khác đang đóng. Không tràn ngang trang hoặc lỗi JavaScript. Đã xem ảnh cả ba phần. Artifacts mới: `verify-simple.cjs`, `simple-*.png`, `simple-tests.log`, `simple-build.log` trong `.artifacts/finance-ux-20261126/`.
- Lỗi trung gian đã sửa: script chỉnh Unicode qua stdin PowerShell bị đổi ký tự, đã chuyển sang file UTF-8 và khôi phục phần bị ảnh hưởng; typecheck phát hiện JSX/option truy vấn test sai, đã sửa và chạy kiểm tra lại qua. Không dùng kết quả build cũ thay cho build mới.
- Không thay backend/API/DB hoặc triển khai staging; kiểm tra HTTP thật, tablet/zoom và thử với Owner thực vẫn **NOT RUN**.

### Lượt kiểm tra ban đầu

- Vitest 6 file: **76/76 test qua**, bao gồm bốn test tóm tắt kinh doanh, gợi ý nhập chi phí, deep link định kỳ, What-if và AppShell. Đã chạy lại bộ này bằng Node 22.23.4 trong `.tools`, phù hợp engine repo. Bao phủ số âm, decimal lớn, null khác 0, API cũ thiếu management, nguồn chi phí hai kỳ và không tự ghi/thanh toán khi chọn gợi ý/điều hướng.
- `npm run typecheck --workspace ./src/owner-web`: qua. `npm run build --workspace ./src/owner-web`: qua; build cuối bằng Node 22.23.4 và URL placeholder `https://api.example.com`. Vite vẫn cảnh báo chunk lớn hơn 500 kB.
- ESLint các file TSX thay đổi với `--max-warnings 0`: qua. `npm run lint --workspace ./src/owner-web` (oxlint): exit 0, có warning sẵn ở `ContractsNavigation.test.tsx:106`, ngoài phạm vi thay đổi.
- Kiểm tra trình duyệt Edge headless, bản build API mode, desktop 1440×1000 và mobile 390×844: báo cáo, mở chỉ tiêu chi tiết, nhập `1250000` hiển thị `1.250.000`, chọn danh mục, đi từ danh sách chi phí tới đúng tab định kỳ của cơ sở, nhóm giả định What-if. Không tràn ngang trang hoặc lỗi JavaScript. Dùng hoàn toàn response API tổng hợp, **không phải** kiểm chứng API/database thật. Đã xem ảnh và thực hiện một lượt thu gọn responsive, sau đó xác nhận lại.
- Artifact local: `.artifacts/finance-ux-20261126/verify.cjs`, các ảnh `reports-*`, `expense-form-*`, `recurring-*`, `what-if-*`, và `build-node22.log`. Detector giao diện đã chạy một lần, trả `[]` tại lượt kiểm tra cơ học.
- Lỗi gặp và đã xử lý: Python alias không có runtime, nên đọc SRS bằng .NET ZIP/XML; PowerShell chặn `npx.ps1`, dùng `npx.cmd`; build trung gian phát hiện nhánh so sánh TypeScript không còn hợp lệ sau thu gọn banner, đã bỏ nhánh thừa và build lại qua. Script browser ban đầu dùng sai đường dẫn fixture reference choices và locator nhãn không duy nhất; đã sửa fixture/locator và chạy lại qua.
- **NOT RUN:** backend suite/DB integration, staging thật, kiểm tra với người dùng thực, tablet/zoom 200% và kiểm chứng quyền qua HTTP. Không sửa backend, API contract, migration, chính sách khấu hao hoặc dữ liệu thật; không commit/push/deploy.

## Files thay đổi

Trong `src/owner-web/src/`:

- `features/reports/BusinessFinanceOverview.tsx`, `BusinessFinanceOverview.test.tsx` (mới).
- `features/reports/FinancialReportsApiPage.tsx`, `FinancialReportsApiPage.test.tsx`.
- `features/expenses/ExpensesApiPage.tsx`, `ExpensesApiPage.test.tsx`.
- `features/locations/pages/LocationFinanceWorkspace.tsx`, `LocationFinanceWorkspace.test.tsx`.
- `features/what-if/FinancialScenariosApiPage.tsx`, `FinancialScenariosApiPage.test.tsx`.
- `features/finance/FinanceWorkflowStrip.tsx`, `components/layout/AppShell.test.tsx`.

Tài liệu: ghi chú này và `docs/ux/OWNER_FINANCE_UX.md`.
