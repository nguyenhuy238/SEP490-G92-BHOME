using BHome.Application.Ocr;
using BHome.Infrastructure.Ocr;
using Microsoft.ML.OnnxRuntime.Tensors;
using OpenCvSharp;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;

namespace BHome.IntegrationTests.Ocr;

// Adapter contract/safety tests, not trained-model accuracy evidence.
public sealed class YoloMeterCategoryClassifierTests
{
    // Deliberately constant ONNX graph (not trained weights). Generated with
    // onnx.helper Constant(value=[1,8,3549]), FP32/opset17/IR9; only anchor0
    // contains cxcywh=(208,208,208,83.2), class3=.97. This exercises the real
    // loader/ORT/concurrency, NEVER model accuracy or a usable classifier.
    private const string ConstantGraph = "H4sIAAAAAAACCu3bsWoUQRgH8F2TbMYFIVlBhEAIaQLB4tQujZB0VtraHJt1Ly7e7R13s3oS8i5X2fkC+hb2eQP7s3SjRlB8hN8PZor5fzMDX/+Fuyefv2f513VWbE+7OOvi4DCcTdtFLNt4/GWd5VvvynFXH39aZyENIVzv7aTPV+ssSV6cJQAAAAAAAAAAAAAAAABAYuYOAAAAAAAAAAAAAAAAAG6ZuQMAAAAAAAAAAAAAAACAG6PRx1NdAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP7n28vlM10AAAAAAAAAAAAAAAAAgCRZpZvFfr2cjZuqicNq2i5i2cZhrBdxOGqWsZvXrw7zrJmUF/WieJg/CGlR5HdC2q+NfCOsfm3n+/n2tIuzLg6K+/luX3Tvd1Ho8+u908082dmdv8232nLSP3R+OTg5OKrHdRXnNz9/GE7q6k3ZNlU5Pnp08Pif8HVz0cSfyZM+eV/Gev73had/jm9Lr34AdnxrMrO8AQA=";

    [Fact]
    public async Task ActualOnnxSessionLoadsVerifiedFixtureOnceAndSupportsConcurrentRuns()
    {
        using var compressed = new MemoryStream(Convert.FromBase64String(ConstantGraph));
        using var gzip = new GZipStream(compressed, CompressionMode.Decompress);
        using var bytes = new MemoryStream(); gzip.CopyTo(bytes);
        var content = bytes.ToArray();
        var path = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N") + ".onnx");
        try
        {
            File.WriteAllBytes(path, content);
            var options = new OcrOptions
            {
                VisualClassifier = new()
                {
                    Enabled = true,
                    ModelPath = path,
                    Sha256 = Convert.ToHexString(SHA256.HashData(content))
                }
            };
            using (var classifier = new YoloMeterCategoryClassifier(options, true))
            {
                classifier.Warmup(default);
                var results = await Task.WhenAll(Enumerable.Range(0, 4).Select(_ => Task.Run(() =>
                {
                    using var image = new Mat(100, 200, MatType.CV_8UC3, Scalar.Black);
                    return classifier.Classify(image, default)!;
                })));
                Assert.All(results, result => { Assert.Equal(OcrDocumentKind.DigitalWater, result.Kind); Assert.Equal(.97f, result.Confidence); });
            }
            // Valid tensors and checksum alone cannot establish the class order.
            var offset = content.AsSpan().IndexOf(Encoding.ASCII.GetBytes("water_digital"));
            Assert.True(offset > 0);
            Encoding.ASCII.GetBytes("water_invalid").CopyTo(content, offset);
            File.WriteAllBytes(path, content);
            options.VisualClassifier.Sha256 = Convert.ToHexString(SHA256.HashData(content));
            using var incompatible = new YoloMeterCategoryClassifier(options, true);
            using var frame = new Mat(100, 200, MatType.CV_8UC3, Scalar.Black);
            Assert.Equal("unavailable", incompatible.Classify(frame, default)!.Status);
        }
        finally { File.Delete(path); }
    }

