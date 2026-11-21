using System.Text.Json;
using BHome.Application.Contracts;
using BHome.Domain.TenantContracts;
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

internal sealed class DepositDeductionRepository(BHomePersistenceContext db, IContractRepository contracts) : IDepositDeductionRepository
{
    public async Task<T> TransactionAsync<T>(Guid contractId, Func<Task<T>> work, CancellationToken token)
    {
        if (db is not Compact24DbContext) throw new ContractException(503, "deposit_deduction_unavailable");
        var room = await db.Set<Contract>().AsNoTracking().Where(c => c.Id == contractId).Select(c => (Guid?)c.RoomId).SingleOrDefaultAsync(token)
            ?? throw ContractException.Missing();
        return await contracts.InTransactionAsync(room, work, token);
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
}
