using System.Net;
using System.Net.Http.Json;
using BHome.Application.Finance;
using BHome.Application.IdentityAccess;
using BHome.Domain.Locations;
using BHome.Domain.PropertyManagement;
using BHome.Infrastructure.Persistence;
using BHome.Infrastructure.Persistence.Compact24;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests.Compact24;

[Trait("Category", "CompactPostgres")]
public sealed class Compact24ExpenseTests(Compact24Fixture fixture) : IClassFixture<Compact24Fixture>
{
    private const string Root = "/api/v1/expenses";
    private async Task<HttpClient> User(string role)
    {
        const string password = "Synthetic-Finance!874";
        var id = Guid.NewGuid(); var email = $"{id:N}@example.invalid";
        await using (var scope = fixture.Factory!.Services.CreateAsyncScope())
        {
            var user = await WorkflowTestUsers.CreateAsync(scope.ServiceProvider,
                new ApplicationUser { Id = id, UserName = email, Email = email, IsActive = true }, role, password);
            email = user.Email!;
        }
        var client = fixture.Factory!.CreateClient();
        var response = await client.PostAsJsonAsync("/api/v1/auth/login", new { email, password }); response.EnsureSuccessStatusCode();
        var session = (await response.Content.ReadFromJsonAsync<LoginResult>())!;
        client.DefaultRequestHeaders.Authorization = new("Bearer", session.AccessToken); return client;
    }
    private async Task<(HttpClient Owner, ExpenseInput Input)> Setup()
    {
        var owner = await User("Owner");
        await using var scope = fixture.Factory!.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var location = new Location("Synthetic Finance " + Guid.NewGuid()) { ChainId = await db.Set<Chain>().Select(c=>c.Id).SingleAsync() };
        db.Add(location); await db.SaveChangesAsync();
        return (owner, new(location.Id, null, "OPERATING", "Điện khu vực chung", 123456, new(2026,11,1), "Chứng từ tổng hợp"));
    }
    private static Task<HttpResponseMessage> Create(HttpClient owner, ExpenseInput value, Guid key)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, Root) { Content = JsonContent.Create(value) };
        request.Headers.Add("Idempotency-Key", key.ToString()); return owner.SendAsync(request);
    }
    private static async Task<ExpenseView> Value(HttpResponseMessage response)
    { Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync()); return (await response.Content.ReadFromJsonAsync<ExpenseView>())!; }

    [CompactPostgresFact]
    public async Task CreatesFiltersReloadsAndUpdatesWithAppendOnlySnapshotsAndNoNewTables()
    {
        var (owner, input) = await Setup();
        var created = await Value(await Create(owner,input,Guid.NewGuid()));
        Assert.Equal(1,created.Version); Assert.True(created.CanEdit);
        var view = await owner.GetFromJsonAsync<ExpenseView>($"{Root}/{created.Id}"); Assert.Equal(created,view);
        var page = await owner.GetFromJsonAsync<ExpensePage>($"{Root}?locationId={input.LocationId}&from=2026-11-01&to=2026-11-01&category={Uri.EscapeDataString(input.Category)}");
        Assert.Equal(1,page!.Total); Assert.Equal(created,Assert.Single(page.Items));
        var updated = await Value(await owner.PutAsJsonAsync($"{Root}/{created.Id}",new ExpenseUpdate(input with { Amount = 200000 },1,"Đối chiếu chứng từ")));
        Assert.Equal(2,updated.Version); Assert.Equal(200000,updated.Amount);
        Assert.Equal(HttpStatusCode.Conflict,(await owner.PutAsJsonAsync($"{Root}/{created.Id}",new ExpenseUpdate(input,1,"Phiên bản cũ"))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict,(await owner.PutAsJsonAsync($"{Root}/{created.Id}",new ExpenseUpdate(input with {ExpenseType="INITIAL_INVESTMENT"},2,"Đổi phân loại"))).StatusCode);
        await using var scope = fixture.Factory!.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<Compact24DbContext>();
        var history = await db.Database.SqlQuery<string>($"SELECT history::text AS \"Value\" FROM expenses WHERE id={created.Id}").SingleAsync();
        Assert.Contains("123456",history); Assert.Contains("200000",history); Assert.Contains("Đối chiếu chứng từ",System.Text.Json.JsonDocument.Parse(history).RootElement[1].GetProperty("Reason").GetString());
        Assert.True(await db.IsSchemaReadyAsync());
    }
    [CompactPostgresFact]
    public async Task ReplaysConcurrentCreatesRejectsChangedKeysAndHasOneUpdateWinner()
    {
        var (owner,input)=await Setup(); var key=Guid.NewGuid();
        var responses=await Task.WhenAll(Create(owner,input,key),Create(owner,input,key));
        var first=await Value(responses[0]); Assert.Equal(first.Id,(await Value(responses[1])).Id);
        Assert.Equal(HttpStatusCode.Conflict,(await Create(owner,input with {Amount=1},key)).StatusCode);
        var updates=await Task.WhenAll(owner.PutAsJsonAsync($"{Root}/{first.Id}",new ExpenseUpdate(input with {Amount=200},1,"A")),owner.PutAsJsonAsync($"{Root}/{first.Id}",new ExpenseUpdate(input with {Amount=300},1,"B")));
        Assert.Single(updates,r=>r.StatusCode==HttpStatusCode.OK); Assert.Single(updates,r=>r.StatusCode==HttpStatusCode.Conflict);
        var page=await owner.GetFromJsonAsync<ExpensePage>($"{Root}?locationId={input.LocationId}"); Assert.Equal(1,page!.Total);
    }
    [CompactPostgresFact]
    public async Task RejectsUnauthorizedInvalidAndCrossLocationInputWithoutFinancialWrites()
    {
        var (owner,input)=await Setup(); using var staff=await User("Staff"); using var tenant=await User("Tenant"); using var anonymous=fixture.Factory!.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized,(await anonymous.GetAsync(Root)).StatusCode);
        foreach(var client in new[]{staff,tenant})
        { Assert.Equal(HttpStatusCode.Forbidden,(await client.GetAsync(Root)).StatusCode); Assert.Equal(HttpStatusCode.Forbidden,(await Create(client,input,Guid.NewGuid())).StatusCode); }
        foreach(var value in new[]{input with {Amount=0},input with {Amount=-1},input with {Amount=1.1m},input with {ExpenseType="REFUND"},input with {Category=""},input with {Note=""}})
            Assert.Equal(HttpStatusCode.BadRequest,(await Create(owner,value,Guid.NewGuid())).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,(await owner.PostAsJsonAsync(Root,input)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,(await Create(owner,input with {RoomId=Guid.NewGuid()},Guid.NewGuid())).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,(await owner.GetAsync(Root+"?page=0")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,(await owner.GetAsync(Root+"?from=2026-12-01&to=2026-11-01")).StatusCode);
        var page=await owner.GetFromJsonAsync<ExpensePage>($"{Root}?locationId={input.LocationId}"); Assert.Equal(0,page!.Total);
    }
    [CompactPostgresFact]
    public async Task ReportReadsActualExpensesRejectsOtherRolesAndHandlesEmptyCapital()
    {
        var (owner,input)=await Setup();
        await Value(await Create(owner,input with {ExpenseType="INITIAL_INVESTMENT",Amount=1000000},Guid.NewGuid()));
        await Value(await Create(owner,input,Guid.NewGuid()));
        const string reportRoot="/api/v1/financial-reports?from=2026-11-01&to=2026-11-30";
        var response=await owner.GetAsync(reportRoot+$"&locationId={input.LocationId}");
        Assert.True(response.IsSuccessStatusCode,await response.Content.ReadAsStringAsync());
        var report=(await response.Content.ReadFromJsonAsync<FinancialReport>())!;
        Assert.Equal("1000000",report.Total.InitialInvestment); Assert.Equal("123456",report.Total.OperatingExpenses);
        Assert.Equal("-123456",report.Total.OperatingProfit); Assert.Equal("0",report.Total.VerifiedCollections);
        Assert.Null(report.Capital.EstimatedRemainingMonths); Assert.Equal("positive_cash_flow_required",report.Capital.UnavailableReason);
        Assert.Single(report.Locations);
        using var staff=await User("Staff"); Assert.Equal(HttpStatusCode.Forbidden,(await staff.GetAsync(reportRoot)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,(await owner.GetAsync("/api/v1/financial-reports")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,(await owner.GetAsync(reportRoot+$"&locationId={Guid.NewGuid()}")).StatusCode);
    }
}
