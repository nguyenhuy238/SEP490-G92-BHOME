using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Jobs;

internal sealed class LegacyJobPersistence(BHomeDbContext db) : IJobPersistence
{
    public async Task<BackgroundJobRecord?> ClaimAsync(string[] handlerNames, DateTimeOffset now, Guid leaseToken, int maxAttempts, CancellationToken token)
    {
        await using var tx = await db.Database.BeginTransactionAsync(token);
        var job = await db.BackgroundJobs.FromSqlInterpolated($"""
            SELECT * FROM "BackgroundJobs" WHERE "Name"=ANY({handlerNames}) AND
              (("State"='Pending' AND "AvailableAt"<={now}) OR ("State"='Processing' AND "LockedUntil"<{now}))
            ORDER BY "AvailableAt" LIMIT 1 FOR UPDATE SKIP LOCKED
            """).FirstOrDefaultAsync(token);
        if (job is null) return null;
        if (job.Attempts >= maxAttempts) { job.State = "Failed"; job.LastErrorCode = "LeaseExpiredAfterFinalAttempt"; }
        else { job.State = "Processing"; job.LockToken = leaseToken; job.LockedUntil = now.AddMinutes(2); job.Attempts++; }
        await db.SaveChangesAsync(token); await tx.CommitAsync(token);
        return job;
    }
    public Task<int> CompleteAsync(Guid id, Guid leaseToken, CancellationToken token) =>
        db.BackgroundJobs.Where(j => j.Id == id && j.LockToken == leaseToken).ExecuteUpdateAsync(s => s.SetProperty(j => j.State, "Completed")
            .SetProperty(j => j.LockedUntil, (DateTimeOffset?)null), token);
    public Task<int> FailAsync(Guid id, Guid leaseToken, string state, DateTimeOffset next, string errorCode, CancellationToken token) =>
        db.BackgroundJobs.Where(j => j.Id == id && j.LockToken == leaseToken).ExecuteUpdateAsync(s => s.SetProperty(j => j.State, state)
            .SetProperty(j => j.AvailableAt, next).SetProperty(j => j.LockedUntil, (DateTimeOffset?)null).SetProperty(j => j.LastErrorCode, errorCode), token);
}
