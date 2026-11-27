using BHome.Application.Ocr;
using BHome.Infrastructure.Ocr;
using OpenCvSharp;

namespace BHome.IntegrationTests.Ocr;

public sealed class IdentityCardCropperTests
{
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
}
