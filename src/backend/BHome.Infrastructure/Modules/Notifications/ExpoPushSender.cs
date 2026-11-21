using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using BHome.Application.Notifications;
using Microsoft.Extensions.Options;

namespace BHome.Infrastructure.Modules.Notifications;

// Expo returns a submission ticket, not proof that the handset received a notification.
// The existing outbox owns retries and leases; this adapter never retries a POST.
internal sealed class ExpoPushOptions
{
    public bool Enabled { get; set; }
    public string AccessToken { get; set; } = "";
    public int TimeoutSeconds { get; set; } = 15;

    public bool Valid() => !Enabled ||
        (!string.IsNullOrWhiteSpace(AccessToken) && AccessToken.Length <= 4096 &&
         !AccessToken.Any(char.IsWhiteSpace) && TimeoutSeconds is >= 1 and <= 45);
}

internal sealed class ExpoPushSender(HttpClient http, IOptions<ExpoPushOptions> options)
{
    private static readonly Uri Endpoint = new("https://exp.host/--/api/v2/push/send");
    internal bool IsConfigured => options.Value.Enabled && options.Value.Valid();

    internal async Task<string> SendAsync(ChannelMessage message, CancellationToken token)
    {
        if (!IsConfigured) throw new ChannelDeliveryException("push_unconfigured");
        if (!ValidToken(message.Destination)) throw new ChannelDeliveryException("push_token_invalid");
        if (string.IsNullOrWhiteSpace(message.Title) || string.IsNullOrWhiteSpace(message.Body) ||
            message.Title.Length > 150 || message.Body.Length > 3000)
            throw new ChannelDeliveryException("push_payload_invalid");

        using var request = new HttpRequestMessage(HttpMethod.Post, Endpoint)
        {
            Content = JsonContent.Create(new
            {
                to = message.Destination,
                title = message.Title,
                body = message.Body,
                data = new { eventType = message.EventType }
            })
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", options.Value.AccessToken);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

        // Never log provider bodies, tokens, Authorization headers or exception messages.
        try
        {
            using var deadline = CancellationTokenSource.CreateLinkedTokenSource(token);
            deadline.CancelAfter(TimeSpan.FromSeconds(options.Value.TimeoutSeconds));
            using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, deadline.Token);
            if (!response.IsSuccessStatusCode) throw StatusError(response.StatusCode);

            // A successful HTTP status alone is insufficient. Expo must return an ok ticket + ID.
            await using var stream = await response.Content.ReadAsStreamAsync(deadline.Token);
            using var bounded = new MemoryStream();
            var buffer = new byte[4096];
            while (true)
            {
                var count = await stream.ReadAsync(buffer, deadline.Token);
                if (count == 0) break;
                if (bounded.Length + count > 32 * 1024)
                    throw new ChannelDeliveryException("push_ticket_invalid", outcomeUnknown: true);
                bounded.Write(buffer, 0, count);
            }
            bounded.Position = 0;
            using var body = await JsonDocument.ParseAsync(bounded,
                new JsonDocumentOptions { MaxDepth = 8 }, deadline.Token);
            return ParseTicket(body.RootElement);
        }
        catch (ChannelDeliveryException) { throw; }
        catch (Exception e) when (e is HttpRequestException or IOException or OperationCanceledException or
                                  JsonException or NotSupportedException)
        {
            // Once the POST is attempted, the network may fail after Expo accepted it.
            // Expo has no submission idempotency key; an automatic retry can duplicate a push.
            throw new ChannelDeliveryException("push_submission_outcome_unknown", outcomeUnknown: true);
        }
    }

    internal static bool ValidToken(string? token)
    {
        if (token is null || token.Length is < 20 or > 256) return false;
        var prefix = token.StartsWith("ExpoPushToken[", StringComparison.Ordinal)
            ? "ExpoPushToken[" : token.StartsWith("ExponentPushToken[", StringComparison.Ordinal)
                ? "ExponentPushToken[" : null;
        if (prefix is null || token[^1] != ']') return false;
        var inner = token.AsSpan(prefix.Length, token.Length - prefix.Length - 1);
        return inner.Length is >= 8 and <= 220 &&
            inner.ToString().All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_');
    }

    internal static ChannelDeliveryException StatusError(HttpStatusCode status) => (int)status switch
    {
        400 or 413 or 422 => new("push_request_rejected"),
        401 or 403 => new("push_provider_unauthorized"),
        429 => new("push_rate_limited", retryable: true),
        // For server-side failures we cannot prove Expo did not enqueue the request.
        _ => new("push_submission_outcome_unknown", outcomeUnknown: true)
    };

    internal static string ParseTicket(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
            throw new ChannelDeliveryException("push_ticket_missing", outcomeUnknown: true);
        if (root.TryGetProperty("errors", out var errors) && errors.ValueKind == JsonValueKind.Array &&
            errors.GetArrayLength() > 0)
        {
            var first = errors[0];
            var code = first.ValueKind == JsonValueKind.Object &&
                       first.TryGetProperty("code", out var parsed) &&
                       parsed.ValueKind == JsonValueKind.String ? parsed.GetString() : null;
            throw code == "TOO_MANY_REQUESTS"
                ? new ChannelDeliveryException("push_rate_limited", retryable: true)
                : new ChannelDeliveryException("push_provider_rejected");
        }
        if (!root.TryGetProperty("data", out var data))
            throw new ChannelDeliveryException("push_ticket_missing", outcomeUnknown: true);

        // Expo supports both one-object and one-element-array responses.
        if (data.ValueKind == JsonValueKind.Array)
        {
            if (data.GetArrayLength() != 1)
                throw new ChannelDeliveryException("push_ticket_missing", outcomeUnknown: true);
            data = data[0];
        }
        if (data.ValueKind != JsonValueKind.Object ||
            !data.TryGetProperty("status", out var value) ||
            value.ValueKind != JsonValueKind.String)
            throw new ChannelDeliveryException("push_ticket_missing", outcomeUnknown: true);
        var status = value.GetString();
        if (status == "error")
        {
            var reason = data.TryGetProperty("details", out var details) &&
                         details.ValueKind == JsonValueKind.Object &&
                         details.TryGetProperty("error", out var error) &&
                         error.ValueKind == JsonValueKind.String ? error.GetString() : null;
            throw reason switch
            {
                "DeviceNotRegistered" => new ChannelDeliveryException("push_device_not_registered"),
                "MessageTooBig" => new ChannelDeliveryException("push_payload_too_large"),
                "MismatchSenderId" or "InvalidCredentials" => new ChannelDeliveryException("push_credentials_invalid"),
                _ => new ChannelDeliveryException("push_ticket_rejected")
            };
        }
        if (status != "ok" || !data.TryGetProperty("id", out var id) ||
            id.ValueKind != JsonValueKind.String || !Guid.TryParse(id.GetString(), out var ticket))
            throw new ChannelDeliveryException("push_ticket_invalid", outcomeUnknown: true);
        return "expo-ticket:" + ticket.ToString("D");
    }
}
