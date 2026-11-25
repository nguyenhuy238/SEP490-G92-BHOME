# Sửa backend CI #313 — 24/11/2026

## Bằng chứng và truy vết

[CI #313](https://github.com/nguyenhuy238/SEP490-G92-BHOME/actions/runs/45404253605),
commit `a27dd64e1a192676be28abece4223a25b6300c61`: build backend thành công;
artifact `backend-trx-attempt-1` có đúng một test lỗi trong integration:
`StaffCanSubmitFourCompletedSectionsWithRoomIssueAndMissingInventoryWithoutDraftAssets`.
Các suite Application (721), Domain (115), Infrastructure (243), Digital Signing
(41) đều pass; integration có 1481 pass, 1 fail và 32 ca không chạy.

Phạm vi: BF-03/BF-04, UC-17, GBR-01/02/03/18. Đối chiếu `AGENTS.md`,
`docs/api/MOVE_IN_HANDOVER_DRAFT.md` (luồng kiểm tra lại và API evidence),
`ContractHandoverService` và `ContractHandoverDraftService`.

## Nguyên nhân và thay đổi

Sau khi Owner yêu cầu kiểm tra lại, test gọi helper tải ảnh qua route legacy
`handover/evidence`. Draft đã được lưu nên backend từ chối đúng với
`409 handover_draft_workflow_required`. Test phải tải ảnh mới bằng
`handover/draft/evidence`, route hỗ trợ trạng thái `ReinspectionRequested`
và kiểm tra đúng Staff đã bắt đầu công việc.

Chỉ sửa bước upload trong `Compact24MoveInSignedWorkflowTests.cs`. Giữ các
assert về ảnh kiểm kê mới, resubmit, ký và snapshot cuối cùng. Không thay đổi
production code, API, phân quyền, schema, migration hay bộ lọc CI.

Tiêu chí: tái hiện lỗi cũ; tải ảnh kiểm tra lại thành công qua Draft; hoàn tất
luồng kiểm kê lại/Owner Ready/Tenant ký; các kiểm tra phân quyền và tương thích
legacy hiện có tiếp tục pass.

## Kiểm chứng local

- Tái hiện test lỗi trước sửa: 1 FAIL, đúng mã 409 của CI.
- `dotnet test tests/backend/BHome.IntegrationTests/BHome.IntegrationTests.csproj -c Release --no-restore --filter ... --logger trx`:
  9 PASS, 0 FAIL, 0 SKIP. Bộ lọc gồm test lỗi và toàn bộ test trong
  `Compact24MoveInDraftTests.cs`, `Compact24MoveInSignedWorkflowTests.cs`.
  Dùng PostgreSQL 16 container cô lập với `BHOME_COMPACT24_TEST_ADMIN` loopback;
  kết quả tại `.tools/ci-313/local/after.trx` (không commit artifact).
- `dotnet build src/backend/BHome.sln -c Release --no-restore`: PASS,
  0 warning, 0 error.
- `dotnet format src/backend/BHome.sln --verify-no-changes --no-restore`: PASS.
- `git diff --check`: PASS.
- Không chạy lại toàn bộ suite backend; chưa xác nhận GitHub Actions trên bản sửa.
