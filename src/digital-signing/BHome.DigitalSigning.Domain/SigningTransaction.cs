namespace BHome.DigitalSigning.Domain;

// One attempt to sign one PDF. Phase 1 keeps the prepared PDF (signature placeholder already
// written) and the byte-range digest, so phase 2 only has to embed what Viettel returns.
public sealed class SigningTransaction
{
    public required Guid Id { get; init; }
    public Guid? CertificateId { get; init; }
    public required Guid RequestedByUserId { get; init; }
    public required string Provider { get; init; }
    public required string ProviderUserId { get; init; }
    public required string CredentialId { get; init; }
    public required string SerialNumber { get; init; }
    public string? ProviderTransactionId { get; set; }
    public required SigningTransactionStatus Status { get; set; }
    public required string DocumentName { get; init; }
    public required string SourcePdfSha256 { get; init; }
    public required string FieldName { get; init; }
    public required byte[] PreparedPdf { get; init; }
    public required byte[] DocumentDigest { get; init; }
    public required string DataToSignSha256 { get; init; }
    // Base64 DER certificates, one per line, signer first: phase 2 builds the CMS from these.
    public required string CertificateChain { get; init; }
    public required DateTimeOffset SigningDate { get; init; }
    public string? Description { get; init; }
    public byte[]? SignedPdf { get; set; }
    public string? ErrorCode { get; set; }
    public string? ErrorMessage { get; set; }
    public required DateTimeOffset ExpiresAt { get; init; }
    public required DateTimeOffset CreatedAt { get; init; }
    public required DateTimeOffset UpdatedAt { get; set; }

    public bool IsExpiredAt(DateTimeOffset now) => ExpiresAt <= now;
}
