using BHome.Application.Contracts;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using NSubstitute;
using static BHome.Application.UnitTests.UnitTestDoc.BF03.Bf03ContractWorld;

namespace BHome.Application.UnitTests.UnitTestDoc.BF03;

// Unit test cho sheet "BF-03 Onboarding Contract" - các chức năng hợp đồng giữ chỗ, hợp đồng chính, bàn giao nhận phòng.
// Kết quả mong đợi lấy NGUYÊN VĂN từ sheet (căn cứ SRS v1.3: UC-14, UC-15, UC-17, DBR-02, GBR-03/04/05/07/08/13/18, JOB-05).
// Code chỉ dùng để biết cách gọi hàm (ContractService.*). Kho dữ liệu và các phụ thuộc ngoài giả lập bằng NSubstitute (Bf03ContractWorld).
// Quy ước của sheet: các trường hợp bị từ chối vẫn ghi "Exception: N/A"; ở hệ thống này việc từ chối được trả về bằng
// ContractException (mã lỗi cho người dùng), nên test coi ContractException là "bị từ chối" và kiểm tra trạng thái dữ liệu.
// Câu Log Message (MSG02, MSG07, MSG08) không quan sát được ở tầng unit: ContractException chỉ mang mã lỗi, không có câu thông báo.
public sealed class Bf03OnboardingContractUnitTests
{
    private readonly Bf03ContractWorld world = new();

    private static readonly DateOnly MainStart = new(2026, 12, 1);
    private static readonly DateOnly MainEnd = new(2027, 11, 30);
    private static readonly DateTimeOffset HoldingExpiry = new(2026, 11, 17, 0, 0, 0, TimeSpan.Zero);
    private const decimal HoldingDeposit = 1000000m;
    private const decimal SecurityDeposit = 3500000m;

    // ---------------------------------------------------------------- createHoldingContract

    // UTC05 (Normal) - sheet "BF-03 Onboarding Contract", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Staff assigned to L1; Room 204 eligible for holding (Available); prospective Tenant R1 identity and contact information available
    // Đầu vào : room=204; tenant=R1; expiryDate=2026-11-17; holdingDeposit=1000000
    // Mong đợi: Return: Holding Contract draft generated from the configured template and entered terms (status Draft); Room 204 not set to On Hold; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-14 steps 1-4; Contract lifecycle (Draft); UC-14 Postconditions (Room On Hold only after activation)
    // Ghi chú : "generated from the configured template" không quan sát được ở tầng unit (mẫu hợp đồng nằm ở tầng hạ tầng).
    [Fact(DisplayName = "BF03 UTC05 - Tao hop dong giu cho phong 204: Draft, phong chua On Hold")]
    public async Task UTC05_CreateHoldingDraft()
    {
        world.StaffAssignedToL1LoggedIn();
        var room = world.Room204(RoomStatus.Available);
        var r1 = world.Resident(room, "R1", ResidentType.Representative, tenantUserId: world.TenantId);

        var (created, rejection) = await Attempt(() => world.Service().CreateHoldingAsync(
            new HoldingDraftInput(room.Id, world.OwnerId, world.TenantId, r1.Id, [r1.Id], MainStart, MainEnd, HoldingExpiry, HoldingDeposit, "Dieu khoan giu cho"),
            Guid.NewGuid(), default));

        Assert.Null(rejection);
        Assert.NotNull(created);
        var holding = Assert.Single(world.AddedContracts);
        Assert.Equal(created.Id, holding.Id);
        Assert.Equal(ContractKind.Holding, holding.Kind);
        Assert.Equal(ContractStatus.Draft, holding.Status);
        Assert.NotEqual(RoomStatus.OnHold, room.Status);
    }

    // UTC06 (Abnormal) - sheet "BF-03 Onboarding Contract", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Room 204 Occupied under an active Main Tenancy Contract covering the requested period
    // Đầu vào : room=204; contractType=Holding; tenant=R1
    // Mong đợi: Return: Holding Contract not created; Staff must select another eligible Room; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-14 A1; DBR-02
    [Fact(DisplayName = "BF03 UTC06 - Phong 204 dang Occupied: khong tao hop dong giu cho")]
    public async Task UTC06_HoldingOnOccupiedRoomRejected()
    {
        world.StaffAssignedToL1LoggedIn();
        var room = world.Room204(RoomStatus.Occupied);
        var r1 = world.Resident(room, "R1", ResidentType.Representative, tenantUserId: world.TenantId);
        var other = world.Resident(room, "Nguoi thue hien tai", ResidentType.Representative);
        world.Contract(room, ContractKind.Main, ContractStatus.Active, other, new DateOnly(2026, 6, 1), new DateOnly(2027, 12, 31), SecurityDeposit);
        world.PeriodConflict = true;
        world.HoldingConflict = true;

        var (created, _) = await Attempt(() => world.Service().CreateHoldingAsync(
            new HoldingDraftInput(room.Id, world.OwnerId, world.TenantId, r1.Id, [r1.Id], MainStart, MainEnd, HoldingExpiry, HoldingDeposit, "Dieu khoan giu cho"),
            Guid.NewGuid(), default));

        Assert.Null(created);
        Assert.DoesNotContain(world.AddedContracts, c => c.Kind == ContractKind.Holding);
    }

