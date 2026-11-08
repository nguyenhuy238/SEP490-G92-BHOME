using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using BHome.Application.Notifications;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Modules.Notifications;

internal sealed class CompactNotificationWorkspace(Compact24DbContext db, CompactNotificationWriter sql,
    Microsoft.Extensions.Options.IOptions<NotificationChannelOptions> options) : INotificationWorkspace
{
    private sealed record Recipient(Guid Id, Guid Location, bool HasEmail);
    // Current occupancy is resolved server-side. Staff cannot escape its assignments by supplying IDs.
    private async Task<List<Recipient>> Resolve(NotificationScope scope, NotificationAudience audience, CancellationToken t)
    {
        if (audience is null || audience.Type is not ("ALL_TENANTS" or "LOCATION" or "ROOM" or "USER" or "SELECTED_USERS") ||
            new[] { audience.LocationIds, audience.RoomIds, audience.UserIds }.Any(a => a?.Length > 500 || a?.Contains(Guid.Empty) == true))
            throw new NotificationException(400, "invalid_audience");
        var locations = audience.LocationIds ?? []; var rooms = audience.RoomIds ?? []; var users = audience.UserIds ?? [];
        if (audience.Type == "ALL_TENANTS" && !scope.Owner) throw new NotificationException(403, "announcement_scope_forbidden");
        if (audience.Type == "LOCATION" && locations.Length == 0 || audience.Type == "ROOM" && rooms.Length == 0 ||
            audience.Type is "USER" or "SELECTED_USERS" && users.Length == 0 || audience.Type == "USER" && users.Length != 1)
            throw new NotificationException(400, "empty_audience");
        if (!scope.Owner && audience.Type is "LOCATION" or "ROOM")
        {
            var requested = audience.Type == "LOCATION" ? locations : await db.Database.SqlQuery<Guid>($"SELECT DISTINCT location_id AS \"Value\" FROM rooms WHERE id=ANY({rooms})").ToArrayAsync(t);
            foreach (var id in requested)
                if (!await Assigned(scope, id, t)) throw new NotificationException(403, "announcement_scope_forbidden");
        }
        await using var cmd = await sql.Command("""
            SELECT DISTINCT u.id,l.id,(u.email IS NOT NULL AND u.email<>'' AND u.email_confirmed)
            FROM contract_residents cr JOIN residents r ON r.id=cr.resident_id JOIN users u ON u.id=r.user_id
            JOIN contracts c ON c.id=cr.contract_id JOIN rooms rm ON rm.id=c.room_id JOIN locations l ON l.id=rm.location_id
            WHERE u.is_active AND 'Tenant'=ANY(u.roles) AND l.is_active AND c.status=3 AND c.contract_type<>'HOLDING'
              AND c.start_date<=@today AND COALESCE(c.actual_end_date,c.end_date)>=@today
              AND cr.residence_from<=@today AND (cr.residence_to IS NULL OR cr.residence_to>=@today)
              AND (@owner OR EXISTS(SELECT 1 FROM jsonb_array_elements(l.staff_assignments) a WHERE (a->>'staffUserId')::uuid=@actor
                AND (a->>'startDate')::date<=@today AND (a->>'endDate')::date>=@today))
              AND (@type='ALL_TENANTS' OR (@type='LOCATION' AND l.id=ANY(@locations)) OR (@type='ROOM' AND rm.id=ANY(@rooms))
                OR (@type IN ('USER','SELECTED_USERS') AND u.id=ANY(@users)))
            ORDER BY u.id,l.id
            """, t, ("today", scope.Today), ("owner", scope.Owner), ("actor", scope.Actor), ("type", audience.Type), ("locations", locations), ("rooms", rooms), ("users", users));
        var result = new List<Recipient>();
        await using (var reader = await cmd.ExecuteReaderAsync(t)) while (await reader.ReadAsync(t)) result.Add(new(reader.GetGuid(0), reader.GetGuid(1), reader.GetBoolean(2)));
        if (!scope.Owner && audience.Type is "USER" or "SELECTED_USERS" && users.Except(result.Select(r => r.Id)).Any()) throw new NotificationException(403, "announcement_scope_forbidden");
        return result.DistinctBy(r => r.Id).ToList();
    }
    private Task<bool> Assigned(NotificationScope s, Guid id, CancellationToken t) => sql.Scalar<bool>("""
        SELECT EXISTS(SELECT 1 FROM locations l CROSS JOIN LATERAL jsonb_array_elements(l.staff_assignments) a
          WHERE l.id=@id AND l.is_active AND (a->>'staffUserId')::uuid=@actor AND (a->>'startDate')::date<=@today AND (a->>'endDate')::date>=@today)
        """, t, ("id", id), ("actor", s.Actor), ("today", s.Today));
    public async Task<RecipientPreview> PreviewAsync(NotificationScope scope, NotificationAudience audience, CancellationToken t)
    { var recipients = await Resolve(scope, audience, t); return new(recipients.Count, recipients.Count(r => !r.HasEmail)); }
    public async Task<AnnouncementView> CreateAsync(NotificationScope scope, AnnouncementWrite input, CancellationToken t)
    {
        _ = await Resolve(scope, input.Audience, t);
        var id = Guid.NewGuid(); var view = new AnnouncementView(id, input.Title, input.Body, input.Audience, input.Channels, input.Priority, "Draft", 0, null);
        await sql.Execute("""
            INSERT INTO operational_tasks(id,task_type,source_key,status,assigned_user_id,task_data)
            VALUES(@id,'SYSTEM_JOB',@key,'Draft',@actor,jsonb_build_object('schemaVersion',1,'recordType','Announcement','createdBy',@actor::text,'view',@view::jsonb))
            """, t, ("id", id), ("key", "announcement:" + id), ("actor", scope.Actor), ("view", JsonSerializer.Serialize(view, CompactNotificationWriter.Json)));
        return view;
    }
    public async Task<AnnouncementView> SendAsync(NotificationScope scope, Guid id, CancellationToken t)
    {
        await using var tx = await db.Database.BeginTransactionAsync(t);
        var json = await sql.Scalar<string>("""
            SELECT task_data->'view' FROM operational_tasks WHERE id=@id AND task_data->>'recordType'='Announcement'
              AND (@owner OR assigned_user_id=@actor) FOR UPDATE
            """, t, ("id", id), ("owner", scope.Owner), ("actor", scope.Actor));
        if (json is null) throw new NotificationException(404, "announcement_not_found");
        var view = JsonSerializer.Deserialize<AnnouncementView>(json, CompactNotificationWriter.Json)!;
        if (view.Status == "Sent") { await tx.CommitAsync(t); return view; }
        var recipients = await Resolve(scope, view.Audience, t);
        foreach (var r in recipients) await sql.Emit(r.Id, "Tenant", r.Location, "announcement:" + id, "ANNOUNCEMENT_SENT", "Announcement", view.Title, view.Body,
            "Announcement", id, t, view.Priority, view.Channels, "Manual");
        view = view with { Status = "Sent", SentAt = sql.Now, RecipientCount = recipients.Count };
        await sql.Execute("UPDATE operational_tasks SET status='Sent',task_data=jsonb_set(task_data,'{view}',@view::jsonb),version=version+1 WHERE id=@id", t,
            ("id", id), ("view", JsonSerializer.Serialize(view, CompactNotificationWriter.Json)));
        await tx.CommitAsync(t); return view;
    }
    public async Task<IReadOnlyList<AnnouncementView>> SentAsync(NotificationScope scope, int page, int pageSize, CancellationToken t)
    {
        await using var cmd = await sql.Command("""
            SELECT task_data->'view' FROM operational_tasks WHERE task_data->>'recordType'='Announcement' AND status='Sent'
              AND (@owner OR assigned_user_id=@actor) ORDER BY (task_data->'view'->>'sentAt')::timestamptz DESC,id OFFSET @skip LIMIT @take
            """, t, ("owner", scope.Owner), ("actor", scope.Actor), ("skip", (page - 1) * pageSize), ("take", pageSize));
        var result = new List<AnnouncementView>(); await using var reader = await cmd.ExecuteReaderAsync(t);
        while (await reader.ReadAsync(t)) result.Add(JsonSerializer.Deserialize<AnnouncementView>(reader.GetString(0), CompactNotificationWriter.Json)!);
        return result;
    }
    public async Task<PushDeviceView> RegisterDeviceAsync(Guid actor, PushDeviceWrite input, CancellationToken t)
    {
        var key = "push-device:" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(input.PushToken)));
        await using var tx = await db.Database.BeginTransactionAsync(t);
        await sql.Execute("SELECT pg_advisory_xact_lock(hashtextextended(@key,0))", t, ("key", key));
        var other = await sql.Scalar<bool>("SELECT EXISTS(SELECT 1 FROM operational_tasks WHERE source_key=@key AND assigned_user_id<>@actor AND status='Active')", t, ("key", key), ("actor", actor));
        if (other) throw new NotificationException(409, "device_already_registered");
        var data = JsonSerializer.Serialize(new { schemaVersion = 1, recordType = "PushDevice", input.PushToken, input.Platform, lastSeenAt = sql.Now }, CompactNotificationWriter.Json);
        var id = await sql.Scalar<Guid>("""
            INSERT INTO operational_tasks(id,task_type,source_key,status,assigned_user_id,task_data) VALUES(@id,'SYSTEM_JOB',@key,'Active',@actor,@data::jsonb)
            ON CONFLICT(source_key) WHERE source_key IS NOT NULL DO UPDATE SET status='Active',assigned_user_id=@actor,task_data=@data::jsonb,version=operational_tasks.version+1 RETURNING id
            """, t, ("id", Guid.NewGuid()), ("key", key), ("actor", actor), ("data", data));
        await tx.CommitAsync(t); return new(id, input.Platform, true, sql.Now);
    }
    public async Task RemoveDeviceAsync(Guid actor, Guid id, CancellationToken t)
    {
        if (await sql.Execute("UPDATE operational_tasks SET status='Inactive',task_data=task_data-'pushToken',version=version+1 WHERE id=@id AND assigned_user_id=@actor AND task_data->>'recordType'='PushDevice'", t, ("id", id), ("actor", actor)) != 1)
            throw new NotificationException(404, "device_not_found");
    }
    public async Task<IReadOnlyList<NotificationChannelStatus>> DeliveriesAsync(Guid actor, Guid id, CancellationToken t)
    {
        if (!await sql.Scalar<bool>("SELECT EXISTS(SELECT 1 FROM notifications WHERE id=@id AND record_kind='INBOX' AND recipient_user_id=@actor)", t, ("id", id), ("actor", actor)))
            throw new NotificationException(404, "notification_not_found");
        await using var cmd = await sql.Command("""
            SELECT event_data->>'channel',delivery_status,(SELECT count(*)::int FROM jsonb_array_elements(delivery_history) h WHERE h->>'recordType'='ChannelClaim'),
              CASE WHEN delivery_status='Pending' THEN next_delivery_at ELSE NULL END FROM notifications
            WHERE event_data->>'recordType'='ChannelDelivery' AND event_data->>'notificationId'=@id::text AND event_data->>'recipient'=@actor::text ORDER BY event_data->>'channel'
            """, t, ("id", id), ("actor", actor));
        var result = new List<NotificationChannelStatus>(); await using var reader = await cmd.ExecuteReaderAsync(t);
        while (await reader.ReadAsync(t)) result.Add(new(reader.GetString(0), reader.GetString(1), reader.GetInt32(2), reader.IsDBNull(3) ? null : reader.GetFieldValue<DateTimeOffset>(3)));
        return result;
    }
    public async Task<NotificationChannelOverview> ChannelOverviewAsync(CancellationToken t)
    {
        await using var cmd = await sql.Command("""
            SELECT event_data->>'channel',delivery_status,count(*)::int FROM notifications
            WHERE record_kind='OUTBOX' AND event_data->>'recordType'='ChannelDelivery'
            GROUP BY event_data->>'channel',delivery_status ORDER BY event_data->>'channel',delivery_status
            """, t);
        var result = new List<NotificationChannelSummary>(); await using var reader = await cmd.ExecuteReaderAsync(t);
        while (await reader.ReadAsync(t)) result.Add(new(reader.GetString(0), reader.GetString(1), reader.GetInt32(2)));
        return new(options.Value.Enabled, options.Value.AutomationEnabled, options.Value.Mode, result);
    }
    public async Task<NotificationReminderPolicy> PolicyAsync(Guid location, CancellationToken t)
    {
        var json = await sql.Scalar<string>("SELECT COALESCE(operating_settings->'notificationPolicy','{}'::jsonb) FROM locations WHERE id=@id", t, ("id", location));
        return json is null ? throw new NotificationException(404, "location_not_found") : JsonSerializer.Deserialize<NotificationReminderPolicy>(json, CompactNotificationWriter.Json)!;
    }
    public async Task<NotificationReminderPolicy> SavePolicyAsync(Guid actor, Guid location, NotificationReminderPolicy input, CancellationToken t)
    {
        if (await sql.Execute("""
            UPDATE locations SET operating_settings=jsonb_set(operating_settings,'{notificationPolicy}',@data::jsonb),history=history||jsonb_build_array(jsonb_build_object(
              'recordType','NotificationPolicy','actor',@actor::text,'at',@now,'policy',@data::jsonb)),version=version+1 WHERE id=@id
            """, t, ("id", location), ("data", JsonSerializer.Serialize(input, CompactNotificationWriter.Json)), ("actor", actor), ("now", sql.Now)) != 1)
            throw new NotificationException(404, "location_not_found");
        return input;
    }
    public async Task<IReadOnlyList<TenantRoomView>> RoomsAsync(Guid actor, DateOnly today, Guid? id, CancellationToken t)
    {
        await using var cmd = await sql.Command("""
            SELECT DISTINCT rm.id,l.id,l.name,rm.room_number,rm.status,rm.capacity FROM rooms rm JOIN locations l ON l.id=rm.location_id
            JOIN contracts c ON c.room_id=rm.id JOIN contract_residents cr ON cr.contract_id=c.id JOIN residents r ON r.id=cr.resident_id
            WHERE r.user_id=@actor AND c.status=3 AND c.contract_type<>'HOLDING' AND c.start_date<=@today AND COALESCE(c.actual_end_date,c.end_date)>=@today
              AND cr.residence_from<=@today AND (cr.residence_to IS NULL OR cr.residence_to>=@today) AND (@id::uuid IS NULL OR rm.id=@id) ORDER BY rm.room_number,rm.id
            """, t, ("actor", actor), ("today", today), ("id", id));
        var result = new List<TenantRoomView>(); await using var reader = await cmd.ExecuteReaderAsync(t);
        while (await reader.ReadAsync(t)) result.Add(new(reader.GetGuid(0), reader.GetGuid(1), reader.GetString(2), reader.GetString(3), ((BHome.Domain.PropertyManagement.RoomStatus)reader.GetInt16(4)).ToString(), reader.GetInt16(5)));
        return result;
    }
}
