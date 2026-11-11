using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using BHome.Application.Common;
using BHome.Application.Contracts;
using BHome.Application.IdentityAccess;
using BHome.Application.Storage;
using BHome.Application.PropertyManagement;
using BHome.Domain.IdentityAccess;
using BHome.Domain.Locations;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using NSubstitute;

namespace BHome.Application.UnitTests.Contracts;

public sealed class ContractServiceTests
{
    [Fact]
    public async Task HoldingReadinessUsesHoldingApprovalInsteadOfMainContractRules()
    {
        var rig = new Rig();
        var id = await rig.Service.CreateHoldingAsync(rig.HoldingDraft, Guid.NewGuid(), default);
        var result = await rig.Service.ReadinessAsync(id.Id, default);
        Assert.False(result.Ready);
        Assert.Contains("holding_owner_approval_required", result.Blockers);
        Assert.DoesNotContain("main_contract_required", result.Blockers);
    }
    private static readonly DateOnly Today = new(2026, 10, 29);
    private sealed class Clock : TimeProvider { public override DateTimeOffset GetUtcNow() => new(2026, 10, 29, 8, 0, 0, TimeSpan.Zero); }
    private sealed class User : ICurrentUser
    {
        public Guid? UserId { get; set; } = Guid.NewGuid(); public string Role { get; set; } = Roles.Owner;
        public bool IsInRole(string role) => role == Role;
    }
    private sealed class Rig
    {
        public readonly User User = new();
        public readonly IContractRepository Repo = Substitute.For<IContractRepository>();
        public readonly IStaffLocationAccess Staff = Substitute.For<IStaffLocationAccess>();
        public readonly IContractSigningProvider Signing = Substitute.For<IContractSigningProvider>();
        public readonly IObjectStorage Storage = Substitute.For<IObjectStorage>();
        public readonly IContractFileStore Files = Substitute.For<IContractFileStore>();
        public readonly IContractImageValidator Images = Substitute.For<IContractImageValidator>();
        public readonly IContractSettlementLedger Ledger = Substitute.For<IContractSettlementLedger>();
        public readonly IContractHoldingLedger Holdings = Substitute.For<IContractHoldingLedger>();
        public readonly IContractDepositPosition Positions = Substitute.For<IContractDepositPosition>();
        public readonly List<Contract> Contracts = [];
        public readonly List<ContractMoveOut> Moves = [];
        public readonly List<ContractOperation> Operations = [];
        public readonly List<DepositVerification> Deposits = [];
        public readonly Resident Resident = new() { VerificationStatus = IdentityVerificationStatus.Verified };
        public readonly Room Room = new() { Location = new Location("Synthetic"), Status = RoomStatus.Available };
        public Guid Owner => Contracts[0].OwnerSignerId;
        public Guid Tenant { get; } = Guid.NewGuid();
        public ContractService Service { get; }
        public Rig()
        {
            Room.LocationId = Room.Location.Id; Resident.RoomId = Room.Id;
            Repo.RoomAsync(Room.Id, default).ReturnsForAnyArgs(Room);
            Repo.ResidentsAsync(default, default!, default).ReturnsForAnyArgs(new[] { Resident });
            Repo.ActiveUserInRoleAsync(default, default!, default).ReturnsForAnyArgs(true);
            Repo.FindAsync(default, default).ReturnsForAnyArgs(c => Contracts.SingleOrDefault(x => x.Id == c.Arg<Guid>()));
            Repo.MoveOutAsync(default, default).ReturnsForAnyArgs(c => Moves.SingleOrDefault(x => x.ContractId == c.Arg<Guid>()));
            Repo.DepositTotalAsync(default, default).ReturnsForAnyArgs(c => Deposits.Where(d => d.ContractId == c.Arg<Guid>()).Sum(d => d.Amount));
            Repo.BankReferenceAsync(default!, default).ReturnsForAnyArgs(c => Deposits.SingleOrDefault(d => d.BankTransactionReference == c.Arg<string>()));
            Repo.ResolvePricesAsync(default, default, default).ReturnsForAnyArgs(new ResolvedPrices(Room.Id, Today,
                [new PolicyDto(Guid.NewGuid(), Room.LocationId, Room.Id, ChargeCategory.Rent, "RENT", "Rent",
                    ChargingMethod.FixedPerRoomPerMonth, 3000000, Today.AddMonths(-1), null, 1)], []));
            Repo.MainForHoldingAsync(default, default).ReturnsForAnyArgs(c => Contracts.SingleOrDefault(x => x.HoldingContractId == c.Arg<Guid>()));
            Repo.OperationAsync(default, default, default!, default).ReturnsForAnyArgs(c => Operations.SingleOrDefault(o => o.ActorId == c.ArgAt<Guid>(0) && o.Key == c.ArgAt<Guid>(1) && o.Operation == c.Arg<string>()));
            Repo.InTransactionAsync(default, default(Func<Task<ContractId>>)!, default).ReturnsForAnyArgs(c => c.Arg<Func<Task<ContractId>>>()());
            Repo.InTransactionAsync(default, default(Func<Task<ContractView>>)!, default).ReturnsForAnyArgs(c => c.Arg<Func<Task<ContractView>>>()());
            Repo.InTransactionAsync(default, default(Func<Task<MoveOutView>>)!, default).ReturnsForAnyArgs(c => c.Arg<Func<Task<MoveOutView>>>()());
            Repo.InTransactionAsync(default, default(Func<Task<bool>>)!, default).ReturnsForAnyArgs(c => c.Arg<Func<Task<bool>>>()());
            Repo.InTransactionAsync(default, default(Func<Task<Guid>>)!, default).ReturnsForAnyArgs(c => c.Arg<Func<Task<Guid>>>()());
            Repo.When(r => r.Add(Arg.Any<object>())).Do(c =>
            {
                switch (c.Arg<object>())
                {
                    case Contract x: x.Room = Room; Contracts.Add(x); break;
                    case ContractMoveOut x: Moves.Add(x); break;
                    case ContractOperation x: Operations.Add(x); break;
                    case DepositVerification x: Deposits.Add(x); break;
                    case ContractSignature x: Contracts.Single(a => a.Id == x.ContractId).Signatures.Add(x); break;
                }
            });
            Holdings.ApplyAsync(default, default, default, default, default, default).ReturnsForAnyArgs(Task.FromException<HoldingDepositApplication>(new IntegrationUnavailableException("holding ledger")));
            Positions.ReadAsync(default!, default, default!).ReturnsForAnyArgs(call => (DepositLedgerPosition?)new(Deposits.Where(d => call.Arg<Guid[]>().Contains(d.ContractId)).Sum(d => d.Amount), 0, 0, 0));
            Service = new(Repo, User, new ResourceAccess(User, Staff), Signing, Storage, Files, Images, Ledger, Holdings, new Clock(), depositPositions: Positions);
        }
        public ContractDraftInput Draft => new(Room.Id, User.UserId!.Value, Tenant, Resident.Id, [Resident.Id], Today.AddDays(-10), Today.AddDays(30), 3000000, 3000000, "Synthetic approved terms");
        public HoldingDraftInput HoldingDraft => new(Room.Id, User.UserId!.Value, Tenant, Resident.Id, [Resident.Id],
            Today.AddDays(1), Today.AddMonths(12), new DateTimeOffset(2026, 10, 31, 8, 0, 0, TimeSpan.Zero),
            2000000, "Synthetic Holding terms", 1);
        public async Task<Contract> Create()
        { var id = await Service.CreateAsync(Draft, Guid.NewGuid(), default); return Contracts.Single(c => c.Id == id.Id); }
        public async Task<Contract> Ready()
        {
            var c = await Create(); c.Status = ContractStatus.PendingActivation;
            var bytes = Encoding.UTF8.GetBytes("TEST ONLY verified PDF boundary"); var hash = Convert.ToHexString(SHA256.HashData(bytes));
            foreach (var signer in new[] { c.OwnerSignerId, c.TenantUserId ?? throw new InvalidOperationException("Signing fixture requires an existing Tenant account.") }) c.Signatures.Add(new ContractSignature
            {
                ContractId = c.Id,
                SignerUserId = signer,
                Status = SignatureStatus.Signed,
                SnapshotHash = c.SnapshotHash,
                SignedObjectKey = "test-private-key",
                SignedHash = hash,
                ProviderReference = Guid.NewGuid().ToString(),
                SignedAt = DateTimeOffset.UtcNow
            });
            Storage.CopyToAsync(default!, default!, default).ReturnsForAnyArgs(async x => await x.Arg<Stream>().WriteAsync(bytes));
            Deposits.Add(new DepositVerification { ContractId = c.Id, Amount = c.RequiredDeposit }); return c;
        }
    }

