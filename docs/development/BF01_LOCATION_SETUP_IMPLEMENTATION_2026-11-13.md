# BF01 — Báo cáo triển khai và kiểm thử (2026-11-13)

Phạm vi: BF01, UC04–UC07, FE01 và kiểm tra hồi quy các luồng tiêu thụ cấu hình. Quyết định nghiệp vụ: [BF01 Location setup](../architecture/BF01_LOCATION_SETUP_DECISION_2026-11-13.md). Không phải chứng nhận toàn bộ ứng dụng hoặc production readiness.

## 1. Kết quả triển khai

- Owner Web dùng wizard 7 bước với API thật: thông tin cơ sở (có chọn nguồn trước thông tin), RoomDefaults, sinh phòng, định mức tài sản, giá/biểu phí, nội quy, xem lại và xác nhận. Chế độ mock được giữ riêng, không sử dụng khi API mode.
- Thư viện Published được nạp vào bản nháp theo lựa chọn; cấu hình riêng không tạo/sửa mẫu dùng chung. Có chọn, kéo thả, chỉnh sửa, nhân bản, xác nhận gói tài sản hoặc bỏ gói; phí riêng của nguồn yêu cầu phòng đích; ngày hiệu lực giá thuê là dữ liệu xác nhận.
- `POST /api/v1/location-setup` lưu Location, metadata, local RoomDefaults, phòng thật, provenance, định mức/assignment, BillingPolicy và OperatingPolicy trong một transaction Compact24; idempotency, kiểm tra phiên bản, quyền Owner và source-state ở backend. Không tạo khách thuê, hợp đồng, hóa đơn, thanh toán, tài sản vật lý hoặc chi phí từ template.
- `GET /api/v1/location-setup/source/{locationId}` chỉ trả cấu hình có thể sao chép, không trả room rent thực tế/legacy RoomType scope, không trả thông tin vận hành. Giá mặc định đi theo RoomDefaults, giá cấp cơ sở có thể nạp làm tham khảo; phí dịch vụ/tiện ích theo phòng cần ánh xạ sang room key mới.
- Phiên bản các nguồn được ghi bằng `sourceReferences`; backend kiểm tra Published + version với thư viện và đối chiếu snapshot với local configuration. Phí theo phòng không được chuyển sang scope cơ sở khi sao chép. Không sử dụng RoomType aggregate/FK đã nghỉ.
- RoomDefaults CRUD, archive, history; configured-rooms bulk/single generation; RoomProvenance readback; metadata; danh sách cơ sở API-native; workspace hiển thị phòng, giá, tài sản, nội quy và dữ liệu thực tế. Điều chỉnh local defaults không ngầm sửa phòng đã tạo. Các tab chi phí/tài chính tiếp tục dùng API thực tế, không sinh chi phí từ định mức.
- Desired inventory theo gói đã gán; configured room không tự kế thừa gói legacy không liên quan; kiểm kê phải đúng desired version. Cơ sở chưa kích hoạt có phòng Unavailable.

## 2. API chính

| Method   | Route                                                   | Nội dung                                           |
| -------- | ------------------------------------------------------- | -------------------------------------------------- |
| GET      | `/api/v1/location-setup/source/{locationId}`            | Snapshot cấu hình và sourceState                   |
| POST     | `/api/v1/location-setup`                                | Atomic setup; header Idempotency-Key GUID          |
| GET/POST | `/api/v1/locations/{id}/room-defaults`                  | List/create local defaults                         |
| PUT      | `/api/v1/locations/{id}/room-defaults/{typeId}`         | Update/archive theo expectedVersion                |
| GET      | `/api/v1/locations/{id}/room-defaults/{typeId}/history` | Lịch sử                                            |
| GET      | `/api/v1/locations/{id}/room-provenance`                | Snapshot theo phòng                                |
| POST     | `/api/v1/locations/{id}/configured-rooms`               | Sinh phòng thật từ local defaults, Idempotency-Key |
| GET/PUT  | `/api/v1/locations/{id}/setup-metadata`                 | Metadata cơ sở, update theo version                |

