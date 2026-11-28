using BHome.Application.Ocr;
using BHome.Application.StaffOperations;
using BHome.Application.Storage;
using BHome.Domain.StaffOperations;
using BHome.Infrastructure.Ocr;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using BHome.Infrastructure.Modules.StaffOperations.Persistence;
using Native = BHome.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using OpenCvSharp;

namespace BHome.Infrastructure.Modules.StaffOperations;

internal sealed class TaskEvidenceFiles(BHomePersistenceContext context, IObjectStorage storage, TimeProvider clock) : ITaskEvidenceFiles
{
    public string Validate(byte[] content, int maximumBytes)
    {
        try
        {
            ImagePreprocessor.ValidateHeader(content, maximumBytes, 12_000_000);
            using var decoded = Cv2.ImDecode(content, ImreadModes.Color);
            if (decoded.Empty()) throw OperationalTaskException.Invalid("corrupted_task_image");
            return content[0] == 137 ? "image/png" : "image/jpeg";
        }
        catch (OcrInputException) { throw OperationalTaskException.Invalid("invalid_task_image"); }
        catch (OpenCVException) { throw OperationalTaskException.Invalid("corrupted_task_image"); }
    }
    public async Task PutAsync(Guid taskId, string key, byte[] content, string contentType, CancellationToken t)
    {
        await using var intent = context.CreateIndependentContext();
        var upload = new OperationalTaskFileUpload { TaskId = taskId, ObjectKey = key, CleanupAfter = clock.GetUtcNow().AddHours(1) };
        if (intent is Compact24DbContext compact)
            await NativeOperationalTaskPersistence.WriteTechnicalAsync(compact, upload, false, t);
        else { intent.Add(upload); await intent.SaveChangesAsync(t); }
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(t); deadline.CancelAfter(TimeSpan.FromSeconds(30));
        using var data = new MemoryStream(content, false);
        await storage.PutAsync(key, data, content.Length, contentType, deadline.Token);
    }
    public async Task CopyAsync(string key, Stream output, CancellationToken t)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(t); deadline.CancelAfter(TimeSpan.FromSeconds(30));
        await storage.CopyToAsync(key, output, deadline.Token);
    }
}

public sealed class TaskEvidenceCleanup(IServiceScopeFactory scopes, TimeProvider clock, ILogger<TaskEvidenceCleanup> logger) : BackgroundService
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
                { logger.LogWarning("Task evidence cleanup pending ({ErrorType})", e.GetType().Name); }
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
    }
    public static async Task CleanupAsync(BHomePersistenceContext db, IObjectStorage storage, DateTimeOffset now, CancellationToken t)
    {
        if (db is Compact24DbContext compact)
        {
            var nativeCandidates = (await compact.Database.SqlQuery<string>($"""
                SELECT (task_data->'state')::text AS "Value" FROM operational_tasks
                WHERE task_type='SYSTEM_JOB' AND task_data->>'recordType'='OperationalTaskFileUpload'
                    AND COALESCE(task_data->>'deleted','false')<>'true' AND (task_data->'state'->>'cleanupAfter')::timestamptz<={now}
                ORDER BY (task_data->'state'->>'cleanupAfter')::timestamptz LIMIT 50
                """).ToArrayAsync(t)).Select(NativeOperationalTaskPersistence.Upload).ToArray();
            foreach (var candidate in nativeCandidates)
            {
                var location = await NativeOperationalTaskPersistence.Roots(compact).Where(x => x.Id == candidate.TaskId)
                    .Select(x => x.LocationId).SingleAsync(t);
                await using var transaction = await db.Database.BeginTransactionAsync(t);
                await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({location!.Value.ToString()}, 0))", t);
                var json = await compact.Database.SqlQuery<string>($"""
                    SELECT (task_data->'state')::text AS "Value" FROM operational_tasks WHERE id={candidate.Id}
                    AND task_type='SYSTEM_JOB' AND task_data->>'recordType'='OperationalTaskFileUpload'
                    AND COALESCE(task_data->>'deleted','false')<>'true'
                    """).SingleOrDefaultAsync(t);
                if (json is null) continue;
                var row = NativeOperationalTaskPersistence.Upload(json);
                var linked = await compact.Database.SqlQuery<bool>($"""
                    SELECT EXISTS(SELECT 1 FROM operational_tasks o CROSS JOIN LATERAL jsonb_array_elements(o.evidence) e
                        WHERE e->>'recordType'='OperationalTaskEvidence' AND e->>'objectKey'={row.ObjectKey}) AS "Value"
                    """).SingleAsync(t);
                if (!linked)
                {
                    using var deadline = CancellationTokenSource.CreateLinkedTokenSource(t); deadline.CancelAfter(TimeSpan.FromSeconds(30));
                    await storage.DeleteAsync(row.ObjectKey, deadline.Token);
                }
                await NativeOperationalTaskPersistence.WriteTechnicalAsync(compact, row, true, t);
                await transaction.CommitAsync(t);
            }
            return;
        }
        var candidates = await db.Set<OperationalTaskFileUpload>().AsNoTracking().Where(x => x.CleanupAfter <= now)
            .OrderBy(x => x.CleanupAfter).Take(50).Select(x => new { x.Id, x.TaskId }).ToArrayAsync(t);
        foreach (var candidate in candidates)
        {
            db.ChangeTracker.Clear();
            var location = await db.Set<BHome.Domain.Billing.OperationalTask>().Where(x => x.Id == candidate.TaskId).Select(x => x.RequiredLocationId).SingleAsync(t);
            await using var transaction = await db.Database.BeginTransactionAsync(t);
            await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({location.ToString()}, 0))", t);
            var row = await db.Set<OperationalTaskFileUpload>().SingleOrDefaultAsync(x => x.Id == candidate.Id, t);
            if (row is null) continue;
            if (!await db.Set<OperationalTaskEvidence>().AnyAsync(x => x.ObjectKey == row.ObjectKey, t))
            {
                using var deadline = CancellationTokenSource.CreateLinkedTokenSource(t); deadline.CancelAfter(TimeSpan.FromSeconds(30));
                await storage.DeleteAsync(row.ObjectKey, deadline.Token);
            }
            db.Remove(row); await db.SaveChangesAsync(t); await transaction.CommitAsync(t);
        }
    }
}
