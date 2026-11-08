using BHome.Application.Ocr;
using BHome.Infrastructure.Ocr;
using OpenCvSharp;

namespace BHome.IntegrationTests.Ocr;

public sealed class TrustedMeterCategoryTests
{
    private static OcrCategoryDecision WeakBody() => YoloMeterCategoryClassifier.Decide([
        new(OcrDocumentKind.MechanicalElectricity,.7f,new Rect2d(0,0,200,100)),
        new(OcrDocumentKind.DigitalElectricity,.65f,new Rect2d(2,1,200,100))], .9f);

    [Fact]
    public void WeakOverlappingCategoriesAreNotCountedAsTwoPhysicalMeters()
    {
        var visual = WeakBody();
        Assert.DoesNotContain("multiple_meters", visual.Warnings!);
        Assert.Null(visual.Kind); Assert.Equal("ambiguous", visual.Status);
        var freeForm = AutomaticOcrRouter.Route(new(new([], "synthetic", []), visual), .9f);
        Assert.Equal("unknown", freeForm.DetectedCategory); Assert.Null(freeForm.MeterProposal);
        var selected = MeterCategoryValidation.Check(visual, OcrDocumentKind.DigitalElectricity, .9f);
        Assert.True(selected.CanRecognize); Assert.Contains("meter_category_unverified", selected.Warnings);
        Assert.False(MeterCategoryValidation.Check(visual with { Confidence = .99f }, OcrDocumentKind.DigitalElectricity, .9f).CanRecognize);
    }

    [Theory]
    [InlineData(220, .65f)]
    [InlineData(2, .99f)]
    public void SeparateBodiesOrStrongContradictionsStillRequireRetake(int otherX, float confidence)
    {
        var visual = YoloMeterCategoryClassifier.Decide([
            new(OcrDocumentKind.MechanicalElectricity,.7f,new Rect2d(0,0,200,100)),
            new(OcrDocumentKind.DigitalWater,confidence,new Rect2d(otherX,1,200,100))], .9f);
        Assert.False(MeterCategoryValidation.Check(visual, OcrDocumentKind.DigitalElectricity, .9f).CanRecognize);
    }

    [LocalMeterModelsFact]
    public async Task TrustedProfileReachesRealPpOcrDespiteWeakCategoryHypotheses()
    {
        // Synthetic detector boxes; real pinned PP models and known rendered
        // digits. This tests routing, not learned visual-classifier accuracy.
        var root = Environment.GetEnvironmentVariable("BHOME_OCR_LOCAL_EVALUATION_ROOT")!;
        var options = new OcrOptions { ModelDirectory = Path.Combine(root, ".tools/ocr-models") };
        using var image = new Mat(180, 640, MatType.CV_8UC3, Scalar.White);
        Cv2.PutText(image, "123.45 kWh", new Point(30, 115), HersheyFonts.HersheySimplex, 2, Scalar.Black, 3);
        var legacy = new OcrCategoryDecision("ambiguous", null, "visual_model", Candidates: [OcrDocumentKind.MechanicalElectricity, OcrDocumentKind.DigitalElectricity], Warnings: ["multiple_meters"]);
        using var previous = new OnnxOcrEngine(options, new ImagePreprocessor(options), categoryClassifier: new FixedVisual(legacy));
        var before = OcrFieldParser.Parse(await previous.RecognizeAsync(image.ImEncode(".png"), OcrDocumentKind.DigitalElectricity, default), OcrDocumentKind.DigitalElectricity);
        Assert.True(before.IsFallback); Assert.Empty(before.ProposedFields);
        using var engine = new OnnxOcrEngine(options, new ImagePreprocessor(options), categoryClassifier: new FixedVisual(WeakBody()));
        var result = OcrFieldParser.Parse(await engine.RecognizeAsync(image.ImEncode(".png"), OcrDocumentKind.DigitalElectricity, default), OcrDocumentKind.DigitalElectricity);
        Assert.Equal("123.45", result.ProposedFields.GetValueOrDefault("reading"));
        Assert.True(result.RequiresConfirmation); Assert.Contains("meter_category_unverified", result.Warnings);
        using var rejected = new OnnxOcrEngine(options, new ImagePreprocessor(options), categoryClassifier: new FixedVisual(
            new("classified", OcrDocumentKind.DigitalWater, "visual_model", .99f)));
        var mismatch = await rejected.RecognizeAsync(image.ImEncode(".png"), OcrDocumentKind.DigitalElectricity, default);
        Assert.Empty(mismatch.Lines); Assert.Contains("meter_type_mismatch", mismatch.Warnings);
    }

    private sealed class FixedVisual(OcrCategoryDecision decision) : IImageCategoryClassifier
    {
        public OcrCategoryDecision Classify(Mat image, CancellationToken token) => decision;
    }
}
