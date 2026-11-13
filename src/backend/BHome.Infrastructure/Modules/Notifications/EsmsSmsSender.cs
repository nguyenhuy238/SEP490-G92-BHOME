using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using BHome.Application.Notifications;
using Microsoft.Extensions.Options;

namespace BHome.Infrastructure.Modules.Notifications;

internal sealed class EsmsSmsSender(HttpClient client, IOptions<SmsOptions> options)
{
    internal const string SandboxContent = "Cam on quy khach da su dung dich vu cua chung toi. Chuc quy khach mot ngay tot lanh!";
    internal async Task<SmsReceipt> SendAsync(SmsMessage message, string content, CancellationToken token)
    {
        var config = options.Value;
        if (!config.Valid() || !config.Enabled || config.Mode is not ("Sandbox" or "Production"))
            throw new ChannelDeliveryException("sms_unconfigured");
        if (config.Mode == "Production" && (!config.ProductionEnabled || !config.ApprovedTemplates.Contains(message.TemplateId) ||
            string.IsNullOrWhiteSpace(config.Brandname))) throw new ChannelDeliveryException("sms_production_not_approved");
        var sandbox = config.Mode == "Sandbox";
        var body = new Dictionary<string, string>
        {
            ["ApiKey"] = config.ApiKey,
            ["SecretKey"] = config.SecretKey,
            ["Phone"] = message.Phone,
            ["Content"] = sandbox ? SandboxContent : content,
            ["Brandname"] = sandbox ? "Baotrixemay" : config.Brandname,
            ["SmsType"] = config.SmsType,
            ["IsUnicode"] = "0",
            ["Sandbox"] = sandbox ? "1" : "0",
            ["RequestId"] = SmsGateway.RequestId(message.IdempotencyKey)
        };
        if (!sandbox && !string.IsNullOrEmpty(config.CallbackUrl)) body["CallbackUrl"] = config.CallbackUrl;
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(token);
        timeout.CancelAfter(TimeSpan.FromSeconds(config.TimeoutSeconds));
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, config.BaseUrl) { Content = JsonContent.Create(body) };
            using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
            if (!response.IsSuccessStatusCode)
                throw new ChannelDeliveryException("sms_http_rejected", retryable: response.StatusCode == HttpStatusCode.TooManyRequests || (int)response.StatusCode >= 500);
            // Bounded response: do not buffer arbitrary provider/proxy bodies or propagate them to logs.
            await using var stream = await response.Content.ReadAsStreamAsync(timeout.Token);
            var bytes = new byte[16385]; var used = 0;
            while (used < bytes.Length)
            { var read = await stream.ReadAsync(bytes.AsMemory(used), timeout.Token); if (read == 0) break; used += read; }
            if (used > 16384) throw new ChannelDeliveryException("sms_response_invalid", outcomeUnknown: true);
            using var json = JsonDocument.Parse(bytes.AsMemory(0, used));
            var code = json.RootElement.TryGetProperty("CodeResult", out var result) ? result.ToString() : "";
            if (code != "100") throw new ChannelDeliveryException(code switch
            { "101" => "sms_authentication_failed", "104" => "sms_brandname_unapproved", "146" => "sms_template_unapproved", "124" => "sms_duplicate_request", _ => "sms_provider_rejected" },
                outcomeUnknown: code == "124");
            var id = json.RootElement.TryGetProperty("SMSID", out var reference) ? reference.GetString() : null;
            if (string.IsNullOrWhiteSpace(id) || id.Length > 150 || id.Any(c => !char.IsAsciiLetterOrDigit(c) && c != '-'))
                throw new ChannelDeliveryException("sms_receipt_invalid", outcomeUnknown: true);
            return new(sandbox ? "SandboxAccepted" : "ProviderAccepted", id);
        }
        catch (OperationCanceledException) when (!token.IsCancellationRequested)
        { throw new ChannelDeliveryException("sms_timeout", outcomeUnknown: true); }
        catch (HttpRequestException) { throw new ChannelDeliveryException("sms_transport_unknown", outcomeUnknown: true); }
        catch (JsonException) { throw new ChannelDeliveryException("sms_response_invalid", outcomeUnknown: true); }
        catch (IOException) { throw new ChannelDeliveryException("sms_response_unknown", outcomeUnknown: true); }
        catch (InvalidOperationException) { throw new ChannelDeliveryException("sms_response_invalid", outcomeUnknown: true); }
    }
}
