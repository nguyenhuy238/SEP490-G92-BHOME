# BF-04 — API kết thúc hợp đồng và quyết toán trả phòng

Đối chiếu ngày 16/11/2026 trên nhánh `member/Long`, HEAD `fce393b6`, với mô tả BF-04 do người dùng cung cấp trong hội thoại. Đây là kiểm tra source controller → DTO → service → repository; không phải kết quả gọi API trên một hợp đồng thật. Không chạy test, không sửa nghiệp vụ, không thay đổi database.

Ghi chú: đoạn trên mô tả phạm vi lượt audit ban đầu. Công việc UI và kết quả kiểm thử thực thi tiếp theo được ghi riêng tại [báo cáo triển khai Owner Web](../development/BF04_OWNER_WEB_IMPLEMENTATION_2026-11-16.md).

## 1. Quy ước đọc

- Prefix chung: `/api/v1`. `{id}` trong các route `/contracts/{id}` là ID hợp đồng; `{chargeId}` là ID khoản phải thu quyết toán.
- O = Owner; S = Staff; T = Tenant. Các role dưới đây còn chịu kiểm tra phạm vi cơ sở/hợp đồng/người thuê tại service, không chỉ kiểm tra role tại controller.
- Response JSON dùng camelCase. Các danh sách dưới đây là tên field thật từ DTO; `?` trong mô tả biểu thị nullable, không phải một phần tên field.
- Tiền và nhiều giá trị decimal trả về dạng JSON string, ví dụ `"2500000"`. Ngày: `yyyy-MM-dd`; timestamp: ISO 8601. Không mặc định mọi con số đều là string: version, count, HTTP status vẫn là số.
- Các mutation hợp đồng/quyết toán/hoàn tiền có `Idempotency-Key` UUID; thiếu/sai/reuse sai payload có thể bị 400/409. Các API hóa đơn/capture có cơ chế riêng, không áp dụng máy móc header này cho tất cả endpoint.
- JSON body trả trực tiếp DTO, không có envelope chung kiểu `{ success, data }`. Hầu hết endpoint bên dưới thành công HTTP 200. Tạo renewal trả 201. File trả binary.
- Có endpoint không đồng nghĩa toàn bộ nghiệp vụ đã hoàn chỉnh. Các điểm lệch nằm ở mục 11.

## 2. Sắp hết hạn và gia hạn

### GET `/contracts/expiry-reminders` — O, T

HTTP 200, `ContractExpiryNoticeView[]`:

```text
id, contractId, roomNumber, locationName, endDate, stage, createdAt
```

`stage`: `Upcoming30` hoặc `Expired`. Danh sách tối đa 100 notice, lọc theo hợp đồng còn Active và kỳ hết hạn tương ứng. S không được gọi route này.

Có hai đường xử lý thông báo cần phân biệt:

- `ContractExpiryScheduler` + `ContractExpiryProcessor`: job kiểm tra mỗi ngày, cửa sổ 30 ngày; notice riêng cho Owner/Tenant. Chỉ chạy khi `Jobs:Enabled=true`.
- `CompactNotificationEvents.OperationalAlerts`: luồng notification Compact24 kiểm tra hợp đồng trong 30 ngày và phát `CONTRACT_EXPIRY_REMINDER` cho Owner, Tenant và Staff đang được phân công tại Location. Staff đọc qua API notification chung.

Profile local `.env.neon.dev04` đang có `Jobs__Enabled=false`, `NotificationChannels__AutomationEnabled=true`: scheduler riêng không chạy, nhưng luồng notification chung vẫn có thể phát nhắc hạn. Không thể suy ra `/expiry-reminders` chắc chắn có dữ liệu chỉ vì inbox đã có thông báo.

### GET `/notifications?category=Contract` — O, S, T có quyền đọc thông báo của mình

HTTP 200, `PagedResult<NotificationView>`:

```text
items[], page, pageSize, totalCount
items[]:
  id, category, title, summary, relatedObjectType, relatedObjectId,
  createdAt, readAt, deliveryState, eventType, priority, source, isRead,
  action: { type, entityId } | null
```

`GET /notifications/unread-count` → `{ unreadCount }`.
`GET /notifications/{id}/target` → `{ objectType, objectId, locationId, billingPeriod }`.
`POST /notifications/process-events` → `{ createdCount }`, quyền `Locations.Manage`; đây là phát thông báo từ event, không phải API chạy riêng job hết hạn.

### POST `/contracts/{id}/renewals` — O, S

