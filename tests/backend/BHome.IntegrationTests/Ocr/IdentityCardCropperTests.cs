using BHome.Application.Ocr;
using BHome.Infrastructure.Ocr;
using OpenCvSharp;

namespace BHome.IntegrationTests.Ocr;

public sealed class IdentityCardCropperTests
{
    [Fact]
    public void LowContrastCardCanBeLocalizedWithoutAStrongCannyBoundary()
    {
        using var source = new Mat(1280, 960, MatType.CV_8UC3, Scalar.All(100));
        Cv2.Rectangle(source, new Rect(180, 350, 600, 375), Scalar.All(125), -1);
        using var crop = new Mat();
        Assert.True(IdentityCardCropper.TryCrop(source, crop));
        Assert.InRange(crop.Width, 570, 630);
        Assert.InRange(crop.Height, 345, 405);
        Assert.True(Cv2.Mean(crop).Val0 > 120);
    }

    [Fact]
    public void BrightnessFallbackStillRejectsTwoCardsAndASquare()
    {
        using var source = new Mat(1000, 1600, MatType.CV_8UC3, Scalar.All(100));
        using var crop = new Mat();
        Cv2.Rectangle(source, new Rect(100, 300, 600, 375), Scalar.All(125), -1);
        Cv2.Rectangle(source, new Rect(900, 300, 600, 375), Scalar.All(125), -1);
        Assert.False(IdentityCardCropper.TryCrop(source, crop));
        source.SetTo(Scalar.All(100));
        Cv2.Rectangle(source, new Rect(400, 200, 600, 600), Scalar.All(125), -1);
        Assert.False(IdentityCardCropper.TryCrop(source, crop));
    }

    [Theory]
    [InlineData(1600, 1200)]
    [InlineData(800, 800)]
    public void SmallIdentityIsResampledWithinConfiguredLimitButMeterIsNot(int limit, int expectedWidth)
    {
        using var source = new Mat(375, 600, MatType.CV_8UC3, Scalar.White);
        var options = new OcrOptions { MaxDimension = limit };
        var processor = new ImagePreprocessor(options);
        using var identity = processor.Prepare(source.ImEncode(".png"), OcrDocumentKind.IdentityFront);
        using var back = processor.Prepare(source.ImEncode(".png"), OcrDocumentKind.IdentityBack);
        using var meter = processor.Prepare(source.ImEncode(".png"), OcrDocumentKind.DigitalWater);
        Assert.Equal(expectedWidth, identity.Image.Width);
        Assert.Equal(600, back.Image.Width);
        Assert.Equal(600, meter.Image.Width);
    }

    [Fact]
    public void UpperFrontValueCanBeReadBeforeItsLabelWhileAllRegionsRemainAvailable()
    {
        var number = new RotatedRect(new(650, 300), new(400, 45), 0);
        var numberLabel = new RotatedRect(new(530, 250), new(150, 25), 0);
        var name = new RotatedRect(new(750, 420), new(500, 40), 0);
        var nameLabel = new RotatedRect(new(750, 370), new(500, 25), 0);
        List<RotatedRect> regions = [numberLabel, number, nameLabel, name];
        var ordered = IdentityTextRegionOrder.Prioritize(regions, new(1400, 880), OcrDocumentKind.IdentityFront);
        Assert.Equal(new[] { number, nameLabel, name }, ordered.Take(3));
        Assert.Equal(regions.Count, ordered.Distinct().Count());
    }

    [Fact]
    public void FrontNameAndDatePrecedeLargerAddressTextAndTheNationalHeading()
    {
        var header = new RotatedRect(new(850, 100), new(900, 65), 0);
        var address = new RotatedRect(new(800, 760), new(800, 55), 0);
        var name = new RotatedRect(new(750, 400), new(500, 40), 0);
        var nameLabel = new RotatedRect(new(750, 350), new(500, 25), 0);
        var birth = new RotatedRect(new(650, 530), new(300, 40), 0);
        var birthLabel = new RotatedRect(new(750, 480), new(500, 25), 0);
        List<RotatedRect> regions = [header, address, nameLabel, name, birthLabel, birth];
        var ordered = IdentityTextRegionOrder.Prioritize(regions, new(1400, 880), OcrDocumentKind.IdentityFront);
        Assert.Equal(new[] { nameLabel, name, birthLabel, birth }, ordered.Take(4));
        Assert.Equal(regions.Count, ordered.Distinct().Count());
    }

    [Fact]
    public void BackFieldRegionsPrecedeLargeMrzAndSignatoryTextWithoutDiscardingThem()
    {
        var mrz = new RotatedRect(new(700, 780), new(1250, 65), 0);
        var signatory = new RotatedRect(new(600, 640), new(700, 60), 0);
        var issue = new RotatedRect(new(750, 240), new(250, 35), 0);
        var label = new RotatedRect(new(320, 240), new(500, 25), 0);
        List<RotatedRect> regions = [mrz, signatory, label, issue];
        var ordered = IdentityTextRegionOrder.Prioritize(regions, new(1400, 880), OcrDocumentKind.IdentityBack);
        Assert.Equal(new[] { issue, label }, ordered.Take(2));
        Assert.Equal(regions.Count, ordered.Distinct().Count());
        Assert.Contains(mrz, ordered);
        Assert.Contains(signatory, ordered);
    }

