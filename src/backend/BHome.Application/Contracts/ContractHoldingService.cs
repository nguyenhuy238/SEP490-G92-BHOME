using System.Text.Json;
using BHome.Domain.IdentityAccess;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;

namespace BHome.Application.Contracts;

public sealed partial class ContractService
{
    internal Task CompleteInternalHoldingSigningAsync(Contract contract, CancellationToken t)
    {
        Role(Roles.Owner);
        return LockHoldingPriceAsync(contract, "SigningAndDepositCompleted", clock.GetUtcNow(), t);
    }
    private bool HoldingSigned(Contract c) => c.SigningMode == ContractSigningModes.Internal ? AnonymousContractSigningService.Complete(c) : new[] { c.OwnerSignerId, c.TenantUserId }.All(signer =>
        c.Signatures.Any(s => s.SignerUserId == signer && CompleteSignature(s, c) && s.SignedAt is not null &&
            s.SnapshotHash == c.SnapshotHash && !string.IsNullOrWhiteSpace(s.SignedObjectKey) &&
            !string.IsNullOrWhiteSpace(s.SignedHash) && !string.IsNullOrWhiteSpace(s.ProviderReference)));

    private async Task LockHoldingPriceAsync(Contract c, string trigger, DateTimeOffset at, CancellationToken token, decimal incomingAmount = 0, bool providerVerified = false)
    {
        if (c.Kind != ContractKind.Holding || c.PriceLockedAt.HasValue) return;
        if (c.ApprovedAt is null) throw ContractException.Conflict("holding_owner_approval_required");
        if (!HoldingSigned(c) || await repository.DepositTotalAsync(c.Id, token) + incomingAmount != c.RequiredDeposit) return;
        if (await repository.HoldingConflictAsync(c.RoomId, c.Id, c.StartDate, c.EndDate, token))
            throw ContractException.Conflict("room_contract_conflict");
        var approved = c.AgreedPriceSnapshot == "{}" ? null : JsonSerializer.Deserialize<HoldingPriceSnapshot>(c.AgreedPriceSnapshot);
        var prices = approved is null ? await repository.ResolvePricesAsync(c.RoomId, c.StartDate, token) : null;
        var charges = approved?.Charges ?? prices!.Charges.Select(x => new HoldingPriceCharge(
            x.Id, x.ChargeCode, (int)x.Category, (int)x.Method, x.Rate, x.EffectiveFrom, x.EffectiveTo, x.Version)).ToArray();
        if (charges.SingleOrDefault(x => x.ChargeCode == "RENT")?.Rate != c.MonthlyRent)
            throw ContractException.Conflict("holding_approved_price_changed");
        var signedAt = c.SigningMode == ContractSigningModes.Internal ? AnonymousContractSigningService.AcceptedEvidence(c)!.OwnerAcceptedAt!.Value :
            c.Signatures.Where(s => CompleteSignature(s, c)).Max(s => s.SignedAt)!.Value;
        var instant = (at > signedAt ? at : signedAt).ToUniversalTime();
        trigger = "SigningAndDepositCompleted";
        var snapshot = new HoldingPriceSnapshot(c.MonthlyRent, c.RequiredDeposit, c.StartDate, c.EndDate,
            c.HoldingExpiryAt!.Value, trigger, instant, charges);
        c.AgreedPriceSnapshot = JsonSerializer.Serialize(snapshot);
        c.PriceLockTrigger = trigger;
        c.PriceLockedAt = instant;
        if (providerVerified) repository.AuditAnonymous("ProviderHoldingPriceLocked", c.Id, clock.GetUtcNow());
        else Audit("HoldingPriceLocked", c.Id);
    }

