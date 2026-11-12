# Rà soát luồng BF sau khi cập nhật develop — 11/11/2026

## Phạm vi và kết luận

Đối chiếu 9 nhóm BF người dùng liệt kê, tập trung Mobile Owner/Staff/Tenant. BF-01 được đánh giá ở Owner Web theo kênh chính của nghiệp vụ. Nguồn là `develop` tại `f318ffc` cộng các thay đổi local đang làm trên `member/Long`, không phải chỉ riêng commit develop. Rà soát UI live, client/API, các điểm chặn server và test hiện có. Không dùng preview/mock UI làm bằng chứng nối BE.

**Chưa đủ cơ sở xác nhận toàn bộ 9 BF đã hoàn thành.** BF-01 ở Owner Web và BF-07 có các bước chính trong mã nguồn; BF-05 có chuỗi ghi số–hóa đơn nhưng chất lượng OCR và môi trường chạy vẫn cần nghiệm thu. Các nhóm còn lại có thiếu sót hoặc phụ thuộc cụ thể dưới đây. Không nhóm nào được gắn nhãn nghiệm thu E2E thực tế trong lần kiểm tra này.

“Có bước trong code” nghĩa là có UI gọi client và endpoint tương ứng; không có nghĩa provider thật, thiết bị thật hoặc toàn bộ điều kiện dữ liệu đã được chạy thành công. Test component dùng mock transport không phải E2E FE–BE.

## BF-01 — Cơ sở, phòng, tài sản, biểu phí

**Có các bước chính ở Owner Web; mobile chỉ hỗ trợ setup cơ bản.**

- Owner Web đã có native property/configuration consumers; cấu hình tài sản, utility, biểu phí có màn và API, version/history theo khả năng backend. Không dùng trạng thái audit cũ ngày 08/11 để kết luận các màn này vẫn mock.
- Mobile setup mới đã chuyển tạo Location/Room sang `/api/v1/locations`, `/api/v1/rooms`, gửi capacity, không phụ thuộc Chain/RoomType legacy. Đây không phải toàn bộ trình quản lý tài sản/biểu phí trên mobile.
- Nguồn: [setup service](../../src/mobile/src/services/setup.ts), [Owner property features](../../src/owner-web/src/features/property), [configuration status](../api/API_IMPLEMENTATION_STATUS.md).
- 4 file test property được chạy trong tập Owner Web 9 file phía dưới. Chưa kiểm thử browser live/save–reload với database trong lần này.

## BF-02 — Phân công và thực hiện công việc

**Một phần: tác nghiệp công việc đã nối, lịch ca trực chưa hoàn chỉnh.**

- Có chuỗi Owner tạo/phân công → Staff start/progress/blockers/evidence/submit → Owner verify hoặc rework, cùng detail/history.
- Màn `shifts` chỉ đọc cơ sở được phân công. Source ghi rõ chưa có API ca trực; không được tính màn này là lịch làm việc đã hoàn chỉnh.
- Backend hiện đã có `RecurringOperationsJob` được đăng ký DI và phần sinh task định kỳ trong CompactOperationsRepository. Mô tả JOB-06 chưa có trong tài liệu cũ không đủ để phủ nhận implementation hiện tại. Chưa chạy scheduler/deadline ngoài đời trong lần này.
- Nguồn: [task service](../../src/mobile/src/services/operationalTasks.ts), [schedule](../../src/mobile/src/screens/StaffScheduleScreen.tsx), [recurring job](../../src/backend/BHome.Infrastructure/Modules/Operations/RecurringOperationsJob.cs).

## BF-03A — Hợp đồng giữ chỗ và tiền cọc

**Chưa trọn luồng trên mobile.**

- Backend và Owner Web có tạo Holding, approval, verified deposit allocation, activation, cancellation và conversion. Mobile shared actions đã có các quyết định Holding trên hợp đồng tồn tại.
- Chưa tìm thấy mobile form gọi `POST /contracts/holdings` hoặc dùng `holdingDraftPayload`; ContractDraftForm vẫn tạo hợp đồng thuê qua đường Main. Không suy từ action của hợp đồng có sẵn rằng Staff đã tạo được Holding từ đầu trên mobile.
- Owner mobile payment review hiện allocate vào Invoice, chưa có consumer allocate-holding-deposit. Vì vậy nhận cọc giữ chỗ qua ngân hàng chưa khép kín trên mobile.
- Ký thật còn phụ thuộc provider/chứng thư/mẫu được duyệt.
- Nguồn: [mobile draft](../../src/mobile/src/features/contracts/ContractDraftForm.tsx), [mobile decisions](../../src/mobile/src/screens/OwnerDecisionScreens.tsx), [Holding Web contract](../api/HOLDING_OWNER_WEB.md), [shared contract actions](../../packages/client-core/src/contracts.ts).

