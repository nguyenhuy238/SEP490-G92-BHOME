using BHome.Application.Jobs;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Testcontainers.PostgreSql;

namespace BHome.IntegrationTests;

[Trait("Category", "Docker")]
public sealed class PostgresFoundationTests : IAsyncLifetime
{
    private readonly PostgreSqlContainer database = new PostgreSqlBuilder("postgres:16-alpine").Build();
    private readonly ApiFactory factory = new();

    public async Task InitializeAsync()
    {
        await database.StartAsync();
        factory.ConnectionString = database.GetConnectionString();
        await using var scope = factory.Services.CreateAsyncScope();
        await scope.ServiceProvider.GetRequiredService<BHomeDbContext>().Database.MigrateAsync();
    }

    [Fact]
    public async Task ApiReadinessUsesIsolatedMigratedPostgres()
    {
        using var client = factory.CreateClient();
        Assert.True((await client.GetAsync("/health/ready")).IsSuccessStatusCode);
    }

    [Fact]
    public async Task RepeatedEnqueueCreatesOneDurableJob()
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var queue = scope.ServiceProvider.GetRequiredService<IBackgroundJobQueue>();
        var job = new JobSubmission("test", Guid.NewGuid().ToString(), "{}");
        await queue.EnqueueAsync(job, default);
        await queue.EnqueueAsync(job, default);
        var db = scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
        var count = await db.Database.SqlQuery<int>($"""
            SELECT COUNT(*)::int AS "Value" FROM "BackgroundJobs" WHERE "Name" = {job.Name} AND "IdempotencyKey" = {job.IdempotencyKey}
            """).SingleAsync();
        Assert.Equal(1, count);
    }

    public async Task DisposeAsync()
    {
        await factory.DisposeAsync();
        await database.DisposeAsync();
    }
}
