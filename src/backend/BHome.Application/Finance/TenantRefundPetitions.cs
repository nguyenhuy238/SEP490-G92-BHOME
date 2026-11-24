using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using BHome.Application.Contracts;
using BHome.Application.IdentityAccess;
using BHome.Application.PropertyManagement;
using BHome.Application.Storage;
using BHome.Domain.IdentityAccess;

namespace BHome.Application.Finance;

// A Tenant petition is not an accounting refund. The optional references are context only;
// neither creating nor completing a petition reserves funds or changes the verified ledger.
public sealed record TenantRefundPetitionInput(
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal Amount,
    string Reason, Guid? SourcePaymentId = null,
    Guid? SourceContractId = null, Guid? MoveOutProposalId = null);
public sealed record TenantRefundPetitionDecision(int ExpectedVersion, bool Approve, string Reason, bool HumanConfirmed);
public sealed record TenantRefundPetitionExecution(int ExpectedVersion, DateTimeOffset ExecutedAt,
    string ExternalReference, string Reason, bool HumanConfirmed);
public sealed record TenantRefundSourceChoice(Guid Id, string Label);
public sealed record TenantRefundPetitionSources(IReadOnlyList<TenantRefundSourceChoice> Payments,
    IReadOnlyList<TenantRefundSourceChoice> Contracts);
public sealed record TenantRefundPetitionView(Guid Id,
    [property: JsonNumberHandling(JsonNumberHandling.AllowReadingFromString | JsonNumberHandling.WriteAsString)] decimal Amount,
    string Reason, string Status, Guid? SourcePaymentId, Guid? SourceContractId, DateTimeOffset CreatedAt,
    DateTimeOffset? DecidedAt, string? DecisionReason, DateTimeOffset? ExecutedAt, string? ExternalReference,
    bool HasEvidence, int Version, string? TenantLabel = null, RefundUploadView? ExecutionIntent = null,
    Guid? MoveOutProposalId = null);

public sealed class TenantRefundPetitionState
{
    public string Classification { get; set; } = "TenantRefundPetitionV1";
    public Guid? SourcePaymentId { get; set; }
    public Guid? SourceContractId { get; set; }
    public Guid? MoveOutProposalId { get; set; }
    public List<RefundEvent> Events { get; set; } = [];
    public RefundUpload? Upload { get; set; }
}
public sealed class TenantRefundPetitionRecord
{
    public Guid Id { get; set; }
    public Guid BeneficiaryResidentId { get; set; }
    public Guid TenantUserId { get; set; }
    public string TenantLabel { get; set; } = "";
    public decimal Amount { get; set; }
    public string Reason { get; set; } = "";
    public string Status { get; set; } = "REQUESTED";
    public DateTimeOffset CreatedAt { get; set; }
    public Guid OperationKey { get; set; }
    public int Version { get; set; } = 1;
    public Guid? DecidedBy { get; set; }
    public DateTimeOffset? DecidedAt { get; set; }
    public string? DecisionReason { get; set; }
    public DateTimeOffset? ExecutedAt { get; set; }
    public string? ExternalReference { get; set; }
    public string? EvidenceKey { get; set; }
    public string HistoryJson { get; set; } = "[]";
    [System.ComponentModel.DataAnnotations.Schema.NotMapped]
    public TenantRefundPetitionState State { get; set; } = new();
}
public interface ITenantRefundPetitionRepository
{
    Task<T> TransactionAsync<T>(Func<Task<T>> work, CancellationToken token);
    Task<PagedResult<TenantRefundPetitionRecord>> ListAsync(Guid? tenantId, int page, int size, CancellationToken token);
    Task<TenantRefundPetitionRecord> GetAsync(Guid id, CancellationToken token);
    Task<TenantRefundPetitionRecord?> ByOperationAsync(Guid key, CancellationToken token);
    Task<Guid?> ResidentIdAsync(Guid tenantId, CancellationToken token);
    Task<TenantRefundPetitionSources> SourcesAsync(Guid tenantId, CancellationToken token);
    Task<bool> ActiveMoveOutPetitionAsync(Guid proposalId, CancellationToken token);
    Task<bool> ReferenceUsedAsync(string reference, Guid exceptId, CancellationToken token);
    Task SaveAsync(TenantRefundPetitionRecord row, bool create, Guid actor, string action, DateTimeOffset now,
        CancellationToken token);
}

