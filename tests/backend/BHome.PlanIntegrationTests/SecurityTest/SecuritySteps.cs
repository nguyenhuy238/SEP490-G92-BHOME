using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Npgsql;

namespace BHome.PlanIntegrationTests.SecurityTest;

/// <summary>
/// Black-box helpers for the SecurityTest sheet: editing JWT segments (no signing key needed) and running SQL
/// that must be rejected inside a transaction that is always rolled back.
/// </summary>
internal static class SecuritySteps
{
    /// <summary>Optional: the API's Jwt:SigningKey (docs/development/LOCAL_DEVELOPMENT.md, user-secret). Needed only by TC-SEC-014.</summary>
    public const string SigningKeyVariable = "BHOME_IT_JWT_SIGNING_KEY";

    public static JsonObject Header(string jwt) => Decode(jwt.Split('.')[0]);

    public static JsonObject Payload(string jwt) => Decode(jwt.Split('.')[1]);

    public static string Signature(string jwt) => jwt.Split('.')[2];

    /// <summary>Rebuilds a token from edited segments, keeping the given signature (so the token is tampered).</summary>
    public static string Build(JsonObject header, JsonObject payload, string signature)
        => $"{Encode(header)}.{Encode(payload)}.{signature}";

    /// <summary>Same header and signature, payload edited by <paramref name="edit"/>.</summary>
    public static string WithPayload(string jwt, Action<JsonObject> edit)
    {
        var payload = Payload(jwt);
        edit(payload);
        return Build(Header(jwt), payload, Signature(jwt));
    }

    /// <summary>Signs header.payload with HS256 using the given key (TC-SEC-014 only).</summary>
    public static string SignHs256(JsonObject header, JsonObject payload, string key)
    {
        var unsigned = $"{Encode(header)}.{Encode(payload)}";
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(key));
        return unsigned + "." + Base64Url(hmac.ComputeHash(Encoding.ASCII.GetBytes(unsigned)));
    }

    public static string Base64Url(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    public static long UnixNow => DateTimeOffset.UtcNow.ToUnixTimeSeconds();

    /// <summary>Roles of a login answer ("roles": [...]).</summary>
    public static string[] Roles(JsonElement loginBody)
        => loginBody.Find("roles") is { ValueKind: JsonValueKind.Array } roles
            ? roles.EnumerateArray().Select(r => r.GetString() ?? string.Empty).ToArray()
            : [];

    /// <summary>
    /// Runs one statement in its own transaction and always rolls it back. Returns the database error message when the
    /// statement was rejected, or null when the database accepted it (the rollback still undoes the change).
    /// </summary>
    public static async Task<string?> RejectionAsync(string sql, params (string Name, object? Value)[] parameters)
    {
        await using var connection = await PlanDb.OpenAsync();
        await using var transaction = await connection.BeginTransactionAsync();
        try
        {
            await using var command = new NpgsqlCommand(sql, connection, transaction);
            foreach (var (name, value) in parameters)
            {
                command.Parameters.AddWithValue(name, value ?? DBNull.Value);
            }

            await command.ExecuteNonQueryAsync();
            return null;
        }
        catch (PostgresException ex)
        {
            return ex.MessageText;
        }
        finally
        {
            await transaction.RollbackAsync();
        }
    }

    /// <summary>Asserts a ProblemDetails body (docs/api/API_CONVENTIONS.md: type, title, status, correlationId).</summary>
    public static void IsProblemDetails(string body, int status, string step)
    {
        Assert.False(string.IsNullOrWhiteSpace(body), $"{step}: expected a ProblemDetails body but the answer was empty.");
        using var doc = JsonDocument.Parse(body);
        var root = doc.RootElement.Clone();
        Assert.True(root.Str("status") == status.ToString() && root.Str("title") is not null, $"{step}: expected ProblemDetails with status {status}. Body: {body}");
    }

    private static JsonObject Decode(string segment)
    {
        var s = segment.Replace('-', '+').Replace('_', '/');
        s = s.PadRight(s.Length + ((4 - (s.Length % 4)) % 4), '=');
        return JsonNode.Parse(Convert.FromBase64String(s))?.AsObject() ?? throw new InvalidOperationException("Token segment is not a JSON object.");
    }

    private static string Encode(JsonObject node) => Base64Url(Encoding.UTF8.GetBytes(node.ToJsonString()));
}