    // UTC07 (Abnormal) - sheet "BF-03 Onboarding Contract", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Staff assigned to L1; Room 204 eligible for holding
    // Đầu vào : room=204; tenant=R1; holdingDeposit=1000000; expiryDate=(empty)
    // Mong đợi: Return: validation error shown on the missing expiry date; Holding Contract remains inactive and is not sent for signing; Exception: N/A; Log Message: "This field is required."
    // Căn cứ  : UC-14 step 2-3, A2; MSG02
    // Ghi chú : expiryDate rỗng = giá trị mặc định (chưa nhập). Log Message MSG02 không quan sát được ở tầng unit.
    [Fact(DisplayName = "BF03 UTC07 - Thieu ngay het han giu cho: loi kiem tra, khong tao, khong gui ky")]
    public async Task UTC07_MissingExpiryDateRejected()
    {
        world.StaffAssignedToL1LoggedIn();
        var room = world.Room204(RoomStatus.Available);
        var r1 = world.Resident(room, "R1", ResidentType.Representative, tenantUserId: world.TenantId);

        var (created, rejection) = await Attempt(() => world.Service().CreateHoldingAsync(
            new HoldingDraftInput(room.Id, world.OwnerId, world.TenantId, r1.Id, [r1.Id], MainStart, MainEnd, default, HoldingDeposit, "Dieu khoan giu cho"),
            Guid.NewGuid(), default));

        Assert.Null(created);
        Assert.NotNull(rejection);
        Assert.DoesNotContain(world.AddedContracts, c => c.Status == ContractStatus.Active);
        await world.Signing.DidNotReceiveWithAnyArgs().RequestAsync(default!, default);
    }

    // "H1 Pending Deposit": trường Status của HoldingDepositStatus là trạng thái của khoản cọc giữ chỗ,
    // nên giá trị "Pending" (cọc đang chờ nộp) hoặc "PendingDeposit" đều diễn đạt đúng "H1 Pending Deposit".
    private static bool PendingDeposit(HoldingDepositStatus deposit) =>
        SameStatus(deposit.Status, "Pending Deposit") || SameStatus(deposit.Status, "Pending");

    // ---------------------------------------------------------------- signHoldingContract

    // H1 được tạo bằng chính chức năng tạo hợp đồng giữ chỗ (Staff), sau đó đặt trạng thái theo Điều kiện của từng test.
    // Thời hạn giữ chỗ: từ hôm nay đến 2026-11-17 (ngày hết hạn trong sheet).
    private async Task<Contract> HoldingH1(Room room, ContractStatus status)
    {
        var r1 = world.Resident(room, "R1", ResidentType.Representative, tenantUserId: world.TenantId);
        world.StaffAssignedToL1LoggedIn();
        var id = await world.Service().CreateHoldingAsync(new HoldingDraftInput(room.Id, world.OwnerId, world.TenantId, r1.Id, [r1.Id],
            Today, DateOnly.FromDateTime(HoldingExpiry.UtcDateTime), HoldingExpiry, HoldingDeposit, "Dieu khoan giu cho"), Guid.NewGuid(), default);
        var h1 = world.Contracts[id.Id];
        world.Added.Clear();
        h1.ApprovedByUserId = world.OwnerId;
        h1.ApprovedAt = world.At.AddHours(-2);
        h1.Status = status;
        return h1;
    }

    private void ProviderReports(ContractSignature signature, string state) =>
        world.Signing.PollAsync(Arg.Is<ContractSignature>(s => s.Id == signature.Id), Arg.Any<byte[]>(), Arg.Any<CancellationToken>())
            .Returns(c => new SigningOutcome(state, state == "Signed" ? c.ArgAt<byte[]>(1) : null));

    // UTC08 (Normal) - sheet "BF-03 Onboarding Contract", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Holding Contract H1 confirmed by Owner and sent for electronic signing
    // Đầu vào : provider signing status: Owner=Signed; Tenant=Signed
    // Mong đợi: Return: signing status and evidence recorded for each signer; Holding Deposit bank-transfer payment request generated; H1 Pending Deposit; Room 204 not yet On Hold; Exception: N/A; Log Message: "Contract signing status has been updated."
    // Căn cứ  : UC-14 steps 6-9; UC-14 Postconditions; ContractSigning entity; GBR-04; PaymentRequest (HOLDING_DEPOSIT); MSG08
    // Ghi chú : "payment request generated" kiểm tra qua tình trạng đặt cọc giữ chỗ (HoldingDepositAsync): còn phải nộp 1,000,000.
    //           Log Message MSG08 không quan sát được ở tầng unit.
    [Fact(DisplayName = "BF03 UTC08 - Ca hai ben da ky: ghi nhan chu ky, cho dat coc, phong chua On Hold")]
    public async Task UTC08_BothPartiesSigned()
    {
        world.OwnerLoggedIn();
        var room = world.Room204(RoomStatus.Available);
        var h1 = await HoldingH1(room, ContractStatus.PendingSigning);
        world.OwnerLoggedIn();
        var owner = world.Signature(h1, world.OwnerId, SignatureStatus.Pending);
        var tenant = world.Signature(h1, world.TenantId, SignatureStatus.Pending);
        ProviderReports(owner, "Signed");
        ProviderReports(tenant, "Signed");

        // Hệ thống đồng bộ trạng thái ký bằng cách hỏi nhà cung cấp định kỳ: mô phỏng 2 lượt hỏi (mỗi bên ký 1 lượt).
        await world.Service().SyncSigningAsync(h1.Id, default);
        var view = await world.Service().SyncSigningAsync(h1.Id, default);
        var deposit = await world.Service().HoldingDepositAsync(h1.Id, default);

        Assert.All(view.Signatures, s => Assert.True(SameStatus(s.Status, "Signed")));
        Assert.All(view.Signatures, s => Assert.NotNull(s.SignedAt));
        Assert.Equal(2, view.Signatures.Count);
        Assert.True(PendingDeposit(deposit), $"Trang thai dat coc giu cho: {deposit.Status}");
        Assert.Equal(HoldingDeposit, deposit.Remaining);
        Assert.NotEqual(ContractStatus.Active, h1.Status);
        Assert.NotEqual(RoomStatus.OnHold, room.Status);
    }

