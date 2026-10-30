using System.Security.Cryptography.X509Certificates;

namespace BHome.DigitalSigning.Application;

// PAdES deferred signing in two phases, because the signer confirms on a phone for seconds to minutes.
public interface IPdfSigner
{
    // Phase 1: writes the signature placeholder (and the visible box, if any) and returns the hash to send to the CA.
    // Throws ArgumentException when the file is not a readable PDF or the box does not fit on the page.
    PreparedSignature Prepare(byte[] pdf, IReadOnlyList<X509Certificate2> chain, DateTimeOffset signingDate,
        VisibleSignature? visible);

    // Phase 2: embeds the CA's raw signature into the prepared PDF. Throws InvalidSignatureException when it does not verify.
    byte[] Complete(byte[] preparedPdf, string fieldName, byte[] documentDigest, IReadOnlyList<X509Certificate2> chain,
        byte[] rawSignature);
}

// DataToSignDigest is what the CA signs: SHA-256 of the CMS signed attributes, which cover DocumentDigest.
public sealed record PreparedSignature(byte[] PreparedPdf, string FieldName, byte[] DocumentDigest, byte[] DataToSignDigest);

// Page is 1-based; X, Y and Width are fractions of the page measured from its top-left. With Image (a PNG) the box
// shows the signer's picture and its height follows the picture's proportions; without, it shows Text.
public sealed record VisibleSignature(int Page, double X, double Y, double Width, string Text, byte[]? Image = null);
