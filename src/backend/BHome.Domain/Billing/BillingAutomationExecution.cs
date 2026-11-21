namespace BHome.Domain.Billing;
public sealed class BillingAutomationExecution
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid PlanId { get; set; }
    public Guid LocationId { get; set; }
    public DateOnly BillingPeriod { get; set; }
    public string Phase { get; set; } = "";
    public string Status { get; set; } = "Pending";
    public int Attempts { get; set; }
    public int CreatedCount { get; set; }
    public int ExistingCount { get; set; }
    public string ExceptionsJson { get; set; } = "[]";
    public string? LastErrorCode { get; set; }
    public DateTimeOffset LastStartedAt { get; set; }
    public DateTimeOffset? FinishedAt { get; set; }
    public DateTimeOffset? LockedUntil { get; set; }
    public Guid? LockToken { get; set; }
}
public sealed class BillingAutomationAttempt
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ExecutionId { get; set; }
    public int Sequence { get; set; }
    public string Status { get; set; } = "";
    public string SummaryJson { get; set; } = "{}";
    public DateTimeOffset StartedAt { get; set; }
    public DateTimeOffset FinishedAt { get; set; }
}
