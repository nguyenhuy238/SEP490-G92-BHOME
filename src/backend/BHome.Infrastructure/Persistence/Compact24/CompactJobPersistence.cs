using System.Text.Json;
using BHome.Application.Jobs;
using BHome.Infrastructure.Jobs;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;

namespace BHome.Infrastructure.Persistence.Compact24;

internal sealed class CompactJobPersistence(Compact24DbContext db) : IBackgroundJobQueue, IJobPersistence
{
    public async Task EnqueueAsync(JobSubmission job, CancellationToken token)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(job.Name); ArgumentException.ThrowIfNullOrWhiteSpace(job.IdempotencyKey);
        if (job.Name.Length > 100 || job.IdempotencyKey.Length > 200 || job.PayloadJson.Length > 16000) throw new ArgumentException("Job contract exceeds configured limits.");
        using var payload = JsonDocument.Parse(job.PayloadJson);
        var data = JsonSerializer.Serialize(new { schemaVersion = 1, name = job.Name, idempotencyKey = job.IdempotencyKey, payload = payload.RootElement });
        // JSON array encoding of both values avoids delimiter collisions and stays under varchar(250).
        // The original name/key remain in task_data for exact equality even when the index key is hashed.
        var sourceKey = Key(job.Name, job.IdempotencyKey);
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO operational_tasks(id,task_type,source_key,status,next_run_at,task_data)
            VALUES ({Guid.NewGuid()},'SYSTEM_JOB',{sourceKey},'Pending',{DateTimeOffset.UtcNow},CAST({data} AS jsonb))
            ON CONFLICT (source_key) WHERE source_key IS NOT NULL DO NOTHING
            """, token);
    }
    internal static string Key(string name, string key) => "job:" + Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(
        System.Text.Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new[] { name, key }))));

    public async Task<BackgroundJobRecord?> ClaimAsync(string[] handlerNames, DateTimeOffset now, Guid leaseToken, int maxAttempts, CancellationToken token)
    {
        await using var tx = await db.Database.BeginTransactionAsync(token);
        await db.Database.OpenConnectionAsync(token);
        await using var select = new NpgsqlCommand("""
            SELECT id,status,attempt_count,next_run_at,locked_until,lease_token,task_data::text
            FROM operational_tasks WHERE task_type='SYSTEM_JOB' AND task_data->>'name'=ANY(@names) AND
              ((status='Pending' AND next_run_at<=@now) OR (status='Processing' AND locked_until<@now))
            ORDER BY next_run_at,id LIMIT 1 FOR UPDATE SKIP LOCKED
            """, (NpgsqlConnection)db.Database.GetDbConnection(), (NpgsqlTransaction)tx.GetDbTransaction());
        select.Parameters.AddWithValue("names", handlerNames); select.Parameters.AddWithValue("now", now);
        BackgroundJobRecord? job = null;
        await using (var reader = await select.ExecuteReaderAsync(token))
        {
            if (await reader.ReadAsync(token))
            {
                using var data = JsonDocument.Parse(reader.GetString(6));
                job = new BackgroundJobRecord
                {
                    Id = reader.GetGuid(0),
                    State = reader.GetString(1),
                    Attempts = reader.GetInt32(2),
                    AvailableAt = reader.GetFieldValue<DateTimeOffset>(3),
                    Name = data.RootElement.GetProperty("name").GetString()!,
                    IdempotencyKey = data.RootElement.GetProperty("idempotencyKey").GetString()!,
                    PayloadJson = data.RootElement.GetProperty("payload").GetRawText()
                };
            }
        }
        if (job is null) return null;
        var exhausted = job.Attempts >= maxAttempts;
        job.State = exhausted ? "Failed" : "Processing";
        job.LastErrorCode = exhausted ? "LeaseExpiredAfterFinalAttempt" : null;
        job.LockToken = leaseToken;
        if (!exhausted) job.Attempts++;
        var error = job.LastErrorCode;
        var eventJson = JsonSerializer.Serialize(new[] { new { action = exhausted ? "Exhausted" : "Claimed", occurredAt = now, attempt = job.Attempts } });
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE operational_tasks SET status={job.State},attempt_count={job.Attempts},lease_token={leaseToken},locked_until={now.AddMinutes(2)},
              task_data=jsonb_set(task_data,ARRAY['lastErrorCode'],COALESCE(to_jsonb(CAST({error} AS text)),'null'::jsonb)),history=history||CAST({eventJson} AS jsonb)
            WHERE id={job.Id} AND task_type='SYSTEM_JOB'
            """, token);
        await tx.CommitAsync(token); return job;
    }
    public Task<int> CompleteAsync(Guid id, Guid leaseToken, CancellationToken token) => UpdateAsync(id, leaseToken, "Completed", null, null, token);
    public Task<int> FailAsync(Guid id, Guid leaseToken, string state, DateTimeOffset next, string errorCode, CancellationToken token) => UpdateAsync(id, leaseToken, state, next, errorCode, token);
    private Task<int> UpdateAsync(Guid id, Guid leaseToken, string state, DateTimeOffset? next, string? error, CancellationToken token)
    {
        var eventJson = JsonSerializer.Serialize(new[] { new { action = state, occurredAt = DateTimeOffset.UtcNow, errorCode = error } });
        return db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE operational_tasks SET status={state},next_run_at=COALESCE({next},next_run_at),locked_until=NULL,
              task_data=jsonb_set(task_data,ARRAY['lastErrorCode'],COALESCE(to_jsonb(CAST({error} AS text)),'null'::jsonb)),history=history||CAST({eventJson} AS jsonb)
            WHERE id={id} AND task_type='SYSTEM_JOB' AND lease_token={leaseToken}
            """, token);
    }
}
