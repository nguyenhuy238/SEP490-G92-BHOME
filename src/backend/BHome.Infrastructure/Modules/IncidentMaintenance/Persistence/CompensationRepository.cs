using BHome.Application.Contracts;
using BHome.Application.IncidentMaintenance;
using BHome.Domain.Billing;
using BHome.Domain.IncidentMaintenance;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Contracts;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace BHome.Infrastructure.Modules.IncidentMaintenance.Persistence;

internal sealed class CompensationRepository(BHomePersistenceContext db, IIncidentRepository incidents,
    IContractDepositPosition deposits) : ICompensationRepository
{
    public Task<bool> ActiveOwnerAsync(Guid actor, CancellationToken t) => incidents.ActiveRoleAsync(actor, BHome.Domain.IdentityAccess.Roles.Owner, t);
    public Task<MaintenanceWorkOrder?> WorkAsync(Guid id, CancellationToken t) => incidents.WorkOrderAsync(id, t);
    public async Task<T> TransactionAsync<T>(Guid workOrder, Guid actor, Guid key, Func<Task<T>> work, CancellationToken t)
    {
        if (db is not Compact24DbContext) throw new IncidentException(503, "compact_maintenance_compensation_required");
        db.ChangeTracker.Clear();
        await using var transaction = await db.Database.BeginTransactionAsync(t);
        await db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(hashtextextended('bhome-payment-ledger-v1',0))", t);
        var target = await WorkAsync(workOrder, t) ?? throw IncidentException.Missing();
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({target.LocationId.ToString()},0))", t);
        if (target.RoomId is { } room) await db.Locked<Room>(room).SingleAsync(t);
        try
        {
            var result = await work(); await db.SaveChangesAsync(t); await transaction.CommitAsync(t); return result;
        }
        catch (DbUpdateConcurrencyException) { throw IncidentException.Conflict("stale_version"); }
        catch (DbUpdateException error) when (error.InnerException is PostgresException { SqlState: "23505" or "23514" or "23503" })
        { throw IncidentException.Conflict("compensation_concurrent_or_invalid_state"); }
    }
    public async Task<IReadOnlyList<CompensationContract>> ContractsAsync(Guid room, CancellationToken t) =>
        await db.Set<Contract>().AsNoTracking().Where(c => c.RoomId == room && c.ActivatedAt != null && c.Kind != ContractKind.Holding &&
            (c.Status == ContractStatus.Active || c.Status == ContractStatus.Terminated || c.Status == ContractStatus.Superseded))
            .OrderByDescending(c => c.StartDate).Select(c => new CompensationContract(c.Id, c.Status.ToString(), c.StartDate, c.ActualEndDate ?? c.EndDate)).Take(100).ToArrayAsync(t);
    public Task<MaintenanceCompensation?> FindAsync(Guid workOrder, CancellationToken t) => db.Set<MaintenanceCompensation>().SingleOrDefaultAsync(c => c.WorkOrderId == workOrder, t);
    public async Task<IReadOnlyList<CompensationView>> HistoryAsync(Guid workOrder, CancellationToken t)
    {
        var versions = await db.Database.SqlQuery<string>($"""
            SELECT (h->'state')::text AS "Value" FROM operational_tasks task
            CROSS JOIN LATERAL jsonb_array_elements(task.history) WITH ORDINALITY a(h,n)
            WHERE task.id={workOrder} AND task.task_type='WORK_ORDER' AND h->>'recordType'='MaintenanceCompensation'
            ORDER BY n DESC LIMIT 100
            """).ToArrayAsync(t);
        return versions.Select(v => System.Text.Json.JsonSerializer.Deserialize<CompensationView>(v,
            new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web))!).ToArray();
    }
    public Task<IncidentCommand?> CommandAsync(Guid actor, Guid key, CancellationToken t) => incidents.CommandAsync(actor, key, t);
    public Task<IReadOnlyList<IncidentEvidence>> EvidenceAsync(Guid workOrder, CancellationToken t) => incidents.WorkEvidenceAsync(workOrder, t);
    public Task<bool> InvoiceHasMoneyAsync(Guid invoice, CancellationToken t) => db.Set<BHome.Domain.PaymentsDebt.PaymentAllocation>().AnyAsync(a => a.InvoiceId == invoice, t);
    public async Task<CompensationSource> SourceAsync(Guid workOrder, Guid contractId, CancellationToken t)
    {
        var work = await WorkAsync(workOrder, t) ?? throw IncidentException.Missing();
        var contract = await db.Set<Contract>().AsNoTracking().Include(c => c.Room).ThenInclude(r => r.Location).Include(c => c.Residents)
            .SingleOrDefaultAsync(c => c.Id == contractId && c.RoomId == work.RoomId && c.ActivatedAt != null && c.Kind != ContractKind.Holding &&
                (c.Status == ContractStatus.Active || c.Status == ContractStatus.Terminated || c.Status == ContractStatus.Superseded), t) ?? throw IncidentException.Missing();
        var root = contract; var visited = new HashSet<Guid> { root.Id };
        while (root.PreviousContractId is { } parent)
        {
            if (!visited.Add(parent) || visited.Count > 100) throw IncidentException.Conflict("contract_version_integrity_failed");
            root = await db.Set<Contract>().AsNoTracking().SingleAsync(c => c.Id == parent, t);
            if (root.RoomId != contract.RoomId || root.TenantUserId != contract.TenantUserId) throw IncidentException.Conflict("contract_version_integrity_failed");
        }
        var position = await deposits.ReadAsync(visited.ToArray(), t);
        var otherReserved = await db.Set<MaintenanceCompensation>().Where(c => c.DepositContractId == root.Id && c.WorkOrderId != workOrder &&
            (c.Status == "DepositPending" || c.Status == "Deducted")).SumAsync(c => (decimal?)c.Amount, t) ?? 0;
        var legacyPlan = await DepositDeductionRecords.LatestAsync(db, contractId, t);
        var available = position is null || position.UnclassifiedRefunds > 0 ? 0 : position.Received - position.Allocated - position.Refunded - position.Reserved - otherReserved - (legacyPlan?.Total ?? 0);
        var residents = contract.Residents.Select(r => r.ResidentId).ToArray();
        var people = await db.Set<Resident>().AsNoTracking().Where(r => residents.Contains(r.Id) && r.TenantUserId != null)
            .Select(r => r.TenantUserId!.Value).ToArrayAsync(t);
        // Contract-bound residents establish entitlements. Room membership alone grants none.
        var recipients = contract.TenantUserId is { } tenant ? people.Prepend(tenant).Distinct().ToArray() : [];
        var move = await db.Set<ContractMoveOut>().AsNoTracking().SingleOrDefaultAsync(m => m.ContractId == contractId, t);
        var inspection = await db.Set<ContractFinalInspection>().AsNoTracking().Where(i => i.ContractId == contractId).OrderByDescending(i => i.Version).FirstOrDefaultAsync(t);
        return new(work, contractId, root.Id, recipients, contract.Room.RoomNumber, contract.Room.Location.Name,
            Math.Max(0, available), contract.Status == ContractStatus.Active && move?.ApprovedAt != null && inspection?.OwnerDecision == "Confirmed");
    }
    public void Add(object entity) => db.Add(entity);
    public Task FlushAsync(CancellationToken t) => db.SaveChangesAsync(t);
    public void Audit(Guid actor, string action, Guid target, DateTimeOffset now) => incidents.Audit(actor, action, target, now);
}
