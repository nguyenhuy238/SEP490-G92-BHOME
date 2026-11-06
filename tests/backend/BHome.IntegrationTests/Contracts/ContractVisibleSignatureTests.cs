using BHome.Application.Contracts;
using BHome.DigitalSigning.Application;
using BHome.Infrastructure.Contracts;
using iText.Kernel.Pdf;
using iText.Signatures;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests.Contracts;

// Visible remote signatures on the contract: each party's box in the signature block, the signer's picture above
// "Ký bởi / Ngày ký", both signatures still valid, and the page pictures a signer places the box on.
public sealed class ContractVisibleSignatureTests
{
    [Fact]
    public async Task SIGN02_BothPartiesSignVisiblyInTheirOwnBoxWithAGeneratedPicture()
    {
        using var backend = ContractPdfRendererTests.Backend();
        using var scope = backend.CreateScope();
        var renderer = scope.ServiceProvider.GetRequiredService<IContractDocumentRenderer>();
        var pages = backend.GetRequiredService<IContractSigningPages>();
        var signer = backend.GetRequiredService<IPdfSigner>();
        var picture = backend.GetRequiredService<SignaturePictureGenerator>().FromName("Nguyễn Quang Huy");
        using var remote = new SyntheticRemoteSigningProvider();
        var bytes = await renderer.RenderAsync(ContractPdfRendererTests.Snapshot(), default);

        var owner = pages.Inspect(bytes, owner: true);
        var tenant = pages.Inspect(bytes, owner: false);
        Assert.NotNull(owner.Suggested);
        Assert.NotNull(tenant.Suggested);
        Assert.Equal(owner.Pages.Count, owner.Suggested!.Page);
        Assert.Equal(owner.Suggested.Page, tenant.Suggested!.Page);
        Assert.True(owner.Suggested.X + owner.Suggested.Width <= tenant.Suggested.X, "Bên A và Bên B không được chồng lên nhau");
        Assert.True(picture.AsSpan(1, 3).SequenceEqual("PNG"u8));

        foreach (var (subscriber, slot) in new[] { ("SYNTHETIC-OWNER", owner.Suggested), ("SYNTHETIC-TENANT", tenant.Suggested) })
        {
            var credential = Assert.Single(await remote.ListCredentialsAsync(subscriber, null, default));
            var visible = new VisibleSignature(slot.Page, slot.X, slot.Y, slot.Width,
                "Ký bởi: " + subscriber + "\nNgày ký: 06/11/2026 10:00:00", picture, CaptionUnderImage: true);
            var prepared = signer.Prepare(bytes, credential.Chain, DateTimeOffset.UtcNow, visible);
            var reference = await remote.RequestSignatureAsync(new(subscriber, credential.CredentialId,
                prepared.DataToSignDigest, Guid.NewGuid().ToString(), "Synthetic visible signature"), default);
            var signed = Assert.IsType<SignStatus.Signed>(await remote.GetStatusAsync(subscriber, reference, default));
            bytes = signer.Complete(prepared.PreparedPdf, prepared.FieldName, prepared.DocumentDigest, credential.Chain, signed.RawSignature);
        }

        using var pdf = new PdfDocument(new PdfReader(new MemoryStream(bytes)));
        var signatures = new SignatureUtil(pdf);
        var fields = signatures.GetSignatureNames();
        Assert.Equal(2, fields.Count);
        Assert.All(fields, name => Assert.True(signatures.ReadSignatureData(name).VerifySignatureIntegrityAndAuthenticity()));
        Assert.True(signatures.SignatureCoversWholeDocument(fields[^1]));
        var form = iText.Forms.PdfAcroForm.GetAcroForm(pdf, false);
        foreach (var name in fields)
        {
            var widget = form.GetField(name).GetWidgets()[0];
            Assert.True(widget.GetRectangle().ToRectangle().GetWidth() > 50, "chữ ký phải hiển thị trên trang");
            Assert.Equal(owner.Suggested.Page, pdf.GetPageNumber(widget.GetPage()));
        }
        // The slots survive both incremental updates, so the second signer's suggestion still reads from the signed PDF.
        Assert.Equal(tenant.Suggested, ContractSignatureSlots.Read(bytes, owner: false));

        var png = pages.RenderPage(bytes, owner.Suggested.Page, 600);
        Assert.True(png.AsSpan(1, 3).SequenceEqual("PNG"u8));
        Assert.Equal(600, System.Buffers.Binary.BinaryPrimitives.ReadInt32BigEndian(png.AsSpan(16, 4)));
        Assert.Throws<ContractException>(() => pages.RenderPage(bytes, owner.Pages.Count + 1, 600));
    }

    [Fact]
    public void SIGN03_GeneratedPictureIsATransparentPngAndRejectsUnusableNames()
    {
        var generator = new SignaturePictureGenerator();
        var png = generator.FromName("Trần Thị Bích");
        Assert.True(png.AsSpan(1, 3).SequenceEqual("PNG"u8));
        Assert.Equal(6, png[25]); // colour type 6: RGBA, so the picture sits over the page text
        Assert.Equal(400, Assert.Throws<ContractException>(() => generator.FromName("A")).Status);
        Assert.Equal(400, Assert.Throws<ContractException>(() => generator.FromName("Tên\u0007lạ")).Status);
    }

    [Fact]
    public void SIGN04_PlacementOutsideThePageIsRefusedBeforeAnythingIsSent()
    {
        Assert.False(new SignaturePlacementInput(0, 0.1, 0.1, 0.3).IsValid);
        Assert.False(new SignaturePlacementInput(1, 0.8, 0.1, 0.3).IsValid);
        Assert.False(new SignaturePlacementInput(1, 0.1, 1.2, 0.3).IsValid);
        Assert.False(new SignaturePlacementInput(1, 0.1, 0.1, 0.01).IsValid);
        Assert.True(new SignaturePlacementInput(2, 0.55, 0.7, 0.35).IsValid);
    }
}
