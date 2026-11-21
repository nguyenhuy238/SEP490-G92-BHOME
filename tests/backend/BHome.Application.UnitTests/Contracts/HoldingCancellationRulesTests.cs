using System.Text.Json;
using BHome.Application.Contracts;
using BHome.Domain.TenantContracts;
namespace BHome.Application.UnitTests.Contracts;
public sealed class HoldingCancellationRulesTests
{
    [Fact]
    public void ReferenceSurvivesJsonbKeyOrderAndWhitespaceButRejectsChangedMoney()
    {
        var contract = Guid.NewGuid();
        var value = new HoldingCancellationDisposition(HoldingCancellationRules.Kind, HoldingCancellationCause.OwnerCannotProvideRoom,
            100000, 0, 100000, Guid.NewGuid(), DateTimeOffset.UtcNow, "Synthetic verified Owner cancellation");
        var review = new ContractSettlementReview { ContractId = contract, Decision = "HoldingRefundRequired", FinancialSnapshot = JsonSerializer.Serialize(value) };
        var reference = HoldingCancellationRules.Reference(contract, review);
        using var json = JsonDocument.Parse(review.FinancialSnapshot);
        review.FinancialSnapshot = JsonSerializer.Serialize(json.RootElement.EnumerateObject().Reverse().ToDictionary(p => p.Name, p => p.Value), new JsonSerializerOptions { WriteIndented = true });
        Assert.Equal(reference, HoldingCancellationRules.Reference(contract, review));
        review.FinancialSnapshot = JsonSerializer.Serialize(value with { RefundRequired = 100001 });
        Assert.NotEqual(reference, HoldingCancellationRules.Reference(contract, review));
    }
}
