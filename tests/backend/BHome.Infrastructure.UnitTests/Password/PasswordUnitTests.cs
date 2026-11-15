using BHome.Application.IdentityAccess;
using BHome.Domain.IdentityAccess;
using BHome.Infrastructure.UnitTests.AccountProvisioning;
using BHome.Infrastructure.UnitTests.Shared;
using static BHome.Infrastructure.UnitTests.AccountProvisioning.AccountProvisioningWorld;
using static BHome.Infrastructure.UnitTests.Shared.IdentityArrange;

namespace BHome.Infrastructure.UnitTests.Password;

// Report 5.1 – sheet "Password" (UTC01–UTC17).
// Pre-conditions, inputs and expected results are taken from the sheet, not from the code.
// The reset e-mail is captured by FakeEmailDelivery ("the test mailbox"); its token is the "token from the reset email".
// Run only this sheet:  dotnet test --filter "Sheet=Password"   ·   one function:  --filter "Sheet=Password&Function=ChangeAsync"
[Collection(AccountProvisioningCollection.Name)]
[Trait("Suite", "QA-SrsUnit")]
[Trait("Sheet", "Password")]
public sealed class PasswordUnitTests(PostgresContainerFixture postgres) : IAsyncLifetime
{
    private AccountProvisioningWorld world = null!;

    public async Task InitializeAsync() => world = await AccountProvisioningWorld.CreateAsync(postgres);

    public async Task DisposeAsync() => await world.DisposeAsync();

    private IPasswordService Passwords => world.Get<IPasswordService>();

    // "Staff staff.sample@example.invalid is signed in on the Mobile app; password 12CharPass1@."
    private async Task<LoginResult> StaffSignedInAsync()
    {
        await world.AddStaffSampleAsync();
        return await world.SignInAsync(StaffEmail, StaffPassword, MobileApp);
    }

    // "staff.sample@example.invalid has a valid, unused reset link": requested through the real function, token read from the mailbox.
    private async Task<string> StaffResetTokenAsync()
    {
        await world.AddStaffSampleAsync();
        await Passwords.RequestResetAsync(StaffEmail, default);
        return Assert.Single(world.Email.Sent).Token;
    }

    // Password protection (NFR 2.3): the plain password must not appear in stored account data, logs or audit records.
    private async Task AssertNotStoredInPlainTextAsync(string password) => Assert.Equal(0L, await world.ScalarAsync<long>(
        """
        select (select count(*) from users where password_hash = @p or password_hash like '%' || @p || '%' or history::text like '%' || @p || '%')
             + (select count(*) from notifications where event_data::text like '%' || @p || '%')
        """, ("p", password)));

    #region VerifyAsync(string Email, string password)

    [Fact(DisplayName = "UTC01 - VerifyAsync: staff.sample dung mat khau -> Verified role Staff, mat khau khong luu dang ro")]
    [Trait("Function", "VerifyAsync")]
    public async Task UTC01()
    {
        await world.AddStaffSampleAsync();

        var result = await world.Get<ICredentialVerifier>().VerifyAsync(StaffEmail, StaffPassword, default);

        Assert.NotNull(result);
        Assert.Equal([Roles.Staff], result.Roles);
        await AssertNotStoredInPlainTextAsync(StaffPassword);
    }

    #endregion

    #region ChangeAsync(Guid userId, Guid sessionId, string currentPassword, string newPassword)

    [Fact(DisplayName = "UTC02 - ChangeAsync: dung mat khau hien tai, mat khau moi NewStaffPass456@ -> true, co audit")]
    [Trait("Function", "ChangeAsync")]
    public async Task UTC02()
    {
        var staff = await StaffSignedInAsync();

        var result = await Passwords.ChangeAsync(StaffSampleId, staff.SessionId, StaffPassword, "NewStaffPass456@", default);

        Assert.True(result);
        Assert.True(await world.CanSignInAsync(StaffEmail, "NewStaffPass456@"));
        Assert.False(await world.CanSignInAsync(StaffEmail, StaffPassword));
        await AssertNotStoredInPlainTextAsync("NewStaffPass456@");
        Assert.Equal(1, await world.AuditCountAsync("PasswordChange"));
    }

