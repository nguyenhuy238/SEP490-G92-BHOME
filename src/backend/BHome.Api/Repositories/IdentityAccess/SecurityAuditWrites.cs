using System.Text.Json;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.IdentityAccess;

internal static class SecurityAuditWrites
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    internal static async Task AppendAsync(BHomePersistenceContext db, SecurityAuditEvent state, CancellationToken token)
    {
        if (db is not Compact24DbContext)
        {
            db.SecurityAudit.Add(new SecurityAuditRecord
            {
                Id = state.Id, UserId = state.UserId, TargetUserId = state.TargetUserId, SessionId = state.SessionId,
                Event = state.Event, Succeeded = state.Succeeded, OccurredAt = state.OccurredAt,
                TargetType = state.TargetType, TargetId = state.TargetId
            });
            await db.SaveChangesAsync(token);
            return;
        }
        if (db.Database.CurrentTransaction is null)
            throw new InvalidOperationException("Security audit must share the protected operation transaction.");
        var payload = JsonSerializer.Serialize(new
        {
            schemaVersion = 1, recordType = "SecurityAuditRecord", state,
            audienceRole = (string?)null, category = (string?)null,
            succeeded = state.Succeeded, sessionId = state.SessionId, targetUserId = state.TargetUserId
        }, Json);
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO notifications(id,record_kind,actor_user_id,event_key,notification_type,
              related_entity_type,related_entity_id,event_data,event_at)
            VALUES({state.Id},'AUDIT',{state.UserId},{"SecurityAuditRecord:" + state.Id},{state.Event},
              {state.TargetType},{state.TargetId},CAST({payload} AS jsonb),{state.OccurredAt})
            """, token);
    }
}
