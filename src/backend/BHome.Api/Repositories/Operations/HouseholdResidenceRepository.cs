using BHome.Application.Operations;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using NpgsqlTypes;

namespace BHome.Infrastructure.Modules.Operations;

internal sealed partial class CompactOperationsRepository
{
    public async Task<ResidenceTrackingPage> ResidenceTrackingAsync(Guid staffId, DateOnly today, ResidenceTrackingQuery query, CancellationToken t)
    {
        if (!await StaffEmploymentEligibility.EligibleIds(db, today).AnyAsync(id => id == staffId, t))
            return new([], query.Page, query.PageSize, 0, new(0, 0, 0, 0), 0);
        await Open(t);
        const string baseWhere = "c.status=3 AND c.contract_type IN ('MAIN','RENEWAL') AND cr.actual_residence_from IS NOT NULL AND cr.actual_residence_from<=@today AND cr.actual_move_out_date IS NULL AND (@location IS NULL OR l.id=@location) AND (@search IS NULL OR r.display_label ILIKE @search OR rm.room_number ILIKE @search) AND EXISTS(SELECT 1 FROM jsonb_array_elements(l.staff_assignments) a WHERE (a->>'staffUserId')::uuid=@staff AND (a->>'startDate')::date<=@today AND (a->>'endDate')::date>=@today)";
        const string required = "COALESCE((SELECT (h.value->>'registrationRequired')::boolean FROM jsonb_array_elements(cr.history) WITH ORDINALITY h(value,seq) WHERE h.value->>'action'='TrackingConfigured' ORDER BY h.seq DESC LIMIT 1),true)";
        const string deadline = "(SELECT (h.value->>'registrationDeadline')::date FROM jsonb_array_elements(cr.history) WITH ORDINALITY h(value,seq) WHERE h.value->>'action'='AccommodationConfirmed' AND h.value->>'actualResidenceFrom'=cr.actual_residence_from::text ORDER BY h.seq DESC LIMIT 1)";
        var filterWhere = query.Filter switch
        {
            "Pending" => $" AND {required} AND COALESCE(cr.registration_status,'Pending')='Pending'",
            "AwaitingReview" => $" AND {required} AND COALESCE(cr.registration_status,'Pending')='Completed' AND cr.owner_confirmed_at IS NULL",
            "Completed" => $" AND {required} AND COALESCE(cr.registration_status,'Pending')='Completed' AND cr.owner_confirmed_at IS NOT NULL",
            "Overdue" => $" AND {required} AND {deadline} IS NOT NULL AND {deadline}<@today AND cr.owner_confirmed_at IS NULL",
            _ => string.Empty
        };
        const string from = " FROM contract_residents cr JOIN contracts c ON c.id=cr.contract_id JOIN rooms rm ON rm.id=c.room_id JOIN locations l ON l.id=rm.location_id JOIN residents r ON r.id=cr.resident_id WHERE ";
        void Bind(Npgsql.NpgsqlCommand command, bool filtered)
        {
            command.Parameters.Add(new Npgsql.NpgsqlParameter("location", NpgsqlDbType.Uuid) { Value = (object?)query.LocationId ?? DBNull.Value });
            command.Parameters.Add(new Npgsql.NpgsqlParameter("search", NpgsqlDbType.Text) { Value = (object?)(query.Search is null ? null : $"%{EscapeLike(query.Search)}%") ?? DBNull.Value });
            command.Parameters.AddWithValue("staff", staffId); command.Parameters.AddWithValue("today", today);
            if (filtered) command.Parameters.AddWithValue("skip", checked((query.Page - 1) * query.PageSize));
        }
        await using var statsCommand = Command($"SELECT count(*),count(*) FILTER (WHERE {required} AND COALESCE(cr.registration_status,'Pending')='Pending'),count(*) FILTER (WHERE {required} AND COALESCE(cr.registration_status,'Pending')='Completed' AND cr.owner_confirmed_at IS NOT NULL),count(*) FILTER (WHERE {required} AND {deadline} IS NOT NULL AND {deadline}<@today AND cr.owner_confirmed_at IS NULL){from}{baseWhere}"); Bind(statsCommand, false);
        await using var statsReader = await statsCommand.ExecuteReaderAsync(t);
        await statsReader.ReadAsync(t);
        var stats = new ResidenceTrackingStats(statsReader.GetInt32(0), statsReader.GetInt32(1), statsReader.GetInt32(2), statsReader.GetInt32(3));
        await statsReader.DisposeAsync();
        var where = baseWhere + filterWhere;
        await using var count = Command("SELECT count(*)" + from + where); Bind(count, false);
        var total = Convert.ToInt32(await count.ExecuteScalarAsync(t));
        await using var command = Command(ResidenceSelect + " WHERE " + where + $" ORDER BY CASE WHEN {required} AND {deadline} IS NOT NULL AND {deadline}<@today AND cr.owner_confirmed_at IS NULL THEN 0 WHEN COALESCE(cr.registration_status,'Pending')='Completed' AND cr.owner_confirmed_at IS NULL THEN 1 ELSE 2 END,{deadline} NULLS LAST,rm.room_number,cr.resident_id OFFSET @skip LIMIT @take");
        Bind(command, true); command.Parameters.AddWithValue("take", query.PageSize);
        var result = new List<ResidenceTrackingSummary>();
        await using var reader = await command.ExecuteReaderAsync(t);
        while (await reader.ReadAsync(t))
        {
            var row = Residence(reader);
            // Staff receives only fields needed for operations. Identity numbers, phone, files and history stay private.
            result.Add(new(row.ContractId, row.ResidentId, row.LocationId, row.RoomNumber, row.ResidentLabel,
                row.ResidentRole, row.ActualResidenceFrom, row.Status, row.RegistrationRequired, row.RegistrationDeadline, row.RegistrationExpiresOn,
                row.ResultAt, row.OwnerConfirmed, row.OwnerConfirmedAt));
        }
        return new(result, query.Page, query.PageSize, total, stats, checked((query.Page - 1) * query.PageSize + result.Count));
    }