    [Theory]
    [InlineData("3000000")]
    [InlineData("3000000.000000")]
    public async Task HoldingDraftUsesResolvedRentAndDoesNotReserveRoom(string rate)
    {
        var r = new Rig();
        r.Repo.ResolvePricesAsync(default, default, default).ReturnsForAnyArgs(new ResolvedPrices(r.Room.Id, Today,
            [new PolicyDto(Guid.NewGuid(), r.Room.LocationId, r.Room.Id, ChargeCategory.Rent, "RENT", "Rent",
                ChargingMethod.FixedPerRoomPerMonth, decimal.Parse(rate, System.Globalization.CultureInfo.InvariantCulture), Today, null, 1)], []));
        var id = await r.Service.CreateHoldingAsync(r.HoldingDraft, Guid.NewGuid(), default);
        var holding = Assert.Single(r.Contracts, c => c.Id == id.Id);
        Assert.Equal(ContractKind.Holding, holding.Kind);
        Assert.Equal(3000000, holding.MonthlyRent);
        Assert.Equal(ContractStatus.Draft, holding.Status);
        Assert.Equal(RoomStatus.Available, r.Room.Status);
        Assert.Null(holding.ApprovedAt);
        var persistedDocument = new ContractDocument(holding.Id, holding.RoomId, holding.OwnerSignerId, holding.TenantUserId!.Value,
            holding.RepresentativeResidentId, holding.Residents.Select(x => x.ResidentId).Order().ToArray(), holding.StartDate, holding.EndDate,
            decimal.Truncate(holding.MonthlyRent), decimal.Truncate(holding.RequiredDeposit), holding.HoldingContractId,
            holding.AppliedHoldingDeposit, holding.Terms, holding.SnapshotHash);
        Assert.Equal(holding.SnapshotHash, ContractDocumentSnapshot.Hash(persistedDocument));
    }

