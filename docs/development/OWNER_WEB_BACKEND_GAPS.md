# Owner Web — Backend gaps

Rà soát runtime `BHome.Api` + Compact24 ngày 08/11/2026. Tài liệu này không đặt tên endpoint mới và không cho phép thay đổi schema.

## Staff lifecycle

- Hiện có: capture Staff name/ID + create; Location assignment list/create.
- Thiếu: Staff detail an toàn, update profile, activate/deactivate, session revocation khi deactivate, amend/end assignment có lịch sử.
- Bắt buộc: Owner authorization, ownership scope, validation uniqueness/overlap, optimistic concurrency, audit reason; không trả password hash, refresh token, security stamp hay identity document.

## Incident và Work Order (checklist 44, 46, 47)

- Runtime không có Incident/WorkOrder Controller/service lifecycle; OperationalTask không phải WorkOrder.
- Cần Incident list/detail theo Location; Owner review/classification/reject/duplicate/direct-resolution; emergency history; private evidence.
- Cần Work Order state machine, eligible assignee, proposal/time/cost, Owner approval, progress/evidence, pending verification, verify/rework/cancel, maintenance/asset history và OperatingExpense linkage.
- Mọi command cần Owner/Location authorization, version/concurrency, idempotency, append-only history và audit.

## Public content management (checklist 56)

- Runtime không có public-content Controller.
- Cần Owner-scoped draft/published list/detail, create/update, publish/unpublish có version và audit.
- DTO chỉ chứa Location/Room thông tin không nhạy cảm, giá tham khảo, vacancy, amenities, ảnh đã duyệt và thông tin liên hệ tĩnh.
- Không nhận dữ liệu Guest, booking, payment hoặc onboarding.

## Provider dependencies

- Electronic signing cần cấu hình/kiểm chứng provider staging; simulation không phải chữ ký pháp lý.
- Email/push mặc định Unconfigured; in-app notification vẫn là source of truth.
- Bank callback/provider tự động chưa được nghiệm thu; manual verified receipt không được mô tả thành bank callback.

## Known business blockers

- Holding Contract chưa có ledger/API/UI đầy đủ; không giả `OnHold` từ Main Contract.
- Temporary residence không có Owner confirmation workflow riêng; không cấp Staff quyền đăng ký thay Tenant.
- Deposit debt-offset, fee beyond deposit và một số refund classification vẫn cần quyết định/chức năng Backend đã phê duyệt.
