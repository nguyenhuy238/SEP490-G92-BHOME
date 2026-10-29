using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using BHome.Application.IdentityAccess;
using BHome.DigitalSigning.Application.Contracts;
using BHome.DigitalSigning.Domain;

namespace BHome.DigitalSigning.Application.Services;

// Remote signing of one PDF with the signer's Viettel MySign certificate, in two phases:
//  1. StartAsync: the PDF gets its signature placeholder, only the hash goes to Viettel, the attempt is kept as pending
//     and Viettel pushes a confirmation to the signer's MySign app.
//  2. StatusAsync (the screen asks every few seconds): once Viettel has the signature it is embedded into the very file
//     that was hashed, verified, and kept as the signed document.
// Phase 2 runs in the requester's own request, so nothing happens behind a closed browser; an attempt nobody comes back
// for simply expires. The signature is PAdES-BASELINE-B without a timestamp: Viettel's async flow returns none.
public sealed class RemoteSigningService(
    ICurrentUser user, IDigitalSigningStore store, ISigningProvider provider, IPdfSigner pdf, DigitalSigningPolicy policy,
    ISignatureImageStore images, TimeProvider clock)
{
    private static readonly TimeSpan VietnamOffset = TimeSpan.FromHours(7);

    public async Task<SigningTransactionView> StartAsync(StartSigning input, CancellationToken cancellationToken)
    {
        var requester = SignerAccess.RequireSigner(user);
        var documentName = DocumentName(input.DocumentName);
        RequirePdf(input.Pdf);

        var certificate = await store.CertificateAsync(input.CertificateId, cancellationToken);
        var now = clock.GetUtcNow();
        if (certificate is null || certificate.OwnerUserId != requester) throw DigitalSigningException.NotFound("chứng thư số");
        if (certificate.Locked) throw DigitalSigningException.Conflict("Chứng thư đang bị khóa; mở khóa rồi ký.");
        if (!certificate.IsValidAt(now)) throw DigitalSigningException.Conflict("Chứng thư đã hết hạn hoặc chưa có hiệu lực.");

        // Read again at every signing: a certificate renewed or revoked at Viettel shows up here, not at the next audit.
        var credential = await CredentialAsync(certificate, cancellationToken);

        // Fixed to the second: the date written in the PDF and the one shown in the box must agree.
        var signingDate = new DateTimeOffset(now.UtcTicks - now.UtcTicks % TimeSpan.TicksPerSecond, TimeSpan.Zero);
        // Placed by the signer: their signature picture when they keep one, otherwise who signed and when.
        VisibleSignature? visible = null;
        if (input.Placement is { } at)
        {
            var picture = await images.FindAsync(requester, cancellationToken);
            visible = new VisibleSignature(at.Page, at.X, at.Y, at.Width, AppearanceText(credential.Certificate, signingDate),
                picture?.Content);
        }

        PreparedSignature prepared;
        try
        {
            prepared = pdf.Prepare(input.Pdf, credential.Chain, signingDate, visible);
        }
        catch (ArgumentException unusable)
        {
            throw DigitalSigningException.Invalid(visible is null
                ? "Không chuẩn bị được tệp PDF để ký: " + unusable.Message
                : "Vị trí chữ ký không hợp lệ hoặc nằm ngoài trang: " + unusable.Message);
        }

        var transaction = new SigningTransaction
        {
            Id = Guid.NewGuid(),
            CertificateId = certificate.Id,
            RequestedByUserId = requester,
            Provider = provider.Code,
            ProviderUserId = certificate.ProviderUserId,
            CredentialId = credential.CredentialId,
            SerialNumber = credential.SerialNumber,
            Status = SigningTransactionStatus.Pending,
            DocumentName = documentName,
            SourcePdfSha256 = Convert.ToHexString(SHA256.HashData(input.Pdf)).ToLowerInvariant(),
            FieldName = prepared.FieldName,
            PreparedPdf = prepared.PreparedPdf,
            DocumentDigest = prepared.DocumentDigest,
            DataToSignSha256 = Convert.ToHexString(prepared.DataToSignDigest).ToLowerInvariant(),
            CertificateChain = string.Join('\n', credential.Chain.Select(item => Convert.ToBase64String(item.RawData))),
            SigningDate = signingDate,
            Description = string.IsNullOrWhiteSpace(input.Description) ? null : Limited(input.Description.Trim(), 200),
            ExpiresAt = now + policy.TransactionTtl,
            CreatedAt = now,
            UpdatedAt = now
        };
        await store.AddTransactionAsync(transaction, cancellationToken);

        try
        {
            var providerTransactionId = await provider.RequestSignatureAsync(new SignHashRequest(
                certificate.ProviderUserId, credential.CredentialId, prepared.DataToSignDigest,
                "bhome-" + transaction.Id.ToString("N"), transaction.Description ?? "Ky tai lieu " + documentName),
                cancellationToken);
            await store.SetProviderTransactionAsync(transaction.Id, providerTransactionId, clock.GetUtcNow(), cancellationToken);
        }
        catch (SigningProviderException refused)
        {
            await store.MoveAsync(transaction.Id, SigningTransactionStatus.Pending, SigningTransactionStatus.Failed,
                "PROVIDER_REFUSED", Limited(refused.Message, 1000), clock.GetUtcNow(), cancellationToken);
            throw DigitalSigningException.ProviderUnavailable("Viettel MySign chưa nhận yêu cầu ký; thử lại sau.");
        }
        return View(await ReloadAsync(transaction.Id, cancellationToken));
    }

    // Where an attempt stands. While pending Viettel is asked, and a signature that came back is embedded now.
    public async Task<SigningTransactionView> StatusAsync(Guid id, CancellationToken cancellationToken)
    {
        var transaction = await OwnAsync(id, cancellationToken);
        if (transaction.Status != SigningTransactionStatus.Pending) return View(transaction);
        if (transaction.IsExpiredAt(clock.GetUtcNow()))
            return await EndAsync(transaction, SigningTransactionStatus.Expired, null, null, cancellationToken);
        if (transaction.ProviderTransactionId is null) return View(transaction);

        SignStatus answer;
        try
        {
            answer = await provider.GetStatusAsync(transaction.ProviderUserId, transaction.ProviderTransactionId,
                cancellationToken);
        }
        catch (SigningProviderException)
        {
            // Viettel did not answer this time: the attempt stays open and the next ask tries again.
            return View(transaction);
        }
        return answer switch
        {
            SignStatus.Signed signed => await CompleteAsync(transaction, signed.RawSignature, cancellationToken),
            SignStatus.Rejected rejected => await EndAsync(transaction, SigningTransactionStatus.Rejected, null,
                rejected.Reason, cancellationToken),
            SignStatus.Expired => await EndAsync(transaction, SigningTransactionStatus.Expired, null, null, cancellationToken),
            SignStatus.Failed failed => await EndAsync(transaction, SigningTransactionStatus.Failed, failed.Code,
                failed.Message, cancellationToken),
            _ => View(transaction)
        };
    }

    public async Task<SignedDocument> DownloadAsync(Guid id, CancellationToken cancellationToken)
    {
        var transaction = await OwnAsync(id, cancellationToken);
        if (transaction.Status != SigningTransactionStatus.Signed || transaction.SignedPdf is null)
            throw DigitalSigningException.Conflict("Tài liệu chưa được ký xong.");
        return new SignedDocument(SignedFileName(transaction.DocumentName), transaction.SignedPdf);
    }

    private async Task<SigningTransactionView> CompleteAsync(SigningTransaction transaction, byte[] rawSignature,
        CancellationToken cancellationToken)
    {
        // Only the request that wins this move embeds; a concurrent poll just reads the outcome.
        if (!await store.MoveAsync(transaction.Id, SigningTransactionStatus.Pending, SigningTransactionStatus.Signing, null,
                null, clock.GetUtcNow(), cancellationToken))
            return View(await ReloadAsync(transaction.Id, cancellationToken));

        string code;
        string message;
        try
        {
            var signed = pdf.Complete(transaction.PreparedPdf, transaction.FieldName, transaction.DocumentDigest,
                Chain(transaction.CertificateChain), rawSignature);
            await store.CompleteAsync(transaction.Id, signed, clock.GetUtcNow(), cancellationToken);
            return View(await ReloadAsync(transaction.Id, cancellationToken));
        }
        catch (InvalidSignatureException invalid)
        {
            (code, message) = ("SIGNATURE_INVALID", "Chữ ký Viettel trả về không khớp chứng thư và tài liệu: " + invalid.Message);
        }
        catch (Exception failure) when (failure is ArgumentException or InvalidOperationException or CryptographicException
                                            or IOException)
        {
            (code, message) = ("COMPLETE_FAILED", "Không gắn được chữ ký vào tệp PDF.");
        }
        await store.MoveAsync(transaction.Id, SigningTransactionStatus.Signing, SigningTransactionStatus.Failed, code,
            Limited(message, 1000), clock.GetUtcNow(), CancellationToken.None);
        return View(await ReloadAsync(transaction.Id, cancellationToken));
    }

    private async Task<RemoteCredential> CredentialAsync(SigningCertificate certificate, CancellationToken cancellationToken)
    {
        IReadOnlyList<RemoteCredential> found;
        try
        {
            found = await provider.ListCredentialsAsync(certificate.ProviderUserId, certificate.SerialNumber,
                cancellationToken);
        }
        catch (SigningProviderException)
        {
            throw DigitalSigningException.ProviderUnavailable("Không đọc được chứng thư từ Viettel MySign; thử lại sau.");
        }
        return found.Count > 0
            ? found[0]
            : throw DigitalSigningException.Conflict("Viettel MySign không còn chứng thư này; khai báo lại chứng thư.");
    }

    private async Task<SigningTransactionView> EndAsync(SigningTransaction transaction, SigningTransactionStatus status,
        string? code, string? message, CancellationToken cancellationToken)
    {
        await store.MoveAsync(transaction.Id, SigningTransactionStatus.Pending, status, code,
            message is null ? null : Limited(message, 1000), clock.GetUtcNow(), cancellationToken);
        return View(await ReloadAsync(transaction.Id, cancellationToken));
    }

    // Only whoever asked for a signature follows it or downloads its result; anyone else sees it as missing.
    private async Task<SigningTransaction> OwnAsync(Guid id, CancellationToken cancellationToken)
    {
        var requester = SignerAccess.RequireSigner(user);
        var transaction = await store.TransactionAsync(id, cancellationToken);
        return transaction is not null && transaction.RequestedByUserId == requester
            ? transaction
            : throw DigitalSigningException.NotFound("yêu cầu ký");
    }

    private async Task<SigningTransaction> ReloadAsync(Guid id, CancellationToken cancellationToken)
        => await store.TransactionAsync(id, cancellationToken) ?? throw DigitalSigningException.NotFound("yêu cầu ký");

    private void RequirePdf(byte[]? content)
    {
        if (content is null || content.Length == 0) throw DigitalSigningException.Invalid("Chọn tệp PDF cần ký.");
        if (content.Length > policy.MaxPdfBytes)
            throw DigitalSigningException.Invalid($"Tệp PDF tối đa {policy.MaxPdfBytes / (1024 * 1024)} MB.");
        if (content.Length < 5 || !content.AsSpan(0, 5).SequenceEqual("%PDF-"u8))
            throw DigitalSigningException.Invalid("Tệp tải lên không phải PDF.");
    }

    // What the box on the page says: who signed (the certificate's common name) and when, in Vietnam time.
    internal static string AppearanceText(X509Certificate2 certificate, DateTimeOffset signingDate)
    {
        var signer = certificate.GetNameInfo(X509NameType.SimpleName, false);
        if (signer.Length > 60) signer = signer[..60];
        return $"Ký bởi: {signer}\nNgày ký: {signingDate.ToOffset(VietnamOffset):dd/MM/yyyy HH:mm:ss}";
    }

    private static IReadOnlyList<X509Certificate2> Chain(string stored) => stored
        .Split('\n', StringSplitOptions.RemoveEmptyEntries)
        .Select(line => new X509Certificate2(Convert.FromBase64String(line.Trim())))
        .ToList();

    private static string DocumentName(string? name)
    {
        var trimmed = Path.GetFileName(name?.Trim() ?? "");
        if (trimmed.Length == 0) return "tai-lieu.pdf";
        return Limited(trimmed, 200);
    }

    private static string SignedFileName(string documentName)
    {
        var stem = documentName.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase) ? documentName[..^4] : documentName;
        return stem + "-da-ky.pdf";
    }

    private static SigningTransactionView View(SigningTransaction transaction) => new(
        transaction.Id, transaction.Status.ToString().ToLowerInvariant(), transaction.Provider, transaction.SerialNumber,
        transaction.DocumentName, transaction.ExpiresAt, transaction.ErrorCode, transaction.ErrorMessage,
        transaction.Status == SigningTransactionStatus.Signed);

    private static string Limited(string value, int max) => value.Length <= max ? value : value[..max];
}
