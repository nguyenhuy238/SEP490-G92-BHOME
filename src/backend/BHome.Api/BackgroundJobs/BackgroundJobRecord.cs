namespace BHome.Infrastructure.Jobs;

internal sealed class BackgroundJobRecord
{
    public Guid Id { get; set; }
    public string Name { get; set; } = "";
    public string IdempotencyKey { get; set; } = "";
    public string PayloadJson { get; set; } = "{}";
    public string State { get; set; } = "Pending";
    public int Attempts { get; set; }
    public DateTimeOffset AvailableAt { get; set; }
    public DateTimeOffset? LockedUntil { get; set; }
    public Guid? LockToken { get; set; }
    public string? LastErrorCode { get; set; }
}
