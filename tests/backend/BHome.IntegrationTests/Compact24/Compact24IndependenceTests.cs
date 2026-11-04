using System.Data.Common;
using System.Text.RegularExpressions;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Npgsql;

namespace BHome.IntegrationTests.Compact24;

public sealed class CompactIndependenceFactAttribute : FactAttribute
{
    public CompactIndependenceFactAttribute()
    {
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("BHOME_COMPACT24_TEST_ADMIN")) ||
            string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("BHOME_COMPACT24_QUERY_LOG")))
            Skip = "Requires an isolated PostgreSQL server with statement logging and parameter logging disabled.";
    }
}

[Trait("Category", "CompactIndependence")]
public sealed class Compact24IndependenceTests
{
    [CompactIndependenceFact]
    public async Task DefaultApplicationRepositoriesHealthChecksAndRealHostedServicesHaveNoLegacyDependency()
    {
        var fixture = new Compact24Fixture(keepHostedServices: true);
        await fixture.InitializeAsync();
        var guard = new LegacySqlGuard();
        var storage = new Compact24WorkflowFixture.TestObjectStorage();
        await using var host = fixture.Factory!.WithWebHostBuilder(b =>
        {
            b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?>
            { ["Jobs:Enabled"] = "true", ["Jobs:PollSeconds"] = "1", ["Ocr:Enabled"] = "false" }));
            b.ConfigureServices(s =>
            {
                s.AddDbContext<Compact24DbContext>(o => o.AddInterceptors(guard));
                s.AddSingleton<BHome.Application.Storage.IObjectStorage>(storage);
            });
        });
        try
        {
            await using (var scope = host.Services.CreateAsyncScope())
            {
                Assert.Null(scope.ServiceProvider.GetService<BHomeDbContext>());
                Assert.Null(scope.ServiceProvider.GetService<DbContextOptions<BHomeDbContext>>());
                Assert.IsType<Compact24DbContext>(scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>());
                Assert.IsType<CompactUserStore>(scope.ServiceProvider.GetRequiredService<IUserStore<ApplicationUser>>());
                Assert.IsType<CompactRoleStore>(scope.ServiceProvider.GetRequiredService<IRoleStore<IdentityRole<Guid>>>());
                var roleManager = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<Guid>>>();
                Assert.True(await roleManager.RoleExistsAsync("Owner"));
                Assert.True(await scope.ServiceProvider.GetRequiredService<Compact24DbContext>().IsSchemaReadyAsync());
            }
            var workers = host.Services.GetServices<IHostedService>().Select(s => s.GetType().Name).ToArray();
            Assert.Contains("PostgresJobWorker", workers); Assert.Contains("ContractFileCleanup", workers);
            Assert.Contains("MeterEvidenceCleanup", workers); Assert.Contains("TaskEvidenceCleanup", workers);
            Assert.Contains("AdjustmentEvidenceCleanup", workers);
            using var client = host.CreateClient();
            Assert.Equal(System.Net.HttpStatusCode.OK, (await client.GetAsync("/health/ready")).StatusCode);
            var capture = new BHome.IntegrationTests.Ocr.CaptureFixture(host, "http://private-storage-test.invalid");
            await new BHome.IntegrationTests.PaymentsDebt.PaymentLedgerTests(capture).OwnerApiReconcilesPersistedInvoiceAndRejectsUnmatchedTransferWithHistory();

            // Exercise actual registered schedules/handlers; the PostgreSQL log also sees direct
            // Npgsql commands (which bypass EF interceptors) and independent upload contexts.
            await using (var scope = host.Services.CreateAsyncScope())
            {
                foreach (var schedule in scope.ServiceProvider.GetServices<BHome.Application.Jobs.IJobScheduleContributor>())
                    await schedule.EnqueueDueAsync(default);
                var queue = scope.ServiceProvider.GetRequiredService<BHome.Application.Jobs.IBackgroundJobQueue>();
                await queue.EnqueueAsync(new("notification-publish", "independence-check", "{}"), default);
            }
            await Task.Delay(TimeSpan.FromSeconds(3));
            await using (var scope = host.Services.CreateAsyncScope())
                Assert.True(await scope.ServiceProvider.GetRequiredService<Compact24DbContext>().Set<BHome.Infrastructure.Jobs.BackgroundJobRecord>()
                    .AnyAsync(j => j.State == "Completed"));
            Assert.Empty(guard.Unexpected);
            var database = new NpgsqlConnectionStringBuilder(fixture.Connection).Database!;
            var logPath = Environment.GetEnvironmentVariable("BHOME_COMPACT24_QUERY_LOG")!;
            var statements = await ReadDatabaseLog(logPath, database);
            Assert.Contains("operational_tasks", statements, StringComparison.Ordinal);
            Assert.Contains("notifications", statements, StringComparison.Ordinal);
            Assert.False(LegacySqlGuard.LegacyReference.IsMatch(statements), "A removed source table was queried in the Compact24 database.");
            await using var connection = new NpgsqlConnection(fixture.Connection); await connection.OpenAsync();
            await using var count = new NpgsqlCommand("SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'", connection);
            Assert.Equal(24L, await count.ExecuteScalarAsync());
        }
        finally { await host.DisposeAsync(); await fixture.DisposeAsync(); }
    }

    private static async Task<string> ReadDatabaseLog(string path, string database)
    {
        await using var input = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
        using var reader = new StreamReader(input);
        var result = new System.Text.StringBuilder(); var include = false;
        while (await reader.ReadLineAsync() is { } line)
        {
            if (line.Contains(" db=", StringComparison.Ordinal)) include = line.Contains(" db=" + database + " ", StringComparison.Ordinal);
            if (include) result.AppendLine(line);
        }
        return result.ToString();
    }

    private sealed class LegacySqlGuard : DbCommandInterceptor
    {
        internal static readonly Regex LegacyReference = new("(?:FROM|JOIN|UPDATE|INTO|DELETE\\s+FROM)\\s+(?:public\\.)?\\\"?(?:" +
            string.Join('|', Compact24MigrationMap.Tables.Keys.Select(Regex.Escape)) + ")\\\"?(?=\\s|\\(|$)", RegexOptions.CultureInvariant);
        internal System.Collections.Concurrent.ConcurrentQueue<string> Unexpected { get; } = new();
        private void Check(DbCommand command)
        {
            if (!LegacyReference.IsMatch(command.CommandText)) return;
            Unexpected.Enqueue("removed_table_reference"); throw new InvalidOperationException("Legacy SQL is forbidden in Compact24 runtime.");
        }
        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken token = default)
        { Check(command); return ValueTask.FromResult(result); }
        public override ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(DbCommand command, CommandEventData eventData, InterceptionResult<int> result, CancellationToken token = default)
        { Check(command); return ValueTask.FromResult(result); }
        public override ValueTask<InterceptionResult<object>> ScalarExecutingAsync(DbCommand command, CommandEventData eventData, InterceptionResult<object> result, CancellationToken token = default)
        { Check(command); return ValueTask.FromResult(result); }
    }
}
