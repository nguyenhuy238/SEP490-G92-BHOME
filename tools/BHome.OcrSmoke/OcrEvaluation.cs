using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Serialization;
using BHome.Application.Ocr;

internal static class OcrEvaluation
{
    private static readonly HashSet<string> AllowedFields = ["citizenIdentityNumber", "fullName", "dateOfBirth", "gender", "nationality", "placeOfOrigin", "residentialAddress", "dateOfIssue", "dateOfExpiry", "placeOfIssue", "reading"];
    internal static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true,
        Converters = { new JsonStringEnumConverter() }
    };

    public static async Task<int> RunAsync(IOcrService service, string manifestPath, string? reportPath)
    {
        // Keep paths, OCR text, expected/observed values out of console and report output.
        var root = Path.GetDirectoryName(Path.GetFullPath(manifestPath))!;
        if (new FileInfo(manifestPath).Length > 2 * 1024 * 1024) throw new InvalidDataException();
        var manifest = JsonSerializer.Deserialize<EvaluationManifest>(await File.ReadAllTextAsync(manifestPath), Json)
            ?? throw new InvalidDataException();
        if (manifest.Dataset is not ("synthetic" or "meter-evaluation") || manifest.Cases is null || manifest.Cases.Count is < 1 or > 1000)
            throw new InvalidDataException();
        var results = new List<EvaluationResult>();
        var times = new List<long>();
        var matched = 0; var rejected = 0; var falseProposals = 0; var fallbacks = 0;
        var incorrectFields = 0; var missingFields = 0;
        var fields = new Dictionary<string, (int Correct, int Total)>();
        var engineVersions = new HashSet<string>();
        for (var index = 0; index < manifest.Cases.Count; index++)
        {
            var sample = manifest.Cases[index];
            if (sample is null || !Enum.IsDefined(sample.Kind) || sample.ExpectedFields is null ||
                sample.DecimalPlaces is < 0 or > 4 ||
                (sample.DecimalPlaces is not null && sample.Kind is OcrDocumentKind.IdentityFront or OcrDocumentKind.IdentityBack) ||
                sample.ExpectedFields.Any(field => !AllowedFields.Contains(field.Key) || field.Value is null || field.Value.Length > 1000) ||
                (!sample.ExpectFallback && sample.ExpectedFields.Count == 0) ||
                (sample.ExpectFallback && sample.ExpectedFields.Count != 0) ||
                (manifest.Dataset != "synthetic" && sample.Kind is OcrDocumentKind.IdentityFront or OcrDocumentKind.IdentityBack))
                throw new InvalidDataException();
            var path = Path.GetFullPath(sample.File, root);
            // A manifest is data, not permission to read unrelated local files.
            if (!path.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) ||
                Path.GetExtension(path).ToLowerInvariant() is not (".jpg" or ".jpeg" or ".png"))
                throw new InvalidDataException();
            using var input = File.OpenRead(path);
            var clock = Stopwatch.StartNew();
            var proposal = await service.ExtractAsync(input, sample.Kind, CancellationToken.None);
            engineVersions.Add(proposal.EngineVersion);
            if (sample.Kind is not (OcrDocumentKind.IdentityFront or OcrDocumentKind.IdentityBack))
                proposal = MeterReadingPrecision.Apply(proposal, sample.DecimalPlaces);
            times.Add(clock.ElapsedMilliseconds);
            if (proposal.IsFallback) fallbacks++;
            var fieldResults = sample.ExpectedFields.ToDictionary(field => field.Key,
                field => proposal.ProposedFields.TryGetValue(field.Key, out var actual) && actual == field.Value);
            incorrectFields += fieldResults.Count(field => !field.Value && proposal.ProposedFields.ContainsKey(field.Key));
            missingFields += fieldResults.Count(field => !field.Value && !proposal.ProposedFields.ContainsKey(field.Key));
            foreach (var field in fieldResults)
            {
                var previous = fields.GetValueOrDefault(field.Key);
                fields[field.Key] = (previous.Correct + (field.Value ? 1 : 0), previous.Total + 1);
            }
            var passed = sample.ExpectFallback
                ? proposal.IsFallback && proposal.ProposedFields.Count == 0
                : !proposal.IsFallback && fieldResults.Values.All(value => value);
            if (sample.ExpectFallback)
            {
                rejected++;
                if (!passed) falseProposals++;
            }
            if (passed) matched++;
            results.Add(new(index, sample.Kind.ToString(), passed, fieldResults, times[^1], proposal.IsFallback, proposal.Warnings, sample.ExpectFallback));
            Console.WriteLine(JsonSerializer.Serialize(new
            {
                index,
                profile = sample.Kind.ToString(),
                passed,
                elapsedMilliseconds = times[^1],
                proposal.IsFallback
            }));
        }
        times.Sort();
        var profiles = results.GroupBy(result => result.Profile).ToDictionary(group => group.Key, group => new
        {
            total = group.Count(),
            exactMatches = group.Count(result => result.Passed),
            expectedRejections = group.Count(result => result.ExpectedRejection),
            sourceCount = manifest.Cases.Where(sample => sample.Kind.ToString() == group.Key)
                .Select(sample => sample.Source ?? sample.File).Distinct().Count(),
            p95Milliseconds = group.Select(result => result.ElapsedMilliseconds).Order().ElementAt((int)Math.Ceiling(group.Count() * .95) - 1)
        });
        var report = new
        {
            manifest.Dataset,
            engineVersions,
            sourceCount = manifest.Cases.Select(sample => sample.Source ?? sample.File).Distinct().Count(),
            total = manifest.Cases.Count,
            exactMatches = matched,
            expectedRejections = rejected,
            falseProposals,
            incorrectExpectedFields = incorrectFields,
            missingExpectedFields = missingFields,
            fallbacks,
            profiles,
            fieldAccuracy = fields.ToDictionary(field => field.Key, field => new
            {
                correct = field.Value.Correct,
                total = field.Value.Total,
                percent = decimal.Round(100m * field.Value.Correct / field.Value.Total, 2)
            }),
            p50Milliseconds = times[(int)Math.Ceiling(times.Count * .5) - 1],
            p95Milliseconds = times[(int)Math.Ceiling(times.Count * .95) - 1],
            results
        };
        if (reportPath is not null) await File.WriteAllTextAsync(reportPath, JsonSerializer.Serialize(report, Json));
        Console.WriteLine(JsonSerializer.Serialize(new
        {
            stage = "evaluation",
            manifest.Dataset,
            total = manifest.Cases.Count,
            exactMatches = matched,
            falseProposals,
            incorrectExpectedFields = incorrectFields,
            missingExpectedFields = missingFields,
            fallbacks,
            profiles,
            report.p95Milliseconds
        }));
        return matched == manifest.Cases.Count ? 0 : 1;
    }
}

internal sealed record EvaluationManifest(string Dataset, IReadOnlyList<EvaluationCase> Cases);
internal sealed record EvaluationCase(string File, OcrDocumentKind Kind,
    IReadOnlyDictionary<string, string> ExpectedFields, bool ExpectFallback = false, int? DecimalPlaces = null, string? Source = null);
internal sealed record EvaluationResult(int Index, string Profile, bool Passed, IReadOnlyDictionary<string, bool> Fields,
    long ElapsedMilliseconds, bool IsFallback, IReadOnlyList<string> Warnings, bool ExpectedRejection);
