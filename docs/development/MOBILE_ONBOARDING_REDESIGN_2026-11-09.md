# Mobile onboarding và hợp đồng nháp — 09/11/2026

Phạm vi: Staff, BF-03/BF-04, UC-13..15, GBR-01/02/04/07, bảo vệ định danh và phân quyền theo Location. Yêu cầu thay đổi trực tiếp của người dùng ngày 09/11/2026 là nguồn cho việc rút gọn UI, bổ sung email liên hệ và bỏ ô nơi cấp khỏi form hợp đồng. SRS/SDS trong `docs/reports` không tìm thấy yêu cầu riêng về ô nơi cấp trên form tạo nháp khi đối chiếu văn bản. Không thay đổi identity confirmation, signing, payment hoặc activation workflow.

## Luồng mới

1. Chọn Location/Room từ capture API có scope. Room trả thêm `status` và `capacity`; form nhận người loại phòng không ở trạng thái Available/Occupied. Không suy đoán occupancy từ số hồ sơ Pending. Capacity chỉ hiển thị khi server cung cấp; kiểm tra trùng kỳ/occupancy khi lập hợp đồng vẫn ở Backend.
2. Thêm người ở, chọn nhóm/gia đình hoặc cá nhân và người đại diện. Resident IDs được giữ khi quay lại; các hồ sơ đã tạo không được tạo lại do thao tác Back. Nhóm cá nhân có lựa chọn người thuê để lập từng hợp đồng riêng.
3. OCR hai mặt hoặc nhập thủ công, đối chiếu và xác nhận từng người qua API. Chỉ response khớp Resident ID và `verificationStatus=1` mới bật Verified. Kết quả hiển thị gọn trên item; bỏ bước review/success onboarding lặp. Khi đủ hồ sơ, một nút **Tiếp tục tạo hợp đồng** chuyển các reference IDs sang màn nháp.

## Mở lại Resident

`ResidentProfile.tsx` lấy trạng thái từ API summary đã scope, không tin cờ Verified trên navigation. Pending mở wizard; Verified hiển thị label/Location/Room/type/timestamp và thông báo lưu an toàn; Rejected hiển thị hướng dẫn kiểm tra hồ sơ. Không tải hay giải mã CCCD trên client, không có nút OCR lại hồ sơ Verified.

Thao tác **Xem / chuẩn bị hợp đồng** đọc danh sách và detail hợp đồng được phép để kiểm tra Resident đã thuộc Draft/PendingSigning/PendingActivation/Active hay chưa. Nếu có thì mở bản hiện hữu. Nếu không, đại diện có thể vào preparation; co-occupant phải chọn đại diện qua màn chuẩn bị hiện hữu. Kiểm tra FE không thay thế guard duplicate/race Backend. Với hơn 25 trang, chuyển tới danh sách thay vì kết luận không có hợp đồng.

## Form hợp đồng

- Bốn phần: Thông tin phòng → Người thuê → Điều khoản thuê → Ghi chú. Giá/cọc/chính sách lấy từ preparation theo ngày bắt đầu; khi đổi ngày, gọi lại preparation. Không cho Staff tự thay server-calculated amounts.
- Thêm email liên hệ có trim, validation, bàn phím email; chỉ prefill email của account đã liên kết với đúng Resident đại diện, qua read scope hiện hữu.
- Bỏ input/validation nơi cấp khỏi Mobile. Trường supplement `TenantPlaceOfIssue` cũ vẫn tồn tại trong DTO/metadata và được bảo toàn khi mở nháp cũ; cho phép rỗng ở nháp mới. Renderer bỏ phần “tại:” nếu không có giá trị, không chèn dữ liệu mẫu. Không sửa dữ liệu identity Verified, không xóa field/database.
- Một notice cấu hình. Backend hiện yêu cầu đủ Owner settings và giá ngay từ SaveAsync, nên cả lưu nháp và preview bị chặn khi có blockers; không nới điều kiện chỉ để bật nút. Staff không được hiển thị nút cấu hình Owner.
- Thanh nút trong vùng safe area/keyboard avoidance: Lưu nháp là secondary, Xem trước hợp đồng là primary. Lưu xong giữ form và ID/version; preview dùng bản đã lưu và generate API, không activate. Web dùng safe-area context của app, tránh provider lồng đo sai inset làm vùng cuộn bằng 0. Native giữ provider trong modal.
- Lỗi ở các màn bị ảnh hưởng hiển thị inline một lần, giữ input; success có toast. Chỉ ghi log allowlisted workflow/status/correlation ID, không log payload, ảnh, CCCD hay email. Mutations giữ lock/idempotency và kiểm tra response.
- Nếu POST tạo Resident timeout/5xx và chưa nhận được ID, khóa gửi lại item đó và hướng tới danh sách để kiểm tra kết quả, vì API tạo Resident hiện chưa có idempotency contract. Không tự đoán hồ sơ qua display name hoặc tạo lại sau lỗi không rõ kết quả.

## Email: hợp đồng API và persistence

Invitation hiện tại `POST /residents/{id}/invitation` chỉ cho Owner và yêu cầu tenancy Active; không thể dùng endpoint này để Staff lưu email lúc tạo Main Draft. Không mở rộng quyền invitation.

Thay đổi tối thiểu: thêm `tenantEmail?: string | null` vào `MainDraftInput`, validate email/256 ký tự ở Backend và trim trước khi hash/save. Email là **liên hệ của nháp**, nằm trong MainDraftState đã mã hóa bằng pipeline `IMainDraftData.Protect` hiện hữu. Save/Get trả lại field này; không thêm bảng/cột/migration, không đổi account email, không tạo account hay gửi lời mời. Preparation chỉ trả email linked account cho đại diện. Field null bị bỏ khi serialize để giữ compatibility snapshot của nháp cũ.