    // UTC09 (Abnormal) - sheet "BF-03 Onboarding Contract", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: H1 sent for electronic signing; Owner has signed
    // Đầu vào : provider signing status: Tenant=Pending
    // Mong đợi: Return: H1 remains inactive (not activated); Room 204 not On Hold; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-14 A3; API-03 Fallback
    [Fact(DisplayName = "BF03 UTC09 - Tenant chua ky: H1 chua hieu luc, phong khong On Hold")]
    public async Task UTC09_TenantSigningPending()
    {
        world.OwnerLoggedIn();
        var room = world.Room204(RoomStatus.Available);
        var h1 = await HoldingH1(room, ContractStatus.PendingSigning);
        world.OwnerLoggedIn();
        world.Signature(h1, world.OwnerId, SignatureStatus.Signed);
        var tenant = world.Signature(h1, world.TenantId, SignatureStatus.Pending);
        ProviderReports(tenant, "Pending");

        var (view, _) = await Attempt(() => world.Service().SyncSigningAsync(h1.Id, default));

        Assert.NotEqual(ContractStatus.Active, h1.Status);
        if (view is not null) Assert.False(SameStatus(view.Status, "Active"));
        Assert.NotEqual(RoomStatus.OnHold, room.Status);
    }

    // ---------------------------------------------------------------- activateHoldingContract

    // UTC10 (Normal) - sheet "BF-03 Onboarding Contract", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: H1 signed by Owner and Tenant, Pending Deposit; Room 204 Available
    // Đầu vào : bank transfer 1000000 with H1 payment code reconciled and verified
    // Mong đợi: Return: H1 Active; Room 204 On Hold; signing and payment evidence retained; confirmation notification initiated; activation actor and timestamp retained; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-14 steps 10-12 and Postconditions; BF-03 end condition; GBR-13
    // Ghi chú : "Pending Deposit" dựng bằng trạng thái hợp đồng PendingActivation (đã ký, chờ điều kiện kích hoạt).
    //           "confirmation notification initiated" không quan sát được ở tầng unit (ContractService không nhận dịch vụ thông báo).
    [Fact(DisplayName = "BF03 UTC10 - Da xac minh coc giu cho: H1 Active, phong 204 On Hold")]
    public async Task UTC10_VerifiedDepositActivatesHolding()
    {
        world.OwnerLoggedIn();
        var room = world.Room204(RoomStatus.Available);
        var h1 = await HoldingH1(room, ContractStatus.PendingActivation);
        world.OwnerLoggedIn();
        world.Signature(h1, world.OwnerId, SignatureStatus.Signed);
        world.Signature(h1, world.TenantId, SignatureStatus.Signed);
        world.VerifiedDeposits[h1.Id] = HoldingDeposit;

        var view = await world.Service().ActivateHoldingAsync(h1.Id, Guid.NewGuid(), default);

        Assert.True(SameStatus(view.Status, "Active"), $"Trang thai H1: {view.Status}");
        Assert.Equal(RoomStatus.OnHold, room.Status);
        Assert.Equal(2, h1.Signatures.Count(s => s.Status == SignatureStatus.Signed));
        Assert.Equal(HoldingDeposit, world.VerifiedDeposits[h1.Id]);
        Assert.True(h1.ActivatedByUserId == world.OwnerId || h1.LifecycleActorId == world.OwnerId, "Phai luu nguoi kich hoat");
        Assert.True(h1.ActivatedAt is not null || h1.LifecycleAt is not null, "Phai luu thoi diem kich hoat");
    }

    // UTC11 (Abnormal) - sheet "BF-03 Onboarding Contract", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: H1 signed, Pending Deposit; holding expiry not reached
    // Đầu vào : no bank transfer verified for H1 (transaction under Manual Review)
    // Mong đợi: Return: H1 remains Pending Deposit; Room 204 not actively held (not On Hold); Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-14 Postconditions; UC-14 A6; BF-03 end condition
    [Fact(DisplayName = "BF03 UTC11 - Chua xac minh coc: H1 van cho dat coc, phong khong On Hold")]
    public async Task UTC11_NoVerifiedDepositKeepsHoldingPending()
    {
        world.OwnerLoggedIn();
        var room = world.Room204(RoomStatus.Available);
        var h1 = await HoldingH1(room, ContractStatus.PendingActivation);
        world.OwnerLoggedIn();
        world.Signature(h1, world.OwnerId, SignatureStatus.Signed);
        world.Signature(h1, world.TenantId, SignatureStatus.Signed);
        world.VerifiedDeposits[h1.Id] = 0m;

        await Attempt(() => world.Service().ActivateHoldingAsync(h1.Id, Guid.NewGuid(), default));
        var deposit = await world.Service().HoldingDepositAsync(h1.Id, default);

        Assert.NotEqual(ContractStatus.Active, h1.Status);
        Assert.True(PendingDeposit(deposit), $"Trang thai dat coc giu cho: {deposit.Status}");
        Assert.NotEqual(RoomStatus.OnHold, room.Status);
    }

    // ---------------------------------------------------------------- closeHoldingContract

    // UTC12 (Normal) - sheet "BF-03 Onboarding Contract", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: H1 Active, Room 204 On Hold; holding expiry date has passed; no other valid holding obligation on Room 204
    // Đầu vào : JOB-05 scheduled expiry check runs
    // Mong đợi: Return: H1 Expired; Room 204 released from On Hold; existing payment history preserved; Exception: N/A; Log Message: N/A
    // Căn cứ  : JOB-05; UC-14 A7, A8; BF-03 end condition
    // Ghi chú : danh mục chữ ký tầng Application không có hàm hết hạn hợp đồng giữ chỗ (JOB-05). Ứng viên duy nhất là
    //           ContractExpiryProcessor (tầng hạ tầng, cần database thật) - không kiểm tra được ở tầng unit.
    [Fact(DisplayName = "BF03 UTC12 - JOB-05 het han giu cho: H1 Expired, nha phong")]
    public void UTC12_HoldingExpiryJob() =>
        Assert.Fail("Chưa tìm thấy chức năng closeHoldingContract (JOB-05 hết hạn giữ chỗ) trong hệ thống (danh mục chữ ký)");

    // UTC13 (Abnormal) - sheet "BF-03 Onboarding Contract", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: H1 already Expired by JOB-05; Room 204 already released
    // Đầu vào : JOB-05 runs again
    // Mong đợi: Return: H1 not expired again; Room 204 not released again; no duplicate notification; Exception: N/A; Log Message: N/A
    // Căn cứ  : JOB-05 Failure/Idempotency; GBR-18; NFR IV.2.2 Idempotency
    [Fact(DisplayName = "BF03 UTC13 - JOB-05 chay lai: khong xu ly trung")]
    public void UTC13_HoldingExpiryJobIdempotent() =>
        Assert.Fail("Chưa tìm thấy chức năng closeHoldingContract (JOB-05 hết hạn giữ chỗ) trong hệ thống (danh mục chữ ký)");

