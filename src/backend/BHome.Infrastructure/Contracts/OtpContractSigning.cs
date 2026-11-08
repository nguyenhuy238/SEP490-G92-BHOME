using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.Json;
using BHome.Application.Common;
using BHome.Application.Contracts;
using BHome.Application.IdentityAccess;
using BHome.Application.Notifications;
using BHome.DigitalSigning.Application;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Distributed;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace BHome.Infrastructure.Contracts;

// The BHOME seal: the system's own certificate that seals an OTP-signed PDF so any later change is detectable. It is
// never a user's key (SRS: BHOME does not store users' private signing keys). Production loads ContractSigning:Seal;
// Development/Testing without one uses a per-process self-signed certificate, clearly named as such.
internal sealed class SigningSeal : IDisposable
{
    private readonly Lazy<X509Certificate2?> certificate;

    public SigningSeal(IOptions<ContractSigningOptions> options, IHostEnvironment environment)
    {
        certificate = new(() =>
        {
            var seal = options.Value.Seal;
            if (!string.IsNullOrWhiteSpace(seal.PfxPath))
                return new X509Certificate2(seal.PfxPath, seal.PfxPassword, X509KeyStorageFlags.Exportable | X509KeyStorageFlags.EphemeralKeySet);
            if (!environment.IsDevelopment() && !environment.IsEnvironment("Testing")) return null;
            using var key = RSA.Create(2048);
            var request = new CertificateRequest("CN=BHOME Seal (Development - not trusted), O=BHOME", key, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
            request.CertificateExtensions.Add(new X509KeyUsageExtension(X509KeyUsageFlags.DigitalSignature | X509KeyUsageFlags.NonRepudiation, true));
            using var created = request.CreateSelfSigned(DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddYears(1));
            return new X509Certificate2(created.Export(X509ContentType.Pkcs12), (string?)null, X509KeyStorageFlags.Exportable | X509KeyStorageFlags.EphemeralKeySet);
        });
    }

    private X509Certificate2 Certificate => certificate.Value ?? throw new ContractException(503, "signing_seal_not_configured");

    public IReadOnlyList<X509Certificate2> Chain => [Certificate];

    public string EncodedChain => Convert.ToBase64String(Certificate.RawData);

    // RSA PKCS#1 v1.5 over the SHA-256 of the CMS signed attributes, as ITextPdfSigner expects from any signer.
    public byte[] Sign(byte[] dataToSignDigest)
    {
        using var rsa = Certificate.GetRSAPrivateKey() ?? throw new ContractException(503, "signing_seal_not_configured");
        return rsa.SignHash(dataToSignDigest, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
    }

    public void Dispose()
    {
        if (certificate.IsValueCreated) certificate.Value?.Dispose();
    }
}

// One-time codes. Only an HMAC of the code is kept, in the distributed cache (in-memory by default, Redis when the
// deployment registers it), together with its expiry, wrong attempts and resend time. The code itself is only in the email.
internal sealed class SigningOtpChallenges(IDistributedCache cache, IOptions<ContractSigningOptions> options, IConfiguration configuration,
    IHostEnvironment environment, TimeProvider clock)
{
    private static readonly byte[] ProcessKey = RandomNumberGenerator.GetBytes(32);
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private OtpSigningOptions Options => options.Value.Otp;

    internal sealed record Challenge(string Hash, DateTimeOffset IssuedAt, DateTimeOffset ExpiresAt, int Attempts, int Issues, string MaskedEmail, bool Locked);
    internal enum Check { Valid, Wrong, Expired, Locked, Missing }

    private static string Key(Guid signatureId) => "bhome:contract-otp:" + signatureId.ToString("N");

    public async Task<(string Code, Challenge Challenge)> IssueAsync(Guid signatureId, string email, CancellationToken t)
    {
        var now = clock.GetUtcNow();
        var previous = await ReadAsync(signatureId, t);
        if (previous is { Locked: true }) throw ContractException.Conflict("otp_locked");
        if (previous is not null && now < previous.IssuedAt.AddSeconds(Options.ResendSeconds))
            throw ContractException.Conflict("otp_resend_too_soon");
        var code = RandomNumberGenerator.GetInt32(0, (int)Math.Pow(10, Options.Length)).ToString("D" + Options.Length, System.Globalization.CultureInfo.InvariantCulture);
        var challenge = new Challenge(Hash(signatureId, code), now, now.AddSeconds(Options.TtlSeconds), 0, (previous?.Issues ?? 0) + 1, Mask(email), false);
        await WriteAsync(signatureId, challenge, t);
        return (code, challenge);
    }

    public async Task<Check> VerifyAsync(Guid signatureId, string code, CancellationToken t)
    {
        var challenge = await ReadAsync(signatureId, t);
        if (challenge is null) return Check.Missing;
        if (challenge.Locked) return Check.Locked;
        if (clock.GetUtcNow() >= challenge.ExpiresAt) return Check.Expired;
        var given = Hash(signatureId, code.Trim());
        if (CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(given), Encoding.ASCII.GetBytes(challenge.Hash)))
        {
            await cache.RemoveAsync(Key(signatureId), t); // one use only
            return Check.Valid;
        }
        var attempts = challenge.Attempts + 1;
        await WriteAsync(signatureId, challenge with { Attempts = attempts, Locked = attempts >= Options.MaxAttempts }, t);
        return attempts >= Options.MaxAttempts ? Check.Locked : Check.Wrong;
    }

    public async Task<Challenge?> ReadAsync(Guid signatureId, CancellationToken t)
    {
        var json = await cache.GetStringAsync(Key(signatureId), t);
        return json is null ? null : JsonSerializer.Deserialize<Challenge>(json, Json);
    }

    public int ResendAfterSeconds(Challenge challenge) =>
        Math.Max(0, (int)Math.Ceiling((challenge.IssuedAt.AddSeconds(Options.ResendSeconds) - clock.GetUtcNow()).TotalSeconds));

    // Kept an hour so the resend delay and the lock survive the code's own expiry.
    private Task WriteAsync(Guid signatureId, Challenge challenge, CancellationToken t) =>
        cache.SetStringAsync(Key(signatureId), JsonSerializer.Serialize(challenge, Json),
            new DistributedCacheEntryOptions { AbsoluteExpirationRelativeToNow = TimeSpan.FromHours(1) }, t);

    private string Hash(Guid signatureId, string code)
    {
        using var hmac = new HMACSHA256(SecretKey());
        return Convert.ToHexString(hmac.ComputeHash(Encoding.UTF8.GetBytes(signatureId.ToString("N") + ":" + code)));
    }

    private byte[] SecretKey()
    {
        var secret = Options.Secret ?? configuration["DigitalSigning:SecretKey"];
        if (!string.IsNullOrEmpty(secret) && secret.Length >= 32) return SHA256.HashData(Encoding.UTF8.GetBytes(secret + ".contract-otp.v1"));
        if (environment.IsDevelopment() || environment.IsEnvironment("Testing")) return ProcessKey;
        throw new ContractException(503, "otp_secret_not_configured");
    }

    internal static string Mask(string email)
    {
        var at = email.IndexOf('@');
        if (at <= 0) return "***";
        var name = email[..at];
        return (name.Length <= 2 ? name[..1] : name[..1] + new string('*', Math.Min(name.Length - 2, 6)) + name[^1]) + email[at..];
    }
}

// Name and email of a contract party, from the account. Compact24 keeps the display name in users.full_name.
internal sealed class SigningPartyDirectory(BHomePersistenceContext db)
{
    public async Task<(string? Email, string Name)> FindAsync(Guid userId, CancellationToken t)
    {
        var account = await db.Users.AsNoTracking().Where(u => u.Id == userId).Select(u => new { u.Email, u.UserName }).SingleOrDefaultAsync(t)
            ?? throw ContractException.Missing();
        string? fullName = null;
        if (db is Compact24DbContext)
            fullName = await db.Database.SqlQuery<string?>($"SELECT full_name AS \"Value\" FROM users WHERE id = {userId}").SingleOrDefaultAsync(t);
        var name = (fullName ?? account.UserName ?? account.Email ?? "").Trim();
        return (string.IsNullOrWhiteSpace(account.Email) ? null : account.Email.Trim(), name.Length > 60 ? name[..60] : name);
    }
}

// In-app electronic signature (SRS v1.3: "electronically sign"; Law on Electronic Transactions 2023 Art. 23(1)).
// Prepare draws the signer's picture and "Ký điện tử bởi / Ngày ký / Xác thực" in their box, Request emails a one-time
// code, Confirm checks it and seals the PDF with the BHOME seal as an incremental revision, so the other party's earlier
// signature stays valid.
internal sealed class OtpContractSigningAdapter(ICurrentUser user, IPdfSigner pdf, IContractDocumentRenderer renderer, TimeProvider clock,
    IContractSigningDocumentSource documents, SigningSeal seal, SigningOtpChallenges challenges, SigningPartyDirectory parties,
    INotificationChannelProvider channel, IHostEnvironment environment, IOptions<ContractSigningOptions> options,
    ILogger<OtpContractSigningAdapter> logger, ISignatureImageStore? pictures = null) : IContractSigningProvider
{
    private static readonly TimeSpan VietnamOffset = TimeSpan.FromHours(7);
    private Guid Actor => user.UserId ?? throw new ContractException(401, "authentication_required");

    public Task<SigningPreparation> PrepareAsync(ContractDocument document, Guid certificateId, byte[]? previousPdf, CancellationToken t)
        => PrepareAsync(document, certificateId, previousPdf, new SigningAppearance(null, true, SigningMethods.Otp), t);

    public async Task<(bool HasPicture, string SignerName)> SignerAsync(CancellationToken t)
    {
        var picture = pictures is null ? null : await pictures.FindAsync(Actor, t);
        var (_, name) = await parties.FindAsync(Actor, t);
        return (picture is not null, name);
    }

    public async Task<SigningPreparation> PrepareAsync(ContractDocument document, Guid certificateId, byte[]? previousPdf,
        SigningAppearance appearance, CancellationToken t)
    {
        // Fail before anything is stored: without an email channel or an address the code could never arrive.
        if (!channel.IsConfigured("EMAIL")) throw new ContractException(503, "otp_email_unavailable");
        var (email, name) = await parties.FindAsync(Actor, t);
        if (email is null) throw ContractException.Conflict("signer_email_required");
        var reviewed = await documents.ReadAsync(document, t);
        if (reviewed is null) await renderer.ValidateAsync(document, t);
        var source = previousPdf ?? reviewed ?? await renderer.RenderAsync(document, t);
        if (source.Length > 10 * 1024 * 1024 || source.Length < 5 || !source.AsSpan(0, 5).SequenceEqual("%PDF-"u8))
            throw ContractException.Invalid("contract_pdf_invalid");
        var now = clock.GetUtcNow();
        var placement = appearance.Placement ?? ContractSignatureSlots.Read(source, document.OwnerSignerId == Actor);
        VisibleSignature? visible = null;
        if (placement is not null)
        {
            var text = $"Ký điện tử bởi: {name}\nNgày ký: {now.ToOffset(VietnamOffset):dd/MM/yyyy HH:mm:ss}\nXác thực: mã OTP qua email";
            var picture = appearance.UsePicture && pictures is not null ? await pictures.FindAsync(Actor, t) : null;
            visible = new VisibleSignature(placement.Page, placement.X, placement.Y, placement.Width, text, picture?.Content, CaptionUnderImage: true);
        }
        PreparedSignature prepared;
        try { prepared = pdf.Prepare(source, seal.Chain, now, visible); }
        catch (ArgumentException) { throw ContractException.Invalid("signature_placement_invalid"); }
        return new(source, prepared.PreparedPdf, prepared.FieldName, Convert.ToBase64String(prepared.DocumentDigest),
            Convert.ToBase64String(prepared.DataToSignDigest), seal.EncodedChain, Actor.ToString(), ContractSigningRouter.OtpCredential);
    }

    public async Task<string> RequestAsync(ContractSignature signature, CancellationToken t)
    {
        await SendCodeAsync(signature, t);
        return "otp:" + signature.Id.ToString("N");
    }

    // The code only arrives by email; until it is typed the signature stays Pending. Too many wrong codes fail it.
    public async Task<SigningOutcome> PollAsync(ContractSignature signature, byte[] preparedPdf, CancellationToken t)
        => (await challenges.ReadAsync(signature.Id, t)) is { Locked: true } ? new("Failed") : new("Pending");

    public async Task<SigningOutcome> ConfirmAsync(ContractSignature signature, byte[] preparedPdf, string code, CancellationToken t)
    {
        if (signature.SignerUserId != Actor) throw new ContractException(403, "contract_signer_required");
        if (string.IsNullOrWhiteSpace(code) || code.Trim().Length != options.Value.Otp.Length || !code.Trim().All(char.IsAsciiDigit))
            throw ContractException.Invalid("otp_invalid_format");
        switch (await challenges.VerifyAsync(signature.Id, code, t))
        {
            case SigningOtpChallenges.Check.Wrong: throw ContractException.Invalid("otp_incorrect");
            case SigningOtpChallenges.Check.Expired or SigningOtpChallenges.Check.Missing: throw ContractException.Conflict("otp_expired");
            case SigningOtpChallenges.Check.Locked: return new("Failed");
        }
        var raw = seal.Sign(Convert.FromBase64String(signature.DataToSignDigest));
        try
        {
            var signed = pdf.Complete(preparedPdf, signature.FieldName, Convert.FromBase64String(signature.DocumentDigest), seal.Chain, raw);
            return new("Signed", signed);
        }
        catch (Exception e) when (e is InvalidSignatureException or CryptographicException or ArgumentException or InvalidOperationException)
        {
            return new("Failed");
        }
    }

    public async Task<SigningOtpView> ResendAsync(ContractSignature signature, CancellationToken t)
    {
        if (signature.SignerUserId != Actor) throw new ContractException(403, "contract_signer_required");
        return await SendCodeAsync(signature, t);
    }

    public async Task<SigningOtpView?> ChallengeAsync(ContractSignature signature, CancellationToken t)
    {
        var challenge = await challenges.ReadAsync(signature.Id, t);
        return challenge is null ? null : View(signature, challenge);
    }

    private async Task<SigningOtpView> SendCodeAsync(ContractSignature signature, CancellationToken t)
    {
        var (email, _) = await parties.FindAsync(signature.SignerUserId, t);
        if (email is null) throw ContractException.Conflict("signer_email_required");
        var (code, challenge) = await challenges.IssueAsync(signature.Id, email, t);
        var minutes = Math.Max(1, options.Value.Otp.TtlSeconds / 60);
        var receipt = await channel.SendAsync(new ChannelMessage($"contract-otp:{signature.Id:N}:{challenge.Issues}", "EMAIL", email,
            "CONTRACT_SIGNING_OTP", $"[BHOME] Mã xác nhận ký hợp đồng: {code}",
            $"Mã xác nhận ký hợp đồng của bạn là: {code}\n\nMã có hiệu lực {minutes} phút và chỉ dùng được một lần.\n" +
            "Không chia sẻ mã này với bất kỳ ai, kể cả nhân viên BHOME.\nNếu bạn không yêu cầu ký hợp đồng, hãy bỏ qua email này."), t);
        // Sandbox email (Development) delivers nothing; an explicit Development-only switch prints the code to test locally.
        if (options.Value.Otp.DevelopmentLogCode && environment.IsDevelopment() && receipt.StartsWith("sandbox:", StringComparison.Ordinal))
            logger.LogWarning("DEVELOPMENT ONLY - contract signing OTP for signature {SignatureId}: {Code}", signature.Id, code);
        return View(signature, challenge);
    }

    private SigningOtpView View(ContractSignature signature, SigningOtpChallenges.Challenge challenge) =>
        new(signature.Id, challenge.Locked ? "Locked" : "Sent", challenge.MaskedEmail, challenge.ExpiresAt, challenges.ResendAfterSeconds(challenge));
}

// Emails the next party once a signature completes ("Bạn có hợp đồng cần ký"), and both parties once it is fully signed.
// Best effort: a delivery failure never undoes a verified signature.
internal sealed class ContractSigningNotifier(SigningPartyDirectory parties, INotificationChannelProvider channel,
    ILogger<ContractSigningNotifier> logger) : IContractSigningNotifier
{
    public async Task SignatureCompletedAsync(ContractSigningProgress progress, CancellationToken t)
    {
        if (!channel.IsConfigured("EMAIL")) return;
        var room = string.IsNullOrWhiteSpace(progress.RoomNumber) ? "" : $" phòng {progress.RoomNumber}";
        var place = string.IsNullOrWhiteSpace(progress.LocationName) ? "" : $" ({progress.LocationName})";
        if (progress.NextSignerUserId is { } next)
        {
            await SendAsync(next, $"contract-sign-invite:{progress.ContractId:N}:{next:N}", "CONTRACT_SIGNING_INVITATION",
                $"[BHOME] Bạn có hợp đồng{room} cần ký",
                $"Hợp đồng{room}{place} đã được bên kia ký và đang chờ bạn ký.\n\nMở ứng dụng BHOME, vào mục Hợp đồng để xem và ký.\n" +
                "Email này không chứa mã xác nhận. Mã chỉ được gửi khi bạn bấm Ký trong ứng dụng.", t);
            return;
        }
        foreach (var party in progress.Parties)
            await SendAsync(party, $"contract-signed:{progress.ContractId:N}:{party:N}", "CONTRACT_FULLY_SIGNED",
                $"[BHOME] Hợp đồng{room} đã được ký đủ",
                $"Hợp đồng{room}{place} đã có đủ chữ ký của các bên.\n\nBạn có thể tải bản hợp đồng đã ký trong ứng dụng BHOME.", t);
    }

    private async Task SendAsync(Guid userId, string key, string eventType, string title, string body, CancellationToken t)
    {
        try
        {
            var (email, _) = await parties.FindAsync(userId, t);
            if (email is null) return;
            await channel.SendAsync(new ChannelMessage(key, "EMAIL", email, eventType, title, body), t);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            logger.LogWarning(e, "Contract signing email {EventType} could not be sent.", eventType);
        }
    }
}
