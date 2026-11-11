# Phải thu chuyển ra và cấn trừ cọc

Quyết định nguồn: yêu cầu được duyệt BR-15/19/20/21/22/23 (attachment 978b0212 ngày 10–11/11/2026), BF-04/06, UC-19/22/25, GBR-10/18. BR-21 thay cách giới hạn thiệt hại bằng số tiền cọc. Bàn giao vật lý không chờ quyết toán.

## Phạm vi đã thực hiện

- Owner duyệt khoản thiệt hại theo biên bản kiểm tra cuối kỳ đã xác nhận. Lưu nguồn phòng/tài sản, phiên bản biên bản, mô tả chi phí, chính sách tính là chi phí Owner xác nhận, ảnh và hash, người/thời điểm duyệt, nhóm người thuê của phòng tại thời điểm phát sinh. Không tự tạo chi phí, mức phạt hoặc hóa đơn quyết toán riêng.
- Khoản phải thu có thể lớn hơn cọc. Một nguồn phòng/tài sản trong cùng lần chuyển ra chỉ được ghi nhận một lần, kể cả khi biên bản được lập lại. Bản đã duyệt bất biến; chưa cung cấp thao tác sửa trực tiếp.
- Cấn trừ là quyết định riêng, chỉ Owner, chọn chính xác nguồn cọc và khoản phải thu hoặc hóa đơn Final thuộc chuỗi hợp đồng. Lưu snapshot số dư và tham chiếu đã xem. Một `payment_allocations` gắn một quyết định duyệt; không tạo người trả giả cho khoản cấn trừ.
- Dùng khóa giao dịch tài chính → Location → Room. Cấn trừ kiểm tra lại số dư nghĩa vụ, tiền cọc chưa dùng và chưa giữ cho hoàn tiền, hash ảnh thiệt hại. Retry cùng actor/key/input trả kết quả cũ; thay nội dung cùng key bị 409. DB cũng chặn phân bổ thiếu quyết định hoặc vượt nguồn/đích.
- Tenant xem theo nhóm quyền được chụp lúc duyệt, gồm người thuê khác đủ điều kiện trong phòng. Người mới vào sau không tự nhận nợ lịch sử. Kết thúc cư trú không mất quyền cũ. DTO Tenant loại danh sách ID người thuê khác và metadata của lệnh ghi.
- Không cho tạo kế hoạch khấu trừ kiểu cũ nếu đã có khoản phải thu/cấn trừ mới và ngược lại. Dữ liệu kế hoạch cũ được giữ để tiếp tục xử lý có kiểm soát; việc chuyển hoàn toàn endpoint cũ sang mô hình mới còn trong phần tiếp theo.

## API

Tất cả dùng xác thực; `NoStore`. Mọi POST cần UUID `Idempotency-Key`.

