using BHome.Application.Contracts;
using BHome.Application.IdentityAccess;
using BHome.Application.PropertyManagement;
using BHome.Application.Storage;
using BHome.Domain.IdentityAccess;
using BHome.Domain.Locations;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using NSubstitute;

namespace BHome.Application.UnitTests.UnitTestDoc.BF03;

// Dữ liệu và phụ thuộc giả lập cho sheet "BF-03 Onboarding Contract".
// Chỉ dựng dữ liệu theo Điều kiện (Pre-conditions) của sheet; mọi phụ thuộc ngoài ContractService giả lập bằng NSubstitute.
// Cách gọi hàm lấy từ danh mục chữ ký (tên kiểu, hàm, tham số) - không đọc thân hàm.
internal sealed class Bf03ContractWorld
{
    public static readonly DateTimeOffset Now = new(2026, 11, 10, 2, 0, 0, TimeSpan.Zero);
    public static readonly DateOnly Today = DateOnly.FromDateTime(Now.UtcDateTime);

    public readonly Guid OwnerId = Guid.Parse("00000000-0000-0000-0000-000000000101");
    public readonly Guid StaffId = Guid.Parse("00000000-0000-0000-0000-000000000102");
    public readonly Guid TenantId = Guid.Parse("00000000-0000-0000-0000-000000000103");
    public readonly Guid LocationL1 = Guid.Parse("00000000-0000-0000-0000-0000000000a1");

    public readonly Dictionary<Guid, Contract> Contracts = [];
    public readonly Dictionary<Guid, Room> Rooms = [];
    public readonly Dictionary<Guid, Resident> Residents = [];
    public readonly Dictionary<Guid, decimal> VerifiedDeposits = [];
    public readonly List<object> Added = [];
    public readonly HashSet<Guid> AssignedStaff = [];

    // Kho file giả lập (MinIO): object key -> nội dung.
    public readonly Dictionary<string, byte[]> StoredObjects = [];

    public bool PeriodConflict { get; set; }
    public bool HoldingConflict { get; set; }
    public decimal ConfiguredMonthlyRent { get; } = 3500000m;

    public readonly ICurrentUser User = Substitute.For<ICurrentUser>();
    public readonly IStaffLocationAccess StaffLocations = Substitute.For<IStaffLocationAccess>();
    public readonly IContractRepository Repository = Substitute.For<IContractRepository>();
    public readonly IContractSigningProvider Signing = Substitute.For<IContractSigningProvider>();
    public readonly IObjectStorage Storage = Substitute.For<IObjectStorage>();
    public readonly IContractFileStore Files = Substitute.For<IContractFileStore>();
    public readonly IContractImageValidator Images = Substitute.For<IContractImageValidator>();
    public readonly IContractSettlementLedger Settlement = Substitute.For<IContractSettlementLedger>();
    public readonly IContractHoldingLedger Holdings = Substitute.For<IContractHoldingLedger>();
    public readonly IContractDocumentRenderer Renderer = Substitute.For<IContractDocumentRenderer>();
    public readonly IContractWorkflowRepository Workflow = Substitute.For<IContractWorkflowRepository>();
    public readonly IContractHandoverRepository Handovers = Substitute.For<IContractHandoverRepository>();

