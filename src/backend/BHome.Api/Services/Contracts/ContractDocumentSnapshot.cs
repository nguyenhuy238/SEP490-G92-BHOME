using System.Security.Cryptography;
using System.Text.Json;

namespace BHome.Application.Contracts;

public static class ContractDocumentSnapshot
{
    // Preserve the existing persisted JSON/hash format, including decimal serialization attributes.
    public static string Hash(ContractDocument document) => Convert.ToHexString(SHA256.HashData(
        JsonSerializer.SerializeToUtf8Bytes(document with { SnapshotHash = "" })));
}