DTO setup chứa `location`, `roomTypes`, `rooms`, `fees`, `policy`, `activate`, `rentEffectiveFrom`, optional `sourceLocationId`, `sourceState`, `sourceReferences`. Phòng trong request dùng key bản nháp; backend tạo ID thực. Retry cùng key/payload trả các ID đã tạo; retry payload khác trả 409. Nếu target đã được cập nhật sau commit, DTO location replay là trạng thái hiện tại, không phải snapshot response ban đầu.

## 3. Kiểm thử PostgreSQL

Thực thi Release với PostgreSQL 16 disposable loopback; fixture Compact24 tạo DB riêng, không dùng DB development để rollback/race test.

| Suite                                                         |      Kết quả |
| ------------------------------------------------------------- | -----------: |
| LocationSetup tests mới                                       |     8/8 PASS |
| Compact24OwnerSetupTests (bao gồm 8 test trên)                |   46/46 PASS |
| Application unit                                              | 463/463 PASS |
| Domain unit                                                   | 106/106 PASS |
| Compact24 downstream regressions (selected 10 distinct cases) |   10/10 PASS |
| Native setup FE riêng                                         |     4/4 PASS |

Owner Web final typecheck, build and lint PASS (0 lint errors/warnings, 291 files). Full Vitest run with `--maxWorkers=2`: 75/75 files, 436/436 tests PASS. Added focused `LocationSetupWizardCopy.test.tsx` after that run began: 1/1 PASS separately, for 437 distinct FE tests across 76 files. The copy regression covers source without RoomDefaults, effective reference rent, explicit package assignment, mapped room fee, partial catalog failure, unselected policy omission, inactive target and source version references. An earlier full run had four timeouts under default concurrency; all passed with reduced workers. Existing Vite chunk-size and unrelated passing-test MUI/signing stderr warnings remain.

Backend 625 test phân biệt PASS (không cộng lặp 8 test nằm trong 46). API Release build PASS. Backend test TRX: `tests/backend/BHome.IntegrationTests/TestResults/bf01-location-setup.trx`, `bf01-owner-setup-regression.trx` (generated, local); `.tools/bf01-results/compact24/bf01-downstream.trx`. Lượt tích hợp ban đầu 43/43; lượt sau thêm kiểm tra concurrent replay, shared references, stale inventory.

Test mới xác nhận transaction late-failure bằng PostgreSQL trigger, rollback rồi retry cùng key; simultaneous replay; source và destination độc lập, exact version, archived defaults, code/fee scope, inactive lifecycle; Owner-only, actual rent effective date; desired inventory không tạo physical assets; stale desired version bị từ chối.

P5: 10/10 test regression Compact24 PASS, không skip: price precedence, policy replacement, occupied-room guard, effective contract draft settings/future rent, move-in handover, renewal, immutable invoice finalization, tiered utility invoice, settlement calculation, payment reconciliation. Đây là kiểm tra các nghiệp vụ downstream có sẵn trên DB thật; không phải kịch bản browser xuyên suốt ký hợp đồng/handover/phát hành hóa đơn cho phòng QA vừa tạo.

## 4. Kiểm thử UI thật

Microsoft Edge Playwright, Vite Owner Web, API thật và PostgreSQL. Không intercept hoặc thay thế HTTP bằng mock. Mỗi thao tác tạo/publish/save thực hiện bằng UI, API đọc lại để đối chiếu. Credentials/token chỉ trong memory; không lưu trong evidence.

### Development QA (giữ lại dữ liệu)

