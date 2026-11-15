using BHome.Application.IdentityAccess;
using BHome.Domain.IdentityAccess;
using BHome.Infrastructure.UnitTests.AccountProvisioning;
using static BHome.Infrastructure.UnitTests.AccountProvisioning.AccountProvisioningWorld;

namespace BHome.Infrastructure.UnitTests.Shared;

// Pre-condition builders shared by the IdentityAccess sheets (Login, Session, Password, Profile, ResourceAccess).
// Accounts, passwords and IDs are the synthetic ones written in Report 5.1; nothing here touches the shared Neon DB.
internal static class IdentityArrange
{
    public const string OwnerEmail = "owner.sample@example.invalid";
    public const string OwnerPassword = "Owner123456@";
    public const string OwnerPhone = "0914139271";
    public const string StaffEmail = "staff.sample@example.invalid";
    public const string StaffPassword = "12CharPass1@";
    public const string TenantEmail = "tenant.sample@example.invalid";
    public const string TenantPassword = "MySecurePass2026@";
    public const string StaffApiTestEmail = "staff.api.test@example.invalid";
    public const string StaffApiTestPassword = "Staff123456@";

    public const string MobileApp = "Mobile app";
    public const string OwnerWebPortal = "Owner Web Portal";

    public static Task AddOwnerSampleAsync(this AccountProvisioningWorld world) =>
        world.AddUserAsync(OwnerId, OwnerEmail, Roles.Owner, OwnerPassword, phone: OwnerPhone);

    public static Task AddStaffSampleAsync(this AccountProvisioningWorld world) =>
        world.AddUserAsync(StaffSampleId, StaffEmail, Roles.Staff, StaffPassword);

    public static Task AddTenantSampleAsync(this AccountProvisioningWorld world) =>
        world.AddUserAsync(TenantSampleId, TenantEmail, Roles.Tenant, TenantPassword);

    public static Task AddStaffApiTestAsync(this AccountProvisioningWorld world, bool active = true) =>
        world.AddUserAsync(StaffApiTestId, StaffApiTestEmail, Roles.Staff, StaffApiTestPassword, active: active);

    // "X is signed in on <device>": a real verification followed by a real session (CreateAsync).
    public static async Task<LoginResult> SignInAsync(this AccountProvisioningWorld world, string email, string password, string device)
    {
        var verified = await world.Get<ICredentialVerifier>().VerifyAsync(email, password, default);
        Assert.NotNull(verified);
        var login = await world.Get<IAuthenticationSessions>().CreateAsync(verified, device, default);
        Assert.NotNull(login);
        return login;
    }

    // "X signed out of its session": the real sign-out of that one session.
    public static Task SignOutAsync(this AccountProvisioningWorld world, LoginResult login) =>
        world.Get<IAuthenticationSessions>().RevokeAsync(login.UserId, login.SessionId, allDevices: false, default);

    // "The Owner deactivated it" / "set it back to Active": account status as stored in users.is_active.
    public static Task SetActiveAsync(this AccountProvisioningWorld world, Guid userId, bool active) =>
        world.ExecAsync("update users set is_active = @a where id = @id", ("a", active), ("id", userId));

    public static Task<string> StampAsync(this AccountProvisioningWorld world, Guid userId) =>
        world.ScalarAsync<string>("select security_stamp from users where id = @id", ("id", userId));

    public static async Task<bool> IsSessionActiveAsync(this AccountProvisioningWorld world, LoginResult login) =>
        await world.Get<IAuthenticationSessions>().ValidateAsync(
            new SessionIdentity(login.UserId, login.SessionId, login.Roles), await world.StampAsync(login.UserId), default);

    public static async Task<bool> CanSignInAsync(this AccountProvisioningWorld world, string email, string password) =>
        await world.Get<ICredentialVerifier>().VerifyAsync(email, password, default) is not null;
}
