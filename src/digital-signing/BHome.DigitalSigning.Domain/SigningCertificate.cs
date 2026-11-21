namespace BHome.DigitalSigning.Domain;

// A certificate a user declared as their own. The private key stays at Viettel; only the
// subscriber id and the CA's handle (credential id) are kept to ask for a signature later.
public sealed class SigningCertificate
{
    public required Guid Id { get; init; }
    public required Guid OwnerUserId { get; init; }
    public required string Provider { get; init; }
    public required string ProviderUserId { get; init; }
    public required string CredentialId { get; init; }
    public required string SerialNumber { get; init; }
    public required string Subject { get; init; }
    public required string Issuer { get; init; }
    public required DateTimeOffset ValidFrom { get; init; }
    public required DateTimeOffset ValidTo { get; init; }
    public bool Locked { get; set; }
    public required DateTimeOffset CreatedAt { get; init; }

    public bool IsValidAt(DateTimeOffset now) => ValidFrom <= now && now < ValidTo;
}
