using System.Text.Json;
using BHome.Application.Contracts;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Contracts;

internal static class DepositDeductionRecords
{
    internal const string Kind = "DepositDeductionV1";
    internal static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    internal static async Task<DepositDeductionPlan?> LatestAsync(BHomePersistenceContext db, Guid contractId, CancellationToken token)
    {
        if (db is not Compact24DbContext) return null; // Explicit unsupported offline legacy capability.
        var json = await db.Database.SqlQuery<string>($"""
            SELECT (h->'state')::text AS "Value" FROM contracts c
            CROSS JOIN LATERAL jsonb_array_elements(c.history) WITH ORDINALITY e(h,n)
            WHERE c.id={contractId} AND h->>'recordType'={Kind} ORDER BY n DESC LIMIT 1
            """).FirstOrDefaultAsync(token);
        return json is null ? null : JsonSerializer.Deserialize<DepositDeductionPlan>(json, Json)
            ?? throw ContractException.Conflict("deposit_deduction_history_invalid");
    }
}

internal sealed class DepositDeductionRepository(BHomePersistenceContext db, IContractRepository contracts,
    IContractSettlementLedger ledger) : IDepositDeductionRepository
{
    public async Task<T> TransactionAsync<T>(Guid contractId, Func<Task<T>> work, CancellationToken token)
    {
        if (db is not Compact24DbContext) throw new ContractException(503, "deposit_deduction_unavailable");
        var room = await db.Set<Contract>().AsNoTracking().Where(c => c.Id == contractId).Select(c => (Guid?)c.RoomId).SingleOrDefaultAsync(token)
            ?? throw ContractException.Missing();
        return await contracts.InTransactionAsync(room, work, token);
    }
    public async Task<DepositDeductionContext> ContextAsync(Guid contractId, CancellationToken token)
    {
        if (ledger is not IContractSettlementDetails details) throw new ContractException(503, "settlement_summary_unavailable");
        var contract = await db.Set<Contract>().AsNoTracking().SingleOrDefaultAsync(c => c.Id == contractId, token) ?? throw ContractException.Missing();
        var summary = await details.SummaryAsync(contractId, token);
        var move = await db.Set<ContractMoveOut>().AsNoTracking().SingleOrDefaultAsync(m => m.ContractId == contractId, token);
        var inspection = await db.Set<ContractFinalInspection>().AsNoTracking().Where(i => i.ContractId == contractId)
            .OrderByDescending(i => i.Version).FirstOrDefaultAsync(token);
        var snapshot = inspection is null ? null : JsonSerializer.Deserialize<HandoverSnapshot>(inspection.ObservedSnapshot);
        var ids = snapshot?.EvidenceIds ?? [];
        var files = await db.Set<ContractInspectionEvidence>().AsNoTracking().Where(e => e.ContractId == contractId && e.IsLinked && ids.Contains(e.Id))
            .Select(e => new DeductionFile(e.Id, e.ObjectKey, e.ContentType)).ToArrayAsync(token);
        return new(summary, contract.Status.ToString(), move?.Status.ToString() ?? "Missing", inspection?.Id ?? Guid.Empty,
            inspection?.Version ?? 0, inspection?.OwnerDecision == "Confirmed", inspection?.NoAdditionalCharges ?? true,
            snapshot?.Assets.Select(a => a.Id).ToArray() ?? [], files, contract.IsDevelopmentDemo);
    }
    public async Task<DepositDeductionPlan?> OperationAsync(Guid actor, Guid key, CancellationToken token)
    {
        var json = await db.Database.SqlQuery<string>($"""
            SELECT (h->'state')::text AS "Value" FROM contracts c CROSS JOIN LATERAL jsonb_array_elements(c.history) h
            WHERE h->>'recordType'={DepositDeductionRecords.Kind} AND h->'state'->>'operationKey'={key.ToString()}
              AND h->'state'->>'approvedByUserId'={actor.ToString()}
            """).SingleOrDefaultAsync(token);
        return json is null ? null : JsonSerializer.Deserialize<DepositDeductionPlan>(json, DepositDeductionRecords.Json);
    }
    public async Task SaveAsync(DepositDeductionPlan plan, CancellationToken token)
    {
        var json = JsonSerializer.Serialize(new { recordType = DepositDeductionRecords.Kind, recordKey = plan.Id, state = plan }, DepositDeductionRecords.Json);
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE contracts SET history=history||jsonb_build_array({json}::jsonb) WHERE id={plan.ContractId}", token);
        db.SecurityAudit.Add(new SecurityAuditRecord { UserId = plan.ApprovedByUserId, TargetId = plan.Id, TargetType = "DepositDeduction",
            Event = "DepositDeductionApproved", Succeeded = true, OccurredAt = plan.ApprovedAt });
        await db.SaveChangesAsync(token);
    }
}
