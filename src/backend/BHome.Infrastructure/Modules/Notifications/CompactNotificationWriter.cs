using System.Text.Json;
using BHome.Application.Notifications;
using BHome.Domain.Notifications;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;
using NpgsqlTypes;

namespace BHome.Infrastructure.Modules.Notifications;

// Parameterized access to the existing notification/workspace containers. No schema inference.
internal sealed class CompactNotificationWriter(Compact24DbContext db, TimeProvider clock)
{
    internal static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    internal DateTimeOffset Now => clock.GetUtcNow();
    internal async Task<NpgsqlCommand> Command(string sql, CancellationToken t, params (string Key, object? Value)[] args)
    {
        await db.Database.OpenConnectionAsync(t);
        var cmd = new NpgsqlCommand(sql, (NpgsqlConnection)db.Database.GetDbConnection(), (NpgsqlTransaction?)db.Database.CurrentTransaction?.GetDbTransaction());
        foreach (var (key, value) in args)
            if (value is null) cmd.Parameters.AddWithValue(key, NpgsqlDbType.Uuid, DBNull.Value);
            else cmd.Parameters.AddWithValue(key, value);
        return cmd;
    }
    internal async Task<int> Execute(string sql, CancellationToken t, params (string Key, object? Value)[] args)
    { await using var cmd = await Command(sql, t, args); return await cmd.ExecuteNonQueryAsync(t); }
    internal async Task<T?> Scalar<T>(string sql, CancellationToken t, params (string Key, object? Value)[] args)
    { await using var cmd = await Command(sql, t, args); var result = await cmd.ExecuteScalarAsync(t); return result is null or DBNull ? default : (T)result; }
    internal async Task<int> Emit(Guid user, string role, Guid? location, string key, string eventType, string category,
        string title, string body, string type, Guid target, CancellationToken t, string priority = "P1", string[]? channels = null, string source = "System", Guid? taskSource = null)
    {
        var id = Guid.NewGuid(); var now = Now;
        var state = new UserNotification { Id = id, RecipientUserId = user, AudienceRole = role, LocationId = location, EventKey = key,
            EventType = eventType, Category = category, Title = title, Summary = body, RelatedObjectType = type, RelatedObjectId = target,
            Priority = priority, Source = source, Channels = channels ?? ["IN_APP", "PUSH"], CreatedAt = now, SourceTaskNotificationId = taskSource };
        var data = JsonSerializer.Serialize(new { schemaVersion = 2, recordType = "UserNotification", audienceRole = role, category, state }, Json);
        return await Execute("""
            INSERT INTO notifications(id,record_kind,recipient_user_id,location_id,event_key,notification_type,title,message,related_entity_type,related_entity_id,event_data,event_at,delivery_status)
            VALUES(@id,'INBOX',@user,@location,@key,@event,@title,@body,@type,@target,@data::jsonb,@now,'Unconfigured')
            ON CONFLICT (recipient_user_id,event_key) WHERE record_kind='INBOX' DO NOTHING
            """, t, ("id", id), ("user", user), ("location", location), ("key", key), ("event", eventType), ("title", title), ("body", body),
            ("type", type), ("target", target), ("data", data), ("now", now));
    }
}
