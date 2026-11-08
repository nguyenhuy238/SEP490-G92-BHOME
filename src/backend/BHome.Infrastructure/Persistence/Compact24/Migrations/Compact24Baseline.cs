using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace BHome.Infrastructure.Persistence.Compact24.Migrations;

internal static class Compact24Baseline
{
    internal const string Id = "20261108112733_InitialCompact24";
    internal const string Sha256 = "85A9B7D01A9D5F480C73B5D78349E5E1AF941DAB1886D569F6C42048FDC3F05C";
    internal static string MigrationSql { get; } = Read();

    private static string Read()
    {
        using var stream = typeof(Compact24Baseline).Assembly.GetManifestResourceStream("BHome.Compact24.InitialBaseline.sql")!;
        using var bytes = new MemoryStream();
        stream.CopyTo(bytes);
        if (Convert.ToHexString(SHA256.HashData(bytes.ToArray())) != Sha256)
            throw new InvalidOperationException("The immutable Compact24 baseline checksum differs from the reviewed SQL.");
        var sql = Encoding.UTF8.GetString(bytes.ToArray());
        if (Regex.Matches(sql, "(?m)^BEGIN;\\r?$").Count != 1 || Regex.Matches(sql, "(?m)^COMMIT;\\r?$").Count != 1)
            throw new InvalidOperationException("Expected exactly one outer transaction in the reviewed baseline.");
        // EF owns the transaction, including its history INSERT. Keep DO/function bodies intact.
        return Regex.Replace(sql, "(?m)^(?:BEGIN|COMMIT);\\r?$", "");
    }
}
