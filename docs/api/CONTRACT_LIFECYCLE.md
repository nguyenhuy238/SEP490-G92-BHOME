# BH-40 — Contract lifecycle

Tái sử dụng `/api/v1/contracts/{id}` renewal/signing/activation, termination-requests,
expiry-move-out, move-out/approve/schedule/inspection/settlement/complete hiện có.
Mutation JSON cần Idempotency-Key GUID. Auth ở service, object scope lấy từ DB.

- GET `{id}/versions`: Owner/Tenant sở hữu, Staff assigned; cùng chain previous/next;
  Staff chỉ dates/status, không rent/terms. Renewal chỉ Active khi ngày hiệu lực và đủ ký/cọc.
- POST `{id}/move-out/schedule`: Owner hoặc Staff assigned, `{scheduledAt UTC,staffUserId?,
  expectedVersion?}`. Staff không chỉ định người ngoài assignment Location. Owner để trống
  assignee sẽ hiển thị chưa phân công; không tự chọn một người. Không đóng Contract.
- GET `move-out-assignments`: Staff, tối đa 100 lịch được giao trong Locations hiện có quyền.
- GET `{id}/move-out/history`: Owner/Tenant của Contract hoặc Staff assigned; append-only.
MoveOut response bổ sung inspectionStaffId/version. Version 1 request, tăng khi approve/schedule.
Không thêm reject/cancel termination. Không dùng tenancy của người khác để mở evidence.
