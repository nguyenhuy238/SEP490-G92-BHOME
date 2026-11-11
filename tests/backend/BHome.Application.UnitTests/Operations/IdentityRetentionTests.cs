using BHome.Application.IdentityAccess;
using BHome.Application.Operations;
using NSubstitute;
namespace BHome.Application.UnitTests.Operations;
public sealed class IdentityRetentionTests
{
    [Fact]
    public void MissingLegalDecisionNeverGetsAnInventedRetentionPeriod()
    {
        var result = IdentityRetentionRules.Evaluate(new(null, null, null), null, new(2026, 11, 11), []);
        Assert.Null(result.Due); Assert.Contains("retention_policy_unapproved", result.Blockers);
        Assert.Contains("retention_duration_unconfigured", result.Blockers); Assert.Contains("retention_start_policy_unconfigured", result.Blockers);
    }
    [Fact]
    public void SyntheticPolicyDoesNotOverrideFinancialOrLegalHoldsAndHandlesDateOverflow()
    {
        var policy = new IdentityRetentionPolicy("SYNTHETIC-APPROVED-DECISION", 30, "LatestActualMoveOut");
        Assert.Empty(IdentityRetentionRules.Evaluate(policy, new(2026, 10, 1), new(2026, 11, 11), []).Blockers);
        var restricted = IdentityRetentionRules.Evaluate(policy, new(2026, 11, 1), new(2026, 11, 11), ["refund_pending", "identity_retention_hold_active"]);
        Assert.Contains("retention_period_not_elapsed", restricted.Blockers); Assert.Contains("refund_pending", restricted.Blockers); Assert.Contains("identity_retention_hold_active", restricted.Blockers);
        Assert.Equal(new DateOnly(2026, 12, 1), restricted.Due);
        Assert.Contains("retention_period_not_elapsed", IdentityRetentionRules.Evaluate(policy with { RetentionDays = int.MaxValue }, new(2026, 11, 1), new(2026, 11, 11), []).Blockers);
    }
    [Theory]
    [InlineData("Staff")]
    [InlineData("Tenant")]
    public async Task NonOwnerCannotReadOrRecordMetadata(string role)
    {
        var repository = Substitute.For<IIdentityRetentionRepository>(); var user = Substitute.For<ICurrentUser>();
        user.UserId.Returns(Guid.NewGuid()); user.IsInRole(role).Returns(true);
        var service = new IdentityRetentionService(repository, user, new(), TimeProvider.System);
        Assert.Equal(403, (await Assert.ThrowsAsync<OperationsException>(() => service.GetAsync(Guid.NewGuid(), default))).Status);
        Assert.Equal(403, (await Assert.ThrowsAsync<OperationsException>(() => service.RecordAsync(Guid.NewGuid(), new("ref", "Review", null, "Synthetic", true), Guid.NewGuid(), default))).Status);
        Assert.Empty(repository.ReceivedCalls());
    }
    [Fact]
    public async Task IrreversibleRequestsCannotReachPersistence()
    {
        var repository = Substitute.For<IIdentityRetentionRepository>(); var user = Substitute.For<ICurrentUser>();
        user.UserId.Returns(Guid.NewGuid()); user.IsInRole("Owner").Returns(true);
        var service = new IdentityRetentionService(repository, user, new(), TimeProvider.System);
        foreach (var action in new[] { "Delete", "Anonymize", "ApproveLegalPolicy" })
            Assert.Equal(400, (await Assert.ThrowsAsync<OperationsException>(() => service.RecordAsync(Guid.NewGuid(), new("ref", action, null, "Synthetic", true), Guid.NewGuid(), default))).Status);
        Assert.Empty(repository.ReceivedCalls());
    }
}
