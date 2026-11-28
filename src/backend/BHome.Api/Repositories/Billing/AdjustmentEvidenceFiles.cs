using BHome.Application.Billing;
using BHome.Application.Storage;
using BHome.Domain.Billing;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Native = BHome.Domain.Entities;

namespace BHome.Infrastructure.Billing;

internal sealed class AdjustmentEvidenceFiles(BHomePersistenceContext context, IObjectStorage storage, TimeProvider clock) : IAdjustmentEvidenceFiles
{
    public async Task<AdjustmentEvidenceView> UploadAsync(Guid invoiceId, Guid actor, byte[] content, string contentType, CancellationToken t)
    {
        await using var db = context.CreateIndependentContext();
        var file = new InvoiceAdjustmentEvidence
        {
            InvoiceId = invoiceId,
            UploaderId = actor,
            ContentType = contentType,
            Length = content.Length,
            CleanupAfter = clock.GetUtcNow().AddDays(1)
        };
        if (db is Compact24DbContext compact)
        {
            var invoice = await compact.Set<BHome.Domain.Billing.Invoice>().AsNoTracking().Where(i => i.Id == invoiceId)
                .Select(i => new { i.LocationId, i.RoomId }).SingleAsync(t);
            file.ObjectKey = PrivateImageKeys.Evidence(invoice.LocationId, invoice.RoomId, "invoice-adjustments", invoiceId, file.Id);
            await SaveNativeAsync(compact, file, t); // Durable orphan intent before the upload.
        }
        else
        {
            var invoice = await db.Set<Invoice>().AsNoTracking().SingleAsync(i => i.Id == invoiceId, t);
            file.ObjectKey = PrivateImageKeys.Evidence(invoice.LocationId, invoice.RoomId, "invoice-adjustments", invoiceId, file.Id);
            db.Add(file); await db.SaveChangesAsync(t);
        }
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(t); deadline.CancelAfter(TimeSpan.FromSeconds(30));
        using var data = new MemoryStream(content);
        await storage.PutAsync(file.ObjectKey, data, content.Length, contentType, deadline.Token);
        file.Uploaded = true;
        if (db is Compact24DbContext native) await SaveNativeAsync(native, file, t);
        else await db.SaveChangesAsync(t);
        return new(file.Id, file.ContentType, file.Length);
    }
    private static async Task SaveNativeAsync(Compact24DbContext db, InvoiceAdjustmentEvidence file, CancellationToken t)
    {
        await using var tx = await db.Database.BeginTransactionAsync(t);
        await db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(hashtextextended('bhome-payment-ledger-v1', 0))", t);
        if (await NativeAdjustmentPersistence.SaveEvidenceAsync(db, file, false, t) != 1)
            throw new DbUpdateConcurrencyException("Adjustment evidence unavailable.");
        await tx.CommitAsync(t);
    }
    public Task CopyAsync(string key, Stream destination, CancellationToken t) => storage.CopyToAsync(key, destination, t);
}
public sealed class AdjustmentEvidenceCleanup(IServiceScopeFactory scopes, TimeProvider clock, ILogger<AdjustmentEvidenceCleanup> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(10));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                await CleanupAsync(scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>(), scope.ServiceProvider.GetRequiredService<IObjectStorage>(), clock.GetUtcNow(), stoppingToken);
            }
            catch (Exception e) when (e is not OperationCanceledException) { logger.LogWarning("Adjustment evidence cleanup unavailable ({Code})", e.GetType().Name); }
        }
    }
    public static async Task CleanupAsync(BHomePersistenceContext db, IObjectStorage storage, DateTimeOffset now, CancellationToken t)
    {
        if (db is Compact24DbContext compact)
        {
            var candidates = NativeAdjustmentPersistence.ExpiredEvidenceRows(compact, now);
            var candidateIds = await candidates.Select(e => e.Id).Take(100).ToArrayAsync(t);
            foreach (var id in candidateIds)
            {
                await using var tx = await db.Database.BeginTransactionAsync(t);
                await db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(hashtextextended('bhome-payment-ledger-v1', 0))", t);
                var row = await candidates.SingleOrDefaultAsync(e => e.Id == id, t);
                if (row is null) continue;
                var file = NativeAdjustmentPersistence.ReadEvidence(row);
                await storage.DeleteAsync(file.ObjectKey, t);
                if (await NativeAdjustmentPersistence.SaveEvidenceAsync(compact, file, true, t) != 1)
                    throw new DbUpdateConcurrencyException("Adjustment evidence unavailable.");
                await tx.CommitAsync(t);
            }
            return;
        }
        var ids = await db.Set<InvoiceAdjustmentEvidence>().AsNoTracking().Where(e => e.RequestId == null && e.CleanupAfter < now).Select(e => e.Id).Take(100).ToArrayAsync(t);
        foreach (var id in ids)
        {
            await using var tx = await db.Database.BeginTransactionAsync(t);
            await db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(hashtextextended('bhome-payment-ledger-v1', 0))", t);
            var file = await db.Set<InvoiceAdjustmentEvidence>().SingleOrDefaultAsync(e => e.Id == id && e.RequestId == null && e.CleanupAfter < now, t);
            if (file is null) continue;
            await storage.DeleteAsync(file.ObjectKey, t); db.Remove(file); await db.SaveChangesAsync(t); await tx.CommitAsync(t);
        }
    }
}
