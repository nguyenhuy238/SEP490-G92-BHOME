using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace BHome.Application.Common;

internal static class CommandFingerprint
{
    // These are persisted formats. Keep the default JSON settings and the exact
    // operation separator; the two formats are not interchangeable.
    internal static string ForInput(object value) => Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(value)));

    internal static string ForOperation(string operation, object input) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(operation + "\n" + JsonSerializer.Serialize(input))));
}
