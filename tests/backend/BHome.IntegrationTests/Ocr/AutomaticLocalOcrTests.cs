using BHome.Application.Ocr;
using BHome.Infrastructure.Ocr;
using Microsoft.Extensions.Logging.Abstractions;
using OpenCvSharp;

namespace BHome.IntegrationTests.Ocr;

public sealed class AutomaticLocalOcrTests
{
    [Fact]
    public async Task UnsupportedAutomaticCapabilityNeverFallsBackToAHardcodedProfile()
    {
        using var service = Service(new ExplicitOnlyEngine()); using var input = new MemoryStream(Image());
        var result = await service.ExtractAutomaticAsync(input, default);
        Assert.Equal("unavailable", result.ClassificationStatus);
        Assert.Contains("classification_unavailable", result.Warnings);
        Assert.Null(result.IdentityProposal); Assert.Null(result.MeterProposal);
    }
    private sealed class ExplicitOnlyEngine : IOcrEngine
    {
        public Task<OcrText> RecognizeAsync(ReadOnlyMemory<byte> bytes, OcrDocumentKind kind, CancellationToken token)
            => throw new InvalidOperationException("A default profile must never be selected");
    }
    private static byte[] Image() { using var mat = new Mat(100, 100, MatType.CV_8UC3, Scalar.White); return mat.ImEncode(".png"); }
    private static LocalOcrService Service(IOcrEngine engine, int timeout = 8000) => new(new OcrOptions { Enabled = true, TimeoutMilliseconds = timeout },
        new Lazy<IOcrEngine>(() => engine), NullLogger<LocalOcrService>.Instance);

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task FailureAndSuccessBothZeroTheBufferAndNeverCallAProfile(bool fail)
    {
        var engine = new Analyzer((_, _) => fail ? throw new InvalidDataException("PRIVATE_MODEL_DETAIL") : Task.FromResult(new OcrImageAnalysis(new([], "synthetic", ["no_text"]))));
        using var service = Service(engine); using var input = new MemoryStream(Image());
        var result = await service.ExtractAutomaticAsync(input, default);
        Assert.Equal(fail ? "unavailable" : "unknown", result.ClassificationStatus);
        Assert.Null(result.IdentityProposal); Assert.Null(result.MeterProposal);
        Assert.All(engine.Captured.ToArray(), b => Assert.Equal(0, b));
        Assert.True(input.CanRead);
        Assert.DoesNotContain("PRIVATE_MODEL_DETAIL", System.Text.Json.JsonSerializer.Serialize(result));
    }

    [Fact]
    public async Task AutomaticAndExplicitRequestsShareTheSameConcurrencyLimitAndDeadline()
    {
        var started = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var engine = new Analyzer(async (_, token) => { started.SetResult(); await Task.Delay(Timeout.Infinite, token); throw new InvalidOperationException(); });
        using var service = Service(engine, 200);
        using var firstImage = new MemoryStream(Image()); var first = service.ExtractAutomaticAsync(firstImage, default);
        await started.Task;
        using var secondImage = new MemoryStream(Image());
        Assert.Contains("ocr_busy", (await service.ExtractAsync(secondImage, OcrDocumentKind.IdentityFront, default)).Warnings);
        Assert.Contains("ocr_timeout", (await first).Warnings);
        Assert.All(engine.Captured.ToArray(), b => Assert.Equal(0, b));
    }

    [Fact]
    public async Task CallerCancellationPropagatesAndReleasesMemory()
    {
        using var cancel = new CancellationTokenSource();
        var engine = new Analyzer(async (_, token) => { cancel.Cancel(); await Task.Delay(Timeout.Infinite, token); throw new InvalidOperationException(); });
        using var service = Service(engine); using var input = new MemoryStream(Image());
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => service.ExtractAutomaticAsync(input, cancel.Token));
        Assert.All(engine.Captured.ToArray(), b => Assert.Equal(0, b));
    }

    private sealed class Analyzer(Func<ReadOnlyMemory<byte>, CancellationToken, Task<OcrImageAnalysis>> analyze) : IOcrEngine, IOcrAnalysisEngine
    {
        public ReadOnlyMemory<byte> Captured { get; private set; }
        public Task<OcrImageAnalysis> AnalyzeAsync(ReadOnlyMemory<byte> image, CancellationToken token) { Captured = image; return analyze(image, token); }
        public Task<OcrText> RecognizeAsync(ReadOnlyMemory<byte> image, OcrDocumentKind kind, CancellationToken token) => throw new InvalidOperationException("Must not choose a default profile");
    }
}
