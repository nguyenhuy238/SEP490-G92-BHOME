namespace BHome.Application.Contracts;

// Explicit opt-in for synthetic Holding fixtures on a named Development database.
public interface IHoldingTestScope
{
    bool AllowsExternalDatabase { get; }
    bool Allows(Guid locationId);
}