    public Bf03ContractWorld()
    {
        StaffLocations.IsAssignedAsync(Arg.Any<Guid>(), Arg.Any<Guid>(), Arg.Any<CancellationToken>())
            .Returns(c => AssignedStaff.Contains(c.ArgAt<Guid>(0)) && c.ArgAt<Guid>(1) == LocationL1);

        Repository.FindAsync(Arg.Any<Guid>(), Arg.Any<CancellationToken>())
            .Returns(c => Contracts.GetValueOrDefault(c.ArgAt<Guid>(0)));
        Repository.RoomAsync(Arg.Any<Guid>(), Arg.Any<CancellationToken>())
            .Returns(c => Rooms.GetValueOrDefault(c.ArgAt<Guid>(0)));
        Repository.ResidentsAsync(Arg.Any<Guid>(), Arg.Any<Guid[]>(), Arg.Any<CancellationToken>())
            .Returns(c => (IReadOnlyList<Resident>)Residents.Values
                .Where(r => r.RoomId == c.ArgAt<Guid>(0) && c.ArgAt<Guid[]>(1).Contains(r.Id)).ToList());
        Repository.ActiveUserInRoleAsync(Arg.Any<Guid>(), Arg.Any<string>(), Arg.Any<CancellationToken>()).Returns(true);
        Repository.StaffAssignedAsync(Arg.Any<Guid>(), Arg.Any<Guid>(), Arg.Any<DateOnly>(), Arg.Any<CancellationToken>())
            .Returns(c => AssignedStaff.Contains(c.ArgAt<Guid>(0)) && c.ArgAt<Guid>(1) == LocationL1);
        Repository.ConflictsAsync(Arg.Any<Guid>(), Arg.Any<Guid>(), Arg.Any<DateOnly>(), Arg.Any<DateOnly>(), Arg.Any<Guid[]>(), Arg.Any<CancellationToken>())
            .Returns(_ => PeriodConflict);
        Repository.HoldingConflictAsync(Arg.Any<Guid>(), Arg.Any<Guid>(), Arg.Any<DateOnly>(), Arg.Any<DateOnly>(), Arg.Any<CancellationToken>())
            .Returns(_ => HoldingConflict);
        Repository.HasOtherActiveContractsAsync(Arg.Any<Guid>(), Arg.Any<Guid>(), Arg.Any<CancellationToken>()).Returns(false);
        Repository.OpenRenewalAsync(Arg.Any<Guid>(), Arg.Any<CancellationToken>()).Returns(false);
        Repository.DepositTotalAsync(Arg.Any<Guid>(), Arg.Any<CancellationToken>())
            .Returns(c => VerifiedDeposits.GetValueOrDefault(c.ArgAt<Guid>(0)));
        Repository.MainForHoldingAsync(Arg.Any<Guid>(), Arg.Any<CancellationToken>())
            .Returns(c => Contracts.Values.FirstOrDefault(x => x.Kind != ContractKind.Holding && x.HoldingContractId == c.ArgAt<Guid>(0)));
        Repository.ResolvePricesAsync(Arg.Any<Guid>(), Arg.Any<DateOnly>(), Arg.Any<CancellationToken>())
            .Returns(c => new ResolvedPrices(c.ArgAt<Guid>(0), c.ArgAt<DateOnly>(1), ConfiguredCharges(c.ArgAt<Guid>(0)), []));
        Repository.When(r => r.Add(Arg.Any<object>())).Do(c =>
        {
            var entity = c.Arg<object>();
            Added.Add(entity);
            if (entity is Contract contract)
            {
                // Giống kho dữ liệu thật: khi đọc lại hợp đồng thì có kèm thông tin Phòng.
                contract.Room ??= Rooms.GetValueOrDefault(contract.RoomId)!;
                Contracts[contract.Id] = contract;
            }
        });
        // Mặc định: các truy vấn danh sách trả về danh sách rỗng (không có dữ liệu khác ngoài Điều kiện của từng test).
        Repository.VersionsAsync(Arg.Any<Guid>(), Arg.Any<Guid>(), Arg.Any<CancellationToken>()).Returns(c =>
            (IReadOnlyList<Contract>)Contracts.Values.Where(x => x.RoomId == c.ArgAt<Guid>(0)).ToList());
        Repository.MoveOutHistoryAsync(Arg.Any<Guid>(), Arg.Any<CancellationToken>()).Returns(new List<ContractMoveOutHistory>());
        Repository.FinalInspectionsAsync(Arg.Any<Guid>(), Arg.Any<CancellationToken>()).Returns(new List<ContractFinalInspection>());
        Repository.FinalReadingsAsync(Arg.Any<Guid>(), Arg.Any<Guid>(), Arg.Any<DateOnly>(), Arg.Any<CancellationToken>()).Returns(new List<HandoverReading>());
        Repository.AssignmentsAsync(Arg.Any<Guid>(), Arg.Any<DateOnly>(), Arg.Any<CancellationToken>()).Returns(new List<MoveOutAssignment>());
        Repository.InspectionEvidenceAsync(Arg.Any<Guid>(), Arg.Any<CancellationToken>()).Returns(new List<ContractInspectionEvidence>());
        Repository.SettlementReviewsAsync(Arg.Any<Guid>(), Arg.Any<CancellationToken>()).Returns(new List<ContractSettlementReview>());
        Workflow.TenantAccountsAsync(Arg.Any<CancellationToken>()).Returns(new List<ContractChoice>());
        Workflow.FilesAsync(Arg.Any<Guid>(), Arg.Any<ContractFileKind>(), Arg.Any<CancellationToken>()).Returns(new List<ContractDocumentFile>());
        Workflow.HistoryAsync(Arg.Any<Guid>(), Arg.Any<CancellationToken>()).Returns(new List<ContractHistoryView>());
        Workflow.DepositsAsync(Arg.Any<Guid>(), Arg.Any<CancellationToken>()).Returns(new List<DepositVerificationView>());
        Handovers.AssetsAsync(Arg.Any<Guid>(), Arg.Any<CancellationToken>()).Returns(new List<Asset>());
        Handovers.ReadingsAsync(Arg.Any<Guid>(), Arg.Any<DateOnly>(), Arg.Any<CancellationToken>()).Returns(new List<HandoverReading>());
        Handovers.HistoryAsync(Arg.Any<Guid>(), Arg.Any<CancellationToken>()).Returns(new List<ContractHandoverHistory>());
        Signing.SignerAsync(Arg.Any<CancellationToken>()).Returns((true, "signer"));
        Storage.When(s => s.PutAsync(Arg.Any<string>(), Arg.Any<Stream>(), Arg.Any<long>(), Arg.Any<string>(), Arg.Any<CancellationToken>()))
            .Do(c => { using var copy = new MemoryStream(); c.ArgAt<Stream>(1).CopyTo(copy); StoredObjects[c.ArgAt<string>(0)] = copy.ToArray(); });
        Files.When(s => s.PutAsync(Arg.Any<Guid>(), Arg.Any<string>(), Arg.Any<byte[]>(), Arg.Any<string>(), Arg.Any<CancellationToken>()))
            .Do(c => StoredObjects[c.ArgAt<string>(1)] = c.ArgAt<byte[]>(2));
        Storage.When(s => s.CopyToAsync(Arg.Any<string>(), Arg.Any<Stream>(), Arg.Any<CancellationToken>()))
            .Do(c => { if (StoredObjects.TryGetValue(c.ArgAt<string>(0), out var bytes)) c.ArgAt<Stream>(1).Write(bytes); });
        Renderer.RenderAsync(Arg.Any<ContractDocument>(), Arg.Any<CancellationToken>()).Returns("%PDF-rendered"u8.ToArray());

        RunTransactions<ContractId>();
        RunTransactions<ContractView>();
        RunTransactions<HandoverView>();
        RunTransactions<SignatureView>();
        RunTransactions<ContractDocumentView>();
        RunTransactions<bool>();

        Holdings.ApplyAsync(Arg.Any<Guid>(), Arg.Any<Guid>(), Arg.Any<Guid>(), Arg.Any<Guid>(), Arg.Any<decimal>(), Arg.Any<CancellationToken>())
            .Returns(c =>
            {
                var holding = Contracts[c.ArgAt<Guid>(0)];
                var applied = Math.Min(VerifiedDeposits.GetValueOrDefault(holding.Id), c.ArgAt<decimal>(4));
                return new HoldingDepositApplication(holding.Id, c.ArgAt<Guid>(2), c.ArgAt<Guid>(3), applied, "HOLD-ALLOC-H1");
            });
    }