    // UTC14 (Normal) - sheet "BF-03 Onboarding Contract", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: H1 Pending Deposit; Room 204 not On Hold
    // Đầu vào : contract=H1; action=cancel; reason="Tenant changed mind"
    // Mong đợi: Return: H1 Cancelled; Room 204 not held; cancellation actor, time and reason retained; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-14 A7, A8; BF-03 end condition (Expired/Cancelled without active Room hold); GBR-13. Actor allowed to cancel not stated (see open questions)
    // Ghi chú : SRS không nêu ai được hủy - test dùng Owner.
    [Fact(DisplayName = "BF03 UTC14 - Huy hop dong giu cho: Cancelled, luu nguoi/thoi diem/ly do")]
    public async Task UTC14_CancelHolding()
    {
        world.OwnerLoggedIn();
        var room = world.Room204(RoomStatus.Available);
        var h1 = await HoldingH1(room, ContractStatus.PendingActivation);
        world.OwnerLoggedIn();
        world.Signature(h1, world.OwnerId, SignatureStatus.Signed);
        world.Signature(h1, world.TenantId, SignatureStatus.Signed);

        var view = await world.Service().CancelHoldingAsync(h1.Id, new HoldingDecisionInput("Tenant changed mind"), Guid.NewGuid(), default);

        Assert.True(SameStatus(view.Status, "Cancelled"), $"Trang thai H1: {view.Status}");
        Assert.NotEqual(RoomStatus.OnHold, room.Status);
        Assert.Equal(world.OwnerId, h1.LifecycleActorId);
        Assert.NotNull(h1.LifecycleAt);
        Assert.Equal("Tenant changed mind", h1.LifecycleReason);
    }

    // ---------------------------------------------------------------- createMainContract

    // UTC15 (Normal) - sheet "BF-03 Onboarding Contract", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Staff assigned to L1; Room 204 eligible; R1 verified; rent, utility rates and fees configured for Room 204
    // Đầu vào : startDate=2026-12-01; endDate=2027-11-30; representative=R1; coOccupants=R2
    // Mong đợi: Return: Main Tenancy Contract generated (Draft) with the configured rent, utility rates and fees applied; R1 recorded as representative Tenant and R2 as a separately stored co-occupant; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-15 steps 1, 3-7; GBR-05; GBR-08
    // Ghi chú : giá điện/nước/phí không có trên đối tượng Contract - chỉ kiểm tra được tiền phòng theo cấu hình.
    [Fact(DisplayName = "BF03 UTC15 - Tao hop dong chinh: Draft, gia theo cau hinh, R1 dai dien, R2 o cung")]
    public async Task UTC15_CreateMainContractDraft()
    {
        world.StaffAssignedToL1LoggedIn();
        var room = world.Room204(RoomStatus.Available, capacity: 2);
        var r1 = world.Resident(room, "R1", ResidentType.Representative, tenantUserId: world.TenantId);
        var r2 = world.Resident(room, "R2", ResidentType.CoOccupant);

        var (created, rejection) = await Attempt(() => world.Service().CreateAsync(
            new ContractDraftInput(room.Id, world.OwnerId, world.TenantId, r1.Id, [r1.Id, r2.Id], MainStart, MainEnd,
                world.ConfiguredMonthlyRent, SecurityDeposit, "Dieu khoan hop dong chinh"), Guid.NewGuid(), default));

        Assert.Null(rejection);
        Assert.NotNull(created);
        var main = Assert.Single(world.AddedContracts);
        Assert.Equal(ContractKind.Main, main.Kind);
        Assert.Equal(ContractStatus.Draft, main.Status);
        Assert.Equal(world.ConfiguredMonthlyRent, main.MonthlyRent);
        Assert.Equal(r1.Id, main.RepresentativeResidentId);
        Assert.Contains(main.Residents, x => x.ResidentId == r1.Id && x.Role == ResidentType.Representative);
        Assert.Contains(main.Residents, x => x.ResidentId == r2.Id && x.Role == ResidentType.CoOccupant);
    }

    // UTC16 (Boundary) - sheet "BF-03 Onboarding Contract", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Room 204 Capacity (maximum supported occupants) = 2
    // Đầu vào : representative=R1; coOccupants=R2, R3 (3 occupants)
    // Mong đợi: Return: validation error, contract information invalid; signing process not started; Exception: N/A; Log Message: N/A
    // Căn cứ  : FE-01 1.1.1 Capacity = Maximum supported occupants; UC-15 A1
    [Fact(DisplayName = "BF03 UTC16 - 3 nguoi o phong suc chua 2: loi kiem tra, khong bat dau ky")]
    public async Task UTC16_OccupantsOverCapacity()
    {
        world.StaffAssignedToL1LoggedIn();
        var room = world.Room204(RoomStatus.Available, capacity: 2);
        var r1 = world.Resident(room, "R1", ResidentType.Representative, tenantUserId: world.TenantId);
        var r2 = world.Resident(room, "R2", ResidentType.CoOccupant);
        var r3 = world.Resident(room, "R3", ResidentType.CoOccupant);

        var (created, rejection) = await Attempt(() => world.Service().CreateAsync(
            new ContractDraftInput(room.Id, world.OwnerId, world.TenantId, r1.Id, [r1.Id, r2.Id, r3.Id], MainStart, MainEnd,
                world.ConfiguredMonthlyRent, SecurityDeposit, "Dieu khoan hop dong chinh"), Guid.NewGuid(), default));

        Assert.Null(created);
        Assert.NotNull(rejection);
        Assert.Empty(world.AddedContracts);
        await world.Signing.DidNotReceiveWithAnyArgs().RequestAsync(default!, default);
    }

