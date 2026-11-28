using BHome.Application.Contracts;
using BHome.Application.Ocr;
using BHome.Application.Storage;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Ocr;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
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
        if (intent is Compact24DbContext compact)
        {
            if (await ContractFilePersistence.FindAsync(compact, key, t) is null)
                await ContractFilePersistence.WriteAsync(compact, new ContractFileUpload { ObjectKey = key, RoomId = roomId, CleanupAfter = clock.GetUtcNow().AddDays(1) }, false, t);
        }
        else if (!await intent.Set<ContractFileUpload>().AnyAsync(f => f.ObjectKey == key, t))
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
        var candidates = db is Compact24DbContext native ? await ContractFilePersistence.DueAsync(native, now, t) :
            await db.Set<ContractFileUpload>().AsNoTracking().Where(f => f.CleanupAfter <= now).OrderBy(f => f.CleanupAfter).Take(100).ToArrayAsync(t);
        foreach (var item in candidates)
        {
            db.ChangeTracker.Clear();
            await using var tx = await db.Database.BeginTransactionAsync(t);
            if (db is Compact24DbContext)
                await db.Database.SqlQuery<Guid>($"SELECT id AS \"Value\" FROM rooms WHERE id={item.RoomId} FOR UPDATE").ToArrayAsync(t);
            else await db.Locked<Room>(item.RoomId).SingleOrDefaultAsync(t);
            var file = db is Compact24DbContext physical ? await ContractFilePersistence.FindAsync(physical, item.ObjectKey, t) :
                await db.Set<ContractFileUpload>().SingleOrDefaultAsync(f => f.ObjectKey == item.ObjectKey, t);
            if (file is null) continue;
            var linked = (db is Compact24DbContext physicalDb
                ? await ContractFilePersistence.LinkedAsync(physicalDb, file.ObjectKey, t)
                : await db.Set<ContractSignature>().AnyAsync(s => s.PreparedObjectKey == file.ObjectKey || s.SignedObjectKey == file.ObjectKey, t) ||
                    await db.Set<ContractInspectionEvidence>().AnyAsync(e => e.ObjectKey == file.ObjectKey, t)) ||
                await ContractDocumentPersistence.LinkedAsync(db, file.ObjectKey, t);
            if (!linked && db is Compact24DbContext compact)
                linked = await NativeInvitationPersistence.LinkedAsync(compact, file.ObjectKey, t);
            if (!linked && db is BHome.Infrastructure.Persistence.Compact24.Compact24DbContext)
            {
                // Handover-signing attempts and Owner-signed revisions live in
                // versioned contracts.handover JSON until Tenant signs. They are
                // authoritative private files, not orphan uploads. Never purge
                // them while a signature is pending or waiting for the Tenant.
                linked = await db.Database.SqlQuery<bool>($"""
                    SELECT EXISTS (
                        SELECT 1 FROM contracts WHERE
                          handover->'preparation'->'ownerSignature'->>'objectKey'={file.ObjectKey}
                          OR handover->'preparation'->'tenantSigning'->>'preparedObjectKey'={file.ObjectKey}
                          OR handover->'preparation'->'tenantSignature'->>'objectKey'={file.ObjectKey}
                    ) AS "Value"
                    """).SingleAsync(t);
            }
            if (!linked) await storage.DeleteAsync(file.ObjectKey, t);
            if (db is Compact24DbContext nativeDb) await ContractFilePersistence.WriteAsync(nativeDb, file, true, t);
            else { db.Remove(file); await db.SaveChangesAsync(t); }
            await tx.CommitAsync(t);
        }
    }
}
