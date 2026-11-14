using BHome.Application.IdentityAccess;
using BHome.Application.Operations;
using BHome.Domain.IdentityAccess;
using BHome.Domain.Locations;
using BHome.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using static BHome.Infrastructure.UnitTests.AccountProvisioning.AccountProvisioningWorld;

namespace BHome.Infrastructure.UnitTests.AccountProvisioning;

// Sheet "AccountProvisioning" of BHOME_Report-5.1_Unit_Test (UTC01–UTC18).
// Pre-conditions, inputs and expected results are taken from the sheet, not from the code.
[Collection(AccountProvisioningCollection.Name)]
public sealed class AccountProvisioningUnitTests(PostgresContainerFixture postgres) : IAsyncLifetime
{
    private static readonly Guid Location1Id = Guid.Parse("c2400000-0000-4000-8000-000000000010");
    private static readonly Guid Room101Id = Guid.Parse("c2400000-0000-4000-8000-000000000040");
    private static readonly Guid TenantResidentId = Guid.Parse("bd110000-0000-4000-8000-000000000030");
    private const string ValidPassword = "MySecurePass2026@";

    private AccountProvisioningWorld world = null!;

    public async Task InitializeAsync()
    {
        world = await AccountProvisioningWorld.CreateAsync(postgres);
        // Common pre-condition of every case: Owner owner.sample@example.invalid (phone 0914139271) is signed in.
        await world.AddUserAsync(OwnerId, "owner.sample@example.invalid", Roles.Owner, "Owner123456@", phone: "0914139271");
        world.SignInAsOwner();
    }

    public async Task DisposeAsync() => await world.DisposeAsync();

    private OperationsService Operations => world.Get<OperationsService>();
    private IAccountInvitations Invitations => world.Get<IAccountInvitations>();

    private static EmploymentWrite FullTimeActive => new(null, "FullTime", new DateOnly(2026, 11, 11), null, null, null, "Active");

    private static StaffCreate NewStaff(string email, string fullName, string? phone, string password) =>
        new(email, fullName, phone, password, FullTimeActive);

    // Pre-condition "Staff X is active": a Staff account created the way the Owner creates Staff (with employment).
    private async Task<Guid> AddStaffAsync(string email, string fullName) =>
        (await Operations.CreateStaffAsync(NewStaff(email, fullName, null, "Staff123456@"), default)).UserId;

    private async Task<StaffUpdate> UpdateOf(Guid id, string email, string fullName, bool isActive, string reason) =>
        new((await Operations.StaffAsync(id, default)).AccountVersion, email, fullName, null, isActive, FullTimeActive, reason);

    // Sheet expects "Exception: <status> "<code>"".
    private static async Task AssertRejected(Func<Task> act, int status, string code)
    {
        var error = await Assert.ThrowsAnyAsync<Exception>(act);
        var type = error.GetType();
        var actualStatus = type.GetProperty("Status")?.GetValue(error) ?? type.GetProperty("StatusCode")?.GetValue(error);
        var actualCode = type.GetProperty("Code")?.GetValue(error) ?? error.Message;
        Assert.Equal((status, code), (Convert.ToInt32(actualStatus), actualCode as string));
    }

    // ----- pre-condition builders -----

    private async Task AddLocationAsync(Guid id, string name)
    {
        await world.ExecAsync("insert into locations(id, name, address) values (@id, @n, 'Synthetic address')", ("id", id), ("n", name));
        await world.ExecAsync("insert into rooms(id, location_id, room_number, capacity, status) values (@r, @l, '101', 2, 2)",
            ("r", Room101Id), ("l", id));
    }

    private Task AddResidentAsync(Guid id, string label, Guid? userId) => world.ExecAsync(
        """
        insert into residents(id, user_id, current_room_id, identity_owner_scope_id, display_label, verification_status)
        values (@id, @u, @room, @owner, @label, 1)
        """, ("id", id), ("u", userId), ("room", Room101Id), ("owner", OwnerId), ("label", label));

