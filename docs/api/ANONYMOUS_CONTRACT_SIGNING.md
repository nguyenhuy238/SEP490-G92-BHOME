# Ký trước tài khoản và cấp tài khoản sau Main Active

Nguồn: quyết định được duyệt BR-01–07/09/11, BF-03/04, UC-13/14/15; thay thế yêu cầu tài khoản Tenant trước khi ký. SRS/Report 4 về nhà cung cấp vẫn áp dụng cho nhánh MySign. Nhánh nội bộ không đưa ra tuyên bố pháp lý hoặc chứng thư CA.

## Luồng và UI

1. Staff lưu Resident đã xác minh, email riêng; không tạo User. Các đại diện độc lập lập hợp đồng riêng; co-occupant gia đình có thể cùng hợp đồng.
2. Owner Web duyệt PDF Main Draft, chọn “Người ở mới — ký bằng OTP…” để release với tenantUserId=null. API tạo Main/Holding trực tiếp cũng nhận null, không dùng User giả.
3. Chi tiết hợp đồng → “Ký nội bộ qua OTP”: Owner duyệt đúng snapshot, tạo lời mời. Hợp đồng Holding cần Owner approval trước. Mỗi lời mời mới thu hồi lời mời chưa ký cũ. Backend không đổi PDF đã duyệt.
4. Trang Web /contract-signing#token=… đọc token từ fragment rồi xóa fragment khỏi thanh địa chỉ. Mobile: màn đăng nhập → “Mở lời mời ký hợp đồng”, dán liên kết/mã, không đưa token vào tham số điều hướng.
5. OTP → PDF riêng → xem đúng hash → đồng ý có phiên bản → vẽ nét ký → gửi chấp thuận. Không mở PDF chỉ bằng link chưa xác minh.
6. Owner xem bằng chứng tại endpoint document và xác nhận nội dung; Main chuyển PendingActivation. Backend vẫn kiểm tra đủ cọc, thời hạn, người ở, công suất và evidence hash trước activation.
7. Khi Main Active, cùng transaction tạo/link User cho từng người ở, liên kết đại diện, ghi intent gửi lời mời. Holding Active không tạo tài khoản. Lời mời đặt mật khẩu dùng Identity purpose AccountInvitation; sau khi dùng một lần không thể dùng lại.
8. Web /accept-invitation hoặc Mobile “Thiết lập tài khoản từ lời mời” nhận email, mã email và mật khẩu mới; chung endpoint backend. Không tự đăng nhập hoặc tự xác nhận payment từ frontend.

## API

Tất cả route có tiền tố /api/v1, response NoStore. Owner routes yêu cầu JWT Owner và đúng OwnerSignerId. Public routes gửi token/session trong JSON body; không dùng query string. Không API nào trả OTP.

| Method | Route                                              | Nội dung                                                                      |
| ------ | -------------------------------------------------- | ----------------------------------------------------------------------------- |
| GET    | contracts/{id}/internal-signing                    | Mode, trạng thái, hash, thời gian chấp thuận, danh sách lời mời đã loại token |
| POST   | contracts/{id}/signing-invitations                 | snapshotHash, expiresAt UTC; trả token ngẫu nhiên duy nhất trong response tạo |
| DELETE | contracts/{id}/signing-invitations/{invitationId}  | Thu hồi lời mời chưa chấp thuận                                               |
| POST   | contracts/{id}/internal-signing/owner-confirmation | documentHash, consent=true, consentVersion=internal-acceptance-v1             |
| POST   | contract-signing/info                              | token; chỉ email che và trạng thái tối thiểu                                  |
| POST   | contract-signing/otp                               | token; gửi OTP qua email đã xác minh nguồn Resident                           |
| POST   | contract-signing/verify                            | token, otp; trả session ngẫu nhiên, documentHash, consentVersion              |
| POST   | contract-signing/document                          | token, session; đúng PDF được đóng băng                                       |
| POST   | contract-signing/document/layout                   | token, session; kích thước trang                                              |
| POST   | contract-signing/document/pages/{page}             | token, session; PNG của PDF để Mobile đọc trong app                           |
| POST   | contract-signing/accept                            | token, session, documentHash, consentVersion, consent, strokes                |
| POST   | residents/{id}/invitation                          | Owner retry sau Active, email phải khớp hồ sơ/link                            |
| POST   | auth/accept-invitation                             | userName, token, newPassword; anonymous, one-time                             |

