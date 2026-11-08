using BHome.Application.Contracts;
using BHome.Application.IdentityAccess;
using BHome.Application.PropertyManagement;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Domain.Billing;
using NSubstitute;

namespace BHome.Application.UnitTests.UnitTestDoc.BF04;

// Äá»“ng há»“ cá»‘ Ä‘á»‹nh cho test.
internal sealed class BF04Clock(DateTimeOffset now) : TimeProvider
{
    public DateTimeOffset Now { get; set; } = now;
    public override DateTimeOffset GetUtcNow() => Now;
}

// NgÆ°á»i dÃ¹ng hiá»‡n táº¡i cÃ³ thá»ƒ Ä‘á»•i giá»¯a cÃ¡c bÆ°á»›c (Tenant gá»­i yÃªu cáº§u, Owner xÃ¡c nháº­n...).
internal sealed class BF04User : ICurrentUser
{
    public Guid? UserId { get; set; }
    public string Role { get; set; } = "";
    public bool IsInRole(string role) => role == Role;
    public void As(Guid id, string role) { UserId = id; Role = role; }
}

// Kho há»£p Ä‘á»“ng trong bá»™ nhá»›, chá»‰ hiá»‡n thá»±c theo chá»¯ kÃ½ cá»§a IContractRepository (khÃ´ng dá»±a vÃ o code xá»­ lÃ½).
internal sealed class BF04ContractStore : IContractRepository
{
    public Dictionary<Guid, Contract> Contracts { get; } = new();
    public Dictionary<Guid, Room> Rooms { get; } = new();
    public List<Resident> Residents { get; } = new();
    public Dictionary<Guid, ContractMoveOut> MoveOuts { get; } = new();
    public List<ContractMoveOutHistory> MoveOutHistory { get; } = new();
    public List<ContractFinalInspection> FinalInspections { get; } = new();
    public List<ContractSettlementReview> SettlementReviews { get; } = new();
    public List<ContractOperation> Operations { get; } = new();
    public List<object> Added { get; } = new();
    public List<(Guid Actor, string Action, Guid Target)> Audits { get; } = new();
    public decimal DepositTotal { get; set; }

