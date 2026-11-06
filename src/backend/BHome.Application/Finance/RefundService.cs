using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.ComponentModel.DataAnnotations.Schema;
using BHome.Application.Contracts;
using BHome.Application.IdentityAccess;
using BHome.Application.Storage;
using BHome.Domain.IdentityAccess;
using BHome.Application.PaymentsDebt;

namespace BHome.Application.Finance;

public sealed record RefundInput(Guid BeneficiaryResidentId,
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal Amount,
    string Reason, bool HumanConfirmed);
public sealed record RefundDecision(int ExpectedVersion, bool Approve, string Reason, bool HumanConfirmed);
public sealed record RefundExecution(int ExpectedVersion, DateTimeOffset ExecutedAt, string ExternalReference, string Reason, bool HumanConfirmed);
public sealed record RefundPerson(Guid Id, string Label);
public sealed record RefundEvent(string Action, Guid Actor, DateTimeOffset At, string Reason, int Version,
    Guid Key, string Fingerprint);
public sealed record RefundUpload(Guid Key, string Fingerprint, string ObjectKey, string ContentType, long Length,
    string Sha256, DateTimeOffset ExecutedAt, string ExternalReference, string Reason);
public sealed class RefundRecord
{
    public Guid Id { get; set; }
    public Guid SourcePaymentId { get; set; }
    public Guid BeneficiaryResidentId { get; set; }
    public string BeneficiaryLabel { get; set; } = "";
    public decimal Amount { get; set; }
    public Guid RequestedBy { get; set; }
    public DateTimeOffset RequestedAt { get; set; }
    public string Reason { get; set; } = "";
    public string Status { get; set; } = "REQUESTED";
    public int Version { get; set; } = 1;
    public Guid OperationKey { get; set; }
    public Guid? DecidedBy { get; set; }
    public DateTimeOffset? DecidedAt { get; set; }
    public string? DecisionReason { get; set; }
    public DateTimeOffset? ExecutedAt { get; set; }
    public string? ExternalReference { get; set; }
    public string? EvidenceKey { get; set; }
    public string HistoryJson { get; set; } = "[]";
    public bool IsDevelopmentDemo { get; set; }
    [NotMapped] public RefundState State { get; set; } = new();
}
public sealed class RefundState
{
    public string Classification { get; set; } = "ExcessReceiptRefundV1";
    public List<RefundEvent> Events { get; set; } = [];
    public RefundUpload? Upload { get; set; }
}
public sealed record RefundView(Guid Id, Guid SourcePaymentId, Guid BeneficiaryResidentId, string BeneficiaryLabel,
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal Amount, string Reason, string Status,
    int Version, DateTimeOffset RequestedAt, string? DecisionReason, DateTimeOffset? DecidedAt,
    DateTimeOffset? ExecutedAt, string? ExternalReference, bool IsDevelopmentDemo,
    IReadOnlyList<RefundEvent> History, RefundUploadView? ExecutionIntent);
public sealed record RefundUploadView(Guid Key, string ContentType, long Length, string Sha256,
    DateTimeOffset ExecutedAt, string ExternalReference, string Reason);
public sealed record RefundSource(Guid SourcePaymentId,
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal ExcessAmount,
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal RefundedAmount,
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal ReservedAmount,
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal AvailableAmount,
    bool IsDevelopmentDemo, IReadOnlyList<RefundPerson> Beneficiaries, IReadOnlyList<RefundView> Requests);
public sealed record RefundSourceData(decimal Excess, bool IsDevelopmentDemo, IReadOnlyList<RefundPerson> Beneficiaries,
    IReadOnlyList<RefundRecord> Requests);
