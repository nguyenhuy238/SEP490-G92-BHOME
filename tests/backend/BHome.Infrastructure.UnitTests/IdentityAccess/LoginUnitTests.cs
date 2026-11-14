using BHome.Application.IdentityAccess;
using BHome.Domain.IdentityAccess;
using BHome.Infrastructure.UnitTests.AccountProvisioning;
using static BHome.Infrastructure.UnitTests.AccountProvisioning.AccountProvisioningWorld;

namespace BHome.Infrastructure.UnitTests.IdentityAccess;

// Sheet "Login" of BHOME_Report-5.1_Unit_Test (UTC01–UTC10).
// Pre-conditions, inputs and expected results are taken from the sheet, not from the code.
// Accounts are synthetic and created in an isolated PostgreSQL database per test (never the shared Neon DB).
[Collection(AccountProvisioningCollection.Name)]
public sealed class LoginUnitTests(PostgresContainerFixture postgres) : IAsyncLifetime
{
    private AccountProvisioningWorld world = null!;

    public async Task InitializeAsync()
    {
        world = await AccountProvisioningWorld.CreateAsync(postgres);
        // Common pre-condition: "No user is signed in."
        world.CurrentUser.Set(null);
    }

    public async Task DisposeAsync() => await world.DisposeAsync();

    private ICredentialVerifier Credentials => world.Get<ICredentialVerifier>();
    private IAuthenticationSessions Sessions => world.Get<IAuthenticationSessions>();

    private Task AddOwnerSampleAsync() =>
        world.AddUserAsync(OwnerId, "owner.sample@example.invalid", Roles.Owner, "Owner123456@", phone: "0914139271");

    private Task<int> AccessFailedCountAsync(Guid id) => world.ScalarAsync<int>(
        "select access_failed_count from users where id = @id", ("id", id));

    // ----- VerifyAsync(string Email, string password) -----

    [Fact(DisplayName = "UTC01 - VerifyAsync: staff.sample active, dung mat khau -> Verified role Staff")]
    public async Task UTC01()
    {
        await world.AddUserAsync(StaffSampleId, "staff.sample@example.invalid", Roles.Staff, "12CharPass1@");

        var result = await Credentials.VerifyAsync("staff.sample@example.invalid", "12CharPass1@", default);

        Assert.NotNull(result);
        Assert.Equal(StaffSampleId, result.UserId);
        Assert.Equal([Roles.Staff], result.Roles);
    }

    [Fact(DisplayName = "UTC02 - VerifyAsync: tenant.sample da kich hoat, dung mat khau -> Verified role Tenant")]
    public async Task UTC02()
    {
        await world.AddUserAsync(TenantSampleId, "tenant.sample@example.invalid", Roles.Tenant, "MySecurePass2026@");

        var result = await Credentials.VerifyAsync("tenant.sample@example.invalid", "MySecurePass2026@", default);

        Assert.NotNull(result);
        Assert.Equal(TenantSampleId, result.UserId);
        Assert.Equal([Roles.Tenant], result.Roles);
    }

    [Fact(DisplayName = "UTC03 - VerifyAsync: dang nhap bang SDT 0914139271 -> owner.sample Verified role Owner")]
    public async Task UTC03()
    {
        await AddOwnerSampleAsync();

        var result = await Credentials.VerifyAsync("0914139271", "Owner123456@", default);

        Assert.NotNull(result);
        Assert.Equal(OwnerId, result.UserId);
        Assert.Equal([Roles.Owner], result.Roles);
    }

    [Fact(DisplayName = "UTC04 - VerifyAsync: Email = null -> null, khong kiem tra tai khoan")]
    public async Task UTC04()
    {
        await AddOwnerSampleAsync();

        var result = await Credentials.VerifyAsync(null!, "Owner123456@", default);

        Assert.Null(result);
        Assert.Equal(0, await AccessFailedCountAsync(OwnerId)); // account not checked
    }

    [Fact(DisplayName = "UTC05 - VerifyAsync: owner.sample sai mat khau -> null")]
    public async Task UTC05()
    {
        await AddOwnerSampleAsync();

        var result = await Credentials.VerifyAsync("owner.sample@example.invalid", "WrongPass999@", default);

        Assert.Null(result);
    }

    [Fact(DisplayName = "UTC06 - VerifyAsync: nobody@bhome.test khong ton tai -> null (khong lo tai khoan)")]
    public async Task UTC06()
    {
        await AddOwnerSampleAsync();

        var result = await Credentials.VerifyAsync("nobody@bhome.test", "Owner123456@", default);

        Assert.Null(result);
    }

    [Fact(DisplayName = "UTC07 - VerifyAsync: staff.api.test Inactive, dung mat khau -> null")]
    public async Task UTC07()
    {
        await world.AddUserAsync(StaffApiTestId, "staff.api.test@example.invalid", Roles.Staff, "Staff123456@", active: false);

        var result = await Credentials.VerifyAsync("staff.api.test@example.invalid", "Staff123456@", default);

        Assert.Null(result);
    }

    [Fact(DisplayName = "UTC08 - VerifyAsync: staff1 dang bi khoa tam thoi, dung mat khau -> null")]
    public async Task UTC08()
    {
        await world.AddUserAsync(Staff1Id, "staff1@gmail.com", Roles.Staff, "Staff123456@");
        // Temporarily Locked: lockout ends 15 minutes after both the test clock and the real clock.
        var lockoutEnd = (world.Clock.GetUtcNow() > DateTimeOffset.UtcNow ? world.Clock.GetUtcNow() : DateTimeOffset.UtcNow).AddMinutes(15);
        await world.ExecAsync("update users set lockout_end = @end where id = @id", ("end", lockoutEnd), ("id", Staff1Id));

        var result = await Credentials.VerifyAsync("staff1@gmail.com", "Staff123456@", default);

        Assert.Null(result);
    }

    // ----- CreateAsync(VerifiedIdentity identity, string? device) -----

    [Fact(DisplayName = "UTC09 - CreateAsync: owner.sample vua xac thuc, Roles [Owner], Mobile app -> session moi chi role Owner")]
    public async Task UTC09()
    {
        await AddOwnerSampleAsync();
        // Pre-condition "was just verified": the identity comes from a successful verification.
        var verified = await Credentials.VerifyAsync("owner.sample@example.invalid", "Owner123456@", default);
        Assert.NotNull(verified);

        var result = await Sessions.CreateAsync(verified with { Roles = [Roles.Owner] }, "Mobile app", default);

        Assert.NotNull(result);
        Assert.Equal(OwnerId, result.UserId);
        Assert.Equal([Roles.Owner], result.Roles);
        Assert.False(string.IsNullOrEmpty(result.AccessToken));
    }

    [Fact(DisplayName = "UTC10 - CreateAsync: owner.sample voi Roles [Administrator] -> null, khong tao session")]
    public async Task UTC10()
    {
        await AddOwnerSampleAsync();
        var verified = await Credentials.VerifyAsync("owner.sample@example.invalid", "Owner123456@", default);
        Assert.NotNull(verified);

        var result = await Sessions.CreateAsync(verified with { Roles = ["Administrator"] }, "Mobile app", default);

        Assert.Null(result);
        Assert.Equal(0L, await world.ScalarAsync<long>("select count(*) from refresh_tokens where user_id = @id", ("id", OwnerId)));
    }
}
