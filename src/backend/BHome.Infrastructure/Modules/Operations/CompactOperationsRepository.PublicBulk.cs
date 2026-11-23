using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using BHome.Application.Operations;

namespace BHome.Infrastructure.Modules.Operations;

internal sealed partial class CompactOperationsRepository
{
    private sealed record BulkRoom(Guid Id, string Number, int Version, bool Published,
        bool NeedsRepublish, RoomProfile Profile);
    private sealed record BulkSource(string Description, string[] Amenities, decimal? Price);
    private sealed record BulkSnapshot(
        Dictionary<Guid, BulkRoom> Rooms, bool LocationActive, bool LocationPublished,
        BulkSource? Source, string? SourceIssue, Dictionary<Guid, Guid> DefaultsByRoom);

    public async Task<IReadOnlyList<RoomPublicContent>> ManagedRoomsAsync(Guid locationId, CancellationToken t)
    {
        await Open(t);
        await using var command = Command("""
            SELECT r.id,r.location_id,r.room_number,r.floor,r.capacity,r.status,r.public_profile::text,
                   r.published_at,r.public_profile ? 'published',r.version
            FROM rooms r WHERE r.location_id=@location ORDER BY r.room_number,r.id LIMIT 2001
            """);
        command.Parameters.AddWithValue("location", locationId);
        var result = new List<RoomPublicContent>();
        await using var reader = await command.ExecuteReaderAsync(t);
        while (await reader.ReadAsync(t)) result.Add(RoomContent(reader));
        if (result.Count > 2000) throw OperationsException.Conflict("public_room_list_limit");
        return result;
    }

    private async Task<BulkSnapshot> LoadBulkSnapshot(Guid locationId, PublicRoomBulkRequest input, bool locked, CancellationToken t)
    {
        await Open(t);
        bool active;
        bool published;
        await using (var parent = Command("SELECT is_active,published_at IS NOT NULL FROM locations WHERE id=@location" +
                                         (locked ? " FOR UPDATE" : "")))
        {
            parent.Parameters.AddWithValue("location", locationId);
            await using var reader = await parent.ExecuteReaderAsync(t);
            if (!await reader.ReadAsync(t)) throw OperationsException.Missing();
            active = reader.GetBoolean(0);
            published = reader.GetBoolean(1);
        }

        var rooms = new Dictionary<Guid, BulkRoom>();
        await using (var command = Command("""
            SELECT id,room_number,version,published_at IS NOT NULL,public_profile::text,
                   (public_profile->'published') IS DISTINCT FROM (public_profile-'published')
            FROM rooms WHERE location_id=@location ORDER BY id
            """ + (locked ? " FOR UPDATE" : "")))
        {
            command.Parameters.AddWithValue("location", locationId);
            await using var reader = await command.ExecuteReaderAsync(t);
            while (await reader.ReadAsync(t))
            {
                var profile = JsonSerializer.Deserialize<RoomProfile>(reader.IsDBNull(4) ? "{}" : reader.GetString(4), Json) ?? new();
                var row = new BulkRoom(reader.GetGuid(0), reader.GetString(1), reader.GetInt32(2),
                    reader.GetBoolean(3), reader.GetBoolean(5), profile);
                rooms.Add(row.Id, row);
            }
        }

        BulkSource? source = null;
        string? sourceIssue = null;
        var provenance = new Dictionary<Guid, Guid>();
        if (input.Mode == "Room")
        {
            if (!input.SourceId.HasValue || !rooms.TryGetValue(input.SourceId.Value, out var room))
                sourceIssue = "source_not_in_location";
            else if (room.Version != input.SourceVersion) sourceIssue = "stale_source_version";
            else source = new(room.Profile.Description, [.. room.Profile.Amenities ?? []], room.Profile.IndicativePrice);
        }
        if (input.Mode == "RoomDefaults")
        {
            await using (var command = Command("""
                SELECT (task_data->'document')::text FROM operational_tasks
                WHERE id=@source AND location_id=@location AND task_type='SYSTEM_JOB'
                  AND task_data->>'recordType'='SetupRoomDefaults'
                """ + (locked ? " FOR SHARE" : "")))
            {
                command.Parameters.AddWithValue("source", input.SourceId!.Value);
                command.Parameters.AddWithValue("location", locationId);
                var raw = await command.ExecuteScalarAsync(t) as string;
                if (raw is null) sourceIssue = "source_not_in_location";
                else
                {
                    using var doc = JsonDocument.Parse(raw);
                    var root = doc.RootElement;
                    if (root.GetProperty("version").GetInt32() != input.SourceVersion)
                        sourceIssue = "stale_source_version";
                    else if (root.GetProperty("status").GetString() != "Recorded")
                        sourceIssue = "source_not_active";
                    else
                    {
                        var data = root.GetProperty("data");
                        var defaults = data.GetProperty("defaults");
                        source = new(
                            data.TryGetProperty("description", out var desc) && desc.ValueKind == JsonValueKind.String ? desc.GetString() ?? "" : "",
                            defaults.TryGetProperty("amenities", out var amenities) && amenities.ValueKind == JsonValueKind.Array
                                ? amenities.EnumerateArray().Select(x => x.GetString() ?? "").ToArray() : [],
                            defaults.TryGetProperty("referenceRent", out var price) && price.ValueKind is JsonValueKind.Number or JsonValueKind.String
                                ? decimal.Parse(price.ToString(), CultureInfo.InvariantCulture) : null);
                    }
                }
            }
            await using (var command = Command("""
                SELECT task_data->'document'->'data'->>'roomId',
                       task_data->'document'->'data'->>'roomDefaultsId'
                FROM operational_tasks
                WHERE location_id=@location AND task_type='SYSTEM_JOB'
                  AND task_data->>'recordType'='SetupRoomProvenance'
                """))
            {
                command.Parameters.AddWithValue("location", locationId);
                await using var reader = await command.ExecuteReaderAsync(t);
                while (await reader.ReadAsync(t))
                    if (Guid.TryParse(reader.IsDBNull(0) ? null : reader.GetString(0), out var roomId) &&
                        Guid.TryParse(reader.IsDBNull(1) ? null : reader.GetString(1), out var defaultsId))
                        provenance[roomId] = defaultsId;
            }
        }
        if (input.Mode == "Manual")
            source = new(input.Description ?? "", input.Amenities ?? [], input.IndicativePrice);
        return new(rooms, active, published, source, sourceIssue, provenance);
    }

