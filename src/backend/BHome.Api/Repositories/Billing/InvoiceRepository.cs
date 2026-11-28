using BHome.Application.Billing;
using BHome.Application.PropertyManagement;
using BHome.Domain.Billing;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using BHome.Infrastructure.Modules.Billing.Persistence;
using BHome.Infrastructure.Modules.PropertyManagement.Persistence;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Native = BHome.Domain.Entities;

namespace BHome.Infrastructure.Billing;

internal sealed class InvoiceRepository(BHomePersistenceContext db) : IInvoiceRepository
{
    // Only populated during the existing location/room transaction. Domain workflow
    // values are detached from EF; persistence is explicitly scoped to this unit of work.
    private Dictionary<Guid, (Invoice Invoice, int? Version)>? nativeInvoices;
    private readonly Dictionary<Guid, (BillingSchedule Schedule, int? Version)> nativeSchedules = [];
    private readonly List<InvoiceIssuedEvent> nativeIssued = [];
    private readonly List<SecurityAuditRecord> nativeAudits = [];
    public async Task<BillingSchedule?> ScheduleAsync(Guid locationId, CancellationToken t)
    {
        if (db is Compact24DbContext compact)
        {
            if (nativeSchedules.TryGetValue(locationId, out var existing)) return existing.Schedule;
            var schedule = await NativeBillingAutomationPersistence.ScheduleAsync(compact, locationId, t);
            if (nativeInvoices is not null && schedule is not null)
                nativeSchedules.Add(locationId, (schedule, schedule.Version));
            return schedule;
        }
        return await db.Set<BillingSchedule>().SingleOrDefaultAsync(s => s.LocationId == locationId, t);
    }
    public Task<BillingSchedule?> ScheduleForPeriodAsync(Guid locationId, DateOnly period, CancellationToken t) =>
        BillingAutomationSchedules.ResolveCalendarAsync(db, locationId, period, t);
    public async Task<IReadOnlyList<Guid>> TenantBillingLocationIdsAsync(Guid tenantId, CancellationToken t)
    {
        if (db is Compact24DbContext compact)
        {
            return await (from c in compact.Set<BHome.Domain.TenantContracts.Contract>().AsNoTracking()
                          join r in compact.Set<BHome.Domain.PropertyManagement.Room>().AsNoTracking() on c.RoomId equals r.Id
                          join l in compact.Set<BHome.Domain.Locations.Location>().AsNoTracking() on r.LocationId equals l.Id
                          where c.TenantUserId == tenantId && c.Status == ContractStatus.Active &&
                              (c.Kind == BHome.Domain.TenantContracts.ContractKind.Main || c.Kind == BHome.Domain.TenantContracts.ContractKind.Renewal) && c.ActivatedAt != null && l.IsActive
                          select r.LocationId).Distinct().ToArrayAsync(t);
        }
        return await db.Set<Contract>().AsNoTracking().Where(c => c.TenantUserId == tenantId && c.Status == ContractStatus.Active &&
            (c.Kind == ContractKind.Main || c.Kind == ContractKind.Renewal) && c.ActivatedAt != null && c.Room.Location.IsActive)
            .Select(c => c.Room.LocationId).Distinct().ToArrayAsync(t);
    }
    public async Task<Room?> RoomAsync(Guid roomId, CancellationToken t)
    {
        if (db is Compact24DbContext compact)
        {
            var pair = await (from room in compact.Set<BHome.Domain.PropertyManagement.Room>().AsNoTracking()
                              join location in compact.Set<BHome.Domain.Locations.Location>().AsNoTracking() on room.LocationId equals location.Id
                              where room.Id == roomId
                              select new { room, location }).SingleOrDefaultAsync(t);
            if (pair is null) return null;
            var result = NativeRoomLocationPersistence.Read(pair.room);
            result.Location = NativeRoomLocationPersistence.Read(pair.location);
            return result;
        }
        return await db.Set<Room>().Include(r => r.Location).SingleOrDefaultAsync(r => r.Id == roomId, t);
    }
    public async Task<T> WithRoomLockAsync<T>(Guid roomId, Func<Task<T>> action, CancellationToken t)
    {
        var locationId = await RoomLocationAsync(roomId, t)
            ?? throw new InvoiceException(404, "room_not_found");
        return await WithLocationLockAsync(locationId, async () =>
        {
            if (db is Compact24DbContext compact)
                await compact.Set<BHome.Domain.PropertyManagement.Room>().FromSqlInterpolated($"SELECT * FROM rooms WHERE id={roomId} FOR UPDATE").AsNoTracking().SingleAsync(t);
            else await db.Locked<Room>(roomId).SingleAsync(t);
            return await action();
        }, t);
    }
    private async Task<Guid?> RoomLocationAsync(Guid roomId, CancellationToken t)
    {
        if (db is Compact24DbContext compact)
        {
            return await compact.Set<BHome.Domain.PropertyManagement.Room>().AsNoTracking().Where(r => r.Id == roomId).Select(r => (Guid?)r.LocationId).SingleOrDefaultAsync(t);
        }
        return await db.Set<Room>().AsNoTracking().Where(r => r.Id == roomId).Select(r => (Guid?)r.LocationId).SingleOrDefaultAsync(t);
    }
    public async Task<T> WithLocationLockAsync<T>(Guid locationId, Func<Task<T>> action, CancellationToken t)
    {
        db.ChangeTracker.Clear();
        await using var transaction = await db.Database.BeginTransactionAsync(t);
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({locationId.ToString()}, 0))", t);
        if (!await LocationExistsAsync(locationId, t)) throw new InvoiceException(404, "billing_location_not_found");
        try
        {
            if (db is Compact24DbContext) nativeInvoices = [];
            var result = await action();
            if (db is Compact24DbContext compact)
            {
                foreach (var (schedule, originalVersion) in nativeSchedules.Values)
                    if (originalVersion != schedule.Version)
                        await NativeBillingAutomationPersistence.SaveScheduleAsync(compact, schedule, originalVersion, t);
                foreach (var (invoice, originalVersion) in nativeInvoices!.Values)
                    if (originalVersion is null || invoice.Version != originalVersion)
                        await NativeInvoicePersistence.SaveAsync(compact, invoice, originalVersion,
                            originalVersion is not null && invoice.Status == InvoiceStatus.Draft, t);
                foreach (var issued in nativeIssued)
                    await NativeInvoicePersistence.WriteIssuedAsync(compact, issued, t);
                foreach (var audit in nativeAudits)
                    await NativeAdjustmentPersistence.WriteAuditAsync(compact, audit, t);
            }
            await db.SaveChangesAsync(t); await transaction.CommitAsync(t); return result;
        }
        catch (DbUpdateConcurrencyException) { throw new InvoiceException(409, "invoice_concurrent_change"); }
        catch (DbUpdateException e) when (e.InnerException is PostgresException { SqlState: "23505" or "23514" or "23P01" })
        { throw new InvoiceException(409, "invoice_concurrent_or_invalid_state"); }
        catch (PostgresException e) when (e.SqlState is "23505" or "23514" or "23P01")
        { throw new InvoiceException(409, "invoice_concurrent_or_invalid_state"); }
        finally { nativeInvoices = null; nativeSchedules.Clear(); nativeIssued.Clear(); nativeAudits.Clear(); }
    }
    private async Task<bool> LocationExistsAsync(Guid locationId, CancellationToken t)
    {
        if (db is Compact24DbContext compact)
        {
            return await compact.Set<BHome.Domain.Locations.Location>().AsNoTracking().AnyAsync(l => l.Id == locationId, t);
        }
        return await db.Locations.AnyAsync(l => l.Id == locationId, t);
    }
    private IQueryable<Invoice> Visible(InvoiceScope scope) => db.Set<Invoice>().Where(i => scope.Owner || scope.Tenant && i.Recipients.Any(r => r.TenantUserId == scope.Actor));
    private static IQueryable<Invoice> Detail(IQueryable<Invoice> source) => source.Include(i => i.Lines).Include(i => i.Recipients).AsSplitQuery();
    private Invoice? TrackNative(Invoice? invoice)
    {
        if (invoice is null || nativeInvoices is null) return invoice;
        if (nativeInvoices.TryGetValue(invoice.Id, out var existing)) return existing.Invoice;
        nativeInvoices.Add(invoice.Id, (invoice, invoice.Version));
        return invoice;
    }
    public async Task<Invoice?> FindAsync(Guid id, InvoiceScope scope, CancellationToken t)
    {
        if (db is Compact24DbContext compact)
            return TrackNative((await NativeInvoicePersistence.ReadAsync(compact,
                NativeInvoicePersistence.Visible(compact, scope).Where(i => i.Id == id), t)).SingleOrDefault());
        return await Detail(Visible(scope)).SingleOrDefaultAsync(i => i.Id == id, t);
    }
    public async Task<Invoice?> ForPeriodAsync(Guid roomId, DateOnly period, CancellationToken t)
    {
        if (db is Compact24DbContext compact)
            return TrackNative((await NativeInvoicePersistence.ReadAsync(compact, compact.Set<BHome.Domain.Billing.Invoice>().AsNoTracking()
                .Where(i => i.InvoiceType == "PERIODIC" && i.RoomId == roomId && i.BillingPeriod == period), t)).SingleOrDefault());
        var invoices = db.PeriodicInvoices().Where(i => i.RoomId == roomId && i.BillingPeriod == period);
        return await Detail(invoices).SingleOrDefaultAsync(t);
    }
    public async Task<PagedResult<Invoice>> ListAsync(InvoiceScope scope, int page, int pageSize, Guid? roomId, CancellationToken t, InvoiceListFilter? filter = null)
    {
        if (db is Compact24DbContext compact)
        {
            var rows = NativeInvoicePersistence.Visible(compact, scope).Where(i => roomId == null || i.RoomId == roomId);
            if (filter?.LocationId is { } nativeLocation) rows = rows.Where(i => i.LocationId == nativeLocation);
            if (filter?.BillingPeriod is { } nativePeriod) rows = rows.Where(i => i.BillingPeriod == nativePeriod);
            if (filter?.Status is { } nativeStatus) rows = rows.Where(i => i.Status == nativeStatus);
            var total = await rows.CountAsync(t);
            var result = await NativeInvoicePersistence.ReadAsync(compact, rows.OrderByDescending(i => i.BillingPeriod)
                .ThenBy(i => i.Id).Skip((page - 1) * pageSize).Take(pageSize), t);
            return new(result, page, pageSize, total);
        }
        var source = Visible(scope).AsNoTracking().Where(i => roomId == null || i.RoomId == roomId);
        if (filter?.LocationId is { } locationId) source = source.Where(i => i.LocationId == locationId);
        if (filter?.BillingPeriod is { } period) source = source.Where(i => i.BillingPeriod == period);
        if (filter?.Status is { } status) source = source.Where(i => i.Status == status);
        var count = await source.CountAsync(t);
        var items = await Detail(source.OrderByDescending(i => i.BillingPeriod).ThenBy(i => i.Id).Skip((page - 1) * pageSize).Take(pageSize)).ToArrayAsync(t);
        return new(items, page, pageSize, count);
    }
    public async Task<IReadOnlyList<BillingOccupancy>> OccupanciesAsync(Guid roomId, DateOnly from, DateOnly to, CancellationToken t)
    {
        Contract[] contracts;
        if (db is Compact24DbContext compact)
        {
            var rows = await compact.Set<BHome.Domain.TenantContracts.Contract>().AsNoTracking().Where(c => c.RoomId == roomId &&
                (c.Kind == BHome.Domain.TenantContracts.ContractKind.Main || c.Kind == BHome.Domain.TenantContracts.ContractKind.Renewal) &&
                (c.Status == ContractStatus.Active || c.Status == ContractStatus.Terminated ||
                    c.Status == ContractStatus.Superseded || c.Status == ContractStatus.Expired) &&
                c.ActivatedAt != null && c.StartDate <= to && (c.ActualEndDate ?? c.EndDate) >= from).Take(501).ToArrayAsync(t);
            if (rows.Length > 500) throw new InvoiceException(409, "billing_occupancy_review_required");
            var ids = rows.Select(r => r.Id).ToArray();
            var residents = (await compact.Set<BHome.Domain.TenantContracts.ContractResident>().AsNoTracking().Where(r => ids.Contains(r.ContractId))
                .ToArrayAsync(t)).ToLookup(r => r.ContractId);
            contracts = rows.Select(r =>
            {
                var contract = NativeContractSnapshot.Read(r);
                contract.Residents = residents[r.Id].ToList();
                return contract;
            }).ToArray();
        }
        else contracts = await db.Set<Contract>().AsNoTracking().Include(c => c.Residents).Where(c => c.RoomId == roomId &&
            (c.Kind == ContractKind.Main || c.Kind == ContractKind.Renewal) &&
            (c.Status == ContractStatus.Active || c.Status == ContractStatus.Terminated || c.Status == ContractStatus.Superseded || c.Status == ContractStatus.Expired) &&
            c.ActivatedAt != null && c.StartDate <= to && (c.ActualEndDate ?? c.EndDate) >= from).Take(501).ToArrayAsync(t);
        if (contracts.Length > 500) throw new InvoiceException(409, "billing_occupancy_review_required");
        var residentIds = contracts.SelectMany(c => c.Residents.Where(r => r.ResidenceFrom <= to && (r.ResidenceTo == null || r.ResidenceTo >= from)).Select(r => r.ResidentId)).Distinct().ToArray();
        var links = db is Compact24DbContext native
            ? await native.Set<BHome.Domain.TenantContracts.Resident>().AsNoTracking().Where(r => residentIds.Contains(r.Id) && r.TenantUserId != null)
                .ToDictionaryAsync(r => r.Id, r => r.TenantUserId!.Value, t)
            : await db.Set<Resident>().AsNoTracking().Where(r => residentIds.Contains(r.Id) && r.TenantUserId != null).ToDictionaryAsync(r => r.Id, r => r.TenantUserId!.Value, t);
        var linkedUsers = links.Values.Concat(contracts.Where(c => c.TenantUserId != null).Select(c => c.TenantUserId!.Value)).Distinct().ToArray();
        var emails = await db.Users.AsNoTracking().Where(u => linkedUsers.Contains(u.Id)).Select(u => new { u.Id, u.Email }).ToArrayAsync(t);
        var validEmails = emails.Where(u => !string.IsNullOrWhiteSpace(u.Email) && new System.ComponentModel.DataAnnotations.EmailAddressAttribute().IsValid(u.Email)).Select(u => u.Id).ToHashSet();
        return contracts.Select(c => new BillingOccupancy(c, c.Residents.Where(r => r.ResidenceFrom <= to && (r.ResidenceTo == null || r.ResidenceTo >= from) && links.ContainsKey(r.ResidentId))
            .Select(r => links[r.ResidentId]).Append(c.TenantUserId ?? throw new InvoiceException(409, "active_tenant_account_required")).Distinct().ToArray(), c.Residents.Where(r => r.ResidenceFrom <= to && (r.ResidenceTo == null || r.ResidenceTo >= from))
                .Where(r => r.Role == ResidentType.Representative)
                .All(r => links.TryGetValue(r.ResidentId, out var user) && validEmails.Contains(user)) && c.TenantUserId is { } representative && validEmails.Contains(representative))).ToArray();
    }
    public async Task<BillingReading?> ReadingAsync(Guid roomId, UtilityType type, DateOnly period, CancellationToken t)
    {
        if (db is Compact24DbContext compact)
        {
            var rows = await (from reading in NativeBillingMeterQueries.Confirmed(compact)
                              join task in compact.Set<BHome.Domain.Billing.OperationalTask>().AsNoTracking() on reading.OperationalTaskId equals task.Id
                              join meter in compact.Set<BHome.Domain.Billing.Meter>().AsNoTracking() on reading.MeterId equals meter.Id
                              where meter.RoomId == roomId && meter.UtilityType == type &&
                                reading.ReadingPurpose == ReadingPurpose.Periodic && task.BillingPeriod == period
                              select new { reading, task }).Take(2).ToArrayAsync(t);
            if (rows.Length != 1) return null;
            var nativeValue = NativeBillingMeterQueries.Read(rows[0].reading, rows[0].task);
            var target = new BHome.Application.Contracts.BillableMeterPoint(nativeValue.Reading.Id, nativeValue.Evidence.Id, nativeValue.Task.ReadingDate,
                nativeValue.Reading.ConfirmedValue, nativeValue.Evidence.ImageHash, nativeValue.Evidence.Length, "ConfirmedPeriodic", nativeValue.Reading.Id);
            var position = await MeterBillingCoverage.ReadAsync(db, roomId, nativeValue.Reading.MeterId, period, target, nativeValue.Reading.ConfirmedAt, t);
            var snapshot = System.Text.Json.JsonSerializer.Serialize(new
            {
                kind = "MeterBillingCoverage/v1",
                position.Baseline,
                target,
                position.AlreadyBilledQuantity,
                position.FullyCovered
            });
            return new(nativeValue.Reading, nativeValue.Task.ReadingDate, position.Baseline?.Value,
                position.Baseline is null ? null : nativeValue.Reading.ConfirmedValue - position.Baseline.Value,
                position.AlreadyBilledQuantity, position.PreviousPricingSnapshot, position.FullyCovered, snapshot, position.MissingInputs);
        }
        var row = await (from reading in db.Set<MeterReading>().AsNoTracking()
                         join task in db.Set<OperationalTask>() on reading.TaskId equals task.Id
                         join meter in db.Set<Meter>() on reading.MeterId equals meter.Id
                         join evidence in db.Set<MeterEvidence>() on reading.EvidenceId equals evidence.Id
                         where meter.RoomId == roomId && meter.UtilityType == type && task.Purpose == ReadingPurpose.Periodic &&
                             task.BillingPeriod == period && task.MeterStatus == MeterTaskStatus.Completed && evidence.IsLinked && evidence.IsUploaded
                         select new BillingReading(reading, task.ReadingDate, null, null, 0, null, false, null, null)).ToArrayAsync(t);
        // Replaced meters/multiple readings require an approved replacement allocation; never guess.
        if (row.Length != 1) return null;
        var value = row[0];
        // Offline source-schema regressions retain their original projection; the
        // runtime composition always uses Compact24 and the financial baseline above.
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
        if (db is Compact24DbContext compact)
        {
            var unused = await compact.Set<BHome.Domain.PropertyManagement.BillingPolicy>().AsNoTracking()
                .Where(p => ids.Contains(p.Id) && p.FirstUsedAt == null).ToArrayAsync(t);
            foreach (var row in unused)
            {
                var policy = NativePolicyPersistence.Read(row);
                policy.RecordUsage(at);
                await NativePolicyPersistence.StageAsync(compact, policy, row.Version, DateTimeOffset.UtcNow, t);
            }
            if (unused.Length > 0) await compact.SaveChangesAsync(t);
            return;
        }
        foreach (var policy in await db.Set<BillingPolicy>().Where(p => ids.Contains(p.Id)).ToArrayAsync(t)) policy.RecordUsage(at);
    }
    public void Add(object entity)
    {
        if (nativeInvoices is not null)
        {
            if (entity is Invoice invoice) { nativeInvoices.Add(invoice.Id, (invoice, null)); return; }
            if (entity is BillingSchedule schedule) { nativeSchedules.Add(schedule.LocationId, (schedule, null)); return; }
            if (entity is InvoiceIssuedEvent issued) { nativeIssued.Add(issued); return; }
            // Lines are persisted as the complete draft calculation from the aggregate.
            if (entity is InvoiceItem) return;
        }
        db.Add(entity);
    }
    public Task<bool> HasPendingAdjustmentsAsync(Guid invoiceId, CancellationToken t) =>
        db is Compact24DbContext compact
            ? compact.Set<InvoiceAdjustment>().AsNoTracking().AnyAsync(r => r.InvoiceId == invoiceId && r.DecisionSnapshot == null, t)
            : db.Set<InvoiceAdjustment>().AnyAsync(r => r.InvoiceId == invoiceId && r.Decision == null, t);
    public async Task<IReadOnlyList<InvoiceAdjustmentDecision>> DraftCorrectionsAsync(Guid invoiceId, CancellationToken t)
    {
        if (db is Compact24DbContext compact)
        {
            var rows = await compact.Set<InvoiceAdjustment>().FromSqlInterpolated($"""
                SELECT * FROM invoice_adjustments WHERE invoice_id={invoiceId} AND decision_snapshot->>'outcome'='Approved'
                    AND COALESCE((decision_snapshot->>'invoiceStatus')::integer,0)=0
                """).AsNoTracking().ToArrayAsync(t);
            return rows.Select(r => NativeAdjustmentPersistence.ReadDecision(r)!).ToArray();
        }
        return await db.Set<InvoiceAdjustmentDecision>().AsNoTracking().Where(d => d.InvoiceId == invoiceId && d.Outcome == "Approved" && d.InvoiceStatus == InvoiceStatus.Draft).ToArrayAsync(t);
    }
    public void Audit(Guid actor, string action, Guid invoiceId, DateTimeOffset at)
    {
        var audit = new SecurityAuditRecord
        { UserId = actor, Event = action, TargetType = "Billing", TargetId = invoiceId, Succeeded = true, OccurredAt = at };
        if (nativeInvoices is not null) nativeAudits.Add(audit);
        else db.SecurityAudit.Add(audit);
    }
    public void RemoveLines(Invoice invoice)
    {
        if (nativeInvoices is null) db.RemoveRange(invoice.Lines);
        invoice.Lines.Clear();
    }
}
