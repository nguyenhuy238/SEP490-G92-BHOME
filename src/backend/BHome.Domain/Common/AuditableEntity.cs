namespace BHome.Domain.Common;

// Inherit only when the finalized model needs these fields. All instants are UTC.
public abstract class AuditableEntity
{
    public Guid Id { get; protected set; } = Guid.NewGuid();
    public DateTimeOffset CreatedAt { get; internal set; }
    public DateTimeOffset UpdatedAt { get; internal set; }

    public void Stamp(DateTimeOffset now, bool isNew)
    {
        if (isNew) CreatedAt = now;
        UpdatedAt = now;
    }
}
