using System.Net;
using System.Net.Http.Json;
using BHome.Application.Finance;
using BHome.Application.PaymentsDebt;
using BHome.Domain.Billing;
using BHome.Domain.IdentityAccess;
using BHome.Domain.PaymentsDebt;
using BHome.Domain.PropertyManagement;
using BHome.Domain.TenantContracts;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests.PaymentsDebt;

public sealed partial class PaymentLedgerTests
{
    internal async Task FinanceTrendVietnamMonthBoundaryAcceptance()
    {
        var w = await Setup(sharedContract: true);
        using var owner = await Client(w.Owner);
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(
            DateTimeOffset.UtcNow, "Asia/Ho_Chi_Minh").DateTime);
        var month = new DateOnly(today.Year, today.Month, 1).AddMonths(-1);
        var midnight = new DateTimeOffset(month.ToDateTime(TimeOnly.MinValue), TimeSpan.FromHours(7)).ToUniversalTime();
        foreach (var (amount, at) in new[] { (10000m, midnight.AddSeconds(-1)), (20000m, midnight) })
        {
            var transfer = await As(w.Owner, Roles.Owner, service => service.RegisterAsync(
                Input(w, amount) with { OccurredAt = PaymentRules.Timestamp(at) }, Guid.NewGuid(), default));
            await As(w.Owner, Roles.Owner, service => service.AllocateAsync(
                transfer.Id, new(w.Invoice, w.Tenants[0], true), Guid.NewGuid(), default));
        }
        var report = (await owner.GetFromJsonAsync<FinancialReport>(
            $"/api/v1/financial-reports?from={month.AddMonths(-1):yyyy-MM-dd}&to={month.AddMonths(1).AddDays(-1):yyyy-MM-dd}&locationId={w.Location}"))!;
        Assert.Equal(2, report.Trend!.Count);
        Assert.Equal("10000", report.Trend[0].ActualBusinessCollections);
        Assert.Equal("20000", report.Trend[1].ActualBusinessCollections);
        Assert.Equal("0", report.Trend[0].Revenue);
        Assert.Equal("100000", report.Trend[1].Revenue);
        Assert.Equal("30000", report.Total.Management!.ActualBusinessCollections);
    }

    internal async Task ForecastRentCoverageAcceptance()
    {
        var w = await Setup(sharedContract: false, rent: 3100000);
        using var owner = await Client(w.Owner);
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(DateTimeOffset.UtcNow, "Asia/Ho_Chi_Minh").DateTime);
        var month = new DateOnly(today.Year, today.Month, 1);
        var next = month.AddMonths(1);
        var path = $"/api/v1/financial-scenarios/defaults?from={month.AddMonths(-1):yyyy-MM-dd}&to={month.AddDays(-1):yyyy-MM-dd}&locationId={w.Location}";
        var initial = (await owner.GetFromJsonAsync<ScenarioDefaults>(path))!;
        Assert.Equal("3100000", initial.MonthlyRent);
        Assert.Equal("100", initial.OccupancyPercent);
        Assert.Equal(1, initial.Obligations!.RentCoverage!.ContractedRooms);
        Assert.Equal(next.AddMonths(1).AddDays(-1).Day, initial.Obligations.RentCoverage.OccupiedRoomDays);
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
            var contracts = await db.Set<Contract>().Where(c => c.RoomId == w.Room).OrderBy(c => c.Id).ToArrayAsync();
            Assert.Equal(3, contracts.Length);
            contracts[0].EndDate = next.AddDays(4);
            contracts[1].StartDate = next.AddDays(10);
            contracts[2].EndDate = month.AddMonths(1).AddDays(-1);
            await db.SaveChangesAsync();
        }
        var partial = (await owner.GetFromJsonAsync<ScenarioDefaults>(path))!;
        var coverage = partial.Obligations!.RentCoverage!;
        Assert.Equal(1, coverage.ContractedRooms);
        Assert.Equal(coverage.PossibleRoomDays - 5, coverage.OccupiedRoomDays);
        Assert.Equal("3100000", partial.MonthlyRent);
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
            var contract = await db.Set<Contract>().Where(c => c.RoomId == w.Room).OrderBy(c => c.Id).FirstAsync();
            contract.MonthlyRent = 3200000;
            await db.SaveChangesAsync();
        }
        var conflict = (await owner.GetFromJsonAsync<ScenarioDefaults>(path))!;
        Assert.Null(conflict.MonthlyRent);
        Assert.Equal(1, conflict.Obligations!.RentCoverage!.UnresolvedRooms);
        Assert.Equal(partial.OccupancyPercent, conflict.OccupancyPercent);
    }

    internal async Task ForecastSnapshotAcceptance()
    {
        var w = await Setup(sharedContract: true);
        using var owner = await Client(w.Owner);
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        var token = timeout.Token;
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(
            DateTimeOffset.UtcNow, "Asia/Ho_Chi_Minh").DateTime);
        var month = new DateOnly(today.Year, today.Month, 1);
        var filter = new ReportFilter(month.AddMonths(-1), month.AddDays(-1), w.Location);
        var next = month.AddMonths(1);
        var projection = new ReportFilter(next, next.AddMonths(1).AddDays(-1), w.Location);
        await using var scope = fixture.Factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        var scenarios = scope.ServiceProvider.GetRequiredService<IFinancialScenarioRepository>();
        var reports = scope.ServiceProvider.GetRequiredService<IFinancialReportRepository>();
        var before = await scenarios.ReadSnapshotAsync(async () =>
        {
            var first = await reports.ReadAsync(filter, token);
            var beforeObligations = await scenarios.ObligationsAsync(filter, next, token);
            var beforeDepreciation = await reports.DepreciationSourcesAsync(projection, 1, 10, token);
            Assert.Equal("0", beforeDepreciation.TotalAmount);
            // Separate API request / DbContext commits while the read snapshot is open.
            using var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/expenses")
            {
                Content = JsonContent.Create(new ExpenseInput(w.Location, null, "INITIAL_INVESTMENT",
                    "Snapshot concurrent investment", 1200, filter.From, "Synthetic committed change"))
            };
            request.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString());
            using var response = await owner.SendAsync(request, token);
            Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync(token));
            var expense = (await response.Content.ReadFromJsonAsync<ExpenseView>(cancellationToken: token))!;
            using var plan = new HttpRequestMessage(HttpMethod.Post, $"/api/v1/depreciation/{expense.Id}")
            {
                Content = JsonContent.Create(new DepreciationInput("Equipment", filter.From, 12, 0, null, null, expense.Version, "Synthetic plan"))
            };
            plan.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString());
            using var planResponse = await owner.SendAsync(plan, token);
            Assert.True(planResponse.IsSuccessStatusCode, await planResponse.Content.ReadAsStringAsync(token));
            var second = await reports.ReadAsync(filter, token);
            Assert.Equal(first.Locations.Single().Investment, second.Locations.Single().Investment);
            Assert.Equal(beforeObligations, await scenarios.ObligationsAsync(filter, next, token));
            Assert.Equal(beforeDepreciation.TotalAmount, (await reports.DepreciationSourcesAsync(projection, 1, 10, token)).TotalAmount);
            return first.Locations.Single().Investment;
        }, token);
        Assert.Null(db.Database.CurrentTransaction);
        var after = await reports.ReadAsync(filter, token);
        Assert.Equal(before + 1200, after.Locations.Single().Investment);
        Assert.Equal("100", (await reports.DepreciationSourcesAsync(projection, 1, 10, token)).TotalAmount);
        await Assert.ThrowsAsync<InvalidOperationException>(() => scenarios.ReadSnapshotAsync<int>(
            () => throw new InvalidOperationException("Synthetic read failure"), token));
        Assert.Null(db.Database.CurrentTransaction);
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => scenarios.ReadSnapshotAsync<int>(
            () => Task.FromCanceled<int>(new CancellationToken(true)), token));
        Assert.Null(db.Database.CurrentTransaction);
        Assert.Equal(before + 1200, (await reports.ReadAsync(filter, token)).Locations.Single().Investment);
    }

    internal async Task ManagementFinanceAcceptance()
    {
        const decimal rent = 100_000_000;
        var w = await Setup(sharedContract: true, rent: rent);
        using var owner = await Client(w.Owner);
        using var staff = await Client(w.Staff);
        DateOnly period;
        Guid previousInvoice;
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
            var current = await db.Set<Invoice>().AsNoTracking().SingleAsync(i => i.Id == w.Invoice);
            period = current.BillingPeriod;
            var previous = new Invoice
            {
                RoomId = w.Room,
                LocationId = w.Location,
                RoomNumber = current.RoomNumber,
                LocationName = current.LocationName,
                BillingPeriod = period.AddMonths(-1),
                RepresentativeContractId = w.Contract,
                RepresentativeTenantUserId = w.Tenants[0],
                Total = rent,
                CreatedByUserId = w.Owner,
                ScheduledFinalDate = period.AddMonths(-1),
                DueDate = period.AddDays(-1),
                ScheduleSnapshot = "{}",
                Recipients = w.Tenants.Select(t => new InvoiceRecipient { TenantUserId = t }).ToList(),
                Lines = [new InvoiceLine { Category = ChargeCategory.Rent, ChargeCode = "RENT", Name = "Synthetic rent",
                    Rate = rent - 1_000_000, Quantity = 1, Amount = rent - 1_000_000, OccupiedDays = 30, PeriodDays = 30, RateDate = period.AddMonths(-1) },
                    new InvoiceLine { Category = ChargeCategory.ServiceFee, ChargeCode = "SERVICE-INTERNET", Name = "Synthetic internet",
                        Rate = 1_000_000, Quantity = 1, Amount = 1_000_000, OccupiedDays = 30, PeriodDays = 30, RateDate = period.AddMonths(-1) }]
            };
            db.Add(previous); await db.SaveChangesAsync();
            previous.Status = InvoiceStatus.Final; previous.FinalizedByUserId = w.Owner; previous.FinalizedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync(); previousInvoice = previous.Id;
        }
        async Task PayInvoice(Guid invoice, decimal amount, DateOnly day)
        {
            var key = Guid.NewGuid();
            var input = Input(w, amount, memo: PaymentRules.InvoiceReference(invoice)) with
            {
                ProposedInvoiceId = invoice,
                OccurredAt = PaymentRules.Timestamp(new DateTimeOffset(day.ToDateTime(new TimeOnly(12, 0)), TimeSpan.FromHours(7)).ToUniversalTime())
            };
            var transfer = await As(w.Owner, Roles.Owner, s => s.RegisterAsync(input, key, default));
            Assert.Equal(transfer.Id, (await As(w.Owner, Roles.Owner, s => s.RegisterAsync(input, key, default))).Id);
            await As(w.Owner, Roles.Owner, s => s.AllocateAsync(transfer.Id, new(invoice, w.Tenants[0], true), Guid.NewGuid(), default));
        }
        await PayInvoice(previousInvoice, rent, period.AddDays(-2));
        await PayInvoice(w.Invoice, 96_000_000, period.AddDays(5));
        async Task<T> Post<T>(string path, object input, Guid key)
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, path) { Content = JsonContent.Create(input) };
            request.Headers.Add("Idempotency-Key", key.ToString());
            using var response = await owner.SendAsync(request);
            Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
            return (await response.Content.ReadFromJsonAsync<T>())!;
        }
        async Task<ExpenseView> Cost(string category, decimal amount, DateOnly date, string type = "OPERATING") =>
            await Post<ExpenseView>("/api/v1/expenses", new ExpenseInput(w.Location, null, type, category, amount, date, "Synthetic acceptance"), Guid.NewGuid());
        async Task<ExpensePaymentView> Confirm(ExpenseView expense, decimal paid, DateOnly date)
        {
            var input = new ExpensePaymentInput(paid, date, expense.Version, "Synthetic verified receipt");
            var key = Guid.NewGuid(); var path = $"/api/v1/expenses/{expense.Id}/payments";
            var result = await Post<ExpensePaymentView>(path, input, key);
            var replay = await Post<ExpensePaymentView>(path, input, key);
            Assert.Equal(result.Version, replay.Version); Assert.Single(replay.Events); Assert.Equal(paid, replay.PaidAmount);
            return result;
        }
        await Confirm(await Cost("Maintenance", 5_000_000, period.AddMonths(-1)), 5_000_000, period.AddDays(-1));
        await Confirm(await Cost("Utilities", 19_000_000, period.AddMonths(-1)), 19_000_000, period.AddDays(-1));
        await Confirm(await Cost("Maintenance", 10_000_000, period), 10_000_000, period.AddDays(1));
        var utilities = await Cost("Utilities", 20_000_000, period);
        var partial = await Confirm(utilities, 18_000_000, period.AddDays(2));
        Assert.Equal("PartiallyPaid", partial.Status); Assert.Equal(2_000_000, partial.RemainingAmount);
        var investment = await Cost("Building", 180_000_000, period, "INITIAL_INVESTMENT");
        var paidInvestment = await Confirm(investment, 180_000_000, period);
        var plan = await Post<DepreciationView>($"/api/v1/depreciation/{investment.Id}",
            new DepreciationInput("Building", period, 12, 0, null, null, paidInvestment.Version, "Synthetic life"), Guid.NewGuid());
        Assert.Single(plan.Revisions);
        var to = period.AddMonths(1).AddDays(-1);
        var reportPath = $"/api/v1/financial-reports?from={period:yyyy-MM-dd}&to={to:yyyy-MM-dd}&locationId={w.Location}&includeComparison=true";
        using var response = await owner.GetAsync(reportPath);
        Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
        var report = (await response.Content.ReadFromJsonAsync<FinancialReport>())!;
        var management = Assert.IsType<FinanceManagementTotals>(report.Total.Management);
        Assert.Equal("100000000", management.Revenue);
        Assert.Equal("96000000", management.ActualBusinessCollections);
        Assert.Equal("30000000", report.Total.OperatingExpenses);
        Assert.Equal("70000000", report.Total.OperatingProfit);
        Assert.Equal("28000000", management.OperatingPaymentsConfirmed);
        Assert.Equal("15000000", management.Depreciation);
        var trendReport = (await owner.GetFromJsonAsync<FinancialReport>(
            $"/api/v1/financial-reports?from={period.AddMonths(-1):yyyy-MM-dd}&to={to:yyyy-MM-dd}&locationId={w.Location}"))!;
        Assert.Null(trendReport.TrendUnavailableReason);
        Assert.Equal(2, trendReport.Trend!.Count);
        var previousPoint = trendReport.Trend[0];
        var currentPoint = trendReport.Trend[1];
        Assert.Equal(period.AddMonths(-1), previousPoint.From);
        Assert.Equal(period.AddDays(-1), previousPoint.To);
        Assert.Equal("100000000", previousPoint.Revenue);
        Assert.Equal("24000000", previousPoint.OperatingExpenses);
        Assert.Equal("76000000", previousPoint.OperatingProfit);
        Assert.Equal("100000000", previousPoint.ActualBusinessCollections);
        Assert.Equal("24000000", previousPoint.OperatingPaymentsConfirmed);
        Assert.Equal(period, currentPoint.From);
        Assert.Equal(to, currentPoint.To);
        Assert.Equal("100000000", currentPoint.Revenue);
        Assert.Equal("30000000", currentPoint.OperatingExpenses);
        Assert.Equal("70000000", currentPoint.OperatingProfit);
        Assert.Equal("96000000", currentPoint.ActualBusinessCollections);
        Assert.Equal("28000000", currentPoint.OperatingPaymentsConfirmed);
        Assert.All(trendReport.Trend, point => Assert.True(point.IsComplete));
        decimal Amount(string amount) => decimal.Parse(amount, System.Globalization.CultureInfo.InvariantCulture);
        Assert.Equal(Amount(trendReport.Total.Management!.Revenue), trendReport.Trend.Sum(point => Amount(point.Revenue)));
        Assert.Equal(Amount(trendReport.Total.OperatingExpenses), trendReport.Trend.Sum(point => Amount(point.OperatingExpenses)));
        Assert.Equal(Amount(trendReport.Total.OperatingProfit), trendReport.Trend.Sum(point => Amount(point.OperatingProfit)));
        Assert.Equal(Amount(trendReport.Total.Management.ActualBusinessCollections),
            trendReport.Trend.Sum(point => Amount(point.ActualBusinessCollections)));
        Assert.Equal(Amount(trendReport.Total.Management.OperatingPaymentsConfirmed!),
            trendReport.Trend.Sum(point => Amount(point.OperatingPaymentsConfirmed!)));
        var chainTrend = (await owner.GetFromJsonAsync<FinancialReport>(
            $"/api/v1/financial-reports?from={period.AddMonths(-1):yyyy-MM-dd}&to={to:yyyy-MM-dd}"))!;
        Assert.Equal(trendReport.Trend, chainTrend.Trend);
        var clipped = (await owner.GetFromJsonAsync<FinancialReport>(
            $"/api/v1/financial-reports?from={period.AddDays(1):yyyy-MM-dd}&to={to:yyyy-MM-dd}&locationId={w.Location}"))!;
        var clippedPoint = Assert.Single(clipped.Trend!);
        Assert.Equal(period.AddDays(1), clippedPoint.From);
        Assert.Equal(to, clippedPoint.To);
        Assert.False(clippedPoint.IsComplete);
        Assert.Equal(clipped.Total.Management!.Revenue, clippedPoint.Revenue);
        Assert.Equal(clipped.Total.Management.ActualBusinessCollections, clippedPoint.ActualBusinessCollections);
        Assert.Equal(clipped.Total.Management.OperatingPaymentsConfirmed, clippedPoint.OperatingPaymentsConfirmed);
        var depreciationPath = $"/api/v1/financial-reports/depreciation-sources?from={period:yyyy-MM-dd}&to={to:yyyy-MM-dd}&locationId={w.Location}&pageSize=1";
        var depreciationSources = (await owner.GetFromJsonAsync<DepreciationSourcePage>(depreciationPath))!;
        Assert.Equal(management.Depreciation, depreciationSources.TotalAmount);
        Assert.Equal("15000000", depreciationSources.KnownAmount);
        Assert.Equal(0, depreciationSources.UnknownLots);
        Assert.Equal(1L, depreciationSources.Total);
        var sourceLot = Assert.Single(depreciationSources.Items);
        Assert.Equal(investment.Id, sourceLot.ExpenseId);
        Assert.Equal(w.Location, sourceLot.LocationId);
        Assert.Null(sourceLot.RoomId);
        Assert.Equal("180000000", sourceLot.Cost);
        Assert.Equal(period, sourceLot.PurchasedOn);
        Assert.Equal(15_000_000m, sourceLot.Amounts!.Period);
        Assert.Equal(15_000_000m, sourceLot.Amounts.Accumulated);
        Assert.Equal(165_000_000m, sourceLot.Amounts.CarryingValue);
        Assert.Empty((await owner.GetFromJsonAsync<DepreciationSourcePage>(depreciationPath + "&page=2"))!.Items);
        Assert.Empty((await owner.GetFromJsonAsync<DepreciationSourcePage>(depreciationPath + $"&roomId={w.Room}"))!.Items);
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.GetAsync(depreciationPath)).StatusCode);
        using (var tenant = await Client(w.Tenants[0]))
            Assert.Equal(HttpStatusCode.Forbidden, (await tenant.GetAsync(depreciationPath)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.GetAsync(depreciationPath + "&page=0")).StatusCode);
        Assert.Equal("55000000", management.ProfitAfterDepreciation);
        Assert.Equal("68000000", management.OperatingCashFlow);
        Assert.Equal("4000000", management.PeriodOutstanding);
        Assert.Equal("2000000", management.OperatingUnpaidConfirmed);
        Assert.Equal("-112000000", management.NetCashAfterInvestment);
        var comparison = Assert.IsType<FinanceComparison>(report.Comparison);
        Assert.Equal("76000000", comparison.OperatingProfit.Previous);
        Assert.Equal("6000000", comparison.OperatingExpenses.Change);
        Assert.Equal("25", comparison.OperatingExpenses.ChangePercent);
        Assert.Equal("-7.89", comparison.OperatingProfit.ChangePercent);
        Assert.Equal("5000000", comparison.ExpenseCategories.Single(c => c.Category == "Maintenance").Change);
        Assert.Equal("1000000", comparison.ExpenseCategories.Single(c => c.Category == "Utilities").Change);
        foreach (var (kind, expected) in new[] { ("revenue", "100000000"), ("cash", "96000000"), ("debt", "4000000"), ("period-debt", "4000000"), ("deposit", "0") })
        {
            var path = $"/api/v1/financial-reports/sources?from={period:yyyy-MM-dd}&to={to:yyyy-MM-dd}&locationId={w.Location}&kind={kind}&pageSize=1";
            var detail = (await owner.GetFromJsonAsync<FinanceSourcePage>(path))!;
            Assert.Equal(expected, detail.TotalAmount);
            if (kind == "deposit") Assert.Empty(detail.Items);
            else
            {
                var item = Assert.Single(detail.Items);
                Assert.Equal(w.Location, item.LocationId);
                Assert.Equal(w.Room, item.RoomId);
                Assert.Equal(w.Contract, item.ContractId);
                Assert.Equal(expected, item.Amount);
                if (kind == "cash") Assert.NotNull(item.PaymentId);
                else Assert.Equal(w.Invoice, item.Id);
            }
            Assert.Equal(HttpStatusCode.Forbidden, (await staff.GetAsync(path)).StatusCode);
        }
        var sourcesPath = $"/api/v1/expenses?locationId={w.Location}&from={period:yyyy-MM-dd}&to={to:yyyy-MM-dd}&expenseType=OPERATING&includeTotalAmount=true&pageSize=1";
        var sources = (await owner.GetFromJsonAsync<ExpensePage>(sourcesPath))!;
        Assert.Equal(2L, sources.Total);
        Assert.Single(sources.Items);
        Assert.Equal("30000000", sources.TotalAmount);
        var maintenance = (await owner.GetFromJsonAsync<ExpensePage>(sourcesPath + "&category=Maintenance"))!;
        Assert.Equal("10000000", maintenance.TotalAmount);
        Assert.Single(maintenance.Items);
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.GetAsync(sourcesPath)).StatusCode);
        var defaultsPath = $"/api/v1/financial-scenarios/defaults?from={period:yyyy-MM-dd}&to={to:yyyy-MM-dd}&locationId={w.Location}";
        var defaults = (await owner.GetFromJsonAsync<ScenarioDefaults>(defaultsPath))!;
        Assert.Equal("20000000", defaults.MonthlyUtilityServiceCost);
        Assert.Equal("10000000", defaults.MonthlyMaintenanceCost);
        Assert.Equal("0", defaults.MonthlyOtherCost);
        Assert.Equal("15000000", defaults.MonthlyDepreciation);
        Assert.Equal("0", defaults.MonthlyServiceRevenue);
        Assert.Equal("93.33", defaults.OperatingPaymentPercent);
        var previousDefaults = (await owner.GetFromJsonAsync<ScenarioDefaults>(
            $"/api/v1/financial-scenarios/defaults?from={period.AddMonths(-1):yyyy-MM-dd}&to={period.AddDays(-1):yyyy-MM-dd}&locationId={w.Location}"))!;
        Assert.Equal("1000000", previousDefaults.MonthlyServiceRevenue);
        Assert.Equal("100", previousDefaults.OperatingPaymentPercent);
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.GetAsync(defaultsPath)).StatusCode);
        var scenario = new ScenarioInput("Synthetic scenario", new(period, to, w.Location), 2,
            new(100_000_000, 50, 80, 20_000_000, 0, 10_000_000, 0, MonthlyDepreciation: 15_000_000));
        var scenarioKey = Guid.NewGuid();
        var saved = await Post<ScenarioView>("/api/v1/financial-scenarios", scenario, scenarioKey);
        var replayed = await Post<ScenarioView>("/api/v1/financial-scenarios", scenario, scenarioKey);
        Assert.Equal(saved.Id, replayed.Id);
        Assert.Equal(System.Text.Json.JsonSerializer.Serialize(saved.Result), System.Text.Json.JsonSerializer.Serialize(replayed.Result));
        Assert.Equal("management-cash-v2", saved.CalculationVersion);
        var unchanged = (await owner.GetFromJsonAsync<FinancialReport>(reportPath))!;
        Assert.Equal(report.Total.OperatingProfit, unchanged.Total.OperatingProfit);
        Assert.Equal(management.Revenue, unchanged.Total.Management!.Revenue);
        Assert.Equal(management.ActualBusinessCollections, unchanged.Total.Management.ActualBusinessCollections);
        Assert.Equal(management.OperatingPaymentsConfirmed, unchanged.Total.Management.OperatingPaymentsConfirmed);
        Assert.Equal(management.Depreciation, unchanged.Total.Management.Depreciation);
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(report.SnapshotAt, "Asia/Ho_Chi_Minh").DateTime);
        var disposalPath = $"/api/v1/depreciation/{investment.Id}/disposal";
        var receiptPath = $"/api/v1/depreciation/{investment.Id}/disposal-receipts";
        var disposalKey = Guid.NewGuid();
        var disposalInput = new InvestmentDisposalInput(today, 30_000_000, plan.Version, "Synthetic disposal");
        var disposal = await Post<DepreciationView>(disposalPath, disposalInput, disposalKey);
        Assert.Equal(disposal.Version, (await Post<DepreciationView>(disposalPath, disposalInput, disposalKey)).Version);
        Assert.Equal("30000000", disposal.DisposalOutstanding);
        Assert.Equal("0", disposal.DisposalReceived);
        Assert.Equal(0, disposal.Amounts!.CarryingValue);
        var receiptKey = Guid.NewGuid();
        var receiptInput = new InvestmentReceiptInput(12_000_000, today, disposal.Version, "First transfer");
        var firstReceipt = await Post<DepreciationView>(receiptPath, receiptInput, receiptKey);
        Assert.Equal("18000000", firstReceipt.DisposalOutstanding);
        Assert.Single((await Post<DepreciationView>(receiptPath, receiptInput, receiptKey)).Receipts!);
        var currentPath = $"/api/v1/financial-reports?from={today:yyyy-MM-dd}&to={today:yyyy-MM-dd}&locationId={w.Location}";
        var partialDisposalReport = (await owner.GetFromJsonAsync<FinancialReport>(currentPath))!;
        Assert.Equal("12000000", partialDisposalReport.Total.Management!.AssetDisposalReceipts);
        Assert.Equal("12000000", partialDisposalReport.Total.Management.NetCashAfterInvestment);
        Assert.Equal("0", partialDisposalReport.Total.Management.OperatingCashFlow);
        var finalReceipt = await Post<DepreciationView>(receiptPath, new InvestmentReceiptInput(18_000_000, today, firstReceipt.Version, "Final transfer"), Guid.NewGuid());
        Assert.Equal("0", finalReceipt.DisposalOutstanding);
        Assert.Equal(2, finalReceipt.Receipts!.Count);
        var disposalReport = (await owner.GetFromJsonAsync<FinancialReport>(currentPath))!;
        Assert.Equal("30000000", disposalReport.Total.Management!.NetCashAfterInvestment);
        Assert.Equal("0", disposalReport.Total.Management.Revenue);
        var historicalReport = (await owner.GetFromJsonAsync<FinancialReport>(reportPath))!;
        Assert.Equal(management.Depreciation, historicalReport.Total.Management!.Depreciation);
        var historicalSources = (await owner.GetFromJsonAsync<DepreciationSourcePage>(depreciationPath))!;
        Assert.Equal(depreciationSources.TotalAmount, historicalSources.TotalAmount);
        Assert.Equal(sourceLot.Amounts, Assert.Single(historicalSources.Items).Amounts);
        Assert.Equal(management.NetCashAfterInvestment, historicalReport.Total.Management.NetCashAfterInvestment);
        using (var forbidden = new HttpRequestMessage(HttpMethod.Post, receiptPath) { Content = JsonContent.Create(receiptInput) })
        {
            forbidden.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString());
            Assert.Equal(HttpStatusCode.Forbidden, (await staff.SendAsync(forbidden)).StatusCode);
        }
        // A category whose wording matches both utility and repair rules must be counted once.
        await Cost("Sửa chữa điện nước", 1_000_000, period);
        var overlapDefaults = (await owner.GetFromJsonAsync<ScenarioDefaults>(defaultsPath))!;
        Assert.Equal("20000000", overlapDefaults.MonthlyUtilityServiceCost);
        Assert.Equal("11000000", overlapDefaults.MonthlyMaintenanceCost);
        Assert.Equal("0", overlapDefaults.MonthlyOtherCost);
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.GetAsync($"/api/v1/expenses/{utilities.Id}/payments")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.GetAsync($"/api/v1/depreciation/{investment.Id}")).StatusCode);
        var unknown = await Cost("Unknown depreciation", 1000, period, "INITIAL_INVESTMENT");
        var incomplete = (await owner.GetFromJsonAsync<DepreciationSourcePage>(depreciationPath))!;
        Assert.Null(incomplete.TotalAmount);
        Assert.Equal("15000000", incomplete.KnownAmount);
        Assert.Equal(1, incomplete.UnknownLots);
        Assert.Equal(2L, incomplete.Total);
        var secondPage = (await owner.GetFromJsonAsync<DepreciationSourcePage>(depreciationPath + "&page=2"))!;
        Assert.Equal(incomplete.TotalAmount, secondPage.TotalAmount);
        Assert.Contains(unknown.Id, incomplete.Items.Concat(secondPage.Items).Select(x => x.ExpenseId));
        // Exercise due-date events on a separate expense after the report fixture
        // assertions, so the original acceptance dataset remains unchanged.
        var dueExpense = await Cost("Due date test", 1000, period);
        var paymentPath = $"/api/v1/expenses/{dueExpense.Id}/payments";
        var duePath = paymentPath + "/due-date";
        var legacy = (await owner.GetFromJsonAsync<ExpensePaymentView>(paymentPath))!;
        Assert.Null(legacy.DueOn);
        Assert.Null(legacy.PaidAmount);
        Assert.Equal("Unknown", legacy.Status);
        var dueKey = Guid.NewGuid();
        var dueInput = new ExpenseDueDateInput(today.AddDays(1), legacy.Version, "Agreed due date");
        var scheduled = await Post<ExpensePaymentView>(duePath, dueInput, dueKey);
        Assert.Equal(dueInput.DueOn, scheduled.DueOn);
        Assert.Equal("Unknown", scheduled.DueStatus);
        Assert.Equal(scheduled.Version, (await Post<ExpensePaymentView>(duePath, dueInput, dueKey)).Version);
        Assert.Single(scheduled.DueHistory!);
        Assert.Empty(scheduled.Events);
        async Task<HttpStatusCode> DueStatus(HttpClient client, ExpenseDueDateInput input, Guid key)
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, duePath) { Content = JsonContent.Create(input) };
            request.Headers.Add("Idempotency-Key", key.ToString());
            using var result = await client.SendAsync(request);
            return result.StatusCode;
        }
        Assert.Equal(HttpStatusCode.Conflict, await DueStatus(owner, dueInput with { Note = "Changed replay" }, dueKey));
        Assert.Equal(HttpStatusCode.Conflict, await DueStatus(owner, dueInput, Guid.NewGuid()));
        Assert.Equal(HttpStatusCode.Forbidden, await DueStatus(staff, dueInput, Guid.NewGuid()));
        Assert.Equal(HttpStatusCode.BadRequest, await DueStatus(owner, dueInput with { DueOn = period.AddDays(-1), ExpectedVersion = scheduled.Version }, Guid.NewGuid()));
        var unpaid = await Post<ExpensePaymentView>(paymentPath, new ExpensePaymentInput(0, null, scheduled.Version, "Confirmed unpaid"), Guid.NewGuid());
        Assert.Equal("Unpaid", unpaid.Status);
        Assert.Equal("NotDue", unpaid.DueStatus);
        var onDay = await Post<ExpensePaymentView>(duePath, new ExpenseDueDateInput(today, unpaid.Version, "Due today"), Guid.NewGuid());
        Assert.Equal("DueToday", onDay.DueStatus);
        var overdue = await Post<ExpensePaymentView>(duePath, new ExpenseDueDateInput(today.AddDays(-1), onDay.Version, "Revised date"), Guid.NewGuid());
        Assert.Equal("Overdue", overdue.DueStatus);
        var part = await Post<ExpensePaymentView>(paymentPath, new ExpensePaymentInput(400, today, overdue.Version, "Part payment"), Guid.NewGuid());
        Assert.Equal("PartiallyPaid", part.Status);
        Assert.Equal("Overdue", part.DueStatus);
        Assert.Equal(600, part.RemainingAmount);
        var cleared = await Post<ExpensePaymentView>(duePath, new ExpenseDueDateInput(null, part.Version, "Due date unknown"), Guid.NewGuid());
        Assert.Null(cleared.DueOn);
        Assert.Equal("Unknown", cleared.DueStatus);
        Assert.Equal(4, cleared.DueHistory!.Count);
        Assert.Equal(2, cleared.Events.Count);
        var full = await Post<ExpensePaymentView>(paymentPath, new ExpensePaymentInput(600, today, cleared.Version, "Final payment"), Guid.NewGuid());
        Assert.Equal("Paid", full.Status);
        Assert.Equal("Paid", full.DueStatus);
        Assert.Equal(1000, full.PaidAmount);
        Assert.Equal(4, full.DueHistory!.Count);
        // Synthetic homogeneous asset purchase snapshot. No real inventory or
        // other fixture is modified. Preserve the original purchase expense.
        var fourUnits = Guid.NewGuid();
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
            var history = """[{"action":"VerifiedAssetInvestment","quantity":4,"unitCost":300,"amount":1200}]""";
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO expenses(id,location_id,room_id,expense_type,category,amount,occurred_on,note,source_key,recorded_by_user_id,history)
                VALUES({fourUnits},{w.Location},{w.Room},'INITIAL_INVESTMENT','Equipment',1200,{period},'Four homogeneous units',{"asset-capital:synthetic:" + fourUnits.ToString("N")},{w.Owner},{history}::jsonb)
                """);
        }
        var lotPath = $"/api/v1/depreciation/{fourUnits}";
        var lot = (await owner.GetFromJsonAsync<DepreciationView>(lotPath))!;
        Assert.Equal(4, lot.Quantity);
        var configured = await Post<DepreciationView>(lotPath,
            new DepreciationInput("Equipment", period, 12, 0, null, null, lot.Version, "Equal units"), Guid.NewGuid());
        var historicalLot = (await owner.GetFromJsonAsync<DepreciationSourcePage>(depreciationPath + $"&roomId={w.Room}"))!;
        Assert.Equal("100", historicalLot.TotalAmount);
        var historicalAmounts = Assert.Single(historicalLot.Items).Amounts;
        var firstSaleKey = Guid.NewGuid();
        var lateDate = today.AddMonths(-1);
        var firstSaleInput = new InvestmentDisposalInput(lateDate, 200, configured.Version, "One unit; late declaration", 1, true);
        var firstSale = await Post<DepreciationView>(lotPath + "/disposal", firstSaleInput, firstSaleKey);
        Assert.Null(firstSale.Disposal);
        Assert.Equal(3, firstSale.RemainingQuantity);
        Assert.Equal(1200, firstSale.Cost);
        Assert.Equal("200", Assert.Single(firstSale.PartialDisposals!).Outstanding);
        Assert.Equal(lateDate, firstSale.PartialDisposals![0].Sale.Input.DisposedOn);
        Assert.Equal(DepreciationMath.StartMonth(today), firstSale.PartialDisposals![0].Sale.RecognizedOn);
        Assert.Equal(firstSale.Version, (await Post<DepreciationView>(lotPath + "/disposal", firstSaleInput, firstSaleKey)).Version);
        async Task<HttpStatusCode> SellStatus(HttpClient client, InvestmentDisposalInput input, Guid key)
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, lotPath + "/disposal") { Content = JsonContent.Create(input) };
            request.Headers.Add("Idempotency-Key", key.ToString());
            using var result = await client.SendAsync(request);
            return result.StatusCode;
        }
        Assert.Equal(HttpStatusCode.BadRequest, await SellStatus(owner, firstSaleInput with { Quantity = 4, ExpectedVersion = firstSale.Version }, Guid.NewGuid()));
        Assert.Equal(HttpStatusCode.Conflict, await SellStatus(owner, firstSaleInput, Guid.NewGuid()));
        Assert.Equal(HttpStatusCode.Conflict, await SellStatus(owner, firstSaleInput with { SaleAmount = 201 }, firstSaleKey));
        Assert.Equal(HttpStatusCode.Forbidden, await SellStatus(staff, firstSaleInput, Guid.NewGuid()));
        var receiptForFirst = new InvestmentReceiptInput(80, today, firstSale.Version, "Partial receipt", firstSaleKey);
        var firstCollected = await Post<DepreciationView>(lotPath + "/disposal-receipts", receiptForFirst, Guid.NewGuid());
        Assert.Equal("80", Assert.Single(firstCollected.PartialDisposals!).Received);
        Assert.Equal("120", Assert.Single(firstCollected.PartialDisposals!).Outstanding);
        var secondKey = Guid.NewGuid();
        var secondSale = await Post<DepreciationView>(lotPath + "/disposal",
            new InvestmentDisposalInput(today, 400, firstCollected.Version, "Two units", 2), secondKey);
        Assert.Equal(1, secondSale.RemainingQuantity);
        Assert.Equal(2, secondSale.PartialDisposals!.Count);
        var secondCollected = await Post<DepreciationView>(lotPath + "/disposal-receipts",
            new InvestmentReceiptInput(400, today, secondSale.Version, "Second sale paid", secondKey), Guid.NewGuid());
        Assert.Equal("120", secondCollected.PartialDisposals![0].Outstanding);
        Assert.Equal("0", secondCollected.PartialDisposals[1].Outstanding);
        var last = await Post<DepreciationView>(lotPath + "/disposal",
            new InvestmentDisposalInput(today, 50, secondCollected.Version, "Last unit", 1), Guid.NewGuid());
        Assert.Equal(0, last.RemainingQuantity);
        Assert.Equal(0, last.Amounts!.CarryingValue);
        Assert.Equal("50", last.DisposalOutstanding);
        var roomHistorical = (await owner.GetFromJsonAsync<DepreciationSourcePage>(depreciationPath + $"&roomId={w.Room}"))!;
        Assert.Equal(historicalLot.TotalAmount, roomHistorical.TotalAmount);
        Assert.Equal(historicalAmounts, Assert.Single(roomHistorical.Items).Amounts);
        Assert.Equal(4, Assert.Single(roomHistorical.Items).RemainingQuantity);
        var roomCash = (await owner.GetFromJsonAsync<FinancialReport>(currentPath + $"&roomId={w.Room}"))!;
        Assert.Equal("480", roomCash.Total.Management!.AssetDisposalReceipts);
    }
}