public interface IRefundRepository
{
    Task<T> TransactionAsync<T>(Func<Task<T>> work, CancellationToken t);
    Task<RefundSourceData> SourceAsync(Guid id, CancellationToken t);
    Task<RefundRecord> GetAsync(Guid id, CancellationToken t);
    Task<RefundRecord?> OperationAsync(Guid key, CancellationToken t);
    Task<bool> ReferenceUsedAsync(string reference, Guid exceptId, CancellationToken t);
    Task SaveAsync(RefundRecord record, bool create, Guid actor, string action, DateTimeOffset now, CancellationToken t);
}
public sealed class RefundService(IRefundRepository repository, IObjectStorage storage, IContractImageValidator images,
    ICurrentUser user, TimeProvider clock, PaymentRuntimeMode? mode = null)
{
    private Guid Owner()
    {
        if (user.UserId is not { } actor || actor == Guid.Empty) throw new FinanceException(401, "authentication_required");
        if (!user.IsInRole(Roles.Owner)) throw new FinanceException(403, "finance_owner_required");
        return actor;
    }
    private DateTimeOffset Now => clock.GetUtcNow();
    private void ValidateMode(bool demo) { if (demo && mode?.AllowDevelopmentDemo != true) throw new FinanceException(409, "development_payment_unavailable"); }
    private static string Reason(string value) => string.IsNullOrWhiteSpace(value) || value.Length > 2000
        ? throw new FinanceException(400, "invalid_refund_reason") : value.Trim();
    private static void Key(Guid key) { if (key == Guid.Empty) throw new FinanceException(400, "idempotency_key_required"); }
    private static string Hash(object value) => Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(value)));
    private static RefundView View(RefundRecord row) => new(row.Id, row.SourcePaymentId, row.BeneficiaryResidentId,
        row.BeneficiaryLabel, row.Amount, row.Reason, row.Status, row.Version, row.RequestedAt, row.DecisionReason,
        row.DecidedAt, row.ExecutedAt, row.ExternalReference, row.IsDevelopmentDemo, row.State.Events,
        row.State.Upload is { } u && row.Status != "COMPLETED" ? new(u.Key, u.ContentType, u.Length, u.Sha256, u.ExecutedAt, u.ExternalReference, u.Reason) : null);
    private static decimal Reserved(RefundSourceData source) => source.Requests.Where(r => r.Status is "REQUESTED" or "APPROVED" or "COMPLETED").Sum(r => r.Amount);
    public async Task<RefundSource> SourceAsync(Guid id, CancellationToken t)
    {
        _ = Owner();
        return await repository.TransactionAsync(async () => {
            var source = await repository.SourceAsync(id, t);
            var paid = source.Requests.Where(r => r.Status == "COMPLETED").Sum(r => r.Amount);
            var held = Reserved(source) - paid;
            return new RefundSource(id, source.Excess, paid, held, Math.Max(0, source.Excess - paid - held),
                source.IsDevelopmentDemo, source.Beneficiaries, source.Requests.Select(View).ToArray());
        }, t);
    }
    public Task<RefundView> CreateAsync(Guid sourceId, RefundInput input, Guid key, CancellationToken t)
    {
        var actor = Owner(); Key(key);
        var x = input with { Reason = Reason(input.Reason) };
        if (!x.HumanConfirmed || x.BeneficiaryResidentId == Guid.Empty || x.Amount <= 0 ||
            x.Amount >= 1_000_000_000_000_000_000m || decimal.Truncate(x.Amount) != x.Amount)
            throw new FinanceException(400, "invalid_refund_request");
        var fingerprint = Hash(new { sourceId, input = x });
        return repository.TransactionAsync(async () => {
            if (await repository.OperationAsync(key, t) is { } previous)
            {
                if (previous.RequestedBy != actor || previous.State.Events.FirstOrDefault()?.Fingerprint != fingerprint)
                    throw new FinanceException(409, "refund_idempotency_conflict");
                return View(previous);
            }
            var source = await repository.SourceAsync(sourceId, t);
            ValidateMode(source.IsDevelopmentDemo);
            var person = source.Beneficiaries.SingleOrDefault(p => p.Id == x.BeneficiaryResidentId)
                ?? throw new FinanceException(409, "refund_verified_payer_required");
            if (source.Requests.Count >= 100 || x.Amount > source.Excess - Reserved(source))
                throw new FinanceException(409, "refund_amount_unavailable");
            var now = Now;
            var row = new RefundRecord { Id = Guid.NewGuid(), SourcePaymentId = sourceId, BeneficiaryResidentId = person.Id,
                BeneficiaryLabel = person.Label, Amount = x.Amount, Reason = x.Reason, RequestedBy = actor,
                RequestedAt = now, OperationKey = key, IsDevelopmentDemo = source.IsDevelopmentDemo };
            row.State.Events.Add(new("Requested", actor, now, x.Reason, row.Version, key, fingerprint));
            await repository.SaveAsync(row, true, actor, "ExcessRefundRequested", now, t); return View(row);
        }, t);
    }
    public Task<RefundView> DecideAsync(Guid id, RefundDecision input, Guid key, CancellationToken t)
    {
        var actor = Owner(); Key(key); var x = input with { Reason = Reason(input.Reason) };
        if (!x.HumanConfirmed || x.ExpectedVersion < 1) throw new FinanceException(400, "invalid_refund_decision");
        var fingerprint = Hash(x);
        return repository.TransactionAsync(async () => {
            var row = await repository.GetAsync(id, t);
            ValidateMode(row.IsDevelopmentDemo);
            if (Replay(row, actor, key, fingerprint)) return View(row);
            if (row.Status != "REQUESTED" || row.Version != x.ExpectedVersion) throw new FinanceException(409, "refund_changed");
            if (x.Approve) await ValidateSourceAsync(row, t);
            row.Status = x.Approve ? "APPROVED" : "REJECTED"; row.Version++;
            row.DecidedBy = actor; row.DecidedAt = Now; row.DecisionReason = x.Reason;
            row.State.Events.Add(new(row.Status, actor, row.DecidedAt.Value, x.Reason, row.Version, key, fingerprint));
            await repository.SaveAsync(row, false, actor, "ExcessRefund" + row.Status, row.DecidedAt.Value, t); return View(row);
        }, t);
    }
    private static bool Replay(RefundRecord row, Guid actor, Guid key, string fingerprint)
    {
        if (row.State.Events.SingleOrDefault(e => e.Key == key) is not { } previous) return false;
        if (previous.Actor != actor || previous.Fingerprint != fingerprint) throw new FinanceException(409, "refund_idempotency_conflict");
        return true;
    }
    private async Task ValidateSourceAsync(RefundRecord row, CancellationToken t)
    {
        var source = await repository.SourceAsync(row.SourcePaymentId, t);
        if (!source.Beneficiaries.Any(p => p.Id == row.BeneficiaryResidentId) || Reserved(source) > source.Excess)
            throw new FinanceException(409, "refund_source_changed");
    }
    public async Task<RefundView> ExecuteAsync(Guid id, RefundExecution input, Guid key, Stream image, CancellationToken t)
    {
        var actor = Owner(); Key(key);
        var x = input with { Reason = Reason(input.Reason), ExternalReference = input.ExternalReference?.Trim().ToUpperInvariant() ?? "",
            ExecutedAt = input.ExecutedAt.ToUniversalTime() };
        if (!x.HumanConfirmed || x.ExpectedVersion < 1 || x.ExecutedAt == default || x.ExecutedAt > Now ||
            x.ExternalReference.Length is < 1 or > 200 || x.ExternalReference.Any(c => !char.IsAsciiLetterOrDigit(c) && c is not ('-' or '_' or ':' or '.' or '/')))
            throw new FinanceException(400, "invalid_refund_execution");
        _ = await repository.GetAsync(id, t);
        using var buffer = new MemoryStream(); var block = new byte[81920];
        while (true) {
            var count = await image.ReadAsync(block, t); if (count == 0) break;
            if (buffer.Length + count > 5 * 1024 * 1024) throw new FinanceException(413, "refund_evidence_too_large");
            await buffer.WriteAsync(block.AsMemory(0, count), t);
        }
        var bytes = buffer.ToArray();
        try {
            var type = images.Validate(bytes); var hash = Convert.ToHexString(SHA256.HashData(bytes));
            var fingerprint = Hash(new { input = x, type, hash, length = bytes.Length });
            var row = await repository.TransactionAsync(async () => {
                var current = await repository.GetAsync(id, t);
                ValidateMode(current.IsDevelopmentDemo);
                if (Replay(current, actor, key, fingerprint)) return current;
                if (current.Status != "APPROVED" || current.Version != x.ExpectedVersion || x.ExecutedAt < current.DecidedAt)
                    throw new FinanceException(409, "refund_changed");
                await ValidateSourceAsync(current, t);
                if (current.State.Upload is { } prior && (prior.Key != key || prior.Fingerprint != fingerprint))
                    throw new FinanceException(409, "refund_execution_intent_conflict");
                if (await repository.ReferenceUsedAsync(x.ExternalReference, id, t)) throw new FinanceException(409, "refund_reference_used");
                if (current.State.Upload is null) {
                    current.State.Upload = new(key, fingerprint, $"refunds/{id:N}/{key:N}", type, bytes.Length, hash,
                        x.ExecutedAt, x.ExternalReference, x.Reason);
                    await repository.SaveAsync(current, false, actor, "ExcessRefundExecutionPending", Now, t);
                }
                return current;
            }, t);
            var intent = row.State.Upload ?? throw new FinanceException(409, "refund_evidence_missing");
            if (row.Status == "COMPLETED") { await CopyVerified(intent, Stream.Null, t); return View(row); }
            using var deadline = CancellationTokenSource.CreateLinkedTokenSource(t); deadline.CancelAfter(TimeSpan.FromSeconds(30));
            using var content = new MemoryStream(bytes);
            await storage.PutAsync(intent.ObjectKey, content, bytes.Length, type, deadline.Token);
            await CopyVerified(intent, Stream.Null, deadline.Token);
            return await repository.TransactionAsync(async () => {
                var current = await repository.GetAsync(id, t);
                if (Replay(current, actor, key, fingerprint)) return View(current);
                if (current.Status != "APPROVED" || current.Version != x.ExpectedVersion || current.State.Upload?.Fingerprint != fingerprint)
                    throw new FinanceException(409, "refund_changed");
                await ValidateSourceAsync(current, t);
                current.Status = "COMPLETED"; current.Version++; current.ExecutedAt = intent.ExecutedAt;
                current.ExternalReference = intent.ExternalReference; current.EvidenceKey = intent.ObjectKey;
                current.State.Events.Add(new("Completed", actor, Now, x.Reason, current.Version, key, fingerprint));
                await repository.SaveAsync(current, false, actor, "ExcessRefundCompleted", Now, t); return View(current);
            }, t);
        } finally { CryptographicOperations.ZeroMemory(bytes); }
    }
    public async Task<string> CopyAsync(Guid id, Stream output, CancellationToken t)
    {
        _ = Owner(); var row = await repository.GetAsync(id, t);
        if (row.Status != "COMPLETED" || row.State.Upload is not { } intent || row.EvidenceKey != intent.ObjectKey)
            throw new FinanceException(404, "refund_evidence_not_found");
        await CopyVerified(intent, output, t); return intent.ContentType;
    }
    private async Task CopyVerified(RefundUpload file, Stream output, CancellationToken t)
    {
        using var bytes = new MemoryStream(); await storage.CopyToAsync(file.ObjectKey, bytes, t);
        if (bytes.Length != file.Length || Convert.ToHexString(SHA256.HashData(bytes.ToArray())) != file.Sha256)
            throw new FinanceException(409, "refund_evidence_integrity_failed");
        bytes.Position = 0; await bytes.CopyToAsync(output, t);
    }
}
