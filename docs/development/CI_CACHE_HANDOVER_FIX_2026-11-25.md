# Sửa CI cache image và test bàn giao — 25/11/2026

## Bằng chứng và truy vết

- CI #319, run `45431147131`: theo log người dùng cung cấp, image API đã push
  manifest thành công, sau đó exporter GitHub Actions cache trả HTTP 503
  `no healthy upstream`, khiến bước build và release thất bại.
- CI #321, run `45440311916`: test validation và cuộn tới trường thiếu thông tin
  trong `move-in-draft-handover.test.tsx` thấy thông báo validation
  nhưng chưa thấy lời gọi `modalScrollTo` tại assertion đầu tiên.
- Phạm vi kỹ thuật: độ tin cậy CI/release; hồi quy BF-03/BF-04, UC-17.
  Đối chiếu `AGENTS.md`, `docs/api/MOVE_IN_HANDOVER_DRAFT.md`, workflow hiện có
  và `MoveInDraftHandoverPanel.run` cùng effect cuộn tới trường lỗi.
  Không sửa quy tắc, quyền, API, trạng thái nghiệp vụ hoặc schema.

## Thay đổi và tiêu chí chấp nhận

- Sáu exporter `cache-to: type=gha` trong `ci.yml` và `release.yml` dùng
  `ignore-error=true`. Cache phục vụ tăng tốc; lỗi xuất cache không được làm hỏng
  kết quả build/push image. Lỗi build, push và xác minh digest vẫn chặn release;
  không dùng `continue-on-error` cho bước build hay job.
- Giữ nguyên scope cache, tag theo commit, digest và các cổng kiểm tra deployment.
- Test bàn giao chờ riêng tác dụng phụ cuộn bằng `waitFor`: thông báo đã xuất
  hiện trong DOM không bảo đảm passive effect `useEffect` đã chạy. Giữ nguyên
  assertion vị trí `y=0` và `y=352`, việc xóa lỗi khi đóng/mở lại, và nhánh lưu
  hợp lệ. Bổ sung kiểm tra hai lần lưu thiếu thông tin không POST bản nháp.
- Không tăng timeout, thêm sleep, bỏ test hoặc đổi mã giao diện để chiều test.

Tham chiếu: [Docker GHA cache — tham số ignore-error](https://docs.docker.com/build/cache/backends/gha/)
và [Testing Library — waitFor](https://testing-library.com/docs/dom-testing-library/api-async/).

## Kiểm chứng

- Trước sửa, file test bàn giao chạy riêng: 54 PASS. Chưa tái hiện được lỗi
  chập chờn của CI trên máy local; nguyên nhân thứ tự assertion/effect được
  suy ra từ log và mã hiện có.
- `npm test` toàn frontend: PASS, 299 file / 2.789 test (Owner Web 1.033,
  Mobile 1.745, Public Web 11), không có test fail hoặc skip. Lượt đầy đủ dùng
  Node 24.22.1 mặc định của máy; các kiểm tra bên dưới dùng Node 22 như CI.
  Owner Web có log jsdom chưa hỗ trợ canvas `getContext`, nhưng suite vẫn PASS.
- Sau sửa, chạy trên Node 22.23.4:
  - `npm run test --workspace ./src/mobile -- src/__tests__/move-in-draft-handover.test.tsx`:
    54 PASS, 0 FAIL.
  - `npm run lint`: PASS.
  - `npm run typecheck --workspace ./src/mobile`: PASS.
  - `npm run build` với `VITE_API_BASE_URL=https://api.example.com`: PASS
    (client-core, Owner Web, Public Web). Vite vẫn có cảnh báo kích thước chunk.
- `node --test tests/deployment/*.test.cjs`: 21 PASS, 0 FAIL.
- `actionlint -shellcheck= .github/workflows/ci.yml .github/workflows/release.yml`:
  PASS bằng actionlint 1.7.12; không chạy ShellCheck.
- `npm run format:check` toàn repository và `git diff --check`: PASS. Lượt
  format ban đầu chỉ báo file tài liệu mới; đã format file đó và chạy lại thành công.
- Chưa chạy lại GitHub Actions hoặc thử xuất cache tới dịch vụ GitHub đang lỗi.
  Chưa chạy lại backend test hoặc build/push Docker image; bản sửa không đổi
  backend/Dockerfile. Không commit, push, merge hoặc triển khai trong tác vụ này.
