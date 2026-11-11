using System.Text.Json;
using BHome.Application.Contracts;
using BHome.Application.PaymentsDebt;
using BHome.Domain.Billing;
using BHome.Domain.PaymentsDebt;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Billing;
using BHome.Infrastructure.Contracts;
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.PaymentsDebt;

internal static class ReceiptExcessRecords
{
    internal const string Kind = "ReceiptExcessDispositionV1";
    internal static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    internal static Task<bool> PendingDepositAsync(BHomePersistenceContext db, Guid[] contractIds, CancellationToken token, Guid? payerResidentId = null)
    {
        if (db is not Compact24DbContext) return Task.FromResult(false);
        return db.Database.SqlQuery<bool>($"""
            SELECT EXISTS(SELECT 1 FROM payments p JOIN payment_allocations a ON a.source_payment_id=p.id
              LEFT JOIN LATERAL (SELECT h->'state' state FROM jsonb_array_elements(p.history) h WHERE h->>'recordType'='DepositReceiptAllocationV1') payer ON true
              WHERE (cardinality({contractIds})=0 OR a.target_deposit_contract_id=ANY({contractIds})) AND a.target_deposit_contract_id IS NOT NULL
                AND ({payerResidentId}::uuid IS NULL OR payer.state->>'payerResidentId'={payerResidentId}::text OR
                  payer.state IS NULL AND EXISTS(SELECT 1 FROM residents person WHERE person.id={payerResidentId} AND person.user_id=a.paid_by_user_id))
                AND (p.amount-(SELECT COALESCE(sum(aa.amount),0) FROM payment_allocations aa WHERE aa.source_payment_id=p.id)<>
                  (SELECT COALESCE(sum(r.requested_amount),0) FROM refund_requests r WHERE r.source_payment_id=p.id AND r.status='COMPLETED') OR
                EXISTS(SELECT 1 FROM refund_requests r WHERE r.source_payment_id=p.id AND r.status='COMPLETED'
                  AND NOT bhome24_external_refund_valid(r.id) AND NOT bhome24_deposit_refund_valid(r.id)))) AS "Value"
            """).SingleAsync(token);
    }
    internal static Task<bool> PendingAllocatedSettlementAsync(BHomePersistenceContext db, Guid contractId, CancellationToken token)
    {
        if (db is not Compact24DbContext) return Task.FromResult(false);
        return db.Database.SqlQuery<bool>($"""
            SELECT EXISTS(SELECT 1 FROM payments p JOIN payment_allocations a ON a.source_payment_id=p.id
              WHERE a.target_settlement_contract_id={contractId} AND (p.status<>'VERIFIED' OR
                p.amount-(SELECT COALESCE(sum(aa.amount),0) FROM payment_allocations aa WHERE aa.source_payment_id=p.id)<>
                  (SELECT COALESCE(sum(r.requested_amount),0) FROM refund_requests r WHERE r.source_payment_id=p.id AND r.status='COMPLETED') OR
                EXISTS(SELECT 1 FROM refund_requests r WHERE r.source_payment_id=p.id AND r.status='COMPLETED' AND NOT bhome24_external_refund_valid(r.id)
                  AND NOT EXISTS(SELECT 1 FROM residents person,
                    LATERAL (SELECT h->'state' state FROM jsonb_array_elements(r.history) WITH ORDINALITY e(h,n)
                      WHERE h->>'recordType'='ExcessReceiptRefundV1' ORDER BY n DESC LIMIT 1) proof
                    WHERE person.id=r.beneficiary_resident_id AND person.user_id=a.paid_by_user_id AND r.source_deposit_contract_id IS NULL
                      AND proof.state->>'classification'='ExcessReceiptRefundV1' AND r.executed_at IS NOT NULL
                      AND proof.state->'upload'->>'objectKey'=r.execution_evidence_key AND proof.state->'upload'->>'externalReference'=r.external_refund_reference
                      AND proof.state->'upload'->>'sha256' ~ {"^[A-F0-9]{64}$"}
                      AND EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(proof.state->'events')='array' THEN proof.state->'events' ELSE '[]'::jsonb END) e WHERE e->>'action'='Completed'))))) AS "Value"
            """).SingleAsync(token);
    }
    internal static async Task<ReceiptExcessDisposition?> ReadAsync(BHomePersistenceContext db, Guid transferId, CancellationToken token)
    {
        if (db is not Compact24DbContext) return null;
        var json = await db.Database.SqlQuery<string>($"""
            SELECT (h->'state')::text AS "Value" FROM payments p CROSS JOIN LATERAL jsonb_array_elements(p.history) h
            WHERE p.id={transferId} AND h->>'recordType'={Kind}
            """).SingleOrDefaultAsync(token);
        return json is null ? null : JsonSerializer.Deserialize<ReceiptExcessDisposition>(json, Json) ?? throw new PaymentException(409, "receipt_excess_history_invalid");
    }
    internal static Task<bool> PendingAsync(BHomePersistenceContext db, Guid? invoiceId, Guid? settlementContractId, CancellationToken token, Guid? payerResidentId = null)
    {
        if (db is not Compact24DbContext) return Task.FromResult(false);
        return db.Database.SqlQuery<bool>($"""
            SELECT EXISTS(SELECT 1 FROM payments p CROSS JOIN LATERAL jsonb_array_elements(p.history) h
              WHERE h->>'recordType'={Kind} AND (({invoiceId}::uuid IS NOT NULL AND h->'state'->'target'->>'invoiceId'={invoiceId}::text)
                OR ({settlementContractId}::uuid IS NOT NULL AND h->'state'->'target'->>'settlementContractId'={settlementContractId}::text)
                OR ({payerResidentId}::uuid IS NOT NULL AND h->'state'->>'payerResidentId'={payerResidentId}::text))
              AND p.amount>(SELECT COALESCE(sum(r.requested_amount),0) FROM refund_requests r WHERE r.source_payment_id=p.id AND r.status='COMPLETED'
                AND EXISTS(SELECT 1 FROM jsonb_array_elements(r.history) proof WHERE proof->>'recordType'='ExcessReceiptRefundV1'
                  AND proof->'state'->>'receiptExcessDispositionId'=h->'state'->>'id' AND r.executed_at IS NOT NULL
                  AND proof->'state'->'upload'->>'objectKey'=r.execution_evidence_key
                  AND proof->'state'->'upload'->>'externalReference'=r.external_refund_reference
                  AND proof->'state'->'upload'->>'sha256' ~ {"^[A-F0-9]{64}$"}
                  AND EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(proof->'state'->'events')='array' THEN proof->'state'->'events' ELSE '[]'::jsonb END) event
                    WHERE event->>'action'='Completed')))) AS "Value"
            """).SingleAsync(token);
    }
}

