using BHome.Application.Operations;
using BHome.Domain.IdentityAccess;
using BHome.Infrastructure.UnitTests.AccountProvisioning;
using BHome.Infrastructure.UnitTests.Shared;
using static BHome.Infrastructure.UnitTests.AccountProvisioning.AccountProvisioningWorld;
using static BHome.Infrastructure.UnitTests.Shared.IdentityArrange;

namespace BHome.Infrastructure.UnitTests.Profile;

// Report 5.1 – sheet "Profile" (UTC01–UTC13).
// Pre-conditions, inputs and expected results are taken from the sheet, not from the code.
// ProfileAsync(Guid userId) is called on IOperationsRepository (same signature as the sheet).
// UpdateProfileAsync(Guid userId, ProfileUpdate input, DateTimeOffset now) is called through OperationsService,
// which validates the input and passes userId (= signed-in user) and now (= test clock) to the repository function.
// Run only this sheet:  dotnet test --filter "Sheet=Profile"   ·   one function:  --filter "Sheet=Profile&Function=UpdateProfileAsync"
[Collection(AccountProvisioningCollection.Name)]
[Trait("Suite", "QA-SrsUnit")]
[Trait("Sheet", "Profile")]
public sealed class ProfileUnitTests(PostgresContainerFixture postgres) : IAsyncLifetime
{
    private static readonly Guid UnknownUserId = Guid.Parse("00000000-0000-0000-0000-000000000999");
    private static readonly DateTimeOffset Now = new(2026, 11, 12, 9, 0, 0, TimeSpan.FromHours(7)); // now = 2026-11-12 09:00 (UTC+7)

    private AccountProvisioningWorld world = null!;

    public async Task InitializeAsync()
    {
        world = await AccountProvisioningWorld.CreateAsync(postgres, Now);
    }

    public async Task DisposeAsync() => await world.DisposeAsync();

    private IOperationsRepository Repository => world.Get<IOperationsRepository>();
    private OperationsService Operations => world.Get<OperationsService>();

    // "Staff staff.sample@example.invalid is signed in (FullName "Staff Sample", Phone null, Active)."
    private async Task StaffSignedInAsync()
    {
        await world.AddStaffSampleAsync();
        await world.ExecAsync("update users set full_name = 'Staff Sample', phone = null where id = @id", ("id", StaffSampleId));
        world.CurrentUser.Set(StaffSampleId, Roles.Staff);
    }

    private async Task<ProfileView> StaffProfileAsync() => (await Repository.ProfileAsync(StaffSampleId, default))!;

    private async Task<ProfileUpdate> UpdateOf(string fullName, string? phone, string email) =>
        new(fullName, phone, email, (await StaffProfileAsync()).Version);

    #region ProfileAsync(Guid userId)

    [Fact(DisplayName = "UTC01 - ProfileAsync: tenant.sample -> ho so co Role Tenant, Status Active")]
    [Trait("Function", "ProfileAsync")]
    public async Task UTC01()
    {
        await world.AddTenantSampleAsync();
        world.CurrentUser.Set(TenantSampleId, Roles.Tenant);

        var result = await Repository.ProfileAsync(TenantSampleId, default);

        Assert.NotNull(result);
        Assert.Equal(TenantEmail, result.Email);
        Assert.Equal([Roles.Tenant], result.Roles);
        Assert.True(result.IsActive);
    }

    [Fact(DisplayName = "UTC02 - ProfileAsync: userId 00000000-...-0999 khong ton tai -> null")]
    [Trait("Function", "ProfileAsync")]
    public async Task UTC02()
    {
        var result = await Repository.ProfileAsync(UnknownUserId, default);

        Assert.Null(result);
    }

    [Fact(DisplayName = "UTC03 - ProfileAsync: staff.sample -> ho so co Role Staff, Status Active")]
    [Trait("Function", "ProfileAsync")]
    public async Task UTC03()
    {
        await StaffSignedInAsync();

        var result = await Repository.ProfileAsync(StaffSampleId, default);

        Assert.NotNull(result);
        Assert.Equal("Staff Sample", result.FullName);
        Assert.Equal(StaffEmail, result.Email);
        Assert.Equal([Roles.Staff], result.Roles);
        Assert.True(result.IsActive);
    }

    [Fact(DisplayName = "UTC04 - ProfileAsync: owner.sample -> Phone 0914139271, Email owner.sample, Role Owner, Active")]
    [Trait("Function", "ProfileAsync")]
    public async Task UTC04()
    {
        await world.AddOwnerSampleAsync();
        world.CurrentUser.Set(OwnerId, Roles.Owner);

        var result = await Repository.ProfileAsync(OwnerId, default);

        Assert.NotNull(result);
        Assert.Equal(OwnerPhone, result.Phone);
        Assert.Equal(OwnerEmail, result.Email);
        Assert.Equal([Roles.Owner], result.Roles);
        Assert.True(result.IsActive);
    }

    #endregion

    #region UpdateProfileAsync(Guid userId, ProfileUpdate input, DateTimeOffset now)

    [Fact(DisplayName = "UTC05 - UpdateProfileAsync: FullName Tran Van Tam, Phone 0987654321 -> luu, Role/Status giu nguyen")]
    [Trait("Function", "UpdateProfileAsync")]
    public async Task UTC05()
    {
        await StaffSignedInAsync();

        var result = await Operations.UpdateProfileAsync(await UpdateOf("Tran Van Tam", "0987654321", StaffEmail), default);

        Assert.Equal("Tran Van Tam", result.FullName);
        Assert.Equal("0987654321", result.Phone);
        Assert.Equal([Roles.Staff], result.Roles);
        Assert.True(result.IsActive);
    }