Request: `{ endDate, monthlyRent, terms }`.
Response HTTP **201**: `{ id }`, ID bản hợp đồng renewal mới; không trả toàn bộ hợp đồng và không tự xác nhận đã ký/đã kích hoạt.

Điều kiện: hợp đồng gốc Active; chưa có move-out; chưa có renewal đang mở; endDate mới phải sau endDate cũ. Tạo version mới `kind=Renewal`, `previousContractId=id`, bắt đầu sau ngày kết thúc bản trước.

API tiếp theo liên quan:

- `GET /contracts/{newId}` — O/S/T: `ContractView`.
- `GET /contracts/{id}/versions` — O/S/T: `{ id, previousContractId, kind, status, startDate, endDate, monthlyRent, terms }[]`. Staff bị ẩn giá/điều khoản ở service của route versions.
- `POST /contracts/{newId}/signing` — O/T: `SignatureView` gồm `id, signerUserId, status, signedAt, method, expiresAt, certificateSubject, certificateIssuer`.
- `POST /contracts/{newId}/signing/sync` — O/T: `ContractView`.
- `GET /contracts/{newId}/activation-readiness` — O/S/T: `{ ready, verifiedDeposit, remainingDeposit, blockers[] }`.
- `POST /contracts/{newId}/activate` — O: `ContractView`. Phải qua readiness; khi kích hoạt renewal, bản cũ chuyển Superseded. Ký xong không đồng nghĩa renewal tự Active.
- `POST /contracts/{newId}/renewal-cancellation` — O: `ContractView` có status Cancelled khi còn ở trạng thái cho phép.

## 3. Yêu cầu chấm dứt / không gia hạn

### POST `/contracts/{id}/termination-requests` — T

Request: `{ proposedDate, reason }`.
Response HTTP 200: `MoveOutView`, `status=Requested`.

Hợp đồng phải Active, không có renewal đang mở, chưa có move-out. Ngày đề nghị không được trước hôm nay/bắt đầu hợp đồng; chấm dứt trước hạn yêu cầu `proposedDate < contract.endDate`.

### POST `/contracts/{id}/expiry-move-out` — O

Cùng request/response ở trên. Dùng cho không gia hạn; yêu cầu ngày đề nghị không trước ngày hết hạn. Vẫn tạo yêu cầu Requested, chưa tự Approved.

### GET `/contracts/{id}/move-out` — O, S, T

Response HTTP 200: `MoveOutView`; chưa có yêu cầu thì **404**, không phải `{}`.

```text
id                         ID hồ sơ move-out, không phải contractId
status                     Requested | Approved | Inspected | PendingSettlement | Settled | Completed
proposedDate, reason
inspectionScheduledAt, inspectionStaffId
inspectionNotes, inspectedAt
electricityReadingId, waterReadingId
evidenceIds[]
pendingReason
version
ownerConfirmedInspection
financialReviewStatus      PendingReview | OwnerReviewed
```

GET này tính lại `ownerConfirmedInspection` từ inspection mới nhất và lấy evidenceIds từ repository. Nhiều POST khác trả qua `View(m)`, để `evidenceIds=[]` và `ownerConfirmedInspection=false` mặc định. Sau mutation nên GET lại move-out/inspections; không lấy mặc định của POST để suy ra Owner chưa duyệt.

### POST `/contracts/{id}/move-out/approve` — O

Không có body nghiệp vụ, cần Idempotency-Key. Response: `MoveOutView`, `status=Approved`, version tăng. Chỉ duyệt hồ sơ Requested của hợp đồng Active.

**Không tìm thấy API reject/decline/cancel yêu cầu chấm dứt.** `MoveOutStatus` cũng không có Rejected. Publisher có tiêu đề thông báo Rejected nhưng chưa thấy mutation tạo action này; không coi đó là tính năng từ chối đã hoạt động.

## 4. Lịch kiểm tra và bàn giao

### POST `/contracts/{id}/move-out/schedule` — O, S

Request: `{ scheduledAt, staffUserId?, expectedVersion? }`.
Response: `MoveOutView`; cập nhật `inspectionScheduledAt`, `inspectionStaffId`, `version`; status vẫn Approved.

`scheduledAt` phải ở tương lai và có UTC offset 0 (dùng hậu tố Z). Staff phải đang được phân công đúng cơ sở. S bỏ staffUserId thì tự nhận; O bỏ staffUserId có thể lưu lịch chưa gán người.

### GET `/contracts/move-out-assignments` — S

