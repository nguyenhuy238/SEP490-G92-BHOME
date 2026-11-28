using System.Text.Json;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Contracts;

internal static class NativeInvitationPersistence
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private sealed record State(Guid Id, Guid ContractId, Guid ResidentId, Guid ApprovedByUserId,
        string TokenHash, string SnapshotHash, string DocumentObjectKey, string DocumentHash,
        string RecipientEmail, string? ContactEmails, DateTimeOffset ExpiresAt, DateTimeOffset? RevokedAt,
        string? OtpHash, DateTimeOffset? OtpExpiresAt, DateTimeOffset? OtpSentAt, int OtpAttempts,
        int OtpSendCount, string? SessionHash, DateTimeOffset? SessionExpiresAt, DateTimeOffset? AcceptedAt,
        string? SignatureObjectKey, string? SignatureHash, string? AcceptedDocumentObjectKey,
        string? AcceptedDocumentHash, string DeliveryStatus, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt);

    private static State Snapshot(ContractSigningInvitation i) => new(i.Id, i.ContractId, i.ResidentId,
        i.ApprovedByUserId, i.TokenHash, i.SnapshotHash, i.DocumentObjectKey, i.DocumentHash, i.RecipientEmail,
        i.ContactEmails, i.ExpiresAt, i.RevokedAt, i.OtpHash, i.OtpExpiresAt, i.OtpSentAt, i.OtpAttempts,
        i.OtpSendCount, i.SessionHash, i.SessionExpiresAt, i.AcceptedAt, i.SignatureObjectKey, i.SignatureHash,
        i.AcceptedDocumentObjectKey, i.AcceptedDocumentHash, i.DeliveryStatus, i.CreatedAt, i.UpdatedAt);

    private static ContractSigningInvitation Read(string value)
    {
        var s = JsonSerializer.Deserialize<State>(value, Json) ?? throw new InvalidOperationException("Invalid invitation state.");
        var i = ContractSigningInvitation.Rehydrate(s.Id, s.CreatedAt, s.UpdatedAt);
        i.ContractId = s.ContractId; i.ResidentId = s.ResidentId; i.ApprovedByUserId = s.ApprovedByUserId;
        i.TokenHash = s.TokenHash ?? ""; i.SnapshotHash = s.SnapshotHash ?? "";
        i.DocumentObjectKey = s.DocumentObjectKey ?? ""; i.DocumentHash = s.DocumentHash ?? "";
        i.RecipientEmail = s.RecipientEmail ?? ""; i.ContactEmails = s.ContactEmails; i.ExpiresAt = s.ExpiresAt;
        i.RevokedAt = s.RevokedAt; i.OtpHash = s.OtpHash; i.OtpExpiresAt = s.OtpExpiresAt;
        i.OtpSentAt = s.OtpSentAt; i.OtpAttempts = s.OtpAttempts; i.OtpSendCount = s.OtpSendCount;
        i.SessionHash = s.SessionHash; i.SessionExpiresAt = s.SessionExpiresAt; i.AcceptedAt = s.AcceptedAt;
        i.SignatureObjectKey = s.SignatureObjectKey; i.SignatureHash = s.SignatureHash;
        i.AcceptedDocumentObjectKey = s.AcceptedDocumentObjectKey; i.AcceptedDocumentHash = s.AcceptedDocumentHash;
        i.DeliveryStatus = s.DeliveryStatus ?? "";
        return i;
    }

    // Latest state per immutable invitation identity. Never search historical token
    // hashes: a resend invalidates the previous token immediately.
    internal static async Task<ContractSigningInvitation[]> ListAsync(Compact24DbContext db, Guid? contractId,
        Guid? id, string? tokenHash, CancellationToken t)
    {
        var rows = await db.Database.SqlQuery<string>($"""
            SELECT (s.entry->'state')::text AS "Value" FROM contracts c
            CROSS JOIN LATERAL (
                SELECT DISTINCT ON (h.value->>'recordKey') h.value AS entry
                FROM jsonb_array_elements(c.history) WITH ORDINALITY h(value,n)
                WHERE h.value->>'recordType'='ContractSigningInvitation'
                ORDER BY h.value->>'recordKey',h.n DESC
            ) s
            WHERE (CAST({contractId} AS uuid) IS NULL OR c.id={contractId})
              AND COALESCE(s.entry->>'deleted','false')<>'true'
              AND (CAST({id} AS uuid) IS NULL OR (s.entry->'state'->>'id')::uuid={id})
              AND (CAST({tokenHash} AS text) IS NULL OR s.entry->'state'->>'tokenHash'={tokenHash})
            """).ToArrayAsync(t);
        return rows.Select(Read).OrderByDescending(i => i.CreatedAt).ToArray();
    }

    internal static Task<ContractSigningInvitation[]> ForContractAsync(BHomePersistenceContext db, Guid id, CancellationToken t) =>
        db is Compact24DbContext compact ? ListAsync(compact, id, null, null, t) :
            db.Set<ContractSigningInvitation>().AsNoTracking().Where(i => i.ContractId == id).ToArrayAsync(t);

    internal static Task<bool> LinkedAsync(Compact24DbContext db, string objectKey, CancellationToken t) =>
        db.Database.SqlQuery<bool>($"""
            SELECT EXISTS (SELECT 1 FROM contracts c CROSS JOIN LATERAL (
                SELECT DISTINCT ON (h.value->>'recordKey') h.value AS entry
                FROM jsonb_array_elements(c.history) WITH ORDINALITY h(value,n)
                WHERE h.value->>'recordType'='ContractSigningInvitation'
                ORDER BY h.value->>'recordKey',h.n DESC
            ) s WHERE COALESCE(s.entry->>'deleted','false')<>'true' AND
                (s.entry->'state'->>'documentObjectKey'={objectKey} OR
                 s.entry->'state'->>'signatureObjectKey'={objectKey} OR
                 s.entry->'state'->>'acceptedDocumentObjectKey'={objectKey})) AS "Value"
            """).SingleAsync(t);

    internal static async Task SaveAsync(Compact24DbContext db, ContractSigningInvitation invitation, CancellationToken t)
    {
        if (db.Database.CurrentTransaction is null)
            throw new InvalidOperationException("Invitation writes require the contract transaction.");
        var previous = (await ListAsync(db, invitation.ContractId, invitation.Id, null, t)).SingleOrDefault();
        if (previous is not null && Snapshot(previous) == Snapshot(invitation)) return;
        invitation.Stamp(DateTimeOffset.UtcNow, previous is null);
        var history = JsonSerializer.Serialize(new
        {
            schemaVersion = 1,
            recordType = "ContractSigningInvitation",
            recordKey = invitation.Id.ToString(),
            deleted = false,
            state = Snapshot(invitation)
        }, Json);
        var affected = await db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE contracts SET history=history||jsonb_build_array(CAST({history} AS jsonb))
            WHERE id={invitation.ContractId}
            """, t);
        if (affected != 1) throw new DbUpdateConcurrencyException("Invitation contract missing.");
    }

    internal static async Task<bool> AcceptedEmailInUseAsync(Compact24DbContext db, Guid contractId, Guid residentId,
        string email, CancellationToken t)
    {
        var rows = await db.Database.SqlQuery<AcceptedRow>($"""
            SELECT (s.entry->'state')::text AS "State", (c.id<>{contractId} AND c.status={(short)ContractStatus.Active}) AS "Active"
            FROM contracts c CROSS JOIN LATERAL (
                SELECT DISTINCT ON (h.value->>'recordKey') h.value AS entry
                FROM jsonb_array_elements(c.history) WITH ORDINALITY h(value,n)
                WHERE h.value->>'recordType'='ContractSigningInvitation'
                ORDER BY h.value->>'recordKey',h.n DESC
            ) s
            WHERE c.contract_type='MAIN' AND COALESCE(s.entry->>'deleted','false')<>'true'
              AND s.entry->'state'->>'acceptedAt' IS NOT NULL AND s.entry->'state'->>'revokedAt' IS NULL
              AND (lower(btrim(s.entry->'state'->>'recipientEmail'))={email} OR
                   strpos(lower(s.entry->'state'->>'contactEmails'),{email})>0)
            """).ToArrayAsync(t);
        return rows.Any(row => BHome.Application.Contracts.SigningContacts.Read(Read(row.State)).Any(contact =>
            string.Equals(contact.Value.Trim(), email, StringComparison.OrdinalIgnoreCase) &&
            (row.Active || contact.Key != residentId)));
    }

    private sealed class AcceptedRow
    {
        public string State { get; init; } = "";
        public bool Active { get; init; }
    }
}
