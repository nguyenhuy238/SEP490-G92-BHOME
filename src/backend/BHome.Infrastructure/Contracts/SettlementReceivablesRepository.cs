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

namespace BHome.Infrastructure.Contracts;

internal static class SettlementChargeRecords
{
    internal const string ChargeKind = "SettlementReceivableV1", OffsetKind = "DepositOffsetApprovalV1", BankKind = "SettlementBankAllocationV1";
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

internal sealed class SettlementReceivablesRepository(BHomePersistenceContext db, IContractRepository contracts,
    IContractDepositPosition deposits, TimeProvider clock) : ISettlementReceivablesRepository
{
    public async Task<T> TransactionAsync<T>(Guid id, Func<Task<T>> work, CancellationToken token)
    {
        if (db is not Compact24DbContext) throw new ContractException(503, "settlement_receivables_unavailable");
        var room = await db.Set<Contract>().AsNoTracking().Where(c => c.Id == id).Select(c => (Guid?)c.RoomId).SingleOrDefaultAsync(token)
            ?? throw ContractException.Missing();
        return await contracts.InTransactionAsync(room, work, token);
    }
    public async Task<bool> CanReadAsync(Guid id, Guid userId, bool owner, CancellationToken token)
    {
        if (await db.Set<Contract>().AnyAsync(c => c.Id == id && (owner || c.TenantUserId == userId ||
            db.Set<ContractResident>().Any(cr => cr.ContractId == id && db.Set<Resident>().Any(r => r.Id == cr.ResidentId && r.TenantUserId == userId))), token)) return true;
        return db is Compact24DbContext && await db.Database.SqlQuery<bool>($"""
            SELECT EXISTS(SELECT 1 FROM contracts c CROSS JOIN LATERAL jsonb_array_elements(c.history) h
              WHERE c.id={id} AND h->>'recordType'={SettlementChargeRecords.ChargeKind}
                AND h->'state'->'recipientUserIds' @> jsonb_build_array({userId.ToString()})) AS "Value"
            """).SingleAsync(token);
    }
    private async Task<List<Contract>> ChainAsync(Guid id, CancellationToken token)
    {
        var c = await db.Set<Contract>().AsNoTracking().Include(c => c.Room).SingleOrDefaultAsync(c => c.Id == id, token) ?? throw ContractException.Missing();
        var chain = new List<Contract> { c };
        while (chain[^1].PreviousContractId is { } previous)
        {
            if (chain.Count >= 100 || chain.Any(v => v.Id == previous)) throw ContractException.Conflict("contract_version_integrity_failed");
            var parent = await db.Set<Contract>().AsNoTracking().SingleAsync(v => v.Id == previous, token);
            if (parent.RoomId != c.RoomId || parent.TenantUserId != c.TenantUserId) throw ContractException.Conflict("contract_version_integrity_failed");
            chain.Add(parent);
        }
        return chain;
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
        var chain = await ChainAsync(id, token); var contract = chain[0]; var chainIds = chain.Select(c => c.Id).ToArray();
        var inspection = await db.Set<ContractFinalInspection>().AsNoTracking().Where(i => i.ContractId == id).OrderByDescending(i => i.Version).FirstOrDefaultAsync(token);
        var move = await db.Set<ContractMoveOut>().AsNoTracking().SingleOrDefaultAsync(m => m.ContractId == id, token);
        var observed = inspection is null ? null : JsonSerializer.Deserialize<HandoverSnapshot>(inspection.ObservedSnapshot);
        var charges = await SettlementChargeRecords.ReadAsync<SettlementReceivable>(db, id, SettlementChargeRecords.ChargeKind, token);
        var offsets = await SettlementChargeRecords.ReadAsync<DepositOffsetApproval>(db, id, SettlementChargeRecords.OffsetKind, token);
        var totals = await db.Set<PaymentAllocation>().AsNoTracking().Where(a => a.TargetSettlementContractId == id)
            .GroupBy(a => a.SettlementReceivableId).Select(g => new { Id = g.Key, Amount = g.Sum(a => a.Amount) }).ToArrayAsync(token);
        var balances = charges.Select(c =>
        {
            var paid = totals.SingleOrDefault(a => a.Id == c.Id)?.Amount ?? 0;
            if (paid < 0 || paid > c.Amount) throw ContractException.Conflict("settlement_ledger_integrity_failed");
            return new SettlementReceivableBalance(c, paid, c.Amount - paid, paid == c.Amount ? "Paid" : paid == 0 ? "Unpaid" : "PartiallyPaid");
        }).ToArray();
        var position = await deposits.ReadAsync([chain[^1].Id], token) ?? throw new ContractException(503, "deposit_position_unavailable");
        var available = position.Received - position.Allocated - position.Refunded - position.Reserved;
        if (available < 0) throw ContractException.Conflict("deposit_ledger_reconciliation_required");
        var incurred = observed?.Date ?? contract.ActualEndDate ?? contract.EndDate;
        var capturedAt = inspection?.InspectedAt ?? DateTimeOffset.MinValue;
        var recipients = await (from cr in db.Set<ContractResident>().AsNoTracking()
                                join tenancy in db.Set<Contract>() on cr.ContractId equals tenancy.Id
                                join r in db.Set<Resident>() on cr.ResidentId equals r.Id
                                where tenancy.RoomId == contract.RoomId && tenancy.ActivatedAt != null && tenancy.ActivatedAt <= capturedAt &&
                                    tenancy.StartDate <= incurred && (tenancy.ActualEndDate ?? tenancy.EndDate) >= incurred &&
                                    (tenancy.Status == ContractStatus.Active || tenancy.Id == id ||
                                        tenancy.Status == ContractStatus.Terminated && tenancy.ActualEndDate >= incurred || tenancy.Status == ContractStatus.Superseded) &&
                                    cr.ResidenceFrom <= incurred && (cr.ResidenceTo == null || cr.ResidenceTo >= incurred) && r.TenantUserId != null
                                select r.TenantUserId!.Value).Distinct().ToArrayAsync(token);
        var legacy = await DepositDeductionRecords.LatestAsync(db, id, token);
        var payerIds = charges.SelectMany(c => c.RecipientUserIds).Distinct().ToArray();
        var payerRows = await db.Set<Resident>().AsNoTracking().Where(r => r.TenantUserId != null && payerIds.Contains(r.TenantUserId.Value))
            .OrderBy(r => r.Id).Select(r => new { Id = r.TenantUserId!.Value, r.DisplayLabel }).ToArrayAsync(token);
        var payers = payerRows.DistinctBy(r => r.Id).Select(r => new BHome.Application.PaymentsDebt.PayerChoice(r.Id, r.DisplayLabel)).ToArray();
        var invoiceRows = await db.Financials(db.Set<Invoice>().AsNoTracking().Where(i => i.RoomId == contract.RoomId && i.Status == InvoiceStatus.Final && chainIds.Contains(i.RepresentativeContractId)))
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
        return new(new(id, contract.RoomId, reference, available, balances, offsets, contract.Room.RoomNumber, invoiceBalances, payers), chain[^1].Id,
            inspection?.Id ?? Guid.Empty, inspection?.Version ?? 0,
            contract.Kind is ContractKind.Main or ContractKind.Renewal && contract.Status is ContractStatus.Active or ContractStatus.Terminated && move?.ApprovedAt != null && inspection?.OwnerDecision == "Confirmed",
            inspection?.NoAdditionalCharges ?? true, observed?.Assets.Select(a => a.Id).ToArray() ?? [], observed?.EvidenceIds ?? [], recipients, legacy is not null, contract.IsDevelopmentDemo);
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
    public Task<Guid> LocationAsync(Guid id, CancellationToken token) => db.Set<Contract>().Where(c => c.Id == id).Select(c => c.Room.LocationId).SingleAsync(token);
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
        var location = await db.Set<Contract>().Where(c => c.Id == charge.ContractId).Select(c => c.Room.LocationId).SingleAsync(token);
        var writer = new BHome.Infrastructure.Modules.Notifications.CompactNotificationWriter((Compact24DbContext)db, clock);
        foreach (var recipient in charge.RecipientUserIds)
            await writer.Emit(recipient, "Tenant", location, key, "PAYMENT_STATUS_UPDATED", "Invoice", title, message, "SettlementReceivable", charge.Id, token, channels: ["IN_APP", "EMAIL"]);
    }
    public async Task<decimal?> InvoiceOutstandingAsync(Guid id, Guid invoiceId, CancellationToken token)
    {
        var chain = await ChainAsync(id, token); var ids = chain.Select(c => c.Id).ToArray();
        if (!await db.Set<Invoice>().AnyAsync(i => i.Id == invoiceId && i.RoomId == chain[0].RoomId && i.Status == InvoiceStatus.Final && ids.Contains(i.RepresentativeContractId), token)) return null;
        return (await db.FinancialsAsync(invoiceId, token)).OutstandingAmount;
    }
    private async Task AppendAsync<T>(Guid contractId, Guid id, string kind, T record, Guid actor, DateTimeOffset at, CancellationToken token)
    {
        var json = JsonSerializer.Serialize(new { schemaVersion = 1, recordType = kind, recordKey = id, state = record }, SettlementChargeRecords.Json);
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE contracts SET history=history||jsonb_build_array({json}::jsonb) WHERE id={contractId}", token);
        db.SecurityAudit.Add(new SecurityAuditRecord { UserId = actor, TargetId = id, TargetType = kind, Event = kind + "Approved", Succeeded = true, OccurredAt = at });
    }
    public async Task SaveChargeAsync(SettlementReceivable charge, CancellationToken token)
    {
        await AppendAsync(charge.ContractId, charge.Id, SettlementChargeRecords.ChargeKind, charge, charge.ApprovedByUserId, charge.ApprovedAt, token);
        await db.SaveChangesAsync(token);
        await NotifyAsync(charge, "settlement-charge:" + charge.Id, "Có khoản phải thu chuyển ra", "Owner đã duyệt khoản phải thu theo biên bản. Mở hóa đơn và khoản phải thu để kiểm tra.", token);
    }
    public async Task SaveOffsetAsync(DepositOffsetApproval approval, CancellationToken token)
    {
        await AppendAsync(approval.ContractId, approval.Id, SettlementChargeRecords.OffsetKind, approval, approval.ApprovedByUserId, approval.ApprovedAt, token);
        var allocation = new PaymentAllocation
        {
            SourceDepositContractId = approval.SourceDepositContractId,
            TargetSettlementContractId = approval.ReceivableId is null ? null : approval.ContractId,
            SettlementReceivableId = approval.ReceivableId,
            InvoiceId = approval.InvoiceId,
            DepositOffsetApprovalId = approval.Id,
            Amount = approval.Amount,
            VerifiedByUserId = approval.ApprovedByUserId,
            AllocatedAt = approval.ApprovedAt
        };
        db.Entry(allocation).Property(a => a.Id).CurrentValue = approval.AllocationId;
        db.Add(allocation);
        await db.SaveChangesAsync(token);
        if (approval.ReceivableId is { } chargeId)
        {
            var charge = (await SettlementChargeRecords.ReadAsync<SettlementReceivable>(db, approval.ContractId, SettlementChargeRecords.ChargeKind, token)).Single(c => c.Id == chargeId);
            await NotifyAsync(charge, "settlement-offset:" + approval.Id, "Đã duyệt cấn trừ cọc", "Owner đã duyệt cấn trừ cọc vào khoản phải thu. Mở khoản phải thu để xem số dư đã xác nhận.", token);
        }
    }
}
