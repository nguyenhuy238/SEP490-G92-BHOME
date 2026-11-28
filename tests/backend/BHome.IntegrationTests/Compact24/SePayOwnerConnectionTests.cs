using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using BHome.Application.PaymentsDebt;
using BHome.Application.PaymentsDebt.SePay;
using BHome.Domain.PaymentsDebt;
using BHome.Infrastructure.PaymentsDebt;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests.Compact24;

public sealed partial class SePayIntegrationTests
{
    private const string OwnerToken = "synthetic-owner-live-api-token";
    private const string OwnerSecret = "synthetic-owner-live-webhook-secret-at-least-32-bytes";
    private sealed class LinkedAccountHandler(string mode = "Live") : HttpMessageHandler
    {
        internal int Requests;
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token)
        {
            Interlocked.Increment(ref Requests);
            Assert.Equal(mode == "Test" ? "userapi-sandbox.sepay.vn" : "userapi.sepay.vn", request.RequestUri!.Host);
            Assert.Equal("/v2/bank-accounts", request.RequestUri.AbsolutePath);
            Assert.Equal("Bearer " + OwnerToken, request.Headers.Authorization!.ToString());
            Assert.Contains("active=1", request.RequestUri.Query);
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = JsonContent.Create(new
                {
                    status = "success",
                    data = new[] { new { bank_bin = "970416", account_number = Account, bank_short_name = "ACB", active = 1 } },
                    meta = new { pagination = new { has_more = false } }
                })
            });
        }
    }
    private static SePayConnectionInput OwnerInput(int accountVersion = 0, int version = 0) =>
        new("970416", "ACB", Account, "SYNTHETIC OWNER", true, true, accountVersion, version, OwnerToken, OwnerSecret);

    [CompactPostgresFact]
    public async Task OwnerManagedConnectionRetainsLegacyLocationBindingForAlreadyIssuedQr()
    {
        await using var scenario = await Create(dualMode: true);
        using var host = scenario.Host.WithWebHostBuilder(b => b.ConfigureTestServices(s =>
            s.AddHttpClient<SePayApiClient>().ConfigurePrimaryHttpMessageHandler(() => new LinkedAccountHandler("Test"))));
        using var original = await scenario.Client(scenario.Owner);
        using var owner = host.CreateClient(); owner.DefaultRequestHeaders.Authorization = original.DefaultRequestHeaders.Authorization;
        var qrRoute = $"/api/v1/invoices/{scenario.Invoice}/transfer-instructions";
        var before = (await owner.GetFromJsonAsync<TransferInstructions>(qrRoute))!;
        const string route = "/api/v1/receiving-bank-accounts/owner/sepay/Test";
        (await owner.PutAsJsonAsync(route, OwnerInput())).EnsureSuccessStatusCode();
        using var check = await owner.PostAsync(route + "/check", null); check.EnsureSuccessStatusCode();
        Assert.True((await check.Content.ReadFromJsonAsync<SePayConnectionCheck>())!.Connected);
        Assert.Equal(before, await owner.GetFromJsonAsync<TransferInstructions>(qrRoute));
        var connection = (await owner.GetFromJsonAsync<SePayConnectionView>(route))!;
        var tx = new SePayTransaction(Guid.NewGuid().ToString(), "ACB", scenario.TransactionDate, Account, null,
            scenario.Code, scenario.Code, "in", 100000, "SYN-LEGACY-BINDING-" + Guid.NewGuid(), null, null);
        var body = JsonSerializer.Serialize(tx, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        var timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString(System.Globalization.CultureInfo.InvariantCulture);
        var signature = "sha256=" + Convert.ToHexString(HMACSHA256.HashData(Encoding.UTF8.GetBytes(OwnerSecret), Encoding.UTF8.GetBytes(timestamp + "." + body)));
        using var request = new HttpRequestMessage(HttpMethod.Post, connection.WebhookPath) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
        request.Headers.Add("X-SePay-Timestamp", timestamp); request.Headers.Add("X-SePay-Signature", signature);
        using var anonymous = host.CreateClient(); (await anonymous.SendAsync(request)).EnsureSuccessStatusCode();
        await using var scope = host.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24ArchiveContext>();
        Assert.Equal(100000m, await db.Set<PaymentAllocation>().Where(a => a.InvoiceId == scenario.Invoice).SumAsync(a => a.Amount));
    }

    [CompactPostgresFact]
    public async Task OwnerCanEnableLiveConnectionWhenAllServerSePayProfilesAreDisabled()
    {
        await using var scenario = await Create(dualMode: true);
        var provider = new LinkedAccountHandler();
        using var host = scenario.Host.WithWebHostBuilder(b =>
        {
            b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?> { ["SePay:Enabled"] = "false" }));
            b.ConfigureTestServices(s => s.AddHttpClient<SePayApiClient>().ConfigurePrimaryHttpMessageHandler(() => provider));
        });
        using var original = await scenario.Client(scenario.Owner);
        using var owner = host.CreateClient(); owner.DefaultRequestHeaders.Authorization = original.DefaultRequestHeaders.Authorization;
        const string modes = "/api/v1/receiving-bank-accounts/owner/mode";
        var initial = (await owner.GetFromJsonAsync<PaymentModeView>(modes))!;
        Assert.False(initial.TestAvailable); Assert.False(initial.LiveAvailable);
        (await owner.PutAsJsonAsync(modes, new PaymentModeInput("Test", initial.Mode))).EnsureSuccessStatusCode();
        (await owner.PutAsJsonAsync(modes, new PaymentModeInput("Live", "Test"))).EnsureSuccessStatusCode();
        const string route = "/api/v1/receiving-bank-accounts/owner/sepay/Live";
        (await owner.PutAsJsonAsync(route, OwnerInput())).EnsureSuccessStatusCode();
        using var check = await owner.PostAsync(route + "/check", null); check.EnsureSuccessStatusCode();
        Assert.True((await check.Content.ReadFromJsonAsync<SePayConnectionCheck>())!.Connected);
        var invoice = await NewModeInvoice(scenario);
        var qr = (await owner.GetFromJsonAsync<TransferInstructions>($"/api/v1/invoices/{invoice.ObligationId}/transfer-instructions"))!;
        Assert.Equal("Available", qr.Availability); Assert.False(qr.IsDevelopmentDemo);
        Assert.Equal(invoice.Code, qr.TransferReference); Assert.Equal(Account, qr.AccountNumber);
        Assert.Equal(1, provider.Requests);
    }

    [CompactPostgresFact]
    public async Task OwnerCanSelectUnconfiguredLiveAndSaveEncryptedCredentialsWithoutRestart()
    {
        await using var scenario = await Create(dualMode: true);
        var provider = new LinkedAccountHandler();
        using var host = scenario.Host.WithWebHostBuilder(b =>
        {
            b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?> { ["SePay:Live:Enabled"] = "false" }));
            b.ConfigureTestServices(s => s.AddHttpClient<SePayApiClient>().ConfigurePrimaryHttpMessageHandler(() => provider));
        });
        using var originalOwner = await scenario.Client(scenario.Owner);
        using var owner = host.CreateClient(); owner.DefaultRequestHeaders.Authorization = originalOwner.DefaultRequestHeaders.Authorization;
        const string modeRoute = "/api/v1/receiving-bank-accounts/owner/mode";
        const string route = "/api/v1/receiving-bank-accounts/owner/sepay/Live";
        (await owner.PutAsJsonAsync(modeRoute, new PaymentModeInput("Live", "Test"))).EnsureSuccessStatusCode();
        Assert.Equal("Live", (await owner.GetFromJsonAsync<PaymentModeView>(modeRoute))!.Mode);
        Assert.Equal("NotConfigured", (await owner.GetFromJsonAsync<SePayConnectionView>(route))!.Status);
        using var saved = await owner.PutAsJsonAsync(route, OwnerInput()); saved.EnsureSuccessStatusCode();
        var payload = await saved.Content.ReadAsStringAsync();
        Assert.DoesNotContain(OwnerToken, payload); Assert.DoesNotContain(OwnerSecret, payload);
        var view = (await saved.Content.ReadFromJsonAsync<SePayConnectionView>())!;
        Assert.True(view.HasApiToken); Assert.True(view.HasWebhookSecret); Assert.Equal("Configured", view.Status);
        Assert.Contains(scenario.Owner.ToString(), view.WebhookPath);
        Assert.False(view.Account!.IsDevelopmentDemo);
        Assert.Equal(HttpStatusCode.Conflict, (await owner.PutAsJsonAsync(route, OwnerInput())).StatusCode);
        var checkedResponse = await owner.PostAsync(route + "/check", null); checkedResponse.EnsureSuccessStatusCode();
        Assert.True((await checkedResponse.Content.ReadFromJsonAsync<SePayConnectionCheck>())!.Connected);
        Assert.Equal(1, provider.Requests);
        view = (await owner.GetFromJsonAsync<SePayConnectionView>(route))!;
        Assert.Equal("Connected", view.Status); Assert.Equal(2, view.Version);
        await using var fresh = host.Services.CreateAsyncScope();
        var db = fresh.ServiceProvider.GetRequiredService<Compact24ArchiveContext>();
        var stored = await db.Database.SqlQuery<string>($"SELECT business_profile::text AS \"Value\" FROM users WHERE id={scenario.Owner}").SingleAsync();
        Assert.DoesNotContain(OwnerToken, stored); Assert.DoesNotContain(OwnerSecret, stored); Assert.Contains("protectedSecrets", stored);
        await fresh.ServiceProvider.GetRequiredService<ISePayOwnerConnections>().ApplyLocationAsync(scenario.Location, default);
        var options = fresh.ServiceProvider.GetRequiredService<SePayOptions>();
        Assert.True(options.For("Live").Enabled); Assert.Equal(OwnerToken, options.For("Live").ApiToken);
        var live = await NewModeInvoice(scenario);
        Assert.Equal("Live", live.Mode); Assert.False(live.AccountSnapshot!.IsDevelopmentDemo);
        var tx = new SePayTransaction(Guid.NewGuid().ToString(), "ACB", scenario.TransactionDate, Account, null,
            live.Code, live.Code, "in", 100000, "SYN-OWNER-" + Guid.NewGuid(), null, null);
        var body = JsonSerializer.Serialize(tx, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        var timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString(System.Globalization.CultureInfo.InvariantCulture);
        var signature = "sha256=" + Convert.ToHexString(HMACSHA256.HashData(Encoding.UTF8.GetBytes(OwnerSecret), Encoding.UTF8.GetBytes(timestamp + "." + body)));
        var retiredSignature = "sha256=" + Convert.ToHexString(HMACSHA256.HashData(Encoding.UTF8.GetBytes(Secret + "-live"), Encoding.UTF8.GetBytes(timestamp + "." + body)));
        using (var legacyClient = scenario.Anonymous())
        using (var retired = new HttpRequestMessage(HttpMethod.Post, "/api/v1/integrations/sepay/Live/webhook") { Content = new StringContent(body, Encoding.UTF8, "application/json") })
        {
            retired.Headers.Add("X-SePay-Timestamp", timestamp); retired.Headers.Add("X-SePay-Signature", retiredSignature);
            Assert.Equal(HttpStatusCode.Unauthorized, (await legacyClient.SendAsync(retired)).StatusCode);
            var unmatchedBody = JsonSerializer.Serialize(tx with { Code = null, Content = "Synthetic unmatched transfer" }, new JsonSerializerOptions(JsonSerializerDefaults.Web));
            using var unmatched = new HttpRequestMessage(HttpMethod.Post, "/api/v1/integrations/sepay/Live/webhook") { Content = new StringContent(unmatchedBody, Encoding.UTF8, "application/json") };
            unmatched.Headers.Add("X-SePay-Timestamp", timestamp);
            unmatched.Headers.Add("X-SePay-Signature", "sha256=" + Convert.ToHexString(HMACSHA256.HashData(Encoding.UTF8.GetBytes(Secret + "-live"), Encoding.UTF8.GetBytes(timestamp + "." + unmatchedBody))));
            Assert.Equal(HttpStatusCode.Unauthorized, (await legacyClient.SendAsync(unmatched)).StatusCode);
        }
        async Task<HttpResponseMessage> Callback(string secretSignature)
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, view.WebhookPath) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
            request.Headers.Add("X-SePay-Timestamp", timestamp); request.Headers.Add("X-SePay-Signature", secretSignature);
            using var anonymous = host.CreateClient(); return await anonymous.SendAsync(request);
        }
        Assert.Equal(HttpStatusCode.Unauthorized, (await Callback("sha256=" + new string('0', 64))).StatusCode);
        (await Callback(signature)).EnsureSuccessStatusCode(); (await Callback(signature)).EnsureSuccessStatusCode();
        Assert.Equal(100000m, await db.Set<PaymentAllocation>().Where(a => a.InvoiceId == live.ObligationId).SumAsync(a => a.Amount));
        // Existing Test QR continues to use its original channel/account and normal ledger.
        (await scenario.Send(100000)).EnsureSuccessStatusCode();
        Assert.Equal(100000m, await db.Set<PaymentAllocation>().Where(a => a.InvoiceId == scenario.Invoice).SumAsync(a => a.Amount));
        using var retained = await owner.PutAsJsonAsync(route, OwnerInput(view.Account!.Version, view.Version) with { ApiToken = null, WebhookSecret = null });
        retained.EnsureSuccessStatusCode();
        Assert.Equal("Connected", (await retained.Content.ReadFromJsonAsync<SePayConnectionView>())!.Status);
    }

    [CompactPostgresFact]
    public async Task OwnerConnectionRejectsTenantOverpostingMissingConfirmationAndSharedModeSecrets()
    {
        await using var scenario = await Create(dualMode: true);
        const string route = "/api/v1/receiving-bank-accounts/owner/sepay/Live";
        using var anonymous = scenario.Anonymous(); using var tenant = await scenario.Client(scenario.Tenants[0]);
        using var owner = await scenario.Client(scenario.Owner);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync(route)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await tenant.GetAsync(route)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await tenant.PutAsJsonAsync(route, OwnerInput())).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await tenant.PostAsync(route + "/check", null)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PutAsJsonAsync(route, OwnerInput() with { HumanVerified = false })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PutAsJsonAsync(route, OwnerInput() with { WebhookSecret = Secret })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.PutAsJsonAsync(route, OwnerInput() with { ApiToken = "bad\r\nheader" })).StatusCode);
        await using var scope = scenario.Host.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<Compact24ArchiveContext>();
        Assert.Null(await scope.ServiceProvider.GetRequiredService<IPaymentRepository>().OwnerReceivingAccountForModeAsync(scenario.Owner, "Live", default));
        Assert.False(await db.Database.SqlQuery<bool>($"SELECT business_profile ? 'sepayConnections' AS \"Value\" FROM users WHERE id={scenario.Owner}").SingleAsync());
    }
}
