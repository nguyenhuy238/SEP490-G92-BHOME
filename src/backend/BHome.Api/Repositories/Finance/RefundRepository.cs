using System.Text.Json;
using System.Text.Json.Nodes;
using BHome.Application.Finance;
using BHome.Application.PaymentsDebt;
using BHome.Domain.Billing;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Native = BHome.Domain.Entities;

namespace BHome.Infrastructure.Finance;

internal sealed partial class RefundRepository(BHomePersistenceContext db, BHome.Application.Contracts.IContractSettlementLedger ledger,
    BHome.Application.Contracts.IDepositDeductionEvidence? deductionEvidence = null,
    BHome.Application.Contracts.ISettlementChargeEvidence? chargeEvidence = null) : IRefundRepository
{
    private const string Kind = "ExcessReceiptRefundV1";
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private IQueryable<RefundRecord> Rows => db.Database.SqlQuery<RefundRecord>($"""
        SELECT r.id AS "Id", r.source_payment_id AS "SourcePaymentId", r.source_deposit_contract_id AS "SourceDepositContractId", r.beneficiary_resident_id AS "BeneficiaryResidentId",
          r.beneficiary_kind AS "BeneficiaryKind",r.external_payer_attestation_id AS "ExternalPayerAttestationId",
          COALESCE(resident.display_label,external_payer.state->>'payerLabel','') AS "BeneficiaryLabel", r.requested_amount AS "Amount", r.requested_by_user_id AS "RequestedBy",
          r.requested_at AS "RequestedAt", r.reason AS "Reason", r.status AS "Status", r.version AS "Version",
          r.operation_key AS "OperationKey", r.decided_by_user_id AS "DecidedBy", r.decided_at AS "DecidedAt",
          r.decision_reason AS "DecisionReason", r.executed_at AS "ExecutedAt", r.external_refund_reference AS "ExternalReference",
          r.execution_evidence_key AS "EvidenceKey", r.history::text AS "HistoryJson",
          (COALESCE(p.verification_data->'compactState'->>'isDevelopmentDemo','false')='true' OR
            EXISTS(SELECT 1 FROM jsonb_array_elements(r.history) h WHERE h->>'recordType' IN ('SecurityDepositRefundV1','HoldingDepositRefundV1')
              AND h->'state'->>'isDevelopmentDemo'='true')) AS "IsDevelopmentDemo"
        FROM refund_requests r LEFT JOIN residents resident ON resident.id=r.beneficiary_resident_id
          LEFT JOIN payments p ON p.id=r.source_payment_id
          LEFT JOIN LATERAL (SELECT h->'state' AS state FROM jsonb_array_elements(p.history) h
            WHERE h->>'recordType'='ExternalPaymentPayerV1' AND h->'state'->>'id'=r.external_payer_attestation_id::text) external_payer ON true
        WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(r.history) h WHERE h->>'recordType' IN ({Kind},'SecurityDepositRefundV1','HoldingDepositRefundV1'))
        """);
    private static RefundRecord Decode(RefundRecord row)
    {
        using var json = JsonDocument.Parse(row.HistoryJson);
        row.State = json.RootElement.EnumerateArray().Last(n => n.TryGetProperty("recordType", out var kind) && kind.GetString() is Kind or "SecurityDepositRefundV1" or "HoldingDepositRefundV1")
            .GetProperty("state").Deserialize<RefundState>(Json) ?? throw new FinanceException(409, "refund_history_invalid");
        if (row.BeneficiaryKind == "EXTERNAL" ? row.BeneficiaryResidentId is not null || row.ExternalPayerAttestationId is null || row.State.ExternalPayerAttestationId != row.ExternalPayerAttestationId
            : row.BeneficiaryKind != "RESIDENT" || row.BeneficiaryResidentId is null || row.ExternalPayerAttestationId is not null || row.State.ExternalPayerAttestationId is not null)
            throw new FinanceException(409, "refund_history_invalid");
        return row;
    }
    public async Task<T> TransactionAsync<T>(Func<Task<T>> work, CancellationToken t)
    {
        // A higher-level Owner financial-close transaction already holds this
        // same payment-ledger advisory lock and owns rollback of all offsets.
        if (db.Database.CurrentTransaction is not null && BHome.Application.Contracts.SettlementFinancialCloseTransactionContext.Active)
        {
            // A reentrant acquisition is harmless under the ordered outer
            // lock and preserves the ledger invariant even on future callers.
            await db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(hashtextextended('bhome-payment-ledger-v1',0))", t);
            return await work();
        }
        await using var transaction = await db.Database.BeginTransactionAsync(t);
        await db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(hashtextextended('bhome-payment-ledger-v1',0))", t);
        var result = await work(); await transaction.CommitAsync(t); return result;
    }
    public async Task<RefundRecord> GetAsync(Guid id, CancellationToken t) => Decode(await Rows.SingleOrDefaultAsync(r => r.Id == id, t)
        ?? throw new FinanceException(404, "refund_not_found"));
    public async Task<RefundRecord?> OperationAsync(Guid key, CancellationToken t)
    {
        if (await Rows.SingleOrDefaultAsync(r => r.OperationKey == key, t) is { } row) return Decode(row);
        if (await db.Database.SqlQuery<bool>($"SELECT EXISTS(SELECT 1 FROM refund_requests WHERE operation_key={key}) AS \"Value\"").SingleAsync(t))
            throw new FinanceException(409, "refund_idempotency_conflict");
        return null;
    }
    public async Task<RefundSourceData> SourceAsync(Guid id, CancellationToken t)
    {
        if (!await db.Database.SqlQuery<bool>($"SELECT EXISTS(SELECT 1 FROM payments WHERE id={id} AND status='VERIFIED') AS \"Value\"").SingleAsync(t))
            throw new FinanceException(404, "bank_transfer_not_found");
        var payment = await db.Database.SqlQuery<RefundReceiptBasis>($"""
            SELECT id AS "Id",amount AS "Amount",currency AS "Currency",received_at AS "OccurredAt",remittance_info AS "TransferDescription",
                COALESCE(verification_data->'compactState'->>'normalizedReference','') AS "NormalizedReference",
                COALESCE(verification_data->'compactState'->>'statementReference','') AS "StatementReference",
                COALESCE(verified_by_user_id,'00000000-0000-0000-0000-000000000000'::uuid) AS "VerifiedByUserId",
                verified_at AS "VerifiedAt",COALESCE((verification_data->'compactState'->>'isDevelopmentDemo')::boolean,false) AS "IsDevelopmentDemo"
            FROM payments WHERE id={id} AND verification_data ? 'compactState'
            """).SingleOrDefaultAsync(t) ?? throw new FinanceException(404, "bank_transfer_not_found");
        var allocation = await db.Set<BHome.Domain.PaymentsDebt.PaymentAllocation>().AsNoTracking().SingleOrDefaultAsync(a => a.SourcePaymentId == id &&
            (a.TargetInvoiceId != null || a.TargetDepositContractId != null || a.TargetSettlementContractId != null || a.TargetInitialContractId != null), t);
        var whole = allocation is null ? await BHome.Infrastructure.PaymentsDebt.ReceiptExcessRecords.ReadAsync(db, id, t) : null;
        var external = await BHome.Infrastructure.PaymentsDebt.ExternalPaymentPayerRecords.ReadAsync(db, id, t);
        if (external is not null && (external.TransferFingerprint != payment.Fingerprint() || allocation?.PaidByUserId is not null ||
            whole is not null && whole.ExternalPayerAttestationId != external.Id)) throw new FinanceException(409, "refund_source_requires_manual_review");
        if (whole is not null && (whole.TransferFingerprint != payment.Fingerprint() || whole.Amount != payment.Amount))
            throw new FinanceException(409, "refund_source_requires_manual_review");
        var excess = whole?.Amount ?? payment.Amount - (allocation?.Amount ?? payment.Amount);
        var allReserved = await db.Database.SqlQuery<decimal>($"""
            SELECT COALESCE(sum(requested_amount),0) AS "Value" FROM refund_requests
            WHERE source_payment_id={id} AND status IN ('REQUESTED','APPROVED','COMPLETED')
            """).SingleAsync(t);
        var requests = (await Rows.Where(r => r.SourcePaymentId == id).OrderByDescending(r => r.RequestedAt).ToArrayAsync(t)).Select(Decode).ToArray();
        // Do not hide reservations owned by another/legacy workflow from availability.
        if (allReserved != requests.Where(r => r.Status is "REQUESTED" or "APPROVED" or "COMPLETED").Sum(r => r.Amount))
            throw new FinanceException(409, "refund_source_requires_manual_review");
        if (whole is not null && requests.Any(r => (r.Status is "REQUESTED" or "APPROVED" or "COMPLETED") && r.State.ReceiptExcessDispositionId != whole.Id))
            throw new FinanceException(409, "refund_source_requires_manual_review");
        if (external is not null && requests.Any(r => (r.Status is "REQUESTED" or "APPROVED" or "COMPLETED") && r.ExternalPayerAttestationId != external.Id))
            throw new FinanceException(409, "refund_source_requires_manual_review");
        if ((whole is not null || external is not null) && requests.Any(r => r.Status == "COMPLETED" && (r.ExecutedAt is null || r.State.Upload is not { } upload ||
            upload.ObjectKey != r.EvidenceKey || upload.ExternalReference != r.ExternalReference || !System.Text.RegularExpressions.Regex.IsMatch(upload.Sha256, "^[A-F0-9]{64}$") || !r.State.Events.Any(e => e.Action == "Completed"))))
            throw new FinanceException(409, "refund_source_requires_manual_review");
        var people = allocation?.PaidByUserId is not { } payer ? [] : await (
            from person in db.Set<BHome.Domain.TenantContracts.Resident>().AsNoTracking()
            from invoice in db.Set<BHome.Domain.Billing.Invoice>().AsNoTracking()
            where invoice.Id == allocation.InvoiceId && person.TenantUserId == payer &&
                person.VerificationStatus == IdentityVerificationStatus.Verified && invoice.RecipientUserIds.Contains(payer) &&
                db.Set<BHome.Domain.TenantContracts.ContractResident>().Any(cr => cr.ResidentId == person.Id && db.Set<BHome.Domain.TenantContracts.Contract>().Any(c => c.Id == cr.ContractId && (c.Kind == BHome.Domain.TenantContracts.ContractKind.Main || c.Kind == BHome.Domain.TenantContracts.ContractKind.Renewal || c.Kind == BHome.Domain.TenantContracts.ContractKind.Holding || c.Kind == BHome.Domain.TenantContracts.ContractKind.Addendum) && c.RoomId == invoice.RoomId))
            orderby person.Id
            select new RefundPerson(person.Id, person.DisplayLabel)).ToArrayAsync(t);
        if (allocation is { PaidByUserId: { } chargePayer, TargetSettlementContractId: { } contractId, SettlementReceivableId: { } chargeId })
        {
            var charge = (await BHome.Infrastructure.Contracts.SettlementChargeRecords.ReadAsync<BHome.Application.Contracts.SettlementReceivable>(db,
                contractId, BHome.Infrastructure.Contracts.SettlementChargeRecords.ChargeKind, t)).SingleOrDefault(c => c.Id == chargeId);
            if (charge is null || !charge.RecipientUserIds.Contains(chargePayer)) throw new FinanceException(409, "refund_source_requires_manual_review");
            people = await db.Set<BHome.Domain.TenantContracts.Resident>().AsNoTracking().Where(person => person.TenantUserId == chargePayer && person.VerificationStatus == IdentityVerificationStatus.Verified &&
                db.Set<BHome.Domain.TenantContracts.ContractResident>().Any(cr => cr.ResidentId == person.Id && db.Set<BHome.Domain.TenantContracts.Contract>().Any(c => c.Id == cr.ContractId && (c.Kind == BHome.Domain.TenantContracts.ContractKind.Main || c.Kind == BHome.Domain.TenantContracts.ContractKind.Renewal || c.Kind == BHome.Domain.TenantContracts.ContractKind.Holding || c.Kind == BHome.Domain.TenantContracts.ContractKind.Addendum) && c.RoomId == charge.RoomId)))
                .OrderBy(person => person.Id).Select(person => new RefundPerson(person.Id, person.DisplayLabel)).ToArrayAsync(t);
        }
        if (allocation?.TargetDepositContractId is { } depositContract)
        {
            var deposit = await BHome.Infrastructure.PaymentsDebt.DepositReceiptRecords.ReadAsync(db, id, t);
            if (deposit is not null)
            {
                if (deposit.TransferFingerprint != payment.Fingerprint() || deposit.AllocationId != allocation.Id ||
                    deposit.ContractId != depositContract || deposit.AllocatedAmount != allocation.Amount.ToString("0", System.Globalization.CultureInfo.InvariantCulture) ||
                    deposit.PayerUserId != allocation.PaidByUserId || deposit.ExternalPayerAttestationId != external?.Id)
                    throw new FinanceException(409, "refund_source_requires_manual_review");
                people = await db.Set<BHome.Domain.TenantContracts.Resident>().AsNoTracking().Where(person => person.Id == deposit.PayerResidentId &&
                    person.VerificationStatus == IdentityVerificationStatus.Verified && (deposit.PayerUserId == null || person.TenantUserId == deposit.PayerUserId) &&
                    db.Set<BHome.Domain.TenantContracts.ContractResident>().Any(cr => cr.ContractId == depositContract && cr.ResidentId == person.Id))
                    .Select(person => new RefundPerson(person.Id, person.DisplayLabel)).ToArrayAsync(t);
            }
            else if (allocation.PaidByUserId is { } depositUser)
                people = await db.Set<BHome.Domain.TenantContracts.Resident>().AsNoTracking().Where(person => person.TenantUserId == depositUser && person.VerificationStatus == IdentityVerificationStatus.Verified &&
                    db.Set<BHome.Domain.TenantContracts.ContractResident>().Any(cr => cr.ContractId == depositContract && cr.ResidentId == person.Id))
                    .Select(person => new RefundPerson(person.Id, person.DisplayLabel)).ToArrayAsync(t);
        }
        if (whole is not null)
            people = await db.Set<BHome.Domain.TenantContracts.Resident>().AsNoTracking().Where(person => person.Id == whole.PayerResidentId && person.VerificationStatus == IdentityVerificationStatus.Verified &&
                (whole.PayerUserId == null || person.TenantUserId == whole.PayerUserId)).Select(person => new RefundPerson(person.Id, person.DisplayLabel)).ToArrayAsync(t);
        return new(Math.Max(0, excess), payment.IsDevelopmentDemo, external is null ? people : [], requests, ReceiptExcessDispositionId: whole?.Id,
            ExternalBeneficiary: external is null ? null : new(external.Id, external.PayerLabel));
    }
    public Task<bool> ReferenceUsedAsync(string reference, Guid exceptId, CancellationToken t) => db.Database.SqlQuery<bool>($"""
        SELECT EXISTS(SELECT 1 FROM refund_requests r WHERE id<>{exceptId} AND (
          upper(external_refund_reference)={reference} OR EXISTS(
            SELECT 1 FROM jsonb_array_elements(r.history) h
            WHERE h->>'recordType' IN ({Kind},'SecurityDepositRefundV1','HoldingDepositRefundV1','TenantRefundPetitionV1')
              AND h->'state'->'upload'->>'externalReference'={reference}))) AS "Value"
        """).SingleAsync(t);
    public async Task SaveAsync(RefundRecord row, bool create, Guid actor, string action, DateTimeOffset now, CancellationToken t)
    {
        var history = JsonNode.Parse(row.HistoryJson) as JsonArray ?? throw new FinanceException(409, "refund_history_invalid");
        history.Add(new JsonObject { ["recordType"] = row.State.Classification, ["state"] = JsonSerializer.SerializeToNode(row.State, Json) });
        var json = JsonSerializer.SerializeToElement(history);
        if (create)
            db.Add(new Native.RefundRequest
            {
                Id = row.Id,
                SourcePaymentId = row.SourcePaymentId,
                SourceDepositContractId = row.SourceDepositContractId,
                BeneficiaryResidentId = row.BeneficiaryResidentId,
                BeneficiaryKind = row.BeneficiaryKind,
                ExternalPayerAttestationId = row.ExternalPayerAttestationId,
                RequestedByUserId = row.RequestedBy,
                RequestedAt = row.RequestedAt,
                RequestedAmount = row.Amount,
                Reason = row.Reason,
                Status = row.Status,
                OperationKey = row.OperationKey,
                Version = row.Version,
                History = json
            });
        else
            await RefundRequestWrites.UpdateAsync(db, row.Id, row.Status, row.Version, row.DecidedBy, row.DecidedAt,
                row.DecisionReason, row.ExecutedAt, row.ExternalReference, row.EvidenceKey, json, t);
        // The native write and the historical audit/reconciliation remain atomic
        // under the same payment-ledger transaction; never mix tracked models.
        await db.SaveChangesAsync(t);
        await SecurityAuditWrites.AppendAsync(db, new(Guid.NewGuid(), actor, null, null, action, true, now, "Refund", row.Id), t);
        if (!create && row.Status == "COMPLETED" && row.SourcePaymentId is { } receipt && row.State.ReceiptExcessDispositionId is { } dispositionId)
        {
            var disposition = await BHome.Infrastructure.PaymentsDebt.ReceiptExcessRecords.ReadAsync(db, receipt, t);
            if (disposition?.Id != dispositionId) throw new FinanceException(409, "refund_source_changed");
            var returned = await db.Database.SqlQuery<decimal>($"SELECT COALESCE(sum(requested_amount),0) AS \"Value\" FROM refund_requests WHERE source_payment_id={receipt} AND status='COMPLETED'").SingleAsync(t);
            await AppendReconciliationAsync(receipt, disposition.Target.InvoiceId,
                disposition.Target.HoldingContractId ?? disposition.Target.DepositContractId,
                returned == disposition.Amount ? "ExcessRefundCompleted" : "ExcessRefundPending",
                returned == disposition.Amount ? "verified_whole_excess_returned" : "verified_partial_excess_returned",
                actor, now, t);
        }
    }

    private async Task AppendReconciliationAsync(Guid receipt, Guid? invoice, Guid? deposit, string decision,
        string reason, Guid actor, DateTimeOffset occurredAt, CancellationToken token)
    {
        // Same global sequence lock, parent-row lock and append-only envelope
        // as the original ledger writer; no independent transaction or status change.
        var at = DateTimeOffset.UtcNow;
        await db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(hashtextextended('compact24-sequence:PaymentReconciliation',0))", token);
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT id FROM payments WHERE id={receipt} FOR UPDATE", token);
        var sequence = await db.Database.SqlQuery<long>($"""
            SELECT COALESCE(max((h->'state'->>'sequence')::bigint),0)+1 AS "Value"
            FROM payments p CROSS JOIN LATERAL jsonb_array_elements(p.history) h
            WHERE h->>'recordType'='PaymentReconciliation'
            """).SingleAsync(token);
        var id = Guid.NewGuid();
        var envelope = JsonSerializer.Serialize(new
        {
            schemaVersion = 1,
            recordType = "PaymentReconciliation",
            recordKey = id.ToString(),
            deleted = false,
            state = new
            {
                id,
                sequence,
                transferId = receipt,
                invoiceId = invoice,
                depositContractId = deposit,
                decision,
                reason,
                actorId = actor,
                occurredAt,
                createdAt = at,
                updatedAt = at
            }
        }, Json);
        var changed = await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE payments SET history=history||jsonb_build_array({envelope}::jsonb) WHERE id={receipt}", token);
        if (changed != 1) throw new DbUpdateConcurrencyException("Compact24 containing record is unavailable.");
    }
}