    public async Task<ContractId> CreateHoldingAsync(HoldingDraftInput input, Guid key, CancellationToken token)
    {
        Role(Roles.Owner, Roles.Staff); Validate(input); Money(input.HoldingDeposit);
        var now = clock.GetUtcNow();
        if (input.OwnerSignerId == input.TenantUserId || input.StartDate == default || input.EndDate <= input.StartDate ||
            input.ExpiresAt.Offset != TimeSpan.Zero || input.ExpiresAt <= now || input.ResidentIds is null || input.ResidentIds.Length == 0 ||
            input.ResidentIds.Distinct().Count() != input.ResidentIds.Length || !input.ResidentIds.Contains(input.RepresentativeResidentId) ||
            input.ReservedCapacity is <= 0 || input.ReservedCapacity is { } capacity && capacity < input.ResidentIds.Length)
            throw ContractException.Invalid("invalid_holding_terms");
        await ScopeRoom(input.RoomId, token);
        return await repository.InTransactionAsync(input.RoomId, async () =>
        {
            await ScopeRoom(input.RoomId, token);
            if (await Replay(key, "holding-draft", input, token) is { } prior) return new ContractId(prior);
            var room = await repository.RoomAsync(input.RoomId, token) ?? throw ContractException.Missing();
            if (room.Status != RoomStatus.Available || input.ReservedCapacity > room.Capacity)
                throw ContractException.Conflict("room_not_available_for_holding");
            if (await repository.HoldingConflictAsync(input.RoomId, Guid.Empty, input.StartDate, input.EndDate, token))
                throw ContractException.Conflict("room_contract_conflict");
            if (!await repository.ActiveUserInRoleAsync(input.OwnerSignerId, Roles.Owner, token) ||
                input.TenantUserId is { } tenant && !await repository.ActiveUserInRoleAsync(tenant, Roles.Tenant, token))
                throw ContractException.Invalid("invalid_contract_signers");
            var residents = await repository.ResidentsAsync(input.RoomId, input.ResidentIds, token);
            if (residents.Count != input.ResidentIds.Length || residents.Any(r => r.VerificationStatus != IdentityVerificationStatus.Verified))
                throw ContractException.Invalid("verified_residents_required");
            if (residents.Any(r => r.Id != input.RepresentativeResidentId && r.ResidentType != ResidentType.CoOccupant))
                throw ContractException.Invalid("individual_representatives_require_separate_contracts");
            if (residents.Single(r => r.Id == input.RepresentativeResidentId).TenantUserId is { } linked && linked != input.TenantUserId)
                throw ContractException.Invalid("tenant_account_mismatch");
            var prices = await repository.ResolvePricesAsync(input.RoomId, input.StartDate, token);
            var rent = prices.Charges.SingleOrDefault(x => x.ChargeCode == "RENT")
                ?? throw ContractException.Conflict("rent_policy_required");
            Money(rent.Rate, false);
            var c = new Contract
            {
                RoomId = input.RoomId,
                OwnerSignerId = input.OwnerSignerId,
                TenantUserId = input.TenantUserId,
                SigningMode = input.TenantUserId is null ? ContractSigningModes.Internal : "",
                RepresentativeResidentId = input.RepresentativeResidentId,
                Kind = ContractKind.Holding,
                StartDate = input.StartDate,
                EndDate = input.EndDate,
                HoldingExpiryAt = input.ExpiresAt,
                ReservedCapacity = input.ReservedCapacity ?? checked((short)input.ResidentIds.Length),
                // Policy rates have decimal scale, while contract VND columns use numeric(18,0).
                // Seal the representation that survives persistence so signing can verify it.
                MonthlyRent = decimal.Truncate(rent.Rate),
                RequiredDeposit = decimal.Truncate(input.HoldingDeposit),
                Terms = input.Terms.Trim(),
                IsDevelopmentDemo = DemoEnabled
            };
            c.Residents = residents.Select(r => new ContractResident
            {
                ContractId = c.Id,
                ResidentId = r.Id,
                Role = r.Id == input.RepresentativeResidentId ? ResidentType.Representative : ResidentType.CoOccupant,
                ResidenceFrom = c.StartDate
            }).ToList();
            if (operatingPolicies is not null) await operatingPolicies.BindDraftAsync(c, token);
            Seal(c); repository.Add(c); Audit("HoldingDraftCreated", c.Id);
            Remember(key, "holding-draft", input, c.Id); return new ContractId(c.Id);
        }, token);
    }

    public Task<ContractView> ApproveHoldingAsync(Guid id, HoldingDecisionInput input, Guid key, CancellationToken token)
    {
        Validate(input);
        return Mutate(id, [Roles.Owner], async c =>
        {
            if (await Replay(key, "holding-approve", new { id, input }, token) is not null) return View(c);
            if (c.Kind != ContractKind.Holding || c.Status != ContractStatus.Draft || c.HoldingExpiryAt <= clock.GetUtcNow())
                throw ContractException.Conflict("holding_not_pending_approval");
            if (c.ApprovedAt.HasValue) throw ContractException.Conflict("holding_already_approved");
            if (await repository.HoldingConflictAsync(c.RoomId, c.Id, c.StartDate, c.EndDate, token))
                throw ContractException.Conflict("room_contract_conflict");
            c.ApprovedByUserId = Actor; c.ApprovedAt = clock.GetUtcNow(); c.ApprovalReason = input.Reason.Trim();
            var prices = await repository.ResolvePricesAsync(c.RoomId, c.StartDate, token);
            if (prices.Charges.SingleOrDefault(x => x.ChargeCode == "RENT")?.Rate != c.MonthlyRent)
                throw ContractException.Conflict("holding_approved_price_changed");
            c.AgreedPriceSnapshot = JsonSerializer.Serialize(new HoldingPriceSnapshot(c.MonthlyRent, c.RequiredDeposit,
                c.StartDate, c.EndDate, c.HoldingExpiryAt!.Value, "OwnerApproved", c.ApprovedAt.Value,
                prices.Charges.Select(x => new HoldingPriceCharge(x.Id, x.ChargeCode, (int)x.Category, (int)x.Method,
                    x.Rate, x.EffectiveFrom, x.EffectiveTo, x.Version)).ToArray()));
            Audit("HoldingApproved", id); Remember(key, "holding-approve", new { id, input }, id); return View(c);
        }, token);
    }

