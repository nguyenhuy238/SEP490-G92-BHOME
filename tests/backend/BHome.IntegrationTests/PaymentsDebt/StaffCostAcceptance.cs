using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using BHome.Application.Finance;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests.PaymentsDebt;

public sealed partial class PaymentLedgerTests
{
    internal async Task StaffCostAcceptance()
    {
        var w = await Setup(sharedContract: true);
        var employment = Guid.NewGuid();
        var secondLocation = Guid.NewGuid();
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(DateTimeOffset.UtcNow, "Asia/Ho_Chi_Minh").DateTime);
        var period = new DateOnly(today.Year, today.Month, 1).AddMonths(-1);
        var end = period.AddMonths(3).AddDays(-1);
        string Assignment() => JsonSerializer.Serialize(new[] { new { id = Guid.NewGuid(), staffUserId = w.Staff, startDate = period, endDate = end } });
        await using (var scope = fixture.Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO staff_employments(id,staff_user_id,start_date,end_date,salary_type,base_rate,status)
                VALUES({employment},{w.Staff},{period},{end},'Monthly',10000000,'Active')
                """);
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE locations SET staff_assignments={Assignment()}::jsonb WHERE id={w.Location}
                """);
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO locations(id,name,address,staff_assignments)
                VALUES({secondLocation},'Synthetic allocation','Synthetic address',{Assignment()}::jsonb)
                """);
        }
        using var owner = await Client(w.Owner);
        using var staff = await Client(w.Staff);
        var path = $"/api/v1/staff-costs?period={period:yyyy-MM-dd}";
        var list = await owner.GetFromJsonAsync<StaffCostCandidate[]>(path);
        var candidate = Assert.Single(list!, c => c.EmploymentId == employment);
        Assert.Equal("10000000", candidate.BaseRate);
        Assert.Equal(2, candidate.Locations.Count);
        Assert.False(candidate.Recorded);
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.GetAsync(path)).StatusCode);
        var input = new StaffCostInput(employment, period, "Lương", 10_000_000,
            [new(w.Location, 6_000_000), new(secondLocation, 4_000_000)], "Synthetic confirmed split");
        async Task<HttpResponseMessage> Post(HttpClient client, StaffCostInput value, Guid key)
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/staff-costs") { Content = JsonContent.Create(value) };
            request.Headers.Add("Idempotency-Key", key.ToString());
            return await client.SendAsync(request);
        }
        using var denied = await Post(staff, input, Guid.NewGuid());
        Assert.Equal(HttpStatusCode.Forbidden, denied.StatusCode);
        using var invalid = await Post(owner, input with { Total = 9_000_000 }, Guid.NewGuid());
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        var key = Guid.NewGuid();
        var results = await Task.WhenAll(Post(owner, input, key), Post(owner, input, key));
        using var first = results[0]; using var replay = results[1];
        Assert.True(first.IsSuccessStatusCode, await first.Content.ReadAsStringAsync());
        Assert.True(replay.IsSuccessStatusCode, await replay.Content.ReadAsStringAsync());
        var ids = await first.Content.ReadFromJsonAsync<Guid[]>();
        Assert.Equal(ids, await replay.Content.ReadFromJsonAsync<Guid[]>());
        Assert.Equal(2, ids!.Length);
        using var duplicate = await Post(owner, input, Guid.NewGuid());
        Assert.Equal(HttpStatusCode.Conflict, duplicate.StatusCode);
        var after = Assert.Single((await owner.GetFromJsonAsync<StaffCostCandidate[]>(path))!, c => c.EmploymentId == employment);
        Assert.True(after.Recorded);
        await using var verification = fixture.Factory.Services.CreateAsyncScope();
        var check = verification.ServiceProvider.GetRequiredService<BHomePersistenceContext>();
        Assert.Equal(6_000_000m, await check.Database.SqlQuery<decimal>($"SELECT sum(amount) AS \"Value\" FROM expenses WHERE location_id={w.Location} AND category='Lương'").SingleAsync());
        Assert.Equal(4_000_000m, await check.Database.SqlQuery<decimal>($"SELECT sum(amount) AS \"Value\" FROM expenses WHERE location_id={secondLocation} AND category='Lương'").SingleAsync());
        var forecastMonth = period.AddMonths(2);
        var recurring = new RecurringExpenseWrite(w.Location, "Synthetic monthly obligation",
            250_000m, "MONTHLY", 1, period, null, true);
        using var createRule = new HttpRequestMessage(HttpMethod.Post, "/api/v1/recurring-expenses") { Content = JsonContent.Create(recurring) };
        createRule.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString());
        using var createdRule = await owner.SendAsync(createRule);
        Assert.True(createdRule.IsSuccessStatusCode, await createdRule.Content.ReadAsStringAsync());
        var rule = (await createdRule.Content.ReadFromJsonAsync<RecurringExpenseView>())!;
        using var revision = await owner.PutAsJsonAsync($"/api/v1/recurring-expenses/{rule.Id}", recurring with
        { Amount = 300_000m, ExpectedVersion = rule.Version, EffectiveFrom = forecastMonth });
        Assert.True(revision.IsSuccessStatusCode, await revision.Content.ReadAsStringAsync());
        var previousEnd = period.AddMonths(1).AddDays(-1);
        var defaultsPath = $"/api/v1/financial-scenarios/defaults?from={period:yyyy-MM-dd}&to={previousEnd:yyyy-MM-dd}";
        var chain = (await owner.GetFromJsonAsync<ScenarioDefaults>(defaultsPath))!;
        Assert.Equal(forecastMonth, chain.Obligations!.From);
        Assert.Equal("10000000", chain.Obligations.ContractualSalary);
        Assert.Equal("10000000", chain.Obligations.HistoricalAllocatedSalary);
        Assert.Equal("10000000", chain.MonthlyStaffCost);
        Assert.Equal("300000", chain.Obligations.RecurringDue);
        Assert.Equal("300000", chain.MonthlyOtherCost);
        var scoped = (await owner.GetFromJsonAsync<ScenarioDefaults>(defaultsPath + $"&locationId={w.Location}"))!;
        Assert.Null(scoped.Obligations!.ContractualSalary);
        Assert.Equal(1, scoped.Obligations.UnresolvedStaffCount);
        Assert.Null(scoped.MonthlyStaffCost);
        Assert.Equal("6000000", scoped.Obligations.HistoricalAllocatedSalary);
        Assert.Equal("300000", scoped.MonthlyOtherCost);
    }
}
