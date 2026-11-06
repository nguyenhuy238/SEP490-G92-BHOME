using BHome.Application.Ocr;
using BHome.Infrastructure.Ocr;
using OpenCvSharp;

namespace BHome.IntegrationTests.Ocr;

// These verify adapter orchestration and coordinates, not real detector accuracy.
public sealed class MeterSceneSelectionTests
{
    private static readonly Rect Body = new(100, 50, 400, 300);
    private static readonly Rect Display = new(180, 120, 180, 50);
    private static MeterSceneSelection Select(params DetectedMeter[] meters) =>
        MeterSceneSelection.Select(new(true, meters), new(800, 600), OcrDocumentKind.DigitalElectricity, .8f);
    private static DetectedMeter Meter() => new(Body, .95f, OcrDocumentKind.DigitalElectricity, .9f,
        [new(Display, .96f)]);

    [Fact]
    public void DisplayCropUsesPreparedImageCoordinatesAndKeepsRegisterReview()
    {
        var result = Select(Meter());
        Assert.True(result.CanRecognize);
        Assert.Equal(Display, result.Crop);
        Assert.Contains("billing_register_unverified", result.Warnings);
        using var image = new Mat(600, 800, MatType.CV_8UC3, Scalar.Black);
        Cv2.Rectangle(image, Display, Scalar.White, -1);
        using var crop = new Mat(image, result.Crop!.Value);
        Assert.Equal(new Size(180, 50), crop.Size());
        Assert.Equal(255, Cv2.Mean(crop).Val0);
    }

    [Fact]
    public void MissingModelsRetainLegacyOcrWithExplicitUncertainty()
    {
        foreach (var scene in new MeterScene?[] { null, new(false, []) })
        {
            var result = MeterSceneSelection.Select(scene, new(800, 600), OcrDocumentKind.MechanicalWater, .8f);
            Assert.True(result.CanRecognize);
            Assert.Null(result.Crop);
            Assert.Contains("meter_localization_unavailable", result.Warnings);
        }
        var meterOnly = Select(Meter() with { ReadingRegions = null });
        Assert.True(meterOnly.CanRecognize);
        Assert.Equal(Body, meterOnly.Crop);
        Assert.Contains("reading_region_unverified", meterOnly.Warnings);
    }

    [Fact]
    public void NoMeterAndMultipleMetersNeverChooseTheHighestScore()
    {
        Assert.Contains("meter_not_detected", Select().Warnings);
        var result = Select(Meter(), Meter() with { Confidence = .81f });
        Assert.False(result.CanRecognize);
        Assert.Null(result.Crop);
        Assert.Contains("multiple_meters", result.Warnings);
    }

    [Fact]
    public void MissingOrMultipleDisplaysRequireManualEntry()
    {
        Assert.False(Select(Meter() with { ReadingRegions = [] }).CanRecognize);
        var result = Select(Meter() with { ReadingRegions = [new(Display, .99f), new(new(180, 220, 180, 50), .9f)] });
        Assert.False(result.CanRecognize);
        Assert.Contains("ambiguous_reading", result.Warnings);
    }

    [Theory]
    [InlineData(.1f)]
    [InlineData(float.NaN)]
    [InlineData(float.PositiveInfinity)]
    [InlineData(1.01f)]
    public void InvalidOrLowConfidenceCannotBecomeAReading(float confidence)
    {
        Assert.False(Select(Meter() with { Confidence = confidence }).CanRecognize);
        Assert.False(Select(Meter() with { ReadingRegions = [new(Display, confidence)] }).CanRecognize);
        var metadata = Select(Meter() with { Category = OcrDocumentKind.DigitalWater, CategoryConfidence = confidence });
        Assert.True(metadata.CanRecognize);
        Assert.Contains("meter_category_unverified", metadata.Warnings);
    }

    [Fact]
    public void ConfidentVisualMismatchCannotOverrideServerCategory()
    {
        foreach (var kind in new[] { OcrDocumentKind.MechanicalElectricity, OcrDocumentKind.DigitalWater, OcrDocumentKind.IdentityFront })
        {
            var result = Select(Meter() with { Category = kind });
            Assert.False(result.CanRecognize);
            Assert.Contains("meter_type_mismatch", result.Warnings);
        }
    }

    [Theory]
    [InlineData(-1, 10, 100, 50)]
    [InlineData(700, 10, 200, 50)]
    [InlineData(100, 50, 0, 100)]
    [InlineData(int.MaxValue, 50, int.MaxValue, 100)]
    public void InvalidBoundsAreRejectedRatherThanClamped(int x, int y, int width, int height)
    {
        Assert.False(Select(Meter() with { Bounds = new(x, y, width, height) }).CanRecognize);
        Assert.False(Select(Meter() with { ReadingRegions = [new(new(x, y, width, height), .99f)] }).CanRecognize);
    }
}
