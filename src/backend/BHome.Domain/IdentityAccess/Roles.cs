namespace BHome.Domain.IdentityAccess;

public static class Roles
{
    public const string Owner = "Owner";
    public const string Staff = "Staff";
    public const string Tenant = "Tenant";

    public static IReadOnlyList<string> All { get; } = Array.AsReadOnly([Owner, Staff, Tenant]);
}
