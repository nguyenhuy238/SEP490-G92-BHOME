using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using BHome.Application.PaymentsDebt.SePay;
using BHome.Domain.Billing;
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Persistence;
using BHome.LocalDevelopment;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests.Compact24;

public sealed class SePaySandboxSeedTests
{
    private const string Secret = "synthetic-team-sepay-secret-at-least-32-characters";
    private const string Password = "Synthetic!SePay-Testing-891";
    private static SePayOptions Options() => new() { Enabled = true, WebhookSecret = Secret, ReceivingAccounts = [new() { LocationId = Guid.NewGuid(), BankIdentifier = "970416", Gateway = "ACB", AccountNumber = "0000001234" }] };

    [Theory]
    [InlineData("Production", "127.0.0.1", "bhome_compact24_dev_ae130000000040008000000000000001")]
    [InlineData("Development", "shared.example.invalid", "bhome_compact24_dev_ae130000000040008000000000000001")]
    [InlineData("Development", "127.0.0.1", "bhome")]
    [InlineData("Development", "127.0.0.1", "postgres")]
    public void RefusesProductionRemoteAndWorkingDatabases(string environment, string host, string database) =>
        Assert.Throws<LocalTestAccountException>(() => SePaySandboxSeed.ValidateTarget(environment, $"Host={host};Database={database}", Options(), "SYNTHETIC TEST"));

    [Fact]
    public void RefusesLiveDisabledAndMalformedReceivingConfiguration()
    {
        const string connection = "Host=127.0.0.1;Database=bhome_compact24_dev_ae130000000040008000000000000001";
        var options = Options(); options.Mode = "Live";
        Assert.Throws<LocalTestAccountException>(() => SePaySandboxSeed.ValidateTarget("Development", connection, options, "SYNTHETIC TEST"));
        options = Options(); options.Enabled = false;
        Assert.Throws<LocalTestAccountException>(() => SePaySandboxSeed.ValidateTarget("Development", connection, options, "SYNTHETIC TEST"));
        options = Options(); options.ReceivingAccounts[0].AccountNumber = "replace-with-account";
        Assert.Throws<LocalTestAccountException>(() => SePaySandboxSeed.ValidateTarget("Development", connection, options, "SYNTHETIC TEST"));
    }

    [CompactPostgresFact]
    public async Task SeedIsReplayableWithoutResettingVerifiedPaymentOrPasswords() => await InDatabase(async fixture =>
    {
        var location = Guid.NewGuid();
        using var host = fixture.Factory!.WithWebHostBuilder(builder => builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["SePay:Enabled"] = "true",
            ["SePay:WebhookSecret"] = Secret,
            ["SePay:ReceivingAccounts:0:LocationId"] = location.ToString(),
            ["SePay:ReceivingAccounts:0:BankIdentifier"] = "970416",
            ["SePay:ReceivingAccounts:0:Gateway"] = "ACB",
            ["SePay:ReceivingAccounts:0:AccountNumber"] = "0000001234",
            ["SePaySandbox:AccountHolder"] = "SYNTHETIC TEST"
        })));
        var first = await SePaySandboxSeed.RunAsync(host.Services, "Testing", Password);
        Assert.True(first.Created);
        Assert.Matches("^BH[0-9]{8}$", first.PaymentCode);
        string? hash;
        await using (var scope = host.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
            hash = await db.Users.Where(u => u.Id == SePaySandboxSeed.Id(1)).Select(u => u.PasswordHash).SingleAsync();
            Assert.Equal(2, await db.Set<InvoiceRecipient>().CountAsync(x => x.InvoiceId == first.InvoiceId));
        }
        using var client = host.CreateClient();
        var body = JsonSerializer.Serialize(new { id = 12345, gateway = "ACB", transactionDate = DateTimeOffset.UtcNow.AddSeconds(-3).ToOffset(TimeSpan.FromHours(7)).ToString("yyyy-MM-dd HH:mm:ss"), accountNumber = "0000001234", subAccount = "", code = first.PaymentCode, content = first.PaymentCode, transferType = "in", transferAmount = 2500000, referenceCode = "SYN-TEAM-SEED-1", description = first.PaymentCode, accumulated = 0 });
        var timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString(System.Globalization.CultureInfo.InvariantCulture);
        using var request = new HttpRequestMessage(HttpMethod.Post, SePayOptions.WebhookRoute) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
        request.Headers.Add("X-SePay-Timestamp", timestamp);
        request.Headers.Add("X-SePay-Signature", "sha256=" + Convert.ToHexString(HMACSHA256.HashData(Encoding.UTF8.GetBytes(Secret), Encoding.UTF8.GetBytes(timestamp + "." + body))));
        Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(request)).StatusCode);
        var replay = await SePaySandboxSeed.RunAsync(host.Services, "Testing", "Different!Synthetic-Password-546");
        Assert.False(replay.Created); Assert.Equal(first.PaymentCode, replay.PaymentCode);
        await using var verified = host.Services.CreateAsyncScope();
        var verifiedDb = verified.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        Assert.Equal(hash, await verifiedDb.Users.Where(u => u.Id == SePaySandboxSeed.Id(1)).Select(u => u.PasswordHash).SingleAsync());
        Assert.Equal(2500000m, await verifiedDb.Database.SqlQuery<decimal>($"""SELECT COALESCE(sum(amount),0) AS "Value" FROM payment_allocations WHERE target_invoice_id={first.InvoiceId}""").SingleAsync());
    });

    [CompactPostgresFact]
    public async Task RefusesExistingNonFixtureDataWithoutCreatingSyntheticUsers() => await InDatabase(async fixture =>
    {
        await using var scope = fixture.Factory!.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        db.Add(new BHome.Domain.Locations.Location("Existing unrelated fixture")); await db.SaveChangesAsync();
        // Target validation happens before writes; a valid dedicated configuration still
        // must not mix the Sandbox seed into an unrelated populated database.
        using var host = fixture.Factory.WithWebHostBuilder(builder => builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["SePay:Enabled"] = "true",
            ["SePay:WebhookSecret"] = Secret,
            ["SePay:ReceivingAccounts:0:LocationId"] = Guid.NewGuid().ToString(),
            ["SePay:ReceivingAccounts:0:BankIdentifier"] = "970416",
            ["SePay:ReceivingAccounts:0:Gateway"] = "ACB",
            ["SePay:ReceivingAccounts:0:AccountNumber"] = "0000001234",
            ["SePaySandbox:AccountHolder"] = "SYNTHETIC TEST"
        })));
        var count = await db.Users.CountAsync();
        await Assert.ThrowsAsync<LocalTestAccountException>(() => SePaySandboxSeed.RunAsync(host.Services, "Testing", Password));
        Assert.Equal(count, await db.Users.CountAsync());
    });

    private static async Task InDatabase(Func<Compact24Fixture, Task> work)
    {
        var fixture = new Compact24Fixture(); await fixture.InitializeAsync();
        try { await work(fixture); }
        finally { await fixture.DisposeAsync(); }
    }
}
