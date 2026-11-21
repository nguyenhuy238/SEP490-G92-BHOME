namespace BHome.Application.Ocr;

public enum OcrInputKind { MeterReading, IdentityCard }
public sealed record OcrProposal(IReadOnlyDictionary<string, string> ProposedFields, string EngineVersion)
{
    public IReadOnlyList<string> Warnings { get; init; } = [];
    public IReadOnlyList<string> MissingFields { get; init; } = [];
    public IReadOnlyDictionary<string, float> Confidence { get; init; } = new Dictionary<string, float>();
    public bool RequiresConfirmation => true;
    public bool ManualEntryAvailable => true;
    public bool IsFallback { get; init; }
    [System.Text.Json.Serialization.JsonIgnore]
    public string? SourceImageHash { get; init; }
    public override string ToString() => "OCR proposal (sensitive fields omitted)";
}

public interface IOcrService
{
    // Input is temporary; the caller owns/disposes it. Proposals require explicit human confirmation.
    // Implementations must not retain identity images, write them to object storage, or log extracted fields.
    Task<OcrProposal> ExtractAsync(Stream temporaryInput, OcrInputKind kind, CancellationToken cancellationToken);
    Task<OcrProposal> ExtractAsync(Stream temporaryInput, OcrDocumentKind kind, CancellationToken cancellationToken);
}
