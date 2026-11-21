using System.Text.Json;
using System.Text.Json.Nodes;
using BHome.Application.Finance;
using BHome.Infrastructure.IdentityAccess;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace BHome.Infrastructure.Finance;

internal sealed class ExpenseEvidenceRepository(BHomePersistenceContext db) : IExpenseEvidenceRepository
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private async Task<JsonArray> ReadAsync(Guid id, CancellationToken t)
    {
        var value = await db.Database.SqlQuery<string>($"SELECT evidence::text AS \"Value\" FROM expenses WHERE id={id}").SingleOrDefaultAsync(t)
            ?? throw new FinanceException(404, "expense_not_found");
        return JsonNode.Parse(value) as JsonArray ?? throw new FinanceException(409, "expense_evidence_metadata_invalid");
    }
    private static ExpenseEvidenceFile? File(JsonNode? node) => node is JsonObject entry && entry["recordType"]?.GetValue<string>() == "ExpenseEvidence"
        ? entry["state"]?.Deserialize<ExpenseEvidenceFile>(Json) : null;
    public async Task<IReadOnlyList<ExpenseEvidenceFile>> ListAsync(Guid id, CancellationToken t) =>
        (await ReadAsync(id, t)).Select(File).OfType<ExpenseEvidenceFile>().ToArray();
    private Task LockAsync(Guid id, CancellationToken t) => db.Database.ExecuteSqlInterpolatedAsync($"SELECT id FROM expenses WHERE id={id} FOR UPDATE", t);
    private Task WriteAsync(Guid id, JsonArray files, CancellationToken t)
    {
        var json = files.ToJsonString();
        return db.Database.ExecuteSqlInterpolatedAsync($"UPDATE expenses SET evidence={json}::jsonb WHERE id={id}", t);
    }
    public async Task<ExpenseEvidenceFile> BeginAsync(Guid id, Guid key, Guid actor, string type, long length, string hash, DateTimeOffset now, CancellationToken t)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(t); await LockAsync(id, t);
        var nodes = await ReadAsync(id, t); var files = nodes.Select(File).OfType<ExpenseEvidenceFile>().ToArray();
        if (files.SingleOrDefault(f => f.OperationKey == key) is { } existing)
        {
            if (existing.RecordedBy != actor || existing.ContentType != type || existing.Length != length || existing.Sha256 != hash)
                throw new FinanceException(409, "expense_evidence_idempotency_conflict");
            await transaction.CommitAsync(t); return existing;
        }
        // Bounded image evidence, matching the existing 5 MB private image pipeline.
        if (nodes.Count >= 20) throw new FinanceException(409, "expense_evidence_limit");
        var fileId = Guid.NewGuid();
        var file = new ExpenseEvidenceFile(fileId, key, $"expenses/{id:N}/{fileId:N}", type, length, hash, "PendingUpload", actor, now);
        nodes.Add(new JsonObject { ["schemaVersion"] = 1, ["recordType"] = "ExpenseEvidence", ["state"] = JsonSerializer.SerializeToNode(file, Json) });
        await WriteAsync(id, nodes, t); await transaction.CommitAsync(t); return file;
    }
    public async Task<ExpenseEvidenceFile> CompleteAsync(Guid id, Guid fileId, Guid actor, DateTimeOffset now, CancellationToken t)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(t); await LockAsync(id, t);
        var nodes = await ReadAsync(id, t); var index = Enumerable.Range(0, nodes.Count).FirstOrDefault(i => File(nodes[i])?.Id == fileId, -1);
        if (index < 0) throw new FinanceException(404, "expense_evidence_not_found");
        var file = File(nodes[index])!;
        if (file.Status != "Uploaded")
        {
            file = file with { Status = "Uploaded" }; nodes[index]!["state"] = JsonSerializer.SerializeToNode(file, Json); await WriteAsync(id, nodes, t);
            db.SecurityAudit.Add(new SecurityAuditRecord { UserId = actor, TargetId = id, TargetType = "Expense", Event = "ExpenseEvidenceUploaded", Succeeded = true, OccurredAt = now });
            await db.SaveChangesAsync(t);
        }
        await transaction.CommitAsync(t); return file;
    }
}
