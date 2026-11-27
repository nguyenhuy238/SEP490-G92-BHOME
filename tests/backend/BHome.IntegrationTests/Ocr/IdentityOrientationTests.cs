using BHome.Application.Ocr;
using BHome.Infrastructure.Ocr;
using OpenCvSharp;

namespace BHome.IntegrationTests.Ocr;

public sealed class IdentityOrientationTests
{
    [Fact]
    public void AConfidentNumberOrMrzCannotDetermineTextDirection()
    {
        Assert.False(IdentityOrientation.Reliable(new("000000000000", .99f)));
        Assert.False(IdentityOrientation.Reliable(new("IDVNM000000000000<<<<", .99f)));
        Assert.False(IdentityOrientation.PreferReversed(new("000000000000", .5f), new("000000000000", .99f)));
    }

    [Fact]
    public void ReversalRequiresClearAlphabeticEvidenceAndAMargin()
    {
        Assert.True(IdentityOrientation.Reliable(new("Họ và tên / Full name", .98f)));
        Assert.True(IdentityOrientation.PreferReversed(new("unreadable", .6f), new("Họ và tên", .97f)));
        Assert.False(IdentityOrientation.PreferReversed(new("Full name", .9f), new("Họ và tên", .95f)));
        Assert.False(IdentityOrientation.PreferReversed(new("unreadable", .3f), new("Họ và tên", .7f)));
    }

    [Fact]
    public void OrientationProbeDoesNotUseShortNumbersOrOverwideMrz()
    {
        var label = new RotatedRect(new(500, 300), new(300, 30), 0);
        var number = new RotatedRect(new(600, 200), new(250, 50), 0);
        var mrz = new RotatedRect(new(600, 700), new(1300, 60), 0);
        Assert.Equal(label, IdentityOrientation.Probe([number, mrz, label]));
        Assert.Null(IdentityOrientation.Probe([number, mrz]));
    }
}
