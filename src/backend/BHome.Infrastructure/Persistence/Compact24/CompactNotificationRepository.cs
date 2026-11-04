using BHome.Application.Notifications;
using BHome.Application.PropertyManagement;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;
using NpgsqlTypes;

namespace BHome.Infrastructure.Persistence.Compact24;

internal sealed class CompactNotificationRepository(Compact24DbContext db) : INotificationRepository
{
    private const string SourceRead = "(SELECT old.read_at FROM notifications old WHERE old.record_kind='OUTBOX' AND old.id=(n.event_data->'state'->>'sourceTaskNotificationId')::uuid AND old.event_data->'state'->>'recipientUserId'=@actor::text)";
    private const string EffectiveRead = "COALESCE(n.read_at," + SourceRead + ")";
    private const string Visible = """
        n.record_kind='INBOX' AND n.recipient_user_id=@actor AND
        ((@owner AND n.event_data->>'audienceRole'='Owner') OR (@tenant AND n.event_data->>'audienceRole'='Tenant') OR
         (@staff AND n.event_data->>'audienceRole'='Staff' AND n.event_data->>'category'='Task' AND EXISTS(
           SELECT 1 FROM locations l WHERE l.id=n.location_id AND l.is_active AND EXISTS(
             SELECT 1 FROM jsonb_array_elements(l.staff_assignments) a WHERE (a->>'staffUserId')::uuid=@actor
             AND (a->>'startDate')::date<=@today AND (a->>'endDate')::date>=@today))))
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
        await using var command = await Query($"SELECT count(*) FROM notifications n WHERE {Visible} AND {EffectiveRead} IS NULL", scope, token);
        return checked((int)(long)(await command.ExecuteScalarAsync(token))!);
    }
    public async Task<PagedResult<NotificationView>> ListAsync(NotificationScope scope, NotificationQuery query, CancellationToken token)
    {
        var filter = Visible + $" AND (@category IS NULL OR n.event_data->>'category'=@category) AND (@unread IS NULL OR ({EffectiveRead} IS NULL)=@unread)";
        await using var command = await Query($"SELECT count(*) FROM notifications n WHERE {filter}", scope, token);
        command.Parameters.AddWithValue("category", NpgsqlDbType.Text, (object?)query.Category ?? DBNull.Value);
        command.Parameters.AddWithValue("unread", NpgsqlDbType.Boolean, (object?)query.Unread ?? DBNull.Value);
        var count = checked((int)(long)(await command.ExecuteScalarAsync(token))!);
        command.CommandText = $"""
            SELECT n.id,n.event_data->>'category',n.title,n.message,n.related_entity_type,n.related_entity_id,n.event_at,{EffectiveRead},n.delivery_status
            FROM notifications n WHERE {filter} ORDER BY n.event_at DESC,n.id OFFSET @skip LIMIT @take
            """;
        command.Parameters.AddWithValue("skip", checked((query.Page - 1) * query.PageSize)); command.Parameters.AddWithValue("take", query.PageSize);
        var items = new List<NotificationView>();
        await using var reader = await command.ExecuteReaderAsync(token);
        while (await reader.ReadAsync(token))
            items.Add(new(reader.GetGuid(0), reader.GetString(1), reader.IsDBNull(2) ? "" : reader.GetString(2), reader.IsDBNull(3) ? "" : reader.GetString(3),
                reader.IsDBNull(4) ? "" : reader.GetString(4), reader.IsDBNull(5) ? Guid.Empty : reader.GetGuid(5), reader.GetFieldValue<DateTimeOffset>(6),
                reader.IsDBNull(7) ? null : reader.GetFieldValue<DateTimeOffset>(7), reader.IsDBNull(8) ? "Unconfigured" : reader.GetString(8)));
        return new(items, query.Page, query.PageSize, count);
    }
    public async Task ReadAsync(NotificationScope scope, Guid? id, DateTimeOffset now, CancellationToken token)
    {
        await using var own = db.Database.CurrentTransaction is null ? await db.Database.BeginTransactionAsync(token) : null;
        await using var command = await Query($"UPDATE notifications n SET read_at=COALESCE({EffectiveRead},@now) WHERE {Visible} AND (@id IS NULL OR n.id=@id)", scope, token);
        command.Parameters.AddWithValue("now", now); command.Parameters.AddWithValue("id", NpgsqlDbType.Uuid, (object?)id ?? DBNull.Value);
        var updated = await command.ExecuteNonQueryAsync(token);
        if (id is not null && updated == 0) throw new NotificationException(404, "notification_not_found");
        command.CommandText = $"""
            UPDATE notifications old SET read_at=COALESCE(old.read_at,@now) WHERE old.record_kind='OUTBOX'
              AND old.event_data->'state'->>'recipientUserId'=@actor::text AND EXISTS(
              SELECT 1 FROM notifications n WHERE {Visible} AND (@id IS NULL OR n.id=@id)
                AND old.id=(n.event_data->'state'->>'sourceTaskNotificationId')::uuid)
            """;
        await command.ExecuteNonQueryAsync(token);
        if (own is not null) await own.CommitAsync(token);
    }
    public async Task<NotificationTarget?> TargetAsync(NotificationScope scope, Guid id, CancellationToken token)
    {
        string type; Guid related; Guid? location;
        await using var command = await Query($"SELECT n.related_entity_type,n.related_entity_id,n.location_id FROM notifications n WHERE {Visible} AND n.id=@id", scope, token);
        command.Parameters.AddWithValue("id", id);
        await using (var reader = await command.ExecuteReaderAsync(token))
        {
            if (!await reader.ReadAsync(token) || reader.IsDBNull(0) || reader.IsDBNull(1)) return null;
            type = reader.GetString(0); related = reader.GetGuid(1); location = reader.IsDBNull(2) ? null : reader.GetGuid(2);
        }
        command.Parameters.AddWithValue("target", related);
        command.CommandText = type switch
        {
            "Invoice" => "SELECT EXISTS(SELECT 1 FROM invoices i WHERE i.id=@target AND (@owner OR (@tenant AND @actor=ANY(i.recipient_user_ids))))",
            "Adjustment" => "SELECT EXISTS(SELECT 1 FROM invoice_adjustments a JOIN invoices i ON i.id=a.invoice_id WHERE a.id=@target AND (@owner OR (@tenant AND a.requested_by_user_id=@actor AND @actor=ANY(i.recipient_user_ids))))",
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
