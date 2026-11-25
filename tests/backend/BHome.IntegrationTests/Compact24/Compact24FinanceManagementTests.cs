using BHome.IntegrationTests.PaymentsDebt;

namespace BHome.IntegrationTests.Compact24;

[Trait("Category", "CompactPostgres")]
public sealed class Compact24FinanceManagementTests
{
    [CompactPostgresFact]
    public async Task MonthlyCashTrendUsesVietnamMonthBoundaries()
    {
        var fixture = new Compact24WorkflowFixture();
        await fixture.InitializeAsync();
        try { await new PaymentLedgerTests(fixture.Capture).FinanceTrendVietnamMonthBoundaryAcceptance(); }
        finally { await fixture.DisposeAsync(); }
    }

    [CompactPostgresFact]
    public async Task ForecastUsesUniqueRoomDaysAndRejectsConflictingRates()
    {
        var fixture = new Compact24WorkflowFixture();
        await fixture.InitializeAsync();
        try { await new PaymentLedgerTests(fixture.Capture).ForecastRentCoverageAcceptance(); }
        finally { await fixture.DisposeAsync(); }
    }

    [CompactPostgresFact]
    public async Task RealLedgerCashAccrualDepreciationAndVarianceAcceptance()
    {
        var fixture = new Compact24WorkflowFixture();
        await fixture.InitializeAsync();
        try { await new PaymentLedgerTests(fixture.Capture).ManagementFinanceAcceptance(); }
        finally { await fixture.DisposeAsync(); }
    }

    [CompactPostgresFact]
    public async Task ForecastSnapshotSurvivesConcurrentCommittedChangesAndReleasesTransaction()
    {
        var fixture = new Compact24WorkflowFixture();
        await fixture.InitializeAsync();
        try { await new PaymentLedgerTests(fixture.Capture).ForecastSnapshotAcceptance(); }
        finally { await fixture.DisposeAsync(); }
    }

    [CompactPostgresFact]
    public async Task StaffAllocationIsAtomicIdempotentAndOwnerOnly()
    {
        var fixture = new Compact24WorkflowFixture();
        await fixture.InitializeAsync();
        try { await new PaymentLedgerTests(fixture.Capture).StaffCostAcceptance(); }
        finally { await fixture.DisposeAsync(); }
    }
}