    // UTC17 (Abnormal) - sheet "BF-03 Onboarding Contract", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Main Tenancy Contract M1 Active on Room 204 from 2026-12-01 to 2027-11-30
    // Đầu vào : room=204; startDate=2027-06-01; endDate=2028-05-31
    // Mong đợi: Return: Contract not created (conflicting active Contract for the same period); Exception: N/A; Log Message: N/A
    // Căn cứ  : DBR-02; UC-15 A1. Same-day end/start boundary not defined (see open questions)
    [Fact(DisplayName = "BF03 UTC17 - Trung thoi gian voi hop dong M1 dang hieu luc: khong tao")]
    public async Task UTC17_OverlappingActiveContract()
    {
        world.StaffAssignedToL1LoggedIn();
        var room = world.Room204(RoomStatus.Occupied, capacity: 2);
        var m1Tenant = world.Resident(room, "Nguoi thue M1", ResidentType.Representative);
        world.Contract(room, ContractKind.Main, ContractStatus.Active, m1Tenant, MainStart, MainEnd, SecurityDeposit);
        var r1 = world.Resident(room, "R1", ResidentType.Representative, tenantUserId: world.TenantId);
        world.PeriodConflict = true;

        var (created, _) = await Attempt(() => world.Service().CreateAsync(
            new ContractDraftInput(room.Id, world.OwnerId, world.TenantId, r1.Id, [r1.Id], new DateOnly(2027, 6, 1), new DateOnly(2028, 5, 31),
                world.ConfiguredMonthlyRent, SecurityDeposit, "Dieu khoan hop dong chinh"), Guid.NewGuid(), default));

        Assert.Null(created);
        Assert.Empty(world.AddedContracts);
    }

    // UTC18 (Abnormal) - sheet "BF-03 Onboarding Contract", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Holding Contract H1 already Converted into Main Tenancy Contract M2
    // Đầu vào : start Main Tenancy Contract from holdingContract=H1
    // Mong đợi: Return: H1 not accepted as a valid Holding Contract; no new Main Tenancy Contract created from H1; Holding Deposit not applied again; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-15 Preconditions (valid Holding Contract); Contract lifecycle (Converted); GBR-18
    [Fact(DisplayName = "BF03 UTC18 - H1 da chuyen thanh M2: khong tao them hop dong, khong ap coc lan nua")]
    public async Task UTC18_ConvertedHoldingNotReused()
    {
        world.StaffAssignedToL1LoggedIn();
        var room = world.Room204(RoomStatus.Available, capacity: 2);
        var h1 = await HoldingH1(room, ContractStatus.Converted);
        room.Status = RoomStatus.OnHold;
        world.StaffAssignedToL1LoggedIn();
        var r1 = world.Residents[h1.RepresentativeResidentId];
        var m2 = world.Contract(room, ContractKind.Main, ContractStatus.Draft, r1, MainStart, MainEnd, SecurityDeposit);
        m2.HoldingContractId = h1.Id;
        m2.AppliedHoldingDeposit = HoldingDeposit;
        h1.ConvertedMainContractId = m2.Id;
        world.VerifiedDeposits[h1.Id] = HoldingDeposit;

        var (created, _) = await Attempt(() => world.Service().ConvertHoldingAsync(h1.Id, new HoldingConversionInput(SecurityDeposit), Guid.NewGuid(), default));

        Assert.True(created is null || created.Id == m2.Id, "Khong duoc tao hop dong chinh moi tu H1");
        Assert.Empty(world.AddedContracts);
        await world.Holdings.DidNotReceiveWithAnyArgs().ApplyAsync(default, default, default, default, default, default);
    }

    // ---------------------------------------------------------------- activateMainContract

    // UTC19 (Normal) - sheet "BF-03 Onboarding Contract", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: M2 created from Active H1 with verified Holding Deposit 1,000,000; required Security Deposit 3,500,000; Owner and Tenant signed M2
    // Đầu vào : contract=M2
    // Mong đợi: Return: 1,000,000 applied toward the Security Deposit; remaining initial payment request of 2,500,000 generated; M2 retains reference to H1; H1 Converted; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-15 steps 2, 11-12, A5; SecurityDeposit entity (applied Holding Deposit, remaining amount); Contract business identity; BF-03 end condition
    // Ghi chú : M2 được tạo từ H1 bằng ConvertHoldingAsync (cọc giữ chỗ chuyển sang M2); số còn phải nộp kiểm tra qua ReadinessAsync(M2).
    [Fact(DisplayName = "BF03 UTC19 - Chuyen H1 sang M2: ap 1,000,000 vao coc, con phai nop 2,500,000, H1 Converted")]
    public async Task UTC19_HoldingDepositAppliedToMainContract()
    {
        world.StaffAssignedToL1LoggedIn();
        var room = world.Room204(RoomStatus.Available, capacity: 2);
        var h1 = await HoldingH1(room, ContractStatus.Active);
        room.Status = RoomStatus.OnHold;
        world.StaffAssignedToL1LoggedIn();
        world.Signature(h1, world.OwnerId, SignatureStatus.Signed);
        world.Signature(h1, world.TenantId, SignatureStatus.Signed);
        world.VerifiedDeposits[h1.Id] = HoldingDeposit;

        var m2Id = await world.Service().ConvertHoldingAsync(h1.Id, new HoldingConversionInput(SecurityDeposit), Guid.NewGuid(), default);
        var m2 = world.Contracts[m2Id.Id];
        world.Signature(m2, world.OwnerId, SignatureStatus.Signed);
        world.Signature(m2, world.TenantId, SignatureStatus.Signed);
        world.OwnerLoggedIn();
        var readiness = await world.Service().ReadinessAsync(m2.Id, default);

        Assert.Equal(h1.Id, m2.HoldingContractId);
        Assert.Equal(HoldingDeposit, m2.AppliedHoldingDeposit);
        Assert.Equal(2500000m, readiness.RemainingDeposit);
        Assert.Equal(ContractStatus.Converted, h1.Status);
    }