    [Fact]
    public void ReadsLargeValuesTogetherWithTheirLabelsBeforeHeaderAndMicroprint()
    {
        var nameLabel = new RotatedRect(new(700, 300), new(500, 25), 0);
        var name = new RotatedRect(new(700, 345), new(500, 50), 0);
        var dateLabel = new RotatedRect(new(650, 425), new(400, 25), 0);
        var date = new RotatedRect(new(650, 470), new(400, 50), 0);
        var header = new RotatedRect(new(700, 50), new(800, 25), 0);
        List<RotatedRect> regions = [header, nameLabel, name, dateLabel, date];
        var ordered = IdentityTextRegionOrder.Prioritize(regions, new(1400, 880), OcrDocumentKind.IdentityFront);
        Assert.Equal(new[] { nameLabel, name, dateLabel, date }, ordered.Take(4));
        Assert.Equal(regions.Count, ordered.Distinct().Count());
        Assert.Same(regions, IdentityTextRegionOrder.Prioritize(regions, new(1400, 880), OcrDocumentKind.DigitalWater));
        Assert.Same(regions, IdentityTextRegionOrder.Prioritize(regions, new(1500, 500), OcrDocumentKind.IdentityFront));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(6)]
    [InlineData(-18)]
    [InlineData(35)]
    [InlineData(60)]
    [InlineData(90)]
    public void LocalizesOneCardBeforeResizingAndPreservesItsContents(float angle)
    {
        using var scene = Scene();
        var card = new RotatedRect(new(1200, 1580), new(1400, 880), angle);
        Cv2.FillConvexPoly(scene, card.Points().Select(p => new Point((int)p.X, (int)p.Y)), Scalar.White);
        using var cropped = new Mat();
        Assert.True(IdentityCardCropper.TryCrop(scene, cropped));
        Assert.InRange(cropped.Width, 1350, 1450);
        Assert.InRange(cropped.Height, 830, 930);
        Assert.True(Cv2.Mean(cropped).Val0 > 245);
        using var prepared = new ImagePreprocessor(new OcrOptions()).Prepare(scene.ImEncode(".png"), OcrDocumentKind.IdentityFront);
        Assert.InRange(prepared.Image.Width, 1350, 1450);
        Assert.InRange(prepared.Image.Height, 830, 930);
    }

    [Fact]
    public void DoesNotChooseBetweenTwoDistinctCards()
    {
        using var scene = new Mat(1400, 2400, MatType.CV_8UC3, new Scalar(65, 74, 85));
        Cv2.Rectangle(scene, new Rect(100, 400, 950, 600), Scalar.White, -1);
        Cv2.Rectangle(scene, new Rect(1300, 400, 950, 600), Scalar.White, -1);
        using var cropped = new Mat();
        Assert.False(IdentityCardCropper.TryCrop(scene, cropped));
        Assert.True(cropped.Empty());
    }

    [Fact]
    public void BlankImageAndNonCardShapeKeepTheOriginalFrame()
    {
        using var scene = Scene();
        using var cropped = new Mat();
        Assert.False(IdentityCardCropper.TryCrop(scene, cropped));
        Cv2.Rectangle(scene, new Rect(400, 500, 1500, 1500), Scalar.White, -1);
        Assert.False(IdentityCardCropper.TryCrop(scene, cropped));
    }

    [Fact]
    public void DoesNotMistakeThePortraitInsetForATightlyFramedCard()
    {
        using var frame = new Mat(880, 1400, MatType.CV_8UC3, Scalar.White);
        Cv2.Rectangle(frame, new Rect(50, 190, 370, 570), new Scalar(100, 110, 120), -1);
        using var cropped = new Mat();
        Assert.False(IdentityCardCropper.TryCrop(frame, cropped));
        using var prepared = new ImagePreprocessor(new OcrOptions()).Prepare(frame.ImEncode(".png"), OcrDocumentKind.IdentityFront);
        Assert.Equal(frame.Size(), prepared.Image.Size());
    }

    [Fact]
    public void IdentityLocalizationDoesNotCropMeterInputs()
    {
        using var scene = Scene();
        Cv2.Rectangle(scene, new Rect(500, 1140, 1400, 880), Scalar.White, -1);
        using var prepared = new ImagePreprocessor(new OcrOptions()).Prepare(scene.ImEncode(".png"), OcrDocumentKind.DigitalWater);
        Assert.Equal(1280, prepared.Image.Width);
        Assert.Equal(1600, prepared.Image.Height);
    }

    private static Mat Scene() => new(3000, 2400, MatType.CV_8UC3, new Scalar(65, 74, 85));

    [Theory]
    [InlineData(-75)]
    [InlineData(-35)]
    [InlineData(35)]
    [InlineData(75)]
    [InlineData(90)]
    public void CornerOrderPreservesLongAndShortEdgesForSteepTilt(float angle)
    {
        var box = new RotatedRect(new(1200, 1400), new(1400, 880), angle);
        var corners = IdentityCardCropper.OrderCorners(box.Points().Reverse().ToArray());
        Assert.InRange(corners[0].DistanceTo(corners[1]), 1399, 1401);
        Assert.InRange(corners[0].DistanceTo(corners[3]), 879, 881);
        Assert.True(corners[0].Y + corners[1].Y <= corners[2].Y + corners[3].Y + .01);
    }
}
