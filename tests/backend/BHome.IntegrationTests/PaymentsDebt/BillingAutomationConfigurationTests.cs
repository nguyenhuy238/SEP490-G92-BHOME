using System.Net;
using System.Net.Http.Json;
using BHome.Application.Billing;
using BHome.Domain.Billing;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
namespace BHome.IntegrationTests.PaymentsDebt;
public sealed partial class PaymentLedgerTests
{
    private static BillingScheduleWrite Calendar(Workspace w)=>new(w.Location,BillingRateDate.PeriodStart,BillingRentSource.RoomPolicy,PartialMonthRule.FullMonth,VndRounding.AwayFromZero,1,0,20,0,31,0,0);
    private static DateOnly CurrentPeriod(){var local=TimeZoneInfo.ConvertTimeBySystemTimeZoneId(DateTimeOffset.UtcNow,"Asia/Ho_Chi_Minh");return new(local.Year,local.Month,1);}
    private static BillingAutomationWrite Plan(Workspace w)=>new(w.Location,CurrentPeriod(),true,false,5,10,0,"Asia/Ho_Chi_Minh",0,1);
    [Fact]
    public async Task AutomationPreviewAndHistoryRemainOwnerOnlyAndReflectSelectedPeriod()
    {
        var w=await Setup();using var owner=await Client(w.Owner);using var tenant=await Client(w.Tenants[0]);
        var path=$"/api/v1/billing-automation/preview?locationId={w.Location}&period={CurrentPeriod():yyyy-MM-dd}";
        Assert.Equal(HttpStatusCode.Forbidden,(await tenant.GetAsync(path)).StatusCode);
        var missing=(await owner.GetFromJsonAsync<BillingAutomationPreview>(path))!;Assert.Empty(missing.Phases);
        (await owner.PutAsJsonAsync("/api/v1/billing-schedules",Calendar(w))).EnsureSuccessStatusCode();
        (await owner.PutAsJsonAsync("/api/v1/billing-automation",Plan(w))).EnsureSuccessStatusCode();
        var preview=(await owner.GetFromJsonAsync<BillingAutomationPreview>(path))!;
        Assert.True(preview.DeveloperActionsEnabled);Assert.Equal("Asia/Ho_Chi_Minh",preview.TimeZone);
        Assert.Equal(3,preview.Phases.Count);Assert.False(preview.Phases.Single(p=>p.Phase=="Final").Eligible);
        Assert.Empty((await owner.GetFromJsonAsync<BillingAutomationAttempt[]>($"/api/v1/billing-automation/attempts?locationId={w.Location}&period={CurrentPeriod():yyyy-MM-dd}"))!);
    }
    [Fact]
    public async Task AutomationCalendarIsOwnerAuthorizedEffectiveDatedAndImmutable()
    {
        var w=await Setup();using var owner=await Client(w.Owner);using var tenant=await Client(w.Tenants[0]);using var staff=await Client(w.Staff);
        (await owner.PutAsJsonAsync("/api/v1/billing-schedules",Calendar(w))).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Forbidden,(await staff.PutAsJsonAsync("/api/v1/billing-automation",Plan(w))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,(await tenant.GetAsync($"/api/v1/billing-automation/{w.Location}?period={CurrentPeriod():yyyy-MM-dd}")).StatusCode);
        var first=await owner.PutAsJsonAsync("/api/v1/billing-automation",Plan(w));first.EnsureSuccessStatusCode();var p=(await first.Content.ReadFromJsonAsync<BillingAutomationPlan>())!;Assert.False(p.AuthorizeAutomaticFinalization);
        Assert.Equal(HttpStatusCode.Conflict,(await owner.PutAsJsonAsync("/api/v1/billing-automation",Plan(w))).StatusCode);
        (await owner.PutAsJsonAsync("/api/v1/billing-schedules",Calendar(w) with {ExpectedVersion=1,DueDay=25})).EnsureSuccessStatusCode();
        (await owner.PutAsJsonAsync("/api/v1/billing-automation",Plan(w) with {EffectiveFrom=CurrentPeriod().AddMonths(1),ExpectedVersion=1,ExpectedBillingScheduleVersion=2,AuthorizeAutomaticFinalization=true})).EnsureSuccessStatusCode();
        var current=(await owner.GetFromJsonAsync<BillingAutomationPlan>($"/api/v1/billing-automation/{w.Location}?period={CurrentPeriod():yyyy-MM-dd}"))!;
        var future=(await owner.GetFromJsonAsync<BillingAutomationPlan>($"/api/v1/billing-automation/{w.Location}?period={CurrentPeriod().AddMonths(1):yyyy-MM-dd}"))!;
        Assert.Equal(1,current.Version);Assert.Equal(2,future.Version);Assert.Equal(31,BillingAutomationService.Calendar(current).DueDay);Assert.Equal(25,BillingAutomationService.Calendar(future).DueDay);
        await using var scope=fixture.Factory.Services.CreateAsyncScope();var db=scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
        await Assert.ThrowsAsync<PostgresException>(()=>db.Database.ExecuteSqlInterpolatedAsync($"UPDATE \"BillingAutomationPlans\" SET \"Enabled\"=false WHERE \"Id\"={p.Id}"));
        var invoice=await owner.PostAsJsonAsync("/api/v1/invoices/drafts",new DraftInvoiceInput(w.Room,CurrentPeriod(),w.Contract));invoice.EnsureSuccessStatusCode();
        Assert.Equal(InvoiceMath.CalendarDate(CurrentPeriod(),31,0),(await invoice.Content.ReadFromJsonAsync<InvoiceView>())!.DueDate);
    }
    [Theory]
    [InlineData("UTC",5,10,0,true,false)]
    [InlineData("Asia/Ho_Chi_Minh",32,10,0,true,false)]
    [InlineData("Asia/Ho_Chi_Minh",20,10,0,true,false)]
    [InlineData("Asia/Ho_Chi_Minh",5,10,0,false,true)]
    public async Task AutomationCalendarRejectsInvalidTimezoneDatesAndUnapprovedFinalization(string zone,int meter,int due,int offset,bool enabled,bool final)
    {
        var w=await Setup();using var owner=await Client(w.Owner);
        (await owner.PutAsJsonAsync("/api/v1/billing-schedules",Calendar(w))).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.BadRequest,(await owner.PutAsJsonAsync("/api/v1/billing-automation",Plan(w) with {TimeZone=zone,MeterDay=meter,MeterDueDay=due,MeterDueMonthOffset=offset,Enabled=enabled,AuthorizeAutomaticFinalization=final})).StatusCode);
    }
}
