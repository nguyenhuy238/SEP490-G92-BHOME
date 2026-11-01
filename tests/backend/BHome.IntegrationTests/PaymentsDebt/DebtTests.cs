using System.Net;
using System.Net.Http.Json;
using BHome.Application.PaymentsDebt;
using BHome.Application.PropertyManagement;
using BHome.Domain.IdentityAccess;
using BHome.Domain.Locations;
using BHome.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace BHome.IntegrationTests.PaymentsDebt;

public sealed partial class PaymentLedgerTests
{
    [Fact]
    public async Task DebtHistoryFiltersAndStaffScopeUseSharedInvoiceOnceAndRemovePaidDebt()
    {
        var w=await Setup();using var owner=await Client(w.Owner);using var tenant=await Client(w.Tenants[1]);using var staff=await Client(w.Staff);
        var route=$"/api/v1/debts?locationId={w.Location}&overdueOnly=true";
        var debts=(await owner.GetFromJsonAsync<PagedResult<DebtInvoiceView>>(route))!;
        Assert.Equal(1,debts.TotalCount);Assert.Equal(w.Invoice,debts.Items[0].InvoiceId);Assert.Equal(1,debts.Items[0].OverdueDays);Assert.Equal(100000,debts.Items[0].OutstandingAmount);
        Assert.Equal(1,(await tenant.GetFromJsonAsync<PagedResult<DebtInvoiceView>>(route))!.TotalCount);
        Assert.Empty((await staff.GetFromJsonAsync<PagedResult<DebtInvoiceView>>(route))!.Items);
        await using(var scope=fixture.Factory.Services.CreateAsyncScope())
        {
            var db=scope.ServiceProvider.GetRequiredService<BHomeDbContext>();
            var today=DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(DateTimeOffset.UtcNow,"Asia/Ho_Chi_Minh").DateTime);
            db.Add(new StaffLocationAssignment(w.Location,w.Staff,w.Owner,today.AddDays(-1),today.AddDays(1)));await db.SaveChangesAsync();
        }
        var staffDebt=Assert.Single((await staff.GetFromJsonAsync<PagedResult<DebtInvoiceView>>(route))!.Items);
        Assert.Null(staffDebt.PayableAmount);Assert.Null(staffDebt.PaidAmount);Assert.Equal(100000,staffDebt.OutstandingAmount);
        Assert.Equal(HttpStatusCode.Forbidden,(await staff.GetAsync("/api/v1/payment-history")).StatusCode);
        var transfer=await As(w.Owner,Roles.Owner,s=>s.RegisterAsync(Input(w),Guid.NewGuid(),default));
        await As(w.Owner,Roles.Owner,s=>s.AllocateAsync(transfer.Id,new(w.Invoice,w.Tenants[0],true),Guid.NewGuid(),default));
        Assert.Empty((await owner.GetFromJsonAsync<PagedResult<DebtInvoiceView>>(route))!.Items);
        var paid=await tenant.GetFromJsonAsync<PagedResult<DebtInvoiceView>>($"/api/v1/payment-invoices?roomId={w.Room}&paymentStatus=Paid");
        Assert.Equal(1,paid!.TotalCount);Assert.Equal("Paid",paid.Items[0].PaymentStatus);
        var history=(await tenant.GetFromJsonAsync<PagedResult<PaymentHistoryEntry>>($"/api/v1/payment-history?roomId={w.Room}"))!;
        Assert.Equal(1,history.TotalCount);Assert.Null(history.Items[0].BankReference);Assert.Null(history.Items[0].VerifiedByUserId);
        var other=await Setup();using var outsider=await Client(other.Tenants[0]);
        Assert.Empty((await outsider.GetFromJsonAsync<PagedResult<PaymentHistoryEntry>>($"/api/v1/payment-history?roomId={w.Room}"))!.Items);
        Assert.Equal(HttpStatusCode.BadRequest,(await owner.GetAsync("/api/v1/debts?pageSize=101")).StatusCode);
    }
}
