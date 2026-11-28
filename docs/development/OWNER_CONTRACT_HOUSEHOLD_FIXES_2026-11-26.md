# Sửa luồng hợp đồng, email và hộ gia đình — 26/11/2026

Nguồn quyết định: yêu cầu trực tiếp của người dùng ngày 26/11/2026 (11 mục và ảnh lỗi). Nhánh làm việc `member/QHuy`; working tree sạch trước khi sửa. Không triển khai, push hoặc sửa dữ liệu Staging trong tác vụ này.

## Truy vết và tiêu chí chấp nhận

| Yêu cầu                                                                      | Nguồn liên quan                                                                                           | Thành phần                                 | Kiểm chứng cần thực hiện                                                                                           |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Mở lời mời không bị khóa do thao tác Owner; vẫn chặn lạm dụng OTP            | BF-03/04, UC-13–15, GBR-04/18; quyết định ký nội bộ đã ghi trong `docs/api/ANONYMOUS_CONTRACT_SIGNING.md` | API rate limiter, trang ký                 | Tách ngân sách Auth/đọc trạng thái/OTP; OTP sai và gửi lại vẫn bị giới hạn                                         |
| PDF không giãn chữ, không sửa bản đã ký                                      | UC-14/15, GBR-04                                                                                          | DOCX layout                                | Nội dung nhiều dòng căn trái; giữ hash và file đã phát hành                                                        |
| Email không lỗi logo và không kèm PNG                                        | FE-07, JOB-04                                                                                             | MIME/email template                        | HTML có tên BHome, không CID/ảnh; vẫn giữ PDF hợp lệ                                                               |
| Thông báo, danh sách/chi tiết/ký Owner gọn, phân trang và phân biệt hợp đồng | UC-14/15/31, GBR-01/02                                                                                    | Owner Web                                  | Chọn thông báo để đọc; nhận diện loại/phòng/đại diện; phân trang và PDF                                            |
| Chọn đúng người giữ chỗ/đại diện theo họ tên, CCCD                           | UC-13/14, GBR-01/02/13                                                                                    | Chuẩn bị hợp đồng, hồ sơ đã mã hóa, picker | Dữ liệu tên từ hồ sơ; tìm tên/số định danh; không mở rộng dữ liệu nhạy cảm cho Staff                               |
| Phí theo người tính bằng sức chứa phòng, không thu riêng khi thêm người      | BF-05/06, UC-21/22; quyết định mới của người dùng                                                         | Tính hóa đơn, phí cuối kỳ                  | Phòng 3 chỗ, 2 người vẫn tính 3; thêm người không sinh phí riêng; không sửa hóa đơn Final                          |
| Chỉ đại diện cần hồ sơ đầy đủ, người cùng ở có/không có định danh            | BF-03/04, UC-13/14, GBR-13                                                                                | Household profile, form Mobile             | Có CCCD/số định danh/để trống; vẫn đếm người và chặn vượt sức chứa                                                 |
| Tạm trú riêng từng thành viên, đại diện cập nhật, minh chứng chung           | BF-04, UC-18, GBR-06, JOB-08; nghiệp vụ mới người dùng đã chốt                                            | Residence service/repository/clients       | Đại diện chỉ sửa trong cùng hợp đồng; Owner xác nhận; không lộ minh chứng cho Staff; mỗi người có trạng thái riêng |

## Quyết định áp dụng

- Phí `FixedPerPersonPerMonth` dùng sức chứa phòng làm số lượng tính phí; số người thực tế vẫn phục vụ kiểm tra sức chứa và theo dõi từng người. Không tự chia khoản tiền giữa người thuê. Hóa đơn đã chốt giữ bất biến.
- Người ở cùng dùng hồ sơ rút gọn (họ tên, ngày sinh, quan hệ; điện thoại và số định danh không bắt buộc). Không lưu ảnh căn cước.
- Tenant đăng ký chính thức bên ngoài BHOME; đại diện cập nhật kết quả cho thành viên cùng hợp đồng. Owner kiểm tra/xác nhận. Staff chỉ có dữ liệu theo dõi tối thiểu theo quyền, không minh chứng/định danh cư trú.
- Không suy đoán thời hạn pháp lý, diện miễn đăng ký hoặc nhịp cảnh báo chưa được cấu hình. Giữ thời hạn nhập/xác nhận theo mô hình hiện có; ghi rõ khoảng trống nếu thiếu.

