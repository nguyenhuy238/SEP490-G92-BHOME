using BHome.Application.Ocr;
using BHome.Infrastructure.Ocr;
using Microsoft.Extensions.Logging.Abstractions;

internal static class IdentityCameraEvaluation
{
    public static async Task<int> Run(string models, string manifest, string reportPrefix)
    {
        var options = new OcrOptions { Enabled = true, ModelDirectory = models };
        var preprocessor = new ImagePreprocessor(options);
        using (var baseline = new OnnxOcrEngine(options, new UncroppedPreprocessor(preprocessor)))
        using (var service = new LocalOcrService(options, new Lazy<IOcrEngine>(() => baseline), NullLogger<LocalOcrService>.Instance))
        {
            Console.WriteLine("Uncropped identity baseline:");
            await OcrEvaluation.RunAsync(service, manifest, reportPrefix + "-before.json");
        }
        using var engine = new OnnxOcrEngine(options, preprocessor);
        using var updated = new LocalOcrService(options, new Lazy<IOcrEngine>(() => engine), NullLogger<LocalOcrService>.Instance);
        Console.WriteLine("Localized identity result:");
        return await OcrEvaluation.RunAsync(updated, manifest, reportPrefix + "-after.json");
    }

    private sealed class UncroppedPreprocessor(ImagePreprocessor inner) : IImagePreprocessor
    {
        public PreparedImage Prepare(ReadOnlyMemory<byte> bytes, OcrDocumentKind kind) => inner.PrepareUnclassified(bytes);
    }
}
