using System.Text.Json.Serialization;

namespace BHome.DigitalSigning.Infrastructure.Viettel;

// Request bodies for Viettel MySign, asynchronous flow (huong_dan_tich_hop_bat_dong_bo.pdf). Responses are read as a
// JSON tree instead: Viettel's documents disagree in places, and a missing or renamed field should degrade to a clear
// error rather than fail the whole mapping. Null fields are not sent (profile_id is optional).
internal static class ViettelMySignMessages
{
    internal sealed record LoginRequest(
        [property: JsonPropertyName("client_id")] string? ClientId,
        [property: JsonPropertyName("client_secret")] string? ClientSecret,
        [property: JsonPropertyName("profile_id")] string? ProfileId,
        [property: JsonPropertyName("user_id")] string UserId);

    // credentials/list takes the client's id and secret in the body as well as the Bearer token.
    internal sealed record CredentialsRequest(
        [property: JsonPropertyName("client_id")] string? ClientId,
        [property: JsonPropertyName("client_secret")] string? ClientSecret,
        [property: JsonPropertyName("profile_id")] string? ProfileId,
        [property: JsonPropertyName("user_id")] string UserId,
        [property: JsonPropertyName("certificates")] string Certificates,
        [property: JsonPropertyName("certInfo")] bool CertInfo,
        [property: JsonPropertyName("authInfo")] bool AuthInfo);

    // credentials/info: the certificate of one credential, which credentials/list names but does not carry.
    internal sealed record CredentialInfoRequest(
        [property: JsonPropertyName("client_id")] string? ClientId,
        [property: JsonPropertyName("client_secret")] string? ClientSecret,
        [property: JsonPropertyName("profile_id")] string? ProfileId,
        [property: JsonPropertyName("credentialID")] string CredentialId,
        [property: JsonPropertyName("certificates")] string Certificates,
        [property: JsonPropertyName("certInfo")] bool CertInfo,
        [property: JsonPropertyName("authInfo")] bool AuthInfo);

    internal sealed record Document(
        [property: JsonPropertyName("document_id")] string DocumentId,
        [property: JsonPropertyName("document_name")] string DocumentName);

    internal sealed record SignHashRequest(
        [property: JsonPropertyName("credentialID")] string CredentialId,
        [property: JsonPropertyName("numSignatures")] int NumSignatures,
        [property: JsonPropertyName("description")] string Description,
        [property: JsonPropertyName("documents")] IReadOnlyList<Document> Documents,
        [property: JsonPropertyName("hash")] IReadOnlyList<string> Hash,
        [property: JsonPropertyName("hashAlgo")] string HashAlgo,
        [property: JsonPropertyName("signAlgo")] string SignAlgo,
        [property: JsonPropertyName("async")] int Async);

    internal sealed record StatusRequest([property: JsonPropertyName("transactionId")] string TransactionId);
}