## Kết quả thực hiện

Đã sửa các nhóm trong yêu cầu:

1. Tách rate limiter public signing khỏi Auth và polling Owner; giữ giới hạn gửi/đoán OTP từng lời mời. Trang ký có nút tải lại khi chưa đọc được lời mời.
2. DOCX căn trái nội quy nhiều dòng, không giãn chữ do manual line break; tăng `MainDraftRenderer.DocumentVersion` lên 4 để tạo lại bản nháp đúng phiên bản. File đã ký giữ nguyên.
3. Email dùng chữ BHome, không CID/logo PNG hoặc tài nguyên ảnh đính kèm; giữ hai PDF được kiểm tra nội dung/tên file.
4. Thông báo dùng hết chiều rộng danh sách khi chưa chọn, bấm trực tiếp để đọc, mở hồ sơ liên quan bằng nút riêng. Mobile có quay lại danh sách.
5. Tên người giữ chỗ/đại diện lấy từ hồ sơ đã xác nhận. Owner chọn/tìm theo tên và số CCCD; Staff thấy tên và CCCD che, tìm bằng tên/4 số cuối. Không mở quyền Staff xem CCCD đầy đủ.
6. Tính phí theo sức chứa ở thanh toán ban đầu, hóa đơn định kỳ và phí cuối kỳ. Người vào thêm chia sẻ nghĩa vụ phòng hiện có, không thu thêm khoản riêng, kể cả tháng sau. Nợ phòng cũ giữ ở hóa đơn hiện có; thiếu chứng từ nguồn vẫn cần rà soát.
7. Khôi phục bước người giữ chỗ trên Mobile (trước đó bị bỏ qua và lấy tên phòng làm tên mặc định). Chọn đại diện không cho chọn co-occupant. Chi tiết ưu tiên PDF snapshot; gấp phần tiến trình, giá phí và lịch sử.
8. Owner có tab loại hợp đồng, lọc server trước phân trang, 10 hợp đồng/trang, tên đại diện/phòng/mã rút gọn. Bổ sung nhãn Holding/Addendum đang thiếu.
9. Ký Owner chỉ hiện trạng thái hai bên, PDF, thao tác cần làm; tùy chỉnh vị trí chữ ký nằm trong phần mở rộng. Vẫn có chấp thuận và kiểm tra backend.
10. Biểu mẫu thành viên có ô số CCCD/số định danh tùy chọn; không cần ảnh căn cước/hồ sơ đầy đủ như đại diện. Tên từng thành viên được giải mã đúng để phân biệt trên hợp đồng/tạm trú; không thay kiểm tra số người của phòng.
11. Đại diện cập nhật từng thành viên cùng hợp đồng, dùng chung một minh chứng theo danh sách chọn trong transaction; Owner quản lý diện đăng ký/hạn theo hồ sơ thực tế và xác nhận từng người. Cảnh báo hết hạn từ 15 ngày trước, dedup theo thành viên/ngày/giai đoạn. Staff có màn hình/API tracking tối thiểu theo Location hiện hành, không minh chứng/định danh/lịch sử nhạy cảm. Chi tiết contract: `docs/api/HOUSEHOLD_RESIDENCE.md`.

## Kiểm chứng và giới hạn

Evidence, TRX, log và ảnh local nằm trong `.tools/owner-contract-household-20261126/`. Bộ kiểm tra cuối được ghi sau khi chạy hoàn tất. Dữ liệu đều synthetic, PostgreSQL disposable trên loopback; không dùng dữ liệu Staging.

- Browser QA dùng API trả lời synthetic trên cùng máy để kiểm tra layout/thao tác ở 1440px và 390px; không phải nghiệm thu tích hợp Staging.
- PDF DOCX→LibreOffice thực sự được tạo/render và kiểm tra cả nội dung, vị trí hai bên ký. Email được kiểm tra MIME/SMTP capture; không gửi thư thật tới người dùng hoặc xác nhận Gmail đã nhận.
- Không commit/push/deploy hoặc chạy migration trên server. Email đã gửi và PDF đã ký trước đây không thể được sửa bằng thay đổi mã nguồn này.
- Worker thông báo cần hoạt động để tự phát cảnh báo; không đổi các cờ jobs đang tắt trên Staging. Không tự áp thời hạn pháp lý/miễn đăng ký cho trẻ em.

