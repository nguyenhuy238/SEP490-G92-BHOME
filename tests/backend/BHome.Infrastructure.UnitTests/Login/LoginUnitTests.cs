using BHome.Application.IdentityAccess;
using BHome.Domain.IdentityAccess;
using BHome.Infrastructure.UnitTests.AccountProvisioning;
using BHome.Infrastructure.UnitTests.Shared;
using static BHome.Infrastructure.UnitTests.AccountProvisioning.AccountProvisioningWorld;
using static BHome.Infrastructure.UnitTests.Shared.IdentityArrange;

namespace BHome.Infrastructure.UnitTests.Login;

// Report 5.1 – sheet "Login" (UTC01–UTC11).
// Pre-conditions, inputs and expected results are taken from the sheet, not from the code.
// Run only this sheet:  dotnet test --filter "Sheet=Login"   ·   one function:  --filter "Sheet=Login&Function=VerifyAsync"
[Collection(AccountProvisioningCollection.Name)]
[Trait("Suite", "QA-SrsUnit")]
[Trait("Sheet", "Login")]
public sealed class LoginUnitTests(PostgresContainerFixture postgres) : IAsyncLifetime
{
    private AccountProvisioningWorld world = null!;

    public async Task InitializeAsync()
    {
        world = await AccountProvisioningWorld.CreateAsync(postgres);
        world.CurrentUser.Set(null); // Common pre-condition: "No user is signed in."
    }

    public async Task DisposeAsync() => await world.DisposeAsync();

    private ICredentialVerifier Credentials => world.Get<ICredentialVerifier>();
    private IAuthenticationSessions Sessions => world.Get<IAuthenticationSessions>();

    private Task<int> AccessFailedCountAsync(Guid id) => world.ScalarAsync<int>(
        "select access_failed_count from users where id = @id", ("id", id));

    #region VerifyAsync(string Email, string password)

    [Fact(DisplayName = "UTC01 - VerifyAsync: staff.sample active, dung mat khau -> Verified role Staff")]
    [Trait("Function", "VerifyAsync")]
    public async Task UTC01()
    {
        await world.AddStaffSampleAsync();

        var result = await Credentials.VerifyAsync(StaffEmail, StaffPassword, default);

        Assert.NotNull(result);
        Assert.Equal(StaffSampleId, result.UserId);
        Assert.Equal([Roles.Staff], result.Roles);
    }

    [Fact(DisplayName = "UTC02 - VerifyAsync: tenant.sample da kich hoat, dung mat khau -> Verified role Tenant")]
    [Trait("Function", "VerifyAsync")]
    public async Task UTC02()
    {
        await world.AddTenantSampleAsync();

        var result = await Credentials.VerifyAsync(TenantEmail, TenantPassword, default);

        Assert.NotNull(result);
        Assert.Equal(TenantSampleId, result.UserId);
        Assert.Equal([Roles.Tenant], result.Roles);
    }

    [Fact(DisplayName = "UTC03 - VerifyAsync: dang nhap bang SDT 0914139271 -> owner.sample Verified role Owner")]
    [Trait("Function", "VerifyAsync")]
    public async Task UTC03()
    {
        await world.AddOwnerSampleAsync();

        var result = await Credentials.VerifyAsync(OwnerPhone, OwnerPassword, default);

        Assert.NotNull(result);
        Assert.Equal(OwnerId, result.UserId);
        Assert.Equal([Roles.Owner], result.Roles);
    }

    [Fact(DisplayName = "UTC04 - VerifyAsync: Email = null -> null, khong kiem tra tai khoan")]
    [Trait("Function", "VerifyAsync")]
    public async Task UTC04()
    {
        await world.AddOwnerSampleAsync();

        var result = await Credentials.VerifyAsync(null!, OwnerPassword, default);

        Assert.Null(result);
        Assert.Equal(0, await AccessFailedCountAsync(OwnerId)); // account not checked
    }

    [Fact(DisplayName = "UTC05 - VerifyAsync: owner.sample sai mat khau -> null")]
    [Trait("Function", "VerifyAsync")]
    public async Task UTC05()
    {
        await world.AddOwnerSampleAsync();

        var result = await Credentials.VerifyAsync(OwnerEmail, "WrongPass999@", default);

        Assert.Null(result);
    }

