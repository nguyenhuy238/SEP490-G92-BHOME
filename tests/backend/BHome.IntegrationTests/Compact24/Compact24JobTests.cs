using BHome.Application.Jobs;
using BHome.Infrastructure.Jobs;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Npgsql;

namespace BHome.IntegrationTests.Compact24;

[Trait("Category", "CompactPostgres")]
public sealed class Compact24JobTests(Compact24Fixture fixture) : IClassFixture<Compact24Fixture>
{
    [CompactPostgresFact]
    public async Task EnqueueCommitsWithBusinessTransactionAndNamespacedKeyIsCollisionSafe()
    {
        var name = Guid.NewGuid().ToString("N");
        await using var scope = fixture.Factory!.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var queue = scope.ServiceProvider.GetRequiredService<IBackgroundJobQueue>();
        await using (var tx = await db.Database.BeginTransactionAsync())
        {
            await queue.EnqueueAsync(new(name, "rollback", "{}"), default);
            await tx.RollbackAsync();
        }
        Assert.Equal(0, await Count(name));
        await queue.EnqueueAsync(new(name, "once", "{}"), default);
        await queue.EnqueueAsync(new(name, "once", "{}"), default);
        Assert.Equal(1, await Count(name));
        Assert.NotEqual(CompactJobPersistence.Key("a:b", "c"), CompactJobPersistence.Key("a", "b:c"));
        await using var connection = new NpgsqlConnection(fixture.Connection); await connection.OpenAsync();
        await using var query = new NpgsqlCommand("SELECT task_type,location_id FROM operational_tasks WHERE task_data->>'name'=@name", connection);
        query.Parameters.AddWithValue("name", name);
        await using var reader = await query.ExecuteReaderAsync();
        Assert.True(await reader.ReadAsync()); Assert.Equal("SYSTEM_JOB", reader.GetString(0)); Assert.True(reader.IsDBNull(1));
    }

    [CompactPostgresFact]
    public async Task ClaimsAreExclusiveExpiredLeaseRecoversAndOldWorkerCannotComplete()
    {
        var name = Guid.NewGuid().ToString("N");
        await using (var scope = fixture.Factory!.Services.CreateAsyncScope())
            await scope.ServiceProvider.GetRequiredService<IBackgroundJobQueue>().EnqueueAsync(new(name, "lease", "{}"), default);
        var now = DateTimeOffset.UtcNow.AddSeconds(1);
        var firstToken = Guid.NewGuid();
        async Task<BackgroundJobRecord?> Claim(Guid lease)
        {
            await using var scope = fixture.Factory!.Services.CreateAsyncScope();
            return await scope.ServiceProvider.GetRequiredService<IJobPersistence>().ClaimAsync([name], now, lease, 4, default);
        }
        var claims = await Task.WhenAll(Claim(firstToken), Claim(firstToken));
        var winner = Assert.Single(claims, x => x is not null)!;
        var secondToken = Guid.NewGuid();
        await using var scope2 = fixture.Factory!.Services.CreateAsyncScope();
        var store = scope2.ServiceProvider.GetRequiredService<IJobPersistence>();
        var recovered = await store.ClaimAsync([name], now.AddMinutes(3), secondToken, 4, default);
        Assert.NotNull(recovered); Assert.Equal(2, recovered.Attempts);
        Assert.Equal(0, await store.CompleteAsync(winner.Id, firstToken, default));
        Assert.Equal(1, await store.CompleteAsync(winner.Id, secondToken, default));
    }

    [CompactPostgresFact]
    public async Task ExistingWorkerRecordsFailureRetryAndCompletionThroughCompactStore()
    {
        var handler = new SyntheticHandler();
        using var host = fixture.Factory!.WithWebHostBuilder(b => b.ConfigureServices(s =>
        {
            s.RemoveAll<IBackgroundJobHandler>(); s.AddSingleton<IBackgroundJobHandler>(handler);
        }));
        await using (var scope = host.Services.CreateAsyncScope())
            await scope.ServiceProvider.GetRequiredService<IBackgroundJobQueue>().EnqueueAsync(new(handler.Name, "worker", "{}"), default);
        using var worker = ActivatorUtilities.CreateInstance<PostgresJobWorker>(host.Services);
        Assert.True(await worker.ProcessOneAsync(default));
        Assert.Equal("Pending", await State(handler.Name));
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
            await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE operational_tasks SET next_run_at={DateTimeOffset.UtcNow.AddSeconds(-1)} WHERE task_type='SYSTEM_JOB' AND task_data->>'name'={handler.Name}");
        }
        Assert.True(await worker.ProcessOneAsync(default));
        Assert.Equal("Completed", await State(handler.Name));
        Assert.Equal(2, handler.Calls);
        Assert.False(await worker.ProcessOneAsync(default));
    }
    private async Task<long> Count(string name)
    {
        await using var connection = new NpgsqlConnection(fixture.Connection); await connection.OpenAsync();
        await using var command = new NpgsqlCommand("SELECT count(*) FROM operational_tasks WHERE task_data->>'name'=@name", connection);
        command.Parameters.AddWithValue("name", name); return (long)(await command.ExecuteScalarAsync())!;
    }
    private async Task<string> State(string name)
    {
        await using var connection = new NpgsqlConnection(fixture.Connection); await connection.OpenAsync();
        await using var command = new NpgsqlCommand("SELECT status FROM operational_tasks WHERE task_data->>'name'=@name", connection);
        command.Parameters.AddWithValue("name", name); return (string)(await command.ExecuteScalarAsync())!;
    }
    private sealed class SyntheticHandler : IBackgroundJobHandler
    {
        public string Name { get; } = "synthetic-" + Guid.NewGuid().ToString("N");
        public int Calls { get; private set; }
        public Task ExecuteAsync(JobExecution job, CancellationToken cancellationToken)
        { if (++Calls == 1) throw new InvalidOperationException("Synthetic retry."); return Task.CompletedTask; }
    }
}
