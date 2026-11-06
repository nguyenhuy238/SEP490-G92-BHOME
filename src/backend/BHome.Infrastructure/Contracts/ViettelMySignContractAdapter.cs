using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using BHome.Application.Common;
using BHome.Application.Contracts;
using BHome.Application.IdentityAccess;
using BHome.DigitalSigning.Application;
using BHome.DigitalSigning.Domain;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;

namespace BHome.Infrastructure.Contracts;

internal sealed class ViettelMySignContractAdapter(BHomePersistenceContext db, ICurrentUser user, ISigningProvider remote,
    IPdfSigner pdf, IContractDocumentRenderer renderer, TimeProvider clock, IContractSigningDocumentSource documents,
    ISignatureImageStore? pictures = null) : IContractSigningProvider
{
    private static readonly TimeSpan VietnamOffset = TimeSpan.FromHours(7);

    public Task<SigningPreparation> PrepareAsync(ContractDocument document, Guid certificateId, byte[]? previousPdf, CancellationToken t)
        => PrepareAsync(document, certificateId, previousPdf, new SigningAppearance(null, true), t);

    public async Task<(bool HasPicture, string SignerName)> SignerAsync(CancellationToken t)
    {
        var id = user.UserId ?? throw ContractException.Missing();
        var picture = pictures is null ? null : await pictures.FindAsync(id, t);
        var certificate = await db.Set<SigningCertificate>().AsNoTracking().Where(c => c.OwnerUserId == id && !c.Locked)
            .OrderByDescending(c => c.CreatedAt).FirstOrDefaultAsync(t);
        return (picture is not null, certificate is null ? "" : CommonName(certificate.Subject));
    }

    public async Task<SigningPreparation> PrepareAsync(ContractDocument document, Guid certificateId, byte[]? previousPdf,
        SigningAppearance appearance, CancellationToken t)
    {
        var certificate = await db.Set<SigningCertificate>().AsNoTracking().SingleOrDefaultAsync(c => c.Id == certificateId, t);
        if (certificate is null || certificate.OwnerUserId != user.UserId || certificate.Provider != SigningProviders.ViettelMySign)
            throw ContractException.Missing();
        if (certificate.Locked || !certificate.IsValidAt(clock.GetUtcNow())) throw ContractException.Conflict("signing_certificate_not_valid");
        var reviewed = await documents.ReadAsync(document, t);
        if (reviewed is null) await renderer.ValidateAsync(document, t);
        try
        {
            var credentials = await remote.ListCredentialsAsync(certificate.ProviderUserId, certificate.SerialNumber, t);
            var credential = credentials.SingleOrDefault(c => c.CredentialId == certificate.CredentialId)
                ?? throw ContractException.Conflict("signing_certificate_no_longer_available");
            var source = previousPdf ?? reviewed ?? await renderer.RenderAsync(document, t);
            if (source.Length > 10 * 1024 * 1024 || source.Length < 5 || !source.AsSpan(0, 5).SequenceEqual("%PDF-"u8))
                throw ContractException.Invalid("contract_pdf_invalid");
            // Incremental signing: the second signer signs the first signer's complete PDF.
            var now = clock.GetUtcNow();
            var visible = await VisibleAsync(document, source, credential.Certificate, now, appearance, t);
            PreparedSignature prepared;
            try { prepared = pdf.Prepare(source, credential.Chain, now, visible); }
            catch (ArgumentException) { throw ContractException.Invalid("signature_placement_invalid"); }
            return new(source, prepared.PreparedPdf, prepared.FieldName, Convert.ToBase64String(prepared.DocumentDigest),
                Convert.ToBase64String(prepared.DataToSignDigest), string.Join('\n', credential.Chain.Select(c => Convert.ToBase64String(c.RawData))),
                certificate.ProviderUserId, credential.CredentialId);
        }
        catch (SigningProviderException) { throw new IntegrationUnavailableException("Viettel MySign"); }
    }
    // The box shows "Ký bởi: <certificate name> / Ngày ký: <Vietnam time>", under the signer's picture when they saved one.
    // Without a chosen placement it goes in the signer's own box of the signature block; a PDF without that block
    // (rendered before it existed) is signed invisibly, as before.
    private async Task<VisibleSignature?> VisibleAsync(ContractDocument document, byte[] source, X509Certificate2 signer,
        DateTimeOffset now, SigningAppearance appearance, CancellationToken t)
    {
        var placement = appearance.Placement ?? ContractSignatureSlots.Read(source, document.OwnerSignerId == user.UserId);
        if (placement is null) return null;
        var text = $"Ký bởi: {CommonName(signer.Subject)}\nNgày ký: {now.ToOffset(VietnamOffset):dd/MM/yyyy HH:mm:ss}";
        var picture = appearance.UsePicture && pictures is not null && user.UserId is { } id ? await pictures.FindAsync(id, t) : null;
        return new VisibleSignature(placement.Page, placement.X, placement.Y, placement.Width, text, picture?.Content, CaptionUnderImage: true);
    }

    internal static string CommonName(string subject)
    {
        string name;
        try
        {
            name = new X500DistinguishedName(subject).Format(true).Split('\n').Select(p => p.Trim())
                .FirstOrDefault(p => p.StartsWith("CN=", StringComparison.OrdinalIgnoreCase))?[3..] ?? subject;
        }
        catch (CryptographicException) { name = subject; }
        name = name.Trim();
        return name.Length > 60 ? name[..60] : name;
    }

    public async Task<string> RequestAsync(ContractSignature signature, CancellationToken t)
    {
        try
        {
            return await remote.RequestSignatureAsync(new(signature.ProviderUserId, signature.CredentialId,
                Convert.FromBase64String(signature.DataToSignDigest), "bhome-contract-" + signature.Id.ToString("N"), "Ky hop dong BHOME"), t);
        }
        catch (SigningProviderException) { throw new IntegrationUnavailableException("Viettel MySign"); }
    }
    public async Task<SigningOutcome> PollAsync(ContractSignature signature, byte[] preparedPdf, CancellationToken t)
    {
        try
        {
            var status = await remote.GetStatusAsync(signature.ProviderUserId, signature.ProviderReference!, t);
            if (status is SignStatus.Signed signed)
            {
                var chain = signature.CertificateChain.Split('\n').Select(c => new X509Certificate2(Convert.FromBase64String(c))).ToArray();
                try
                {
                    var result = pdf.Complete(preparedPdf, signature.FieldName, Convert.FromBase64String(signature.DocumentDigest), chain, signed.RawSignature);
                    return new("Signed", result); // Complete must verify the embedded CMS and PDF byte ranges.
                }
                finally { foreach (var c in chain) c.Dispose(); }
            }
            return new(status is SignStatus.Rejected or SignStatus.Expired or SignStatus.Failed ? "Failed" : "Pending");
        }
        catch (SigningProviderException) { throw new IntegrationUnavailableException("Viettel MySign status"); }
        catch (Exception e) when (e is InvalidSignatureException or CryptographicException or ArgumentException or InvalidOperationException)
        { return new("Failed"); }
    }
}

internal sealed class UnconfiguredContractHoldingLedger : IContractHoldingLedger
{
    public Task<HoldingDepositApplication> ApplyAsync(Guid holdingContractId, Guid mainContractId, Guid roomId, Guid tenantUserId, decimal requiredDeposit, CancellationToken t)
        => throw new IntegrationUnavailableException("BF-03A holding-contract allocation ledger");
}
