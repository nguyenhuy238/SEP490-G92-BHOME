using BHome.Application.PropertyManagement;

namespace BHome.Application.UnitTests.PropertyManagement;

public sealed class EquipmentInspectionRulesTests
{
    private static EquipmentInspection Cycle()
    {
        var policy = new AssetLifecyclePolicyWrite("Synthetic", "FireSafetyEquipment", true, 30, null, false, false,
            [new("position", "Synthetic check", true)], "OwnerPolicy", "Synthetic basis", null, null, new(2026, 1, 1));
        return new(Guid.NewGuid(), Guid.NewGuid(), new(2026, 1, 1), Guid.NewGuid(), Guid.NewGuid(), 2, policy,
            Enumerable.Range(0, 4).Select(_ => new InspectionUnitSnapshot(Guid.NewGuid(), 1, "Synthetic", "Lobby")).ToArray(), 4, []);
    }

    [Theory]
    [InlineData("Passed", 4, "Passed", 4, 0, 0)]
    [InlineData("Passed", 3, "Incomplete", 3, 0, 1)]
    [InlineData("Failed", 4, "Failed", 0, 4, 0)]
    [InlineData("NotApplicable", 4, "Incomplete", 0, 0, 4)]
    [InlineData("NotInspected", 4, "Incomplete", 0, 0, 4)]
    public void OutcomesRequireActualInspections(string result, int count, string outcome, int passed, int failed, int missing)
    {
        var cycle = Cycle();
        var answers = cycle.Units.Take(count).Select(unit => new InspectionAnswer(unit.Id, "position", result, "Synthetic reason", [])).ToArray();
        var progress = EquipmentInspectionRules.Evaluate(cycle, answers);
        Assert.Equal(outcome, progress.Outcome); Assert.Equal(passed, progress.Passed); Assert.Equal(failed, progress.Failed); Assert.Equal(missing, progress.NotInspected);
    }

    [Fact]
    public void ForeignUnitsDuplicateAnswersAndUnjustifiedNotApplicableAreRejected()
    {
        var cycle = Cycle();
        var answer = new InspectionAnswer(cycle.Units[0].Id, "position", "Passed", null, []);
        Assert.Throws<PropertyException>(() => EquipmentInspectionRules.Evaluate(cycle, [answer with { UnitId = Guid.NewGuid() }]));
        Assert.Throws<PropertyException>(() => EquipmentInspectionRules.Evaluate(cycle, [answer, answer]));
        Assert.Throws<PropertyException>(() => EquipmentInspectionRules.Evaluate(cycle, [answer with { Result = "NotApplicable" }]));
    }
}
