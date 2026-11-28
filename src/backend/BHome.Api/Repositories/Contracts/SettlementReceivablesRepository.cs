using System.Security.Cryptography;
using System.Text.Json;
using BHome.Application.Contracts;
using BHome.Domain.Billing;
using BHome.Domain.PaymentsDebt;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Billing;
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using BHome.Infrastructure.PaymentsDebt;
using BHome.Infrastructure.Modules.PropertyManagement.Persistence;
using Native = BHome.Domain.Entities;

namespace BHome.Infrastructure.Contracts;

internal static class SettlementChargeRecords
{
    internal const string ChargeKind = "SettlementReceivableV1", OffsetKind = "DepositOffsetApprovalV1", BankKind = "SettlementBankAllocationV1", ReviewKind = "SettlementChargeReviewV1", FinancialCloseKind = "SettlementFinancialCloseV1",
        ProposalKind = "MoveOutChargeProposalV1", ProposalFeedbackKind = "MoveOutChargeProposalFeedbackV1",
        ProposalSettlementKind = "MoveOutChargeProposalSettlementV1";
    internal static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    internal static async Task<T[]> ReadAsync<T>(BHomePersistenceContext db, Guid contractId, string kind, CancellationToken token)
    {
        if (db is not Compact24DbContext) return [];
        var values = await db.Database.SqlQuery<string>($"""
            SELECT (h->'state')::text AS "Value" FROM contracts c CROSS JOIN LATERAL jsonb_array_elements(c.history) h
            WHERE c.id={contractId} AND h->>'recordType'={kind} ORDER BY h->'state'->>'approvedAt',h->>'recordKey'
            """).ToArrayAsync(token);
        return values.Select(v => JsonSerializer.Deserialize<T>(v, Json) ?? throw ContractException.Conflict("settlement_history_invalid")).ToArray();
    }
}

