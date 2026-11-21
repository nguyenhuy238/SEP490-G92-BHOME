using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using BHome.Application.Notifications;
using BHome.Infrastructure.Modules.Notifications;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using NSubstitute;

namespace BHome.Infrastructure.UnitTests.Notifications;

public sealed class ExpoPushSenderTests
{
    private const string Device = "ExpoPushToken[aaaaaaaaaaaaaaaaaaaaaaaa]";
    private const string AccessToken = "synthetic-push-credential";
    private const string Ticket = "1bc840b1-220a-4c9e-963e-dc462843a219";
    private static readonly ChannelMessage Message = new("channel/123/device", "PUSH", Device,
        "INVOICE_FINALIZED", "Hóa đơn đã phát hành", "Mở BHOME để xem hóa đơn.");

    [Fact]
    public void DefaultsRemainUnconfiguredAndInvalidEnabledOptionsFailValidation()
    {
        var defaults = new ExpoPushOptions();
        Assert.False(defaults.Enabled);
        Assert.True(defaults.Valid());
        Assert.False(new ExpoPushOptions { Enabled = true }.Valid());
        Assert.False(new ExpoPushOptions { Enabled = true, AccessToken = AccessToken, TimeoutSeconds = 0 }.Valid());
        Assert.False(new ExpoPushOptions { Enabled = true, AccessToken = "bad\nsecret" }.Valid());
        Assert.True(new ExpoPushOptions { Enabled = true, AccessToken = AccessToken }.Valid());
    }

    [Theory]
    [InlineData("ExpoPushToken[aaaaaaaaaaaaaaaaaaaaaaaa]", true)]
    [InlineData("ExponentPushToken[aaaaaaaaaaaaaaaaaaaa]", true)]
    [InlineData("ExponentPushToken[1234567890_-]", true)]
    [InlineData("anything", false)]
    [InlineData("ExpoPushToken[]", false)]
    [InlineData("ExpoPushToken[aaa aaa aaa]", false)]
    [InlineData("ExpoPushToken[aaaa]/--/api/v2/push/send", false)]
    public void RestrictsDestinationsToExpoPushTokens(string candidate, bool expected) =>
        Assert.Equal(expected, ExpoPushSender.ValidToken(candidate));

    [Fact]
    public async Task ActualExpoSubmissionRequiresExplicitEnablementAndReturnsOnlyARealTicket()
    {
        var handler = new StubHandler(async request =>
        {
            Assert.Equal(HttpMethod.Post, request.Method);
            Assert.Equal("https://exp.host/--/api/v2/push/send", request.RequestUri!.AbsoluteUri);
            Assert.Equal("Bearer", request.Headers.Authorization?.Scheme);
            Assert.Equal(AccessToken, request.Headers.Authorization?.Parameter);
            Assert.Equal("application/json", request.Content!.Headers.ContentType?.MediaType);
            var json = await request.Content.ReadAsStringAsync();
            using var body = JsonDocument.Parse(json);
            Assert.Equal(Device, body.RootElement.GetProperty("to").GetString());
            Assert.Equal("INVOICE_FINALIZED", body.RootElement.GetProperty("data").GetProperty("eventType").GetString());
            Assert.DoesNotContain(AccessToken, json, StringComparison.Ordinal);
            return Json(HttpStatusCode.OK, $$$"""{"data":{"status":"ok","id":"{{{Ticket}}}"}}""");
        });
        var provider = Sender(handler);
        Assert.True(provider.IsConfigured);
        Assert.Equal("expo-ticket:" + Ticket, await provider.SendAsync(Message, CancellationToken.None));
        Assert.Equal(1, handler.Calls);
        Assert.DoesNotContain(Device, "expo-ticket:" + Ticket);

        var disabled = Sender(handler, enabled: false);
        Assert.False(disabled.IsConfigured);
        var failure = await Assert.ThrowsAsync<ChannelDeliveryException>(() => disabled.SendAsync(Message, default));
        Assert.Equal("push_unconfigured", failure.Code);
        Assert.Equal(1, handler.Calls);
    }

    [Theory]
    [InlineData("""{"data":{"status":"error","details":{"error":"DeviceNotRegistered"},"message":"private push token"}}""",
        "push_device_not_registered", false, false)]
    [InlineData("""{"data":{"status":"error","details":{"error":"MessageTooBig"}}}""",
        "push_payload_too_large", false, false)]
    [InlineData("""{"data":[{"status":"error","details":{"error":"InvalidCredentials"}}]}""",
        "push_credentials_invalid", false, false)]
    [InlineData("""{"data":{"status":"ok"}}""", "push_ticket_invalid", false, true)]
    [InlineData("""{"data":{"status":"unexpected"}}""", "push_ticket_invalid", false, true)]
    [InlineData("""{"errors":[{"code":"TOO_MANY_REQUESTS","message":"private response"}]}""",
        "push_rate_limited", true, false)]
    [InlineData("""{"data":{"status":"ok","id":"1bc840b1-220a-4c9e-963e-dc462843a219"},"errors":[{"code":"UNAUTHORIZED"}]}""",
        "push_provider_rejected", false, false)]
    public async Task RejectedTicketsAndAmbiguousResponsesNeverProduceSuccess(
        string payload, string code, bool retryable, bool unknown)
    {
        var provider = Sender(new StubHandler(_ => Task.FromResult(Json(HttpStatusCode.OK, payload))));
        var failure = await Assert.ThrowsAsync<ChannelDeliveryException>(() => provider.SendAsync(Message, default));
        Assert.Equal(code, failure.Code);
        Assert.Equal(retryable, failure.Retryable);
        Assert.Equal(unknown, failure.OutcomeUnknown);
        Assert.Equal("Notification channel delivery failed.", failure.Message);
    }

