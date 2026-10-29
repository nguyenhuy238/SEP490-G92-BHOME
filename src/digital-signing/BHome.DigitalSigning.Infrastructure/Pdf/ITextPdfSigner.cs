using System.Security.Cryptography;
using BHome.DigitalSigning.Application;
using iText.Bouncycastle.X509;
using iText.Commons.Bouncycastle.Cert;
using iText.Forms.Form.Element;
using iText.IO.Font;
using iText.IO.Image;
using iText.Kernel.Colors;
using iText.Kernel.Crypto;
using iText.Commons.Exceptions;
using iText.Kernel.Font;
using iText.Kernel.Geom;
using iText.Kernel.Pdf;
using iText.Signatures;
using Org.BouncyCastle.X509;
using SystemCertificate = System.Security.Cryptography.X509Certificates.X509Certificate2;

namespace BHome.DigitalSigning.Infrastructure.Pdf;

// PAdES-BASELINE-B deferred signing with iText. Phase 1 writes the signature field and a blank /Contents placeholder in
// an incremental update, hashes the signed byte ranges and builds the CMS signed attributes (CAdES: content type,
// message digest, signing-certificate-v2). Their SHA-256 is what Viettel signs. Phase 2 rebuilds the very same
// attributes (they are deterministic: no signing-time attribute, the date lives in the PDF /M entry), wraps Viettel's
// raw signature into the CMS and writes it into the placeholder. The prepared PDF is kept between the phases, so
// nothing has to be re-derived bit for bit.
internal sealed class ITextPdfSigner(PdfAppearanceOptions options) : IPdfSigner
{
    // Bytes reserved for the CMS: signature, signer certificate and its chain, with room to spare.
    private const int EstimatedSize = 32_768;
    private const float Padding = 6f;

    private static readonly Lazy<byte[]> FontBytes = new(LoadFont);

    public PreparedSignature Prepare(byte[] pdf, IReadOnlyList<SystemCertificate> chain, DateTimeOffset signingDate,
        VisibleSignature? visible)
    {
        if (chain.Count == 0) throw new ArgumentException("The certificate chain is empty.", nameof(chain));
        var fieldName = "BHomeSignature_" + Guid.NewGuid().ToString("N")[..12];
        using var output = new MemoryStream();
        var container = new DigestCapturingContainer();
        try
        {
            var signer = new PdfSigner(new PdfReader(new MemoryStream(pdf)), output, new StampingProperties().UseAppendMode());
            var properties = new SignerProperties()
                .SetFieldName(fieldName)
                .SetClaimedSignDate(signingDate.UtcDateTime)
                .SetSignatureCreator("BHome");
            if (visible is not null) Place(signer.GetDocument(), properties, visible);
            signer.SetSignerProperties(properties);
            signer.SignExternalContainer(container, EstimatedSize);
        }
        catch (ITextException unreadable)
        {
            throw new ArgumentException("Tệp không đọc được như một PDF hợp lệ.", nameof(pdf), unreadable);
        }

        var documentDigest = container.Digest ?? throw new InvalidOperationException("The byte ranges were not hashed.");
        var attributes = NewCms(chain).GetAuthenticatedAttributeBytes(documentDigest, PdfSigner.CryptoStandard.CADES, null, null);
        return new PreparedSignature(output.ToArray(), fieldName, documentDigest, SHA256.HashData(attributes));
    }

    public byte[] Complete(byte[] preparedPdf, string fieldName, byte[] documentDigest, IReadOnlyList<SystemCertificate> chain,
        byte[] rawSignature)
    {
        var cms = NewCms(chain);
        cms.SetExternalSignatureValue(rawSignature, null, EncryptionAlgorithm(chain[0]));
        var encoded = cms.GetEncodedPKCS7(documentDigest, PdfSigner.CryptoStandard.CADES, null, null, null);

        byte[] signed;
        try
        {
            using var output = new MemoryStream();
            using (var reader = new PdfReader(new MemoryStream(preparedPdf)))
            {
                PdfSigner.SignDeferred(reader, fieldName, output, new FixedContainer(encoded));
            }
            signed = output.ToArray();
        }
        catch (ITextException failure)
        {
            throw new InvalidOperationException("The signature could not be written into the prepared PDF.", failure);
        }
        Verify(signed, fieldName);
        return signed;
    }

    // Refuses a signature that does not match the certificate or the document, before anyone keeps the file.
    private static void Verify(byte[] signed, string fieldName)
    {
        using var document = new PdfDocument(new PdfReader(new MemoryStream(signed)));
        var signatures = new SignatureUtil(document);
        var cms = signatures.ReadSignatureData(fieldName);
        if (cms is null || !cms.VerifySignatureIntegrityAndAuthenticity())
            throw new InvalidSignatureException("chữ ký không xác minh được với chứng thư");
        if (!signatures.SignatureCoversWholeDocument(fieldName))
            throw new InvalidSignatureException("chữ ký không bao trùm toàn bộ tài liệu");
    }

