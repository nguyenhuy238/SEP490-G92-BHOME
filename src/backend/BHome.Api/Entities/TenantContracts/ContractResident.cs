using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace BHome.Domain.TenantContracts;

public sealed class ContractResident
{
    // Composite primary key (ContractId, ResidentId) is configured by the table context.

    public Guid ContractId { get; set; }

    public Guid ResidentId { get; set; }

    [NotMapped, JsonIgnore] public ResidentType ResidentRole { get; set; }
    public ResidentType Role { get => ResidentRole; set => ResidentRole = value; }

    public DateOnly ResidenceFrom { get; set; }

    public DateOnly? ResidenceTo { get; set; }

    [NotMapped, JsonIgnore]
    public DateOnly? ActualResidenceFrom { get; set; }

    [NotMapped, JsonIgnore]
    public DateOnly? ActualMoveOutDate { get; set; }

    [NotMapped, JsonIgnore]
    public string? RegistrationStatus { get; set; }

    [NotMapped, JsonIgnore]
    public string? RegistrationEvidenceKey { get; set; }

    [NotMapped, JsonIgnore]
    public DateTimeOffset? RegistrationResultAt { get; set; }

    [NotMapped, JsonIgnore]
    public Guid? OwnerConfirmedByUserId { get; set; }

    [NotMapped, JsonIgnore]
    public DateTimeOffset? OwnerConfirmedAt { get; set; }

    [NotMapped, JsonIgnore]
    public JsonElement History { get; set; }
}