    [Theory]
    [InlineData(HttpStatusCode.BadRequest, "push_request_rejected", false, false)]
    [InlineData(HttpStatusCode.Unauthorized, "push_provider_unauthorized", false, false)]
    [InlineData(HttpStatusCode.TooManyRequests, "push_rate_limited", true, false)]
    [InlineData(HttpStatusCode.ServiceUnavailable, "push_submission_outcome_unknown", false, true)]
    public async Task HttpErrorsPreserveSafeRetryAndUnknownOutcomeSemantics(HttpStatusCode status,
        string code, bool retryable, bool unknown)
    {
        var provider = Sender(new StubHandler(_ => Task.FromResult(Json(status,
            """{"message":"private diagnostic never exposed"}"""))));
        var failure = await Assert.ThrowsAsync<ChannelDeliveryException>(() => provider.SendAsync(Message, default));
        Assert.Equal(code, failure.Code);
        Assert.Equal(retryable, failure.Retryable);
        Assert.Equal(unknown, failure.OutcomeUnknown);
        Assert.DoesNotContain("private", failure.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ConnectionFailureAfterPostDoesNotRetryUncertainSend()
    {
        var sender = Sender(new StubHandler(_ => throw new HttpRequestException("sensitive details")));
        var failure = await Assert.ThrowsAsync<ChannelDeliveryException>(() => sender.SendAsync(Message, default));
        Assert.True(failure.OutcomeUnknown);
        Assert.False(failure.Retryable);
        Assert.Equal("push_submission_outcome_unknown", failure.Code);
    }

    [Fact]
    public async Task ProviderNeverSubmitsInvalidTokenOrPayload()
    {
        var handler = new StubHandler(_ => Task.FromResult(Json(HttpStatusCode.OK,
            $$$"""{"data":{"status":"ok","id":"{{{Ticket}}}"}}""")));
        var sender = Sender(handler);
        var invalid = await Assert.ThrowsAsync<ChannelDeliveryException>(() =>
            sender.SendAsync(Message with { Destination = "not-an-expo-token" }, default));
        Assert.Equal("push_token_invalid", invalid.Code);
        var payload = await Assert.ThrowsAsync<ChannelDeliveryException>(() =>
            sender.SendAsync(Message with { Title = " " }, default));
        Assert.Equal("push_payload_invalid", payload.Code);
        Assert.Equal(0, handler.Calls);
    }

    [Fact]
    public void ChannelRouterDoesNotDeclareProductionPushOrEmailConfiguredWithoutCredentials()
    {
        var handler = new StubHandler(_ => Task.FromResult(Json(HttpStatusCode.OK,
            $$$"""{"data":{"status":"ok","id":"{{{Ticket}}}"}}""")));
        var sms = Substitute.For<ISmsSender>();
        sms.IsConfigured.Returns(false);
        var production = Substitute.For<IHostEnvironment>();
        production.EnvironmentName.Returns(Environments.Production);
        var email = new MailKitEmailSender(Options.Create(new EmailOptions()),
            NullLogger<MailKitEmailSender>.Instance, production);
        var disabledPush = Sender(handler, false);
        var channel = new NotificationChannelProvider(Options.Create(new NotificationChannelOptions()), production,
            email, disabledPush, sms);
        Assert.False(channel.IsConfigured("PUSH"));
        Assert.False(channel.IsConfigured("EMAIL"));
        Assert.False(channel.IsConfigured("unknown"));
        Assert.False(channel.SupportsIdempotency("PUSH"));

        var enabledChannel = new NotificationChannelProvider(Options.Create(new NotificationChannelOptions()), production,
            email, Sender(handler), sms);
        Assert.True(enabledChannel.IsConfigured("PUSH"));
        Assert.False(enabledChannel.SupportsIdempotency("PUSH"));
    }

    private static ExpoPushSender Sender(StubHandler handler, bool enabled = true) =>
        new(new HttpClient(handler), Options.Create(new ExpoPushOptions
        {
            Enabled = enabled,
            AccessToken = enabled ? AccessToken : "",
            TimeoutSeconds = 5
        }));

    private static HttpResponseMessage Json(HttpStatusCode status, string value) =>
        new(status) { Content = new StringContent(value, Encoding.UTF8, "application/json") };

    private sealed class StubHandler(Func<HttpRequestMessage, Task<HttpResponseMessage>> response) : HttpMessageHandler
    {
        public int Calls { get; private set; }
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Calls++;
            return response(request);
        }
    }
}
