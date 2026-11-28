using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json;

namespace BHome.Domain.Entities;

[Table("contracts", Schema = "public")]
public sealed class Contract
{
    [Key]
    [Column("id", TypeName = "uuid")]
    public Guid Id { get; set; }

    [Column("room_id", TypeName = "uuid")]
    public Guid RoomId { get; set; }

    [Column("representative_resident_id", TypeName = "uuid")]
    public Guid RepresentativeResidentId { get; set; }

    [Column("tenant_user_id", TypeName = "uuid")]
    public Guid? TenantUserId { get; set; }

    [Column("owner_signer_id", TypeName = "uuid")]
    public Guid OwnerSignerId { get; set; }

    [Column("contract_type", TypeName = "varchar(12)")]
    public string ContractType { get; set; } = null!;

    [Column("previous_contract_id", TypeName = "uuid")]
    public Guid? PreviousContractId { get; set; }

    [Column("parent_contract_id", TypeName = "uuid")]
    public Guid? ParentContractId { get; set; }

    [Column("source_holding_contract_id", TypeName = "uuid")]
    public Guid? SourceHoldingContractId { get; set; }

    [Column("start_date", TypeName = "date")]
    public DateOnly StartDate { get; set; }

    [Column("end_date", TypeName = "date")]
    public DateOnly EndDate { get; set; }

    [Column("holding_expiry_at", TypeName = "timestamptz")]
    public DateTimeOffset? HoldingExpiryAt { get; set; }

    [Column("monthly_rent", TypeName = "numeric(18,0)")]
    public decimal? MonthlyRent { get; set; }

    [Column("deposit_required", TypeName = "numeric(18,0)")]
    public decimal DepositRequired { get; set; }

    [Column("applied_holding_deposit", TypeName = "numeric(18,0)")]
    public decimal AppliedHoldingDeposit { get; set; }

    [Column("reserved_capacity", TypeName = "smallint")]
    public short? ReservedCapacity { get; set; }

    [Column("terms", TypeName = "text")]
    public string Terms { get; set; } = null!;

    [Column("snapshot_hash", TypeName = "varchar(64)")]
    public string? SnapshotHash { get; set; }

    [Column("draft_metadata", TypeName = "jsonb")]
    public JsonElement DraftMetadata { get; set; }

    [Column("documents", TypeName = "jsonb")]
    public JsonElement Documents { get; set; }

    [Column("handover", TypeName = "jsonb")]
    public JsonElement Handover { get; set; }

    [Column("move_out", TypeName = "jsonb")]
    public JsonElement MoveOut { get; set; }

    [Column("settlement", TypeName = "jsonb")]
    public JsonElement Settlement { get; set; }

    [Column("status", TypeName = "smallint")]
    public short Status { get; set; }

    [Column("activated_at", TypeName = "timestamptz")]
    public DateTimeOffset? ActivatedAt { get; set; }

    [Column("activated_by_user_id", TypeName = "uuid")]
    public Guid? ActivatedByUserId { get; set; }

    [Column("actual_end_date", TypeName = "date")]
    public DateOnly? ActualEndDate { get; set; }

    [Column("version", TypeName = "integer")]
    public int Version { get; set; }

    [Column("history", TypeName = "jsonb")]
    public JsonElement History { get; set; }
}
