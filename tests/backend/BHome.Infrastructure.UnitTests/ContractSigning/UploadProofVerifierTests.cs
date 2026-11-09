using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using BHome.Application.Contracts;
using BHome.DigitalSigning.Application;
using BHome.Infrastructure.Contracts;
using iText.IO.Font.Constants;
using iText.Kernel.Font;
using iText.Kernel.Pdf;
using iText.Kernel.Pdf.Canvas;
using iText.Layout;
using iText.Layout.Element;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace BHome.Infrastructure.UnitTests.ContractSigning;

// Owner signs the issued PDF outside BHOME (Viettel MySign registered through VNeID) and uploads it. Expected
// behaviour agreed on 09/11/2026: accept only the issued PDF plus a valid digital signature from a Viettel-CA
// certificate valid when it signed, with nothing else changed (SRS v1.3 UC-15, DBR-03 traceable evidence).
public sealed class UploadProofVerifierTests : IDisposable
{
    private readonly ServiceProvider services;
    private readonly IPdfSigner pdf;
    private readonly UploadedSignatureVerifier verifier = new(Options.Create(new ContractSigningOptions()));

    public UploadProofVerifierTests()
    {
        var collection = new ServiceCollection();
        BHome.DigitalSigning.Infrastructure.DependencyInjection.AddContractPdfSigning(collection);
        services = collection.BuildServiceProvider();
        pdf = services.GetRequiredService<IPdfSigner>();
    }

    public void Dispose() => services.Dispose();

    private sealed class Ca : IDisposable
    {
        public RSA Key { get; } = RSA.Create(2048);
        public X509Certificate2 Certificate { get; }
        public Ca(string subject, DateTimeOffset? notBefore = null, DateTimeOffset? notAfter = null) =>
            Certificate = new CertificateRequest(subject, Key, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1)
                .CreateSelfSigned(notBefore ?? DateTimeOffset.UtcNow.AddDays(-1), notAfter ?? DateTimeOffset.UtcNow.AddYears(1));
        public void Dispose() { Certificate.Dispose(); Key.Dispose(); }
    }

    private byte[] Sign(byte[] source, Ca ca)
    {
        X509Certificate2[] chain = [ca.Certificate];
        var prepared = pdf.Prepare(source, chain, DateTimeOffset.UtcNow, new VisibleSignature(1, 0.1, 0.7, 0.35, "Ký bởi: CHỦ TRỌ TỔNG HỢP"));
        return pdf.Complete(prepared.PreparedPdf, prepared.FieldName, prepared.DocumentDigest, chain,
            ca.Key.SignHash(prepared.DataToSignDigest, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1));
    }

    private static string Refused(Action verify) => Assert.Throws<ContractException>(verify).Code;

    [Fact]
    public void TheIssuedContractSignedWithAViettelCertificateIsAccepted()
    {
        using var owner = new Ca("CN=CHU TRO TONG HOP, O=Viettel-CA Synthetic Test");
        var issued = Contract("Hợp đồng thuê phòng P.201 – tiền thuê 3.000.000 VND/tháng");

        verifier.Verify(issued, Sign(issued, owner));
    }

    [Fact]
    public void AFileSignedFromAnotherDocumentIsRefused()
    {
        using var owner = new Ca("CN=CHU TRO TONG HOP, O=Viettel-CA Synthetic Test");
        var issued = Contract("Tiền thuê 3.000.000 VND/tháng");
        var other = Contract("Tiền thuê 1.000.000 VND/tháng");

        Assert.Equal("signed_pdf_not_from_issued_contract", Refused(() => verifier.Verify(issued, Sign(other, owner))));
    }

    [Fact]
    public void AFileWithoutANewSignatureIsRefused()
    {
        var issued = Contract("Tiền thuê 3.000.000 VND/tháng");

        Assert.Equal("signed_pdf_has_no_new_signature", Refused(() => verifier.Verify(issued, Append(issued, addText: false))));
    }

    [Fact]
    public void TextAddedBeforeSigningIsRefusedEvenIfTheSignatureIsValid()
    {
        using var owner = new Ca("CN=CHU TRO TONG HOP, O=Viettel-CA Synthetic Test");
        var issued = Contract("Tiền thuê 3.000.000 VND/tháng");

        Assert.Equal("signed_pdf_content_changed", Refused(() => verifier.Verify(issued, Sign(Append(issued, addText: true), owner))));
    }

    [Fact]
    public void ACertificateFromAnotherIssuerIsRefused()
    {
        using var stranger = new Ca("CN=Someone, O=Unknown CA");
        var issued = Contract("Tiền thuê 3.000.000 VND/tháng");

        Assert.Equal("signed_pdf_certificate_issuer_not_allowed", Refused(() => verifier.Verify(issued, Sign(issued, stranger))));
    }

    [Fact]
    public void ACertificateThatExpiredBeforeSigningIsRefused()
    {
        using var expired = new Ca("CN=CHU TRO TONG HOP, O=Viettel-CA Synthetic Test", DateTimeOffset.UtcNow.AddYears(-2), DateTimeOffset.UtcNow.AddYears(-1));
        var issued = Contract("Tiền thuê 3.000.000 VND/tháng");

        Assert.Equal("signed_pdf_certificate_not_valid", Refused(() => verifier.Verify(issued, Sign(issued, expired))));
    }

    [Fact]
    public void AFileChangedAfterSigningIsRefused()
    {
        using var owner = new Ca("CN=CHU TRO TONG HOP, O=Viettel-CA Synthetic Test");
        var issued = Contract("Tiền thuê 3.000.000 VND/tháng");
        var signed = Sign(issued, owner);

        var appended = Append(signed, addText: true);

        Assert.StartsWith("signed_pdf_", Refused(() => verifier.Verify(issued, appended)));
    }

    [Fact]
    public void AFileThatIsNotAPdfIsRefused()
    {
        var issued = Contract("Tiền thuê 3.000.000 VND/tháng");

        Assert.Equal("signed_pdf_invalid", Refused(() => verifier.Verify(issued, "not a pdf at all"u8.ToArray())));
    }

    private static byte[] Contract(string text)
    {
        using var output = new MemoryStream();
        using (var document = new PdfDocument(new PdfWriter(output)))
        using (var layout = new Document(document))
            layout.Add(new Paragraph(text));
        return output.ToArray();
    }

    // An incremental revision that either only edits metadata or also writes text on page 1.
    private static byte[] Append(byte[] source, bool addText)
    {
        using var output = new MemoryStream();
        using (var document = new PdfDocument(new PdfReader(new MemoryStream(source)), new PdfWriter(output), new StampingProperties().UseAppendMode()))
        {
            document.GetDocumentInfo().SetMoreInfo("Edited", "yes");
            if (addText)
            {
                var page = document.GetPage(1);
                new PdfCanvas(page.NewContentStreamAfter(), page.GetResources(), document).BeginText()
                    .SetFontAndSize(PdfFontFactory.CreateFont(StandardFonts.HELVETICA), 12).MoveText(50, 50).ShowText("Rent: 1 VND").EndText();
            }
        }
        return output.ToArray();
    }
}
