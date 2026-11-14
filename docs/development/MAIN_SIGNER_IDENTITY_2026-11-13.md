# Hoàn thiện định danh bên thuê và ký Main Contract

## Sửa lỗi render màn hình ký — 14/11/2026

Truy vết: màn hình Owner ký Main Contract (BF-03/04, UC-15/16, GBR-04) → `OwnerMainContractFlow` → regression `owner-main-contract-flow.test.tsx`. Đây là sửa render; không đổi quy tắc ký hoặc kích hoạt.

`consent.error` bằng chuỗi rỗng khi không có lỗi. Điều kiện `{consent.error && ...}` đưa chuỗi rỗng vào `Surface/View`, khiến React Native Web báo `Unexpected text node: . A text node cannot be a child of a <View>.`. Đổi điều kiện sang boolean để bỏ qua phần tử khi không có lỗi; lỗi API vẫn hiển thị trong `Text`.

Test dùng `View` thật của React Native Web thay cho HTML `section` và kiểm tra `console.error`: hai trường hợp PendingSigning (internal/MySign) tái hiện đúng cảnh báo trước sửa; sau sửa cả hai qua, trường hợp lỗi API vẫn hiển thị đúng. Full Mobile: **101 files / 1.109 tests PASS**. Browser check trước đây chỉ bắt `pageerror`, nên không phát hiện cảnh báo qua `console.error`; không coi kết quả đó là bằng chứng đã kiểm tra invariant này.

## Truy vết và kế hoạch

Yêu cầu được duyệt ngày 13/11/2026 BR-01..05 → BF-03/04, UC-15/16, GBR-04; quyết định nghiệp vụ 10/11 BR-01/04/05/07. Nhánh `member/QHuy`, base `ffe9320b`, working tree ban đầu sạch. Không thay Staff/Tenant screens, billing, occupancy, schema hoặc provider policy.

1. Signer: bỏ global Tenant dropdown; đọc resident đại diện hiện tại qua GET `/api/v1/residents/{id}` (Owner-only), đối chiếu với persisted Draft; backend release bắt buộc account đúng liên kết resident. Tests linked/unlinked/unrelated/family và PDF review.
2. Signing: phương thức theo khả năng hiện có (null-account internal; linked-account MySign); reuse invitation, OTP, confirmation và certificate APIs. Không tự đổi phương thức hoặc giả provider success.
3. Navigation: route Owner là nguồn ID; xóa state cũ khi parameters bị xóa/đổi, promotion có ID persist, preserve back hợp lệ. Tests empty/malformed/switch/reload.
4. UX: summary bên thuê chỉ đọc, một lỗi, phương thức rõ, footer responsive.
5. Regression và local CI checks; commit từng giai đoạn, không push/merge.

## Phát hiện ban đầu

- `MainDraftSigningReview` tải global `/contracts/preparation/accounts`, cho chọn lại account hoặc internal; account không được giải quyết từ resident đã chọn.
- `MainDraftService.ReleaseAsync` chặn account khác khi resident đã linked, nhưng resident chưa linked có thể nhận account Tenant bất kỳ. Cần chặn ở backend.
- `ResidentAdministrationView` hiện có ID, RoomId, ResidentType, VerificationStatus, TenantUserId, ContactEmail; đủ để xác thực lựa chọn mà không tạo endpoint/DTO mới.
- Domain chỉ có Representative/CoOccupant, không có household classification riêng. Không suy family từ số người. Preparation backend yêu cầu một Representative và các CoOccupant; không gắn nhãn family mới. Individuals có Representative riêng và Draft riêng; giữ capacity/room/conflict guards hiện có.
- `ConflictsAsync` đã giới hạn active occupants theo capacity và trùng Resident; `DuplicateAsync` chặn Draft/Pending/Active chồng cùng occupant. Không nới các guard này.
- Invitation hiện dùng `Resident.ContactEmail` đã xác nhận, không dùng email tùy ý trong release; kiểm verified và unique emails toàn bộ actual occupants theo quyết định BR-05.
- Route dùng `selected || deepId` nên local selection có thể thắng route rỗng/mới. MainDraftStart giữ ID trong local state và `persistRoute=false`.

## Kết quả

