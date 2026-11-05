using BHome.Application.Ocr;
using BHome.Infrastructure.Ocr;
using Microsoft.ML.OnnxRuntime.Tensors;
using OpenCvSharp;

namespace BHome.IntegrationTests.Ocr;

public sealed class WaterDigitRecognitionTests
{
    private static YoloMeterSceneDetector.YoloBox Digit(int value, float x, float y = 20, float score = .95f) =>
        new(value, score, new(new(x, y), new(10, 20), 0));
    [Fact]
    public void ReadingOrderPreservesZerosWithoutAssumingDigitCountOrDecimal()
    {
        var result = YoloWaterDigitRecognizer.Assemble([Digit(2, 40), Digit(0, 10), Digit(0, 25), Digit(9, 55)]);
        Assert.Equal("0029", result.Digits); Assert.Equal(.95f, result.Confidence);
        Assert.DoesNotContain("0029", result.ToString());
    }
    [Theory]
    [InlineData("unclear")]
    [InlineData("overlap")]
    [InlineData("gap")]
    [InlineData("row")]
    [InlineData("weak")]
    public void UnclearMissingDuplicateConflictingOrDifferentRowDigitsRequireReview(string failure)
    {
        var boxes = new List<YoloMeterSceneDetector.YoloBox> { Digit(0, 10), Digit(1, 25), Digit(2, 40) };
        if (failure == "unclear") boxes[1] = Digit(10, 25);
        if (failure == "overlap") boxes.Add(Digit(7, 26));
        if (failure == "gap") boxes[2] = Digit(2, 80);
        if (failure == "row") boxes[2] = Digit(2, 40, 80);
        if (failure == "weak") boxes[1] = Digit(1, 25, score: .49f);
        Assert.Null(YoloWaterDigitRecognizer.Assemble(boxes).Digits);
    }
    private static OcrText Text(params string[] lines) => new(lines.Select(t => new OcrLine(t, .9f)).ToArray(), "synthetic", []);
    [Fact]
    public void SingleUnparseablePpLineCanUseCompleteDigitsButMultipleRegionsAndWrongUnitsCannot()
    {
        var result = MeterRecognitionFusion.Combine(Text("00/768128"), new("00768328", .95f, []));
        Assert.Equal("00768328", result.Lines.Single().Text);
        Assert.Contains("stage2_only_review", result.Warnings);
        Assert.Contains("decimal_separator_unverified", result.Warnings);
        Assert.Empty(MeterRecognitionFusion.Combine(Text("00/768128", "123 Hz"), new("00768328", .95f, [])).Lines);
        Assert.Empty(MeterRecognitionFusion.Combine(Text("00123 kWh"), new("00123", .95f, [])).Lines);
        Assert.Empty(MeterRecognitionFusion.Combine(Text("00/768128") with { Warnings = ["blur_or_low_detail"] }, new("00768328", .95f, [])).Lines);
        Assert.Empty(MeterRecognitionFusion.Combine(Text("00/768128"), new("00768328", .49f, [])).Lines);
    }
    [Fact]
    public void FusionRejectsDisagreementEvenWhenOneRecognizerHasHigherConfidence()
    {
        var result = MeterRecognitionFusion.Combine(Text("00123"), new("00128", .99f, []));
        Assert.Empty(result.Lines); Assert.Contains("recognizer_conflict", result.Warnings);
        result = MeterRecognitionFusion.Combine(Text("123", "456"), new("123", .99f, []));
        Assert.Empty(result.Lines);
    }
    [Fact]
    public void FusionPreservesObservedDecimalsAndNeverFabricatesSeparatorsForDigitModel()
    {
        var result = MeterRecognitionFusion.Combine(Text("001.23"), new("00123", .95f, []));
        Assert.Equal("001.23", result.Lines.Single().Text);
        result = MeterRecognitionFusion.Combine(Text(), new("00123", .95f, []));
        Assert.Equal("00123", result.Lines.Single().Text); Assert.Contains("stage2_only_review", result.Warnings);
        var proposal = OcrFieldParser.Parse(result, OcrDocumentKind.MechanicalWater);
        Assert.Equal("001.23", MeterReadingPrecision.Apply(proposal, 2).ProposedFields["reading"]);
        Assert.Equal("00123", MeterReadingPrecision.Apply(proposal, null).ProposedFields["reading"]);
    }
    [Fact]
    public void MissingModelKeepsExplicitPpFallbackButUnclearDigitVetoesIt()
    {
        Assert.Equal("00123", MeterRecognitionFusion.Combine(Text("00123"), new(null, null, ["digit_model_unavailable"])).Lines.Single().Text);
        Assert.Empty(MeterRecognitionFusion.Combine(Text("00123"), new(null, null, ["unclear_digit"])).Lines);
        var directory = Path.Combine(Path.GetTempPath(), "bhome-digit-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        try
        {
            using var image = new Mat(40, 100, MatType.CV_8UC3, Scalar.White);
            var options = new OcrOptions { MeterDetector = new() { ModelDirectory = directory } };
            using var missing = new YoloWaterDigitRecognizer(options); missing.Warmup(default);
            Assert.Contains("digit_model_unavailable", missing.Recognize(image, default).Warnings);
            File.WriteAllText(Path.Combine(directory, YoloWaterDigitRecognizer.FileName), "corrupt");
            using var corrupt = new YoloWaterDigitRecognizer(options);
            Assert.Contains("digit_model_unavailable", corrupt.Recognize(image, default).Warnings);
            Assert.Throws<OperationCanceledException>(() => corrupt.Recognize(image, new CancellationToken(true)));
        }
        finally { File.Delete(Path.Combine(directory, YoloWaterDigitRecognizer.FileName)); Directory.Delete(directory); }
    }
    [Fact]
    public void Stage2UsesItsOwnClassContractAndNativeOddPaddingConvention()
    {
        var raw = new DenseTensor<float>(new[] { 1, 16, 3549 });
        raw[0, 0, 0] = 200; raw[0, 1, 0] = 200; raw[0, 2, 0] = 20; raw[0, 3, 0] = 50; raw[0, 7, 0] = .95f;
        var boxes = YoloMeterSceneDetector.Decode(raw, new(114, 27), 416d / 114, 0, 158, .35f, .45f, digits: true);
        Assert.Equal(3, boxes.Single().ClassId);
        Assert.InRange(boxes.Single().Box.Center.Y, 11.23f, 11.24f); // native pad159
        Assert.Throws<InvalidDataException>(() => YoloMeterSceneDetector.Decode(raw, new(114, 27), 1, 0, 0, .35f, .45f));
    }
}
