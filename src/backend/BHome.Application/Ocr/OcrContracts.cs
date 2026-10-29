namespace BHome.Application.Ocr;

public enum OcrDocumentKind
{
    IdentityFront, IdentityBack, MechanicalElectricity, MechanicalWater, DigitalElectricity, DigitalWater
}

public sealed record OcrLine(string Text, float Confidence)
{
    public override string ToString() => "OCR line (sensitive text omitted)";
}

public sealed record OcrText(IReadOnlyList<OcrLine> Lines, string EngineVersion, IReadOnlyList<string> Warnings);

// Internal capability only. Authorization belongs to the enclosing business use case.
public interface IOcrEngine
{
    Task<OcrText> RecognizeAsync(ReadOnlyMemory<byte> image, OcrDocumentKind kind, CancellationToken cancellationToken);
}

public sealed class OcrInputException(string code) : Exception("Ảnh OCR không hợp lệ.")
{
    public string Code { get; } = code;
}
