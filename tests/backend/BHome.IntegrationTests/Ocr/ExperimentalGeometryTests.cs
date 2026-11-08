using BHome.Infrastructure.Ocr;
using BHome.Application.Ocr;
using OpenCvSharp;

namespace BHome.IntegrationTests.Ocr;

public sealed class ExperimentalGeometryTests
{
    [Theory]
    [InlineData("FGF000898")]
    [InlineData("000890 kWh")]
    [InlineData("E21 000890")]
    [InlineData("1.8.0")]
    [InlineData("")]
    public void ExpansionCannotReplaceNumericRowWithBrandUnitOrRegisterText(string mixed)
    {
        var observed = new OcrLine("000890", .94f) { Bounds = new(363, 239, 431, 138) };
        var expanded = new OcrLine(mixed, .99f) { Bounds = new(294, 239, 569, 138) };
        Assert.Same(observed, ExperimentalMeterRecognizer.ChooseNumericExpansion(observed, expanded));
    }
    [Fact]
    public void ValidExpandedReadingRetainsLeadingZerosAndItsObservedSeparator()
    {
        var old = new OcrLine("00050", .95f);
        var expanded = new OcrLine("000501", .97f);
        Assert.Same(expanded, ExperimentalMeterRecognizer.ChooseNumericExpansion(old, expanded));
        var decimalRow = new OcrLine("000501,20", .97f);
        Assert.Same(decimalRow, ExperimentalMeterRecognizer.ChooseNumericExpansion(old, decimalRow));
    }
    [LocalMeterModelsFact]
    public void RealGreenLcdDoesNotReplaceObservedDigitsWithTheAdjacentBrand()
    {
        var root = Environment.GetEnvironmentVariable("BHOME_OCR_LOCAL_EVALUATION_ROOT")!;
        var bytes = File.ReadAllBytes(Path.Combine(root, ".tools/ocr-next-staff/new-public/commons_122443403.jpg"));
        Assert.Equal("7f658474d2633f8911976b04724bb69d65a8dc537ae3e6b551adc2b7547a3a59",
            Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(bytes)).ToLowerInvariant());
        var options = new OcrOptions { ModelDirectory = Path.Combine(root, ".tools/ocr-models") };
        using var prepared = new ImagePreprocessor(options).PrepareUnclassified(bytes);
        using var detector = new OnnxOcrEngine(options, new ImagePreprocessor(options));
        using var reader = new EnglishMeterTextRecognizer(Path.Combine(root, ".tools/ocr-recovery-english"));
        var regions = detector.InspectTextRegions(prepared.Image, 1280, default).Take(48)
            .Select(r => r.BoundingRect().Intersect(new Rect(0, 0, prepared.Image.Width, prepared.Image.Height))).ToArray();
        foreach (var bounds in regions.Where(r => r.Width >= 2 && r.Height >= 2))
        {
            using var crop = new Mat(prepared.Image, bounds);
            var original = reader.Recognize(crop, default).Line;
            if (original.Text != "000890") continue;
            var margin = ExperimentalMeterRecognizer.ExpandNumericRow(bounds, regions, prepared.Image.Size());
            using var expanded = new Mat(prepared.Image, margin);
            var contaminated = reader.Recognize(expanded, default).Line;
            Assert.Equal("GF000898", contaminated.Text);
            Assert.Same(original, ExperimentalMeterRecognizer.ChooseNumericExpansion(original, contaminated));
            // This is a partial numeric observation, not verified complete digits,
            // a unit/register claim, or a new full-frame accepted reading.
            return;
        }
        Assert.Fail("Pinned real numeric region was not detected.");
    }
    [Theory]
    [InlineData("kW")]
    [InlineData("kVA")]
    [InlineData("V")]
    [InlineData("A")]
    [InlineData("Hz")]
    [InlineData("m3/h")]
    [InlineData("L/min")]
    [InlineData("1000 imp/kWh")]
    [InlineData("serial42")]
    public void RectificationCannotOverrideExplicitNonConsumptionEvidence(string original)
    {
        Assert.False(ExperimentalMeterRecognizer.CanUseRefinedUnit(new(original, .99f), new("kWh", .99f), .99f,
            new("kWh", .99f), .99f, OcrDocumentKind.DigitalElectricity));
    }
    [Fact]
    public void RefinedUnitRequiresTwoActualConsistentHighConfidenceReads()
    {
        var original = new OcrLine("uncertain", .6f);
        Assert.True(ExperimentalMeterRecognizer.CanUseRefinedUnit(original, new("kwh", .9f), .7f, new("kWh", .9f), .7f, OcrDocumentKind.DigitalElectricity));
        Assert.False(ExperimentalMeterRecognizer.CanUseRefinedUnit(original, new("kwh", .9f), .7f, new("KVA", .99f), .99f, OcrDocumentKind.DigitalElectricity));
        Assert.False(ExperimentalMeterRecognizer.CanUseRefinedUnit(original, new("kwh", .9f), .4f, new("kWh", .9f), .7f, OcrDocumentKind.DigitalElectricity));
        Assert.False(ExperimentalMeterRecognizer.CanUseRefinedUnit(original, new("kwh", .9f), .7f, new("kWh", float.NaN), .7f, OcrDocumentKind.DigitalElectricity));
        Assert.False(ExperimentalMeterRecognizer.CanUseRefinedUnit(original, new("kwh", .9f), .7f, new("kWh", .9f), .7f, OcrDocumentKind.DigitalWater));
    }
    [Fact]
    public void ExperimentalConfigurationRequiresFrozenNeutralPreprocessing()
    {
        var options = new OcrOptions
        {
            ExperimentalMeter = new()
            {
                Enabled = true,
                ClassifierPath = "classifier.onnx",
                ClassifierSha256 = new string('0', 64),
                EnglishModelDirectory = "english",
                Categories = [BHome.Application.Ocr.OcrDocumentKind.DigitalElectricity]
            }
        };
        Assert.True(options.IsValid());
        options.MaxDimension = 1280; Assert.False(options.IsValid()); options.MaxDimension = 1600;
        options.AutomaticProfile.EnhanceContrast = true; Assert.False(options.IsValid());
        options.ExperimentalMeter.Enabled = false; Assert.True(options.IsValid());
    }
    [Fact]
    public void RowMarginKeepsRealPixelsAndStopsAtAdjacentUnitRegion()
    {
        var row = new Rect(20, 10, 80, 40); var unit = new Rect(110, 10, 40, 40);
        var expanded = ExperimentalMeterRecognizer.ExpandNumericRow(row, [row, unit], new Size(200, 100));
        Assert.Equal(0, expanded.Left); Assert.Equal(110, expanded.Right); Assert.Equal(row.Y, expanded.Y); Assert.Equal(row.Height, expanded.Height);
    }
    [Fact]
    public void AUnitOnAnotherRowDoesNotCutOffTheThinTerminalDigit()
    {
        var row = new Rect(20, 10, 80, 40); var unit = new Rect(105, 70, 40, 20);
        Assert.Equal(120, ExperimentalMeterRecognizer.ExpandNumericRow(row, [row, unit], new Size(200, 100)).Right);
    }
    [Fact]
    public void BlankPixelsAreNotActiveAndRepeatedEightsAreNotAStringVeto()
    {
        using var image = new Mat(80, 300, MatType.CV_8UC3, Scalar.White);
        Assert.False(ExperimentalMeterRecognizer.HasActiveInk(image));
        Cv2.PutText(image, "88888", new Point(5, 60), HersheyFonts.HersheySimplex, 1.5, Scalar.Black, 3);
        Assert.True(ExperimentalMeterRecognizer.HasActiveInk(image));
    }
}
