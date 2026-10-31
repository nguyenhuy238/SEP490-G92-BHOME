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

internal sealed class ViettelMySignContractAdapter(BHomeDbContext db, ICurrentUser user, ISigningProvider remote,
    IPdfSigner pdf, IContractDocumentRenderer renderer, TimeProvider clock) : IContractSigningProvider
{
    public async Task<SigningPreparation> PrepareAsync(ContractDocument document, Guid certificateId, byte[]? previousPdf, CancellationToken t)
    {
        var certificate = await db.Set<SigningCertificate>().AsNoTracking().SingleOrDefaultAsync(c => c.Id == certificateId, t);
        if (certificate is null || certificate.OwnerUserId != user.UserId || certificate.Provider != SigningProviders.ViettelMySign)
            throw ContractException.Missing();
        if (certificate.Locked || !certificate.IsValidAt(clock.GetUtcNow())) throw ContractException.Conflict("signing_certificate_not_valid");
        try
        {
            var credentials = await remote.ListCredentialsAsync(certificate.ProviderUserId, certificate.SerialNumber, t);
            var credential = credentials.SingleOrDefault(c => c.CredentialId == certificate.CredentialId)
                ?? throw ContractException.Conflict("signing_certificate_no_longer_available");
            var source = previousPdf ?? await renderer.RenderAsync(document, t);
            if (source.Length > 10 * 1024 * 1024 || source.Length < 5 || !source.AsSpan(0, 5).SequenceEqual("%PDF-"u8))
                throw ContractException.Invalid("contract_pdf_invalid");
            // Incremental signing: the second signer signs the first signer's complete PDF.
            var prepared = pdf.Prepare(source, credential.Chain, clock.GetUtcNow(), null);
            return new(source, prepared.PreparedPdf, prepared.FieldName, Convert.ToBase64String(prepared.DocumentDigest),
                Convert.ToBase64String(prepared.DataToSignDigest), string.Join('\n', credential.Chain.Select(c => Convert.ToBase64String(c.RawData))),
                certificate.ProviderUserId, credential.CredentialId);
        }
        catch (SigningProviderException) { throw new IntegrationUnavailableException("Viettel MySign"); }
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

internal sealed class ContractMySignAccount(IConfiguration config) : IViettelAccountSource
{
    public Task<ViettelAccount> CurrentAsync(CancellationToken t)
    {
        var c = config.GetSection("DigitalSigning:Viettel");
        var timeout = c.GetValue<int?>("TimeoutSeconds") ?? 15;
        if (timeout is < 1 or > 120) throw new IntegrationUnavailableException("Viettel timeout configuration");
        var account = new ViettelAccount(c["BaseUrl"], c["ClientId"], c["ClientSecret"], c["ProfileId"],
            c["LoginPath"] ?? "/vtss/service/ras/v1/login", c["CredentialsPath"] ?? "/adss/service/ras/csc/v1/credentials/list",
            c["SignHashPath"] ?? "/vtss/service/signHash", c["StatusPath"] ?? "/vtss/service/requests/status", timeout);
        if (account.IsConfigured && (!Uri.TryCreate(account.BaseUrl, UriKind.Absolute, out var url) || url.Scheme != "https"))
            throw new IntegrationUnavailableException("Viettel HTTPS configuration");
        return Task.FromResult(account);
    }
}

internal sealed class UnconfiguredContractRenderer : IContractDocumentRenderer
{
    public Task<byte[]> RenderAsync(ContractDocument document, CancellationToken t)
        => throw new ContractException(503, "contract_template_not_configured");
}
internal sealed class PendingContractSettlementLedger : IContractSettlementLedger
{
    public Task<SettlementLedgerState?> ReadAsync(Guid contractId, Guid electricityReadingId, Guid waterReadingId, CancellationToken t)
        => Task.FromResult<SettlementLedgerState?>(null);
}
internal sealed class UnconfiguredContractHoldingLedger : IContractHoldingLedger
{
    public Task<HoldingDepositApplication> ApplyAsync(Guid holdingContractId, Guid mainContractId, Guid roomId, Guid tenantUserId, decimal requiredDeposit, CancellationToken t)
        => throw new IntegrationUnavailableException("BF-03A holding-contract allocation ledger");
}
