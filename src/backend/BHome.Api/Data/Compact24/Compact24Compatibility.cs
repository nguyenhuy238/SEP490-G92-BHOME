namespace BHome.Infrastructure.Persistence.Compact24;

// An explicit, Development-only recognition of the previous reviewed schema.
// This does not initialize, migrate, drop or rewrite any database object or row.
public sealed record Compact24Compatibility(bool AllowPreviousPropertySchema)
{
    public static Compact24Compatibility Resolve(string? environment, bool configured, string connectionString)
    {
        if (!configured || environment != "Development") return new(false);
        try
        {
            _ = Compact24DevelopmentDatabase.ValidateTarget(environment, connectionString);
            return new(true);
        }
        catch (DevelopmentDatabaseException) { return new(false); }
    }
}