    public async Task<HoldingDepositStatus> HoldingDepositAsync(Guid id, CancellationToken token)
    {
        var c = await Load(id, [Roles.Owner, Roles.Staff, Roles.Tenant], token);
        if (c.Kind != ContractKind.Holding) throw ContractException.Missing();
        var verified = await repository.DepositTotalAsync(id, token);
        HoldingDispositionView? disposition = null;
        if (c.Status == ContractStatus.Cancelled && !user.IsInRole(Roles.Staff))
        {
            var review = (await repository.SettlementReviewsAsync(id, token)).FirstOrDefault(r => HoldingCancellationRules.Decode(r) is not null);
            var decision = HoldingCancellationRules.Decode(review);
            if (decision is not null)
            {
                var reference = HoldingCancellationRules.Reference(id, review!);
                var position = depositPositions is null ? null : await depositPositions.ReadAsync([id], token, reference);
                var valid = position is not null && position.Received == decision.VerifiedDeposit && verified == decision.VerifiedDeposit && position.Allocated == 0 && position.UnclassifiedRefunds == 0;
                var status = !valid ? "PendingManualReview" : decision.VerifiedDeposit == 0 ? "NotRequired" : decision.Cause == HoldingCancellationCause.TenantVoluntary
                    ? position!.Refunded == 0 && position.Reserved == 0 ? "Forfeited" : "PendingManualReview"
                    : position!.Refunded == decision.RefundRequired && position.Reserved == 0 ? "RefundCompleted" : position.Reserved > 0 ? "RefundReserved" : "RefundPending";
                disposition = new(decision.Cause.ToString(), status, decision.ForfeitedAmount, decision.RefundRequired, position?.Refunded ?? 0, position?.Reserved ?? 0, reference);
            }
        }
        return new(id, verified >= c.RequiredDeposit ? "Verified" : verified > 0 ? "Partial" : "Pending",
            c.RequiredDeposit, verified, Math.Max(0, c.RequiredDeposit - verified), verified > c.RequiredDeposit || !user.IsInRole(Roles.Staff) && c.Status == ContractStatus.Cancelled && (disposition is null || disposition.Status == "PendingManualReview"),
            c.PriceLockedAt, c.PriceLockTrigger, disposition);
    }

    public async Task ConfirmHoldingDepositAllocationAsync(Guid id, decimal amount, DateTimeOffset verifiedAt, CancellationToken token)
    {
        Role(Roles.Owner); Money(amount, false);
        var c = await Load(id, [Roles.Owner], token);
        if (c.Kind != ContractKind.Holding || c.ApprovedAt is null || c.Status is ContractStatus.Expired or ContractStatus.Cancelled or ContractStatus.Converted ||
            c.HoldingExpiryAt <= verifiedAt) throw ContractException.Conflict("holding_deposit_requires_manual_review");
        if (await repository.HoldingConflictAsync(c.RoomId, c.Id, c.StartDate, c.EndDate, token)) throw ContractException.Conflict("room_contract_conflict");
        await LockHoldingPriceAsync(c, "VerifiedDeposit", verifiedAt, token, amount);
    }
    public async Task<bool> CanAcceptHoldingDepositAsync(Guid id, CancellationToken t)
    {
        var c = await Load(id, [Roles.Owner], t);
        return !await repository.HoldingConflictAsync(c.RoomId, c.Id, c.StartDate, c.EndDate, t);
    }