    [LocalMeterModelsFact]
    public async Task OptionalClassifierOutagePreservesRealPpOcrAndTrustedTaskMismatchFallsBack()
    {
        var root = Environment.GetEnvironmentVariable("BHOME_OCR_LOCAL_EVALUATION_ROOT")!;
        var options = new OcrOptions { ModelDirectory = Path.Combine(root, ".tools/ocr-models") };
        var fake = new BoundaryClassifier(new("unavailable", null, "visual_model", Warnings: ["visual_classifier_unavailable"]));
        using var engine = new OnnxOcrEngine(options, new ImagePreprocessor(options), categoryClassifier: fake);
        var image = File.ReadAllBytes(Path.Combine(root, ".tools/ocr-real/meter.png"));
        var analysis = await engine.AnalyzeAsync(image, default);
        var routed = AutomaticOcrRouter.Route(analysis, .9f);
        Assert.Equal("electricity_digital", routed.DetectedCategory); Assert.Null(routed.ClassificationConfidence);
        Assert.Contains("visual_classifier_unavailable", routed.Warnings);
        fake.Decision = new("classified", OcrDocumentKind.DigitalWater, "visual_model", .99f);
        var mismatch = await engine.RecognizeAsync(image, OcrDocumentKind.DigitalElectricity, default);
        Assert.Empty(mismatch.Lines); Assert.Contains("meter_type_mismatch", mismatch.Warnings);
        fake.Decision = new("unknown", null, "visual_model");
        var identity = File.ReadAllBytes(Path.Combine(root, ".tools/automatic-ocr/front-0.png"));
        var front = AutomaticOcrRouter.Route(await engine.AnalyzeAsync(identity, default), .9f);
        Assert.Equal("cccd_front", front.DetectedCategory); Assert.NotNull(front.IdentityProposal);
        Assert.True(front.IdentityProposal.RequiresConfirmation);
    }

    private sealed class BoundaryClassifier(OcrCategoryDecision decision) : IImageCategoryClassifier
    {
        public OcrCategoryDecision Decision { get; set; } = decision;
        public OcrCategoryDecision Classify(Mat image, CancellationToken token) => Decision;
    }

    [LocalMeterModelsFact]
    public async Task ClassifiedWaterUsesRealStage2DisplayReaderAndReturnsReviewCrop()
    {
        // Classification is a labelled orchestration boundary; detection/PP/
        // stage2 below use actual pinned ONNX weights, not classifier accuracy.
        var root = Environment.GetEnvironmentVariable("BHOME_OCR_LOCAL_EVALUATION_ROOT")!;
        var options = new OcrOptions
        {
            Enabled = true,
            ModelDirectory = Path.Combine(root, ".tools/ocr-models"),
            MeterDetectionMinConfidence = .7f,
            MeterDetector = new()
            {
                Enabled = true,
                WaterDigitsEnabled = true,
                ModelDirectory = Path.Combine(root, ".tools/meter-detection-models")
            }
        };
        using var detector = new YoloMeterSceneDetector(options);
        using var digits = new YoloWaterDigitRecognizer(options); digits.Warmup(default);
        var classifier = new BoundaryClassifier(new("classified", OcrDocumentKind.MechanicalWater, "visual_model", .99f));
        using var engine = new OnnxOcrEngine(options, new ImagePreprocessor(options), detector, classifier, digits);
        using var original = Cv2.ImRead(Path.Combine(root, ".tools/meter-detection-all-test/wm_clean_000058.jpg"));
        using var resized = new Mat(); var scale = Math.Min(1d, 1600d / Math.Max(original.Width, original.Height));
        Cv2.Resize(original, resized, new((int)(original.Width * scale), (int)(original.Height * scale)), 0, 0, InterpolationFlags.Area);
        var image = resized.ImEncode(".jpg", new ImageEncodingParam(ImwriteFlags.JpegQuality, 85));
        var analysis = await engine.AnalyzeAsync(image, default);
        var automatic = AutomaticOcrRouter.Route(analysis, .9f);
        var typed = OcrFieldParser.Parse(await engine.RecognizeAsync(image, OcrDocumentKind.MechanicalWater, default), OcrDocumentKind.MechanicalWater);
        Assert.Equal("00431469", typed.ProposedFields["reading"]);
        Assert.Equal(typed.ProposedFields["reading"], automatic.MeterProposal!.ProposedFields["reading"]);
        Assert.Equal("water_mechanical", automatic.DetectedCategory);
        Assert.NotNull(automatic.CropPreviewDataUri); Assert.NotNull(automatic.DetectionConfidence);
        Assert.DoesNotContain("reading_region_unverified", automatic.MeterProposal.Warnings);
        Assert.True(automatic.MeterProposal.RequiresConfirmation); Assert.True(automatic.RequiresReview);

        classifier.Decision = new("classified", OcrDocumentKind.DigitalWater, "visual_model", .99f);
        var unsupported = AutomaticOcrRouter.Route(await engine.AnalyzeAsync(image, default), .9f);
        Assert.Null(unsupported.CropPreviewDataUri); Assert.Null(unsupported.DetectionConfidence);
        Assert.Contains("billing_register_unverified", unsupported.MeterProposal!.Warnings);
        Assert.Contains("reading_region_unverified", unsupported.MeterProposal.Warnings);
    }

