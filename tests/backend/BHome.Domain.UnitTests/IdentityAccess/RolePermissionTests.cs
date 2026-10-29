using System.Reflection;
using BHome.Domain.IdentityAccess;

namespace BHome.Domain.UnitTests.IdentityAccess;

public sealed class RolePermissionTests
{
    // Acceptance matrix from SRS I.4.4: independent expected grants, including explicit denials.
    public static TheoryData<string, string[]> Matrix => new()
    {
        { Permissions.Account.ViewOwn, [Roles.Owner, Roles.Staff, Roles.Tenant] },
        { Permissions.Account.UpdateOwn, [Roles.Owner, Roles.Staff, Roles.Tenant] },
        { Permissions.Account.ChangePassword, [Roles.Owner, Roles.Staff, Roles.Tenant] },
        { Permissions.Sessions.RevokeOwn, [Roles.Owner, Roles.Staff, Roles.Tenant] },
        { Permissions.StaffAccounts.Manage, [Roles.Owner] },
        { Permissions.StaffAssignments.Manage, [Roles.Owner] },
        { Permissions.Locations.Manage, [Roles.Owner] },
        { Permissions.Locations.ViewAssigned, [Roles.Staff] },
        { Permissions.Rooms.View, [Roles.Owner, Roles.Staff, Roles.Tenant] },
        { Permissions.Rooms.Manage, [Roles.Owner] },
        { Permissions.Assets.View, [Roles.Owner, Roles.Staff] },
        { Permissions.Assets.Manage, [Roles.Owner] },
        { Permissions.Assets.UpdateCondition, [Roles.Owner, Roles.Staff] },
        { Permissions.OperationalTasks.Manage, [Roles.Owner] },
        { Permissions.OperationalTasks.Execute, [Roles.Staff] },
        { Permissions.OperationalTasks.Verify, [Roles.Owner] },
        { Permissions.Contracts.Prepare, [Roles.Owner, Roles.Staff] },
        { Permissions.Contracts.Activate, [Roles.Owner] },
        { Permissions.Contracts.Sign, [Roles.Owner, Roles.Tenant] },
        { Permissions.MeterReadings.Confirm, [Roles.Staff] },
        { Permissions.Invoices.View, [Roles.Owner] },
        { Permissions.Invoices.ViewOperational, [Roles.Staff] },
        { Permissions.Invoices.ViewOwn, [Roles.Tenant] },
        { Permissions.InvoiceAdjustments.Request, [Roles.Tenant] },
        { Permissions.InvoiceAdjustments.Approve, [Roles.Owner] },
        { Permissions.Incidents.Report, [Roles.Staff, Roles.Tenant] },
        { Permissions.Incidents.View, [Roles.Owner, Roles.Staff, Roles.Tenant] },
        { Permissions.Incidents.RespondEmergency, [Roles.Owner, Roles.Staff] },
        { Permissions.Incidents.Review, [Roles.Owner] },
        { Permissions.WorkOrders.ApprovePlan, [Roles.Owner] },
        { Permissions.WorkOrders.Execute, [Roles.Staff] },
        { Permissions.WorkOrders.Verify, [Roles.Owner] },
        { Permissions.Finance.View, [Roles.Owner] },
        { Permissions.Notifications.ReadOwn, [Roles.Owner, Roles.Staff, Roles.Tenant] },
        { Permissions.PublicContent.Publish, [Roles.Owner] }
    };

    [Theory]
    [MemberData(nameof(Matrix))]
    public void GrantsExactlyTheRolesApprovedForTheAction(string permission, string[] expected)
    {
        Assert.Equal(expected.Order(), RolePermissions.GetAllowedRoles(permission).Order());
    }

    [Fact]
    public void EveryPermissionConstantHasOneExplicitGrantAndNoUnsupportedRole()
    {
        var constants = typeof(Permissions).GetNestedTypes().SelectMany(type => type.GetFields(BindingFlags.Public | BindingFlags.Static))
            .Where(field => field.IsLiteral).Select(field => (string)field.GetRawConstantValue()!).ToArray();
        Assert.Equal(constants.Length, constants.Distinct().Count());
        Assert.Equal(constants.Order(), RolePermissions.All.Keys.Order());
        Assert.All(RolePermissions.All.Values, roles =>
        {
            Assert.NotEmpty(roles);
            Assert.All(roles, role => Assert.Contains(role, Roles.All));
            Assert.Equal(roles.Count, roles.Distinct().Count());
        });
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("*")]
    [InlineData("Owner")]
    [InlineData("ROOMS.VIEW")]
    [InlineData("government-registration.submit")]
    public void UnknownPermissionHasNoGrant(string? permission) => Assert.Empty(RolePermissions.GetAllowedRoles(permission));
}
