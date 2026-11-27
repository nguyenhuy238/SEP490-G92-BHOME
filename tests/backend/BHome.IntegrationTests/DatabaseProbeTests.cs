using BHome.DatabaseCheck;
using Npgsql;
using Testcontainers.PostgreSql;
using BHome.Infrastructure.Persistence.Compact24;

namespace BHome.IntegrationTests;

public sealed class DatabaseProbeTests
{
    [Fact]
    public async Task ReadOnlyProbeDetectsEmptyAndReadyRuntimeWithoutCreatingAccountsOrHistory()
    {
        await using var database = new PostgreSqlBuilder("postgres:16-alpine").Build();
        await database.StartAsync();
        using var empty = new StringWriter();
        Assert.Equal(2, await DatabaseProbe.RunAsync(database.GetConnectionString(), empty));
        Assert.Contains("PublicTables=0", empty.ToString());
        await using var connection = new NpgsqlConnection(database.GetConnectionString());
        await connection.OpenAsync();
        await using var script = typeof(Compact24DbContext).Assembly.GetManifestResourceStream("BHome.Compact24.Schema.sql")!;
        using var text = new StreamReader(script);
        await using (var create = new NpgsqlCommand(await text.ReadToEndAsync(), connection))
            await create.ExecuteNonQueryAsync();
        using var ready = new StringWriter();
        Assert.Equal(0, await DatabaseProbe.RunAsync(database.GetConnectionString(), ready));
        Assert.Contains("read_only=on", ready.ToString());
        Assert.Contains("Compact24=PASS", ready.ToString());
        Assert.Contains("RuntimeEFQuery=PASS; tenant_records_read=0", ready.ToString());
        Assert.DoesNotContain(database.GetConnectionString(), ready.ToString());
        await using var check = new NpgsqlCommand("SELECT (SELECT count(*) FROM users)=0 AND to_regclass('public.\"__EFMigrationsHistory\"') IS NULL", connection);
        Assert.Equal(true, await check.ExecuteScalarAsync());
    }

    [Theory]
    [InlineData("SSL Mode=Disable;Channel Binding=Require")]
    [InlineData("SSL Mode=Require;Channel Binding=Require")]
    [InlineData("SSL Mode=VerifyFull;Channel Binding=Prefer")]
    [InlineData("SSL Mode=VerifyFull;Channel Binding=Require;Trust Server Certificate=true")]
    [InlineData("SSL Mode=VerifyFull;Channel Binding=Require;No Reset On Close=true")]
    [InlineData("SSL Mode=VerifyFull;Channel Binding=Require;Multiplexing=true")]
    public void RejectsUnsafeNeonSettingsBeforeConnecting(string options) => Assert.Throws<InvalidOperationException>(() =>
        DatabaseProbe.Validate("Host=synthetic-pooler.c-2.ap-southeast-1.aws.neon.tech;Database=neondb;" + options));

    [Fact]
    public void AcceptsSecureNeonAndPreservesLocalSupport()
    {
        var neon = DatabaseProbe.Validate("Host=synthetic-pooler.aws.neon.tech;Database=neondb;SSL Mode=VerifyFull;Channel Binding=Require;Include Error Detail=true;Log Parameters=true");
        Assert.Equal(SslMode.VerifyFull, neon.SslMode);
        Assert.Equal(ChannelBinding.Require, neon.ChannelBinding);
        Assert.False(neon.IncludeErrorDetail);
        Assert.False(neon.LogParameters);
        Assert.False(neon.Pooling);
        Assert.Equal("bhome", DatabaseProbe.Validate("Host=127.0.0.1;Database=bhome").Database);
    }

    [Theory]
    [InlineData("Password=synthetic-secret;unknown=synthetic-secret")]
    [InlineData("postgresql://synthetic:synthetic-secret@localhost/neondb")]
    [InlineData("")]
    public async Task InvalidConfigurationNeverPrintsSecrets(string connection)
    {
        using var output = new StringWriter();
        Assert.Equal(1, await DatabaseProbe.RunAsync(connection, output));
        Assert.Contains("FAILED stage=configuration", output.ToString());
        Assert.DoesNotContain("synthetic-secret", output.ToString());
    }
}
