using BHome.Domain.Common;
using BHome.Domain.PropertyManagement;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace BHome.Domain.TenantContracts;

public sealed class ContractSigning : AuditableEntity
{
    // A handover keeps its OTP signing attempt in the versioned handover
    // preparation, not in the already-signed tenancy's signature collection.
    // Restore that stable attempt ID when invoking the existing OTP provider.
    public static ContractSigning RestoreDetachedAttempt(Guid id)
    {
        if (id == Guid.Empty) throw new ArgumentException("Signature ID is required", nameof(id));
        return new ContractSigning { Id = id };
    }
    public Guid ContractId { get; set; }
    public Guid SignerUserId { get; set; }
    public Guid CertificateId { get; set; }
    [NotMapped, JsonIgnore] public SignatureStatus SigningStatus { get; set; }
    public SignatureStatus Status { get => SigningStatus; set => SigningStatus = value; }
    public string SnapshotHash { get; set; } = "";
    [NotMapped, JsonConverter(typeof(LegacyStringJsonConverter))] public string? SourceHash { get; set; }
    [JsonIgnore] public string SourceHashOrEmpty { get => SourceHash ?? ""; set => SourceHash = value; }
    [NotMapped, JsonConverter(typeof(LegacyStringJsonConverter))] public string? PreparedHash { get; set; }
    [JsonIgnore] public string PreparedHashOrEmpty { get => PreparedHash ?? ""; set => PreparedHash = value; }
    [NotMapped, JsonConverter(typeof(LegacyStringJsonConverter))] public string? PreparedObjectKey { get; set; }
    [JsonIgnore] public string PreparedObjectKeyOrEmpty { get => PreparedObjectKey ?? ""; set => PreparedObjectKey = value; }
    public string FieldName { get; set; } = "";
    public string DocumentDigest { get; set; } = "";
    public string DataToSignDigest { get; set; } = "";
    public string CertificateChain { get; set; } = "";
    public string ProviderUserId { get; set; } = "";
    public string CredentialId { get; set; } = "";
    public string? ProviderReference { get; set; }
    public string? SignedObjectKey { get; set; }
    public string? SignedHash { get; set; }
    public DateTimeOffset? SignedAt { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    [NotMapped, JsonIgnore] public DateTimeOffset RequestedAt { get => CreatedAt; set => CreatedAt = value; }
    [NotMapped, JsonIgnore] public string ProviderCode { get; set; } = "";
    [NotMapped, JsonIgnore] public JsonElement CertificateSnapshot { get; set; } = JsonSerializer.SerializeToElement(new { });
    [NotMapped, JsonIgnore] public JsonElement SigningData { get; set; } = JsonSerializer.SerializeToElement(new { });
    [NotMapped, JsonIgnore] public JsonElement History { get; set; } = JsonSerializer.SerializeToElement(Array.Empty<object>());
}
