using System.Text.Json;
using BHome.Application.Operations;
using BHome.Infrastructure.Modules.Notifications;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Modules.Operations;

internal sealed class PersonalDataRequestRepository(Compact24DbContext db, CompactNotificationWriter sql) : IPersonalDataRequestRepository
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    public async Task<OperationsPage<PersonalDataRequestView>> ListAsync(Guid? userId, int page, int size, CancellationToken t)
    {
        const string source = "FROM users u CROSS JOIN LATERAL jsonb_array_elements(COALESCE(u.business_profile->'personalDataRequests','[]'::jsonb)) r WHERE (@user IS NULL OR u.id=@user)";
        var count = await sql.Scalar<long>("SELECT count(*) " + source, t, ("user", userId));
        await using var command = await sql.Command("SELECT r::text " + source + " ORDER BY (r->>'requestedAt')::timestamptz DESC,u.id,r->>'id' OFFSET @skip LIMIT @take", t,
            ("user", userId), ("skip", checked((page - 1) * size)), ("take", size));
        await using var reader = await command.ExecuteReaderAsync(t); var result = new List<PersonalDataRequestView>();
        while (await reader.ReadAsync(t)) result.Add(JsonSerializer.Deserialize<PersonalDataRequestView>(reader.GetString(0), Json)!);
        return new(result, page, size, checked((int)count));
    }

    public async Task<PersonalDataRequestView> CreateAsync(Guid actor, Guid id, PersonalDataRequestCreate input, DateTimeOffset now, CancellationToken t)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(t);
        var (requests, label) = await LockedRequests(actor, t);
        var existing = requests.SingleOrDefault(r => r.Id == id);
        if (existing is not null)
        {
            if (existing.RequestType != input.RequestType || existing.Description != input.Description) throw OperationsException.Conflict("personal_data_request_key_conflict");
            await transaction.CommitAsync(t); return existing;
        }
        var result = new PersonalDataRequestView(id, actor, label, input.RequestType, input.Description, "Pending", 1, now,
            [new(actor, now, "Pending", null, null)]);
        requests.Add(result);
        await Persist(actor, id, actor, requests, "PersonalDataRequestCreated", t);
        await transaction.CommitAsync(t); return result;
    }

    public async Task<PersonalDataRequestView> DecideAsync(Guid actor, Guid userId, Guid id, PersonalDataRequestDecision input, DateTimeOffset now, CancellationToken t)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(t);
        var (requests, _) = await LockedRequests(userId, t);
        var current = requests.SingleOrDefault(r => r.Id == id) ?? throw OperationsException.Missing();
        if (current.Version != input.ExpectedVersion || current.Status is "Resolved" or "Rejected") throw OperationsException.Conflict("personal_data_request_stale_or_closed");
        var result = current with
        {
            Status = input.Status,
            Version = current.Version + 1,
            History = current.History.Append(new PersonalDataRequestEvent(actor, now, input.Status, input.Resolution, input.Basis)).ToArray()
        };
        requests[requests.IndexOf(current)] = result;
        await Persist(userId, id, actor, requests, "PersonalDataRequestReviewed", t);
        await transaction.CommitAsync(t); return result;
    }

    private async Task<(List<PersonalDataRequestView> Requests, string Label)> LockedRequests(Guid userId, CancellationToken t)
    {
        await using var command = await sql.Command("SELECT COALESCE(business_profile->'personalDataRequests','[]'::jsonb)::text,COALESCE(full_name,'') FROM users WHERE id=@id FOR UPDATE", t, ("id", userId));
        await using var reader = await command.ExecuteReaderAsync(t);
        if (!await reader.ReadAsync(t)) throw OperationsException.Missing();
        return (JsonSerializer.Deserialize<List<PersonalDataRequestView>>(reader.GetString(0), Json)!, reader.GetString(1));
    }

    private async Task Persist(Guid userId, Guid target, Guid actor, List<PersonalDataRequestView> requests, string action, CancellationToken t)
    {
        await sql.Execute("UPDATE users SET business_profile=jsonb_set(business_profile,'{personalDataRequests}',@requests::jsonb,true) WHERE id=@id", t,
            ("id", userId), ("requests", JsonSerializer.Serialize(requests, Json)));
        await sql.Execute("""
            INSERT INTO notifications(id,record_kind,actor_user_id,event_key,notification_type,related_entity_type,related_entity_id,event_data,event_at,delivery_history)
            VALUES(@id,'AUDIT',@actor,@key,@action,'PersonalDataRequest',@target,'{"succeeded":true}'::jsonb,@now,'[]')
            """, t, ("id", Guid.NewGuid()), ("actor", actor), ("key", "privacy-request:" + Guid.NewGuid()), ("action", action), ("target", target), ("now", sql.Now));
        if (actor != userId)
        {
            var role = await sql.Scalar<string>("SELECT CASE WHEN 'Tenant'=ANY(roles) THEN 'Tenant' ELSE 'Staff' END FROM users WHERE id=@id", t, ("id", userId));
            await sql.Emit(userId, role!, null, $"privacy-request:{target}:{requests.Single(r => r.Id == target).Version}", "personal_data_request_updated", "ACCOUNT",
                "Yêu cầu dữ liệu đã được cập nhật", "Mở hồ sơ cá nhân để xem phản hồi.", "PersonalDataRequest", target, t);
        }
    }
}
