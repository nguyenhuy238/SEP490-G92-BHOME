namespace BHome.Application.Ocr;

public enum OcrInputKind { MeterReading, IdentityCard }
public sealed record OcrProposal(IReadOnlyDictionary<string, string> ProposedFields, string EngineVersion);

public interface IOcrService
{
    // Input is temporary; the caller owns/disposes it. Proposals require explicit human confirmation.
    // Implementations must not retain identity images, write them to object storage, or log extracted fields.
    Task<OcrProposal> ExtractAsync(Stream temporaryInput, OcrInputKind kind, CancellationToken cancellationToken);
}
