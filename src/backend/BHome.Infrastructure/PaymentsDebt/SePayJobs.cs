using System.Text.Json;
using BHome.Application.Jobs;
using BHome.Application.PaymentsDebt.SePay;
using BHome.Infrastructure.Persistence.Compact24;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace BHome.Infrastructure.PaymentsDebt;

internal sealed class SePayReconciliationJob(SePayService service, SePayOptions options) : IBackgroundJobHandler
{
    public string Name => "sepay-reconcile-" + options.Mode.ToLowerInvariant();
    public bool Enabled => options.Enabled;
    public Task ExecuteAsync(JobExecution job, CancellationToken cancellationToken)
    {
        using var payload = JsonDocument.Parse(job.PayloadJson);
        return service.ReconcileAsync(payload.RootElement.GetProperty("EventId").GetGuid(), cancellationToken);
    }
}

internal sealed class SePayPollingJob(BHomePersistenceContext db, ISePayTransactionClient client, SePayService service,
    SePayOptions options, TimeProvider clock) : IBackgroundJobHandler
{
    public string Name => "sepay-poll-" + options.Mode.ToLowerInvariant();
    public bool Enabled => options.Enabled && !string.IsNullOrWhiteSpace(options.ApiToken);
    public async Task ExecuteAsync(JobExecution job, CancellationToken cancellationToken)
    {
        // Keep the synchronization lease separate from each ledger transaction and HTTP request.
        await using var connection = new NpgsqlConnection(db.Database.GetConnectionString());
        await connection.OpenAsync(cancellationToken);
        await using var sync = await connection.BeginTransactionAsync(cancellationToken);
        var key = "sepay-sync:" + options.Mode;
        await using (var gate = new NpgsqlCommand("SELECT pg_try_advisory_xact_lock(hashtextextended(@key,0))", connection, sync))
        {
            gate.Parameters.AddWithValue("key", key);
            if (!(bool)(await gate.ExecuteScalarAsync(cancellationToken))!) return;
        }
        string? state;
        await using (var read = new NpgsqlCommand("SELECT task_data->>'cursor' FROM operational_tasks WHERE source_key=@key", connection, sync))
        {
            read.Parameters.AddWithValue("key", key); state = (string?)await read.ExecuteScalarAsync(cancellationToken);
        }
        var cursor = state is null ? new SePayPollingCursor() : JsonSerializer.Deserialize<SePayPollingCursor>(state)!;
        var page = await client.GetAsync(cursor, cancellationToken);
        foreach (var transaction in page.Items) await service.ReceiveAsync(transaction, cancellationToken);
        var candidate = page.Items.LastOrDefault()?.Id ?? cursor.CandidateId;
        var next = page.HasMore ? cursor with { Page = checked(cursor.Page + 1), CandidateId = candidate }
            : new SePayPollingCursor(candidate ?? cursor.SinceId, SynchronizedAt: clock.GetUtcNow());
        var data = JsonSerializer.Serialize(new { recordType = "SePaySyncV1", mode = options.Mode, cursor = JsonSerializer.Serialize(next) });
        await using var write = new NpgsqlCommand("""
            INSERT INTO operational_tasks(id,task_type,source_key,status,task_data) VALUES(@id,'COMMAND',@key,'Synchronized',@data::jsonb)
            ON CONFLICT(source_key) WHERE source_key IS NOT NULL DO UPDATE SET task_data=EXCLUDED.task_data
            """, connection, sync);
        write.Parameters.AddWithValue("id", Guid.NewGuid()); write.Parameters.AddWithValue("key", key); write.Parameters.AddWithValue("data", data);
        await write.ExecuteNonQueryAsync(cancellationToken); await sync.CommitAsync(cancellationToken);
    }
}

internal sealed class SePayScheduling(BHomePersistenceContext db, IBackgroundJobQueue jobs, SePayOptions options, TimeProvider clock) : IJobScheduleContributor
{
    public async Task EnqueueDueAsync(CancellationToken t)
    {
        if (db is not Compact24DbContext || !options.Enabled || string.IsNullOrWhiteSpace(options.ApiToken)) return;
        var name = "sepay-poll-" + options.Mode.ToLowerInvariant();
        if (await db.Database.SqlQuery<bool>($"""
            SELECT EXISTS(SELECT 1 FROM operational_tasks WHERE task_type='SYSTEM_JOB' AND task_data->>'name'={name} AND status IN ('Pending','Processing')) AS "Value"
            """).SingleAsync(t)) return;
        var window = clock.GetUtcNow().ToUnixTimeSeconds() / options.PollIntervalSeconds;
        await jobs.EnqueueAsync(new(name, options.Mode + ":" + window.ToString(System.Globalization.CultureInfo.InvariantCulture), "{}"), t);
    }
}