    [Theory]
    [InlineData("3000000.5")]
    [InlineData("-1")]
    [InlineData("0")]
    public async Task HoldingDraftRejectsInvalidRentInsteadOfTruncatingIt(string rate)
    {
        var r = new Rig();
        r.Repo.ResolvePricesAsync(default, default, default).ReturnsForAnyArgs(new ResolvedPrices(r.Room.Id, Today,
            [new PolicyDto(Guid.NewGuid(), r.Room.LocationId, r.Room.Id, ChargeCategory.Rent, "RENT", "Rent",
                ChargingMethod.FixedPerRoomPerMonth, decimal.Parse(rate, System.Globalization.CultureInfo.InvariantCulture), Today, null, 1)], []));
        var error = await Assert.ThrowsAsync<ContractException>(() => r.Service.CreateHoldingAsync(r.HoldingDraft, Guid.NewGuid(), default));
        Assert.Equal("invalid_vnd_amount", error.Code);
        Assert.Empty(r.Contracts);
        Assert.Equal(RoomStatus.Available, r.Room.Status);
    }

    [Fact]
    public async Task HoldingDepositLocksApprovedPriceOnlyOnce()
    {
        var r = new Rig(); var id = await r.Service.CreateHoldingAsync(r.HoldingDraft, Guid.NewGuid(), default);
        await r.Service.ApproveHoldingAsync(id.Id, new("Owner approved reviewed terms"), Guid.NewGuid(), default);
        await r.Service.VerifyDepositAsync(id.Id, new("HOLD-ONE", 1000000, "Verified bank statement"), Guid.NewGuid(), default);
        var holding = r.Contracts.Single(); Assert.Null(holding.PriceLockedAt);
        foreach (var signer in new[] { holding.OwnerSignerId, holding.TenantUserId!.Value }) holding.Signatures.Add(new ContractSignature
        {
            ContractId = holding.Id,
            SignerUserId = signer,
            Status = SignatureStatus.Signed,
            SnapshotHash = holding.SnapshotHash,
            SignedObjectKey = "synthetic-signed",
            SignedHash = "synthetic-hash",
            ProviderReference = "synthetic-provider",
            SignedAt = new Clock().GetUtcNow()
        });
        r.Repo.ResolvePricesAsync(default, default, default).ReturnsForAnyArgs(new ResolvedPrices(r.Room.Id, Today,
            [new PolicyDto(Guid.NewGuid(), r.Room.LocationId, r.Room.Id, ChargeCategory.Rent, "RENT", "Changed",
                ChargingMethod.FixedPerRoomPerMonth, 9000000, Today, null, 2)], []));
        await r.Service.VerifyDepositAsync(id.Id, new("HOLD-TWO", 1000000, "Verified bank statement"), Guid.NewGuid(), default);
        Assert.Equal("SigningAndDepositCompleted", holding.PriceLockTrigger); Assert.NotNull(holding.PriceLockedAt);
        var locked = holding.AgreedPriceSnapshot; var lockedAt = holding.PriceLockedAt;
        await r.Service.VerifyDepositAsync(id.Id, new("HOLD-TWO", 1000000, "Verified bank statement"), Guid.NewGuid(), default);
        Assert.Equal(lockedAt, holding.PriceLockedAt); Assert.Equal(locked, holding.AgreedPriceSnapshot);
    }

