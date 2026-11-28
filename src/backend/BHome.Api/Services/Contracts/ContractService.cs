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
    IContractDepositPosition? depositPositions = null, IHoldingSettingsData? holdingSettings = null,
    IHoldingTestScope? holdingTestScope = null, BHome.Application.PaymentsDebt.IMainInitialPaymentLedger? initialPayments = null,
    IContractSigningMethods? signingMethods = null, IContractSigningNotifier? signingNotifier = null,
    IAnonymousSigningRepository? signingInvitations = null,
    BHome.Application.PaymentsDebt.SePay.SePayOptions? paymentOptions = null,
    IHandoverInventory? handoverInventory = null, IHandoverDocumentRenderer? handoverDocuments = null,
    ISetupWorkspaceStore? contractSetup = null,
    IHandoverDraftRepository? handoverDrafts = null, IHandoverDraftPdfRenderer? handoverDraftPdf = null,
    IInternalAcceptanceRenderer? acceptanceRenderer = null,
    IHandoverSignatureInkRenderer? handoverInkRenderer = null,
    ISettlementReceivablesRepository? settlementRecords = null,
    IMainDraftData? handoverPartyData = null,
    BHome.Application.PaymentsDebt.IPaymentRepository? paymentAccounts = null,
    BHome.Application.PaymentsDebt.SePay.ISePayOwnerConnections? paymentConnections = null) : IAdministrativeContractReadiness
{
    private Guid Actor => user.UserId is { } id && id != Guid.Empty ? id : throw new ContractException(401, "authentication_required");
    private DateOnly Today => clock.BusinessToday();
    private void Role(params string[] roles) { _ = Actor; if (!roles.Any(user.IsInRole)) throw new ContractException(403, "contract_role_forbidden"); }
    private static string Hash<T>(T value) => Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(value)));
    private static string FileHash(byte[] value) => Convert.ToHexString(SHA256.HashData(value));
    // MemoryStream owns its buffer; hash the occupied portion without a second
    // full-size allocation for every private image or PDF download.
    private static string FileHash(MemoryStream value) => Convert.ToHexString(
        SHA256.HashData(value.GetBuffer().AsSpan(0, checked((int)value.Length))));
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
    private void ChangeRoomStatus(Contract contract, RoomStatus requested, RoomTransitionSource source, bool otherActive = false,
        Guid? approvedOwner = null, string? automaticReason = null)
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
            ActorId = approvedOwner ?? Actor,
            LocationId = room.LocationId,
            TargetId = room.Id,
            TargetType = nameof(Room),
            Action = source.ToString(),
            Reason = automaticReason ?? (approvedOwner is null ? source.ToString() : "AutomaticMainActivationAfterVerifiedPayment"),
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
        c.RentAmount, c.RequiredDeposit, c.HoldingContractId, c.AppliedHoldingDeposit, c.Terms, c.SnapshotHashOrEmpty)
    {
        IsOperatingPolicyAmendment = c.Kind == ContractKind.Addendum,
        IsInternalResidentAcceptance = c.SigningMode == ContractSigningModes.Internal,
        AgreedCharges = ContractChargeSnapshot.DocumentCharges(c)
    };
    private static void Seal(Contract c)
    {
        // Native VND columns have scale 0; hash the exact values that survive a database round-trip.
        c.RentAmount = decimal.Truncate(c.RentAmount); c.RequiredDeposit = decimal.Truncate(c.RequiredDeposit);
        c.AppliedHoldingDeposit = decimal.Truncate(c.AppliedHoldingDeposit);
        c.SnapshotHashOrEmpty = ContractDocumentSnapshot.Hash(Document(c));
    }
    private static bool Intact(Contract c) => ContractChargeSnapshot.IsIntact(c);
    private static ContractView View(Contract c) => new(c.Id, c.RoomId, c.Kind.ToString(), c.Status.ToString(), c.StartDate,
        c.EndDate, c.RentAmount, c.RequiredDeposit, c.Terms, c.PreviousContractId,
        c.Residents.Select(r => r.ResidentId).ToArray(), c.Signatures.Select(SignatureOf).ToArray(), c.ActivatedAt,
        c.OwnerSignerId, c.TenantUserId, c.RepresentativeResidentId, c.HoldingContractId, c.AppliedHoldingDeposit, c.Room.LocationId, c.IsDevelopmentDemo, c.Room.RoomNumber, c.Room.Location?.Name ?? "", ActualEndDate: c.ActualEndDate, OnboardingDraft: c.Kind == ContractKind.Main && c.DraftMetadata != "{}" && c.Status == ContractStatus.Draft,
        HoldingExpiresAt: c.HoldingExpiryAt, ReservedCapacity: c.ReservedCapacity, ApprovedAt: c.ApprovedAt,
        PriceLockedAt: c.PriceLockedAt, PriceLockTrigger: c.PriceLockTrigger, ConvertedMainContractId: c.ConvertedMainContractId,
        SigningMode: c.SigningMode, SnapshotHash: c.SnapshotHashOrEmpty, AgreedCharges: ContractChargeSnapshot.ViewCharges(c), InitialPaymentRequired: c.InitialPaymentRequired, OwnerOnlySandboxConfirmed: MainSandboxAcceptance.Read(c)?.ConfirmedAt is not null, SandboxTenantSimulated: MainSandboxAcceptance.Read(c)?.TenantSimulatedAt is not null, PaymentMode: ContractPaymentModes.Of(c));
    // What a signing screen shows: the method (from the provider credential), the deadline and the signing certificate.
    private static SignatureView SignatureOf(ContractSigning s)
    {
        var method = s.CredentialId switch
        {
            OtpCredential => SigningMethods.Otp,
            OwnerSessionCredential => SigningMethods.OwnerSession,
            UploadCredential => SigningMethods.UploadProof,
            "SIMULATED-NO-CERTIFICATE" => SigningMethods.Simulated,
            _ => SigningMethods.ViettelMySign
        };
        string? subject = null, issuer = null;
        var first = s.CertificateChain.Split('\n', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault();
        if (first is not null)
        {
            try
            {
                using var certificate = new System.Security.Cryptography.X509Certificates.X509Certificate2(Convert.FromBase64String(first));
                subject = certificate.GetNameInfo(System.Security.Cryptography.X509Certificates.X509NameType.SimpleName, false);
                issuer = certificate.GetNameInfo(System.Security.Cryptography.X509Certificates.X509NameType.SimpleName, true);
            }
            catch (Exception e) when (e is FormatException or System.Security.Cryptography.CryptographicException) { }
        }
        return new(s.Id, s.SignerUserId, s.Status.ToString(), s.SignedAt, method, s.ExpiresAt, subject, issuer);
    }
    private static MoveOutView View(ContractMoveOut m) => new(m.Id, m.Status.ToString(), m.ProposedDate, m.Reason, m.InspectionScheduledAt, m.PendingReason,
        m.InspectionNotes, m.InspectedAt, m.ElectricityReadingId, m.WaterReadingId, [], m.InspectionStaffId, m.Version,
        FinancialReviewStatus: m.SettlementApprovedAt is null ? "PendingReview" : "OwnerReviewed", IsForced: Forced(m));
    public async Task<ContractView> GetAsync(Guid id, CancellationToken t)
    {
        var c = await Load(id, [Roles.Owner, Roles.Staff, Roles.Tenant], t);
        var customer = c.Kind == ContractKind.Holding && (user.IsInRole(Roles.Owner) || user.IsInRole(Roles.Staff))
            ? await repository.HoldingCustomerAsync(c.Id, c.RepresentativeResidentId, t) : null;
        return View(c) with { Occupants = await repository.OccupantsAsync(c.Id, t), HoldingCustomer = customer };
    }

    public Task<ContractPage> ListAsync(int page, int pageSize, Guid? locationId, string? status, CancellationToken t, string? kind = null)
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
        ContractKind? kindFilter = null;
        if (kind is not null)
        {
            if (!Enum.TryParse<ContractKind>(kind, out var parsedKind) || !Enum.IsDefined(parsedKind))
                throw ContractException.Invalid("invalid_contract_kind");
            kindFilter = parsedKind;
        }
        return repository.ListAsync(new(Actor, user.IsInRole(Roles.Owner), user.IsInRole(Roles.Staff), user.IsInRole(Roles.Tenant), Today, kindFilter),
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
                source.RepresentativeResidentId != x.RepresentativeResidentId || source.RentAmount != x.MonthlyRent ||
                source.StartDate != x.StartDate || source.EndDate != x.EndDate || source.Terms != x.Terms.Trim() ||
                !source.Residents.Select(r => r.ResidentId).Order().SequenceEqual(x.ResidentIds.Order()))
                throw ContractException.Conflict("holding_conversion_terms_mismatch");
            return await ConvertHoldingAsync(sourceId, new(x.RequiredDeposit), key, t);
        }
        return await repository.InTransactionAsync(x.RoomId, async () =>
        {
            await ScopeRoom(x.RoomId, t);
            if (await Replay(key, "draft", x, t) is { } prior) return new ContractId(prior);
            var room = (await repository.RoomAsync(x.RoomId, t))!;
            if (room.Status is not (RoomStatus.Available or RoomStatus.Occupied)) throw ContractException.Conflict("room_not_available");
            if (x.ResidentIds.Length > room.Capacity) throw ContractException.Conflict("room_capacity_exceeded");
            if (!await repository.ActiveUserInRoleAsync(x.OwnerSignerId, Roles.Owner, t) ||
                x.TenantUserId is { } tenant && !await repository.ActiveUserInRoleAsync(tenant, Roles.Tenant, t)) throw ContractException.Invalid("invalid_contract_signers");
            var residents = await repository.ResidentsAsync(x.RoomId, x.ResidentIds, t);
            if (residents.Count != x.ResidentIds.Length || residents.Any(r => !BHome.Application.Ocr.ContractResidentEligibility.Ready(r, x.RepresentativeResidentId)))
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
                RentAmount = x.MonthlyRent,
                RequiredDeposit = x.MonthlyRent,
                IsDevelopmentDemo = DemoEnabled,
                PaymentMode = await ConfiguredPaymentModeAsync((await repository.RoomAsync(x.RoomId, t))!.LocationId, x.OwnerSignerId, t),
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
            if (c.Status != ContractStatus.Active || c.EndDate.Year >= 9999 || x.EndDate <= c.EndDate || await repository.MoveOutAsync(c.Id, t) is { Status: not MoveOutStatus.Rejected })
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
                PaymentMode = c.PaymentMode,
                PreviousContractId = c.Id,
                StartDate = c.EndDate.AddDays(1),
                EndDate = x.EndDate,
                RentAmount = x.MonthlyRent,
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
            if (c.Kind == ContractKind.Holding && (c.ApprovedAt is null && !AnonymousContractSigningService.HoldingOwnerHasSigned(c) || c.Status is ContractStatus.Expired or ContractStatus.Cancelled || c.HoldingExpiryAt <= clock.BusinessUtcNow()))
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
        if (c.InitialPaymentRequired && (initialPayments is null || !await initialPayments.SatisfiedAsync(c.Id, t))) blockers.Add("initial_payment_required");
        if (c.Kind == ContractKind.Addendum)
        {
            var parent = c.ParentContractId is { } amendmentParent ? await repository.FindAsync(amendmentParent, t) : null;
            if (parent is null || parent.Status != ContractStatus.Active || parent.RoomId != c.RoomId || parent.TenantUserId != c.TenantUserId || parent.OwnerSignerId != c.OwnerSignerId)
                blockers.Add("amendment_parent_not_active");
            if (c.Status != ContractStatus.PendingActivation || !Intact(c) || !HoldingSigned(c)) blockers.Add("verified_signature_evidence_required");
            if (Today < c.StartDate || Today > c.EndDate) blockers.Add("amendment_not_effective");
            return new(blockers.Count == 0, 0, 0, blockers.ToArray());
        }
        // ContractRepository.ConflictsAsync evaluates actual capacity/resident overlap;
        // generic room blockers must not reject valid co-occupants or a Holding source.
        if (lifecycle is not null) blockers.AddRange(await lifecycle.RoomBlockersAsync(c.RoomId, t, c.Id, includeActiveContracts: false));
        if (c.Kind == ContractKind.Holding) blockers.Add("main_contract_required");
        if (c.IsDevelopmentDemo && !DemoEnabled &&
            !(MainSandboxAcceptance.Read(c) is not null && holdingTestScope?.Allows(c.Room.LocationId) == true))
            blockers.Add("development_demo_disabled");
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
                parent.EndDate.AddDays(1) != c.StartDate || await repository.MoveOutAsync(parentId, t) is { Status: not MoveOutStatus.Rejected }) blockers.Add("renewal_parent_not_active");
        }
        if (c.HoldingContractId is { } holdingId)
        {
            var holding = await repository.FindAsync(holdingId, t);
            if (holding is null || holding.Kind != ContractKind.Holding || holding.Status != ContractStatus.Active ||
                holding.HoldingExpiryAt <= clock.BusinessUtcNow() || holding.RoomId != c.RoomId || holding.TenantUserId != c.TenantUserId ||
                holding.ConvertedMainContractId is not null || holding.AgreedPriceSnapshot == "{}" || holding.RentAmount != c.RentAmount ||
                holding.StartDate != c.StartDate || holding.EndDate != c.EndDate || holding.Terms != c.Terms ||
                !ContractChargeSnapshot.SameChargeTerms(holding, c))
                blockers.Add("source_holding_not_convertible");
        }
        if (c.SigningMode == ContractSigningModes.Internal)
        {
            if (MainSandboxAcceptance.Read(c) is not null &&
                holdingTestScope?.Allows(c.Room.LocationId) != true) blockers.Add("sandbox_signing_not_available");
            if (!AnonymousContractSigningService.Complete(c)) blockers.Add("internal_acceptance_evidence_required");
        }
        else foreach (var signer in new[] { c.OwnerSignerId, c.TenantUserId })
                if (!c.Signatures.Any(s => s.SignerUserId == signer && CompleteSignature(s, c) && s.SignedAt is not null &&
                    s.SnapshotHash == c.SnapshotHashOrEmpty && !string.IsNullOrWhiteSpace(s.SignedObjectKey) && !string.IsNullOrWhiteSpace(s.ProviderReference)))
                    blockers.Add("verified_signature_evidence_required");
        var residents = await repository.ResidentsAsync(c.RoomId, c.Residents.Select(r => r.ResidentId).ToArray(), t);
        if (residents.Count != c.Residents.Count || residents.Any(r => !BHome.Application.Ocr.ContractResidentEligibility.Ready(r, c.RepresentativeResidentId)) ||
            !c.Residents.Any(r => r.ResidentId == c.RepresentativeResidentId && r.Role == ResidentType.Representative)) blockers.Add("verified_residents_required");
        if (!await repository.ActiveUserInRoleAsync(c.OwnerSignerId, Roles.Owner, t) ||
            c.SigningMode != ContractSigningModes.Internal && !await repository.ActiveUserInRoleAsync(RequireTenant(c), Roles.Tenant, t)) blockers.Add("invalid_contract_signers");
        if (c.SigningMode == ContractSigningModes.Internal)
        {
            var evidence = AnonymousContractSigningService.AcceptedEvidence(c);
            var invitation = evidence is not null && signingInvitations is not null
                ? await signingInvitations.FindAsync(evidence.InvitationId, t) : null;
            var contacts = SigningContacts.Read(invitation);
            if (residents.Where(r => r.Id == c.RepresentativeResidentId).Any(r => string.IsNullOrWhiteSpace(r.ContactEmail) &&
                (!contacts.TryGetValue(r.Id, out var email) || string.IsNullOrWhiteSpace(email))))
                blockers.Add("resident_email_required");
        }
        var root = c;
        while (root.PreviousContractId is { } previous) root = await repository.FindAsync(previous, t) ?? throw ContractException.Missing();
        var paymentOrder = root.InitialPaymentRequired && initialPayments is not null ? await initialPayments.ReadAsync(root.Id, t) : null;
        var sharedDeposit = paymentOrder?.SharedDepositContractId is { } source
            ? await repository.FindAsync(source, t) ?? throw ContractException.Missing() : null;
        var depositContract = sharedDeposit ?? root;
        var requiredDeposit = sharedDeposit?.RequiredDeposit ?? c.RequiredDeposit;
        var deposit = depositContract.AppliedHoldingDeposit + await repository.DepositTotalAsync(depositContract.Id, t);
        if (deposit < requiredDeposit) blockers.Add("security_deposit_insufficient");
        if (await repository.ConflictsAsync(c.RoomId, c.PreviousContractId ?? c.Id, c.StartDate, c.EndDate, c.Residents.Select(r => r.ResidentId).ToArray(), t)) blockers.Add("room_contract_conflict");
        return new(blockers.Count == 0, deposit, Math.Max(0, requiredDeposit - deposit), blockers.Distinct().ToArray());
    }
    public async Task<ActivationReadiness> ReadinessAsync(Guid id, CancellationToken t)
    {
        var contract = await Load(id, [Roles.Owner, Roles.Staff, Roles.Tenant], t);
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
        return await ActivateReadyAsync(c, Actor, key, false, t);
    }, t);

    // Called only by the durable payment-completion worker, never exposed as an HTTP command.
    public async Task AutoActivatePaidMainAsync(Guid id, CancellationToken t)
    {
        var before = await repository.FindAsync(id, t) ?? throw ContractException.Missing();
        await repository.InTransactionAsync(before.RoomId, async () =>
        {
            var c = await repository.FindAsync(id, t) ?? throw ContractException.Missing();
            if (c.Status == ContractStatus.Active) return true;
            if (c.Kind == ContractKind.Holding)
            {
                await ActivateHoldingReadyAsync(c, null, true, t);
                return true;
            }
            if (c.Kind != ContractKind.Main || c.PreviousContractId is not null)
                throw ContractException.Conflict("initial_main_contract_required");
            await ActivateReadyAsync(c, c.OwnerSignerId, null, true, t);
            return true;
        }, t);
    }

    // Trusted scheduler probe; activation rechecks every condition under the Room transaction lock.
    public async Task<bool> AutomaticActivationReadyAsync(Guid id, CancellationToken t)
    {
        var c = await repository.FindAsync(id, t);
        if (c is null || c.Status != ContractStatus.PendingActivation || c.PreviousContractId is not null) return false;
        return c.Kind == ContractKind.Holding ? (await HoldingReadiness(c, t)).Ready :
            c.Kind == ContractKind.Main && (await Readiness(c, t)).Ready;
    }

    private async Task<ContractView> ActivateReadyAsync(Contract c, Guid approvedOwner, Guid? key, bool automatic, CancellationToken t)
    {
        var id = c.Id;
        void Audit(string action, Guid target)
        {
            if (automatic) repository.AuditAnonymous("Automatic:" + action, target, clock.GetUtcNow());
            else repository.Audit(approvedOwner, action, target, clock.GetUtcNow());
        }
        if (!(await Readiness(c, t)).Ready) throw ContractException.Conflict("contract_not_ready_for_activation");
        if (c.SigningMode == ContractSigningModes.Internal)
        {
            var sandbox = MainSandboxAcceptance.Read(c);
            var e = AnonymousContractSigningService.AcceptedEvidence(c);
            using var accepted = new MemoryStream(); await storage.CopyToAsync(sandbox?.DocumentKey ?? e!.FinalDocumentKey!, accepted, t);
            if (FileHash(accepted.ToArray()) != (sandbox?.DocumentHash ?? e!.FinalDocumentHash)) throw ContractException.Conflict("signing_evidence_integrity_failed");
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
            c.Status = ContractStatus.Applied; c.ActivatedAt = clock.BusinessUtcNow(); c.ActivatedByUserId = approvedOwner;
            Audit("OperatingPolicyAmendmentApplied", id); if (key is { } amendmentKey) Remember(amendmentKey, "activate", id, id); return View(c);
        }
        if (c.PreviousContractId is { } previous)
        {
            var parent = await repository.FindAsync(previous, t) ?? throw ContractException.Missing();
            if (parent.Status != ContractStatus.Active || await repository.MoveOutAsync(previous, t) is { Status: not MoveOutStatus.Rejected }) throw ContractException.Conflict("renewal_parent_not_active");
            parent.Status = ContractStatus.Superseded;
            foreach (var r in parent.Residents) r.ResidenceTo = parent.EndDate;
            // Release the filtered active-room index before updating the new version, within this same transaction.
            await repository.FlushAsync(t);
        }
        if (c.HoldingContractId is { } holdingId)
        {
            var holding = await repository.FindAsync(holdingId, t) ?? throw ContractException.Missing();
            if (holding.Kind != ContractKind.Holding || holding.Status != ContractStatus.Active || holding.ConvertedMainContractId is not null ||
                holding.HoldingExpiryAt <= clock.BusinessUtcNow()) throw ContractException.Conflict("source_holding_not_convertible");
            holding.Status = ContractStatus.Converted; holding.ConvertedMainContractId = c.Id; holding.ActualEndDate = Today;
            holding.LifecycleActorId = approvedOwner; holding.LifecycleAt = clock.GetUtcNow(); holding.LifecycleReason = "MainContractActivated";
            Audit("HoldingConverted", holding.Id);
        }
        ChangeRoomStatus(c, RoomStatus.Occupied, RoomTransitionSource.ContractActivation, approvedOwner: automatic ? approvedOwner : null);
        ContractChargeSnapshot.MarkMainBound(c, clock.GetUtcNow());
        c.Status = ContractStatus.Active; c.ActivatedByUserId = approvedOwner; c.ActivatedAt = clock.BusinessUtcNow();
        if (provisioning is not null) await provisioning.ProvisionAsync(c, approvedOwner, t);
        if (handoverRepository is not null && c.PreviousContractId is null)
            await handoverRepository.EnsureMoveInTaskAsync(c, approvedOwner, clock.BusinessUtcNow(), t);
        if (c.HoldingContractId is { } acceptedHolding && c.SigningMode == ContractSigningModes.Internal)
        {
            var linked = await repository.FindAsync(acceptedHolding, t) ?? throw ContractException.Missing();
            linked.TenantUserId = c.TenantUserId;
            Audit("HoldingAccountLinkedAfterMainActivation", linked.Id);
        }
        Audit("ContractActivated", id); if (key is { } operationKey) Remember(operationKey, "activate", id, id); return View(c);
    }

    public Task<ContractView> CancelPolicyAmendmentAsync(Guid id, PolicyAmendmentCancellation input, Guid key, CancellationToken t) => Mutate(id, [Roles.Owner], async c =>
    {
        if (string.IsNullOrWhiteSpace(input.Reason) || input.Reason.Length > 2000) throw ContractException.Invalid("reason_required");
        if (await Replay(key, "cancel-policy-amendment", new { id, input }, t) is not null) return View(c);
        if (c.Kind != ContractKind.Addendum || c.Status is not (ContractStatus.Draft or ContractStatus.PendingSigning or ContractStatus.PendingActivation)) throw ContractException.Conflict("policy_amendment_not_cancellable");
        c.Status = ContractStatus.Cancelled; c.LifecycleActorId = Actor; c.LifecycleAt = clock.GetUtcNow(); c.LifecycleReason = input.Reason.Trim();
        Audit("OperatingPolicyAmendmentCancelled", id); Remember(key, "cancel-policy-amendment", new { id, input }, id); return View(c);
    }, t);
}