    // Hợp đồng chính được tạo bằng chính chức năng tạo hợp đồng (Staff), sau đó dựng Điều kiện: đã gửi ký, chữ ký, tiền cọc đã xác minh.
    // Thời điểm Owner xác nhận kích hoạt: ngày bắt đầu hợp đồng 2026-12-01 (sheet không quy định ngày kích hoạt).
    private async Task<Contract> MainM2(Room room, Resident representative, SignatureStatus tenantSignature, decimal verifiedDeposit)
    {
        world.StaffAssignedToL1LoggedIn();
        var id = await world.Service().CreateAsync(new ContractDraftInput(room.Id, world.OwnerId, world.TenantId, representative.Id, [representative.Id],
            MainStart, MainEnd, world.ConfiguredMonthlyRent, SecurityDeposit, "Dieu khoan hop dong chinh"), Guid.NewGuid(), default);
        var m2 = world.Contracts[id.Id];
        world.Added.Clear();
        world.At = new DateTimeOffset(2026, 12, 1, 2, 0, 0, TimeSpan.Zero);
        m2.Status = ContractStatus.PendingActivation;
        world.Signature(m2, world.OwnerId, SignatureStatus.Signed);
        world.Signature(m2, world.TenantId, tenantSignature);
        world.VerifiedDeposits[m2.Id] = verifiedDeposit;
        world.OwnerLoggedIn();
        return m2;
    }

    // UTC20 (Normal) - sheet "BF-03 Onboarding Contract", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: M2 signed by Owner and Tenant; Tenant information verified; initial payment verified (Security Deposit Received)
    // Đầu vào : Owner confirms activation of M2
    // Mong đợi: Return: M2 Active; Room 204 Occupied; Tenant account created or linked; Contract/account information sent; activation actor and timestamp retained; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-15 steps 15-16 and Postconditions; BF-03 end condition; GBR-03; GBR-13
    // Ghi chú : "Contract/account information sent" không quan sát được ở tầng unit (ContractService không nhận dịch vụ thông báo).
    [Fact(DisplayName = "BF03 UTC20 - Owner kich hoat M2 du dieu kien: Active, phong Occupied, luu nguoi/thoi diem")]
    public async Task UTC20_OwnerActivatesMainContract()
    {
        world.OwnerLoggedIn();
        var room = world.Room204(RoomStatus.Available, capacity: 2);
        var r1 = world.Resident(room, "R1", ResidentType.Representative, tenantUserId: world.TenantId);
        var m2 = await MainM2(room, r1, SignatureStatus.Signed, SecurityDeposit);

        var view = await world.Service().ActivateAsync(m2.Id, Guid.NewGuid(), default);

        Assert.True(SameStatus(view.Status, "Active"), $"Trang thai M2: {view.Status}");
        Assert.Equal(RoomStatus.Occupied, room.Status);
        Assert.NotNull(view.TenantUserId);
        Assert.Equal(world.OwnerId, m2.ActivatedByUserId);
        Assert.NotNull(m2.ActivatedAt);
    }

    // UTC21 (Abnormal) - sheet "BF-03 Onboarding Contract", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: M2 signed by Owner; Tenant signing Pending
    // Đầu vào : Owner confirms activation of M2
    // Mong đợi: Return: activation prevented; M2 remains awaiting signing; Room 204 not Occupied; Owner informed of unresolved conditions; Exception: N/A; Log Message: "Required signing or payment conditions are incomplete."
    // Căn cứ  : UC-15 A2, A4; API-03 Fallback; MSG07
    // Ghi chú : "Owner informed of unresolved conditions" kiểm tra qua ReadinessAsync (danh sách điều kiện chưa đạt). MSG07 không quan sát được ở tầng unit.
    [Fact(DisplayName = "BF03 UTC21 - Tenant chua ky M2: khong kich hoat, phong khong Occupied")]
    public async Task UTC21_TenantNotSignedBlocksActivation()
    {
        world.OwnerLoggedIn();
        var room = world.Room204(RoomStatus.Available, capacity: 2);
        var r1 = world.Resident(room, "R1", ResidentType.Representative, tenantUserId: world.TenantId);
        var m2 = await MainM2(room, r1, SignatureStatus.Pending, SecurityDeposit);

        var (view, _) = await Attempt(() => world.Service().ActivateAsync(m2.Id, Guid.NewGuid(), default));
        var readiness = await world.Service().ReadinessAsync(m2.Id, default);

        Assert.Null(view);
        Assert.NotEqual(ContractStatus.Active, m2.Status);
        Assert.NotEqual(RoomStatus.Occupied, room.Status);
        Assert.False(readiness.Ready);
        Assert.NotEmpty(readiness.Blockers);
    }

    // UTC22 (Abnormal) - sheet "BF-03 Onboarding Contract", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: M2 signed by Owner and Tenant; remaining Security Deposit 2,500,000 not yet verified
    // Đầu vào : Owner confirms activation of M2
    // Mong đợi: Return: activation prevented; M2 remains pending; Room 204 not Occupied; Tenant account not activated; Exception: N/A; Log Message: "Required signing or payment conditions are incomplete."
    // Căn cứ  : BF-03 end condition (payment not fully verified -> contract remains pending); UC-15 A4; MSG07
    // Ghi chú : "Tenant account not activated" và MSG07 không quan sát được ở tầng unit.
    [Fact(DisplayName = "BF03 UTC22 - Con thieu 2,500,000 tien coc: khong kich hoat M2")]
    public async Task UTC22_DepositNotFullyVerifiedBlocksActivation()
    {
        world.OwnerLoggedIn();
        var room = world.Room204(RoomStatus.Available, capacity: 2);
        var r1 = world.Resident(room, "R1", ResidentType.Representative, tenantUserId: world.TenantId);
        var m2 = await MainM2(room, r1, SignatureStatus.Signed, HoldingDeposit);

        var (view, _) = await Attempt(() => world.Service().ActivateAsync(m2.Id, Guid.NewGuid(), default));
        var readiness = await world.Service().ReadinessAsync(m2.Id, default);

        Assert.Null(view);
        Assert.NotEqual(ContractStatus.Active, m2.Status);
        Assert.NotEqual(RoomStatus.Occupied, room.Status);
        Assert.False(readiness.Ready);
        Assert.NotEmpty(readiness.Blockers);
    }