strokes là mảng nét; mỗi nét gồm {x,y} hữu hạn trong [0,1]. Backend giới hạn 20 nét, 1.000 điểm/nét, tổng 4.000 điểm, và ít nhất hai vị trí khác nhau. 400 sai input/OTP/consent, 401 sai/hết phiên, 403 sai role, 404 lời mời không dùng được, 409 thay đổi nội dung/state, 429 giới hạn gửi mã, 503 chưa cấu hình dịch vụ.

## Bảo vệ và persistence

- Token và session 256-bit ngẫu nhiên, chỉ lưu SHA-256. OTP 6 số dùng HMAC-SHA256 với khóa riêng >=32 bytes, purpose + invitation + token hash; không lưu/log OTP.
- Chính sách an ninh kỹ thuật hiện tại: lời mời tối đa 24 giờ, OTP 5 phút, 5 lần đoán/challenge, ít nhất 60 giây giữa lần gửi, tối đa 5 lần gửi/lời mời, session 15 phút. Đây không phải giới hạn thời gian Holding hay chính sách tiền cọc.
- Failed OTP attempt được commit trước response lỗi. OTP dùng xong xóa hash. Reissue/revoke làm session cũ mất hiệu lực. API còn dùng Auth rate limiter theo IP.
- contracts.history giữ ContractSigningInvitation; contract state giữ mode INTERNAL_OTP_DRAWN và InternalAcceptanceEvidence. Bằng chứng có Resident, invitation, snapshot/source hashes, consent version cố định theo nhánh, thời gian, PNG nét ký, PDF chấp thuận và Owner confirmation. Audit Tenant anonymous có actor null; subject là Resident trong evidence, không giả danh Owner/User.
- PDF source giữ nguyên; trang bằng chứng chấp thuận được thêm riêng. Source/accepted/final hashes kiểm tra lại khi đọc/kích hoạt. Tất cả file private; orphan cleanup nhận diện reference mới và giữ bằng chứng đã liên kết.
- Signed subject nội bộ là Resident. User ID provision sau Active không thay signed snapshot. Chế độ MySign/simulator hiện có không được dùng để xác nhận nhánh nội bộ.
- Transaction theo khóa ledger → Location → Room; ghi acceptance lặp với cùng nét là idempotent, nét khác bị từ chối. Main activation/accounts/resident links/job intents commit cùng nhau. User mới có mật khẩu khởi tạo ngẫu nhiên không được phát hành, chưa EmailConfirmed cho đến khi chấp nhận lời mời.
- Gửi email ngoài transaction tài chính. Durable job không tự gửi lại khi đã dispatch hoặc kết quả SMTP mơ hồ; Owner có thể retry lời mời sau kiểm tra. Grant đang còn hiệu lực do Owner tạo được bảo toàn trước automatic job. Provider accepted không đồng nghĩa đã tới inbox.

## Cấu hình và giới hạn thực thi

AnonymousSigning__OtpHmacKey: Base64 khóa riêng >=32 bytes từ secret local, không commit. AnonymousSigning__PublicSigningUrl: trang HTTPS đã duyệt, không query/fragment; nếu bỏ trống email chỉ dẫn dán mã trong Mobile. NotificationChannels dùng SMTP cấu hình hiện có. Sandbox notification không được coi là kênh nhận OTP thực.

Chưa có SMTP, bank, MySign credentials: delivery/provider thật BLOCKED. Integration tests dùng delivery/storage test doubles tường minh; PDF renderer, HMAC, backend, PostgreSQL và Identity token flow chạy thật trong test. Component tests không chứng minh native Android/iOS UI E2E.
