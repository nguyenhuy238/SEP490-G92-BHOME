# Tích hợp develop vào member/QHuy — 21/11/2026

Yêu cầu: lấy code chuẩn từ `develop`, bảo toàn các commit chức năng riêng và phần
email, tiếp nhận thay đổi Staff do member khác phụ trách. Phạm vi kiểm tra chính:
BF-02/UC-08..12, luồng xác thực hiện có, JOB-04/GBR-18 và cấu hình link local.

## Nguồn và quyết định

- Nhánh trước merge: `member/QHuy`, HEAD `b41ef872`, working tree sạch.
- Đã fetch `origin/develop` tại `88246936`; không rebase/reset hoặc squash các
  commit chức năng của nhánh hiện tại.
- `430dacd2` triển khai Staff active khi tạo và cấp credential trực tiếp;
  `3f77773b` cập nhật các test tích hợp tương ứng. Đây là thay đổi được tiếp nhận
  từ develop, không triển khai lại điều kiện kích hoạt theo cách khác.
- Staff mới có `IsActive=true`, `EmailConfirmed=true`, không pending invitation.
  Tạo tài khoản chưa tự gửi password: Owner dùng thao tác cấp mật khẩu riêng;
  outbox gửi credential sau commit. Tenant vẫn theo điều kiện hợp đồng hiện có.

## Giải quyết xung đột

1. `src/owner-web/vite.config.ts`: nhận hỗ trợ chứng chỉ `.pem` hoặc `.crt` từ
   develop; giữ proxy `/open/sign-contract` và `/api`, TLS verification vẫn bật.
2. `AuthenticationEmailTests.cs`: giữ test Staff active và cấp credential mới của
   develop; lấy password từ `EmailCredentials`, đúng message nội bộ của template
   v2. Không bỏ kiểm tra 12 ký tự/login/change password/cooldown/quyền.
   Test invitation cũ được giữ với fixture Staff legacy, không tạo Staff mới qua
   API rồi giả định tài khoản vẫn pending.
3. Auto-merge giữ cả kiểm tra relevance hóa đơn đang chờ approval của develop
   và nội dung/credential/native action của phần email trên nhánh hiện tại.
   `AccountInvitations.cs` giữ nguyên develop; phần tạo Staff trong
   `CompactOperationsRepository.cs` giữ nguyên develop. Các khác biệt còn lại
   của repository đó thuộc chức năng residence đã có trên member/QHuy.

## Kiểm chứng

Log/TRX đặt trong `.tools/develop-merge-20261121/` bị Git bỏ qua. Database tổng
hợp PostgreSQL 16 và Mailpit riêng chỉ bind loopback; không dùng dữ liệu thật,
không gửi tới mailbox người dùng hoặc đổi `.env`/secret/DNS/production.

| Kiểm tra            | Lệnh/scenario                                                                                                                                                              | Kết quả                                                |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Backend build       | `dotnet build src/backend/BHome.sln -c Release --no-restore`                                                                                                               | PASS, 0 warning/error                                  |
| Staff credential QA | `dotnet test tests/backend/BHome.Infrastructure.UnitTests/BHome.Infrastructure.UnitTests.csproj -c Release --no-build --filter FullyQualifiedName~IssueStaffPasswordAsync` | 6 PASS, 0 FAIL/SKIP                                    |
| Backend CI suite    | `dotnet test src/backend/BHome.CI.slnf -c Release --no-build --settings tests/backend/ci.runsettings -m:1`                                                                 | Exit 0: 2.278 PASS, 0 FAIL, 28 SKIP                    |
| Backend format      | `dotnet format src/backend/BHome.sln --verify-no-changes --no-restore`                                                                                                     | PASS                                                   |
| Frontend            | `npm ci --no-fund --no-audit`; `npm test -- --maxWorkers=2`                                                                                                                | Owner Web 851 PASS; Mobile 1.532 PASS; exit 0          |
| Frontend gates      | `npm run lint`; typecheck Owner Web/Mobile; `npm run build` với Staging canonical URL                                                                                      | PASS; Vite có cảnh báo chunk lớn, không có build error |
| Mobile export       | `EXPO_NO_DOTENV=1`; `expo export --platform web --max-workers 2`                                                                                                           | PASS                                                   |
| Deployment Node     | `node --test tests/deployment/*.test.cjs`                                                                                                                                  | 17 PASS, 0 FAIL/SKIP                                   |

Chưa chạy GitHub Actions hoặc deploy/push. Các opt-in/model/provider/device
tests bị SKIP và QA suites bị CI filter loại ra không được tính là PASS.

Backend theo project: Application 667 PASS; Domain 115 PASS; Infrastructure 128
PASS; Integration 1.327 PASS/0 FAIL/28 SKIP; Digital Signing 41 PASS.
Các test tạo Staff active, cấp credential, login/change password và invitation
legacy đều PASS; ba test SMTP Mailpit/browser cũng PASS trong lượt này.
Backend format, Prettier toàn repository và git diff --check đều PASS.

Cảnh báo đã quan sát: npm báo dependency whatwg-encoding deprecated; jsdom chưa
hỗ trợ canvas trong các test sẵn có; Vite cảnh báo chunk lớn. Các runner vẫn
exit 0; không nới assertions hoặc sửa workflow CI để bỏ qua lỗi.

Đã gỡ PostgreSQL/Mailpit riêng sau kiểm thử; giữ nguyên MinIO đang dùng.
Merge commit giữ hai phía lịch sử; không push lên remote trong tác vụ này.
