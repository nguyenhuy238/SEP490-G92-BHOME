using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json;

namespace BHome.Domain.Entities;

[Table("contract_residents", Schema = "public")]
public sealed class ContractResident
{
    // Composite primary key (ContractId, ResidentId) is configured by the table context.

    [Column("contract_id", TypeName = "uuid")]
    public Guid ContractId { get; set; }

    [Column("resident_id", TypeName = "uuid")]
    public Guid ResidentId { get; set; }

    [Column("resident_role", TypeName = "smallint")]
    public short ResidentRole { get; set; }

    [Column("residence_from", TypeName = "date")]
    public DateOnly ResidenceFrom { get; set; }

    [Column("residence_to", TypeName = "date")]
    public DateOnly? ResidenceTo { get; set; }

    [Column("actual_residence_from", TypeName = "date")]
    public DateOnly? ActualResidenceFrom { get; set; }

    [Column("actual_move_out_date", TypeName = "date")]
    public DateOnly? ActualMoveOutDate { get; set; }

    [Column("registration_status", TypeName = "varchar(25)")]
    public string? RegistrationStatus { get; set; }

    [Column("registration_evidence_key", TypeName = "varchar(250)")]
    public string? RegistrationEvidenceKey { get; set; }

    [Column("registration_result_at", TypeName = "timestamptz")]
    public DateTimeOffset? RegistrationResultAt { get; set; }

    [Column("owner_confirmed_by_user_id", TypeName = "uuid")]
    public Guid? OwnerConfirmedByUserId { get; set; }

    [Column("owner_confirmed_at", TypeName = "timestamptz")]
    public DateTimeOffset? OwnerConfirmedAt { get; set; }

    [Column("history", TypeName = "jsonb")]
    public JsonElement History { get; set; }
}
