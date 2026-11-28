# Sửa CI checkpoint chỉ số đầu kỳ — 24/11/2026

## Bằng chứng và phạm vi

[CI #301](https://github.com/nguyenhuy238/SEP490-G92-BHOME/actions/runs/45315199940)
trên nhánh `member/THuy`, commit `f3c3a81`, build thành công nhưng có 12 lỗi
integration với mã `task_duplicate_command`. Artifact `backend-trx-attempt-1`
ghi nhận lỗi ở các luồng bắt đầu bàn giao, kiểm kê và chuẩn bị trả phòng.
Các bộ Application, Domain, Infrastructure và Digital Signing không có lỗi.

Truy vết: BF-03/BF-04, UC-17, GBR-07/18; đối chiếu quy tắc bàn giao và chỉ số
đã xác nhận trong `AGENTS.md`, `OWNER_CONTRACT_HANDOVER_RESIDENCE.md`,
`ContractHandoverRepository` và khóa `ux_task_source` trong Compact24.

Tái hiện ba ca `MoveOutProposalNetDepositSePay` trước sửa: 3 FAIL.
PostgreSQL từ chối `source_key=meter-contract-initial:<meter>:<contract>` trùng.
`EnsureMeterBaselinesAsync` chỉ tìm ID tự sinh trong khi API capture và dữ liệu
lịch sử có thể có checkpoint cùng công tơ/hợp đồng với một ID khác.

## Thay đổi và tiêu chí chấp nhận

- Tìm checkpoint đầu kỳ chưa hủy theo loại task, công tơ và hợp đồng trước khi
  tạo mới; kiểm tra cả bản ghi đang theo dõi trong DbContext và đã lưu.
- Trả về đúng ID checkpoint hiện có, giữ nguyên trạng thái, chỉ số và bằng chứng.
- Khi thiếu checkpoint vẫn tạo như trước, dưới transaction/Location lock hiện có.
- Test hồi quy gọi API capture để tạo hai checkpoint với ID khác ID tự sinh,
  xác nhận một checkpoint, rồi bắt đầu bàn giao và gọi ensure lặp lại. Phải có
  đúng hai checkpoint, giữ ID, trạng thái và giá trị đã xác nhận.
- Các test hiện có tiếp tục kiểm tra chỉ số riêng cho hợp đồng mới, phân quyền,
  checkpoint còn thiếu, idempotency và các luồng từng lỗi trên CI.

Không thay đổi API, schema, migration, quyền hoặc bộ lọc CI. Trước khi commit
và push theo yêu cầu người dùng, đã bỏ hai thay đổi debug có sẵn: trả
constraint/detail trong mã lỗi API và bật `Include Error Detail` trong fixture.
Giữ nguyên mã lỗi công khai `task_duplicate_command`.

## Kiểm chứng

- `dotnet build src/backend/BHome.sln -c Release --no-restore`: PASS,
  0 warning / 0 error. Lượt build chạy đồng thời với test trước đó bị khóa DLL;
  đã chạy lại thành công sau khi nhóm test kết thúc.
- Nhóm test `PropertyContractDockerTests`, `Compact24OwnerSetupTests` và
  `Compact24ContractRegressionTests.MoveOut`: 29 PASS, 0 FAIL, 101 SKIP do
  lượt này chưa cấu hình biến PostgreSQL admin. Có test hồi quy mới về checkpoint
  đã tồn tại. Không coi các test SKIP là đã kiểm chứng.
- `dotnet format src/backend/BHome.sln --verify-no-changes --no-restore`: PASS.
- `scripts/Test-SePaySandboxScripts.ps1`: PASS.
- `node --test tests/deployment/ci-backend-test-boundary.test.cjs`: 1 PASS.
- Digital Signing chạy riêng: 41 PASS.
- Bộ CI đầy đủ đã chạy với PostgreSQL admin cô lập: Application 704 PASS,
  Domain 115 PASS; dừng trong phần integration theo yêu cầu người dùng giảm
  phạm vi test. Không có kết quả cuối cùng cho bộ đầy đủ, không khẳng định cả
  12 ca lỗi GitHub đã PASS.
- Kết quả trên là kiểm tra local trên Windows; chưa xác nhận GitHub Actions
  trên commit mới. Người dùng yêu cầu commit/push sau khi dừng bộ test đầy đủ.
