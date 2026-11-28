using BHome.Application.IncidentMaintenance;
using BHome.Application.Ocr;
using BHome.Application.Storage;
using BHome.Domain.IncidentMaintenance;
using BHome.Infrastructure.Ocr;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using BHome.Infrastructure.Modules.IncidentMaintenance.Persistence;
using System.Text.Json;
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
        var intent = new IncidentFileUpload { LocationId = locationId, ObjectKey = key, CleanupAfter = clock.GetUtcNow().AddHours(1) };
        if (staging is Compact24DbContext compact)
        {
            await using var tx = await compact.Database.BeginTransactionAsync(t);
            await NativeIncidentWrites.WriteAsync(compact, intent, true, null, t);
            await tx.CommitAsync(t);
        }
        else
        {
            staging.Add(intent);
            await staging.SaveChangesAsync(t);
        }
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
        if (db is Compact24DbContext compact)
        {
            await CleanupNativeAsync(compact, storage, now, t);
            return;
        }
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

    private static async Task CleanupNativeAsync(Compact24DbContext db, IObjectStorage storage, DateTimeOffset now, CancellationToken t)
    {
        var rows = await db.Database.SqlQuery<string>($"""
            SELECT (task_data->'state')::text AS "Value" FROM operational_tasks
            WHERE task_type='SYSTEM_JOB' AND task_data->>'recordType'='IncidentFileUpload'
                AND COALESCE(task_data->>'deleted','false')<>'true'
                AND (task_data->'state'->>'cleanupAfter')::timestamptz<={now}
            ORDER BY (task_data->'state'->>'cleanupAfter')::timestamptz LIMIT 50
            """).ToArrayAsync(t);
        foreach (var value in rows)
        {
            var candidate = JsonSerializer.Deserialize<IncidentSnapshots.IncidentFileUploadState>(value, IncidentSnapshots.Json)!.ToDomain();
            await using var tx = await db.Database.BeginTransactionAsync(t);
            await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({candidate.LocationId.ToString()},0))", t);
            var current = await db.Database.SqlQuery<string>($"""
                SELECT (task_data->'state')::text AS "Value" FROM operational_tasks
                WHERE id={candidate.Id} AND task_type='SYSTEM_JOB' AND task_data->>'recordType'='IncidentFileUpload'
                    AND COALESCE(task_data->>'deleted','false')<>'true'
                """).SingleOrDefaultAsync(t);
            if (current is null) continue;
            var intent = JsonSerializer.Deserialize<IncidentSnapshots.IncidentFileUploadState>(current, IncidentSnapshots.Json)!.ToDomain();
            var linked = await db.Database.SqlQuery<bool>($"""
                SELECT EXISTS (SELECT 1 FROM (
                    SELECT history FROM incident_reports
                    UNION ALL SELECT history FROM operational_tasks WHERE task_type='WORK_ORDER'
                ) parents CROSS JOIN LATERAL (
                    SELECT DISTINCT ON (h->>'recordKey') h FROM jsonb_array_elements(parents.history)
                        WITH ORDINALITY a(h,n) WHERE h->>'recordType'='IncidentEvidence' ORDER BY h->>'recordKey',n DESC
                ) s WHERE COALESCE(s.h->>'deleted','false')<>'true' AND s.h->'state'->>'objectKey'={intent.ObjectKey}) AS "Value"
                """).SingleAsync(t);
            if (!linked)
            {
                using var deadline = CancellationTokenSource.CreateLinkedTokenSource(t); deadline.CancelAfter(TimeSpan.FromSeconds(30));
                await storage.DeleteAsync(intent.ObjectKey, deadline.Token);
            }
            await NativeIncidentWrites.DeleteUploadIntentAsync(db, intent, t);
            await tx.CommitAsync(t);
        }
    }
}
