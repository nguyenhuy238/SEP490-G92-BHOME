using System.Net.Http.Json;
using System.Text.Json;
using BHome.Application.Finance;
using BHome.Application.IdentityAccess;
using BHome.Domain.PaymentsDebt;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using BHome.IntegrationTests.PaymentsDebt;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests.Compact24;

[Trait("Category", "CompactPostgres")]
public sealed class Compact24FinanceLedgerTests
{
    [CompactPostgresFact]
    public async Task ReportsFinalInvoicesAndVerifiedAllocationsWithoutCountingUnallocatedOrSimulatedTransfers()
    {
        var fixture = new Compact24WorkflowFixture(); await fixture.InitializeAsync();
        try
        {
            await new PaymentLedgerTests(fixture.Capture).FullPaymentIsAtomicIdempotentSharedAndDoesNotMutateFinalInvoice();
            string email;
            await using (var scope = fixture.Capture.Factory.Services.CreateAsyncScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<Compact24ArchiveContext>();
                var owner = await db.Users.SingleAsync(u => EF.Property<string[]>(u, "roles").Contains("Owner")); email = owner.Email!;
                // Verified, unallocated cash and explicitly simulated receipts must never become revenue.
                foreach (var demo in new[] { false, true }) db.Add(new PaymentTransfer
                {
                    ProviderIdentity = "SyntheticFinance",
                    BankReference = Guid.NewGuid().ToString(),
                    NormalizedReference = Guid.NewGuid().ToString(),
                    Amount = 9000000,
                    Currency = "VND",
                    OccurredAt = DateTimeOffset.UtcNow,
                    VerifiedAt = DateTimeOffset.UtcNow,
                    VerifiedByUserId = owner.Id,
                    IsDevelopmentDemo = demo,
                    StatementReference = "Synthetic",
                    VerificationReason = "Synthetic test"
                });
                await db.SaveChangesAsync();
            }
            using var client = fixture.Capture.Factory.CreateClient();
            var login = await client.PostAsJsonAsync("/api/v1/auth/login", new { email, password = WorkflowTestUsers.Password }); login.EnsureSuccessStatusCode();
            client.DefaultRequestHeaders.Authorization = new("Bearer", (await login.Content.ReadFromJsonAsync<LoginResult>())!.AccessToken);
            var response = await client.GetAsync("/api/v1/financial-reports?from=2000-01-01&to=2100-12-31");
            Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
            var report = (await response.Content.ReadFromJsonAsync<FinancialReport>())!;
            Assert.Null(report.Trend);
            Assert.Equal("period_too_long", report.TrendUnavailableReason);
            Assert.Equal("100000", report.Total.Issued); Assert.Equal("100000", report.Total.VerifiedCollections);
            Assert.Equal("0", report.Total.OutstandingNow); Assert.Equal(1, report.Total.TotalRooms); Assert.Equal(1, report.Total.OccupiedRooms);
            Assert.Equal("100000", report.Total.OperatingProfit); Assert.Null(report.Capital.EstimatedRemainingMonths);
            var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(
                DateTimeOffset.UtcNow, "Asia/Ho_Chi_Minh").DateTime);
            var completedMonth = new DateOnly(today.Year, today.Month, 1).AddMonths(-1);
            var scenario = new ScenarioInput("Tổng hợp", new(completedMonth, completedMonth.AddMonths(1).AddDays(-1)), 12, new(200000, 100, 50, 10000, 0, 0, 0));
            var analysis = await client.PostAsJsonAsync("/api/v1/financial-scenarios/analyze", scenario);
            Assert.True(analysis.IsSuccessStatusCode, await analysis.Content.ReadAsStringAsync());
            var calculated = (await analysis.Content.ReadFromJsonAsync<ScenarioView>())!;
            Assert.Null(calculated.Id); Assert.Equal("190000", calculated.Result.MonthlyProfit); Assert.Equal("90000", calculated.Result.MonthlyNetCashFlow);
            var key = Guid.NewGuid();
            Task<HttpResponseMessage> Save(ScenarioInput value) { var message = new HttpRequestMessage(HttpMethod.Post, "/api/v1/financial-scenarios") { Content = JsonContent.Create(value) }; message.Headers.Add("Idempotency-Key", key.ToString()); return client.SendAsync(message); }
            var saved = await Task.WhenAll(Save(scenario), Save(scenario));
            foreach (var item in saved) Assert.True(item.IsSuccessStatusCode, await item.Content.ReadAsStringAsync());
            var first = (await saved[0].Content.ReadFromJsonAsync<ScenarioView>())!; var second = (await saved[1].Content.ReadFromJsonAsync<ScenarioView>())!;
            Assert.Equal(first.Id, second.Id); Assert.Equal(first.Baseline.SnapshotAt, second.Baseline.SnapshotAt);
            Assert.Equal(System.Net.HttpStatusCode.Conflict, (await Save(scenario with { Name = "Changed" })).StatusCode);
            var loaded = (await client.GetFromJsonAsync<ScenarioView>($"/api/v1/financial-scenarios/{key}"))!;
            Assert.Equal(System.Text.Json.JsonSerializer.Serialize(first.Result), System.Text.Json.JsonSerializer.Serialize(loaded.Result)); Assert.Equal(scenario, loaded.Input);
            Assert.Single((await client.GetFromJsonAsync<ScenarioSummary[]>("/api/v1/financial-scenarios"))!);
            var unchanged = (await client.GetFromJsonAsync<FinancialReport>("/api/v1/financial-reports?from=2000-01-01&to=2100-12-31"))!;
            Assert.Equal(System.Text.Json.JsonSerializer.Serialize(report.Total), System.Text.Json.JsonSerializer.Serialize(unchanged.Total));
            Assert.Equal(System.Net.HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/v1/financial-scenarios/analyze", scenario with { Assumptions = scenario.Assumptions with { OccupancyPercent = 101 } })).StatusCode);
            Assert.Equal(System.Net.HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/v1/financial-scenarios/analyze", scenario with { ForecastMonths = 0 })).StatusCode);
            Assert.Equal(System.Net.HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/v1/financial-scenarios/analyze", scenario with { Baseline = scenario.Baseline with { LocationId = Guid.Empty } })).StatusCode);
            var legacyKey = Guid.NewGuid();
            await using (var scope = fixture.Capture.Factory.Services.CreateAsyncScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
                Assert.Equal(1, await db.Database.SqlQuery<int>($"SELECT count(*)::integer AS \"Value\" FROM financial_scenarios").SingleAsync());
                Assert.Equal(0, await db.Database.SqlQuery<int>($"SELECT count(*)::integer AS \"Value\" FROM expenses").SingleAsync());
                Assert.True(await db.IsSchemaReadyAsync());
                // Reproduce the persisted v1 shape in the disposable fixture. Its
                // recorded result must remain immutable, rather than being recalculated.
                await db.Database.ExecuteSqlInterpolatedAsync($$"""
                    INSERT INTO financial_scenarios(id,location_id,name,baseline_from,baseline_to,forecast_months,
                        assumptions,baseline_snapshot,result_snapshot,calculation_version,created_by_user_id,calculated_at)
                    SELECT {{legacyKey}},location_id,name,baseline_from,baseline_to,forecast_months,
                        jsonb_set(assumptions,'{Assumptions}',(assumptions->'Assumptions')
                            - ARRAY['MonthlyServiceRevenue','AdditionalInvestment','MonthlyDepreciation','OperatingPaymentPercent','CostIncreasePercent']),
                        (baseline_snapshot #- '{Total,Management}') - 'Comparison' - 'ReceiptReconciliation',
                        result_snapshot - ARRAY['MonthlyProfitAfterDepreciation','MonthlyMarginPercent','MonthlyOperatingPayments','ForecastCashAfterInvestment','Warnings'],
                        'management-constant-v1',created_by_user_id,calculated_at
                    FROM financial_scenarios WHERE id={{key}}
                    """);
            }
            var legacy = (await client.GetFromJsonAsync<ScenarioView>($"/api/v1/financial-scenarios/{legacyKey}"))!;
            Assert.Equal("management-constant-v1", legacy.CalculationVersion);
            Assert.Equal(scenario, legacy.Input);
            Assert.Null(legacy.Baseline.Total.Management);
            Assert.Equal("90000", legacy.Result.MonthlyNetCashFlow);
            Assert.Null(legacy.Result.MonthlyOperatingPayments);
            Assert.Null(legacy.Result.MonthlyProfitAfterDepreciation);
            using var legacyReplay = new HttpRequestMessage(HttpMethod.Post, "/api/v1/financial-scenarios") { Content = JsonContent.Create(scenario) };
            legacyReplay.Headers.Add("Idempotency-Key", legacyKey.ToString());
            using var legacyResponse = await client.SendAsync(legacyReplay);
            legacyResponse.EnsureSuccessStatusCode();
            var replayedLegacy = (await legacyResponse.Content.ReadFromJsonAsync<ScenarioView>())!;
            Assert.Equal(legacy.CalculationVersion, replayedLegacy.CalculationVersion);
            Assert.Equal(legacy.Result, replayedLegacy.Result);
            await NativeScenarioPersistenceParityAsync(fixture, key, legacyKey, first);
        }
        finally { await fixture.DisposeAsync(); }
    }

    private static async Task NativeScenarioPersistenceParityAsync(Compact24WorkflowFixture fixture, Guid key, Guid legacyKey, ScenarioView saved)
    {
        await using var scope = fixture.Capture.Factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var repository = scope.ServiceProvider.GetRequiredService<IFinancialScenarioRepository>();
        var actor = await db.Database.SqlQuery<Guid>($"SELECT created_by_user_id AS \"Value\" FROM financial_scenarios WHERE id={key}").SingleAsync();
        // Independently compare every persisted column against the original SQL/serializer contract.
        var input = saved.Input;
        var assumptions = JsonSerializer.Serialize(input);
        var baseline = JsonSerializer.Serialize(saved.Baseline);
        var result = JsonSerializer.Serialize(saved.Result);
        Assert.True(await db.Database.SqlQuery<bool>($"""
            SELECT (location_id IS NOT DISTINCT FROM {input.Baseline.LocationId}::uuid
                AND name={input.Name} AND baseline_from={input.Baseline.From} AND baseline_to={input.Baseline.To}
                AND forecast_months={(short)input.ForecastMonths} AND assumptions={assumptions}::jsonb
                AND baseline_snapshot={baseline}::jsonb AND result_snapshot={result}::jsonb
                AND calculation_version={saved.CalculationVersion} AND created_by_user_id={actor}
                AND calculated_at={saved.Baseline.SnapshotAt}) AS "Value"
            FROM financial_scenarios WHERE id={key}
            """).SingleAsync());

        var otherActor = Guid.NewGuid();
        Assert.Null(await repository.GetAsync(key, otherActor, default));
        Assert.Empty(await repository.ListAsync(otherActor, 1, 10, default));
        var conflict = await Assert.ThrowsAsync<FinanceException>(() => repository.SaveAsync(key, otherActor, saved, default));
        Assert.Equal(409, conflict.Status);
        Assert.Equal("scenario_idempotency_conflict", conflict.Code);
        Assert.Null(db.Database.CurrentTransaction);

        // Even if recalculation now differs, replay returns the original immutable snapshot.
        var recalculated = saved with
        {
            Baseline = saved.Baseline with { SnapshotAt = saved.Baseline.SnapshotAt.AddDays(1) },
            Result = saved.Result with { MonthlyProfit = "0" }
        };
        Assert.Equal(JsonSerializer.Serialize(saved), JsonSerializer.Serialize(await repository.SaveAsync(key, actor, recalculated, default)));
        Assert.Null(db.Database.CurrentTransaction);

        // A failed native insert must release the transaction and leave the key reusable.
        var retryKey = Guid.NewGuid();
        var failure = await Assert.ThrowsAsync<DbUpdateException>(() => repository.SaveAsync(retryKey, otherActor, saved, default));
        Assert.Equal(Npgsql.PostgresErrorCodes.ForeignKeyViolation, Assert.IsType<Npgsql.PostgresException>(failure.InnerException).SqlState);
        Assert.Null(db.Database.CurrentTransaction);
        Assert.False(await db.Database.SqlQuery<bool>($"SELECT EXISTS(SELECT 1 FROM financial_scenarios WHERE id={retryKey}) AS \"Value\"").SingleAsync());
        var retried = await repository.SaveAsync(retryKey, actor, saved, default);
        Assert.Equal(JsonSerializer.Serialize(saved with { Id = retryKey }), JsonSerializer.Serialize(retried));
        Assert.Null(db.Database.CurrentTransaction);

        // All three rows have the same stored timestamp; preserve PostgreSQL UUID tie-break and pagination.
        var expected = await db.Database.SqlQuery<Guid>($"""
            SELECT id AS "Value" FROM financial_scenarios WHERE created_by_user_id={actor}
            ORDER BY calculated_at DESC,id
            """).ToArrayAsync();
        Assert.Equal(3, expected.Length);
        Assert.Contains(legacyKey, expected);
        Assert.Equal(expected, (await repository.ListAsync(actor, 1, 10, default)).Select(row => row.Id).ToArray());
        Assert.Equal(expected[1], Assert.Single(await repository.ListAsync(actor, 2, 1, default)).Id);
    }
}
