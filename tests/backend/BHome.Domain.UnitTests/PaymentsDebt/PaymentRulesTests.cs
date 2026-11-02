using BHome.Domain.PaymentsDebt;

namespace BHome.Domain.UnitTests.PaymentsDebt;

public sealed class PaymentRulesTests
{
    [Theory]
    [InlineData(99, 100, "CODE", false, "partial_payment_policy_required")]
    [InlineData(101, 100, "CODE", false, "excess_payment_policy_required")]
    [InlineData(100, 0, "CODE", false, "invoice_already_settled")]
    [InlineData(100, 100, "OTHER", false, "invoice_transfer_reference_mismatch")]
    [InlineData(100, 100, "CODE", true, "bank_reference_already_credited")]
    [InlineData(100, 100, "code", false, null)]
    public void OnlyExactVerifiedObligationCanAllocate(decimal amount, decimal balance, string memo, bool claimed, string? expected) =>
        Assert.Equal(expected, PaymentRules.ReviewReason(amount, balance, memo, "CODE", claimed));
    [Fact]
    public void VietnamDateBoundaryAndSettledBillsDoNotCreateFalseOverdueDebt()
    {
        Assert.Equal(0, PaymentRules.OverdueDays(new(2026, 11, 1), new(2026, 11, 1), 100));
        Assert.Equal(1, PaymentRules.OverdueDays(new(2026, 11, 1), new(2026, 11, 2), 100));
        Assert.Equal(0, PaymentRules.OverdueDays(new(2026, 11, 1), new(2026, 11, 2), 0));
    }
    [Fact]
    public void ReferencesUseEntireInvoiceIdAndFitTransferDescriptionLimits()
    {
        var first = PaymentRules.InvoiceReference(Guid.Parse("de000000-0000-4000-8000-000000000001"));
        var second = PaymentRules.InvoiceReference(Guid.Parse("de000000-0000-4000-8000-000000000002"));
        Assert.NotEqual(first, second); Assert.Equal(25, first.Length);
        Assert.Matches("^[A-Z0-9]{25}$", first);
        Assert.False(PaymentRules.ValidMoney(1.5m)); Assert.False(PaymentRules.ValidMoney(0));
        Assert.Equal("SYNTHETIC-001", PaymentRules.NormalizeReference(" synthetic-001 "));
    }
}
