using System.Globalization;
using System.Text.Json;
using BHome.Application.Ocr;
using BHome.Domain.Billing;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Native = BHome.Domain.Entities;

namespace BHome.Infrastructure.Ocr;

// Physical writes retain the existing snapshot shape and transaction boundaries.
internal static class NativeCaptureWrites
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private static string Envelope(string type, Guid id, object state, bool deleted = false) =>
        JsonSerializer.Serialize(new { schemaVersion = 1, recordType = type, recordKey = id.ToString(), deleted, state }, Json);

    private static void RequireTransaction(Compact24DbContext db)
    {
        if (db.Database.CurrentTransaction is null) throw new InvalidOperationException("Capture write requires a transaction.");
    }

    private static void Ensure(int affected)
    {
        if (affected != 1) throw new DbUpdateConcurrencyException("Capture record changed or no longer exists.");
    }

    private static async Task<int> ExecuteAsync(Compact24DbContext db, FormattableString sql, CancellationToken t)
    {
        try { return await db.Database.ExecuteSqlInterpolatedAsync(sql, t); }
        catch (Npgsql.PostgresException e) when (e.SqlState == "23505")
        { throw new CaptureConflictException("duplicate_or_conflicting_record"); }
    }

    internal static async Task AuditAsync(Compact24DbContext db, SecurityAuditRecord audit, CancellationToken t)
    {
        RequireTransaction(db);
        var data = JsonSerializer.Serialize(new
        {
            schemaVersion = 1,
            recordType = "SecurityAuditRecord",
            state = audit,
            audienceRole = (string?)null,
            category = (string?)null,
            succeeded = audit.Succeeded,
            sessionId = audit.SessionId,
            targetUserId = audit.TargetUserId
        }, Json);
        await ExecuteAsync(db, $"""
            INSERT INTO notifications(id,record_kind,actor_user_id,event_key,notification_type,related_entity_type,related_entity_id,event_data,event_at)
            VALUES({audit.Id},'AUDIT',{audit.UserId},{"SecurityAuditRecord:" + audit.Id},{audit.Event},{audit.TargetType},{audit.TargetId},CAST({data} AS jsonb),{audit.OccurredAt})
            """, t);
    }

    internal static async Task ResidentAsync(Compact24DbContext db, Resident r, bool added, CancellationToken t)
    {
        RequireTransaction(db);
        r.Stamp(DateTimeOffset.UtcNow, added);
        var state = new
        {
            r.Id,
            r.RoomId,
            r.DisplayLabel,
            r.ResidentType,
            r.VerificationStatus,
            r.OwnerUserId,
            r.TenantUserId,
            r.HouseholdRepresentativeId,
            r.HouseholdClientKey,
            r.HouseholdProfile,
            r.HouseholdConfirmedAt,
            r.HouseholdConfirmedByUserId,
            r.HouseholdVersion,
            r.HouseholdRequestKey,
            r.HouseholdRequestHash,
            r.ContactEmail,
            r.IdentityData,
            r.IdentityHmac,
            r.HmacKeyVersion,
            r.ConfirmedByUserId,
            r.ConfirmedAt,
            r.CreatedAt,
            r.UpdatedAt
        };
        var history = Envelope("Resident", r.Id, state);
        Ensure(added
            ? await ExecuteAsync(db, $"""
                INSERT INTO residents(id,user_id,current_room_id,identity_owner_scope_id,display_label,identity_data,identity_hmac,hmac_key_version,
                    verification_status,verified_by_user_id,verified_at,contact_email,history)
                VALUES({r.Id},{r.TenantUserId},{r.RoomId},{r.OwnerUserId},{r.DisplayLabel},CAST({r.IdentityData} AS jsonb),{r.IdentityHmac},
                    {r.HmacKeyVersion},{(short)r.VerificationStatus},{r.ConfirmedByUserId},{r.ConfirmedAt},{r.ContactEmail},jsonb_build_array(CAST({history} AS jsonb)))
                """, t)
            : await ExecuteAsync(db, $"""
                UPDATE residents SET user_id={r.TenantUserId},current_room_id={r.RoomId},identity_owner_scope_id={r.OwnerUserId},display_label={r.DisplayLabel},
                    identity_data=CAST({r.IdentityData} AS jsonb),identity_hmac={r.IdentityHmac},hmac_key_version={r.HmacKeyVersion},
                    verification_status={(short)r.VerificationStatus},verified_by_user_id={r.ConfirmedByUserId},verified_at={r.ConfirmedAt},
                    contact_email={r.ContactEmail},history=history||jsonb_build_array(CAST({history} AS jsonb)) WHERE id={r.Id}
                """, t));
    }

    internal static async Task MeterAsync(Compact24DbContext db, Meter m, CancellationToken t)
    {
        RequireTransaction(db);
        m.Stamp(DateTimeOffset.UtcNow, true);
        var history = Envelope("Meter", m.Id, new
        {
            m.Id,
            m.RoomId,
            m.Code,
            m.UtilityType,
            m.Display,
            m.DecimalPlaces,
            m.IsActive,
            m.InstalledOn,
            m.CreatedAt,
            m.UpdatedAt
        });
        Ensure(await ExecuteAsync(db, $"""
            INSERT INTO meters(id,room_id,meter_code,utility_type,display_type,decimal_places,installed_on,is_active,history)
            VALUES({m.Id},{m.RoomId},{m.Code},{(short)m.UtilityType},{(short)m.Display},{(short)m.DecimalPlaces},{m.InstalledOn},{m.IsActive},jsonb_build_array(CAST({history} AS jsonb)))
            """, t));
    }

    internal static async Task TaskAsync(Compact24DbContext db, OperationalTask task, bool added, int originalVersion, CancellationToken t)
    {
        RequireTransaction(db);
        var meter = task.MeterId is { } meterId
            ? await db.Set<Native.Meter>().AsNoTracking().SingleAsync(m => m.Id == meterId, t) : null;
        if (task.Kind == BHome.Domain.StaffOperations.OperationalTaskKind.MeterReading && task.Purpose == ReadingPurpose.Periodic)
        {
            task.BillingRoomId = meter!.RoomId;
            task.BillingUtilityType = (UtilityType)meter.UtilityType;
        }
        task.Stamp(DateTimeOffset.UtcNow, added);
        var state = new
        {
            task.Id,
            task.Kind,
            task.LocationId,
            task.Title,
            task.Requirements,
            task.Priority,
            task.DueAt,
            task.EvidenceRequired,
            task.AssignedStaffUserId,
            task.AssignmentId,
            task.AssignedAt,
            task.Result,
            task.VerifiedByUserId,
            task.VerifiedAt,
            task.Version,
            task.TargetRoomId,
            task.TargetAssetId,
            task.TargetCommonArea,
            task.TargetLabel,
            task.ContractId,
            task.MoveInInventoryJson,
            task.LocationAssetInventoryJson,
            task.BillingRoomId,
            task.BillingUtilityType,
            task.AutomationPlanId,
            task.MeterId,
            task.Purpose,
            task.ReadingDate,
            task.BillingPeriod,
            task.Status,
            task.OcrProposedValue,
            task.OcrImageHash,
            task.OcrEngineVersion,
            task.CompletedAt,
            task.CreatedAt,
            task.UpdatedAt
        };
        var data = JsonSerializer.Serialize(new { schemaVersion = 1, recordType = "OperationalTask", state }, Json);
        var history = Envelope("OperationalTask", task.Id, state);
        var status = ((int)task.Status).ToString(CultureInfo.InvariantCulture);
        var priority = ((int)task.Priority).ToString(CultureInfo.InvariantCulture);
        var taskType = task.Kind == BHome.Domain.StaffOperations.OperationalTaskKind.MeterReading ? "METER_READ" : "GENERAL";
        var source = taskType != "METER_READ" || task.Status == MeterTaskStatus.Cancelled ? null : task.Purpose switch
        {
            ReadingPurpose.Initial when task.ContractId is not null => $"meter-contract-initial:{task.MeterId}:{task.ContractId}",
            ReadingPurpose.Initial => $"meter-initial:{task.MeterId}",
            ReadingPurpose.Periodic => $"meter-period:{meter!.RoomId}:{meter.UtilityType.ToString(CultureInfo.InvariantCulture)}:{task.BillingPeriod!.Value.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)}",
            ReadingPurpose.Final when task.ContractId is not null => $"meter-final:{task.MeterId}:{task.ContractId}",
            _ => null
        };
        Ensure(added
            ? await ExecuteAsync(db, $"""
                INSERT INTO operational_tasks(id,task_type,location_id,room_id,meter_id,contract_id,assigned_user_id,billing_period,
                    title,description,assigned_at,due_at,verified_by_user_id,verified_at,version,status,priority,source_key,task_data,history)
                VALUES({task.Id},{taskType},{task.LocationId},{meter?.RoomId},{task.MeterId},{task.ContractId},{task.AssignedStaffUserId},{task.BillingPeriod},
                    {task.Title},{task.Requirements},{task.AssignedAt},{task.DueAt},{task.VerifiedByUserId},{task.VerifiedAt},{task.Version},
                    {status},{priority},{source},CAST({data} AS jsonb),jsonb_build_array(CAST({history} AS jsonb)))
                """, t)
            : await ExecuteAsync(db, $"""
                UPDATE operational_tasks SET location_id={task.LocationId},room_id={meter?.RoomId},meter_id={task.MeterId},
                    contract_id={task.ContractId},assigned_user_id={task.AssignedStaffUserId},billing_period={task.BillingPeriod},
                    title={task.Title},description={task.Requirements},assigned_at={task.AssignedAt},due_at={task.DueAt},
                    verified_by_user_id={task.VerifiedByUserId},verified_at={task.VerifiedAt},priority={priority},
                    status={status},version={task.Version},source_key={source},task_data=CAST({data} AS jsonb),
                    history=history||jsonb_build_array(CAST({history} AS jsonb)) WHERE id={task.Id} AND task_type={taskType} AND version={originalVersion}
                """, t));
    }

    internal static async Task EvidenceAsync(Compact24DbContext db, MeterEvidence e, bool added, CancellationToken t, bool deleted = false)
    {
        RequireTransaction(db);
        if (!deleted) e.Stamp(DateTimeOffset.UtcNow, added);
        var state = JsonSerializer.Serialize(e, Json);
        var history = Envelope("MeterEvidence", e.Id, e, deleted);
        var key = e.Id.ToString();
        Ensure(await ExecuteAsync(db, $"""
            UPDATE operational_tasks SET evidence=COALESCE((SELECT jsonb_agg(item ORDER BY n) FROM jsonb_array_elements(evidence)
                WITH ORDINALITY a(item,n) WHERE item->>'id' IS DISTINCT FROM {key}),'[]'::jsonb)
                ||CASE WHEN {deleted} THEN '[]'::jsonb ELSE jsonb_build_array(CAST({state} AS jsonb)||jsonb_build_object('recordType','MeterEvidence')) END,
                history=history||jsonb_build_array(CAST({history} AS jsonb)) WHERE id={e.TaskId} AND task_type='METER_READ'
            """, t));
    }

    internal static async Task ReadingAsync(Compact24DbContext db, MeterReading r, OperationalTask task, bool added, CancellationToken t)
    {
        RequireTransaction(db);
        r.Stamp(DateTimeOffset.UtcNow, added);
        var history = Envelope("MeterReading", r.Id, r);
        var evidenceKey = r.EvidenceId.ToString();
        Ensure(added
            ? await ExecuteAsync(db, $"""
                INSERT INTO meter_readings(id,meter_id,operational_task_id,reading_purpose,billing_period,reading_at,previous_value,
                    ocr_proposed_value,confirmed_value,consumption,confirmed_by_user_id,confirmed_at,evidence,status,history)
                VALUES({r.Id},{r.MeterId},{r.TaskId},{(short)task.Purpose},{task.BillingPeriod},CAST({task.ReadingDate} AS timestamptz),{r.PreviousValue},
                    {r.OcrProposedValue},{r.ConfirmedValue},{r.Consumption},{r.ConfirmedByUserId},{r.ConfirmedAt},
                    (SELECT e FROM operational_tasks t CROSS JOIN LATERAL jsonb_array_elements(t.evidence) e WHERE t.id={r.TaskId} AND e->>'id'={evidenceKey}),
                    {(short)r.Status},jsonb_build_array(CAST({history} AS jsonb)))
                """, t)
            : await ExecuteAsync(db, $"""
                UPDATE meter_readings SET previous_value={r.PreviousValue},ocr_proposed_value={r.OcrProposedValue},confirmed_value={r.ConfirmedValue},
                    consumption={r.Consumption},confirmed_by_user_id={r.ConfirmedByUserId},confirmed_at={r.ConfirmedAt},status={(short)r.Status},
                    evidence=(SELECT e FROM operational_tasks t CROSS JOIN LATERAL jsonb_array_elements(t.evidence) e WHERE t.id={r.TaskId} AND e->>'id'={evidenceKey}),
                    history=history||jsonb_build_array(CAST({history} AS jsonb)) WHERE id={r.Id} AND operational_task_id={r.TaskId}
                """, t));
    }
}
