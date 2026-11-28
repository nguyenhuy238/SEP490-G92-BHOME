namespace BHome.DigitalSigning.Application.Identity;

// Supplied by the host so signing does not depend on the host's application project.
public interface ISigningCurrentUser
{
    Guid? UserId { get; }
    bool IsInRole(string role);
}

public static class SigningRoles
{
    public const string Owner = "Owner";
    public const string Staff = "Staff";
    public const string Tenant = "Tenant";

    public static IReadOnlyList<string> All { get; } = Array.AsReadOnly([Owner, Staff, Tenant]);
}
