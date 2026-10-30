using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using BHome.DigitalSigning.Application;
using BHome.DigitalSigning.Domain;

namespace BHome.DigitalSigning.Sandbox;

// Stands in for Viettel MySign when no Viettel account is configured. Each subscriber id gets its own RSA key and
// self-signed certificate, kept only in memory; a signature request waits until someone approves or rejects it on
// phone.html, exactly like the MySign app. The PDF side is the real one: what comes out verifies like a real signature
// (only the certificate is not trusted, since no real CA issued it).
internal sealed class FakeMySign(TimeProvider clock) : ISigningProvider
{
    private static readonly TimeSpan Window = TimeSpan.FromMinutes(5);
    private readonly ConcurrentDictionary<string, Subscriber> subscribers = new();
    private readonly ConcurrentDictionary<string, string> names = new();
    private readonly ConcurrentDictionary<string, Request> requests = new();

    public enum State { Pending, Approved, Rejected }

    public sealed record Request(string Id, string UserId, byte[] Digest, string Description, string DocumentId,
        DateTimeOffset CreatedAt)
    {
        public State State { get; set; } = State.Pending;
        public byte[]? Signature { get; set; }
    }

    private sealed record Subscriber(RSA Key, X509Certificate2 Certificate, string CredentialId);

    public string Code => SigningProviders.ViettelMySign;

    public Task<IReadOnlyList<RemoteCredential>> ListCredentialsAsync(string providerUserId, string? serialNumber,
        CancellationToken cancellationToken)
    {
        var subscriber = SubscriberOf(providerUserId);
        var certificate = subscriber.Certificate;
        IReadOnlyList<RemoteCredential> found = serialNumber is null ||
            string.Equals(serialNumber.TrimStart('0'), certificate.SerialNumber.TrimStart('0'), StringComparison.OrdinalIgnoreCase)
            ? [new RemoteCredential(certificate.SerialNumber, certificate, [certificate], subscriber.CredentialId)]
            : [];
        return Task.FromResult(found);
    }

    public Task<string> RequestSignatureAsync(SignHashRequest request, CancellationToken cancellationToken)
    {
        if (request.Digest.Length != SHA256.HashSizeInBytes) throw new SigningProviderException("SHA-256 digests only");
        var id = "fake-" + Guid.NewGuid().ToString("N")[..12];
        requests[id] = new Request(id, request.ProviderUserId, request.Digest, request.Description, request.DocumentId,
            clock.GetUtcNow());
        return Task.FromResult(id);
    }

    public Task<SignStatus> GetStatusAsync(string providerUserId, string providerTransactionId,
        CancellationToken cancellationToken)
    {
        if (!requests.TryGetValue(providerTransactionId, out var request))
            return Task.FromResult<SignStatus>(new SignStatus.Failed("404", "Không có giao dịch này"));
        SignStatus status = request.State switch
        {
            State.Approved => new SignStatus.Signed(request.Signature!),
            State.Rejected => new SignStatus.Rejected("Người ký từ chối trên ứng dụng MySign (giả lập)"),
            _ when clock.GetUtcNow() - request.CreatedAt > Window => new SignStatus.Expired(),
            _ => new SignStatus.Pending()
        };
        return Task.FromResult(status);
    }

    public Task<string?> CheckAccountAsync(string providerUserId, CancellationToken cancellationToken)
        => Task.FromResult<string?>(null);

    // The name the fake certificate carries for this subscriber. A different name issues a new certificate, as a new
    // registration at Viettel would; the old one then no longer matches and has to be declared again.
    public void Name(string userId, string name)
    {
        var key = userId.Trim();
        var cleaned = string.Concat(name.Trim().Where(c => c != ',' && c != '=' && c != '+' && !char.IsControl(c)));
        if (key.Length == 0 || cleaned.Length == 0) return;
        if (names.TryGetValue(key, out var known) && known == cleaned) return;
        names[key] = cleaned;
        subscribers.TryRemove(key, out _);
    }

    // --- What the fake phone does ---

    public IReadOnlyList<Request> PendingFor(string userId) => requests.Values
        .Where(request => request.UserId == userId && request.State == State.Pending &&
                          clock.GetUtcNow() - request.CreatedAt <= Window)
        .OrderBy(request => request.CreatedAt)
        .ToList();

    public bool Approve(string id)
    {
        if (!requests.TryGetValue(id, out var request) || request.State != State.Pending) return false;
        // The same operation an HSM performs: RSA PKCS#1 v1.5 over the SHA-256 digest it was sent.
        request.Signature = SubscriberOf(request.UserId).Key.SignHash(request.Digest, HashAlgorithmName.SHA256,
            RSASignaturePadding.Pkcs1);
        request.State = State.Approved;
        return true;
    }

    public bool Reject(string id)
    {
        if (!requests.TryGetValue(id, out var request) || request.State != State.Pending) return false;
        request.State = State.Rejected;
        return true;
    }

    private Subscriber SubscriberOf(string userId)
    {
        if (string.IsNullOrWhiteSpace(userId)) throw new SigningProviderException("user_id is required");
        return subscribers.GetOrAdd(userId.Trim(), id =>
        {
            var key = RSA.Create(2048);
            var name = names.TryGetValue(id, out var given) ? given : $"Nguyễn Văn Thử {id}";
            var request = new CertificateRequest($"CN={name}, O=BHome Sandbox, C=VN", key,
                HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
            var now = clock.GetUtcNow();
            using var withKey = request.CreateSelfSigned(now.AddDays(-1), now.AddYears(1));
            return new Subscriber(key, new X509Certificate2(withKey.Export(X509ContentType.Cert)),
                "fake-cred-" + id);
        });
    }
}