Response HTTP 200:

```text
[{ contractId, roomId, roomNumber, locationName, status, proposedDate, scheduledAt, version }]
```

### GET `/contracts/{id}/move-out/inspection-preparation` — O, S

Response `InspectionPreparation`:

```text
baseline: HandoverView | null
baselineContractId: UUID | null
finalReadings: HandoverReading[]
otherTenantsRemain: boolean
```

Baseline tìm từ hợp đồng hiện tại hoặc chuỗi bản trước có bàn giao Confirmed. Đây là dữ liệu để so sánh lúc nhận phòng với lúc trả phòng, không tự ghi nhận đã kiểm kê.

Các cấu trúc lồng:

```text
HandoverView:
  version, status, snapshot, tenantConfirmedVersion, tenantConfirmedAt, staffConfirmedAt
HandoverSnapshot:
  date, roomNumber, roomCondition, keysAndAccess, notes,
  assets[], electricity, water, evidenceIds[]
HandoverAsset:
  id, name, inventoryCondition, observedCondition
HandoverReading:
  id, meterCode, utilityType, date, value, evidenceId, evidenceHash
```

`evidenceObjectKey` của reading có JsonIgnore, không trả object-storage key này cho client.

### POST `/contracts/{id}/move-out/evidence` — S

Body là ảnh binary PNG/JPEG, tối đa 5 MiB, không phải JSON/multipart. Response HTTP 200 `{ id }`, ID bằng chứng. Chỉ cho upload khi move-out Approved; service giới hạn tổng số evidence.

### GET `/contracts/{id}/move-out/evidence/{evidenceId}` — O/S/T theo quyền hợp đồng

Trả file binary `application/octet-stream`, không phải JSON metadata.

### POST `/contracts/{id}/move-out/inspection` — S

Request:

```text
electricityReadingId, waterReadingId, notes,
evidenceIds: UUID[1..5],
assets?: [{ id, condition }], roomCondition?, keysAndAccess?, expectedVersion?
```

Mặc dù một số field khai báo nullable cho tương thích cũ, luồng có baseline yêu cầu đủ checklist assets, roomCondition, keysAndAccess. IDs tài sản phải khớp baseline. Điện/nước phải là reading cuối kỳ đã xác nhận, đúng hợp đồng/phòng/ngày; không chỉ truyền số đọc tùy ý.

Response: `MoveOutView`, `status=Inspected`, có inspectedAt/notes/reading IDs; pendingReason có thể vẫn báo chờ ledger. Không kết luận đã quyết toán chỉ từ việc lưu inspection thành công.

Điều kiện đáng chú ý: phải có lịch, status Approved, ngày hiện tại đã đến proposedDate, đúng Staff được giao nếu đã gán.

### GET `/contracts/{id}/move-out/inspections` — O, S, T

Response HTTP 200:

```text
[{ id, version, baselineContractId, baselineVersion,
   baseline: HandoverSnapshot, observed: HandoverSnapshot,
   staffId, inspectedAt, ownerDecision, ownerReason, reviewedAt }]
```

`ownerDecision`: null, Confirmed hoặc Reinspection.

### POST `/contracts/{id}/move-out/inspection-review` — O

Request: `{ version, confirmed, reason, noAdditionalCharges }`.
Response: `MoveOutView`.

- confirmed=true: ghi OwnerDecision=Confirmed, giữ trạng thái inspection đã gửi.
- confirmed=false: ghi OwnerDecision=Reinspection, move-out về Approved để kiểm tra lại.
- noAdditionalCharges chỉ có hiệu lực khi confirmed=true.
- Version phải khớp inspection mới nhất và inspection chưa được quyết định.

## 5. Chỉ số điện/nước phục vụ inspection

Inspection không tạo reading. Nhánh capture có sẵn:

- `POST /capture/meter-tasks` — O. Request `meterId, purpose, readingDate, billingPeriod, contractId`; trả `{ id }`.
- `PUT /capture/meter-tasks/{taskId}/evidence` — S. Binary PNG/JPEG; trả `{ id }` evidence.
- `POST /capture/meter-tasks/{taskId}/confirm` — S. Request `{ humanConfirmed, confirmedValue, evidenceId }`; trả `ConfirmedReading`.
- `GET /capture/readings/{readingId}` — O/S theo phạm vi; trả `ConfirmedReading`.

`ConfirmedReading`: `id, taskId, confirmedValue, previousValue, consumption, status, confirmedAt`. Các giá trị decimal dùng string; status của DTO này là enum, không phải tất cả status trong hệ thống đều được service chuyển thành tên string như MoveOutView.