    public Task<ContractPage> ListAsync(ContractListScope scope, int page, int pageSize, Guid? locationId, ContractStatus? status, CancellationToken t) =>
        Task.FromResult(new ContractPage([], page, pageSize, 0));
    public Task<T> InTransactionAsync<T>(Guid roomId, Func<Task<T>> work, CancellationToken t) => work();
    public Task FlushAsync(CancellationToken t) => Task.CompletedTask;
    // Giống CSDL: khi đọc hợp đồng thì nạp kèm phòng (navigation) của hợp đồng.
    public Task<Contract?> FindAsync(Guid id, CancellationToken t)
    {
        var contract = Contracts.GetValueOrDefault(id);
        if (contract is not null && contract.Room is null && Rooms.TryGetValue(contract.RoomId, out var room)) contract.Room = room;
        return Task.FromResult(contract);
    }
    public Task<Room?> RoomAsync(Guid id, CancellationToken t) => Task.FromResult(Rooms.GetValueOrDefault(id));
    public Task<IReadOnlyList<Resident>> ResidentsAsync(Guid roomId, Guid[] ids, CancellationToken t) =>
        Task.FromResult<IReadOnlyList<Resident>>(Residents.Where(r => r.RoomId == roomId && ids.Contains(r.Id)).ToList());
    public Task<bool> ActiveUserInRoleAsync(Guid id, string role, CancellationToken t) => Task.FromResult(true);
    public Task<bool> StaffAssignedAsync(Guid staffId, Guid locationId, DateOnly today, CancellationToken t) => Task.FromResult(true);
    public Task<bool> ConflictsAsync(Guid roomId, Guid exceptId, DateOnly from, DateOnly to, Guid[] residentIds, CancellationToken t) => Task.FromResult(false);
    public Task<bool> HasOtherActiveContractsAsync(Guid roomId, Guid exceptId, CancellationToken t) => Task.FromResult(false);
    public Task<bool> OpenRenewalAsync(Guid contractId, CancellationToken t) =>
        Task.FromResult(Contracts.Values.Any(c => c.PreviousContractId == contractId &&
            c.Status is ContractStatus.Draft or ContractStatus.PendingSigning or ContractStatus.PendingActivation));
    public Task<IReadOnlyList<Contract>> VersionsAsync(Guid roomId, Guid tenantId, CancellationToken t) =>
        Task.FromResult<IReadOnlyList<Contract>>(Contracts.Values.Where(c => c.RoomId == roomId).ToList());
    public Task<IReadOnlyList<ContractMoveOutHistory>> MoveOutHistoryAsync(Guid contractId, CancellationToken t) =>
        Task.FromResult<IReadOnlyList<ContractMoveOutHistory>>(MoveOutHistory.Where(h => h.ContractId == contractId).ToList());
    public Task<IReadOnlyList<ContractFinalInspection>> FinalInspectionsAsync(Guid contractId, CancellationToken t) =>
        Task.FromResult<IReadOnlyList<ContractFinalInspection>>(FinalInspections.Where(f => f.ContractId == contractId).ToList());
    public Task<IReadOnlyList<HandoverReading>> FinalReadingsAsync(Guid contractId, Guid roomId, DateOnly today, CancellationToken t) =>
        Task.FromResult<IReadOnlyList<HandoverReading>>([]);
    public Task<IReadOnlyList<MoveOutAssignment>> AssignmentsAsync(Guid staffId, DateOnly today, CancellationToken t) =>
        Task.FromResult<IReadOnlyList<MoveOutAssignment>>([]);
    public Task<decimal> DepositTotalAsync(Guid contractId, CancellationToken t) => Task.FromResult(DepositTotal);
    public Task<DepositVerification?> BankReferenceAsync(string reference, CancellationToken t) => Task.FromResult<DepositVerification?>(null);
    public Task<ResolvedPrices> ResolvePricesAsync(Guid roomId, DateOnly effectiveOn, CancellationToken t) =>
        Task.FromResult(new ResolvedPrices(roomId, effectiveOn, [], []));
    public Task<bool> HoldingConflictAsync(Guid roomId, Guid exceptId, DateOnly from, DateOnly to, CancellationToken t) => Task.FromResult(false);
    public Task<Contract?> MainForHoldingAsync(Guid holdingId, CancellationToken t) => Task.FromResult<Contract?>(null);
    public Task<ContractMoveOut?> MoveOutAsync(Guid contractId, CancellationToken t) => Task.FromResult(MoveOuts.GetValueOrDefault(contractId));
    public Task<IReadOnlyList<ContractInspectionEvidence>> InspectionEvidenceAsync(Guid contractId, CancellationToken t) =>
        Task.FromResult<IReadOnlyList<ContractInspectionEvidence>>([]);
    public Task<IReadOnlyList<ContractSettlementReview>> SettlementReviewsAsync(Guid contractId, CancellationToken t) =>
        Task.FromResult<IReadOnlyList<ContractSettlementReview>>(SettlementReviews.Where(r => r.ContractId == contractId).ToList());
    public Task<bool> ValidFinalReadingAsync(Guid readingId, Guid contractId, Guid roomId, UtilityType type, DateOnly on, CancellationToken t) => Task.FromResult(true);
    public Task<ContractOperation?> OperationAsync(Guid actorId, Guid key, string operation, CancellationToken t) =>
        Task.FromResult(Operations.FirstOrDefault(o => o.ActorId == actorId && o.Key == key && o.Operation == operation));

    public void Add(object entity)
    {
        Added.Add(entity);
        switch (entity)
        {
            case Contract c: Contracts[c.Id] = c; break;
            case ContractMoveOut m: MoveOuts[m.ContractId] = m; break;
            case ContractMoveOutHistory h: MoveOutHistory.Add(h); break;
            case ContractFinalInspection f: FinalInspections.Add(f); break;
            case ContractSettlementReview r: SettlementReviews.Add(r); break;
            case ContractOperation o: Operations.Add(o); break;
        }
    }

    public void Audit(Guid actorId, string action, Guid targetId, DateTimeOffset at) => Audits.Add((actorId, action, targetId));
}

