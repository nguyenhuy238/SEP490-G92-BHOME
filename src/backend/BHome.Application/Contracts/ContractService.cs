using System.ComponentModel.DataAnnotations;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json;
using BHome.Application.Common;
using BHome.Application.IdentityAccess;
using BHome.Application.Storage;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;

namespace BHome.Application.Contracts;

public sealed class ContractService(IContractRepository repository, ICurrentUser user, ResourceAccess access,
    IContractSigningProvider signing, IObjectStorage storage, IContractFileStore files, IContractImageValidator images,
    IContractSettlementLedger ledger, IContractHoldingLedger holdings, TimeProvider clock)
{
    private Guid Actor => user.UserId is { } id && id != Guid.Empty ? id : throw new ContractException(401, "authentication_required");
    private DateOnly Today => DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(clock.GetUtcNow(), "Asia/Ho_Chi_Minh").DateTime);
    private void Role(params string[] roles) { _ = Actor; if (!roles.Any(user.IsInRole)) throw new ContractException(403, "contract_role_forbidden"); }
    private static string Hash<T>(T value) => Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(value)));
    private static string FileHash(byte[] value) => Convert.ToHexString(SHA256.HashData(value));
    private static void Validate(object value)
    {
        if (!Validator.TryValidateObject(value, new ValidationContext(value), [], true)) throw ContractException.Invalid("invalid_contract_input");
        foreach (var parameter in value.GetType().GetConstructors().Single().GetParameters())
        {
            var field = value.GetType().GetProperty(parameter.Name!)!.GetValue(value);
            if (!Validator.TryValidateValue(field, new ValidationContext(value), [], parameter.GetCustomAttributes<ValidationAttribute>()))
                throw ContractException.Invalid("invalid_contract_input");
        }
    }
    private static void Money(decimal value, bool allowZero = true)
    {
        if (value < 0 || (!allowZero && value == 0) || value >= 1_000_000_000_000_000_000m || decimal.Truncate(value) != value)
            throw ContractException.Invalid("invalid_vnd_amount");
    }
    private async Task<Contract> Load(Guid id, string[] roles, CancellationToken t)
    {
        Role(roles);
        var c = await repository.FindAsync(id, t) ?? throw ContractException.Missing();
        if (!await access.CanAccessAsync(new(c.Room.LocationId, c.TenantUserId), roles, t)) throw ContractException.Missing();
        return c;
    }
    private async Task ScopeRoom(Guid roomId, CancellationToken t)
    {
        var room = await repository.RoomAsync(roomId, t) ?? throw ContractException.Missing();
        if (!room.Location.IsActive || !await access.CanAccessAsync(new(room.LocationId, null), [Roles.Owner, Roles.Staff], t))
            throw ContractException.Missing();
    }
    private async Task<Guid?> Replay(Guid key, string operation, object input, CancellationToken t)
    {
        if (key == Guid.Empty) throw ContractException.Invalid("idempotency_key_required");
        var prior = await repository.OperationAsync(Actor, key, operation, t);
        if (prior is null) return null;
        if (prior.Fingerprint != Hash(input)) throw ContractException.Conflict("idempotency_key_reused");
        return prior.ResultId;
    }
    private void Remember(Guid key, string operation, object input, Guid result)
        => repository.Add(new ContractOperation { ActorId = Actor, Key = key, Operation = operation, Fingerprint = Hash(input), ResultId = result, CreatedAt = clock.GetUtcNow() });
    private void Audit(string action, Guid id) => repository.Audit(Actor, action, id, clock.GetUtcNow());
    private async Task<T> Mutate<T>(Guid id, string[] roles, Func<Contract, Task<T>> work, CancellationToken t)
    {
        var before = await Load(id, roles, t);
        return await repository.InTransactionAsync(before.RoomId, async () => await work(await Load(id, roles, t)), t);
    }
    private static ContractDocument Document(Contract c) => new(c.Id, c.RoomId, c.OwnerSignerId, c.TenantUserId,
        c.RepresentativeResidentId, c.Residents.Select(x => x.ResidentId).Order().ToArray(), c.StartDate, c.EndDate,
        c.MonthlyRent, c.RequiredDeposit, c.HoldingContractId, c.AppliedHoldingDeposit, c.Terms, c.SnapshotHash);
    private static void Seal(Contract c) => c.SnapshotHash = Hash(Document(c) with { SnapshotHash = "" });
    private static bool Intact(Contract c) => c.SnapshotHash == Hash(Document(c) with { SnapshotHash = "" });
    private static ContractView View(Contract c) => new(c.Id, c.RoomId, c.Kind.ToString(), c.Status.ToString(), c.StartDate,
        c.EndDate, c.MonthlyRent, c.RequiredDeposit, c.Terms, c.PreviousContractId,
        c.Residents.Select(r => r.ResidentId).ToArray(), c.Signatures.Select(s => new SignatureView(s.Id, s.SignerUserId, s.Status.ToString(), s.SignedAt)).ToArray(), c.ActivatedAt,
        c.OwnerSignerId, c.TenantUserId, c.RepresentativeResidentId, c.HoldingContractId, c.AppliedHoldingDeposit, c.Room.LocationId);
    private static MoveOutView View(ContractMoveOut m) => new(m.Id, m.Status.ToString(), m.ProposedDate, m.Reason, m.InspectionScheduledAt, m.PendingReason,
        m.InspectionNotes, m.InspectedAt, m.ElectricityReadingId, m.WaterReadingId, []);
    public async Task<ContractView> GetAsync(Guid id, CancellationToken t) => View(await Load(id, [Roles.Owner, Roles.Staff, Roles.Tenant], t));

    public Task<ContractPage> ListAsync(int page, int pageSize, Guid? locationId, string? status, CancellationToken t)
    {
        Role(Roles.Owner, Roles.Staff, Roles.Tenant);
        if (page < 1 || pageSize is < 1 or > 100 || page > int.MaxValue / pageSize || locationId == Guid.Empty)
            throw ContractException.Invalid("invalid_contract_pagination");
        ContractStatus? filter = null;
        if (status is not null)
        {
            if (!Enum.TryParse<ContractStatus>(status, out var parsed) || !Enum.IsDefined(parsed))
                throw ContractException.Invalid("invalid_contract_status");
            filter = parsed;
        }
        return repository.ListAsync(new(Actor, user.IsInRole(Roles.Owner), user.IsInRole(Roles.Staff), user.IsInRole(Roles.Tenant), Today),
            page, pageSize, locationId, filter, t);
    }

    public async Task<ContractId> CreateAsync(ContractDraftInput x, Guid key, CancellationToken t)
    {
        Role(Roles.Owner, Roles.Staff); Validate(x); Money(x.MonthlyRent, false); Money(x.RequiredDeposit);
        if (x.OwnerSignerId == x.TenantUserId || x.StartDate == default || x.EndDate <= x.StartDate || x.ResidentIds is null || x.ResidentIds.Length == 0 ||
            x.ResidentIds.Distinct().Count() != x.ResidentIds.Length || !x.ResidentIds.Contains(x.RepresentativeResidentId))
            throw ContractException.Invalid("invalid_contract_period_or_residents");
        await ScopeRoom(x.RoomId, t);
        return await repository.InTransactionAsync(x.RoomId, async () =>
        {
            await ScopeRoom(x.RoomId, t);
            if (await Replay(key, "draft", x, t) is { } prior) return new ContractId(prior);
            if ((await repository.RoomAsync(x.RoomId, t))!.Status != RoomStatus.Available) throw ContractException.Conflict("room_not_available");
            if (!await repository.ActiveUserInRoleAsync(x.OwnerSignerId, Roles.Owner, t) ||
                !await repository.ActiveUserInRoleAsync(x.TenantUserId, Roles.Tenant, t)) throw ContractException.Invalid("invalid_contract_signers");
            var residents = await repository.ResidentsAsync(x.RoomId, x.ResidentIds, t);
            if (residents.Count != x.ResidentIds.Length || residents.Any(r => r.VerificationStatus != IdentityVerificationStatus.Verified))
                throw ContractException.Invalid("verified_residents_required");
            if (await repository.ConflictsAsync(x.RoomId, Guid.Empty, x.StartDate, x.EndDate, t)) throw ContractException.Conflict("room_contract_conflict");
            var c = new Contract { RoomId = x.RoomId, OwnerSignerId = x.OwnerSignerId, TenantUserId = x.TenantUserId,
                RepresentativeResidentId = x.RepresentativeResidentId, StartDate = x.StartDate, EndDate = x.EndDate,
                MonthlyRent = x.MonthlyRent, RequiredDeposit = x.RequiredDeposit, Terms = x.Terms.Trim() };
            if (x.HoldingContractId is { } holdingId)
            {
                var application = await holdings.ApplyAsync(holdingId, c.Id, c.RoomId, c.TenantUserId, c.RequiredDeposit, t);
                if (application.HoldingContractId != holdingId || application.RoomId != c.RoomId || application.TenantUserId != c.TenantUserId ||
                    application.AppliedAmount < 0 || application.AppliedAmount > c.RequiredDeposit || decimal.Truncate(application.AppliedAmount) != application.AppliedAmount ||
                    string.IsNullOrWhiteSpace(application.AllocationReference) || application.AllocationReference.Length > 200)
                    throw ContractException.Conflict("invalid_holding_deposit_allocation");
                c.HoldingContractId = holdingId; c.AppliedHoldingDeposit = application.AppliedAmount; c.HoldingAllocationReference = application.AllocationReference;
            }
            c.Residents = residents.Select(r => new ContractResident { ContractId = c.Id, ResidentId = r.Id,
                Role = r.Id == x.RepresentativeResidentId ? ResidentType.Representative : ResidentType.CoOccupant, ResidenceFrom = c.StartDate }).ToList();
            Seal(c); repository.Add(c); Audit("ContractDraftCreated", c.Id); Remember(key, "draft", x, c.Id); return new ContractId(c.Id);
        }, t);
    }

    public Task<ContractId> RenewAsync(Guid id, RenewalInput x, Guid key, CancellationToken t)
    {
        Validate(x); Money(x.MonthlyRent, false);
        return Mutate(id, [Roles.Owner, Roles.Staff], async c =>
        {
            if (await Replay(key, "renewal", new { id, x }, t) is { } prior) return new ContractId(prior);
            if (c.Status != ContractStatus.Active || x.EndDate <= c.EndDate || await repository.MoveOutAsync(c.Id, t) is not null)
                throw ContractException.Conflict("contract_not_renewable");
            if (await repository.OpenRenewalAsync(c.Id, t)) throw ContractException.Conflict("renewal_already_pending");
            var next = new Contract { RoomId = c.RoomId, OwnerSignerId = c.OwnerSignerId, TenantUserId = c.TenantUserId,
                RepresentativeResidentId = c.RepresentativeResidentId, Kind = ContractKind.Renewal, PreviousContractId = c.Id,
                StartDate = c.EndDate.AddDays(1), EndDate = x.EndDate, MonthlyRent = x.MonthlyRent,
                RequiredDeposit = c.RequiredDeposit, Terms = x.Terms.Trim() };
            next.Residents = c.Residents.Select(r => new ContractResident { ContractId = next.Id, ResidentId = r.ResidentId, Role = r.Role, ResidenceFrom = next.StartDate }).ToList();
            Seal(next); repository.Add(next); Audit("ContractRenewalPrepared", next.Id); Remember(key, "renewal", new { id, x }, next.Id); return new ContractId(next.Id);
        }, t);
    }

    public Task<ContractId> VerifyDepositAsync(Guid id, DepositInput x, Guid key, CancellationToken t)
    {
        Validate(x); Money(x.Amount, false);
        return Mutate(id, [Roles.Owner], async c =>
        {
            if (await Replay(key, "deposit", new { id, x }, t) is { } prior) return new ContractId(prior);
            if (c.PreviousContractId is not null || c.Status is ContractStatus.Terminated or ContractStatus.Superseded)
                throw ContractException.Conflict("deposit_not_payable");
            var reference = x.BankTransactionReference.Trim();
            var existing = await repository.BankReferenceAsync(reference, t);
            if (existing is not null)
            {
                if (existing.ContractId != id || existing.Amount != x.Amount) throw ContractException.Conflict("bank_transaction_already_allocated");
                Remember(key, "deposit", new { id, x }, existing.Id); return new ContractId(existing.Id);
            }
            var entry = new DepositVerification { ContractId = id, Amount = x.Amount, BankTransactionReference = reference,
                VerificationReason = x.VerificationReason.Trim(), VerifiedByUserId = Actor, VerifiedAt = clock.GetUtcNow() };
            repository.Add(entry); Audit("ContractDepositVerified", id); Remember(key, "deposit", new { id, x }, entry.Id); return new ContractId(entry.Id);
        }, t);
    }

    public Task<ContractView> CancelRenewalAsync(Guid id, Guid key, CancellationToken t) => Mutate(id, [Roles.Owner], async c =>
    {
        if (await Replay(key, "renewal-cancel", id, t) is not null) return View(c);
        if (c.Kind != ContractKind.Renewal || c.Status is not (ContractStatus.Draft or ContractStatus.PendingSigning or ContractStatus.PendingActivation))
            throw ContractException.Conflict("renewal_not_cancellable");
        c.Status = ContractStatus.Cancelled; Audit("ContractRenewalCancelled", id); Remember(key, "renewal-cancel", id, id); return View(c);
    }, t);

    private async Task<ActivationReadiness> Readiness(Contract c, CancellationToken t)
    {
        List<string> blockers = [];
        if (c.Status != ContractStatus.PendingActivation) blockers.Add("contract_not_pending_activation");
        if (!c.Room.Location.IsActive) blockers.Add("location_not_active");
        if (c.PreviousContractId is null && c.Room.Status != RoomStatus.Available) blockers.Add("room_not_available");
        if (!Intact(c)) blockers.Add("signed_terms_changed");
        if (c.StartDate > Today || c.EndDate < Today) blockers.Add("contract_not_in_effective_period");
        foreach (var signer in new[] { c.OwnerSignerId, c.TenantUserId })
            if (!c.Signatures.Any(s => s.SignerUserId == signer && s.Status == SignatureStatus.Signed && s.SignedAt is not null &&
                s.SnapshotHash == c.SnapshotHash && !string.IsNullOrWhiteSpace(s.SignedObjectKey) && !string.IsNullOrWhiteSpace(s.ProviderReference)))
                blockers.Add("verified_signature_evidence_required");
        var residents = await repository.ResidentsAsync(c.RoomId, c.Residents.Select(r => r.ResidentId).ToArray(), t);
        if (residents.Count != c.Residents.Count || residents.Any(r => r.VerificationStatus != IdentityVerificationStatus.Verified) ||
            !c.Residents.Any(r => r.ResidentId == c.RepresentativeResidentId && r.Role == ResidentType.Representative)) blockers.Add("verified_residents_required");
        if (!await repository.ActiveUserInRoleAsync(c.OwnerSignerId, Roles.Owner, t) || !await repository.ActiveUserInRoleAsync(c.TenantUserId, Roles.Tenant, t)) blockers.Add("invalid_contract_signers");
        var root = c;
        while (root.PreviousContractId is { } previous) root = await repository.FindAsync(previous, t) ?? throw ContractException.Missing();
        var deposit = root.AppliedHoldingDeposit + await repository.DepositTotalAsync(root.Id, t);
        if (deposit < c.RequiredDeposit) blockers.Add("security_deposit_insufficient");
        if (await repository.ConflictsAsync(c.RoomId, c.PreviousContractId ?? c.Id, c.StartDate, c.EndDate, t)) blockers.Add("room_contract_conflict");
        return new(blockers.Count == 0, deposit, Math.Max(0, c.RequiredDeposit - deposit), blockers.Distinct().ToArray());
    }
    public async Task<ActivationReadiness> ReadinessAsync(Guid id, CancellationToken t) => await Readiness(await Load(id, [Roles.Owner, Roles.Tenant], t), t);
    public Task<ContractView> ActivateAsync(Guid id, Guid key, CancellationToken t) => Mutate(id, [Roles.Owner], async c =>
    {
        if (await Replay(key, "activate", id, t) is not null) return View(c);
        if (!(await Readiness(c, t)).Ready) throw ContractException.Conflict("contract_not_ready_for_activation");
        // Verify stored evidence still exists and matches the exact bytes accepted from the PDF verifier.
        foreach (var s in c.Signatures.Where(s => s.Status == SignatureStatus.Signed))
        {
            using var bytes = new MemoryStream(); await storage.CopyToAsync(s.SignedObjectKey!, bytes, t);
            if (FileHash(bytes.ToArray()) != s.SignedHash) throw ContractException.Conflict("signing_evidence_integrity_failed");
        }
        if (c.PreviousContractId is { } previous)
        {
            var parent = await repository.FindAsync(previous, t) ?? throw ContractException.Missing();
            if (parent.Status != ContractStatus.Active || await repository.MoveOutAsync(previous, t) is not null) throw ContractException.Conflict("renewal_parent_not_active");
            parent.Status = ContractStatus.Superseded;
            foreach (var r in parent.Residents) r.ResidenceTo = parent.EndDate;
            // Release the filtered active-room index before updating the new version, within this same transaction.
            await repository.FlushAsync(t);
        }
        c.Status = ContractStatus.Active; c.ActivatedByUserId = Actor; c.ActivatedAt = clock.GetUtcNow(); c.Room.Status = RoomStatus.Occupied;
        Audit("ContractActivated", id); Remember(key, "activate", id, id); return View(c);
    }, t);

    // Persist prepared work before making the ambiguous external mutation. Never automatically resend Dispatching.
    public async Task<SignatureView> RequestSigningAsync(Guid id, SigningInput x, Guid key, CancellationToken t)
    {
        if (x.CertificateId == Guid.Empty) throw ContractException.Invalid("certificate_required");
        await Mutate(id, [Roles.Owner, Roles.Tenant], async c =>
        {
            if (Actor != c.OwnerSignerId && Actor != c.TenantUserId) throw new ContractException(403, "contract_signer_required");
            if (await Replay(key, "sign", new { id, x }, t) is not null) return true;
            if (c.Status is not (ContractStatus.Draft or ContractStatus.PendingSigning) || !Intact(c)) throw ContractException.Conflict("contract_not_signable");
            if (c.Status == ContractStatus.Draft) { c.Status = ContractStatus.PendingSigning; Audit("ContractSigningInitiated", id); }
            return true;
        }, t);
        var signatureId = await Mutate(id, [Roles.Owner, Roles.Tenant], async c =>
        {
            if (Actor != c.OwnerSignerId && Actor != c.TenantUserId) throw new ContractException(403, "contract_signer_required");
            if (await Replay(key, "sign", new { id, x }, t) is { } prior) return prior;
            if (c.Status is not (ContractStatus.Draft or ContractStatus.PendingSigning) || !Intact(c)) throw ContractException.Conflict("contract_not_signable");
            if (c.Signatures.Any(s => s.SignerUserId == Actor && s.Status != SignatureStatus.Failed)) throw ContractException.Conflict("signer_already_requested");
            if (c.Signatures.Any(s => s.Status is not (SignatureStatus.Signed or SignatureStatus.Failed))) throw ContractException.Conflict("previous_signature_pending");
            byte[]? previous = null;
            var last = c.Signatures.Where(s => s.Status == SignatureStatus.Signed).OrderBy(s => s.SignedAt).LastOrDefault();
            if (last is not null)
            {
                using var stream = new MemoryStream(); await storage.CopyToAsync(last.SignedObjectKey!, stream, t); previous = stream.ToArray();
                if (FileHash(previous) != last.SignedHash) throw ContractException.Conflict("signing_evidence_integrity_failed");
            }
            var prepared = await signing.PrepareAsync(Document(c), x.CertificateId, previous, t);
            var s = new ContractSignature { ContractId = id, SignerUserId = Actor, CertificateId = x.CertificateId,
                SnapshotHash = c.SnapshotHash, SourceHash = FileHash(prepared.SourcePdf), FieldName = prepared.FieldName,
                PreparedHash = FileHash(prepared.PreparedPdf),
                DocumentDigest = prepared.DocumentDigest, DataToSignDigest = prepared.DataToSignDigest,
                CertificateChain = prepared.CertificateChain, ProviderUserId = prepared.ProviderUserId, CredentialId = prepared.CredentialId,
                ExpiresAt = clock.GetUtcNow().AddMinutes(5) };
            s.PreparedObjectKey = $"contracts/{id:N}/signatures/{s.Id:N}/prepared.pdf";
            await files.PutAsync(c.RoomId, s.PreparedObjectKey, prepared.PreparedPdf, "application/pdf", t);
            repository.Add(s); c.Status = ContractStatus.PendingSigning; Audit("ContractSigningPrepared", id);
            Remember(key, "sign", new { id, x }, s.Id); return s.Id;
        }, t);
        var dispatch = await Mutate(id, [Roles.Owner, Roles.Tenant], c =>
        {
            var s = c.Signatures.Single(s => s.Id == signatureId);
            if (s.Status != SignatureStatus.Prepared) return Task.FromResult(false);
            s.Status = SignatureStatus.Dispatching; Audit("ContractSigningDispatching", id); return Task.FromResult(true);
        }, t);
        if (dispatch)
        {
            var c = await Load(id, [Roles.Owner, Roles.Tenant], t); var s = c.Signatures.Single(s => s.Id == signatureId);
            string reference;
            try { reference = await signing.RequestAsync(s, t); }
            catch (Exception e) when (e is IntegrationUnavailableException or HttpRequestException or OperationCanceledException)
            {
                await Mutate(id, [Roles.Owner, Roles.Tenant], current =>
                {
                    current.Signatures.Single(a => a.Id == signatureId).Status = SignatureStatus.ManualReview;
                    Audit("ContractSigningNeedsReview", id); return Task.FromResult(true);
                }, CancellationToken.None);
                throw new IntegrationUnavailableException("contract signing; check pending provider request before retry");
            }
            await Mutate(id, [Roles.Owner, Roles.Tenant], current =>
            {
                var attempt = current.Signatures.Single(a => a.Id == signatureId); attempt.ProviderReference = reference; attempt.Status = SignatureStatus.Pending;
                Audit("ContractSigningRequested", id); return Task.FromResult(true);
            }, t);
        }
        var updated = await Load(id, [Roles.Owner, Roles.Tenant], t);
        var result = updated.Signatures.Single(s => s.Id == signatureId);
        return new(result.Id, result.SignerUserId, result.Status.ToString(), result.SignedAt);
    }

    public Task<ContractView> SyncSigningAsync(Guid id, CancellationToken t) => Mutate(id, [Roles.Owner, Roles.Tenant], async c =>
    {
        if (Actor != c.OwnerSignerId && Actor != c.TenantUserId) throw new ContractException(403, "contract_signer_required");
        if (c.Status is ContractStatus.Cancelled or ContractStatus.Terminated or ContractStatus.Superseded) return View(c);
        var s = c.Signatures.Where(s => s.SignerUserId == Actor).OrderBy(s => s.CreatedAt).ThenBy(s => s.Id).LastOrDefault() ?? throw ContractException.Missing();
        if (s.Status != SignatureStatus.Pending) return View(c);
        if (!Intact(c) || s.SnapshotHash != c.SnapshotHash) throw ContractException.Conflict("signed_terms_changed");
        using var prepared = new MemoryStream(); await storage.CopyToAsync(s.PreparedObjectKey, prepared, t);
        if (FileHash(prepared.ToArray()) != s.PreparedHash) throw ContractException.Conflict("prepared_document_integrity_failed");
        var answer = await signing.PollAsync(s, prepared.ToArray(), t);
        if (answer.State == "Signed" && answer.SignedPdf is { Length: > 0 } pdf)
        {
            s.SignedObjectKey = $"contracts/{id:N}/signatures/{s.Id:N}/signed.pdf";
            await files.PutAsync(c.RoomId, s.SignedObjectKey, pdf, "application/pdf", t);
            s.SignedHash = FileHash(pdf); s.Status = SignatureStatus.Signed; s.SignedAt = clock.GetUtcNow();
            if (new[] { c.OwnerSignerId, c.TenantUserId }.All(signer => c.Signatures.Any(a => a.SignerUserId == signer && a.Status == SignatureStatus.Signed))) c.Status = ContractStatus.PendingActivation;
            Audit("ContractSignatureVerified", id);
        }
        else if (answer.State == "Failed") { s.Status = SignatureStatus.Failed; Audit("ContractSigningFailed", id); }
        return View(c);
    }, t);
    public Task<ContractView> RecoverSigningAsync(Guid id, SigningRecoveryInput x, Guid key, CancellationToken t)
    {
        Validate(x);
        return Mutate(id, [Roles.Owner, Roles.Tenant], async c =>
        {
            if (Actor != c.OwnerSignerId && Actor != c.TenantUserId) throw new ContractException(403, "contract_signer_required");
            if (await Replay(key, "sign-recover", new { id, x }, t) is not null) return View(c);
            var s = c.Signatures.SingleOrDefault(s => s.SignerUserId == Actor && s.Status != SignatureStatus.Failed) ?? throw ContractException.Missing();
            if (s.Status is not (SignatureStatus.Dispatching or SignatureStatus.ManualReview)) throw ContractException.Conflict("signing_not_ambiguous");
            // Linking a reference never means signed: sync must still verify its signature against the persisted PDF.
            s.ProviderReference = x.ProviderReference.Trim(); s.Status = SignatureStatus.Pending;
            Audit("ContractSigningReferenceRecovered", id); Remember(key, "sign-recover", new { id, x }, s.Id); return View(c);
        }, t);
    }
    public async Task CopyDocumentAsync(Guid id, Stream output, CancellationToken t)
    {
        var c = await Load(id, [Roles.Owner, Roles.Tenant], t);
        var s = c.Signatures.Where(s => s.Status == SignatureStatus.Signed).OrderBy(s => s.SignedAt).LastOrDefault() ?? throw ContractException.Conflict("signed_document_not_available");
        await storage.CopyToAsync(s.SignedObjectKey!, output, t);
    }

    public Task<MoveOutView> RequestTerminationAsync(Guid id, TerminationInput x, Guid key, bool expiry, CancellationToken t)
    {
        Validate(x);
        return Mutate(id, expiry ? [Roles.Owner] : [Roles.Tenant], async c =>
        {
            if (await Replay(key, expiry ? "expiry" : "terminate-request", new { id, x }, t) is not null) return View((await repository.MoveOutAsync(id, t))!);
            if (c.Status != ContractStatus.Active || await repository.OpenRenewalAsync(id, t)) throw ContractException.Conflict("contract_not_terminable");
            if (x.ProposedDate < Today || x.ProposedDate < c.StartDate || (!expiry && x.ProposedDate >= c.EndDate) || (expiry && x.ProposedDate < c.EndDate))
                throw ContractException.Invalid("invalid_move_out_date");
            if (await repository.MoveOutAsync(id, t) is not null) throw ContractException.Conflict("move_out_already_requested");
            var m = new ContractMoveOut { ContractId = id, ProposedDate = x.ProposedDate, Reason = x.Reason.Trim(),
                RequestedByUserId = Actor, IsExpiry = expiry, Status = MoveOutStatus.Requested };
            repository.Add(m); Audit("ContractMoveOutRequested", id); Remember(key, expiry ? "expiry" : "terminate-request", new { id, x }, m.Id); return View(m);
        }, t);
    }
    public async Task<MoveOutView> GetMoveOutAsync(Guid id, CancellationToken t)
    {
        await Load(id, [Roles.Owner, Roles.Staff, Roles.Tenant], t);
        var view = View(await repository.MoveOutAsync(id, t) ?? throw ContractException.Missing());
        return view with { EvidenceIds = (await repository.InspectionEvidenceAsync(id, t)).Where(e => e.IsLinked || e.UploadedByUserId == Actor).Select(e => e.Id).ToArray() };
    }
    public Task<MoveOutView> ApproveTerminationAsync(Guid id, Guid key, CancellationToken t) => Mutate(id, [Roles.Owner], async c =>
    {
        var m = await repository.MoveOutAsync(id, t) ?? throw ContractException.Missing();
        if (await Replay(key, "terminate-approve", id, t) is not null) return View(m);
        if (c.Status != ContractStatus.Active || m.Status != MoveOutStatus.Requested) throw ContractException.Conflict("move_out_not_pending_approval");
        m.Status = MoveOutStatus.Approved; m.ApprovedByUserId = Actor; m.ApprovedAt = clock.GetUtcNow();
        Audit("ContractMoveOutApproved", id); Remember(key, "terminate-approve", id, m.Id); return View(m);
    }, t);
    public Task<MoveOutView> ScheduleInspectionAsync(Guid id, InspectionScheduleInput x, Guid key, CancellationToken t) => Mutate(id, [Roles.Owner, Roles.Staff], async c =>
    {
        var m = await repository.MoveOutAsync(id, t) ?? throw ContractException.Missing();
        if (await Replay(key, "inspection-schedule", new { id, x }, t) is not null) return View(m);
        if (m.Status != MoveOutStatus.Approved || x.ScheduledAt < clock.GetUtcNow() || x.ScheduledAt.Offset != TimeSpan.Zero) throw ContractException.Invalid("invalid_inspection_schedule");
        m.InspectionScheduledAt = x.ScheduledAt; Audit("ContractInspectionScheduled", id); Remember(key, "inspection-schedule", new { id, x }, m.Id); return View(m);
    }, t);
    public Task<MoveOutView> InspectAsync(Guid id, InspectionInput x, Guid key, CancellationToken t)
    {
        Validate(x);
        return Mutate(id, [Roles.Staff], async c =>
        {
            var m = await repository.MoveOutAsync(id, t) ?? throw ContractException.Missing();
            if (await Replay(key, "inspection", new { id, x }, t) is not null) return View(m);
            if (m.Status != MoveOutStatus.Approved || m.InspectionScheduledAt is null || Today < m.ProposedDate)
                throw ContractException.Conflict("move_out_not_ready_for_inspection");
            if (!await repository.ValidFinalReadingAsync(x.ElectricityReadingId, c.Id, c.RoomId, UtilityType.Electricity, Today, t) ||
                !await repository.ValidFinalReadingAsync(x.WaterReadingId, c.Id, c.RoomId, UtilityType.Water, Today, t))
                throw ContractException.Conflict("confirmed_final_readings_required");
            if (x.EvidenceIds.Distinct().Count() != x.EvidenceIds.Length) throw ContractException.Invalid("duplicate_inspection_evidence");
            var evidence = (await repository.InspectionEvidenceAsync(id, t)).Where(e => x.EvidenceIds.Contains(e.Id)).ToArray();
            if (evidence.Length != x.EvidenceIds.Length || evidence.Any(e => e.IsLinked || e.UploadedByUserId != Actor)) throw ContractException.Conflict("inspection_evidence_not_available");
            foreach (var e in evidence) { await storage.CopyToAsync(e.ObjectKey, Stream.Null, t); e.IsLinked = true; }
            m.ElectricityReadingId = x.ElectricityReadingId; m.WaterReadingId = x.WaterReadingId; m.InspectionNotes = x.Notes.Trim();
            m.InspectedByUserId = Actor; m.InspectedAt = clock.GetUtcNow(); m.Status = MoveOutStatus.Inspected;
            m.PendingReason = "financial_ledger_and_deposit_policy"; Audit("ContractMoveOutInspected", id);
            Remember(key, "inspection", new { id, x }, m.Id); return View(m);
        }, t);
    }
    public Task<MoveOutView> SettleAsync(Guid id, SettlementInput x, Guid key, CancellationToken t)
    {
        Validate(x);
        return Mutate(id, [Roles.Owner], async c =>
        {
            var m = await repository.MoveOutAsync(id, t) ?? throw ContractException.Missing();
            if (await Replay(key, "settlement", new { id, x }, t) is not null) return View(m);
            if (m.Status is not (MoveOutStatus.Inspected or MoveOutStatus.PendingSettlement or MoveOutStatus.Settled) || c.Status != ContractStatus.Active) throw ContractException.Conflict("inspection_required");
            m.SettlementDecision = x.Decision.Trim(); m.Status = MoveOutStatus.PendingSettlement;
            m.SettlementApprovedByUserId = null; m.SettlementApprovedAt = null; m.SettlementLedgerReference = null;
            var result = await ledger.ReadAsync(id, m.ElectricityReadingId!.Value, m.WaterReadingId!.Value, t);
            if (result is { AllObligationsResolved: true, DepositResolved: true, TransfersVerified: true } && !string.IsNullOrWhiteSpace(result.DecisionReference))
            {
                m.Status = MoveOutStatus.Settled; m.SettlementApprovedByUserId = Actor; m.SettlementApprovedAt = clock.GetUtcNow(); m.PendingReason = "";
                m.SettlementLedgerReference = result.DecisionReference;
            }
            else m.PendingReason = "financial_ledger_and_deposit_policy";
            repository.Add(new ContractSettlementReview { ContractId = id, Decision = m.SettlementDecision, LedgerReference = m.SettlementLedgerReference,
                Settled = m.Status == MoveOutStatus.Settled, ReviewedByUserId = Actor, ReviewedAt = clock.GetUtcNow() });
            Audit("ContractSettlementReviewed", id); Remember(key, "settlement", new { id, x }, m.Id); return View(m);
        }, t);
    }
    public async Task<IReadOnlyList<SettlementReviewView>> SettlementHistoryAsync(Guid id, CancellationToken t)
    {
        await Load(id, [Roles.Owner, Roles.Tenant], t);
        return (await repository.SettlementReviewsAsync(id, t)).Select(r => new SettlementReviewView(r.Id, r.Decision, r.Settled, r.ReviewedByUserId, r.ReviewedAt)).ToArray();
    }
    public Task<ContractView> CompleteAsync(Guid id, CompletionInput x, Guid key, CancellationToken t) => Mutate(id, [Roles.Owner], async c =>
    {
        if (await Replay(key, "complete", new { id, x }, t) is not null) return View(c);
        var m = await repository.MoveOutAsync(id, t) ?? throw ContractException.Missing();
        if (c.Status != ContractStatus.Active || m.Status != MoveOutStatus.Settled || m.InspectedAt is null ||
            x.ActualEndDate < m.ProposedDate || x.ActualEndDate != DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(m.InspectedAt.Value, "Asia/Ho_Chi_Minh").DateTime) || x.ActualEndDate > Today)
            throw ContractException.Conflict("move_out_not_settled");
        var final = await ledger.ReadAsync(id, m.ElectricityReadingId!.Value, m.WaterReadingId!.Value, t);
        if (final is not { AllObligationsResolved: true, DepositResolved: true, TransfersVerified: true } || string.IsNullOrWhiteSpace(final.DecisionReference) || final.DecisionReference != m.SettlementLedgerReference)
            throw ContractException.Conflict("settlement_unresolved");
        c.Status = ContractStatus.Terminated; c.ActualEndDate = x.ActualEndDate; c.Room.Status = RoomStatus.Available; m.Status = MoveOutStatus.Completed;
        foreach (var r in c.Residents) r.ResidenceTo = x.ActualEndDate;
        Audit("ContractTerminationCompleted", id); Remember(key, "complete", new { id, x }, id); return View(c);
    }, t);

    public async Task<ContractId> UploadInspectionEvidenceAsync(Guid id, Stream input, CancellationToken t)
    {
        Role(Roles.Staff); await Load(id, [Roles.Staff], t);
        using var buffer = new MemoryStream();
        var block = new byte[81920];
        while (true)
        {
            var read = await input.ReadAsync(block, t); if (read == 0) break;
            if (buffer.Length + read > 5 * 1024 * 1024) throw new ContractException(413, "inspection_image_too_large");
            await buffer.WriteAsync(block.AsMemory(0, read), t);
        }
        var bytes = buffer.ToArray(); var type = images.Validate(bytes);
        return await Mutate(id, [Roles.Staff], async c =>
        {
            var m = await repository.MoveOutAsync(id, t) ?? throw ContractException.Missing();
            if (m.Status != MoveOutStatus.Approved || (await repository.InspectionEvidenceAsync(id, t)).Count >= 5)
                throw ContractException.Conflict("inspection_upload_not_allowed");
            var e = new ContractInspectionEvidence { ContractId = id, UploadedByUserId = Actor, ContentType = type };
            e.ObjectKey = $"contracts/{id:N}/inspection/{e.Id:N}";
            await files.PutAsync(c.RoomId, e.ObjectKey, bytes, type, t); repository.Add(e); Audit("ContractInspectionEvidenceAdded", id); return new ContractId(e.Id);
        }, t);
    }
    public async Task CopyInspectionEvidenceAsync(Guid id, Guid evidenceId, Stream output, CancellationToken t)
    {
        await Load(id, [Roles.Owner, Roles.Staff, Roles.Tenant], t);
        var evidence = (await repository.InspectionEvidenceAsync(id, t)).SingleOrDefault(e => e.Id == evidenceId &&
            (e.IsLinked || e.UploadedByUserId == Actor)) ?? throw ContractException.Missing();
        await storage.CopyToAsync(evidence.ObjectKey, output, t);
    }
}
