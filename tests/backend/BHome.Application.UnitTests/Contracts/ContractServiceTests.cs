using System.Security.Cryptography;
using System.Text;
using BHome.Application.Common;
using BHome.Application.Contracts;
using BHome.Application.IdentityAccess;
using BHome.Application.Storage;
using BHome.Domain.IdentityAccess;
using BHome.Domain.Locations;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using NSubstitute;

namespace BHome.Application.UnitTests.Contracts;

public sealed class ContractServiceTests
{
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
            Service = new(Repo, User, new ResourceAccess(User, Staff), Signing, Storage, Files, Images, Ledger, Holdings, new Clock());
        }
        public ContractDraftInput Draft => new(Room.Id, User.UserId!.Value, Tenant, Resident.Id, [Resident.Id], Today.AddDays(-10), Today.AddDays(30), 3000000, 3000000, "Synthetic approved terms");
        public async Task<Contract> Create()
        { var id = await Service.CreateAsync(Draft, Guid.NewGuid(), default); return Contracts.Single(c => c.Id == id.Id); }
        public async Task<Contract> Ready()
        {
            var c = await Create(); c.Status = ContractStatus.PendingActivation;
            var bytes = Encoding.UTF8.GetBytes("TEST ONLY verified PDF boundary"); var hash = Convert.ToHexString(SHA256.HashData(bytes));
            foreach (var signer in new[] { c.OwnerSignerId, c.TenantUserId }) c.Signatures.Add(new ContractSignature
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
    [InlineData(RoomStatus.OnHold)]
    [InlineData(RoomStatus.Occupied)]
    [InlineData(RoomStatus.Unavailable)]
    public async Task DraftRequiresAvailableRoomWithoutChangingItsStatus(RoomStatus status)
    {
        var r = new Rig(); r.Room.Status = status;
        var error = await Assert.ThrowsAsync<ContractException>(() => r.Service.CreateAsync(r.Draft, Guid.NewGuid(), default));
        Assert.Equal(409, error.Status);
        Assert.Equal(status, r.Room.Status);
        Assert.Empty(r.Contracts);
        Assert.Empty(r.Operations);
    }

    [Fact]
    public async Task T01_ActivationCommitsContractAndRoomAndReplaysWithoutDuplicateAudit()
    {
        var r = new Rig(); var c = await r.Ready(); var key = Guid.NewGuid();
        await r.Service.ActivateAsync(c.Id, key, default); await r.Service.ActivateAsync(c.Id, key, default);
        Assert.Equal(ContractStatus.Active, c.Status); Assert.Equal(RoomStatus.Occupied, r.Room.Status);
        r.Repo.Received(1).Audit(r.User.UserId!.Value, "ContractActivated", c.Id, Arg.Any<DateTimeOffset>());
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
        if (invalid == "room") r.Repo.ConflictsAsync(default, default, default, default, default).ReturnsForAnyArgs(true);
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
        var r = new Rig(); await Assert.ThrowsAsync<IntegrationUnavailableException>(() => r.Service.CreateAsync(r.Draft with { HoldingContractId = Guid.NewGuid() }, Guid.NewGuid(), default));
        Assert.Empty(r.Contracts); Assert.Empty(r.Deposits);
    }
    [Fact]
    public async Task T06_EligibleHoldingAllocationReducesRemainingDepositExactlyOnce()
    {
        var r = new Rig(); var holdingId = Guid.NewGuid();
        r.Holdings.ApplyAsync(default, default, default, default, default, default).ReturnsForAnyArgs(new HoldingDepositApplication(holdingId, r.Room.Id, r.Tenant, 1000000, "synthetic-allocation"));
        var key = Guid.NewGuid(); var input = r.Draft with { HoldingContractId = holdingId };
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
    public async Task T12_T13_MissingInspectionOrUnresolvedLedgerCannotReleaseRoom(MoveOutStatus status)
    {
        var r = new Rig(); var c = await r.Ready(); c.Status = ContractStatus.Active; r.Room.Status = RoomStatus.Occupied;
        r.Moves.Add(new() { ContractId = c.Id, Status = status, ProposedDate = Today });
        await Assert.ThrowsAsync<ContractException>(() => r.Service.CompleteAsync(c.Id, new(Today), Guid.NewGuid(), default));
        Assert.Equal(ContractStatus.Active, c.Status); Assert.Equal(RoomStatus.Occupied, r.Room.Status);
    }
    [Fact]
    public async Task T14_CompleteRequiresRevalidatedLedgerAndPreservesHistory()
    {
        var r = new Rig(); var c = await r.Ready(); c.Status = ContractStatus.Active; r.Room.Status = RoomStatus.Occupied;
        r.Moves.Add(new()
        {
            ContractId = c.Id,
            Status = MoveOutStatus.Settled,
            ProposedDate = Today,
            InspectedAt = new Clock().GetUtcNow(),
            ElectricityReadingId = Guid.NewGuid(),
            WaterReadingId = Guid.NewGuid(),
            SettlementLedgerReference = "verified-synthetic-ledger"
        });
        r.Ledger.ReadAsync(default, default, default, default).ReturnsForAnyArgs(new SettlementLedgerState(true, true, true, "verified-synthetic-ledger"));
        await r.Service.CompleteAsync(c.Id, new(Today), Guid.NewGuid(), default);
        Assert.Equal(ContractStatus.Terminated, c.Status); Assert.Equal(RoomStatus.Available, r.Room.Status); Assert.Equal(Today, c.Residents.Single().ResidenceTo); Assert.Equal(2, c.Signatures.Count);
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
    [InlineData(Roles.Tenant)]
    [InlineData(Roles.Staff)]
    public async Task T16_OtherTenantOrUnassignedStaffCannotReadContract(string role)
    {
        var r = new Rig(); var c = await r.Create(); r.User.Role = role; r.User.UserId = Guid.NewGuid();
        Assert.Equal(404, (await Assert.ThrowsAsync<ContractException>(() => r.Service.GetAsync(c.Id, default))).Status);
    }
}
