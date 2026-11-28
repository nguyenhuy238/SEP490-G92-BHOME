using BHome.Application.Contracts;
using BHome.Application.IncidentMaintenance;
using BHome.Domain.Billing;
using BHome.Domain.IncidentMaintenance;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Contracts;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using BHome.Infrastructure.Modules.PropertyManagement.Persistence;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Native = BHome.Domain.Entities;

namespace BHome.Infrastructure.Modules.IncidentMaintenance.Persistence;

internal sealed class CompensationRepository(BHomePersistenceContext db, IIncidentRepository incidents,
    IContractDepositPosition deposits) : ICompensationRepository
{
    private readonly NativeIncidentSession? native = db is Compact24DbContext compact ? new(compact) : null;
    public Task<bool> ActiveOwnerAsync(Guid actor, CancellationToken t) => incidents.ActiveRoleAsync(actor, BHome.Domain.IdentityAccess.Roles.Owner, t);
    public Task<MaintenanceWorkOrder?> WorkAsync(Guid id, CancellationToken t) => native is not null
        ? native.WorkAsync(id, t) : incidents.WorkOrderAsync(id, t);
    public async Task<T> TransactionAsync<T>(Guid workOrder, Guid actor, Guid key, Func<Task<T>> work, CancellationToken t)
    {
        if (db is not Compact24DbContext) throw new IncidentException(503, "compact_maintenance_compensation_required");
        native!.Clear();
        db.ChangeTracker.Clear();
        await using var transaction = await db.Database.BeginTransactionAsync(t);
        await db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(hashtextextended('bhome-payment-ledger-v1',0))", t);
        var target = await WorkAsync(workOrder, t) ?? throw IncidentException.Missing();
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({target.LocationId.ToString()},0))", t);
        if (target.RoomId is { } room && !await IncidentRepository.LockRoomAsync(db, room, t)) throw IncidentException.Missing();
        native.Clear();
        try
        {
            var result = await work(); await FlushAsync(t); await transaction.CommitAsync(t); return result;
        }
        catch (DbUpdateConcurrencyException) { throw IncidentException.Conflict("stale_version"); }
        catch (DbUpdateException error) when (error.InnerException is PostgresException { SqlState: "23505" or "23514" or "23503" })
        { throw IncidentException.Conflict("compensation_concurrent_or_invalid_state"); }
        catch (PostgresException error) when (error.SqlState is "23505" or "23514" or "23503")
        { throw IncidentException.Conflict("compensation_concurrent_or_invalid_state"); }
        finally { native.Clear(); }
    }
    public async Task<IReadOnlyList<CompensationContract>> ContractsAsync(Guid room, CancellationToken t)
    {
        if (native is not null)
            return (await db.Set<BHome.Domain.TenantContracts.Contract>().AsNoTracking().Where(c => c.RoomId == room && c.ActivatedAt != null &&
                c.Kind != BHome.Domain.TenantContracts.ContractKind.Holding && (c.Status == ContractStatus.Active || c.Status == ContractStatus.Terminated ||
                c.Status == ContractStatus.Superseded)).OrderByDescending(c => c.StartDate).Take(100)
                .Select(c => new { c.Id, c.Status, c.StartDate, End = c.ActualEndDate ?? c.EndDate }).ToArrayAsync(t))
                .Select(c => new CompensationContract(c.Id, ((ContractStatus)c.Status).ToString(), c.StartDate, c.End)).ToArray();
        return await db.Set<Contract>().AsNoTracking().Where(c => c.RoomId == room && c.ActivatedAt != null && c.Kind != ContractKind.Holding &&
            (c.Status == ContractStatus.Active || c.Status == ContractStatus.Terminated || c.Status == ContractStatus.Superseded))
            .OrderByDescending(c => c.StartDate).Select(c => new CompensationContract(c.Id, c.Status.ToString(), c.StartDate, c.ActualEndDate ?? c.EndDate)).Take(100).ToArrayAsync(t);
    }
    public Task<MaintenanceCompensation?> FindAsync(Guid workOrder, CancellationToken t) => native is not null
        ? native.CompensationAsync(workOrder, t) : db.Set<MaintenanceCompensation>().SingleOrDefaultAsync(c => c.WorkOrderId == workOrder, t);
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
    public Task<IncidentCommand?> CommandAsync(Guid actor, Guid key, CancellationToken t) => native is not null
        ? native.CommandAsync(actor, key, t) : incidents.CommandAsync(actor, key, t);
    public Task<IReadOnlyList<IncidentEvidence>> EvidenceAsync(Guid workOrder, CancellationToken t) => native is not null
        ? native.EvidenceAsync(null, workOrder, t) : incidents.WorkEvidenceAsync(workOrder, t);
    public Task<bool> InvoiceHasMoneyAsync(Guid invoice, CancellationToken t) => native is not null
        ? db.Set<BHome.Domain.PaymentsDebt.PaymentAllocation>().AsNoTracking().AnyAsync(a => a.InvoiceId == invoice, t)
        : db.Set<BHome.Domain.PaymentsDebt.PaymentAllocation>().AnyAsync(a => a.InvoiceId == invoice, t);
    public async Task IssueInvoiceAsync(Invoice invoice, InvoiceIssuedEvent issued, CancellationToken t)
    {
        if (db is Compact24DbContext compact)
        {
            await NativeCompensationInvoice.IssueAsync(compact, invoice, issued, t);
            return;
        }
        db.Add(invoice);
        await db.SaveChangesAsync(t);
        invoice.Status = InvoiceStatus.Final;
        invoice.Version++;
        await db.SaveChangesAsync(t);
        db.Add(issued);
    }
    public async Task<CompensationSource> SourceAsync(Guid workOrder, Guid contractId, CancellationToken t)
    {
        var work = await WorkAsync(workOrder, t) ?? throw IncidentException.Missing();
        if (db is Compact24DbContext compact)
            return await NativeSourceAsync(compact, work, contractId, t);
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
    private async Task<CompensationSource> NativeSourceAsync(Compact24DbContext compact, MaintenanceWorkOrder work,
        Guid contractId, CancellationToken t)
    {
        var contract = await NativeContractSnapshot.LoadAsync(compact, contractId, t);
        if (contract is null || contract.RoomId != work.RoomId || contract.ActivatedAt is null || contract.Kind == ContractKind.Holding ||
            contract.Status is not (ContractStatus.Active or ContractStatus.Terminated or ContractStatus.Superseded))
            throw IncidentException.Missing();
        var root = contract;
        var visited = new HashSet<Guid> { root.Id };
        while (root.PreviousContractId is { } parent)
        {
            if (!visited.Add(parent) || visited.Count > 100) throw IncidentException.Conflict("contract_version_integrity_failed");
            root = NativeContractSnapshot.Read(await compact.Set<BHome.Domain.TenantContracts.Contract>().AsNoTracking().SingleAsync(c => c.Id == parent, t));
            if (root.RoomId != contract.RoomId || root.TenantUserId != contract.TenantUserId)
                throw IncidentException.Conflict("contract_version_integrity_failed");
        }
        var position = await deposits.ReadAsync(visited.ToArray(), t);
        var reserved = await compact.Database.SqlQuery<decimal>($"""
            SELECT COALESCE(sum((s.data->>'amount')::numeric),0) AS "Value" FROM operational_tasks task
            CROSS JOIN LATERAL (
                SELECT DISTINCT ON (h->>'recordKey') h->'state' AS data,h->>'deleted' AS deleted
                FROM jsonb_array_elements(task.history) WITH ORDINALITY a(h,n)
                WHERE h->>'recordType'='MaintenanceCompensation' ORDER BY h->>'recordKey',n DESC
            ) s WHERE task.task_type='WORK_ORDER' AND task.id<>{work.Id}
                AND COALESCE(s.deleted,'false')<>'true' AND (s.data->>'depositContractId')::uuid={root.Id}
                AND s.data->>'status' IN ('DepositPending','Deducted')
            """).SingleAsync(t);
        var legacyPlan = await DepositDeductionRecords.LatestAsync(db, contractId, t);
        var available = position is null || position.UnclassifiedRefunds > 0 ? 0 :
            position.Received - position.Allocated - position.Refunded - position.Reserved - reserved - (legacyPlan?.Total ?? 0);
        var residents = contract.Residents.Select(r => r.ResidentId).ToArray();
        var people = await compact.Set<BHome.Domain.TenantContracts.Resident>().AsNoTracking().Where(r => residents.Contains(r.Id) && r.TenantUserId != null)
            .Select(r => r.TenantUserId!.Value).ToArrayAsync(t);
        var recipients = contract.TenantUserId is { } tenant ? people.Prepend(tenant).Distinct().ToArray() : [];
        var ready = contract.Status == ContractStatus.Active && await compact.Database.SqlQuery<bool>($"""
            SELECT EXISTS(SELECT 1 FROM contracts c WHERE (c.move_out->'current'->>'contractId')::uuid={contractId}
                AND c.move_out->'current'->>'approvedAt' IS NOT NULL)
                AND COALESCE((SELECT i->>'ownerDecision'='Confirmed' FROM contracts c
                    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c.move_out->'inspections','[]'::jsonb)) i
                    WHERE (i->>'contractId')::uuid={contractId} ORDER BY (i->>'version')::int DESC LIMIT 1),false) AS "Value"
            """).SingleAsync(t);
        return new(work, contractId, root.Id, recipients, contract.Room.RoomNumber, contract.Room.Location.Name,
            Math.Max(0, available), ready);
    }
    public void Add(object entity)
    {
        if (native?.Add(entity) != true) db.Add(entity);
    }
    public Task FlushAsync(CancellationToken t) => native is not null ? native.FlushAsync(t) : db.SaveChangesAsync(t);
    public void Audit(Guid actor, string action, Guid target, DateTimeOffset now)
    {
        if (native is not null) native.Audit(actor, action, target, now);
        else incidents.Audit(actor, action, target, now);
    }
}
