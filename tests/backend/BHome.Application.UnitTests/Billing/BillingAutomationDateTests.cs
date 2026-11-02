using BHome.Application.Billing;
namespace BHome.Application.UnitTests.Billing;
public sealed class BillingAutomationDateTests
{
    [Theory]
    [InlineData("2026-11-01T16:59:59Z", "2026-11-01")]
    [InlineData("2026-11-01T17:00:00Z", "2026-11-02")]
    [InlineData("2026-12-31T17:00:00Z", "2027-01-01")]
    [InlineData("2028-02-28T17:00:00Z", "2028-02-29")]
    public void CalendarUsesVietnamBusinessDate(string instant, string expected) => Assert.Equal(DateOnly.Parse(expected), BillingAutomationDates.BusinessDate(DateTimeOffset.Parse(instant)));
}
