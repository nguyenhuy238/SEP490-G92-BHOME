using BHome.Application.Contracts;
using BHome.Infrastructure.Contracts;
using SkiaSharp;

namespace BHome.Infrastructure.UnitTests.ContractSigning;

// Tenant draws the signature with a finger (plan §6 P4, mockup "Vẽ chữ ký"); the server turns the strokes into the
// signer's picture: transparent PNG, cropped to the ink, 200 px high. A tap is not a signature.
public sealed class DrawnSignatureTests
{
    private readonly SignaturePictureGenerator generator = new();

    [Fact]
    public void StrokesBecomeATransparentPngCroppedToTheInk()
    {
        var drawing = new DrawnSignatureInput(360, 150, [
            [[20, 100], [60, 40], [90, 110], [130, 50]],
            [[150, 90], [200, 60], [260, 95], [320, 70]]
        ]);

        var png = generator.FromStrokes(drawing);

        using var bitmap = SKBitmap.Decode(png);
        Assert.Equal(200, bitmap.Height);
        Assert.Equal(0, bitmap.GetPixel(0, 0).Alpha);
        Assert.Contains(Enumerable.Range(0, bitmap.Width), x => bitmap.GetPixel(x, bitmap.Height / 2).Alpha > 0);
    }

    [Fact]
    public void ATapIsNotASignature()
    {
        var refused = Assert.Throws<ContractException>(() => generator.FromStrokes(new DrawnSignatureInput(360, 150, [[[100, 100], [101, 101]]])));
        Assert.Equal("signature_drawing_empty", refused.Code);
    }

    [Theory]
    [InlineData(400, 900)]
    [InlineData(-1, 10)]
    public void PointsOutsideThePadAreRefused(double x, double y)
    {
        var refused = Assert.Throws<ContractException>(() =>
            generator.FromStrokes(new DrawnSignatureInput(360, 150, [[[10, 10], [x, y], [50, 50], [60, 60], [70, 70]]])));
        Assert.Equal("signature_drawing_invalid", refused.Code);
    }

    [Fact]
    public void NoStrokesAreRefused()
    {
        Assert.Equal("signature_drawing_invalid", Assert.Throws<ContractException>(() => generator.FromStrokes(new DrawnSignatureInput(360, 150, []))).Code);
    }
}
