# Tenant Mobile triển khai ngày 04/11/2026

## Kết quả và phạm vi

Đã triển khai Dashboard, màn Phòng của tôi, lịch sử điện nước, điều hướng điều chỉnh hóa đơn, tổng hợp lịch sử thanh toán/công nợ và các giao diện còn thiếu theo khả năng API hiện có. Chưa thể hoàn thành các luồng lưu sự cố, theo dõi yêu cầu sự cố, sửa hồ sơ, lưu kết quả tạm trú và xác nhận ý định gia hạn vì backend chưa có hợp đồng tương ứng. Các màn này không gọi endpoint tự đặt, không giả lập đã lưu hoặc đã gửi thông báo.

Không sửa backend, database, cơ chế phân quyền, mẫu hợp đồng hoặc logic đối soát. Không thiết kế lại Staff. Các thay đổi Staff đang có từ lượt trước được giữ nguyên; thay đổi shared shell trong lượt này bổ sung hành vi riêng cho Tenant.

Căn cứ: yêu cầu Tenant Mobile mới của người dùng; Report 3 trong `docs/reports/BHome_Report-3_Software Requirement Specification (2).docx`; root/mobile AGENTS.md; controllers và DTO thực tế. Liên quan UC-01..03, UC-14..21, UC-23..30 và thông báo; GBR-01/02 về phạm vi dữ liệu, GBR-04 về ký hợp đồng, GBR-06 về tạm trú ngoài BHOME, GBR-07 về xác nhận OCR, GBR-10 về thanh toán và GBR-13 về thông tin nhạy cảm. UC-18 chi tiết vẫn nhắc Staff trong tài liệu cũ; tuân theo GBR-06 và yêu cầu hiện tại: Tenant đăng ký ngoài BHOME, Owner xác nhận chỗ ở, không thêm Staff vào luồng.

## Trạng thái triển khai

Các nhãn dưới đây tách kiểm thử tự động với nghiệm thu đầu-cuối. Test UI dùng API giả lập có kiểm soát, không chứng minh provider, ngân hàng, camera native hoặc database thật đã được nghiệm thu.

- **Implemented and tested:** điều hướng/phân quyền route Tenant, xử lý số tiền thập phân chính xác, ẩn hướng dẫn chuyển khoản cũ khi số tiền không còn khớp, kiểm tra ảnh và cách ly dữ liệu tài khoản trước. Có test tự động cho các hành vi này; chưa phải chứng nhận bảo mật toàn hệ thống.
- **Implemented but not end-to-end tested:** Dashboard, Phòng của tôi, điện nước từ hóa đơn, tổng hợp lịch sử thanh toán và công nợ, lối vào điều chỉnh hóa đơn, đọc định danh phiên và đăng xuất. Đã chạy test UI với request/response giả lập và build web; chưa chạy trên thiết bị/API/database thật trong lượt này.
- **UI implemented, API missing:** biểu mẫu sự cố có phạm vi phòng, mức độ, mô tả và ảnh tạm; trang yêu cầu; giao diện hướng dẫn và bản nháp kết quả tạm trú; phần thông tin hồ sơ chưa có nguồn dữ liệu. Không có nút lưu/gửi giả.
- **Blocked by Backend:** tạo sự cố thật, nhận kết quả đã lưu, danh sách/chi tiết/lịch sử xử lý sự cố và ảnh riêng tư, cập nhật hồ sơ, lưu trạng thái/bằng chứng tạm trú, xem toàn bộ chỉ số trước khi có hóa đơn và ghi ý định gia hạn.
- **Not implemented:** trạng thái/kiểm kê tài sản hiện tại độc lập với biên bản bàn giao khi chưa có nguồn Tenant được cấp quyền; chọn ảnh thư viện native riêng. Native dùng camera hiện hữu; web có chọn file JPEG/PNG.

## Giao diện và điều hướng