// Dá»±ng ContractService vá»›i cÃ¡c phá»¥ thuá»™c ngoÃ i Ä‘Æ°á»£c giáº£ láº­p báº±ng NSubstitute.
internal sealed class BF04Contracts
{
    public static readonly Guid OwnerId = Guid.Parse("00000000-0000-0000-0000-000000000101");
    public static readonly Guid StaffId = Guid.Parse("00000000-0000-0000-0000-000000000102");
    public static readonly Guid TenantId = Guid.Parse("00000000-0000-0000-0000-000000000103");
    public static readonly Guid LocationId = Guid.Parse("00000000-0000-0000-0000-0000000000a1");

    public BF04ContractStore Store { get; } = new();
    public BF04User User { get; } = new();
    public BF04Clock Clock { get; }
    public IContractSettlementLedger Ledger { get; } = Substitute.For<IContractSettlementLedger>();
    public IStaffLocationAccess StaffLocations { get; } = Substitute.For<IStaffLocationAccess>();
    public ContractService Service { get; }
    public Room Room { get; }
    public Resident Representative { get; }

    public BF04Contracts(DateTimeOffset now)
    {
        Clock = new BF04Clock(now);
        StaffLocations.IsAssignedAsync(Arg.Any<Guid>(), Arg.Any<Guid>(), Arg.Any<CancellationToken>()).Returns(true);
        var location = new BHome.Domain.Locations.Location("Greenbay House") { IsActive = true };
        Room = new Room { LocationId = location.Id, Location = location, RoomNumber = "101", Capacity = 2, Status = RoomStatus.Occupied };
        Store.Rooms[Room.Id] = Room;
        Representative = new Resident
        {
            RoomId = Room.Id, Room = Room, DisplayLabel = "Tenant t1", ResidentType = ResidentType.Representative,
            VerificationStatus = IdentityVerificationStatus.Verified, OwnerUserId = OwnerId, TenantUserId = TenantId
        };
        Store.Residents.Add(Representative);
        User.As(OwnerId, BHome.Domain.IdentityAccess.Roles.Owner);
        Service = new ContractService(Store, User, new ResourceAccess(User, StaffLocations),
            Substitute.For<IContractSigningProvider>(), Substitute.For<BHome.Application.Storage.IObjectStorage>(),
            Substitute.For<IContractFileStore>(), Substitute.For<IContractImageValidator>(), Ledger,
            Substitute.For<IContractHoldingLedger>(), Clock);
    }

    // Há»£p Ä‘á»“ng thuÃª chÃ­nh M1 (Main) cá»§a Tenant t1 trong phÃ²ng 101.
    public Contract MainContract(ContractStatus status, DateOnly start, DateOnly end, decimal rent = 3_500_000m)
    {
        var contract = new Contract
        {
            RoomId = Room.Id, Room = Room, OwnerSignerId = OwnerId, TenantUserId = TenantId,
            RepresentativeResidentId = Representative.Id, Kind = ContractKind.Main, Status = status,
            StartDate = start, EndDate = end, MonthlyRent = rent, RequiredDeposit = 3_500_000m, Terms = "Main tenancy terms",
            SnapshotHash = "M1-HASH", ActivatedByUserId = status == ContractStatus.Active ? OwnerId : null,
            ActivatedAt = status == ContractStatus.Active ? new DateTimeOffset(start.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero) : null
        };
        contract.Residents.Add(new ContractResident { ContractId = contract.Id, ResidentId = Representative.Id, Role = ResidentType.Representative, ResidenceFrom = start });
        Store.Contracts[contract.Id] = contract;
        Store.DepositTotal = contract.RequiredDeposit;
        return contract;
    }

    public static ContractSignature Signature(Contract contract, Guid signer, SignatureStatus status) => new()
    {
        ContractId = contract.Id, SignerUserId = signer, Status = status,
        SnapshotHash = contract.SnapshotHash, SignedAt = status == SignatureStatus.Signed ? DateTimeOffset.UtcNow : null,
        ExpiresAt = DateTimeOffset.UtcNow.AddDays(7),
        // Bằng chứng ký điện tử (file đã ký, mã băm, tham chiếu nhà cung cấp) khi chữ ký đã hoàn tất.
        SignedObjectKey = status == SignatureStatus.Signed ? $"contracts/{contract.Id}/signatures/{signer}.pdf" : null,
        SignedHash = status == SignatureStatus.Signed ? "SIGNED-HASH-" + signer.ToString("N") : null,
        ProviderReference = status == SignatureStatus.Signed ? "PROVIDER-" + signer.ToString("N") : null
    };
}