internal sealed class RefundReceiptBasis
{
    public Guid Id { get; set; }
    public decimal Amount { get; set; }
    public string Currency { get; set; } = "";
    public DateTimeOffset OccurredAt { get; set; }
    public string TransferDescription { get; set; } = "";
    public string NormalizedReference { get; set; } = "";
    public string StatementReference { get; set; } = "";
    public Guid VerifiedByUserId { get; set; }
    public DateTimeOffset VerifiedAt { get; set; }
    public bool IsDevelopmentDemo { get; set; }
    internal string Fingerprint() => ReceiptExcessRules.TransferFingerprint(Id, NormalizedReference, Amount, Currency,
        OccurredAt, TransferDescription, StatementReference, VerifiedByUserId, VerifiedAt, IsDevelopmentDemo);
}

internal static class RefundRequestWrites
{
    internal static async Task UpdateAsync(BHomePersistenceContext db, Guid id, string status, int version,
        Guid? decidedBy, DateTimeOffset? decidedAt, string? decisionReason, DateTimeOffset? executedAt,
        string? externalReference, string? evidenceKey, JsonElement history, CancellationToken token)
    {
        var entity = await db.Set<Native.RefundRequest>().AsNoTracking().SingleAsync(r => r.Id == id, token);
        db.Attach(entity);
        entity.Status = status;
        entity.Version = version;
        entity.DecidedByUserId = decidedBy;
        entity.DecidedAt = decidedAt;
        entity.DecisionReason = decisionReason;
        entity.ExecutedAt = executedAt;
        entity.ExternalRefundReference = externalReference;
        entity.ExecutionEvidenceKey = evidenceKey;
        entity.History = history;
    }
}