Lấy đúng purpose/ngày/hợp đồng theo capture workflow, sau đó dùng ID reading đã confirmed để gửi inspection. Không coi OCR suggestion là reading được xác nhận.

## 6. Tính và duyệt chi phí cuối kỳ

Prefix của nhóm này: `/contracts/{id}/move-out/receivables`.

### GET prefix — O, T

Response `SettlementReceivablesView`:

```text
contractId, roomId, reference, availableDeposit, roomNumber,
receivables: [{ charge: SettlementReceivable, allocated, outstanding, status }],
offsets: DepositOffsetApproval[],
invoices: [{ id, billingPeriod, payable, allocated, outstanding }] | null,
payers: [{ userId, displayLabel }] | null
```

Balance status: Paid / Unpaid / PartiallyPaid. Tenant chỉ thấy charge có entitlement; operationKey/fingerprint/recipientUserIds bị xóa hoặc làm rỗng, invoices/payers trả null. Không gọi API này bằng Staff.

`GET /tenant/settlement-receivables` — T → `{ items: SettlementReceivablesView[], page, pageSize, total }`. Lưu ý tên **total**, không phải totalCount; pageSize tối đa 25.

### GET `prefix/final-fixed-charges` — O

Response `FinalFixedChargePreview[]`:

```text
chargeCode, name, billingPeriod, reference, amount,
calculation: FixedChargeSource | null,
existingReceivableId, missingInputs[]
```

FixedChargeSource gồm kỳ tính, chargeCode/category, policyId/version, rate, policyReference, partialMonth, rounding, occupiedDays, periodDays, cumulativePricedAmount, alreadyPricedAmount, policyCalculatedAmount, approvedReduction, approvedAdjustmentIds và các field số người/ngày người khi áp dụng. Nguồn giá lấy từ snapshot của hợp đồng; preview có thể amount=null và missingInputs khác rỗng.

### POST `prefix/final-fixed-charges` — O

Request `{ chargeCode, expectedReference, policyAppliesToSignedTermsConfirmed }`.
Response: `SettlementReceivable` đã được duyệt; không phải `InvoiceView`.

### GET `prefix/final-utilities` — O

Response `FinalUtilityPreview[]`, gồm điện và nước:

```text
contractId, utilityType, billingPeriod, reference,
baseline: BillableMeterPoint | null, final: BillableMeterPoint | null,
alreadyBilledQuantity, quantity, amount, calculationSnapshot,
existingReceivableId, missingInputs[], pricePolicyId, pricePolicyVersion
BillableMeterPoint:
  readingId, evidenceId, date, value, imageHash, length, sourceKind, sourceId
```

quantity/amount có thể null nếu chưa đủ dữ liệu. Số đã tính kỳ trước được đối chiếu để tránh tính lặp.

### POST `prefix/final-utilities` — O

Request `{ utilityType, expectedReference, humanConfirmed }`.
Response: `SettlementReceivable`. UtilityType là enum request của backend; không mặc định gửi string nếu deployment chưa cấu hình converter enum-string.

### POST `prefix/damage` — O

Request `{ expectedReference, inspectionId, inspectionVersion, assetId?, amount, description, evidenceIds[], humanConfirmed }`.
Response: `SettlementReceivable`, kind `TenantDamage`.

Cần inspection Owner đã xác nhận, bằng chứng đúng nguồn, version/reference còn mới; không tự suy ra mức bồi thường từ ảnh. Có thể lập khoản phải thu lớn hơn tiền cọc; phần thiếu theo dõi riêng.

### GET `prefix/charge-review` — O

Response `{ reference, review: SettlementChargeReview | null, isCurrent, missingInputs[] }`.

### POST `prefix/charge-review` — O

Request `{ expectedReference, reason, allChargesConfirmed }`.
Response `SettlementChargeReview`: `id, contractId, sourceReference, chargeIds[], reason, approvedByUserId, approvedAt, operationKey, fingerprint, isDevelopmentDemo`.

Schema dùng chung `SettlementReceivable`:

```text
id, contractId, roomId, kind, sourceKey, inspectionId, inspectionVersion,
assetId, amount, description, calculationPolicy,
evidence: [{ id, length, sha256 }], recipientUserIds[],
approvedByUserId, approvedAt, operationKey, fingerprint, isDevelopmentDemo,
utility: SettlementUtilitySource | null,
fixedCharge: FixedChargeSource | null
```

