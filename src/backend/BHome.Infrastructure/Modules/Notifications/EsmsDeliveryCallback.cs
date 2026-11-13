using System.Net;
using BHome.Application.Notifications;
using Microsoft.Extensions.Options;

namespace BHome.Infrastructure.Modules.Notifications;

public sealed record EsmsDeliveryReport(string SMSID, string RequestId, int SendStatus, int SendSuccess, int SendFailed, int TotalReceiver, int TypeId);

public sealed class EsmsDeliveryCallback
{
    private readonly CompactNotificationWriter sql;
    private readonly SmsOptions options;
    internal EsmsDeliveryCallback(CompactNotificationWriter sql, IOptions<SmsOptions> options) { this.sql = sql; this.options = options.Value; }
    public static bool TrustedSource(IPAddress? address) => address?.MapToIPv4().ToString() is "103.29.26.39" or "103.29.26.80" or "103.29.27.39";
    public async Task<bool> ApplyAsync(EsmsDeliveryReport report, IPAddress? source, CancellationToken t)
    {
        if (!options.Enabled || options.Mode != "Production" || !options.ProductionEnabled || !TrustedSource(source) ||
            report.RequestId.Length != 40 || report.RequestId.Any(c => !char.IsAsciiHexDigit(c)) || report.SMSID.Length is < 1 or > 150 ||
            report.SMSID.Any(c => !char.IsAsciiLetterOrDigit(c) && c != '-') || report.TypeId != 2 || report.TotalReceiver != 1 ||
            report.SendSuccess < 0 || report.SendFailed < 0 || report.SendSuccess + report.SendFailed > 1 ||
            report.SendStatus is not (4 or 5) || report.SendStatus == 5 && report.SendSuccess + report.SendFailed != 1) return false;
        var state = report.SendStatus == 5 && report.SendSuccess == 1 ? "Delivered" : "Failed";
        var history = System.Text.Json.JsonSerializer.Serialize(new { recordType = "SmsDeliveryReport", requestId = report.RequestId, providerReference = report.SMSID, state, at = sql.Now }, CompactNotificationWriter.Json);
        // Conditional single transition also handles callbacks arriving before SendAsync returns.
        var updated = await sql.Execute("""
            UPDATE notifications SET delivery_status=CASE WHEN event_data->>'recordType'='SmsRecoveryChallenge' THEN delivery_status ELSE @state END,locked_until=NULL,lease_token=NULL,next_delivery_at=NULL,
              delivery_history=delivery_history||jsonb_build_array(@history::jsonb)
            WHERE record_kind='OUTBOX' AND event_data->>'channel'='SMS' AND
              (delivery_status IN ('Processing','ProviderAccepted','PendingReview') OR event_data->>'recordType'='SmsRecoveryChallenge')
              AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(delivery_history) h WHERE h->>'recordType'='SmsDeliveryReport')
              AND EXISTS(SELECT 1 FROM jsonb_array_elements(delivery_history) h WHERE h->>'recordType'='SmsSubmission' AND h->>'requestId'=@request)
              AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(delivery_history) h WHERE h->>'recordType'='ChannelAttempt'
                AND h->>'providerReference' IS NOT NULL AND h->>'providerReference'<>@provider)
            """, t, ("state", state), ("history", history), ("request", report.RequestId), ("provider", report.SMSID));
        if (updated > 0) return true;
        return await sql.Scalar<bool>("""
            SELECT EXISTS(SELECT 1 FROM notifications n CROSS JOIN LATERAL jsonb_array_elements(n.delivery_history) h
              WHERE n.record_kind='OUTBOX' AND h->>'recordType'='SmsDeliveryReport' AND h->>'requestId'=@request AND h->>'providerReference'=@provider)
            """, t, ("request", report.RequestId), ("provider", report.SMSID));
    }
}