    [Fact(DisplayName = "UTC06 - UpdateProfileAsync: gui Role Owner -> Role van la Staff")]
    [Trait("Function", "UpdateProfileAsync")]
    public async Task UTC06()
    {
        await StaffSignedInAsync();
        // ProfileUpdate has no Role field, so Role = "Owner" cannot reach the function; the stored role is checked after saving.

        await Record.ExceptionAsync(async () => await Operations.UpdateProfileAsync(await UpdateOf("Staff Sample", null, StaffEmail), default));

        Assert.Equal([Roles.Staff], (await StaffProfileAsync()).Roles);
    }

    [Fact(DisplayName = "UTC07 - UpdateProfileAsync: FullName rong -> khong cap nhat (MSG02)")]
    [Trait("Function", "UpdateProfileAsync")]
    public async Task UTC07()
    {
        await StaffSignedInAsync();
        var before = Snapshot(await StaffProfileAsync());

        var error = await Record.ExceptionAsync(async () => await Operations.UpdateProfileAsync(await UpdateOf("", "0987654321", StaffEmail), default));

        Assert.NotNull(error);
        Assert.Equal(before, Snapshot(await StaffProfileAsync())); // not updated
    }

    [Fact(DisplayName = "UTC08 - UpdateProfileAsync: gui Account Status Inactive -> Status van Active")]
    [Trait("Function", "UpdateProfileAsync")]
    public async Task UTC08()
    {
        await StaffSignedInAsync();
        // ProfileUpdate has no Account Status field (read-only); the stored status is checked after saving.

        await Record.ExceptionAsync(async () => await Operations.UpdateProfileAsync(await UpdateOf("Staff Sample", null, StaffEmail), default));

        Assert.True((await StaffProfileAsync()).IsActive);
    }

    [Fact(DisplayName = "UTC09 - UpdateProfileAsync: Email trung tenant.sample -> khong cap nhat, bao trung")]
    [Trait("Function", "UpdateProfileAsync")]
    public async Task UTC09()
    {
        await StaffSignedInAsync();
        await world.AddTenantSampleAsync();

        var error = await Record.ExceptionAsync(async () => await Operations.UpdateProfileAsync(await UpdateOf("Staff Sample", null, TenantEmail), default));

        Assert.NotNull(error);
        Assert.Contains("email", ErrorCode(error));             // duplicate is reported
        Assert.Equal(StaffEmail, (await StaffProfileAsync()).Email);
    }

    [Fact(DisplayName = "UTC10 - UpdateProfileAsync: Phone trung owner.sample 0914139271 -> khong cap nhat, bao trung")]
    [Trait("Function", "UpdateProfileAsync")]
    public async Task UTC10()
    {
        await StaffSignedInAsync();
        await world.AddOwnerSampleAsync();

        var error = await Record.ExceptionAsync(async () => await Operations.UpdateProfileAsync(await UpdateOf("Staff Sample", OwnerPhone, StaffEmail), default));

        Assert.NotNull(error);
        Assert.Contains("phone", ErrorCode(error));             // duplicate is reported
        Assert.Null((await StaffProfileAsync()).Phone);
    }

    [Fact(DisplayName = "UTC11 - UpdateProfileAsync: FullName chi co khoang trang -> khong cap nhat (MSG02)")]
    [Trait("Function", "UpdateProfileAsync")]
    public async Task UTC11()
    {
        await StaffSignedInAsync();
        var before = Snapshot(await StaffProfileAsync());

        var error = await Record.ExceptionAsync(async () => await Operations.UpdateProfileAsync(await UpdateOf("   ", null, StaffEmail), default));

        Assert.NotNull(error);
        Assert.Equal(before, Snapshot(await StaffProfileAsync()));
    }

    [Fact(DisplayName = "UTC12 - UpdateProfileAsync: Email sai dinh dang 'staff.sample' -> khong cap nhat")]
    [Trait("Function", "UpdateProfileAsync")]
    public async Task UTC12()
    {
        await StaffSignedInAsync();

        var error = await Record.ExceptionAsync(async () => await Operations.UpdateProfileAsync(await UpdateOf("Staff Sample", null, "staff.sample"), default));

        Assert.NotNull(error);
        Assert.Equal(StaffEmail, (await StaffProfileAsync()).Email);
    }

    [Fact(DisplayName = "UTC13 - UpdateProfileAsync: userId khong ton tai -> khong tao/doi tai khoan nao")]
    [Trait("Function", "UpdateProfileAsync")]
    public async Task UTC13()
    {
        world.CurrentUser.Set(UnknownUserId, Roles.Staff);

        var error = await Record.ExceptionAsync(() => Operations.UpdateProfileAsync(
            new ProfileUpdate("Tran Van Tam", null, "nobody@bhome.test", "any-version"), default));

        Assert.NotNull(error);
        Assert.Equal(0L, await world.ScalarAsync<long>("select count(*) from users"));
    }

    #endregion

    private static (string FullName, string? Phone, string? Email, string Version) Snapshot(ProfileView p) => (p.FullName, p.Phone, p.Email, p.Version);

    private static string ErrorCode(Exception error) =>
        (error.GetType().GetProperty("Code")?.GetValue(error) as string ?? error.Message).ToLowerInvariant();
}