| Method | Đường dẫn                                                  | Quyền / dữ liệu                                                                                                                                                                      |
| ------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/api/v1/contracts/{id}/move-out/receivables`              | Owner hoặc Tenant thuộc hồ sơ/khoản phải thu. Trả `reference`, cọc còn dùng, khoản phải thu/số đã phân bổ/còn nợ/trạng thái, lịch sử cấn trừ. Owner nhận thêm hóa đơn đích và số dư. |
| POST   | `…/receivables/damage`                                     | Owner. `expectedReference`, `inspectionId`, `inspectionVersion`, `assetId` nullable cho phòng, `amount` VND nguyên dương, `description`, 1–5 `evidenceIds`, `humanConfirmed=true`.   |
| POST   | `…/receivables/deposit-offsets`                            | Owner. `expectedReference`, đúng một trong `receivableId`/`invoiceId`, `amount`, `reason`, `humanConfirmed=true`. Không tự chọn ưu tiên cấn trừ.                                     |
| GET    | `/api/v1/tenant/settlement-receivables?page=1&pageSize=20` | Tenant; lọc quyền trước phân trang, tối đa 25 hồ sơ/trang.                                                                                                                           |

Money JSON là chuỗi thập phân VND. Các trạng thái khoản phải thu được backend suy ra từ ledger: `Unpaid`, `PartiallyPaid`, `Paid`. Không dùng thao tác UI để xác nhận đã thanh toán.

## Nối ngân hàng thủ công

- `GET …/receivables/{chargeId}/transfer-instructions`: Owner/Tenant thuộc khoản phải thu. Trả tài khoản nhận đã cấu hình, nội dung, số dư và QR nội bộ; tài khoản chưa sẵn sàng thì không trả chi tiết nhận tiền. QR không xác nhận thanh toán.
- `POST …/receivables/{chargeId}/bank-allocations`: Owner; body gồm `expectedReference`, `transferId` đã xác minh qua payment API hiện có, `paidByUserId` nullable, `humanConfirmed=true`; cần Idempotency-Key.
- Owner chọn khoản tiền đã xác minh từ `/api/v1/payment-transactions`, rồi chọn khoản đích/người thực trả tại sổ phải thu. Nội dung không khớp hoặc mã đã claim giữ PendingReview và không giảm nợ. Một receipt chỉ ghi tiền một lần; phân bổ min(received, outstanding), tiền dư không chuyển thành Tenant Credit.
- Nguồn hoàn Receipt hiện có chọn đúng Resident liên kết người thực trả trong snapshot, kể cả khác người đại diện và không còn ở phòng. Chưa xác định được người trả thì chờ xác minh; chưa có nhánh hoàn cho người trả bên ngoài không có Resident được xác minh.
- GET payment-transactions hỗ trợ `settlementContractId`, lọc trước phân trang. TransferView thêm `allocatedSettlementContractId`/`allocatedSettlementReceivableId`.
- Thông báo khoản phải thu/offset/tiền nhận có khóa dedupe, không chứa số tiền hoặc sao kê; in-app/email intent cùng giao dịch tiền. Resolve target kiểm lại quyền snapshot trước khi điều hướng Tenant.
- Nhóm chịu nghĩa vụ giới hạn theo thời điểm kiểm tra cuối: người kích hoạt hợp đồng sau lúc kiểm tra, kể cả cùng ngày, không nhận thiệt hại cũ. Hợp đồng đã kết thúc trước ngày phát sinh bị loại.

## Persistence và migration

Vẫn 24 bảng. `SettlementReceivableV1` và `DepositOffsetApprovalV1` là record bất biến trong `contracts.history`. Thêm ba cột nullable vào bảng phân bổ hiện hữu: `target_settlement_contract_id` (FK), `settlement_receivable_id`, `deposit_offset_approval_id`; ràng buộc đúng một đích, cặp tham chiếu khoản phải thu, index duy nhất cho quyết định cấn trừ, trigger kiểm nguồn/đích. EF migration `20261111035703_SettlementReceivableLedger`; không đổi baseline cũ, không migrate DB làm việc.

Migration `20261111050000_SettlementBankAllocations` chỉ bổ sung SQL guard, không đổi EF model. Trigger kiểm receipt verified/chưa dùng/chưa claim, người trả đủ điều kiện và số tiền đúng phần còn nợ. `SettlementBankAllocationV1` lưu quyết định, actor, target, key/fingerprint, money effect và phần ngoài phân bổ. Không migrate DB làm việc.

## Còn phải hoàn thành

Tính điện/nước chốt từ baseline đã tính tiền, tiền thuê tháng lẻ theo chính sách hiệu lực, duyệt danh sách phí cuối kỳ hoàn chỉnh, điều chỉnh khoản đã duyệt, hoàn phần cọc dư sau cấn trừ và đưa các khoản mới vào tổng thu/nợ của báo cáo tài chính. Báo cáo đã nhận diện nhánh hoàn dư mới, nhưng chưa tổng hợp doanh thu/phải thu mới. Hiện sổ vẫn giữ các blocker quyết toán tương ứng; không coi một khoản thiệt hại là đã duyệt toàn bộ nghĩa vụ. Bank/MySign/Email/SMS sandbox thật còn thiếu nhà cung cấp/access.

## Bằng chứng kiểm thử

Kiểm thử trên PostgreSQL local dùng DB `bhome_compact24_<uuid>` riêng, xóa sau mỗi fixture; object storage là test substitute rõ ràng. Không phải bằng chứng MinIO/bank thật.

- Hai kịch bản API tích hợp mới: 600.000đ phải thu, 400.000đ cọc phân bổ qua hai quyết định, còn 200.000đ sau bàn giao; quyền người cùng phòng/người ngoài; replay/race; không thêm/sửa hóa đơn; DB từ chối bypass; ảnh bị thay đổi bị chặn; hóa đơn có điều chỉnh Final được cấn đúng số dư.
- Migration upgrade/replay, snapshot, bốn ca physical release và hai ca khoản phải thu: **8 PASS** sau thay đổi backend cuối.
- Nhóm hồi quy payment/contract/invoice/refund/finance hiện hữu: **71 PASS**. Application unit: **387 PASS**. Owner Web 3 file/**20 PASS**; Mobile 1 file/**1 PASS**.
- Owner/Mobile typecheck, ESLint các file thay đổi, `git diff --check`: PASS. Chưa chạy native UI E2E hoặc kiểm thử provider thật cho phần này.

Sau bước nối ngân hàng thủ công: nhóm 3 ca khoản phải thu + migration + snapshot **5 PASS**; payment/refund/finance/inbox regression **46 PASS**; Application unit **387 PASS**; Owner 3 file/**10 PASS**, Mobile 3 file/**25 PASS**; typecheck hai client và changed-file ESLint PASS. Ca mới chạy thiếu → dư → hoàn 50.000đ cho người thực trả khác đại diện; trùng reference/replay/concurrency; tài khoản nhận chưa cấu hình/đã cấu hình; trạng thái sau bàn giao; người vào cùng ngày nhưng sau kiểm tra bị loại; quyền target thông báo; không lộ sao kê trong thông báo. Đây là dữ liệu tổng hợp và xác minh thủ công trong test, **không phải PASS bank sandbox thật**.
