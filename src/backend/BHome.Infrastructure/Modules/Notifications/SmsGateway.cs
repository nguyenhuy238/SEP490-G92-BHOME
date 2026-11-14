using System.Security.Cryptography;
using System.Text;
using BHome.Application.Notifications;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;

namespace BHome.Infrastructure.Modules.Notifications;

internal sealed class SmsGateway(IOptions<SmsOptions> options, IHostEnvironment environment,
    MockSmsSender mock, EsmsSmsSender esms) : ISmsSender
{
    public bool IsConfigured => options.Value.Enabled && options.Value.Valid() &&
        (options.Value.Mode != "Mock" || options.Value.MockAllowed(environment.EnvironmentName));

    public async Task<SmsReceipt> SendAsync(SmsMessage message, CancellationToken token)
    {
        if (!IsConfigured) throw new ChannelDeliveryException("sms_unconfigured");
        var config = options.Value;
        if (!config.EnabledTemplates.Contains(message.TemplateId)) throw new ChannelDeliveryException("sms_event_disabled");
        var phone = VietnameseSmsPhone.Normalize(message.Phone) ?? throw new ChannelDeliveryException("sms_phone_invalid");
        if (string.IsNullOrWhiteSpace(message.IdempotencyKey) || message.IdempotencyKey.Length > 500)
            throw new ChannelDeliveryException("sms_request_id_invalid");
        var content = SmsTemplates.Render(message.TemplateId, message.Variables);
        if (config.Mode == "Mock") return await mock.SendAsync(message with { Phone = phone }, content, token);
        if (config.Mode == "Production" && (!config.ProductionEnabled || string.IsNullOrWhiteSpace(config.Brandname) ||
            !config.ApprovedTemplates.Contains(message.TemplateId))) throw new ChannelDeliveryException("sms_production_not_approved");
        return await esms.SendAsync(message with { Phone = phone }, content, token);
    }

    // eSMS RequestId has a maximum of 50 characters and a 24-hour deduplication window.
    internal static string RequestId(string key) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(key)))[..40];
}
