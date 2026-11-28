using System.Globalization;
using BHome.Application.IdentityAccess;
using BHome.Application.Ocr;
using BHome.Domain.Billing;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Native = BHome.Domain.Entities;

namespace BHome.Infrastructure.Ocr;

internal sealed class CaptureWorkflowResources(BHomePersistenceContext db, CaptureScope scope) : IOcrWorkflowResources
{
    public async Task<OcrWorkflowResource?> FindIdentityAsync(Guid id, CancellationToken token)
    {
        try
        {
            if (db is Compact24DbContext compact)
                return await (from r in compact.Set<BHome.Domain.TenantContracts.Resident>()
                              join room in scope.NativeRooms on r.CurrentRoomId equals (Guid?)room.Id
                              where r.Id == id
                              select new OcrWorkflowResource(new ResourceScope(room.LocationId, null),
                                  r.VerificationStatus == IdentityVerificationStatus.Pending, OcrDocumentKind.IdentityFront, null, null)).SingleOrDefaultAsync(token);
            return await db.Set<Resident>().Where(r => r.Id == id && scope.VisibleRooms.Any(room => room.Id == r.RoomId))
            .Select(r => new OcrWorkflowResource(new ResourceScope(r.Room.LocationId, null),
                r.VerificationStatus == IdentityVerificationStatus.Pending, OcrDocumentKind.IdentityFront, null, null)).SingleOrDefaultAsync(token);
        }
        catch (Npgsql.NpgsqlException) { throw new BHome.Application.Common.IntegrationUnavailableException("OCR resource lookup"); }
        // EF Core wraps transient connection failures when retry-on-failure is disabled.
        catch (InvalidOperationException ex) when (ex.InnerException is Npgsql.NpgsqlException)
        { throw new BHome.Application.Common.IntegrationUnavailableException("OCR resource lookup"); }
    }
    public async Task<OcrWorkflowResource?> FindMeterTaskAsync(Guid id, CancellationToken token)
    {
        try
        {
            if (db is Compact24DbContext compact)
            {
                var current = await scope.ReadTaskAsync(id, token);
                if (current is null) return null;
                var device = await scope.MeterAsync(current.MeterId, token);
                var kind = (device.UtilityType, device.Display) switch
                {
                    (UtilityType.Water, MeterDisplay.Mechanical) => OcrDocumentKind.MechanicalWater,
                    (UtilityType.Water, MeterDisplay.Digital) => OcrDocumentKind.DigitalWater,
                    (UtilityType.Electricity, MeterDisplay.Mechanical) => OcrDocumentKind.MechanicalElectricity,
                    (UtilityType.Electricity, MeterDisplay.Digital) => OcrDocumentKind.DigitalElectricity,
                    _ => (OcrDocumentKind?)null
                };
                var latest = await compact.Set<BHome.Domain.Billing.MeterReading>().Where(r => r.MeterId == device.Id).OrderByDescending(r => r.ConfirmedAt)
                    .ThenBy(r => r.Id).Select(r => (decimal?)r.ConfirmedValue).FirstOrDefaultAsync(token);
                var result = new OcrWorkflowResource(new ResourceScope(current.RequiredLocationId, null),
                    device.IsActive && current.MeterStatus is MeterTaskStatus.Assigned or MeterTaskStatus.InProgress,
                    kind, device.DecimalPlaces, latest);
                if (current.MeterStatus != MeterTaskStatus.Completed) return result;
                var confirmed = await scope.TaskReadingAsync(id, token);
                return confirmed is not null && await scope.CanCorrectAsync(current, device, confirmed, token)
                    ? result with { CanCapture = true, PreviousConfirmedValue = confirmed.PreviousValue } : result;
            }
            var resource = await scope.VisibleTasks.Where(t => t.Id == id).Select(t => new OcrWorkflowResource(
            new ResourceScope(t.Meter.Room.LocationId, null),
            t.Meter.IsActive && (t.MeterStatus == MeterTaskStatus.Assigned || t.MeterStatus == MeterTaskStatus.InProgress),
            t.Meter.UtilityType == UtilityType.Water && t.Meter.Display == MeterDisplay.Mechanical ? OcrDocumentKind.MechanicalWater :
                t.Meter.UtilityType == UtilityType.Water && t.Meter.Display == MeterDisplay.Digital ? OcrDocumentKind.DigitalWater :
                t.Meter.UtilityType == UtilityType.Electricity && t.Meter.Display == MeterDisplay.Mechanical ? OcrDocumentKind.MechanicalElectricity :
                t.Meter.UtilityType == UtilityType.Electricity && t.Meter.Display == MeterDisplay.Digital ? OcrDocumentKind.DigitalElectricity : (OcrDocumentKind?)null,
            t.Meter.DecimalPlaces,
            db.Set<MeterReading>().Where(reading => reading.MeterId == t.MeterId)
                .OrderByDescending(reading => reading.ConfirmedAt).ThenBy(reading => reading.Id)
                .Select(reading => (decimal?)reading.ConfirmedValue).FirstOrDefault())).SingleOrDefaultAsync(token);
            if (resource is null) return null;
            var task = await scope.VisibleTasks.AsNoTracking().SingleAsync(t => t.Id == id, token);
            if (task.MeterStatus != MeterTaskStatus.Completed) return resource;
            var meter = await db.Set<Meter>().AsNoTracking().SingleAsync(m => m.Id == task.MeterId, token);
            var reading = await db.Set<MeterReading>().AsNoTracking().SingleOrDefaultAsync(r => r.TaskId == id, token);
            return reading is not null && await scope.CanCorrectAsync(task, meter, reading, token)
                ? resource with { CanCapture = true, PreviousConfirmedValue = reading.PreviousValue }
                : resource;
        }
        catch (Npgsql.NpgsqlException) { throw new BHome.Application.Common.IntegrationUnavailableException("OCR resource lookup"); }
        catch (InvalidOperationException ex) when (ex.InnerException is Npgsql.NpgsqlException)
        { throw new BHome.Application.Common.IntegrationUnavailableException("OCR resource lookup"); }
    }
    public async Task RecordMeterProposalAsync(Guid id, OcrProposal proposal, CancellationToken token)
    {
        decimal? value = proposal.ProposedFields.TryGetValue("reading", out var text) && decimal.TryParse(text, NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var number) ? number : null;
        await using var transaction = await db.Database.BeginTransactionAsync(token);
        var locationId = await scope.TaskLocationAsync(id, token);
        if (locationId is null) return;
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({locationId.Value.ToString()}, 0))", token);
        var task = await scope.LockTaskAsync(id, token);
        if (task is not null && await scope.TaskLocationAsync(id, token) is not null && task.MeterStatus is not (MeterTaskStatus.Completed or MeterTaskStatus.Cancelled))
        {
            task.OcrProposedValue = value; task.OcrImageHash = proposal.SourceImageHash; task.OcrEngineVersion = proposal.EngineVersion;
            if (db is Compact24DbContext compact) await NativeCaptureWrites.TaskAsync(compact, task, false, task.Version, token);
            else await db.SaveChangesAsync(token);
        }
        await transaction.CommitAsync(token);
    }
}
