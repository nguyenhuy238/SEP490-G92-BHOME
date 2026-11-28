namespace BHome.Domain.Billing;
public sealed class BillingRepresentativeSelection
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid RoomId { get; set; }
    public DateOnly BillingPeriod { get; set; }
    public Guid ContractId { get; set; }
    public int Version { get; set; }
    public Guid SelectedByUserId { get; set; }
    public DateTimeOffset SelectedAt { get; set; }
}
