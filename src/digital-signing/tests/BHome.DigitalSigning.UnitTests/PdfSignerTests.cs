using BHome.DigitalSigning.Application;
using BHome.DigitalSigning.Infrastructure.Pdf;
using iText.Kernel.Pdf;
using iText.Signatures;

namespace BHome.DigitalSigning.UnitTests;

public sealed class PdfSignerTests
{
    private readonly ITextPdfSigner signer = new(new PdfAppearanceOptions());

    [Fact]
    public void TwoPhasesProduceAValidSignatureCoveringTheWholeDocument()
    {
        using var ca = new FakeCa();
        var prepared = signer.Prepare(Pdfs.Simple(), ca.Chain, DateTimeOffset.UtcNow, null);

        var signed = signer.Complete(prepared.PreparedPdf, prepared.FieldName, prepared.DocumentDigest, ca.Chain,
            ca.Sign(prepared.DataToSignDigest));

        using var document = new PdfDocument(new PdfReader(new MemoryStream(signed)));
        var signatures = new SignatureUtil(document);
        Assert.Equal([prepared.FieldName], signatures.GetSignatureNames());
        Assert.True(signatures.SignatureCoversWholeDocument(prepared.FieldName));
        var cms = signatures.ReadSignatureData(prepared.FieldName);
        Assert.True(cms.VerifySignatureIntegrityAndAuthenticity());
        // A random serial may start with a 00 sign byte that BigInteger does not print.
        Assert.Equal(ca.Certificate.SerialNumber.TrimStart('0'), cms.GetSigningCertificate().GetSerialNumber().ToString(16),
            StringComparer.OrdinalIgnoreCase);
    }

    [Fact]
    public void VisibleSignatureIsDrawnWhereTheSignerPlacedIt()
    {
        using var ca = new FakeCa();
        var visible = new VisibleSignature(2, 0.55, 0.7, 0.4, "Ký bởi: Nguyễn Văn A\nNgày ký: 29/10/2026 10:00:00");
        var prepared = signer.Prepare(Pdfs.Simple(pages: 2), ca.Chain, DateTimeOffset.UtcNow, visible);

        var signed = signer.Complete(prepared.PreparedPdf, prepared.FieldName, prepared.DocumentDigest, ca.Chain,
            ca.Sign(prepared.DataToSignDigest));

        using var document = new PdfDocument(new PdfReader(new MemoryStream(signed)));
        var widget = Assert.Single(document.GetPage(2).GetAnnotations());
        var box = widget.GetRectangle().ToRectangle();
        var page = document.GetPage(2).GetPageSize();
        Assert.Equal(0.55 * page.GetWidth(), box.GetX(), 1);
        Assert.Equal(0.4 * page.GetWidth(), box.GetWidth(), 1);
        // Two lines at 14pt plus padding: big enough to read without zooming.
        Assert.True(box.GetHeight() >= 2 * 14);
        Assert.Empty(document.GetPage(1).GetAnnotations());
    }

    [Fact]
    public void ASignaturePictureKeepsItsProportionsOnThePage()
    {
        using var ca = new FakeCa();
        var visible = new VisibleSignature(1, 0.55, 0.75, 0.3, "Ký bởi: A", Pngs.Create(300, 100));
        var prepared = signer.Prepare(Pdfs.Simple(), ca.Chain, DateTimeOffset.UtcNow, visible);

        var signed = signer.Complete(prepared.PreparedPdf, prepared.FieldName, prepared.DocumentDigest, ca.Chain,
            ca.Sign(prepared.DataToSignDigest));

        using var document = new PdfDocument(new PdfReader(new MemoryStream(signed)));
        var box = Assert.Single(document.GetPage(1).GetAnnotations()).GetRectangle().ToRectangle();
        Assert.Equal(box.GetWidth() / 3, box.GetHeight(), 1);
        Assert.Equal(1, Pdfs.SignatureCount(signed));
    }

    [Fact]
    public void ASignatureFromAnotherKeyIsRefused()
    {
        using var ca = new FakeCa();
        using var impostor = new FakeCa("Kẻ mạo danh");
        var prepared = signer.Prepare(Pdfs.Simple(), ca.Chain, DateTimeOffset.UtcNow, null);

        Assert.Throws<InvalidSignatureException>(() => signer.Complete(prepared.PreparedPdf, prepared.FieldName,
            prepared.DocumentDigest, ca.Chain, impostor.Sign(prepared.DataToSignDigest)));
    }

    [Fact]
    public void ABoxOutsideThePageIsRefused()
    {
        using var ca = new FakeCa();
        var visible = new VisibleSignature(1, 0.8, 0.1, 0.4, "Ký bởi: A");

        Assert.Throws<ArgumentException>(() => signer.Prepare(Pdfs.Simple(), ca.Chain, DateTimeOffset.UtcNow, visible));
    }

    [Fact]
    public void AFileThatIsNotAPdfIsRefused()
    {
        using var ca = new FakeCa();

        Assert.ThrowsAny<ArgumentException>(() =>
            signer.Prepare("%PDF-1.7 not really"u8.ToArray(), ca.Chain, DateTimeOffset.UtcNow, null));
    }
}
