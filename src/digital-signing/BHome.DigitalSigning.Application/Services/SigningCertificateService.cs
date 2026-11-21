using BHome.Application.IdentityAccess;
using BHome.DigitalSigning.Application.Contracts;
using BHome.DigitalSigning.Domain;

namespace BHome.DigitalSigning.Application.Services;

// A signer's own Viettel MySign certificates: declared once by subscriber id, then chosen when signing.
public sealed class SigningCertificateService(
    ICurrentUser user, ISigningCertificateStore store, ISigningProvider provider, TimeProvider clock)
{
    public async Task<IReadOnlyList<CertificateView>> MineAsync(CancellationToken cancellationToken)
    {
        var owner = SignerAccess.RequireSigner(user);
        var now = clock.GetUtcNow();
        var certificates = await store.CertificatesOfAsync(owner, cancellationToken);
        return certificates.Select(certificate => View(certificate, now)).ToList();
    }

    // Asks Viettel for the subscriber's certificate, so what is stored is what the CA actually holds.
    public async Task<CertificateView> DeclareAsync(DeclareCertificate input, CancellationToken cancellationToken)
    {
        var owner = SignerAccess.RequireSigner(user);
        var providerUserId = input.ProviderUserId?.Trim();
        if (string.IsNullOrEmpty(providerUserId) || providerUserId.Length > 100)
            throw DigitalSigningException.Invalid("Nhập mã thuê bao Viettel MySign (số CCCD, mã số thuế hoặc mã Viettel cấp).");
        var serial = string.IsNullOrWhiteSpace(input.SerialNumber) ? null : input.SerialNumber.Trim();

        IReadOnlyList<RemoteCredential> found;
        try
        {
            found = await provider.ListCredentialsAsync(providerUserId, serial, cancellationToken);
        }
        catch (SigningProviderException)
        {
            throw DigitalSigningException.ProviderUnavailable(
                "Không đọc được chứng thư từ Viettel MySign; kiểm tra mã thuê bao và tài khoản ký số.");
        }
        if (found.Count == 0)
            throw DigitalSigningException.Invalid("Viettel MySign không có chứng thư nào cho thuê bao này.");
        if (serial is null && found.Count > 1)
            throw DigitalSigningException.Invalid(
                "Thuê bao có nhiều chứng thư; nhập số serial của chứng thư muốn dùng: " +
                string.Join(", ", found.Select(credential => credential.SerialNumber)) + ".");

        var credential = found[0];
        var now = clock.GetUtcNow();
        var certificate = credential.Certificate;
        if (new DateTimeOffset(certificate.NotAfter.ToUniversalTime()) <= now)
            throw DigitalSigningException.Invalid("Chứng thư này đã hết hạn.");

        // A certificate belongs to one holder: declaring it again for the same person is harmless, for anyone else refused.
        var existing = await store.CertificateAsync(provider.Code, credential.SerialNumber, cancellationToken);
        if (existing is not null)
        {
            if (existing.OwnerUserId != owner)
                throw DigitalSigningException.Conflict("Chứng thư này đã được người khác khai báo.");
            return View(existing, now);
        }

        var row = new SigningCertificate
        {
            Id = Guid.NewGuid(),
            OwnerUserId = owner,
            Provider = provider.Code,
            ProviderUserId = providerUserId,
            CredentialId = credential.CredentialId,
            SerialNumber = credential.SerialNumber,
            Subject = Limited(certificate.Subject),
            Issuer = Limited(certificate.Issuer),
            ValidFrom = new DateTimeOffset(certificate.NotBefore.ToUniversalTime()),
            ValidTo = new DateTimeOffset(certificate.NotAfter.ToUniversalTime()),
            CreatedAt = now
        };
        await store.AddCertificateAsync(row, cancellationToken);
        return View(row, now);
    }

    public async Task RemoveAsync(Guid id, CancellationToken cancellationToken)
    {
        await OwnAsync(id, cancellationToken);
        await store.RemoveCertificateAsync(id, cancellationToken);
    }

    // A locked certificate stays declared but signs nothing until unlocked (lost phone, suspected misuse).
    public async Task LockAsync(Guid id, bool locked, CancellationToken cancellationToken)
    {
        await OwnAsync(id, cancellationToken);
        await store.SetLockedAsync(id, locked, cancellationToken);
    }

    private async Task<SigningCertificate> OwnAsync(Guid id, CancellationToken cancellationToken)
    {
        var owner = SignerAccess.RequireSigner(user);
        var certificate = await store.CertificateAsync(id, cancellationToken);
        // Somebody else's certificate answers as missing, so ids cannot be probed.
        if (certificate is null || certificate.OwnerUserId != owner) throw DigitalSigningException.NotFound("chứng thư số");
        return certificate;
    }

    internal static CertificateView View(SigningCertificate certificate, DateTimeOffset now) => new(
        certificate.Id, certificate.Provider, SignerAccess.Tail(certificate.ProviderUserId), certificate.SerialNumber,
        certificate.Subject, certificate.Issuer, certificate.ValidFrom, certificate.ValidTo, certificate.Locked,
        !certificate.Locked && certificate.IsValidAt(now));

    private static string Limited(string value) => value.Length <= 1000 ? value : value[..1000];
}
