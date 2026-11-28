using BHome.Application.Ocr;
using BHome.Infrastructure.Ocr;
using OpenCvSharp;
using QRCoder;

namespace BHome.IntegrationTests.Ocr;

public sealed class IdentityRegionRecoveryTests
{
    [Fact]
    public void LocalQrDecoderReadsSyntheticUtf8WithoutNetworkOrFileWrites()
    {
        using var code = QRCodeGenerator.GenerateQrCode("000000001234||NGƯỜI THỬ NGHIỆM|12032001|Nam|Xã Giả Lập|14062023", QRCodeGenerator.ECCLevel.Q);
        using var png = new PngByteQRCode(code);
        using var image = Cv2.ImDecode(png.GetGraphic(6), ImreadModes.Color);
        var fields = IdentityQrReader.Read(image);
        Assert.Equal("NGƯỜI THỬ NGHIỆM", fields.Single(field => field.Field == "fullName").Value);
    }

    [Fact]
    public void RecoveryOnlySchedulesMissingOrUncertainFieldCropsWithinTheCard()
    {
        var fields = IdentityOcrEvidence.FrontFields.ToDictionary(field => field, _ => "synthetic");
        var confidence = fields.ToDictionary(field => field.Key, _ => .99f);
        var proposal = new OcrProposal(fields, "synthetic") { Confidence = confidence };
        Assert.Empty(IdentityFieldRegions.MissingOrUncertain(proposal, new(1200, 750), OcrDocumentKind.IdentityFront));
        fields.Remove("fullName"); confidence["residentialAddress"] = .7f;
        var targets = IdentityFieldRegions.MissingOrUncertain(proposal, new(1200, 750), OcrDocumentKind.IdentityFront).ToArray();
        Assert.Equal(new[] { "fullName", "residentialAddress" }, targets.Select(target => target.Field));
        Assert.All(targets, target =>
        {
            Assert.InRange(target.Region.Left, 0, 1199);
            Assert.InRange(target.Region.Right, 1, 1200);
            Assert.InRange(target.Region.Bottom, 1, 750);
            Assert.True(target.Region.Width * target.Region.Height < 1200 * 750 / 4);
        });
    }

    [Fact]
    public void UnlocalizedBackStopsAfterIssueDateOnlyWithMrzGeometry()
    {
        var size = new Size(960, 1280);
        OcrLine[] lines = [new("Ngày, tháng, năm / Date, month, year: 14/06/2023", .99f)
        { Bounds = new(150, 430, 320, 20) }, new("synthetic text", .99f)];
        RotatedRect[] regions = [new(new(480, 690), new(560, 28), 0),
            new(new(480, 725), new(560, 28), 0), new(new(480, 760), new(560, 28), 0)];
        Assert.True(IdentityFieldRegions.Complete(OcrDocumentKind.IdentityBack, size, regions, lines));
        Assert.Equal(3, IdentityFieldRegions.MrzRows(regions, lines, size).Count);
        Assert.False(IdentityFieldRegions.Complete(OcrDocumentKind.IdentityBack, size, regions[..1], lines));
        Assert.False(IdentityFieldRegions.Complete(OcrDocumentKind.IdentityFront, size, regions, lines));
    }

    [Fact]
    public void FirstAddressLineCannotStopReadingADetectedContinuation()
    {
        OcrLine[] lines = [new("Số / No.: 000000001234", .99f), new("Họ và tên: NGƯỜI THỬ", .99f),
            new("Ngày sinh: 12/03/2001", .99f), new("Giới tính: Nam", .99f), new("Quốc tịch: Việt Nam", .99f),
            new("Quê quán: Xã Giả Lập", .99f), new("Nơi thường trú: Thôn Mẫu", .99f), new("Có giá trị đến: 12/03/2031", .99f)];
        var suffix = new RotatedRect(new(750, 710), new(650, 25), 0);
        Assert.False(IdentityFieldRegions.Complete(OcrDocumentKind.IdentityFront, new(1200, 750), [suffix], lines));
        Assert.True(IdentityFieldRegions.Complete(OcrDocumentKind.IdentityFront, new(1200, 750), [suffix],
            [.. lines, new("Xã Giả Lập", .99f) { Bounds = OcrImageGeometry.LayoutBounds(suffix, 0) }]));
    }
}
