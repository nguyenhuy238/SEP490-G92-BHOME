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