    // The box: fractions of the page from its top-left turned into a PDF rectangle (origin bottom-left). With a picture
    // it is as tall as the picture's proportions ask, so a signature is never stretched; with text, tall enough for the
    // text at the configured font size. A box that leaves the page is refused rather than cut.
    private void Place(PdfDocument document, SignerProperties properties, VisibleSignature visible)
    {
        var pages = document.GetNumberOfPages();
        if (visible.Page < 1 || visible.Page > pages)
            throw new ArgumentException($"Tài liệu có {pages} trang, không có trang {visible.Page}.");
        var page = document.GetPage(visible.Page);
        if (page.GetRotation() != 0) throw new ArgumentException("Chưa hỗ trợ đặt chữ ký trên trang bị xoay.");
        var size = page.GetPageSize();

        var width = (float)(visible.Width * size.GetWidth());
        var picture = visible.Image is null ? null : ImageDataFactory.Create(visible.Image);
        var height = picture is not null
            ? width * picture.GetHeight() / picture.GetWidth()
            : visible.Text.Split('\n').Length * options.FontSize * 1.35f + 2 * Padding;
        var left = (float)(visible.X * size.GetWidth());
        var top = (float)(visible.Y * size.GetHeight());
        if (visible.Width <= 0 || visible.X < 0 || visible.Y < 0 ||
            left + width > size.GetWidth() + 0.5f || top + height > size.GetHeight() + 0.5f)
            throw new ArgumentException("Ô chữ ký nằm ngoài trang.");

        var appearance = new SignatureFieldAppearance(SignerProperties.IGNORED_ID);
        if (picture is not null)
        {
            appearance.SetContent(picture);
        }
        else
        {
            var font = PdfFontFactory.CreateFont(FontBytes.Value, PdfEncodings.IDENTITY_H,
                PdfFontFactory.EmbeddingStrategy.FORCE_EMBEDDED);
            appearance.SetContent(visible.Text);
            appearance.SetFont(font).SetFontSize(options.FontSize).SetFontColor(ColorConstants.RED);
        }
        properties
            .SetPageNumber(visible.Page)
            .SetPageRect(new Rectangle(size.GetLeft() + left, size.GetTop() - top - height, width, height))
            .SetSignatureAppearance(appearance);
    }

    private static PdfPKCS7 NewCms(IReadOnlyList<SystemCertificate> chain)
    {
        var parser = new X509CertificateParser();
        IX509Certificate[] converted = chain
            .Select(certificate => (IX509Certificate)new X509CertificateBC(parser.ReadCertificate(certificate.RawData)))
            .ToArray();
        return new PdfPKCS7(null, converted, DigestAlgorithms.SHA256, false);
    }

    private static string EncryptionAlgorithm(SystemCertificate certificate) => certificate.GetKeyAlgorithm() switch
    {
        "1.2.840.10045.2.1" => "ECDSA",
        _ => "RSA"
    };

    private static byte[] LoadFont()
    {
        using var stream = typeof(ITextPdfSigner).Assembly.GetManifestResourceStream("BHome.DigitalSigning.Tinos-Regular.ttf")
            ?? throw new InvalidOperationException("The embedded signature font is missing.");
        using var copy = new MemoryStream();
        stream.CopyTo(copy);
        return copy.ToArray();
    }

    // Phase 1: only hashes the signed byte ranges; the placeholder stays blank until phase 2.
    private sealed class DigestCapturingContainer : IExternalSignatureContainer
    {
        public byte[]? Digest { get; private set; }

        public byte[] Sign(Stream data)
        {
            Digest = SHA256.HashData(data);
            return [];
        }

        public void ModifySigningDictionary(PdfDictionary signDic)
        {
            signDic.Put(PdfName.Filter, PdfName.Adobe_PPKLite);
            signDic.Put(PdfName.SubFilter, PdfName.ETSI_CAdES_DETACHED);
        }
    }

    private sealed class FixedContainer(byte[] cms) : IExternalSignatureContainer
    {
        public byte[] Sign(Stream data) => cms;

        public void ModifySigningDictionary(PdfDictionary signDic) { }
    }
}

// FontSize: the signature box text ("Ký bởi", "Ngày ký"). 14pt by default, well above the usual 10pt.
public sealed class PdfAppearanceOptions
{
    public float FontSize { get; set; } = 14f;
}