## BF-03B — Tiếp nhận, OCR CCCD, hợp đồng chính

**Đã nối phần lớn các bước; chưa nghiệm thu toàn luồng.**

- Có tạo/xem hồ sơ cư dân, OCR CCCD và human confirmation; Main Draft review/release, PDF, ký, xác minh cọc, Owner activation, bàn giao Staff/Tenant.
- Đường link/invite tài khoản cần Owner Web khi hồ sơ chưa có Tenant account; chưa tìm thấy mobile consumer invitation/linkTenant. Vì vậy không coi onboarding một người hoàn toàn mới là tự hoàn tất chỉ trong mobile.
- Ký simulation không chứng minh chữ ký pháp lý/provider production đã hoàn tất; chưa thử journey nhiều vai trò với thiết bị và provider thật trong lần này.
- Nguồn: [onboarding](../../src/mobile/src/screens/OnboardingScreen.tsx), [identity](../../src/mobile/src/features/onboarding/IdentityWizard.tsx), [Main Draft](../../src/mobile/src/features/contracts/MainDraftScreen.tsx), [contract workflow](../../src/mobile/src/features/contracts/ContractWorkflowPanel.tsx), [handover](../../src/mobile/src/features/contracts/ContractHandoverPanel.tsx).

## BF-04A — Gia hạn, chấm dứt, trả phòng

**Một phần; chưa đóng kín trả phòng trong mọi trường hợp.**

- Có renewal, termination request/approval, lịch/kiểm tra trả phòng, final readings, inspection review, settlement summary và complete theo điều kiện server.
- Mobile hiện hiển thị khấu trừ/hoàn cọc nhưng chưa tìm thấy consumer duyệt deposit-deductions hoặc tạo/duyệt/execution deposit-refunds. Owner Web có các panel xử lý riêng.
- Server còn chặn `unbilled_final_usage_pending:<utilityType>` nếu Final Invoice chưa bao phủ đúng chỉ số/ngày/công tơ của kiểm tra cuối. Chỉ nhìn thấy summary/complete button không chứng minh phần phát sinh điện nước cuối kỳ đã được giải quyết; chưa tìm thấy luồng riêng tự lập delta utility trong phạm vi rà soát.
- Đây là guard bảo toàn quyết toán, không nên bỏ guard để cho trả phòng thành công.
- Nguồn: [mobile lifecycle](../../src/mobile/src/features/contracts/ContractLifecyclePanel.tsx), [settlement ledger](../../src/backend/BHome.Infrastructure/Contracts/ContractSettlementLedger.cs), [refund API](../api/REFUNDS.md), [deductions API](../api/DEPOSIT_DEDUCTIONS.md).

## BF-04B — Đăng ký và theo dõi tạm trú

**Một phần trên mobile: Tenant đã nối, Owner confirmation còn ở Web.**

- Tenant có list/detail, cập nhật kết quả và minh chứng qua residence client. Đăng ký chính thức thực hiện bên ngoài BHOME qua VNeID.
- Mobile route `residence` chỉ cấp Tenant; chưa có Owner UI gọi owner-confirmation. Owner Web TemporaryResidencePage có chức năng theo dõi/xác nhận.
- Deadline/reminder JOB-08 còn phụ thuộc quyết định nghiệp vụ; không tự kết luận đã hoàn thành từ việc lưu được minh chứng.
- Nguồn: [Tenant residence](../../src/mobile/src/screens/TenantResidenceScreen.tsx), [role routes](../../src/mobile/src/features/workspace/navigation.ts), [Owner residence](../../src/owner-web/src/features/temporary-residence/pages/TemporaryResidencePage.tsx).

## BF-05 — Ghi điện nước, OCR, hóa đơn

**Đã có chuỗi chính trong code; OCR và vận hành cần nghiệm thu thêm.**

- Staff task → chụp ảnh/OCR hoặc nhập tay → human confirmation → confirmed reading; Owner Web cấu hình/tạo/kiểm tra/final hóa đơn hoặc ủy quyền automation; Tenant xem chỉ số/hóa đơn. Staff không được final thay Owner.
- Backend có billing automation JOB-09/10. Chưa xác minh worker/plan/ủy quyền đang bật và chạy đúng lịch ở môi trường người dùng trong lần này.
- Báo cáo OCR hiện tại chưa chứng minh reader đạt ngưỡng >=90% trên bộ >=50 ảnh và chưa nghiệm thu camera thiết bị; manual fallback không có nghĩa OCR đã đạt yêu cầu chất lượng.
- Nguồn: [meter route](../../src/mobile/src/app/meter.tsx), [meter transport](../../src/mobile/src/services/meterService.ts), [Tenant invoices](../../src/mobile/src/screens/TenantInvoicesScreen.tsx), [automation](../api/BILLING_AUTOMATION.md), [OCR results](OCR_NEXT_STAFF_RECOGNITION_RESULTS.md).