    [Fact(DisplayName = "UTC06 - VerifyAsync: nobody@bhome.test khong ton tai -> null (khong lo tai khoan)")]
    [Trait("Function", "VerifyAsync")]
    public async Task UTC06()
    {
        await world.AddOwnerSampleAsync();

        var result = await Credentials.VerifyAsync("nobody@bhome.test", OwnerPassword, default);

        Assert.Null(result);
    }

    [Fact(DisplayName = "UTC07 - VerifyAsync: staff.api.test Inactive, dung mat khau -> null")]
    [Trait("Function", "VerifyAsync")]
    public async Task UTC07()
    {
        await world.AddStaffApiTestAsync(active: false);

        var result = await Credentials.VerifyAsync(StaffApiTestEmail, StaffApiTestPassword, default);

        Assert.Null(result);
    }

    [Fact(DisplayName = "UTC08 - VerifyAsync: staff1 dang bi khoa tam thoi, dung mat khau -> null")]
    [Trait("Function", "VerifyAsync")]
    public async Task UTC08()
    {
        await world.AddUserAsync(Staff1Id, "staff1@gmail.com", Roles.Staff, "Staff123456@");
        // Temporarily Locked: lockout ends 15 minutes after both the test clock and the real clock.
        var lockoutEnd = (world.Clock.GetUtcNow() > DateTimeOffset.UtcNow ? world.Clock.GetUtcNow() : DateTimeOffset.UtcNow).AddMinutes(15);
        await world.ExecAsync("update users set lockout_end = @end where id = @id", ("end", lockoutEnd), ("id", Staff1Id));

        var result = await Credentials.VerifyAsync("staff1@gmail.com", "Staff123456@", default);

        Assert.Null(result);
    }

    [Fact(DisplayName = "UTC11 - VerifyAsync: staff.api.test vua duoc bat lai Active, dung mat khau -> Verified role Staff")]
    [Trait("Function", "VerifyAsync")]
    public async Task UTC11()
    {
        await world.AddStaffApiTestAsync(active: false);
        await world.SetActiveAsync(StaffApiTestId, true); // the Owner has just set it back to Active

        var result = await Credentials.VerifyAsync(StaffApiTestEmail, StaffApiTestPassword, default);

        Assert.NotNull(result);
        Assert.Equal(StaffApiTestId, result.UserId);
        Assert.Equal([Roles.Staff], result.Roles);
    }

    #endregion

    #region CreateAsync(VerifiedIdentity identity, string? device)

    [Fact(DisplayName = "UTC09 - CreateAsync: owner.sample vua xac thuc, Roles [Owner], Mobile app -> session moi chi role Owner")]
    [Trait("Function", "CreateAsync")]
    public async Task UTC09()
    {
        await world.AddOwnerSampleAsync();
        var verified = await Credentials.VerifyAsync(OwnerEmail, OwnerPassword, default); // "was just verified"
        Assert.NotNull(verified);

        var result = await Sessions.CreateAsync(verified with { Roles = [Roles.Owner] }, MobileApp, default);

        Assert.NotNull(result);
        Assert.Equal(OwnerId, result.UserId);
        Assert.Equal([Roles.Owner], result.Roles);
        Assert.False(string.IsNullOrEmpty(result.AccessToken));
    }

    [Fact(DisplayName = "UTC10 - CreateAsync: owner.sample voi Roles [Administrator] -> null, khong tao session")]
    [Trait("Function", "CreateAsync")]
    public async Task UTC10()
    {
        await world.AddOwnerSampleAsync();
        var verified = await Credentials.VerifyAsync(OwnerEmail, OwnerPassword, default);
        Assert.NotNull(verified);

        var result = await Sessions.CreateAsync(verified with { Roles = ["Administrator"] }, MobileApp, default);

        Assert.Null(result);
        Assert.Equal(0L, await world.ScalarAsync<long>("select count(*) from refresh_tokens where user_id = @id", ("id", OwnerId)));
    }

    #endregion
}
