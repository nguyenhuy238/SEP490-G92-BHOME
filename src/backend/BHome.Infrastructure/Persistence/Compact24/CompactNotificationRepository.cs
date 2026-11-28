using BHome.Application.Notifications;
using BHome.Application.PropertyManagement;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;
using NpgsqlTypes;

namespace BHome.Infrastructure.Persistence.Compact24;

internal sealed class CompactNotificationRepository(Compact24DbContext db, BHome.Application.Billing.ITenantMeterReadings readings) : INotificationRepository
{
    private const string SourceRead = "(SELECT old.read_at FROM notifications old WHERE old.record_kind='OUTBOX' AND old.id=(n.event_data->'state'->>'sourceTaskNotificationId')::uuid AND COALESCE(old.event_data->'state'->>'recipientUserId',old.event_data->'state'->>'recipientId')=@actor::text)";
    private const string EffectiveRead = "COALESCE(n.read_at," + SourceRead + ")";
    private const string Visible = """
        n.record_kind='INBOX' AND n.recipient_user_id=@actor AND
        ((@owner AND n.event_data->>'audienceRole'='Owner') OR (@tenant AND n.event_data->>'audienceRole'='Tenant') OR
         (@staff AND n.event_data->>'audienceRole'='Staff' AND (n.event_data->>'category'='Account' OR (n.event_data->>'category' IN ('Task','Incident','Announcement','Contract','Invoice') AND EXISTS(
           SELECT 1 FROM locations l WHERE l.id=n.location_id AND l.is_active AND EXISTS(
             SELECT 1 FROM jsonb_array_elements(l.staff_assignments) a WHERE (a->>'staffUserId')::uuid=@actor
             AND (a->>'startDate')::date<=@today AND (a->>'endDate')::date>=@today))))))
        """;
    // Project old per-meter assignment notices and new period notices into a
    // single inbox item without deleting or rewriting immutable event history.
    private const string GroupedRows = $"""
        WITH visible_rows AS (
          SELECT n.*, {EffectiveRead} AS effective_read,
            CASE WHEN n.event_data->>'audienceRole'='Staff' AND n.event_data->'state'->>'eventType'='TASK_ASSIGNED'
              THEN t.billing_period END AS meter_period
          FROM notifications n LEFT JOIN operational_tasks t ON n.related_entity_type='MeterTask'
            AND t.id=n.related_entity_id AND t.task_type='METER_READ'
            AND t.task_data->'state'->>'purpose'='1' AND t.location_id=n.location_id
          WHERE {Visible}
        ), keyed_rows AS (
          SELECT v.*, CASE WHEN meter_period IS NOT NULL
            THEN 'meter:'||location_id::text||':'||meter_period::text ELSE id::text END AS group_key
          FROM visible_rows v
        ), grouped_rows AS (
          SELECT k.*, row_number() OVER (PARTITION BY group_key ORDER BY event_at DESC,id) AS group_rank,
            CASE WHEN bool_or(effective_read IS NULL) OVER (PARTITION BY group_key) THEN NULL
              ELSE max(effective_read) OVER (PARTITION BY group_key) END AS group_read
          FROM keyed_rows k
        )
        """;
    private async Task<NpgsqlCommand> Query(string sql, NotificationScope scope, CancellationToken token)
    {
        await db.Database.OpenConnectionAsync(token);
        var command = new NpgsqlCommand(sql, (NpgsqlConnection)db.Database.GetDbConnection(), (NpgsqlTransaction?)db.Database.CurrentTransaction?.GetDbTransaction());
        command.Parameters.AddWithValue("actor", scope.Actor); command.Parameters.AddWithValue("owner", scope.Owner);
        command.Parameters.AddWithValue("staff", scope.Staff); command.Parameters.AddWithValue("tenant", scope.Tenant);
        command.Parameters.AddWithValue("today", scope.Today);
        return command;
    }
    public async Task<int> UnreadAsync(NotificationScope scope, CancellationToken token)
    {
        await using var command = await Query($"{GroupedRows} SELECT count(*) FROM grouped_rows WHERE group_rank=1 AND group_read IS NULL", scope, token);
        return checked((int)(long)(await command.ExecuteScalarAsync(token))!);
    }
    public async Task<PagedResult<NotificationView>> ListAsync(NotificationScope scope, NotificationQuery query, CancellationToken token)
    {
        const string filter = "group_rank=1 AND (@category IS NULL OR n.event_data->>'category'=@category) AND (@unread IS NULL OR (group_read IS NULL)=@unread)";
        await using var command = await Query($"{GroupedRows} SELECT count(*) FROM grouped_rows n WHERE {filter}", scope, token);
        command.Parameters.AddWithValue("category", NpgsqlDbType.Text, (object?)query.Category ?? DBNull.Value);
        command.Parameters.AddWithValue("unread", NpgsqlDbType.Boolean, (object?)query.Unread ?? DBNull.Value);
        var count = checked((int)(long)(await command.ExecuteScalarAsync(token))!);
        command.CommandText = $"""
            {GroupedRows}
            SELECT n.id,n.event_data->>'category',
              CASE WHEN meter_period IS NOT NULL THEN 'Có nhiệm vụ ghi chỉ số kỳ '||to_char(meter_period,'MM/YYYY') ELSE n.title END,
              CASE WHEN meter_period IS NOT NULL THEN 'Mở danh sách phòng được phân công để ghi chỉ số điện nước.' ELSE n.message END,
              n.related_entity_type,n.related_entity_id,n.event_at,group_read,n.delivery_status,COALESCE(n.event_data->'state'->>'eventType',''),COALESCE(n.event_data->'state'->>'priority','P1'),COALESCE(n.event_data->'state'->>'source','System')
            FROM grouped_rows n WHERE {filter} ORDER BY n.event_at DESC,n.id OFFSET @skip LIMIT @take
            """;
        command.Parameters.AddWithValue("skip", checked((query.Page - 1) * query.PageSize)); command.Parameters.AddWithValue("take", query.PageSize);
        var items = new List<NotificationView>();
        await using var reader = await command.ExecuteReaderAsync(token);
        while (await reader.ReadAsync(token))
            items.Add(new(reader.GetGuid(0), reader.GetString(1), reader.IsDBNull(2) ? "" : reader.GetString(2), reader.IsDBNull(3) ? "" : reader.GetString(3),
                reader.IsDBNull(4) ? "" : reader.GetString(4), reader.IsDBNull(5) ? Guid.Empty : reader.GetGuid(5), reader.GetFieldValue<DateTimeOffset>(6),
                reader.IsDBNull(7) ? null : reader.GetFieldValue<DateTimeOffset>(7), reader.IsDBNull(8) ? "Unconfigured" : reader.GetString(8), reader.GetString(9), reader.GetString(10), reader.GetString(11)));
        return new(items, query.Page, query.PageSize, count);
    }
    public async Task<NotificationView?> GetAsync(NotificationScope scope, Guid id, CancellationToken token)
    {
        await using var command = await Query($"""
            SELECT n.id,n.event_data->>'category',COALESCE(n.title,''),COALESCE(n.message,''),COALESCE(n.related_entity_type,''),
              COALESCE(n.related_entity_id,'00000000-0000-0000-0000-000000000000'::uuid),n.event_at,{EffectiveRead},COALESCE(n.delivery_status,'Unconfigured'),
              COALESCE(n.event_data->'state'->>'eventType',''),COALESCE(n.event_data->'state'->>'priority','P1'),COALESCE(n.event_data->'state'->>'source','System')
            FROM notifications n WHERE {Visible} AND n.id=@id
            """, scope, token);
        command.Parameters.AddWithValue("id", id);
        await using var reader = await command.ExecuteReaderAsync(token);
        return await reader.ReadAsync(token) ? new(reader.GetGuid(0), reader.GetString(1), reader.GetString(2), reader.GetString(3), reader.GetString(4), reader.GetGuid(5),
            reader.GetFieldValue<DateTimeOffset>(6), reader.IsDBNull(7) ? null : reader.GetFieldValue<DateTimeOffset>(7), reader.GetString(8), reader.GetString(9), reader.GetString(10), reader.GetString(11)) : null;
    }
    public async Task ReadAsync(NotificationScope scope, Guid? id, DateTimeOffset now, CancellationToken token)
    {
        await using var own = db.Database.CurrentTransaction is null ? await db.Database.BeginTransactionAsync(token) : null;
        const string selected = "SELECT id FROM keyed_rows WHERE @id IS NULL OR group_key=(SELECT group_key FROM keyed_rows WHERE id=@id)";
        await using var command = await Query($"{GroupedRows} UPDATE notifications n SET read_at=COALESCE({EffectiveRead},@now) WHERE n.id IN ({selected})", scope, token);
        command.Parameters.AddWithValue("now", now); command.Parameters.AddWithValue("id", NpgsqlDbType.Uuid, (object?)id ?? DBNull.Value);
        var updated = await command.ExecuteNonQueryAsync(token);
        if (id is not null && updated == 0) throw new NotificationException(404, "notification_not_found");
        command.CommandText = $"""
            {GroupedRows}
            UPDATE notifications old SET read_at=COALESCE(old.read_at,@now) WHERE old.record_kind='OUTBOX'
              AND COALESCE(old.event_data->'state'->>'recipientUserId',old.event_data->'state'->>'recipientId')=@actor::text AND EXISTS(
              SELECT 1 FROM notifications n WHERE n.id IN ({selected})
                AND old.id=(n.event_data->'state'->>'sourceTaskNotificationId')::uuid)
            """;
        await command.ExecuteNonQueryAsync(token);
        if (own is not null) await own.CommitAsync(token);
    }
    public async Task<NotificationTarget?> TargetAsync(NotificationScope scope, Guid id, CancellationToken token)
    {
        string type; Guid related; Guid? location; string? eventType;
        await using var command = await Query($"SELECT n.related_entity_type,n.related_entity_id,n.location_id,n.event_data->'state'->>'eventType' FROM notifications n WHERE {Visible} AND n.id=@id", scope, token);
        command.Parameters.AddWithValue("id", id);
        await using (var reader = await command.ExecuteReaderAsync(token))
        {
            if (!await reader.ReadAsync(token) || reader.IsDBNull(0) || reader.IsDBNull(1)) return null;
            type = reader.GetString(0); related = reader.GetGuid(1); location = reader.IsDBNull(2) ? null : reader.GetGuid(2);
            eventType = reader.IsDBNull(3) ? null : reader.GetString(3);
        }
        command.Parameters.AddWithValue("target", related);
        if (type == "MeterTask" && (eventType is "TASK_ASSIGNED" or "PERIODIC_METER_OVERDUE") && scope.Staff && location is { } meterLocation)
        {
            command.Parameters.AddWithValue("location", meterLocation);
            command.CommandText = """
                SELECT billing_period FROM operational_tasks WHERE id=@target AND location_id=@location
                  AND task_type='METER_READ' AND task_data->'state'->>'purpose'='1'
                """;
            DateOnly? sourcePeriod;
            await using (var periodReader = await command.ExecuteReaderAsync(token))
                sourcePeriod = await periodReader.ReadAsync(token) && !periodReader.IsDBNull(0)
                    ? periodReader.GetFieldValue<DateOnly>(0) : null;
            if (sourcePeriod is { } meterPeriod)
            {
                if (!await StaffEmploymentEligibility.IsEligibleAsync(db, scope.Actor, scope.Today, token)) return null;
                command.Parameters.AddWithValue("period", meterPeriod);
                command.CommandText = """
                    SELECT EXISTS(SELECT 1 FROM operational_tasks WHERE location_id=@location AND billing_period=@period
                      AND task_type='METER_READ' AND task_data->'state'->>'purpose'='1'
                      AND status<>'3' AND assigned_user_id=@actor)
                    """;
                return (bool)(await command.ExecuteScalarAsync(token))!
                    ? new("MeterPeriod", meterLocation, meterLocation, meterPeriod)
                    : null;
            }
        }
        if (type == "MeterReading")
            return scope.Tenant && await readings.CanViewAsync(scope.Actor, related, token) ? new(type, related, location) : null;
        if (type == "Refund")
        {
            command.CommandText = """
                SELECT r.source_payment_id FROM refund_requests r LEFT JOIN residents person ON person.id=r.beneficiary_resident_id
                WHERE r.id=@target AND r.source_payment_id IS NOT NULL AND r.source_deposit_contract_id IS NULL
                  AND (@owner OR (@tenant AND r.beneficiary_kind='RESIDENT' AND person.user_id=@actor))
                  AND EXISTS(SELECT 1 FROM jsonb_array_elements(r.history) h WHERE h->>'recordType'='ExcessReceiptRefundV1')
                """;
            var source = await command.ExecuteScalarAsync(token);
            if (source is Guid receipt) return scope.Owner ? new("BankTransfer", receipt) : new("Refund", related);
            var depositContract = await BHome.Infrastructure.Modules.Notifications.NotificationEventPublisher.DepositRefundNotices(db)
                .Where(n => n.RefundId == related && (scope.Owner && n.OwnerId == scope.Actor || scope.Tenant && n.BeneficiaryUserId == scope.Actor))
                .Select(n => (Guid?)n.ContractId).Distinct().SingleOrDefaultAsync(token);
            return depositContract is { } contract ? scope.Owner ? new("Contract", contract) : new("Refund", related) : null;
        }
        command.CommandText = type switch
        {
            "SettlementReceivable" => "SELECT EXISTS(SELECT 1 FROM contracts c CROSS JOIN LATERAL jsonb_array_elements(c.history) h WHERE h->>'recordType'='SettlementReceivableV1' AND h->>'recordKey'=@target::text AND (@owner OR (@tenant AND h->'state'->'recipientUserIds' @> jsonb_build_array(@actor::text))))",
            "Invoice" => "SELECT EXISTS(SELECT 1 FROM invoices i WHERE i.id=@target AND (@owner OR (@tenant AND @actor=ANY(i.recipient_user_ids))))",
            "Adjustment" => "SELECT EXISTS(SELECT 1 FROM invoice_adjustments a JOIN invoices i ON i.id=a.invoice_id WHERE a.id=@target AND (@owner OR (@tenant AND a.requested_by_user_id=@actor AND @actor=ANY(i.recipient_user_ids))))",
            "Location" => "SELECT EXISTS(SELECT 1 FROM locations l WHERE l.id=@target AND (@owner OR (@staff AND l.is_active AND EXISTS(SELECT 1 FROM jsonb_array_elements(l.staff_assignments) a WHERE (a->>'staffUserId')::uuid=@actor AND (a->>'startDate')::date<=@today AND (a->>'endDate')::date>=@today))))",
            "Room" => "SELECT EXISTS(SELECT 1 FROM rooms r JOIN contracts c ON c.room_id=r.id JOIN contract_residents cr ON cr.contract_id=c.id JOIN residents p ON p.id=cr.resident_id WHERE r.id=@target AND p.user_id=@actor AND c.status=3 AND cr.residence_from<=@today AND (cr.residence_to IS NULL OR cr.residence_to>=@today))",
            "Debt" => "SELECT EXISTS(SELECT 1 FROM invoices i JOIN locations l ON l.id=i.location_id WHERE i.id=@target AND @staff AND l.is_active AND EXISTS(SELECT 1 FROM jsonb_array_elements(l.staff_assignments) a WHERE (a->>'staffUserId')::uuid=@actor AND (a->>'startDate')::date<=@today AND (a->>'endDate')::date>=@today))",
            "BankTransfer" => "SELECT @owner AND EXISTS(SELECT 1 FROM payments WHERE id=@target)",
            "Account" => "SELECT @target=@actor",
            "Announcement" => "SELECT true",
            "Residence" => "SELECT EXISTS(SELECT 1 FROM contract_residents cr JOIN residents r ON r.id=cr.resident_id WHERE r.id=@target AND (@owner OR (@tenant AND r.user_id=@actor)))",
            "Incident" => """
                SELECT EXISTS(SELECT 1 FROM incident_reports i WHERE i.id=@target AND (@owner OR (@tenant AND i.reporter_user_id=@actor)
                OR (@staff AND EXISTS(SELECT 1 FROM locations l CROSS JOIN LATERAL jsonb_array_elements(l.staff_assignments) a
                  WHERE l.id=i.location_id AND l.is_active AND (a->>'staffUserId')::uuid=@actor AND (a->>'startDate')::date<=@today AND (a->>'endDate')::date>=@today))))
                """,
            "Contract" => "SELECT EXISTS(SELECT 1 FROM contracts c WHERE c.id=@target AND (@owner OR (@tenant AND c.tenant_user_id=@actor)))",
            "MeterTask" or "OperationalTask" => """
                SELECT EXISTS(SELECT 1 FROM operational_tasks t JOIN locations l ON l.id=t.location_id WHERE t.id=@target AND t.task_type=@tasktype AND
                 (@owner OR (@staff AND l.is_active AND (@tasktype<>'METER_READ' OR COALESCE(t.task_data->'state'->>'automationPlanId',t.task_data->>'automationPlanId') IS NULL OR t.assigned_user_id=@actor) AND
                   EXISTS(SELECT 1 FROM jsonb_array_elements(l.staff_assignments) a WHERE (a->>'staffUserId')::uuid=@actor AND
                   (a->>'startDate')::date<=@today AND (a->>'endDate')::date>=@today))))
                """,
            "AutomationExecution" => "SELECT EXISTS(SELECT 1 FROM operational_tasks t WHERE @owner AND t.id=@target AND t.task_type='SYSTEM_JOB' AND t.task_data->>'recordType'='BillingAutomationExecution')",
            _ => "SELECT false"
        };
        if (type is "MeterTask" or "OperationalTask") command.Parameters.AddWithValue("tasktype", type == "MeterTask" ? "METER_READ" : "GENERAL");
        if (!(bool)(await command.ExecuteScalarAsync(token))!) return null;
        DateOnly? period = null;
        if (type == "AutomationExecution")
        {
            command.CommandText = "SELECT (task_data->'state'->>'billingPeriod')::date FROM operational_tasks WHERE id=@target AND task_data->>'recordType'='BillingAutomationExecution'";
            period = (DateOnly?)await command.ExecuteScalarAsync(token);
        }
        return new(type, related, location, period);
    }
}
