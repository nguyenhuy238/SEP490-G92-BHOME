using BHome.Application.Ocr;
using BHome.Infrastructure.Ocr;
using OpenCvSharp;

namespace BHome.IntegrationTests.Ocr;

public sealed class OcrRecognitionTests
{
    [Fact]
    public void LongIdentityLinesSplitOnlyAtAnObservedWordGap()
    {
        using var words = new Mat(80, 900, MatType.CV_8UC3, Scalar.White);
        Cv2.Rectangle(words, new Rect(30, 20, 350, 40), Scalar.Black, -1);
        Cv2.Rectangle(words, new Rect(470, 20, 350, 40), Scalar.Black, -1);
        Assert.True(OcrLineSegmentation.TryWordBoundary(words, out var split));
        Assert.InRange(split, 380, 469);
        using var continuous = new Mat(80, 900, MatType.CV_8UC3, Scalar.White);
        Cv2.Rectangle(continuous, new Rect(30, 20, 790, 40), Scalar.Black, -1);
        Assert.False(OcrLineSegmentation.TryWordBoundary(continuous, out _));
    }

    [Theory]
    [InlineData(OcrDocumentKind.MechanicalElectricity, "kWh")]
    [InlineData(OcrDocumentKind.DigitalElectricity, "kWh")]
    [InlineData(OcrDocumentKind.MechanicalWater, "m^3")]
    [InlineData(OcrDocumentKind.DigitalWater, "㎥")]
    public void AllMeterKindsRefineOnlyTheQuantityBesideItsOwnUnit(OcrDocumentKind kind, string unit)
    {
        var quantity = new OcrLine("00123X45", .9f) { Bounds = new(20, 50, 180, 40) };
        OcrLine[] lines = [quantity, new(unit, .95f) { Bounds = new(150, 20, 45, 20) }];
        Assert.True(OcrNumericRefinement.HasUnit(quantity, lines, kind));
        Assert.False(OcrNumericRefinement.HasUnit(new("1600 imp/kWh", .99f), [], kind));
        Assert.False(OcrNumericRefinement.HasUnit(new("123 m3/h", .99f), [], kind));
    }
    [Theory]
    [InlineData(-20)]
    [InlineData(-8)]
    [InlineData(0)]
    [InlineData(8)]
    [InlineData(20)]
    public void LongTiltedTextIsRectifiedAlongItsLongEdge(float angle)
    {
        var region = new RotatedRect(new(500, 300), new(800, 30), angle);
        var corners = OcrImageGeometry.Corners(region);
        Assert.InRange(corners[0].DistanceTo(corners[1]), 799, 801);
        Assert.InRange(corners[0].DistanceTo(corners[3]), 29, 31);
        var expanded = OcrImageGeometry.Expand(region);
        Assert.True(expanded.Size.Height > region.Size.Height * 2);
        Assert.Equal(region.Center, expanded.Center);
    }

    [Fact]
    public void TextAxisIgnoresSquareSymbols()
    {
        Assert.True(OcrImageGeometry.IsVertical([new(new(100, 100), new(30, 400), 0)]));
        Assert.False(OcrImageGeometry.IsVertical([new(new(100, 100), new(400, 30), 0)]));
        Assert.False(OcrImageGeometry.IsVertical([new(new(100, 100), new(30, 30), 0)]));
    }

    [Theory]
    [InlineData(-20)]
    [InlineData(-8)]
    [InlineData(0)]
    [InlineData(8)]
    [InlineData(20)]
    public void LayoutCoordinatesUndoTiltWithoutInflatingTextHeight(float degrees)
    {
        var radians = degrees * Math.PI / 180;
        RotatedRect Region(float x, float y) => new(
            new Point2f((float)(x * Math.Cos(radians) - y * Math.Sin(radians)),
                (float)(x * Math.Sin(radians) + y * Math.Cos(radians))), new Size2f(500, 25), degrees);
        var first = Region(500, 100); var second = Region(500, 150);
        var angle = OcrImageGeometry.PageAngle([first, second]);
        var a = OcrImageGeometry.LayoutBounds(first, angle);
        var b = OcrImageGeometry.LayoutBounds(second, angle);
        Assert.InRange(b.Y - a.Y, 49.9f, 50.1f);
        Assert.InRange(Math.Abs(b.X - a.X), 0, .1f);
        Assert.Equal(25, a.Height);
    }

    [Theory]
    [InlineData("03257H", "032514", "032514", false)]
    [InlineData("00123.45", "0012345", "00123.45", false)]
    [InlineData("0012345", "00123.45", "00123.45", false)]
    [InlineData("00123.45", "00124.45", "", true)]
    [InlineData("00123.45", "0123.45", "", true)]
    [InlineData("00123.45", "unreadable", "00123.45", false)]
    public void NumericRefinementNeverChoosesBetweenConflictingValidReadings(string original, string candidate, string expected, bool conflict)
    {
        var line = new OcrLine(original, .95f) { Bounds = new(20, 30, 100, 40) };
        var result = OcrNumericRefinement.Select(line, new(candidate, .99f), OcrDocumentKind.DigitalElectricity);
        Assert.Equal(expected, result.Line.Text);
        Assert.Equal(conflict, result.Conflicting);
        Assert.Equal(line.Bounds, result.Line.Bounds);
    }

    [Fact]
    public void UnitAndConflictArePreservedThroughRefinementAndParsing()
    {
        var result = OcrNumericRefinement.Select(new("03257H kWh", .95f), new("032514", .95f), OcrDocumentKind.DigitalElectricity);
        Assert.Equal("032514 kWh", result.Line.Text);
        var proposal = OcrFieldParser.Parse(new([new("123 kWh", .99f)], "synthetic", ["conflicting_reading"]), OcrDocumentKind.DigitalElectricity);
        Assert.Empty(proposal.ProposedFields);
        Assert.True(proposal.IsFallback);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void LcdNormalizationPreservesQuantityAndNormalizesPolarity(bool inverted)
    {
        using var image = new Mat(70, 350, MatType.CV_8UC3, Scalar.All(inverted ? 50 : 150));
        Cv2.PutText(image, "03251.4", new Point(10, 48), HersheyFonts.HersheySimplex, 1,
            Scalar.All(inverted ? 150 : 50), 2);
        using var binary = OcrNumericRefinement.Binarize(image);
        Assert.Equal(image.Size(), binary.Size());
        using var gray = new Mat();
        Cv2.CvtColor(binary, gray, ColorConversionCodes.BGR2GRAY);
        Assert.InRange((double)Cv2.CountNonZero(gray) / gray.Total(), .6, .99);
    }
}
