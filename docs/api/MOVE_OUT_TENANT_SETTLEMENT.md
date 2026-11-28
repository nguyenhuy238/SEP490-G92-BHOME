# Tenant xác nhận phí trả phòng, SePay và hoàn cọc

Phạm vi: BF-03/BF-06, UC-19/UC-22–25, GBR-10; giữ các quy tắc đối soát
và khấu trừ cọc hiện có, không tự đặt một chính sách khấu trừ mới (OQ-01/OQ-05).

## Luồng chính

1. Staff lưu thành công kết quả kiểm kê Final và bằng chứng riêng của các hạng
   mục. Owner xem kết quả, tự duyệt **giá tiền, lý do và hạng mục** khi gửi
   `POST /api/v1/contracts/{contractId}/move-out/receivables/proposal`.
   **Đề xuất phí Owner gửi chính là phê duyệt tài chính**; không yêu cầu Owner
   thực hiện thêm `inspection-review` trước hoặc sau khi Tenant đồng ý.
   Tenant xem bằng `GET` cùng route.
2. Tenant gửi `POST /api/v1/contracts/{contractId}/move-out/receivables/proposal/tenant-feedback`
   (header `Idempotency-Key`) với `proposalId`, `expectedReference`, `confirmed`
   và khi không đồng ý, `reason` và/hoặc `disputedItems` (`kind`, `assetId?`,
   `roomCheckCode?`, `accessType?`, `reason`). Tenant chỉ được phản đối hạng mục
   đã có trong bản đề xuất. Owner thấy phản hồi từng khoản, sửa và gửi lại.
3. Khi Tenant **đồng ý**, Backend kiểm tra lại bản Final của Staff,
   bằng chứng riêng đúng hạng mục, hóa đơn/khoản nợ và tiền cọc đã đối soát. Backend
   ghi khoản phải thu và cấn cọc trong **cùng transaction** trước khi trả về
   `tenantFeedback.settlement`:

   - `Payable`: có `payableAmount` và `payableReceivableId`. Tenant tự mở
     `GET /api/v1/contracts/{contractId}/move-out/receivables/{payableReceivableId}/transfer-instructions`.
     SePay cấp mã `BH########` và QR **chính xác số còn thiếu sau cấn cọc**.
     Mobile kiểm tra lại trạng thái định kỳ. Chỉ webhook đã xác minh, đúng mã,
     đúng số tiền, đúng tài khoản và môi trường mới ghi nhận thanh toán.
   - `RefundEligible`: có `refundAmount` thực tế còn lại. Tenant mở màn yêu cầu
     hoàn tiền đã điền số tiền/hợp đồng và gửi `POST /api/v1/tenant/refund-requests`
     với `moveOutProposalId`. Backend kiểm tra hợp đồng thuộc Tenant, proposal
     hiện hành đã xác nhận, số tiền đúng và tiền cọc vẫn còn khả dụng; chặn
     đơn trùng. Owner duyệt hoặc từ chối có lý do tại
     `/api/v1/owner/tenant-refund-requests`.
   - `Settled`: không còn phải thu hoặc hoàn, không phát QR.
   - `PendingOwnerReview`: không ghi khoản thu mới/không phát QR khi bằng chứng
     riêng của từng hạng mục, bản Final của Staff hoặc phân bổ nghĩa vụ chưa
     đủ an toàn. Trạng thái này **không được dùng làm bước phê duyệt Owner lần hai**.

   Đối với xác nhận Tenant cũ đã lưu `PendingOwnerReview` do điều kiện
   `owner_confirmed_inspection_required`, client gọi
   `POST /api/v1/contracts/{contractId}/move-out/receivables/proposal/reconcile`
   với JSON `{ "proposalId": "<proposal-id>" }`. Route chỉ dành cho Tenant đã
   xác nhận bản đề xuất hiện hành; không yêu cầu gửi lại quyết định đồng ý.
   Backend dùng transaction khóa hợp đồng, kiểm tra snapshot Final và ledger
   hiện hành, ghi khoản phải thu/cấn trừ cọc đúng một lần và lưu một bản ghi
   **reconciliation riêng, chỉ bổ sung** cho phản hồi Tenant gốc. Gọi lặp sẽ
   trả cùng kết quả. Nếu dữ liệu bị thay đổi hoặc thiếu bằng chứng riêng thì
   từ chối phát sinh thu tiền mà vẫn giữ nguyên phản hồi trước đó.
   Đề xuất lịch sử chưa có `physicalReference` chỉ được đối soát khi
   `sourceReference` gốc còn khớp chính xác; bản ghi reconciliation mới phải
   khóa `physicalReference` đã xác minh. Màn QR, webhook SePay và hoàn cọc sử
   dụng hash đã khóa đó để kiểm tra chứng cứ vật lý về sau.