    private async Task<Guid> AddContractAsync(string type, int status, Guid representativeId, Guid? tenantUserId,
        params (Guid ResidentId, int Role)[] residents)
    {
        var id = Guid.NewGuid();
        await world.ExecAsync(
            """
            insert into contracts(id, room_id, representative_resident_id, tenant_user_id, owner_signer_id, contract_type,
                start_date, end_date, monthly_rent, deposit_required, terms, status, activated_at, activated_by_user_id)
            values (@id, @room, @rep, @tenant, @owner, @type, date '2026-11-01', date '2027-10-31', 3500000, 3500000,
                'Synthetic terms', @status, case when @status = 3 then timestamptz '2026-11-01 02:00+00' end,
                case when @status = 3 then @owner end)
            """, ("id", id), ("room", Room101Id), ("rep", representativeId), ("tenant", tenantUserId), ("owner", OwnerId),
            ("type", type), ("status", (short)status));
        foreach (var (residentId, role) in residents)
            await world.ExecAsync(
                "insert into contract_residents(contract_id, resident_id, resident_role, residence_from) values (@c, @r, @role, date '2026-11-01')",
                ("c", id), ("r", residentId), ("role", (short)role));
        return id;
    }

    // tenant.sample@example.invalid is the representative of an Active Main Contract (resident bd110000-…-0030).
    private async Task AddTenantSampleTenancyAsync(bool emailConfirmed)
    {
        await world.AddUserAsync(TenantSampleId, "tenant.sample@example.invalid", Roles.Tenant, "TenantSample123@",
            emailConfirmed: emailConfirmed);
        await AddLocationAsync(Location1Id, "BHOME SAMPLE 1");
        await AddResidentAsync(TenantResidentId, "Tenant Sample", TenantSampleId);
        await AddContractAsync("MAIN", 3, TenantResidentId, TenantSampleId, (TenantResidentId, 0));
    }

    private async Task<string> InvitationTokenForTenantSampleAsync()
    {
        await AddTenantSampleTenancyAsync(emailConfirmed: false);
        await Invitations.InviteAsync(TenantResidentId, new TenantInvitationRequest("tenant.sample@example.invalid"), default);
        return Assert.Single(world.Email.Sent, s => s.UserId == TenantSampleId).Token;
    }

    private async Task<string> StaffInvitationTokenAsync(Guid id, string email)
    {
        await world.AddUserAsync(id, email, Roles.Staff, "StaffPass123@", emailConfirmed: false);
        await Invitations.InviteStaffAsync(id, default);
        return Assert.Single(world.Email.Sent, s => s.UserId == id).Token;
    }

    // ===================== CreateStaffAsync(StaffCreate input) =====================

    [Fact(DisplayName = "UTC01 - CreateStaffAsync: email/phone  dung -> tao Staff IsActive = true, audit StaffCreated")]
    public async Task UTC01_CreateStaffAsync_NewEmailAndPhone_CreatesActiveStaff()
    {
        var result = await Operations.CreateStaffAsync(NewStaff("annguyen@bhome.test", "Nguyen Van An", "0912345678", "StaffPass123@"), default);

        Assert.True(result.IsActive);
        Assert.Equal(1, await world.UserCountAsync("annguyen@bhome.test"));
        Assert.Equal(1, await world.AuditCountAsync("StaffCreated"));
    }

    [Fact(DisplayName = "UTC02 - CreateStaffAsync: mat khau dung 12 ky tu -> tao Staff")]
    public async Task UTC02_CreateStaffAsync_PasswordExactly12Chars_CreatesStaff()
    {
        var result = await Operations.CreateStaffAsync(NewStaff("dungpham@bhome.test", "Pham Van Dung", null, "Pass1234567@"), default);

        Assert.Equal("dungpham@bhome.test", result.Email);
        Assert.Equal(1, await world.UserCountAsync("dungpham@bhome.test"));
    }

    [Fact(DisplayName = "UTC03 - CreateStaffAsync: mat khau 11 ky tu -> 400 invalid_operations_input, khong tao")]
    public async Task UTC03_CreateStaffAsync_Password11Chars_Rejected()
    {
        await AssertRejected(() => Operations.CreateStaffAsync(NewStaff("haihoang@bhome.test", "Hoang Van Hai", null, "Pass123456@"), default),
            400, "invalid_operations_input");

        Assert.Equal(0, await world.UserCountAsync("haihoang@bhome.test"));
    }

