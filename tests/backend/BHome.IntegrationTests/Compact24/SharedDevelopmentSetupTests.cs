using BHome.LocalDevelopment;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Testcontainers.PostgreSql;

namespace BHome.IntegrationTests.Compact24;

public sealed class SharedDevelopmentSetupTests
{
    [Theory]
    [InlineData("Development", "development", "Host=localhost;Database=bhome")]
    [InlineData("Development", "production", "Host=ep-royal-water-ao5mauq0-pooler.c-2.ap-southeast-1.aws.neon.tech;Database=neondb;SSL Mode=VerifyFull;Channel Binding=Require")]
    [InlineData("Production", "development", "Host=ep-royal-water-ao5mauq0-pooler.c-2.ap-southeast-1.aws.neon.tech;Database=neondb;SSL Mode=VerifyFull;Channel Binding=Require")]
    [InlineData("Development", "development", "Host=ep-curly-leaf-aoxpcuzr-pooler.c-2.ap-southeast-1.aws.neon.tech;Database=neondb;SSL Mode=VerifyFull;Channel Binding=Require")]
    public void SharedSeedRequiresExactDevelopmentTarget(string environment, string branch, string connection) =>
        Assert.Throws<LocalTestAccountException>(() => Compact24SampleSeed.ValidateSharedTarget(environment, branch, connection));

    [Fact]
    public void SharedSeedDoesNotWeakenTheLocalOnlyEntryPoint()
    {
        const string connection = "Host=ep-royal-water-ao5mauq0-pooler.c-2.ap-southeast-1.aws.neon.tech;Database=neondb;SSL Mode=VerifyFull;Channel Binding=Require";
        Compact24SampleSeed.ValidateSharedTarget("Development", "development", connection);
        Assert.Throws<LocalTestAccountException>(() => Compact24SampleSeed.ValidateTarget("Development", connection));
    }

    [Fact]
    public async Task FiveRuntimeRolesCanQueryButCannotCreateTablesRolesOrModifyMigrationHistoryAndReplayKeepsPasswords()
    {
        await using var postgres = new PostgreSqlBuilder("postgres:16-alpine")
            .WithDatabase("bhome_compact24_" + Guid.NewGuid().ToString("N")).Build();
        await postgres.StartAsync();
        await using var db = new Compact24DbContext(new DbContextOptionsBuilder<Compact24DbContext>().UseNpgsql(postgres.GetConnectionString()).Options);
        await db.Database.MigrateAsync();
        var directory = Path.Combine(Path.GetTempPath(), "bhome-role-fixture-" + Guid.NewGuid().ToString("N"));
        try
        {
            await SharedDevelopmentRoles.ProvisionAsync(postgres.GetConnectionString(), directory);
            var before = Directory.GetFiles(directory).ToDictionary(path => Path.GetFileName(path)!, File.ReadAllText);
            await SharedDevelopmentRoles.ProvisionAsync(postgres.GetConnectionString(), directory);
            foreach (var name in SharedDevelopmentRoles.Names)
            {
                var file = Path.Combine(directory, name + ".env");
                Assert.Equal(before[name + ".env"], await File.ReadAllTextAsync(file));
                var settings = new NpgsqlConnectionStringBuilder((await File.ReadAllTextAsync(file))["ConnectionStrings__Database=".Length..].Trim()) { Pooling = false };
                await using var connection = new NpgsqlConnection(settings.ConnectionString);
                await connection.OpenAsync();
                await using (var query = new NpgsqlCommand("SELECT count(*) FROM users", connection))
                    Assert.Equal(0L, await query.ExecuteScalarAsync());
                foreach (var sql in new[] { "CREATE TABLE public.forbidden(id integer)", "CREATE ROLE forbidden_role", "INSERT INTO bhome_meta.\"__EFMigrationsHistory\" VALUES ('forbidden','8.0.32')", "SET ROLE postgres" })
                {
                    await using var denied = new NpgsqlCommand(sql, connection);
                    var error = await Assert.ThrowsAsync<PostgresException>(() => denied.ExecuteNonQueryAsync());
                    Assert.Equal("42501", error.SqlState);
                }
            }
        }
        finally { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
    }
}