    private void RunTransactions<T>() =>
        Repository.InTransactionAsync(Arg.Any<Guid>(), Arg.Any<Func<Task<T>>>(), Arg.Any<CancellationToken>())
            .Returns(c => c.ArgAt<Func<Task<T>>>(1)());

    private IReadOnlyList<PolicyDto> ConfiguredCharges(Guid roomId) =>
    [
        new PolicyDto(Guid.NewGuid(), LocationL1, roomId, default, "RENT", "Tien phong", default, ConfiguredMonthlyRent, new DateOnly(2026, 1, 1), null, 1)
    ];

    // Thời điểm "hiện tại" của hệ thống trong test (sheet không quy định; mỗi test chọn ngày hợp với Điều kiện).
    public DateTimeOffset At { get; set; } = Now;

    public ContractService Service() => new(Repository, User, new ResourceAccess(User, StaffLocations), Signing, Storage, Files, Images,
        Settlement, Holdings, new FixedClock(At), Renderer, Workflow, null, Handovers);

    public void LoggedIn(Guid userId, string role)
    {
        User.UserId.Returns(userId);
        User.IsInRole(Arg.Any<string>()).Returns(c => c.Arg<string>() == role);
    }

    public void OwnerLoggedIn() => LoggedIn(OwnerId, Roles.Owner);

