namespace BHome.Application.PropertyManagement;

public sealed record InspectionScheduleWrite(Guid AssetId, Guid PolicyId, int PolicyVersion,
    DateOnly StartsOn, int? IntervalDays, int CompletionWindowDays, bool Enabled, int ExpectedVersion = 0);
public sealed record InspectionUnitSnapshot(Guid Id, int Version, string Label, string Position);
public sealed record InspectionAnswer(Guid UnitId, string ChecklistCode, string Result, string? Note, Guid[] EvidenceIds);
public sealed record EquipmentInspection(Guid AssetId, Guid ScheduleId, DateOnly Period, Guid TaskId,
    Guid PolicyId, int PolicyVersion, AssetLifecyclePolicyWrite PolicySnapshot, InspectionUnitSnapshot[] Units,
    int QuantitySnapshot, InspectionAnswer[] Answers, string Outcome = "NotInspected", Guid? SubmittedBy = null,
    DateTimeOffset? SubmittedAt = null, string? ReviewNote = null, Guid? RemediationWorkOrderId = null,
    string? RemediationFingerprint = null, InspectionProgress? Progress = null);
public sealed record InspectionBatch(int ExpectedVersion, InspectionAnswer[] Answers, bool Submit);
public sealed record InspectionReview(int ExpectedVersion, string Action, string Note);
public sealed record InspectionRemediation(int ExpectedVersion, string Description, string ExpectedOutcome, DateTimeOffset TargetCompletionAt);
public sealed record InspectionProgress(int Total, int Inspected, int Passed, int Failed, int NotInspected, string Outcome);

public static class EquipmentInspectionRules
{
    public static InspectionProgress Evaluate(EquipmentInspection cycle, InspectionAnswer[] answers)
    {
        if (answers is null || answers.Length > 10000 || answers.Any(a => a is null || a.EvidenceIds is null || a.EvidenceIds.Length > 50 || a.Note?.Length > 2000) ||
            answers.Select(a => (a.UnitId, a.ChecklistCode)).Distinct().Count() != answers.Length)
            throw new PropertyException(400, "invalid_inspection_answers");
        var units = cycle.Units.Select(u => u.Id).ToHashSet();
        var checklist = cycle.PolicySnapshot.Checklist.ToDictionary(c => c.Code, StringComparer.Ordinal);
        foreach (var answer in answers)
        {
            if (!units.Contains(answer.UnitId) || !checklist.TryGetValue(answer.ChecklistCode, out var item) ||
                answer.Result is not ("Passed" or "Failed" or "NotApplicable" or "NotInspected") ||
                answer.Result == "NotApplicable" && item.NotApplicableReasonRequired && string.IsNullOrWhiteSpace(answer.Note))
                throw new PropertyException(400, "invalid_inspection_answer");
        }
        var groups = answers.GroupBy(a => a.UnitId).ToDictionary(g => g.Key, g => g.ToArray());
        var passed = 0; var failed = 0;
        foreach (var unit in cycle.Units)
        {
            var result = groups.GetValueOrDefault(unit.Id) ?? [];
            if (result.Length != checklist.Count || result.Any(a => a.Result == "NotInspected")) continue;
            if (result.Any(a => a.Result == "Failed")) failed++;
            else if (result.Any(a => a.Result == "Passed")) passed++;
        }
        var inspected = passed + failed;
        var total = cycle.PolicySnapshot.IndividualTracking ? cycle.QuantitySnapshot : 1;
        return new(total, inspected, passed, failed, total - inspected,
            inspected < total ? "Incomplete" : failed > 0 ? "Failed" : "Passed");
    }
}