### Kết quả kiểm tra cuối

| Nhóm                                                                                                                                                                                        | Kết quả thực chạy                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Infrastructure unit: MIME email, layout DOCX, tên hồ sơ và xóa buffer plaintext                                                                                                             | 24 PASS, 0 skip                                                                                                                                                                                 |
| Application unit: phí theo sức chứa, coverage và đếm người thực tế                                                                                                                          | 11 PASS, 0 skip                                                                                                                                                                                 |
| Integration chọn lọc: PostgreSQL disposable, OTP rate isolation, SMTP capture, household, ký/khoản thu ban đầu/PDF, quyền Tenant/Staff/Owner, upload chung rollback, cảnh báo 15 ngày dedup | 57 PASS, 0 skip                                                                                                                                                                                 |
| Integration phí cuối kỳ ↔ hóa đơn, gồm phòng 3 chỗ có 2 người ở, chống thu trùng và hóa đơn đã chốt                                                                                         | 6 PASS, 0 skip                                                                                                                                                                                  |
| Owner Web: hợp đồng, PDF, ký, thông báo, tạm trú                                                                                                                                            | 58 PASS; thêm 1 ca phân trang/lọc loại mới PASS trong lượt regression 12 ca                                                                                                                     |
| Mobile: giữ chỗ, household, tạm trú Tenant/Owner/Staff và phân quyền điều hướng                                                                                                             | 107 PASS                                                                                                                                                                                        |
| API Release build                                                                                                                                                                           | PASS, 0 warning/error                                                                                                                                                                           |
| Owner Web build/typecheck                                                                                                                                                                   | PASS; build dùng `VITE_API_BASE_URL=https://owner.example.invalid` chỉ để xác minh bundle local, không deploy. Vite còn cảnh báo chunk lớn hơn 500 kB; chưa tối ưu chia bundle trong tác vụ này |
| Mobile typecheck/lint                                                                                                                                                                       | PASS                                                                                                                                                                                            |
| Owner lint                                                                                                                                                                                  | Exit 0; 1 warning có sẵn về `navigate` trong `ContractsNavigation.test.tsx`; không sửa ngoài phạm vi                                                                                            |
| Browser desktop 1440px và mobile 390px                                                                                                                                                      | PASS với API synthetic: chọn loại hợp đồng, đọc thông báo, mở chi tiết; không tràn ngang trang, không page error                                                                                |
| Impeccable detector                                                                                                                                                                         | `[]` cho các màn Owner đã sửa                                                                                                                                                                   |

Các lượt đầu có lỗi biên dịch/projection optional argument/namespace và fixture chữ ký thiếu expiry/reference riêng; đã sửa và chạy lại. Các test giao diện ban đầu còn kỳ vọng luồng bỏ qua người giữ chỗ và bấm thông báo để điều hướng ngay; đã cập nhật theo yêu cầu mới. Build Owner ban đầu thiếu `VITE_API_BASE_URL`, sau đó chạy lại với URL synthetic hợp lệ. Browser harness ban đầu thiếu response Demo Clock nên chưa hiển thị Outlet; đã sửa dữ liệu harness, không thay AppShell/Demo Clock của sản phẩm. Các kết quả PASS trên là lượt sau khi sửa tương ứng.

### File thay đổi

- Backend API/Application/Infrastructure: giới hạn ký, projection tên/hợp đồng, renderer, MIME, tính phí/ledger, residence service/repository và notification publisher.
- Shared client: `packages/client-core/src/contracts.ts`, `residence.ts`.
- Owner Web: danh sách/chi tiết/tạo/ký hợp đồng, thông báo và trang tạm trú.
- Mobile: bước người giữ chỗ, biểu mẫu thành viên, màn tạm trú Tenant/Owner, màn Staff chỉ đọc và cấu hình điều hướng tương ứng.
- Kiểm thử và tài liệu API/nghiệp vụ đi kèm. Danh sách đường dẫn đầy đủ: `.tools/owner-contract-household-20261126/modified-files.txt`.