    public void StaffAssignedToL1LoggedIn()
    {
        AssignedStaff.Add(StaffId);
        LoggedIn(StaffId, Roles.Staff);
    }

    public void TenantLoggedIn() => LoggedIn(TenantId, Roles.Tenant);

    public Room Room204(RoomStatus status = RoomStatus.Available, int capacity = 2)
    {
        var room = new Room
        {
            LocationId = LocationL1,
            Location = WithId(new Location("L1"), LocationL1),
            RoomNumber = "204",
            Capacity = capacity,
            Status = status
        };
        WithId(room, Guid.Parse("00000000-0000-0000-0000-000000000204"));
        Rooms[room.Id] = room;
        return room;
    }

    public Resident Resident(Room room, string label, ResidentType type, bool verified = true, Guid? tenantUserId = null)
    {
        var resident = new Resident
        {
            RoomId = room.Id,
            Room = room,
            DisplayLabel = label,
            ResidentType = type,
            VerificationStatus = verified ? IdentityVerificationStatus.Verified : IdentityVerificationStatus.Pending,
            OwnerUserId = OwnerId,
            TenantUserId = tenantUserId,
            IdentityData = "{}",
            ConfirmedByUserId = verified ? StaffId : null,
            ConfirmedAt = verified ? Now.AddDays(-1) : null
        };
        WithId(resident, Guid.NewGuid());
        Residents[resident.Id] = resident;
        return resident;
    }

    public Contract Contract(Room room, ContractKind kind, ContractStatus status, Resident representative,
        DateOnly start, DateOnly end, decimal requiredDeposit, params Resident[] coOccupants)
    {
        var contract = new Contract
        {
            RoomId = room.Id,
            Room = room,
            OwnerSignerId = OwnerId,
            TenantUserId = TenantId,
            RepresentativeResidentId = representative.Id,
            Kind = kind,
            Status = status,
            StartDate = start,
            EndDate = end,
            MonthlyRent = ConfiguredMonthlyRent,
            RequiredDeposit = requiredDeposit,
            Terms = "Dieu khoan hop dong",
            SnapshotHash = "SNAPSHOT-HASH",
            DraftMetadata = "{}",
            AgreedPriceSnapshot = "{}"
        };
        WithId(contract, Guid.NewGuid());
        contract.Residents.Add(new ContractResident { ContractId = contract.Id, ResidentId = representative.Id, Role = ResidentType.Representative, ResidenceFrom = start });
        foreach (var co in coOccupants)
            contract.Residents.Add(new ContractResident { ContractId = contract.Id, ResidentId = co.Id, Role = ResidentType.CoOccupant, ResidenceFrom = start });
        Contracts[contract.Id] = contract;
        return contract;
    }