    // UTC23 (Abnormal) - sheet "BF-03 Onboarding Contract", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: M3 signed by all parties and initial payment verified; representative Tenant R3 identity not Staff-verified (OCR proposal only)
    // Đầu vào : Owner confirms activation of M3
    // Mong đợi: Return: activation prevented; Owner informed of the unresolved condition (Tenant information not verified); Room not Occupied; Exception: N/A; Log Message: N/A
    // Căn cứ  : BF-03 end condition (activated after Tenant information is verified); GBR-07; UC-15 A4
    [Fact(DisplayName = "BF03 UTC23 - Nguoi dai dien R3 chua duoc Staff xac minh: khong kich hoat M3")]
    public async Task UTC23_UnverifiedRepresentativeBlocksActivation()
    {
        world.OwnerLoggedIn();
        var room = world.Room204(RoomStatus.Available, capacity: 2);
        var r3 = world.Resident(room, "R3", ResidentType.Representative, tenantUserId: world.TenantId);
        var m3 = await MainM2(room, r3, SignatureStatus.Signed, SecurityDeposit);
        // R3 chỉ có đề xuất OCR, chưa được Staff xác minh.
        r3.VerificationStatus = IdentityVerificationStatus.Pending;
        r3.ConfirmedByUserId = null;
        r3.ConfirmedAt = null;

        var (view, _) = await Attempt(() => world.Service().ActivateAsync(m3.Id, Guid.NewGuid(), default));
        var readiness = await world.Service().ReadinessAsync(m3.Id, default);

        Assert.Null(view);
        Assert.NotEqual(ContractStatus.Active, m3.Status);
        Assert.NotEqual(RoomStatus.Occupied, room.Status);
        Assert.False(readiness.Ready);
        Assert.NotEmpty(readiness.Blockers);
    }

    // ---------------------------------------------------------------- recordMoveInHandover

    private readonly Guid electricityReading = Guid.NewGuid();
    private readonly Guid waterReading = Guid.NewGuid();
    private readonly Guid[] assetIds = [Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid()];
    private readonly List<Guid> photoIds = [];
    private ContractHandover? savedHandover;

    // Điều kiện chung UC-17: M2 Active (hiệu lực từ hôm nay); Staff assigned L1; Room 204 có 3 tài sản;
    // có chỉ số ĐIỆN, NƯỚC ban đầu kèm ảnh bằng chứng (lưu trong kho file, hash khớp nội dung).
    private async Task<Contract> MoveInSetup()
    {
        var room = world.Room204(RoomStatus.Available, capacity: 2);
        var r1 = world.Resident(room, "R1", ResidentType.Representative, tenantUserId: world.TenantId);
        world.StaffAssignedToL1LoggedIn();
        var id = await world.Service().CreateAsync(new ContractDraftInput(room.Id, world.OwnerId, world.TenantId, r1.Id, [r1.Id],
            Today, Today.AddYears(1).AddDays(-1), world.ConfiguredMonthlyRent, SecurityDeposit, "Dieu khoan hop dong chinh"), Guid.NewGuid(), default);
        var m2 = world.Contracts[id.Id];
        m2.Status = ContractStatus.Active;
        m2.ActivatedAt = world.At.AddHours(-1);
        m2.ActivatedByUserId = world.OwnerId;
        room.Status = RoomStatus.Occupied;

        var names = new[] { "Tu lanh", "May lanh", "Giuong" };
        IReadOnlyList<Asset> assets = assetIds.Select((assetId, i) => WithId(new Asset
        {
            LocationId = world.LocationL1, RoomId = room.Id, Code = $"A-{i + 1}", Name = names[i], Category = "Noi that",
            Condition = "Tot", Status = AssetStatus.Active, Version = 1
        }, assetId)).ToList();
        world.Handovers.AssetsAsync(room.Id, Arg.Any<CancellationToken>()).Returns(assets);

        byte[] elecPhoto = [0xFF, 0xD8, 0x01], waterPhoto = [0xFF, 0xD8, 0x02];
        world.StoredObjects["meter-evidence/dien-204"] = elecPhoto;
        world.StoredObjects["meter-evidence/nuoc-204"] = waterPhoto;
        var readings = new List<HandoverReading>
        {
            new(electricityReading, "DIEN-204", 0, Today, 1250m, Guid.NewGuid(), "meter-evidence/dien-204", Sha256(elecPhoto)),
            new(waterReading, "NUOC-204", 1, Today, 310m, Guid.NewGuid(), "meter-evidence/nuoc-204", Sha256(waterPhoto))
        };
        world.Handovers.ReadingsAsync(room.Id, Arg.Any<DateOnly>(), Arg.Any<CancellationToken>()).Returns(readings);
        world.Handovers.ReadingAsync(room.Id, Arg.Any<Guid>(), Arg.Any<CancellationToken>())
            .Returns(c => readings.FirstOrDefault(r => r.Id == c.ArgAt<Guid>(1)));
        world.Handovers.GetAsync(m2.Id, Arg.Any<CancellationToken>()).Returns(_ => savedHandover);
        world.Handovers.HistoryAsync(m2.Id, Arg.Any<CancellationToken>()).Returns(_ =>
            (IReadOnlyList<ContractHandoverHistory>)world.Added.OfType<ContractHandoverHistory>().ToList());
        world.Repository.When(r => r.Add(Arg.Any<object>())).Do(c =>
        {
            if (c.Arg<object>() is ContractHandover handover) savedHandover = handover;
        });

        // Ảnh tình trạng 3 tài sản: Staff tải lên bằng chức năng tải bằng chứng bàn giao.
        world.Images.Validate(Arg.Any<byte[]>()).Returns("image/jpeg");
        world.Workflow.FileAsync(m2.Id, Arg.Any<Guid>(), Arg.Any<CancellationToken>())
            .Returns(c => world.Added.OfType<ContractDocumentFile>().FirstOrDefault(x => x.Id == c.ArgAt<Guid>(1)));
        world.Workflow.FilesAsync(m2.Id, ContractFileKind.HandoverEvidence, Arg.Any<CancellationToken>())
            .Returns(_ => (IReadOnlyList<ContractDocumentFile>)world.Added.OfType<ContractDocumentFile>().ToList());
        for (var i = 0; i < 3; i++)
            photoIds.Add((await world.Service().UploadHandoverEvidenceAsync(m2.Id, new MemoryStream([0xFF, 0xD8, 0xFF, 0xE0, (byte)i]), default)).Id);
        return m2;
    }

