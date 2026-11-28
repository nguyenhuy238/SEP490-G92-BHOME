using System.Text.Json;
using BHome.Domain.TenantContracts;

namespace BHome.Application.Contracts;

// Test-only acceptance; never deserialize or display this as Tenant OTP/legal signing evidence.
public sealed record MainSandboxAcceptance(string RecordType, Guid OwnerId, string SnapshotHash,
    DateTimeOffset? ConfirmedAt, string DocumentKey, string DocumentHash,
    Guid? TenantSimulatedBy = null, DateTimeOffset? TenantSimulatedAt = null, Guid? OwnerSimulatedBy = null,
    bool RebuiltTestArtifact = false)
{
    public const string Kind = "MainOwnerOnlySandboxV1";
    public static MainSandboxAcceptance? Read(Contract contract)
    {
        if (!contract.IsDevelopmentDemo || contract.Kind != ContractKind.Main || contract.SigningMode != ContractSigningModes.Internal) return null;
        try
        {
            var value = JsonSerializer.Deserialize<MainSandboxAcceptance>(contract.InternalAcceptance);
            return value?.RecordType == Kind && value.OwnerId == contract.OwnerSignerId &&
                value.SnapshotHash == contract.SnapshotHashOrEmpty && !string.IsNullOrWhiteSpace(value.DocumentKey) &&
                !string.IsNullOrWhiteSpace(value.DocumentHash) ? value : null;
        }
        catch (JsonException) { return null; }
    }
}
