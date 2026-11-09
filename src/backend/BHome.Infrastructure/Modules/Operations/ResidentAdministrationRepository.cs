using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using BHome.Application.Operations;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;
using NpgsqlTypes;

namespace BHome.Infrastructure.Modules.Operations;

internal sealed class ResidentAdministrationRepository(Compact24DbContext db) : IResidentAdministrationRepository
{
    private const string Select = """
        SELECT r.id,room.location_id,r.current_room_id,room.room_number,r.display_label,r.verification_status,
          r.verified_at,r.user_id,u.email,u.phone,r.history::text,
          COALESCE((SELECT cr.resident_role FROM contract_residents cr WHERE cr.resident_id=r.id
            ORDER BY cr.residence_from DESC,cr.contract_id LIMIT 1),
            (SELECT (h.value->'state'->>'residentType')::smallint FROM jsonb_array_elements(r.history) WITH ORDINALITY h(value,n)
              WHERE h.value->>'recordType'='Resident' ORDER BY h.n DESC LIMIT 1),0)::smallint
        FROM residents r JOIN rooms room ON room.id=r.current_room_id LEFT JOIN users u ON u.id=r.user_id
        """;
    private NpgsqlCommand Command(string sql) => new(sql, (NpgsqlConnection)db.Database.GetDbConnection(),
        (NpgsqlTransaction?)db.Database.CurrentTransaction?.GetDbTransaction());
    public async Task<OperationsPage<ResidentAdministrationView>> ListAsync(ResidentAdministrationQuery query, CancellationToken t)
    {
        await db.Database.OpenConnectionAsync(t);
        const string where = " WHERE (@location IS NULL OR room.location_id=@location) AND (@room IS NULL OR r.current_room_id=@room) AND (@status IS NULL OR r.verification_status=@status) AND r.display_label ILIKE '%'||@search||'%'";
        await using var count = Command("SELECT count(*) FROM residents r JOIN rooms room ON room.id=r.current_room_id" + where);
        Bind(count, query); var total = Convert.ToInt32(await count.ExecuteScalarAsync(t));
        await using var command = Command(Select + where + " ORDER BY r.display_label,r.id OFFSET @skip LIMIT @take");
        Bind(command, query); command.Parameters.AddWithValue("skip", (query.Page - 1) * query.PageSize); command.Parameters.AddWithValue("take", query.PageSize);
        var rows = new List<ResidentAdministrationView>();
        await using (var reader = await command.ExecuteReaderAsync(t)) while (await reader.ReadAsync(t)) rows.Add(Read(reader));
        return new(rows, query.Page, query.PageSize, total);
    }
    public async Task<ResidentAdministrationView?> GetAsync(Guid id, CancellationToken t)
    {
        await db.Database.OpenConnectionAsync(t);
        var value = await FindAsync(id, false, t); if (value is null) return null;
        await using var command = Command("SELECT cr.contract_id,c.status,cr.resident_role,cr.residence_from,cr.residence_to FROM contract_residents cr JOIN contracts c ON c.id=cr.contract_id WHERE cr.resident_id=@id ORDER BY cr.residence_from DESC,cr.contract_id");
        command.Parameters.AddWithValue("id", id); var contracts = new List<ResidentTenancy>();
        await using var reader = await command.ExecuteReaderAsync(t);
        while (await reader.ReadAsync(t)) contracts.Add(new(reader.GetGuid(0), ((ContractStatus)reader.GetInt16(1)).ToString(), ((ResidentType)reader.GetInt16(2)).ToString(), reader.GetFieldValue<DateOnly>(3), reader.IsDBNull(4) ? null : reader.GetFieldValue<DateOnly>(4)));
        return value with { Tenancies = contracts };
    }
    private async Task<ResidentAdministrationView?> FindAsync(Guid id, bool locked, CancellationToken t)
    {
        await using var command = Command(Select + " WHERE r.id=@id" + (locked ? " FOR UPDATE OF r" : ""));
        command.Parameters.AddWithValue("id", id); await using var reader = await command.ExecuteReaderAsync(t);
        return await reader.ReadAsync(t) ? Read(reader) : null;
    }
    public async Task<ResidentAdministrationView> UpdateLabelAsync(Guid actor, Guid id, ResidentLabelUpdate input, DateTimeOffset now, CancellationToken t)
    {
        await using var tx = await db.Database.BeginTransactionAsync(t);
        await db.Database.OpenConnectionAsync(t); var current = await FindAsync(id, true, t) ?? throw OperationsException.Missing();
        if (current.Version != input.Version) throw OperationsException.Conflict("resident_version_changed");
        await using var command = Command("""
            UPDATE residents SET display_label=@label,
              history=history||jsonb_build_array(jsonb_build_object('action','WorkspaceLabelUpdated','actorId',@actor,
                'occurredAt',@now,'reason',@reason)) WHERE id=@id
            """);
        command.Parameters.AddWithValue("id", id); command.Parameters.AddWithValue("actor", actor); command.Parameters.AddWithValue("label", input.DisplayLabel);
        command.Parameters.AddWithValue("reason", input.Reason); command.Parameters.AddWithValue("now", now);
        await command.ExecuteNonQueryAsync(t);
        db.SecurityAudit.Add(new() { UserId = actor, Event = "ResidentWorkspaceLabelUpdated", TargetType = "Resident", TargetId = id, Succeeded = true, OccurredAt = now });
        await db.SaveChangesAsync(t); await tx.CommitAsync(t);
        return (await GetAsync(id, t))!;
    }
    private static ResidentAdministrationView Read(NpgsqlDataReader r)
    {
        var version = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new { Label = r.GetString(4), History = r.GetString(10), User = r.IsDBNull(7) ? (Guid?)null : r.GetGuid(7), Room = r.GetGuid(2) }))));
        return new(r.GetGuid(0), r.GetGuid(1), r.GetGuid(2), r.GetString(3), r.GetString(4), ((ResidentType)r.GetInt16(11)).ToString(),
            ((IdentityVerificationStatus)r.GetInt16(5)).ToString(), r.IsDBNull(6) ? null : r.GetFieldValue<DateTimeOffset>(6),
            r.IsDBNull(7) ? null : r.GetGuid(7), r.IsDBNull(8) ? null : r.GetString(8), r.IsDBNull(9) ? null : r.GetString(9), version, []);
    }
    private static void Bind(NpgsqlCommand command, ResidentAdministrationQuery query)
    {
        command.Parameters.Add(new NpgsqlParameter("location", NpgsqlDbType.Uuid) { Value = (object?)query.LocationId ?? DBNull.Value });
        command.Parameters.Add(new NpgsqlParameter("room", NpgsqlDbType.Uuid) { Value = (object?)query.RoomId ?? DBNull.Value });
        command.Parameters.Add(new NpgsqlParameter("status", NpgsqlDbType.Smallint) { Value = query.VerificationStatus is { } s ? (short)s : DBNull.Value });
        command.Parameters.AddWithValue("search", query.Search?.Trim() ?? "");
    }
}
