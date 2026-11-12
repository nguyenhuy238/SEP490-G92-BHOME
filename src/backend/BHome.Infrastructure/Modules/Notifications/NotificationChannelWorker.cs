using System.Text.Json;
using BHome.Application.Billing;
using BHome.Application.Jobs;
using BHome.Application.Notifications;
using BHome.Domain.Billing;
using BHome.Infrastructure.Billing;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace BHome.Infrastructure.Modules.Notifications;

// One durable OUTBOX delivery per inbox/channel; retries never recreate the inbox.
internal sealed class NotificationChannelWorker(Compact24DbContext db, CompactNotificationWriter sql, INotificationRepository inbox,
    INotificationChannelProvider provider, IOptions<NotificationChannelOptions> options, IBackgroundJobQueue queue,
    NotificationEmailContent content) : IBackgroundJobHandler, IJobScheduleContributor
{
    public string Name => "notification-channels";
    private sealed record Work(Guid Id, int Sequence);
    private sealed record Claim(Guid Id, Guid Lease, Guid Notice, Guid Recipient, string Role, string Channel, string EventType, int Attempt);
    public async Task EnqueueDueAsync(CancellationToken t)
    {
        foreach (var work in await DueAsync(t)) await queue.EnqueueAsync(new(Name, $"channel/{work.Id}/{work.Sequence}/{sql.Now:yyyyMMddHHmm}", JsonSerializer.Serialize(work.Id)), t);
    }
    internal async Task ProcessPendingAsync(CancellationToken t)
    { foreach (var work in await DueAsync(t)) await DeliverAsync(work.Id, t); }
    private async Task<IReadOnlyList<Work>> DueAsync(CancellationToken t)
    {
        if (!options.Value.Enabled) return [];
        // event_data remains immutable; delivery status/history is the mutable envelope.
        await sql.Execute("""
            INSERT INTO notifications(id,record_kind,event_key,notification_type,event_data,event_at,delivery_status,next_delivery_at)
            SELECT gen_random_uuid(),'OUTBOX','channel:'||n.id::text||':'||c.channel,'CHANNEL_DELIVERY',
              jsonb_build_object('schemaVersion',1,'recordType','ChannelDelivery','notificationId',n.id,'recipient',n.recipient_user_id,
                'role',n.event_data->>'audienceRole','channel',c.channel,'eventType',n.event_data->'state'->>'eventType'),@now,'Pending',@now
            FROM notifications n CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(n.event_data->'state'->'channels','[]'::jsonb)) c(channel)
            WHERE n.record_kind='INBOX' AND c.channel IN ('EMAIL','PUSH')
            ON CONFLICT(record_kind,event_key) WHERE record_kind IN ('OUTBOX','AUDIT') DO NOTHING
            """, t, ("now", sql.Now));
        var due = new List<Work>();
        await using (var cmd = await sql.Command("""
            SELECT id,(SELECT count(*)::int FROM jsonb_array_elements(delivery_history) h WHERE h->>'recordType'='ChannelClaim')+1 FROM notifications WHERE record_kind='OUTBOX' AND event_data->>'recordType'='ChannelDelivery'
              AND ((delivery_status='Pending' AND next_delivery_at<=@now) OR (delivery_status='Processing' AND locked_until<=@now))
            ORDER BY event_at,id LIMIT 50
            """, t, ("now", sql.Now)))
        { await using var reader = await cmd.ExecuteReaderAsync(t); while (await reader.ReadAsync(t)) due.Add(new(reader.GetGuid(0), reader.GetInt32(1))); }
        return due;
    }
    public Task ExecuteAsync(JobExecution job, CancellationToken t) => DeliverAsync(JsonSerializer.Deserialize<Guid>(job.PayloadJson), t);
    internal async Task DeliverAsync(Guid id, CancellationToken t)
    {
        if (!options.Value.Enabled) return;
        Claim? claim = null;
        string? terminalState = null;
        await using (var tx = await db.Database.BeginTransactionAsync(t))
        {
            await using var cmd = await sql.Command("""
                SELECT (event_data->>'notificationId')::uuid,(event_data->>'recipient')::uuid,event_data->>'role',event_data->>'channel',
                  COALESCE(event_data->>'eventType',''),(SELECT count(*)::int FROM jsonb_array_elements(delivery_history) h WHERE h->>'recordType'='ChannelClaim')+1,delivery_status
                FROM notifications WHERE id=@id AND event_data->>'recordType'='ChannelDelivery' AND
                 ((delivery_status='Pending' AND next_delivery_at<=@now) OR (delivery_status='Processing' AND locked_until<=@now)) FOR UPDATE SKIP LOCKED
                """, t, ("id", id), ("now", sql.Now));
            string previous;
            await using (var reader = await cmd.ExecuteReaderAsync(t))
            {
                if (!await reader.ReadAsync(t)) return;
                claim = new(id, Guid.NewGuid(), reader.GetGuid(0), reader.GetGuid(1), reader.GetString(2), reader.GetString(3), reader.GetString(4), reader.GetInt32(5)); previous = reader.GetString(6);
            }
            if (!provider.IsConfigured(claim.Channel)) return;
            if (previous == "Processing" && !provider.SupportsIdempotency(claim.Channel))
                terminalState = "PendingReview";
            else if (claim.Attempt > options.Value.MaxAttempts) terminalState = "PermanentlyFailed";
            var started = JsonSerializer.Serialize(new { recordType = terminalState is null ? "ChannelClaim" : "ChannelRecovery", sequence = claim.Attempt, at = sql.Now }, CompactNotificationWriter.Json);
            await sql.Execute("UPDATE notifications SET delivery_status='Processing',lease_token=@lease,locked_until=@until,delivery_history=delivery_history||jsonb_build_array(@started::jsonb) WHERE id=@id", t,
                ("id", id), ("lease", claim.Lease), ("until", sql.Now.AddSeconds(options.Value.TimeoutSeconds + 30)), ("started", started));
            await tx.CommitAsync(t);
        }
        var state = terminalState ?? "Sent";
        string? error = terminalState == "PendingReview" ? "email_delivery_lease_expired" : terminalState is not null ? "delivery_attempt_limit" : null;
        string? providerReference = null;
        try
        {
            if (terminalState is null)
            {
                var scope = new NotificationScope(claim.Recipient, claim.Role == "Owner", claim.Role == "Staff", claim.Role == "Tenant", BillingAutomationDates.BusinessDate(sql.Now));
                var notice = await inbox.GetAsync(scope, claim.Notice, t);
                var eligible = await sql.Scalar<bool>("SELECT EXISTS(SELECT 1 FROM users WHERE id=@id AND @role=ANY(roles) AND (is_active OR @security))", t,
                    ("id", claim.Recipient), ("role", claim.Role), ("security", notice?.Category == "Account"));
                if (!eligible || notice is null || await inbox.TargetAsync(scope, claim.Notice, t) is null || !await Relevant(notice, t)) state = "Suppressed";
                else
                {
                    var destinations = new List<(string Id, string Value)>();
                    if (claim.Channel == "EMAIL")
                    {
                        var email = await sql.Scalar<string>("SELECT email FROM users WHERE id=@id AND email_confirmed AND (is_active OR @security)", t, ("id", claim.Recipient), ("security", notice.Category == "Account"));
                        if (!EmailOptions.ValidAddress(email)) throw new ChannelDeliveryException("email_recipient_unavailable");
                        destinations.Add(("email", email!));
                    }
                    else
                    {
                        await using var cmd = await sql.Command("""
                            SELECT d.id,d.task_data->>'pushToken' FROM operational_tasks d JOIN users u ON u.id=d.assigned_user_id
                            WHERE d.assigned_user_id=@id AND d.task_data->>'recordType'='PushDevice' AND d.status='Active' AND u.is_active AND d.task_data ? 'pushToken'
                            """, t, ("id", claim.Recipient));
                        await using var reader = await cmd.ExecuteReaderAsync(t); while (await reader.ReadAsync(t)) destinations.Add((reader.GetGuid(0).ToString("N"), reader.GetString(1)));
                        if (destinations.Count == 0) throw new InvalidOperationException("push_device_unavailable");
                    }
                    var emailContent = claim.Channel == "EMAIL" ? await content.BuildAsync(notice, t) : (notice.Title, notice.Summary);
                    foreach (var destination in destinations)
                    {
                        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(t); timeout.CancelAfter(TimeSpan.FromSeconds(options.Value.TimeoutSeconds));
                        // Stable per-device key protects fanout retries after a partial provider failure.
                        var receipt = await provider.SendAsync(new($"channel/{claim.Id}/{destination.Id}", claim.Channel, destination.Value, notice.EventType, emailContent.Item1, emailContent.Item2), timeout.Token);
                        if (string.IsNullOrWhiteSpace(receipt) || receipt.Length > 200) throw new InvalidOperationException("invalid_provider_receipt");
                        providerReference = receipt;
                    }
            }
            }
        }
        catch (OperationCanceledException) when (t.IsCancellationRequested) { throw; }
        catch (ChannelDeliveryException e)
        {
            error = e.Code;
            state = e.OutcomeUnknown ? "PendingReview" : e.Retryable && claim.Attempt < options.Value.MaxAttempts ? "Pending" : "PermanentlyFailed";
        }
        catch (Exception e)
        {
            error = e is InvalidOperationException ? "destination_unavailable" : e.GetType().Name;
            state = !provider.SupportsIdempotency(claim.Channel) ? "PendingReview" : claim.Attempt >= options.Value.MaxAttempts ? "PermanentlyFailed" : "Pending";
        }
        var history = JsonSerializer.Serialize(new { schemaVersion = 1, recordType = "ChannelAttempt", sequence = claim.Attempt, at = sql.Now, state, errorCode = error, providerReference }, CompactNotificationWriter.Json);
        await using var completed = await db.Database.BeginTransactionAsync(t);
        await sql.Execute("SELECT id FROM notifications WHERE id=@id FOR UPDATE", t, ("id", claim.Notice));
        var updated = await sql.Execute("""
            UPDATE notifications SET delivery_status=@state,delivery_history=delivery_history||jsonb_build_array(@history::jsonb),locked_until=NULL,lease_token=NULL,
              next_delivery_at=CASE WHEN @state='Pending' THEN @next ELSE NULL END
            WHERE id=@id AND lease_token=@lease
            """, t, ("id", claim.Id), ("lease", claim.Lease), ("state", state), ("history", history),
            ("next", sql.Now.Add(options.Value.RetryDelay(claim.Attempt))));
        if (updated == 1)
        {
            var aggregate = await sql.Scalar<string>("""
                SELECT CASE WHEN bool_and(delivery_status='Suppressed') THEN 'Suppressed'
                  WHEN bool_and(delivery_status IN ('Sent','Suppressed')) THEN 'Delivered'
                  WHEN bool_or(delivery_status='PendingReview') THEN 'PendingReview'
                  WHEN bool_or(delivery_status='PermanentlyFailed') THEN 'Failed' ELSE 'Pending' END
                FROM notifications WHERE record_kind='OUTBOX' AND event_data->>'recordType'='ChannelDelivery' AND event_data->>'notificationId'=@notice::text
                """, t, ("notice", claim.Notice));
            await sql.Execute("UPDATE notifications SET delivery_status=@status WHERE id=@id AND record_kind='INBOX'", t, ("id", claim.Notice), ("status", aggregate!));
            // Preserve the incident-specific API while the actual deliveries use the shared channels.
            await sql.Execute("""
                UPDATE notifications src SET delivery_status=@status,delivery_history=src.delivery_history||jsonb_build_array(jsonb_build_object(
                  'recordType','IncidentNotification','state',src.event_data->'state'||jsonb_build_object('deliveryState',@status,
                    'deliveryReference',CASE WHEN @status='Delivered' THEN 'channel:'||@notice::text ELSE NULL END)))
                FROM notifications n WHERE n.id=@notice AND src.id=(n.event_data->'state'->>'sourceTaskNotificationId')::uuid
                  AND src.record_kind='OUTBOX' AND src.event_data->>'recordType'='IncidentNotification'
                """, t, ("status", aggregate!), ("notice", claim.Notice));
        }
        await completed.CommitAsync(t);
    }
    private async Task<bool> Relevant(NotificationView n, CancellationToken t)
    {
        if (n.EventType == "EXCESS_PAYMENT_OR_REFUND_STATUS" && await db.Set<BHome.Domain.Notifications.UserNotification>()
            .AnyAsync(notice => notice.Id == n.Id && notice.EventKey.StartsWith("deposit-refund:"), t))
            return await NotificationEventPublisher.DepositRefundNotices(db).AnyAsync(r =>
                db.Set<BHome.Domain.Notifications.UserNotification>().Any(notice => notice.Id == n.Id && notice.EventKey == r.EventKey &&
                    (notice.AudienceRole == "Owner" && notice.RecipientUserId == r.OwnerId || notice.AudienceRole == "Tenant" && notice.RecipientUserId == r.BeneficiaryUserId)), t);
        if (n.RelatedObjectType == "Refund" && n.EventType == "EXCESS_PAYMENT_OR_REFUND_STATUS")
            return await NotificationEventPublisher.ReceiptRefundNotices(db).AnyAsync(r => r.RefundId == n.RelatedObjectId &&
                db.Set<BHome.Domain.Notifications.UserNotification>().Any(notice => notice.Id == n.Id && notice.EventKey == r.EventKey), t);
        if (n.EventType is "INVOICE_OVERDUE" or "INVOICE_DUE_SOON") return (await db.FinancialsAsync(n.RelatedObjectId, t)).OutstandingAmount > 0;
        if (n.EventType == "TASK_DUE_OR_OVERDUE") return await db.Set<OperationalTask>().AnyAsync(x => x.Id == n.RelatedObjectId && x.Status != MeterTaskStatus.Completed && x.Status != MeterTaskStatus.Cancelled, t);
        if (n.EventType.StartsWith("EMERGENCY_ACK_")) return await db.Set<BHome.Domain.IncidentMaintenance.IncidentReport>().AnyAsync(x => x.Id == n.RelatedObjectId && x.AcknowledgedAt == null && (x.Status == BHome.Domain.IncidentMaintenance.IncidentStatus.Submitted || x.Status == BHome.Domain.IncidentMaintenance.IncidentStatus.InProgress), t);
        if (n.EventType == "TEMPORARY_RESIDENCE_ACTION") return await sql.Scalar<bool>("""
            SELECT EXISTS(SELECT 1 FROM notifications notice JOIN contract_residents cr ON cr.resident_id=notice.related_entity_id
              AND cr.contract_id::text=split_part(notice.event_key,':',2)
              JOIN contracts c ON c.id=cr.contract_id JOIN residents r ON r.id=cr.resident_id
              WHERE notice.id=@notice AND notice.event_key LIKE 'residence:%' AND c.status=3
                AND cr.actual_residence_from<=@today AND (cr.residence_to IS NULL OR cr.residence_to>=@today)
                AND cr.actual_move_out_date IS NULL AND COALESCE(cr.registration_status,'Pending') IN ('Pending','InProgress')
                AND (notice.recipient_user_id=c.owner_signer_id OR notice.recipient_user_id=r.user_id))
            """, t, ("notice", n.Id), ("today", BillingAutomationDates.BusinessDate(sql.Now)));
        return true;
    }
}
