using System.Text.Json;
using BHome.Application.Jobs;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Jobs;

internal sealed class PostgresJobQueue(BHomeDbContext db) : IBackgroundJobQueue
{
    public async Task EnqueueAsync(JobSubmission submission, CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(submission.Name);
        ArgumentException.ThrowIfNullOrWhiteSpace(submission.IdempotencyKey);
        if (submission.Name.Length > 100 || submission.IdempotencyKey.Length > 200 || submission.PayloadJson.Length > 16000)
            throw new ArgumentException("Job contract exceeds configured limits.");
        using var payload = JsonDocument.Parse(submission.PayloadJson);
        // Uses the scoped context/transaction: enqueue with business changes in the same explicit transaction.
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO "BackgroundJobs" ("Id", "Name", "IdempotencyKey", "PayloadJson", "State", "Attempts", "AvailableAt")
            VALUES ({Guid.NewGuid()}, {submission.Name}, {submission.IdempotencyKey}, CAST({submission.PayloadJson} AS jsonb), 'Pending', 0, {DateTimeOffset.UtcNow})
            ON CONFLICT ("Name", "IdempotencyKey") DO NOTHING
            """, cancellationToken);
    }
}