    private static DenseTensor<float> Tensor() => new(new[] { 1, 8, 3549 });
    private static void Box(DenseTensor<float> tensor, int index, int category, float score, float x = 208)
    {
        tensor[0, 0, index] = x; tensor[0, 1, index] = 208;
        tensor[0, 2, index] = 208; tensor[0, 3, index] = 83.2f;
        tensor[0, 4 + category, index] = score;
    }
    private static IReadOnlyList<YoloMeterCategoryClassifier.Detection> Decode(DenseTensor<float> tensor) =>
        YoloMeterCategoryClassifier.Decode(tensor, new(200, 100), 2.08, 0, 104, .25f, .45f);

    [Theory]
    [InlineData(0, OcrDocumentKind.MechanicalElectricity)]
    [InlineData(1, OcrDocumentKind.DigitalElectricity)]
    [InlineData(2, OcrDocumentKind.MechanicalWater)]
    [InlineData(3, OcrDocumentKind.DigitalWater)]
    public void FourClassMappingAndInverseLetterboxAreExplicit(int category, OcrDocumentKind kind)
    {
        var tensor = Tensor(); Box(tensor, 0, category, .97f);
        var detection = Assert.Single(Decode(tensor));
        Assert.Equal(kind, detection.Category);
        Assert.InRange(detection.Bounds.X, 49.99, 50.01); Assert.InRange(detection.Bounds.Y, 29.99, 30.01);
        Assert.InRange(detection.Bounds.Width, 99.99, 100.01); Assert.InRange(detection.Bounds.Height, 39.99, 40.01);
        var decision = YoloMeterCategoryClassifier.Decide([detection], .9f);
        Assert.Equal("classified", decision.Status); Assert.Equal(kind, decision.Kind);
        Assert.Equal(.97f, decision.Confidence); Assert.Equal("visual_model", decision.Source);
    }

    [Fact]
    public void DuplicateNmsPreservesOtherMetersAndConflictingClassEvidence()
    {
        var tensor = Tensor(); Box(tensor, 0, 0, .98f); Box(tensor, 1, 0, .96f);
        Assert.Single(Decode(tensor));
        Box(tensor, 2, 0, .8f, 395); // second, lower-confidence meter still requires review
        Assert.Equal(2, Decode(tensor).Count);
        Assert.Equal("ambiguous", YoloMeterCategoryClassifier.Decide(Decode(tensor), .9f).Status);
        tensor = Tensor(); Box(tensor, 0, 0, .98f); tensor[0, 5, 0] = .91f;
        Assert.Equal(2, Decode(tensor).Count); // competing classes at the SAME anchor
        Assert.Null(YoloMeterCategoryClassifier.Decide(Decode(tensor), .9f).Kind);
    }

    [Fact]
    public void NoDetectionAndLowConfidenceNeverAcquireAClassProbability()
    {
        Assert.Equal("unknown", YoloMeterCategoryClassifier.Decide(Decode(Tensor()), .9f).Status);
        var tensor = Tensor(); Box(tensor, 0, 3, .7f);
        var decision = YoloMeterCategoryClassifier.Decide(Decode(tensor), .9f);
        Assert.Equal("ambiguous", decision.Status); Assert.Null(decision.Confidence); Assert.Null(decision.Kind);
    }

    [Fact]
    public void MalformedTensorsAndNonfiniteCompetingScoresFailClosed()
    {
        Assert.Throws<InvalidDataException>(() => Decode(new(new[] { 1, 7, 3549 })));
        var tensor = Tensor(); Box(tensor, 0, 0, .99f); tensor[0, 5, 0] = float.NaN;
        Assert.Throws<InvalidDataException>(() => Decode(tensor));
        tensor[0, 5, 0] = 1.1f; Assert.Throws<InvalidDataException>(() => Decode(tensor));
        tensor[0, 5, 0] = 0; tensor[0, 2, 0] = float.PositiveInfinity;
        Assert.Throws<InvalidDataException>(() => Decode(tensor));
        Assert.Throws<OperationCanceledException>(() => YoloMeterCategoryClassifier.Decode(Tensor(), new(200, 100), 2.08, 0, 104, .25f, .45f, new(true)));
    }