    [Fact]
    public async Task FullySatisfiedHoldingActivatesOnHoldAndCancellationReleasesIt()
    {
        var r = new Rig(); var id = await r.Service.CreateHoldingAsync(r.HoldingDraft, Guid.NewGuid(), default);
        await r.Service.ApproveHoldingAsync(id.Id, new("Owner approved reviewed terms"), Guid.NewGuid(), default);
        var holding = r.Contracts.Single(); holding.Status = ContractStatus.PendingActivation;
        var bytes = Encoding.UTF8.GetBytes("TEST ONLY signed Holding PDF"); var hash = Convert.ToHexString(SHA256.HashData(bytes));
        foreach (var signer in new[] { holding.OwnerSignerId, holding.TenantUserId!.Value }) holding.Signatures.Add(new ContractSignature
        {
            ContractId = holding.Id,
            SignerUserId = signer,
            Status = SignatureStatus.Signed,
            SnapshotHash = holding.SnapshotHash,
            SignedObjectKey = "holding-signed",
            SignedHash = hash,
            ProviderReference = Guid.NewGuid().ToString(),
            SignedAt = new Clock().GetUtcNow()
        });
        r.Storage.CopyToAsync(default!, default!, default).ReturnsForAnyArgs(async x => await x.Arg<Stream>().WriteAsync(bytes));
        await r.Service.VerifyDepositAsync(id.Id, new("HOLD-FULL", 2000000, "Verified bank statement"), Guid.NewGuid(), default);
        await r.Service.ActivateHoldingAsync(id.Id, Guid.NewGuid(), default);
        Assert.Equal(ContractStatus.Active, holding.Status); Assert.Equal(RoomStatus.OnHold, r.Room.Status); Assert.Equal(2, r.Room.Version);
        await r.Service.CancelHoldingAsync(id.Id, new("Synthetic Tenant voluntarily cancelled", HoldingCancellationCause.TenantVoluntary, true), Guid.NewGuid(), default);
        Assert.Equal(ContractStatus.Cancelled, holding.Status); Assert.Equal(RoomStatus.Available, r.Room.Status); Assert.Equal(3, r.Room.Version);
    }

    [Fact]
    public async Task ConversionReusesHoldingLedgerAndDoesNotMarkHoldingConvertedAtDraftTime()
    {
        var r = new Rig(); var id = await r.Service.CreateHoldingAsync(r.HoldingDraft, Guid.NewGuid(), default);
        var holding = r.Contracts.Single(); holding.Status = ContractStatus.Active; holding.ApprovedAt = new Clock().GetUtcNow();
        holding.PriceLockedAt = new Clock().GetUtcNow(); holding.AgreedPriceSnapshot = "{\"locked\":true}"; r.Room.Status = RoomStatus.OnHold;
        r.Holdings.ApplyAsync(default, default, default, default, default, default).ReturnsForAnyArgs(call =>
            new HoldingDepositApplication(holding.Id, holding.RoomId, holding.TenantUserId!.Value, 2000000, "allocation-once"));
        var mainId = await r.Service.ConvertHoldingAsync(holding.Id, new(3000000), Guid.NewGuid(), default);
        var main = r.Contracts.Single(c => c.Id == mainId.Id);
        Assert.Equal(holding.Id, main.HoldingContractId); Assert.Equal(2000000, main.AppliedHoldingDeposit);
        Assert.Equal(ContractStatus.Active, holding.Status); Assert.Null(holding.ConvertedMainContractId);
    }