    // Trusted provider pathway. The caller holds the payment, Location and Room locks.
    internal async Task<bool> ConfirmProviderHoldingDepositAsync(Guid id, decimal amount, DateTimeOffset verifiedAt, CancellationToken token)
    {
        Money(amount, false);
        var contract = await repository.FindAsync(id, token) ?? throw ContractException.Missing();
        if (contract.Kind != ContractKind.Holding || contract.ApprovedAt is null || contract.HoldingExpiryAt <= verifiedAt ||
            await repository.HoldingConflictAsync(contract.RoomId, id, contract.StartDate, contract.EndDate, token)) return false;
        await LockHoldingPriceAsync(contract, "VerifiedDeposit", verifiedAt, token, amount, providerVerified: true);
        return true;
    }

    private async Task<ActivationReadiness> HoldingReadiness(Contract c, CancellationToken token)
    {
        List<string> blockers = [];
        if (lifecycle is not null) blockers.AddRange(await lifecycle.RoomBlockersAsync(c.RoomId, token));
        if (c.Kind != ContractKind.Holding) blockers.Add("holding_contract_required");
        if (c.Status != ContractStatus.PendingActivation) blockers.Add("holding_not_pending_activation");
        if (c.ApprovedAt is null) blockers.Add("holding_owner_approval_required");
        if (c.HoldingExpiryAt is null || c.HoldingExpiryAt <= clock.GetUtcNow()) blockers.Add("holding_expired");
        if (c.Room.Status != RoomStatus.Available || !c.Room.Location.IsActive || c.Room.RoomType is { IsActive: false }) blockers.Add("room_not_available");
        if (!Intact(c) || !HoldingSigned(c)) blockers.Add("verified_signature_evidence_required");
        var deposit = await repository.DepositTotalAsync(c.Id, token);
        if (deposit < c.RequiredDeposit) blockers.Add("holding_deposit_insufficient");
        if (deposit > c.RequiredDeposit) blockers.Add("holding_deposit_excess_requires_review");
        if (!c.PriceLockedAt.HasValue || c.AgreedPriceSnapshot == "{}") blockers.Add("holding_price_not_locked");
        if (await repository.HoldingConflictAsync(c.RoomId, c.Id, c.StartDate, c.EndDate, token)) blockers.Add("room_contract_conflict");
        return new(blockers.Count == 0, deposit, Math.Max(0, c.RequiredDeposit - deposit), blockers.Distinct().ToArray());
    }

    public Task<ContractView> ActivateHoldingAsync(Guid id, Guid key, CancellationToken token) => Mutate(id, [Roles.Owner], async c =>
    {
        if (await Replay(key, "holding-activate", id, token) is not null) return View(c);
        await LockHoldingPriceAsync(c, "SigningAndDepositCompleted", clock.GetUtcNow(), token);
        if (!(await HoldingReadiness(c, token)).Ready) throw ContractException.Conflict("holding_not_ready_for_activation");
        if (c.SigningMode == ContractSigningModes.Internal)
        {
            var evidence = AnonymousContractSigningService.AcceptedEvidence(c)!;
            using var bytes = new MemoryStream(); await storage.CopyToAsync(evidence.FinalDocumentKey!, bytes, token);
            if (FileHash(bytes.ToArray()) != evidence.FinalDocumentHash) throw ContractException.Conflict("signing_evidence_integrity_failed");
        }
        foreach (var signature in c.Signatures.Where(s => CompleteSignature(s, c)))
        {
            using var bytes = new MemoryStream(); await storage.CopyToAsync(signature.SignedObjectKey!, bytes, token);
            if (FileHash(bytes.ToArray()) != signature.SignedHash) throw ContractException.Conflict("signing_evidence_integrity_failed");
        }
        ChangeRoomStatus(c, RoomStatus.OnHold, RoomTransitionSource.HoldingActivation);
        c.Status = ContractStatus.Active; c.ActivatedByUserId = Actor; c.ActivatedAt = clock.GetUtcNow();
        Audit("HoldingActivated", id); Remember(key, "holding-activate", id, id); return View(c);
    }, token);

