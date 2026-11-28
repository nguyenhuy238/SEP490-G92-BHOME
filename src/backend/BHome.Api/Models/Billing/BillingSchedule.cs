using BHome.Domain.Common;
using BHome.Domain.PropertyManagement;

namespace BHome.Domain.Billing;

// Explicit Owner selections; no implicit financial defaults when configuration is missing.
public sealed class BillingSchedule : AuditableEntity
{
    internal static BillingSchedule Rehydrate(Guid id, DateTimeOffset createdAt, DateTimeOffset updatedAt) =>
        new() { Id = id, CreatedAt = createdAt, UpdatedAt = updatedAt };
    public Guid LocationId { get; set; }
    public BillingRateDate RateDate { get; set; }
    public BillingRentSource RentSource { get; set; }
    public PartialMonthRule PartialMonth { get; set; }
    public VndRounding Rounding { get; set; }
    public int DraftDay { get; set; }
    public int DraftMonthOffset { get; set; }
    public int FinalDay { get; set; }
    public int FinalMonthOffset { get; set; }
    public int DueDay { get; set; }
    public int DueMonthOffset { get; set; }
    public int Version { get; set; } = 1;
}

// Snapshot entitlements: former occupants retain access, new occupants never inherit old bills.
public sealed class InvoiceRecipient
{
    public Guid InvoiceId { get; set; }
    public Guid TenantUserId { get; set; }
}
// Committed with issuance; consumers never infer issuance from a draft or an uncommitted job.
public sealed class InvoiceIssuedEvent
{
    public Guid InvoiceId { get; set; }
    public Guid OwnerUserId { get; set; }
    public Guid? AutomationPlanId { get; set; }
    public DateTimeOffset OccurredAt { get; set; }
}