    [Fact(DisplayName = "UTC04 - CreateStaffAsync: email staff.sample da duoc dung -> 400 invalid_staff_account, khong tao")]
    public async Task UTC04_CreateStaffAsync_EmailAlreadyUsed_Rejected()
    {
        await world.AddUserAsync(StaffSampleId, "staff.sample@example.invalid", Roles.Staff, "StaffSample123@");

        await AssertRejected(() => Operations.CreateStaffAsync(NewStaff("staff.sample@example.invalid", "Tran Van Tam", null, "StaffPass123@"), default),
            400, "invalid_staff_account");

        Assert.Equal(1, await world.UserCountAsync("staff.sample@example.invalid"));
    }

    [Fact(DisplayName = "UTC05 - CreateStaffAsync: phone 0914139271 thuoc Owner -> 409 phone_already_used, khong tao")]
    public async Task UTC05_CreateStaffAsync_PhoneAlreadyUsed_Rejected()
    {
        await AssertRejected(() => Operations.CreateStaffAsync(NewStaff("sonmai@bhome.test", "Mai Van Son", "0914139271", "StaffPass123@"), default),
            409, "phone_already_used");

        Assert.Equal(0, await world.UserCountAsync("sonmai@bhome.test"));
    }

    // ===================== UpdateStaffAsync(Guid id, StaffUpdate input) =====================

    [Fact(DisplayName = "UTC06 - UpdateStaffAsync: sua FullName staff1 -> 'Nguyen Van C', audit StaffUpdated")]
    public async Task UTC06_UpdateStaffAsync_CorrectFullName_Updated()
    {
        var staff1 = await AddStaffAsync("staff1@gmail.com", "Nguyen Van B");

        var result = await Operations.UpdateStaffAsync(staff1,
            await UpdateOf(staff1, "staff1@gmail.com", "Nguyen Van C", isActive: true, "Correct full name"), default);

        Assert.Equal("Nguyen Van C", result.FullName);
        Assert.Equal(1, await world.AuditCountAsync("StaffUpdated"));
    }

    [Fact(DisplayName = "UTC07 - UpdateStaffAsync: staff.api.test khong co Location/task, IsActive=false -> Inactive, phien cu het hieu luc")]
    public async Task UTC07_UpdateStaffAsync_DeactivateFreeStaff_InactiveAndSessionsStop()
    {
        var staffApiTest = await AddStaffAsync("staff.api.test@example.invalid", "Staff Api Test");
        var user = (await world.Get<UserManager<ApplicationUser>>().FindByIdAsync(staffApiTest.ToString()))!;
        var stamp = await world.Get<UserManager<ApplicationUser>>().GetSecurityStampAsync(user);
        var session = await world.Get<IAuthenticationSessions>()
            .CreateAsync(new VerifiedIdentity(staffApiTest, [Roles.Staff], stamp), "Mobile app", default);
        Assert.NotNull(session);

        var result = await Operations.UpdateStaffAsync(staffApiTest,
            await UpdateOf(staffApiTest, "staff.api.test@example.invalid", "Staff Api Test", isActive: false, "Left the company"), default);

        Assert.False(result.IsActive);
        Assert.Null(await world.Get<IAuthenticationSessions>().RefreshAsync(session!.RefreshToken!, default));
    }

    [Fact(DisplayName = "UTC08 - UpdateStaffAsync: staff.sample dang phu trach BHOME SAMPLE 1 -> 409 staff_responsibilities_unresolved, van Active")]
    public async Task UTC08_UpdateStaffAsync_DeactivateResponsibleStaff_Rejected()
    {
        var staffSample = await AddStaffAsync("staff.sample@example.invalid", "Staff Sample");
        await AddLocationAsync(Location1Id, "BHOME SAMPLE 1");
        world.Db.StaffLocationAssignments.Add(new StaffLocationAssignment(Location1Id, staffSample, OwnerId,
            new DateOnly(2025, 11, 8), new DateOnly(2027, 11, 8)));
        await world.Db.SaveChangesAsync();
        var update = await UpdateOf(staffSample, "staff.sample@example.invalid", "Staff Sample", isActive: false, "Left the company");

        await AssertRejected(() => Operations.UpdateStaffAsync(staffSample, update, default), 409, "staff_responsibilities_unresolved");

        Assert.True(await world.ScalarAsync<bool>("select is_active from users where id = @id", ("id", staffSample)));
    }

