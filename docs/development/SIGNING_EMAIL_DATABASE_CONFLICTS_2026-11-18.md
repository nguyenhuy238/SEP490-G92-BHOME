# Đối chiếu email trước gửi ký

Phạm vi BF-03/04, UC-13..15, GBR-01..04, DBR-01. Nguồn quyết định ngày 18/11/2026: người dùng yêu cầu đối chiếu email với hợp đồng chính thức Active, email trong dữ liệu hợp đồng chính thức và email nhân viên; xác nhận khi trùng phải hiển thị lỗi ở Mobile. Đây là kiểm tra trùng, không phải danh sách chỉ cho phép email đã tồn tại.

`IAnonymousSigningRepository.IsEmailInUseAsync` và `AnonymousSigningRepository` kiểm tra:

- Tài khoản có vai trò Staff, kể cả đang bị khóa/ngừng hoạt động.
- Email hồ sơ Resident hoặc tài khoản Tenant được liên kết với hợp đồng Main; chặn người khác đã sử dụng email đó, và chặn email đang thuộc Main Active khác.
- Email trong bằng chứng lời mời Main đã Accepted, gồm contacts, kể cả email hồ sơ bị sửa về sau. Lời mời mới nhập/chưa ký không tự đặt chỗ một email khác với yêu cầu chỉ xác lập email sau ký đã được phê duyệt trước đó.
- Không tự coi email hồ sơ của chính người đang xử lý trong cùng hợp đồng là trùng. Giữ kiểm tra các email trong cùng danh sách người ở phải khác nhau. Chuẩn hóa khoảng trắng và chữ hoa/thường. Chỉ trả boolean; không lộ danh tính, cơ sở hoặc hợp đồng khác cho Staff.

`AnonymousContractSigningService` áp dụng với Holding/Main trước tạo/sửa lời mời, khi gửi lại/sửa email, khi gửi OTP tiếp và trước ghi nhận acceptance. Trả 409 `signing_email_already_in_use` trước gửi SMTP; không đổi token, session, email hồ sơ hoặc evidence khi bị chặn. Các kiểm tra quyền, CCCD verified, snapshot/PDF, hạn và throttle giữ nguyên. Email lock dùng advisory transaction lock hiện có của PostgreSQL, lấy các email theo thứ tự ổn định. Renewal giữ luồng hiện hành.

`internalSigning.ts` ánh xạ lỗi sang tiếng Việt. `ContractSigningStep.tsx` giữ lỗi gửi theo contract, không bị polling thành công xóa sau vài giây; lỗi vẫn hiện sau refresh, giữ email để sửa và xóa khi người dùng sửa/gửi lại. Không thêm endpoint kiểm tra công khai hoặc gọi SMTP để dò email.

Files chính: `AnonymousSigningContracts.cs`, `AnonymousSigningRepository.cs`, `AnonymousContractSigningService.cs`, `internalSigning.ts`, `ContractSigningStep.tsx`. Kiểm thử: `ContractServiceTests.cs`, `AnonymousSigningSecurityTests.cs`, `SigningEmailConflictTests.cs`, `contract-signing-step.test.tsx`.

Xác minh: 146 backend Contracts unit PASS; 1 PostgreSQL integration lookup PASS (Staff hoa/thường/khoảng trắng, Staff ngừng hoạt động, Main Active, hồ sơ Main đã có, accepted contacts, email hiện tại và email mới hợp lệ); 2 integration Holding→Main đầy đủ PASS; Mobile kiểm tra cả gửi đầu và resend trên Main/Holding, hiện lỗi 409 tại màn hiện tại, refresh không mất lỗi, sửa email xóa lỗi. Không gửi email thật hoặc sửa dữ liệu người dùng để kiểm thử. Không thêm migration/dependency.

Kết quả Mobile cuối: 42 test trong hai file signing PASS; typecheck/lint PASS. API build thành công, khởi động lại và readiness HTTP 200; Metro bundle HTTP 200.