Giai đoạn 1: bỏ global account query/selector, dùng Owner resident endpoint để đối chiếu ID/phòng/vai trò/xác minh/contact với Draft; resolve null-account hoặc account đã linked. Re-check trước generate/release; không giữ reviewed file khi liên kết/contact đổi. Backend không gán account bất kỳ khi resident chưa linked. 19 test Mobile mục tiêu và 19 test backend (bao gồm Compact24) PASS; lint các tệp và Mobile typecheck PASS. Test legacy chỉ kiểm rejection; null-account release được thực thi trên Compact24 đang triển khai vì schema lịch sử còn constraint signer cũ. Không thay schema để làm test qua.

Giai đoạn 2: Main internal invitation kiểm tra đúng resident/phòng/liên kết trước khi gửi; hiển thị recipient, delivery, Tenant acceptance, Owner confirmation. Delivery chưa thành công có blocker rõ; không hiển thị token. Owner có directory chứng thư MySign; unknown mode không fallback. Parent reload evidence sau action để tránh trạng thái cũ. 12 test Owner signing PASS và lint các tệp PASS. Reuse `/contracts/{id}/signing-invitations`, `/internal-signing`, `/internal-signing/owner-confirmation`, certificate và signing/sync/recover APIs; không thêm API hoặc thay hình thức ký.

Giai đoạn 3: Owner dùng ID trên route, không fallback sang selected/local Draft khi route rỗng hoặc đổi. Malformed/conflicting IDs bị chặn. Main preparation được mở trực tiếp theo yêu cầu duyệt mới; test cũ bắt chuyển Owner sang Web được cập nhật theo phạm vi được duyệt này, vẫn xác minh không mutation trước Save. Owner chọn một Representative, chỉ thêm CoOccupant rõ ràng; đổi representative xóa members cũ, không tự nhóm những người đại diện độc lập. Save trong standalone preparation persist `contractId`; back/reopen giữ Draft, reload đọc lại backend. Internal progress theo evidence, không theo màn hình đã ghé. 35 test route/preparation/Owner flow và lint PASS.

Giai đoạn 4: thông tin bên thuê chỉ xuất hiện một lần ở bước duyệt; summary vẫn giữ phòng/kỳ thuê, bỏ tiêu đề và reload lặp khi hồ sơ hợp lệ. Checkbox kiểm tra đúng thông tin/nội dung; Owner không còn nút primary “Về danh sách” cạnh tranh với release. Scroll trở về đầu khi đổi bước Owner; Staff giữ mặc định summary/footer cũ. 44 test component mục tiêu PASS; browser transport tổng hợp đi qua PDF recovery → read-only signer → exact signing review → một release null-account → PendingSigning, không global accounts query/PUT/page error; responsive 360/400/768/1280px và fullscreen/zoom/download PASS. Đã xem ảnh tổng hợp để kiểm tra bố cục. Không gộp kết quả UI mock với provider thật.

## Kiểm chứng cuối (14/11/2026)

| Phần                   | Kết quả và phạm vi bằng chứng                                                                                                                                                                                                     |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mobile                 | **101 files / 1.106 tests PASS**, lint/typecheck PASS; full Vitest sau regression reload cuối                                                                                                                                     |
| Backend                | **32 PASS, 0 skipped**: MainDraft API/release, preview, Compact24 identity/family/certificate/capacity guards, AnonymousSigning và Compact24DigitalSigning                                                                        |
| OTP/Owner confirmation | PASS qua API trên DB dùng một lần: đúng recipient, OTP dùng một lần/giới hạn, exact PDF, consent/drawn evidence, Owner confirmation và verified deposit mới activate; email được thu bởi test delivery sink, không phải SMTP thật |
| Owner Web contracts    | **16 files / 63 PASS**; không sửa Owner Web                                                                                                                                                                                       |
| Build/export           | Workspace build và Expo Web export PASS; build giữ warning chunk size đã có                                                                                                                                                       |
| Format                 | Prettier và dotnet whitespace cho C# sửa PASS; git diff check PASS                                                                                                                                                                |
| Browser internal       | PASS với transport tổng hợp: reload Draft mới → preview/recovery → signer chỉ đọc → PDF signing review → một release `tenantUserId=null` → PendingSigning; không global accounts request, không PUT, không page error             |
| Browser linked MySign  | PASS với transport tổng hợp: dùng đúng account liên kết, không selector; khi certificate API trả 503 hiện blocker và không gửi POST ký, không fallback sang internal                                                              |
| Responsive             | PASS 360/400/768/1280px, fullscreen/zoom, Blob view/download; đã kiểm tra ảnh tổng hợp                                                                                                                                            |
| Live providers/devices | SMTP/MySign/bank thật, Android/iOS trên thiết bị và remote CI: **NOT RUN**                                                                                                                                                        |