PostgreSQL disposable đã được dừng/xóa sau kiểm thử; giữ TRX/log và ảnh synthetic để rà soát. `git diff --check` đạt. Ở thời điểm hoàn tất lượt kiểm tra chức năng ban đầu có 65 đường dẫn source/test/docs thay đổi, chưa stage hoặc commit. Lượt kiểm tra CI bổ sung bên dưới cập nhật thêm các regression liên quan.

## Kiểm tra CI bổ sung ngày 26/11/2026

Phạm vi cuối cùng gồm 69 file, được chia thành 12 commit theo chức năng, kèm test của từng phần và một commit tài liệu kiểm thử. Danh sách đường dẫn: `.tools/ci-household-20261126/modified-files.txt`. Các log, TRX, JUnit và công cụ kiểm tra local được Git ignore.

Đối chiếu trực tiếp `.github/workflows/ci.yml` và Dockerfile của pipeline, dùng Node 22.23.4 và .NET SDK 8.0.427. Không thay đổi workflow, test inventory, danh sách skip được duyệt hoặc timeout để bỏ qua lỗi.

Các sửa bổ sung cho CI:

- Chạy formatter cho các file C# bị báo lỗi whitespace và 3 tài liệu Markdown.
- Giữ tên test `InlineBrandPreservesBothExistingPdfAttachmentsExactly` để không làm mất identity trong inventory; assertion tiếp tục kiểm tra email không chứa ảnh và bảo toàn PDF.
- Cập nhật test menu/quyền Mobile theo màn Staff theo dõi tạm trú chỉ đọc; kiểm tra Owner dùng màn riêng.
- Cập nhật regression mẫu hợp đồng sang phiên bản 4 và kiểm tra người ở cùng chưa có tài khoản không chặn lập hóa đơn qua đại diện.

Kết quả đã thực thi:

| Kiểm tra                                                              | Kết quả                                                                                                      |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Restore/build toàn bộ `BHome.sln`, Release                            | PASS, 0 warning, 0 error                                                                                     |
| Root ESLint `npm run lint`                                            | PASS, exit 0                                                                                                 |
| Root Prettier `npm run format:check`                                  | PASS                                                                                                         |
| `dotnet format BHome.sln --verify-no-changes --no-restore`            | PASS sau tất cả cập nhật assertion                                                                           |
| Owner Web toàn bộ                                                     | 1.060 test PASS, 140 file                                                                                    |
| Mobile toàn bộ                                                        | 1.765 test PASS, 166 file                                                                                    |
| Public Web                                                            | 11 test PASS và 16 test trình duyệt PASS                                                                     |
| `Verify-FrontendEvidence.py`                                          | PASS cho cả 4 báo cáo JUnit, không fail/skip                                                                 |
| Build client-core, Owner Web, Public Web                              | PASS                                                                                                         |
| Mobile typecheck và Expo web export                                   | PASS                                                                                                         |
| Docker image API, Owner Web, Public Web                               | PASS trên Linux; web artifact verifier PASS                                                                  |
| Hai cấu hình Docker Compose và script SePay                           | PASS                                                                                                         |
| Bash syntax, test triển khai Python, email preflight, Node deployment | PASS: 90 + 7 Python test, 25 Node test                                                                       |
| Backend CI đầy đủ, discovery, TRX inventory và regression gate        | PASS: 2.668 test, 32 skip đã duyệt; inventory/discovery của 5 assembly và 9 nhóm regression Staging đều PASS |

Các lượt đầu phát hiện format và assertion còn bám nghiệp vụ cũ. Lượt backend đầu cũng gặp timeout PDF/PostgreSQL khi chạy cùng nhiều build; đã dừng lượt dùng assertion cũ, build lại và chạy từ đầu với `DOTNET_PROCESSOR_COUNT=2`, giữ nguyên runsettings và timeout. Lượt Owner đầu có timeout; nhóm router 43 test và toàn bộ 1.060 test đã qua khi chạy lại với kỳ vọng demo gốc.

Evidence CI local nằm tại `.tools/ci-household-20261126/` (được Git ignore). Các kiểm tra này không phải một GitHub Actions run; được thực hiện trước khi commit riêng theo từng nhóm chức năng theo yêu cầu. Chưa push, publish image hoặc triển khai. Cảnh báo kích thước chunk của Vite không làm build thất bại. Registry, runner Ubuntu của GitHub và bước deploy vẫn cần xác nhận trong pipeline sau khi thay đổi được đưa lên nhánh.