- Header navy có vai trò khách thuê, cơ sở/phòng từ hợp đồng đang hiệu lực và badge thông báo hiện hữu. Không lấy tên mẫu hoặc suy ra tên từ tài khoản khác.
- Bốn tab Tenant: Trang chủ, Hóa đơn, Yêu cầu, Cá nhân. Thông báo tiếp tục mở từ header. Các tab Owner/Staff giữ nguyên.
- Dashboard dùng thẻ tổng quan, hóa đơn cần chú ý, danh mục hai cột và chỉ số điện nước của kỳ đang hiển thị. Bốn tiện ích đầu tiên là Phòng của tôi, Hóa đơn, Báo sự cố và Yêu cầu của tôi; mở “Tất cả chức năng” để xem 11 lối tắt trong ba nhóm.
- Nợ đến hạn sớm nhất lấy từ `/api/v1/debts`, không bỏ qua nợ của kỳ cũ. Khi không có nợ trong phản hồi, Dashboard dùng hóa đơn tháng hiện tại trong trang hóa đơn được tải; danh sách hóa đơn đầy đủ vẫn phân trang ở màn Hóa đơn.
- “Cần chú ý” chỉ hiện khi có nợ, nhắc hết hạn từ server hoặc thông báo chưa đọc. Không tạo số đếm yêu cầu/sự cố hoặc nhiệm vụ tạm trú không có API.
- Bản nháp hóa đơn hiển thị tổng tạm tính; thanh toán nằm trong chi tiết hóa đơn Final. Trạng thái Paid/Unpaid vẫn từ backend; nhãn “Đã thanh toán một phần” chỉ diễn giải paidAmount và outstandingAmount đã được backend trả về.
- Lối tắt Điều chỉnh đi tới `invoice` với `focus=adjustment`. Route `adjustment` cũ cũng dùng cùng màn chọn hóa đơn và `TenantAdjustmentPanel`, không tạo form nghiệp vụ thứ hai.
- Lối tắt hợp đồng và bàn giao truyền ID hợp đồng hiện tại khi có. Ký, chấm dứt trước hạn, xác nhận bàn giao và xem kết quả trả phòng dùng màn ContractScreen hiện hữu.
- Các màn mới có back trong shared shell: quay lại lịch sử khi có, hoặc về route dự phòng khi mở trực tiếp. Chỉ Tenant được mở `tenant-room`, `tenant-requests`, `tenant-meters`.
- Nội dung Tenant được remount theo tài khoản; query không giữ dữ liệu API/đường dẫn cũ khi chuyển phiên. Thay đổi deep link hóa đơn cũng reset lựa chọn để mở đúng hóa đơn mới.

## API được tái sử dụng

- `GET /api/v1/contracts` với status Active, phân trang: chọn phòng/hợp đồng. Loại Holding không được coi là phòng đang thuê.
- `GET /api/v1/contracts/{id}` và `GET /api/v1/contracts/{id}/handover`: phòng, nhãn người ở được backend cho phép và hiện trạng tài sản tại ngày bàn giao. Không hiển thị thêm CCCD hoặc định danh sâu.
- `GET /api/v1/contracts/expiry-reminders`: nhắc hết hạn có sẵn, không tự đặt thời hạn nhắc.
- `GET /api/v1/invoices` và `GET /api/v1/invoices/{id}`: hóa đơn nháp/chính thức, chỉ số đã xác nhận trong các dòng hóa đơn. Màn điện nước không gọi capture API của Staff và không hiển thị OCR proposal.
- `GET /api/v1/debts`, `GET /api/v1/payment-history`, `GET /api/v1/invoices/{id}/payment`, `GET /api/v1/invoices/{id}/transfer-instructions`: nợ, lịch sử đã xác minh, mã giao dịch được cấp quyền và hướng dẫn chuyển khoản.
- Các API invoice adjustment và form hiện hữu tiếp tục được sử dụng trong chi tiết hóa đơn, gồm gửi yêu cầu, ảnh và theo dõi quyết định.
- Các API notifications hiện hữu: danh sách chưa đọc, đếm chưa đọc, đánh dấu và phân giải hồ sơ. Chưa có target sự cố thực tế để mở chi tiết yêu cầu mới; không dựng route detail hoặc trạng thái sự cố giả.
- `GET /api/v1/auth/me`: xác thực vai trò hiện tại. DTO này chỉ có định danh phiên/tài khoản và vai trò; không phải API hồ sơ. Đăng xuất và đổi mật khẩu dùng cơ chế hiện hữu.

## Thanh toán nhiều người ở

Tiếp tục dùng ID hóa đơn chung và InvoiceRecipient/authorization của backend, không nhân bản hóa đơn theo người xem. Không ghi thanh toán hoặc thay đổi trạng thái từ frontend. Hướng dẫn chuyển khoản chỉ hiện khi backend còn trả Unpaid, số tiền còn phải trả dương và số tiền trong hướng dẫn khớp với trạng thái thanh toán.

Payment panel làm mới khi focus, khi người dùng yêu cầu và mỗi 30 giây khi đang focus; ngừng timer khi rời màn. Khi đã Paid, không hiển thị thao tác sao chép chuyển khoản. Payer và bank reference chỉ hiển thị nếu DTO được cấp quyền đã trả về. Đồng bộ giữa nhiều thiết bị thật sau đối soát chưa được chạy đầu-cuối trong lượt này.

## Hợp đồng backend còn thiếu

Đây là các khả năng cần bổ sung, không phải endpoint đã tồn tại hoặc đường dẫn API do frontend tự định nghĩa:

1. **Hồ sơ của tôi:** đọc tên/thông tin liên hệ được phép; định nghĩa chính xác whitelist trường tự sửa, validation, concurrency và phản hồi sau lưu. Trường định danh đã xác minh phải đi qua quy trình xác minh tương ứng. Auth/me hiện không cung cấp các trường này.
2. **Gửi sự cố:** xác định phòng/cơ sở được phép, phạm vi vấn đề, severity Normal/Emergency, nội dung và ảnh tối đa 5 ảnh/5 MB; cơ chế upload riêng tư; trả ID, trạng thái, thời điểm đã lưu và lỗi xác thực/phân quyền. Backend chịu trách nhiệm persistence, chống gửi lặp và thông báo khẩn cấp. Chưa có controller/DTO/client tương ứng.
3. **Yêu cầu sự cố của tôi:** danh sách phân trang, phạm vi tài khoản, trạng thái do backend định nghĩa, chi tiết, ảnh được cấp quyền, timeline cho Tenant và kết quả xử lý. Không cấp quyền duyệt chi phí, giao việc hoặc thay quyết định Owner cho Tenant.
4. **Tạm trú:** thông tin chỗ ở/chủ cơ sở được phép cung cấp; trạng thái và thời điểm đăng ký; cập nhật kết quả/bằng chứng riêng tư; quy trình Owner xác nhận. Không cần và không được hiểu là API gửi hồ sơ tới VNeID/chính phủ; không có Staff đăng ký thay.
5. **Chỉ số trước hóa đơn:** truy vấn theo tenancy/kỳ để lấy chỉ số trước, chỉ số đã xác nhận, mức tiêu thụ và thời điểm xác nhận. CaptureController hiện chỉ cho Owner/Staff. Invoice Draft/Final đã có dữ liệu đọc được nên vẫn hoạt động; khi chưa có hóa đơn, chưa thể xem đủ lịch sử tháng độc lập.
6. **Ý định gia hạn:** thao tác Tenant ghi nhận nhu cầu, phản hồi/trạng thái và phiên bản. API renewals hiện dành cho Owner/Staff chuẩn bị hợp đồng; không biến nó thành quyền Tenant tự gia hạn hoặc kích hoạt. Tenant vẫn xem và ký bản gia hạn được tạo theo luồng hiện hữu.
7. **Thông tin phòng hiện tại:** DTO Tenant nếu cần trạng thái vật lý phòng, địa chỉ cơ sở chi tiết và kiểm kê mới nhất. Hiện chỉ dùng hợp đồng và snapshot bàn giao, có ghi rõ ngày; không tuyên bố đó là kiểm kê hiện tại.

## Tệp mới và đã sửa trong lượt Tenant

Tệp mới:

- `src/mobile/src/features/tenant/useTenantTenancy.ts`
- `src/mobile/src/features/tenant/paymentPresentation.ts`
- `src/mobile/src/components/TenantFeatureDirectory.tsx`
- `src/mobile/src/components/TenantEvidenceDraft.tsx`
- `src/mobile/src/screens/TenantRoomScreen.tsx`
- `src/mobile/src/screens/TenantMeterHistoryScreen.tsx`
- `src/mobile/src/screens/TenantServiceScreens.tsx`
- `src/mobile/src/screens/TenantProfileScreen.tsx`
- Tài liệu bàn giao này.

Tệp sửa:

- `src/mobile/src/screens/TenantDashboard.tsx`
- `src/mobile/src/screens/TenantDashboardScreen.tsx`
- `src/mobile/src/screens/TenantInvoicesScreen.tsx`
- `src/mobile/src/screens/TenantPaymentPanel.tsx`
- `src/mobile/src/screens/NotificationsScreen.tsx` (thông báo lỗi riêng cho Tenant khi chưa có màn detail phù hợp).
- `src/mobile/src/app/workspace/[screen].tsx`
- `src/mobile/src/features/workspace/navigation.ts`
- `src/mobile/src/components/WorkspaceShell.tsx` (nhánh Tenant).
- `tests/mobile/ocr/liveWorkspace-ui.test.tsx`
- `src/mobile/src/__tests__/workspace-navigation.test.tsx`
- `src/mobile/src/__tests__/onboarding-state.test.ts`

## Kiểm chứng

- `npm run typecheck --workspace ./src/mobile`: PASS.
- `npm run lint --workspace ./src/mobile`: PASS.
- `npm run lint` toàn repository: PASS.
- `npm run format:check`: PASS.
- `npm run test --workspace ./src/mobile` bằng Node 22 trong `.tools`: 41 file, 396 tests PASS.
- Sau thay đổi header cuối, chạy lại hai file UI/điều hướng liên quan: 51 tests PASS; TypeScript, lint toàn repo và export web chạy lại đều PASS.
- `expo export --platform web --output-dir ../../.tools/tenant-mobile-web`: PASS; output ignored, không publish.
- Test mới kiểm tra room API/biên bản bàn giao, dữ liệu bị từ chối, chuyển tài khoản không lộ dữ liệu trước, loại Holding, Draft meter readings không lộ proposal, incident/residence không POST giả, profile không lộ session IDs và logout có hủy, nợ/ledger/reference, hướng dẫn chuyển khoản cũ, số tiền lớn không mất chính xác, ưu tiên nợ kỳ cũ, target thông báo sai quyền, điều chỉnh hóa đơn và deep link đổi hóa đơn.
- Kiểm tra trực quan và native/device: NOT RUN. Computer Use báo không kết nối được browser host/native pipe. Chưa chạy camera/ảnh trên điện thoại thật, MySign/VNeID thật, đối soát ngân hàng thật hoặc PostgreSQL integration/end-to-end.
- Không commit, push, deploy, tạo migration hoặc gọi API lưu sự cố/tạm trú/hồ sơ không tồn tại.
