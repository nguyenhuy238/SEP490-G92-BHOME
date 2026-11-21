# Bằng chứng email BHOME

Tất cả nội dung trong thư mục này là dữ liệu **minh họa**, không phải tài khoản,
mật khẩu hoặc token thật. `DEMO_ONLY` và `DEMO-ONLY-12` chỉ phục vụ kiểm tra bố cục.

| Loại                     | Trước                            | Sau                              |
| ------------------------ | -------------------------------- | -------------------------------- |
| Invitation desktop 900px | [Ảnh](before-invitation-900.png) | [Ảnh](after-invitation-900.png)  |
| Invitation mobile 360px  | [Ảnh](before-invitation-360.png) | [Ảnh](after-invitation-360.png)  |
| Credential desktop 900px | Chưa có bản chụp trước           | [Ảnh](after-credentials-900.png) |
| Credential mobile 360px  | Chưa có bản chụp trước           | [Ảnh](after-credentials-360.png) |

HTML do **EmailTemplate thực tế** render ở baseline `d048cec7` và code hiện tại:
[invitation trước](before-invitation.html), [invitation sau](after-invitation.html),
[credential sau](after-credentials.html). Chụp bằng Edge headless qua Playwright,
đã mở kiểm tra cả desktop và mobile; không tràn ngang ở các kích thước trên.

Giữ Arial/Helvetica để tương thích email client; đây là lựa chọn có chủ đích trước
cảnh báo font phổ biến của detector. Layout không tải font/ảnh ngoài, không script.
Ảnh browser render không chứng minh Outlook/Gmail native render giống hệt.

## Kiểm thử SMTP nhận thư

`MailpitEmailTests.cs` dùng provider MailKit thật → TCP loopback → Mailpit v1.27.10
(cùng phiên bản với Docker Compose) → đọc MIME qua API Mailpit. PostgreSQL riêng
chỉ chứa dữ liệu tổng hợp. Không đọc `.env` hoặc SMTP user-secrets.

Biến môi trường chỉ dành cho **process test**:

- `BHOME_COMPACT24_TEST_ADMIN`: admin PostgreSQL loopback, database `postgres`;
  fixture tự tạo/xóa database `bhome_compact24_<random>`.
- `BHOME_MAILPIT_SMTP_PORT`, `BHOME_MAILPIT_UI_PORT`: cổng loopback của Mailpit riêng,
  không relay/forward ra Internet, không dùng chung inbox có dữ liệu thật.
- `BHOME_RUN_EMAIL_BROWSER_E2E=true`: bật kiểm thử bấm CTA trên trang Web thật;
  cần Node 22 và Edge. `BHOME_TEST_NODE` tùy chọn chọn executable Node.

Không in connection string, password, token hoặc raw MIME vào test logs. Thiếu
điều kiện thì test SKIP rõ ràng, không coi là PASS.

```powershell
dotnet test tests/backend/BHome.IntegrationTests/BHome.IntegrationTests.csproj -c Release --no-build --filter 'FullyQualifiedName~MailpitReceives|FullyQualifiedName~MailpitInvitation|FullyQualifiedName~MailpitReceivedInvitation' --logger trx
```

Các test kiểm tra subject/sender/HTML/text, mật khẩu 12 ký tự, plaintext không nằm
trong outbox, login/change password/revoke, lỗi kết nối trước submit, retry cùng
password/hash, concurrent claim gửi một lần, invitation/reset một lần, Web token
scrubbing và reuse. Không thay thế kiểm tra sender authentication/SPF/DKIM/DMARC,
Gmail Android/iPhone hoặc App Links/Universal Links trên thiết bị thật.

Kết quả, lệnh và giới hạn đầy đủ trong
[báo cáo audit](../../development/BHOME_EMAIL_AUDIT_2026-11-20.md).
Các bộ đếm theo project được trích từ TRX của lượt PostgreSQL 16 tại
[verification.json](verification.json): 2.221 PASS, 0 FAIL, 170 SKIP.
Không tính SKIP hoặc QA suites bị CI filter loại ra thành PASS.