    [Fact(DisplayName = "UTC03 - ChangeAsync: sai mat khau hien tai -> false, mat khau giu nguyen")]
    [Trait("Function", "ChangeAsync")]
    public async Task UTC03()
    {
        var staff = await StaffSignedInAsync();

        var result = await Passwords.ChangeAsync(StaffSampleId, staff.SessionId, "WrongPass999@", "NewStaffPass456@", default);

        Assert.False(result);
        Assert.True(await world.CanSignInAsync(StaffEmail, StaffPassword));
    }

    [Fact(DisplayName = "UTC04 - ChangeAsync: mat khau moi 11 ky tu NewPass456@ -> false")]
    [Trait("Function", "ChangeAsync")]
    public async Task UTC04()
    {
        var staff = await StaffSignedInAsync();

        var result = await Passwords.ChangeAsync(StaffSampleId, staff.SessionId, StaffPassword, "NewPass456@", default);

        Assert.False(result);
        Assert.True(await world.CanSignInAsync(StaffEmail, StaffPassword));
    }

    [Fact(DisplayName = "UTC05 - ChangeAsync: mat khau moi dung 12 ky tu NewPass4567@ -> true, co audit")]
    [Trait("Function", "ChangeAsync")]
    public async Task UTC05()
    {
        var staff = await StaffSignedInAsync();

        var result = await Passwords.ChangeAsync(StaffSampleId, staff.SessionId, StaffPassword, "NewPass4567@", default);

        Assert.True(result);
        Assert.True(await world.CanSignInAsync(StaffEmail, "NewPass4567@"));
        await AssertNotStoredInPlainTextAsync("NewPass4567@");
        Assert.Equal(1, await world.AuditCountAsync("PasswordChange"));
    }

    [Fact(DisplayName = "UTC06 - ChangeAsync: mat khau hien tai rong -> false (MSG02)")]
    [Trait("Function", "ChangeAsync")]
    public async Task UTC06()
    {
        var staff = await StaffSignedInAsync();

        var result = await Passwords.ChangeAsync(StaffSampleId, staff.SessionId, "", "NewStaffPass456@", default);

        Assert.False(result);
        Assert.True(await world.CanSignInAsync(StaffEmail, StaffPassword));
    }

    [Fact(DisplayName = "UTC07 - ChangeAsync: mat khau moi rong -> false (MSG02)")]
    [Trait("Function", "ChangeAsync")]
    public async Task UTC07()
    {
        var staff = await StaffSignedInAsync();

        var result = await Passwords.ChangeAsync(StaffSampleId, staff.SessionId, StaffPassword, "", default);

        Assert.False(result);
        Assert.True(await world.CanSignInAsync(StaffEmail, StaffPassword));
    }

    [Fact(DisplayName = "UTC08 - ChangeAsync: phien Mobile app da dang xuat -> false")]
    [Trait("Function", "ChangeAsync")]
    public async Task UTC08()
    {
        var staff = await StaffSignedInAsync();
        await world.SignOutAsync(staff);

        var result = await Passwords.ChangeAsync(StaffSampleId, staff.SessionId, StaffPassword, "NewStaffPass456@", default);

        Assert.False(result);
        Assert.True(await world.CanSignInAsync(StaffEmail, StaffPassword));
    }

    [Fact(DisplayName = "UTC09 - ChangeAsync: staff.api.test bi khoa sau khi dang nhap -> false")]
    [Trait("Function", "ChangeAsync")]
    public async Task UTC09()
    {
        await world.AddStaffApiTestAsync();
        var login = await world.SignInAsync(StaffApiTestEmail, StaffApiTestPassword, MobileApp);
        await world.SetActiveAsync(StaffApiTestId, false);

        var result = await Passwords.ChangeAsync(StaffApiTestId, login.SessionId, StaffApiTestPassword, "NewStaffPass456@", default);

        Assert.False(result);
    }

    #endregion

    #region RequestResetAsync(string userName)

    [Fact(DisplayName = "UTC10 - RequestResetAsync: staff.sample active -> gui 1 email dat lai mat khau")]
    [Trait("Function", "RequestResetAsync")]
    public async Task UTC10()
    {
        await world.AddStaffSampleAsync();

        await Passwords.RequestResetAsync(StaffEmail, default);

        var mail = Assert.Single(world.Email.Sent);
        Assert.Equal(StaffSampleId, mail.UserId);
        Assert.Equal(StaffEmail, mail.Destination);
        Assert.False(string.IsNullOrEmpty(mail.Token));
    }

