using System.Text.Json;
using BHome.Application.PaymentsDebt;

namespace BHome.Application.UnitTests.PaymentsDebt;
public sealed class ReceiptExcessTargetTests
{
    [Fact]
    public void LegacyTargetKeepsItsFourPropertyFingerprintShape()
    {
        var target = new ReceiptExcessTarget(HoldingContractId: Guid.NewGuid());
        using var json = JsonDocument.Parse(JsonSerializer.Serialize(target));
        Assert.Equal(4, json.RootElement.EnumerateObject().Count());
        Assert.False(json.RootElement.TryGetProperty("DepositContractId", out _));
        ReceiptExcessRules.Validate(target);
    }
    [Fact]
    public void MainDepositTargetCanBeConfirmedIndependentlyOfOtherDebts()
    {
        var id = Guid.NewGuid(); var target = new ReceiptExcessTarget(DepositContractId: id);
        ReceiptExcessRules.Validate(target);
        Assert.Equal(target, JsonSerializer.Deserialize<ReceiptExcessTarget>(JsonSerializer.Serialize(target)));
    }
    [Fact]
    public void DepositCannotBeMixedWithAnInvoiceSettlementOrHoldingAlias()
    {
        var id = Guid.NewGuid();
        ReceiptExcessTarget[] invalid = [new(DepositContractId: Guid.Empty), new(InvoiceId: id, DepositContractId: id),
            new(HoldingContractId: id, DepositContractId: id), new(SettlementContractId: id, ReceivableId: id, DepositContractId: id), new(ReceivableId: id, DepositContractId: id)];
        foreach (var target in invalid) Assert.Equal("receipt_excess_target_required", Assert.Throws<PaymentException>(() => ReceiptExcessRules.Validate(target)).Code);
    }
}