    public Task<ContractView> CancelHoldingAsync(Guid id, HoldingCancellationInput input, Guid key, CancellationToken token)
    {
        Validate(input);
        if (!input.HumanConfirmed || !Enum.IsDefined(input.Cause)) throw ContractException.Invalid("holding_cancellation_cause_required");
        return Mutate(id, [Roles.Owner], async c =>
        {
            if (await Replay(key, "holding-cancel", new { id, input }, token) is not null) return View(c);
            if (c.Kind != ContractKind.Holding || c.Status is not (ContractStatus.Draft or ContractStatus.PendingSigning or ContractStatus.PendingActivation or ContractStatus.Active))
                throw ContractException.Conflict("holding_not_cancellable");
            if (await repository.MainForHoldingAsync(c.Id, token) is not null) throw ContractException.Conflict("holding_conversion_in_progress");
            var received = await repository.DepositTotalAsync(c.Id, token);
            if (depositPositions is null) throw new ContractException(503, "deposit_position_unavailable");
            var position = await depositPositions.ReadAsync([id], token);
            if (position is null || position.Received != received || position.Allocated != 0 || position.Refunded != 0 || position.Reserved != 0 || position.UnclassifiedRefunds != 0)
                throw ContractException.Conflict("holding_deposit_requires_manual_review");
            if (c.Status == ContractStatus.Active)
            {
                ChangeRoomStatus(c, RoomStatus.Available, RoomTransitionSource.HoldingRelease);
            }
            c.Status = ContractStatus.Cancelled; c.ActualEndDate = Today; c.LifecycleActorId = Actor;
            c.LifecycleAt = clock.GetUtcNow(); c.LifecycleReason = input.Reason.Trim();
            var forfeited = input.Cause == HoldingCancellationCause.TenantVoluntary ? received : 0;
            var review = new ContractSettlementReview
            {
                ContractId = c.Id,
                Decision = input.Cause == HoldingCancellationCause.TenantVoluntary ? "HoldingDepositForfeited" : "HoldingRefundRequired",
                Settled = input.Cause == HoldingCancellationCause.TenantVoluntary || received == 0,
                ReviewedByUserId = Actor,
                ReviewedAt = clock.GetUtcNow(),
                FinancialSnapshot = JsonSerializer.Serialize(new HoldingCancellationDisposition(HoldingCancellationRules.Kind, input.Cause, received,
                    forfeited, received - forfeited, Actor, clock.GetUtcNow(), input.Reason.Trim()))
            };
            review.LedgerReference = HoldingCancellationRules.Reference(id, review);
            repository.Add(review);
            Audit("HoldingCancelled", id); Remember(key, "holding-cancel", new { id, input }, id); return View(c);
        }, token);
    }

    public Task<ContractId> ConvertHoldingAsync(Guid id, HoldingConversionInput input, Guid key, CancellationToken token)
    {
        Money(input.RequiredSecurityDeposit);
        return Mutate(id, [Roles.Owner, Roles.Staff], async holding =>
        {
            if (await Replay(key, "holding-convert", new { id, input }, token) is { } replay) return new ContractId(replay);
            if (holding.Kind != ContractKind.Holding || holding.Status != ContractStatus.Active || holding.HoldingExpiryAt <= clock.GetUtcNow() ||
                holding.Room.Status != RoomStatus.OnHold || holding.PriceLockedAt is null)
                throw ContractException.Conflict("holding_not_convertible");
            if (await repository.MainForHoldingAsync(id, token) is { } existing)
            {
                Remember(key, "holding-convert", new { id, input }, existing.Id); return new ContractId(existing.Id);
            }
            var main = new Contract
            {
                RoomId = holding.RoomId,
                OwnerSignerId = holding.OwnerSignerId,
                TenantUserId = holding.TenantUserId,
                SigningMode = holding.SigningMode,
                RepresentativeResidentId = holding.RepresentativeResidentId,
                HoldingContractId = holding.Id,
                StartDate = holding.StartDate,
                EndDate = holding.EndDate,
                MonthlyRent = holding.MonthlyRent,
                RequiredDeposit = input.RequiredSecurityDeposit,
                Terms = holding.Terms,
                IsDevelopmentDemo = holding.IsDevelopmentDemo
            };
            main.OperatingPolicySnapshot = holding.OperatingPolicySnapshot;
            var application = await holdings.ApplyAsync(id, main.Id, main.RoomId, main.TenantUserId, main.RequiredDeposit, token);
            if (application.HoldingContractId != id || application.RoomId != main.RoomId || application.TenantUserId != main.TenantUserId ||
                application.AppliedAmount < 0 || application.AppliedAmount > main.RequiredDeposit || string.IsNullOrWhiteSpace(application.AllocationReference))
                throw ContractException.Conflict("invalid_holding_deposit_allocation");
            main.AppliedHoldingDeposit = application.AppliedAmount; main.HoldingAllocationReference = application.AllocationReference;
            main.Residents = holding.Residents.Select(r => new ContractResident
            { ContractId = main.Id, ResidentId = r.ResidentId, Role = r.Role, ResidenceFrom = main.StartDate }).ToList();
            Seal(main); repository.Add(main); Audit("HoldingConversionPrepared", id); Audit("ContractDraftCreated", main.Id);
            Remember(key, "holding-convert", new { id, input }, main.Id); return new ContractId(main.Id);
        }, token);
    }
}