    [Theory]
    [InlineData(RoomStatus.OnHold)]
    [InlineData(RoomStatus.Unavailable)]
    public async Task DraftRejectsHeldOrUnavailableRoomWithoutChangingItsStatus(RoomStatus status)
    {
        var r = new Rig(); r.Room.Status = status;
        var error = await Assert.ThrowsAsync<ContractException>(() => r.Service.CreateAsync(r.Draft, Guid.NewGuid(), default));
        Assert.Equal(409, error.Status);
        Assert.Equal(status, r.Room.Status);
        Assert.Empty(r.Contracts);
        Assert.Empty(r.Operations);
    }

    [Fact]
    public async Task SharedRoomDraftIsAllowedWhenOccupantsAndCapacityDoNotConflict()
    {
        var r = new Rig(); r.Room.Status = RoomStatus.Occupied;
        await r.Service.CreateAsync(r.Draft, Guid.NewGuid(), default);
        Assert.Single(r.Contracts); Assert.Equal(RoomStatus.Occupied, r.Room.Status);
    }

    [Fact]
    public async Task T01_ActivationCommitsContractAndRoomAndReplaysWithoutDuplicateAudit()
    {
        var r = new Rig(); var c = await r.Ready(); var key = Guid.NewGuid();
        await r.Service.ActivateAsync(c.Id, key, default); await r.Service.ActivateAsync(c.Id, key, default);
        Assert.Equal(ContractStatus.Active, c.Status); Assert.Equal(RoomStatus.Occupied, r.Room.Status);
        Assert.Equal(2, r.Room.Version);
        r.Repo.Received(1).Add(Arg.Is<PropertyChange>(a => a.TargetId == r.Room.Id && a.ActorId == r.User.UserId &&
            a.Before!.Contains("\"Version\":1") && a.After.Contains("\"Version\":2")));
        r.Repo.Received(1).Audit(r.User.UserId!.Value, "ContractActivated", c.Id, Arg.Any<DateTimeOffset>());
    }
    [Fact]
    public async Task ActivationInAlreadyOccupiedRoomDoesNotIncrementRoomVersionOrAddRoomHistory()
    {
        var r = new Rig(); var c = await r.Ready(); r.Room.Status = RoomStatus.Occupied;
        await r.Service.ActivateAsync(c.Id, Guid.NewGuid(), default);
        Assert.Equal(ContractStatus.Active, c.Status); Assert.Equal(1, r.Room.Version);
        r.Repo.DidNotReceive().Add(Arg.Any<PropertyChange>());
    }
    [Fact]
    public async Task ActivationRechecksRoomTypeConfiguration()
    {
        var r = new Rig(); var c = await r.Ready(); r.Room.RoomType = new RoomType { IsActive = false };
        await Assert.ThrowsAsync<ContractException>(() => r.Service.ActivateAsync(c.Id, Guid.NewGuid(), default));
        Assert.Equal(ContractStatus.PendingActivation, c.Status); Assert.Equal(1, r.Room.Version);
        r.Repo.DidNotReceive().Add(Arg.Any<PropertyChange>());
    }
    [Theory]
    [InlineData("signature")]
    [InlineData("deposit")]
    [InlineData("room")]
    [InlineData("terms")]
    [InlineData("identity")]
    public async Task T02_T03_T05_InvalidReadinessCannotActivate(string invalid)
    {
        var r = new Rig(); var c = await r.Ready();
        if (invalid == "signature") c.Signatures.RemoveAt(0);
        if (invalid == "deposit") r.Deposits.Clear();
        if (invalid == "room") r.Repo.ConflictsAsync(default, default, default, default, default!, default).ReturnsForAnyArgs(true);
        if (invalid == "terms") c.Terms = "tampered";
        if (invalid == "identity") r.Resident.VerificationStatus = IdentityVerificationStatus.Pending;
        Assert.Equal(409, (await Assert.ThrowsAsync<ContractException>(() => r.Service.ActivateAsync(c.Id, Guid.NewGuid(), default))).Status);
        Assert.Equal(RoomStatus.Available, r.Room.Status);
    }
    [Fact]
    public async Task T04_StaffCannotActivateOrVerifyDeposits()
    {
        var r = new Rig(); var c = await r.Ready(); r.User.Role = Roles.Staff;
        Assert.Equal(403, (await Assert.ThrowsAsync<ContractException>(() => r.Service.ActivateAsync(c.Id, Guid.NewGuid(), default))).Status);
        Assert.Equal(403, (await Assert.ThrowsAsync<ContractException>(() => r.Service.VerifyDepositAsync(c.Id, new("TEST", 1, "TEST"), Guid.NewGuid(), default))).Status);
    }
    [Fact]
    public async Task T06_MissingHoldingModuleCannotFabricateCredit()
    {
        var r = new Rig(); Assert.Equal(404, (await Assert.ThrowsAsync<ContractException>(() => r.Service.CreateAsync(r.Draft with { HoldingContractId = Guid.NewGuid() }, Guid.NewGuid(), default))).Status);
        Assert.Empty(r.Contracts); Assert.Empty(r.Deposits);
    }
    [Fact]
    public async Task T06_EligibleHoldingAllocationReducesRemainingDepositExactlyOnce()
    {
        var r = new Rig(); var holdingId = (await r.Service.CreateHoldingAsync(r.HoldingDraft, Guid.NewGuid(), default)).Id;
        var holding = r.Contracts.Single(); holding.Status = ContractStatus.Active; holding.PriceLockedAt = new Clock().GetUtcNow(); r.Room.Status = RoomStatus.OnHold;
        r.Holdings.ApplyAsync(default, default, default, default, default, default).ReturnsForAnyArgs(new HoldingDepositApplication(holdingId, r.Room.Id, r.Tenant, 1000000, "synthetic-allocation"));
        var key = Guid.NewGuid(); var input = r.Draft with { HoldingContractId = holdingId, StartDate = holding.StartDate, EndDate = holding.EndDate, Terms = holding.Terms, MonthlyRent = holding.MonthlyRent };
        var one = await r.Service.CreateAsync(input, key, default); var two = await r.Service.CreateAsync(input, key, default);
        Assert.Equal(one, two);
        var ready = await r.Service.ReadinessAsync(one.Id, default);
        Assert.Equal(1000000, ready.VerifiedDeposit); Assert.Equal(2000000, ready.RemainingDeposit);
        await r.Holdings.Received(1).ApplyAsync(holdingId, one.Id, r.Room.Id, r.Tenant, 3000000, default);
    }
    [Fact]
    public async Task RepeatedBankReferenceCreditsExactlyOnceAndCannotBeReallocated()
    {
        var r = new Rig(); var c = await r.Create(); var input = new DepositInput("SYNTHETIC-BANK", 100, "Owner checked bank statement");
        await r.Service.VerifyDepositAsync(c.Id, input, Guid.NewGuid(), default);
        await r.Service.VerifyDepositAsync(c.Id, input, Guid.NewGuid(), default); Assert.Single(r.Deposits);
        await Assert.ThrowsAsync<ContractException>(() => r.Service.VerifyDepositAsync(c.Id, input with { Amount = 200 }, Guid.NewGuid(), default));
    }
    [Fact]
    public async Task ReusingIdempotencyKeyWithChangedInputFails()
    {
        var r = new Rig(); var key = Guid.NewGuid(); await r.Service.CreateAsync(r.Draft, key, default);
        var error = await Assert.ThrowsAsync<ContractException>(() => r.Service.CreateAsync(r.Draft with { MonthlyRent = 4000000 }, key, default));
        Assert.Equal("idempotency_key_reused", error.Code); Assert.Single(r.Contracts);
    }
    [Fact]
    public async Task T09_RenewalRejectsInvalidDatesAndUnsignedActivation()
    {
        var r = new Rig(); var c = await r.Ready(); c.Status = ContractStatus.Active;
        await Assert.ThrowsAsync<ContractException>(() => r.Service.RenewAsync(c.Id, new(c.EndDate, 1, "terms"), Guid.NewGuid(), default));
        var next = await r.Service.RenewAsync(c.Id, new(c.EndDate.AddYears(1), 4000000, "new terms"), Guid.NewGuid(), default);
        await Assert.ThrowsAsync<ContractException>(() => r.Service.ActivateAsync(next.Id, Guid.NewGuid(), default));
        Assert.Equal(ContractStatus.Active, c.Status); Assert.Equal(3000000, c.MonthlyRent);
    }
    [Fact]
    public async Task T10_T11_RequestPreservesActiveContractOwnerApprovesAndStaffCannotApprove()
    {
        var r = new Rig(); var c = await r.Ready(); c.Status = ContractStatus.Active; r.User.Role = Roles.Tenant; r.User.UserId = c.TenantUserId;
        await r.Service.RequestTerminationAsync(c.Id, new(Today, "Synthetic move out"), Guid.NewGuid(), false, default);
        Assert.Equal(ContractStatus.Active, c.Status); Assert.Equal(MoveOutStatus.Requested, r.Moves.Single().Status);
        r.User.Role = Roles.Staff; await Assert.ThrowsAsync<ContractException>(() => r.Service.ApproveTerminationAsync(c.Id, Guid.NewGuid(), default));
        r.User.Role = Roles.Owner; r.User.UserId = c.OwnerSignerId;
        await r.Service.ApproveTerminationAsync(c.Id, Guid.NewGuid(), default); Assert.Equal(MoveOutStatus.Approved, r.Moves.Single().Status);
    }
    [Theory]
    [InlineData(MoveOutStatus.Approved)]
    [InlineData(MoveOutStatus.Inspected)]
    [InlineData(MoveOutStatus.PendingSettlement)]
    [InlineData(MoveOutStatus.Settled)]
    public async Task T12_T13_MissingInspectionCannotReleaseRoom(MoveOutStatus status)
    {
        var r = new Rig(); var c = await r.Ready(); c.Status = ContractStatus.Active; r.Room.Status = RoomStatus.Occupied;
        r.Moves.Add(new() { ContractId = c.Id, Status = status, ProposedDate = Today });
        await Assert.ThrowsAsync<ContractException>(() => r.Service.CompleteAsync(c.Id, new(Today), Guid.NewGuid(), default));
        Assert.Equal(ContractStatus.Active, c.Status); Assert.Equal(RoomStatus.Occupied, r.Room.Status);
    }
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task T14_OwnerReviewedHandoverReleasesPhysicalOccupancyWithUnresolvedFinanceAndPreservesHistory(bool otherActive)
    {
        var r = new Rig(); var c = await r.Ready(); c.Status = ContractStatus.Active; r.Room.Status = RoomStatus.Occupied;
        r.Moves.Add(new()
        {
            ContractId = c.Id,
            Status = MoveOutStatus.PendingSettlement,
            ProposedDate = Today,
            InspectedAt = new Clock().GetUtcNow(),
            ElectricityReadingId = Guid.NewGuid(),
            WaterReadingId = Guid.NewGuid(),
            SettlementLedgerReference = "verified-synthetic-ledger"
        });
        r.Ledger.ReadAsync(default, default, default, default).ReturnsForAnyArgs(new SettlementLedgerState(false, false, false, ""));
        var image = Encoding.UTF8.GetBytes("synthetic private meter image");
        var imageHash = Convert.ToHexString(SHA256.HashData(image));
        var move = r.Moves.Single();
        var electricity = new HandoverReading(move.ElectricityReadingId!.Value, "E-SYN", 0, Today, 120, Guid.NewGuid(), "private/e", imageHash);
        var water = new HandoverReading(move.WaterReadingId!.Value, "W-SYN", 1, Today, 30, Guid.NewGuid(), "private/w", imageHash);
        var observed = new HandoverSnapshot(Today, "SYN", "Checked", "Returned", "", [], electricity, water, []);
        r.Repo.FinalInspectionsAsync(c.Id, default).Returns(new[] { new ContractFinalInspection { ContractId = c.Id, OwnerDecision = "Confirmed", ObservedSnapshot = JsonSerializer.Serialize(observed) } });
        r.Repo.FinalReadingsAsync(c.Id, c.RoomId, Today, default).Returns(new[] { electricity, water });
        r.Storage.CopyToAsync(Arg.Any<string>(), Arg.Any<Stream>(), default).Returns(call => call.Arg<Stream>().WriteAsync(image).AsTask());
        r.Repo.HasOtherActiveContractsAsync(c.RoomId, c.Id, default).Returns(otherActive);
        await r.Service.CompleteAsync(c.Id, new(Today), Guid.NewGuid(), default);
        Assert.Equal(ContractStatus.Terminated, c.Status); Assert.Equal(otherActive ? RoomStatus.Occupied : RoomStatus.Available, r.Room.Status);
        Assert.Equal(otherActive ? 1 : 2, r.Room.Version);
        r.Repo.Received(otherActive ? 0 : 1).Add(Arg.Any<PropertyChange>());
        Assert.Equal(Today, c.Residents.Single().ResidenceTo); Assert.Equal(2, c.Signatures.Count);
        await r.Ledger.DidNotReceiveWithAnyArgs().ReadAsync(default, default, default, default);
        await r.Repo.Received(1).CloseResidenceAsync(c, Today, r.User.UserId!.Value, Arg.Any<DateTimeOffset>(), default);
    }
    [Fact]
    public async Task T15_UnconfiguredProviderKeepsPendingSigning()
    {
        var r = new Rig(); var c = await r.Create();
        r.Signing.PrepareAsync(default!, default, default, default).ReturnsForAnyArgs<SigningPreparation>(_ => throw new IntegrationUnavailableException("test-only"));
        await Assert.ThrowsAsync<IntegrationUnavailableException>(() => r.Service.RequestSigningAsync(c.Id, new(Guid.NewGuid()), Guid.NewGuid(), default));
        Assert.Equal(ContractStatus.PendingSigning, c.Status); Assert.Empty(c.Signatures); Assert.Equal(RoomStatus.Available, r.Room.Status);
    }
    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task SIGN03_AmbiguousProviderTimeoutOrNetworkFailureRemainsInManualReviewWithoutResending(bool timeout)
    {
        var r = new Rig(); var c = await r.Create(); var key = Guid.NewGuid(); var input = new SigningInput(Guid.NewGuid());
        var source = "%PDF-1.7 SYNTHETIC PROVIDER BOUNDARY"u8.ToArray();
        r.Signing.PrepareAsync(default!, default, default, default).ReturnsForAnyArgs(new SigningPreparation(
            source, source, "synthetic-field", "synthetic-digest", "synthetic-data-to-sign", "synthetic-chain", "synthetic-user", "synthetic-credential"));
        Exception failure = timeout ? new OperationCanceledException("Synthetic provider timeout") : new HttpRequestException("Synthetic provider outage");
        r.Signing.RequestAsync(default!, default).ReturnsForAnyArgs(Task.FromException<string>(failure));

        await Assert.ThrowsAsync<IntegrationUnavailableException>(() => r.Service.RequestSigningAsync(c.Id, input, key, default));
        var signature = Assert.Single(c.Signatures);
        Assert.Equal(SignatureStatus.ManualReview, signature.Status);
        Assert.Null(signature.SignedAt); Assert.Null(signature.SignedObjectKey); Assert.Null(signature.ProviderReference);
        var replay = await r.Service.RequestSigningAsync(c.Id, input, key, default);
        Assert.Equal(signature.Id, replay.Id); Assert.Equal("ManualReview", replay.Status);
        await r.Signing.Received(1).PrepareAsync(Arg.Any<ContractDocument>(), input.CertificateId, null, Arg.Any<CancellationToken>());
        await r.Signing.Received(1).RequestAsync(Arg.Any<ContractSignature>(), Arg.Any<CancellationToken>());
        Assert.Equal(ContractStatus.PendingSigning, c.Status); Assert.Equal(RoomStatus.Available, r.Room.Status);
    }
    [Fact]
    public async Task SIGN02_AnotherOwnerCannotSignOnBehalfOfEitherContractSigner()
    {
        var r = new Rig(); var c = await r.Create(); r.User.UserId = Guid.NewGuid();
        var error = await Assert.ThrowsAsync<ContractException>(() => r.Service.RequestSigningAsync(c.Id, new(Guid.NewGuid()), Guid.NewGuid(), default));
        Assert.Equal(403, error.Status); Assert.Equal("contract_signer_required", error.Code);
        Assert.Empty(c.Signatures); Assert.Equal(ContractStatus.Draft, c.Status);
        await r.Signing.DidNotReceiveWithAnyArgs().PrepareAsync(default!, default, default, default);
    }
    [Theory]
    [InlineData(Roles.Tenant)]
    [InlineData(Roles.Staff)]
    public async Task T16_OtherTenantOrUnassignedStaffCannotReadContract(string role)
    {
        var r = new Rig(); var c = await r.Create(); r.User.Role = role; r.User.UserId = Guid.NewGuid();
        Assert.Equal(404, (await Assert.ThrowsAsync<ContractException>(() => r.Service.GetAsync(c.Id, default))).Status);
    }
}