    public static string Sha256(byte[] bytes) => Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(bytes));

    // Chữ ký điện tử kèm bằng chứng: tài liệu chuẩn bị ký và (nếu đã ký) tài liệu đã ký được lưu trong kho file, hash khớp nội dung.
    public ContractSignature Signature(Contract contract, Guid signer, SignatureStatus status)
    {
        var prepared = System.Text.Encoding.UTF8.GetBytes($"%PDF-prepared-{contract.Id}-{signer}");
        var signed = System.Text.Encoding.UTF8.GetBytes($"%PDF-signed-{contract.Id}-{signer}");
        var preparedKey = $"contracts/{contract.Id}/signatures/{signer}/prepared.pdf";
        var signedKey = $"contracts/{contract.Id}/signatures/{signer}/signed.pdf";
        StoredObjects[preparedKey] = prepared;
        if (status == SignatureStatus.Signed) StoredObjects[signedKey] = signed;
        var signature = new ContractSignature
        {
            ContractId = contract.Id,
            SignerUserId = signer,
            CertificateId = Guid.NewGuid(),
            Status = status,
            SnapshotHash = contract.SnapshotHash,
            SourceHash = "SOURCE",
            PreparedHash = Sha256(prepared),
            PreparedObjectKey = preparedKey,
            FieldName = $"sig-{signer}",
            DocumentDigest = "DIGEST",
            DataToSignDigest = "DTS",
            CertificateChain = "CHAIN",
            ProviderUserId = signer.ToString(),
            CredentialId = "CRED",
            ProviderReference = $"REF-{signer}",
            SignedObjectKey = status == SignatureStatus.Signed ? signedKey : null,
            SignedHash = status == SignatureStatus.Signed ? Sha256(signed) : null,
            SignedAt = status == SignatureStatus.Signed ? At.AddHours(-1) : null,
            ExpiresAt = Now.AddDays(3)
        };
        WithId(signature, Guid.NewGuid());
        contract.Signatures.Add(signature);
        return signature;
    }

    // Kiểm tra trạng thái theo cách viết trong sheet ("Pending Deposit" ~ "PendingDeposit"), không phân biệt hoa thường.
    public static bool SameStatus(string? actual, string expected) =>
        Normalize(actual) == Normalize(expected);

    private static string Normalize(string? value) =>
        new string((value ?? "").Where(char.IsLetterOrDigit).ToArray()).ToLowerInvariant();

    // Gọi hàm và ghi nhận việc từ chối. Theo quy ước của sheet ("Exception: N/A" kể cả khi bị từ chối),
    // một ContractException (lỗi nghiệp vụ trả về cho người dùng) được coi là "bị từ chối", không phải lỗi bất ngờ.
    public static async Task<(T? Result, ContractException? Rejection)> Attempt<T>(Func<Task<T>> call)
    {
        try { return (await call(), null); }
        catch (ContractException rejection) { return (default, rejection); }
    }

    public IEnumerable<Contract> AddedContracts => Added.OfType<Contract>();

    // Id của entity chỉ có setter không public: gán qua reflection để dữ liệu thử cố định, dễ đối chiếu.
    public static T WithId<T>(T entity, Guid id) where T : class
    {
        typeof(BHome.Domain.Common.AuditableEntity).GetProperty("Id")!.SetValue(entity, id);
        return entity;
    }
}

internal sealed class FixedClock(DateTimeOffset now) : TimeProvider
{
    public override DateTimeOffset GetUtcNow() => now;
    public override TimeZoneInfo LocalTimeZone => TimeZoneInfo.Utc;
}
