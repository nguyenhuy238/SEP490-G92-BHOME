using System.Text.Json;
using BHome.Application.Billing;
using BHome.Application.Contracts;

namespace BHome.Application.UnitTests.Contracts;

public sealed class SettlementCalculationTests
{
    private static SettlementInvoice Invoice(bool shared, decimal paid = 40, decimal payable = 90) =>
        new(Guid.NewGuid(), new(2026, 11, 1), shared, new(100, -10, payable, paid,
            Math.Max(0, payable - paid), Math.Max(0, paid - payable), 2, "None"));

    [Fact]
    public void SeparatesIssuedAdjustedPaidAndUnsplitSharedDebtWithoutCountingDepositAsRevenue()
    {
        var result = SettlementCalculator.Calculate([Invoice(true), Invoice(false, 20)], 500,
            new(500, 30, 100, 50));
        Assert.Equal(200, result.IssuedTotal); Assert.Equal(-20, result.ApprovedAdjustmentTotal);
        Assert.Equal(180, result.PayableTotal); Assert.Equal(60, result.VerifiedInvoicePayments);
        Assert.Equal(120, result.RoomOutstanding); Assert.Null(result.ContractSpecificOutstanding);
        Assert.Equal(320, result.AvailableSecurityDeposit); Assert.True(result.DepositPositionConsistent);
        Assert.Equal(100, result.DepositRefunded); Assert.Equal(50, result.DepositReserved);
    }
    [Fact]
    public void ExclusiveDebtIsKnownAndSharedPaidInvoiceDoesNotIntroduceUnknownLiability()
    {
        var result = SettlementCalculator.Calculate([Invoice(true, 90), Invoice(false, 10)], 0, new(0, 0, 0, 0));
        Assert.Equal(80, result.ContractSpecificOutstanding); Assert.Equal(0, result.AvailableSecurityDeposit);
    }
    [Fact]
    public void AdjustmentCreatedExcessIsNotRefundableUnallocatedDeposit()
    {
        var result = SettlementCalculator.Calculate([Invoice(false, 100)], 50, new(50, 0, 0, 0));
        Assert.Equal(10, result.PotentialInvoiceExcess); Assert.Equal(50, result.AvailableSecurityDeposit);
        Assert.Equal(0, result.ContractSpecificOutstanding);
    }
    [Theory]
    [InlineData(500, 501, 0, 0)]
    [InlineData(500, 0, 400, 101)]
    [InlineData(501, 0, 0, 0)]
    [InlineData(500, -1, 0, 0)]
    public void MismatchOrOverdrawnPositionIsUnknownRatherThanZero(decimal received, decimal used, decimal refunded, decimal held)
    {
        var result = SettlementCalculator.Calculate([], 500, new(received, used, refunded, held));
        Assert.Null(result.AvailableSecurityDeposit); Assert.False(result.DepositPositionConsistent);
    }
    [Fact]
    public void MissingLedgerDoesNotPretendThereWereNoPriorRefunds()
    {
        var result = SettlementCalculator.Calculate([], 500, null);
        Assert.Null(result.AvailableSecurityDeposit); Assert.Null(result.DepositReserved);
    }
    [Fact]
    public void DuplicateInvoiceCannotDoubleCountAndMoneySerializesExactlyAsStrings()
    {
        var invoice = Invoice(false);
        Assert.Throws<ContractException>(() => SettlementCalculator.Calculate([invoice, invoice], 0, new(0, 0, 0, 0)));
        var result = SettlementCalculator.Calculate([], 999999999999999999, new(999999999999999999, 0, 0, 0));
        var json = JsonSerializer.SerializeToElement(result, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        Assert.Equal("999999999999999999", json.GetProperty("availableSecurityDeposit").GetString());
        Assert.Equal(JsonValueKind.String, json.GetProperty("roomOutstanding").ValueKind);
    }
}
