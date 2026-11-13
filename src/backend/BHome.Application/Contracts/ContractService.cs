using System.ComponentModel.DataAnnotations;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json;
using BHome.Application.Common;
using BHome.Application.IdentityAccess;
using BHome.Application.Storage;
using BHome.Application.PropertyManagement;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;

namespace BHome.Application.Contracts;

public sealed partial class ContractService(IContractRepository repository, ICurrentUser user, ResourceAccess access,
    IContractSigningProvider signing, IObjectStorage storage, IContractFileStore files, IContractImageValidator images,
    IContractSettlementLedger ledger, IContractHoldingLedger holdings, TimeProvider clock,
    IContractDocumentRenderer? renderer = null, IContractWorkflowRepository? workflowRepository = null, IContractWorkflowMode? workflowMode = null,
    IContractHandoverRepository? handoverRepository = null, IContractSigningPages? signingPages = null,
    IContractSigningDocumentSource? signingDocuments = null, IPropertyLifecycleChecks? lifecycle = null,
    IOperatingPolicyWorkflow? operatingPolicies = null, IPostActivationTenantProvisioning? provisioning = null,
    IContractDepositPosition? depositPositions = null) : IAdministrativeContractReadiness
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
    private void ChangeRoomStatus(Contract contract, RoomStatus requested, RoomTransitionSource source, bool otherActive = false)
    {
        var room = contract.Room;
        if (!PropertyRules.CanChangeRoomStatus(room.Status, requested, source, hasOtherActiveContracts: otherActive))
            throw ContractException.Conflict("room_status_controlled");
        if (room.Status == requested) return;
        var before = JsonSerializer.Serialize(new { room.Status, room.Version, ContractId = contract.Id });
        room.Status = requested;
        room.Version++;
        repository.Add(new PropertyChange
        {
            ActorId = Actor,
            LocationId = room.LocationId,
            TargetId = room.Id,
            TargetType = nameof(Room),
            Action = source.ToString(),
            Reason = source.ToString(),
            Before = before,
            After = JsonSerializer.Serialize(new { room.Status, room.Version, ContractId = contract.Id }),
            OccurredAt = clock.GetUtcNow()
        });
    }
    private async Task<T> Mutate<T>(Guid id, string[] roles, Func<Contract, Task<T>> work, CancellationToken t)
    {
        var before = await Load(id, roles, t);
        return await repository.InTransactionAsync(before.RoomId, async () => await work(await Load(id, roles, t)), t);
    }
    private static Guid RequireTenant(Contract c) => c.TenantUserId ?? throw ContractException.Conflict("tenant_account_required_for_lifecycle");
    internal static ContractDocument Document(Contract c) => new(c.Id, c.RoomId, c.OwnerSignerId, c.SigningMode == ContractSigningModes.Internal ? Guid.Empty : RequireTenant(c),
        c.RepresentativeResidentId, c.Residents.Select(x => x.ResidentId).Order().ToArray(), c.StartDate, c.EndDate,
        c.MonthlyRent, c.RequiredDeposit, c.HoldingContractId, c.AppliedHoldingDeposit, c.Terms, c.SnapshotHash)
    { IsOperatingPolicyAmendment = c.Kind == ContractKind.Addendum, IsInternalResidentAcceptance = c.SigningMode == ContractSigningModes.Internal,
        AgreedCharges = ContractChargeSnapshot.DocumentCharges(c) };
    private static void Seal(Contract c)
    {
        // Native VND columns have scale 0; hash the exact values that survive a database round-trip.
        c.MonthlyRent = decimal.Truncate(c.MonthlyRent); c.RequiredDeposit = decimal.Truncate(c.RequiredDeposit);
        c.AppliedHoldingDeposit = decimal.Truncate(c.AppliedHoldingDeposit);
        c.SnapshotHash = ContractDocumentSnapshot.Hash(Document(c));
    }
    private static bool Intact(Contract c) => ContractChargeSnapshot.IsIntact(c);
    private static ContractView View(Contract c) => new(c.Id, c.RoomId, c.Kind.ToString(), c.Status.ToString(), c.StartDate,
        c.EndDate, c.MonthlyRent, c.RequiredDeposit, c.Terms, c.PreviousContractId,
        c.Residents.Select(r => r.ResidentId).ToArray(), c.Signatures.Select(s => new SignatureView(s.Id, s.SignerUserId, s.Status.ToString(), s.SignedAt)).ToArray(), c.ActivatedAt,
        c.OwnerSignerId, c.TenantUserId, c.RepresentativeResidentId, c.HoldingContractId, c.AppliedHoldingDeposit, c.Room.LocationId, c.IsDevelopmentDemo, c.Room.RoomNumber, c.Room.Location?.Name ?? "", ActualEndDate: c.ActualEndDate, OnboardingDraft: c.DraftMetadata != "{}" && c.Status == ContractStatus.Draft,
        HoldingExpiresAt: c.HoldingExpiryAt, ReservedCapacity: c.ReservedCapacity, ApprovedAt: c.ApprovedAt,
        PriceLockedAt: c.PriceLockedAt, PriceLockTrigger: c.PriceLockTrigger, ConvertedMainContractId: c.ConvertedMainContractId,
        SigningMode: c.SigningMode, SnapshotHash: c.SnapshotHash, AgreedCharges: ContractChargeSnapshot.ViewCharges(c));
    private static MoveOutView View(ContractMoveOut m) => new(m.Id, m.Status.ToString(), m.ProposedDate, m.Reason, m.InspectionScheduledAt, m.PendingReason,
        m.InspectionNotes, m.InspectedAt, m.ElectricityReadingId, m.WaterReadingId, [], m.InspectionStaffId, m.Version,
        FinancialReviewStatus: m.SettlementApprovedAt is null ? "PendingReview" : "OwnerReviewed");
    public async Task<ContractView> GetAsync(Guid id, CancellationToken t)
    {
        var c = await Load(id, [Roles.Owner, Roles.Staff, Roles.Tenant], t);
        return View(c) with { Occupants = await repository.OccupantsAsync(c.Id, t) };
    }

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
        if (x.HoldingContractId is { } sourceId)
        {
            var source = await Load(sourceId, [Roles.Owner, Roles.Staff], t);
            if (source.RoomId != x.RoomId || source.OwnerSignerId != x.OwnerSignerId || source.TenantUserId != x.TenantUserId ||
                source.RepresentativeResidentId != x.RepresentativeResidentId || source.MonthlyRent != x.MonthlyRent ||
                source.StartDate != x.StartDate || source.EndDate != x.EndDate || source.Terms != x.Terms.Trim() ||
                !source.Residents.Select(r => r.ResidentId).Order().SequenceEqual(x.ResidentIds.Order()))
                throw ContractException.Conflict("holding_conversion_terms_mismatch");
            return await ConvertHoldingAsync(sourceId, new(x.RequiredDeposit), key, t);
        }
        return await repository.InTransactionAsync(x.RoomId, async () =>
        {
            await ScopeRoom(x.RoomId, t);
            if (await Replay(key, "draft", x, t) is { } prior) return new ContractId(prior);
            if ((await repository.RoomAsync(x.RoomId, t))!.Status is not (RoomStatus.Available or RoomStatus.Occupied)) throw ContractException.Conflict("room_not_available");
            if (!await repository.ActiveUserInRoleAsync(x.OwnerSignerId, Roles.Owner, t) ||
                x.TenantUserId is { } tenant && !await repository.ActiveUserInRoleAsync(tenant, Roles.Tenant, t)) throw ContractException.Invalid("invalid_contract_signers");
            var residents = await repository.ResidentsAsync(x.RoomId, x.ResidentIds, t);
            if (residents.Count != x.ResidentIds.Length || residents.Any(r => r.VerificationStatus != IdentityVerificationStatus.Verified))
                throw ContractException.Invalid("verified_residents_required");
            if (residents.Any(r => r.Id != x.RepresentativeResidentId && r.ResidentType != ResidentType.CoOccupant))
                throw ContractException.Invalid("individual_representatives_require_separate_contracts");
            if (residents.Single(r => r.Id == x.RepresentativeResidentId).TenantUserId is { } linkedTenant && linkedTenant != x.TenantUserId)
                throw ContractException.Invalid("tenant_account_mismatch");
            if (await repository.ConflictsAsync(x.RoomId, Guid.Empty, x.StartDate, x.EndDate, x.ResidentIds, t)) throw ContractException.Conflict("room_contract_conflict");
            var c = new Contract
            {
                RoomId = x.RoomId,
                OwnerSignerId = x.OwnerSignerId,
                TenantUserId = x.TenantUserId,
                SigningMode = x.TenantUserId is null ? ContractSigningModes.Internal : "",
                RepresentativeResidentId = x.RepresentativeResidentId,
                StartDate = x.StartDate,
                EndDate = x.EndDate,
                MonthlyRent = x.MonthlyRent,
                RequiredDeposit = x.RequiredDeposit,
                IsDevelopmentDemo = DemoEnabled,
                Terms = x.Terms.Trim()
            };
            c.Residents = residents.Select(r => new ContractResident
            {
                ContractId = c.Id,
                ResidentId = r.Id,
                Role = r.Id == x.RepresentativeResidentId ? ResidentType.Representative : ResidentType.CoOccupant,
                ResidenceFrom = c.StartDate
            }).ToList();
            await ContractChargeSnapshot.RejectUtilityProfileAsync(repository, c, t);
            ContractChargeSnapshot.Store(c, ContractChargeSnapshot.FromPolicies(c,
                (await repository.ResolvePricesAsync(c.RoomId, c.StartDate, t)).Charges), "ContractDraft", clock.GetUtcNow());
            if (operatingPolicies is not null) await operatingPolicies.BindDraftAsync(c, t);
            Seal(c); repository.Add(c); Audit("ContractDraftCreated", c.Id); Remember(key, "draft", x, c.Id); return new ContractId(c.Id);
        }, t);
    }

    public Task<ContractId> RenewAsync(Guid id, RenewalInput x, Guid key, CancellationToken t)
    {
        Validate(x); Money(x.MonthlyRent, false);
        return Mutate(id, [Roles.Owner, Roles.Staff], async c =>
        {
            if (await Replay(key, "renewal", new { id, x }, t) is { } prior) return new ContractId(prior);
            if (c.Status != ContractStatus.Active || c.EndDate.Year >= 9999 || x.EndDate <= c.EndDate || await repository.MoveOutAsync(c.Id, t) is not null)
                throw ContractException.Conflict("contract_not_renewable");
            if (await repository.OpenRenewalAsync(c.Id, t)) throw ContractException.Conflict("renewal_already_pending");
            var next = new Contract
            {
                RoomId = c.RoomId,
                OwnerSignerId = c.OwnerSignerId,
                TenantUserId = c.TenantUserId,
                SigningMode = c.SigningMode,
                RepresentativeResidentId = c.RepresentativeResidentId,
                Kind = ContractKind.Renewal,
                IsDevelopmentDemo = c.IsDevelopmentDemo,
                PreviousContractId = c.Id,
                StartDate = c.EndDate.AddDays(1),
                EndDate = x.EndDate,
                MonthlyRent = x.MonthlyRent,
                RequiredDeposit = c.RequiredDeposit,
                Terms = x.Terms.Trim()
            };
            next.Residents = c.Residents.Select(r => new ContractResident { ContractId = next.Id, ResidentId = r.ResidentId, Role = r.Role, ResidenceFrom = next.StartDate }).ToList();
            await ContractChargeSnapshot.RejectUtilityProfileAsync(repository, next, t);
            ContractChargeSnapshot.Store(next, ContractChargeSnapshot.FromPolicies(next,
                (await repository.ResolvePricesAsync(next.RoomId, next.StartDate, t)).Charges), "ContractRenewalDraft", clock.GetUtcNow());
            if (operatingPolicies is not null) await operatingPolicies.BindDraftAsync(next, t);
            Seal(next); repository.Add(next); Audit("ContractRenewalPrepared", next.Id); Remember(key, "renewal", new { id, x }, next.Id); return new ContractId(next.Id);
        }, t);
    }

    public Task<ContractId> VerifyDepositAsync(Guid id, DepositInput x, Guid key, CancellationToken t)
    {
        Validate(x); Money(x.Amount, false);
        return Mutate(id, [Roles.Owner], async c =>
        {
            if (await Replay(key, "deposit", new { id, x }, t) is { } prior) return new ContractId(prior);
            if (c.PreviousContractId is not null || c.Kind is not (ContractKind.Main or ContractKind.Holding) ||
                c.Status is ContractStatus.Terminated or ContractStatus.Superseded or ContractStatus.Converted or ContractStatus.Cancelled or ContractStatus.Expired or ContractStatus.Applied)
                throw ContractException.Conflict("deposit_not_payable");
            if (c.Kind == ContractKind.Holding && (c.ApprovedAt is null || c.Status is ContractStatus.Expired or ContractStatus.Cancelled || c.HoldingExpiryAt <= clock.GetUtcNow()))
                throw ContractException.Conflict("holding_deposit_requires_manual_review");
            var reference = x.BankTransactionReference.Trim();
            var existing = await repository.BankReferenceAsync(reference, t);
            if (existing is not null)
            {
                if (existing.ContractId != id || existing.Amount != x.Amount) throw ContractException.Conflict("bank_transaction_already_allocated");
                Remember(key, "deposit", new { id, x }, existing.Id); return new ContractId(existing.Id);
            }
            var already = await repository.DepositTotalAsync(c.Id, t);
            if (x.Amount > c.RequiredDeposit - c.AppliedHoldingDeposit - already)
                throw ContractException.Conflict(c.Kind == ContractKind.Holding ? "holding_deposit_excess_requires_manual_review" : "main_deposit_excess_requires_manual_review");
            var entry = new DepositVerification
            {
                ContractId = id,
                Amount = x.Amount,
                BankTransactionReference = reference,
                VerificationReason = x.VerificationReason.Trim(),
                VerifiedByUserId = Actor,
                VerifiedAt = clock.GetUtcNow()
            };
            if (c.Kind == ContractKind.Holding)
            {
                if (await repository.HoldingConflictAsync(c.RoomId, c.Id, c.StartDate, c.EndDate, t)) throw ContractException.Conflict("room_contract_conflict");
                await LockHoldingPriceAsync(c, "VerifiedDeposit", entry.VerifiedAt, t, entry.Amount);
            }
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
        if (c.Kind == ContractKind.Addendum)
        {
            var parent = c.ParentContractId is { } amendmentParent ? await repository.FindAsync(amendmentParent, t) : null;
            if (parent is null || parent.Status != ContractStatus.Active || parent.RoomId != c.RoomId || parent.TenantUserId != c.TenantUserId || parent.OwnerSignerId != c.OwnerSignerId)
                blockers.Add("amendment_parent_not_active");
            if (c.Status != ContractStatus.PendingActivation || !Intact(c) || !HoldingSigned(c)) blockers.Add("verified_signature_evidence_required");
            if (Today < c.StartDate || Today > c.EndDate) blockers.Add("amendment_not_effective");
            return new(blockers.Count == 0, 0, 0, blockers.ToArray());
        }
        if (lifecycle is not null) blockers.AddRange(await lifecycle.RoomBlockersAsync(c.RoomId, t));
        if (c.Kind == ContractKind.Holding) blockers.Add("main_contract_required");
        if (c.IsDevelopmentDemo && !DemoEnabled) blockers.Add("development_demo_disabled");
        if (c.Status != ContractStatus.PendingActivation) blockers.Add("contract_not_pending_activation");
        if (!c.Room.Location.IsActive) blockers.Add("location_not_active");
        if (!PropertyRules.CanChangeRoomStatus(c.Room.Status, RoomStatus.Occupied, RoomTransitionSource.ContractActivation) ||
            c.Room.RoomType is { IsActive: false }) blockers.Add("room_not_available");
        if (!Intact(c)) blockers.Add("signed_terms_changed");
        try { await ContractChargeSnapshot.ValidateBindingAsync(repository, c, t, checkProfile: false); }
        catch (ContractException ex) { blockers.Add(ex.Code); }
        if (c.StartDate > Today || c.EndDate < Today) blockers.Add("contract_not_in_effective_period");
        if (c.PreviousContractId is { } parentId)
        {
            var parent = await repository.FindAsync(parentId, t);
            if (parent is null || parent.Status != ContractStatus.Active || parent.RoomId != c.RoomId || parent.TenantUserId != c.TenantUserId ||
                parent.EndDate.AddDays(1) != c.StartDate || await repository.MoveOutAsync(parentId, t) is not null) blockers.Add("renewal_parent_not_active");
        }
        if (c.HoldingContractId is { } holdingId)
        {
            var holding = await repository.FindAsync(holdingId, t);
            if (holding is null || holding.Kind != ContractKind.Holding || holding.Status != ContractStatus.Active ||
                holding.HoldingExpiryAt <= clock.GetUtcNow() || holding.RoomId != c.RoomId || holding.TenantUserId != c.TenantUserId ||
                holding.ConvertedMainContractId is not null || holding.AgreedPriceSnapshot == "{}" || holding.MonthlyRent != c.MonthlyRent ||
                holding.StartDate != c.StartDate || holding.EndDate != c.EndDate || holding.Terms != c.Terms ||
                !ContractChargeSnapshot.SameChargeTerms(holding, c))
                blockers.Add("source_holding_not_convertible");
        }
        if (c.SigningMode == ContractSigningModes.Internal)
        {
            if (!AnonymousContractSigningService.Complete(c)) blockers.Add("internal_acceptance_evidence_required");
        }
        else foreach (var signer in new[] { c.OwnerSignerId, c.TenantUserId })
                if (!c.Signatures.Any(s => s.SignerUserId == signer && CompleteSignature(s, c) && s.SignedAt is not null &&
                    s.SnapshotHash == c.SnapshotHash && !string.IsNullOrWhiteSpace(s.SignedObjectKey) && !string.IsNullOrWhiteSpace(s.ProviderReference)))
                    blockers.Add("verified_signature_evidence_required");
        var residents = await repository.ResidentsAsync(c.RoomId, c.Residents.Select(r => r.ResidentId).ToArray(), t);
        if (residents.Count != c.Residents.Count || residents.Any(r => r.VerificationStatus != IdentityVerificationStatus.Verified) ||
            !c.Residents.Any(r => r.ResidentId == c.RepresentativeResidentId && r.Role == ResidentType.Representative)) blockers.Add("verified_residents_required");
        if (!await repository.ActiveUserInRoleAsync(c.OwnerSignerId, Roles.Owner, t) ||
            c.SigningMode != ContractSigningModes.Internal && !await repository.ActiveUserInRoleAsync(RequireTenant(c), Roles.Tenant, t)) blockers.Add("invalid_contract_signers");
        if (c.SigningMode == ContractSigningModes.Internal && residents.Any(r => string.IsNullOrWhiteSpace(r.ContactEmail))) blockers.Add("resident_email_required");
        var root = c;
        while (root.PreviousContractId is { } previous) root = await repository.FindAsync(previous, t) ?? throw ContractException.Missing();
        var deposit = root.AppliedHoldingDeposit + await repository.DepositTotalAsync(root.Id, t);
        if (deposit < c.RequiredDeposit) blockers.Add("security_deposit_insufficient");
        if (await repository.ConflictsAsync(c.RoomId, c.PreviousContractId ?? c.Id, c.StartDate, c.EndDate, c.Residents.Select(r => r.ResidentId).ToArray(), t)) blockers.Add("room_contract_conflict");
        return new(blockers.Count == 0, deposit, Math.Max(0, c.RequiredDeposit - deposit), blockers.Distinct().ToArray());
    }
    public async Task<ActivationReadiness> ReadinessAsync(Guid id, CancellationToken t)
    {
        var contract = await Load(id, [Roles.Owner, Roles.Tenant], t);
        return contract.Kind == ContractKind.Holding ? await HoldingReadiness(contract, t) : await Readiness(contract, t);
    }
    public async Task<IReadOnlyList<string>> BlockersAsync(Guid contractId, Guid roomId, CancellationToken token)
    {
        var contract = await Load(contractId, [Roles.Owner, Roles.Staff], token);
        if (contract.RoomId != roomId) return ["contract_room_mismatch"];
        return (await Readiness(contract, token)).Blockers;
    }
    public Task<ContractView> ActivateAsync(Guid id, Guid key, CancellationToken t) => Mutate(id, [Roles.Owner], async c =>
    {
        if (await Replay(key, "activate", id, t) is not null) return View(c);
        if (!(await Readiness(c, t)).Ready) throw ContractException.Conflict("contract_not_ready_for_activation");
        if (c.SigningMode == ContractSigningModes.Internal)
        {
            var e = AnonymousContractSigningService.AcceptedEvidence(c)!;
            using var accepted = new MemoryStream(); await storage.CopyToAsync(e.FinalDocumentKey!, accepted, t);
            if (FileHash(accepted.ToArray()) != e.FinalDocumentHash) throw ContractException.Conflict("signing_evidence_integrity_failed");
        }
        // Verify stored evidence still exists and matches the exact bytes accepted from the PDF verifier.
        foreach (var s in c.Signatures.Where(s => CompleteSignature(s, c)))
        {
            using var bytes = new MemoryStream(); await storage.CopyToAsync(s.SignedObjectKey!, bytes, t);
            if (FileHash(bytes.ToArray()) != s.SignedHash) throw ContractException.Conflict("signing_evidence_integrity_failed");
        }
        if (c.Kind == ContractKind.Addendum)
        {
            await (operatingPolicies ?? throw ContractException.Conflict("operating_policy_workflow_unavailable")).ApplyAmendmentAsync(c, t);
            c.Status = ContractStatus.Applied; c.ActivatedAt = clock.GetUtcNow(); c.ActivatedByUserId = Actor;
            Audit("OperatingPolicyAmendmentApplied", id); Remember(key, "activate", id, id); return View(c);
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
        if (c.HoldingContractId is { } holdingId)
        {
            var holding = await repository.FindAsync(holdingId, t) ?? throw ContractException.Missing();
            if (holding.Kind != ContractKind.Holding || holding.Status != ContractStatus.Active || holding.ConvertedMainContractId is not null ||
                holding.HoldingExpiryAt <= clock.GetUtcNow()) throw ContractException.Conflict("source_holding_not_convertible");
            holding.Status = ContractStatus.Converted; holding.ConvertedMainContractId = c.Id; holding.ActualEndDate = Today;
            holding.LifecycleActorId = Actor; holding.LifecycleAt = clock.GetUtcNow(); holding.LifecycleReason = "MainContractActivated";
            Audit("HoldingConverted", holding.Id);
        }
        ChangeRoomStatus(c, RoomStatus.Occupied, RoomTransitionSource.ContractActivation);
        ContractChargeSnapshot.MarkMainBound(c, clock.GetUtcNow());
        c.Status = ContractStatus.Active; c.ActivatedByUserId = Actor; c.ActivatedAt = clock.GetUtcNow();
        if (provisioning is not null) await provisioning.ProvisionAsync(c, Actor, t);
        if (c.HoldingContractId is { } acceptedHolding && c.SigningMode == ContractSigningModes.Internal)
        {
            var linked = await repository.FindAsync(acceptedHolding, t) ?? throw ContractException.Missing();
            linked.TenantUserId = c.TenantUserId;
            Audit("HoldingAccountLinkedAfterMainActivation", linked.Id);
        }
        Audit("ContractActivated", id); Remember(key, "activate", id, id); return View(c);
    }, t);

    public Task<ContractView> CancelPolicyAmendmentAsync(Guid id, PolicyAmendmentCancellation input, Guid key, CancellationToken t) => Mutate(id, [Roles.Owner], async c =>
    {
        if (string.IsNullOrWhiteSpace(input.Reason) || input.Reason.Length > 2000) throw ContractException.Invalid("reason_required");
        if (await Replay(key, "cancel-policy-amendment", new { id, input }, t) is not null) return View(c);
        if (c.Kind != ContractKind.Addendum || c.Status is not (ContractStatus.Draft or ContractStatus.PendingSigning or ContractStatus.PendingActivation)) throw ContractException.Conflict("policy_amendment_not_cancellable");
        c.Status = ContractStatus.Cancelled; c.LifecycleActorId = Actor; c.LifecycleAt = clock.GetUtcNow(); c.LifecycleReason = input.Reason.Trim();
        Audit("OperatingPolicyAmendmentCancelled", id); Remember(key, "cancel-policy-amendment", new { id, input }, id); return View(c);
    }, t);

    // Persist prepared work before making the ambiguous external mutation. Never automatically resend Dispatching.
    public async Task<SignatureView> RequestSigningAsync(Guid id, SigningInput x, Guid key, CancellationToken t)
    {
        if (x.CertificateId == Guid.Empty && !DemoEnabled) throw ContractException.Invalid("certificate_required");
        if (x.Placement is { IsValid: false }) throw ContractException.Invalid("signature_placement_invalid");
        await Mutate(id, [Roles.Owner, Roles.Tenant], async c =>
        {
            RequireSigningMode(c);
            if (Actor != c.OwnerSignerId && Actor != c.TenantUserId) throw new ContractException(403, "contract_signer_required");
            if (await Replay(key, "sign", new { id, x }, t) is not null) return true;
            if (c.Kind == ContractKind.Holding && c.ApprovedAt is null) throw ContractException.Conflict("holding_owner_approval_required");
            if (c.Kind == ContractKind.Holding && await repository.HoldingConflictAsync(c.RoomId, c.Id, c.StartDate, c.EndDate, t)) throw ContractException.Conflict("room_contract_conflict");
            if (c.Status is not (ContractStatus.Draft or ContractStatus.PendingSigning) || !Intact(c)) throw ContractException.Conflict("contract_not_signable");
            if (c.Kind is ContractKind.Main or ContractKind.Renewal or ContractKind.Holding)
                await ContractChargeSnapshot.ValidateBindingAsync(repository, c, t,
                    checkProfile: c.Status == ContractStatus.Draft && c.Kind != ContractKind.Holding && !c.PriceLockedAt.HasValue);
            if (c.Status == ContractStatus.Draft)
            {
                if (c.Kind is ContractKind.Main or ContractKind.Renewal)
                {
                    ContractChargeSnapshot.MarkMainBound(c, clock.GetUtcNow());
                }
                c.Status = ContractStatus.PendingSigning; Audit("ContractSigningInitiated", id);
            }
            return true;
        }, t);
        var signatureId = await Mutate(id, [Roles.Owner, Roles.Tenant], async c =>
        {
            RequireSigningMode(c);
            if (Actor != c.OwnerSignerId && Actor != c.TenantUserId) throw new ContractException(403, "contract_signer_required");
            if (await Replay(key, "sign", new { id, x }, t) is { } prior) return prior;
            if (c.Kind == ContractKind.Holding && c.ApprovedAt is null) throw ContractException.Conflict("holding_owner_approval_required");
            if (c.Kind == ContractKind.Holding && await repository.HoldingConflictAsync(c.RoomId, c.Id, c.StartDate, c.EndDate, t)) throw ContractException.Conflict("room_contract_conflict");
            if (c.Status is not (ContractStatus.Draft or ContractStatus.PendingSigning) || !Intact(c)) throw ContractException.Conflict("contract_not_signable");
            if (c.Signatures.Any(s => s.SignerUserId == Actor && s.Status != SignatureStatus.Failed)) throw ContractException.Conflict("signer_already_requested");
            if (c.Signatures.Any(s => s.Status is not (SignatureStatus.Signed or SignatureStatus.Simulated or SignatureStatus.Failed))) throw ContractException.Conflict("previous_signature_pending");
            var previous = await PreviousSignedPdfAsync(c, t);
            var prepared = x.Placement is null && x.UsePicture is null or true
                ? await signing.PrepareAsync(Document(c), x.CertificateId, previous, t)
                : await signing.PrepareAsync(Document(c), x.CertificateId, previous, new SigningAppearance(x.Placement, x.UsePicture ?? true), t);
            var s = new ContractSignature
            {
                ContractId = id,
                SignerUserId = Actor,
                CertificateId = x.CertificateId,
                SnapshotHash = c.SnapshotHash,
                SourceHash = FileHash(prepared.SourcePdf),
                FieldName = prepared.FieldName,
                PreparedHash = FileHash(prepared.PreparedPdf),
                DocumentDigest = prepared.DocumentDigest,
                DataToSignDigest = prepared.DataToSignDigest,
                CertificateChain = prepared.CertificateChain,
                ProviderUserId = prepared.ProviderUserId,
                CredentialId = prepared.CredentialId,
                ExpiresAt = clock.GetUtcNow().AddMinutes(5)
            };
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
                var attempt = current.Signatures.Single(a => a.Id == signatureId); attempt.ProviderReference = reference; attempt.Status = SignatureStatus.Pending; // 349-351:Tự sinh ObjectKey (contracts/.../prepared.pdf, signed.pdf), băm SHA-256 và gọi lưu file.
                Audit("ContractSigningRequested", id); return Task.FromResult(true);
            }, t);
        }
        var updated = await Load(id, [Roles.Owner, Roles.Tenant], t);
        var result = updated.Signatures.Single(s => s.Id == signatureId);
        return new(result.Id, result.SignerUserId, result.Status.ToString(), result.SignedAt);
    }

    public Task<ContractView> SyncSigningAsync(Guid id, CancellationToken t) => Mutate(id, [Roles.Owner, Roles.Tenant], async c =>
    {
        RequireSigningMode(c);
        if (Actor != c.OwnerSignerId && Actor != c.TenantUserId) throw new ContractException(403, "contract_signer_required");
        if (c.Status is ContractStatus.Cancelled or ContractStatus.Terminated or ContractStatus.Superseded or ContractStatus.Expired or ContractStatus.Converted or ContractStatus.Applied) return View(c);
        var s = c.Signatures.Where(s => s.SignerUserId == Actor).OrderBy(s => s.CreatedAt).ThenBy(s => s.Id).LastOrDefault() ?? throw ContractException.Missing();
        if (s.Status != SignatureStatus.Pending) return View(c);
        if (!Intact(c) || s.SnapshotHash != c.SnapshotHash) throw ContractException.Conflict("signed_terms_changed");
        using var prepared = new MemoryStream(); await storage.CopyToAsync(s.PreparedObjectKey, prepared, t);
        if (FileHash(prepared.ToArray()) != s.PreparedHash) throw ContractException.Conflict("prepared_document_integrity_failed");
        var answer = await signing.PollAsync(s, prepared.ToArray(), t);
        if (answer.State is "Signed" or "Simulated" && answer.SignedPdf is { Length: > 0 } pdf)
        {
            if ((answer.State == "Simulated") != c.IsDevelopmentDemo) throw ContractException.Conflict("signing_mode_mismatch");
            s.SignedObjectKey = $"contracts/{id:N}/signatures/{s.Id:N}/signed.pdf";  // 372–377 (CopyDocumentAsync): Kiểm tra đúng quyền Owner/Tenant rồi gọi storage.CopyToAsync tải PDF từ MinIO.
            await files.PutAsync(c.RoomId, s.SignedObjectKey, pdf, "application/pdf", t);
            s.SignedHash = FileHash(pdf); s.Status = c.IsDevelopmentDemo ? SignatureStatus.Simulated : SignatureStatus.Signed; s.SignedAt = clock.GetUtcNow();
            if (new[] { c.OwnerSignerId, c.TenantUserId }.All(signer => c.Signatures.Any(a => a.SignerUserId == signer && CompleteSignature(a, c))))
            {
                c.Status = ContractStatus.PendingActivation;
                if (c.Kind == ContractKind.Holding) await LockHoldingPriceAsync(c, "SigningCompleted", s.SignedAt.Value, t);
            }
            Audit(c.IsDevelopmentDemo ? "ContractSignatureSimulated" : "ContractSignatureVerified", id);
        }
        else if (answer.State == "Failed") { s.Status = SignatureStatus.Failed; Audit("ContractSigningFailed", id); }
        return View(c);
    }, t);
    public Task<ContractView> RecoverSigningAsync(Guid id, SigningRecoveryInput x, Guid key, CancellationToken t)
    {
        Validate(x);
        return Mutate(id, [Roles.Owner, Roles.Tenant], async c =>
        {
            RequireSigningMode(c);
            if (Actor != c.OwnerSignerId && Actor != c.TenantUserId) throw new ContractException(403, "contract_signer_required");
            if (await Replay(key, "sign-recover", new { id, x }, t) is not null) return View(c);
            var s = c.Signatures.SingleOrDefault(s => s.SignerUserId == Actor && s.Status != SignatureStatus.Failed) ?? throw ContractException.Missing();
            if (s.Status is not (SignatureStatus.Dispatching or SignatureStatus.ManualReview)) throw ContractException.Conflict("signing_not_ambiguous");
            // Linking a reference never means signed: sync must still verify its signature against the persisted PDF.
            s.ProviderReference = x.ProviderReference.Trim(); s.Status = SignatureStatus.Pending;
            Audit("ContractSigningReferenceRecovered", id); Remember(key, "sign-recover", new { id, x }, s.Id); return View(c);
        }, t);
    }
    // The first signer's verified PDF, which the second signer signs incrementally; null before anyone has signed.
    private async Task<byte[]?> PreviousSignedPdfAsync(Contract c, CancellationToken t)
    {
        var last = c.Signatures.Where(s => CompleteSignature(s, c)).OrderBy(s => s.SignedAt).LastOrDefault();
        if (last is null) return null;
        using var stream = new MemoryStream(); await storage.CopyToAsync(last.SignedObjectKey!, stream, t);
        var previous = stream.ToArray();
        if (FileHash(previous) != last.SignedHash) throw ContractException.Conflict("signing_evidence_integrity_failed");
        return previous;
    }

    // Exactly the PDF the caller would sign now: the signed PDF so far, the reviewed Main Draft PDF, or the
    // contract rendered from its snapshot — the same order the signing adapters use.
    private async Task<(Contract Contract, byte[] Pdf)> SigningSourceAsync(Guid id, CancellationToken t)
    {
        var c = await Load(id, [Roles.Owner, Roles.Tenant], t);
        if (Actor != c.OwnerSignerId && Actor != c.TenantUserId) throw new ContractException(403, "contract_signer_required");
        if (c.Status is not (ContractStatus.Draft or ContractStatus.PendingSigning) || !Intact(c)) throw ContractException.Conflict("contract_not_signable");
        if (renderer is null || signingPages is null) throw new IntegrationUnavailableException("contract signing pages");
        var pdf = await PreviousSignedPdfAsync(c, t);
        if (pdf is null)
        {
            var document = Document(c);
            pdf = signingDocuments is null ? null : await signingDocuments.ReadAsync(document, t);
            if (pdf is null) { await renderer.ValidateAsync(document, t); pdf = await renderer.RenderAsync(document, t); }
        }
        return (c, pdf);
    }

    public async Task<SigningLayout> SigningLayoutAsync(Guid id, CancellationToken t)
    {
        var (c, pdf) = await SigningSourceAsync(id, t);
        var owner = Actor == c.OwnerSignerId;
        var info = signingPages!.Inspect(pdf, owner);
        var (picture, name) = await signing.SignerAsync(t);
        return new(info.Pages.Count, info.Pages, info.Suggested, owner ? "Owner" : "Tenant", picture, name);
    }

    public async Task<byte[]> SigningPageAsync(Guid id, int page, int width, CancellationToken t)
    {
        if (page is < 1 or > 500) throw ContractException.Invalid("signing_page_invalid");
        var (_, pdf) = await SigningSourceAsync(id, t);
        return signingPages!.RenderPage(pdf, page, Math.Clamp(width, 200, 1400));
    }

    public async Task CopyDocumentAsync(Guid id, Stream output, CancellationToken t)
    {
        var c = await Load(id, [Roles.Owner, Roles.Tenant], t);
        if (c.SigningMode == ContractSigningModes.Internal)
        {
            var evidence = AnonymousContractSigningService.AcceptedEvidence(c) ?? throw ContractException.Conflict("signed_document_not_available");
            using var accepted = new MemoryStream();
            await storage.CopyToAsync(evidence.FinalDocumentKey ?? evidence.TenantDocumentKey, accepted, t);
            if (FileHash(accepted.ToArray()) != (evidence.FinalDocumentHash ?? evidence.TenantDocumentHash)) throw ContractException.Conflict("signing_evidence_integrity_failed");
            accepted.Position = 0; await accepted.CopyToAsync(output, t); return;
        }
        var s = c.Signatures.Where(s => CompleteSignature(s, c)).OrderBy(s => s.SignedAt).LastOrDefault() ?? throw ContractException.Conflict("signed_document_not_available");
        if (!Intact(c) || s.SnapshotHash != c.SnapshotHash || string.IsNullOrWhiteSpace(s.SignedObjectKey) || string.IsNullOrWhiteSpace(s.SignedHash))
            throw ContractException.Conflict("signing_evidence_integrity_failed");
        using var buffer = new MemoryStream();
        await storage.CopyToAsync(s.SignedObjectKey, buffer, t);
        if (FileHash(buffer.ToArray()) != s.SignedHash) throw ContractException.Conflict("signing_evidence_integrity_failed");
        buffer.Position = 0; await buffer.CopyToAsync(output, t);
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
            var m = new ContractMoveOut
            {
                ContractId = id,
                ProposedDate = x.ProposedDate,
                Reason = x.Reason.Trim(),
                RequestedByUserId = Actor,
                IsExpiry = expiry,
                Status = MoveOutStatus.Requested
            };
            repository.Add(m); MoveOutEvent(m, "Requested"); Audit("ContractMoveOutRequested", id); Remember(key, expiry ? "expiry" : "terminate-request", new { id, x }, m.Id); return View(m);
        }, t);
    }
    public async Task<MoveOutView> GetMoveOutAsync(Guid id, CancellationToken t)
    {
        await Load(id, [Roles.Owner, Roles.Staff, Roles.Tenant], t);
        var move = await repository.MoveOutAsync(id, t) ?? throw ContractException.Missing();
        var view = View(move);
        var inspection = (await repository.FinalInspectionsAsync(id, t)).FirstOrDefault();
        view = view with
        {
            OwnerConfirmedInspection = inspection?.OwnerDecision == "Confirmed",
            FinancialReviewStatus = move.SettlementApprovedAt is null ? "PendingReview" : "OwnerReviewed"
        };
        return view with { EvidenceIds = (await repository.InspectionEvidenceAsync(id, t)).Where(e => e.IsLinked || e.UploadedByUserId == Actor).Select(e => e.Id).ToArray() };
    }
    public Task<MoveOutView> ApproveTerminationAsync(Guid id, Guid key, CancellationToken t) => Mutate(id, [Roles.Owner], async c =>
    {
        var m = await repository.MoveOutAsync(id, t) ?? throw ContractException.Missing();
        if (await Replay(key, "terminate-approve", id, t) is not null) return View(m);
        if (c.Status != ContractStatus.Active || m.Status != MoveOutStatus.Requested) throw ContractException.Conflict("move_out_not_pending_approval");
        m.Status = MoveOutStatus.Approved; m.ApprovedByUserId = Actor; m.ApprovedAt = clock.GetUtcNow(); m.Version++; MoveOutEvent(m, "Approved");
        Audit("ContractMoveOutApproved", id); Remember(key, "terminate-approve", id, m.Id); return View(m);
    }, t);
    public Task<MoveOutView> ScheduleInspectionAsync(Guid id, InspectionScheduleInput x, Guid key, CancellationToken t) => Mutate(id, [Roles.Owner, Roles.Staff], async c =>
    {
        var m = await repository.MoveOutAsync(id, t) ?? throw ContractException.Missing();
        if (await Replay(key, "inspection-schedule", new { id, x }, t) is not null) return View(m);
        if (m.Status != MoveOutStatus.Approved || x.ScheduledAt < clock.GetUtcNow() || x.ScheduledAt.Offset != TimeSpan.Zero) throw ContractException.Invalid("invalid_inspection_schedule");
        if (x.ExpectedVersion is { } version && version != m.Version) throw ContractException.Conflict("move_out_version_changed");
        var staff = x.StaffUserId ?? (user.IsInRole(Roles.Staff) ? Actor : (Guid?)null);
        if (staff == Guid.Empty || staff is { } assignee && (!await repository.ActiveUserInRoleAsync(assignee, Roles.Staff, t) || !await repository.StaffAssignedAsync(assignee, c.Room.LocationId, Today, t))) throw ContractException.Invalid("inspection_staff_not_assigned");
        m.InspectionStaffId = staff; m.InspectionScheduledAt = x.ScheduledAt; m.Version++; MoveOutEvent(m, "Scheduled"); Audit("ContractInspectionScheduled", id); Remember(key, "inspection-schedule", new { id, x }, m.Id); return View(m);
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
            if (m.InspectionStaffId is { } staff && staff != Actor) throw ContractException.Missing();
            if (x.ExpectedVersion is { } expected && expected != m.Version) throw ContractException.Conflict("move_out_version_changed");
            if (!await repository.ValidFinalReadingAsync(x.ElectricityReadingId, c.Id, c.RoomId, UtilityType.Electricity, Today, t) ||
                !await repository.ValidFinalReadingAsync(x.WaterReadingId, c.Id, c.RoomId, UtilityType.Water, Today, t))
                throw ContractException.Conflict("confirmed_final_readings_required");
            if (x.EvidenceIds.Distinct().Count() != x.EvidenceIds.Length) throw ContractException.Invalid("duplicate_inspection_evidence");
            var evidence = (await repository.InspectionEvidenceAsync(id, t)).Where(e => x.EvidenceIds.Contains(e.Id)).ToArray();
            if (evidence.Length != x.EvidenceIds.Length || evidence.Any(e => e.IsLinked || e.UploadedByUserId != Actor)) throw ContractException.Conflict("inspection_evidence_not_available");
            foreach (var e in evidence) { await storage.CopyToAsync(e.ObjectKey, Stream.Null, t); e.IsLinked = true; }
            m.ElectricityReadingId = x.ElectricityReadingId; m.WaterReadingId = x.WaterReadingId; m.InspectionNotes = x.Notes.Trim();
            m.InspectedByUserId = Actor; m.InspectedAt = clock.GetUtcNow(); m.Status = MoveOutStatus.Inspected;
            await RecordFinalInspection(c, m, x, t); m.Version++; MoveOutEvent(m, "Inspected");
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
            var physicallyCompleted = m.Status == MoveOutStatus.Completed && c.Status == ContractStatus.Terminated;
            if (!physicallyCompleted && (m.Status is not (MoveOutStatus.Inspected or MoveOutStatus.PendingSettlement or MoveOutStatus.Settled) || c.Status != ContractStatus.Active)) throw ContractException.Conflict("inspection_required");
            m.SettlementDecision = x.Decision.Trim();
            if (!physicallyCompleted) m.Status = MoveOutStatus.PendingSettlement;
            m.SettlementApprovedByUserId = null; m.SettlementApprovedAt = null; m.SettlementLedgerReference = null;
            var result = await ledger.ReadAsync(id, m.ElectricityReadingId!.Value, m.WaterReadingId!.Value, t);
            var summary = ledger is IContractSettlementDetails details ? await details.SummaryAsync(id, t) : null;
            if (summary is { Resolved: true } && x.ExpectedReference != summary.Reference) throw ContractException.Conflict("settlement_review_changed");
            if (result is { AllObligationsResolved: true, DepositResolved: true, TransfersVerified: true } && !string.IsNullOrWhiteSpace(result.DecisionReference))
            {
                if (!physicallyCompleted) m.Status = MoveOutStatus.Settled;
                m.SettlementApprovedByUserId = Actor; m.SettlementApprovedAt = clock.GetUtcNow(); m.PendingReason = "";
                m.SettlementLedgerReference = result.DecisionReference;
            }
            else m.PendingReason = summary?.UnresolvedItems.FirstOrDefault() ?? "financial_ledger_and_deposit_policy";
            m.Version++; MoveOutEvent(m, m.SettlementApprovedAt is not null ? "Settled" : "PendingSettlement");
            repository.Add(new ContractSettlementReview
            {
                ContractId = id,
                Decision = m.SettlementDecision,
                LedgerReference = m.SettlementLedgerReference,
                Settled = m.SettlementApprovedAt is not null,
                ReviewedByUserId = Actor,
                ReviewedAt = clock.GetUtcNow()
                ,
                FinancialSnapshot = summary is null ? "{}" : JsonSerializer.Serialize(summary)
            });
            Audit("ContractSettlementReviewed", id); Remember(key, "settlement", new { id, x }, m.Id); return View(m);
        }, t);
    }
    public async Task<IReadOnlyList<SettlementReviewView>> SettlementHistoryAsync(Guid id, CancellationToken t)
    {
        await Load(id, [Roles.Owner, Roles.Tenant], t);
        return (await repository.SettlementReviewsAsync(id, t)).Select(r => new SettlementReviewView(r.Id, r.Decision, r.Settled, r.ReviewedByUserId, r.ReviewedAt, r.FinancialSnapshot)).ToArray();
    }
    public Task<ContractView> CompleteAsync(Guid id, CompletionInput x, Guid key, CancellationToken t) => Mutate(id, [Roles.Owner], async c =>
    {
        if (await Replay(key, "complete", new { id, x }, t) is not null) return View(c);
        var m = await repository.MoveOutAsync(id, t) ?? throw ContractException.Missing();
        if (c.Status != ContractStatus.Active || m.Status is not (MoveOutStatus.Inspected or MoveOutStatus.PendingSettlement or MoveOutStatus.Settled) || m.InspectedAt is null ||
            x.ActualEndDate < m.ProposedDate || x.ActualEndDate != DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(m.InspectedAt.Value, "Asia/Ho_Chi_Minh").DateTime) || x.ActualEndDate > Today)
            throw ContractException.Conflict("move_out_handover_required");
        var inspection = (await repository.FinalInspectionsAsync(id, t)).FirstOrDefault();
        if (inspection?.OwnerDecision != "Confirmed") throw ContractException.Conflict("owner_confirmed_inspection_required");
        var observed = JsonSerializer.Deserialize<HandoverSnapshot>(inspection.ObservedSnapshot) ?? throw ContractException.Conflict("inspection_snapshot_invalid");
        if (observed.Date != x.ActualEndDate || observed.Electricity.Id != m.ElectricityReadingId || observed.Water.Id != m.WaterReadingId)
            throw ContractException.Conflict("inspection_snapshot_invalid");
        var readings = await repository.FinalReadingsAsync(id, c.RoomId, x.ActualEndDate, t);
        foreach (var expected in new[] { observed.Electricity, observed.Water })
        {
            var reading = readings.SingleOrDefault(r => r.Id == expected.Id && r.UtilityType == expected.UtilityType && r.Value == expected.Value &&
                r.EvidenceId == expected.EvidenceId && r.EvidenceHash == expected.EvidenceHash)
                ?? throw ContractException.Conflict("confirmed_final_readings_required");
            using var bytes = new MemoryStream(); await storage.CopyToAsync(reading.EvidenceObjectKey, bytes, t);
            if (FileHash(bytes.ToArray()) != reading.EvidenceHash) throw ContractException.Conflict("inspection_evidence_integrity_failed");
        }
        c.Status = ContractStatus.Terminated; c.ActualEndDate = x.ActualEndDate;
        var otherActive = await repository.HasOtherActiveContractsAsync(c.RoomId, c.Id, t);
        ChangeRoomStatus(c, otherActive ? RoomStatus.Occupied : c.Room.Status == RoomStatus.Occupied ? RoomStatus.Available : c.Room.Status,
            RoomTransitionSource.ContractTermination, otherActive);
        m.Status = MoveOutStatus.Completed; m.Version++; MoveOutEvent(m, "Completed");
        foreach (var r in c.Residents) r.ResidenceTo = x.ActualEndDate;
        await repository.CloseResidenceAsync(c, x.ActualEndDate, Actor, clock.GetUtcNow(), t);
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
            if (m.Status != MoveOutStatus.Approved || (await repository.InspectionEvidenceAsync(id, t)).Count >= 50)
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