    [Fact(DisplayName = "UTC11 - RequestResetAsync: nobody@bhome.test khong ton tai -> ket thuc nhu binh thuong, khong gui email")]
    [Trait("Function", "RequestResetAsync")]
    public async Task UTC11()
    {
        await world.AddStaffSampleAsync();

        var error = await Record.ExceptionAsync(() => Passwords.RequestResetAsync("nobody@bhome.test", default));

        Assert.Null(error); // same completion as for a registered account
        Assert.Empty(world.Email.Sent);
    }

    [Fact(DisplayName = "UTC12 - RequestResetAsync: staff.api.test Inactive -> ket thuc nhu binh thuong, khong gui email")]
    [Trait("Function", "RequestResetAsync")]
    public async Task UTC12()
    {
        await world.AddStaffApiTestAsync(active: false);

        var error = await Record.ExceptionAsync(() => Passwords.RequestResetAsync(StaffApiTestEmail, default));

        Assert.Null(error);
        Assert.Empty(world.Email.Sent);
    }

    #endregion

    #region ResetAsync(string userName, string token, string newPassword)

    [Fact(DisplayName = "UTC13 - ResetAsync: link hop le, ResetPass789@ -> true, link khong dung lai duoc, co audit")]
    [Trait("Function", "ResetAsync")]
    public async Task UTC13()
    {
        var token = await StaffResetTokenAsync();

        var result = await Passwords.ResetAsync(StaffEmail, token, "ResetPass789@", default);

        Assert.True(result);
        Assert.True(await world.CanSignInAsync(StaffEmail, "ResetPass789@"));
        Assert.False(await Passwords.ResetAsync(StaffEmail, token, "AnotherPass321@", default)); // link cannot be reused
        await AssertNotStoredInPlainTextAsync("ResetPass789@");
        Assert.True(await world.AuditCountAsync("PasswordReset") >= 1);
    }

    [Fact(DisplayName = "UTC14 - ResetAsync: token bi sua 'tampered_fake_token' -> false")]
    [Trait("Function", "ResetAsync")]
    public async Task UTC14()
    {
        await StaffResetTokenAsync();

        var result = await Passwords.ResetAsync(StaffEmail, "tampered_fake_token", "ResetPass789@", default);

        Assert.False(result);
        Assert.True(await world.CanSignInAsync(StaffEmail, StaffPassword));
    }

    [Fact(DisplayName = "UTC15 - ResetAsync: dung lai link da dung -> false, mat khau van la ResetPass789@")]
    [Trait("Function", "ResetAsync")]
    public async Task UTC15()
    {
        var token = await StaffResetTokenAsync();
        Assert.True(await Passwords.ResetAsync(StaffEmail, token, "ResetPass789@", default)); // already reset with the link (UTC13)

        var result = await Passwords.ResetAsync(StaffEmail, token, "AnotherPass321@", default);

        Assert.False(result);
        Assert.True(await world.CanSignInAsync(StaffEmail, "ResetPass789@"));
    }

    [Fact(DisplayName = "UTC16 - ResetAsync: mat khau moi 11 ky tu NewPass456@ -> false")]
    [Trait("Function", "ResetAsync")]
    public async Task UTC16()
    {
        var token = await StaffResetTokenAsync();

        var result = await Passwords.ResetAsync(StaffEmail, token, "NewPass456@", default);

        Assert.False(result);
        Assert.True(await world.CanSignInAsync(StaffEmail, StaffPassword));
    }

    [Fact(DisplayName = "UTC17 - ResetAsync: link cua staff.sample dung cho tenant.sample -> false, ca hai giu mat khau")]
    [Trait("Function", "ResetAsync")]
    public async Task UTC17()
    {
        var staffToken = await StaffResetTokenAsync();
        await world.AddTenantSampleAsync();

        var result = await Passwords.ResetAsync(TenantEmail, staffToken, "ResetPass789@", default);

        Assert.False(result);
        Assert.True(await world.CanSignInAsync(TenantEmail, TenantPassword));
        Assert.True(await world.CanSignInAsync(StaffEmail, StaffPassword));
    }

    #endregion
}