## BF-06 — Thanh toán, công nợ, điều chỉnh hóa đơn

**Chuỗi hóa đơn/thanh toán thủ công đã nối; chưa đủ cho toàn bộ phạm vi BF.**

- Tenant xem hướng dẫn chuyển khoản, trạng thái/đã trả/còn nợ/lịch sử và gửi adjustment; Owner mobile mới có list/detail đối soát, allocate/reject, review adjustment. Trạng thái tiền do BE quyết định.
- Bank ingestion/provider thật chưa được nghiệm thu; manual verification là đường hỗ trợ hiện có, không đồng nghĩa ngân hàng tự động đã hoàn thành.
- Staff debt-follow-up vẫn đi vào màn unavailable. Hoàn tiền/cọc/excess chưa có consumer mobile tương ứng, cần Owner Web. Với đúng phạm vi Tenant/Owner chỉ xét thanh toán Invoice và adjustment thủ công, đã có các bước chính.
- Nguồn: [Tenant payment](../../src/mobile/src/screens/TenantPaymentPanel.tsx), [Tenant adjustments](../../src/mobile/src/screens/TenantAdjustmentPanel.tsx), [Owner decisions](../../src/mobile/src/screens/OwnerDecisionScreens.tsx), [payments API](../api/PAYMENTS.md).

## BF-07 — Báo cáo sự cố và bảo trì

**Có đủ các bước chính trong code mobile; chưa nghiệm thu thiết bị/provider thật.**

- Tenant/Staff báo sự cố → Owner review/classify → tạo Work Order hoặc direct completion → Staff inspection/proposal → Owner plan/cost decision → Staff start/progress/evidence/submit → Owner verify hoặc rework. Có chi tiết, lịch sử, evidence và nhánh Emergency acknowledge/action/cost review.
- Mobile không dùng OperationalTask thay cho Work Order bảo trì; hai loại có client/lifecycle riêng.
- Bộ test mobile có các case phân quyền, evidence, proposal/approval/verify và emergency. Đây là test với mock transport, chưa thay thế journey nhiều vai trò trên điện thoại thật. In-app notification không chứng minh push production đã cấu hình.
- Nguồn: [incident screens](../../src/mobile/src/features/incidents/IncidentScreens.tsx), [incident actions](../../src/mobile/src/features/incidents/IncidentActions.tsx), [mobile incident tests](../../src/mobile/src/__tests__/incident-integration.test.tsx).

## Kiểm chứng thực chạy trong lần rà soát

- Mobile typecheck: PASS (`npm.cmd run typecheck`). Mobile lint: PASS (`npm.cmd run lint`).
- Mobile full suite với Node v22.23.4 của dự án: **75 file, 922/922 test PASS**. Chạy `../../.tools/node-v22.23.4-win-x64/node.exe ../../node_modules/vitest/vitest.mjs run --config vitest.config.ts --reporter=dot` từ `src/mobile`.
- Lượt đầu bằng Node hệ thống v24.22.1: 910 PASS/12 FAIL trong expoStartup do nhánh chuyển sang runtime Node 22; chạy lại bằng runtime dự án đạt toàn bộ. Không thay code/test để làm xanh kết quả.
- Owner Web focused suite: **9 file, 67/67 test PASS**, chạy cùng Node 22: PropertyApiPages, LocalSetupPanels, UtilityWorkspace, propertyFlows, Contracts, ContractLifecyclePanel, DepositDeductionsPanel, RefundPanel, TemporaryResidence. Không phải full Owner Web suite.
- Chưa chạy lại backend integration/PostgreSQL, scheduler thực, browser–API–MinIO E2E, Android/iOS/device, ký số/bank/push provider thật. Không ghi dữ liệu vào database làm việc trong lần rà soát.
- `git diff --check` phát hiện blank line ở cuối `packages/client-core/src/localization.ts`, thuộc thay đổi local có sẵn; không sửa ngoài phạm vi.

## Tình trạng Git

- Fetch origin thành công; `member/Long` fast-forward thêm 82 commit đến `f318ffc`, bằng `origin/develop` tại thời điểm fetch.
- Đã giữ và khôi phục các thay đổi tracked/untracked. Hai xung đột khôi phục ở ContractScreen và notificationInbox được ghép để giữ cả Owner Holding readiness/action mới và mobile rental/notification mapping local.
- Không còn unmerged paths; thay đổi local giữ dạng chưa stage. Bản dự phòng vẫn nằm ở stash có nhãn `codex-preserve-local-before-develop-2026-11-11`.
- Không tạo commit, không push lên remote.
