using System.Net;
using System.Text;
using System.Text.Json;
using BHome.Application.Notifications;
using BHome.Infrastructure.Modules.Notifications;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;

namespace BHome.IntegrationTests.Notifications;

public sealed class SmsGatewayTests
{
    [Theory]
    [InlineData("INVOICE_FINALIZED", "Tenant", "SMS-03")]
    [InlineData("INVOICE_FINALIZED", "Staff", null)]
    [InlineData("INVOICE_OVERDUE", "Owner", null)]
    [InlineData("CONTRACT_EXPIRY_REMINDER", "Tenant", "SMS-05")]
    [InlineData("CONTRACT_EXPIRY_REMINDER", "Owner", null)]
    [InlineData("INCIDENT_EMERGENCY_SUBMITTED", "Staff", "SMS-06")]
    [InlineData("INCIDENT_EMERGENCY_SUBMITTED", "Tenant", null)]
    [InlineData("CONTRACT_SIGNING_REQUIRED", "Tenant", null)]
    [InlineData("CONTRACT_SIGNING_INVITATION", "Tenant", "SMS-02")]
    [InlineData("TEMPORARY_RESIDENCE_ACTION", "Tenant", null)]
    public void CriticalSmsPolicyRejectsIneligibleRolesAndRoutineEvents(string eventType, string role, string? template)
        => Assert.Equal(template, SmsNotificationPolicy.Template(eventType, role));
    [Theory]
    [InlineData("0901 234 567", "84901234567")]
    [InlineData("+84 (901) 234-567", "84901234567")]
    [InlineData("84901234567", "84901234567")]
    [InlineData("19001234", null)]
    [InlineData("+12025550123", null)]
    [InlineData("0901234567abc", null)]
    [InlineData("084901234567", null)]
    public void PhoneNormalization(string input, string? expected) => Assert.Equal(expected, VietnameseSmsPhone.Normalize(input));

    [Theory]
    [InlineData("Mock", false, true)]
    [InlineData("Sandbox", false, false)]
    [InlineData("Production", false, false)]
    public void ConfigurationRequiresCredentialsOutsideMock(string mode, bool production, bool valid)
        => Assert.Equal(valid, new SmsOptions { Enabled = true, Mode = mode, ProductionEnabled = production }.Valid());

    [Fact]
    public void TemplatesValidateVariablesAndNormalizeVietnameseWithoutTokens()
    {
        var text = SmsTemplates.Render("SMS-06", new Dictionary<string, string> { ["LOCATION"] = "Cơ sở Đà Nẵng\n", ["ROOM"] = "A-101" });
        Assert.Contains("Co so Da Nang", text); Assert.DoesNotContain('\n', text);
        Assert.Throws<ChannelDeliveryException>(() => SmsTemplates.Render("SMS-03", new Dictionary<string, string>()));
        Assert.Throws<ChannelDeliveryException>(() => SmsTemplates.Render("unknown", new Dictionary<string, string>()));
    }

    internal static SmsOptions Config(string mode = "Sandbox") => new()
    { Enabled = true, Mode = mode, ApiKey = "synthetic-api", SecretKey = "synthetic-secret", EnabledTemplates = ["SMS-01", "SMS-03"] };
    internal static SmsMessage Message(Guid? recipient = null, string key = "synthetic-request") =>
        new(recipient ?? Guid.NewGuid(), "84901234567", "SMS-01", new Dictionary<string, string> { ["OTP"] = "123456", ["MINUTES"] = "5" }, key);

    [Fact]
    public async Task SandboxMapsTheOfficialContractAndReportsAcceptanceOnly()
    {
        string? payload = null;
        using var client = new HttpClient(new Handler(async (request, t) =>
        {
            payload = await request.Content!.ReadAsStringAsync(t);
            Assert.Equal(HttpMethod.Post, request.Method);
            return Reply("{\"CodeResult\":\"100\",\"SMSID\":\"synthetic-id\"}");
        }));
        var receipt = await new EsmsSmsSender(client, Options.Create(Config())).SendAsync(Message(), "unapproved BHOME content", default);
        Assert.Equal("SandboxAccepted", receipt.Status);
        using var json = JsonDocument.Parse(payload!); var body = json.RootElement;
        Assert.Equal("1", body.GetProperty("Sandbox").GetString());
        Assert.Equal("Baotrixemay", body.GetProperty("Brandname").GetString());
        Assert.Equal(EsmsSmsSender.SandboxContent, body.GetProperty("Content").GetString());
        Assert.Equal("2", body.GetProperty("SmsType").GetString());
        Assert.Equal("84901234567", body.GetProperty("Phone").GetString());
        Assert.Equal(SmsGateway.RequestId("synthetic-request"), body.GetProperty("RequestId").GetString());
        Assert.False(body.TryGetProperty("CallbackUrl", out _));
    }