    private Task<HandoverView> StaffRecordsMoveIn(Contract m2)
    {
        world.StaffAssignedToL1LoggedIn();
        return world.Service().SaveHandoverAsync(m2.Id, new HandoverInput(savedHandover?.Version ?? 0, Today, "Phong sach, tuong khong nut",
            "2 chia khoa phong, 1 the tu cong", "Ban giao nhan phong",
            assetIds.Select(assetId => new HandoverAssetInput(assetId, "Tot, co anh dinh kem")).ToArray(),
            electricityReading, waterReading, photoIds.ToArray()), Guid.NewGuid(), default);
    }
    // UTC24 (Normal) - sheet "BF-03 Onboarding Contract", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: M2 Active; Staff assigned to L1; Room 204 has 3 assets in inventory
    // Đầu vào : asset conditions with notes/photos for all 3 assets; key/access information; initial ELEC and WATER readings with evidence
    // Mong đợi: Return: required checklist validated; handover summary awaiting Tenant confirmation (Pending Confirmation); Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-17 steps 1-7; RoomInspection lifecycle (recommended Draft / Pending Confirmation / Confirmed)
    [Fact(DisplayName = "BF03 UTC24 - Staff ghi ban giao nhan phong day du: cho Tenant xac nhan")]
    public async Task UTC24_RecordMoveInHandover()
    {
        var m2 = await MoveInSetup();

        var view = await StaffRecordsMoveIn(m2);

        Assert.True(SameStatus(view.Status, "Pending Confirmation"), $"Trang thai ban giao: {view.Status}");
        Assert.Equal(3, view.Snapshot.Assets.Length);
        Assert.Equal(electricityReading, view.Snapshot.Electricity.Id);
        Assert.Equal(waterReading, view.Snapshot.Water.Id);
        Assert.Null(view.TenantConfirmedAt);
    }

    // UTC25 (Normal) - sheet "BF-03 Onboarding Contract", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Move-in handover Pending Confirmation
    // Đầu vào : Tenant confirms; Staff confirms completion
    // Mong đợi: Return: handover Confirmed; handover record stored with confirmation actors/times and evidence; confirmed baseline of Room condition, assets and initial readings available; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-17 steps 8-10 and Postconditions; FE-03 3.3.1
    // Ghi chú : Điều kiện "Pending Confirmation" được tạo bằng chính bước Staff ghi biên bản (như UTC24).
    [Fact(DisplayName = "BF03 UTC25 - Tenant va Staff xac nhan: ban giao Confirmed, luu nguoi/thoi diem xac nhan")]
    public async Task UTC25_TenantAndStaffConfirmHandover()
    {
        var m2 = await MoveInSetup();
        var pending = await StaffRecordsMoveIn(m2);

        world.TenantLoggedIn();
        var afterTenant = await world.Service().DecideHandoverAsync(m2.Id, new HandoverDecision(pending.Version, "Dong y"), Guid.NewGuid(), false, false, default);
        world.StaffAssignedToL1LoggedIn();
        var confirmed = await world.Service().DecideHandoverAsync(m2.Id, new HandoverDecision(afterTenant.Version, "Hoan tat"), Guid.NewGuid(), false, true, default);

        Assert.True(SameStatus(confirmed.Status, "Confirmed"), $"Trang thai ban giao: {confirmed.Status}");
        Assert.NotNull(confirmed.TenantConfirmedAt);
        Assert.NotNull(confirmed.StaffConfirmedAt);
        Assert.Equal(world.TenantId, savedHandover!.TenantConfirmedBy);
        Assert.Equal(world.StaffId, savedHandover.StaffConfirmedBy);
        Assert.Equal(3, confirmed.Snapshot.Assets.Length);
        Assert.Equal(electricityReading, confirmed.Snapshot.Electricity.Id);
        Assert.Equal(waterReading, confirmed.Snapshot.Water.Id);
        Assert.NotEmpty(confirmed.Snapshot.EvidenceIds);
    }

    // UTC26 (Abnormal) - sheet "BF-03 Onboarding Contract", BHOME_Unit_Test_Document_v1.0.xlsx
    // Điều kiện: Move-in handover Pending Confirmation
    // Đầu vào : Tenant disputes an item; note="Fridge scratched"
    // Mong đợi: Return: discrepancy recorded by Staff; handover remains pending until corrected and acknowledged; Exception: N/A; Log Message: N/A
    // Căn cứ  : UC-17 A1 (Owner notification under A2 only where a decision is required, see open questions)
    [Fact(DisplayName = "BF03 UTC26 - Tenant khieu nai 'Fridge scratched': ghi nhan, ban giao chua Confirmed")]
    public async Task UTC26_TenantDisputesItem()
    {
        var m2 = await MoveInSetup();
        var pending = await StaffRecordsMoveIn(m2);

        world.TenantLoggedIn();
        var (disputed, rejection) = await Attempt(() => world.Service().DecideHandoverAsync(m2.Id,
            new HandoverDecision(pending.Version, "Fridge scratched"), Guid.NewGuid(), true, false, default));

        Assert.Null(rejection);
        Assert.NotNull(disputed);
        Assert.False(SameStatus(disputed.Status, "Confirmed"));
        Assert.Contains(world.Added.OfType<ContractHandoverHistory>(), h => h.Note.Contains("Fridge scratched"));
    }
}
