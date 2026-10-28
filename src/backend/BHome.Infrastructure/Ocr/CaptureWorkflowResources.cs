using System.Globalization;
using BHome.Application.IdentityAccess;
using BHome.Application.Ocr;
using BHome.Domain.Billing;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Ocr;

internal sealed class CaptureWorkflowResources(BHomeDbContext db, CaptureScope scope) : IOcrWorkflowResources
{
    public async Task<OcrWorkflowResource?> FindIdentityAsync(Guid id, CancellationToken token)
    {
        try
        {
            return await db.Set<Resident>().Where(r => r.Id == id && scope.VisibleRooms.Any(room => room.Id == r.RoomId))
            .Select(r => new OcrWorkflowResource(new ResourceScope(r.OwnerUserId, r.Room.LocationId, null),
                r.VerificationStatus == IdentityVerificationStatus.Pending, OcrDocumentKind.IdentityFront)).SingleOrDefaultAsync(token);
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
            return await scope.VisibleTasks.Where(t => t.Id == id).Select(t => new OcrWorkflowResource(
            new ResourceScope(t.Meter.Room.Location.Chain.OwnerUserId, t.Meter.Room.LocationId, null),
            t.Meter.IsActive && (t.Status == MeterTaskStatus.Assigned || t.Status == MeterTaskStatus.InProgress),
            t.Meter.UtilityType == UtilityType.Water ? (t.Meter.Display == MeterDisplay.Mechanical ? OcrDocumentKind.MechanicalWater : OcrDocumentKind.DigitalWater)
                : (t.Meter.Display == MeterDisplay.Mechanical ? OcrDocumentKind.MechanicalElectricity : OcrDocumentKind.DigitalElectricity))).SingleOrDefaultAsync(token);
        }
        catch (Npgsql.NpgsqlException) { throw new BHome.Application.Common.IntegrationUnavailableException("OCR resource lookup"); }
        catch (InvalidOperationException ex) when (ex.InnerException is Npgsql.NpgsqlException)
        { throw new BHome.Application.Common.IntegrationUnavailableException("OCR resource lookup"); }
    }
    public async Task RecordMeterProposalAsync(Guid id, OcrProposal proposal, CancellationToken token)
    {
        decimal? value = proposal.ProposedFields.TryGetValue("reading", out var text) && decimal.TryParse(text, NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var number) ? number : null;
        await scope.VisibleTasks.Where(t => t.Id == id && t.Status != MeterTaskStatus.Completed && t.Status != MeterTaskStatus.Cancelled)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.OcrProposedValue, value).SetProperty(t => t.OcrImageHash, proposal.SourceImageHash)
                .SetProperty(t => t.OcrEngineVersion, proposal.EngineVersion), token);
    }
}