## APIs được dùng lại

- `GET /api/v1/capture/locations`, `/capture/locations/{id}/rooms`, `/capture/locations/{id}/residents`.
- `POST /api/v1/capture/residents`, `/capture/residents/{id}/confirm`.
- `POST /api/v1/ocr/identity/{residentId}/{front|back}`; ảnh vẫn transient, xác nhận người dùng vẫn bắt buộc.
- `GET /api/v1/contracts` và `GET /api/v1/contracts/{id}` để tìm bản hiện hữu.
- `GET /api/v1/contracts/main-drafts/preparation`; `POST/PUT /contracts/main-drafts[/{id}]`; `GET /contracts/main-drafts/{id}`; `POST /contracts/main-drafts/{id}/documents`; download/preview endpoints hiện hữu.

## Kiểm chứng và giới hạn

- Backend Release build: 0 warnings/errors.
- 9 Compact24 MainDraft integration tests PASS trên PostgreSQL Docker riêng, database ngẫu nhiên do fixture tạo rồi dọn; có kiểm tra email roundtrip, ciphertext không chứa email, invalid email, replay không tạo trùng, cross-location, private documents và release/signing guards.
- Mobile: **854 tests PASS / 68 files**, typecheck PASS, lint PASS, chạy bằng Node 22 trong `.tools`; gồm routing Verified/Pending/Rejected, kiểm tra hợp đồng hiện hữu, email, Back, lỗi OCR/confirm, duplicate save, camera cleanup và scope.
- Browser layout dùng Chrome headless ở 360×780, 320×600 và viewport thu ngắn 360×480; API responses tổng hợp được chặn trong browser test, không gửi login/mutation thử vào Neon. Form thật được render, scroll area có chiều cao, footer nằm trong viewport và không overflow ngang. Ảnh kiểm tra nằm trong `.tools/onboarding-visual/`. Không coi browser emulation là kiểm thử Android/iOS native hoặc bàn phím vật lý.
- Chưa nghiệm thu full E2E trên Neon, camera/OCR native, delivery invitation hay MySign/provider thật. Email liên hệ chưa thay cho account invitation/acceptance. Không seed/reset/migrate Neon trong thay đổi này. Audit ngày 08/11 vẫn là baseline riêng, không tự đổi verdict READY.

## File chính

- Mobile: `screens/OnboardingScreen.tsx`, `screens/StaffWorkflowScreens.tsx`, `features/onboarding/{ResidentProfile,IdentityWizard,IdentityPersonCard,OnboardingPeopleStep,useCaptureScope,onboarding}`, `features/contracts/MainDraftScreen.tsx`, `lib/{api,useFeedbackState,workflowFailure}`.
- Shared client: `packages/client-core/src/mainDrafts.ts`.
- Backend: `MainDraftContracts.cs`, `MainDraftService.cs`, `MainDraftData.cs`, `MainDraftRenderer.cs`, `CaptureContracts.cs`, `CaptureRepository.cs`.
- Tests: `resident-profile.test.tsx`, `onboarding-ui.test.tsx`, `main-draft-screen.test.tsx`, `MainDraftApiTests.cs`, `Compact24WorkflowRegressionTests.cs`.

## Kiểm tra bổ sung: tạo và xem PDF trên Mobile

Sau phản hồi không xem được PDF, đã sửa hai vấn đề ở client:

- Transport trước đây hủy mọi request sau 15 giây, trong khi mỗi lượt chuyển DOCX→PDF hoặc PDF→PNG có deadline Backend 45 giây. Chỉ hai loại request conversion được phép chờ tối đa 60 giây; các request thường vẫn 15 giây. Không tự retry POST tạo tài liệu khi timeout. Có thông báo riêng giữ nguyên bản nháp.
- Modal PDF toàn màn hình trên Web dùng lại safe-area context của app, tránh provider lồng làm vùng hiển thị co về 0; Native giữ SafeAreaProvider. Lỗi preview hiện inline một lần, log chỉ correlation ID/status cho chẩn đoán.

Kiểm chứng bổ sung:

- **858 Mobile tests / 69 files PASS**, gồm bốn test deadline: generation/page cần hơn 15 giây vẫn hoàn tất, conversion bị chặn ở 60 giây, request thường vẫn bị chặn ở 15 giây và timeout generation không replay POST.
- `Compact24MainDraftRegressionTests.RealPdfAndPages` PASS: PostgreSQL tạm, storage substitute, Docker converter thật; tạo PDF có chữ tiếng Việt từ DOCX, download, kiểm kích thước trang, render PNG đầu/cuối, kiểm PNG thực, quyền Staff/Owner/anonymous/Tenant/cross-location, stale document và regeneration. Fixture dùng BHomePersistenceContext để chạy trên Compact24. Container test đã dọn.
- Chrome viewport 360px hiển thị được trang PNG của PDF tổng hợp ở chế độ toàn màn hình; không có page error, viewport không co về 0. Ảnh `.tools/onboarding-visual/pdf-fullscreen-360.png`; PDF và các trang tổng hợp ở `.tools/pdf-check-artifacts`.
- Không phát sinh mutation nghiệp vụ thử trên Neon. Chưa xác định duy nhất nguyên nhân của lần bấm lỗi trên thiết bị người dùng khi chưa có status/code/correlation ID của lần đó; không dùng các test trên để tuyên bố Native/live E2E đã nghiệm thu.
