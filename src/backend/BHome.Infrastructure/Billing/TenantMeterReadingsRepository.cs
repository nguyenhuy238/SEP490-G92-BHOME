using BHome.Application.Billing;
using BHome.Domain.Billing;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Billing;

internal sealed class TenantMeterReadingsRepository(BHomePersistenceContext db) : ITenantMeterReadings
{
    private sealed class ReadingRow
    {
        public MeterReading Reading { get; init; } = null!;
        public OperationalTask Task { get; init; } = null!;
        public Meter Meter { get; init; } = null!;
        public Room Room { get; init; } = null!;
        public MeterEvidence Evidence { get; init; } = null!;
    }
    private IQueryable<ReadingRow> Visible(Guid actor) =>
        from reading in db.Set<MeterReading>().AsNoTracking()
        join task in db.Set<OperationalTask>() on reading.TaskId equals task.Id
        join meter in db.Set<Meter>() on reading.MeterId equals meter.Id
        join room in db.Set<Room>() on meter.RoomId equals room.Id
        join evidence in db.Set<MeterEvidence>() on reading.EvidenceId equals evidence.Id
        let periodFrom = task.BillingPeriod ?? task.ReadingDate
        let periodTo = task.BillingPeriod.HasValue ? periodFrom.AddMonths(1).AddDays(-1) : task.ReadingDate
        where task.Status == MeterTaskStatus.Completed && reading.ConfirmedAt != default &&
            (reading.Status == MeterReadingStatus.Confirmed || reading.Status == MeterReadingStatus.Corrected) &&
            evidence.IsUploaded && evidence.IsLinked && evidence.TaskId == task.Id && task.MeterId == meter.Id &&
            (db.Set<Contract>().Any(c => c.RoomId == room.Id && c.Kind != ContractKind.Holding && c.ActivatedAt != null &&
                (c.Status == ContractStatus.Active || c.Status == ContractStatus.Terminated || c.Status == ContractStatus.Superseded) &&
                c.StartDate <= periodTo && (c.ActualEndDate ?? c.EndDate) >= periodFrom &&
                c.Residents.Any(cr => cr.ResidenceFrom <= periodTo && (cr.ResidenceTo == null || cr.ResidenceTo >= periodFrom) &&
                    db.Set<Resident>().Any(r => r.Id == cr.ResidentId && r.TenantUserId == actor))) ||
            db.Set<InvoiceLine>().Any(line => line.MeterReadingId == reading.Id &&
                db.Set<InvoiceRecipient>().Any(recipient => recipient.InvoiceId == line.InvoiceId && recipient.TenantUserId == actor)))
        select new ReadingRow { Reading = reading, Task = task, Meter = meter, Room = room, Evidence = evidence };
    public async Task<TenantMeterReadingPage> ListAsync(Guid actor, int page, int size, Guid? room, DateOnly? period, CancellationToken t)
    {
        var query = Visible(actor);
        if (room is { } roomId) query = query.Where(r => r.Room.Id == roomId);
        if (period is { } billingPeriod) query = query.Where(r => r.Task.BillingPeriod == billingPeriod);
        var total = await query.CountAsync(t);
        var items = await query.OrderByDescending(r => r.Task.ReadingDate).ThenByDescending(r => r.Reading.ConfirmedAt).ThenBy(r => r.Reading.Id)
            .Skip((page - 1) * size).Take(size).Select(r => new TenantMeterReading(r.Reading.Id, r.Room.Id, r.Room.RoomNumber, r.Room.Location.Name,
                r.Meter.Code, r.Meter.UtilityType.ToString(), r.Task.Purpose.ToString(), r.Task.ReadingDate, r.Task.BillingPeriod,
                r.Reading.PreviousValue, r.Reading.ConfirmedValue, r.Reading.Consumption, r.Reading.ConfirmedAt, r.Reading.Status.ToString())).ToArrayAsync(t);
        return new(items, page, size, total);
    }
    public Task<bool> CanViewAsync(Guid actor, Guid id, CancellationToken t) => Visible(actor).AnyAsync(r => r.Reading.Id == id, t);
    public Task<TenantReadingEvidence?> EvidenceAsync(Guid actor, Guid id, CancellationToken t) => Visible(actor).Where(r => r.Reading.Id == id)
        .Select(r => new TenantReadingEvidence(r.Evidence.ObjectKey, r.Evidence.ContentType)).SingleOrDefaultAsync(t);
}
