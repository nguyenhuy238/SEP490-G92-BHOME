using BHome.Application.Billing;
using BHome.Application.PropertyManagement;
using BHome.Domain.Billing;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace BHome.Infrastructure.Billing;

internal sealed class InvoiceRepository(BHomePersistenceContext db) : IInvoiceRepository
{
    public Task<BillingSchedule?> ScheduleAsync(Guid locationId, CancellationToken t) => db.Set<BillingSchedule>().SingleOrDefaultAsync(s => s.LocationId == locationId, t);
    public Task<Room?> RoomAsync(Guid roomId, CancellationToken t) => db.Set<Room>().Include(r => r.Location).SingleOrDefaultAsync(r => r.Id == roomId, t);
    public async Task<T> WithRoomLockAsync<T>(Guid roomId, Func<Task<T>> action, CancellationToken t)
    {
        var locationId = await db.Set<Room>().AsNoTracking().Where(r => r.Id == roomId).Select(r => (Guid?)r.LocationId).SingleOrDefaultAsync(t)
            ?? throw new InvoiceException(404, "room_not_found");
        return await WithLocationLockAsync(locationId, async () =>
        {
            await db.Locked<Room>(roomId).SingleAsync(t);
            return await action();
        }, t);
    }
    public async Task<T> WithLocationLockAsync<T>(Guid locationId, Func<Task<T>> action, CancellationToken t)
    {
        db.ChangeTracker.Clear();
        await using var transaction = await db.Database.BeginTransactionAsync(t);
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({locationId.ToString()}, 0))", t);
        if (!await db.Locations.AnyAsync(l => l.Id == locationId, t)) throw new InvoiceException(404, "billing_location_not_found");
        try
        {
            var result = await action(); await db.SaveChangesAsync(t); await transaction.CommitAsync(t); return result;
        }
        catch (DbUpdateConcurrencyException) { throw new InvoiceException(409, "invoice_concurrent_change"); }
        catch (DbUpdateException e) when (e.InnerException is PostgresException { SqlState: "23505" or "23514" or "23P01" })
        { throw new InvoiceException(409, "invoice_concurrent_or_invalid_state"); }
    }
    private IQueryable<Invoice> Visible(InvoiceScope scope) => db.Set<Invoice>().Where(i => scope.Owner || scope.Tenant && i.Recipients.Any(r => r.TenantUserId == scope.Actor));
    private static IQueryable<Invoice> Detail(IQueryable<Invoice> source) => source.Include(i => i.Lines).Include(i => i.Recipients).AsSplitQuery();
    public Task<Invoice?> FindAsync(Guid id, InvoiceScope scope, CancellationToken t) => Detail(Visible(scope)).SingleOrDefaultAsync(i => i.Id == id, t);
    public Task<Invoice?> ForPeriodAsync(Guid roomId, DateOnly period, CancellationToken t) => Detail(db.Set<Invoice>()).SingleOrDefaultAsync(i => i.RoomId == roomId && i.BillingPeriod == period, t);
    public async Task<PagedResult<Invoice>> ListAsync(InvoiceScope scope, int page, int pageSize, Guid? roomId, CancellationToken t)
    {
        var source = Visible(scope).AsNoTracking().Where(i => roomId == null || i.RoomId == roomId);
        var count = await source.CountAsync(t);
        var items = await Detail(source.OrderByDescending(i => i.BillingPeriod).ThenBy(i => i.Id).Skip((page - 1) * pageSize).Take(pageSize)).ToArrayAsync(t);
        return new(items, page, pageSize, count);
    }
    public async Task<IReadOnlyList<BillingOccupancy>> OccupanciesAsync(Guid roomId, DateOnly from, DateOnly to, CancellationToken t)
    {
        var contracts = await db.Set<Contract>().AsNoTracking().Include(c => c.Residents).Where(c => c.RoomId == roomId &&
            (c.Status == ContractStatus.Active || c.Status == ContractStatus.Terminated || c.Status == ContractStatus.Superseded) &&
            c.ActivatedAt != null && c.StartDate <= to && (c.ActualEndDate ?? c.EndDate) >= from).Take(501).ToArrayAsync(t);
        if (contracts.Length > 500) throw new InvoiceException(409, "billing_occupancy_review_required");
        var residentIds = contracts.SelectMany(c => c.Residents.Where(r => r.ResidenceFrom <= to && (r.ResidenceTo == null || r.ResidenceTo >= from)).Select(r => r.ResidentId)).Distinct().ToArray();
        var links = await db.Set<Resident>().AsNoTracking().Where(r => residentIds.Contains(r.Id) && r.TenantUserId != null).ToDictionaryAsync(r => r.Id, r => r.TenantUserId!.Value, t);
        return contracts.Select(c => new BillingOccupancy(c, c.Residents.Where(r => r.ResidenceFrom <= to && (r.ResidenceTo == null || r.ResidenceTo >= from) && links.ContainsKey(r.ResidentId))
            .Select(r => links[r.ResidentId]).Append(c.TenantUserId ?? throw new InvoiceException(409, "active_tenant_account_required")).Distinct().ToArray())).ToArray();
    }
    public async Task<BillingReading?> ReadingAsync(Guid roomId, UtilityType type, DateOnly period, CancellationToken t)
    {
        var row = await (from reading in db.Set<MeterReading>().AsNoTracking()
                         join task in db.Set<OperationalTask>() on reading.TaskId equals task.Id
                         join meter in db.Set<Meter>() on reading.MeterId equals meter.Id
                         join evidence in db.Set<MeterEvidence>() on reading.EvidenceId equals evidence.Id
                         where meter.RoomId == roomId && meter.UtilityType == type && task.Purpose == ReadingPurpose.Periodic &&
                             task.BillingPeriod == period && task.Status == MeterTaskStatus.Completed && evidence.IsLinked && evidence.IsUploaded
                         select new BillingReading(reading, task.ReadingDate)).ToArrayAsync(t);
        // Replaced meters/multiple readings require an approved replacement allocation; never guess.
        if (row.Length != 1) return null;
        var value = row[0];
        var prior = await (from reading in db.Set<MeterReading>().AsNoTracking()
                           join task in db.Set<OperationalTask>() on reading.TaskId equals task.Id
                           where reading.MeterId == value.Reading.MeterId && reading.Id != value.Reading.Id && task.ReadingDate < value.ReadingDate
                           orderby task.ReadingDate descending, reading.ConfirmedAt descending
                           select new { reading.ConfirmedValue, task.ReadingDate, task.BillingPeriod }).FirstOrDefaultAsync(t);
        if (prior is null || prior.ConfirmedValue != value.Reading.PreviousValue || prior.ReadingDate < period.AddMonths(-1)) return null;
        return value;
    }
    public async Task RecordPolicyUsageAsync(Guid[] ids, DateTimeOffset at, CancellationToken t)
    {
        foreach (var policy in await db.Set<BillingPolicy>().Where(p => ids.Contains(p.Id)).ToArrayAsync(t)) policy.RecordUsage(at);
    }
    public void Add(object entity) => db.Add(entity);
    public Task<bool> HasPendingAdjustmentsAsync(Guid invoiceId, CancellationToken t) => db.Set<InvoiceAdjustmentRequest>().AnyAsync(r => r.InvoiceId == invoiceId && r.Decision == null, t);
    public async Task<IReadOnlyList<InvoiceAdjustmentDecision>> DraftCorrectionsAsync(Guid invoiceId, CancellationToken t) =>
        await db.Set<InvoiceAdjustmentDecision>().AsNoTracking().Where(d => d.InvoiceId == invoiceId && d.Outcome == "Approved" && d.InvoiceStatus == InvoiceStatus.Draft).ToArrayAsync(t);
    public void Audit(Guid actor, string action, Guid invoiceId, DateTimeOffset at) => db.SecurityAudit.Add(new SecurityAuditRecord
    { UserId = actor, Event = action, TargetType = "Billing", TargetId = invoiceId, Succeeded = true, OccurredAt = at });
    public void RemoveLines(Invoice invoice) { db.RemoveRange(invoice.Lines); invoice.Lines.Clear(); }
}