    [Theory]
    [InlineData("101", false)]
    [InlineData("104", false)]
    [InlineData("146", false)]
    [InlineData("124", true)]
    public async Task RejectionsNeverExposeProviderMessagesOrBlindlyRetry(string code, bool unknown)
    {
        using var client = new HttpClient(new Handler((_, _) => Task.FromResult(Reply($"{{\"CodeResult\":\"{code}\",\"ErrorMessage\":\"PRIVATE_PROVIDER_DATA\"}}"))));
        var error = await Assert.ThrowsAsync<ChannelDeliveryException>(() => new EsmsSmsSender(client, Options.Create(Config())).SendAsync(Message(), "test", default));
        Assert.False(error.Retryable); Assert.Equal(unknown, error.OutcomeUnknown);
        Assert.DoesNotContain("PRIVATE_PROVIDER_DATA", error.ToString()); Assert.Null(error.InnerException);
    }

    [Theory]
    [InlineData(429, true)]
    [InlineData(503, true)]
    [InlineData(401, false)]
    public async Task HttpRejectionsHaveExplicitRetryEligibility(int status, bool retryable)
    {
        using var client = new HttpClient(new Handler((_, _) => Task.FromResult(new HttpResponseMessage((HttpStatusCode)status))));
        var error = await Assert.ThrowsAsync<ChannelDeliveryException>(() => new EsmsSmsSender(client, Options.Create(Config())).SendAsync(Message(), "test", default));
        Assert.Equal(retryable, error.Retryable);
    }

    [Fact]
    public async Task TimeoutIsUnknownAndCallerCancellationIsPreserved()
    {
        using var client = new HttpClient(new Handler(async (_, t) => { await Task.Delay(Timeout.Infinite, t); return Reply("{}"); }));
        var config = Config(); config.TimeoutSeconds = 1;
        var sender = new EsmsSmsSender(client, Options.Create(config));
        Assert.True((await Assert.ThrowsAsync<ChannelDeliveryException>(() => sender.SendAsync(Message(), "test", default))).OutcomeUnknown);
        using var cancelled = new CancellationTokenSource(); cancelled.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => sender.SendAsync(Message(), "test", cancelled.Token));
    }

    [Fact]
    public async Task ProductionRequiresExplicitSwitchBrandnameAndTemplateApproval()
    {
        var calls = 0;
        using var client = new HttpClient(new Handler((_, _) => { calls++; return Task.FromResult(Reply("{}")); }));
        var config = Config("Production"); var sender = new EsmsSmsSender(client, Options.Create(config));
        await Assert.ThrowsAsync<ChannelDeliveryException>(() => sender.SendAsync(Message(), "test", default));
        config.ProductionEnabled = true; config.Brandname = "BHOME";
        await Assert.ThrowsAsync<ChannelDeliveryException>(() => sender.SendAsync(Message(), "test", default));
        Assert.Equal(0, calls);
    }

    [Fact]
    public void MockInboxRequiresIsolationAndAllowlistDeduplicatesAndExpiresOtpContent()
    {
        var clock = new Clock(); var id = Guid.NewGuid();
        var config = Config("Mock"); config.DemoIsolated = true; config.DemoAccounts[id.ToString()] = "0901234567";
        var inbox = new DemoSmsInbox(Options.Create(config), new Environment("Development"), clock);
        var message = Message(id) with { ExpiresAt = clock.GetUtcNow().AddMinutes(5) };
        var receipt = inbox.Add(message, "synthetic OTP");
        Assert.Equal(receipt, inbox.Add(message, "synthetic OTP")); Assert.Single(inbox.List());
        clock.Now = clock.Now.AddMinutes(5); Assert.Empty(inbox.List());
        Assert.Equal(receipt, inbox.Add(message, "synthetic OTP")); Assert.Empty(inbox.List());
        Assert.Throws<ChannelDeliveryException>(() => inbox.Add(Message(), "test"));
        var production = new DemoSmsInbox(Options.Create(config), new Environment("Production"), clock);
        Assert.Throws<ChannelDeliveryException>(() => production.Add(message, "test")); Assert.Empty(production.List());
    }

    private static HttpResponseMessage Reply(string body) => new(HttpStatusCode.OK) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
    private sealed class Handler(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> send) : HttpMessageHandler
    { protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) => send(request, cancellationToken); }
    internal sealed class Clock : TimeProvider { public DateTimeOffset Now = DateTimeOffset.UtcNow; public override DateTimeOffset GetUtcNow() => Now; }
    internal sealed class Environment(string name) : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = name;
        public string ApplicationName { get; set; } = "BHome";
        public string ContentRootPath { get; set; } = ".";
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }
}
