using BHome.Domain.Common;

namespace BHome.Domain.PaymentsDebt;

// Immutable configuration versions keep historical instructions auditable.
public sealed class ReceivingBankAccount : AuditableEntity
{
    public Guid LocationId { get; set; }
    public string BankIdentifier { get; set; } = "";
    public string AccountNumber { get; set; } = "";
    public string AccountHolder { get; set; } = "";
    public bool Enabled { get; set; }
    public bool IsDevelopmentDemo { get; set; }
    public int Version { get; set; }
    public Guid ConfirmedByUserId { get; set; }
    public DateTimeOffset ConfirmedAt { get; set; }
}
