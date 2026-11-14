using System.Text.Json;
using BHome.Application.Contracts;
using BHome.Application.IdentityAccess;
using BHome.Application.PaymentsDebt;
using NSubstitute;

namespace BHome.Application.UnitTests.Contracts;

public sealed class DepositDeductionTests
{
    private readonly Guid asset = Guid.NewGuid(), proof = Guid.NewGuid();
    private DepositDeductionInput Input() => new(0, "source", "Owner reviewed", true,
        [new(asset, "TenantDamage", 10000.00m, "  Broken item  ", [proof])]);
    [Fact]
    public void ExplicitDamageIsCanonicalizedAndReservedOnceInAvailableDeposit()
    {
        var items = DepositDeductionPolicy.Normalize(Input(), 10000, [asset], [proof]);
        Assert.Equal("Broken item", items[0].Description); Assert.Equal(10000, items[0].Amount);
        var result = SettlementCalculator.Calculate([], 50000, new(50000, 0, 10000, 5000), items.Sum(i => i.Amount));
        Assert.Equal(25000, result.AvailableSecurityDeposit); Assert.Equal(10000, result.ApprovedDepositDeductions);
        Assert.Equal(0, result.VerifiedInvoicePayments);
    }
    [Fact]
    public void OwnerMayExplicitlyDeclineDeductionsWithoutInventingAnAmount()
    {
        Assert.Empty(DepositDeductionPolicy.Normalize(Input() with { Items = [] }, 10000, [], []));
    }
    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(0.01)]
    [InlineData(10001)]
    public void ImpossibleOrOverBudgetAmountsAreRejected(decimal amount)
    {
        var x = Input(); x = x with { Items = [x.Items[0] with { Amount = amount }] };
        Assert.Throws<ContractException>(() => DepositDeductionPolicy.Normalize(x, 10000, [asset], [proof]));
    }
    [Fact]
    public void ScopeReasonEvidenceAndDuplicateItemsCannotBeBypassed()
    {
        var input = Input(); var item = input.Items[0];
        foreach (var invalid in new[] {
            item with { ReasonCode = "AutomaticPenalty" }, item with { AssetId = Guid.NewGuid() },
            item with { EvidenceIds = [] }, item with { EvidenceIds = [Guid.NewGuid()] },
            item with { EvidenceIds = [proof, proof] }, item with { Description = " " }
        }) Assert.Throws<ContractException>(() => DepositDeductionPolicy.Normalize(input with { Items = [invalid] }, 100000, [asset], [proof]));
        Assert.Throws<ContractException>(() => DepositDeductionPolicy.Normalize(input with { Items = [item, item] }, 100000, [asset], [proof]));
        Assert.Throws<ContractException>(() => DepositDeductionPolicy.Normalize(input with { HumanConfirmed = false }, 10000, [asset], [proof]));
        Assert.Throws<ContractException>(() => DepositDeductionPolicy.Normalize(input with { ExpectedVersion = int.MaxValue }, 10000, [asset], [proof]));
    }
    [Fact]
    public void ExactLargeMoneyAndIntegerVersionsStayDistinctOnTheWire()
    {
        var plan = new DepositDeductionPlan(Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), 1, 2,
            Guid.NewGuid(), DateTimeOffset.UtcNow, "Synthetic", "obligation", 999999999999999999m, [], [], Guid.NewGuid(), "hash");
        var value = JsonSerializer.SerializeToElement(plan, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        Assert.Equal("999999999999999999", value.GetProperty("total").GetString());
        Assert.Equal(2, value.GetProperty("version").GetInt32());
    }
    private sealed class Actor(string role, Guid? id) : ICurrentUser
    { public Guid? UserId => id; public bool IsInRole(string candidate) => candidate == role; }
    [Fact]
    public async Task OwnerCannotCreateAnotherLegacyPlan()
    {
        var repo = Substitute.For<IDepositDeductionRepository>();
        repo.TransactionAsync(Arg.Any<Guid>(), Arg.Any<Func<Task<DepositDeductionPlan>>>(), Arg.Any<CancellationToken>())
            .Returns(c => c.Arg<Func<Task<DepositDeductionPlan>>>()());
        var service = new DepositDeductionService(repo, new Actor("Owner", Guid.NewGuid()), new PaymentRuntimeMode(false));
        var error = await Assert.ThrowsAsync<ContractException>(() => service.ApproveAsync(Guid.NewGuid(), Input(), Guid.NewGuid(), default));
        Assert.Equal("settlement_receivables_replace_legacy_deductions", error.Code);
    }
    [Fact]
    public async Task ProductionCannotReplayADevelopmentLegacyDecision()
    {
        var repo = Substitute.For<IDepositDeductionRepository>();
        repo.TransactionAsync(Arg.Any<Guid>(), Arg.Any<Func<Task<DepositDeductionPlan>>>(), Arg.Any<CancellationToken>())
            .Returns(c => c.Arg<Func<Task<DepositDeductionPlan>>>()());
        repo.OperationAsync(Arg.Any<Guid>(), Arg.Any<Guid>(), Arg.Any<CancellationToken>()).Returns(new DepositDeductionPlan(
            Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), 1, 1, Guid.NewGuid(), DateTimeOffset.UtcNow,
            "Synthetic legacy demo", "source", 10000, [], [], Guid.NewGuid(), "historical", true));
        var service = new DepositDeductionService(repo, new Actor("Owner", Guid.NewGuid()), new PaymentRuntimeMode(false));
        Assert.Equal("development_payment_unavailable", (await Assert.ThrowsAsync<ContractException>(() => service.ApproveAsync(Guid.NewGuid(), Input(), Guid.NewGuid(), default))).Code);
    }
    [Theory]
    [InlineData("Staff", 403)]
    [InlineData("Tenant", 403)]
    [InlineData("", 401)]
    public async Task NonOwnerIsDeniedBeforeAnySourceOrPrivateFileLookup(string role, int status)
    {
        var repo = Substitute.For<IDepositDeductionRepository>();
        var service = new DepositDeductionService(repo, new Actor(role, role == "" ? null : Guid.NewGuid()));
        var error = await Assert.ThrowsAsync<ContractException>(() => service.ApproveAsync(Guid.NewGuid(), Input(), Guid.NewGuid(), default));
        Assert.Equal(status, error.Status); Assert.Empty(repo.ReceivedCalls());
    }
}