## 7. Xử lý tiền cọc và thanh toán phần thiếu

### POST `prefix/deposit-offsets` — O

Request `{ expectedReference, receivableId?, invoiceId?, amount, reason, humanConfirmed }`.
Response `DepositOffsetApproval`:

```text
id, contractId, sourceDepositContractId, receivableId, invoiceId, amount,
reason, approvedByUserId, approvedAt, allocationId, operationKey, fingerprint,
sourceReference, sourceSnapshot, isDevelopmentDemo
```

Đây là route hiện tại để phê duyệt dùng cọc thanh toán nghĩa vụ, không phải POST settlement gửi tổng tiền từ frontend.

### POST `/contracts/{id}/deposit-deductions` — O — route legacy

Khai báo response `DepositDeductionPlan`, nhưng service hiện chỉ replay plan cũ đã tồn tại. Với thao tác mới hợp lệ, trả **409** `settlement_receivables_replace_legacy_deductions`. Không nên nối UI mới vào route này để tạo khấu trừ.

### GET `prefix/{chargeId}/transfer-instructions` — O, T

Response:

```text
contractId, receivableId, availability, bankIdentifier, accountNumber,
accountHolder, outstandingAmount, transferReference, qrImageDataUri, isDevelopmentDemo
```

availability: Available / InstructionsOnly / Settled / ReceivingAccountUnavailable. Khi không khả dụng, thông tin tài khoản/QR có thể null. Route chỉ cấp chỉ dẫn chuyển khoản, không xác nhận đã thanh toán.

### POST `prefix/{chargeId}/bank-allocations` — O

Request `{ expectedReference, transferId, paidByUserId?, humanConfirmed }`.
Response `SettlementBankAllocationResult`:

```text
id, contractId, receivableId, transferId, status, reason,
allocatedAmount, unallocatedAmount, allocationId, paidByUserId,
approvedByUserId, operationKey, fingerprint, approvedAt, isDevelopmentDemo
```

Đối soát transfer với khoản phải thu; không chỉ nhìn HTTP 200 để suy ra đã phân bổ: phải đọc status/reason/allocatedAmount.

## 8. Hoàn cọc còn lại

### GET `/contracts/{id}/deposit-refunds` — O

Response `RefundSource`:

```text
sourcePaymentId, excessAmount, refundedAmount, reservedAmount, availableAmount,
isDevelopmentDemo, beneficiaries: [{ id, label }], requests: RefundView[],
sourceDepositContractId, financialReference, blockers[], verifiedDepositAmount,
depositDeductions, approvedDepositOffsets, externalBeneficiary, maintenanceDeductions
```

availableAmount có thể null; đọc blockers và financialReference trước khi duyệt.

### POST `/contracts/{id}/deposit-refunds` — O

Request `DepositRefundInput`:

```text
refund: { beneficiaryResidentId?, amount, reason, humanConfirmed, externalPayerAttestationId? },
expectedFinancialReference, beneficiaryVerified, noDeductionsConfirmed,
expectedDeductionPlanId?, deductionsConfirmed
```

Response `RefundView`. Tạo yêu cầu chưa đồng nghĩa đã chuyển tiền cho Tenant.

### POST `/refund-requests/{refundId}/decision` — O

Request `{ expectedVersion, approve, reason, humanConfirmed }`.
Response `RefundView`; có luồng đồng ý/từ chối yêu cầu hoàn tiền. Đây **không phải** API từ chối yêu cầu chấm dứt hợp đồng.

### POST `/refund-requests/{refundId}/execution` — O

`multipart/form-data`: `expectedVersion, executedAt, externalReference, reason, humanConfirmed, evidence`.
Response `RefundView`, ghi nhận thực hiện hoàn tiền với chứng từ. BHOME không tự chuyển khoản thay Owner.

```text
RefundView:
  id, sourcePaymentId, beneficiaryResidentId, beneficiaryLabel, amount, reason,
  status, version, requestedAt, decisionReason, decidedAt, executedAt,
  externalReference, isDevelopmentDemo, history[], executionIntent,
  sourceDepositContractId, beneficiaryKind, externalPayerAttestationId
```

`GET /refund-requests/{refundId}/evidence` — O → file PNG/JPEG, không phải JSON.

`GET /tenant/refunds` — T → `{ items: TenantRefundView[], page, pageSize, totalCount }` với mỗi item `id, amount, sourceKind, status, requestedAt, decidedAt, executedAt, isDevelopmentDemo`.

