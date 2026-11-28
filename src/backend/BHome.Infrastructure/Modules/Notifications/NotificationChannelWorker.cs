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
    NotificationEmailContent content, BHome.Infrastructure.IdentityAccess.AuthenticationEmailDelivery authenticationEmail,
    ISmsSender sms, SmsNotificationContent smsContent, IOptions<SmsOptions> smsOptions) : IBackgroundJobHandler, IJobScheduleContributor
{
    public string Name => "notification-channels";
    private sealed record Work(Guid Id, int Sequence);
    private sealed record Claim(Guid Id, Guid Lease, Guid Notice, Guid Recipient, string Role, string Channel, string EventType, int Attempt, string? ProtectedAuthenticationEmail, DateTimeOffset CreatedAt, Guid? HoldingContractId);
    public async Task EnqueueDueAsync(CancellationToken t)
    {
        foreach (var work in await DueAsync(t)) await queue.EnqueueAsync(new(Name, $"channel/{work.Id}/{work.Sequence}/{sql.Now:yyyyMMddHHmm}", JsonSerializer.Serialize(work.Id)), t);
    }
    internal async Task ProcessPendingAsync(CancellationToken t, bool authenticationOnly = false, bool businessEmailOnly = false)
    { foreach (var work in await DueAsync(t, authenticationOnly, businessEmailOnly)) await DeliverAsync(work.Id, t); }
    internal async Task ProcessHoldingConfirmationsAsync(CompactNotificationEvents events, CancellationToken t)
    {
        if (!options.Value.Enabled || !provider.IsConfigured("EMAIL")) return;
        await events.QueueHoldingConfirmationsAsync(t);
        foreach (var work in await DueAsync(t, holdingOnly: true)) await DeliverAsync(work.Id, t);
    }
    internal async Task ProcessBillingPendingAsync(CancellationToken t)
    { foreach (var work in await DueAsync(t, billingOnly: true)) await DeliverAsync(work.Id, t); }
    private static readonly string[] BillingEvents = ["INVOICE_DRAFT_CREATED", "INVOICE_ADJUSTMENT_REQUESTED", "INVOICE_ADJUSTMENT_DECIDED",
        "INVOICE_FINALIZATION_BLOCKED", "INVOICE_FINALIZED", "INVOICE_DUE_SOON", "INVOICE_OVERDUE", "METER_READING_CONFIRMED", "PERIODIC_METER_OVERDUE",
        "PAYMENT_PARTIALLY_CONFIRMED", "INVOICE_FULLY_PAID"];
    private async Task<IReadOnlyList<Work>> DueAsync(CancellationToken t, bool authenticationOnly = false, bool businessEmailOnly = false, bool holdingOnly = false, bool billingOnly = false)
    {
        if (!options.Value.Enabled) return [];
        // event_data remains immutable; delivery status/history is the mutable envelope.
        if (!holdingOnly) await sql.Execute("""
            INSERT INTO notifications(id,record_kind,event_key,notification_type,event_data,event_at,delivery_status,next_delivery_at)
            SELECT gen_random_uuid(),'OUTBOX','channel:'||n.id::text||':'||c.channel,'CHANNEL_DELIVERY',
              jsonb_build_object('schemaVersion',1,'recordType','ChannelDelivery','notificationId',n.id,'recipient',n.recipient_user_id,
                'role',n.event_data->>'audienceRole','channel',c.channel,'eventType',n.event_data->'state'->>'eventType'),@now,'Pending',@now
            FROM notifications n CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(n.event_data->'state'->'channels','[]'::jsonb)) c(channel)
            WHERE n.record_kind='INBOX' AND c.channel IN ('EMAIL','PUSH')
              AND (NOT @authenticationOnly OR n.event_data->>'category'='Account')
              AND (NOT @billingOnly OR n.notification_type=ANY(@billingEvents) OR
                   (n.related_entity_type='MeterTask' AND n.event_key LIKE 'periodic-meter-overdue:%'))
              AND (NOT @businessEmailOnly OR c.channel='EMAIL' AND n.event_data->>'audienceRole'='Tenant'
                AND n.event_data->'state'->>'eventType' IN ('CONTRACT_ACTIVATED','INVOICE_FULLY_PAID','INVOICE_DRAFT_CREATED','MOVE_OUT_CONSENT_REQUIRED','MOVE_OUT_CONSENT_REJECTED'))
            ON CONFLICT(record_kind,event_key) WHERE record_kind IN ('OUTBOX','AUDIT') DO NOTHING
            """, t, ("now", sql.Now), ("authenticationOnly", authenticationOnly), ("businessEmailOnly", businessEmailOnly), ("billingOnly", billingOnly), ("billingEvents", BillingEvents));
        if (!holdingOnly && !authenticationOnly && !businessEmailOnly && !billingOnly && smsOptions.Value.Enabled)
            await sql.Execute("""
                INSERT INTO notifications(id,record_kind,event_key,notification_type,event_data,event_at,delivery_status,next_delivery_at)
                SELECT gen_random_uuid(),'OUTBOX','sms:'||md5(n.event_key||':'||p.phone),'CHANNEL_DELIVERY',
                  jsonb_build_object('schemaVersion',1,'recordType','ChannelDelivery','notificationId',n.id,'recipient',n.recipient_user_id,
                    'notificationIds',jsonb_agg(n.id::text) OVER(PARTITION BY n.event_key,p.phone),
                    'role',n.event_data->>'audienceRole','channel','SMS','eventType',n.event_data->'state'->>'eventType'),@now,'Pending',@now
                FROM notifications n JOIN users u ON u.id=n.recipient_user_id
                CROSS JOIN LATERAL (SELECT regexp_replace(u.phone,'[ .()+-]','','g') AS digits) d
                CROSS JOIN LATERAL (SELECT CASE WHEN d.digits LIKE '0%' THEN '84'||substring(d.digits FROM 2) ELSE d.digits END AS phone) p
                WHERE n.record_kind='INBOX' AND n.event_data->'state'->'channels' ? 'SMS'
                  AND u.is_active AND u.phone_confirmed AND p.phone ~ '^84[35789][0-9]{8}$'
                  AND NOT EXISTS(SELECT 1 FROM notifications d WHERE d.record_kind='OUTBOX' AND d.event_data->>'channel'='SMS'
                    AND (d.event_data->>'notificationId'=n.id::text OR d.event_data->'notificationIds' ? n.id::text))
                ORDER BY n.event_at,n.id
                ON CONFLICT(record_kind,event_key) WHERE record_kind IN ('OUTBOX','AUDIT') DO NOTHING
                """, t, ("now", sql.Now));
        var due = new List<Work>();
        await using (var cmd = await sql.Command("""
            SELECT id,(SELECT count(*)::int FROM jsonb_array_elements(delivery_history) h WHERE h->>'recordType'='ChannelClaim')+1 FROM notifications WHERE record_kind='OUTBOX' AND event_data->>'recordType'='ChannelDelivery'
              AND ((@email AND event_data->>'channel'='EMAIL') OR (@push AND event_data->>'channel'='PUSH') OR (@sms AND event_data->>'channel'='SMS'))
              AND (NOT @holdingOnly OR event_data->>'channel'='EMAIL' AND event_data->>'eventType'='HOLDING_CONFIRMED')
              AND (NOT @businessEmailOnly OR event_data->>'channel'='EMAIL' AND (event_data->>'eventType'='HOLDING_CONFIRMED'
                OR event_data->>'role'='Tenant' AND event_data->>'eventType' IN ('CONTRACT_ACTIVATED','INVOICE_FULLY_PAID','INVOICE_DRAFT_CREATED','MOVE_OUT_CONSENT_REQUIRED','MOVE_OUT_CONSENT_REJECTED')))
              AND (NOT @authenticationOnly OR event_data ? 'protectedAuthenticationEmail' OR event_data->>'eventType' IN
                ('PASSWORD_CHANGED','PASSWORD_RESET_COMPLETED','ACCOUNT_ACTIVATED','ACCOUNT_DEACTIVATED','ACCOUNT_SETUP_COMPLETED','ACCOUNT_ACCESS_CHANGED','ACCOUNT_LOCKED',
                 'STAFF_ASSIGNMENT_CREATED','STAFF_ASSIGNMENT_UPDATED','STAFF_ASSIGNMENT_CANCELLED','STAFF_ASSIGNMENT_REMOVED',
                 'STAFF_ASSIGNMENT_ACTIVATED','STAFF_ASSIGNMENT_ENDED'))
              AND (NOT @billingOnly OR (event_data->>'channel' IN ('EMAIL','PUSH') AND
                   (event_data->>'eventType'=ANY(@billingEvents) OR EXISTS (SELECT 1 FROM notifications n
                       WHERE n.id=(notifications.event_data->>'notificationId')::uuid AND n.record_kind='INBOX'
                           AND n.related_entity_type='MeterTask' AND n.event_key LIKE 'periodic-meter-overdue:%'))))
              AND ((delivery_status='Pending' AND next_delivery_at<=@now) OR (delivery_status='Processing' AND locked_until<=@now))
            ORDER BY event_at,id LIMIT 50
            """, t, ("now", sql.Now), ("authenticationOnly", authenticationOnly), ("businessEmailOnly", businessEmailOnly), ("holdingOnly", holdingOnly), ("billingOnly", billingOnly), ("billingEvents", BillingEvents),
            ("email", provider.IsConfigured("EMAIL")), ("push", provider.IsConfigured("PUSH")), ("sms", provider.IsConfigured("SMS"))))
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
                  COALESCE(event_data->>'eventType',''),(SELECT count(*)::int FROM jsonb_array_elements(delivery_history) h WHERE h->>'recordType'='ChannelClaim')+1,delivery_status,event_data->>'protectedAuthenticationEmail',event_at,(event_data->>'holdingContractId')::uuid
                FROM notifications WHERE id=@id AND event_data->>'recordType'='ChannelDelivery' AND
                 ((delivery_status='Pending' AND next_delivery_at<=@now) OR (delivery_status='Processing' AND locked_until<=@now)) FOR UPDATE SKIP LOCKED
                """, t, ("id", id), ("now", sql.Now));
            string previous;
            await using (var reader = await cmd.ExecuteReaderAsync(t))
            {
                if (!await reader.ReadAsync(t)) return;
                claim = new(id, Guid.NewGuid(), reader.GetGuid(0), reader.GetGuid(1), reader.GetString(2), reader.GetString(3), reader.GetString(4), reader.GetInt32(5), reader.IsDBNull(7) ? null : reader.GetString(7), reader.GetFieldValue<DateTimeOffset>(8), reader.IsDBNull(9) ? null : reader.GetGuid(9)); previous = reader.GetString(6);
            }
            if (!provider.IsConfigured(claim.Channel)) return;
            if (previous == "Processing" && !provider.SupportsIdempotency(claim.Channel))
                terminalState = "PendingReview";
            else if (claim.Channel == "SMS" && sql.Now >= claim.CreatedAt.AddHours(23)) terminalState = "PendingReview";
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
                if (claim.EventType == "HOLDING_CONFIRMED" && claim.HoldingContractId is { } holding)
                {
                    var confirmation = await content.HoldingConfirmationAsync(holding, claim.Recipient, t);
                    if (confirmation is null) state = "Suppressed";
                    else
                    {
                        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(t);
                        timeout.CancelAfter(TimeSpan.FromSeconds(options.Value.TimeoutSeconds));
                        providerReference = await provider.SendAsync(new($"channel/{claim.Id}/email", "EMAIL",
                            confirmation.Value.Destination, claim.EventType, confirmation.Value.Title, confirmation.Value.Body,
                            Attachments: confirmation.Value.Attachments), timeout.Token);
                        if (string.IsNullOrWhiteSpace(providerReference) || providerReference.Length > 200)
                            throw new ChannelDeliveryException("email_submission_outcome_unknown", outcomeUnknown: true);
                    }
                }
                else
                {
                    var scope = new NotificationScope(claim.Recipient, claim.Role == "Owner", claim.Role == "Staff", claim.Role == "Tenant",
                        BillingEvents.Contains(claim.EventType) ? sql.BusinessToday : BillingAutomationDates.BusinessDate(sql.Now));
                    var notice = await inbox.GetAsync(scope, claim.Notice, t);
                    var eligible = await sql.Scalar<bool>("SELECT EXISTS(SELECT 1 FROM users WHERE id=@id AND @role=ANY(roles) AND (is_active OR @security))", t,
                        ("id", claim.Recipient), ("role", claim.Role), ("security", notice?.Category == "Account"));
                    if (!eligible || notice is null || await inbox.TargetAsync(scope, claim.Notice, t) is null || !await Relevant(notice, t)) state = "Suppressed";
                    else if (claim.Channel == "EMAIL" && claim.Role == "Tenant" && notice.EventType == "CONTRACT_ACTIVATED" &&
                        notice.RelatedObjectType == "Contract" &&
                        await content.MainPaidConfirmationAsync(notice.RelatedObjectId, claim.Recipient, t) is { } paidMain)
                    {
                        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(t);
                        timeout.CancelAfter(TimeSpan.FromSeconds(options.Value.TimeoutSeconds));
                        providerReference = await provider.SendAsync(new($"channel/{claim.Id}/email", "EMAIL",
                            paidMain.Destination, "MAIN_CONFIRMED", paidMain.Title, paidMain.Body, Attachments: paidMain.Attachments), timeout.Token);
                        if (string.IsNullOrWhiteSpace(providerReference) || providerReference.Length > 200)
                            throw new ChannelDeliveryException("email_submission_outcome_unknown", outcomeUnknown: true);
                    }
                    else if (claim.Channel == "EMAIL" && claim.Role == "Tenant" && notice.EventType == "CONTRACT_ACTIVATED" &&
                        !await sql.Scalar<bool>("SELECT email_confirmed FROM users WHERE id=@id", t, ("id", claim.Recipient)))
                        state = "Suppressed"; // The durable account-setup email contains the same activation confirmation and password link.
                    else if (claim.Channel == "EMAIL" && claim.Role == "Tenant" &&
                        notice.EventType == "INVOICE_DRAFT_CREATED" && notice.RelatedObjectType == "Invoice")
                    {
                        var draft = await content.DraftInvoiceEmailAsync(notice.RelatedObjectId, claim.Recipient, t);
                        if (draft is null) state = "Suppressed";
                        else
                        {
                            var mobile = await content.InvoiceMobileLinkAsync(notice, claim.Recipient, t);
                            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(t);
                            timeout.CancelAfter(TimeSpan.FromSeconds(options.Value.TimeoutSeconds));
                            providerReference = await provider.SendAsync(new($"channel/{claim.Id}/email", "EMAIL",
                                draft.Value.Destination, notice.EventType, draft.Value.Title, draft.Value.Body,
                                Attachments: draft.Value.Attachments, MobileActionUrl: mobile), timeout.Token);
                            if (string.IsNullOrWhiteSpace(providerReference) || providerReference.Length > 200)
                                throw new ChannelDeliveryException("email_submission_outcome_unknown", outcomeUnknown: true);
                        }
                    }
                    else if (claim.Channel == "SMS")
                    {
                        var template = SmsNotificationPolicy.Template(notice.EventType, claim.Role);
                        var variables = await smsContent.BuildAsync(notice, claim.Recipient, t);
                        var phone = VietnameseSmsPhone.Normalize(await sql.Scalar<string>("SELECT phone FROM users WHERE id=@id AND is_active AND phone_confirmed", t, ("id", claim.Recipient)));
                        if (template is null || !smsOptions.Value.EnabledTemplates.Contains(template) || variables is null || phone is null ||
                            !await sql.Scalar<bool>("SELECT EXISTS(SELECT 1 FROM notifications d JOIN notifications n ON n.id=@notice WHERE d.id=@id AND d.event_key='sms:'||md5(n.event_key||':'||@phone))", t,
                                ("id", claim.Id), ("notice", claim.Notice), ("phone", phone))) state = "Suppressed";
                        else
                        {
                            // RequestId is stable across retries and independent of provider acceptance.
                            var key = $"channel/{claim.Id}/sms";
                            var submitted = JsonSerializer.Serialize(new { recordType = "SmsSubmission", requestId = SmsGateway.RequestId(key), at = sql.Now }, CompactNotificationWriter.Json);
                            await sql.Execute("UPDATE notifications SET delivery_history=delivery_history||jsonb_build_array(@history::jsonb) WHERE id=@id AND lease_token=@lease", t,
                                ("history", submitted), ("id", claim.Id), ("lease", claim.Lease));
                            var receipt = await sms.SendAsync(new(claim.Recipient, phone, template, variables, key), t);
                            state = receipt.Status; providerReference = receipt.ProviderReference;
                        }
                    }
                    else
                    {
                        var auth = claim.ProtectedAuthenticationEmail is null ? null : await authenticationEmail.ResolveAsync(claim.Recipient, claim.ProtectedAuthenticationEmail, t);
                        if (claim.ProtectedAuthenticationEmail is not null && auth is null) state = "Suppressed";
                        else
                        {
                            var destinations = new List<(string Id, string Value)>();
                            if (claim.Channel == "EMAIL")
                            {
                                // Owner-provisioned Staff may still be completing their invitation.
                                // Assignment notice is safe to send to the account's stored address;
                                // all other regular notices still require confirmed email.
                                var assignmentNotice = claim.Role == "Staff" && notice.EventType is
                                    ("STAFF_ASSIGNMENT_CREATED" or "STAFF_ASSIGNMENT_UPDATED" or
                                    "STAFF_ASSIGNMENT_CANCELLED" or "STAFF_ASSIGNMENT_REMOVED" or
                                    "STAFF_ASSIGNMENT_ACTIVATED" or "STAFF_ASSIGNMENT_ENDED");
                                var email = auth?.Destination ?? await sql.Scalar<string>("""
                                    SELECT email FROM users WHERE id=@id AND (email_confirmed OR (@assignment AND 'Staff'=ANY(roles)))
                                      AND (is_active OR (@security AND NOT @assignment))
                                    """, t, ("id", claim.Recipient), ("security", notice.Category == "Account"), ("assignment", assignmentNotice));
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
                            var emailContent = auth is not null ? (auth.Title, auth.Body) : claim.Channel == "EMAIL" ? await content.BuildAsync(notice, t) : (notice.Title, notice.Summary);
                            var mobileAction = auth?.MobileActionUrl ?? (claim.Channel == "EMAIL" && claim.Role == "Tenant" ?
                                await content.InvoiceMobileLinkAsync(notice, claim.Recipient, t) : null);
                            var attachments = auth?.Attachments;
                            if (auth is null && claim.Channel == "EMAIL" && claim.Role == "Tenant" &&
                                notice.EventType == "CONTRACT_ACTIVATED" && notice.RelatedObjectType == "Contract" &&
                                await content.MainConfirmationAsync(notice.RelatedObjectId, claim.Recipient, t) is not null)
                                attachments = await content.MainAttachmentsAsync(notice.RelatedObjectId, claim.Recipient, destinations.Single().Value, t);
                            if (auth is null && claim.Channel == "EMAIL" && claim.Role == "Tenant" &&
                                notice.EventType == "INVOICE_FULLY_PAID" && notice.RelatedObjectType == "Invoice")
                                attachments = await content.PaidInvoiceAttachmentsAsync(notice.RelatedObjectId, claim.Recipient, t);
                            foreach (var destination in destinations)
                            {
                                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(t); timeout.CancelAfter(TimeSpan.FromSeconds(options.Value.TimeoutSeconds));
                                // Stable per-device key protects fanout retries after a partial provider failure.
                                var receipt = await provider.SendAsync(new($"channel/{claim.Id}/{destination.Id}", claim.Channel, destination.Value, auth?.DeliveryEventType ?? notice.EventType, emailContent.Item1, emailContent.Item2, auth?.ActionUrl, attachments, mobileAction, auth?.Credentials), timeout.Token);
                                if (string.IsNullOrWhiteSpace(receipt) || receipt.Length > 200) throw new InvalidOperationException("invalid_provider_receipt");
                                providerReference = receipt;
                            }
                        }
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
            WHERE id=@id AND lease_token=@lease AND delivery_status='Processing'
            """, t, ("id", claim.Id), ("lease", claim.Lease), ("state", state), ("history", history),
            ("next", sql.Now.Add(options.Value.RetryDelay(claim.Attempt))));
        if (updated == 1 && claim.Notice != Guid.Empty)
        {
            var aggregate = await sql.Scalar<string>("""
                SELECT CASE WHEN bool_and(delivery_status='Suppressed') THEN 'Suppressed'
                  WHEN bool_and(delivery_status IN ('Sent','Delivered','Suppressed')) THEN 'Delivered'
                  WHEN bool_and(delivery_status IN ('Sent','Simulated','Suppressed')) THEN 'Simulated'
                  WHEN bool_and(delivery_status IN ('Sent','SandboxAccepted','Suppressed')) THEN 'SandboxAccepted'
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
        if (n.EventType == "INVOICE_FINALIZATION_BLOCKED")
        {
            var today = sql.BusinessToday;
            if (n.RelatedObjectType is "Room" or "AutomationExecution")
            {
                var key = await db.Set<BHome.Domain.Notifications.UserNotification>().Where(notice => notice.Id == n.Id)
                    .Select(notice => notice.EventKey).SingleOrDefaultAsync(t);
                var parts = key?.Split(':');
                if (parts is { Length: 3 } && parts[0] == "invoice-finalization-no-draft" && Guid.TryParse(parts[1], out var room) &&
                    DateOnly.TryParseExact(parts[2] + "01", "yyyyMMdd", System.Globalization.CultureInfo.InvariantCulture,
                        System.Globalization.DateTimeStyles.None, out var period))
                    return !await db.PeriodicInvoices().AnyAsync(i => i.RoomId == room && i.BillingPeriod == period, t);
            }
            if (n.RelatedObjectType == "Adjustment")
                return await HeldInvoiceFinalNotifications.StillHeldForOriginal(
                    db.Set<InvoiceAdjustmentRequest>(), n.RelatedObjectId, today).AnyAsync(t);
            if (n.RelatedObjectType == "Invoice")
            {
                var heldForAdjustment = await db.Set<BHome.Domain.Notifications.UserNotification>()
                    .AnyAsync(notice => notice.Id == n.Id && notice.EventKey.StartsWith("invoice-finalization-held:"), t);
                return await db.Set<Invoice>().AnyAsync(i => i.Id == n.RelatedObjectId && i.Status == InvoiceStatus.Draft &&
                    i.ScheduledFinalDate <= today && (!heldForAdjustment || db.Set<InvoiceAdjustmentRequest>().Any(r => r.InvoiceId == i.Id && r.Decision == null)), t);
            }
        }
        if (n.EventType == "EXCESS_PAYMENT_OR_REFUND_STATUS" && await db.Set<BHome.Domain.Notifications.UserNotification>()
            .AnyAsync(notice => notice.Id == n.Id && notice.EventKey.StartsWith("deposit-refund:"), t))
            return await NotificationEventPublisher.DepositRefundNotices(db).AnyAsync(r =>
                db.Set<BHome.Domain.Notifications.UserNotification>().Any(notice => notice.Id == n.Id && notice.EventKey == r.EventKey &&
                    (notice.AudienceRole == "Owner" && notice.RecipientUserId == r.OwnerId || notice.AudienceRole == "Tenant" && notice.RecipientUserId == r.BeneficiaryUserId)), t);
        if (n.RelatedObjectType == "Refund" && n.EventType == "EXCESS_PAYMENT_OR_REFUND_STATUS")
            return await NotificationEventPublisher.ReceiptRefundNotices(db).AnyAsync(r => r.RefundId == n.RelatedObjectId &&
                db.Set<BHome.Domain.Notifications.UserNotification>().Any(notice => notice.Id == n.Id && notice.EventKey == r.EventKey), t);
        if (n.EventType is "INVOICE_OVERDUE" or "INVOICE_DUE_SOON") return (await db.FinancialsAsync(n.RelatedObjectId, t)).OutstandingAmount > 0;
        if (n.EventType == "PERIODIC_METER_OVERDUE")
        {
            var key = await db.Set<BHome.Domain.Notifications.UserNotification>().Where(notice => notice.Id == n.Id)
                .Select(notice => notice.EventKey).SingleOrDefaultAsync(t);
            var parts = key?.Split(':');
            if (parts is not { Length: 4 } || !Guid.TryParseExact(parts[1], "N", out var location) ||
                !DateOnly.TryParseExact(parts[2] + "01", "yyyyMMdd", System.Globalization.CultureInfo.InvariantCulture,
                    System.Globalization.DateTimeStyles.None, out var period)) return false;
            Guid? staff = null;
            if (parts[3] != "unassigned")
            {
                if (!Guid.TryParseExact(parts[3], "N", out var id)) return false;
                staff = id;
            }
            var now = sql.BusinessNow;
            var today = sql.BusinessToday;
            var currentStaff = db.StaffLocationAssignments.Where(a => a.LocationId == location &&
                a.StartDate <= today && a.EndDate >= today && StaffEmploymentEligibility.EligibleIds(db, today).Contains(a.StaffUserId));
            if (staff is { } recipient ? !await currentStaff.AnyAsync(a => a.StaffUserId == recipient, t) : await currentStaff.AnyAsync(t)) return false;
            return await db.Set<OperationalTask>().AnyAsync(x => x.LocationId == location && x.BillingPeriod == period &&
                x.Purpose == ReadingPurpose.Periodic && x.Location.IsActive &&
                x.DueAt < now && x.Status != MeterTaskStatus.Completed && x.Status != MeterTaskStatus.Cancelled, t);
        }
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
