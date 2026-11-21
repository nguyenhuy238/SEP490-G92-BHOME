namespace BHome.Domain.Billing;

// Immutable Owner authorization + the existing financial calendar snapshot for an effective period.
public sealed class BillingAutomationPlan
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid LocationId { get; set; }
    public int Version { get; set; }
    public DateOnly EffectiveFrom { get; set; }
    public bool Enabled { get; set; }
    public bool AuthorizeAutomaticFinalization { get; set; }
    public int MeterDay { get; set; }
    public int MeterDueDay { get; set; }
    public int MeterDueMonthOffset { get; set; }
    public string TimeZone { get; set; } = "Asia/Ho_Chi_Minh";
    public int BillingScheduleVersion { get; set; }
    public string BillingSnapshot { get; set; } = "{}";
    public Guid AuthorizedByUserId { get; set; }
    public DateTimeOffset RecordedAt { get; set; }
}
