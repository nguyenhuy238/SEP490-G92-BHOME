using BHome.Domain.Common;
using BHome.Domain.PropertyManagement;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace BHome.Domain.TenantContracts;

// Signed versions are never edited. A renewal is a new version of the same tenancy.
public sealed class Contract : AuditableEntity
{
    [System.ComponentModel.DataAnnotations.Schema.NotMapped] public string SigningMode { get; set; } = "";
    [System.ComponentModel.DataAnnotations.Schema.NotMapped] public string InternalAcceptance { get; set; } = "{}";
    [System.ComponentModel.DataAnnotations.Schema.NotMapped] public bool InitialPaymentRequired { get; set; }
    [System.ComponentModel.DataAnnotations.Schema.NotMapped] public Guid? ParentContractId { get; set; }
    [System.ComponentModel.DataAnnotations.Schema.NotMapped] public string OperatingPolicySnapshot { get; set; } = "";
    public Guid RoomId { get; set; }
    public Room Room { get; set; } = null!;
    public Guid OwnerSignerId { get; set; }
    public Guid? TenantUserId { get; set; }
    // Draft-only metadata is encrypted by the existing identity protection service.
    public string DraftMetadata { get; set; } = "{}";
    public int DraftVersion { get; set; } = 1;
    public Guid RepresentativeResidentId { get; set; }
    public Guid? PreviousContractId { get; set; }
    public Guid? HoldingContractId { get; set; }
    public decimal AppliedHoldingDeposit { get; set; }
    public string? HoldingAllocationReference { get; set; }
    public DateTimeOffset? HoldingExpiryAt { get; set; }
    public short? ReservedCapacity { get; set; }
    public Guid? ApprovedByUserId { get; set; }
    public DateTimeOffset? ApprovedAt { get; set; }
    public string? ApprovalReason { get; set; }
    public string AgreedPriceSnapshot { get; set; } = "{}";
    public string? PriceLockTrigger { get; set; }
    public DateTimeOffset? PriceLockedAt { get; set; }
    public Guid? ConvertedMainContractId { get; set; }
    public Guid? LifecycleActorId { get; set; }
    public DateTimeOffset? LifecycleAt { get; set; }
    public string? LifecycleReason { get; set; }
    public ContractKind Kind { get; set; }
    public ContractStatus Status { get; set; }
    public DateOnly StartDate { get; set; }
    public DateOnly EndDate { get; set; }
    [NotMapped, JsonIgnore] internal decimal? StoredMonthlyRent { get; set; }
    public decimal MonthlyRent { get => StoredMonthlyRent ?? 0; set => StoredMonthlyRent = value; }
    public decimal RequiredDeposit { get; set; }
    public string Terms { get; set; } = "";
    [NotMapped, JsonIgnore] internal string? StoredSnapshotHash { get; set; }
    public string SnapshotHash { get => StoredSnapshotHash ?? ""; set => StoredSnapshotHash = value; }
    public bool IsDevelopmentDemo { get; set; }
    // Payment data environment is independent of genuine versus simulated signatures.
    [System.ComponentModel.DataAnnotations.Schema.NotMapped] public string? PaymentMode { get; set; }
    public List<ContractResident> Residents { get; set; } = [];
    public List<ContractSignature> Signatures { get; set; } = [];
    public Guid? ActivatedByUserId { get; set; }
    public DateTimeOffset? ActivatedAt { get; set; }
    public DateOnly? ActualEndDate { get; set; }
    [NotMapped, JsonIgnore] public JsonElement Documents { get; set; } = JsonSerializer.SerializeToElement(Array.Empty<object>());
    [NotMapped, JsonIgnore] public JsonElement Handover { get; set; } = JsonSerializer.SerializeToElement(new { });
    [NotMapped, JsonIgnore] public JsonElement MoveOut { get; set; } = JsonSerializer.SerializeToElement(new { });
    [NotMapped, JsonIgnore] public JsonElement Settlement { get; set; } = JsonSerializer.SerializeToElement(new { });
    [NotMapped, JsonIgnore] public JsonElement History { get; set; } = JsonSerializer.SerializeToElement(Array.Empty<object>());
}
