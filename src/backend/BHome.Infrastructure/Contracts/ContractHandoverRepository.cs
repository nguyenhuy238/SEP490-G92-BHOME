using BHome.Application.Contracts;
using BHome.Domain.Billing;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;
namespace BHome.Infrastructure.Contracts;

internal sealed class ContractHandoverRepository(BHomeDbContext db) : IContractHandoverRepository
{
    public Task<ContractHandover?> GetAsync(Guid id, CancellationToken t) => db.Set<ContractHandover>().SingleOrDefaultAsync(h => h.ContractId == id, t);
    public async Task<IReadOnlyList<Asset>> AssetsAsync(Guid roomId, CancellationToken t)
    {
        var assets = await db.Set<Asset>().AsNoTracking().Where(a => a.RoomId == roomId && a.Status != AssetStatus.Retired).OrderBy(a => a.Name).Take(201).ToArrayAsync(t);
        if (assets.Length > 200) throw new ContractException(503, "handover_inventory_limit");
        return assets;
    }
    public async Task<IReadOnlyList<HandoverReading>> ReadingsAsync(Guid roomId, DateOnly startDate, CancellationToken t) => await (
        from r in db.Set<MeterReading>().AsNoTracking()
        join task in db.Set<OperationalTask>() on r.TaskId equals task.Id
        join meter in db.Set<Meter>() on r.MeterId equals meter.Id
        join evidence in db.Set<MeterEvidence>() on r.EvidenceId equals evidence.Id
        where meter.RoomId == roomId && meter.IsActive && task.ReadingDate >= startDate && task.Status == MeterTaskStatus.Completed &&
            (task.Purpose == ReadingPurpose.Initial || task.Purpose == ReadingPurpose.Periodic) && evidence.IsUploaded && evidence.IsLinked
        orderby task.ReadingDate descending
        select new HandoverReading(r.Id, meter.Code, (int)meter.UtilityType, task.ReadingDate, r.ConfirmedValue, evidence.Id, evidence.ObjectKey, evidence.ImageHash))
        .Take(100).ToArrayAsync(t);
    public async Task<IReadOnlyList<ContractHandoverHistory>> HistoryAsync(Guid id, CancellationToken t) => await db.Set<ContractHandoverHistory>().AsNoTracking().Where(h => h.ContractId == id).OrderByDescending(h => h.OccurredAt).Take(100).ToArrayAsync(t);
    public Task<HandoverReading?> ReadingAsync(Guid roomId, Guid readingId, CancellationToken t) => (
        from reading in db.Set<MeterReading>().AsNoTracking()
        join task in db.Set<OperationalTask>() on reading.TaskId equals task.Id
        join meter in db.Set<Meter>() on reading.MeterId equals meter.Id
        join evidence in db.Set<MeterEvidence>() on reading.EvidenceId equals evidence.Id
        where reading.Id == readingId && meter.RoomId == roomId && evidence.IsUploaded && evidence.IsLinked
        select new HandoverReading(reading.Id, meter.Code, (int)meter.UtilityType, task.ReadingDate, reading.ConfirmedValue, evidence.Id, evidence.ObjectKey, evidence.ImageHash)).SingleOrDefaultAsync(t);
    public Task<bool> HistoryContainsEvidenceAsync(Guid id, Guid fileId, CancellationToken t)
    {
        var fragment = JsonSerializer.Serialize(new { EvidenceIds = new[] { fileId } });
        return db.Set<ContractHandoverHistory>().AnyAsync(h => h.ContractId == id && EF.Functions.JsonContains(h.Snapshot, fragment), t);
    }
    public Task<string?> HistoryForReadingAsync(Guid id, Guid readingId, CancellationToken t) => db.Set<ContractHandoverHistory>().AsNoTracking()
        .Where(h => h.ContractId == id && (h.ElectricityReadingId == readingId || h.WaterReadingId == readingId)).OrderByDescending(h => h.OccurredAt).Select(h => h.Snapshot).FirstOrDefaultAsync(t);
}
