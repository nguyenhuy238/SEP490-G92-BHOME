namespace BHome.Application.Storage;

// New uploads use server-owned IDs only. Existing stored object keys remain
// authoritative for reads, verification, cleanup and historical references.
public static class PrivateImageKeys
{
    public static string Evidence(Guid location, Guid? room, string category, Guid resource, Guid file) =>
        room is { } id
            ? $"images/locations/{location:N}/rooms/{id:N}/{category}/{resource:N}/{file:N}"
            : $"images/locations/{location:N}/{category}/{resource:N}/{file:N}";

    public static string Setup(Guid location, Guid file) =>
        $"images/locations/{location:N}/setup/{file:N}";

    public static string Entity(string category, Guid resource, Guid file) =>
        $"images/{category}/{resource:N}/{file:N}";

    public static bool IsSetup(Guid location, string? key) =>
        key is not null && (key.StartsWith($"setup/{location:N}/evidence/", StringComparison.Ordinal) ||
            key.StartsWith($"images/locations/{location:N}/setup/", StringComparison.Ordinal));
}
