using System.Data;
using System.Globalization;
using System.Text.Json;
using BHome.Application.Operations;
using BHome.Domain.IdentityAccess;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;
using NpgsqlTypes;

namespace BHome.Infrastructure.Modules.Operations;

internal sealed class CompactOperationsRepository(Compact24DbContext db, UserManager<ApplicationUser> users)
    : IOperationsRepository
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public async Task<ProfileView?> ProfileAsync(Guid userId, CancellationToken t)
    {
        await Open(t); await using var command = Command("""
            SELECT id,COALESCE(full_name,''),phone,email,roles,is_active,concurrency_stamp
            FROM users WHERE id=@id
            """);
        command.Parameters.AddWithValue("id", userId);
        await using var reader = await command.ExecuteReaderAsync(t);
        return await reader.ReadAsync(t) ? Profile(reader) : null;
    }

    public async Task<ProfileView> UpdateProfileAsync(Guid userId, ProfileUpdate input, DateTimeOffset now, CancellationToken t)
    {
        await using var tx = await db.Database.BeginTransactionAsync(t); await Open(t);
        await EnsurePhoneAvailable(userId, input.Phone, t);
        var normalized = input.Email.ToUpperInvariant(); var nextVersion = Guid.NewGuid().ToString("N");
        await using var command = Command("""
            UPDATE users SET full_name=@name,phone=@phone,email=@email,normalized_email=@normalized,
                username=@email,normalized_username=@normalized,
                email_confirmed=CASE WHEN normalized_email=@normalized THEN email_confirmed ELSE false END,
                phone_confirmed=CASE WHEN phone IS NOT DISTINCT FROM @phone THEN phone_confirmed ELSE false END,
                security_stamp=CASE WHEN normalized_email=@normalized AND phone IS NOT DISTINCT FROM @phone THEN security_stamp ELSE @stamp END,
                concurrency_stamp=@next,
                history=history||jsonb_build_array(jsonb_build_object('action','ProfileUpdated','actorId',id,
                    'occurredAt',@now,'emailChanged',normalized_email IS DISTINCT FROM @normalized,
                    'phoneChanged',phone IS DISTINCT FROM @phone))
            WHERE id=@id AND concurrency_stamp=@version
            """);
        command.Parameters.AddWithValue("name", input.FullName); command.Parameters.AddWithValue("phone", (object?)input.Phone ?? DBNull.Value);
        command.Parameters.AddWithValue("email", input.Email); command.Parameters.AddWithValue("normalized", normalized);
        command.Parameters.AddWithValue("stamp", Guid.NewGuid().ToString("N")); command.Parameters.AddWithValue("next", nextVersion);
        command.Parameters.AddWithValue("now", now); command.Parameters.AddWithValue("id", userId); command.Parameters.AddWithValue("version", input.Version);
        try
        {
            if (await command.ExecuteNonQueryAsync(t) != 1) throw OperationsException.Conflict("stale_profile_version");
            await Audit(userId, "ProfileUpdated", "User", userId, now, t); await tx.CommitAsync(t);
        }
        catch (PostgresException e) when (e.SqlState == PostgresErrorCodes.UniqueViolation)
        { throw OperationsException.Conflict("email_already_used"); }
        return (await ProfileAsync(userId, t))!;
    }

    public async Task<OperationsPage<StaffView>> StaffAsync(StaffQuery query, CancellationToken t)
    {
        await Open(t); var where = "'Staff'=ANY(u.roles) AND (@active IS NULL OR u.is_active=@active) AND (@search IS NULL OR u.full_name ILIKE '%'||@search||'%' OR u.email ILIKE '%'||@search||'%')";
        await using var count = Command("SELECT count(*) FROM users u WHERE " + where); StaffParameters(count, query);
        var total = Convert.ToInt32(await count.ExecuteScalarAsync(t), CultureInfo.InvariantCulture);
        await using var command = Command("""
            SELECT u.id,COALESCE(u.full_name,''),u.phone,u.email,u.is_active,u.concurrency_stamp,
                   e.id,e.contract_number,e.start_date,e.end_date,e.salary_type,e.base_rate,e.status,
                   COALESCE(e.reward_penalty_policy->>'employmentType','')
            FROM users u LEFT JOIN LATERAL (
                SELECT * FROM staff_employments x WHERE x.staff_user_id=u.id ORDER BY x.start_date DESC,x.id LIMIT 1
            ) e ON TRUE WHERE 
            """ + where + " ORDER BY u.full_name,u.id OFFSET @skip LIMIT @take");
        StaffParameters(command, query); command.Parameters.AddWithValue("skip", checked((query.Page - 1) * query.PageSize)); command.Parameters.AddWithValue("take", query.PageSize);
        var result = new List<StaffView>(); await using var reader = await command.ExecuteReaderAsync(t);
        while (await reader.ReadAsync(t)) result.Add(Staff(reader));
        return new(result, query.Page, query.PageSize, total);
    }

    public async Task<StaffView?> StaffAsync(Guid userId, CancellationToken t)
    {
        await Open(t); await using var command = Command("""
            SELECT u.id,COALESCE(u.full_name,''),u.phone,u.email,u.is_active,u.concurrency_stamp,
                   e.id,e.contract_number,e.start_date,e.end_date,e.salary_type,e.base_rate,e.status,
                   COALESCE(e.reward_penalty_policy->>'employmentType','')
            FROM users u LEFT JOIN LATERAL (
                SELECT * FROM staff_employments x WHERE x.staff_user_id=u.id ORDER BY x.start_date DESC,x.id LIMIT 1
            ) e ON TRUE WHERE u.id=@id AND 'Staff'=ANY(u.roles)
            """); command.Parameters.AddWithValue("id", userId);
        await using var reader = await command.ExecuteReaderAsync(t); return await reader.ReadAsync(t) ? Staff(reader) : null;
    }

    public async Task<StaffView> CreateStaffAsync(Guid actorId, StaffCreate input, DateTimeOffset now, CancellationToken t)
    {
        await using var tx = await db.Database.BeginTransactionAsync(t);
        await Open(t); await EnsurePhoneAvailable(Guid.Empty, input.Phone, t);
        var user = new ApplicationUser
        {
            Id = Guid.NewGuid(),
            UserName = input.Email,
            Email = input.Email,
            PhoneNumber = input.Phone,
            EmailConfirmed = false,
            IsActive = true,
            SecurityStamp = Guid.NewGuid().ToString("N"),
            ConcurrencyStamp = Guid.NewGuid().ToString("N")
        };
        db.PrepareUserRole(user, Roles.Staff);
        var created = await users.CreateAsync(user, input.InitialPassword);
        if (!created.Succeeded) throw OperationsException.Invalid("invalid_staff_account");
        if (!await users.IsInRoleAsync(user, Roles.Staff))
        {
            var role = await users.AddToRoleAsync(user, Roles.Staff);
            if (!role.Succeeded) throw OperationsException.Invalid("invalid_staff_role");
        }
        await using (var update = Command("UPDATE users SET full_name=@name WHERE id=@id"))
        { update.Parameters.AddWithValue("name", input.FullName); update.Parameters.AddWithValue("id", user.Id); await update.ExecuteNonQueryAsync(t); }
        await SaveEmployment(user.Id, null, input.Employment, actorId, now, t);
        await Audit(actorId, "StaffCreated", "User", user.Id, now, t); await tx.CommitAsync(t);
        return (await StaffAsync(user.Id, t))!;
    }

    public async Task<StaffView> UpdateStaffAsync(Guid actorId, Guid userId, StaffUpdate input, DateTimeOffset now, CancellationToken t)
    {
        await using var tx = await db.Database.BeginTransactionAsync(t); await Open(t);
        await using (var lockUser = Command("SELECT is_active FROM users WHERE id=@id AND 'Staff'=ANY(roles) FOR UPDATE"))
        {
            lockUser.Parameters.AddWithValue("id", userId); var current = await lockUser.ExecuteScalarAsync(t);
            if (current is null) throw OperationsException.Missing();
            if ((bool)current && !input.IsActive && await HasResponsibilities(userId, DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(now, "Asia/Ho_Chi_Minh").DateTime), t))
                throw OperationsException.Conflict("staff_responsibilities_unresolved");
        }
        await EnsurePhoneAvailable(userId, input.Phone, t);
        var normalized = input.Email.ToUpperInvariant(); var next = Guid.NewGuid().ToString("N");
        await using (var update = Command("""
            UPDATE users SET full_name=@name,phone=@phone,email=@email,normalized_email=@normalized,
                username=@email,normalized_username=@normalized,is_active=@active,
                email_confirmed=CASE WHEN normalized_email=@normalized THEN email_confirmed ELSE false END,
                phone_confirmed=CASE WHEN phone IS NOT DISTINCT FROM @phone THEN phone_confirmed ELSE false END,
                security_stamp=CASE WHEN normalized_email=@normalized AND phone IS NOT DISTINCT FROM @phone AND is_active=@active THEN security_stamp ELSE @stamp END,
                concurrency_stamp=@next,
                history=history||jsonb_build_array(jsonb_build_object('action','StaffUpdated','actorId',@actor,'occurredAt',@now,'reason',@reason))
            WHERE id=@id AND concurrency_stamp=@version AND 'Staff'=ANY(roles)
            """))
        {
            update.Parameters.AddWithValue("name", input.FullName); update.Parameters.AddWithValue("phone", (object?)input.Phone ?? DBNull.Value);
            update.Parameters.AddWithValue("email", input.Email); update.Parameters.AddWithValue("normalized", normalized); update.Parameters.AddWithValue("active", input.IsActive);
            update.Parameters.AddWithValue("stamp", Guid.NewGuid().ToString("N")); update.Parameters.AddWithValue("next", next);
            update.Parameters.AddWithValue("actor", actorId); update.Parameters.AddWithValue("now", now); update.Parameters.AddWithValue("reason", input.Reason);
            update.Parameters.AddWithValue("id", userId); update.Parameters.AddWithValue("version", input.AccountVersion);
            try { if (await update.ExecuteNonQueryAsync(t) != 1) throw OperationsException.Conflict("stale_staff_version"); }
            catch (PostgresException e) when (e.SqlState == PostgresErrorCodes.UniqueViolation) { throw OperationsException.Conflict("email_already_used"); }
        }
        Guid? employmentId; await using (var select = Command("SELECT id FROM staff_employments WHERE staff_user_id=@id ORDER BY start_date DESC,id LIMIT 1"))
        { select.Parameters.AddWithValue("id", userId); var value = await select.ExecuteScalarAsync(t); employmentId = value is Guid id ? id : null; }
        await SaveEmployment(userId, employmentId, input.Employment, actorId, now, t);
        await Audit(actorId, "StaffUpdated", "User", userId, now, t); await tx.CommitAsync(t);
        return (await StaffAsync(userId, t))!;
    }

    public Task<OperationsPage<ResidenceTaskView>> ResidenceAsync(ResidenceQuery query, Guid? tenantUserId, CancellationToken t) =>
        ResidencePage(query, tenantUserId, t);

    public async Task<ResidenceTaskView?> ResidenceAsync(Guid contractId, Guid residentId, Guid? tenantUserId, CancellationToken t)
    {
        await Open(t); await using var command = Command(ResidenceSelect + " WHERE cr.contract_id=@contract AND cr.resident_id=@resident AND (@tenant IS NULL OR r.user_id=@tenant)");
        command.Parameters.AddWithValue("contract", contractId); command.Parameters.AddWithValue("resident", residentId); AddNullableUuid(command, "tenant", tenantUserId);
        await using var reader = await command.ExecuteReaderAsync(t); return await reader.ReadAsync(t) ? Residence(reader) : null;
    }

    public Task<ResidenceTaskView> UpdateResidenceAsync(Guid actorId, Guid contractId, Guid residentId,
        ResidenceUpdate input, DateTimeOffset now, CancellationToken t) => ResidenceMutation(actorId, contractId, residentId, now, t, async () =>
    {
        await using var command = Command("""
            UPDATE contract_residents cr SET actual_residence_from=@actual,registration_status=@status,
                registration_result_at=@result,owner_confirmed_by_user_id=NULL,owner_confirmed_at=NULL,
                history=cr.history||jsonb_build_array(jsonb_build_object('action','TenantStatusUpdated','actorId',@actor,
                    'occurredAt',@now,'status',@status,'note',@note))
            FROM residents r,contracts c WHERE cr.contract_id=@contract AND cr.resident_id=@resident
              AND r.id=cr.resident_id AND r.user_id=@actor AND c.id=cr.contract_id AND c.status=3
              AND @actual>=cr.residence_from
              AND (COALESCE(cr.registration_status,'Pending')<>'Completed' OR @status='Completed')
              AND (@status<>'Completed' OR (cr.registration_evidence_key IS NOT NULL AND @result IS NOT NULL))
            """);
        command.Parameters.AddWithValue("actual", input.ActualResidenceFrom); command.Parameters.AddWithValue("status", input.Status);
        command.Parameters.AddWithValue("result", NpgsqlDbType.TimestampTz, (object?)input.ResultAt ?? DBNull.Value); command.Parameters.AddWithValue("actor", actorId);
        command.Parameters.AddWithValue("now", now); command.Parameters.AddWithValue("note", NpgsqlDbType.Text, (object?)input.Note ?? DBNull.Value);
        command.Parameters.AddWithValue("contract", contractId); command.Parameters.AddWithValue("resident", residentId);
        if (await command.ExecuteNonQueryAsync(t) != 1) throw OperationsException.Conflict("invalid_residence_transition");
    });

    public Task<ResidenceTaskView> ConfirmResidenceAsync(Guid actorId, Guid contractId, Guid residentId,
        ResidenceOwnerConfirmation input, DateTimeOffset now, CancellationToken t) => ResidenceMutation(actorId, contractId, residentId, now, t, async () =>
    {
        await using var command = Command("""
            UPDATE contract_residents cr SET owner_confirmed_by_user_id=@actor,owner_confirmed_at=@now,
                history=history||jsonb_build_array(jsonb_build_object('action','OwnerConfirmed','actorId',@actor,'occurredAt',@now,'note',@note))
            WHERE contract_id=@contract AND resident_id=@resident AND registration_status='Completed'
              AND registration_evidence_key IS NOT NULL AND owner_confirmed_at IS NULL
            """);
        command.Parameters.AddWithValue("actor", actorId); command.Parameters.AddWithValue("now", now); command.Parameters.AddWithValue("note", input.Note);
        command.Parameters.AddWithValue("contract", contractId); command.Parameters.AddWithValue("resident", residentId);
        if (await command.ExecuteNonQueryAsync(t) != 1) throw OperationsException.Conflict("residence_not_ready_for_confirmation");
    });

    public Task<ResidenceTaskView> AttachResidenceEvidenceAsync(Guid actorId, Guid contractId, Guid residentId,
        OperationsFile file, DateTimeOffset now, CancellationToken t) => ResidenceMutation(actorId, contractId, residentId, now, t, async () =>
    {
        await using var command = Command("""
            UPDATE contract_residents cr SET registration_evidence_key=@key,
                owner_confirmed_by_user_id=NULL,owner_confirmed_at=NULL,
                history=cr.history||jsonb_build_array(jsonb_build_object('action','EvidenceUploaded','actorId',@actor,
                  'occurredAt',@now,'contentType',@type,'length',@length))
            FROM residents r,contracts c WHERE cr.contract_id=@contract AND cr.resident_id=@resident
              AND r.id=cr.resident_id AND r.user_id=@actor AND c.id=cr.contract_id AND c.status=3
            """);
        command.Parameters.AddWithValue("key", file.ObjectKey); command.Parameters.AddWithValue("actor", actorId); command.Parameters.AddWithValue("now", now);
        command.Parameters.AddWithValue("type", file.ContentType); command.Parameters.AddWithValue("length", file.Length);
        command.Parameters.AddWithValue("contract", contractId); command.Parameters.AddWithValue("resident", residentId);
        if (await command.ExecuteNonQueryAsync(t) != 1) throw OperationsException.Missing();
    });

    public async Task<OperationsFile?> ResidenceEvidenceAsync(Guid contractId, Guid residentId, Guid? tenantUserId, CancellationToken t)
    {
        await Open(t); await using var command = Command("""
            SELECT cr.registration_evidence_key,
              COALESCE((SELECT h->>'contentType' FROM jsonb_array_elements(cr.history) h WHERE h->>'action'='EvidenceUploaded' ORDER BY (h->>'occurredAt')::timestamptz DESC LIMIT 1),'image/jpeg'),
              COALESCE((SELECT (h->>'length')::bigint FROM jsonb_array_elements(cr.history) h WHERE h->>'action'='EvidenceUploaded' ORDER BY (h->>'occurredAt')::timestamptz DESC LIMIT 1),0)
            FROM contract_residents cr JOIN residents r ON r.id=cr.resident_id
            WHERE cr.contract_id=@contract AND cr.resident_id=@resident AND cr.registration_evidence_key IS NOT NULL
              AND (@tenant IS NULL OR r.user_id=@tenant)
            """); command.Parameters.AddWithValue("contract", contractId); command.Parameters.AddWithValue("resident", residentId); AddNullableUuid(command, "tenant", tenantUserId);
        await using var reader = await command.ExecuteReaderAsync(t); return await reader.ReadAsync(t) ? new(reader.GetString(0), reader.GetString(1), reader.GetInt64(2)) : null;
    }

    public async Task<OperationsPage<RoomOccupancyView>> OccupancyAsync(OccupancyQuery query, Guid? staffUserId, DateOnly today, CancellationToken t)
    {
        await Open(t); var scope = "(@location IS NULL OR rm.location_id=@location) AND (@status IS NULL OR rm.status=@status) AND (@staff IS NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements(l.staff_assignments) a WHERE (a->>'staffUserId')::uuid=@staff AND (a->>'startDate')::date<=@today AND (a->>'endDate')::date>=@today))";
        await using var count = Command("SELECT count(*) FROM rooms rm JOIN locations l ON l.id=rm.location_id WHERE " + scope); OccupancyParameters(count, query, staffUserId, today);
        var total = Convert.ToInt32(await count.ExecuteScalarAsync(t), CultureInfo.InvariantCulture);
        await using var command = Command("""
            SELECT rm.id,rm.location_id,rm.room_number,rm.status,c.id,c.start_date,c.end_date,
              COALESCE((SELECT jsonb_agg(jsonb_build_object('residentId',r.id,'displayLabel',r.display_label,
                'role',CASE cr.resident_role WHEN 0 THEN 'Representative' ELSE 'CoOccupant' END) ORDER BY cr.resident_role,r.display_label)
                FROM contract_residents cr JOIN residents r ON r.id=cr.resident_id WHERE cr.contract_id=c.id),'[]'::jsonb)::text
            FROM rooms rm JOIN locations l ON l.id=rm.location_id
            LEFT JOIN LATERAL (SELECT x.* FROM contracts x WHERE x.room_id=rm.id AND x.status=3
                AND x.start_date<=@today AND x.end_date>=@today ORDER BY x.activated_at DESC NULLS LAST LIMIT 1) c ON TRUE
            WHERE 
            """ + scope + " ORDER BY l.name,rm.room_number,rm.id OFFSET @skip LIMIT @take");
        OccupancyParameters(command, query, staffUserId, today); command.Parameters.AddWithValue("skip", checked((query.Page - 1) * query.PageSize)); command.Parameters.AddWithValue("take", query.PageSize);
        var items = new List<RoomOccupancyView>(); await using var reader = await command.ExecuteReaderAsync(t);
        while (await reader.ReadAsync(t)) items.Add(new(reader.GetGuid(0), reader.GetGuid(1), reader.GetString(2), RoomStatus(reader.GetInt16(3)),
            reader.IsDBNull(4) ? null : reader.GetGuid(4), reader.IsDBNull(5) ? null : reader.GetFieldValue<DateOnly>(5),
            reader.IsDBNull(6) ? null : reader.GetFieldValue<DateOnly>(6), Occupants(reader.GetString(7))));
        return new(items, query.Page, query.PageSize, total);
    }

    public async Task<RoomOccupancyHistory?> OccupancyHistoryAsync(Guid roomId, Guid? staffUserId, DateOnly today, CancellationToken t)
    {
        await Open(t); Guid location; string number;
        await using (var room = Command("""
            SELECT rm.location_id,rm.room_number FROM rooms rm JOIN locations l ON l.id=rm.location_id
            WHERE rm.id=@room AND (@staff IS NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements(l.staff_assignments) a
              WHERE (a->>'staffUserId')::uuid=@staff AND (a->>'startDate')::date<=@today AND (a->>'endDate')::date>=@today))
            """))
        {
            room.Parameters.AddWithValue("room", roomId); AddNullableUuid(room, "staff", staffUserId); room.Parameters.AddWithValue("today", today);
            await using var reader = await room.ExecuteReaderAsync(t); if (!await reader.ReadAsync(t)) return null;
            location = reader.GetGuid(0); number = reader.GetString(1);
        }
        await using var command = Command("""
            SELECT c.id,c.start_date,c.end_date,c.actual_end_date,c.status,
              COALESCE((SELECT jsonb_agg(jsonb_build_object('residentId',r.id,'displayLabel',r.display_label,
                'role',CASE cr.resident_role WHEN 0 THEN 'Representative' ELSE 'CoOccupant' END) ORDER BY cr.resident_role,r.display_label)
                FROM contract_residents cr JOIN residents r ON r.id=cr.resident_id WHERE cr.contract_id=c.id),'[]'::jsonb)::text
            FROM contracts c WHERE c.room_id=@room AND c.contract_type IN ('MAIN','RENEWAL')
            ORDER BY c.start_date DESC,c.id
            """); command.Parameters.AddWithValue("room", roomId);
        var periods = new List<RoomOccupancyPeriod>(); await using var rows = await command.ExecuteReaderAsync(t);
        while (await rows.ReadAsync(t)) periods.Add(new(rows.GetGuid(0), rows.GetFieldValue<DateOnly>(1), rows.GetFieldValue<DateOnly>(2),
            rows.IsDBNull(3) ? null : rows.GetFieldValue<DateOnly>(3), ContractStatus(rows.GetInt16(4)), Occupants(rows.GetString(5))));
        return new(roomId, location, number, periods);
    }

    public Task<LocationPublicContent?> LocationContentAsync(Guid locationId, bool publishedOnly, CancellationToken t) => LocationContent(locationId, publishedOnly, t);
    public Task<RoomPublicContent?> RoomContentAsync(Guid roomId, bool publishedOnly, CancellationToken t) => RoomContent(roomId, publishedOnly, t);

    public async Task<IReadOnlyList<LocationPublicContent>> PublishedLocationsAsync(CancellationToken t)
    {
        await Open(t); await using var command = Command("""
            SELECT id,name,address,public_profile::text,published_at FROM locations
            WHERE is_active AND published_at IS NOT NULL ORDER BY name,id
            """); var result = new List<LocationPublicContent>(); await using var reader = await command.ExecuteReaderAsync(t);
        while (await reader.ReadAsync(t)) result.Add(LocationContent(reader)); return result;
    }

    public async Task<IReadOnlyList<RoomPublicContent>> PublishedRoomsAsync(Guid locationId, CancellationToken t)
    {
        await Open(t); await using var command = Command("""
            SELECT r.id,r.location_id,r.room_number,r.floor,r.capacity,r.status,r.public_profile::text,r.published_at
            FROM rooms r JOIN locations l ON l.id=r.location_id
            WHERE r.location_id=@location AND l.is_active AND l.published_at IS NOT NULL AND r.published_at IS NOT NULL
            ORDER BY r.room_number,r.id
            """);
        command.Parameters.AddWithValue("location", locationId); var result = new List<RoomPublicContent>();
        await using var reader = await command.ExecuteReaderAsync(t);
        while (await reader.ReadAsync(t)) result.Add(RoomContent(reader)); return result;
    }

    public Task<LocationPublicContent> UpdateLocationContentAsync(Guid actorId, Guid locationId,
        LocationPublicContentWrite input, DateTimeOffset now, CancellationToken t) => PublicLocationMutation(actorId, locationId, now, t, async profile =>
    {
        var next = new LocationProfile(input.Summary, input.Amenities, input.ContactPhone, input.ContactEmail, profile.Photos ?? []);
        await UpdatePublicProfile("locations", locationId, next, actorId, now, "PublicContentUpdated", t);
    });

    public Task<RoomPublicContent> UpdateRoomContentAsync(Guid actorId, Guid roomId,
        RoomPublicContentWrite input, DateTimeOffset now, CancellationToken t) => PublicRoomMutation(actorId, roomId, now, t, async profile =>
    {
        var next = new RoomProfile(input.Description, input.Amenities, input.IndicativePrice, profile.Photos ?? []);
        await UpdatePublicProfile("rooms", roomId, next, actorId, now, "PublicContentUpdated", t);
    });

    public Task<LocationPublicContent> PublishLocationAsync(Guid actorId, Guid locationId, bool publish,
        DateTimeOffset now, CancellationToken t) => PublicLocationMutation(actorId, locationId, now, t, async profile =>
    {
        if (publish && (string.IsNullOrWhiteSpace(profile.Summary) || string.IsNullOrWhiteSpace(profile.ContactPhone) && string.IsNullOrWhiteSpace(profile.ContactEmail)))
            throw OperationsException.Conflict("public_location_incomplete");
        await Publish("locations", locationId, actorId, publish, now, t);
        if (!publish)
        {
            await using var children = Command("UPDATE rooms SET published_at=NULL,published_by_user_id=NULL WHERE location_id=@id");
            children.Parameters.AddWithValue("id", locationId); await children.ExecuteNonQueryAsync(t);
        }
    });

    public Task<RoomPublicContent> PublishRoomAsync(Guid actorId, Guid roomId, bool publish,
        DateTimeOffset now, CancellationToken t) => PublicRoomMutation(actorId, roomId, now, t, async profile =>
    {
        if (publish && string.IsNullOrWhiteSpace(profile.Description)) throw OperationsException.Conflict("public_room_incomplete");
        if (publish)
        {
            await using var parent = Command("SELECT EXISTS(SELECT 1 FROM rooms r JOIN locations l ON l.id=r.location_id WHERE r.id=@id AND l.is_active AND l.published_at IS NOT NULL)");
            parent.Parameters.AddWithValue("id", roomId); if (!(bool)(await parent.ExecuteScalarAsync(t))!) throw OperationsException.Conflict("public_location_not_published");
        }
        await Publish("rooms", roomId, actorId, publish, now, t);
    });

    public Task<LocationPublicContent> AttachLocationPhotoAsync(Guid actorId, Guid locationId,
        OperationsFile file, DateTimeOffset now, CancellationToken t) => PublicLocationMutation(actorId, locationId, now, t, async profile =>
    {
        if ((profile.Photos?.Count ?? 0) >= 20) throw OperationsException.Conflict("public_photo_limit");
        await UpdatePublicProfile("locations", locationId, profile with { Photos = [.. profile.Photos ?? [], new(file.ObjectKey, file.ContentType, file.Length)] }, actorId, now, "PublicPhotoAdded", t);
    });

    public Task<RoomPublicContent> AttachRoomPhotoAsync(Guid actorId, Guid roomId,
        OperationsFile file, DateTimeOffset now, CancellationToken t) => PublicRoomMutation(actorId, roomId, now, t, async profile =>
    {
        if ((profile.Photos?.Count ?? 0) >= 20) throw OperationsException.Conflict("public_photo_limit");
        await UpdatePublicProfile("rooms", roomId, profile with { Photos = [.. profile.Photos ?? [], new(file.ObjectKey, file.ContentType, file.Length)] }, actorId, now, "PublicPhotoAdded", t);
    });

    public Task<OperationsFile?> RemoveLocationPhotoAsync(Guid actorId, Guid locationId, int index,
        DateTimeOffset now, CancellationToken t) => RemovePublicPhoto("locations", actorId, locationId, index, now, t);
    public Task<OperationsFile?> RemoveRoomPhotoAsync(Guid actorId, Guid roomId, int index,
        DateTimeOffset now, CancellationToken t) => RemovePublicPhoto("rooms", actorId, roomId, index, now, t);

    private async Task<OperationsFile?> RemovePublicPhoto(string table, Guid actor, Guid id, int index,
        DateTimeOffset now, CancellationToken t)
    {
        await using var tx = await db.Database.BeginTransactionAsync(t); await Open(t);
        if (table == "locations")
        {
            var profile = await LockedProfile<LocationProfile>(table, id, t) ?? throw OperationsException.Missing();
            var photos = (profile.Photos ?? []).ToList(); if (index >= photos.Count) return null;
            var removed = photos[index]; photos.RemoveAt(index);
            await UpdatePublicProfile(table, id, profile with { Photos = photos }, actor, now, "PublicPhotoRemoved", t);
            await Audit(actor, "PublicPhotoRemoved", "Location", id, now, t); await tx.CommitAsync(t);
            return new(removed.ObjectKey, removed.ContentType, removed.Length);
        }
        else
        {
            var profile = await LockedProfile<RoomProfile>(table, id, t) ?? throw OperationsException.Missing();
            var photos = (profile.Photos ?? []).ToList(); if (index >= photos.Count) return null;
            var removed = photos[index]; photos.RemoveAt(index);
            await UpdatePublicProfile(table, id, profile with { Photos = photos }, actor, now, "PublicPhotoRemoved", t);
            await Audit(actor, "PublicPhotoRemoved", "Room", id, now, t); await tx.CommitAsync(t);
            return new(removed.ObjectKey, removed.ContentType, removed.Length);
        }
    }

    public async Task<OperationsFile?> PublicPhotoAsync(string targetType, Guid id, int index, bool publishedOnly, CancellationToken t)
    {
        if (targetType == "location")
        {
            var value = await LocationContent(id, publishedOnly, t); if (value is null || index >= value.Photos.Count) return null;
            return await PublicPhotoFile("locations", id, index, publishedOnly, t);
        }
        var room = await RoomContent(id, publishedOnly, t); if (room is null || index >= room.Photos.Count) return null;
        return await PublicPhotoFile("rooms", id, index, publishedOnly, t);
    }

    public async Task<IReadOnlyList<RecurringTaskTemplateView>> TemplatesAsync(Guid locationId, CancellationToken t)
    {
        await Open(t); await using var command = Command("SELECT COALESCE(operating_settings->'recurringTaskTemplates','[]'::jsonb)::text FROM locations WHERE id=@id");
        command.Parameters.AddWithValue("id", locationId); var value = await command.ExecuteScalarAsync(t) as string;
        if (value is null) throw OperationsException.Missing(); return ParseTemplates(value, locationId);
    }

    public async Task<RecurringTaskTemplateView> SaveTemplateAsync(Guid actorId, Guid? id, RecurringTaskTemplateWrite input,
        DateTimeOffset now, CancellationToken t)
    {
        await using var tx = await db.Database.BeginTransactionAsync(t); await Open(t);
        var templates = (await TemplatesLocked(input.LocationId, t)).ToList(); var templateId = id ?? Guid.NewGuid();
        var existing = templates.FindIndex(x => x.Id == templateId);
        if (id.HasValue && existing < 0) throw OperationsException.Missing();
        if (existing >= 0 && templates[existing].Version != input.Version) throw OperationsException.Conflict("stale_recurring_template_version");
        if (!id.HasValue && input.Version != 0) throw OperationsException.Invalid("invalid_recurring_template_version");
        var next = new RecurringTaskTemplateView(templateId, input.LocationId, input.Title, input.Requirements, input.Priority,
            input.EvidenceRequired, input.IntervalDays, input.NextRunAt, input.DueAfterHours, input.IsActive,
            existing < 0 ? 1 : templates[existing].Version + 1, input.ScheduleType, input.DayOfWeek, input.DayOfMonth);
        if (existing < 0) templates.Add(next); else templates[existing] = next;
        await SaveTemplates(input.LocationId, templates, actorId, now, "RecurringTemplateSaved", t);
        await tx.CommitAsync(t); return next;
    }

    public async Task RemoveTemplateAsync(Guid actorId, Guid locationId, Guid id, int version, DateTimeOffset now, CancellationToken t)
    {
        await using var tx = await db.Database.BeginTransactionAsync(t); await Open(t);
        var templates = (await TemplatesLocked(locationId, t)).ToList(); var existing = templates.SingleOrDefault(x => x.Id == id) ?? throw OperationsException.Missing();
        if (existing.Version != version) throw OperationsException.Conflict("stale_recurring_template_version");
        templates.Remove(existing); await SaveTemplates(locationId, templates, actorId, now, "RecurringTemplateRemoved", t); await tx.CommitAsync(t);
    }

    public async Task<int> GenerateDueRecurringTasksAsync(DateTimeOffset now, CancellationToken t)
    {
        await Open(t); var locations = new List<Guid>();
        await using (var query = Command("SELECT id FROM locations WHERE is_active AND operating_settings ? 'recurringTaskTemplates' ORDER BY id"))
        await using (var reader = await query.ExecuteReaderAsync(t)) while (await reader.ReadAsync(t)) locations.Add(reader.GetGuid(0));
        var created = 0;
        foreach (var location in locations)
        {
            await using var tx = await db.Database.BeginTransactionAsync(t);
            var templates = (await TemplatesLocked(location, t)).ToList(); var changed = false;
            for (var i = 0; i < templates.Count; i++)
            {
                var template = templates[i]; if (!template.IsActive || template.NextRunAt > now) continue;
                var scheduled = template.NextRunAt; var assignment = await CurrentResponsible(location, DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(now, TimeZoneInfo.FindSystemTimeZoneById("Asia/Ho_Chi_Minh")).DateTime), t);
                if (await InsertRecurringTask(template, scheduled, assignment, now, t)) created++;
                do { scheduled = RecurringTaskSchedule.Next(template, scheduled); } while (scheduled <= now);
                templates[i] = template with { NextRunAt = scheduled, Version = template.Version + 1 }; changed = true;
            }
            if (changed) await SaveTemplates(location, templates, Guid.Empty, now, "RecurringTasksGenerated", t);
            await tx.CommitAsync(t);
        }
        return created;
    }

    private async Task<OperationsPage<ResidenceTaskView>> ResidencePage(ResidenceQuery query, Guid? tenant, CancellationToken t)
    {
        await Open(t); var where = "(@location IS NULL OR l.id=@location) AND (@status IS NULL OR COALESCE(cr.registration_status,'Pending')=@status) AND (@tenant IS NULL OR r.user_id=@tenant)";
        await using var count = Command("SELECT count(*) FROM contract_residents cr JOIN contracts c ON c.id=cr.contract_id JOIN rooms rm ON rm.id=c.room_id JOIN locations l ON l.id=rm.location_id JOIN residents r ON r.id=cr.resident_id WHERE " + where);
        ResidenceParameters(count, query, tenant); var total = Convert.ToInt32(await count.ExecuteScalarAsync(t), CultureInfo.InvariantCulture);
        await using var command = Command(ResidenceSelect + " WHERE " + where + " ORDER BY cr.residence_from DESC,cr.contract_id,cr.resident_id OFFSET @skip LIMIT @take");
        ResidenceParameters(command, query, tenant); command.Parameters.AddWithValue("skip", checked((query.Page - 1) * query.PageSize)); command.Parameters.AddWithValue("take", query.PageSize);
        var items = new List<ResidenceTaskView>(); await using var reader = await command.ExecuteReaderAsync(t); while (await reader.ReadAsync(t)) items.Add(Residence(reader));
        return new(items, query.Page, query.PageSize, total);
    }

    private async Task<ResidenceTaskView> ResidenceMutation(Guid actorId, Guid contractId, Guid residentId,
        DateTimeOffset now, CancellationToken t, Func<Task> mutation)
    {
        await using var tx = await db.Database.BeginTransactionAsync(t); await Open(t);
        await using (var row = Command("SELECT 1 FROM contract_residents WHERE contract_id=@contract AND resident_id=@resident FOR UPDATE"))
        { row.Parameters.AddWithValue("contract", contractId); row.Parameters.AddWithValue("resident", residentId); if (await row.ExecuteScalarAsync(t) is null) throw OperationsException.Missing(); }
        await mutation(); await Audit(actorId, "ResidenceUpdated", "ContractResident", contractId, now, t); await tx.CommitAsync(t);
        return (await ResidenceAsync(contractId, residentId, null, t))!;
    }

    private async Task<LocationPublicContent> PublicLocationMutation(Guid actor, Guid id, DateTimeOffset now, CancellationToken t,
        Func<LocationProfile, Task> mutation)
    {
        await using var tx = await db.Database.BeginTransactionAsync(t); await Open(t);
        var profile = await LockedProfile<LocationProfile>("locations", id, t) ?? throw OperationsException.Missing();
        await mutation(profile); await Audit(actor, "PublicContentChanged", "Location", id, now, t); await tx.CommitAsync(t);
        return (await LocationContent(id, false, t))!;
    }

    private async Task<RoomPublicContent> PublicRoomMutation(Guid actor, Guid id, DateTimeOffset now, CancellationToken t,
        Func<RoomProfile, Task> mutation)
    {
        await using var tx = await db.Database.BeginTransactionAsync(t); await Open(t);
        var profile = await LockedProfile<RoomProfile>("rooms", id, t) ?? throw OperationsException.Missing();
        await mutation(profile); await Audit(actor, "PublicContentChanged", "Room", id, now, t); await tx.CommitAsync(t);
        return (await RoomContent(id, false, t))!;
    }

    private async Task<T?> LockedProfile<T>(string table, Guid id, CancellationToken t) where T : class
    {
        await using var command = Command($"SELECT public_profile::text FROM {table} WHERE id=@id FOR UPDATE"); command.Parameters.AddWithValue("id", id);
        var value = await command.ExecuteScalarAsync(t) as string; return value is null ? null : JsonSerializer.Deserialize<T>(value, Json) ?? throw new InvalidOperationException("Invalid public profile.");
    }

    private async Task UpdatePublicProfile<T>(string table, Guid id, T profile, Guid actor, DateTimeOffset now, string action, CancellationToken t)
    {
        await using var command = Command($"UPDATE {table} SET public_profile=CAST(@profile AS jsonb),version=version+1,history=history||jsonb_build_array(jsonb_build_object('action',@action,'actorId',@actor,'occurredAt',@now)) WHERE id=@id");
        command.Parameters.AddWithValue("profile", JsonSerializer.Serialize(profile, Json)); command.Parameters.AddWithValue("action", action);
        command.Parameters.AddWithValue("actor", actor); command.Parameters.AddWithValue("now", now); command.Parameters.AddWithValue("id", id);
        if (await command.ExecuteNonQueryAsync(t) != 1) throw OperationsException.Missing();
    }

    private async Task Publish(string table, Guid id, Guid actor, bool publish, DateTimeOffset now, CancellationToken t)
    {
        await using var command = Command($"UPDATE {table} SET published_at=@published,published_by_user_id=@publisher,version=version+1,history=history||jsonb_build_array(jsonb_build_object('action',@action,'actorId',@actor,'occurredAt',@now)) WHERE id=@id");
        command.Parameters.Add(new NpgsqlParameter("published", NpgsqlDbType.TimestampTz) { Value = publish ? now : DBNull.Value });
        command.Parameters.Add(new NpgsqlParameter("publisher", NpgsqlDbType.Uuid) { Value = publish ? actor : DBNull.Value });
        command.Parameters.AddWithValue("action", publish ? "Published" : "Unpublished"); command.Parameters.AddWithValue("actor", actor);
        command.Parameters.AddWithValue("now", now); command.Parameters.AddWithValue("id", id); await command.ExecuteNonQueryAsync(t);
    }

    private async Task<LocationPublicContent?> LocationContent(Guid id, bool publishedOnly, CancellationToken t)
    {
        await Open(t); await using var command = Command("SELECT id,name,address,public_profile::text,published_at FROM locations WHERE id=@id AND (NOT @published OR (is_active AND published_at IS NOT NULL))");
        command.Parameters.AddWithValue("id", id); command.Parameters.AddWithValue("published", publishedOnly);
        await using var reader = await command.ExecuteReaderAsync(t); return await reader.ReadAsync(t) ? LocationContent(reader) : null;
    }

    private async Task<RoomPublicContent?> RoomContent(Guid id, bool publishedOnly, CancellationToken t)
    {
        await Open(t); await using var command = Command("""
            SELECT r.id,r.location_id,r.room_number,r.floor,r.capacity,r.status,r.public_profile::text,r.published_at
            FROM rooms r JOIN locations l ON l.id=r.location_id WHERE r.id=@id
              AND (NOT @published OR (l.is_active AND l.published_at IS NOT NULL AND r.published_at IS NOT NULL))
            """); command.Parameters.AddWithValue("id", id); command.Parameters.AddWithValue("published", publishedOnly);
        await using var reader = await command.ExecuteReaderAsync(t); return await reader.ReadAsync(t) ? RoomContent(reader) : null;
    }

    private static LocationPublicContent LocationContent(NpgsqlDataReader reader)
    {
        var profile = JsonSerializer.Deserialize<LocationProfile>(reader.GetString(3), Json) ?? new();
        return new(reader.GetGuid(0), reader.GetString(1), reader.GetString(2), profile.Summary, profile.Amenities ?? [],
            profile.ContactPhone, profile.ContactEmail, Photos("location", reader.GetGuid(0), profile.Photos),
            !reader.IsDBNull(4), reader.IsDBNull(4) ? null : reader.GetFieldValue<DateTimeOffset>(4));
    }

    private static RoomPublicContent RoomContent(NpgsqlDataReader reader)
    {
        var profile = JsonSerializer.Deserialize<RoomProfile>(reader.GetString(6), Json) ?? new();
        return new(reader.GetGuid(0), reader.GetGuid(1), reader.GetString(2), reader.IsDBNull(3) ? null : reader.GetString(3),
            reader.GetInt16(4), profile.Description, profile.Amenities ?? [], profile.IndicativePrice, Vacancy(reader.GetInt16(5)),
            Photos("room", reader.GetGuid(0), profile.Photos), !reader.IsDBNull(7), reader.IsDBNull(7) ? null : reader.GetFieldValue<DateTimeOffset>(7));
    }

    private async Task<OperationsFile?> PublicPhotoFile(string table, Guid id, int index, bool publishedOnly, CancellationToken t)
    {
        await Open(t); var join = table == "rooms" ? "JOIN locations l ON l.id=t.location_id" : "";
        var published = table == "rooms" ? "t.published_at IS NOT NULL AND l.published_at IS NOT NULL AND l.is_active" : "t.published_at IS NOT NULL AND t.is_active";
        await using var command = Command($"SELECT p->>'objectKey',p->>'contentType',(p->>'length')::bigint FROM {table} t {join} CROSS JOIN LATERAL jsonb_array_elements(t.public_profile->'photos') WITH ORDINALITY x(p,n) WHERE t.id=@id AND n=@ordinal AND (NOT @published OR ({published}))");
        command.Parameters.AddWithValue("id", id); command.Parameters.AddWithValue("ordinal", index + 1L); command.Parameters.AddWithValue("published", publishedOnly);
        await using var reader = await command.ExecuteReaderAsync(t); return await reader.ReadAsync(t) ? new(reader.GetString(0), reader.GetString(1), reader.GetInt64(2)) : null;
    }

    private async Task<IReadOnlyList<RecurringTaskTemplateView>> TemplatesLocked(Guid locationId, CancellationToken t)
    {
        await using var command = Command("SELECT COALESCE(operating_settings->'recurringTaskTemplates','[]'::jsonb)::text FROM locations WHERE id=@id FOR UPDATE");
        command.Parameters.AddWithValue("id", locationId); var value = await command.ExecuteScalarAsync(t) as string;
        if (value is null) throw OperationsException.Missing(); return ParseTemplates(value, locationId);
    }

    private async Task SaveTemplates(Guid locationId, IReadOnlyList<RecurringTaskTemplateView> templates, Guid actor,
        DateTimeOffset now, string action, CancellationToken t)
    {
        await using var command = Command("""
            UPDATE locations SET operating_settings=jsonb_set(operating_settings,'{recurringTaskTemplates}',CAST(@templates AS jsonb),true),
              version=version+1,history=history||jsonb_build_array(jsonb_build_object('action',@action,'actorId',@actor,'occurredAt',@now)) WHERE id=@id
            """); command.Parameters.AddWithValue("templates", JsonSerializer.Serialize(templates, Json)); command.Parameters.AddWithValue("action", action);
        command.Parameters.AddWithValue("actor", actor); command.Parameters.AddWithValue("now", now); command.Parameters.AddWithValue("id", locationId); await command.ExecuteNonQueryAsync(t);
    }

    private async Task<Guid?> CurrentResponsible(Guid locationId, DateOnly today, CancellationToken t)
    {
        await using var command = Command("""
            SELECT (a->>'staffUserId')::uuid FROM locations l CROSS JOIN LATERAL jsonb_array_elements(l.staff_assignments) a
            JOIN users u ON u.id=(a->>'staffUserId')::uuid WHERE l.id=@id AND (a->>'startDate')::date<=@today
              AND (a->>'endDate')::date>=@today AND u.is_active AND 'Staff'=ANY(u.roles) LIMIT 1
            """); command.Parameters.AddWithValue("id", locationId); command.Parameters.AddWithValue("today", today);
        var value = await command.ExecuteScalarAsync(t); return value is Guid id ? id : null;
    }

    private async Task<bool> InsertRecurringTask(RecurringTaskTemplateView template, DateTimeOffset scheduled, Guid? assignee,
        DateTimeOffset now, CancellationToken t)
    {
        var id = Guid.NewGuid(); var source = $"recurring:{template.Id:N}:{scheduled.UtcTicks}"; var assignment = assignee is null ? null : await AssignmentId(template.LocationId, assignee.Value, DateOnly.FromDateTime(now.UtcDateTime), t);
        var state = new Dictionary<string, object?>
        {
            ["id"] = id,
            ["kind"] = 1,
            ["locationId"] = template.LocationId,
            ["title"] = template.Title,
            ["requirements"] = template.Requirements,
            ["priority"] = template.Priority == "High" ? 1 : 0,
            ["dueAt"] = scheduled.AddHours(template.DueAfterHours),
            ["evidenceRequired"] = template.EvidenceRequired,
            ["assignedStaffUserId"] = assignee,
            ["assignmentId"] = assignment,
            ["assignedAt"] = now,
            ["status"] = 0,
            ["version"] = 1,
            ["createdAt"] = now,
            ["updatedAt"] = now
        };
        await using var command = Command("""
            INSERT INTO operational_tasks(id,task_type,location_id,assigned_user_id,source_key,title,description,priority,status,
              assigned_at,due_at,task_data,version,history)
            VALUES(@id,'GENERAL',@location,@assigned,@source,@title,@description,@priority,'0',@now,@due,
              jsonb_build_object('schemaVersion',1,'recordType','OperationalTask','state',CAST(@state AS jsonb)),1,
              jsonb_build_array(jsonb_build_object('recordType','OperationalTaskHistory','recordKey',@historyId::text,
                'state',jsonb_build_object('id',@historyId,'taskId',@id,'actorId','00000000-0000-0000-0000-000000000000',
                  'action','generated','note','','changesJson',jsonb_build_object('templateId',@template)::text,
                  'responsibleStaffUserId',@assigned,'occurredAt',@now,'wasOverdue',false,'taskVersion',1,
                  'createdAt',@now,'updatedAt',@now)))) ON CONFLICT(source_key) DO NOTHING
            """);
        command.Parameters.AddWithValue("id", id); command.Parameters.AddWithValue("location", template.LocationId); command.Parameters.AddWithValue("assigned", (object?)assignee ?? DBNull.Value);
        command.Parameters.AddWithValue("source", source); command.Parameters.AddWithValue("title", template.Title); command.Parameters.AddWithValue("description", template.Requirements);
        command.Parameters.AddWithValue("priority", template.Priority == "High" ? "1" : "0"); command.Parameters.AddWithValue("now", now);
        command.Parameters.AddWithValue("due", scheduled.AddHours(template.DueAfterHours)); command.Parameters.AddWithValue("state", JsonSerializer.Serialize(state, Json));
        command.Parameters.AddWithValue("historyId", Guid.NewGuid()); command.Parameters.AddWithValue("template", template.Id);
        var inserted = await command.ExecuteNonQueryAsync(t) == 1;
        if (inserted && assignee is { } recipient)
        {
            await using var notice = Command("""
                INSERT INTO notifications(id,record_kind,recipient_user_id,location_id,event_key,notification_type,
                  related_entity_type,related_entity_id,title,message,event_data,event_at,delivery_status,delivery_history)
                VALUES(@notice,'INBOX',@recipient,@location,@key,'TASK_ASSIGNED','OperationalTask',@task,'Operational task assigned',
                  @message,jsonb_build_object('category','Task','audienceRole','Staff'),@now,'Unconfigured','[]')
                ON CONFLICT(recipient_user_id,event_key) WHERE record_kind='INBOX' DO NOTHING
                """); notice.Parameters.AddWithValue("notice", Guid.NewGuid()); notice.Parameters.AddWithValue("recipient", recipient);
            notice.Parameters.AddWithValue("location", template.LocationId); notice.Parameters.AddWithValue("key", "task-assigned:" + id.ToString("N"));
            notice.Parameters.AddWithValue("task", id); notice.Parameters.AddWithValue("message", template.Title); notice.Parameters.AddWithValue("now", now); await notice.ExecuteNonQueryAsync(t);
        }
        return inserted;
    }

    private async Task<Guid?> AssignmentId(Guid locationId, Guid staffId, DateOnly today, CancellationToken t)
    {
        await using var command = Command("SELECT (a->>'id')::uuid FROM locations l CROSS JOIN LATERAL jsonb_array_elements(l.staff_assignments) a WHERE l.id=@location AND (a->>'staffUserId')::uuid=@staff AND (a->>'startDate')::date<=@today AND (a->>'endDate')::date>=@today LIMIT 1");
        command.Parameters.AddWithValue("location", locationId); command.Parameters.AddWithValue("staff", staffId); command.Parameters.AddWithValue("today", today);
        var value = await command.ExecuteScalarAsync(t); return value is Guid id ? id : null;
    }

    private async Task SaveEmployment(Guid staffId, Guid? employmentId, EmploymentWrite input, Guid actor, DateTimeOffset now, CancellationToken t)
    {
        var metadata = JsonSerializer.Serialize(new { employmentType = input.EmploymentType }, Json);
        if (employmentId is null)
        {
            await using var insert = Command("""
                INSERT INTO staff_employments(id,staff_user_id,contract_number,start_date,end_date,salary_type,base_rate,reward_penalty_policy,status,history)
                VALUES(@id,@staff,@contract,@start,@end,@salary,@rate,CAST(@metadata AS jsonb),@status,
                  jsonb_build_array(jsonb_build_object('action','Created','actorId',@actor,'occurredAt',@now)))
                """); insert.Parameters.AddWithValue("id", Guid.NewGuid()); EmploymentParameters(insert, staffId, input, metadata, actor, now); await insert.ExecuteNonQueryAsync(t);
        }
        else
        {
            await using var update = Command("""
                UPDATE staff_employments SET contract_number=@contract,start_date=@start,end_date=@end,salary_type=@salary,
                  base_rate=@rate,reward_penalty_policy=reward_penalty_policy||CAST(@metadata AS jsonb),status=@status,
                  history=history||jsonb_build_array(jsonb_build_object('action','Updated','actorId',@actor,'occurredAt',@now))
                WHERE id=@id AND staff_user_id=@staff
                """); update.Parameters.AddWithValue("id", employmentId.Value); EmploymentParameters(update, staffId, input, metadata, actor, now); await update.ExecuteNonQueryAsync(t);
        }
    }

    private async Task<bool> HasResponsibilities(Guid staffId, DateOnly today, CancellationToken t)
    {
        await using var command = Command("""
            SELECT EXISTS(SELECT 1 FROM locations l CROSS JOIN LATERAL jsonb_array_elements(l.staff_assignments) a
              WHERE (a->>'staffUserId')::uuid=@staff AND (a->>'endDate')::date>=@today)
              OR EXISTS(SELECT 1 FROM operational_tasks WHERE assigned_user_id=@staff AND
                ((task_type IN ('GENERAL','METER_READ') AND status NOT IN ('2','3')) OR
                 (task_type='WORK_ORDER' AND status NOT IN ('Verified','Cancelled'))))
              OR EXISTS(SELECT 1 FROM contracts WHERE move_out->'current'->>'inspectionStaffId'=@staff::text
                AND move_out->'current'->>'inspectedAt' IS NULL AND COALESCE(move_out->'current'->>'status','0')<>'5')
            """); command.Parameters.AddWithValue("staff", staffId); command.Parameters.AddWithValue("today", today); return (bool)(await command.ExecuteScalarAsync(t))!;
    }

    private async Task EnsurePhoneAvailable(Guid userId, string? phone, CancellationToken t)
    {
        if (phone is null) return;
        await using (var phoneLock = Command("SELECT pg_advisory_xact_lock(hashtextextended(@key,0))"))
        {
            phoneLock.Parameters.AddWithValue("key", "login-phone:" + phone);
            await phoneLock.ExecuteNonQueryAsync(t);
        }
        await using var duplicate = Command("""
            SELECT EXISTS(SELECT 1 FROM users WHERE id<>@id AND phone IS NOT NULL AND
              replace(replace(replace(replace(replace(phone,' ',''),'-',''),'.',''),'(',''),')','')=@phone)
            """);
        duplicate.Parameters.AddWithValue("id", userId); duplicate.Parameters.AddWithValue("phone", phone);
        if ((bool)(await duplicate.ExecuteScalarAsync(t))!) throw OperationsException.Conflict("phone_already_used");
    }

    private async Task Audit(Guid actor, string action, string targetType, Guid targetId, DateTimeOffset now, CancellationToken t)
    {
        await using var command = Command("""
            INSERT INTO notifications(id,record_kind,actor_user_id,event_key,notification_type,related_entity_type,
              related_entity_id,event_data,event_at,delivery_history)
            VALUES(@id,'AUDIT',@actor,@key,@action,@type,@target,jsonb_build_object('succeeded',true),@now,'[]')
            ON CONFLICT(record_kind,event_key) WHERE record_kind IN ('OUTBOX','AUDIT') DO NOTHING
            """); command.Parameters.AddWithValue("id", Guid.NewGuid()); command.Parameters.AddWithValue("actor", actor);
        command.Parameters.AddWithValue("key", $"operations:{action}:{targetId:N}:{now.UtcTicks}"); command.Parameters.AddWithValue("action", action);
        command.Parameters.AddWithValue("type", targetType); command.Parameters.AddWithValue("target", targetId); command.Parameters.AddWithValue("now", now); await command.ExecuteNonQueryAsync(t);
    }

    private static ProfileView Profile(NpgsqlDataReader r) => new(r.GetGuid(0), r.GetString(1), r.IsDBNull(2) ? null : r.GetString(2),
        r.IsDBNull(3) ? null : r.GetString(3), r.GetFieldValue<string[]>(4), r.GetBoolean(5), r.GetString(6));
    private static StaffView Staff(NpgsqlDataReader r) => new(r.GetGuid(0), r.GetString(1), r.IsDBNull(2) ? null : r.GetString(2),
        r.IsDBNull(3) ? "" : r.GetString(3), r.GetBoolean(4), r.GetString(5), r.IsDBNull(6) ? null : new(r.GetGuid(6),
            r.IsDBNull(7) ? null : r.GetString(7), r.GetString(13), r.GetFieldValue<DateOnly>(8), r.IsDBNull(9) ? null : r.GetFieldValue<DateOnly>(9),
            r.IsDBNull(10) ? null : r.GetString(10), r.IsDBNull(11) ? null : r.GetDecimal(11), r.GetString(12)));

    private static ResidenceTaskView Residence(NpgsqlDataReader r) => new(r.GetGuid(0), r.GetGuid(1), r.GetGuid(2), r.GetGuid(3),
        r.GetString(4), r.GetString(5), r.GetInt16(6) == 0 ? "Representative" : "CoOccupant", r.IsDBNull(7) ? null : r.GetGuid(7),
        r.GetFieldValue<DateOnly>(8), r.IsDBNull(9) ? null : r.GetFieldValue<DateOnly>(9), r.GetString(10), r.GetBoolean(11),
        r.IsDBNull(12) ? null : r.GetFieldValue<DateTimeOffset>(12), !r.IsDBNull(13), r.IsDBNull(14) ? null : r.GetFieldValue<DateTimeOffset>(14),
        ParseResidenceHistory(r.GetString(15)));

    private static IReadOnlyList<ResidenceHistoryView> ParseResidenceHistory(string json)
    {
        using var document = JsonDocument.Parse(json); var result = new List<ResidenceHistoryView>();
        foreach (var item in document.RootElement.EnumerateArray())
        {
            if (!item.TryGetProperty("action", out var action) || !item.TryGetProperty("actorId", out var actor) ||
                !item.TryGetProperty("occurredAt", out var occurred) || !Guid.TryParse(actor.GetString(), out var actorId) ||
                !DateTimeOffset.TryParse(occurred.GetString(), CultureInfo.InvariantCulture, DateTimeStyles.None, out var at)) continue;
            result.Add(new(action.GetString()!, actorId, at, item.TryGetProperty("note", out var note) && note.ValueKind == JsonValueKind.String ? note.GetString() : null));
        }
        return result.OrderByDescending(x => x.OccurredAt).ToArray();
    }

    private static IReadOnlyList<OccupantSummary> Occupants(string json) => JsonSerializer.Deserialize<OccupantSummary[]>(json, Json) ?? [];
    private static string RoomStatus(short value) => value switch { 0 => "Available", 1 => "OnHold", 2 => "Occupied", 3 => "Unavailable", _ => "Unknown" };
    private static string Vacancy(short value) => value == 0 ? "Available" : "Unavailable";
    private static string ContractStatus(short value) => value switch { 0 => "Draft", 1 => "PendingSigning", 2 => "PendingActivation", 3 => "Active", 4 => "Terminated", 5 => "Superseded", 6 => "Cancelled", _ => "Unknown" };
    private static IReadOnlyList<PublicPhotoView> Photos(string target, Guid id, IReadOnlyList<StoredPhoto>? photos) => (photos ?? []).Select((p, i) => new PublicPhotoView(i, p.ContentType, p.Length, $"/api/v1/public/{target}s/{id}/photos/{i}")).ToArray();
    private static IReadOnlyList<RecurringTaskTemplateView> ParseTemplates(string json, Guid location) =>
        (JsonSerializer.Deserialize<RecurringTaskTemplateView[]>(json, Json) ?? []).Select(x => x with { LocationId = location }).OrderBy(x => x.NextRunAt).ThenBy(x => x.Id).ToArray();

    private static void StaffParameters(NpgsqlCommand command, StaffQuery query)
    {
        command.Parameters.Add(new NpgsqlParameter("active", NpgsqlDbType.Boolean) { Value = (object?)query.IsActive ?? DBNull.Value });
        command.Parameters.Add(new NpgsqlParameter("search", NpgsqlDbType.Text) { Value = (object?)query.Search?.Trim() ?? DBNull.Value });
    }
    private static void ResidenceParameters(NpgsqlCommand command, ResidenceQuery query, Guid? tenant)
    {
        AddNullableUuid(command, "location", query.LocationId);
        command.Parameters.Add(new NpgsqlParameter("status", NpgsqlDbType.Varchar)
        { Value = (object?)query.Status ?? DBNull.Value });
        AddNullableUuid(command, "tenant", tenant);
    }
    private static void OccupancyParameters(NpgsqlCommand command, OccupancyQuery query, Guid? staff, DateOnly today)
    {
        AddNullableUuid(command, "location", query.LocationId);
        command.Parameters.Add(new NpgsqlParameter("status", NpgsqlDbType.Smallint)
        { Value = query.RoomStatus is null ? DBNull.Value : (short)Array.IndexOf(["Available", "OnHold", "Occupied", "Unavailable"], query.RoomStatus) });
        AddNullableUuid(command, "staff", staff); command.Parameters.AddWithValue("today", today);
    }
    private static void EmploymentParameters(NpgsqlCommand command, Guid staffId, EmploymentWrite input, string metadata, Guid actor, DateTimeOffset now)
    {
        command.Parameters.AddWithValue("staff", staffId); command.Parameters.AddWithValue("contract", (object?)input.ContractNumber ?? DBNull.Value);
        command.Parameters.AddWithValue("start", input.StartDate); command.Parameters.AddWithValue("end", (object?)input.EndDate ?? DBNull.Value);
        command.Parameters.AddWithValue("salary", (object?)input.SalaryType ?? DBNull.Value); command.Parameters.AddWithValue("rate", (object?)input.BaseRate ?? DBNull.Value);
        command.Parameters.AddWithValue("metadata", metadata); command.Parameters.AddWithValue("status", input.Status); command.Parameters.AddWithValue("actor", actor); command.Parameters.AddWithValue("now", now);
    }
    private static void AddNullableUuid(NpgsqlCommand command, string name, Guid? value) => command.Parameters.Add(new NpgsqlParameter(name, NpgsqlDbType.Uuid) { Value = (object?)value ?? DBNull.Value });

    private async Task Open(CancellationToken t) { if (db.Database.GetDbConnection().State != ConnectionState.Open) await db.Database.OpenConnectionAsync(t); }
    private NpgsqlCommand Command(string sql) => new(sql, (NpgsqlConnection)db.Database.GetDbConnection(), (NpgsqlTransaction?)db.Database.CurrentTransaction?.GetDbTransaction());

    private sealed record StoredPhoto(string ObjectKey, string ContentType, long Length);
    private sealed record LocationProfile(string Summary = "", IReadOnlyList<string>? Amenities = null,
        string? ContactPhone = null, string? ContactEmail = null, IReadOnlyList<StoredPhoto>? Photos = null);
    private sealed record RoomProfile(string Description = "", IReadOnlyList<string>? Amenities = null,
        decimal? IndicativePrice = null, IReadOnlyList<StoredPhoto>? Photos = null);

    private const string ResidenceSelect = """
        SELECT cr.contract_id,cr.resident_id,l.id,rm.id,rm.room_number,r.display_label,cr.resident_role,r.user_id,
          cr.residence_from,cr.actual_residence_from,COALESCE(cr.registration_status,'Pending'),
          cr.registration_evidence_key IS NOT NULL,cr.registration_result_at,cr.owner_confirmed_by_user_id,cr.owner_confirmed_at,cr.history::text
        FROM contract_residents cr JOIN contracts c ON c.id=cr.contract_id JOIN rooms rm ON rm.id=c.room_id
        JOIN locations l ON l.id=rm.location_id JOIN residents r ON r.id=cr.resident_id
        """;
}
