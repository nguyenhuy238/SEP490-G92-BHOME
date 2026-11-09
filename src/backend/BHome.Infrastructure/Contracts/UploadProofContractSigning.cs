using System.Security.Cryptography.X509Certificates;
using BHome.Application.Contracts;
using BHome.Application.IdentityAccess;
using BHome.Domain.TenantContracts;
using iText.Commons.Exceptions;
using iText.Forms;
using iText.Kernel.Pdf;
using iText.Kernel.Pdf.Annot;
using iText.Signatures;
using Microsoft.Extensions.Options;

namespace BHome.Infrastructure.Contracts;

// UPLOAD_PROOF: the Owner downloads the issued PDF, signs it outside BHOME with their own certificate (Viettel MySign
// registered through VNeID needs no BHOME integration account) and uploads the result. Prepare keeps the issued PDF as
// the prepared document, so the upload is compared with the exact bytes the Owner received.
internal sealed class UploadProofContractSigningAdapter(ICurrentUser user, IContractDocumentRenderer renderer,
    IContractSigningDocumentSource documents, UploadedSignatureVerifier verifier) : IContractSigningProvider
{
    private Guid Actor => user.UserId ?? throw new ContractException(401, "authentication_required");

    public Task<SigningPreparation> PrepareAsync(ContractDocument document, Guid certificateId, byte[]? previousPdf, CancellationToken t)
        => PrepareAsync(document, certificateId, previousPdf, new SigningAppearance(null, false, SigningMethods.UploadProof), t);

    public async Task<SigningPreparation> PrepareAsync(ContractDocument document, Guid certificateId, byte[]? previousPdf,
        SigningAppearance appearance, CancellationToken t)
    {
        var reviewed = await documents.ReadAsync(document, t);
        if (reviewed is null) await renderer.ValidateAsync(document, t);
        var source = previousPdf ?? reviewed ?? await renderer.RenderAsync(document, t);
        if (source.Length > 10 * 1024 * 1024 || source.Length < 5 || !source.AsSpan(0, 5).SequenceEqual("%PDF-"u8))
            throw ContractException.Invalid("contract_pdf_invalid");
        return new(source, source, "", "", "", "", Actor.ToString(), ContractSigningRouter.UploadCredential);
    }

    // Nothing is sent anywhere: the signature stays Pending until the signed PDF is uploaded.
    public Task<string> RequestAsync(ContractSignature signature, CancellationToken t) => Task.FromResult("upload:" + signature.Id.ToString("N"));
    public Task<SigningOutcome> PollAsync(ContractSignature signature, byte[] preparedPdf, CancellationToken t) => Task.FromResult(new SigningOutcome("Pending"));

    public Task<SigningOutcome> CompleteUploadAsync(ContractSignature signature, byte[] issuedPdf, byte[] uploadedPdf, CancellationToken t)
    {
        if (signature.SignerUserId != Actor) throw new ContractException(403, "contract_signer_required");
        verifier.Verify(issuedPdf, uploadedPdf);
        return Task.FromResult(new SigningOutcome("Signed", uploadedPdf));
    }
}

// Accepts an uploaded PDF only when it is the issued PDF plus a valid digital signature and nothing else:
// 1. the issued bytes are unchanged at the start of the file (the signer appended an incremental revision);
// 2. at least one new signature, every signature intact, and the newest one covers the whole file;
// 3. the new signing certificate was issued by an allowed CA (default "Viettel") and was valid when it signed;
// 4. the same pages with the same page content; new annotations are signature widgets and new form fields are
//    signature fields, so text cannot be added or changed in the signer's revision.
internal sealed class UploadedSignatureVerifier(IOptions<ContractSigningOptions> options)
{
    public void Verify(byte[] issued, byte[] uploaded)
    {
        var settings = options.Value.UploadProof;
        if (uploaded.Length > settings.MaxMegabytes * 1024 * 1024) throw new ContractException(413, "signed_pdf_too_large");
        if (uploaded.Length < 5 || !uploaded.AsSpan(0, 5).SequenceEqual("%PDF-"u8)) throw ContractException.Invalid("signed_pdf_invalid");
        if (uploaded.Length <= issued.Length || !uploaded.AsSpan(0, issued.Length).SequenceEqual(issued))
            throw ContractException.Invalid("signed_pdf_not_from_issued_contract");
        try
        {
            using var before = new PdfDocument(new PdfReader(new MemoryStream(issued)));
            using var after = new PdfDocument(new PdfReader(new MemoryStream(uploaded)));
            var existing = new SignatureUtil(before).GetSignatureNames();
            var signatures = new SignatureUtil(after);
            var names = signatures.GetSignatureNames();
            var added = names.Where(n => !existing.Contains(n)).ToList();
            if (added.Count == 0) throw ContractException.Invalid("signed_pdf_has_no_new_signature");
            foreach (var name in names)
            {
                if (!signatures.ReadSignatureData(name).VerifySignatureIntegrityAndAuthenticity())
                    throw ContractException.Invalid("signed_pdf_signature_invalid");
            }
            if (!signatures.SignatureCoversWholeDocument(names[^1])) throw ContractException.Invalid("signed_pdf_changed_after_signing");
            foreach (var name in added) CheckCertificate(signatures.ReadSignatureData(name), settings.Issuers);
            CheckOnlySignaturesWereAdded(before, after);
        }
        catch (ITextException) { throw ContractException.Invalid("signed_pdf_invalid"); }
    }

    private static void CheckCertificate(PdfPKCS7 cms, IReadOnlyList<string> issuers)
    {
        using var certificate = new X509Certificate2(cms.GetSigningCertificate().GetEncoded());
        if (!issuers.Any(i => certificate.Issuer.Contains(i, StringComparison.OrdinalIgnoreCase)))
            throw ContractException.Invalid("signed_pdf_certificate_issuer_not_allowed");
        var signedAt = new DateTimeOffset(DateTime.SpecifyKind(cms.GetSignDate(), DateTimeKind.Utc));
        if (signedAt < certificate.NotBefore.ToUniversalTime() || signedAt > certificate.NotAfter.ToUniversalTime())
            throw ContractException.Invalid("signed_pdf_certificate_not_valid");
    }

    private static void CheckOnlySignaturesWereAdded(PdfDocument before, PdfDocument after)
    {
        if (before.GetNumberOfPages() != after.GetNumberOfPages()) throw ContractException.Invalid("signed_pdf_content_changed");
        for (var page = 1; page <= before.GetNumberOfPages(); page++)
        {
            var original = before.GetPage(page);
            var signed = after.GetPage(page);
            if (!original.GetContentBytes().AsSpan().SequenceEqual(signed.GetContentBytes())) throw ContractException.Invalid("signed_pdf_content_changed");
            var kept = original.GetAnnotations().Count;
            if (signed.GetAnnotations().Count < kept ||
                signed.GetAnnotations().Skip(kept).Any(a => !PdfName.Widget.Equals(a.GetSubtype())))
                throw ContractException.Invalid("signed_pdf_content_changed");
        }
        var oldFields = PdfAcroForm.GetAcroForm(before, false)?.GetAllFormFields().Keys.ToHashSet() ?? [];
        var newFields = PdfAcroForm.GetAcroForm(after, false)?.GetAllFormFields() ?? new Dictionary<string, iText.Forms.Fields.PdfFormField>();
        if (newFields.Where(f => !oldFields.Contains(f.Key)).Any(f => !PdfName.Sig.Equals(f.Value.GetFormType())))
            throw ContractException.Invalid("signed_pdf_content_changed");
    }
}