Nhánh mới còn có `/tenant/refund-requests` và `/owner/tenant-refund-requests` cho Tenant chủ động đề nghị hoàn tiền; đây là workflow độc lập (`TenantRefundPetitionV1`), không thay thế đối soát hoàn cọc BF-04. Xem tài liệu `TENANT_REFUND_PETITIONS.md`.

## 9. Tổng hợp, xác nhận quyết toán và hoàn tất trả phòng

### GET `/contracts/{id}/move-out/settlement-summary` — O, T

Response `ContractSettlementSummary`:

```text
contractId, depositContractId, roomId, roomNumber, tenantUserId,
verifiedSecurityDeposit, appliedHoldingDeposit, contractSpecificOutstanding,
approvedFinalCharges, approvedDeductions, refundAmount,
invoices: [{ invoiceId, billingPeriod, shared, financials }],
unresolvedItems[], otherActiveContracts, resolved, reference,
transferVerificationStatus, calculation, financialReference,
depositDeductions, obligationReference, receivables[], chargeReview,
approvedDepositOffsets, maintenanceDeductions
```

Financials: `originalIssuedAmount, approvedAdjustmentTotal, effectivePayableAmount, allocatedPayments, outstandingAmount, potentialExcessAmount, financialVersion, reviewStatus`.

Calculation: `issuedTotal, approvedAdjustmentTotal, payableTotal, verifiedInvoicePayments, roomOutstanding, contractSpecificOutstanding, potentialInvoiceExcess, depositAllocated, depositRefunded, depositReserved, availableSecurityDeposit, depositPositionConsistent, approvedDepositDeductions`.

Một số số tiền nullable vì chưa đủ cơ sở hoặc hóa đơn dùng chung chưa có chính sách chia nợ từng Tenant. Không chuyển null thành 0 rồi kết luận hết nợ.

`reference` có prefix BH40-, là snapshot quyết toán để chống duyệt dữ liệu cũ. Các reference cho chi phí/cọc có mục đích khác nhau; dùng reference đúng từ API preview tương ứng.

Các unresolvedItems thực sự có trong ledger, ví dụ:

- owner_termination_approval_required
- owner_confirmed_inspection_required
- confirmed_handover_baseline_required
- final_charges_and_damage_policy_pending
- final_charge_review_required
- final_invoice_coverage_required:yyyy-MM
- draft_invoice_pending
- invoice_outstanding
- settlement_receivable_outstanding
- invoice_adjustment_pending
- bank_transfer_pending_review
- final_meter_readings_required
- deposit_deduction_refund_policy_required
- deposit_ledger_reconciliation_required
- deposit_offset_reconciliation_required
- receipt_excess_refund_pending
- maintenance_compensation_pending

### POST `/contracts/{id}/move-out/settlement` — O

Request `{ decision, expectedReference? }`.
Response **HTTP 200 `MoveOutView` cả khi chưa quyết toán xong**:

- Chưa đủ điều kiện: status PendingSettlement, pendingReason chứa blocker.
- Ledger xác nhận nghĩa vụ/cọc/giao dịch đều hoàn thành: status Settled, financialReviewStatus OwnerReviewed, pendingReason rỗng.
- Nếu đã đóng trả phòng vật lý, endpoint vẫn cho review quyết toán sau đó; status move-out giữ Completed.

`decision` là ghi nhận nội dung quyết định, không phải một enum có quyền ghi đè ledger. Không truyền một câu xác nhận để bỏ qua tiền thiếu/chứng từ.

### GET `/contracts/{id}/move-out/settlement-history` — O, T

Response:

```text
[{ id, decision, settled, reviewedByUserId, reviewedAt, financialSnapshot }]
```

financialSnapshot là **string chứa JSON**, không phải JSON object tự động bung sẵn.

### POST `/contracts/{id}/move-out/complete` — O

Request `{ actualEndDate }`.
Response `ContractView`; status hợp đồng **Terminated**, actualEndDate được ghi nhận. Hồ sơ move-out chuyển Completed. Không có enum/field status tên MoveOutSettled trong ContractStatus.

Service yêu cầu inspection đã được Owner Confirmed, đúng ngày trả thực tế, reading và hash ảnh khớp. Tuy nhiên **không bắt buộc status Settled/resolved=true**: vẫn nhận move-out Inspected hoặc PendingSettlement. Đây là tách đóng cư trú vật lý khỏi quyết toán tài chính; khác mô tả BF-04 cung cấp nếu mô tả đó yêu cầu chỉ đóng sau khi xong mọi nghĩa vụ.

