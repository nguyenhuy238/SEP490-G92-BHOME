using BHome.Application.IdentityAccess;
using BHome.Domain.IdentityAccess;
using BHome.Infrastructure.UnitTests.AccountProvisioning;
using BHome.Infrastructure.UnitTests.Shared;
using static BHome.Infrastructure.UnitTests.AccountProvisioning.AccountProvisioningWorld;
using static BHome.Infrastructure.UnitTests.Shared.IdentityArrange;

namespace BHome.Infrastructure.UnitTests.Session;

// Report 5.1 – sheet "Session" (UTC01–UTC15).
// Pre-conditions, inputs and expected results are taken from the sheet, not from the code.
// Run only this sheet:  dotnet test --filter "Sheet=Session"   ·   one function:  --filter "Sheet=Session&Function=RefreshAsync"
[Collection(AccountProvisioningCollection.Name)]
[Trait("Suite", "QA-SrsUnit")]
[Trait("Sheet", "Session")]
public sealed class SessionUnitTests(PostgresContainerFixture postgres) : IAsyncLifetime
{
    private static readonly Guid UnknownSessionId = Guid.Parse("00000000-0000-0000-0000-000000000999");
    private AccountProvisioningWorld world = null!;

    public async Task InitializeAsync() => world = await AccountProvisioningWorld.CreateAsync(postgres);

    public async Task DisposeAsync() => await world.DisposeAsync();

    private IAuthenticationSessions Sessions => world.Get<IAuthenticationSessions>();

    private async Task<LoginResult> OwnerOnMobileAsync()
    {
        await world.AddOwnerSampleAsync();
        return await world.SignInAsync(OwnerEmail, OwnerPassword, MobileApp);
    }

    private async Task<LoginResult> StaffOnMobileAsync()
    {
        await world.AddStaffSampleAsync();
        return await world.SignInAsync(StaffEmail, StaffPassword, MobileApp);
    }

    private async Task<LoginResult> TenantOnMobileAsync()
    {
        await world.AddTenantSampleAsync();
        return await world.SignInAsync(TenantEmail, TenantPassword, MobileApp);
    }

    // staff.api.test signed in on the Mobile app, then the Owner deactivated it.
    private async Task<(LoginResult Login, string StampOfSession)> StaffApiTestDeactivatedAfterSignInAsync()
    {
        await world.AddStaffApiTestAsync();
        var login = await world.SignInAsync(StaffApiTestEmail, StaffApiTestPassword, MobileApp);
        var stamp = await world.StampAsync(StaffApiTestId);
        await world.SetActiveAsync(StaffApiTestId, false);
        return (login, stamp);
    }

    #region ValidateAsync(SessionIdentity identity, string securityStamp)

    [Fact(DisplayName = "UTC01 - ValidateAsync: owner.sample, phien Mobile app dang hoat dong, Roles [Owner] -> true")]
    [Trait("Function", "ValidateAsync")]
    public async Task UTC01()
    {
        var owner = await OwnerOnMobileAsync();

        var result = await Sessions.ValidateAsync(
            new SessionIdentity(OwnerId, owner.SessionId, [Roles.Owner]), await world.StampAsync(OwnerId), default);

        Assert.True(result);
    }

    [Fact(DisplayName = "UTC02 - ValidateAsync: owner.sample da dang xuat phien Mobile app -> false")]
    [Trait("Function", "ValidateAsync")]
    public async Task UTC02()
    {
        var owner = await OwnerOnMobileAsync();
        await world.SignOutAsync(owner);

        var result = await Sessions.ValidateAsync(
            new SessionIdentity(OwnerId, owner.SessionId, [Roles.Owner]), await world.StampAsync(OwnerId), default);

        Assert.False(result);
    }

    [Fact(DisplayName = "UTC03 - ValidateAsync: staff.api.test bi Owner khoa sau khi dang nhap -> false")]
    [Trait("Function", "ValidateAsync")]
    public async Task UTC03()
    {
        var (login, stamp) = await StaffApiTestDeactivatedAfterSignInAsync();

        var result = await Sessions.ValidateAsync(new SessionIdentity(StaffApiTestId, login.SessionId, [Roles.Staff]), stamp, default);

        Assert.False(result);
    }

    [Fact(DisplayName = "UTC04 - ValidateAsync: tenant.sample, phien Mobile app dang hoat dong, Roles [Tenant] -> true")]
    [Trait("Function", "ValidateAsync")]
    public async Task UTC04()
    {
        var tenant = await TenantOnMobileAsync();

        var result = await Sessions.ValidateAsync(
            new SessionIdentity(TenantSampleId, tenant.SessionId, [Roles.Tenant]), await world.StampAsync(TenantSampleId), default);

        Assert.True(result);
    }

    [Fact(DisplayName = "UTC05 - ValidateAsync: staff.sample gui Roles [Owner] (sua role) -> false")]
    [Trait("Function", "ValidateAsync")]
    public async Task UTC05()
    {
        var staff = await StaffOnMobileAsync();

        var result = await Sessions.ValidateAsync(
            new SessionIdentity(StaffSampleId, staff.SessionId, [Roles.Owner]), await world.StampAsync(StaffSampleId), default);

        Assert.False(result);
    }

