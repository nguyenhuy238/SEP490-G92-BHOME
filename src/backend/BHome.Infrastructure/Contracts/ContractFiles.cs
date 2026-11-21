using BHome.Application.Contracts;
using BHome.Application.Ocr;
using BHome.Application.Storage;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Ocr;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using OpenCvSharp;

namespace BHome.Infrastructure.Contracts;

internal sealed class ContractFileStore(BHomePersistenceContext context, IObjectStorage storage, TimeProvider clock) : IContractFileStore
{
    public async Task PutAsync(Guid roomId, string key, byte[] bytes, string contentType, CancellationToken t)
    {
        // Independent context: this intent survives a rolled-back contract transaction or a process crash.
        await using var intent = context.CreateIndependentContext();
        if (!await intent.Set<ContractFileUpload>().AnyAsync(f => f.ObjectKey == key, t))
        {
            intent.Add(new ContractFileUpload { ObjectKey = key, RoomId = roomId, CleanupAfter = clock.GetUtcNow().AddDays(1) });
            await intent.SaveChangesAsync(t);
        }
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(t); deadline.CancelAfter(TimeSpan.FromSeconds(30));
        using var content = new MemoryStream(bytes); await storage.PutAsync(key, content, content.Length, contentType, deadline.Token);
    }
}

internal sealed class ContractImageValidator : IContractImageValidator
{
    public string Validate(byte[] content)
    {
        ImagePreprocessor.ValidateHeader(content, 5 * 1024 * 1024, 12_000_000);
        using var image = Cv2.ImDecode(content, ImreadModes.Color);
        if (image.Empty()) throw new OcrInputException("corrupted_image");
        return content[0] == 137 ? "image/png" : "image/jpeg";
    }
}

public sealed class ContractFileCleanup(IServiceScopeFactory scopes, TimeProvider clock, ILogger<ContractFileCleanup> logger) : BackgroundService
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
            catch (Exception e) when (e is not OperationCanceledException)
            { logger.LogWarning("Contract file cleanup unavailable ({Code})", e.GetType().Name); }
        }
    }
    public static async Task CleanupAsync(BHomePersistenceContext db, IObjectStorage storage, DateTimeOffset now, CancellationToken t)
    {
        var candidates = await db.Set<ContractFileUpload>().AsNoTracking().Where(f => f.CleanupAfter <= now).OrderBy(f => f.CleanupAfter).Take(100).ToArrayAsync(t);
        foreach (var item in candidates)
        {
            db.ChangeTracker.Clear();
            await using var tx = await db.Database.BeginTransactionAsync(t);
            await db.Locked<Room>(item.RoomId).SingleOrDefaultAsync(t);
            var file = await db.Set<ContractFileUpload>().SingleOrDefaultAsync(f => f.ObjectKey == item.ObjectKey, t);
            if (file is null) continue;
            var linked = await db.Set<ContractSignature>().AnyAsync(s => s.PreparedObjectKey == file.ObjectKey || s.SignedObjectKey == file.ObjectKey, t) ||
                await db.Set<ContractInspectionEvidence>().AnyAsync(e => e.ObjectKey == file.ObjectKey, t) ||
                await db.Set<ContractDocumentFile>().AnyAsync(e => e.ObjectKey == file.ObjectKey, t);
            if (!linked && db is BHome.Infrastructure.Persistence.Compact24.Compact24DbContext)
                linked = await db.Set<ContractSigningInvitation>().AnyAsync(i => i.DocumentObjectKey == file.ObjectKey ||
                    i.SignatureObjectKey == file.ObjectKey || i.AcceptedDocumentObjectKey == file.ObjectKey, t) ||
                    await db.Set<Contract>().AnyAsync(c => c.SigningMode == ContractSigningModes.Internal && c.InternalAcceptance.Contains(file.ObjectKey), t);
            if (!linked) await storage.DeleteAsync(file.ObjectKey, t);
            db.Remove(file); await db.SaveChangesAsync(t); await tx.CommitAsync(t);
        }
    }
}