ContractView có các field:

```text
id, roomId, kind, status, startDate, endDate, monthlyRent, requiredDeposit,
terms, previousContractId, residentIds[], signatures[], activatedAt,
ownerSignerId, tenantUserId, representativeResidentId, holdingContractId,
appliedHoldingDeposit, locationId, isDevelopmentDemo, roomNumber, locationName,
occupants, actualEndDate, onboardingDraft, holdingExpiresAt, reservedCapacity,
approvedAt, priceLockedAt, priceLockTrigger, convertedMainContractId,
signingMode, snapshotHash, agreedCharges, initialPaymentRequired,
ownerOnlySandboxConfirmed, sandboxTenantSimulated, paymentMode
```

`occupants` là field tùy đường lấy response; GET contract bổ sung dữ liệu, response mutation có thể để null.

Khi complete:

- Kết thúc ResidenceTo; cập nhật actual_move_out_date và history cư trú. Registration đã Completed được giữ làm lịch sử; các trạng thái đăng ký khác đổi Closed.
- Bỏ Resident.RoomId nếu không còn hợp đồng Active khác giữ cư trú.
- Nếu phòng còn hợp đồng Active khác, giữ Occupied. Nếu không còn và phòng đang Occupied, đổi Available; trạng thái khác được giữ.
- Không tự suy ra phòng phải Maintenance chỉ từ mô tả tài sản hỏng trong inspection.

## 10. Hóa đơn và lịch sử liên quan

Có API hóa đơn hiện hữu, nhưng không thấy POST settlement tự tạo hóa đơn cuối kỳ:

- `POST /invoices/drafts` — O: `{ roomId, billingPeriod, representativeContractId? }` → `InvoiceView`.
- `POST /invoices/{invoiceId}/refresh` — O: `{ expectedVersion }` → `InvoiceView`.
- `POST /invoices/{invoiceId}/finalize` — O: `{ expectedVersion }` → `InvoiceView`.
- `GET /invoices/{invoiceId}` — O, T → `InvoiceView`.

```text
InvoiceView:
  id, roomId, locationId, roomNumber, locationName, billingPeriod, status,
  version, total, missingInputs[], scheduledFinalDate, dueDate, finalizedAt,
  representativeTenantUserId, lines[], type
```

`lines[]`: `id, category, chargeCode, name, policyId, policyVersion, rateDate, rate, quantity, occupiedDays, periodDays, amount, meterReadingId, previousReading, confirmedReading, calculatedAmount, correctionRequestId, utilityCalculationSnapshot`.

Các final-fixed-charges/final-utilities là **khoản phải thu quyết toán riêng**; không gọi chúng là hóa đơn cuối kỳ tự phát hành.

Tra cứu lịch sử:

- `GET /contracts/{id}/history` — O/S/T → `{ action, actorId, occurredAt }[]`.
- `GET /contracts/{id}/move-out/history` — O/S/T → `{ version, action, actorId, occurredAt, snapshot }[]`. snapshot là string JSON.
- `GET /contracts/{id}/handover` — O/S/T → HandoverView.
- `GET /contracts/{id}/handover/history` — O/S/T → `{ version, action, actorId, occurredAt, note, snapshot: HandoverSnapshot }[]`.
- `GET /contracts/{id}/document` — O/T → file PDF đã ký, không phải JSON.
- `GET /rooms/{roomId}` và `/rooms/{roomId}/readiness` — quyền Property.View → trạng thái/phân tích sẵn sàng của phòng; có kiểm tra scope riêng.

## 11. Những điểm chưa khớp đầy đủ BF-04

