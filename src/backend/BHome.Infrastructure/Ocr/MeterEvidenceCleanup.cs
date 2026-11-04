using BHome.Application.Storage;
using BHome.Domain.Billing;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace BHome.Infrastructure.Ocr;

// Retry durable abandoned-upload intents; linked evidence is retained. 30min is a staging lease,
// not a tenancy/evidence retention policy. SKIP LOCKED avoids an upload/confirmation in progress.
public sealed class MeterEvidenceCleanup(IServiceScopeFactory scopes, ILogger<MeterEvidenceCleanup> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(TimeSpan.FromMinutes(1), stoppingToken);
                await using var scope = scopes.CreateAsyncScope();
                var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
                var storage = scope.ServiceProvider.GetRequiredService<IObjectStorage>();
                await CleanupAsync(db, storage, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception ex) { logger.LogWarning("Meter upload cleanup pending ({ErrorType})", ex.GetType().Name); }
        }
    }
    public static async Task CleanupAsync(BHomePersistenceContext db, IObjectStorage storage, CancellationToken token)
    {
        await using var tx = await db.Database.BeginTransactionAsync(token);
        var now = DateTimeOffset.UtcNow;
        var abandoned = await db.Set<MeterEvidence>().AsNoTracking().Where(e => !e.IsLinked && e.CleanupAfter < now)
            .OrderBy(e => e.CleanupAfter).Take(10).Select(e => e.Id).ToArrayAsync(token);
        foreach (var id in abandoned)
        {
            var row = await db.Locked<MeterEvidence>(id, skipLocked: true).SingleOrDefaultAsync(token);
            if (row is null || row.IsLinked || row.CleanupAfter >= now) continue;
            using var deadline = CancellationTokenSource.CreateLinkedTokenSource(token); deadline.CancelAfter(TimeSpan.FromSeconds(30));
            await storage.DeleteAsync(row.ObjectKey, deadline.Token);
            db.Remove(row);
        }
        await db.SaveChangesAsync(token); await tx.CommitAsync(token);
    }
}
