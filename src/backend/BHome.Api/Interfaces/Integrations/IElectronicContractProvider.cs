namespace BHome.Application.Integrations;

public sealed record SigningRequest(string IdempotencyKey, string DocumentObjectKey, string SignerReference);
public sealed record SigningStatus(string ProviderReference, string Status, string? EvidenceReference);

public interface IElectronicContractProvider
{
    Task<SigningStatus> RequestSigningAsync(SigningRequest request, CancellationToken cancellationToken);
    Task<SigningStatus> GetStatusAsync(string providerReference, CancellationToken cancellationToken);
}
