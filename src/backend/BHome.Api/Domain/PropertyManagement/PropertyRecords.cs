using BHome.Domain.Common;

namespace BHome.Domain.PropertyManagement;

public sealed class Chain : AuditableEntity
{
    public string Name { get; set; } = "";
    public int Version { get; set; } = 1;
}
public sealed class Room : AuditableEntity
{
    internal static Room Rehydrate(Guid id, DateTimeOffset createdAt, DateTimeOffset updatedAt) =>
        new() { Id = id, CreatedAt = createdAt, UpdatedAt = updatedAt };

    public Guid LocationId { get; set; }
    public BHome.Domain.Locations.Location Location { get; set; } = null!;
    public string RoomNumber { get; set; } = "";
    // Nullable only for pre-existing OCR workspace records awaiting Owner configuration.
    public Guid? RoomTypeId { get; set; }
    public RoomType? RoomType { get; set; }
    public string? Floor { get; set; }
    public int Capacity { get; set; } = 1;
    public RoomStatus Status { get; set; } = RoomStatus.Unavailable;
    public int Version { get; set; } = 1;
}