internal sealed class ReceiptExcessRepository(BHomePersistenceContext db, IContractRepository contracts, IPaymentRepository payments) : IReceiptExcessRepository
{
    private async Task<Guid> RoomAsync(ReceiptExcessTarget target, CancellationToken token)
    {
        if (target.InvoiceId is { } invoice)
            return await db.Set<Invoice>().Where(i => i.Id == invoice).Select(i => (Guid?)i.RoomId).SingleOrDefaultAsync(token) ?? throw new PaymentException(404, "payment_invoice_not_found");
        var contractId = target.SettlementContractId ?? target.HoldingContractId;
        return await db.Set<Contract>().Where(c => c.Id == contractId).Select(c => (Guid?)c.RoomId).SingleOrDefaultAsync(token) ?? throw new PaymentException(404, "contract_not_found");
    }
    public async Task<T> TransactionAsync<T>(Guid transferId, ReceiptExcessTarget target, Func<Task<T>> work, CancellationToken token)
    {
        if (db is not Compact24DbContext) throw new PaymentException(503, "receipt_excess_unavailable");
        var room = await RoomAsync(target, token);
        return await contracts.InTransactionAsync(room, async () =>
        {
            if (!await db.Locked<PaymentTransfer>(transferId).AnyAsync(token)) throw new PaymentException(404, "bank_transfer_not_found");
            return await work();
        }, token);
    }
    public Task<ReceiptExcessDisposition?> GetAsync(Guid transferId, CancellationToken token) => ReceiptExcessRecords.ReadAsync(db, transferId, token);
    public async Task<ReceiptExcessDisposition?> OperationAsync(Guid actor, Guid key, CancellationToken token)
    {
        var value = await db.Database.SqlQuery<string>($"""
            SELECT (h->'state')::text AS "Value" FROM payments p CROSS JOIN LATERAL jsonb_array_elements(p.history) h
            WHERE h->>'recordType'={ReceiptExcessRecords.Kind} AND h->'state'->>'operationKey'={key.ToString()}
              AND h->'state'->>'approvedByUserId'={actor.ToString()}
            """).SingleOrDefaultAsync(token);
        return value is null ? null : JsonSerializer.Deserialize<ReceiptExcessDisposition>(value, ReceiptExcessRecords.Json);
    }
    public async Task<ReceiptExcessContext> ContextAsync(Guid id, ReceiptExcessTarget target, CancellationToken token)
    {
        if (db is not Compact24DbContext) throw new PaymentException(503, "receipt_excess_unavailable");
        var transfer = await payments.TransferAsync(id, token) ?? throw new PaymentException(404, "bank_transfer_not_found");
        var room = await RoomAsync(target, token); var problems = new List<string>();
        Guid[] users = []; Guid[] residents = []; decimal outstanding; string reference; bool targetDemo;
        if (target.InvoiceId is { } invoiceId)
        {
            var invoice = await db.Set<Invoice>().AsNoTracking().SingleAsync(i => i.Id == invoiceId, token);
            if (invoice.Status != InvoiceStatus.Final) problems.Add("final_invoice_required");
            outstanding = (await db.FinancialsAsync(invoiceId, token)).OutstandingAmount;
            users = await db.Set<InvoiceRecipient>().Where(r => r.InvoiceId == invoiceId).Select(r => r.TenantUserId).ToArrayAsync(token);
            reference = PaymentRules.InvoiceReference(invoiceId);
            targetDemo = await db.Set<Contract>().Where(c => c.Id == invoice.RepresentativeContractId).Select(c => c.IsDevelopmentDemo).SingleAsync(token);
        }
        else if (target.SettlementContractId is { } contractId)
        {
            var charge = (await SettlementChargeRecords.ReadAsync<SettlementReceivable>(db, contractId, SettlementChargeRecords.ChargeKind, token))
                .SingleOrDefault(c => c.Id == target.ReceivableId) ?? throw new PaymentException(404, "settlement_receivable_not_found");
            var paid = await db.Set<PaymentAllocation>().Where(a => a.TargetSettlementContractId == contractId && a.SettlementReceivableId == charge.Id).SumAsync(a => (decimal?)a.Amount, token) ?? 0;
            if (paid < 0 || paid > charge.Amount) throw new PaymentException(409, "settlement_ledger_integrity_failed");
            outstanding = charge.Amount - paid; users = charge.RecipientUserIds; reference = PaymentRules.InvoiceReference(charge.Id); targetDemo = charge.IsDevelopmentDemo;
        }
        else
        {
            var holding = await db.Set<Contract>().AsNoTracking().SingleAsync(c => c.Id == target.HoldingContractId, token);
            if (holding.Kind != ContractKind.Holding) throw new PaymentException(404, "holding_contract_not_found");
            var received = await db.Set<PaymentAllocation>().Where(a => a.TargetDepositContractId == holding.Id).SumAsync(a => (decimal?)a.Amount, token) ?? 0;
            outstanding = holding.Status is ContractStatus.Cancelled or ContractStatus.Expired or ContractStatus.Converted ? 0 : Math.Max(0, holding.RequiredDeposit - received);
            residents = await db.Set<ContractResident>().Where(r => r.ContractId == holding.Id).Select(r => r.ResidentId).ToArrayAsync(token);
            reference = PaymentRules.DepositReference(holding.Id); targetDemo = holding.IsDevelopmentDemo;
        }
        if (outstanding != 0) problems.Add("receipt_target_not_settled");
        var people = await db.Set<Resident>().AsNoTracking().Where(r => r.VerificationStatus == IdentityVerificationStatus.Verified &&
            (residents.Contains(r.Id) || r.TenantUserId != null && users.Contains(r.TenantUserId.Value) &&
                db.Set<ContractResident>().Any(cr => cr.ResidentId == r.Id && db.Set<Contract>().Any(c => c.Id == cr.ContractId && c.RoomId == room))))
            .OrderBy(r => r.Id).Select(r => new ReceiptExcessPayer(r.Id, r.TenantUserId, r.DisplayLabel)).ToArrayAsync(token);
        var existing = await GetAsync(id, token);
        var verified = await db.Database.SqlQuery<bool>($"SELECT EXISTS(SELECT 1 FROM payments WHERE id={id} AND status='VERIFIED') AS \"Value\"").SingleAsync(token);
        if (!verified || transfer.Currency != "VND" || !PaymentRules.ValidMoney(transfer.Amount)) problems.Add("verified_bank_receipt_required");
        if (transfer.IsDevelopmentDemo != targetDemo) problems.Add("development_payment_mismatch");
        if (!string.Equals(transfer.TransferDescription.Trim(), reference, StringComparison.OrdinalIgnoreCase)) problems.Add("invoice_transfer_reference_mismatch");
        if (await db.Set<PaymentAllocation>().AnyAsync(a => a.TransferId == id, token)) problems.Add("bank_transaction_already_allocated");
        if (await payments.ReferenceClaimedAsync(transfer.NormalizedReference, token)) problems.Add("bank_reference_already_credited");
        if ((await payments.LatestReviewAsync(id, token))?.Decision == "Rejected") problems.Add("bank_transfer_rejected");
        if (await db.Database.SqlQuery<bool>($"SELECT EXISTS(SELECT 1 FROM refund_requests WHERE source_payment_id={id} AND status IN ('REQUESTED','APPROVED','COMPLETED')) AS \"Value\"").SingleAsync(token))
            problems.Add("refund_source_requires_manual_review");
        var external = await ExternalPaymentPayerRecords.ReadAsync(db, id, token);
        if (external is not null && external.TransferFingerprint != ReceiptExcessRules.TransferFingerprint(transfer)) throw new PaymentException(409, "external_payer_history_invalid");
        if (people.Length == 0 && external is null) problems.Add("receipt_verified_payer_required");
        var context = new ReceiptExcessContext(id, target, room, transfer.Amount, outstanding, reference, external is null ? people : [], "", problems.Distinct().Order().ToArray(), existing, transfer.IsDevelopmentDemo, external);
        return context with { Reference = "EXCESS-" + ReceiptExcessRules.Hash(new { context, Transfer = ReceiptExcessRules.TransferFingerprint(transfer) }) };
    }
    public async Task SaveAsync(ReceiptExcessDisposition disposition, CancellationToken token)
    {
        var transfer = await payments.TransferAsync(disposition.TransferId, token) ?? throw new PaymentException(404, "bank_transfer_not_found");
        var record = JsonSerializer.Serialize(new { schemaVersion = 1, recordType = ReceiptExcessRecords.Kind, recordKey = disposition.Id, state = disposition }, ReceiptExcessRecords.Json);
        var claim = JsonSerializer.Serialize(new
        {
            schemaVersion = 1,
            recordType = "BankReferenceClaim",
            recordKey = transfer.NormalizedReference,
            state = new { normalizedReference = transfer.NormalizedReference, allocationId = (Guid?)null, depositVerificationId = (Guid?)null, receiptExcessTransferId = transfer.Id }
        });
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE payments SET history=history||jsonb_build_array({record}::jsonb,{claim}::jsonb) WHERE id={transfer.Id}", token);
        db.Add(new PaymentReconciliation
        {
            TransferId = transfer.Id,
            InvoiceId = disposition.Target.InvoiceId,
            DepositContractId = disposition.Target.HoldingContractId,
            Decision = "ExcessRefundPending",
            Reason = "verified_whole_excess_refund_required",
            ActorId = disposition.ApprovedByUserId,
            OccurredAt = disposition.ApprovedAt
        });
        db.SecurityAudit.Add(new SecurityAuditRecord
        {
            UserId = disposition.ApprovedByUserId,
            Event = "WholeReceiptExcessConfirmed",
            TargetType = ReceiptExcessRecords.Kind,
            TargetId = disposition.Id,
            Succeeded = true,
            OccurredAt = disposition.ApprovedAt
        });
        await db.SaveChangesAsync(token);
    }
}
