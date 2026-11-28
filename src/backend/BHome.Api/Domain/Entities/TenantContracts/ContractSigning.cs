using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json;

namespace BHome.Domain.Entities;

[Table("contract_signings", Schema = "public")]
public sealed class ContractSigning
{
    [Key]
    [Column("id", TypeName = "uuid")]
    public Guid Id { get; set; }

    [Column("contract_id", TypeName = "uuid")]
    public Guid ContractId { get; set; }

    [Column("signer_user_id", TypeName = "uuid")]
    public Guid SignerUserId { get; set; }

    [Column("certificate_id", TypeName = "uuid")]
    public Guid CertificateId { get; set; }

    [Column("certificate_snapshot", TypeName = "jsonb")]
    public JsonElement CertificateSnapshot { get; set; }

    [Column("provider_code", TypeName = "varchar(50)")]
    public string ProviderCode { get; set; } = null!;

    [Column("provider_reference", TypeName = "varchar(200)")]
    public string? ProviderReference { get; set; }

    [Column("signing_status", TypeName = "smallint")]
    public short SigningStatus { get; set; }

    [Column("snapshot_hash", TypeName = "varchar(64)")]
    public string SnapshotHash { get; set; } = null!;

    [Column("source_hash", TypeName = "varchar(64)")]
    public string? SourceHash { get; set; }

    [Column("prepared_hash", TypeName = "varchar(64)")]
    public string? PreparedHash { get; set; }

    [Column("prepared_object_key", TypeName = "varchar(250)")]
    public string? PreparedObjectKey { get; set; }

    [Column("signed_object_key", TypeName = "varchar(250)")]
    public string? SignedObjectKey { get; set; }

    [Column("signed_hash", TypeName = "varchar(64)")]
    public string? SignedHash { get; set; }

    [Column("signing_data", TypeName = "jsonb")]
    public JsonElement SigningData { get; set; }

    [Column("requested_at", TypeName = "timestamptz")]
    public DateTimeOffset RequestedAt { get; set; }

    [Column("expires_at", TypeName = "timestamptz")]
    public DateTimeOffset ExpiresAt { get; set; }

    [Column("signed_at", TypeName = "timestamptz")]
    public DateTimeOffset? SignedAt { get; set; }

    [Column("history", TypeName = "jsonb")]
    public JsonElement History { get; set; }
}
