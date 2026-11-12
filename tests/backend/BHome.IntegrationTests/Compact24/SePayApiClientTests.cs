using System.Net;
using System.Text.Json;
using BHome.Application.Common;
using BHome.Application.PaymentsDebt.SePay;
using BHome.Infrastructure.PaymentsDebt;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;

namespace BHome.IntegrationTests.Compact24;

public sealed class SePayApiClientTests
{
    private sealed class Server : IAsyncDisposable
    {
        private readonly WebApplication app;
        internal int Requests { get; private set; }
        internal string? Authorization { get; private set; }
        internal string? Query { get; private set; }
        internal Uri Address => new(app.Urls.Single() + "/v2/");
        internal Server(Func<HttpContext, Task> respond)
        {
            var builder = WebApplication.CreateBuilder(); builder.Logging.ClearProviders(); builder.WebHost.UseUrls("http://127.0.0.1:0");
            app = builder.Build();
            app.MapGet("/v2/transactions", async context => { Requests++; Authorization = context.Request.Headers.Authorization; Query = context.Request.QueryString.Value; await respond(context); });
        }
        internal Task Start() => app.StartAsync();
        public ValueTask DisposeAsync() => app.DisposeAsync();
    }
    private static SePayOptions Options() => new() { Enabled = true, ApiToken = "synthetic-only-token", RequestTimeoutSeconds = 1 };
    internal static object ProviderResponse(bool more = false, int page = 1) => new
    {
        status = "success",
        data = new[] { new { id = "b206209a-e3a8-432a-a3b1-57956a266921", transaction_date = DateTimeOffset.UtcNow.AddMinutes(-1).ToString("O"), account_number = "0000001234",
            va = (string?)null, amount_in = 100000, amount_out = 0, accumulated = 100000, transaction_content = "BH12345678", reference_number = "SYN-API-1", code = "BH12345678", bank_brand_name = "ACB", transfer_type = "in" } },
        meta = new { pagination = new { current_page = page, has_more = more } }
    };
    [Fact]
    public async Task RealHttpClientSendsBearerAndParsesProviderPagination()
    {
        await using var server = new Server(context => context.Response.WriteAsJsonAsync(ProviderResponse(more: true, page: 2))); await server.Start();
        using var http = new HttpClient { BaseAddress = server.Address, Timeout = TimeSpan.FromSeconds(5) };
        var client = new SePayApiClient(http, Options(), TimeProvider.System);
        var result = await client.GetAsync(new SePayPollingCursor("34d7b527-6209-4a2b-b451-ab9937e5c991", 2), default);
        Assert.True(result.HasMore); Assert.Equal(100000, Assert.Single(result.Items).TransferAmount);
        Assert.Equal("Bearer synthetic-only-token", server.Authorization); Assert.Equal(1, server.Requests);
        Assert.Contains("transaction_date_sort=asc", server.Query); Assert.Contains("page=2", server.Query); Assert.Contains("since_id=34d7b527", server.Query);
    }
    [Theory]
    [InlineData(401)]
    [InlineData(403)]
    [InlineData(429)]
    [InlineData(500)]
    public async Task ProviderFailuresRemainFailures(int status)
    {
        await using var server = new Server(context => { context.Response.StatusCode = status; return context.Response.WriteAsync("<html>Unavailable</html>"); }); await server.Start();
        using var http = new HttpClient { BaseAddress = server.Address };
        await Assert.ThrowsAsync<IntegrationUnavailableException>(() => new SePayApiClient(http, Options(), TimeProvider.System).GetAsync(new(), default));
        Assert.Equal(1, server.Requests);
    }
    [Fact]
    public async Task MalformedResponseDoesNotAdvanceCursor()
    {
        await using var server = new Server(context => context.Response.WriteAsync("{\"status\":\"success\",\"data\":[]}")); await server.Start();
        using var http = new HttpClient { BaseAddress = server.Address };
        await Assert.ThrowsAsync<IntegrationUnavailableException>(() => new SePayApiClient(http, Options(), TimeProvider.System).GetAsync(new(), default));
    }
    [Fact]
    public async Task ResponseBodyTimeoutCancelsTheHttpRead()
    {
        await using var server = new Server(async context => { context.Response.StatusCode = 200; await context.Response.WriteAsync("{"); await context.Response.Body.FlushAsync(); await Task.Delay(5000, context.RequestAborted); }); await server.Start();
        using var http = new HttpClient { BaseAddress = server.Address };
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => new SePayApiClient(http, Options(), TimeProvider.System).GetAsync(new(), default));
    }
    [Fact]
    public async Task ProviderContractSmokeCanUseTheLocalPostmanSimulation()
    {
        var simulation = Environment.GetEnvironmentVariable("BHOME_SEPAY_SIMULATION_URL");
        await using var server = new Server(context => context.Response.WriteAsJsonAsync(ProviderResponse())); await server.Start();
        using var http = new HttpClient { BaseAddress = simulation is null ? server.Address : new Uri(simulation) };
        var result = await new SePayApiClient(http, Options(), TimeProvider.System).GetAsync(new(), default);
        Assert.Equal("SYN-API-1", Assert.Single(result.Items).ReferenceCode);
    }
}