1. **Từ chối chấm dứt:** thiếu route, request DTO và MoveOutStatus tương ứng. Chưa ghi nhận được nhánh Owner từ chối kèm lý do như mô tả.
2. **Staff nhận lịch trả phòng:** có lịch và assignments API. Nhưng `SettlementAudience` phát thông báo thay đổi move-out chỉ cho Owner/Tenant; chưa thấy Staff được đưa vào audience Scheduled. Thông báo nhắc hết hạn 30 ngày cho Staff là luồng khác, đã có.
3. **Hóa đơn cuối kỳ tự động:** có hóa đơn thường và sổ phải thu quyết toán, nhưng POST settlement không tự tạo/finalize InvoiceView như câu mô tả nghiệp vụ.
4. **Điều kiện đóng hợp đồng:** complete cho đóng cư trú khi nợ chưa xong. Response là Terminated/Completed, không phải status Move-out Settled. Khi đọc UI phải kiểm tra thêm settlement-summary.resolved và lịch sử quyết toán.
5. **Phòng cần sửa chữa:** complete chưa tự chuyển Maintenance từ kết quả inspection; có thể đổi Available nếu đang Occupied và hết hợp đồng khác. Chưa đủ để kết luận tự động chặn cho thuê mới vì mọi hư hỏng đã ghi nhận.
6. **Theo dõi/nhắc khoản thiếu:** có PendingSettlement, unresolvedItems, history và thông báo theo sự kiện, cùng notification khoản phải thu/thanh toán. Chưa xác nhận một lịch nhắc lặp riêng BF-04 cho mọi khoản quyết toán thiếu; không coi thông báo lúc đổi trạng thái là nhắc định kỳ.
7. **Route legacy khấu trừ:** tồn tại deposit-deductions nhưng thao tác tạo mới trả 409; phải dùng receivables + deposit-offsets.
8. **Response dễ hiểu nhầm:** HTTP 200 settlement có thể PendingSettlement; POST inspection-review có thể trả ownerConfirmedInspection=false mặc định dù quyết định vừa Confirmed. Luôn refresh GET và đọc status/blocker.

Các điểm trên là phát hiện đối chiếu, không phải đề xuất tự đổi quy tắc tài chính. Nếu sửa theo BF-04 mới, cần thống nhất riêng việc tách đóng cư trú vật lý khỏi quyết toán và điều kiện cho thuê lại phòng.

## 12. Error contract

Lỗi nghiệp vụ đi qua ApiExceptionHandler, dạng `application/problem+json`:

```json
{
  "type": "https://httpstatuses.com/409",
  "title": "Invalid HTTP request.",
  "status": 409,
  "code": "owner_confirmed_inspection_required"
}
```

Đây là ví dụ cấu trúc, không phải response live. Có thể có trace/correlation extension. Các lỗi xác thực/authorization hoặc model validation do framework xử lý không nhất thiết có cùng code nghiệp vụ.

- 400: input/ngày không hợp lệ, thiếu idempotency key.
- 401: chưa xác thực.
- 403: sai role/quyền.
- 404: không có tài nguyên hoặc bị giới hạn scope; chưa có move-out cũng 404.
- 409: sai trạng thái/version/reference, dữ liệu đã thay đổi, route legacy bị thay thế.
- 413: ảnh vượt dung lượng.
- 503: ledger/storage/pricing không khả dụng hoặc database_schema_incompatible.

## 13. Nguồn đã đọc

- `src/backend/BHome.Api/Controllers/ContractsController.cs`
- `src/backend/BHome.Api/Controllers/SettlementReceivablesController.cs`
- `src/backend/BHome.Api/Controllers/DepositDeductionsController.cs`
- `src/backend/BHome.Api/Controllers/RefundsController.cs`, `TenantRefundsController.cs`, `TenantRefundPetitionsController.cs`
- `src/backend/BHome.Api/Controllers/Billing/InvoicesController.cs`
- `src/backend/BHome.Api/Controllers/Ocr/CaptureController.cs`
- `src/backend/BHome.Application/Contracts/ContractContracts.cs`, `ContractService.cs`, `ContractFinalInspectionService.cs`, `ContractLifecycleService.cs`, `ContractHandoverContracts.cs`
- `src/backend/BHome.Application/Contracts/SettlementReceivables.cs`, `SettlementFinalFixedCharges.cs`, `SettlementFinalUtilities.cs`, `SettlementChargeReview.cs`, `SettlementBankAllocations.cs`, `DepositDeductionService.cs`, `SettlementCalculation.cs`
- `src/backend/BHome.Application/Finance/RefundService.cs`, `TenantRefunds.cs`
- `src/backend/BHome.Infrastructure/Contracts/ContractSettlementLedger.cs`, `ContractRepository.cs`, `ContractExpiryProcessor.cs`, `ContractExpiryScheduler.cs`
- `src/backend/BHome.Infrastructure/Modules/Notifications/SettlementNotificationPublisher.cs`, `CompactNotificationEvents.cs`, `NotificationEventPublisher.cs`
- `src/backend/BHome.Api/Middleware/ApiExceptionHandler.cs`

Chỉ đọc cờ bật/tắt của profile local để giải thích scheduler; không đưa credential, token, email người dùng hoặc dữ liệu hợp đồng thật vào báo cáo.
