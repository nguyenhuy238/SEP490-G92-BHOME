using System.Collections.Frozen;

namespace BHome.Domain.IdentityAccess;

// SRS v1.3 I.4.4 / GBR-01..03: explicit grants, no role hierarchy or Owner wildcard.
// Each action still requires its server-loaded resource scope and business-state checks.
public static class RolePermissions
{
    public static IReadOnlyDictionary<string, IReadOnlyList<string>> All { get; } =
        new Dictionary<string, IReadOnlyList<string>>
        {
            [Permissions.Account.ViewOwn] = Allow(Roles.Owner, Roles.Staff, Roles.Tenant),
            [Permissions.Account.UpdateOwn] = Allow(Roles.Owner, Roles.Staff, Roles.Tenant),
            [Permissions.Account.ChangePassword] = Allow(Roles.Owner, Roles.Staff, Roles.Tenant),
            [Permissions.Sessions.RevokeOwn] = Allow(Roles.Owner, Roles.Staff, Roles.Tenant),
            [Permissions.StaffAccounts.Manage] = Allow(Roles.Owner),
            [Permissions.StaffAssignments.Manage] = Allow(Roles.Owner),
            [Permissions.Locations.Manage] = Allow(Roles.Owner),
            [Permissions.Rooms.View] = Allow(Roles.Owner, Roles.Staff, Roles.Tenant),
            [Permissions.Rooms.Manage] = Allow(Roles.Owner),
            [Permissions.Assets.UpdateCondition] = Allow(Roles.Owner, Roles.Staff),
            [Permissions.OperationalTasks.Manage] = Allow(Roles.Owner),
            [Permissions.OperationalTasks.Execute] = Allow(Roles.Staff),
            [Permissions.OperationalTasks.Verify] = Allow(Roles.Owner),
            [Permissions.Contracts.Prepare] = Allow(Roles.Owner, Roles.Staff),
            [Permissions.Contracts.Activate] = Allow(Roles.Owner),
            [Permissions.Contracts.Sign] = Allow(Roles.Owner, Roles.Tenant),
            [Permissions.MeterReadings.Confirm] = Allow(Roles.Staff),
            [Permissions.Invoices.View] = Allow(Roles.Owner),
            [Permissions.Invoices.ViewOperational] = Allow(Roles.Staff),
            [Permissions.Invoices.ViewOwn] = Allow(Roles.Tenant),
            [Permissions.InvoiceAdjustments.Request] = Allow(Roles.Tenant),
            [Permissions.InvoiceAdjustments.Approve] = Allow(Roles.Owner),
            [Permissions.Incidents.Report] = Allow(Roles.Staff, Roles.Tenant),
            [Permissions.WorkOrders.ApprovePlan] = Allow(Roles.Owner),
            [Permissions.WorkOrders.Execute] = Allow(Roles.Staff),
            [Permissions.WorkOrders.Verify] = Allow(Roles.Owner),
            [Permissions.Finance.View] = Allow(Roles.Owner),
            [Permissions.Notifications.ReadOwn] = Allow(Roles.Owner, Roles.Staff, Roles.Tenant),
            [Permissions.PublicContent.Publish] = Allow(Roles.Owner)
        }.ToFrozenDictionary(StringComparer.Ordinal);

    public static IReadOnlyList<string> GetAllowedRoles(string? permission) =>
        permission is not null && All.TryGetValue(permission, out var roles) ? roles : Array.Empty<string>();

    private static IReadOnlyList<string> Allow(params string[] roles) => Array.AsReadOnly(roles);
}