    private static string Value(string field, BulkSource value) => field switch
    {
        "description" => value.Description,
        "amenities" => string.Join(", ", value.Amenities),
        "indicativePrice" => value.Price?.ToString(CultureInfo.InvariantCulture) ?? "",
        _ => ""
    };

    private static BulkSource Source(RoomProfile profile) =>
        new(profile.Description, [.. profile.Amenities ?? []], profile.IndicativePrice);

    private static RoomProfile ChangeProfile(RoomProfile original, BulkSource source, IReadOnlyList<PublicRoomFieldChange> changes)
    {
        var next = original;
        foreach (var change in changes)
            next = change.Field switch
            {
                "description" => next with { Description = source.Description },
                "amenities" => next with { Amenities = source.Amenities },
                "indicativePrice" => next with { IndicativePrice = source.Price },
                _ => next
            };
        return next;
    }

    private static PublicRoomBulkPreview BuildBulkPreview(Guid locationId, PublicRoomBulkRequest input, BulkSnapshot snapshot)
    {
        var result = new List<PublicRoomBulkRow>();
        foreach (var target in input.Targets)
        {
            if (!snapshot.Rooms.TryGetValue(target.RoomId, out var room))
            {
                result.Add(new(target.RoomId, "Phòng không thuộc cơ sở", 0, "Conflict", [], "room_not_in_location"));
                continue;
            }
            string? issue = room.Version == target.ExpectedVersion ? null : "stale_version";
            var changes = new List<PublicRoomFieldChange>();
            if (issue is null && input.Mode == "Publish")
            {
                if (!snapshot.LocationActive || !snapshot.LocationPublished) issue = "public_location_not_published";
                else if (string.IsNullOrWhiteSpace(room.Profile.Description)) issue = "public_room_incomplete";
                else if (!room.Published)
                    changes.Add(new("published", "Chưa đăng", "Đăng lên website", false));
                else if (room.NeedsRepublish)
                    changes.Add(new("published", "Đang đăng", "Cập nhật nội dung website", false));
            }
            else if (issue is null && input.Mode == "Unpublish" && room.Published)
                changes.Add(new("published", "Đang đăng", "Ẩn khỏi website", false));
            else if (issue is null && input.Mode is "Room" or "RoomDefaults" or "Manual")
            {
                issue = snapshot.SourceIssue;
                if (issue is null && input.Mode == "RoomDefaults" &&
                    (!snapshot.DefaultsByRoom.TryGetValue(room.Id, out var defaultsId) || defaultsId != input.SourceId))
                    issue = "room_defaults_not_assigned";
                if (issue is null && snapshot.Source is { } source)
                {
                    var current = Source(room.Profile);
                    foreach (var field in input.Fields)
                    {
                        var before = Value(field, current);
                        var after = Value(field, source);
                        var filled = field == "indicativePrice" ? current.Price is not null : !string.IsNullOrWhiteSpace(before);
                        if (before == after || input.FillEmptyOnly && filled || string.IsNullOrEmpty(after)) continue;
                        changes.Add(new(field, before, after, filled));
                    }
                }
            }
            result.Add(new(room.Id, room.Number, room.Version, issue is not null ? "Conflict" : changes.Count > 0 ? "Ready" : "Skipped", changes, issue));
        }
        // The preview binds source content and requested target versions. A target changed
        // after preview is rejected individually, while unchanged targets may still succeed.
        var content = JsonSerializer.Serialize(new
        {
            locationId,
            input.Mode,
            input.SourceId,
            input.SourceVersion,
            input.Fields,
            input.FillEmptyOnly,
            input.Description,
            input.Amenities,
            input.IndicativePrice,
            input.Targets,
            snapshot.LocationActive,
            snapshot.LocationPublished,
            snapshot.Source,
            snapshot.SourceIssue,
            DefaultsByRoom = snapshot.DefaultsByRoom.OrderBy(item => item.Key).ToArray()
        }, Json);
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(content)));
        return new(hash, result);
    }

    public async Task<PublicRoomBulkPreview> PreviewPublicRoomBulkAsync(Guid locationId, PublicRoomBulkRequest input, CancellationToken t) =>
        BuildBulkPreview(locationId, input, await LoadBulkSnapshot(locationId, input, false, t));

    public async Task<PublicRoomBulkResult> ApplyPublicRoomBulkAsync(Guid actorId, Guid locationId, PublicRoomBulkRequest input,
        DateTimeOffset now, CancellationToken t)
    {
        await using var tx = await db.Database.BeginTransactionAsync(t);
        var snapshot = await LoadBulkSnapshot(locationId, input, true, t);
        var preview = BuildBulkPreview(locationId, input, snapshot);
        if (!string.Equals(input.PreviewHash, preview.PreviewHash, StringComparison.OrdinalIgnoreCase))
            throw OperationsException.Conflict("public_bulk_preview_changed");

        var writes = preview.Rooms.Where(x => x.Status == "Ready").Select(row =>
        {
            var before = snapshot.Rooms[row.RoomId];
            return new
            {
                id = row.RoomId,
                version = row.CurrentVersion,
                profile = ChangeProfile(before.Profile, snapshot.Source ?? Source(before.Profile), row.Changes)
            };
        }).ToArray();
        if (writes.Length > 0)
        {
            await using var command = Command("""
                UPDATE rooms r SET
                  public_profile=CASE WHEN @mode='Publish' THEN jsonb_set(r.public_profile,'{published}',r.public_profile-'published')
                      WHEN @mode='Unpublish' THEN r.public_profile
                      ELSE updates.profile || CASE WHEN r.public_profile ? 'published'
                          THEN jsonb_build_object('published',r.public_profile->'published') ELSE '{}'::jsonb END END,
                  published_at=CASE WHEN @mode='Publish' THEN @now WHEN @mode='Unpublish' THEN NULL ELSE r.published_at END,
                  published_by_user_id=CASE WHEN @mode='Publish' THEN @actor WHEN @mode='Unpublish' THEN NULL ELSE r.published_by_user_id END,
                  version=r.version+1,
                  history=r.history||jsonb_build_array(jsonb_build_object('action',@action,'actorId',@actor,'occurredAt',@now))
                FROM jsonb_to_recordset(CAST(@rows AS jsonb)) AS updates(id uuid,version integer,profile jsonb)
                WHERE r.id=updates.id AND r.location_id=@location AND r.version=updates.version
                """);
            command.Parameters.AddWithValue("mode", input.Mode);
            command.Parameters.AddWithValue("rows", JsonSerializer.Serialize(writes, Json));
            command.Parameters.AddWithValue("location", locationId);
            command.Parameters.AddWithValue("actor", actorId);
            command.Parameters.AddWithValue("now", now);
            command.Parameters.AddWithValue("action", "PublicRoomBulk" + input.Mode);
            if (await command.ExecuteNonQueryAsync(t) != writes.Length)
                throw OperationsException.Conflict("public_bulk_preview_changed");
        }
        await tx.CommitAsync(t);
        return new(preview.Rooms.Select(row => row with { Status = row.Status == "Ready" ? "Applied" : row.Status }).ToArray());
    }
}
