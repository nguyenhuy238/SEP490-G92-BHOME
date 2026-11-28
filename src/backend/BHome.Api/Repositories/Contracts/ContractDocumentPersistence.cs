using System.Text.Json;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Native = BHome.Domain.Entities;

namespace BHome.Infrastructure.Contracts;

// Documents are immutable values embedded in their physical contract row.
internal static class ContractDocumentPersistence
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private sealed record DocumentState(Guid Id, Guid ContractId, ContractFileKind Kind, string SnapshotHash,
        string? TemplateId, int? TemplateVersion, bool DevelopmentOnly, string ObjectKey, string FileHash,
        string ContentType, long Length, Guid RecordedByUserId, DateTimeOffset RecordedAt,
        DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt);

    internal static async Task<ContractDocumentFile[]> ListAsync(BHomePersistenceContext db, Guid contractId, CancellationToken token)
    {
        if (db is not Compact24DbContext)
            return await db.Set<ContractDocumentFile>().AsNoTracking().Where(f => f.ContractId == contractId).ToArrayAsync(token);
        var row = await db.Set<Native.Contract>().AsNoTracking().Where(c => c.Id == contractId)
            .Select(c => c.Documents).SingleOrDefaultAsync(token);
        if (row.ValueKind != JsonValueKind.Array) return [];
        return row.EnumerateArray().Where(e => e.ValueKind == JsonValueKind.Object)
            .Select(e => e.Deserialize<DocumentState>(Json) ?? throw new InvalidOperationException("Invalid contract document state."))
            .Where(s => s.ContractId == contractId).Select(Read).ToArray();
    }

    internal static Task<bool> LinkedAsync(BHomePersistenceContext db, string objectKey, CancellationToken token) =>
        db is Compact24DbContext
            ? db.Database.SqlQuery<bool>($"""
                SELECT EXISTS (SELECT 1 FROM contracts c CROSS JOIN LATERAL jsonb_array_elements(c.documents) d
                    WHERE d->>'objectKey'={objectKey}) AS "Value"
                """).SingleAsync(token)
            : db.Set<ContractDocumentFile>().AnyAsync(f => f.ObjectKey == objectKey, token);

    internal static async Task AppendAsync(BHomePersistenceContext db, ContractDocumentFile file, CancellationToken token)
    {
        if (db is not Compact24DbContext)
        {
            db.Add(file);
            await db.SaveChangesAsync(token);
            return;
        }
        if (db.Database.CurrentTransaction is null)
            throw new InvalidOperationException("Contract document append requires its existing transaction.");
        file.Stamp(DateTimeOffset.UtcNow, true);
        var state = new DocumentState(file.Id, file.ContractId, file.Kind, file.SnapshotHash, file.TemplateId,
            file.TemplateVersion, file.DevelopmentOnly, file.ObjectKey, file.FileHash, file.ContentType, file.Length,
            file.RecordedByUserId, file.RecordedAt, file.CreatedAt, file.UpdatedAt);
        var document = JsonSerializer.Serialize(state, Json);
        var envelope = JsonSerializer.Serialize(new
        {
            schemaVersion = 1,
            recordType = "ContractDocumentFile",
            recordKey = file.Id.ToString(),
            deleted = false,
            state
        }, Json);
        var affected = await db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE contracts SET documents=documents||jsonb_build_array(CAST({document} AS jsonb)||jsonb_build_object('recordType','ContractDocumentFile')),
                history=history||jsonb_build_array(CAST({envelope} AS jsonb))
            WHERE id={file.ContractId} AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(documents) d WHERE d->>'id'={file.Id.ToString()})
            """, token);
        if (affected != 1) throw new DbUpdateConcurrencyException("Contract document parent unavailable or document already exists.");
    }

    private static ContractDocumentFile Read(DocumentState s)
    {
        var file = ContractDocumentFile.Rehydrate(s.Id, s.CreatedAt, s.UpdatedAt);
        file.ContractId = s.ContractId;
        file.Kind = s.Kind;
        file.SnapshotHash = s.SnapshotHash;
        file.TemplateId = s.TemplateId;
        file.TemplateVersion = s.TemplateVersion;
        file.DevelopmentOnly = s.DevelopmentOnly;
        file.ObjectKey = s.ObjectKey;
        file.FileHash = s.FileHash;
        file.ContentType = s.ContentType;
        file.Length = s.Length;
        file.RecordedByUserId = s.RecordedByUserId;
        file.RecordedAt = s.RecordedAt;
        return file;
    }
}
