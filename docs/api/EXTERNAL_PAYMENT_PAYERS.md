# Người thực trả bên ngoài — BR-17/18/19/23

Ngày 11/11/2026. Không tạo Resident/User thay thế cho người chuyển tiền không có hồ sơ Resident. Chỉ Owner xác minh payer theo sao kê của receipt VERIFIED; nguồn ngân hàng và tiền đã nhận giữ nguyên.

## Contract Owner

`GET /api/v1/payment-transactions/{id}/external-payer` trả `{transferId,transferFingerprint,statementReference,problems,payer,isDevelopmentDemo}`.

`POST` cùng route, UUID Idempotency-Key, body `{expectedTransferFingerprint,payerLabel,reason,payerHasNoResidentProfile:true,humanConfirmed:true}`. Source/amount/status đọc lại từ backend; không nhận userId/residentId/amount/actor từ client. Receipt đã gắn payer Tenant, rejected, đã có Resident whole-excess disposition hoặc refund active/completed không được đổi sang external payer. Existing attestation là bất biến; cùng key/content replay, khác content/nguồn bị conflict; Production chặn demo. `ExternalPaymentPayerV1` nằm trong payments.history, fingerprint bind exact receipt, Owner/time/reason/audit. Nhãn/lý do chỉ dành Owner, không nhập CCCD hoặc tài khoản đầy đủ. Đây là Owner manual verification, không là provider sandbox acceptance.

Sau đó phân bổ receipt với paidByUserId null khi đúng nghĩa vụ/reference. Không được gắn receipt đó thành payer Tenant qua API hoặc native allocation. Whole-excess confirmation dùng `payerResidentId:null,externalPayerAttestationId:<id>`; context chỉ trả payer đã attested. Không có allocation 0.

Refund receipt dùng route request/decision/execution hiện hữu, body request `{beneficiaryResidentId:null,externalPayerAttestationId,amount,reason,humanConfirmed:true}`. Hai beneficiary identity là XOR; external payer phải đúng nguồn, không tự chọn representative. DTO Owner có beneficiaryKind RESIDENT/EXTERNAL và nullable beneficiaryResidentId; source có optional externalBeneficiary `{attestationId,label}`. Không có external beneficiary cho Security/Holding principal refund trong slice này; cần đối chiếu nguồn principal riêng. Extra fields nullable được bỏ khi hash request Resident để không làm đổi historical idempotency fingerprints.

Completed chỉ sau Owner approve, thực chuyển bên ngoài và private execution proof khớp intent/hash/reference; partial return giữ phần còn lại pending. Native check/trigger bảo vệ beneficiary/source/amount bất biến, attestation unique/matching, không relabel Tenant, external refund budget và matching completion metadata. Accounting và pending review chỉ chấp nhận đúng proof; không cộng tiền dư/hoàn dư vào collections/OPEX hoặc Tenant Credit.

## Persistence và views

Migration SQL-only `20261111070000_ExternalPaymentPayer`: refund_requests thêm beneficiary_kind mặc định RESIDENT, external_payer_attestation_id; beneficiary_resident_id nullable với XOR check. Không thêm bảng, vẫn Compact24/7 migrations; model snapshot không đổi. Functions/triggers đồng bộ fresh DDL; readiness kiểm cả CREATE OR REPLACE bodies. Up từ migration 6 giữ nguyên recipient/amount/historical requests; Down không được xóa lịch sử. Chỉ đã chạy trên disposable DB, không migrate database làm việc.

Owner Web: Thanh toán → giao dịch → Xác minh người trả bên ngoài, rồi đối soát/hoàn tiền; SettlementBankPanel có cùng attestation khi chọn receipt. Refund/whole-excess chọn nhãn payer đã xác minh, không nhập UUID hoặc tạo hồ sơ giả. Tenant xem payment history bằng nhãn chung “Người trả bên ngoài (đã xác minh)”; không có tên/căn cứ riêng. Tenant own-refund API loại external payer, không cấp quyền xem chứng từ. Owner Mobile giữ monitoring, không thêm form xác minh/hoàn.

Settlement giữ receipt_excess_refund_pending cho cả whole và allocated excess đến khi hoàn đủ/proof hợp lệ, độc lập với physical release. Schema/report/pending query không tải ảnh MinIO trên mỗi dòng; execution và authorized download vẫn kiểm bytes/hash. Main Deposit overage và excess phát sinh do approved adjustment cần luồng canonical tiếp theo; không suy đã giải quyết từ việc attestation/refund receipt này tồn tại.