    private static string EscapeLike(string value) => value.Replace("\\", "\\\\", StringComparison.Ordinal)
        .Replace("%", "\\%", StringComparison.Ordinal).Replace("_", "\\_", StringComparison.Ordinal);

    public Task<ResidenceTaskView> ConfigureResidenceAsync(Guid actorId, Guid contractId, Guid residentId,
        ResidenceTrackingSettings input, DateTimeOffset now, CancellationToken t) => ResidenceMutation(actorId, contractId, residentId, now, t, async () =>
    {
        await using var command = Command("""
            UPDATE contract_residents cr SET history=cr.history||jsonb_build_array(jsonb_build_object(
                'action','TrackingConfigured','actorId',@actor,'occurredAt',@now,'note',@note,
                'registrationRequired',@required,'registrationExpiresOn',@expires))
            FROM contracts c WHERE c.id=cr.contract_id AND c.owner_signer_id=@actor
                AND cr.contract_id=@contract AND cr.resident_id=@resident AND md5(cr.history::text)=@reference
            """);
        command.Parameters.AddWithValue("actor", actorId); command.Parameters.AddWithValue("now", now);
        command.Parameters.AddWithValue("note", input.Reason); command.Parameters.AddWithValue("required", input.RegistrationRequired);
        command.Parameters.AddWithValue("expires", NpgsqlDbType.Date, (object?)input.RegistrationExpiresOn ?? DBNull.Value);
        command.Parameters.AddWithValue("reference", input.ExpectedReference);
        command.Parameters.AddWithValue("contract", contractId); command.Parameters.AddWithValue("resident", residentId);
        if (await command.ExecuteNonQueryAsync(t) != 1) throw OperationsException.Conflict("invalid_residence_transition");
    });

    public async Task<IReadOnlyList<ResidenceTaskView>> AttachHouseholdEvidenceAsync(Guid actorId, Guid contractId,
        ResidenceEvidenceTarget[] targets, OperationsFile file, DateTimeOffset now, CancellationToken t)
    {
        await using var tx = await db.Database.BeginTransactionAsync(t); await Open(t);
        foreach (var target in targets.OrderBy(r => r.ResidentId))
        {
            await using var row = Command("SELECT 1 FROM contract_residents WHERE contract_id=@contract AND resident_id=@resident FOR UPDATE");
            row.Parameters.AddWithValue("contract", contractId); row.Parameters.AddWithValue("resident", target.ResidentId);
            if (await row.ExecuteScalarAsync(t) is null) throw OperationsException.Missing();
            await using var command = Command("""
                UPDATE contract_residents cr SET registration_evidence_key=@key,owner_confirmed_by_user_id=NULL,owner_confirmed_at=NULL,
                    history=cr.history||jsonb_build_array(jsonb_build_object('action','EvidenceUploaded','actorId',@actor,
                        'occurredAt',@now,'contentType',@type,'length',@length,'objectKey',@key))
                FROM contracts c JOIN residents representative ON representative.id=c.representative_resident_id
                WHERE c.id=cr.contract_id AND c.status=3 AND c.tenant_user_id=@actor AND representative.user_id=@actor
                    AND cr.contract_id=@contract AND cr.resident_id=@resident AND md5(cr.history::text)=@reference
                """);
            command.Parameters.AddWithValue("key", file.ObjectKey); command.Parameters.AddWithValue("actor", actorId);
            command.Parameters.AddWithValue("now", now); command.Parameters.AddWithValue("type", file.ContentType);
            command.Parameters.AddWithValue("length", file.Length); command.Parameters.AddWithValue("contract", contractId);
            command.Parameters.AddWithValue("resident", target.ResidentId); command.Parameters.AddWithValue("reference", target.ExpectedReference);
            if (await command.ExecuteNonQueryAsync(t) != 1) throw OperationsException.Conflict("invalid_residence_transition");
        }
        await Audit(actorId, "HouseholdResidenceEvidenceUploaded", "Contract", contractId, now, t);
        var results = new List<ResidenceTaskView>();
        foreach (var target in targets) results.Add((await ResidenceAsync(contractId, target.ResidentId, actorId, t))!);
        await tx.CommitAsync(t); return results;
    }
}
