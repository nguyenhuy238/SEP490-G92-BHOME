using BHome.Domain.Billing;
using BHome.Domain.StaffOperations;

namespace BHome.Domain.UnitTests.StaffOperations;

public sealed class OperationalTaskRulesTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 30, 8, 0, 0, TimeSpan.Zero);
    [Fact]
    public void CompletionRequiresSubmitThenOwnerVerificationAndPreservesRework()
    {
        var task = new OperationalTask { Kind = OperationalTaskKind.AdHoc, DueAt = Now.AddMinutes(-1) };
        var staff = Guid.NewGuid(); var owner = Guid.NewGuid();
        Assert.Throws<InvalidOperationException>(() => task.ApplyAction("verify", Now, owner));
        task.ApplyAction("start", Now, staff);
        task.ApplyAction("blockers", Now, staff);
        Assert.Equal(MeterTaskStatus.InProgress, task.Status);
        task.ApplyAction("submit", Now, staff);
        Assert.Equal(MeterTaskStatus.PendingVerification, task.Status);
        Assert.True(task.IsOverdue(Now));
        task.ApplyAction("rework", Now, owner);
        Assert.Null(task.VerifiedAt);
        task.ApplyAction("submit", Now, staff);
        task.ApplyAction("verify", Now, owner);
        Assert.Equal(MeterTaskStatus.Completed, task.Status);
        Assert.Equal(owner, task.VerifiedByUserId);
        Assert.Equal(Now, task.CompletedAt);
        Assert.False(task.IsOverdue(Now));
        Assert.Throws<InvalidOperationException>(() => task.ApplyAction("start", Now, staff));
        Assert.Throws<InvalidOperationException>(() => task.ApplyAction("cancel", Now, owner));
    }
    [Theory]
    [InlineData(MeterTaskStatus.Assigned)]
    [InlineData(MeterTaskStatus.InProgress)]
    [InlineData(MeterTaskStatus.PendingVerification)]
    public void CancellationClosesEveryOpenState(MeterTaskStatus state)
    {
        var task = new OperationalTask { Kind = OperationalTaskKind.AdHoc, Status = state, DueAt = Now.AddDays(-1) };
        task.ApplyAction("cancel", Now, Guid.NewGuid());
        Assert.False(task.IsOverdue(Now)); Assert.Null(task.VerifiedAt);
        Assert.Throws<InvalidOperationException>(() => task.ApplyAction("submit", Now, Guid.NewGuid()));
    }
    [Fact]
    public void MeterTasksCannotUseGenericCompletionAndExistingEnumValuesStayStable()
    {
        Assert.Throws<InvalidOperationException>(() => new OperationalTask().ApplyAction("start", Now, Guid.NewGuid()));
        Assert.Equal(2, (int)MeterTaskStatus.Completed); Assert.Equal(3, (int)MeterTaskStatus.Cancelled);
    }
}