    [Fact(DisplayName = "UTC09 - UpdateStaffAsync: Reason chi co khoang trang -> 400 reason_required, khong cap nhat")]
    public async Task UTC09_UpdateStaffAsync_BlankReason_Rejected()
    {
        var staff1 = await AddStaffAsync("staff1@gmail.com", "Nguyen Van B");
        var before = (await Operations.StaffAsync(staff1, default)).FullName;
        var update = await UpdateOf(staff1, "staff1@gmail.com", "Nguyen Van C", isActive: true, " ");

        await AssertRejected(() => Operations.UpdateStaffAsync(staff1, update, default), 400, "reason_required");

        Assert.Equal(before, (await Operations.StaffAsync(staff1, default)).FullName);
    }

    // ===================== InviteStaffAsync(Guid userId) =====================

    [Fact(DisplayName = "UTC10 - InviteStaffAsync: staff.sample active chua kich hoat -> gui email moi, AcceptedByProvider, audit AccountInvitationCreated")]
    public async Task UTC10_InviteStaffAsync_NotYetActivatedStaff_InvitationSent()
    {
        await world.AddUserAsync(StaffSampleId, "staff.sample@example.invalid", Roles.Staff, "StaffSample123@", emailConfirmed: false);

        var result = await Invitations.InviteStaffAsync(StaffSampleId, default);

        Assert.Equal("AcceptedByProvider", result.DeliveryState);
        Assert.Single(world.Email.Sent, s => s.Destination == "staff.sample@example.invalid");
        Assert.Equal(1, await world.AuditCountAsync("AccountInvitationCreated"));
    }

    [Fact(DisplayName = "UTC11 - InviteStaffAsync: staff1 da kich hoat (EmailConfirmed) -> 409 account_not_eligible_for_invitation, khong gui")]
    public async Task UTC11_InviteStaffAsync_AlreadyActivated_Rejected()
    {
        await world.AddUserAsync(Staff1Id, "staff1@gmail.com", Roles.Staff, "Staff123456@", emailConfirmed: true);

        await AssertRejected(() => Invitations.InviteStaffAsync(Staff1Id, default), 409, "account_not_eligible_for_invitation");

        Assert.Empty(world.Email.Sent);
    }

    // ===================== InviteAsync(Guid residentId, TenantInvitationRequest request) =====================

    [Fact(DisplayName = "UTC12 - InviteAsync: nguoi o cung Nguyen Thi Mai trong hop dong Active, chua co tai khoan -> tao Tenant Inactive va gui moi")]
    public async Task UTC12_InviteAsync_CoOccupantWithoutAccount_CreatesInactiveTenantAndInvites()
    {
        await AddTenantSampleTenancyAsync(emailConfirmed: true);
        var maiId = Guid.NewGuid();
        await AddResidentAsync(maiId, "Nguyen Thi Mai", null);
        await world.ExecAsync(
            "insert into contract_residents(contract_id, resident_id, resident_role, residence_from) select id, @r, 1, date '2026-11-01' from contracts",
            ("r", maiId));

        var result = await Invitations.InviteAsync(maiId, new TenantInvitationRequest("mainguyen@bhome.test"), default);

        Assert.Equal("AcceptedByProvider", result.DeliveryState);
        Assert.False(await world.ScalarAsync<bool>("select is_active from users where normalized_email = upper(@e)", ("e", "mainguyen@bhome.test")));
        Assert.True(await world.ScalarAsync<bool>("select 'Tenant' = any(roles) from users where id = @id", ("id", result.UserId)));
        Assert.Single(world.Email.Sent, s => s.Destination == "mainguyen@bhome.test");
        Assert.Equal(1, await world.AuditCountAsync("AccountInvitationCreated"));
    }

    [Fact(DisplayName = "UTC13 - InviteAsync: Tran Thi Lan chi co Holding Contract -> 404 eligible_resident_not_found, khong gui")]
    public async Task UTC13_InviteAsync_ResidentWithOnlyHoldingContract_Rejected()
    {
        await AddLocationAsync(Location1Id, "BHOME SAMPLE 1");
        var lanId = Guid.NewGuid();
        await AddResidentAsync(lanId, "Tran Thi Lan", null);
        await AddContractAsync("HOLDING", 2, lanId, null, (lanId, 0));

        await AssertRejected(() => Invitations.InviteAsync(lanId, new TenantInvitationRequest("lantran@bhome.test"), default),
            404, "eligible_resident_not_found");

        Assert.Empty(world.Email.Sent);
        Assert.Equal(0, await world.UserCountAsync("lantran@bhome.test"));
    }

