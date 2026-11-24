# Sửa Tenant ký bàn giao bị 403 — 24/11/2026

## Nguyên nhân và phạm vi

Yêu cầu: sửa lỗi Tenant ký bàn giao phòng để demo trên Staging. Truy vết: BF-04 / UC-17, GBR-01/02 (đúng Tenant và phạm vi hợp đồng), kiểm tra version/hash/bằng chứng và idempotency hiện có. Tham chiếu `AGENTS.md`, `docs/api/MOVE_IN_HANDOVER_DRAFT.md` và code controller/service/adapter ký; không thay phương thức ký hay quyết định chính sách mới.

Log Staging xác nhận `403 tenant_session_signing_contract_tenant_only`. Hợp đồng gặp lỗi dùng `INTERNAL_OTP_DRAWN` và đã liên kết tài khoản Tenant. `ContractService.Document()` cố ý truyền Tenant rỗng trong ngữ cảnh ký hợp đồng nội bộ; tái sử dụng ngữ cảnh đó khi ký biên bản khiến adapter từ chối đúng Tenant.

`ContractHandoverSigningService` tạo ngữ cảnh riêng cho Tenant ký bàn giao, lấy `TenantUserId` từ hợp đồng do server tải, cho session và OTP tương thích. Không sửa adapter để bỏ quyền, không thay DTO/endpoint, không đổi ký hợp đồng nội bộ, activation, payment, occupancy hay schema.

## Kiểm chứng

- Trước sửa: hai ca session trên PostgreSQL 16 dùng một lần: hợp đồng thường PASS; hợp đồng nội bộ FAIL đúng `tenant_session_signing_contract_tenant_only` như Staging.
- Sau sửa trên working tree: **4 PASS, 0 fail, 0 skip** (session và OTP, mỗi luồng với hợp đồng thường/nội bộ). Test xác minh hai chữ ký PDF, hoàn tất bàn giao và từ chối sai vai trò, Tenant khác, thiếu consent/nét ký, version cũ, ký lại và replay tùy luồng.
- Chạy lại trên đúng nguồn PR163 + hotfix dùng dựng Staging, Release: **4 PASS, 0 fail, 0 skip**, evidence `.tools/handover403/staging-source-final/`. Fixture ban đầu thiếu hồ sơ Owner/Tenant cho quy tắc render PDF có sẵn của PR163 và thiếu `Consent=true` ở request OTP; đã bổ sung dữ liệu danh tính tổng hợp, mã hóa bằng key test tạo ngẫu nhiên và consent trong fixture, không sửa guard runtime để vượt lỗi. Hai lượt trước lần lượt lỗi 4 ca do thiếu identity và 2 ca do thiếu consent.
- Lệnh: `scripts/Test-Compact24Isolated.ps1` với filter `TenantSessionSignatureCompletesOwnerSignedMoveIn|StaffSubmitOwnerSignedPdfAndTenantOtpProduceVerifiedTwoSignatureHandover` (mỗi tên có tiền tố `FullyQualifiedName~`). Evidence: `.tools/handover403/after/`.
- Lần chạy đầu không có `BHOME_COMPACT24_TEST_ADMIN` bị SKIP; đã chạy lại bằng script cấp database disposable. Lần chuẩn bị test nguồn Staging thiếu NuGet assets (`NETSDK1004`); đã restore trước khi chạy lại.
- `dotnet format whitespace --verify-no-changes --no-restore --include` hai file C# thay đổi: PASS. `git diff --check` các file sửa: PASS.

## Triển khai

Nguồn dựng kế thừa PR163 `c4860aa44caca6795b55bb4022375dc45d8fd1f5` và các hotfix Staging đã giữ ở `.tools/pr163-staging/source/`; chỉ áp dụng sửa ngữ cảnh Tenant vào source đó. Build Linux Release API thành công. Image cập nhật kế thừa `bhome/pr163-api:demo-20261124`, chỉ thay Application assembly/PDB, giữ nguyên các assembly/config/runtime khác.

Worker riêng: `/opt/bhome-deploy/operator-handover-tenant403-20261124/`. Có khóa release, kiểm checksum, backup DB/config release, readiness, rollback API nếu lỗi và protected-container snapshot. Chỉ recreate API Staging; không seed/migrate hay triển khai Production, Owner Web/Mobile/Public. Không commit/push/merge.

Triển khai thành công lúc 14:44 ngày 24/11/2026 (Asia/Ho_Chi_Minh), image `bhome/handover-tenant403-api:20261124`, image ID `sha256:93d79e4433bd6894ce62d1a2d4563ca1fb9b022dd7eb0a739bb2def91fb2cb6a`. Đối chiếu SHA-256 assembly trong container đúng artifact; HTTPS/auth/CORS/webhook smoke PASS. Probe sau deploy: inbox 200, đọc 3 draft và 3 PDF thành công, cấu hình hợp đồng/thanh toán ban đầu 200; protected snapshot PASS, worker exit 0. Backup DB đã kiểm danh mục bằng `pg_restore --list`; chưa diễn tập restore/rollback cho bản này. Evidence local: `.tools/handover403/deployed.json`, `probe.after.json`; evidence đầy đủ giữ private tại worker VPS.

Probe Staging chỉ đọc bàn giao/PDF/thanh toán và kiểm tra auth; không ký hộ Tenant hoặc hoàn tất biên bản demo để kiểm thử. Người dùng cần tải lại màn hình và ký bằng tài khoản Tenant đã liên kết; frontend hiện tại không cần bản phát hành mới.

Kiểm tra chỉ đọc cuối lượt: chính biên bản người dùng báo lỗi đã chuyển sang **`Confirmed`, version 13** (trước sửa `Ready`, version 12). Probe không gửi thao tác ký. Bốn test cuối trên working tree sau khi hoàn thiện fixture cũng PASS, không skip; evidence `.tools/handover403/working-tree-final/`.

Các file repository sửa: `src/backend/BHome.Application/Contracts/ContractHandoverSigningService.cs`, `tests/backend/BHome.IntegrationTests/Compact24/Compact24MoveInSignedWorkflowTests.cs`, `docs/api/MOVE_IN_HANDOVER_DRAFT.md`, báo cáo này. CI toàn bộ không chạy trong lượt này; không coi bộ test chọn lọc là CI đầy đủ.
