using System.Diagnostics;
using System.Text.Json;
using BHome.Application.Ocr;

internal static class AutomaticOcrEvaluation
{
    public static async Task<int> RunAsync(IAutomaticOcrService service, string manifestPath, string reportPath)
    {
        var root = Path.GetDirectoryName(Path.GetFullPath(manifestPath))!;
        if (new FileInfo(manifestPath).Length > 2 * 1024 * 1024) throw new InvalidDataException();
        var manifest = JsonSerializer.Deserialize<Manifest>(await File.ReadAllTextAsync(manifestPath), OcrEvaluation.Json) ?? throw new InvalidDataException();
        if (manifest.Dataset != "synthetic" || manifest.Cases is null || manifest.Cases.Count is < 1 or > 1000) throw new InvalidDataException();
        var results = new List<object>(); var times = new List<long>(); var passed = 0; var reviewed = 0; var classified = 0;
        var correctFields = 0; var totalFields = 0; var falseProposalsOnReviewCases = 0;
        var statusMatches = 0; var explicitCorrectFields = 0; var sameAsExplicit = 0;
        var transitions = new Dictionary<string, int>();
        foreach (var sample in manifest.Cases)
        {
            if (sample.ExpectedStatus is not ("classified" or "unknown" or "ambiguous" or "unavailable") || sample.ExpectedFields is null ||
                sample.ExpectedFields.Any(f => f.Key is not ("fullName" or "dateOfBirth" or "dateOfIssue" or "placeOfIssue" or "reading") || f.Value is null)) throw new InvalidDataException();
            var path = Path.GetFullPath(sample.File, root);
            if (!path.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) ||
                Path.GetExtension(path).ToLowerInvariant() is not (".png" or ".jpg" or ".jpeg")) throw new InvalidDataException();
            using var input = File.OpenRead(path); var clock = Stopwatch.StartNew();
            var result = await service.ExtractAutomaticAsync(input, default); times.Add(clock.ElapsedMilliseconds);
            var proposal = result.IdentityProposal ?? result.MeterProposal;
            var fields = sample.ExpectedFields.ToDictionary(f => f.Key, f => proposal?.ProposedFields.GetValueOrDefault(f.Key) == f.Value);
            totalFields += fields.Count; correctFields += fields.Count(f => f.Value);
            if (result.ClassificationStatus == "classified") classified++; else reviewed++;
            var falseProposal = sample.ExpectedStatus != "classified" && proposal is not null;
            if (falseProposal) falseProposalsOnReviewCases++;
            var success = result.ClassificationStatus == sample.ExpectedStatus && result.DetectedCategory == sample.ExpectedCategory && fields.Values.All(v => v) && !falseProposal;
            if (result.ClassificationStatus == sample.ExpectedStatus) statusMatches++;
            if (sample.ExpectedStatus == "classified" && service is IOcrService explicitService)
            {
                var kind = Enum.GetValues<OcrDocumentKind>().Single(k => OcrCategories.Name(k) == sample.ExpectedCategory);
                using var explicitInput = File.OpenRead(path);
                var baseline = await explicitService.ExtractAsync(explicitInput, kind, default);
                explicitCorrectFields += sample.ExpectedFields.Count(f => baseline.ProposedFields.GetValueOrDefault(f.Key) == f.Value);
                if (proposal is not null && baseline.ProposedFields.OrderBy(f => f.Key).SequenceEqual(proposal.ProposedFields.OrderBy(f => f.Key))) sameAsExplicit++;
            }
            if (success) passed++;
            var transition = $"{sample.ExpectedCategory}->{result.DetectedCategory}";
            transitions[transition] = transitions.GetValueOrDefault(transition) + 1;
            results.Add(new { index = results.Count, passed = success, result.ClassificationStatus, result.DetectedCategory, elapsedMilliseconds = times[^1], fields, result.Warnings });
            Console.WriteLine(JsonSerializer.Serialize(new { index = results.Count - 1, passed = success, result.ClassificationStatus, elapsedMilliseconds = times[^1] }));
        }
        var summary = new
        {
            manifest.Dataset,
            sourceCount = manifest.Cases.Select(c => c.Source ?? c.File).Distinct().Count(),
            total = results.Count,
            passed,
            statusMatches,
            classified,
            reviewed,
            correctExpectedFields = correctFields,
            totalExpectedFields = totalFields,
            falseProposalsOnReviewCases,
            explicitProfileCorrectExpectedFields = explicitCorrectFields,
            classifiedCasesIdenticalToExplicitProfile = sameAsExplicit,
            fallbackRatePercent = decimal.Round(100m * reviewed / results.Count, 2),
            within10Seconds = times.Count(t => t <= 10000),
            p95Milliseconds = times.Order().ElementAt((int)Math.Ceiling(times.Count * .95) - 1),
            maxMilliseconds = times.Max(),
            expectedToDetected = transitions,
            classificationAccuracy = (decimal?)null,
            sixClassConfusionMatrix = (object?)null,
            limitation = "Synthetic text-evidence acceptance cases; no real six-class labeled dataset or visual classifier. NOT a classification accuracy benchmark."
        };
        await File.WriteAllTextAsync(reportPath, JsonSerializer.Serialize(new { summary, results }, OcrEvaluation.Json));
        Console.WriteLine(JsonSerializer.Serialize(summary));
        return passed == results.Count ? 0 : 1;
    }
    private sealed record Manifest(string Dataset, IReadOnlyList<Case> Cases);
    private sealed record Case(string File, string ExpectedStatus, string ExpectedCategory, IReadOnlyDictionary<string, string> ExpectedFields, string? Source);
}
