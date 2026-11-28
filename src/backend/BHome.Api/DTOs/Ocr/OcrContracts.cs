namespace BHome.Application.Ocr;

public enum OcrDocumentKind
{
    IdentityFront, IdentityBack, MechanicalElectricity, MechanicalWater, DigitalElectricity, DigitalWater
}

public sealed record OcrLine(string Text, float Confidence)
{
    // Internal image coordinates, never included in the public proposal.
    public OcrBounds? Bounds { get; init; }
    public override string ToString() => "OCR line (sensitive text omitted)";
}

public sealed record OcrBounds(float X, float Y, float Width, float Height);

public sealed record OcrText(IReadOnlyList<OcrLine> Lines, string EngineVersion, IReadOnlyList<string> Warnings)
{
    // Internal observations from the same temporary image, never a public payload.
    public IReadOnlyList<IdentityFieldObservation> IdentityObservations { get; init; } = [];
}

public sealed record IdentityFieldObservation(string Field, string Value, float Confidence, string Source)
{
    public override string ToString() => "Identity observation (sensitive value omitted)";
}

// Internal capability only. Authorization belongs to the enclosing business use case.
public interface IOcrEngine
{
    Task<OcrText> RecognizeAsync(ReadOnlyMemory<byte> image, OcrDocumentKind kind, CancellationToken cancellationToken);
}

public sealed class OcrInputException(string code) : Exception("Ảnh OCR không hợp lệ.")
{
    public string Code { get; } = code;
}