**Không hoàn tiền hai lần:** đơn Tenant liên kết `moveOutProposalId` là yêu cầu
Owner xem xét, **không phải** một giao dịch hoàn cọc đã thực hiện. Đường
`/owner/tenant-refund-requests/{id}/execution` không được thực thi đơn loại
này. Chuyển khoản hoàn thật và chứng từ phải dùng luồng hoàn tiền cọc đã phân
loại của hợp đồng, có xác minh người nhận và sổ nguồn tiền.

## Giới hạn an toàn

- PostgreSQL hiện giới hạn một khoản chuyển tiền tự động phân bổ cho một
  receivable. Nếu sau cấn cọc còn nhiều khoản phải thu hoặc vẫn có hóa đơn
  chưa thanh toán, **không tạo QR tổng giả**, trả `PendingOwnerReview`.
- Mỗi khoản phí tự động ghi nhận phải dựa trên bản kiểm kê Final của Staff, giá
  và lý do đã được Owner duyệt trong đề xuất, Tenant đồng ý, cùng với ảnh Final
  **được liên kết đúng hạng mục**. Hạng mục thiếu bằng chứng không được ghi khoản
  thu hay cấn cọc tự động.
- Phản hồi Tenant đã đồng ý trước khi sửa điều kiện cũ được sử dụng lại bằng
  route `proposal/reconcile` khi cùng bản Final và nguồn tiền còn hợp lệ.
  Không nhân bản phản hồi hoặc khoản phải thu. Nếu kiểm kê hoặc công nợ thực tế
  thay đổi, Backend không tự tạo khoản thu dựa trên dữ liệu lỗi thời.
- Không cấp QR tự động nếu SePay, tài khoản ngân hàng nhận, môi trường
  Test/Live hoặc registry mã thanh toán chưa được cấu hình đúng. QR không phải
  chứng từ đã thanh toán; webhook trùng phải không phân bổ lặp.
- Mọi lần sửa kiểm kê hoặc nghĩa vụ phải được Backend kiểm tra lại; chỉ giữ
  xác nhận cũ khi snapshot vật lý bất biến và các khoản tiền đã ghi nhận đúng
  nguồn. Không phát QR mới cho khoản đã thanh toán.

## Triển khai và xác minh

- Áp dụng migration tiến `20261122000100_SettlementSePayCodes` qua quy trình
  EF Core Compact24. Migration mở rộng trigger SePay để chấp nhận payment code
  loại `Settlement` nhưng vẫn khóa mã với receivable và Location hợp lệ;
  **không sửa migration cũ đã phát hành**.
- Cần cấu hình `SePay:Enabled`, `SePay:Mode`, `SePay:ReceivingAccounts`
  trùng tài khoản nhận tiền của Location và webhook secret theo quy trình
  SePay sẵn có. Không đưa khóa/tài khoản thật vào source/test.
- Kiểm thử Docker `PropertyContractDockerTests.MoveOutProposalNetDepositSePay` và
  `MoveOutAlreadyAcceptedReconcilesWithoutSecondConsent` bao phủ giá do Owner
  duyệt sau Final của Staff (không cần review thứ hai), dư phí, hoàn cọc, vừa đủ
  cọc, đồng ý cũ được đối soát một lần, webhook giả lập ký hợp lệ gửi lặp và
  trạng thái sau webhook; không thay thế kiểm thử kết nối ngân hàng Live.
