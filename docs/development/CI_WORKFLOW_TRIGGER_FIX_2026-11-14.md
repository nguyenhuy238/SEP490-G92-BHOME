# Sửa workflow CI không tạo checks cho PR — 14/11/2026

## Nguyên nhân

PR #108 từ `member/QHuy` vào `develop` hiện 0 checks. Log GitHub được cung cấp
báo `Invalid workflow file`, `Unrecognized named-value: 'runner'` tại dòng 16–17.
Commit `a3947562` thêm `${{ runner.temp }}` vào `jobs.backend.env`; context
`runner` không được phép tại cấp này. GitHub từ chối workflow trước khi tạo job.
Trigger `pull_request.branches` đã bao gồm `develop`.

Tham chiếu: [GitHub context availability](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#context-availability).

Traceability: yêu cầu khôi phục CI của người dùng → AGENTS.md mục 9–10
(kiểm tra thay đổi và quality gates) → `.github/workflows/ci.yml` → kiểm tra
workflow hợp lệ, trigger PR và cấu hình SDK trước `setup-dotnet`.
Không thay đổi BF/FE/UC/GBR/DBR/JOB, API hay dữ liệu nghiệp vụ.

## Thay đổi

- Chuyển cấu hình `DOTNET_INSTALL_DIR` và `DOTNET_ROOT` vào step trước
  `actions/setup-dotnet`. Step ghi đường dẫn `$RUNNER_TEMP/.dotnet` vào
  `$GITHUB_ENV` để các step tiếp theo dùng chung bản SDK cô lập.
- Dùng khóa chuỗi `ports['5432']` khi đọc cổng PostgreSQL; `actionlint` phát hiện
  chỉ số số không phù hợp kiểu object của `job.services.*.ports`.

## Kiểm chứng đã chạy

- `actionlint` 1.7.12, binary Windows tải từ release chính thức và đối chiếu
  SHA-256 với checksums của release: trước sửa tái hiện hai lỗi context và một
  lỗi kiểu chỉ số cổng; sau sửa exit code 0.
- Lệnh: `.tools/ci-workflow-fix-20261114/actionlint.exe -shellcheck= -pyflakes= .github/workflows/ci.yml`.
  Hai tùy chọn tắt tích hợp ShellCheck/Pyflakes; kiểm tra YAML, cấu trúc workflow
  và biểu thức GitHub Actions vẫn được thực thi.
- Harness local `.tools/ci-workflow-fix-20261114/validate.cjs` đọc YAML và chạy
  nguyên văn step cấu hình bằng Git Bash: kiểm tra cú pháp Bash, xuất đủ hai biến
  và truyền chúng sang process sau, cả đường dẫn thường và đường dẫn có dấu cách.
  Đồng thời xác nhận giữ trigger PR `main`/`develop`/`release/**`, manual dispatch
  và thứ tự cấu hình trước `setup-dotnet`: PASS.
- Prettier trên hai file thay đổi và `git diff --check`: PASS.

Chưa chạy toàn bộ build/test backend/frontend hoặc GitHub-hosted Ubuntu workflow
trong tác vụ này. Kết quả trên xác nhận sửa lỗi cấu hình; không chứng nhận toàn bộ
pipeline đã xanh trên GitHub. Chưa commit, push hoặc merge. Sau khi commit và push
bản sửa lên nhánh `member/QHuy` của PR #108, sự kiện `pull_request.synchronize`
sẽ cho GitHub đánh giá lại workflow; cần kiểm tra kết quả CI thực trước khi merge.

## Cập nhật sau khi người dùng yêu cầu commit và push

Commit `134c4cd1` đã push lên `member/QHuy` và tự kích hoạt
[run 43563552384](https://github.com/nguyenhuy238/SEP490-G92-BHOME/actions/runs/43563552384).
Cả hai job được tạo; cấu hình SDK, restore và build backend đã qua trên Ubuntu.
Frontend qua install/lint/typecheck nhưng `npm test` phát hiện đúng bốn lỗi
Owner Web đã ghi trong [biên bản merge](MERGE_DEVELOP_2026-11-14.md).
Log thực tế: Owner Web 536/540 qua, Mobile 1.226/1.226 qua.

Khôi phục các thao tác đã có ở commit `e4f5dcf0`, giữ bố cục hiện tại và các
assertion hồi quy. Nguồn hành vi: `docs/ux/OWNER_FINANCE_UX.md`, test hiện có
và client API hiện có; không thêm endpoint, công thức hoặc quyền mới.

| Truy vết                       | Thành phần                | Hành vi khôi phục và kiểm tra chấp nhận                                                                                      |
| ------------------------------ | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| FE-08, UC-31, GBR-01/02        | ExpensesApiPage           | Mở liên kết tùy chọn sau các trường cốt lõi; gửi đúng Room/Asset/Work Order ID; giữ khóa chỉnh sửa nguồn quản lý.            |
| BF-05, UC-21, JOB-10, GBR-09   | AutomationPage            | Hiển thị Draft theo cơ sở/kỳ; cập nhật qua API với expectedVersion; hiển thị total/missingInputs trả về, không tự phát hành. |
| FE-08, UC-32/33; UX kỳ báo cáo | FinancialReportsApiPage   | Mặc định tháng trước, lối tắt kỳ; đổi bộ lọc chưa tải phải báo số liệu cũ, không tự gọi report.                              |
| FE-08, UC-34, GBR-15/16        | FinancialScenariosApiPage | Lối tắt kỳ nền chỉ đổi trường ngày, không tự phân tích/lưu hoặc sửa sổ thực tế.                                              |

Kiểm tra local bổ sung: bốn file test gốc **30/30 PASS**; `npm run lint`,
`npm run build`, `npm run format:check` PASS. Mechanical detector của Impeccable
không trả finding trên bốn file giao diện. Chưa kiểm chứng trực quan bằng browser
trong lượt sửa này. Toàn bộ Owner Web **540/540 PASS**; lượt `npm test` đầu dùng
Node 24.22.1 có 12 lỗi Mobile startup do runtime tự chuyển sang Node 22 của repo.
Chạy lại toàn bộ Mobile bằng Node 22.23.4 theo phiên bản CI: **1.226/1.226 PASS**.
Ánh xạ UC tài chính theo `docs/api/FINANCE.md` (UC-31 chi phí, UC-32/33 báo cáo,
UC-34 What-if). CI của commit bổ sung được theo dõi tiếp sau push.