    [Fact(DisplayName = "UTC06 - ValidateAsync: SessionId khong ton tai -> false")]
    [Trait("Function", "ValidateAsync")]
    public async Task UTC06()
    {
        await OwnerOnMobileAsync();

        var result = await Sessions.ValidateAsync(
            new SessionIdentity(OwnerId, UnknownSessionId, [Roles.Owner]), await world.StampAsync(OwnerId), default);

        Assert.False(result);
    }

    [Fact(DisplayName = "UTC07 - ValidateAsync: staff.sample dung phien cua owner.sample -> false")]
    [Trait("Function", "ValidateAsync")]
    public async Task UTC07()
    {
        var owner = await OwnerOnMobileAsync();
        await StaffOnMobileAsync();

        var result = await Sessions.ValidateAsync(
            new SessionIdentity(StaffSampleId, owner.SessionId, [Roles.Staff]), await world.StampAsync(StaffSampleId), default);

        Assert.False(result);
    }

    #endregion

    #region RevokeAsync(Guid userId, Guid sessionId, bool allDevices)

    [Fact(DisplayName = "UTC08 - RevokeAsync: owner.sample dang xuat Mobile app (allDevices=false) -> Web Portal van hoat dong")]
    [Trait("Function", "RevokeAsync")]
    public async Task UTC08()
    {
        var mobile = await OwnerOnMobileAsync();
        var web = await world.SignInAsync(OwnerEmail, OwnerPassword, OwnerWebPortal);

        await Sessions.RevokeAsync(OwnerId, mobile.SessionId, allDevices: false, default);

        Assert.False(await world.IsSessionActiveAsync(mobile)); // Mobile app session ended
        Assert.True(await world.IsSessionActiveAsync(web));     // Web Portal session still active
    }

    [Fact(DisplayName = "UTC09 - RevokeAsync: owner.sample dang xuat phien cua staff.sample -> phien Staff van hoat dong")]
    [Trait("Function", "RevokeAsync")]
    public async Task UTC09()
    {
        await OwnerOnMobileAsync();
        var staff = await StaffOnMobileAsync();

        await Sessions.RevokeAsync(OwnerId, staff.SessionId, allDevices: false, default);

        Assert.True(await world.IsSessionActiveAsync(staff));
    }

    #endregion

    #region RefreshAsync(string token)

    [Fact(DisplayName = "UTC10 - RefreshAsync: refresh token hop le cua owner.sample -> ket qua dang nhap moi, role Owner")]
    [Trait("Function", "RefreshAsync")]
    public async Task UTC10()
    {
        var owner = await OwnerOnMobileAsync();

        var result = await Sessions.RefreshAsync(owner.RefreshToken!, default);

        Assert.NotNull(result);
        Assert.Equal(OwnerId, result.UserId);
        Assert.Equal([Roles.Owner], result.Roles);
        Assert.True(await world.IsSessionActiveAsync(result)); // user stays signed in
    }

    [Fact(DisplayName = "UTC11 - RefreshAsync: refresh token cua phien da dang xuat -> null")]
    [Trait("Function", "RefreshAsync")]
    public async Task UTC11()
    {
        var owner = await OwnerOnMobileAsync();
        await world.SignOutAsync(owner);

        var result = await Sessions.RefreshAsync(owner.RefreshToken!, default);

        Assert.Null(result);
    }

    [Fact(DisplayName = "UTC12 - RefreshAsync: refresh token hop le cua tenant.sample -> ket qua dang nhap moi, chi role Tenant")]
    [Trait("Function", "RefreshAsync")]
    public async Task UTC12()
    {
        var tenant = await TenantOnMobileAsync();

        var result = await Sessions.RefreshAsync(tenant.RefreshToken!, default);

        Assert.NotNull(result);
        Assert.Equal([Roles.Tenant], result.Roles);
        Assert.True(await world.IsSessionActiveAsync(result));
    }

    [Fact(DisplayName = "UTC13 - RefreshAsync: staff.api.test bi khoa sau khi dang nhap -> null")]
    [Trait("Function", "RefreshAsync")]
    public async Task UTC13()
    {
        var (login, _) = await StaffApiTestDeactivatedAfterSignInAsync();

        var result = await Sessions.RefreshAsync(login.RefreshToken!, default);

        Assert.Null(result);
    }

    [Fact(DisplayName = "UTC14 - RefreshAsync: token gia 'tampered_fake_refresh_token' -> null")]
    [Trait("Function", "RefreshAsync")]
    public async Task UTC14()
    {
        await OwnerOnMobileAsync();

        var result = await Sessions.RefreshAsync("tampered_fake_refresh_token", default);

        Assert.Null(result);
    }

    [Fact(DisplayName = "UTC15 - RefreshAsync: token rong \"\" -> null")]
    [Trait("Function", "RefreshAsync")]
    public async Task UTC15()
    {
        await OwnerOnMobileAsync();

        var result = await Sessions.RefreshAsync("", default);

        Assert.Null(result);
    }

    #endregion
}
