using System.Security.Cryptography;
using BHome.Application.Contracts;
using BHome.Application.IdentityAccess;
using BHome.Application.Storage;
using BHome.Domain.IdentityAccess;

namespace BHome.Application.Finance;

public sealed record ExpenseEvidenceView(Guid Id, Guid OperationKey, string ContentType, long Length,
    string Sha256, string Status, DateTimeOffset RecordedAt);
public sealed record ExpenseEvidenceFile(Guid Id, Guid OperationKey, string ObjectKey, string ContentType,
    long Length, string Sha256, string Status, Guid RecordedBy, DateTimeOffset RecordedAt)
{
    public ExpenseEvidenceView View() => new(Id, OperationKey, ContentType, Length, Sha256, Status, RecordedAt);
}
public interface IExpenseEvidenceRepository
{
    Task<IReadOnlyList<ExpenseEvidenceFile>> ListAsync(Guid expenseId, CancellationToken t);
    Task<ExpenseEvidenceFile> BeginAsync(Guid expenseId, Guid operationKey, Guid actor, string type, long length, string hash, DateTimeOffset now, CancellationToken t);
    Task<ExpenseEvidenceFile> CompleteAsync(Guid expenseId, Guid fileId, Guid actor, DateTimeOffset now, CancellationToken t);
}
public sealed class ExpenseEvidenceService(IExpenseEvidenceRepository repository, IObjectStorage storage,
    IContractImageValidator images, ICurrentUser user, TimeProvider clock)
{
    private Guid Owner()
    {
        if (user.UserId is not { } id || id == Guid.Empty) throw new FinanceException(401, "authentication_required");
        if (!user.IsInRole(Roles.Owner)) throw new FinanceException(403, "finance_owner_required");
        return id;
    }
    public async Task<IReadOnlyList<ExpenseEvidenceView>> ListAsync(Guid id, CancellationToken t)
    { _ = Owner(); return (await repository.ListAsync(id, t)).Select(f => f.View()).ToArray(); }
    public async Task<ExpenseEvidenceView> UploadAsync(Guid id, Guid key, Stream input, CancellationToken t)
    {
        var actor = Owner(); if (key == Guid.Empty) throw new FinanceException(400, "idempotency_key_required");
        // Authorize/lookup before reading a potentially large body or sending it to storage.
        _ = await repository.ListAsync(id, t);
        using var buffer = new MemoryStream(); var block = new byte[81920];
        while (true)
        {
            var count = await input.ReadAsync(block, t); if (count == 0) break;
            if (buffer.Length + count > 5 * 1024 * 1024) throw new FinanceException(413, "expense_evidence_too_large");
            await buffer.WriteAsync(block.AsMemory(0, count), t);
        }
        var bytes = buffer.ToArray(); var type = images.Validate(bytes); var hash = Convert.ToHexString(SHA256.HashData(bytes));
        var intent = await repository.BeginAsync(id, key, actor, type, bytes.Length, hash, clock.GetUtcNow(), t);
        if (intent.Status == "Uploaded") { await CopyVerifiedAsync(intent, Stream.Null, t); return intent.View(); }
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(t); deadline.CancelAfter(TimeSpan.FromSeconds(30));
        using var content = new MemoryStream(bytes);
        await storage.PutAsync(intent.ObjectKey, content, bytes.Length, type, deadline.Token);
        await CopyVerifiedAsync(intent, Stream.Null, deadline.Token);
        return (await repository.CompleteAsync(id, intent.Id, actor, clock.GetUtcNow(), t)).View();
    }
    public async Task<string> CopyAsync(Guid id, Guid fileId, Stream output, CancellationToken t)
    {
        _ = Owner();
        var file = (await repository.ListAsync(id, t)).SingleOrDefault(f => f.Id == fileId && f.Status == "Uploaded")
            ?? throw new FinanceException(404, "expense_evidence_not_found");
        await CopyVerifiedAsync(file, output, t); return file.ContentType;
    }
    private async Task CopyVerifiedAsync(ExpenseEvidenceFile file, Stream output, CancellationToken t)
    {
        using var bytes = new MemoryStream(); await storage.CopyToAsync(file.ObjectKey, bytes, t);
        if (bytes.Length != file.Length || Convert.ToHexString(SHA256.HashData(bytes.ToArray())) != file.Sha256)
            throw new FinanceException(409, "expense_evidence_integrity_failed");
        bytes.Position = 0; await bytes.CopyToAsync(output, t);
    }
}
