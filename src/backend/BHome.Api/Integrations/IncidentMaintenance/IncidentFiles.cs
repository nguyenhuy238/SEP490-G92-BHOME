using BHome.Application.IncidentMaintenance;
using BHome.Application.Ocr;
using BHome.Application.Storage;
using BHome.Domain.IncidentMaintenance;
using BHome.Infrastructure.Ocr;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using OpenCvSharp;

namespace BHome.Infrastructure.Modules.IncidentMaintenance;

internal sealed class IncidentFiles(BHomePersistenceContext context, IObjectStorage storage, TimeProvider clock) : IIncidentFiles
{
    public string Validate(byte[] content)
    {
        if (content.Length > IncidentService.MaximumImageBytes) throw new IncidentException(413, "incident_image_too_large");
        try
        {
            ImagePreprocessor.ValidateHeader(content, IncidentService.MaximumImageBytes, 12_000_000);
            using var image = Cv2.ImDecode(content, ImreadModes.Color);
            if (image.Empty()) throw IncidentException.Invalid("invalid_incident_image");
            return content[0] == 137 ? "image/png" : "image/jpeg";
        }
        catch (OcrInputException) { throw IncidentException.Invalid("invalid_incident_image"); }
        catch (OpenCVException) { throw IncidentException.Invalid("invalid_incident_image"); }
    }
    public async Task PutAsync(Guid locationId, string key, byte[] content, string contentType, CancellationToken t)
    {
        await using var staging = context.CreateIndependentContext();
        staging.Add(new IncidentFileUpload { LocationId = locationId, ObjectKey = key, CleanupAfter = clock.GetUtcNow().AddHours(1) });
        await staging.SaveChangesAsync(t);
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(t); deadline.CancelAfter(TimeSpan.FromSeconds(30));
        using var stream = new MemoryStream(content, false);
        await storage.PutAsync(key, stream, content.Length, contentType, deadline.Token);
    }
    public async Task CopyAsync(string key, Stream output, CancellationToken t)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(t); deadline.CancelAfter(TimeSpan.FromSeconds(30));
        await storage.CopyToAsync(key, output, deadline.Token);
    }
}

public sealed class IncidentFileCleanup(IServiceScopeFactory scopes, TimeProvider clock, ILogger<IncidentFileCleanup> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(5));
        try
        {
            while (await timer.WaitForNextTickAsync(stoppingToken))
            {
                try
                {
                    await using var scope = scopes.CreateAsyncScope();
                    await CleanupAsync(scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>(),
                        scope.ServiceProvider.GetRequiredService<IObjectStorage>(), clock.GetUtcNow(), stoppingToken);
                }
                catch (Exception e) when (e is not OperationCanceledException || !stoppingToken.IsCancellationRequested)
                { logger.LogWarning("Incident upload cleanup pending ({ErrorType})", e.GetType().Name); }
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
    }
    public static async Task CleanupAsync(BHomePersistenceContext db, IObjectStorage storage, DateTimeOffset now, CancellationToken t)
    {
        var ids = await db.Set<IncidentFileUpload>().AsNoTracking().Where(u => u.CleanupAfter <= now)
            .OrderBy(u => u.CleanupAfter).Take(50).Select(u => new { u.Id, u.LocationId }).ToArrayAsync(t);
        foreach (var candidate in ids)
        {
            db.ChangeTracker.Clear(); await using var tx = await db.Database.BeginTransactionAsync(t);
            await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({candidate.LocationId.ToString()}, 0))", t);
            var row = await db.Set<IncidentFileUpload>().SingleOrDefaultAsync(u => u.Id == candidate.Id, t);
            if (row is null) continue;
            if (!await db.Set<IncidentEvidence>().AnyAsync(e => e.ObjectKey == row.ObjectKey, t))
            {
                using var deadline = CancellationTokenSource.CreateLinkedTokenSource(t); deadline.CancelAfter(TimeSpan.FromSeconds(30));
                await storage.DeleteAsync(row.ObjectKey, deadline.Token);
            }
            db.Remove(row); await db.SaveChangesAsync(t); await tx.CommitAsync(t);
        }
    }
}
