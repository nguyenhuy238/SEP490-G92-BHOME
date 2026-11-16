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
        PrivateImageContent image;
        try { image = await PrivateImageEvidence.ReadValidatedAsync(input, images, t); }
        catch (PrivateImageTooLargeException) { throw new FinanceException(413, "expense_evidence_too_large"); }
        try
        {
            var intent = await repository.BeginAsync(id, key, actor, image.ContentType, image.Length, image.Sha256, clock.GetUtcNow(), t);
            if (intent.Status == "Uploaded") { await CopyVerifiedAsync(intent, Stream.Null, t); return intent.View(); }
            using var deadline = CancellationTokenSource.CreateLinkedTokenSource(t); deadline.CancelAfter(TimeSpan.FromSeconds(30));
            try { await PrivateImageEvidence.PutVerifiedAsync(storage, intent.ObjectKey, image, deadline.Token); }
            catch (PrivateImageIntegrityException) { throw new FinanceException(409, "expense_evidence_integrity_failed"); }
            return (await repository.CompleteAsync(id, intent.Id, actor, clock.GetUtcNow(), t)).View();
        }
        finally { CryptographicOperations.ZeroMemory(image.Bytes); }
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
        try { await PrivateImageEvidence.CopyVerifiedAsync(storage, file.ObjectKey, file.Length, file.Sha256, output, t); }
        catch (PrivateImageIntegrityException) { throw new FinanceException(409, "expense_evidence_integrity_failed"); }
    }
}
