# Email xác thực BHOME — 12/11/2026

Yêu cầu tiếp nối Gmail SMTP, FE-02/UC-01..02, GBR-02/13/14/18, JOB-04 và Report 4 Identity/token design.
Giữ Identity hashing, password policy, JWT/session/revocation, quyền Owner/Staff/Tenant hiện có.
Không thay đổi nghiệp vụ tài chính hoặc migration SePay. Baseline: nhánh member/QHuy sạch,
3 commit Gmail trước đã hoàn tất. App Password đã có và được cập nhật trong User Secrets,
không vào repository. Không dùng mật khẩu tài khoản Google để SMTP.

## Audit và traceability

| Yêu cầu | Hiện trạng và phần bổ sung | Tiêu chí kiểm chứng |
| --- | --- | --- |
| Recovery qua email | IdentityPasswordService có reset/hash grant/expiry/session revoke; trước chỉ tìm username và gửi mã đồng bộ | Tìm theo email, generic response, cooldown, link, invalid/expired/reused/weak token, login mật khẩu mới |
| UI recovery | Web có form reset thủ công; Mobile nút chưa nối API | Web đọc fragment, Mobile có route/link và form; không persist token |
| Staff/Tenant invite | AccountInvitations, Owner endpoints, tenancy approval job và UI accept có sẵn | Role-aware email, pending setup, resend, duplicate/scope, không tạo login cho Resident không được provision |
| Security email | Audit đã commit → CompactNotificationEvents → Account inbox/EMAIL | Đúng actor/event/time, không failed action, không double-notify/reset rollback |
| Retry | JOB-04 ChannelDelivery lease/status/history có sẵn | Grant + protected payload + outbox atomic; transient retry, invalid/expired/consumed/superseded suppress |

Token đang chờ gửi được mã hóa/xác thực bằng ASP.NET Data Protection với purpose riêng;
raw token chỉ tồn tại trong bộ nhớ và email riêng. Database giữ grant hash hiện có và protected
payload trong notifications OUTBOX; không thêm bảng/migration hoặc đưa token vào inbox/API/log.
Key ring phải được lưu bền vững, bảo vệ và chia sẻ giữa các instance deployment như Identity keys.
Không có quyền tự chọn một kho key production mới trong tác vụ này.

## Giai đoạn 1

Recovery tái sử dụng IPasswordResetDelivery và NotificationChannelWorker. Adapter durable queue
trong transaction grant, retry không tạo token mới, recheck user/email/expiry/hash/consumed trước gửi.
Fallback test adapter giữ tương thích. API `userName` giữ tên field và hỗ trợ username cũ, thêm
lookup email; không trả token, account existence hoặc kết quả SMTP trong public response.
Lịch cooldown 60 giây cấu hình được, không áp dụng thay lịch nhắc nghiệp vụ.
Web nhận token qua URL fragment rồi xóa fragment khỏi history; Mobile dùng scheme bhome đã có.
Trusted origins/path scheme được kiểm tra; localhost HTTP chỉ Development; Production cần HTTPS
được cấu hình rõ ràng. Không lấy callback từ Host header hoặc dữ liệu tùy ý của caller.

Khi global AutomationEnabled=false và URL xác thực đã được cấu hình, worker hiện có chỉ xử lý
protected auth outbox; không publish/gửi backlog nghiệp vụ hoặc bật job tài chính.
NotificationChannels.Enabled vẫn là công tắc kênh bắt buộc. Không thêm worker/hàng đợi mới.

Kiểm chứng giai đoạn 1: API build 0 warning/error; 13 test backend đầu tiên passed;
Web 13 test recovery/login và Mobile 3 test recovery passed; typecheck/lint hai client passed;
Owner Web production build passed (cảnh báo chunk >500 kB đã tồn tại, không lỗi build).

## Giai đoạn 2

Staff/Tenant invitation giữ endpoint/actor mapping hiện có: Owner gửi qua thao tác quản trị hiện có;
Tenant chỉ được provision khi tenancy active/approved theo AccountInvitations và job đã có.
Không mở quyền mới cho Staff và không tạo login chỉ vì một Resident tồn tại.
Email lời mời có tên/tài khoản, hướng dẫn thiết lập, link một lần và thời hạn; Staff/Tenant dùng
template riêng. Grant + protected outbox commit cùng nhau; SMTP lỗi chỉ đổi delivery status.
Resend trong cooldown giữ invitation cũ; sau cooldown tạo grant mới và tự suppress link cũ.
Đã được mời nhưng chưa thiết lập thì không đăng nhập; cấp invitation thu hồi session cũ và
rotate security stamp trước khi sinh token để chặn login race. Không bắt buộc email confirmation
cho mọi tài khoản đang tồn tại. Accept vẫn dùng Identity token purpose AccountInvitation,
password validator, EmailConfirmed và revoke sessions như trước.
Web/Mobile accept tự đọc link; thao tác gửi invitation trên Owner Web giữ nguyên API có sẵn.
Không tự gửi một email thứ hai từ frontend khi account đã được provision bởi job.