    [Fact(DisplayName = "UTC14 - InviteAsync: resident da lien ket tenant.sample, nhap email khac -> 409 linked_account_email_mismatch")]
    public async Task UTC14_InviteAsync_LinkedResidentDifferentEmail_Rejected()
    {
        await AddTenantSampleTenancyAsync(emailConfirmed: false);

        await AssertRejected(() => Invitations.InviteAsync(TenantResidentId, new TenantInvitationRequest("huongpham@bhome.test"), default),
            409, "linked_account_email_mismatch");

        Assert.Empty(world.Email.Sent);
    }

    // ===================== AcceptAsync(AcceptInvitationRequest request) =====================

    [Fact(DisplayName = "UTC15 - AcceptAsync: link hop le chua dung -> true, kich hoat, link dung 1 lan, thu hoi phien cu, audit AccountInvitationAccepted")]
    public async Task UTC15_AcceptAsync_ValidUnusedLink_ActivatesAccount()
    {
        var token = await InvitationTokenForTenantSampleAsync();
        var user = (await world.Get<UserManager<ApplicationUser>>().FindByIdAsync(TenantSampleId.ToString()))!;
        var earlier = await world.Get<IAuthenticationSessions>().CreateAsync(
            new VerifiedIdentity(TenantSampleId, [Roles.Tenant], user.SecurityStamp ?? ""), "Mobile app", default);
        Assert.NotNull(earlier?.RefreshToken); // pre-condition: an earlier session exists

        var accepted = await Invitations.AcceptAsync(new AcceptInvitationRequest("tenant.sample@example.invalid", token, ValidPassword), default);

        Assert.True(accepted);
        Assert.True(await world.ScalarAsync<bool>("select is_active and email_confirmed from users where id = @id", ("id", TenantSampleId)));
        Assert.False(await Invitations.AcceptAsync(new AcceptInvitationRequest("tenant.sample@example.invalid", token, ValidPassword), default));
        Assert.Null(await world.Get<IAuthenticationSessions>().RefreshAsync(earlier!.RefreshToken!, default));
        Assert.Equal(1, await world.AuditCountAsync("AccountInvitationAccepted"));
    }

    [Fact(DisplayName = "UTC16 - AcceptAsync: NewPassword 11 ky tu -> false, khong kich hoat")]
    public async Task UTC16_AcceptAsync_Password11Chars_ReturnsFalse()
    {
        var token = await StaffInvitationTokenAsync(Guid.NewGuid(), "annguyen@bhome.test");

        var accepted = await Invitations.AcceptAsync(new AcceptInvitationRequest("annguyen@bhome.test", token, "Pass123456@"), default);

        Assert.False(accepted);
        Assert.False(await world.ScalarAsync<bool>("select email_confirmed from users where normalized_email = upper(@e)", ("e", "annguyen@bhome.test")));
    }

    [Fact(DisplayName = "UTC17 - AcceptAsync: link da duoc dung -> false")]
    public async Task UTC17_AcceptAsync_AlreadyUsedToken_ReturnsFalse()
    {
        var token = await InvitationTokenForTenantSampleAsync();
        await Invitations.AcceptAsync(new AcceptInvitationRequest("tenant.sample@example.invalid", token, ValidPassword), default);

        var accepted = await Invitations.AcceptAsync(new AcceptInvitationRequest("tenant.sample@example.invalid", token, ValidPassword), default);

        Assert.False(accepted);
    }

    [Fact(DisplayName = "UTC18 - AcceptAsync: link cua binhle da het han -> false")]
    public async Task UTC18_AcceptAsync_ExpiredToken_ReturnsFalse()
    {
        var token = await StaffInvitationTokenAsync(Guid.NewGuid(), "binhle@bhome.test");
        // SRS does not state the invitation lifetime; 400 days is past any reasonable expiry.
        world.Clock.Advance(TimeSpan.FromDays(400));

        var accepted = await Invitations.AcceptAsync(new AcceptInvitationRequest("binhle@bhome.test", token, ValidPassword), default);

        Assert.False(accepted);
    }
}