    [Fact]
    public void DisabledProductionMissingAndCorruptModelsCannotRunOrGuess()
    {
        var path = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N") + ".onnx");
        var options = new OcrOptions();
        using var image = new Mat(100, 200, MatType.CV_8UC3, Scalar.Black);
        using (var disabled = new YoloMeterCategoryClassifier(options, true)) Assert.Null(disabled.Classify(image, default));
        options.VisualClassifier = new() { Enabled = true, ModelPath = path, Sha256 = new('0', 64) };
        Assert.True(options.IsValid());
        using (var production = new YoloMeterCategoryClassifier(options, false))
            Assert.Equal("unavailable", production.Classify(image, default)!.Status);
        using (var missing = new YoloMeterCategoryClassifier(options, true))
        {
            missing.Warmup(default);
            Assert.Contains("visual_classifier_unavailable", missing.Classify(image, default)!.Warnings!);
            Assert.Throws<OperationCanceledException>(() => missing.Classify(image, new(true)));
        }
        try
        {
            File.WriteAllText(path, "not ONNX");
            using var corrupt = new YoloMeterCategoryClassifier(options, true);
            Assert.Equal("unavailable", corrupt.Classify(image, default)!.Status);
        }
        finally { File.Delete(path); }
        options.VisualClassifier.Sha256 = "unverified"; Assert.False(options.IsValid());
        options.VisualClassifier.Enabled = false; Assert.True(options.IsValid()); // immediate rollback
    }

    [Fact]
    public void InvalidArtifactPathAndThresholdCannotCrashOrCreateAClassification()
    {
        var options = new OcrOptions
        {
            VisualClassifier = new()
            {
                Enabled = true,
                ModelPath = "invalid\0path.onnx",
                Sha256 = new('0', 64)
            }
        };
        using var classifier = new YoloMeterCategoryClassifier(options, true);
        using var image = new Mat(100, 200, MatType.CV_8UC3, Scalar.Black);
        classifier.Warmup(default);
        Assert.Equal("unavailable", classifier.Classify(image, default)!.Status);
        Assert.Throws<InvalidDataException>(() => YoloMeterCategoryClassifier.Decide([], float.NaN));
    }

    [Fact]
    public void VisualEvidenceNeverOverridesTrustedTaskMetadata()
    {
        var mismatch = new OcrCategoryDecision("classified", OcrDocumentKind.DigitalWater, "visual_model", .99f);
        var result = MeterCategoryValidation.Check(mismatch, OcrDocumentKind.DigitalElectricity, .9f);
        Assert.False(result.CanRecognize); Assert.Contains("meter_type_mismatch", result.Warnings);
        Assert.True(MeterCategoryValidation.Check(mismatch, OcrDocumentKind.DigitalWater, .9f).CanRecognize);
        Assert.True(MeterCategoryValidation.Check(mismatch with { Confidence = .5f }, OcrDocumentKind.DigitalElectricity, .9f).CanRecognize);
        result = MeterCategoryValidation.Check(new("unavailable", null, "visual_model"), OcrDocumentKind.DigitalElectricity, .9f);
        Assert.True(result.CanRecognize); Assert.Contains("meter_category_unverified", result.Warnings);
        Assert.False(MeterCategoryValidation.Check(new("ambiguous", null, "visual_model", Warnings: ["multiple_meters"]), OcrDocumentKind.DigitalWater, .9f).CanRecognize);
    }

    [LocalMeterModelsFact]
    public void ExistingRejectedThreeClassCheckpointCannotMasqueradeAsFourClasses()
    {
        var root = Environment.GetEnvironmentVariable("BHOME_OCR_LOCAL_EVALUATION_ROOT")!;
        var options = new OcrOptions
        {
            VisualClassifier = new()
            {
                Enabled = true,
                ModelPath = Path.Combine(root, ".tools/master-body-verified-export/body.onnx"),
                Sha256 = "b7fc13aa09262c46ced335f31d5726c8f8369b5f8e2c4ce7ed5994f4166278af"
            }
        };
        using var classifier = new YoloMeterCategoryClassifier(options, true);
        using var image = new Mat(100, 200, MatType.CV_8UC3, Scalar.Black);
        var result = classifier.Classify(image, default)!;
        Assert.Equal("unavailable", result.Status); Assert.Null(result.Kind); Assert.Null(result.Confidence);
    }
}