Run `26111301`, Owner Web 5188, API 7241. Login, create/publish 6 library documents, required fields, 2 room templates, generate 5 rooms, assign assets, enter fees/rules, atomic setup HTTP 200; source `fe2c4081-ca8d-4711-a995-74b47aba6fef` (`QA BF01 Source 26111301`, code `QA-S-26111301`), 5 rooms and 2 local asset templates. Run ban đầu dừng tại assertion dùng copy-preview API để đếm room rent; API preview được thiết kế không trả room rent. Sửa readback sang `/billing-policies` và tiếp tục xác minh bằng DB độc lập. Dữ liệu QA này vẫn ở development, không xóa dữ liệu cơ sở có sẵn.

### Full isolated browser acceptance

Run `26111302-local-d02489`, Owner Web 5189, API loopback 5242, PostgreSQL 16 container mới; synthetic account từ sample seed. **51/51 assertions PASS, 315 API responses ghi nhận đều HTTP 200, exit code 0**. DB và processes của run được dọn trong finally, không tác động tới 5173/7240.

| Dữ liệu                      | Nguồn                                  | Đích                                   |
| ---------------------------- | -------------------------------------- | -------------------------------------- |
| Location ID (DB test đã dọn) | `8cd16589-5179-4461-bd9e-99425cea4bcc` | `673448c9-a6ea-42db-b97b-b1ab035206db` |
| Phòng                        | 5                                      | 2 mới, ID riêng                        |
| Loại phòng                   | Standard 2 người; Premium 3 người      | Standard 3 người, Premium không chọn   |
| Giá thuê                     | Standard 3.000.000; Premium 4.500.000  | Standard 3.000.000                     |
| Phí riêng CLEANING 30.000    | P.101                                  | ánh xạ P.102                           |
| Định mức                     | 2 gói                                  | 1 gói đã chọn                          |
| Nội quy                      | Published                              | Published độc lập                      |

Source state trước/sau bằng nhau. Reload source, metadata, provenance, room inspector 2/3 người; target no actual assets/contracts/invoices/expenses/residents; target tabs RoomDefaults, assets, pricing, rules, settings truy cập và chụp ảnh. Không suy diễn rằng đã chạy toàn bộ tất cả chức năng CRUD của từng tab hoặc tất cả BF03–BF05 UI.

Evidence local: `.tools/owner-web-e2e/bf01-closure/26111302-local-d02489/evidence.json`, `fixture.json`, `source-review.png`, `copy-selected.png`, `copy-fee-mapping.png`, `target-review.png`, `target-saved.png`, `target-room.png`, `target-assets.png`, `target-pricing.png`, `target-rules.png`, `target-settings.png`. Script `.tools/owner-web-e2e/bf01-closure-e2e.cjs`; local launcher `.tools/bf01-run-isolated-ui.ps1` (generated local tooling, not production deployment). Prior attempt evidence retained separately.

## 5. Lưu ý và giới hạn

- Không migration/destructive reset, commit, push hoặc thay đổi mật khẩu/tài khoản hiện hữu. Không dừng môi trường dev của người dùng. Cần restart/rebuild API 7240 đang chạy bản cũ khi nghiệm thu trên môi trường thường dùng; bản test chạy API riêng.
- Debug build bị DLL lock; dùng Release/isolated output. Docker pull `postgres:16-alpine` lỗi EOF, dùng image `postgres:16` có sẵn. Môi trường UI độc lập gặp binding 5240 do Kestrel endpoints và root Vite 7 không tương thích plugin workspace Vite 8; sửa launcher sang port riêng và binary workspace. Auth origin 5188 được thêm đúng runtime, không tắt auth/TLS verification.
- Old existing-location copy workflow vẫn giữ guard từ chối room-specific fee mapping; mapping trong báo cáo là luồng initial setup mới. Legacy rooms chưa có provenance hiển thị chưa gán; không tự backfill.
- Không tuyên bố toàn bộ BF03–BF05/Finance đã nghiệm thu UI, real payment/signature provider, production deploy hoặc mọi test ngoài phạm vi. Data source mẫu thiếu group cấu hình thì hiển thị trống, không tự tạo. Các test hiện hành có synthetic fixture; không thay thế kiểm thử nghiệp vụ thực tế trên toàn hệ thống.
