using BHome.Domain.Common;

namespace BHome.Domain.PaymentsDebt;

// Immutable configuration versions keep historical instructions auditable.
public sealed class ReceivingBankAccount : AuditableEntity
{
    internal static ReceivingBankAccount RestoreIdentity(Guid id, DateTimeOffset createdAt, DateTimeOffset updatedAt) =>
        new() { Id = id, CreatedAt = createdAt, UpdatedAt = updatedAt };
    // Owner-wide configurations are stored in the Owner's private business_profile
    // history, not in a Location row. Legacy location versions remain immutable.
    [System.ComponentModel.DataAnnotations.Schema.NotMapped]
    public Guid OwnerUserId { get; set; }
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
