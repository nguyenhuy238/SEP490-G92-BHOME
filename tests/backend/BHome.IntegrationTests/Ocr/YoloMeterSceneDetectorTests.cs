using BHome.Application.Ocr;
using BHome.Infrastructure.Ocr;
using Microsoft.ML.OnnxRuntime.Tensors;
using OpenCvSharp;

namespace BHome.IntegrationTests.Ocr;

// Tensor/adapter safety tests; real pretrained accuracy is measured by OcrSmoke.
public sealed class YoloMeterSceneDetectorTests
{
    [Fact]
    public void LetterboxUsesRgbUnitRangeAnd114Padding()
    {
        using var image = new Mat(100, 200, MatType.CV_8UC3, new Scalar(10, 20, 30));
        var tensor = YoloMeterSceneDetector.Letterbox(image, out var scale, out var left, out var top);
        Assert.Equal(3.2, scale); Assert.Equal(0, left); Assert.Equal(160, top);
        Assert.Equal(114 / 255f, tensor[0, 0, 0, 0]);
        Assert.Equal(30 / 255f, tensor[0, 0, 160, 0]);
        Assert.Equal(10 / 255f, tensor[0, 2, 160, 0]);
        tensor.Buffer.Span.Clear();
    }

    private static void Box(DenseTensor<float> tensor, int index, int cls, float score, float x = 320, float y = 320)
    {
        tensor[0, 0, index] = x; tensor[0, 1, index] = y;
        tensor[0, 2, index] = 160; tensor[0, 3, index] = 40;
        tensor[0, 4 + cls, index] = score; tensor[0, 17, index] = MathF.PI / 6;
    }

    [Fact]
    public void DecoderRestoresLetterboxRotationAndUsesClassAwareNms()
    {
        var output = new DenseTensor<float>(new[] { 1, 18, 8400 });
        Box(output, 0, 1, .95f); Box(output, 1, 1, .9f); // duplicate window suppressed
        Box(output, 2, 0, .94f); // overlapping body retained
        Box(output, 3, 1, .91f, 550); // distinct second window retained
        Box(output, 4, 4, .99f, 100); // digit class never becomes a window
        var boxes = YoloMeterSceneDetector.Decode(output, new(200, 100), 3.2, 0, 160, .5f, .7f);
        Assert.Equal(3, boxes.Count);
        var window = boxes.First(b => b.ClassId == 1);
        Assert.Equal(100f, window.Box.Center.X); Assert.Equal(50f, window.Box.Center.Y);
        Assert.Equal(50f, window.Box.Size.Width); Assert.InRange(window.Box.Angle, 29.99f, 30.01f);
        Assert.Equal(2, boxes.Count(b => b.ClassId == 1));
    }

    [Fact]
    public void InvalidCoordinatesScoresAndTensorContractAreRejected()
    {
        var output = new DenseTensor<float>(new[] { 1, 18, 8400 });
        Box(output, 0, 1, float.NaN); Box(output, 1, 1, 1.1f); Box(output, 2, 1, .9f, -1);
        Box(output, 3, 1, .9f); output[0, 17, 3] = float.PositiveInfinity;
        Assert.Empty(YoloMeterSceneDetector.Decode(output, new(640, 640), 1, 0, 0, .5f, .7f));
        Assert.Throws<InvalidDataException>(() => YoloMeterSceneDetector.Decode(new DenseTensor<float>(new[] { 1, 17, 8400 }), new(640, 640), 1, 0, 0, .5f, .7f));
        for (var i = 0; i < 1025; i++) Box(output, i, 1, .9f);
        Assert.Throws<InvalidDataException>(() => YoloMeterSceneDetector.Decode(output, new(640, 640), 1, 0, 0, .5f, .7f));
    }

    [Fact]
    public void DisabledMissingAndCorruptWeightsFallBackWithoutGuessingCategory()
    {
        var directory = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        try
        {
            var options = new OcrOptions { MeterDetector = new() { ModelDirectory = directory } };
            using var image = new Mat(100, 200, MatType.CV_8UC3, Scalar.Black);
            using var disabled = new YoloMeterSceneDetector(options);
            Assert.False(disabled.Detect(image, default).IsAvailable);
            options.MeterDetector.Enabled = true;
            using var missing = new YoloMeterSceneDetector(options);
            missing.Warmup(default);
            Assert.Contains("meter_detector_unavailable", missing.Detect(image, default).Warnings);
            File.WriteAllText(Path.Combine(directory, YoloMeterSceneDetector.FileName), "not a model");
            using var corrupt = new YoloMeterSceneDetector(options);
            Assert.Contains("meter_detector_unavailable", corrupt.Detect(image, default).Warnings);
            Assert.False(corrupt.Supports(OcrDocumentKind.DigitalElectricity));
            Assert.False(corrupt.Supports(OcrDocumentKind.DigitalWater));
            Assert.True(corrupt.Supports(OcrDocumentKind.MechanicalWater));
            Assert.Throws<OperationCanceledException>(() => corrupt.Detect(image, new CancellationToken(true)));
            Assert.Throws<OperationCanceledException>(() => corrupt.Warmup(new CancellationToken(true)));
            Assert.Throws<OperationCanceledException>(() => YoloMeterSceneDetector.Letterbox(image, out _, out _, out _, new CancellationToken(true)));
        }
        finally { File.Delete(Path.Combine(directory, YoloMeterSceneDetector.FileName)); Directory.Delete(directory); }
    }

    [Fact]
    public void RotatedAndStandaloneWindowsMustRemainEntirelyInsideImage()
    {
        var valid = new DetectedReadingRegion(new(100, 100, 200, 50), .95f)
            { OrientedBounds = new(new(200, 125), new(180, 30), 10) };
        var scene = new MeterScene(true, []) { StandaloneReadingRegions = [valid] };
        var result = MeterSceneSelection.Select(scene, new(800, 600), null, .8f);
        Assert.True(result.CanRecognize); Assert.Equal(valid.OrientedBounds, result.OrientedCrop);
        Assert.Contains("meter_body_unverified", result.Warnings);
        var partial = valid with { OrientedBounds = new(new(10, 10), new(180, 30), 40) };
        Assert.False(MeterSceneSelection.Select(scene with { StandaloneReadingRegions = [partial] }, new(800, 600), null, .8f).CanRecognize);
        Assert.False(MeterSceneSelection.Select(scene with { StandaloneReadingRegions = [valid, valid] }, new(800, 600), null, .8f).CanRecognize);
        Assert.False(MeterSceneSelection.Select(scene with { Warnings = ["unclear_digit"] }, new(800, 600), null, .8f).CanRecognize);
    }
}
