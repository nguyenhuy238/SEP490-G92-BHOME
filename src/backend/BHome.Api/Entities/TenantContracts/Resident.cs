using BHome.Domain.Common;
using BHome.Domain.PropertyManagement;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.ComponentModel.DataAnnotations.Schema;

namespace BHome.Domain.TenantContracts;

public sealed class Resident : AuditableEntity
{
    [NotMapped, JsonIgnore] public Guid? CurrentRoomId { get; set; }
    public Guid? RoomId { get => CurrentRoomId; set => CurrentRoomId = value; }
    public Room Room { get; set; } = null!;
    // Non-sensitive workspace label. Actual name/DOB/address live only in the encrypted envelope.
    public string DisplayLabel { get; set; } = "";
    public ResidentType ResidentType { get; set; }
    public IdentityVerificationStatus VerificationStatus { get; set; }
    [NotMapped, JsonIgnore] public Guid IdentityOwnerScopeId { get; set; }
    public Guid OwnerUserId { get => IdentityOwnerScopeId; set => IdentityOwnerScopeId = value; }
    [NotMapped, JsonIgnore] public Guid? UserId { get; set; }
    public Guid? TenantUserId { get => UserId; set => UserId = value; }
    [System.ComponentModel.DataAnnotations.Schema.NotMapped] public Guid? HouseholdRepresentativeId { get; set; }
    [System.ComponentModel.DataAnnotations.Schema.NotMapped] public string? HouseholdClientKey { get; set; }
    [System.ComponentModel.DataAnnotations.Schema.NotMapped] public string HouseholdProfile { get; set; } = "{}";
    [System.ComponentModel.DataAnnotations.Schema.NotMapped] public DateTimeOffset? HouseholdConfirmedAt { get; set; }
    [System.ComponentModel.DataAnnotations.Schema.NotMapped] public Guid? HouseholdConfirmedByUserId { get; set; }
    [System.ComponentModel.DataAnnotations.Schema.NotMapped] public int HouseholdVersion { get; set; }
    [System.ComponentModel.DataAnnotations.Schema.NotMapped] public Guid? HouseholdRequestKey { get; set; }
    [System.ComponentModel.DataAnnotations.Schema.NotMapped] public string? HouseholdRequestHash { get; set; }
    // Contact identity exists before a login account. Only Compact24 persists this field.
    [System.ComponentModel.DataAnnotations.Schema.NotMapped]
    public string? ContactEmail { get; set; }
    public string IdentityData { get; set; } = "{}";
    public string? IdentityHmac { get; set; }
    public string? HmacKeyVersion { get; set; }
    [NotMapped, JsonIgnore] public Guid? VerifiedByUserId { get; set; }
    public Guid? ConfirmedByUserId { get => VerifiedByUserId; set => VerifiedByUserId = value; }
    [NotMapped, JsonIgnore] public DateTimeOffset? VerifiedAt { get; set; }
    public DateTimeOffset? ConfirmedAt { get => VerifiedAt; set => VerifiedAt = value; }
    [NotMapped, JsonIgnore] public JsonElement History { get; set; } = JsonSerializer.SerializeToElement(Array.Empty<object>());
}
