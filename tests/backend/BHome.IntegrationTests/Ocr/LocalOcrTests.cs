using System.Buffers.Binary;
using BHome.Application.Ocr;
using BHome.Infrastructure.Ocr;
using Microsoft.Extensions.Logging.Abstractions;
using OpenCvSharp;

namespace BHome.IntegrationTests.Ocr;

public sealed class LocalOcrTests
{
    [Fact]
    public async Task ModelFailureReturnsManualFallbackWithoutVerifiedFields()
    {
        var engine = new DelegateEngine((_, _, _) => throw new InvalidDataException("PRIVATE_TEST_MODEL_DETAIL"));
        using var service = Service(engine);
        using var input = new MemoryStream(PngHeader(100, 100));
        var result = await service.ExtractAsync(input, OcrDocumentKind.IdentityFront, default);
        Assert.True(result.IsFallback);
        Assert.True(result.ManualEntryAvailable);
        Assert.True(result.RequiresConfirmation);
        Assert.Empty(result.ProposedFields);
        Assert.Equal(new[] { "ocr_unavailable" }, result.Warnings);
        Assert.DoesNotContain("PRIVATE_TEST_MODEL_DETAIL", System.Text.Json.JsonSerializer.Serialize(result));
    }

    [Fact]
    public async Task BadHeadersAndDecompressionBombsAreRejectedBeforeInference()
    {
        var engine = new DelegateEngine((_, _, _) => throw new InvalidOperationException("Must not infer"));
        using var service = Service(engine);
        foreach (var bytes in new[] { Array.Empty<byte>(), "not an image"u8.ToArray(), PngHeader(50000, 50000), new byte[5 * 1024 * 1024 + 1] })
        {
            using var input = new MemoryStream(bytes);
            await Assert.ThrowsAsync<OcrInputException>(() => service.ExtractAsync(input, OcrDocumentKind.IdentityFront, default));
        }
    }

    [Fact]
    public async Task ImageBufferIsClearedAfterInferenceAndStreamRemainsCallerOwned()
    {
        ReadOnlyMemory<byte> captured = default;
        var engine = new DelegateEngine((bytes, _, _) =>
        {
            captured = bytes;
            return Task.FromResult(new OcrText([new("123.45", .99f)], "synthetic", []));
        });
        using var service = Service(engine);
        using var input = new MemoryStream(PngHeader(100, 100));
        var proposal = await service.ExtractAsync(input, OcrDocumentKind.DigitalWater, default);
        Assert.Equal("123.45", proposal.ProposedFields["reading"]);
        Assert.True(input.CanRead);
        Assert.All(captured.ToArray(), b => Assert.Equal(0, b));
    }

    [Fact]
    public async Task ConcurrencyAndTimeoutReturnManualFallbackWithoutLeakingSlots()
    {
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var engine = new DelegateEngine(async (_, _, token) =>
        { entered.TrySetResult(); await Task.Delay(Timeout.Infinite, token); throw new InvalidOperationException(); });
        using var service = Service(engine, 150);
        using var input = new MemoryStream(PngHeader(100, 100));
        var first = service.ExtractAsync(input, OcrDocumentKind.IdentityFront, default);
        await entered.Task;
        using var secondInput = new MemoryStream(PngHeader(100, 100));
        Assert.Contains("ocr_busy", (await service.ExtractAsync(secondInput, OcrDocumentKind.IdentityBack, default)).Warnings);
        Assert.Contains("ocr_timeout", (await first).Warnings);
        using var thirdInput = new MemoryStream(PngHeader(100, 100));
        Assert.Contains("ocr_timeout", (await service.ExtractAsync(thirdInput, OcrDocumentKind.IdentityFront, default)).Warnings);
    }

    [Fact]
    public async Task RequestCancellationPropagatesRatherThanClaimingSuccess()
    {
        var engine = new DelegateEngine(async (_, _, token) =>
        { await Task.Delay(Timeout.Infinite, token); throw new InvalidOperationException(); });
        using var service = Service(engine);
        using var input = new MemoryStream(PngHeader(100, 100));
        using var cancellation = new CancellationTokenSource(50);
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => service.ExtractAsync(input, OcrDocumentKind.IdentityFront, cancellation.Token));
    }

    [Fact]
    public void OpenCvDecodesChecksQualityRotatesAndRejectsCorruption()
    {
        var settings = new OcrOptions();
        settings.Profiles[OcrDocumentKind.IdentityFront].ClockwiseQuarterTurns = 1;
        using var image = new Mat(100, 200, MatType.CV_8UC3, Scalar.White);
        var bytes = image.ImEncode(".png");
        var preprocessor = new ImagePreprocessor(settings);
        using var processed = preprocessor.Prepare(bytes, OcrDocumentKind.IdentityFront);
        Assert.Equal(100, processed.Image.Width); Assert.Equal(200, processed.Image.Height);
        Assert.Contains("blur_or_low_detail", processed.Warnings);
        Assert.Contains("possible_glare", processed.Warnings);
        Assert.Throws<OcrInputException>(() => preprocessor.Prepare(PngHeader(100, 100), OcrDocumentKind.IdentityFront));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void DisplaySplitSeparatesUnitWithoutCuttingObservedDecimal(bool inverted)
    {
        var background = inverted ? Scalar.Black : Scalar.White;
        var foreground = inverted ? Scalar.White : Scalar.Black;
        using var image = new Mat(70, 430, MatType.CV_8UC3, background);
        Cv2.PutText(image, "00123.45", new Point(10, 48), HersheyFonts.HersheySimplex, 1, foreground, 2);
        Cv2.PutText(image, "kWh", new Point(250, 48), HersheyFonts.HersheySimplex, 1, foreground, 2);
        Assert.True(MeterDisplaySplitter.TrySplit(image, out var split));
        Assert.InRange(split, 185, 248);
        using var number = new Mat(image, new Rect(0, 0, split, image.Height));
        using var prepared = MeterDisplaySplitter.PrepareSegment(number);
        Assert.True(prepared.Width < number.Width);
        Assert.True(prepared.Height < number.Height);
        Assert.True(prepared.Width > 145); // keep all digits and the printed decimal separator
    }

    [Fact]
    public void BlankDisplayDoesNotInventAUnitBoundary()
    {
        using var blank = new Mat(70, 300, MatType.CV_8UC3, Scalar.White);
        Assert.False(MeterDisplaySplitter.TrySplit(blank, out _));
        using var prepared = MeterDisplaySplitter.PrepareSegment(blank);
        Assert.Equal(blank.Size(), prepared.Size());
    }

    private static LocalOcrService Service(IOcrEngine engine, int timeout = 1000) => new(
        new OcrOptions { Enabled = true, TimeoutMilliseconds = timeout }, new Lazy<IOcrEngine>(() => engine), NullLogger<LocalOcrService>.Instance);

    private static byte[] PngHeader(int width, int height)
    {
        var bytes = new byte[24];
        new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 }.CopyTo(bytes, 0);
        "IHDR"u8.CopyTo(bytes.AsSpan(12));
        BinaryPrimitives.WriteInt32BigEndian(bytes.AsSpan(16), width);
        BinaryPrimitives.WriteInt32BigEndian(bytes.AsSpan(20), height);
        return bytes;
    }

    private sealed class DelegateEngine(Func<ReadOnlyMemory<byte>, OcrDocumentKind, CancellationToken, Task<OcrText>> run) : IOcrEngine
    {
        public Task<OcrText> RecognizeAsync(ReadOnlyMemory<byte> image, OcrDocumentKind kind, CancellationToken token) => run(image, kind, token);
    }
}
