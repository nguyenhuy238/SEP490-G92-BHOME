using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using BHome.DigitalSigning.Application;
using BHome.DigitalSigning.Domain;
using Microsoft.Extensions.Logging;

namespace BHome.DigitalSigning.Infrastructure.Viettel;

// Viettel MySign remote signing through the asynchronous flow: signHash with async=1 answers at once with a
// transactionId and the signature is fetched later with requests/status, which fits deferred signing (request, then
// poll). The synchronous SAD flow holds the connection until the signer confirms, so it is not used.
//
// Every call but login carries the Bearer token of the signer it is for: a token is per user_id, lasts about an hour,
// is cached and renewed shortly before it ends or when Viettel answers 401. Only raw hashes and raw signatures cross
// this boundary. Unlike the vendor's sample code, TLS certificate validation is never turned off.
internal sealed class ViettelMySignProvider(
    IHttpClientFactory httpClients, IViettelAccountSource accounts, ViettelTokenCache tokens,
    ILogger<ViettelMySignProvider> logger) : ISigningProvider
{
    public const string HttpClientName = "ViettelMySign";

    private const string Sha256Oid = "2.16.840.1.101.3.4.2.1";
    private const string RsaOid = "1.2.840.113549.1.1.1";

    private static readonly JsonSerializerOptions Json = new()
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    public string Code => SigningProviders.ViettelMySign;

    public async Task<string?> CheckAccountAsync(string providerUserId, CancellationToken cancellationToken)
    {
        var account = await accounts.CurrentAsync(cancellationToken);
        if (!account.IsConfigured) return "Chưa có địa chỉ, client_id hoặc client_secret";
        try
        {
            await LoginAsync(account, providerUserId, cancellationToken);
            return null;
        }
        catch (SigningProviderException refused)
        {
            return refused.Message;
        }
    }

    public async Task<IReadOnlyList<RemoteCredential>> ListCredentialsAsync(string providerUserId, string? serialNumber,
        CancellationToken cancellationToken)
    {
        var account = await RequireAccountAsync(cancellationToken);
        var body = new ViettelMySignMessages.CredentialsRequest(account.ClientId, account.ClientSecret,
            Blank(account.ProfileId), providerUserId, "chain", true, false);
        var reply = await AuthorizedAsync(account, providerUserId, account.CredentialsPath, body, cancellationToken);
        if (!reply.Ok) throw new SigningProviderException("Viettel MySign credentials/list failed: " + reply.Error);

        var credentials = new List<RemoteCredential>();
        var root = reply.Body;
        if (root["credentialIDs"] is JsonArray ids)
        {
            // What Viettel really answers: only the ids; the certificate of each is a credentials/info away.
            foreach (var id in ids)
            {
                var credentialId = id?.ToString() ?? "";
                var info = await CredentialInfoAsync(account, providerUserId, credentialId, cancellationToken);
                AddCredential(credentials, info, credentialId, serialNumber);
            }
        }
        else if (root is JsonArray items)
        {
            foreach (var item in items) AddCredential(credentials, item, Text(item, "credential_id"), serialNumber);
        }
        else
        {
            AddCredential(credentials, root, Text(root, "credential_id"), serialNumber);
        }
        return credentials;
    }

    public async Task<string> RequestSignatureAsync(SignHashRequest request, CancellationToken cancellationToken)
    {
        if (request.Digest.Length != SHA256.HashSizeInBytes)
            throw new SigningProviderException("Viettel MySign here signs SHA-256 digests only");
        if (string.IsNullOrWhiteSpace(request.CredentialId))
            throw new SigningProviderException("Viettel MySign needs the credential_id of the certificate");
        var account = await RequireAccountAsync(cancellationToken);
        var shown = ViettelText.Base64(ViettelText.Plain(
            string.IsNullOrWhiteSpace(request.Description) ? request.DocumentId : request.Description));
        var body = new ViettelMySignMessages.SignHashRequest(
            request.CredentialId, 1, shown,
            [new ViettelMySignMessages.Document(request.DocumentId, ViettelText.Base64(ViettelText.Plain(request.DocumentId)))],
            [Convert.ToBase64String(request.Digest)], Sha256Oid, RsaOid, 1);
        var reply = await AuthorizedAsync(account, request.ProviderUserId, account.SignHashPath, body, cancellationToken);
        var transactionId = Text(reply.Body, "transactionId");
        if (!reply.Ok || transactionId.Length == 0)
        {
            // What Viettel support asks for when a sign is refused; never the secret, and the signer's id only by its tail.
            logger.LogWarning(
                "Viettel MySign signHash refused: client_id={ClientId} user_id=***{UserTail} credential_id={CredentialId} " +
                "document_id={DocumentId} status={Status} error={Error}", account.ClientId,
                ViettelText.Tail(request.ProviderUserId), request.CredentialId, request.DocumentId, reply.Status, reply.Error);
            throw new SigningProviderException("Viettel MySign signHash failed: " + reply.Error);
        }
        return transactionId;
    }

    public async Task<SignStatus> GetStatusAsync(string providerUserId, string providerTransactionId,
        CancellationToken cancellationToken)
    {
        var account = await RequireAccountAsync(cancellationToken);
        var reply = await AuthorizedAsync(account, providerUserId, account.StatusPath,
            new ViettelMySignMessages.StatusRequest(providerTransactionId), cancellationToken);
        if (!reply.Ok) return new SignStatus.Failed(((int)reply.Status).ToString(), reply.Error);
        var status = Text(reply.Body, "status");
        return status switch
        {
            "1" => Signed(reply.Body),
            "4000" => new SignStatus.Pending(),
            "4001" => new SignStatus.Expired(),
            "4002" => new SignStatus.Rejected("Người ký từ chối trên ứng dụng MySign"),
            "4004" or "50000" => new SignStatus.Failed(status, ErrorOf(reply.Body, "Viettel MySign báo lỗi khi ký")),
            _ => new SignStatus.Failed(status.Length == 0 ? "?" : status, "Viettel MySign trả trạng thái không rõ: " + status)
        };
    }

    // --- HTTP ---

    private sealed record Reply(HttpStatusCode Status, JsonNode Body)
    {
        public bool Ok => (int)Status is >= 200 and < 300;

        public string Error
        {
            get
            {
                var code = Text(Body, "error");
                var description = Text(Body, "error_description");
                return (code.Length == 0 ? "HTTP " + (int)Status : code) + (description.Length == 0 ? "" : ": " + description);
            }
        }
    }

    private async Task<ViettelAccount> RequireAccountAsync(CancellationToken cancellationToken)
    {
        var account = await accounts.CurrentAsync(cancellationToken);
        return account.IsConfigured
            ? account
            : throw new SigningProviderException("Viettel MySign account is not configured (base URL, client_id, client_secret)");
    }

    // One POST; a 4xx or 5xx is returned, not thrown, because Viettel puts the reason in the body.
    private async Task<Reply> PostAsync(ViettelAccount account, string path, string? bearer, object body,
        CancellationToken cancellationToken)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(account.TimeoutSeconds));
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, Endpoint(account, path))
            {
                Content = JsonContent.Create(body, body.GetType(), options: Json)
            };
            request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
            if (bearer is not null) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearer);
            using var response = await httpClients.CreateClient(HttpClientName).SendAsync(request, timeout.Token);
            var raw = await response.Content.ReadAsByteArrayAsync(timeout.Token);
            return new Reply(response.StatusCode, Parse(raw));
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            throw new SigningProviderException($"Viettel MySign call to {path} timed out");
        }
        catch (HttpRequestException failure)
        {
            throw new SigningProviderException($"Viettel MySign call to {path} failed", failure);
        }
    }

    // A call made as this signer: with a cached token, logging in again once if Viettel says the token is no good.
    private async Task<Reply> AuthorizedAsync(ViettelAccount account, string providerUserId, string path, object body,
        CancellationToken cancellationToken)
    {
        var reply = await PostAsync(account, path, await TokenAsync(account, providerUserId, cancellationToken), body,
            cancellationToken);
        if (reply.Status != HttpStatusCode.Unauthorized) return reply;
        tokens.Remove(account, providerUserId);
        return await PostAsync(account, path, await TokenAsync(account, providerUserId, cancellationToken), body,
            cancellationToken);
    }

    private async Task<string> TokenAsync(ViettelAccount account, string providerUserId, CancellationToken cancellationToken)
        => tokens.Get(account, providerUserId) ?? await LoginAsync(account, providerUserId, cancellationToken);

    private async Task<string> LoginAsync(ViettelAccount account, string providerUserId, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(providerUserId)) throw new SigningProviderException("Viettel MySign needs the signer's user_id");
        var body = new ViettelMySignMessages.LoginRequest(account.ClientId, account.ClientSecret, Blank(account.ProfileId),
            providerUserId);
        var reply = await PostAsync(account, account.LoginPath, null, body, cancellationToken);
        var accessToken = Text(reply.Body, "access_token");
        if (!reply.Ok || accessToken.Length == 0)
        {
            logger.LogWarning("Viettel MySign login refused: client_id={ClientId} user_id=***{UserTail} status={Status} error={Error}",
                account.ClientId, ViettelText.Tail(providerUserId), reply.Status, reply.Error);
            throw new SigningProviderException("Viettel MySign login failed: " + reply.Error);
        }
        tokens.Put(account, providerUserId, accessToken, Lifetime(Text(reply.Body, "expires_in")));
        return accessToken;
    }

    private async Task<JsonNode> CredentialInfoAsync(ViettelAccount account, string providerUserId, string credentialId,
        CancellationToken cancellationToken)
    {
        var body = new ViettelMySignMessages.CredentialInfoRequest(account.ClientId, account.ClientSecret,
            Blank(account.ProfileId), credentialId, "chain", true, false);
        var reply = await AuthorizedAsync(account, providerUserId, InfoPath(account.CredentialsPath), body, cancellationToken);
        return reply.Ok ? reply.Body : throw new SigningProviderException("Viettel MySign credentials/info failed: " + reply.Error);
    }

    // credentials/info sits beside credentials/list, so it follows the configured path rather than being one more setting.
    private static string InfoPath(string listPath) =>
        listPath.EndsWith("/list", StringComparison.Ordinal) ? listPath[..^"/list".Length] + "/info" : listPath;

    private static Uri Endpoint(ViettelAccount account, string path) =>
        new(account.BaseUrl!.TrimEnd('/') + "/" + path.TrimStart('/'), UriKind.Absolute);

    // --- Mapping ---

    private static void AddCredential(List<RemoteCredential> into, JsonNode? node, string credentialId, string? wantedSerial)
    {
        if (credentialId.Length == 0 || node?["cert"]?["certificates"] is not JsonArray { Count: > 0 } certificates) return;
        var chain = certificates.Select(item => ParseCertificate(item?.ToString() ?? "")).ToList();
        var certificateSerial = chain[0].SerialNumber;
        var serial = Text(node["cert"], "SerialNumber");
        if (serial.Length == 0) serial = certificateSerial;
        if (wantedSerial is not null && !ViettelText.SameSerial(wantedSerial, serial) &&
            !ViettelText.SameSerial(wantedSerial, certificateSerial)) return;
        into.Add(new RemoteCredential(serial, chain[0], chain, credentialId));
    }

    private static SignStatus Signed(JsonNode body)
    {
        var signature = body["signatures"] is JsonArray { Count: > 0 } signatures ? signatures[0]?.ToString() ?? "" : "";
        if (string.IsNullOrWhiteSpace(signature))
            return new SignStatus.Failed("1", "Viettel MySign báo đã ký nhưng không trả chữ ký");
        // The signature may come with line breaks inside; kept, they make the stored value impossible to verify.
        try
        {
            return new SignStatus.Signed(Convert.FromBase64String(string.Concat(signature.Where(c => !char.IsWhiteSpace(c)))));
        }
        catch (FormatException)
        {
            return new SignStatus.Failed("1", "Viettel MySign trả chữ ký không đọc được");
        }
    }

    private static X509Certificate2 ParseCertificate(string base64Der)
    {
        try
        {
            return new X509Certificate2(Convert.FromBase64String(string.Concat(base64Der.Where(c => !char.IsWhiteSpace(c)))));
        }
        catch (Exception failure) when (failure is FormatException or CryptographicException)
        {
            throw new SigningProviderException("Viettel MySign returned an unparsable certificate", failure);
        }
    }

    private static string ErrorOf(JsonNode body, string fallback)
    {
        var description = Text(body, "error_description");
        return description.Length == 0 ? fallback : description;
    }

    private static TimeSpan Lifetime(string expiresIn) =>
        long.TryParse(expiresIn.Trim(), out var seconds) && seconds > 0 ? TimeSpan.FromSeconds(seconds) : TimeSpan.FromHours(1);

    private static JsonNode Parse(byte[] raw)
    {
        if (raw.Length == 0) return new JsonObject();
        try
        {
            return JsonNode.Parse(raw) ?? new JsonObject();
        }
        catch (JsonException)
        {
            return new JsonObject();
        }
    }

    // A field as text, "" when absent or null. A number comes back as its digits, which is how status may arrive.
    private static string Text(JsonNode? node, string field) =>
        node is JsonObject obj && obj.TryGetPropertyValue(field, out var value) && value is not null ? value.ToString() : "";

    private static string? Blank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value;
}

// Per signer, per account: a token issued under one client_id is never reused after the account changes.
internal sealed class ViettelTokenCache(TimeProvider clock)
{
    // Renewed this long before it ends, so a token never expires between being fetched and being used.
    private static readonly TimeSpan Margin = TimeSpan.FromSeconds(60);
    private readonly ConcurrentDictionary<string, (string Value, DateTimeOffset ExpiresAt)> tokens = new();

    public string? Get(ViettelAccount account, string userId) =>
        tokens.TryGetValue(Key(account, userId), out var token) && clock.GetUtcNow() < token.ExpiresAt - Margin
            ? token.Value
            : null;

    public void Put(ViettelAccount account, string userId, string value, TimeSpan lifetime) =>
        tokens[Key(account, userId)] = (value, clock.GetUtcNow() + lifetime);

    public void Remove(ViettelAccount account, string userId) => tokens.TryRemove(Key(account, userId), out _);

    private static string Key(ViettelAccount account, string userId) => $"{account.BaseUrl}|{account.ClientId}|{userId}";
}
