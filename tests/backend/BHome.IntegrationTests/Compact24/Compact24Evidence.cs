using System.Text.Json;
using BHome.Infrastructure.Persistence.Compact24;

namespace BHome.IntegrationTests.Compact24;

internal static class Compact24Evidence
{
    internal static Task WriteAsync(string scenario, Compact24DataCopyResult result)
    {
        var directory = Environment.GetEnvironmentVariable("BHOME_COMPACT24_EVIDENCE_DIRECTORY");
        if (string.IsNullOrWhiteSpace(directory)) return Task.CompletedTask;
        Directory.CreateDirectory(directory);
        // Aggregate reconciliation only: never export identifiers, payloads, hashes or keys.
        return File.WriteAllTextAsync(Path.Combine(directory, scenario + ".json"), JsonSerializer.Serialize(new
        {
            Scenario = scenario,
            SchemaVersion = Compact24Schema.Version,
            Compact24Schema.ScriptSha256,
            SyntheticDataOnly = true,
            Reconciliation = result
        }, new JsonSerializerOptions { WriteIndented = true }));
    }
}