Test backend dùng PostgreSQL/MinIO Testcontainers và converter thật ở những case tương ứng; Compact24 identity fixture dùng storage adapter tổng hợp. Anonymous signing test dùng delivery sink và private test storage. Không cộng test chạy lại vào số lượng 32. Bộ kết hợp ban đầu phát hiện fixture MainDraft dùng password khác fixture ContractLifecycle cho cùng Owner duy nhất của Compact24; sửa fixture để cùng dùng `WorkflowTestUsers.Password`, không thay auth production, không reset password thật và không giảm assertion.

Browser fixtures lưu trong `.tools/owner-pdf-validation/signer-*` (ignored); response tổng hợp chỉ dùng cho kiểm tra giao diện, không đưa vào code chạy thật. Dùng dữ liệu/email tổng hợp `example.invalid`; không lưu token hoặc CCCD thật vào artifacts/repo.

Regression reload cuối: Owner Draft mở bằng `contractId` giữ route này khi Save, không tự chuyển sang nhánh `mainDraftId` làm remount/abort preview. Có component test riêng; không đổi nhánh Staff.

## Đối chiếu nghiệm thu

- TC-01..03: MainDraft API + Compact24 family/independent cases; preparation Owner chọn một Representative và CoOccupant rõ ràng. Capacity/competing activation guards giữ nguyên.
- TC-04..08: pure signer validator, component review và backend release kiểm linked/unlinked/unrelated/mismatched role/location/account; không global dropdown/query.
- TC-09..11: Owner invitation tests + AnonymousSigning API tests; recipient/evidence/Owner confirmation được kiểm tra trên backend; không claim delivery thật.
- TC-12: certificate directory isolation và actual adapter từ chối chứng thư khác actor; browser kiểm 503 blocker, không gọi ký khi chưa đủ điều kiện.
- TC-13..14: PDF version/review regression, aborted/late response và empty/malformed/conflicting/reloaded routes.
- TC-15..17: activation thiếu signatures/deposit/wrong actor bị chặn; full Mobile có Staff/Tenant regressions.

## Tệp sửa chính

- Owner review/identity: `MainDraftSigningReview.tsx`, `features/owner/mainDraftSigner.ts`, `packages/client-core/src/mainDrafts.ts`, backend `MainDraftService.cs` (release chỉ dùng account đã liên kết).
- Owner signing: `OwnerMainContractFlow.tsx`, `OwnerHoldingSigning.tsx` (Main-only recipient validation; nhánh Holding giữ hành vi hiện hữu).
- Navigation/preparation/UI: `ContractScreen.tsx`, `MainDraftStart.tsx`, `MainDraftScreen.tsx`, `ContractPreviewSummary.tsx`.
- Tests: `main-draft-signer`, `rental-contract-flow`, `owner-main-contract-flow`, `owner-holding-signing`, `main-draft-start`, `contract-sections`; backend `MainDraftReleaseTests.cs`, `MainDraftApiTests.cs`, `Compact24/MainSignerIdentityTests.cs`.

Không thêm dependency, endpoint, response field, bảng/cột/migration; không sửa Staff/Tenant screens, Owner Web hoặc payment/occupancy policy. Backend release validation cũng áp dụng với caller khác Mobile: caller không được dùng release để tự gán một tài khoản chưa liên kết.

## Commits và giới hạn

- `a6428d0e` — enforce contract signer identity.
- `85804ddd` — integrate verified tenant signing.
- `5e9cbcb8` — stabilize contract review navigation.
- `ad0e0109` — simplify contract signing interface.
- Commit cuối: individual/family signing regression và kiểm chứng reload.

**PARTIAL** đối với E2E có nhà cung cấp thật: chưa gửi email/OTP, ký MySign hoặc chuyển tiền thật. Owner phải xác nhận PDF và hạn lời mời theo API hiện có; release không tự chọn deadline hoặc tự gửi email. Không gắn nhãn OTP/drawn consent là chữ ký số CA. **BLOCKED** cho production signing-review khi chưa có template được duyệt; không thay guard Development/Testing. QR cọc Main chưa được API hiện có cấp, UI không dựng QR giả hoặc suy payment success. Không push/merge; không sửa records thật để demo đạt.