public sealed class TenantRefundPetitionService(
    ITenantRefundPetitionRepository repository, IObjectStorage storage, IContractImageValidator images,
    ICurrentUser user, TimeProvider clock, SettlementReceivablesService? settlements = null)
{
    private Guid Actor(string role)
    {
        if (user.UserId is not { } actor || actor == Guid.Empty)
            throw new FinanceException(401, "authentication_required");
        if (!user.IsInRole(role)) throw new FinanceException(403, "refund_role_required");
        return actor;
    }
    private DateTimeOffset Now => clock.GetUtcNow();
    private static void Key(Guid key)
    {
        if (key == Guid.Empty) throw new FinanceException(400, "idempotency_key_required");
    }
    private static string Reason(string? reason, bool required = true)
    {
        var value = reason?.Trim() ?? "";
        if (value.Length > 2000 || (required && value.Length == 0))
            throw new FinanceException(400, "invalid_refund_reason");
        return value;
    }
    private static string Fingerprint(object data) =>
        Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(data)));
    private static void Page(int page, int size)
    {
        if (page < 1 || size is < 1 or > 100 || (long)(page - 1) * size > int.MaxValue)
            throw new FinanceException(400, "invalid_refund_page");
    }
    private static TenantRefundPetitionView View(TenantRefundPetitionRecord row, bool owner) =>
        new(row.Id, row.Amount, row.Reason, row.Status, row.State.SourcePaymentId, row.State.SourceContractId,
            row.CreatedAt, row.DecidedAt, row.DecisionReason, row.ExecutedAt, row.ExternalReference,
            row.Status == "COMPLETED" && row.State.Upload is { } upload && upload.ObjectKey == row.EvidenceKey,
            row.Version, owner ? row.TenantLabel : null,
            owner && row.Status == "APPROVED" && row.State.Upload is { } intent
                ? new(intent.Key, intent.ContentType, intent.Length, intent.Sha256, intent.ExecutedAt,
                    intent.ExternalReference, intent.Reason) : null,
            row.State.MoveOutProposalId);
    /// <summary>Validated move-out petitions are requests only; the classified deposit refund
    /// ledger is the sole authority allowed to execute money. Never trust prefilled form values.</summary>
    public static void ValidateMoveOutRefund(MoveOutChargeProposalPreview preview, Guid contractId,
        Guid proposalId, decimal amount)
    {
        var offered = preview.LatestProposal;
        var settlement = offered?.TenantFeedback?.Settlement;
        if (preview.ContractId != contractId || offered?.Id != proposalId ||
            preview.Status != "Accepted" || offered.TenantFeedback?.Confirmed != true ||
            settlement?.Status != "RefundEligible" || settlement.RefundAmount <= 0 ||
            decimal.Truncate(settlement.RefundAmount) != settlement.RefundAmount ||
            amount != settlement.RefundAmount)
            throw new FinanceException(409, "move_out_refund_proposal_changed");
    }
    private static bool Replayed(TenantRefundPetitionRecord row, Guid actor, Guid key, string fingerprint)
    {
        var eventRow = row.State.Events.SingleOrDefault(e => e.Key == key);
        if (eventRow is null) return false;
        if (eventRow.Actor != actor || eventRow.Fingerprint != fingerprint)
            throw new FinanceException(409, "refund_idempotency_conflict");
        return true;
    }
    public async Task<PagedResult<TenantRefundPetitionView>> TenantListAsync(int page, int size, CancellationToken token)
    {
        var actor = Actor(Roles.Tenant); Page(page, size);
        var data = await repository.ListAsync(actor, page, size, token);
        return new(data.Items.Select(r => View(r, false)).ToArray(), data.Page, data.PageSize, data.TotalCount);
    }
    public async Task<PagedResult<TenantRefundPetitionView>> OwnerListAsync(int page, int size, CancellationToken token)
    {
        _ = Actor(Roles.Owner); Page(page, size);
        var data = await repository.ListAsync(null, page, size, token);
        return new(data.Items.Select(r => View(r, true)).ToArray(), data.Page, data.PageSize, data.TotalCount);
    }
    public Task<TenantRefundPetitionSources> SourcesAsync(CancellationToken token) =>
        repository.SourcesAsync(Actor(Roles.Tenant), token);

    public Task<TenantRefundPetitionView> CreateAsync(TenantRefundPetitionInput input, Guid key, CancellationToken token)
    {
        var actor = Actor(Roles.Tenant); Key(key);
        var x = input with { Reason = Reason(input.Reason) };
        if (x.Amount <= 0 || x.Amount >= 1_000_000_000_000_000_000m || decimal.Truncate(x.Amount) != x.Amount ||
            x.SourcePaymentId == Guid.Empty || x.SourceContractId == Guid.Empty ||
            x.MoveOutProposalId == Guid.Empty || x.MoveOutProposalId is not null &&
            (x.SourceContractId is null || x.SourcePaymentId is not null))
            throw new FinanceException(400, "invalid_refund_request");
        var fingerprint = Fingerprint(x);
        return repository.TransactionAsync(async () =>
        {
            if (await repository.ByOperationAsync(key, token) is { } previous)
            {
                if (previous.TenantUserId != actor || previous.State.Events.FirstOrDefault()?.Fingerprint != fingerprint)
                    throw new FinanceException(409, "refund_idempotency_conflict");
                return View(previous, false);
            }
            var resident = await repository.ResidentIdAsync(actor, token)
                ?? throw new FinanceException(409, "tenant_resident_required");
            var sources = await repository.SourcesAsync(actor, token);
            if (x.SourcePaymentId is { } payment && !sources.Payments.Any(p => p.Id == payment) ||
                x.SourceContractId is { } contract && !sources.Contracts.Any(c => c.Id == contract))
                throw new FinanceException(404, "refund_source_not_found");
            if (x.MoveOutProposalId is { } moveOutProposal)
            {
                if (settlements is null)
                    throw new FinanceException(503, "move_out_refund_validation_unavailable");
                var preview = await settlements.GetProposalAsync(x.SourceContractId!.Value, token);
                ValidateMoveOutRefund(preview, x.SourceContractId.Value, moveOutProposal, x.Amount);
                if (!await settlements.HasCurrentMoveOutRefundBalanceAsync(x.SourceContractId.Value,
                    x.Amount, token))
                    throw new FinanceException(409, "move_out_refund_proposal_changed");
                if (await repository.ActiveMoveOutPetitionAsync(moveOutProposal, token))
                    throw new FinanceException(409, "move_out_refund_already_requested");
            }
            var now = Now;
            var row = new TenantRefundPetitionRecord
            {
                Id = Guid.NewGuid(),
                TenantUserId = actor,
                BeneficiaryResidentId = resident,
                Amount = x.Amount,
                Reason = x.Reason,
                CreatedAt = now,
                OperationKey = key,
                State = new()
                {
                    SourcePaymentId = x.SourcePaymentId,
                    SourceContractId = x.SourceContractId,
                    MoveOutProposalId = x.MoveOutProposalId
                }
            };
            row.State.Events.Add(new("Requested", actor, now, x.Reason, row.Version, key, fingerprint));
            await repository.SaveAsync(row, true, actor, "TenantRefundPetitionRequested", now, token);
            return View(row, false);
        }, token);
    }
    public Task<TenantRefundPetitionView> DecideAsync(Guid id, TenantRefundPetitionDecision input, Guid key,
        CancellationToken token)
    {
        var actor = Actor(Roles.Owner); Key(key);
        var x = input with { Reason = Reason(input.Reason, !input.Approve) };
        if (!x.HumanConfirmed || x.ExpectedVersion < 1)
            throw new FinanceException(400, "invalid_refund_decision");
        var fingerprint = Fingerprint(x);
        return repository.TransactionAsync(async () =>
        {
            var row = await repository.GetAsync(id, token);
            if (Replayed(row, actor, key, fingerprint)) return View(row, true);
            if (row.Status != "REQUESTED" || row.Version != x.ExpectedVersion)
                throw new FinanceException(409, "refund_changed");
            if (x.Approve && row.State.MoveOutProposalId is { } proposalId)
            {
                if (settlements is null || row.State.SourceContractId is not { } contractId)
                    throw new FinanceException(503, "move_out_refund_validation_unavailable");
                ValidateMoveOutRefund(await settlements.GetProposalAsync(contractId, token),
                    contractId, proposalId, row.Amount);
                if (!await settlements.HasCurrentMoveOutRefundBalanceAsync(contractId,
                    row.Amount, token))
                    throw new FinanceException(409, "move_out_refund_proposal_changed");
            }
            row.Status = x.Approve ? "APPROVED" : "REJECTED";
            row.Version++; row.DecidedBy = actor; row.DecidedAt = Now; row.DecisionReason = x.Reason;
            row.State.Events.Add(new(row.Status, actor, row.DecidedAt.Value, x.Reason, row.Version, key, fingerprint));
            await repository.SaveAsync(row, false, actor, "TenantRefundPetition" + row.Status, Now, token);
            return View(row, true);
        }, token);
    }
    public async Task<TenantRefundPetitionView> ExecuteAsync(Guid id, TenantRefundPetitionExecution input, Guid key,
        Stream evidence, CancellationToken token)
    {
        var actor = Actor(Roles.Owner); Key(key);
        var x = input with
        {
            Reason = Reason(input.Reason, false),
            ExternalReference = input.ExternalReference?.Trim().ToUpperInvariant() ?? "",
            ExecutedAt = input.ExecutedAt.ToUniversalTime()
        };
        if (!x.HumanConfirmed || x.ExpectedVersion < 1 || x.ExecutedAt == default || x.ExecutedAt > Now ||
            x.ExternalReference.Length is < 1 or > 200 ||
            x.ExternalReference.Any(c => !char.IsAsciiLetterOrDigit(c) && c is not ('-' or '_' or ':' or '.' or '/')))
            throw new FinanceException(400, "invalid_refund_execution");
        // A contextual petition is NOT an executable deposit refund. For a
        // move-out-linked petition the Owner must pay from the classified,
        // source-backed deposit refund ledger, never a second independent payout.
        if ((await repository.GetAsync(id, token)).State.MoveOutProposalId is not null)
            throw new FinanceException(409, "move_out_refund_use_deposit_ledger");
        await using var buffer = new MemoryStream();
        var block = new byte[81920];
        while (true)
        {
            var count = await evidence.ReadAsync(block, token);
            if (count == 0) break;
            if (buffer.Length + count > 5 * 1024 * 1024)
                throw new FinanceException(413, "refund_evidence_too_large");
            await buffer.WriteAsync(block.AsMemory(0, count), token);
        }
        var bytes = buffer.ToArray();
        try
        {
            var contentType = images.Validate(bytes);
            var sha = Convert.ToHexString(SHA256.HashData(bytes));
            var fingerprint = Fingerprint(new { input = x, contentType, sha, length = bytes.Length });
            var pending = await repository.TransactionAsync(async () =>
            {
                var row = await repository.GetAsync(id, token);
                if (Replayed(row, actor, key, fingerprint)) return row;
                if (row.Status != "APPROVED" || row.Version != x.ExpectedVersion || x.ExecutedAt < row.DecidedAt)
                    throw new FinanceException(409, "refund_changed");
                if (await repository.ReferenceUsedAsync(x.ExternalReference, id, token))
                    throw new FinanceException(409, "refund_reference_used");
                if (row.State.Upload is { } previous && (previous.Key != key || previous.Fingerprint != fingerprint))
                    throw new FinanceException(409, "refund_execution_intent_conflict");
                if (row.State.Upload is null)
                {
                    row.State.Upload = new(key, fingerprint, $"tenant-refund-petitions/{id:N}/{key:N}", contentType,
                        bytes.Length, sha, x.ExecutedAt, x.ExternalReference, x.Reason);
                    await repository.SaveAsync(row, false, actor, "TenantRefundPetitionExecutionPending", Now, token);
                }
                return row;
            }, token);
            var intent = pending.State.Upload ?? throw new FinanceException(409, "refund_evidence_missing");
            if (pending.Status == "COMPLETED")
            {
                // A replay must not report success if the previously stored evidence
                // has since become unavailable or no longer matches the intent.
                await CopyVerifiedAsync(intent, Stream.Null, token);
                return View(pending, true);
            }
            using var deadline = CancellationTokenSource.CreateLinkedTokenSource(token);
            deadline.CancelAfter(TimeSpan.FromSeconds(30));
            using (var content = new MemoryStream(bytes))
                await storage.PutAsync(intent.ObjectKey, content, bytes.Length, contentType, deadline.Token);
            await CopyVerifiedAsync(intent, Stream.Null, deadline.Token);
            return await repository.TransactionAsync(async () =>
            {
                var row = await repository.GetAsync(id, token);
                if (Replayed(row, actor, key, fingerprint)) return View(row, true);
                if (row.Status != "APPROVED" || row.Version != x.ExpectedVersion ||
                    row.State.Upload?.Fingerprint != fingerprint)
                    throw new FinanceException(409, "refund_changed");
                row.Status = "COMPLETED"; row.Version++; row.ExecutedAt = intent.ExecutedAt;
                row.ExternalReference = intent.ExternalReference; row.EvidenceKey = intent.ObjectKey;
                row.State.Events.Add(new("Completed", actor, Now, x.Reason, row.Version, key, fingerprint));
                await repository.SaveAsync(row, false, actor, "TenantRefundPetitionCompleted", Now, token);
                return View(row, true);
            }, token);
        }
        finally { CryptographicOperations.ZeroMemory(bytes); }
    }
    public async Task<string> CopyEvidenceAsync(Guid id, Stream destination, bool tenant, CancellationToken token)
    {
        var actor = Actor(tenant ? Roles.Tenant : Roles.Owner);
        var row = await repository.GetAsync(id, token);
        if (tenant && row.TenantUserId != actor) throw new FinanceException(404, "refund_not_found");
        if (row.Status != "COMPLETED" || row.State.Upload is not { } upload ||
            row.EvidenceKey != upload.ObjectKey)
            throw new FinanceException(404, "refund_evidence_not_found");
        await CopyVerifiedAsync(upload, destination, token);
        return upload.ContentType;
    }
    private async Task CopyVerifiedAsync(RefundUpload upload, Stream destination, CancellationToken token)
    {
        using var buffer = new MemoryStream();
        await storage.CopyToAsync(upload.ObjectKey, buffer, token);
        if (buffer.Length != upload.Length ||
            Convert.ToHexString(SHA256.HashData(buffer.ToArray())) != upload.Sha256)
            throw new FinanceException(409, "refund_evidence_integrity_failed");
        buffer.Position = 0;
        await buffer.CopyToAsync(destination, token);
    }
}
