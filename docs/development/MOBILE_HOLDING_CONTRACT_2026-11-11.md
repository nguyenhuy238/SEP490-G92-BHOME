# Hợp đồng giữ chỗ trên Mobile Staff

Nguồn: BF-03A/B, UC-14/15, GBR-01..04, DBR-02/03/08, JOB-05; `HOLDING_CONTRACT_PHASE2.md` và quyết định bổ sung ngày 08/11/2026 trong tài liệu đó. Yêu cầu người dùng ngày 11/11/2026 chốt hợp đồng giữ chỗ chỉ gồm đúng một người đại diện, không chọn hộ gia đình/người cùng ở.

## Thay đổi

- `LiveWorkspaceScreens.tsx`: thêm ô tạo hợp đồng giữ chỗ ở trang chủ Staff, mở màn chuẩn bị hiện có với `kind=Holding`.
- `StaffContractsList.tsx`, `ContractScreen.tsx`: thêm lối vào từ danh sách; tạo thành công mở chi tiết hợp đồng do backend trả về, hủy quay lại danh sách. Chi tiết Holding ẩn tab bàn giao/gia hạn/trả phòng; hiển thị hạn giữ chỗ và trạng thái duyệt.
- `ContractDraftForm.tsx`: sử dụng form nháp cũ cho Holding (luồng Main tiếp tục dùng `MainDraftStart`/`MainDraftScreen`). Chọn cơ sở, phòng Available, một hồ sơ đại diện đã xác minh và liên kết Tenant, Owner ký; nhập kỳ thuê dự kiến, hạn giữ chỗ theo giờ Việt Nam, cọc và điều khoản. Không chọn household hay danh sách người cùng ở. Dùng lịch nhập ngày hiện có và `holdingDraftPayload`; tiền thuê do backend resolve theo chính sách phòng.
- Gọi endpoint có sẵn `POST /api/v1/contracts/holdings`; gửi đúng một `residentIds` là đại diện, `reservedCapacity=1`. Chặn lưu lặp trong khi chờ, giữ idempotency key khi lỗi/chưa rõ kết quả, chỉ chuyển màn sau khi server xác nhận.
- `ContractHoldingService.cs`: từ chối tạo Holding nếu số resident khác một. Không đổi DTO, schema, dữ liệu Holding lịch sử, migration hoặc quyền.

## Điều kiện nghiệm thu và quyền

Draft chưa giữ phòng. Staff chỉ chuẩn bị và theo dõi trong Location được phân công; Owner duyệt, Owner/Tenant ký, cọc được xác minh và Owner kích hoạt theo các guard backend hiện có. Không tự đặt hạn giữ chỗ hoặc chính sách hoàn/khấu trừ cọc. Dùng lại tài liệu, ký, readiness, history, expiry và conversion hiện có; không tạo provider hay API mới.

Kiểm thử bổ sung: form gửi đúng một đại diện; chỉ hiển thị phòng Available; không chọn người cùng ở; UTC deadline; lỗi API và retry giữ key; từ chối giờ sai/hạn trong quá khứ; lối vào Holding ở danh sách Staff; backend từ chối nhiều resident và không thay trạng thái phòng.

## Kiểm tra thực thi

- Mobile typecheck và lint: PASS.
- Mobile Holding + danh sách Staff + contract sections + rental contract flow + live workspace UI: 160/160 PASS.
- Backend `ContractServiceTests`: 40/40 PASS, gồm guard một đại diện mới và các test activation, cọc, conversion hiện có.
- Chưa xác minh end-to-end trên điện thoại với PostgreSQL/provider ký thật trong phiên này. Không coi unit/component tests là bằng chứng giao dịch hoặc chữ ký production.
- `git diff --check` trên các file sửa trong phạm vi này: PASS. Kiểm tra toàn worktree còn báo dòng trống cuối file `packages/client-core/src/localization.ts`, là thay đổi đã tồn tại trước tác vụ; không sửa ngoài phạm vi.