internal sealed partial class SettlementReceivablesRepository(BHomePersistenceContext db, IContractRepository contracts,
    IContractDepositPosition deposits, TimeProvider clock) : ISettlementReceivablesRepository
{
    public async Task<T> TransactionAsync<T>(Guid id, Func<Task<T>> work, CancellationToken token)
    {
        if (db is not Compact24DbContext) throw new ContractException(503, "settlement_receivables_unavailable");
        // A financial closing orchestrator already holds the payment-ledger,
        // Location and Room locks. Never begin a nested EF transaction.
        if (db.Database.CurrentTransaction is not null && SettlementFinancialCloseTransactionContext.Active) return await work();
        var room = await db.Set<Native.Contract>().AsNoTracking().Where(c => c.Id == id).Select(c => (Guid?)c.RoomId).SingleOrDefaultAsync(token)
            ?? throw ContractException.Missing();
        return await contracts.InTransactionAsync(room, work, token);
    }
    public async Task<bool> CanReadAsync(Guid id, Guid userId, bool owner, CancellationToken token)
    {
        if (db is Compact24DbContext && await db.Set<Native.Contract>().AnyAsync(c => c.Id == id && (owner || c.TenantUserId == userId ||
            db.Set<Native.ContractResident>().Any(cr => cr.ContractId == id && db.Set<Native.Resident>().Any(r => r.Id == cr.ResidentId && r.UserId == userId))), token)) return true;
        if (db is not Compact24DbContext && await db.Set<Contract>().AnyAsync(c => c.Id == id && (owner || c.TenantUserId == userId ||
            db.Set<ContractResident>().Any(cr => cr.ContractId == id && db.Set<Resident>().Any(r => r.Id == cr.ResidentId && r.TenantUserId == userId))), token)) return true;
        return db is Compact24DbContext && await db.Database.SqlQuery<bool>($"""
            SELECT EXISTS(SELECT 1 FROM contracts c CROSS JOIN LATERAL jsonb_array_elements(c.history) h
              WHERE c.id={id} AND h->>'recordType'={SettlementChargeRecords.ChargeKind}
                AND h->'state'->'recipientUserIds' @> jsonb_build_array({userId.ToString()})) AS "Value"
            """).SingleAsync(token);
    }
    private async Task<List<Contract>> ChainAsync(Guid id, CancellationToken token)
    {
        var c = await NativeSettlementReads.ContractAsync(db, id, token) ?? throw ContractException.Missing();
        var chain = new List<Contract> { c };
        while (chain[^1].PreviousContractId is { } previous)
        {
            if (chain.Count >= 100 || chain.Any(v => v.Id == previous)) throw ContractException.Conflict("contract_version_integrity_failed");
            var parent = await NativeSettlementReads.ContractAsync(db, previous, token) ?? throw new InvalidOperationException("Missing previous contract.");
            if (parent.RoomId != c.RoomId || parent.TenantUserId != c.TenantUserId) throw ContractException.Conflict("contract_version_integrity_failed");
            chain.Add(parent);
        }
        return chain;
    }
    private IQueryable<Native.Invoice> OffsetInvoices(List<Contract> chain, DateOnly incurred)
    {
        var contract = chain[0];
        var chainIds = chain.Select(c => c.Id).ToArray();
        var firstPeriod = new DateOnly(chain[^1].StartDate.Year, chain[^1].StartDate.Month, 1);
        var lastPeriod = new DateOnly(incurred.Year, incurred.Month, 1);
        // The billing reference may be another tenancy in the same room. Match
        // shared periodic debt by the issued recipient snapshot and tenancy dates,
        // while retaining contract-specific invoices from this contract chain.
        return db.Set<Native.Invoice>().AsNoTracking().Where(i => i.RoomId == contract.RoomId && i.Status == (short)InvoiceStatus.Final &&
            (chainIds.Contains(i.ContractId) || i.InvoiceType == "PERIODIC" && i.BillingPeriod >= firstPeriod && i.BillingPeriod <= lastPeriod &&
                contract.TenantUserId.HasValue && i.RecipientUserIds.Contains(contract.TenantUserId.Value)));
    }
    public async Task<(Guid[] Ids, int Total)> TenantContractsAsync(Guid userId, int page, int pageSize, CancellationToken token)
    {
        if (db is not Compact24DbContext) throw new ContractException(503, "settlement_receivables_unavailable");
        var query = db.Database.SqlQuery<Guid>($"""
            SELECT DISTINCT c.id AS "Value" FROM contracts c CROSS JOIN LATERAL jsonb_array_elements(c.history) h
              WHERE h->>'recordType'={SettlementChargeRecords.ChargeKind}
                AND h->'state'->'recipientUserIds' @> jsonb_build_array({userId.ToString()})
            """);
        return (await query.OrderBy(id => id).Skip((page - 1) * pageSize).Take(pageSize).ToArrayAsync(token), await query.CountAsync(token));
    }
    public async Task<SettlementChargeContext> ContextAsync(Guid id, CancellationToken token)
    {
        if (db is not Compact24DbContext) throw new ContractException(503, "settlement_receivables_unavailable");
        var chain = await ChainAsync(id, token); var contract = chain[0];
        var inspection = await NativeSettlementReads.InspectionAsync(db, id, token);
        var move = await NativeSettlementReads.MoveAsync(db, id, token);
        var observed = inspection is null ? null : JsonSerializer.Deserialize<HandoverSnapshot>(inspection.ObservedSnapshot);
        var baseline = inspection is null ? null : JsonSerializer.Deserialize<HandoverSnapshot>(inspection.BaselineSnapshot);
        var charges = await SettlementChargeRecords.ReadAsync<SettlementReceivable>(db, id, SettlementChargeRecords.ChargeKind, token);
        var offsets = await SettlementChargeRecords.ReadAsync<DepositOffsetApproval>(db, id, SettlementChargeRecords.OffsetKind, token);
        var totals = await db.Set<Native.PaymentAllocation>().AsNoTracking().Where(a => a.TargetSettlementContractId == id)
            .GroupBy(a => a.SettlementReceivableId).Select(g => new { Id = g.Key, Amount = g.Sum(a => a.Amount) }).ToArrayAsync(token);
        var balances = charges.Select(c =>
        {
            var paid = totals.SingleOrDefault(a => a.Id == c.Id)?.Amount ?? 0;
            if (paid < 0 || paid > c.Amount) throw ContractException.Conflict("settlement_ledger_integrity_failed");
            return new SettlementReceivableBalance(c, paid, c.Amount - paid, paid == c.Amount ? "Paid" : paid == 0 ? "Unpaid" : "PartiallyPaid");
        }).ToArray();
        var position = await deposits.ReadAsync([chain[^1].Id], token) ?? throw new ContractException(503, "deposit_position_unavailable");
        var available = position.Received - position.Allocated - position.Refunded - position.Reserved;
        var depositRoot = chain[^1].Id;
        available -= (await NativeSettlementReads.CompensationsAsync(db, depositRoot, token)).Sum(c => c.Amount);
        if (available < 0) throw ContractException.Conflict("deposit_ledger_reconciliation_required");
        var incurred = observed?.Date ?? contract.ActualEndDate ?? contract.EndDate;
        var capturedAt = inspection?.InspectedAt ?? DateTimeOffset.MinValue;
        var recipients = await (from cr in db.Set<Native.ContractResident>().AsNoTracking()
                                join tenancy in db.Set<Native.Contract>() on cr.ContractId equals tenancy.Id
                                join r in db.Set<Native.Resident>() on cr.ResidentId equals r.Id
                                where tenancy.RoomId == contract.RoomId && tenancy.ActivatedAt != null && tenancy.ActivatedAt <= capturedAt &&
                                    tenancy.StartDate <= incurred && (tenancy.ActualEndDate ?? tenancy.EndDate) >= incurred &&
                                    (tenancy.Status == (short)ContractStatus.Active || tenancy.Id == id ||
                                        tenancy.Status == (short)ContractStatus.Terminated && tenancy.ActualEndDate >= incurred || tenancy.Status == (short)ContractStatus.Superseded) &&
                                    cr.ResidenceFrom <= incurred && (cr.ResidenceTo == null || cr.ResidenceTo >= incurred) && r.UserId != null
                                select r.UserId!.Value).Distinct().ToArrayAsync(token);
        var legacy = await DepositDeductionRecords.LatestAsync(db, id, token);
        var payerIds = charges.SelectMany(c => c.RecipientUserIds).Distinct().ToArray();
        var payerRows = await db.Set<Native.Resident>().AsNoTracking().Where(r => r.UserId != null && payerIds.Contains(r.UserId.Value))
            .OrderBy(r => r.Id).Select(r => new { Id = r.UserId!.Value, r.DisplayLabel }).ToArrayAsync(token);
        var payers = payerRows.DistinctBy(r => r.Id).Select(r => new BHome.Application.PaymentsDebt.PayerChoice(r.Id, r.DisplayLabel)).ToArray();
        var invoiceRows = await db.Financials(OffsetInvoices(chain, incurred))
            .OrderBy(i => i.BillingPeriod).ThenBy(i => i.Id).Take(251).ToArrayAsync(token);
        if (invoiceRows.Length > 250) throw ContractException.Conflict("settlement_period_review_required");
        var invoiceBalances = new List<SettlementOffsetInvoice>();
        foreach (var invoice in invoiceRows)
        {
            var financials = invoice.View();
            invoiceBalances.Add(new(invoice.Id, invoice.BillingPeriod, financials.EffectivePayableAmount, financials.AllocatedPayments, financials.OutstandingAmount));
        }
        var reference = "CHARGE-" + Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(new
        {
            id,
            contract.Status,
            contract.ActualEndDate,
            contract.Kind,
            Inspection = inspection is null ? null : new { inspection.Id, inspection.Version, inspection.OwnerDecision, inspection.NoAdditionalCharges, inspection.ObservedSnapshot },
            move?.ApprovedAt,
            balances,
            offsets,
            position,
            recipients,
            invoiceBalances,
            Legacy = legacy?.Id
        })));
        var baselineAssets = (baseline?.Assets ?? []).ToDictionary(a => a.Id);
        var issueAssets = (observed?.Assets ?? []).Where(a =>
                HandoverChecklist.NewDamageAgainstBaseline(a, baselineAssets.GetValueOrDefault(a.Id)))
            .ToDictionary(a => a.Id, a => (a.EvidenceIds ?? [])
                .Concat((observed?.PhysicalItemEvidence ?? [])
                    .Where(item => item.AssetId == a.Id).SelectMany(item => item.EvidenceIds))
                .Distinct().ToArray());
        var issueRoomChecks = (observed?.RoomChecks ?? []).Where(item => item.Status == "Issue")
            .ToDictionary(item => item.Code, item => item.EvidenceIds);
        // A missing key is still an issue to price or explicitly waive even if
        // Staff did not upload a photo. Charging it separately still requires
        // the Owner's verified evidence and approval in ApproveDamageAsync.
        if (SettlementFinancialCloseRules.MissingRoomKeys(baseline?.AccessItems, observed?.AccessItems))
            issueRoomChecks["access_room_key"] = observed?.KeyEvidenceIds ?? [];
        // Every proof has already been validated and its digest captured in
        // the immutable inspection snapshot by Staff. Do not infer proof
        // ownership from the overall evidence pool.
        var verifiedEvidenceIds = (observed?.EvidenceHashes?.Keys ?? [])
            .Concat(observed?.EvidenceIds ?? []).Distinct().ToArray();
        return new(new(id, contract.RoomId, reference, available, balances, offsets, contract.Room.RoomNumber, invoiceBalances, payers), chain[^1].Id,
            inspection?.Id ?? Guid.Empty, inspection?.Version ?? 0,
            contract.Kind is ContractKind.Main or ContractKind.Renewal && contract.Status is ContractStatus.Active or ContractStatus.Terminated && move?.ApprovedAt != null && inspection?.OwnerDecision == "Confirmed",
            inspection?.NoAdditionalCharges ?? true, issueAssets.Keys.ToArray(), verifiedEvidenceIds, recipients,
            legacy is not null, ContractPaymentModes.IsTest(contract), issueAssets, issueRoomChecks,
            observed?.RoomChecks is { Length: > 0 }, position.Received);
    }
    private async Task<T?> OperationAsync<T>(Guid actor, Guid key, string kind, CancellationToken token)
    {
        var json = await db.Database.SqlQuery<string>($"""
            SELECT (h->'state')::text AS "Value" FROM contracts c CROSS JOIN LATERAL jsonb_array_elements(c.history) h
            WHERE h->>'recordType'={kind} AND h->'state'->>'operationKey'={key.ToString()} AND h->'state'->>'approvedByUserId'={actor.ToString()}
            """).SingleOrDefaultAsync(token);
        return json is null ? default : JsonSerializer.Deserialize<T>(json, SettlementChargeRecords.Json);
    }
    public Task<SettlementReceivable?> ChargeOperationAsync(Guid actor, Guid key, CancellationToken token) => OperationAsync<SettlementReceivable>(actor, key, SettlementChargeRecords.ChargeKind, token);
    public Task<DepositOffsetApproval?> OffsetOperationAsync(Guid actor, Guid key, CancellationToken token) => OperationAsync<DepositOffsetApproval>(actor, key, SettlementChargeRecords.OffsetKind, token);
    public Task<SettlementBankAllocationResult?> BankOperationAsync(Guid actor, Guid key, CancellationToken token) => OperationAsync<SettlementBankAllocationResult>(actor, key, SettlementChargeRecords.BankKind, token);
    public Task<SettlementChargeReview?> ReviewOperationAsync(Guid actor, Guid key, CancellationToken token) => OperationAsync<SettlementChargeReview>(actor, key, SettlementChargeRecords.ReviewKind, token);
    public Task<SettlementFinancialClose?> FinancialCloseOperationAsync(Guid actor, Guid key, CancellationToken token) =>
        OperationAsync<SettlementFinancialClose>(actor, key, SettlementChargeRecords.FinancialCloseKind, token);
    public async Task<SettlementFinancialClose?> LatestFinancialCloseAsync(Guid contractId, CancellationToken token) =>
        (await SettlementChargeRecords.ReadAsync<SettlementFinancialClose>(db, contractId,
            SettlementChargeRecords.FinancialCloseKind, token)).OrderByDescending(c => c.ApprovedAt).FirstOrDefault();
    public async Task<SettlementChargeReviewContext> ChargeReviewAsync(Guid id, CancellationToken token)
    {
        var context = await ContextAsync(id, token);
        var inspection = await NativeSettlementReads.InspectionAsync(db, id, token);
        var reference = SettlementChargeReviewRules.Reference(id, inspection, context.View.Receivables.Select(r => r.Charge));
        var latest = (await SettlementChargeRecords.ReadAsync<SettlementChargeReview>(db, id, SettlementChargeRecords.ReviewKind, token)).OrderByDescending(r => r.ApprovedAt).FirstOrDefault();
        return new(context, reference, latest);
    }
    public async Task SaveReviewAsync(SettlementChargeReview review, CancellationToken token)
    {
        await AppendAsync(review.ContractId, review.Id, SettlementChargeRecords.ReviewKind, review, review.ApprovedByUserId, review.ApprovedAt, token);
        await db.SaveChangesAsync(token);
    }
    public async Task SaveFinancialCloseAsync(SettlementFinancialClose result, CancellationToken token)
    {
        await AppendAsync(result.ContractId, result.Id, SettlementChargeRecords.FinancialCloseKind, result,
            result.ApprovedByUserId, result.ApprovedAt, token);
        await db.SaveChangesAsync(token);
    }
    public Task<Guid> LocationAsync(Guid id, CancellationToken token) => NativeSettlementReads.LocationAsync(db, id, token);
    public async Task SaveBankResultAsync(SettlementBankAllocationResult result, CancellationToken token)
    {
        await AppendAsync(result.ContractId, result.Id, SettlementChargeRecords.BankKind, result, result.ApprovedByUserId, result.ApprovedAt, token);
        await db.SaveChangesAsync(token);
        if (result.AllocationId is not null && result.Reason != "already_allocated")
        {
            var charge = (await SettlementChargeRecords.ReadAsync<SettlementReceivable>(db, result.ContractId, SettlementChargeRecords.ChargeKind, token)).Single(c => c.Id == result.ReceivableId);
            await NotifyAsync(charge, "settlement-paid:" + result.AllocationId, "Đã xác minh thanh toán khoản phải thu", "Khoản phải thu chuyển ra có thanh toán được xác minh. Mở hóa đơn và khoản phải thu để xem số dư mới nhất.", token);
        }
    }
    private async Task NotifyAsync(SettlementReceivable charge, string key, string title, string message, CancellationToken token)
    {
        var location = await LocationAsync(charge.ContractId, token);
        var writer = new BHome.Infrastructure.Modules.Notifications.CompactNotificationWriter((Compact24DbContext)db, clock);
        foreach (var recipient in charge.RecipientUserIds)
            await writer.Emit(recipient, "Tenant", location, key, "PAYMENT_STATUS_UPDATED", "Invoice", title, message, "SettlementReceivable", charge.Id, token, channels: ["IN_APP", "EMAIL"]);
    }
    public async Task<decimal?> InvoiceOutstandingAsync(Guid id, Guid invoiceId, CancellationToken token)
    {
        var chain = await ChainAsync(id, token);
        var snapshot = (await NativeSettlementReads.InspectionAsync(db, id, token))?.ObservedSnapshot;
        var incurred = snapshot is null ? chain[0].ActualEndDate ?? chain[0].EndDate : JsonSerializer.Deserialize<HandoverSnapshot>(snapshot)!.Date;
        if (!await OffsetInvoices(chain, incurred).AnyAsync(i => i.Id == invoiceId, token)) return null;
        return (await db.FinancialsAsync(invoiceId, token)).OutstandingAmount;
    }
    private async Task AppendAsync<T>(Guid contractId, Guid id, string kind, T record, Guid actor, DateTimeOffset at,
        CancellationToken token, string? auditEvent = null)
    {
        if (db.Database.CurrentTransaction is null) throw new InvalidOperationException("Settlement writes require the existing room and ledger transaction.");
        var json = JsonSerializer.Serialize(new { schemaVersion = 1, recordType = kind, recordKey = id, state = record }, SettlementChargeRecords.Json);
        var affected = await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE contracts SET history=history||jsonb_build_array({json}::jsonb) WHERE id={contractId}", token);
        if (affected != 1) throw new DbUpdateConcurrencyException("Settlement contract changed.");
        await SecurityAuditWrites.AppendAsync(db, new(Guid.NewGuid(), actor, null, null, auditEvent ?? kind + "Approved",
            true, at, kind, id), token);
    }
    public async Task SaveChargeAsync(SettlementReceivable charge, CancellationToken token)
    {
        if ((charge.Utility?.PricePolicyId ?? charge.FixedCharge?.PolicyId) is { } policyId)
        {
            var native = (Compact24DbContext)db;
            var row = await native.Set<Native.BillingPolicy>().AsNoTracking().SingleAsync(p => p.Id == policyId, token);
            if (row.Version != (charge.Utility?.PricePolicyVersion ?? charge.FixedCharge?.PolicyVersion)) throw ContractException.Conflict("settlement_policy_changed");
            if (row.FirstUsedAt is null)
            {
                var policy = NativePolicyPersistence.Read(row);
                policy.RecordUsage(clock.GetUtcNow());
                await NativePolicyPersistence.StageAsync(native, policy, row.Version, DateTimeOffset.UtcNow, token);
            }
        }
        await AppendAsync(charge.ContractId, charge.Id, SettlementChargeRecords.ChargeKind, charge, charge.ApprovedByUserId, charge.ApprovedAt, token);
        await db.SaveChangesAsync(token);
        await NotifyAsync(charge, "settlement-charge:" + charge.Id, "Có khoản phải thu chuyển ra", "Owner đã duyệt khoản phải thu theo kết quả kiểm tra. Mở hóa đơn và khoản phải thu để kiểm tra.", token);
    }
    public async Task SaveOffsetAsync(DepositOffsetApproval approval, CancellationToken token)
    {
        await AppendAsync(approval.ContractId, approval.Id, SettlementChargeRecords.OffsetKind, approval, approval.ApprovedByUserId, approval.ApprovedAt, token);
        var allocation = PaymentAllocation.RestoreIdentity(approval.AllocationId, default, default);
        allocation.SourceDepositContractId = approval.SourceDepositContractId;
        allocation.TargetSettlementContractId = approval.ReceivableId is null ? null : approval.ContractId;
        allocation.SettlementReceivableId = approval.ReceivableId;
        allocation.InvoiceId = approval.InvoiceId;
        allocation.DepositOffsetApprovalId = approval.Id;
        allocation.Amount = approval.Amount;
        allocation.VerifiedByUserId = approval.ApprovedByUserId;
        allocation.AllocatedAt = approval.ApprovedAt;
        try { await PaymentLedgerWrites.AddAllocationAsync(db, allocation, token); }
        catch (Npgsql.PostgresException error)
        {
            // Preserve the repository's persistence-error contract for database guards.
            throw new DbUpdateException("Deposit allocation rejected by the database.", error);
        }
        await db.SaveChangesAsync(token);
        if (approval.ReceivableId is { } chargeId)
        {
            var charge = (await SettlementChargeRecords.ReadAsync<SettlementReceivable>(db, approval.ContractId, SettlementChargeRecords.ChargeKind, token)).Single(c => c.Id == chargeId);
            await NotifyAsync(charge, "settlement-offset:" + approval.Id, "Đã duyệt cấn trừ cọc", "Owner đã duyệt cấn trừ cọc vào khoản phải thu. Mở khoản phải thu để xem số dư đã xác nhận.", token);
        }
    }
}
